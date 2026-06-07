/**
 * GameModel —— 引擎无关的游戏内核（相当于去掉 DOM 的 web/src/game.js 内核）。
 *
 * 职责：持有 grid / dock / score / best / wallet；提供落子与技能（撤销/炸弹/彩虹/冻结）
 * 的纯逻辑操作，并以事件回调对外广播，任意渲染端只需订阅事件绘制，不复制业务逻辑。
 */
import { Grid } from './grid';
import { DockBlock, GameEvent, Skin, ClearResult, ClearReason, GameMode, NearMissLine } from './types';
import { getMode, ModeDef } from './modes';
import { Rng, defaultRng } from './rng';
import { generateDock, SpawnOptions } from './spawn';
import { computeClearScore, deriveNextComboCount } from './scoring';
import { getSkin, DEFAULT_SKIN_ID } from './skins';
import { BOARD_SIZE, DEFAULT_SCORING, ScoringConfig } from './config';
import { Wallet } from './economy';
import { deriveAdaptivePlan } from './adaptive';

export interface GameModelOptions {
    size?: number;
    rng?: Rng;
    skinId?: string;
    scoring?: ScoringConfig;
    best?: number;
    coins?: number;
    /** 玩法模式（默认 classic） */
    mode?: GameMode;
    /**
     * 出块注入：返回 3 块候选。用于接入与 web 完全同源的真实出块闭包
     * （engine/bot/blockSpawn.generateDockShapes，见 core/engineSpawn.ts）。
     * 返回空数组时自动回退到内置自适应 generateDock，保证健壮性。
     */
    spawnFn?: (grid: Grid) => DockBlock[];
}

export type EventListener = (e: GameEvent) => void;

interface Snapshot {
    cells: (number | null)[][];
    dock: DockBlock[];
    score: number;
}

const UNDO_DEPTH = 8;
const COINS_PER_LINE = 2;
const COINS_PERFECT = 25;

export class GameModel {
    grid: Grid;
    dock: DockBlock[] = [];
    score = 0;
    best = 0;
    skin: Skin;
    gameOver = false;
    wallet: Wallet;
    freezeActive = false;
    mode: GameMode = 'classic';
    modeDef: ModeDef;
    /** 本局已复活次数（供变现/难度调控参考） */
    reviveCount = 0;
    /** Combo 链（时间维度，**带 grace 窗口**）—— 当前 combo 已累计的清线次数（粉色爱心 ♥N）。
     *  - 清线 → 按 grace 窗口判定：gap<grace → +1；gap≥grace → 重启=1
     *  - 未清 → 不变（仅累加 roundsSinceLastClear；下次清线判定）
     *  与「空间维度单手多消」`result.count` 完全独立。详见
     *  docs/product/CLEAR_SCORING.md §〇 术语权威。 */
    comboCount = 0;
    /** 距上次清线的未清步数（Infinity 表示尚未启动 combo 或 reset 后）。 */
    roundsSinceLastClear = Number.POSITIVE_INFINITY;
    /** @deprecated 旧字段名 clearStreak —— 现已等同 comboCount（grace 窗口模型）。 */
    get clearStreak(): number { return this.comboCount; }
    set clearStreak(v: number) { this.comboCount = Math.max(0, Math.floor(Number(v) || 0)); }

    private rng: Rng;
    private scoring: ScoringConfig;
    private listeners: EventListener[] = [];
    private undoStack: Snapshot[] = [];
    private spawnFn?: (grid: Grid) => DockBlock[];

    constructor(opts: GameModelOptions = {}) {
        this.grid = new Grid(opts.size ?? BOARD_SIZE);
        this.rng = opts.rng ?? defaultRng;
        this.scoring = opts.scoring ?? DEFAULT_SCORING;
        this.skin = getSkin(opts.skinId ?? DEFAULT_SKIN_ID);
        this.best = opts.best ?? 0;
        this.wallet = new Wallet(opts.coins ?? 0);
        this.wallet.onChange((coins, delta) => this.emit({ type: 'wallet', coins, delta }));
        this.spawnFn = opts.spawnFn;
        this.mode = opts.mode ?? 'classic';
        this.modeDef = getMode(this.mode);
    }

    setMode(mode: GameMode): void {
        this.mode = mode;
        this.modeDef = getMode(mode);
    }

    /**
     * 出块统一入口：优先用注入的真实引擎闭包（与 web 同源）；
     * 失败或返回空时回退内置自适应 generateDock，确保任何环境都可玩。
     */
    private refillDock(): DockBlock[] {
        if (this.spawnFn) {
            try {
                const blocks = this.spawnFn(this.grid);
                if (blocks && blocks.length > 0) return blocks;
            } catch {
                /* 引擎异常 → 回退 */
            }
        }
        return generateDock(this.grid, this.spawnOpts());
    }

    onEvent(fn: EventListener): () => void {
        this.listeners.push(fn);
        return () => {
            const i = this.listeners.indexOf(fn);
            if (i >= 0) this.listeners.splice(i, 1);
        };
    }

    private emit(e: GameEvent): void {
        for (const fn of this.listeners) fn(e);
    }

    /** 自适应开关：默认开启（接入 PB 曲线 + 拓扑压力调控出块）。 */
    adaptiveEnabled = true;

    private spawnOpts(): SpawnOptions {
        if (!this.adaptiveEnabled) {
            return { rng: this.rng, skin: this.skin, minPlayable: 1 };
        }
        const plan = deriveAdaptivePlan(this.grid, this.score, this.best);
        return {
            rng: this.rng,
            skin: this.skin,
            categoryWeights: plan.categoryWeights,
            minPlayable: plan.minPlayable,
        };
    }

    /**
     * 开新局（重新初始化）—— 强契约：
     *   - `score` 必为 0；
     *   - `best` 保持不变（持久 PB，跨局延续）；
     *   - 所有派生态（gameOver / freeze / reviveCount / undoStack）清零；
     *   - 候选区 refill 后广播一次 'dock' + 一次 score=0 的 'score'，UI 据此重置。
     *
     * 注意：'score' 事件即便 delta=0 也必须广播一次（绕过 addScore 的早返），
     * 否则 HUD 中可能残留上一局的 tween 末态分数（"重新初始化时得分不为 0"的常见根因之一）。
     */
    newGame(): void {
        this.grid.clear();
        this.score = 0;
        this.gameOver = false;
        this.freezeActive = false;
        this.reviveCount = 0;
        this.undoStack = [];
        this.dock = this.refillDock();
        this.emit({ type: 'newgame' });
        this.emit({ type: 'dock', blocks: this.dock });
        this.emit({ type: 'score', score: this.score, delta: 0 });
        this.emit({ type: 'freeze', active: false, used: false });
    }

    setSkin(id: string): void {
        this.skin = getSkin(id);
    }

    canPlaceBlock(index: number, gx: number, gy: number): boolean {
        const b = this.dock[index];
        if (!b || b.placed) return false;
        return this.grid.canPlace(b.shape, gx, gy);
    }

    private pushSnapshot(): void {
        this.undoStack.push({
            cells: this.grid.cells.map((row) => [...row]),
            dock: this.dock.map((b) => ({ ...b, shape: b.shape })),
            score: this.score,
        });
        if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    }

    placeAt(index: number, gx: number, gy: number): boolean {
        if (this.gameOver) return false;
        const block = this.dock[index];
        if (!block || block.placed) return false;
        if (!this.grid.canPlace(block.shape, gx, gy)) return false;

        this.pushSnapshot();
        this.grid.place(block.shape, block.colorIdx, gx, gy);
        block.placed = true;

        const placedCells = block.shape.flat().filter(Boolean).length;
        this.addScore(placedCells * this.scoring.placeUnit);
        this.emit({ type: 'place', index, gx, gy, colorIdx: block.colorIdx, shape: block.shape });

        const result = this.grid.checkLines(this.skin.blockIcons);
        if (result.count > 0) {
            const perfectClear = this.grid.getFillRatio() === 0;
            /* Combo (grace 窗口模型) —— 按 deriveNextComboCount 推导；与 web 主局完全同源。 */
            this.comboCount = deriveNextComboCount(
                this.comboCount,
                this.roundsSinceLastClear,
                true,
                this.scoring.comboMultiplier,
            );
            this.roundsSinceLastClear = 0;
            const { clearScore, comboMultiplier } = computeClearScore(
                { count: result.count, bonusLines: result.bonusLines, perfectClear },
                this.scoring,
                this.comboCount,
            );
            this.addScore(clearScore);
            this.wallet.earn(result.count * COINS_PER_LINE + (perfectClear ? COINS_PERFECT : 0));
            this.emit({
                type: 'clear', result, clearScore, perfectClear, reason: 'line',
                comboCount: this.comboCount, comboMultiplier,
            });
        } else {
            /* 未清线 → 累加 grace 计数；comboCount 不归零（由下次清线判定） */
            this.roundsSinceLastClear = (this.roundsSinceLastClear === Number.POSITIVE_INFINITY)
                ? Number.POSITIVE_INFINITY
                : this.roundsSinceLastClear + 1;
        }

        if (this.dock.every((b) => b.placed)) {
            this.dock = this.refillDock();
            this.emit({ type: 'dock', blocks: this.dock });
        }

        if (result.count === 0) {
            const placedCells: Array<{ x: number; y: number }> = [];
            for (let r = 0; r < block.shape.length; r++) {
                for (let c = 0; c < block.shape[r].length; c++) {
                    if (block.shape[r][c]) placedCells.push({ x: gx + c, y: gy + r });
                }
            }
            this.detectNearMiss(placedCells);
        }
        this.checkGameOver();
        return true;
    }

    /**
     * 撤销上一步（消耗由调用方扣费）。返回是否成功。
     *
     * 仅回滚 `grid` / `dock` / `score` / `gameOver`，**不** 回滚 `best`：
     *   - 新语义下 `best` 本来就只在结算时提交，run 内不会被抬升 → 撤销时 best 仍是上局的真 PB；
     *   - 历史上若 best 已被错误抬升的旧存档，撤销保留旧 best 也是符合"PB 单调不降"惯例的稳态。
     */
    undo(): boolean {
        const snap = this.undoStack.pop();
        if (!snap) return false;
        this.grid.cells = snap.cells.map((row) => [...row]);
        this.dock = snap.dock.map((b) => ({ ...b }));
        this.score = snap.score;
        this.gameOver = false;
        this.emit({ type: 'dock', blocks: this.dock });
        // 必须广播（即便 delta=0）：HUD 据此把"score 数字 + 滚动 tween"回滚到撤销后的真值。
        this.emit({ type: 'score', score: this.score, delta: 0 });
        return true;
    }

    /** 炸弹：清除以 (gx,gy) 为中心的 (2r+1)² 区域。 */
    bombArea(gx: number, gy: number, radius = 1): number {
        this.pushSnapshot();
        const cells: ClearResult['cells'] = [];
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = gx + dx;
                const y = gy + dy;
                if (x < 0 || x >= this.grid.size || y < 0 || y >= this.grid.size) continue;
                if (this.grid.cells[y][x] === null) continue;
                cells.push({ x, y, color: this.grid.cells[y][x] });
                this.grid.cells[y][x] = null;
            }
        }
        if (cells.length === 0) {
            this.undoStack.pop();
            return 0;
        }
        const result: ClearResult = { count: 0, cells, bonusLines: [] };
        // 与 web 一致（skills/bomb.js）：每个被清格 5 分。
        const bombScore = cells.length * 5;
        this.addScore(bombScore);
        this.emit({ type: 'clear', result, clearScore: bombScore, perfectClear: false, reason: 'bomb' });
        this.afterSkillClear();
        return cells.length;
    }

    /** 彩虹（色弹）：清除盘面上数量最多的颜色的全部格子。 */
    rainbowClear(): number {
        const counts = new Map<number, number>();
        for (let y = 0; y < this.grid.size; y++) {
            for (let x = 0; x < this.grid.size; x++) {
                const c = this.grid.cells[y][x];
                if (c !== null) counts.set(c, (counts.get(c) || 0) + 1);
            }
        }
        let target = -1;
        let max = 0;
        for (const [c, n] of counts) {
            if (n > max) { max = n; target = c; }
        }
        if (target < 0) return 0;
        this.pushSnapshot();
        const cells: ClearResult['cells'] = [];
        for (let y = 0; y < this.grid.size; y++) {
            for (let x = 0; x < this.grid.size; x++) {
                if (this.grid.cells[y][x] === target) {
                    cells.push({ x, y, color: target });
                    this.grid.cells[y][x] = null;
                }
            }
        }
        const result: ClearResult = { count: 0, cells, bonusLines: [] };
        // 与 web 一致（skills/rainbow.js）：每个被清格 10 分（无 bonusLines 时不加 bonus）。
        const rainbowScore = cells.length * 10;
        this.addScore(rainbowScore);
        this.emit({ type: 'clear', result, clearScore: rainbowScore, perfectClear: false, reason: 'color' });
        this.afterSkillClear();
        return cells.length;
    }

    /** 冻结：激活一次「死局豁免」，下次无可落点时改为刷新候选区而非判负。 */
    setFreeze(active: boolean): void {
        this.freezeActive = active;
        this.emit({ type: 'freeze', active, used: false });
    }

    private afterSkillClear(): void {
        if (this.dock.every((b) => b.placed)) {
            this.dock = this.refillDock();
            this.emit({ type: 'dock', blocks: this.dock });
        }
        this.checkGameOver();
    }

    private checkGameOver(): void {
        if (this.grid.hasAnyMove(this.dock)) return;
        if (this.freezeActive) {
            this.freezeActive = false;
            this.dock = this.refillDock();
            this.emit({ type: 'freeze', active: false, used: true });
            this.emit({ type: 'dock', blocks: this.dock });
            if (this.grid.hasAnyMove(this.dock)) return;
        }
        // Zen 模式不会失败：软重排（清最满半盘）后继续
        if (!this.modeDef.canFail) {
            this.zenSoftReset();
            return;
        }
        this.gameOver = true;
        this.commitBestOnGameOver();
        this.emit({ type: 'gameover', score: this.score, best: this.best });
    }

    /**
     * PB 提交时机（对齐 web `endGame`）：只在真正"本局结算"那一刻把 `best` 与 `score` 比较抬升。
     *
     * 历史 bug：旧实现把 `if (score > best) best = score` 放到 `addScore` 里 → 每次落子/消行
     * 都实时抬升 best；配合 `save()` 把 `Storage.best` 也同步刷新，导致：
     *   1) 冲到 200 → 用"撤销"回到 100 → 临终 100 但 PB 永久记 200（撤销可刷分）
     *   2) 冲到 200 → bomb/rainbow 一通操作后又被消耗回低分 → PB 同样虚高
     *   3) 跨设备 cloudSync 推上去的 best 也是这种虚高值
     *
     * 现行语义：在 run 内 `best` 始终保持"上局结束时的真 PB"，HUD 也据此显示；只有 `gameover`/
     * `endByTime` 真正结算时才比较 `score`→`best` 并落 Storage。这与 `prevBest`（startGame 时
     * 抓拍）+ `score > prevBest && score > 0 → newBest` 的庆祝逻辑严格自洽。
     */
    private commitBestOnGameOver(): void {
        if (this.score > this.best) this.best = this.score;
    }

    private addScore(delta: number): void {
        if (delta === 0) return;
        const scaled = Math.round(delta * this.modeDef.scoreMul);
        this.score += scaled;
        // 注意：这里不再 ratchet `best`。PB 只在 commitBestOnGameOver / endByTime 一次性结算时提交。
        this.emit({ type: 'score', score: this.score, delta: scaled });
    }

    /**
     * 探测「差一格即可消行」的近满线，连同本次落子格子与最大填充率抛给渲染端。
     * 展示与否的体感/控频判定（落子绑定、挫败门槛、单局上限、冷却等）由 GameController
     * 用 `shouldShowNearMiss` 决策，严格对齐 web `shouldShowNearMissPlaceFeedback`。
     */
    private detectNearMiss(placedCells: Array<{ x: number; y: number }>): void {
        const n = this.grid.size;
        const lines: NearMissLine[] = [];
        let maxLineFill = 0;
        for (let y = 0; y < n; y++) {
            let filled = 0;
            for (let x = 0; x < n; x++) if (this.grid.cells[y][x] !== null) filled++;
            if (filled / n > maxLineFill) maxLineFill = filled / n;
            if (filled === n - 1) lines.push({ kind: 'row', idx: y });
        }
        for (let x = 0; x < n; x++) {
            let filled = 0;
            for (let y = 0; y < n; y++) if (this.grid.cells[y][x] !== null) filled++;
            if (filled / n > maxLineFill) maxLineFill = filled / n;
            if (filled === n - 1) lines.push({ kind: 'col', idx: x });
        }
        if (lines.length > 0) this.emit({ type: 'nearmiss', lines, placedCells, maxLineFill });
    }

    /**
     * 复活：清出空间并继续（由调用方决定用广告/金币换取）。
     * 清掉填充最密集的若干行列以保证可玩，重置 dock 与失败态。
     */
    /** 清出空间并继续（复活 / zen 软重排共用）。返回被清格子。 */
    private clearSpaceAndContinue(): ClearResult['cells'] {
        const n = this.grid.size;
        const rowFill = (y: number): number => { let s = 0; for (let x = 0; x < n; x++) if (this.grid.cells[y][x] !== null) s++; return s; };
        const colFill = (x: number): number => { let s = 0; for (let y = 0; y < n; y++) if (this.grid.cells[y][x] !== null) s++; return s; };
        const rows = Array.from({ length: n }, (_, y) => y).sort((a, b) => rowFill(b) - rowFill(a)).slice(0, Math.ceil(n / 2));
        const cols = Array.from({ length: n }, (_, x) => x).sort((a, b) => colFill(b) - colFill(a)).slice(0, Math.ceil(n / 2));
        const cells: ClearResult['cells'] = [];
        const wipe = (x: number, y: number) => {
            if (this.grid.cells[y][x] !== null) { cells.push({ x, y, color: this.grid.cells[y][x] }); this.grid.cells[y][x] = null; }
        };
        for (const y of rows) for (let x = 0; x < n; x++) wipe(x, y);
        for (const x of cols) for (let y = 0; y < n; y++) wipe(x, y);

        this.gameOver = false;
        this.freezeActive = false;
        this.undoStack = [];
        this.dock = this.refillDock();
        if (!this.grid.hasAnyMove(this.dock)) {
            this.grid.clear();
            this.dock = this.refillDock();
        }
        return cells;
    }

    /** 玩家主动复活（gameOver 后，换取条件由调用方处理）。 */
    revive(): boolean {
        if (!this.gameOver) return false;
        const cells = this.clearSpaceAndContinue();
        this.reviveCount++;
        if (cells.length > 0) {
            this.emit({ type: 'clear', result: { count: 0, cells, bonusLines: [] }, clearScore: 0, perfectClear: false, reason: 'revive' });
        }
        this.emit({ type: 'revive' });
        this.emit({ type: 'dock', blocks: this.dock });
        return true;
    }

    /** zen 软重排：无可落点时清空间继续，不计复活、不抛 revive 事件。 */
    private zenSoftReset(): void {
        const cells = this.clearSpaceAndContinue();
        if (cells.length > 0) {
            this.emit({ type: 'clear', result: { count: 0, cells, bonusLines: [] }, clearScore: 0, perfectClear: false, reason: 'revive' });
        }
        this.emit({ type: 'dock', blocks: this.dock });
    }

    /** 换一批候选（reroll 技能；扣费由调用方处理）。 */
    reroll(): boolean {
        if (this.gameOver) return false;
        this.dock = this.refillDock();
        this.emit({ type: 'dock', blocks: this.dock });
        this.checkGameOver();
        return true;
    }

    /** 限时模式时间到：强制结束本局。PB 在此一次性提交（与 checkGameOver 同走 commitBestOnGameOver）。 */
    endByTime(): void {
        if (this.gameOver) return;
        this.gameOver = true;
        this.commitBestOnGameOver();
        this.emit({ type: 'gameover', score: this.score, best: this.best });
    }

    toJSON(): object {
        return {
            grid: this.grid.toJSON(),
            dock: this.dock,
            score: this.score,
            best: this.best,
            skinId: this.skin.id,
            gameOver: this.gameOver,
            wallet: this.wallet.toJSON(),
            freezeActive: this.freezeActive,
        };
    }

    /** 从存档恢复（不广播 newgame，恢复后由调用方整体重绘）。 */
    fromJSON(data: {
        grid?: { size?: number; cells: (number | null)[][] };
        dock?: DockBlock[];
        score?: number;
        best?: number;
        skinId?: string;
        gameOver?: boolean;
        wallet?: object;
        freezeActive?: boolean;
    } | null): boolean {
        if (!data || !data.grid || !Array.isArray(data.dock)) return false;
        this.grid.fromJSON(data.grid);
        this.dock = data.dock.map((b) => ({ ...b }));
        this.score = data.score ?? 0;
        this.best = Math.max(this.best, data.best ?? 0);
        if (data.skinId) this.skin = getSkin(data.skinId);
        this.gameOver = data.gameOver ?? false;
        this.wallet.fromJSON((data.wallet as never) ?? null);
        this.freezeActive = data.freezeActive ?? false;
        this.undoStack = [];
        return true;
    }

    /** 恢复存档后保证候选区可用：候选为空或全部已落子时补一批，并广播。 */
    ensurePlayableDock(): void {
        if (this.gameOver) return;
        if (this.dock.length === 0 || this.dock.every((b) => b.placed)) {
            this.dock = this.refillDock();
            this.emit({ type: 'dock', blocks: this.dock });
        }
    }
}
