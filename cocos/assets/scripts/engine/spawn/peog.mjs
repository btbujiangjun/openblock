/* 自动生成 —— 请勿手改。源：web/src/spawn/peog.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * PEOG —— PB 早期超越守卫（PB Early-Overshoot Guard） v1.71
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计动机
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 对于 PB 处于中高分段（bestScore ≥ midHighFloor，默认 1200，与
 * dynamicDifficulty.pbProgress.expertSoftCap 对齐）的玩家，温暖局 + 构造算法 +
 * expertEarlyBoost 三者叠加可能在开局前 6~8 个 spawn 内送出累计 ≥ PB 的得分爆点：
 *   - 温暖局 T3/T4/T5 命中后 guaranteedDelights = {multiClear:2, perfectClear:1}；
 *   - 构造算法 findMultiClearCompleter / findPerfectClearTriplet 不感知 PB 距离；
 *   - expertEarlyBoost 抬 multiClearBonus / perfectClearBoost ≥ 0.5。
 * 三者同帧叠加 → 高手在 P0 warmup 段就超 PB → _maybeCelebrateNewBest 提前触发烟花，
 * 紧接 pbOvershootBoost + orderRigor 把 stress 推到 0.85+，剩余 80% 时间高压硬挺，
 * 崩盘后玩家本局成就感与生理状态双重透支。本守卫专门解决该路径。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 架构定位（modulator，不替代任何主管线）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   game.js
 *     ├─ buildPeogState(profile, ctx, warmRunState)           // start() 时一次
 *     ├─ evaluatePeogActive(state, ctx, profile)              // 每 spawn 前
 *     ├─ applyWarmRun(enhancedConfig, ctx, opts)
 *     ├─ applyPeogSpawnHintsCap(enhancedConfig, peogState)    // ★ warmRun 之后
 *     ├─ generateDockShapes(grid, enhancedConfig)
 *     │     └─ findMultiClearCompleter/PerfectClearTriplet/LargeBlockCompleter
 *     │           └─ applyPeogYieldCap(candidates, peogState) // ★ 算子返回后立刻 cap
 *     └─ onPlace → consumePeogOnPlace(state, ctx, scoreDelta)
 *
 * 三个不变式：
 *   1. PEOG **只动机会面**（spawnHints + 构造算子候选过滤），绝不改 bestScore、
 *      derivePbCurve、challengeBoost、_maybeCelebrateNewBest 等纪录线。
 *   2. PEOG **bypass 一次定型**（任何 bypass 触发后整局不再恢复 active），避免
 *      "recovery 解除 → PEOG 又把分压回去" 的反复折腾。
 *   3. PEOG 与 expertEarlyBoost 冲突时 **PEOG cap 优先**——
 *      `min(expertEarlyBoostFloor, peogCap)`，子集 override 父集。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Bypass 12 路（优先级从上到下短路）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   buildPeogState 阶段（一次性判定，整局不变）：
 *     1. disabled                    — 配置 enabled=false
 *     2. rollout_out                 — 灰度未命中
 *     3. low_pb                      — bestScore < midHighFloor（中低 PB 玩家不需要守卫）
 *     4. t1_newbie                   — 温暖局 T1 触发（新手 PB 本就低，不应命中此条；兜底）
 *     5. winback_first_run           — 温暖局 T2 + 回流首局（让回流玩家"找回手感"）
 *     6. manual_remote_force         — 温暖局 T7（运营实验强制）
 *
 *   evaluatePeogActive 阶段（每 spawn 重新判定，任一触发即永久 bypass）：
 *     7. recovery                    — profile.needsRecovery === true
 *     8. near_miss                   — ctx.hadRecentNearMiss === true
 *     9. bottleneck                  — ctx.hasBottleneckSignal === true
 *    10. post_pb_release             — §4.9 释放窗口（破 PB 后温柔窗口，本就不应再加东西）
 *    11. late_phase                  — spawnsUsed ≥ guardSpawns（自然到期）
 *    12. approach_handoff            — pct ≥ pbApproachCeiling（交棒给 challengeBoost）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 强度二档（peog_mild → peog_strong）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   - peog_mild（默认）：cap = PB × 0.08，禁 perfectClear≤0.15，允许 perfectClearTriplet；
 *   - peog_strong：cap = PB × 0.05，禁 perfectClear=0，**前置短路** findPerfectClearTriplet。
 *
 *   升级规则：consumePeogOnPlace 中累计 approachCount（pct ≥ ceiling × 0.95 时 +1），
 *   approachCount ≥ escalateAfterApproachCount（默认 3）时升级为 peog_strong。
 *   升级是单向的（不可回退）。
 *
 * @file
 */

import { GAME_RULES } from '../gameRules.mjs';

/* ------------------------------------------------------------------ */
/*  配置读取（带兜底）                                                  */
/* ------------------------------------------------------------------ */

function readPeogConfig() {
    return GAME_RULES?.adaptiveSpawn?.pbChase?.earlyOvershootGuard ?? null;
}

function readScoringConfig() {
    return GAME_RULES?.scoring ?? {};
}

/* ------------------------------------------------------------------ */
/*  灰度哈希（与 warmRun._hashBucket 同源）                              */
/* ------------------------------------------------------------------ */

function _hashBucket(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h % 100;
}

/* ------------------------------------------------------------------ */
/*  构造算子 yield 估算（与 CLEAR_SCORING.md 公式同源）                  */
/* ------------------------------------------------------------------ */

/**
 * 单线消除基础分（baseUnit × c² 中 c=1，再叠加 lineScore=baseUnit×c×4 bonus）。
 * 此处用保守版（仅 baseScore + 平均 bonus 增量），不夸大估算。
 */
function _baseUnit() {
    const baseUnit = Number(readScoringConfig().singleLine);
    return Number.isFinite(baseUnit) && baseUnit > 0 ? baseUnit : 20;
}

/** spawn 中单候选 = 单线消除：baseUnit × 1² = baseUnit。 */
function _yieldCompleter() {
    return _baseUnit() * 1 * 1;
}

/** multiClear n 线：baseUnit × n²（无 bonus 假设；保守低估 bonus 部分）。 */
function _yieldMultiClear(n) {
    return _baseUnit() * n * n;
}

/** perfectClear triplet：按 8 线全清 + perfectMult=10 估算，巨型爆点。 */
function _yieldPerfectTriplet() {
    // c=8 假设，baseScore = baseUnit × 64；× perfectMult(10) = baseUnit × 640。
    return _baseUnit() * 64 * 10;
}

/** 大块自身不直接得分，按 cells × 0.3 折算后续清线期望。 */
function _yieldLargeBlock(size) {
    return Math.max(0, Number(size) || 0) * _baseUnit() * 0.3;
}

/** setup（先铺后清）当帧 0 分，按 0.5×单线折算下帧期望。 */
function _yieldSetup() {
    return _baseUnit() * 0.5;
}

/**
 * 通用入口：根据候选对象的"自描述字段"挑选 yield 公式。
 *
 * 与 web/src/bot/constructiveSpawn.js 输出契约对齐：
 *   - findMultiClearCompleter:   { clears, lineKeys, ... }      → multiClear
 *   - findPerfectClearTriplet:   { shapeIds, placements:[3] }    → perfectTriplet
 *   - findLargeBlockCompleter:   { size, shapeId, ... }          → largeBlock
 *   - findSetupShapes:           { target, shapeId, ... }        → setup
 *   - findCompleterShapes:       { exact, extra, ... }           → completer
 */
export function estimateConstructiveYield(candidate) {
    if (!candidate || typeof candidate !== 'object') return 0;
    if (Number.isFinite(candidate.clears) && candidate.clears > 0) {
        return _yieldMultiClear(candidate.clears);
    }
    if (Array.isArray(candidate.placements) && candidate.placements.length === 3
        && Array.isArray(candidate.shapeIds)) {
        return _yieldPerfectTriplet();
    }
    if (Number.isFinite(candidate.size) && candidate.size > 0) {
        return _yieldLargeBlock(candidate.size);
    }
    if (candidate.target && typeof candidate.target === 'object') {
        return _yieldSetup();
    }
    /* findCompleterShapes 输出：单线补满，最保守。 */
    return _yieldCompleter();
}

/* ------------------------------------------------------------------ */
/*  状态构造（每局 start 时一次）                                        */
/* ------------------------------------------------------------------ */

/**
 * 构造 PEOG 状态。所有 6 路开局期 bypass 在此判定。
 *
 * @param {object} profile  PlayerProfile 实例
 * @param {object} ctx      spawnContext，至少含 bestScoreAtRunStart
 * @param {object|null} warmRunState  game.js 已构造的 warmRunState（用于读取 triggerIds）
 * @returns {object} state
 */
export function buildPeogState(profile, ctx, warmRunState) {
    const cfg = readPeogConfig();
    const midHighFloor = Number(cfg?.midHighFloor) || 1200;
    const pbApproachCeiling = Number(cfg?.pbApproachCeiling) || 0.85;
    const guardSpawns = Number(cfg?.earlyOvershootGuardSpawns) || 8;
    const bestScoreAtRunStart = Number(ctx?.bestScoreAtRunStart) || 0;

    const state = {
        active: false,
        intensity: 'peog_mild',
        bypass: null,
        bestScoreAtRunStart,
        midHighFloor,
        pbApproachCeiling,
        guardSpawns,
        consumedYield: 0,
        approachCount: 0,
        yieldCapHits: 0,
        decisions: [],
        startedAt: Date.now(),
        /* PEOG 抗抖动：bottleneck 延迟让位：连续 hits 计数器 + 让位后冷却帧（防止"刚让位就重激活"）。
         * 让位策略由"瞬时阈值"改为"持续阈值"——单次 hasBottleneckSignal=true 不再立即终止 PEOG，
         * 而是 hits 累加；连续 ≥ bottleneckYieldHits 帧才真正 _bypassNow('bottleneck')。
         * 同理 hadRecentNearMiss 也走持续阈值（near_miss 是窗口型信号，单帧抖动同样存在）。
         * 注意：active=true 时计数器维护；让位是永久（与 _bypassNow 语义一致）。 */
        _bottleneckHits: 0,
        _nearMissHits: 0,
    };

    if (!cfg || cfg.enabled === false) { state.bypass = 'disabled'; return state; }

    /* 灰度（同一玩家始终在同组）。 */
    if (Number.isFinite(cfg.rolloutPercent) && cfg.rolloutPercent < 100) {
        const uid = String(profile?.userId ?? profile?._installTs ?? 'anon');
        if (_hashBucket(uid) >= cfg.rolloutPercent) { state.bypass = 'rollout_out'; return state; }
    }

    if (bestScoreAtRunStart < midHighFloor) { state.bypass = 'low_pb'; return state; }

    const triggerIds = warmRunState?.triggerIds ?? [];
    if (triggerIds.includes('T1_newbie')) { state.bypass = 't1_newbie'; return state; }
    if (triggerIds.includes('T2_returning')
        && Number(ctx?.runsAfterReturn ?? 0) === 0) {
        state.bypass = 'winback_first_run'; return state;
    }
    if (triggerIds.includes('T7_manual_remote')) { state.bypass = 'manual_remote_force'; return state; }

    state.active = true;
    return state;
}

/* ------------------------------------------------------------------ */
/*  每 spawn 前评估（实时 bypass + 自然到期）                            */
/* ------------------------------------------------------------------ */

function _bypassNow(state, reason) {
    state.active = false;
    state.bypass = reason;
    return state;
}

/**
 * 每 spawn 前评估 PEOG 是否仍 active；任一 bypass 触发即永久关闭。
 *
 * @param {object} state    buildPeogState 输出
 * @param {object} ctx      spawnContext（含 score / warmRunState / postPbReleaseActive / hasBottleneckSignal / hadRecentNearMiss）
 * @param {object} profile  PlayerProfile（含 needsRecovery）
 * @returns {object} state（同实例，便于调用方继续传递）
 */
export function evaluatePeogActive(state, ctx, profile) {
    if (!state || !state.active) return state;

    /* needsRecovery / postPbReleaseActive 是状态型信号（玩家挫败 / PB 释放窗口），
     * 一旦置位代表"已经发生且需立即响应"——保持即时让位语义。 */
    if (profile?.needsRecovery === true)        return _bypassNow(state, 'recovery');
    if (ctx?.postPbReleaseActive === true)      return _bypassNow(state, 'post_pb_release');

    /* PEOG 抗抖动：bottleneck / near_miss 改为持续阈值。读取配置（cfg 缺省时退回 1 帧=旧行为）。 */
    const cfg = readPeogConfig();
    const btHitsThresh = Math.max(1, Number(cfg?.bottleneckYieldHits) || 1);
    const nmHitsThresh = Math.max(1, Number(cfg?.nearMissYieldHits) || 1);

    if (ctx?.hasBottleneckSignal === true) {
        state._bottleneckHits = (state._bottleneckHits || 0) + 1;
        if (state._bottleneckHits >= btHitsThresh) return _bypassNow(state, 'bottleneck');
    } else {
        state._bottleneckHits = 0;
    }
    if (ctx?.hadRecentNearMiss === true) {
        state._nearMissHits = (state._nearMissHits || 0) + 1;
        if (state._nearMissHits >= nmHitsThresh) return _bypassNow(state, 'near_miss');
    } else {
        state._nearMissHits = 0;
    }

    const spawnsUsed = Number(ctx?.warmRunState?.budget?.spawnsUsed) || 0;
    if (spawnsUsed >= state.guardSpawns)        return _bypassNow(state, 'late_phase');

    const pct = state.bestScoreAtRunStart > 0
        ? (Number(ctx?.score) || 0) / state.bestScoreAtRunStart
        : 0;
    if (pct >= state.pbApproachCeiling)         return _bypassNow(state, 'approach_handoff');

    return state;
}

/* ------------------------------------------------------------------ */
/*  落子事件（onPlace 同步：累计 yield + 升级判定）                       */
/* ------------------------------------------------------------------ */

/**
 * 累计真实得分 + 判定是否升级 mild → strong。
 *
 * @param {object} state
 * @param {object} ctx       spawnContext（含 score）
 * @param {number} scoreDelta 本次落子的得分增量
 */
export function consumePeogOnPlace(state, ctx, scoreDelta) {
    if (!state) return;
    state.consumedYield += Math.max(0, Number(scoreDelta) || 0);
    if (!state.active || state.intensity === 'peog_strong') return;

    const cfg = readPeogConfig();
    const escalateAfter = Number(cfg?.escalateAfterApproachCount) || 3;
    const pct = state.bestScoreAtRunStart > 0
        ? (Number(ctx?.score) || 0) / state.bestScoreAtRunStart
        : 0;
    /* 升级软触发：pct 触达 ceiling 的 95%（默认 0.85×0.95=0.8075）。 */
    const softThreshold = state.pbApproachCeiling * 0.95;
    if (pct >= softThreshold) state.approachCount += 1;
    if (state.approachCount >= escalateAfter) state.intensity = 'peog_strong';
}

/* ------------------------------------------------------------------ */
/*  spawnHints 钳制（在 applyWarmRun 之后调用）                          */
/* ------------------------------------------------------------------ */

/**
 * 把 PEOG cap/floor 叠加到 enhancedConfig.spawnHints。
 * 与 §4.15 expertEarlyBoost 冲突时 PEOG 优先：min(floor, cap)。
 *
 * 调用约定：
 *   - 调用方负责确保 `applyWarmRun` 已先于本函数执行；
 *   - 纯函数：返回**新对象**（不 mutate 输入）；
 *   - state.active=false（含 bypass）时直接返回原 enhancedConfig（零成本）。
 *
 * @param {object} enhancedConfig  resolveAdaptiveStrategy 输出（可能已被 applyWarmRun 钳制）
 * @param {object} peogState
 * @returns {object} enhancedConfig（新对象）
 */
export function applyPeogSpawnHintsCap(enhancedConfig, peogState) {
    if (!enhancedConfig) return enhancedConfig;
    if (!peogState || !peogState.active) return enhancedConfig;

    const cfg = readPeogConfig();
    const intens = cfg?.intensities?.[peogState.intensity] ?? cfg?.intensities?.peog_mild ?? {};
    const sh = intens.spawnHints ?? {};
    const baseHints = enhancedConfig.spawnHints || {};

    const mcbCap = Number.isFinite(sh.multiClearBonusCap) ? sh.multiClearBonusCap : 0.45;
    const pcbCap = Number.isFinite(sh.perfectClearBoostCap) ? sh.perfectClearBoostCap : 0.15;
    const iconFloor = Number.isFinite(sh.iconBonusTargetFloor) ? sh.iconBonusTargetFloor : 0.55;
    const spCap = Number.isFinite(sh.sizePreferenceCap) ? sh.sizePreferenceCap : 0.45;
    const cgFloor = Number.isFinite(sh.clearGuaranteeFloor) ? sh.clearGuaranteeFloor : 1;

    /* §改进：从"全程封顶机会面"改为"仅临近 ceiling 才封顶"。
     * PEOG 的目的只是守住 pct<pbApproachCeiling（不提前破纪录），并非压制局初得分率。
     * 用累计剩余额度 remaining = PB×ceiling − consumedYield 判定是否临近 ceiling：
     * 额度充裕（remaining ≥ PB×hintsCapHeadroomRatio）时透传爆点机会面（multiClearBonus/
     * perfectClearBoost/sizePreference 不封顶），恢复"高 PB 局初也有爽块"；仅在逼近 ceiling
     * 时才收手，避免一帧打穿纪录线。iconBonusTarget/clearGuarantee 的温暖 floor 始终保留。 */
    const PB = Number(peogState.bestScoreAtRunStart) || 0;
    const ceiling = Number(peogState.pbApproachCeiling) || 0.85;
    const headroomRatio = Number.isFinite(cfg?.hintsCapHeadroomRatio) ? cfg.hintsCapHeadroomRatio : 0.25;
    const remaining = Math.max(0, PB * ceiling - (Number(peogState.consumedYield) || 0));
    const nearCeiling = PB > 0 && remaining < PB * headroomRatio;

    const peogHints = {
        ...baseHints,
        /* multiClearBonus / perfectClearBoost / sizePreference 仅在临近 ceiling 时取 min（封顶）；
         * 额度充裕时透传原值（让 expertEarlyBoost / warmRun 的爽块机会面在局初照常生效）。 */
        multiClearBonus: nearCeiling ? Math.min(baseHints.multiClearBonus ?? 0, mcbCap) : (baseHints.multiClearBonus ?? 0),
        perfectClearBoost: nearCeiling ? Math.min(baseHints.perfectClearBoost ?? 0, pcbCap) : (baseHints.perfectClearBoost ?? 0),
        sizePreference: nearCeiling ? Math.min(baseHints.sizePreference ?? 0, spCap) : (baseHints.sizePreference ?? 0),
        /* iconBonusTarget / clearGuarantee 取 max（保留温暖契约 + 让玩家走颜色清晰路线）。 */
        iconBonusTarget: Math.max(baseHints.iconBonusTarget ?? 0, iconFloor),
        clearGuarantee: Math.max(baseHints.clearGuarantee ?? 0, cgFloor),
        peog: {
            active: true,
            intensity: peogState.intensity,
            consumedYield: peogState.consumedYield,
            approachCount: peogState.approachCount,
            yieldCapHits: peogState.yieldCapHits,
            nearCeiling,
            remainingHeadroom: remaining,
            maxYieldPerSpawn: peogState.bestScoreAtRunStart
                * (Number(intens.maxYieldPerSpawnRatio) || 0.08),
            perfectClearAllowed: intens.perfectClearAllowed !== false,
            largeBlockMinSize: Number(intens.largeBlockMinSize) || 3,
            multiClearMin: Number(intens.multiClearMin) || 2,
        },
    };

    return { ...enhancedConfig, spawnHints: peogHints };
}

/* ------------------------------------------------------------------ */
/*  构造算子 yield cap（在构造算子返回后调用）                            */
/* ------------------------------------------------------------------ */

/**
 * 把单帧 yield 超 cap 的候选剔除；若全部超 cap 则降级为"取 yield 最低的一个"避免空 dock。
 *
 * @param {Array} candidates 构造算子输出（findMultiClearCompleter / findPerfectClearTriplet
 *                           / findLargeBlockCompleter / findCompleterShapes / findSetupShapes）
 * @param {object} peogState
 * @returns {Array} 过滤后的候选
 */
export function applyPeogYieldCap(candidates, peogState) {
    if (!Array.isArray(candidates) || candidates.length === 0) return candidates || [];
    if (!peogState || !peogState.active) return candidates;

    const cfg = readPeogConfig();
    const intens = cfg?.intensities?.[peogState.intensity] ?? cfg?.intensities?.peog_mild ?? {};
    const minRatio = Number(intens.maxYieldPerSpawnRatio) || 0.08;
    const PB = Number(peogState.bestScoreAtRunStart) || 0;
    /* §改进：单帧 cap 从"恒为 PB×ratio 的逐帧限速"改为"累计不超越 ceiling 的预算"。
     *   remaining = PB×ceiling − consumedYield 是距 ceiling 的累计剩余额度；
     *   PB×minRatio 作为单帧下限（floor），避免 remaining→0 时 dock 变琐碎（保留可玩性）。
     * 局初 remaining 充裕 → cap 很高 → 爆点候选照常放行（恢复高 PB 局初得分率）；
     * 仅当累计逼近 ceiling 时 cap 才收紧到 floor。PEOG 的硬下线仍由 evaluatePeogActive
     * 的 approach_handoff(pct≥ceiling) 兜底，故本累计预算不会把玩家越权推过纪录线。 */
    const ceiling = Number(peogState.pbApproachCeiling) || 0.85;
    const remaining = Math.max(0, PB * ceiling - (Number(peogState.consumedYield) || 0));
    const yieldCap = Math.max(PB * minRatio, remaining);
    if (!(yieldCap > 0)) return candidates;

    const accepted = [];
    const rejected = [];
    for (const c of candidates) {
        const est = Number.isFinite(c?._estimatedYield)
            ? c._estimatedYield
            : estimateConstructiveYield(c);
        if (est <= yieldCap) {
            accepted.push({ ...c, _estimatedYield: est, _peogPassed: true });
        } else {
            rejected.push({ ...c, _estimatedYield: est, _peogPassed: false });
            peogState.yieldCapHits += 1;
        }
    }
    if (accepted.length > 0) return accepted;

    /* 全部超 cap：降级到 yield 最低的一个，避免空 dock（保留可玩性）。 */
    rejected.sort((a, b) => a._estimatedYield - b._estimatedYield);
    return rejected.length > 0 ? [{ ...rejected[0], _peogDowngraded: true }] : [];
}

/**
 * 判断 PEOG 是否应短路某构造算子（用于 findPerfectClearTriplet 的前置 gate）。
 *
 * @param {object} peogState
 * @param {'perfectClearTriplet'|'multiClearCompleter'|'largeBlockCompleter'} kind
 * @returns {boolean}
 */
export function shouldShortCircuitConstructive(peogState, kind) {
    if (!peogState || !peogState.active) return false;
    const cfg = readPeogConfig();
    const intens = cfg?.intensities?.[peogState.intensity] ?? cfg?.intensities?.peog_mild ?? {};
    if (kind === 'perfectClearTriplet' && intens.perfectClearAllowed === false) return true;
    return false;
}

/* ------------------------------------------------------------------ */
/*  Telemetry 帮助                                                      */
/* ------------------------------------------------------------------ */

export function formatPeogTrace(state) {
    if (!state) return '';
    if (!state.active) return `peog:bypass=${state.bypass || 'none'}`;
    return `peog:${state.intensity}`
        + ` consumed=${(state.consumedYield ?? 0).toFixed(0)}/cap=${(state.bestScoreAtRunStart * state.pbApproachCeiling).toFixed(0)}`
        + ` approach=${state.approachCount}`
        + ` capHits=${state.yieldCapHits}`;
}

/* ------------------------------------------------------------------ */
/*  导出常量                                                            */
/* ------------------------------------------------------------------ */

export const PEOG_INTENSITY_RANK = Object.freeze({
    peog_mild: 1,
    peog_strong: 2,
});

export const PEOG_BYPASS_REASONS = Object.freeze([
    'disabled',
    'rollout_out',
    'low_pb',
    't1_newbie',
    'winback_first_run',
    'manual_remote_force',
    'recovery',
    'near_miss',
    'bottleneck',
    'post_pb_release',
    'late_phase',
    'approach_handoff',
]);
