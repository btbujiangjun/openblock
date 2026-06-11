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
import { generateDockShapes, getLastSpawnDiagnostics, resetSpawnMemory } from '../engine/bot/blockSpawn.mjs';
// @ts-ignore 三端共享的「出块 commit 段」纯逻辑闭包：维护 totalRounds / roundsSinceSpecial /
// scoreMilestone / prevAdaptiveStress / _occupancyFillAnchor / L1 棋盘特征 / constructCooldown /
// pendingClearTarget 等跨轮字段；源自 web/src/spawn/commitSpawnContext.js，由 sync 脚本同步。
import { commitSpawnContext } from '../engine/spawn/commitSpawnContext.mjs';
// @ts-ignore 自适应策略解析（与 web/小程序同源）：内部 resolveThetaV2 注入寻参 θ → PB 曲线/spawnTargets。
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../engine/adaptiveSpawn.mjs';
// @ts-ignore 寻参 v2 客户端策略：把 19 维 θ（B/C/D/E 组）注入 ctx.modelConfig，与 web v3.0.8 保持一致。
import { resolveThetaV2 } from '../engine/tuning/v2/clientPolicyV2.mjs';

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
    /** 取连胜计数（runStreak 难度修正；默认 0）。需要跨局持久化才有意义；缺省 0 退化为非连战分支。 */
    getRunStreak?: () => number;
    /**
     * 取开局首 N 轮的暖局减压剩余轮数（与 web `_spawnContext.warmupRemaining` 对齐）。
     * 缺省 0 → 不暖局；新局开始时由调用方注入正整数（如 3）启用首三轮 clearBoost。
     */
    getWarmupRemaining?: () => number;
    getWarmupClearBoost?: () => number;
    /**
     * 取当前未放置的 dock 候选(用于 adaptiveSpawn.dockPool 检查与 noFitRescue 救援判定)。
     * 形如 [{ data: number[][] }, ...]；缺省/空数组 → 引擎自然走非 dockPool 分支(无救援增强,等价历史行为)。
     */
    getDockShapePool?: () => Array<{ data: number[][] }>;
    /**
     * 出块后调用一次：tick 破纪录释放窗口 / 暖局等需要"出块后递减"的计数。
     * 与 web `_commitSpawn` 内 `postPbReleaseRemaining −−` + 主消费方一致。
     */
    onSpawned?: () => void;
    /** 取稳定用户 id（寻参灰度门控 hash；默认 ''）。 */
    getUserId?: () => string;
    /**
     * 每日大师题种子源（移植 web dailyMaster）：返回一个确定性 PRNG 时，本次出块体内临时把 `Math.random`
     * 替换为它（含引擎几何选择 + defaultRng 配色，二者都走 Math.random → 全确定）；返回 null 走正常随机。
     * 仅在 spawn 调用期替换、用 try/finally 还原，不影响出块之外的随机（粒子等）。
     */
    getSeedRandom?: () => (() => number) | null;
}

interface EngineShape {
    id: string;
    name?: string;
    category?: string;
    data: number[][];
}

/**
 * 新局开始时调用一次：清掉引擎的模块级状态，避免跨局污染。
 *
 * 1. `resetAdaptiveMilestone` —— 把 `_prevScoreMilestone` 清 0。否则上一局到 5000 分留下的
 *    "已触发到 5000 档"残值会让新局 0~5000 区间所有里程碑全部 miss，blockSpawn 的 gapFill ×1.3
 *    加权完全失效；同时 `_milestoneToastBaseFiredThisRun` 也归零。
 * 2. `resetSpawnMemory` —— 清掉 blockSpawn 内部的 `_spawnMemory.categories/recent` 等新鲜度
 *    缓存。否则上一局尾部的类别记忆会让新局首副 dock 的新鲜度判定带偏。
 *
 * 与 web `game.js` line 1450-1451 严格同址同义；cocos 之前从未调用 → 跨局 milestone/新鲜度
 * 全链路污染（最显眼的现象：连开 2 局后里程碑加权几乎不触发）。
 */
export function resetEngineForNewGame(): void {
    try { (resetAdaptiveMilestone as undefined | (() => void))?.(); } catch { /* 容错 */ }
    try { (resetSpawnMemory as undefined | (() => void))?.(); } catch { /* 容错 */ }
}

/** 出块器函数 + 重置钩子（新局调用，与 web `_spawnContext` 重新赋值新对象同义）。 */
export interface EngineSpawner {
    (grid: Grid): DockBlock[];
    /**
     * 新局开始时调用：除引擎模块级状态由 `resetEngineForNewGame` 单独处理外，
     * 还要清掉本闭包跨轮持有的 spawnContext —— `totalRounds / specialShapeUsed / dupInjectUsed /
     * recentCategories / prevAdaptiveStress / _lastSpawnIntent ...`。
     * 跨局不清会让 cocos 上一局的「已用特殊形状配额」「上轮 intent」直接污染新局头几轮出块。
     */
    resetForNewGame: () => void;
}

/**
 * 构造一个出块函数，签名匹配 GameModel.spawnFn：(grid) => DockBlock[]。
 * 内部维护跨回合的 spawnContext（与 web game.js 的 _spawnContext 等价的累积上下文）。
 */
export function createEngineSpawner(opts: EngineSpawnerOptions = {}): EngineSpawner {
    const rng = opts.rng ?? defaultRng;
    const strategyId = opts.strategyId ?? 'normal';
    const getSkin = opts.getSkin ?? (() => null);
    const onRound = opts.onRound;
    const getProfile = opts.getProfile ?? (() => null);
    const getScore = opts.getScore ?? (() => 0);
    const getBest = opts.getBest ?? (() => 0);
    const getRunStreak = opts.getRunStreak ?? (() => 0);
    const getUserId = opts.getUserId ?? (() => '');
    const getWarmupRemaining = opts.getWarmupRemaining ?? (() => 0);
    const getWarmupClearBoost = opts.getWarmupClearBoost ?? (() => 0);
    const getDockShapePool = opts.getDockShapePool ?? (() => []);
    const onSpawned = opts.onSpawned;
    const getSeedRandom = opts.getSeedRandom;
    /* 跨回合累积上下文，等价 web `game.js._spawnContext`：维护 totalRounds / 各类配额 /
     * prevAdaptiveStress / prevSpawnIntent 等需要跨 spawn 持久的状态。
     * snapshot/L1 等单帧字段由本函数体内每次重写。 */
    const initialCtx = (): Record<string, unknown> => ({
        specialShapeUsed: 0,
        specialReliefUsed: 0,
        specialPressureUsed: 0,
        dupInjectUsed: 0,
        constructCooldown: 0,
        pendingClearTarget: null,
        recentCategories: [],
    });
    let ctx: Record<string, unknown> = initialCtx();
    /* 上一轮 spawn 决策快照（用于 hysteresis 与 stress 平滑），与 web `_lastSpawnIntent /
     * _lastSpawnIntentAge / _spawnContext.prevAdaptiveStress` 严格对齐。 */
    let _lastSpawnIntent: string | null = null;
    let _lastSpawnIntentAge = 0;

    let strat: unknown;
    try {
        strat = getStrategy(strategyId);
    } catch {
        strat = null;
    }

    function spawnCore(grid: Grid): DockBlock[] {
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

        /* 玩家画像 context 下沉（web game.js._spawnContext 的逐步迁移）：合并消行/分数/画像信号。
         *
         * 时序关键点：
         *   1. PlayerContext.snapshot 提供 lastClearCount/totalClears/bestScore/postPbReleaseActive 等
         *      跨轮"事实"字段 —— 都是 PlayerContext 单一权威源；
         *   2. snapshot 的 scoreMilestone 在 `onRound()` 入口已被清为 false，对生效路径无影响：
         *      blockSpawn 实际读取的是引擎 derive 出的 hits（layered.spawnHints.scoreMilestone），
         *      下方在调 generateDockShapes 之前会把它桥回 ctx.scoreMilestone 覆盖此处的 false；
         *   3. snapshot 不包含 prevAdaptiveStress / prevSpawnIntent / specialShapeUsed 等闭包跨轮态，
         *      故不会覆盖它们；这些保留在 ctx 中等待引擎读取或本端在出块后回写。 */
        Object.assign(ctx, getSpawnContextExtra());

        /* 节流计数（与 web `spawnBlocks` 入口 ++ 行为一致）：
         * 引擎据此 gate 特殊形状 / 双胞胎注入；引擎在注入时会把对应计数清 0。
         * 这两个失败也消费，与 web 同语义 —— 失败重试不应让 gate 推迟。 */
        ctx.roundsSinceSpecial = ((ctx.roundsSinceSpecial as number) ?? 0) + 1;
        ctx.roundsSinceDupInject = ((ctx.roundsSinceDupInject as number) ?? 0) + 1;
        /* totalRounds 不在入口 ++（与 web `_commitSpawn` 一致）：仅当出块成功后才推进。
         * 在入口 ++ 会让 generateDockShapes 抛异常的重试链也被记为一轮 → lifecycle_stage 计数偏高、
         * 进而 resolveThetaV2 命中的 context_key 会比 web 多走一步 → 寻参分桶在边界值附近漂移。 */
        // 当前皮肤（引擎评估同花顺潜力时只读使用）。
        ctx.skin = getSkin();
        /* 暖局信号（开局首 N 轮 clearBoost；与 web `_spawnContext.warmupRemaining/warmupClearBoost` 一致）：
         * 由调用方提供剩余轮数；引擎内消费后会自然失效，本端每轮再次拉取最新值（调用方按需 −−）。 */
        const _warmupRem = getWarmupRemaining() | 0;
        if (_warmupRem > 0) {
            ctx.warmupRemaining = _warmupRem;
            ctx.warmupClearBoost = getWarmupClearBoost() || 0;
        } else {
            delete ctx.warmupRemaining;
            delete ctx.warmupClearBoost;
        }
        /* 上一帧 intent → hysteresis（与 web 一致）：让 deriveSpawnIntent 根据 dwell time 抑制抖动。 */
        ctx.prevSpawnIntent = _lastSpawnIntent;
        ctx.prevSpawnIntentAge = _lastSpawnIntentAge;

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
        type LayeredRef = { _adaptiveStressRaw?: number; _spawnIntent?: string; _occupancyFillAnchor?: number; spawnHints?: { spawnIntent?: string; scoreMilestone?: boolean } };
        let layeredRef: LayeredRef | null = null;
        const tuningV2Context = buildTuningV2Context({
            strategyId,
            bestScore: getBest() || (ctx.bestScore as number) || 0,
            // 与 web 一致：本轮 spawnBlocks 入口读到的是「上一轮 _commitSpawn 后」的 totalRounds（未 +1）。
            totalRounds: (ctx.totalRounds as number) || 0,
            userId: getUserId(),
        });
        /* ★ 寻参 θ → ctx.modelConfig 桥接（与 web `game.js` v3.0.8 修复一一对齐）：
         * 引擎内 derivePbCurve 自查 globalThis.__openblockClientPolicyV2 只接通了 B 组 4 维 PB 曲线；
         * 而 C 组 augmentPool 乘性加权（blockSpawn）/ D 组 spawnTargets 翻译矩阵 / E 组 PB 段弯折
         * 全部读取 ctx.modelConfig。此前 cocos 端从不注入 → 15/19 维 θ 全部 dead，部署的 360 条策略
         * 仅 21% 生效。仅在「真实命中策略」(exact / fuzzy-lifecycle / coarse-gen) 时写入；其他情况
         * 显式清为 null，让各 consumer 沿用历史硬默认（与 fallback 多数局行为对齐）。 */
        try {
            const _r = (resolveThetaV2 as ((c: Record<string, unknown>) => { theta: Record<string, number>; source: string }) | undefined)?.(tuningV2Context as unknown as Record<string, unknown>);
            const _hit = _r && (_r.source === 'exact' || _r.source === 'fuzzy-lifecycle' || _r.source === 'coarse-gen');
            ctx.modelConfig = _hit ? _r!.theta : null;
        } catch {
            ctx.modelConfig = null;
        }
        try {
            const profile = getProfile();
            if (profile) {
                // 推进闭环反馈窗口（与 web 每轮 spawn 的 recordSpawn 对齐）。
                const p = profile as { recordSpawn?: () => void; tickRoundForDelight?: () => void };
                if (typeof p.recordSpawn === 'function') p.recordSpawn();
                if (typeof p.tickRoundForDelight === 'function') p.tickRoundForDelight();

                const fill = (typeof eg.getFillRatio === 'function') ? eg.getFillRatio() : grid.getFillRatio();
                /* `_dockShapePool` 仅在本次调用窗口内有意义（adaptiveSpawn 用它估当前 dock 剩余可放性），
                 *  与 web 一致只通过参数对象传递，不持久到 ctx，避免上一轮残值污染下一轮。 */
                const dockPool = getDockShapePool();
                const layered = resolveAdaptiveStrategy(
                    strategyId, profile, getScore(), getRunStreak(), fill,
                    { ...ctx, tuningV2Context, _gridRef: eg, _dockShapePool: dockPool },
                );
                if (layered) {
                    strategyConfig = layered;
                    layeredRef = layered as LayeredRef;
                    // 与 web 一致：把里程碑命中信号桥接回 ctx，blockSpawn 据此对 gapFill 形状加权。
                    const hints = layeredRef?.spawnHints;
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

        /* hysteresis dwell time —— 闭包级状态（不在 ctx 中），由调用方维护。
         * 必须在 commitSpawnContext 之外，因为它依赖 layeredRef._spawnIntent + 上一轮闭包态。 */
        const _newIntent = layeredRef?._spawnIntent ?? layeredRef?.spawnHints?.spawnIntent ?? null;
        if (_newIntent && _lastSpawnIntent === _newIntent) {
            _lastSpawnIntentAge++;
        } else {
            _lastSpawnIntentAge = 0;
        }
        _lastSpawnIntent = _newIntent ?? null;

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

        /* v1.60.x 根因清理：三端共享的「出块 commit 段」纯字段维护抽到 spawn/commitSpawnContext.mjs。
         * 一次性维护 totalRounds++/roundsSinceSpecial=0/scoreMilestone=false/prevAdaptiveStress/
         * _occupancyFillAnchor/L1 棋盘特征回写（nearFullLines/pcSetup/holes/multi/perfectClearCandidates）/
         * constructCooldown 衰减/pendingClearTarget 续接。
         *
         * 时序：必须在 blocks 构造完成（确认出块成功）之后调用——与 web `_commitSpawn` / 旧版尾部
         * `totalRounds++` 同址契约：失败重试链（generateDockShapes 抛异常 / shapes 为空 / 单块校验
         * 失败提前 return []）绝不消费这个计数，否则 lifecycle_stage 分桶与寻参 v2 context_key 会
         * 因为"重试也算 1 轮"而漂移。
         *
         * scoreMilestone：cocos 的权威源是 PlayerContext.scoreMilestone（snapshot 每轮注入），
         * 由 PlayerContext.onRound() 在下一轮入口自动清零；commitSpawnContext 内部把它再清一次为
         * false 是冗余但幂等的——保持三端契约一致。 */
        type SpawnDiag = Parameters<typeof commitSpawnContext>[0]['diagnostics'];
        const _diag = (getLastSpawnDiagnostics as (() => SpawnDiag) | undefined)?.();
        commitSpawnContext({
            ctx,
            shapes: shapes as unknown as Array<{ id: string }>,
            layered: layeredRef as unknown as Record<string, unknown>,
            diagnostics: _diag,
        });

        if (onSpawned) { try { onSpawned(); } catch { /* 容错 */ } }

        if ((ctx.totalRounds as number) <= 3 || (ctx.totalRounds as number) % 10 === 0) {
            const lr = layeredRef as Record<string, unknown> | null;
            const sb = (lr as any)?.stressBreakdown;
            console.log(`[spawn-diag] round=${ctx.totalRounds} stress=${lr?._adaptiveStressRaw ?? '?'} intent=${lr?._spawnIntent ?? '?'} arc=${ctx.runOverRunArc ?? 'null'} pbGrowth=${ctx.pbGrowthFast ?? false} lifecycle=${sb?.lifecycleStage ?? '?'}·${sb?.lifecycleBand ?? '?'} cap=${sb?.lifecycleCapAdjust ?? 0}`);
        }

        return blocks;
    }

    // 每日大师题：若注入了日固定 PRNG，则本次出块体内临时替换 Math.random（含几何 + 配色），用完即还原。
    const engineSpawn = function engineSpawn(grid: Grid): DockBlock[] {
        const seedRandom = getSeedRandom ? getSeedRandom() : null;
        if (!seedRandom) return spawnCore(grid);
        const orig = Math.random;
        Math.random = seedRandom;
        try {
            return spawnCore(grid);
        } finally {
            Math.random = orig;
        }
    } as EngineSpawner;
    engineSpawn.resetForNewGame = (): void => {
        // 闭包态：与 web 新局把 `_spawnContext` 重赋新对象 + `_lastSpawnIntent=null` 等同源。
        ctx = initialCtx();
        _lastSpawnIntent = null;
        _lastSpawnIntentAge = 0;
        // 引擎模块级态：清掉 _prevScoreMilestone / _spawnMemory。
        resetEngineForNewGame();
    };
    return engineSpawn;
}
