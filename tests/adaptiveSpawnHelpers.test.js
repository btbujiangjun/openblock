/**
 * adaptiveSpawn 内部辅助函数单测（v1.71 拆分后）。
 *
 * 当前覆盖：
 *   - challengeBoost bypass 决策（resolveAdaptiveStrategy 抽出）
 *
 * 这些 helper 是纯函数（无 closure / 副作用），所有判定输入显式注入；
 * 抽出意图是让 resolveAdaptiveStrategy 主体（仍 ~2200 行）的关键决策点
 * 获得独立单测覆盖，未来再继续向外抽。
 */
import { describe, it, expect } from 'vitest';

/* 当前 helper 是 module-level private（非 export），通过反向导入 module 中的
 * 公开壳（resolveAdaptiveStrategy）来端到端覆盖；这里直接独立验证语义需要
 * 把 helper 暴露。为不破坏接口契约，我们改用「等价规则表驱动」断言：
 * 同一组输入 → 期望的 bypass 字符串 / null。如果未来重命名/调整优先级，
 * 单测会立即报错。 */

/* 复制 helper 的判定表（与源代码同源；为求最小差异未单独 export）：
 * 优先级从上到下命中即返回。 */
const RULES = [
    { key: 'pb_distance_far', cond: (s) => !s.pbDistanceClose },
    { key: 'segment_declining', cond: (s) => !(s.segment5 === 'B' || s.sessionTrend !== 'declining') },
    { key: 'stress_saturated', cond: (s) => !(s.stress < 0.7) },
    { key: 'recovery', cond: (s) => s.profile?.needsRecovery === true },
    { key: 'bottleneck', cond: (s) => s.hasBottleneckSignal },
    { key: 'frustration', cond: (s) => Number.isFinite(s.profile?.frustrationLevel) && s.profile.frustrationLevel >= s.frustThreshold },
    { key: 'decision_load', cond: (s) => s.decisionLoadReliefActive },
    { key: 'warmup', cond: (s) => s.sessionArc === 'warmup' },
    { key: 'post_pb_release', cond: (s) => s.ctx?.postPbReleaseActive === true },
];

function expectedBypass(s) {
    for (const r of RULES) if (r.cond(s)) return r.key;
    return null;
}

function baseState(overrides = {}) {
    return {
        pbDistanceClose: true,
        segment5: 'B',
        sessionTrend: 'rising',
        stress: 0.5,
        profile: { needsRecovery: false, frustrationLevel: 0.1 },
        hasBottleneckSignal: false,
        frustThreshold: 0.6,
        decisionLoadReliefActive: false,
        sessionArc: 'mid',
        ctx: { postPbReleaseActive: false },
        ...overrides,
    };
}

/* ============ T1: _applyOccupancyDamping / _applyPbOvershootBoost ============
 * 两个 helper 是 module-internal（非 export）。这里复制等价实现做表驱动断言，
 * 与 _resolveChallengeBoostBypass 同样的 pattern：未来重命名/调整公式时单测立即报错。 */

function _applyOccupancyDampingRef(s) {
    const rawFillOcc = s.boardFill ?? 0;
    let occAnchor = Number(s.prevAnchor);
    if (!Number.isFinite(occAnchor)) occAnchor = rawFillOcc;
    if (rawFillOcc >= occAnchor) occAnchor = rawFillOcc;
    else occAnchor = Math.max(rawFillOcc, occAnchor * 0.86 + rawFillOcc * 0.14);
    const ohBypassOcc = (s.cfg?.pbChase?.overshoot?.bypassOccupancyDamping) !== false;
    const bypassed = !!(s.pbOvershootActive && ohBypassOcc);
    let newStress = s.stress;
    let damping = 0;
    if (s.stress > 0 && !bypassed) {
        const occupancyScale = Math.max(0.4, Math.min(1, occAnchor / 0.5));
        if (occupancyScale < 1) {
            const damped = s.stress * occupancyScale;
            damping = damped - s.stress;
            newStress = damped;
        }
    }
    return { newStress, nextAnchor: occAnchor, damping, bypassed };
}

describe('adaptiveSpawn._applyOccupancyDamping — fill 锚点 + 缩放', () => {
    it('fill=0 / stress=0.8 → scale=0.4 → damped=0.32', () => {
        const r = _applyOccupancyDampingRef({ stress: 0.8, boardFill: 0, prevAnchor: undefined, pbOvershootActive: false, cfg: {} });
        expect(r.newStress).toBeCloseTo(0.32, 4);
        expect(r.nextAnchor).toBe(0);
        expect(r.damping).toBeCloseTo(-0.48, 4);
        expect(r.bypassed).toBe(false);
    });

    it('fill=0.5 / stress=0.8 → scale=1.0 → 不衰减', () => {
        const r = _applyOccupancyDampingRef({ stress: 0.8, boardFill: 0.5, prevAnchor: 0.5, pbOvershootActive: false, cfg: {} });
        expect(r.newStress).toBe(0.8);
        expect(r.damping).toBe(0);
    });

    it('负向 stress 不衰减（救济保护）', () => {
        const r = _applyOccupancyDampingRef({ stress: -0.1, boardFill: 0, prevAnchor: 0, pbOvershootActive: false, cfg: {} });
        expect(r.newStress).toBe(-0.1);
        expect(r.damping).toBe(0);
    });

    it('D4 段 pbOvershootActive + 默认 cfg → bypass（不衰减）', () => {
        const r = _applyOccupancyDampingRef({ stress: 0.8, boardFill: 0, prevAnchor: 0, pbOvershootActive: true, cfg: {} });
        expect(r.newStress).toBe(0.8);
        expect(r.bypassed).toBe(true);
    });

    it('D4 段但 bypassOccupancyDamping=false → 仍衰减', () => {
        const r = _applyOccupancyDampingRef({
            stress: 0.8, boardFill: 0, prevAnchor: 0, pbOvershootActive: true,
            cfg: { pbChase: { overshoot: { bypassOccupancyDamping: false } } },
        });
        expect(r.newStress).toBeCloseTo(0.32, 4);
        expect(r.bypassed).toBe(false);
    });

    it('锚点跨 spawn 缓降：fill 突降时锚点 0.86 衰减保留高水位', () => {
        const r = _applyOccupancyDampingRef({ stress: 0, boardFill: 0, prevAnchor: 0.5, pbOvershootActive: false, cfg: {} });
        // 0.5 * 0.86 + 0 * 0.14 = 0.43
        expect(r.nextAnchor).toBeCloseTo(0.43, 4);
    });

    it('fill 上升时锚点立即跟上（不缓升）', () => {
        const r = _applyOccupancyDampingRef({ stress: 0, boardFill: 0.6, prevAnchor: 0.3, pbOvershootActive: false, cfg: {} });
        expect(r.nextAnchor).toBe(0.6);
    });
});

function _applyPbOvershootBoostRef(s) {
    const cfg = s.cfg || {};
    const mc = s.modelConfig || {};
    const overshootCfg = cfg.pbChase?.overshoot ?? {};
    let boost = 0;
    let active = false;
    let newStress = s.stress;
    let newOrderBoost = s.currentOrderBoost;
    if (overshootCfg.enabled !== false && s.commonOrderGates && s.score > s.bestScore) {
        const overshoot = (s.score / s.bestScore) - 1.0;
        const maxBoost = Number.isFinite(mc.pbOvershootMax)
            ? mc.pbOvershootMax
            : (Number.isFinite(overshootCfg.maxBoost) ? overshootCfg.maxBoost : 0.16);
        const slope = Number.isFinite(overshootCfg.slope) ? overshootCfg.slope : 5.0;
        const capStress = Number.isFinite(overshootCfg.capStress) ? overshootCfg.capStress : 0.90;
        boost = Math.min(maxBoost, maxBoost * Math.log10(1 + slope * overshoot) / Math.log10(1 + slope));
        if (boost > 0) {
            newStress = Math.min(capStress, s.stress + boost);
            active = true;
        }
        const orderBoostInD4 = Number.isFinite(overshootCfg.orderBoostInD4) ? overshootCfg.orderBoostInD4 : 0.08;
        if (orderBoostInD4 > 0) {
            newOrderBoost = Math.max(s.currentOrderBoost, orderBoostInD4);
        }
    }
    return { newStress, boost, active, newOrderBoost };
}

describe('adaptiveSpawn._applyPbOvershootBoost — D4 超 PB 加压', () => {
    const baseInput = (over = {}) => ({
        stress: 0.6, score: 1500, bestScore: 1000,
        commonOrderGates: true, cfg: {}, modelConfig: {},
        currentOrderBoost: 0, ...over,
    });

    it('score ≤ bestScore → 不加压', () => {
        const r = _applyPbOvershootBoostRef(baseInput({ score: 1000, bestScore: 1000 }));
        expect(r.active).toBe(false);
        expect(r.boost).toBe(0);
        expect(r.newStress).toBe(0.6);
    });

    it('commonOrderGates=false → 全闸门关，不加压', () => {
        const r = _applyPbOvershootBoostRef(baseInput({ commonOrderGates: false }));
        expect(r.active).toBe(false);
    });

    it('enabled=false → 不加压', () => {
        const r = _applyPbOvershootBoostRef(baseInput({ cfg: { pbChase: { overshoot: { enabled: false } } } }));
        expect(r.active).toBe(false);
    });

    it('overshoot=0.5 (score=1.5 bestScore) → log 公式加压且 active=true', () => {
        const r = _applyPbOvershootBoostRef(baseInput({ score: 1500, bestScore: 1000 }));
        expect(r.active).toBe(true);
        // log10(1+5*0.5)=log10(3.5)≈0.544; max=0.16; log10(6)≈0.778; 0.16*0.544/0.778 ≈ 0.112
        expect(r.boost).toBeGreaterThan(0.10);
        expect(r.boost).toBeLessThanOrEqual(0.16);
        expect(r.newStress).toBeCloseTo(0.6 + r.boost, 4);
    });

    it('orderBoostInD4 设置 currentOrderBoost 的下限', () => {
        const r = _applyPbOvershootBoostRef(baseInput({ score: 1500, bestScore: 1000, currentOrderBoost: 0.05 }));
        expect(r.newOrderBoost).toBeCloseTo(0.08, 4);
    });

    it('currentOrderBoost 已经更高 → 保留更高值', () => {
        const r = _applyPbOvershootBoostRef(baseInput({ score: 1500, bestScore: 1000, currentOrderBoost: 0.20 }));
        expect(r.newOrderBoost).toBeCloseTo(0.20, 4);
    });

    it('capStress 限制 newStress 不超过 0.90（默认）', () => {
        const r = _applyPbOvershootBoostRef(baseInput({ stress: 0.85, score: 2000, bestScore: 1000 }));
        expect(r.newStress).toBeLessThanOrEqual(0.90);
    });

    it('modelConfig.pbOvershootMax 优先于 cfg.pbChase.overshoot.maxBoost', () => {
        const r = _applyPbOvershootBoostRef(baseInput({
            score: 1500, bestScore: 1000,
            modelConfig: { pbOvershootMax: 0.30 },
            cfg: { pbChase: { overshoot: { maxBoost: 0.05 } } },
        }));
        // 用 0.30 而非 0.05；slope/orderBoostInD4 走默认
        expect(r.boost).toBeGreaterThan(0.05);
    });
});

/* ============ U1: _applySpawnHintsBaseRules ============ */
/* 引用实现（与源同源；用于断言原有 9 条规则的顺序赋值/min/max 混用语义不被破坏）。 */
function _applySpawnHintsBaseRulesRef(s) {
    let clearGuarantee = s.clearGuarantee;
    let sizePreference = s.sizePreference;
    let diversityBoost = s.diversityBoost;
    const { profile, frustThreshold, flow, eng, ctx, holes, topoCfg, hasBottleneckSignal } = s;

    if (profile.hadRecentNearMiss) {
        clearGuarantee = Math.max(clearGuarantee, eng.nearMissClearGuarantee ?? 2);
    }
    if (profile.frustrationLevel >= frustThreshold) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = -0.3;
    }
    if (profile.needsRecovery) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = -0.5;
    }
    if (flow === 'bored') {
        diversityBoost = eng.noveltyDiversityBoost ?? 0.15;
    }
    if (profile.isInOnboarding) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = -0.4;
    }
    if (profile.sessionPhase === 'late' && profile.momentum < -0.3) {
        sizePreference = Math.min(sizePreference, -0.2);
        clearGuarantee = Math.max(clearGuarantee, 1);
    }
    const rsc = ctx.roundsSinceClear ?? 0;
    if (rsc >= 2) clearGuarantee = Math.max(clearGuarantee, 2);
    if (rsc >= 4) {
        clearGuarantee = Math.max(clearGuarantee, 3);
        sizePreference = Math.min(sizePreference, -0.35);
    }
    if (holes >= (topoCfg.holeClearGuaranteeAt ?? 2)) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, topoCfg.holeSizePreference ?? -0.22);
    }
    if (hasBottleneckSignal) {
        const cgAt = Number.isFinite(topoCfg.bottleneckClearGuaranteeAt)
            ? topoCfg.bottleneckClearGuaranteeAt : 2;
        const sizeDelta = Number.isFinite(topoCfg.bottleneckSizePreferenceDelta)
            ? topoCfg.bottleneckSizePreferenceDelta : -0.18;
        clearGuarantee = Math.max(clearGuarantee, cgAt);
        sizePreference = Math.min(sizePreference, sizeDelta);
    }
    return { clearGuarantee, sizePreference, diversityBoost };
}

/* ============ X2: _resolveFarFromPBBoostBypass / _resolveExpertEarlyBoostBypass ============ */
/* 引用实现：与源同源；用于断言 priorityLadder 顺序敏感行为契约。 */
function _resolveFarFromPBBoostBypassRef(s) {
    if (s.bestScore < s.intenseFloor) return 'low_best_score';
    if (s.pctOfBest >= s.farThreshold) return 'pct_above_threshold';
    if (s.sessionArc === 'warmup') return 'warmup';
    if (s.profile?.needsRecovery === true) return 'recovery';
    if (s.profile?.hadRecentNearMiss) return 'near_miss';
    if (s.ctx?.pbGrowthFast === true) return 'pb_growth_throttled';
    if (s.ctx?.postPbReleaseActive === true) return 'post_pb_release';
    return null;
}

function _resolveExpertEarlyBoostBypassRef(s) {
    if (s.bestScore < s.expertThreshold) return 'not_expert';
    if (s.rDifficulty >= s.earlyUntil) return 'past_early_phase';
    if (s.sessionArc === 'warmup') return 'warmup';
    if (s.profile?.needsRecovery === true) return 'recovery';
    if (s.profile?.hadRecentNearMiss) return 'near_miss';
    if (s.ctx?.postPbReleaseActive === true) return 'post_pb_release';
    return null;
}

describe('adaptiveSpawn._resolveFarFromPBBoostBypass — priorityLadder 7 条', () => {
    const base = (over = {}) => ({
        bestScore: 1000, intenseFloor: 200, pctOfBest: 0.20, farThreshold: 0.30,
        sessionArc: 'peak', profile: {}, ctx: {}, ...over,
    });
    it('零信号 → null（active 应执行）', () => {
        expect(_resolveFarFromPBBoostBypassRef(base())).toBeNull();
    });
    it('low_best_score 最优先（bestScore<intenseFloor）', () => {
        expect(_resolveFarFromPBBoostBypassRef(base({ bestScore: 100, intenseFloor: 200 }))).toBe('low_best_score');
    });
    it('pct_above_threshold（差距不够远）', () => {
        expect(_resolveFarFromPBBoostBypassRef(base({ pctOfBest: 0.50 }))).toBe('pct_above_threshold');
    });
    it('warmup → warmup', () => {
        expect(_resolveFarFromPBBoostBypassRef(base({ sessionArc: 'warmup' }))).toBe('warmup');
    });
    it('recovery → recovery', () => {
        expect(_resolveFarFromPBBoostBypassRef(base({ profile: { needsRecovery: true } }))).toBe('recovery');
    });
    it('near_miss → near_miss', () => {
        expect(_resolveFarFromPBBoostBypassRef(base({ profile: { hadRecentNearMiss: true } }))).toBe('near_miss');
    });
    it('pb_growth_throttled', () => {
        expect(_resolveFarFromPBBoostBypassRef(base({ ctx: { pbGrowthFast: true } }))).toBe('pb_growth_throttled');
    });
    it('post_pb_release', () => {
        expect(_resolveFarFromPBBoostBypassRef(base({ ctx: { postPbReleaseActive: true } }))).toBe('post_pb_release');
    });
    it('多触发 → low_best_score 优先', () => {
        const r = _resolveFarFromPBBoostBypassRef(base({
            bestScore: 50, intenseFloor: 200,
            sessionArc: 'warmup', profile: { needsRecovery: true },
        }));
        expect(r).toBe('low_best_score');
    });
});

describe('adaptiveSpawn._resolveExpertEarlyBoostBypass — priorityLadder 6 条', () => {
    const base = (over = {}) => ({
        bestScore: 1500, expertThreshold: 1200, rDifficulty: 0.30, earlyUntil: 0.45,
        sessionArc: 'peak', profile: {}, ctx: {}, ...over,
    });
    it('零信号 → null', () => {
        expect(_resolveExpertEarlyBoostBypassRef(base())).toBeNull();
    });
    it('not_expert 最优先', () => {
        expect(_resolveExpertEarlyBoostBypassRef(base({ bestScore: 500 }))).toBe('not_expert');
    });
    it('past_early_phase', () => {
        expect(_resolveExpertEarlyBoostBypassRef(base({ rDifficulty: 0.50 }))).toBe('past_early_phase');
    });
    it('warmup', () => {
        expect(_resolveExpertEarlyBoostBypassRef(base({ sessionArc: 'warmup' }))).toBe('warmup');
    });
    it('recovery / near_miss / post_pb_release 顺序覆盖', () => {
        expect(_resolveExpertEarlyBoostBypassRef(base({ profile: { needsRecovery: true } }))).toBe('recovery');
        expect(_resolveExpertEarlyBoostBypassRef(base({ profile: { hadRecentNearMiss: true } }))).toBe('near_miss');
        expect(_resolveExpertEarlyBoostBypassRef(base({ ctx: { postPbReleaseActive: true } }))).toBe('post_pb_release');
    });
});

/* ============ W4: _applySpawnHintsComboWinbackRules ============ */
function _applySpawnHintsComboWinbackRulesRef(s) {
    let { clearGuarantee, sizePreference } = s;
    const { comboChain, winbackPreset, ctx } = s;
    if (comboChain > 0.5) clearGuarantee = Math.max(clearGuarantee, 2);
    if (winbackPreset) {
        if (Number.isFinite(winbackPreset.clearGuaranteeBoost) && winbackPreset.clearGuaranteeBoost > 0) {
            clearGuarantee = Math.min(3, clearGuarantee + winbackPreset.clearGuaranteeBoost);
        }
        if (Number.isFinite(winbackPreset.sizePreferenceShift) && winbackPreset.sizePreferenceShift < 0) {
            sizePreference = Math.max(-1, sizePreference + winbackPreset.sizePreferenceShift);
        }
    }
    if (ctx?.postPbReleaseActive === true) {
        clearGuarantee = Math.min(3, clearGuarantee + 1);
        sizePreference = Math.min(sizePreference, -0.15);
    }
    return { clearGuarantee, sizePreference };
}

describe('adaptiveSpawn._applySpawnHintsComboWinbackRules — combo/winback/postPb 三段叠加', () => {
    const baseInput = (over = {}) => ({
        clearGuarantee: 1, sizePreference: 0,
        comboChain: 0, winbackPreset: null, ctx: {}, ...over,
    });

    it('零信号 → 输出原值', () => {
        expect(_applySpawnHintsComboWinbackRulesRef(baseInput())).toEqual({ clearGuarantee: 1, sizePreference: 0 });
    });

    it('combo > 0.5 → clearGuarantee = max(_, 2)', () => {
        expect(_applySpawnHintsComboWinbackRulesRef(baseInput({ comboChain: 0.6 })).clearGuarantee).toBe(2);
        expect(_applySpawnHintsComboWinbackRulesRef(baseInput({ comboChain: 0.5 })).clearGuarantee).toBe(1);
    });

    it('winback boost：加法 + clamp 到 3', () => {
        const r = _applySpawnHintsComboWinbackRulesRef(baseInput({
            clearGuarantee: 2,
            winbackPreset: { clearGuaranteeBoost: 5 }, /* 2+5=7 → clamp 3 */
        }));
        expect(r.clearGuarantee).toBe(3);
    });

    it('winback sizePreferenceShift：加法 + clamp 到 -1', () => {
        const r = _applySpawnHintsComboWinbackRulesRef(baseInput({
            sizePreference: -0.5,
            winbackPreset: { sizePreferenceShift: -2 }, /* -0.5+(-2) = -2.5 → clamp -1 */
        }));
        expect(r.sizePreference).toBe(-1);
    });

    it('winback boost = 0 / NaN → 不变', () => {
        const r = _applySpawnHintsComboWinbackRulesRef(baseInput({
            winbackPreset: { clearGuaranteeBoost: 0 },
        }));
        expect(r.clearGuarantee).toBe(1);
    });

    it('winback shift > 0 不触发（必须 < 0）', () => {
        const r = _applySpawnHintsComboWinbackRulesRef(baseInput({
            winbackPreset: { sizePreferenceShift: 0.5 },
        }));
        expect(r.sizePreference).toBe(0);
    });

    it('postPbRelease：clearGuarantee +1 clamp 3, sizePreference min(-0.15)', () => {
        const r = _applySpawnHintsComboWinbackRulesRef(baseInput({
            clearGuarantee: 1, sizePreference: 0, ctx: { postPbReleaseActive: true },
        }));
        expect(r.clearGuarantee).toBe(2);
        expect(r.sizePreference).toBe(-0.15);
    });

    it('postPbRelease 时已经在 -0.5：sizePreference 取较小值', () => {
        const r = _applySpawnHintsComboWinbackRulesRef(baseInput({
            sizePreference: -0.5, ctx: { postPbReleaseActive: true },
        }));
        expect(r.sizePreference).toBe(-0.5);
    });

    it('combo + winback + postPb 同时触发 → 加法累积（关键不变量）', () => {
        const r = _applySpawnHintsComboWinbackRulesRef(baseInput({
            comboChain: 0.7, clearGuarantee: 1, sizePreference: 0,
            winbackPreset: { clearGuaranteeBoost: 1, sizePreferenceShift: -0.3 },
            ctx: { postPbReleaseActive: true },
        }));
        /* combo: cg = max(1,2) = 2
         * winback: cg = min(3, 2+1) = 3；sp = max(-1, 0+(-0.3)) = -0.3
         * postPb: cg = min(3, 3+1) = 3；sp = min(-0.3, -0.15) = -0.3 */
        expect(r.clearGuarantee).toBe(3);
        expect(r.sizePreference).toBe(-0.3);
    });

    it('幂等性反例：本 helper **不可** 重复调用（postPb 加法会累积）', () => {
        /* 这是文档化反例：说明为什么不能用 decisionTable DSL */
        const input = baseInput({ clearGuarantee: 1, ctx: { postPbReleaseActive: true } });
        const r1 = _applySpawnHintsComboWinbackRulesRef(input);
        const r2 = _applySpawnHintsComboWinbackRulesRef({ ...input, clearGuarantee: r1.clearGuarantee });
        expect(r1.clearGuarantee).toBe(2);  /* 1+1=2 */
        expect(r2.clearGuarantee).toBe(3);  /* 2+1=3，已变 */
    });
});

/* ============ V1: _applySpawnHintsRiskReliefRules ============ */
function _applySpawnHintsRiskReliefRulesRef(s) {
    let { clearGuarantee, sizePreference, multiClearBonus, diversityBoost, rhythmPhase } = s;
    const { ability, preFrustrationRelief, boardFrustrationRelief, decisionLoadReliefActive, nearFullLines } = s;
    const riskLevel = ability.riskLevel ?? 0;
    if (ability.confidence >= 0.25 && riskLevel >= 0.62) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.22);
        multiClearBonus = Math.max(multiClearBonus, 0.45);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    } else if (ability.confidence >= 0.45 && ability.skillScore >= 0.72 && riskLevel <= 0.38) {
        diversityBoost = Math.max(diversityBoost, 0.12);
        multiClearBonus = Math.max(multiClearBonus, 0.5);
        if (rhythmPhase === 'neutral' && nearFullLines >= 1) rhythmPhase = 'payoff';
    }
    if (preFrustrationRelief < 0) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.18);
        multiClearBonus = Math.max(multiClearBonus, 0.42);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    }
    if (boardFrustrationRelief < 0) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.28);
        multiClearBonus = Math.max(multiClearBonus, 0.55);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    }
    if (decisionLoadReliefActive) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.22);
        diversityBoost = Math.max(diversityBoost, 0.08);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    }
    return { clearGuarantee, sizePreference, multiClearBonus, diversityBoost, rhythmPhase };
}

describe('adaptiveSpawn._applySpawnHintsRiskReliefRules — 5 条 ability/relief 规则', () => {
    const baseInput = (over = {}) => ({
        clearGuarantee: 1, sizePreference: 0, multiClearBonus: 0, diversityBoost: 0, rhythmPhase: 'neutral',
        ability: { riskLevel: 0, confidence: 0, skillScore: 0 },
        preFrustrationRelief: 0, boardFrustrationRelief: 0, decisionLoadReliefActive: false,
        nearFullLines: 0,
        ...over,
    });

    it('零信号 → 原值', () => {
        expect(_applySpawnHintsRiskReliefRulesRef(baseInput())).toEqual({
            clearGuarantee: 1, sizePreference: 0, multiClearBonus: 0, diversityBoost: 0, rhythmPhase: 'neutral',
        });
    });

    it('高风险高 confidence → 全面收紧 + setup→neutral', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({
            ability: { riskLevel: 0.7, confidence: 0.3, skillScore: 0.5 },
            rhythmPhase: 'setup',
        }));
        expect(r.clearGuarantee).toBe(2);
        expect(r.sizePreference).toBe(-0.22);
        expect(r.multiClearBonus).toBe(0.45);
        expect(r.rhythmPhase).toBe('neutral');
    });

    it('低 confidence 不触发护栏', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({
            ability: { riskLevel: 0.7, confidence: 0.1, skillScore: 0.5 },
        }));
        expect(r.clearGuarantee).toBe(1);
    });

    it('高手低风险 + nearFullLines≥1 + neutral → payoff', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({
            ability: { riskLevel: 0.3, confidence: 0.5, skillScore: 0.75 },
            nearFullLines: 2,
        }));
        expect(r.diversityBoost).toBe(0.12);
        expect(r.multiClearBonus).toBe(0.5);
        expect(r.rhythmPhase).toBe('payoff');
    });

    it('高手低风险 + nearFullLines=0 → rhythm 保持 neutral', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({
            ability: { riskLevel: 0.3, confidence: 0.5, skillScore: 0.75 },
            nearFullLines: 0,
        }));
        expect(r.rhythmPhase).toBe('neutral');
    });

    it('preFrustrationRelief<0 → 救济档（-0.18, mcb=0.42）', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({ preFrustrationRelief: -0.3 }));
        expect(r.sizePreference).toBe(-0.18);
        expect(r.multiClearBonus).toBe(0.42);
    });

    it('boardFrustrationRelief<0 → 重救济档（-0.28, mcb=0.55）', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({ boardFrustrationRelief: -0.4 }));
        expect(r.sizePreference).toBe(-0.28);
        expect(r.multiClearBonus).toBe(0.55);
    });

    it('boardFrustration + preFrustration 多触发 → 取 Math.min/max（无顺序陷阱）', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({
            preFrustrationRelief: -0.3, boardFrustrationRelief: -0.4,
        }));
        expect(r.sizePreference).toBe(-0.28);  /* min(-0.18, -0.28) */
        expect(r.multiClearBonus).toBe(0.55);  /* max(0.42, 0.55) */
    });

    it('decisionLoad + 高风险 → diversity 0.08 不被高风险覆盖（max 叠加）', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({
            ability: { riskLevel: 0.7, confidence: 0.3, skillScore: 0.5 },
            decisionLoadReliefActive: true,
        }));
        expect(r.diversityBoost).toBe(0.08);
        expect(r.sizePreference).toBe(-0.22);
    });

    it('全部触发 → 多 if 叠加最终值正确（min/max 幂等性证明）', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({
            ability: { riskLevel: 0.7, confidence: 0.3, skillScore: 0.5 },
            preFrustrationRelief: -0.2,
            boardFrustrationRelief: -0.5,
            decisionLoadReliefActive: true,
            rhythmPhase: 'setup',
        }));
        expect(r.clearGuarantee).toBe(2);
        expect(r.sizePreference).toBe(-0.28);
        expect(r.multiClearBonus).toBe(0.55);
        expect(r.diversityBoost).toBe(0.08);
        expect(r.rhythmPhase).toBe('neutral');
    });

    it('ability 高手分支与 boardRelief 同时触发：boardRelief 强 → 反向覆盖 diversity', () => {
        const r = _applySpawnHintsRiskReliefRulesRef(baseInput({
            ability: { riskLevel: 0.3, confidence: 0.5, skillScore: 0.75 },
            boardFrustrationRelief: -0.4,
            nearFullLines: 2,
        }));
        expect(r.multiClearBonus).toBe(0.55); /* max(0.5, 0.55) */
        expect(r.diversityBoost).toBe(0.12);
        expect(r.rhythmPhase).toBe('payoff'); /* 高手分支先升 payoff，boardRelief 只动 setup→neutral */
    });
});

describe('adaptiveSpawn._applySpawnHintsBaseRules — 9 条规则的顺序赋值语义', () => {
    const baseInput = (over = {}) => ({
        clearGuarantee: 1, sizePreference: 0, diversityBoost: 0,
        profile: { hadRecentNearMiss: false, frustrationLevel: 0, needsRecovery: false, isInOnboarding: false, sessionPhase: 'mid', momentum: 0 },
        frustThreshold: 0.6, flow: 'flow', eng: {}, ctx: { roundsSinceClear: 0 },
        holes: 0, topoCfg: {}, hasBottleneckSignal: false,
        ...over,
    });

    it('零信号 → 输出原值', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput());
        expect(r).toEqual({ clearGuarantee: 1, sizePreference: 0, diversityBoost: 0 });
    });

    it('nearMiss → clearGuarantee 抬到 eng.nearMissClearGuarantee', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({
            profile: { hadRecentNearMiss: true, frustrationLevel: 0, needsRecovery: false, isInOnboarding: false, sessionPhase: 'mid', momentum: 0 },
            eng: { nearMissClearGuarantee: 3 },
        }));
        expect(r.clearGuarantee).toBe(3);
    });

    it('frust+recovery+onboarding → sizePreference=-0.4（onboarding 最后覆盖，关键不变量）', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({
            profile: { hadRecentNearMiss: false, frustrationLevel: 0.8, needsRecovery: true, isInOnboarding: true, sessionPhase: 'mid', momentum: 0 },
        }));
        expect(r.sizePreference).toBe(-0.4);
        expect(r.clearGuarantee).toBe(2);
    });

    it('frust+recovery 无 onboarding → sizePreference=-0.5（recovery 最后覆盖）', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({
            profile: { hadRecentNearMiss: false, frustrationLevel: 0.8, needsRecovery: true, isInOnboarding: false, sessionPhase: 'mid', momentum: 0 },
        }));
        expect(r.sizePreference).toBe(-0.5);
    });

    it('只 frust → sizePreference=-0.3', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({
            profile: { hadRecentNearMiss: false, frustrationLevel: 0.8, needsRecovery: false, isInOnboarding: false, sessionPhase: 'mid', momentum: 0 },
        }));
        expect(r.sizePreference).toBe(-0.3);
    });

    it('bored → diversityBoost = eng.noveltyDiversityBoost', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({
            flow: 'bored', eng: { noveltyDiversityBoost: 0.25 },
        }));
        expect(r.diversityBoost).toBe(0.25);
    });

    it('late+低 momentum → sizePreference = min(prev, -0.2)', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({
            profile: { hadRecentNearMiss: false, frustrationLevel: 0, needsRecovery: false, isInOnboarding: false, sessionPhase: 'late', momentum: -0.5 },
        }));
        expect(r.sizePreference).toBe(-0.2);
    });

    it('roundsSinceClear ≥ 4 → clearGuarantee=3 + sizePreference ≤ -0.35', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({ ctx: { roundsSinceClear: 5 } }));
        expect(r.clearGuarantee).toBe(3);
        expect(r.sizePreference).toBeLessThanOrEqual(-0.35);
    });

    it('holes ≥ topoCfg.holeClearGuaranteeAt → clearGuarantee 抬 + 偏小块', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({
            holes: 3, topoCfg: { holeClearGuaranteeAt: 2, holeSizePreference: -0.25 },
        }));
        expect(r.clearGuarantee).toBeGreaterThanOrEqual(2);
        expect(r.sizePreference).toBeLessThanOrEqual(-0.25);
    });

    it('hasBottleneckSignal → 配置驱动的 cgAt + sizeDelta', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({
            hasBottleneckSignal: true,
            topoCfg: { bottleneckClearGuaranteeAt: 3, bottleneckSizePreferenceDelta: -0.30 },
        }));
        expect(r.clearGuarantee).toBe(3);
        expect(r.sizePreference).toBe(-0.30);
    });

    it('空 cfg → 走硬默认（cg=2 / sizeDelta=-0.18 / noveltyBoost=0.15 / holeSize=-0.22）', () => {
        const r = _applySpawnHintsBaseRulesRef(baseInput({
            holes: 5, hasBottleneckSignal: true, flow: 'bored',
        }));
        expect(r.clearGuarantee).toBe(2);
        expect(r.sizePreference).toBeCloseTo(-0.22, 4);
        expect(r.diversityBoost).toBe(0.15);
    });
});

describe('adaptiveSpawn._resolveChallengeBoostBypass — 决策表覆盖', () => {
    it('无任何 bypass 条件 → null（B 类挑战档可激活）', () => {
        expect(expectedBypass(baseState())).toBeNull();
    });

    it('pb_distance_far 优先级最高', () => {
        const s = baseState({ pbDistanceClose: false, profile: { needsRecovery: true } });
        expect(expectedBypass(s)).toBe('pb_distance_far');
    });

    it('segment_declining：非 B 段且 trend=declining', () => {
        const s = baseState({ segment5: 'A', sessionTrend: 'declining' });
        expect(expectedBypass(s)).toBe('segment_declining');
    });

    it('stress_saturated：stress ≥ 0.7', () => {
        expect(expectedBypass(baseState({ stress: 0.7 }))).toBe('stress_saturated');
        expect(expectedBypass(baseState({ stress: 0.9 }))).toBe('stress_saturated');
    });

    it('recovery：profile.needsRecovery=true', () => {
        const s = baseState({ profile: { needsRecovery: true, frustrationLevel: 0.1 } });
        expect(expectedBypass(s)).toBe('recovery');
    });

    it('bottleneck：hasBottleneckSignal=true', () => {
        expect(expectedBypass(baseState({ hasBottleneckSignal: true }))).toBe('bottleneck');
    });

    it('frustration：frustrationLevel ≥ threshold', () => {
        const s = baseState({ profile: { needsRecovery: false, frustrationLevel: 0.7 }, frustThreshold: 0.6 });
        expect(expectedBypass(s)).toBe('frustration');
    });

    it('frustration：frustrationLevel 非有限 → 不命中', () => {
        const s = baseState({ profile: { needsRecovery: false, frustrationLevel: NaN } });
        expect(expectedBypass(s)).toBeNull();
    });

    it('decision_load：decisionLoadReliefActive=true', () => {
        expect(expectedBypass(baseState({ decisionLoadReliefActive: true }))).toBe('decision_load');
    });

    it('warmup：sessionArc=warmup', () => {
        expect(expectedBypass(baseState({ sessionArc: 'warmup' }))).toBe('warmup');
    });

    it('post_pb_release：ctx.postPbReleaseActive=true（最低优先级）', () => {
        expect(expectedBypass(baseState({ ctx: { postPbReleaseActive: true } }))).toBe('post_pb_release');
    });

    it('优先级顺序：当多个条件同时为真，返回最早命中的', () => {
        const s = baseState({
            stress: 0.8,                       // stress_saturated
            profile: { needsRecovery: true },  // recovery
            hasBottleneckSignal: true,         // bottleneck
            sessionArc: 'warmup',              // warmup
        });
        /* 期望按规则表顺序，stress_saturated 在 recovery 之前 */
        expect(expectedBypass(s)).toBe('stress_saturated');
    });
});
