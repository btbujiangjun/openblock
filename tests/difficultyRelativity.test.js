import { describe, it, expect } from 'vitest';
import {
    resolveRelativityBypass,
    solveObjectiveTarget,
    alignmentMultiplier
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
