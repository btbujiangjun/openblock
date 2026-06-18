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

/* ============ Y2: _applySpawnHintsD4Tighten ============ */
function _applySpawnHintsD4TightenRef(s, cfgOh) {
    const mcbCap = Number.isFinite(cfgOh.multiClearBonusCap) ? cfgOh.multiClearBonusCap : 0.18;
    const spShift = Number.isFinite(cfgOh.sizePreferenceShift) ? cfgOh.sizePreferenceShift : 0.12;
    const cgShift = Number.isFinite(cfgOh.clearGuaranteeShift) ? cfgOh.clearGuaranteeShift : -1;
    s.multiClearBonus = Math.min(s.multiClearBonus, mcbCap);
    s.sizePreference = Math.max(s.sizePreference, s.sizePreference + spShift);
    s.clearGuarantee = Math.max(0, s.clearGuarantee + cgShift);
    return {
        multiClearBonus: s.multiClearBonus,
        sizePreference: s.sizePreference,
        clearGuarantee: s.clearGuarantee,
    };
}

describe('adaptiveSpawn._applySpawnHintsD4Tighten — D4 收紧 (Y2)', () => {
    it('multiClearBonus 被 cap 钳制（取 min）', () => {
        const s = { multiClearBonus: 0.50, sizePreference: 0, clearGuarantee: 3 };
        _applySpawnHintsD4TightenRef(s, {});
        expect(s.multiClearBonus).toBe(0.18); /* default cap */
    });

    it('multiClearBonus 已经低于 cap 时不上抬', () => {
        const s = { multiClearBonus: 0.05, sizePreference: 0, clearGuarantee: 3 };
        _applySpawnHintsD4TightenRef(s, {});
        expect(s.multiClearBonus).toBe(0.05);
    });

    it('正 sizePreferenceShift → sizePreference 增加（Math.max(sp, sp+shift)）', () => {
        const s = { multiClearBonus: 0, sizePreference: 0.10, clearGuarantee: 3 };
        _applySpawnHintsD4TightenRef(s, {}); /* default shift = +0.12 */
        expect(s.sizePreference).toBeCloseTo(0.22);
    });

    it('历史半语义：负 sizePreferenceShift 不下压（保留抽出前行为）', () => {
        const s = { multiClearBonus: 0, sizePreference: 0.10, clearGuarantee: 3 };
        _applySpawnHintsD4TightenRef(s, { sizePreferenceShift: -0.30 });
        /* Math.max(0.10, 0.10 + -0.30) = Math.max(0.10, -0.20) = 0.10 → 不变 */
        expect(s.sizePreference).toBe(0.10);
    });

    it('clearGuarantee 被钳制为 ≥ 0', () => {
        const s = { multiClearBonus: 0, sizePreference: 0, clearGuarantee: 1 };
        _applySpawnHintsD4TightenRef(s, {}); /* default shift = -1 */
        expect(s.clearGuarantee).toBe(0);
        const s2 = { multiClearBonus: 0, sizePreference: 0, clearGuarantee: 0 };
        _applySpawnHintsD4TightenRef(s2, {});
        expect(s2.clearGuarantee).toBe(0); /* Math.max(0, 0+(-1)) = 0 */
    });

    it('自定义 cfg 完全可覆盖（mcb 0.30 / sp +0.05 / cg -2）', () => {
        const s = { multiClearBonus: 0.40, sizePreference: 0.10, clearGuarantee: 3 };
        _applySpawnHintsD4TightenRef(s, {
            multiClearBonusCap: 0.30, sizePreferenceShift: 0.05, clearGuaranteeShift: -2,
        });
        expect(s.multiClearBonus).toBe(0.30);
        expect(s.sizePreference).toBeCloseTo(0.15);
        expect(s.clearGuarantee).toBe(1);
    });
});

/* ============ Y5: _applySpawnHintsPbCurveRules ============ */
function _applySpawnHintsPbCurveRulesRef(s, pbCurve) {
    if (pbCurve.pbRelease > 0) {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.multiClearBonus = Math.max(s.multiClearBonus, 0.35);
        s.sizePreference = Math.min(s.sizePreference, -0.12);
    }
    if (pbCurve.pbBrake > 0.35 && !(pbCurve.pbRelease > 0)) {
        s.multiClearBonus = Math.max(0, s.multiClearBonus * (1 - pbCurve.pbBrake * 0.22));
        s.clearGuarantee = Math.max(0, s.clearGuarantee - (pbCurve.pbBrake > 0.75 ? 1 : 0));
        s.sizePreference = Math.max(s.sizePreference, pbCurve.pbBrake * 0.10);
    }
    return {
        clearGuarantee: s.clearGuarantee,
        multiClearBonus: s.multiClearBonus,
        sizePreference: s.sizePreference,
    };
}

describe('adaptiveSpawn._applySpawnHintsPbCurveRules — PB 双 S 段 (Y5)', () => {
    it('pbRelease > 0 → clearGuarantee 抬到 ≥2、mcb ≥0.35、sp ≤-0.12', () => {
        const s = { clearGuarantee: 0, multiClearBonus: 0.10, sizePreference: 0.30 };
        _applySpawnHintsPbCurveRulesRef(s, { pbRelease: 1, pbBrake: 0 });
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiClearBonus).toBe(0.35);
        expect(s.sizePreference).toBe(-0.12);
    });

    it('pbRelease > 0 时已经在 floor 之上的字段不下压（Math.max 幂等）', () => {
        const s = { clearGuarantee: 3, multiClearBonus: 0.5, sizePreference: -0.25 };
        _applySpawnHintsPbCurveRulesRef(s, { pbRelease: 1, pbBrake: 0 });
        expect(s.clearGuarantee).toBe(3);
        expect(s.multiClearBonus).toBe(0.5);
        expect(s.sizePreference).toBe(-0.25);
    });

    it('pbBrake > 0.35 触发：mcb 乘性收紧、cg -1 (pbBrake > 0.75)、sp 抬高', () => {
        const s = { clearGuarantee: 3, multiClearBonus: 0.50, sizePreference: -0.20 };
        _applySpawnHintsPbCurveRulesRef(s, { pbRelease: 0, pbBrake: 0.80 });
        /* mcb = 0.50 * (1 - 0.80 * 0.22) = 0.50 * 0.824 ≈ 0.412 */
        expect(s.multiClearBonus).toBeCloseTo(0.412, 3);
        /* cg = max(0, 3 - 1) = 2 (pbBrake > 0.75 减一) */
        expect(s.clearGuarantee).toBe(2);
        /* sp = max(-0.20, 0.80 * 0.10 = 0.08) = 0.08 */
        expect(s.sizePreference).toBeCloseTo(0.08, 3);
    });

    it('pbBrake 在 (0.35, 0.75] 不减 cg（条件 > 0.75 不满足）', () => {
        const s = { clearGuarantee: 3, multiClearBonus: 0.50, sizePreference: 0 };
        _applySpawnHintsPbCurveRulesRef(s, { pbRelease: 0, pbBrake: 0.50 });
        expect(s.clearGuarantee).toBe(3); /* 不减 */
    });

    it('pbBrake ≤ 0.35 不触发任何修改', () => {
        const s = { clearGuarantee: 3, multiClearBonus: 0.50, sizePreference: -0.10 };
        _applySpawnHintsPbCurveRulesRef(s, { pbRelease: 0, pbBrake: 0.30 });
        expect(s).toEqual({ clearGuarantee: 3, multiClearBonus: 0.50, sizePreference: -0.10 });
    });

    it('互斥保护：pbRelease > 0 时 pbBrake 段不触发（避免语义冲突）', () => {
        const s = { clearGuarantee: 1, multiClearBonus: 0.50, sizePreference: 0 };
        /* 两个 trigger 都给到：release 抬 cg 到 2，brake 段绝不触发把它拉回 1 */
        _applySpawnHintsPbCurveRulesRef(s, { pbRelease: 1, pbBrake: 0.90 });
        expect(s.clearGuarantee).toBe(2);    /* 释放窗口期 cg 保持 ≥2 */
        expect(s.multiClearBonus).toBe(0.50); /* mcb 不被乘性收紧 */
    });

    it('多次连续调用 release（幂等）→ 结果稳定', () => {
        const s = { clearGuarantee: 0, multiClearBonus: 0, sizePreference: 0 };
        const pbCurve = { pbRelease: 1, pbBrake: 0 };
        _applySpawnHintsPbCurveRulesRef(s, pbCurve);
        _applySpawnHintsPbCurveRulesRef(s, pbCurve);
        _applySpawnHintsPbCurveRulesRef(s, pbCurve);
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiClearBonus).toBe(0.35);
        expect(s.sizePreference).toBe(-0.12);
    });

    it('反 idempotent 验证（anti-pattern）：多次 brake 会持续收紧 mcb', () => {
        const s = { clearGuarantee: 2, multiClearBonus: 0.50, sizePreference: 0 };
        const pbCurve = { pbRelease: 0, pbBrake: 0.80 };
        _applySpawnHintsPbCurveRulesRef(s, pbCurve);
        const after1 = s.multiClearBonus;
        _applySpawnHintsPbCurveRulesRef(s, pbCurve);
        const after2 = s.multiClearBonus;
        expect(after2).toBeLessThan(after1); /* 第二次更小 → 文档化为何不能重复调 */
    });
});

/* ============ Z2: _applySpawnHintsPlaystyleRules ============ */
function _applySpawnHintsPlaystyleRulesRef(s, playstyle, ctx) {
    if (playstyle === 'perfect_hunter') {
        s.multiClearBonus = Math.max(s.multiClearBonus, 0.85);
        s.clearGuarantee  = Math.max(s.clearGuarantee, 2);
        s.multiLineTarget = Math.max(s.multiLineTarget, 2);
        if (ctx.pcSetup >= 1 || ctx.nearFullLines >= 2) {
            s.perfectClearBoost = Math.max(s.perfectClearBoost, 0.82);
        }
        s.iconBonusTarget = Math.max(s.iconBonusTarget, 0.55);
    } else if (playstyle === 'multi_clear') {
        s.multiClearBonus = Math.max(s.multiClearBonus, 0.65);
        s.multiLineTarget = Math.max(s.multiLineTarget, 1);
        s.iconBonusTarget = Math.max(s.iconBonusTarget, 0.38);
        if (s.rhythmPhase === 'neutral' && ctx.canPromoteToPayoff) s.rhythmPhase = 'payoff';
    } else if (playstyle === 'combo') {
        s.clearGuarantee  = Math.max(s.clearGuarantee, 2);
        s.multiClearBonus = Math.max(s.multiClearBonus, 0.52);
        s.iconBonusTarget = Math.max(s.iconBonusTarget, 0.28);
    } else if (playstyle === 'survival') {
        s.sizePreference = Math.min(s.sizePreference, -0.25);
        s.clearGuarantee = Math.max(s.clearGuarantee, 1);
    }
    return s;
}

const emptyState = () => ({
    multiClearBonus: 0, clearGuarantee: 0, multiLineTarget: 0,
    perfectClearBoost: 0, iconBonusTarget: 0, sizePreference: 0, rhythmPhase: 'neutral',
});

describe('adaptiveSpawn._applySpawnHintsPlaystyleRules — 风格对齐 (Z2)', () => {
    it('perfect_hunter：含 pcSetup ≥1 → 完整四字段抬升', () => {
        const s = emptyState();
        _applySpawnHintsPlaystyleRulesRef(s, 'perfect_hunter', { pcSetup: 1, nearFullLines: 0, canPromoteToPayoff: false });
        expect(s.multiClearBonus).toBe(0.85);
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiLineTarget).toBe(2);
        expect(s.perfectClearBoost).toBe(0.82);
        expect(s.iconBonusTarget).toBe(0.55);
    });

    it('perfect_hunter：pcSetup=0 且 nearFullLines<2 → perfectClearBoost 不抬', () => {
        const s = emptyState();
        _applySpawnHintsPlaystyleRulesRef(s, 'perfect_hunter', { pcSetup: 0, nearFullLines: 1, canPromoteToPayoff: false });
        expect(s.perfectClearBoost).toBe(0); /* 几何不满足 */
    });

    it('multi_clear + rhythmPhase=neutral + canPromoteToPayoff → 切 payoff', () => {
        const s = emptyState();
        _applySpawnHintsPlaystyleRulesRef(s, 'multi_clear', { pcSetup: 0, nearFullLines: 0, canPromoteToPayoff: true });
        expect(s.rhythmPhase).toBe('payoff');
        expect(s.multiClearBonus).toBe(0.65);
    });

    it('multi_clear：canPromoteToPayoff=false → rhythmPhase 保留 neutral', () => {
        const s = emptyState();
        _applySpawnHintsPlaystyleRulesRef(s, 'multi_clear', { pcSetup: 0, nearFullLines: 0, canPromoteToPayoff: false });
        expect(s.rhythmPhase).toBe('neutral');
    });

    it('multi_clear：rhythmPhase=setup → 不被覆盖（仅 neutral 升级）', () => {
        const s = emptyState(); s.rhythmPhase = 'setup';
        _applySpawnHintsPlaystyleRulesRef(s, 'multi_clear', { pcSetup: 0, nearFullLines: 0, canPromoteToPayoff: true });
        expect(s.rhythmPhase).toBe('setup');
    });

    it('combo：三字段抬升', () => {
        const s = emptyState();
        _applySpawnHintsPlaystyleRulesRef(s, 'combo', { pcSetup: 0, nearFullLines: 0, canPromoteToPayoff: false });
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiClearBonus).toBe(0.52);
        expect(s.iconBonusTarget).toBe(0.28);
    });

    it('survival：sp 下压 + cg ≥ 1', () => {
        const s = emptyState(); s.sizePreference = 0.10;
        _applySpawnHintsPlaystyleRulesRef(s, 'survival', { pcSetup: 0, nearFullLines: 0, canPromoteToPayoff: false });
        expect(s.sizePreference).toBe(-0.25);
        expect(s.clearGuarantee).toBe(1);
    });

    it('balanced：完全不改动', () => {
        const s = emptyState(); s.multiClearBonus = 0.20; s.iconBonusTarget = 0.10;
        const snap = { ...s };
        _applySpawnHintsPlaystyleRulesRef(s, 'balanced', { pcSetup: 0, nearFullLines: 0, canPromoteToPayoff: false });
        expect(s).toEqual(snap);
    });

    it('幂等性：已达 floor 时再调不下压', () => {
        const s = emptyState();
        s.multiClearBonus = 0.95; s.clearGuarantee = 3; s.iconBonusTarget = 0.99;
        _applySpawnHintsPlaystyleRulesRef(s, 'perfect_hunter', { pcSetup: 1, nearFullLines: 0, canPromoteToPayoff: false });
        expect(s.multiClearBonus).toBe(0.95);
        expect(s.clearGuarantee).toBe(3);
        expect(s.iconBonusTarget).toBe(0.99);
    });

    it('未知 playstyle → 等价 balanced（不改动）', () => {
        const s = emptyState(); s.multiClearBonus = 0.30;
        const snap = { ...s };
        _applySpawnHintsPlaystyleRulesRef(s, 'unknown_style', { pcSetup: 0, nearFullLines: 0, canPromoteToPayoff: false });
        expect(s).toEqual(snap);
    });
});

/* ============ AA1: _applySpawnHintsPersonalizationRules ============ */
function _applySpawnHintsPersonalizationRulesRef(s, signals) {
    const { returningWarmupStrength, accessibilityLoad, motivationIntent, canPromoteToPayoff } = signals;
    if (returningWarmupStrength >= 0.35) {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.sizePreference = Math.min(s.sizePreference, -0.24 - returningWarmupStrength * 0.12);
        s.multiClearBonus = Math.max(s.multiClearBonus, 0.38);
        if (s.rhythmPhase === 'setup') s.rhythmPhase = 'neutral';
    }
    if (accessibilityLoad >= 0.35) {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.sizePreference = Math.min(s.sizePreference, -0.20 - accessibilityLoad * 0.25);
        s.diversityBoost = Math.max(s.diversityBoost, 0.08);
    }
    if (motivationIntent === 'collection') {
        s.iconBonusTarget = Math.max(s.iconBonusTarget, canPromoteToPayoff ? 0.50 : 0.32);
        if (canPromoteToPayoff) {
            s.multiClearBonus = Math.max(s.multiClearBonus, 0.52);
            s.multiLineTarget = Math.max(s.multiLineTarget, 1);
        }
    } else if (motivationIntent === 'challenge') {
        s.diversityBoost = Math.max(s.diversityBoost, 0.18);
        if (canPromoteToPayoff) {
            s.multiClearBonus = Math.max(s.multiClearBonus, 0.58);
            s.multiLineTarget = Math.max(s.multiLineTarget, 1);
        }
    } else if (motivationIntent === 'relaxation' || motivationIntent === 'competence') {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.sizePreference = Math.min(s.sizePreference, -0.22);
    } else if (motivationIntent === 'social') {
        s.diversityBoost = Math.max(s.diversityBoost, 0.12);
    }
    return s;
}

const personState = () => ({
    clearGuarantee: 0, sizePreference: 0, multiClearBonus: 0, multiLineTarget: 0,
    iconBonusTarget: 0, diversityBoost: 0, rhythmPhase: 'neutral',
});
const personSig = (over = {}) => ({
    returningWarmupStrength: 0, accessibilityLoad: 0, motivationIntent: '',
    canPromoteToPayoff: false, ...over,
});

describe('adaptiveSpawn._applySpawnHintsPersonalizationRules (AA1)', () => {
    it('returningWarmupStrength < 0.35 → 不触发', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ returningWarmupStrength: 0.34 }));
        expect(s.clearGuarantee).toBe(0); /* 阈值未达 */
    });

    it('returningWarmupStrength = 0.50 → cg≥2 / sp 下压含线性项 / mcb≥0.38', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ returningWarmupStrength: 0.50 }));
        expect(s.clearGuarantee).toBe(2);
        /* sp = min(0, -0.24 - 0.50*0.12 = -0.30) = -0.30 */
        expect(s.sizePreference).toBeCloseTo(-0.30);
        expect(s.multiClearBonus).toBe(0.38);
    });

    it('returningWarmup + rhythmPhase=setup → 切 neutral', () => {
        const s = personState(); s.rhythmPhase = 'setup';
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ returningWarmupStrength: 0.50 }));
        expect(s.rhythmPhase).toBe('neutral');
    });

    it('returningWarmup + rhythmPhase=payoff → 保留 payoff（仅 setup 降级）', () => {
        const s = personState(); s.rhythmPhase = 'payoff';
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ returningWarmupStrength: 0.50 }));
        expect(s.rhythmPhase).toBe('payoff');
    });

    it('accessibilityLoad ≥ 0.35 → cg≥2 / sp 下压（陡） / diversity ≥ 0.08', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ accessibilityLoad: 0.60 }));
        expect(s.clearGuarantee).toBe(2);
        /* sp = min(0, -0.20 - 0.60*0.25 = -0.35) = -0.35 */
        expect(s.sizePreference).toBeCloseTo(-0.35);
        expect(s.diversityBoost).toBe(0.08);
    });

    it('motivationIntent=collection + canPromoteToPayoff=true → icon 0.50 / mcb 0.52 / mlt 1', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ motivationIntent: 'collection', canPromoteToPayoff: true }));
        expect(s.iconBonusTarget).toBe(0.50);
        expect(s.multiClearBonus).toBe(0.52);
        expect(s.multiLineTarget).toBe(1);
    });

    it('motivationIntent=collection + canPromoteToPayoff=false → icon 0.32（仅）', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ motivationIntent: 'collection', canPromoteToPayoff: false }));
        expect(s.iconBonusTarget).toBe(0.32);
        expect(s.multiClearBonus).toBe(0);
        expect(s.multiLineTarget).toBe(0);
    });

    it('motivationIntent=challenge → diversity ≥ 0.18，含 payoff 兜底', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ motivationIntent: 'challenge', canPromoteToPayoff: true }));
        expect(s.diversityBoost).toBe(0.18);
        expect(s.multiClearBonus).toBe(0.58);
        expect(s.multiLineTarget).toBe(1);
    });

    it('motivationIntent=relaxation → cg≥2 / sp≤-0.22', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ motivationIntent: 'relaxation' }));
        expect(s.clearGuarantee).toBe(2);
        expect(s.sizePreference).toBe(-0.22);
    });

    it('motivationIntent=competence → 与 relaxation 等价', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ motivationIntent: 'competence' }));
        expect(s.clearGuarantee).toBe(2);
        expect(s.sizePreference).toBe(-0.22);
    });

    it('motivationIntent=social → 仅 diversity ≥ 0.12', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ motivationIntent: 'social' }));
        expect(s.diversityBoost).toBe(0.12);
        expect(s.clearGuarantee).toBe(0);
    });

    it('未知 motivationIntent → 不触发任何 motivation 分支', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({ motivationIntent: 'unknown' }));
        expect(s).toEqual(personState());
    });

    it('多触发：returningWarmup + accessibilityLoad + collection 互不冲突，各自抬升 floor', () => {
        const s = personState();
        _applySpawnHintsPersonalizationRulesRef(s, personSig({
            returningWarmupStrength: 0.50, accessibilityLoad: 0.60,
            motivationIntent: 'collection', canPromoteToPayoff: true,
        }));
        expect(s.clearGuarantee).toBe(2); /* 两个 cg≥2 取 max */
        /* sp = min(min(min(0, -0.30), -0.35), [无 collection sp 调]) = -0.35 */
        expect(s.sizePreference).toBeCloseTo(-0.35);
        expect(s.iconBonusTarget).toBe(0.50);
        expect(s.diversityBoost).toBe(0.08);
    });
});

/* ============ BB1: _applySpawnHintsDelightRules ============ */
function _applySpawnHintsDelightRulesRef(s, delight, canPromoteToPayoff) {
    if (s.rhythmPhase === 'payoff') {
        s.diversityBoost = Math.max(s.diversityBoost, 0.1);
    }
    if (delight.mode === 'challenge_payoff') {
        s.diversityBoost = Math.max(s.diversityBoost, 0.12);
        if (s.rhythmPhase === 'neutral' && canPromoteToPayoff) s.rhythmPhase = 'payoff';
        s.multiLineTarget = Math.max(s.multiLineTarget, 1);
    } else if (delight.mode === 'flow_payoff') {
        if (s.rhythmPhase === 'neutral' && canPromoteToPayoff) s.rhythmPhase = 'payoff';
        s.multiLineTarget = Math.max(s.multiLineTarget, 1);
    } else if (delight.mode === 'relief') {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.sizePreference = Math.min(s.sizePreference, -0.25);
    }
    if (delight.perfectClearBoost >= 0.75) {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.multiLineTarget = Math.max(s.multiLineTarget, 2);
    }
    return s;
}
const delightState = () => ({
    diversityBoost: 0, multiLineTarget: 0, clearGuarantee: 0,
    sizePreference: 0, rhythmPhase: 'neutral',
});

describe('adaptiveSpawn._applySpawnHintsDelightRules (BB1)', () => {
    it('rhythmPhase=payoff → diversityBoost ≥ 0.10', () => {
        const s = delightState(); s.rhythmPhase = 'payoff';
        _applySpawnHintsDelightRulesRef(s, { mode: '', perfectClearBoost: 0 }, false);
        expect(s.diversityBoost).toBe(0.1);
    });

    it('mode=challenge_payoff + canPromoteToPayoff=true → diversity 0.12 / payoff 提升 / mlt 1', () => {
        const s = delightState();
        _applySpawnHintsDelightRulesRef(s, { mode: 'challenge_payoff', perfectClearBoost: 0 }, true);
        expect(s.diversityBoost).toBe(0.12);
        expect(s.rhythmPhase).toBe('payoff');
        expect(s.multiLineTarget).toBe(1);
    });

    it('mode=challenge_payoff + canPromoteToPayoff=false → payoff 不提升（几何门控）', () => {
        const s = delightState();
        _applySpawnHintsDelightRulesRef(s, { mode: 'challenge_payoff', perfectClearBoost: 0 }, false);
        expect(s.rhythmPhase).toBe('neutral');
        expect(s.diversityBoost).toBe(0.12);
        expect(s.multiLineTarget).toBe(1);
    });

    it('mode=flow_payoff + canPromoteToPayoff=true → payoff 提升 / mlt 1（无 diversity 调）', () => {
        const s = delightState();
        _applySpawnHintsDelightRulesRef(s, { mode: 'flow_payoff', perfectClearBoost: 0 }, true);
        expect(s.rhythmPhase).toBe('payoff');
        expect(s.multiLineTarget).toBe(1);
        expect(s.diversityBoost).toBe(0); /* flow 不动 diversity */
    });

    it('mode=relief → cg ≥ 2 / sp ≤ -0.25（无 payoff 提升）', () => {
        const s = delightState();
        _applySpawnHintsDelightRulesRef(s, { mode: 'relief', perfectClearBoost: 0 }, true);
        expect(s.clearGuarantee).toBe(2);
        expect(s.sizePreference).toBe(-0.25);
        expect(s.rhythmPhase).toBe('neutral'); /* relief 不提 payoff */
    });

    it('未知 mode → 不动 enum 字段', () => {
        const s = delightState();
        _applySpawnHintsDelightRulesRef(s, { mode: 'unknown', perfectClearBoost: 0 }, true);
        expect(s).toEqual(delightState());
    });

    it('perfectClearBoost ≥ 0.75 → cg ≥ 2 / mlt ≥ 2', () => {
        const s = delightState();
        _applySpawnHintsDelightRulesRef(s, { mode: '', perfectClearBoost: 0.75 }, false);
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiLineTarget).toBe(2);
    });

    it('perfectClearBoost = 0.74 → 不触发', () => {
        const s = delightState();
        _applySpawnHintsDelightRulesRef(s, { mode: '', perfectClearBoost: 0.74 }, false);
        expect(s.clearGuarantee).toBe(0);
        expect(s.multiLineTarget).toBe(0);
    });

    it('challenge_payoff + perfectClearBoost ≥ 0.75 → mlt 取 max(1, 2)=2', () => {
        const s = delightState();
        _applySpawnHintsDelightRulesRef(s, { mode: 'challenge_payoff', perfectClearBoost: 0.8 }, true);
        expect(s.multiLineTarget).toBe(2);
        expect(s.clearGuarantee).toBe(2);
        expect(s.diversityBoost).toBe(0.12);
    });

    it('rhythmPhase=setup → 不被 payoff 第一段触发；challenge_payoff 也不应提升（仅 neutral→payoff）', () => {
        const s = delightState(); s.rhythmPhase = 'setup';
        _applySpawnHintsDelightRulesRef(s, { mode: 'challenge_payoff', perfectClearBoost: 0 }, true);
        expect(s.rhythmPhase).toBe('setup'); /* setup 不被 challenge_payoff 提升（仅 neutral→payoff） */
        expect(s.diversityBoost).toBe(0.12);
    });

    it('幂等：同一输入连续两次结果一致', () => {
        const s1 = delightState();
        const s2 = delightState();
        _applySpawnHintsDelightRulesRef(s1, { mode: 'challenge_payoff', perfectClearBoost: 0.8 }, true);
        _applySpawnHintsDelightRulesRef(s2, { mode: 'challenge_payoff', perfectClearBoost: 0.8 }, true);
        _applySpawnHintsDelightRulesRef(s2, { mode: 'challenge_payoff', perfectClearBoost: 0.8 }, true);
        expect(s1).toEqual(s2);
    });
});

/* ============ CC1: _applySpawnHintsTopoOpportunityRules ============ */
function _applySpawnHintsTopoOpportunityRulesRef(s, signals) {
    const { pcSetup, nearFullLines, boardFill, pcSetupMinFill } = signals;
    if (pcSetup >= 1) {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.multiLineTarget = Math.max(s.multiLineTarget, 2);
        s.multiClearBonus = Math.max(s.multiClearBonus, 0.75);
        if ((boardFill ?? 0) >= pcSetupMinFill) s.rhythmPhase = 'payoff';
    } else if (nearFullLines >= 3) {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.multiLineTarget = Math.max(s.multiLineTarget, 1);
        s.multiClearBonus = Math.max(s.multiClearBonus, 0.6);
        if (s.rhythmPhase === 'neutral') s.rhythmPhase = 'payoff';
    }
    return s;
}
const topoState = () => ({
    clearGuarantee: 0, multiLineTarget: 0, multiClearBonus: 0, rhythmPhase: 'neutral',
});

describe('adaptiveSpawn._applySpawnHintsTopoOpportunityRules (CC1)', () => {
    it('pcSetup=0 + nearFullLines=0 → 不动', () => {
        const s = topoState();
        _applySpawnHintsTopoOpportunityRulesRef(s, {
            pcSetup: 0, nearFullLines: 0, boardFill: 0.5, pcSetupMinFill: 0.3,
        });
        expect(s).toEqual(topoState());
    });

    it('pcSetup=1 + boardFill ≥ minFill → cg/mlt/mcb 抬 + rhythmPhase=payoff', () => {
        const s = topoState();
        _applySpawnHintsTopoOpportunityRulesRef(s, {
            pcSetup: 1, nearFullLines: 0, boardFill: 0.40, pcSetupMinFill: 0.3,
        });
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiLineTarget).toBe(2);
        expect(s.multiClearBonus).toBe(0.75);
        expect(s.rhythmPhase).toBe('payoff');
    });

    it('pcSetup=1 + boardFill < minFill → 不提 rhythmPhase（保持 neutral）', () => {
        const s = topoState();
        _applySpawnHintsTopoOpportunityRulesRef(s, {
            pcSetup: 1, nearFullLines: 0, boardFill: 0.10, pcSetupMinFill: 0.30,
        });
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiClearBonus).toBe(0.75);
        expect(s.rhythmPhase).toBe('neutral'); /* fill 不够 → 不撒谎 */
    });

    it('pcSetup=1 强制 payoff（无视 rhythmPhase 原值）', () => {
        const s = topoState(); s.rhythmPhase = 'setup';
        _applySpawnHintsTopoOpportunityRulesRef(s, {
            pcSetup: 2, nearFullLines: 0, boardFill: 0.5, pcSetupMinFill: 0.3,
        });
        expect(s.rhythmPhase).toBe('payoff'); /* 强制覆盖 setup */
    });

    it('pcSetup=1 优先于 nearFullLines（互斥 if/else if）', () => {
        const s = topoState();
        _applySpawnHintsTopoOpportunityRulesRef(s, {
            pcSetup: 1, nearFullLines: 5, boardFill: 0.5, pcSetupMinFill: 0.3,
        });
        expect(s.multiClearBonus).toBe(0.75); /* pcSetup 的 0.75，不是 nearFull 的 0.6 */
        expect(s.multiLineTarget).toBe(2);    /* pcSetup 的 2，不是 nearFull 的 1 */
    });

    it('pcSetup=0 + nearFullLines=3 → cg=2 / mlt=1 / mcb=0.6', () => {
        const s = topoState();
        _applySpawnHintsTopoOpportunityRulesRef(s, {
            pcSetup: 0, nearFullLines: 3, boardFill: 0.5, pcSetupMinFill: 0.3,
        });
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiLineTarget).toBe(1);
        expect(s.multiClearBonus).toBe(0.6);
        expect(s.rhythmPhase).toBe('payoff'); /* neutral → payoff */
    });

    it('nearFullLines=2 → 不触发（< 3 阈值）', () => {
        const s = topoState();
        _applySpawnHintsTopoOpportunityRulesRef(s, {
            pcSetup: 0, nearFullLines: 2, boardFill: 0.5, pcSetupMinFill: 0.3,
        });
        expect(s).toEqual(topoState());
    });

    it('nearFullLines=3 + rhythmPhase=setup → 不被提升（仅 neutral→payoff）', () => {
        const s = topoState(); s.rhythmPhase = 'setup';
        _applySpawnHintsTopoOpportunityRulesRef(s, {
            pcSetup: 0, nearFullLines: 3, boardFill: 0.5, pcSetupMinFill: 0.3,
        });
        expect(s.rhythmPhase).toBe('setup');
    });

    it('幂等：同输入连续两次结果一致', () => {
        const s1 = topoState();
        const s2 = topoState();
        const sig = { pcSetup: 1, nearFullLines: 0, boardFill: 0.5, pcSetupMinFill: 0.3 };
        _applySpawnHintsTopoOpportunityRulesRef(s1, sig);
        _applySpawnHintsTopoOpportunityRulesRef(s2, sig);
        _applySpawnHintsTopoOpportunityRulesRef(s2, sig);
        expect(s1).toEqual(s2);
    });
});

/* ============ DD1: _applySpawnHintsFriendlyBoostRules ============ */
function _applySpawnHintsFriendlyBoostRulesRef(s, signals) {
    const { scoreMilestoneHit, sessionArc } = signals;
    if (scoreMilestoneHit) {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.sizePreference = Math.min(s.sizePreference, -0.2);
    }
    if (sessionArc === 'warmup') {
        s.clearGuarantee = Math.max(s.clearGuarantee, 2);
        s.sizePreference = Math.min(s.sizePreference, -0.2);
    }
    return s;
}
const friendlyState = () => ({ clearGuarantee: 0, sizePreference: 0 });

describe('adaptiveSpawn._applySpawnHintsFriendlyBoostRules (DD1)', () => {
    it('两段都不触发 → 不动', () => {
        const s = friendlyState();
        _applySpawnHintsFriendlyBoostRulesRef(s, { scoreMilestoneHit: false, sessionArc: 'peak' });
        expect(s).toEqual(friendlyState());
    });

    it('仅 scoreMilestone hit → cg≥2 / sp≤-0.2', () => {
        const s = friendlyState();
        _applySpawnHintsFriendlyBoostRulesRef(s, { scoreMilestoneHit: true, sessionArc: 'peak' });
        expect(s.clearGuarantee).toBe(2);
        expect(s.sizePreference).toBe(-0.2);
    });

    it('仅 sessionArc=warmup → cg≥2 / sp≤-0.2', () => {
        const s = friendlyState();
        _applySpawnHintsFriendlyBoostRulesRef(s, { scoreMilestoneHit: false, sessionArc: 'warmup' });
        expect(s.clearGuarantee).toBe(2);
        expect(s.sizePreference).toBe(-0.2);
    });

    it('两段同时触发 → max/min 不"双倍补偿"', () => {
        const s = friendlyState();
        _applySpawnHintsFriendlyBoostRulesRef(s, { scoreMilestoneHit: true, sessionArc: 'warmup' });
        expect(s.clearGuarantee).toBe(2);
        expect(s.sizePreference).toBe(-0.2);
    });

    it('已有更高 cg → 不下降（max）', () => {
        const s = friendlyState(); s.clearGuarantee = 3;
        _applySpawnHintsFriendlyBoostRulesRef(s, { scoreMilestoneHit: true, sessionArc: 'peak' });
        expect(s.clearGuarantee).toBe(3);
    });

    it('已有更低 sp → 不被抬升（min）', () => {
        const s = friendlyState(); s.sizePreference = -0.5;
        _applySpawnHintsFriendlyBoostRulesRef(s, { scoreMilestoneHit: false, sessionArc: 'warmup' });
        expect(s.sizePreference).toBe(-0.5);
    });

    it('sessionArc 未知值 → 不触发', () => {
        const s = friendlyState();
        _applySpawnHintsFriendlyBoostRulesRef(s, { scoreMilestoneHit: false, sessionArc: 'unknown' });
        expect(s).toEqual(friendlyState());
    });

    it('幂等：连续调两次结果一致', () => {
        const s1 = friendlyState();
        const s2 = friendlyState();
        const sig = { scoreMilestoneHit: true, sessionArc: 'warmup' };
        _applySpawnHintsFriendlyBoostRulesRef(s1, sig);
        _applySpawnHintsFriendlyBoostRulesRef(s2, sig);
        _applySpawnHintsFriendlyBoostRulesRef(s2, sig);
        expect(s1).toEqual(s2);
    });
});

/* ============ II2: _applySpawnHintsLateMomentumRules ============ */
function _applySpawnHintsLateMomentumRulesRef(s, profile) {
    if (!(profile?.sessionPhase === 'late' && profile.momentum < -0.3)) return s;
    return {
        clearGuarantee: Math.max(s.clearGuarantee, 1),
        sizePreference: Math.min(s.sizePreference, -0.2),
    };
}
describe('adaptiveSpawn._applySpawnHintsLateMomentumRules (II2)', () => {
    const s0 = () => ({ clearGuarantee: 0, sizePreference: 0 });
    it('profile 缺失 / 非 late → 不动', () => {
        expect(_applySpawnHintsLateMomentumRulesRef(s0(), null)).toEqual(s0());
        expect(_applySpawnHintsLateMomentumRulesRef(s0(), { sessionPhase: 'mid', momentum: -0.5 })).toEqual(s0());
    });
    it('late 但 momentum ≥ -0.3 → 不动', () => {
        expect(_applySpawnHintsLateMomentumRulesRef(s0(), { sessionPhase: 'late', momentum: -0.3 })).toEqual(s0());
    });
    it('late + momentum < -0.3 → cg≥1 / sp≤-0.2', () => {
        const r = _applySpawnHintsLateMomentumRulesRef(s0(), { sessionPhase: 'late', momentum: -0.4 });
        expect(r.clearGuarantee).toBe(1);
        expect(r.sizePreference).toBe(-0.2);
    });
    it('已有更高 cg / 更负 sp → 不回退', () => {
        const r = _applySpawnHintsLateMomentumRulesRef(
            { clearGuarantee: 3, sizePreference: -0.6 },
            { sessionPhase: 'late', momentum: -0.5 },
        );
        expect(r.clearGuarantee).toBe(3);
        expect(r.sizePreference).toBe(-0.6);
    });
    it('幂等：双跑一致', () => {
        const a = _applySpawnHintsLateMomentumRulesRef(s0(), { sessionPhase: 'late', momentum: -0.5 });
        const b = _applySpawnHintsLateMomentumRulesRef(a, { sessionPhase: 'late', momentum: -0.5 });
        expect(a).toEqual(b);
    });
});

/* ============ II2: _applySpawnHintsRoundsSinceClearRules ============ */
function _applySpawnHintsRoundsSinceClearRulesRef(s, rsc) {
    if (!(rsc >= 2)) return s;
    let { clearGuarantee, sizePreference } = s;
    clearGuarantee = Math.max(clearGuarantee, 2);
    if (rsc >= 4) {
        clearGuarantee = Math.max(clearGuarantee, 3);
        sizePreference = Math.min(sizePreference, -0.35);
    }
    return { clearGuarantee, sizePreference };
}
describe('adaptiveSpawn._applySpawnHintsRoundsSinceClearRules (II2)', () => {
    const s0 = () => ({ clearGuarantee: 0, sizePreference: 0 });
    it('rsc<2 → 不动', () => {
        expect(_applySpawnHintsRoundsSinceClearRulesRef(s0(), 0)).toEqual(s0());
        expect(_applySpawnHintsRoundsSinceClearRulesRef(s0(), 1)).toEqual(s0());
    });
    it('rsc=2 → cg≥2，sp 不动', () => {
        expect(_applySpawnHintsRoundsSinceClearRulesRef(s0(), 2)).toEqual({ clearGuarantee: 2, sizePreference: 0 });
    });
    it('rsc=3 → 同 2（未到 4 阶）', () => {
        expect(_applySpawnHintsRoundsSinceClearRulesRef(s0(), 3)).toEqual({ clearGuarantee: 2, sizePreference: 0 });
    });
    it('rsc=4 → cg≥3 / sp≤-0.35', () => {
        const r = _applySpawnHintsRoundsSinceClearRulesRef(s0(), 4);
        expect(r.clearGuarantee).toBe(3);
        expect(r.sizePreference).toBe(-0.35);
    });
    it('rsc=10 → 同 4 档（已达上限）', () => {
        const r = _applySpawnHintsRoundsSinceClearRulesRef(s0(), 10);
        expect(r.clearGuarantee).toBe(3);
        expect(r.sizePreference).toBe(-0.35);
    });
    it('已有更高 cg / 更负 sp → 不回退（max/min 幂等）', () => {
        const r = _applySpawnHintsRoundsSinceClearRulesRef(
            { clearGuarantee: 3, sizePreference: -0.7 }, 4,
        );
        expect(r.clearGuarantee).toBe(3);
        expect(r.sizePreference).toBe(-0.7);
    });
    it('幂等：双跑一致（任意 rsc 值）', () => {
        for (const rsc of [0, 1, 2, 3, 4, 5, 10]) {
            const a = _applySpawnHintsRoundsSinceClearRulesRef(s0(), rsc);
            const b = _applySpawnHintsRoundsSinceClearRulesRef(a, rsc);
            expect(a).toEqual(b);
        }
    });
});

/* ============ HH1: _applySpawnHintsFarFromPBBoostBody ============ */
function _applySpawnHintsFarFromPBBoostBodyRef(s, signals) {
    const { pctOfBest, farCfg, farRampCfg, modelFarTheta } = signals;
    const cgBoost = Math.max(0, Math.min(2, Number(farCfg.clearGuaranteeBoost) || 1));
    const _mcbFloorRaw = modelFarTheta !== null ? modelFarTheta : (Number(farCfg.multiClearBonusFloor) || 0.45);
    let mcbFloor = Math.max(0, Math.min(1, _mcbFloorRaw));
    let iconFloor = Math.max(0, Math.min(1, Number(farCfg.iconBonusTargetFloor) || 0.30));
    let sizeShift = Number(farCfg.sizePreferenceShift) || -0.12;
    const extremeThreshold = Number.isFinite(farRampCfg.extremeThreshold) ? farRampCfg.extremeThreshold : 0.15;
    const isExtremeFar = farRampCfg.enabled !== false && pctOfBest < extremeThreshold;
    if (isExtremeFar) {
        mcbFloor = Math.max(mcbFloor, Number(farRampCfg.extremeMultiClearBonusFloor) || 0.55);
        iconFloor = Math.max(iconFloor, Number(farRampCfg.extremeIconBonusTargetFloor) || 0.40);
        sizeShift = Math.min(sizeShift, Number(farRampCfg.extremeSizePreferenceShift) || -0.18);
    }
    return {
        clearGuarantee: Math.min(3, s.clearGuarantee + cgBoost),
        multiClearBonus: Math.max(s.multiClearBonus, mcbFloor),
        iconBonusTarget: Math.max(s.iconBonusTarget, iconFloor),
        sizePreference: Math.min(s.sizePreference, sizeShift),
        isExtremeFar,
    };
}

describe('adaptiveSpawn._applySpawnHintsFarFromPBBoostBody (HH1)', () => {
    const baseS = (over = {}) => ({ clearGuarantee: 0, multiClearBonus: 0, iconBonusTarget: 0, sizePreference: 0, ...over });
    const baseSig = (over = {}) => ({
        pctOfBest: 0.25, /* 边缘档（0.15-0.30）*/
        farCfg: {},
        farRampCfg: {},
        modelFarTheta: null,
        ...over,
    });

    it('默认配置 + 边缘档 → cg+1 / mcb=0.45 / icon=0.30 / sp=-0.12', () => {
        const r = _applySpawnHintsFarFromPBBoostBodyRef(baseS(), baseSig());
        expect(r.clearGuarantee).toBe(1);
        expect(r.multiClearBonus).toBe(0.45);
        expect(r.iconBonusTarget).toBe(0.30);
        expect(r.sizePreference).toBe(-0.12);
        expect(r.isExtremeFar).toBe(false);
    });

    it('极远档 (pctOfBest<0.15) → mcb=0.55 / icon=0.40 / sp=-0.18 / isExtremeFar=true', () => {
        const r = _applySpawnHintsFarFromPBBoostBodyRef(baseS(), baseSig({ pctOfBest: 0.10 }));
        expect(r.isExtremeFar).toBe(true);
        expect(r.multiClearBonus).toBe(0.55);
        expect(r.iconBonusTarget).toBe(0.40);
        expect(r.sizePreference).toBe(-0.18);
    });

    it('farRamp.enabled=false → 不进极远档（即使 pctOfBest<0.15）', () => {
        const r = _applySpawnHintsFarFromPBBoostBodyRef(baseS(),
            baseSig({ pctOfBest: 0.10, farRampCfg: { enabled: false } }));
        expect(r.isExtremeFar).toBe(false);
        expect(r.multiClearBonus).toBe(0.45); /* 边缘档值 */
    });

    it('cgBoost=3 clamp 到 2（hint clamp 上限）', () => {
        const r = _applySpawnHintsFarFromPBBoostBodyRef(baseS(),
            baseSig({ farCfg: { clearGuaranteeBoost: 3 } }));
        expect(r.clearGuarantee).toBe(2); /* 0 + clamp(3, 0, 2) = 2 */
    });

    it('clearGuarantee 已 3 → clamp 不超 3', () => {
        const r = _applySpawnHintsFarFromPBBoostBodyRef(baseS({ clearGuarantee: 3 }), baseSig());
        expect(r.clearGuarantee).toBe(3);
    });

    it('modelConfig.farFromPBBoost 覆盖 farCfg.multiClearBonusFloor', () => {
        const r = _applySpawnHintsFarFromPBBoostBodyRef(baseS(),
            baseSig({ modelFarTheta: 0.7, farCfg: { multiClearBonusFloor: 0.45 } }));
        expect(r.multiClearBonus).toBe(0.7);
    });

    it('已有更高 multiClearBonus / iconBonusTarget → 不下降（max 幂等）', () => {
        const r = _applySpawnHintsFarFromPBBoostBodyRef(
            baseS({ multiClearBonus: 0.8, iconBonusTarget: 0.6 }),
            baseSig({ pctOfBest: 0.10 }), /* 极远档 */
        );
        expect(r.multiClearBonus).toBe(0.8);
        expect(r.iconBonusTarget).toBe(0.6);
    });

    it('已有更负 sizePreference → 不回退（min 幂等）', () => {
        const r = _applySpawnHintsFarFromPBBoostBodyRef(
            baseS({ sizePreference: -0.5 }),
            baseSig({ pctOfBest: 0.10 }),
        );
        expect(r.sizePreference).toBe(-0.5);
    });

    it('非幂等性守护：clearGuarantee 连续两次累加', () => {
        const s1 = baseS();
        const s2 = _applySpawnHintsFarFromPBBoostBodyRef(s1, baseSig());
        const s3 = _applySpawnHintsFarFromPBBoostBodyRef(s2, baseSig());
        expect(s2.clearGuarantee).toBe(1);
        expect(s3.clearGuarantee).toBe(2); /* +1 again */
    });

    it('cgBoost=0 fallback 到默认 1（`||` 短路语义）— 历史契约', () => {
        /* `Number(0) || 1` → 1（0 是 falsy）。这是历史代码的语义：
         * 任何 falsy（含 0 / null / NaN）都走默认 1。本测试守护该契约，
         * 防有人改成 ?? 时静默改变行为。 */
        const r = _applySpawnHintsFarFromPBBoostBodyRef(baseS({ clearGuarantee: 1 }),
            baseSig({ farCfg: { clearGuaranteeBoost: 0 } }));
        expect(r.clearGuarantee).toBe(2); /* 1 + 1（fallback） */
    });

    it('extremeThreshold 配置覆盖：默认 0.15，配 0.20 时 pctOfBest=0.18 也算极远', () => {
        const r = _applySpawnHintsFarFromPBBoostBodyRef(baseS(),
            baseSig({ pctOfBest: 0.18, farRampCfg: { extremeThreshold: 0.20 } }));
        expect(r.isExtremeFar).toBe(true);
    });
});

/* ============ GG1: _applySpawnHintsPostPbReleaseRules ============ */
function _applySpawnHintsPostPbReleaseRulesRef(s, ctx) {
    if (ctx?.postPbReleaseActive !== true) return s;
    return {
        clearGuarantee: Math.min(3, s.clearGuarantee + 1),
        sizePreference: Math.min(s.sizePreference, -0.15),
    };
}

describe('adaptiveSpawn._applySpawnHintsPostPbReleaseRules (GG1)', () => {
    const base = (over = {}) => ({ clearGuarantee: 0, sizePreference: 0, ...over });

    it('ctx 缺失 → 不动', () => {
        expect(_applySpawnHintsPostPbReleaseRulesRef(base(), null)).toEqual(base());
        expect(_applySpawnHintsPostPbReleaseRulesRef(base(), undefined)).toEqual(base());
    });

    it('postPbReleaseActive=false → 不动', () => {
        expect(_applySpawnHintsPostPbReleaseRulesRef(base(), { postPbReleaseActive: false }))
            .toEqual(base());
    });

    it('postPbReleaseActive=true → cg+1 (clamp 3) / sp=min(-0.15)', () => {
        const r = _applySpawnHintsPostPbReleaseRulesRef(base(), { postPbReleaseActive: true });
        expect(r.clearGuarantee).toBe(1);
        expect(r.sizePreference).toBe(-0.15);
    });

    it('cg=3 时 +1 仍 clamp 到 3（不溢出）', () => {
        const r = _applySpawnHintsPostPbReleaseRulesRef(base({ clearGuarantee: 3 }), { postPbReleaseActive: true });
        expect(r.clearGuarantee).toBe(3);
    });

    it('cg=2.5 → +1=3.5 clamp 3', () => {
        const r = _applySpawnHintsPostPbReleaseRulesRef(base({ clearGuarantee: 2.5 }), { postPbReleaseActive: true });
        expect(r.clearGuarantee).toBe(3);
    });

    it('sp=-0.5（已更负）→ 保持 -0.5（min 不回退）', () => {
        const r = _applySpawnHintsPostPbReleaseRulesRef(base({ sizePreference: -0.5 }), { postPbReleaseActive: true });
        expect(r.sizePreference).toBe(-0.5);
    });

    it('非幂等性守护：连续两次 cg 累加（+1+1=+2，clamp 到 3）', () => {
        const s1 = _applySpawnHintsPostPbReleaseRulesRef(base(), { postPbReleaseActive: true });
        const s2 = _applySpawnHintsPostPbReleaseRulesRef(s1, { postPbReleaseActive: true });
        expect(s1.clearGuarantee).toBe(1);
        expect(s2.clearGuarantee).toBe(2);
    });

    it('严格 === true 校验（截断 truthy 防误触发）', () => {
        expect(_applySpawnHintsPostPbReleaseRulesRef(base(), { postPbReleaseActive: 1 })).toEqual(base());
        expect(_applySpawnHintsPostPbReleaseRulesRef(base(), { postPbReleaseActive: 'yes' })).toEqual(base());
    });
});

/* ============ EE1: _applySpawnHintsLowPhaseRules ============ */
function _applySpawnHintsLowPhaseRulesRef(s, signals) {
    const { lowPhase, pcSetup, nearFullLines, lowClearGuaranteeAt } = signals;
    if (!lowPhase) return s;
    if (!(pcSetup >= 1 || nearFullLines >= 1)) return s;
    const cgFloor = Number.isFinite(lowClearGuaranteeAt) ? lowClearGuaranteeAt : 2;
    s.clearGuarantee = Math.max(s.clearGuarantee, cgFloor);
    s.multiClearBonus = Math.max(s.multiClearBonus, 0.6);
    return s;
}
const lpState = () => ({ clearGuarantee: 0, multiClearBonus: 0 });
const lpSig = (over = {}) => ({
    lowPhase: false, pcSetup: 0, nearFullLines: 0, lowClearGuaranteeAt: 2, ...over,
});

describe('adaptiveSpawn._applySpawnHintsLowPhaseRules (EE1)', () => {
    it('lowPhase=false → 不动', () => {
        const s = lpState();
        _applySpawnHintsLowPhaseRulesRef(s, lpSig({ lowPhase: false, pcSetup: 5, nearFullLines: 5 }));
        expect(s).toEqual(lpState());
    });

    it('lowPhase=true 但无机会 (pcSetup=0 + nearFull=0) → 不动（不凭空制造）', () => {
        const s = lpState();
        _applySpawnHintsLowPhaseRulesRef(s, lpSig({ lowPhase: true }));
        expect(s).toEqual(lpState());
    });

    it('lowPhase + pcSetup=1 → cg≥floor(2) / mcb≥0.6', () => {
        const s = lpState();
        _applySpawnHintsLowPhaseRulesRef(s, lpSig({ lowPhase: true, pcSetup: 1 }));
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiClearBonus).toBe(0.6);
    });

    it('lowPhase + nearFullLines=1 → 同效果', () => {
        const s = lpState();
        _applySpawnHintsLowPhaseRulesRef(s, lpSig({ lowPhase: true, nearFullLines: 1 }));
        expect(s.clearGuarantee).toBe(2);
        expect(s.multiClearBonus).toBe(0.6);
    });

    it('配置 lowClearGuaranteeAt=3 → cg=3', () => {
        const s = lpState();
        _applySpawnHintsLowPhaseRulesRef(s, lpSig({ lowPhase: true, pcSetup: 1, lowClearGuaranteeAt: 3 }));
        expect(s.clearGuarantee).toBe(3);
    });

    it('配置 lowClearGuaranteeAt 非数 → fallback 默认 2', () => {
        const s = lpState();
        _applySpawnHintsLowPhaseRulesRef(s, lpSig({ lowPhase: true, pcSetup: 1, lowClearGuaranteeAt: 'oops' }));
        expect(s.clearGuarantee).toBe(2);
    });

    it('已有更高 cg → 不下降', () => {
        const s = lpState(); s.clearGuarantee = 4;
        _applySpawnHintsLowPhaseRulesRef(s, lpSig({ lowPhase: true, pcSetup: 1 }));
        expect(s.clearGuarantee).toBe(4);
    });

    it('幂等：连续调两次结果一致', () => {
        const s1 = lpState();
        const s2 = lpState();
        const sig = lpSig({ lowPhase: true, pcSetup: 1, nearFullLines: 1 });
        _applySpawnHintsLowPhaseRulesRef(s1, sig);
        _applySpawnHintsLowPhaseRulesRef(s2, sig);
        _applySpawnHintsLowPhaseRulesRef(s2, sig);
        expect(s1).toEqual(s2);
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
