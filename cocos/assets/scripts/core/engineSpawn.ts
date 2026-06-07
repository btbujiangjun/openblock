/**
 * engineSpawn.ts —— 把「与 web 完全同源」的真实出块闭包接到 Cocos GameModel。
 *
 * 这里 import 的是 scripts/sync-cocos-engine.mjs 从 web/src 生成的引擎（engine/*.js，ESM 原样），
 * 即 bot/blockSpawn.generateDockShapes + adaptiveSpawn + boardTopology + spawnStepDifficulty …
 * 的真实闭包，而非手写副本，从而达到出块逻辑 100% 同源。
 *
 * 形状（几何）选择 100% 走真实引擎；颜色沿用本端 scoring.pickThreeDockColors（与 web 一致的
 * 同花顺/近满偏置），因 web 的 generateDockShapes 只产出几何、配色在外层完成。
 *
 * 健壮性：引擎是未类型化的生成 JS，故 import 用 @ts-ignore；任何异常/空结果由 GameModel.refillDock
 * 回退到内置自适应 generateDock，保证可玩。
 */
import { Grid } from './grid';
import { DockBlock, Skin } from './types';
import { Rng, defaultRng } from './rng';
import { monoNearFullLineColorWeights, pickThreeDockColors } from './scoring';
import { DOCK_SLOTS } from './config';
import { flag } from './remoteConfig';
import { getSpawnModel, getSpawnContextExtra } from './spawnModel';
import { buildTuningV2Context } from './spawnTuning';

// @ts-ignore 生成的纯逻辑引擎（未类型化）；用 .mjs 以保证 Cocos 按 ESM 打包（.js 会被当 CommonJS）
import { Grid as EngineGrid } from '../engine/grid.mjs';
// @ts-ignore
import { getStrategy } from '../engine/config.mjs';
// @ts-ignore
import { generateDockShapes } from '../engine/bot/blockSpawn.mjs';
// @ts-ignore 自适应策略解析（与 web/小程序同源）：内部 resolveThetaV2 注入寻参 θ → PB 曲线/spawnTargets。
import { resolveAdaptiveStrategy } from '../engine/adaptiveSpawn.mjs';

export interface EngineSpawnerOptions {
    /** 策略 id（默认 normal）。对应 shared/game_rules.json 的 strategies。 */
    strategyId?: string;
    rng?: Rng;
    /** 取当前皮肤用于配色偏置（与回合内皮肤切换同步）。 */
    getSkin?: () => Skin | null;
    /** 每次出块一轮的回调（用于玩家画像 PlayerContext.onRound 节奏推进）。 */
    onRound?: () => void;
    /** 取真实 PlayerProfile（喂给 resolveAdaptiveStrategy；为空则退化为非自适应分支，θ 不生效）。 */
    getProfile?: () => unknown;
    /** 取当前分数（自适应 scoreStress 输入）。 */
    getScore?: () => number;
    /** 取个人最佳分（寻参 pb_bin 维度）。 */
    getBest?: () => number;
    /** 取连胜计数（runStreak 难度修正；默认 0）。 */
    getRunStreak?: () => number;
    /** 取稳定用户 id（寻参灰度门控 hash；默认 ''）。 */
    getUserId?: () => string;
}

interface EngineShape {
    id: string;
    name?: string;
    category?: string;
    data: number[][];
}

/**
 * 构造一个出块函数，签名匹配 GameModel.spawnFn：(grid) => DockBlock[]。
 * 内部维护跨回合的 spawnContext（与 web game.js 的 _spawnContext 等价的累积上下文）。
 */
export function createEngineSpawner(opts: EngineSpawnerOptions = {}): (grid: Grid) => DockBlock[] {
    const rng = opts.rng ?? defaultRng;
    const strategyId = opts.strategyId ?? 'normal';
    const getSkin = opts.getSkin ?? (() => null);
    const onRound = opts.onRound;
    const getProfile = opts.getProfile ?? (() => null);
    const getScore = opts.getScore ?? (() => 0);
    const getBest = opts.getBest ?? (() => 0);
    const getRunStreak = opts.getRunStreak ?? (() => 0);
    const getUserId = opts.getUserId ?? (() => '');
    const ctx: Record<string, unknown> = {};

    let strat: unknown;
    try {
        strat = getStrategy(strategyId);
    } catch {
        strat = null;
    }

    return function engineSpawn(grid: Grid): DockBlock[] {
        if (!strat) return [];

        // RL/模型路径（默认关闭）：开启且注入策略时优先；返回 null 回退规则引擎。
        if (flag('rlSpawn')) {
            const policy = getSpawnModel();
            if (policy) {
                try {
                    const picked = policy(grid, ctx);
                    if (picked && picked.length > 0) return picked;
                } catch { /* 回退引擎 */ }
            }
        }

        // 节奏推进（玩家画像）：通知一轮新出块。
        if (onRound) { try { onRound(); } catch { /* 容错 */ } }

        // 玩家画像 context 下沉（web game.js._spawnContext 的逐步迁移）：合并消行/分数/画像信号。
        Object.assign(ctx, getSpawnContextExtra());

        // 每轮出块节流计数（对齐 web spawnBlocks 入口的 ++）：引擎据此 gate 特殊形状 / 双胞胎注入；
        // 引擎在注入时会把对应计数清 0。此前 cocos 从不自增 → roundsSinceSpecial 恒 0 → 特殊形状从不触发。
        ctx.totalRounds = ((ctx.totalRounds as number) ?? 0) + 1;
        ctx.roundsSinceSpecial = ((ctx.roundsSinceSpecial as number) ?? 0) + 1;
        ctx.roundsSinceDupInject = ((ctx.roundsSinceDupInject as number) ?? 0) + 1;
        // 当前皮肤（引擎评估同花顺潜力时只读使用）。
        ctx.skin = getSkin();

        // 快照当前棋盘到 engine Grid（generateDockShapes 只读 + 内部 clone 模拟，安全）。
        // 两端 cells 表示一致：cells[y][x] = null（空）| colorIdx。
        const eg = new EngineGrid(grid.size) as { cells: (number | null)[][]; getFillRatio?: () => number };
        for (let y = 0; y < grid.size; y++) {
            for (let x = 0; x < grid.size; x++) {
                eg.cells[y][x] = grid.cells[y][x];
            }
        }

        /* 自适应策略解析（与 web game.js / 小程序 gameController 同源）：
         * 把寻参 θ（SpawnParamTuner v2）经 resolveThetaV2 注入 PB 曲线 / spawnTargets，再产出
         * layered 策略喂给 generateDockShapes。需要真实 PlayerProfile（否则 resolveAdaptiveStrategy
         * 在 !profile 处早退到非自适应分支 → θ 不生效）。任何异常回退静态策略 strat，保证可玩。 */
        let strategyConfig: unknown = strat;
        try {
            const profile = getProfile();
            if (profile) {
                // 推进闭环反馈窗口（与 web 每轮 spawn 的 recordSpawn 对齐）。
                const p = profile as { recordSpawn?: () => void; tickRoundForDelight?: () => void };
                if (typeof p.recordSpawn === 'function') p.recordSpawn();
                if (typeof p.tickRoundForDelight === 'function') p.tickRoundForDelight();

                const fill = (typeof eg.getFillRatio === 'function') ? eg.getFillRatio() : grid.getFillRatio();
                const tuningV2Context = buildTuningV2Context({
                    strategyId,
                    bestScore: getBest() || (ctx.bestScore as number) || 0,
                    totalRounds: (ctx.totalRounds as number) || 0,
                    userId: getUserId(),
                });
                const layered = resolveAdaptiveStrategy(
                    strategyId, profile, getScore(), getRunStreak(), fill,
                    { ...ctx, tuningV2Context, _gridRef: eg },
                );
                if (layered) {
                    strategyConfig = layered;
                    // 与 web 一致：把里程碑命中信号桥接回 ctx，blockSpawn 据此对 gapFill 形状加权。
                    const hints = (layered as { spawnHints?: { scoreMilestone?: boolean } }).spawnHints;
                    ctx.scoreMilestone = hints?.scoreMilestone === true;
                }
            }
        } catch { /* 回退静态策略 strat */ }

        let shapes: EngineShape[];
        try {
            shapes = generateDockShapes(eg, strategyConfig, ctx) as EngineShape[];
        } catch {
            return [];
        }
        if (!Array.isArray(shapes) || shapes.length === 0) return [];

        // 记录本轮产出的形状类别，供「下一轮」引擎做新鲜度/重复规避（web 同款 recentCategories 输入）。
        const cats = shapes.map((s) => s.category).filter((c): c is string => !!c);
        if (cats.length > 0) {
            const prev = (ctx.recentCategories as string[]) ?? [];
            ctx.recentCategories = [...prev, ...cats].slice(-8);
        }

        const colorBias = monoNearFullLineColorWeights(grid, getSkin());
        const colors = pickThreeDockColors(colorBias, rng);
        const blocks: DockBlock[] = [];
        for (let i = 0; i < DOCK_SLOTS; i++) {
            const s = shapes[i] ?? shapes[shapes.length - 1];
            if (!s || !Array.isArray(s.data)) return [];
            blocks.push({
                index: i,
                shape: s.data,
                shapeId: s.id,
                colorIdx: colors[i],
                placed: false,
            });
        }
        return blocks;
    };
}
