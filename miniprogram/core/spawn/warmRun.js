/**
 * 温暖局（Warm Run）—— 出块策略钳制器 v1.70
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计动机
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 在 OpenBlock 现有的多层出块体系（profile 插值 + spawnHints + intentResolver
 * + constructiveSpawn）之上，对 **新手 / 回流 / 连续受挫** 三类人群进行
 * 「人群保护」级别的钳制：
 *
 *   1. 大幅释放温暖局：前期多出大方块（2×2 / 2×3 / 3×3）、长方形（1×3 ~ 1×5）
 *      等规则块，抑制 T / Z / J 折角块；
 *   2. 降低难度：保证三连必有 1~2 块即时可消（clearGuarantee≥1）；
 *   3. 制造爽感局：multiClear / monoFlush / perfectClear 在前 6 步内必触发 1 次。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 架构定位（modulator，不是 replacement）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 本模块是 **钳制器（modulator）**，不替代 adaptiveSpawn / blockSpawn 主管线。
 * 调用链：
 *
 *   game.js
 *     ├─ resolveAdaptiveStrategy(ctx)               // 现有：算出 enhancedConfig
 *     ├─ applyWarmRun(enhancedConfig, ctx)          // ★ 本模块：重写 shapeWeights + spawnHints
 *     └─ generateDockShapes(grid, enhancedConfig)   // 现有：自然消费温暖 hint
 *
 * 这样做的好处：
 *   - 完全不动 adaptiveSpawn 内部 17 信号合成 / 10 档 profile 插值 / intentResolver；
 *   - blockSpawn.js 仅需在已有 hint 上多读 hints.warmRun.* 字段，按数据走分支；
 *   - 单元测试只测「输入 enhancedConfig + ctx → 输出 enhancedConfig'」的纯函数行为；
 *   - 关闭 warmRun.enabled 后 applyWarmRun 直接返回原配置，零额外成本。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 触发器矩阵（与 game_rules.json `adaptiveSpawn.warmRun.triggers` 同源）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   T1 newbie           → warm_strong   新手（lifetime<60 且总局序≤3）
 *   T2 returning        → warm_rescue   回流（沉默≥3 天后首 2 局）
 *   T3 frustration_run  → warm_strong   单局连挫（consecutiveNonClears≥6）
 *   T4 frustration_sess → warm_strong   跨局连挫（近 3 局得分 < 60% 均值）
 *   T5 churn_imminent   → warm_mild     流失高危（churnRisk≥0.75）
 *   T6 winback_pack     → warm_rescue   回流保护包激活
 *   T7 manual_remote    → 可配置        远端实验/运营强制
 *
 * 多触发器命中时取强度最高的（rescue > strong > mild）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 三档强度（warm_mild / warm_strong / warm_rescue）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 每档钳制的字段：
 *   - stressCap                  enhancedConfig 顶层 stress 上限（钳制后写回）
 *   - shapeWeights               按品类直接覆盖（rescue 档 T/Z 直接 0）
 *   - forbidJagged               true → T/Z 权重压到 ≤ 0.05
 *   - clearGuaranteeMin          spawnHints.clearGuarantee 下限
 *   - sizePreferenceMin          spawnHints.sizePreference 下限（偏大块）
 *   - multiClearBonusMin         spawnHints.multiClearBonus 下限
 *   - monoFlushBonusMin          → 写到 spawnHints.iconBonusTarget
 *   - perfectClearBoostMin       spawnHints.perfectClearBoost 下限
 *   - largeBlockMinRatio         blockSpawn 后置校验下限（透传到 hints.warmRun）
 *   - guaranteedDelights         整段温暖期必须发生的爽感次数（写入 warmBudget）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 预算管理（防止过度温暖反向无聊）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   warmBudget = {
 *     intensity, phase, maxSpawns, spawnsUsed,
 *     phaseSplit: [early%, mid%, late%],
 *     consumedDelights: { multiClear, monoFlush, perfectClear },
 *     guaranteedDelights: { ... },
 *   }
 *
 * 三段渐退：early=100% 温暖、mid=70% 温暖、late=40% 温暖；late 之后退出。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 退出条件（任一满足）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   - spawnsUsed >= maxSpawns
 *   - 累计 multiClear >= 2（或 perfectClear >= 1）且 spawnsUsed >= minSpawnsBeforeExit
 *   - hintIgnoreStreak >= 3（玩家持续无视温暖 hint，防反向操控）
 *   - T1 类：完成首 maxRunsT1 局；T2 类：完成首 maxRunsT2 局
 *
 * 详见 docs/algorithms/ALGORITHMS_SPAWN.md §十七（温暖局 Warm Run）。
 *
 * @file
 */

const { GAME_RULES } = require('../gameRules');
const { getCachedLifecycleSnapshot } = require('../lifecycle/lifecycleSignals');

/* 与 adaptiveSpawn.normalizeStress 同源（B-Clean v1.55.17）。
 * 此处复刻常量值而不 import，避免 spawn 层与 adaptiveSpawn 之间的循环依赖
 * （adaptiveSpawn 在 game.js 链路中调用 applyWarmRun 时已被加载，反向 import 会破坏 ES 模块解析顺序）。
 * 值变更时由 tests/warmRun.test.js 的「stress 归一化与 adaptiveSpawn 同源」断言强制锁定。 */
const STRESS_NORM_OFFSET = 0.2;
const STRESS_NORM_SCALE = 1.2;
function normalizeStress(raw) {
    const n = (Number(raw) + STRESS_NORM_OFFSET) / STRESS_NORM_SCALE;
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

/* ------------------------------------------------------------------ */
/*  常量与默认配置                                                     */
/* ------------------------------------------------------------------ */

/** 温暖强度等级，数值越大优先级越高（用于多触发器命中时合并）。 */
const INTENSITY_RANK = Object.freeze({
    warm_mild: 1,
    warm_strong: 2,
    warm_rescue: 3,
});

/** spawnHints.warmRun.target 取值集合，blockSpawn / constructiveSpawn 据此选路径。 */
const WARM_TARGETS = Object.freeze({
    SETUP_FOR_MULTI: 'setup_for_multi',
    MULTI_CLEAR_NOW: 'multi_clear_now',
    MONO_FLUSH: 'mono_flush',
    PERFECT_CLEAR: 'perfect_clear',
    COMFORT_FLOW: 'comfort_flow',
});

/* ------------------------------------------------------------------ */
/*  配置读取（带兜底）                                                  */
/* ------------------------------------------------------------------ */

function readWarmRunConfig() {
    const ad = GAME_RULES?.adaptiveSpawn ?? {};
    return ad.warmRun ?? null;
}

function getEngagementConfig() {
    return GAME_RULES?.adaptiveSpawn?.engagement ?? {};
}

/* ------------------------------------------------------------------ */
/*  触发器评估                                                          */
/* ------------------------------------------------------------------ */

/**
 * 评估所有触发器，返回命中列表与合并后强度（命中最高强度）。
 *
 * @param {object} profile PlayerProfile 实例
 * @param {object} runContext 当前局上下文 { runIndex, isReturningRun, winbackActive, churnRisk }
 * @returns {{ intensity: string | null, hits: Array<{id:string, intensity:string, reason:string}>, lifecycle: object | null }}
 */
function evaluateWarmTriggers(profile, runContext = {}) {
    const cfg = readWarmRunConfig();
    if (!cfg || cfg.enabled === false) return { intensity: null, hits: [], lifecycle: null };

    /* rolloutPercent < 100 时按 profile 稳定哈希做灰度（同一玩家始终在同一组）。 */
    if (Number.isFinite(cfg.rolloutPercent) && cfg.rolloutPercent < 100) {
        const uid = String(profile?.userId ?? profile?._installTs ?? 'anon');
        const bucket = _hashBucket(uid);
        if (bucket >= cfg.rolloutPercent) return { intensity: null, hits: [], lifecycle: null };
    }

    const triggers = cfg.triggers ?? {};
    const eng = getEngagementConfig();
    const hits = [];

    /* —— T1 新手 —— */
    const T1 = triggers.T1_newbie;
    if (T1?.enabled !== false) {
        const lifetimePlacements = Number(profile?.lifetimePlacements) || 0;
        const lifetimeGames = Number(profile?.lifetimeGames) || 0;
        if (lifetimePlacements < (T1?.maxLifetimePlacements ?? 60)
            && lifetimeGames < (T1?.maxRunsProtected ?? 3)) {
            hits.push({
                id: 'T1_newbie',
                intensity: T1?.intensity || 'warm_strong',
                reason: `lifetimePlacements=${lifetimePlacements}<${T1?.maxLifetimePlacements ?? 60} & lifetimeGames=${lifetimeGames}<${T1?.maxRunsProtected ?? 3}`,
            });
        }
    }

    /* —— T2 回流 —— */
    const T2 = triggers.T2_returning;
    if (T2?.enabled !== false) {
        const days = Number(profile?.daysSinceLastActive) || 0;
        const runsAfter = Number(runContext.runsAfterReturn ?? 0);
        if (days >= (T2?.minDaysSinceLastSession ?? 3) && runsAfter < (T2?.maxRunsAfterReturn ?? 2)) {
            hits.push({
                id: 'T2_returning',
                intensity: T2?.intensity || 'warm_rescue',
                reason: `daysSinceLastActive=${days}>=${T2?.minDaysSinceLastSession ?? 3} & runsAfterReturn=${runsAfter}<${T2?.maxRunsAfterReturn ?? 2}`,
            });
        }
    }

    /* —— T3 单局连挫 —— */
    const T3 = triggers.T3_frustration_run;
    if (T3?.enabled !== false) {
        const consec = Number(profile?.frustrationLevel) || 0;
        const minNonClears = T3?.thresholdConsecutiveNonClears ?? 6;
        const minFrust = T3?.thresholdFrustrationLevel ?? eng.frustrationThreshold ?? 5;
        if (consec >= minNonClears || consec >= minFrust) {
            hits.push({
                id: 'T3_frustration_run',
                intensity: T3?.intensity || 'warm_strong',
                reason: `consecutiveNonClears=${consec} >= min(${minNonClears},${minFrust})`,
            });
        }
    }

    /* —— T4 跨局连挫 —— */
    const T4 = triggers.T4_frustration_session;
    if (T4?.enabled !== false && typeof profile?.recentSessionStats === 'function') {
        const stats = profile.recentSessionStats(T4?.recentSessions ?? 3);
        if (stats && stats.count >= (T4?.recentSessions ?? 3)) {
            const scoresBelowAvg = stats.belowAvgCount >= (T4?.recentSessions ?? 3)
                && (stats.avgScoreRatio ?? 1) < (T4?.scoreRatioThreshold ?? 0.6);
            const shortRuns = stats.shortSessions >= (T4?.shortSessionCount ?? 2);
            if (scoresBelowAvg && shortRuns) {
                hits.push({
                    id: 'T4_frustration_session',
                    intensity: T4?.intensity || 'warm_strong',
                    reason: `avgScoreRatio=${(stats.avgScoreRatio ?? 0).toFixed(2)}<${T4?.scoreRatioThreshold ?? 0.6} & shortSessions=${stats.shortSessions}`,
                });
            }
        }
    }

    /* —— T5 流失高危 —— */
    const T5 = triggers.T5_churn_imminent;
    if (T5?.enabled !== false) {
        const risk = Number(runContext.churnRisk) || 0;
        if (risk >= (T5?.churnRiskThreshold ?? 0.75)) {
            hits.push({
                id: 'T5_churn_imminent',
                intensity: T5?.intensity || 'warm_mild',
                reason: `churnRisk=${risk.toFixed(2)}>=${T5?.churnRiskThreshold ?? 0.75}`,
            });
        }
    }

    /* —— T6 winback 保护包 —— */
    const T6 = triggers.T6_winback_pack;
    if (T6?.enabled !== false && runContext.winbackActive) {
        hits.push({
            id: 'T6_winback_pack',
            intensity: T6?.intensity || 'warm_rescue',
            reason: 'winbackProtection active',
        });
    }

    /* —— T7 远端强制 —— */
    const T7 = triggers.T7_manual_remote;
    if (T7?.enabled === true && runContext.warmRunForceOn) {
        hits.push({
            id: 'T7_manual_remote',
            intensity: runContext.warmRunIntensityOverride || T7?.intensity || 'warm_strong',
            reason: 'remote forceOn',
        });
    }

    /* 合并：取强度最高者。 */
    let intensity = null;
    let lifecycle = null;
    try {
        lifecycle = getCachedLifecycleSnapshot(profile);
    } catch (_e) { /* lifecycle snapshot 失败不阻断 warm run */ }

    for (const h of hits) {
        if (!intensity || (INTENSITY_RANK[h.intensity] ?? 0) > (INTENSITY_RANK[intensity] ?? 0)) {
            intensity = h.intensity;
        }
    }
    return { intensity, hits, lifecycle };
}

/* ------------------------------------------------------------------ */
/*  预算管理                                                            */
/* ------------------------------------------------------------------ */

/**
 * 根据 intensity 构造温暖局预算（局开始时调用一次）。
 *
 * @param {string} intensity 'warm_mild' | 'warm_strong' | 'warm_rescue'
 * @returns {object} warmBudget 对象（mutate by reference）
 */
function buildWarmBudget(intensity) {
    const cfg = readWarmRunConfig();
    const budgetCfg = cfg?.budget ?? {};
    const intensCfg = cfg?.intensities?.[intensity] ?? {};
    const maxSpawns = Number(budgetCfg.maxSpawnsByIntensity?.[intensity]) || 24;
    const phaseSplit = Array.isArray(budgetCfg.phaseSplit) && budgetCfg.phaseSplit.length === 3
        ? budgetCfg.phaseSplit.slice()
        : [0.33, 0.45, 0.22];
    const phaseStrength = budgetCfg.phaseStrength ?? { early: 1.0, mid: 0.7, late: 0.4 };
    return {
        intensity,
        maxSpawns,
        spawnsUsed: 0,
        phaseSplit,
        phaseStrength: { ...phaseStrength },
        consumedDelights: { multiClear: 0, monoFlush: 0, perfectClear: 0 },
        guaranteedDelights: { ...(intensCfg.guaranteedDelights ?? { multiClear: 2, monoFlush: 1, perfectClear: 1 }) },
        hintIgnoreStreak: 0,
        startedAt: Date.now(),
    };
}

/**
 * 根据预算使用进度推断当前 phase ('early' | 'mid' | 'late')。
 *
 * 不变式：phaseSplit 三段加起来 ≤ 1；超出 late 边界时返回 'expired'。
 */
function getWarmPhase(budget) {
    if (!budget || budget.maxSpawns <= 0) return 'expired';
    const ratio = budget.spawnsUsed / budget.maxSpawns;
    const [e, m] = budget.phaseSplit;
    if (ratio < e) return 'early';
    if (ratio < e + m) return 'mid';
    if (ratio <= 1) return 'late';
    return 'expired';
}

/**
 * 推进温暖局预算 / 记录爽感与 hint 忽视。
 *
 * 调用语义（v1.70.1 拆分修复）：
 *   - **spawn 事件**（每生成一组新三连块时调用一次，与 `_commitSpawn` 同源）：
 *       `consumeWarmBudget(budget, { countSpawn: true })` → `spawnsUsed += 1`。
 *   - **落子事件**（每次玩家放下一块时调用，与 `onPlace` 同源）：
 *       `consumeWarmBudget(budget, { multiClear, monoFlush, perfectClear, hintIgnored })`
 *       仅累加 delights / hintIgnoreStreak，**不动 spawnsUsed**。
 *
 * 历史 v1.70 主链路曾在 `onPlace` 同时累加 spawnsUsed，导致一组三连 = 3 spawns，
 * `maxSpawns` 速度 3 倍超预期，phase 推进与退出全失真。v1.70.1 拆开两个调用点。
 *
 * @param {object} budget
 * @param {{ countSpawn?:boolean, multiClear?:boolean, monoFlush?:boolean, perfectClear?:boolean, hintIgnored?:boolean }} delta
 */
function consumeWarmBudget(budget, delta = {}) {
    if (!budget) return;
    if (delta.countSpawn) budget.spawnsUsed += 1;
    if (delta.multiClear) budget.consumedDelights.multiClear += 1;
    if (delta.monoFlush) budget.consumedDelights.monoFlush += 1;
    if (delta.perfectClear) budget.consumedDelights.perfectClear += 1;
    if (delta.hintIgnored === true) budget.hintIgnoreStreak += 1;
    else if (delta.hintIgnored === false) budget.hintIgnoreStreak = 0;
}

/* ------------------------------------------------------------------ */
/*  退出条件                                                            */
/* ------------------------------------------------------------------ */

/**
 * 判断是否应退出温暖局；若 true 调用方应清空 ctx.warmRunState。
 *
 * @returns {{ exit: boolean, reason: string | null }}
 */
function shouldExitWarmRun(budget, runContext = {}) {
    if (!budget) return { exit: true, reason: 'no-budget' };
    const cfg = readWarmRunConfig();
    const exitCfg = cfg?.exit ?? {};
    const minBefore = exitCfg.minSpawnsBeforeExit ?? 6;

    if (budget.spawnsUsed >= budget.maxSpawns) {
        return { exit: true, reason: 'budget-exhausted' };
    }
    if (budget.spawnsUsed >= minBefore) {
        if (budget.consumedDelights.perfectClear >= (exitCfg.perfectClearExitCount ?? 1)) {
            return { exit: true, reason: 'perfect-clear-hit' };
        }
        if (budget.consumedDelights.multiClear >= (exitCfg.multiClearExitCount ?? 2)) {
            return { exit: true, reason: 'multi-clear-hit' };
        }
    }
    if (budget.hintIgnoreStreak >= (exitCfg.hintIgnoreStreakExit ?? 3)) {
        return { exit: true, reason: 'hint-ignored' };
    }
    /* T1 / T2 局数限制由调用方在 evaluateWarmTriggers 阶段处理（runIndex 超限就不再命中），
     * 此处仅兜底：lifetime 局序若超过 maxRunsT1 / maxRunsT2 也强退。 */
    if (runContext.t1Active && Number(runContext.lifetimeGames) >= (exitCfg.maxRunsT1 ?? 3)) {
        return { exit: true, reason: 't1-runs-exhausted' };
    }
    if (runContext.t2Active && Number(runContext.runsAfterReturn) >= (exitCfg.maxRunsT2 ?? 2)) {
        return { exit: true, reason: 't2-runs-exhausted' };
    }
    return { exit: false, reason: null };
}

/* ------------------------------------------------------------------ */
/*  爽感编排（决定本三连的 target）                                       */
/* ------------------------------------------------------------------ */

/**
 * 根据当前盘面与预算决定本三连的 delight target。
 *
 * @param {object} grid Grid 实例
 * @param {object} budget warmBudget
 * @returns {string} WARM_TARGETS 之一
 */
function pickWarmTarget(grid, budget) {
    const cfg = readWarmRunConfig();
    const choreo = cfg?.delightChoreography ?? {};
    if (choreo.enabled === false) return WARM_TARGETS.COMFORT_FLOW;

    const fill = typeof grid?.getFillRatio === 'function' ? grid.getFillRatio() : 0;
    const phase = getWarmPhase(budget);

    /* perfectClear 触发：棋盘只剩少量空格（remainingEmpty ≤ pcMaxCells）
     * 此时下一组三连若能恰好填满即可清屏。
     * 注意：perfectClearBoardFillCeiling 是「fill 上限」语义已废弃（与 maxRemaining
     * 在 8×8 盘面上互斥）；保留字段仅作向后兼容，实际判定以 remainingEmpty 为准。 */
    const remainingEmpty = _countEmpty(grid);
    const pcMaxCells = choreo.perfectClearMaxRemainingCells ?? 15;
    if (budget && budget.guaranteedDelights?.perfectClear > (budget.consumedDelights.perfectClear ?? 0)
        && remainingEmpty > 0 && remainingEmpty <= pcMaxCells) {
        return WARM_TARGETS.PERFECT_CLEAR;
    }

    /* 检测近满线 ≥ 2 → 立刻多消。 */
    if (typeof grid?.cells === 'object') {
        const near = _scanNearFullLines(grid, 2);
        if (near.length >= 2) return WARM_TARGETS.MULTI_CLEAR_NOW;
    }

    /* 空棋盘 / 低填充 → setup 多消机会。 */
    const multiCeil = choreo.multiClearBoardFillThreshold ?? 0.30;
    if (fill <= multiCeil && phase === 'early') {
        return WARM_TARGETS.SETUP_FOR_MULTI;
    }

    /* 同 icon 簇 ≥ N → mono flush。 */
    const cluster = _detectDominantIconCluster(grid, choreo.monoFlushMinClusterSize ?? 6);
    if (cluster) return WARM_TARGETS.MONO_FLUSH;

    /* late 阶段 / 预算用满 → 顺手大块流。 */
    return WARM_TARGETS.COMFORT_FLOW;
}

/* ------------------------------------------------------------------ */
/*  核心：钳制器（modulator）                                            */
/* ------------------------------------------------------------------ */

/**
 * 在 adaptiveSpawn 产出的 enhancedConfig 之上叠加温暖局钳制。
 *
 * 调用约定：
 *   - 调用方（game.js / engineSpawn）需自行管理 ctx.warmRunState：
 *       { active: boolean, intensity, budget, triggerIds, lifecycle }
 *   - 本函数纯函数：返回一个 **新对象**（不 mutate 输入）。
 *   - 当温暖局未激活或配置禁用时，直接返回原 enhancedConfig。
 *
 * 钳制内容：
 *   1. shapeWeights 用 intensities[intensity].shapeWeights 整段覆盖（不插值，
 *      因为温暖局是「人群保护」级别，需要可预期的体验）；
 *   2. forbidJagged=true 时把 tshapes/zshapes 权重压到 ≤ 0.05；
 *   3. spawnHints 钳制：clearGuarantee/sizePreference/multiClearBonus/iconBonusTarget/
 *      perfectClearBoost/spawnIntent/reliefUrgent 全部按 intensity 下限抬升；
 *   4. spawnHints.warmRun 携带完整钳制元数据，供 blockSpawn / constructiveSpawn 决策；
 *   5. _adaptiveStress / _adaptiveStressRaw 钳制到 intensity.stressCap。
 *
 * @param {object} enhancedConfig resolveAdaptiveStrategy() 返回值
 * @param {object} ctx 调用上下文，必须含 warmRunState
 * @param {{ grid?: object }} [opts]
 * @returns {object} 钳制后的 enhancedConfig（**新对象**）
 */
function applyWarmRun(enhancedConfig, ctx, opts = {}) {
    if (!enhancedConfig) return enhancedConfig;
    const state = ctx?.warmRunState;
    if (!state || !state.active || !state.intensity) return enhancedConfig;

    const cfg = readWarmRunConfig();
    if (!cfg || cfg.enabled === false) return enhancedConfig;
    const intensCfg = cfg.intensities?.[state.intensity];
    if (!intensCfg) return enhancedConfig;

    /* —— shapeWeights 整段覆盖 —— */
    const baseWeights = enhancedConfig.shapeWeights || {};
    const warmWeights = { ...baseWeights, ...(intensCfg.shapeWeights || {}) };
    if (intensCfg.forbidJagged === true) {
        warmWeights.tshapes = Math.min(warmWeights.tshapes ?? 0, 0.05);
        warmWeights.zshapes = Math.min(warmWeights.zshapes ?? 0, 0.05);
    }

    /* —— stress 钳制 —— */
    const stressCap = Number.isFinite(intensCfg.stressCap) ? intensCfg.stressCap : null;
    const rawStress = Number(enhancedConfig._adaptiveStressRaw);
    const cappedRaw = stressCap !== null && Number.isFinite(rawStress)
        ? Math.min(rawStress, stressCap)
        : rawStress;

    /* —— spawnHints 钳制 —— */
    const baseHints = enhancedConfig.spawnHints || {};
    const target = opts.grid ? pickWarmTarget(opts.grid, state.budget) : WARM_TARGETS.COMFORT_FLOW;
    const phase = getWarmPhase(state.budget);
    const phaseStrength = (state.budget?.phaseStrength?.[phase] ?? 1.0);

    /* 按 phaseStrength 衰减下限：late 阶段不再 100% 抬升，让玩家平滑过渡回 normal。 */
    const mix = (cur, min) => {
        const lift = min - cur;
        if (lift <= 0) return cur;
        return cur + lift * phaseStrength;
    };

    const warmHints = {
        ...baseHints,
        clearGuarantee: Math.max(
            baseHints.clearGuarantee ?? 0,
            Math.round((intensCfg.clearGuaranteeMin ?? 1) * (phase === 'late' ? 1 : 1))
        ),
        sizePreference: Math.min(1, Math.max(
            baseHints.sizePreference ?? 0,
            mix(baseHints.sizePreference ?? 0, intensCfg.sizePreferenceMin ?? 0.20)
        )),
        multiClearBonus: Math.min(1, mix(baseHints.multiClearBonus ?? 0, intensCfg.multiClearBonusMin ?? 0.65)),
        iconBonusTarget: Math.min(1, mix(baseHints.iconBonusTarget ?? 0, intensCfg.monoFlushBonusMin ?? 0.35)),
        perfectClearBoost: Math.min(1, mix(baseHints.perfectClearBoost ?? 0, intensCfg.perfectClearBoostMin ?? 0.30)),
        delightBoost: Math.min(1, Math.max(baseHints.delightBoost ?? 0, 0.5)),
        reliefUrgent: true,
        spawnIntent: 'warm',
        warmRun: {
            active: true,
            intensity: state.intensity,
            phase,
            phaseStrength,
            target,
            triggerIds: state.triggerIds || [],
            largeBlockMinRatio: intensCfg.largeBlockMinRatio ?? 0.65,
            specialReliefInjectRate: intensCfg.specialReliefInjectRate ?? 0.18,
            forbidJagged: intensCfg.forbidJagged === true,
            budgetSnapshot: state.budget ? {
                spawnsUsed: state.budget.spawnsUsed,
                maxSpawns: state.budget.maxSpawns,
                consumedDelights: { ...state.budget.consumedDelights },
                guaranteedDelights: { ...state.budget.guaranteedDelights },
            } : null,
        },
    };

    /* —— 返回新对象（不 mutate 输入） —— */
    const out = {
        ...enhancedConfig,
        shapeWeights: warmWeights,
        spawnHints: warmHints,
    };
    if (stressCap !== null && Number.isFinite(cappedRaw)) {
        out._adaptiveStressRaw = cappedRaw;
        out._adaptiveStress = normalizeStress(cappedRaw);
        out._stressBreakdown = {
            ...(enhancedConfig._stressBreakdown || {}),
            warmRunCapApplied: true,
            warmRunCapRaw: stressCap,
        };
    }
    out._warmRun = {
        intensity: state.intensity,
        phase,
        target,
        triggerIds: state.triggerIds || [],
        budget: out.spawnHints.warmRun.budgetSnapshot,
    };
    return out;
}

/* ------------------------------------------------------------------ */
/*  Telemetry 帮助：序列化 trace 字符串                                  */
/* ------------------------------------------------------------------ */

/**
 * 把 warmRunState 序列化为 trace 字符串，供 spawnIntentTrace / evaluation 上报。
 */
function formatWarmRunTrace(state) {
    if (!state || !state.active) return '';
    const b = state.budget || {};
    const cd = b.consumedDelights || {};
    return `warm:${state.intensity}/${getWarmPhase(b)}`
        + ` triggers=[${(state.triggerIds || []).join(',')}]`
        + ` spawns=${b.spawnsUsed ?? 0}/${b.maxSpawns ?? '?'}`
        + ` delights=mc${cd.multiClear ?? 0}/mf${cd.monoFlush ?? 0}/pc${cd.perfectClear ?? 0}`;
}

/* ------------------------------------------------------------------ */
/*  内部工具                                                            */
/* ------------------------------------------------------------------ */

function _hashBucket(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h % 100;
}

function _countEmpty(grid) {
    if (!grid?.cells) return 0;
    let n = 0;
    const size = grid.size;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) if (grid.cells[y][x] === null) n++;
    }
    return n;
}

function _scanNearFullLines(grid, maxEmpty = 2) {
    const out = [];
    if (!grid?.cells) return out;
    const size = grid.size;
    for (let y = 0; y < size; y++) {
        let empties = 0;
        for (let x = 0; x < size; x++) if (grid.cells[y][x] === null) empties++;
        if (empties >= 1 && empties <= maxEmpty) out.push({ type: 'row', index: y, empties });
    }
    for (let x = 0; x < size; x++) {
        let empties = 0;
        for (let y = 0; y < size; y++) if (grid.cells[y][x] === null) empties++;
        if (empties >= 1 && empties <= maxEmpty) out.push({ type: 'col', index: x, empties });
    }
    return out;
}

function _detectDominantIconCluster(grid, minSize) {
    if (!grid?.cells) return null;
    const counts = Object.create(null);
    const size = grid.size;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const v = grid.cells[y][x];
            if (!v) continue;
            const icon = typeof v === 'object' ? (v.icon ?? v.color ?? v.id ?? '?') : v;
            counts[icon] = (counts[icon] || 0) + 1;
        }
    }
    let best = null;
    for (const k of Object.keys(counts)) {
        if (counts[k] >= minSize && (!best || counts[k] > best.size)) {
            best = { icon: k, size: counts[k] };
        }
    }
    return best;
}

/* ------------------------------------------------------------------ */
/*  导出：常量列表，供 derivation/intentResolver 与 UI 引用              */
/* ------------------------------------------------------------------ */

const WARM_RUN_INTENT_ID = 'warm';
const WARM_RUN_PRIORITY = 115; // 高于 pb_chase_pressure(102) 与 relief(100)

module.exports = { applyWarmRun, buildWarmBudget, consumeWarmBudget, evaluateWarmTriggers, formatWarmRunTrace, getWarmPhase, INTENSITY_RANK as WARM_INTENSITY_RANK, pickWarmTarget, shouldExitWarmRun, WARM_RUN_INTENT_ID, WARM_RUN_PRIORITY, WARM_TARGETS };
