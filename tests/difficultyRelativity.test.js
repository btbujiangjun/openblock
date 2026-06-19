import { describe, it, expect } from 'vitest';
import {
    resolveRelativityBypass,
    solveObjectiveTarget,
    alignmentMultiplier,
    resolveRelativityIntent,
    RELATIVITY_INTENT
} from '../web/src/difficultyRelativity.js';
import { DIFFICULTY_VECTOR_DIMS } from '../web/src/spawnStepDifficulty.js';

const calib = { spatial: 0.8, combo: 0.7, order: 0.6, recovery: 0.3, tempo: 0.5, clearEff: 0.65 };

function cfg(over = {}) {
    return {
        enabled: true, rolloutPercent: 100, minConfidence: 0.45,
        personalizationStrength: 0.3, deltaCurriculumK: 0.15, noiseAmp: 0.05,
        lowConfFallback: true, weaknessBoost: 1.5,
        dimWeights: { spatial: 1, combo: 1, order: 1, recovery: 1, tempo: 1, clearEff: 1 },
        ...over
    };
}

describe('difficultyRelativity — bypass / 退化保证', () => {
    it('enabled=false → disabled bypass，b* 不产出', () => {
        const r = solveObjectiveTarget(0.6, cfg({ enabled: false }), { calibration: calib });
        expect(r.bypass).toBe('disabled');
        expect(r.bStar).toBeNull();
    });

    it('无 calibration → low_conf bypass', () => {
        expect(resolveRelativityBypass(cfg(), { calibration: null })).toBe('low_conf');
    });

    it('救济/濒死/瓶颈/破纪录释放/warmup 全部 bypass', () => {
        expect(resolveRelativityBypass(cfg(), { calibration: calib, needsRecovery: true })).toBe('recovery');
        expect(resolveRelativityBypass(cfg(), { calibration: calib, hadRecentNearMiss: true })).toBe('near_miss');
        expect(resolveRelativityBypass(cfg(), { calibration: calib, hasBottleneckSignal: true })).toBe('bottleneck');
        expect(resolveRelativityBypass(cfg(), { calibration: calib, postPbReleaseActive: true })).toBe('post_pb_release');
        expect(resolveRelativityBypass(cfg(), { calibration: calib, sessionArc: 'warmup' })).toBe('warmup');
    });

    it('rollout=0 → 全部 rollout_out；rollout=100 → 全部进入', () => {
        expect(resolveRelativityBypass(cfg({ rolloutPercent: 0 }), { calibration: calib, userId: 'u1' })).toBe('rollout_out');
        expect(resolveRelativityBypass(cfg({ rolloutPercent: 100 }), { calibration: calib, userId: 'u1' })).toBeNull();
    });
});

describe('difficultyRelativity — b* 反解语义', () => {
    it('λ=0 → b* 各维 = stress（恒等于现状均匀客观）', () => {
        const r = solveObjectiveTarget(0.6, cfg({ personalizationStrength: 0, deltaCurriculumK: 0 }), { calibration: calib });
        expect(r.bypass).toBeNull();
        for (const d of DIFFICULTY_VECTOR_DIMS) expect(r.bStar[d]).toBeCloseTo(0.6, 6);
    });

    it('λ=1 → b*_d ≈ clamp(θ_d + (stress−0.5))，高能力维客观更难', () => {
        const r = solveObjectiveTarget(0.6, cfg({ personalizationStrength: 1, deltaCurriculumK: 0 }), { calibration: calib });
        expect(r.bStar.spatial).toBeCloseTo(clamp(0.8 + 0.1), 6);   // θ=0.8 高 → 客观更难
        expect(r.bStar.recovery).toBeCloseTo(clamp(0.3 + 0.1), 6);  // θ=0.3 低 → 客观更易
        expect(r.bStar.spatial).toBeGreaterThan(r.bStar.recovery);
    });

    it('课程项：弱项（θ<0.5）相对加压', () => {
        const noK = solveObjectiveTarget(0.5, cfg({ personalizationStrength: 1, deltaCurriculumK: 0 }), { calibration: calib });
        const withK = solveObjectiveTarget(0.5, cfg({ personalizationStrength: 1, deltaCurriculumK: 0.2 }), { calibration: calib });
        // recovery θ=0.3 < 0.5 → withK 应比 noK 更高（加压训练弱项）
        expect(withK.bStar.recovery).toBeGreaterThan(noK.bStar.recovery);
    });

    it('b* 始终落在 [0,1]', () => {
        const r = solveObjectiveTarget(1, cfg({ personalizationStrength: 1, deltaCurriculumK: 0.5 }), { calibration: calib });
        for (const d of DIFFICULTY_VECTOR_DIMS) {
            expect(r.bStar[d]).toBeGreaterThanOrEqual(0);
            expect(r.bStar[d]).toBeLessThanOrEqual(1);
        }
    });
});

describe('difficultyRelativity — 对齐乘子', () => {
    it('λ=0 → 乘子恒为 1（不影响候选打分）', () => {
        const v = { spatial: 0.1, combo: 0.9, order: 0.5, recovery: 0.5, tempo: 0.5, clearEff: 0.5 };
        expect(alignmentMultiplier(v, { spatial: 0.5 }, cfg({ personalizationStrength: 0 }))).toBe(1);
    });

    it('候选越贴近 b* 乘子越大', () => {
        const bStar = { spatial: 0.6, combo: 0.6, order: 0.6, recovery: 0.6, tempo: 0.6, clearEff: 0.6 };
        const near = { spatial: 0.6, combo: 0.6, order: 0.6, recovery: 0.6, tempo: 0.6, clearEff: 0.6 };
        const far = { spatial: 0.1, combo: 0.1, order: 0.1, recovery: 0.1, tempo: 0.1, clearEff: 0.1 };
        const mNear = alignmentMultiplier(near, bStar, cfg());
        const mFar = alignmentMultiplier(far, bStar, cfg());
        expect(mNear).toBeGreaterThan(mFar);
        expect(mNear).toBeCloseTo(1, 6);
        expect(mFar).toBeLessThan(1);
    });
});

function clamp(x) { return Math.max(0, Math.min(1, x)); }

/* ================================================================ */
/*  相位化对齐预算：相位化对齐预算 resolveRelativityIntent                       */
/* ================================================================ */
describe('相位化对齐预算 resolveRelativityIntent — 相位化对齐预算', () => {
    it('bypass != null → 强制 off（与 resolveRelativityBypass 语义对齐）', () => {
        expect(resolveRelativityIntent({ bypass: 'disabled' })).toBe('off');
        expect(resolveRelativityIntent({ bypass: 'low_conf', spawnIntent: 'maintain' })).toBe('off');
    });

    it('救济类紧急信号（needsRecovery/bottleneck/near_miss/onboarding）→ off', () => {
        expect(resolveRelativityIntent({ needsRecovery: true })).toBe('off');
        expect(resolveRelativityIntent({ hasBottleneckSignal: true })).toBe('off');
        expect(resolveRelativityIntent({ hadRecentNearMiss: true })).toBe('off');
        expect(resolveRelativityIntent({ inOnboarding: true })).toBe('off');
    });

    it('顺玩家相位 harvest/engage/warm → prior_only（禁 best-of-K）', () => {
        expect(resolveRelativityIntent({ spawnIntent: 'harvest' })).toBe('prior_only');
        expect(resolveRelativityIntent({ spawnIntent: 'engage' })).toBe('prior_only');
        expect(resolveRelativityIntent({ spawnIntent: 'warm' })).toBe('prior_only');
    });

    it('sessionArc=warmup → prior_only', () => {
        expect(resolveRelativityIntent({ sessionArc: 'warmup', spawnIntent: 'maintain' })).toBe('prior_only');
    });

    it('pbPhase ∈ {chase, release} → prior_only', () => {
        expect(resolveRelativityIntent({ pbPhase: 'chase', spawnIntent: 'maintain' })).toBe('prior_only');
        expect(resolveRelativityIntent({ pbPhase: 'release', spawnIntent: 'maintain' })).toBe('prior_only');
    });

    it('maintain/flow/sprint/pressure → full（默认全开）', () => {
        expect(resolveRelativityIntent({ spawnIntent: 'maintain' })).toBe('full');
        expect(resolveRelativityIntent({ spawnIntent: 'flow' })).toBe('full');
        expect(resolveRelativityIntent({ spawnIntent: 'sprint' })).toBe('full');
        expect(resolveRelativityIntent({ spawnIntent: 'pressure' })).toBe('full');
    });

    it('优先级顺序：bypass > 救济 > 顺玩家相位 > full', () => {
        /* needsRecovery 在 harvest 帧下仍 off（救济压过顺玩家）。 */
        expect(resolveRelativityIntent({ spawnIntent: 'harvest', needsRecovery: true })).toBe('off');
        /* bypass 在任何状态下都 off。 */
        expect(resolveRelativityIntent({ bypass: 'low_conf', spawnIntent: 'maintain' })).toBe('off');
        /* warmup 在 maintain 下仍 prior_only。 */
        expect(resolveRelativityIntent({ sessionArc: 'warmup', spawnIntent: 'maintain' })).toBe('prior_only');
    });

    it('RELATIVITY_INTENT 常量枚举完整', () => {
        expect(RELATIVITY_INTENT.OFF).toBe('off');
        expect(RELATIVITY_INTENT.PRIOR_ONLY).toBe('prior_only');
        expect(RELATIVITY_INTENT.KBEST_ONLY).toBe('kbest_only');
        expect(RELATIVITY_INTENT.FULL).toBe('full');
    });
});

/* ================================================================ */
/*  b* 前期上界：早期相位 b* 上界（解决高 PB 玩家前期被喂偏难三连）           */
/* ================================================================ */
describe('b* 前期上界 solveObjectiveTarget — earlyPhase b* 上界', () => {
    const strongCalib = { spatial: 0.9, combo: 0.9, order: 0.9, recovery: 0.9, tempo: 0.9, clearEff: 0.9 };

    it('低 d*（前期）+ 高 θ：b* 被钳制在 d + earlyPhaseBStarCap 以内', () => {
        const r = solveObjectiveTarget(0.3, cfg({
            personalizationStrength: 1,
            deltaCurriculumK: 0,
            earlyPhaseDStar: 0.40,
            earlyPhaseBStarCap: 0.10
        }), { calibration: strongCalib });
        for (const d of DIFFICULTY_VECTOR_DIMS) {
            expect(r.bStar[d]).toBeLessThanOrEqual(0.3 + 0.10 + 1e-9);
        }
    });

    it('高 d*（中后段）：上界不生效，b* 走原公式', () => {
        const r1 = solveObjectiveTarget(0.7, cfg({
            personalizationStrength: 1, deltaCurriculumK: 0,
            earlyPhaseDStar: 0.40, earlyPhaseBStarCap: 0.10
        }), { calibration: strongCalib });
        const r2 = solveObjectiveTarget(0.7, cfg({
            personalizationStrength: 1, deltaCurriculumK: 0,
            earlyPhaseDStar: 0  // 禁用上界
        }), { calibration: strongCalib });
        for (const d of DIFFICULTY_VECTOR_DIMS) {
            expect(r1.bStar[d]).toBeCloseTo(r2.bStar[d], 6);
        }
    });

    it('earlyPhaseDStar=0 → 完全禁用（旧行为兼容）', () => {
        const r = solveObjectiveTarget(0.2, cfg({
            personalizationStrength: 1, deltaCurriculumK: 0,
            earlyPhaseDStar: 0
        }), { calibration: strongCalib });
        /* 不被钳制，应该 = clamp(θ + (d-0.5)) = clamp(0.9 - 0.3) = 0.6。 */
        expect(r.bStar.spatial).toBeCloseTo(0.6, 6);
    });

    it('不对称钳制：只压上限，不抬下限（弱项 ZPD 课程仍可加压）', () => {
        const weakCalib = { spatial: 0.1, combo: 0.1, order: 0.1, recovery: 0.1, tempo: 0.1, clearEff: 0.1 };
        const r = solveObjectiveTarget(0.3, cfg({
            personalizationStrength: 1,
            deltaCurriculumK: 0.5,  // 强课程项
            earlyPhaseDStar: 0.40, earlyPhaseBStarCap: 0.10
        }), { calibration: weakCalib });
        /* 弱项：relative = clamp(0.1 + (0.3-0.5)) = 0；b = 0 + 0.5×(0.5-0.1) = 0.2。
         * 上界 cap = d + 0.10 = 0.40，0.2 ≤ 0.40 不触上界，弱项加压保留。 */
        expect(r.bStar.spatial).toBeGreaterThan(0.1);
        expect(r.bStar.spatial).toBeLessThanOrEqual(0.40);
    });
});
