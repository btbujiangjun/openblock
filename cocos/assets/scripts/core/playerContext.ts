/**
 * 玩家画像 / 出块上下文（Phase P2 —— web `game.js._spawnContext` 的引擎无关下沉）。
 *
 * 职责：把「游戏结果信号」（消行/分数/节奏）累积为跨轮上下文，经 setSpawnContextProvider
 * 喂给真实出块引擎 generateDockShapes（它读取 lastClearCount / roundsSinceClear /
 * totalClears / scoreMilestone 等），并附带 skill/momentum/frustration 三档画像信号，
 * 供未来 adaptive 层 / 分析消费。纯逻辑、不依赖引擎与 DOM，可被 web/小程序复用。
 *
 * 由 GameController 在模型事件里驱动：onRound（每次新 dock）/ onClear（消行）/ onScore（计分），
 * 新开局调 reset。snapshot() 返回合并进 spawnContext 的只读快照。
 */

// @ts-ignore 同步引擎（未类型化 ESM）
import { deriveRunOverRunArc, resolveArcThresholds } from '../engine/retention/runOverRunArc.mjs';
// @ts-ignore
import { recordPersonalBest, isPbGrowthFast } from '../engine/pbGrowthTracker.mjs';

export class PlayerContext {
    /** 距上次消行的出块轮数（引擎据此判断纾困/加压）。 */
    private roundsSinceClear = 0;
    /** 上一次消行的行数。 */
    private lastClearCount = 0;
    /** 本局累计消行数（引擎据此放宽特殊形状配额）。 */
    private totalClears = 0;
    /** 本局出块轮数。 */
    private roundCount = 0;
    /** 是否刚跨过一个分数里程碑（消费一轮后由 onRound 清零）。 */
    private scoreMilestone = false;
    private lastMilestone = 0;
    /** 历史最佳（供 PB 追逐类信号）。 */
    private bestScore = 0;
    /** 近若干轮每轮消行数窗口（动量估计）。 */
    private recentClears: number[] = [];
    /** 上个 dock 周期内首手自由度最低点（web _spawnContext.bottleneckTrough）。 */
    private bottleneckTrough = Infinity;
    /** 上个 dock 周期内合法落点总数最低点（web _spawnContext.bottleneckSolutionTrough）。 */
    private bottleneckSolutionTrough = Infinity;
    /** 采样次数；0 表示本周期尚无瓶颈样本。 */
    private bottleneckSamples = 0;
    /** 「最近一帧」dock 几何真值（与 web `_spawnContext.mobility/firstMoveFreedom/placementSolutionScore`
     *  对齐）：喂给 adaptiveSpawn.buildPlayerAbilityVector 的 boardPlanning(mobilityScore) 与
     *  riskLevel(lockRisk)。历史死输入根因同 web —— 仅 trough(min) 入快照、当帧真值从未透传，
     *  导致 mobilityScore 恒走 fallback、lockRisk 恒不参与。null 表示本周期尚无样本。 */
    private lastMobility: number | null = null;
    private lastFirstMoveFreedom: number | null = null;
    private lastPlacementSolutionScore: number | null = null;
    /** 暖局剩余轮数（开局前 N 轮减压 clearBoost；与 web `_spawnContext.warmupRemaining` 对齐）。 */
    private warmupRemaining = 0;
    /** 暖局 clearBoost 强度（与 web `_spawnContext.warmupClearBoost` 对齐）。 */
    private warmupClearBoost = 0;
    /** 「连续重玩」计数 —— 不是连胜，是 game over→retry 的会话内连战次数（与 web `runStreak` 同义）。
     *  仅进程内有效，刻意不持久化：菜单/换难度/换模式回到 enterFromMenu 应清零；从结算卡 onAgain
     *  再开局应 +1。喂给 adaptiveSpawn 的第 4 参数，影响 runStreakStress 信号。 */
    private runStreak = 0;
    /** 破纪录释放窗口 —— 与 web `_spawnContext.postPbReleaseActive/Remaining` + `_postPbReleaseUsed` 严格同义。
     *  局内首次破 PB 时触发，接下来 N (默认 5) 次 spawn 内 stress×0.7 + clearGuarantee +1 + challengeBoost 完全禁用；
     *  同一局内 used 标记保证只激活一次。新局通过 reset() 清空。 */
    private postPbReleaseRemaining = 0;
    private postPbReleaseActive = false;
    private postPbReleaseUsed = false;

    /** 局间弧线（RunOverRunArc）：opener/momentum/peak/fatigue/cooldown。 */
    private runOverRunArc: string | null = null;
    /** 今日第几局（从 1 起计）。 */
    private dailyRunIndex = 0;
    /** 上一局结束时间戳 + 分数。 */
    private lastGameOver: { ts: number; score: number } | null = null;
    /** 赌气重开链长（跨局累加；非进程内持久化——重启 app 清零无妨）。 */
    private rageChainLen = 0;
    /** 最近若干局得分（升序，赌气/疲劳判定用）。 */
    private recentScores: number[] = [];
    /** PB 增长率过快标记（与 web `ctx.pbGrowthFast` 同义）。 */
    private pbGrowthFast = false;
    /** 复活后救济（与 web `_postReviveBoost` 同义）：连续 N 轮 spawn 强制 relief intent。 */
    private forceReliefTtl = 0;
    /** v1.70 温暖局状态（与 web `_spawnContext.warmRunState` 同义）：
     *  active=true 时下游 adaptiveSpawn.applyWarmRun 钳制 shapeWeights / spawnHints。
     *  局开始时由 GameController 通过 evaluateWarmTriggers + buildWarmBudget 注入；
     *  每次 generateDockShapes 后 consumeWarmBudget 推进；shouldExitWarmRun 满足时清空。 */
    private warmRunState: Record<string, unknown> | null = null;

    /** 分数里程碑步长（每跨过一档触发一次 scoreMilestone）。 */
    private readonly milestoneStep = 500;
    private readonly window = 8;

    setBest(best: number): void {
        this.bestScore = Math.max(0, best | 0);
    }

    /** 新开局重置（保留 best 作为 PB 基线；默认启用 3 轮暖局减压，与 web 节奏一致）。 */
    reset(best: number, warmup: { rounds?: number; clearBoost?: number } = {}): void {
        this.roundsSinceClear = 0;
        this.lastClearCount = 0;
        this.totalClears = 0;
        this.roundCount = 0;
        this.scoreMilestone = false;
        this.lastMilestone = 0;
        this.recentClears = [];
        this.resetBottleneck();
        this.setBest(best);
        this.warmupRemaining = Math.max(0, warmup.rounds ?? 3);
        this.warmupClearBoost = Math.max(0, warmup.clearBoost ?? 0.4);
        this.postPbReleaseRemaining = 0;
        this.postPbReleaseActive = false;
        this.postPbReleaseUsed = false;
        this.forceReliefTtl = 0;
        /* v1.70：新局重置温暖局状态；调用方应在 reset 后立即调用 setWarmRunState 注入新预算。 */
        this.warmRunState = null;
        this.dailyRunIndex++;
        this._refreshRunOverRunArc();
        this._refreshPbGrowthFast();
    }

    /** 取当前暖局剩余轮数（engineSpawn 每轮拉取并自然 −−）。 */
    getWarmupRemaining(): number {
        return this.warmupRemaining;
    }

    /** 取当前暖局 clearBoost 强度。 */
    getWarmupClearBoost(): number {
        return this.warmupClearBoost;
    }

    /** 消费一个暖局轮（engineSpawn 在出块成功后调用一次）。 */
    consumeWarmup(): void {
        if (this.warmupRemaining > 0) this.warmupRemaining--;
    }

    /** 取「连续重玩」计数（喂给 adaptiveSpawn 的 runStreak 参数）。 */
    getRunStreak(): number {
        return this.runStreak;
    }

    /** 「再来一局」(GameOver onAgain) 时调用：+1，启用 runStreakStress 累积加压。 */
    incrementRunStreak(): void {
        this.runStreak++;
    }

    /** 「回菜单 / 换模式 / 换难度」时调用：归零。 */
    resetRunStreak(): void {
        this.runStreak = 0;
    }

    /** 破纪录释放窗口是否激活（engineSpawn 注入 `ctx.postPbReleaseActive`）。 */
    isPostPbReleaseActive(): boolean {
        return this.postPbReleaseActive;
    }

    /**
     * 局内首次破纪录时调用（GameController.maybeCelebrateNewBest 内）。
     * 与 web `_startPostPbReleaseWindow` 严格同语义：局内 used → 静默 no-op，保证只激活一次。
     * @param spawns 释放窗口长度（默认 5；与 game_rules.adaptiveSpawn.pbChase.postPbReleaseWindow.spawns 对齐）
     */
    triggerPostPbRelease(spawns = 5): void {
        if (this.postPbReleaseUsed) return;
        this.postPbReleaseRemaining = Math.max(0, spawns | 0);
        this.postPbReleaseActive = this.postPbReleaseRemaining > 0;
        this.postPbReleaseUsed = true;
    }

    /**
     * engineSpawn 每轮出块后调用一次：剩余轮数 −−，归零后关闭 active 标记。
     * 与 web `spawnBlocks` 末尾「postPbReleaseRemaining−−；≤0 时关 active」一致。
     */
    tickPostPbRelease(): void {
        if (!this.postPbReleaseActive) return;
        if (this.postPbReleaseRemaining > 0) this.postPbReleaseRemaining--;
        if (this.postPbReleaseRemaining <= 0) this.postPbReleaseActive = false;
    }

    /**
     * 复活后激活救济（与 web `_postReviveBoost` 同义）：接下来 N 轮 spawn
     * 强制 `ctx.forceReliefIntent=true`，每轮消费一次。
     */
    activateReviveBoost(rounds = 2): void {
        this.forceReliefTtl = Math.max(0, rounds | 0);
    }

    /**
     * 局结束时记录最终得分（供 runOverRunArc 的 fatigue/cooldown 判定）。
     * 由 GameController 在 settle / gameOver 路径调用。
     */
    recordGameOver(score: number): void {
        this.lastGameOver = { ts: Date.now(), score: Math.max(0, score | 0) };
        this.recentScores.push(score);
        if (this.recentScores.length > 10) this.recentScores.shift();
    }

    /**
     * 记录新 PB（与 web `game.js _emitPersonalBestEvent → recordPersonalBest` 对齐）。
     * 同时刷新 pbGrowthFast 标记。
     */
    recordNewPb(newBest: number): void {
        try { recordPersonalBest(newBest); } catch { /* ignore */ }
        this._refreshPbGrowthFast();
    }

    /** 取当前局间弧线标签（喂给 ctx.runOverRunArc）。 */
    getRunOverRunArc(): string | null {
        return this.runOverRunArc;
    }

    /** 取 PB 增长率过快标记（喂给 ctx.pbGrowthFast）。 */
    getPbGrowthFast(): boolean {
        return this.pbGrowthFast;
    }

    private _refreshRunOverRunArc(): void {
        try {
            const result = deriveRunOverRunArc({
                dailyRunIndex: this.dailyRunIndex,
                now: Date.now(),
                lastGameOver: this.lastGameOver,
                recentScores: this.recentScores,
                bestScore: this.bestScore,
                rageChainLen: this.rageChainLen,
            });
            this.runOverRunArc = result?.arc ?? null;
            if (result?.arc === 'cooldown') {
                this.rageChainLen = (result as { debug?: { rageChainLen?: number } }).debug?.rageChainLen ?? this.rageChainLen;
            } else {
                this.rageChainLen = 0;
            }
        } catch {
            this.runOverRunArc = null;
        }
    }

    private _refreshPbGrowthFast(): void {
        try { this.pbGrowthFast = isPbGrowthFast(); } catch { this.pbGrowthFast = false; }
    }

    /** 每次新 dock（出块一轮）：推进节奏计数，开窗，清里程碑标记。 */
    onRound(): void {
        this.roundCount++;
        this.roundsSinceClear++;
        this.scoreMilestone = false;
        this.recentClears.push(0);
        if (this.recentClears.length > this.window) this.recentClears.shift();
    }

    /** 新 dock 周期开始时重置瓶颈采样。 */
    resetBottleneck(): void {
        this.bottleneckTrough = Infinity;
        this.bottleneckSolutionTrough = Infinity;
        this.bottleneckSamples = 0;
        /* 不清 last* 真值：保留上一周期最近一帧作为新周期首 spawn 前的兜底（玩家落子后即被覆写）。 */
    }

    /**
     * 记录当前 dock 周期内的瓶颈低谷，并回灌「最近一帧」dock 几何真值。
     * @param solutionCount 当前未放置候选块的合法落点总和
     * @param firstMoveFreedom 当前未放置候选块中最小合法落点数
     * @param unplacedCount 当前未放置候选块数量（用于 placementSolutionScore 均值归一；缺省退回瓶颈块口径）
     */
    updateBottleneck(solutionCount: number, firstMoveFreedom: number, unplacedCount = 0): void {
        if (Number.isFinite(firstMoveFreedom)) {
            this.bottleneckTrough = Number.isFinite(this.bottleneckTrough)
                ? Math.min(this.bottleneckTrough, firstMoveFreedom)
                : firstMoveFreedom;
        }
        if (Number.isFinite(solutionCount)) {
            this.bottleneckSolutionTrough = Number.isFinite(this.bottleneckSolutionTrough)
                ? Math.min(this.bottleneckSolutionTrough, solutionCount)
                : solutionCount;
        }
        this.bottleneckSamples++;
        /* 「最近一帧」真值（非 min 累加）：供下一次 spawn 的 buildPlayerAbilityVector。 */
        if (Number.isFinite(solutionCount)) this.lastMobility = solutionCount;
        if (Number.isFinite(firstMoveFreedom)) this.lastFirstMoveFreedom = firstMoveFreedom;
        /* placementSolutionScore：整盘 dock「平均每块安全度」∈[0,1]，归一尺度复用
         * playerAbilityModel.risk.firstMoveFreedomSafe（默认 8，与 web/game_rules 同值）。
         * 与瓶颈块 firstMoveFreedom（取最小块）区分：前者取均值，作 lockRisk 主分支输入。 */
        if (Number.isFinite(solutionCount) && unplacedCount > 0) {
            const safe = 8;
            this.lastPlacementSolutionScore = clamp01((solutionCount / unplacedCount) / safe);
        }
    }

    /** 消行：记录行数、清零间隔、累计，并并入当前轮窗口。 */
    onClear(count: number): void {
        if (count <= 0) return;
        this.lastClearCount = count;
        this.roundsSinceClear = 0;
        this.totalClears += count;
        if (this.recentClears.length === 0) this.recentClears.push(0);
        this.recentClears[this.recentClears.length - 1] += count;
    }

    /** 计分：跨过新里程碑则置 scoreMilestone（引擎对 gapFill 形状 ×1.3 加权）。 */
    onScore(score: number): void {
        const m = Math.floor(Math.max(0, score) / this.milestoneStep);
        if (m > this.lastMilestone) {
            this.lastMilestone = m;
            this.scoreMilestone = true;
        }
    }

    /** 熟练度（0..1）：本局每轮平均消行（≈1.2 行/轮视为高水平）。 */
    skill(): number {
        const lpr = this.totalClears / Math.max(8, this.roundCount);
        return clamp01(lpr / 1.2);
    }

    /** 动量（0..1）：近窗口平均消行（≈1.5 行/轮视为高动量）。 */
    momentum(): number {
        if (this.recentClears.length === 0) return 0;
        const sum = this.recentClears.reduce((a, b) => a + b, 0);
        return clamp01((sum / this.recentClears.length) / 1.5);
    }

    /** 受挫度（0..1）：连续未消行轮数（8 轮封顶）。 */
    frustration(): number {
        return clamp01(this.roundsSinceClear / 8);
    }

    /** 合并进 spawnContext 的只读快照（键名与引擎/web _spawnContext 对齐）。 */
    snapshot(): Record<string, unknown> {
        const forceRelief = this.forceReliefTtl > 0;
        if (forceRelief) this.forceReliefTtl--;
        return {
            lastClearCount: this.lastClearCount,
            roundsSinceClear: this.roundsSinceClear,
            totalClears: this.totalClears,
            scoreMilestone: this.scoreMilestone,
            bestScore: this.bestScore,
            skill: this.skill(),
            momentum: this.momentum(),
            frustration: this.frustration(),
            bottleneckTrough: this.bottleneckTrough,
            bottleneckSolutionTrough: this.bottleneckSolutionTrough,
            bottleneckSamples: this.bottleneckSamples,
            /* 最近一帧 dock 几何真值（mobilityScore / lockRisk 输入）；null 时下游退回 fallback。 */
            ...(this.lastMobility != null ? { mobility: this.lastMobility } : {}),
            ...(this.lastFirstMoveFreedom != null ? { firstMoveFreedom: this.lastFirstMoveFreedom } : {}),
            ...(this.lastPlacementSolutionScore != null ? { placementSolutionScore: this.lastPlacementSolutionScore } : {}),
            postPbReleaseActive: this.postPbReleaseActive,
            runOverRunArc: this.runOverRunArc,
            pbGrowthFast: this.pbGrowthFast,
            forceReliefIntent: forceRelief,
            /* v1.70：透传温暖局状态到 spawnContext.warmRunState，下游 adaptiveSpawn.applyWarmRun
             * 据此钳制 shapeWeights / spawnHints。 */
            warmRunState: this.warmRunState,
        };
    }

    /** v1.70：设置温暖局状态（由 GameController 局开始时调用）。传 null 表示未触发。 */
    setWarmRunState(state: Record<string, unknown> | null): void {
        this.warmRunState = state && (state as { active?: boolean }).active ? state : null;
    }

    /** v1.70：读取温暖局状态（供 GameController consume / exit 判定）。 */
    getWarmRunState(): Record<string, unknown> | null {
        return this.warmRunState;
    }
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
}
