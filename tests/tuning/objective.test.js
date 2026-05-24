/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
    clamp01,
    sigmoid,
    overshootTolerance,
    breakHealthScore,
    fairnessSubscore,
    excitementSubscore,
    antiInflationSubscore,
    lifecycleMultiplier,
    computeObjective,
    OBJECTIVE_CONFIG,
} from '../../web/src/tuning/objective.js';

/** 辅助: 构造一行带常用字段的"模拟评估行" */
function mkRow(over = {}) {
    return {
        noMoveRate: 0.05,
        firstMoveFreedomMean: 8.0,
        fallbackRate: 0.01,
        clearsMean: 20,
        multiClearRate: 0.25,
        clearIntervalP90: 6,
        overshootRate: 0.04,
        breakPbRate: 0.10,
        ...over,
    };
}

describe('objective.js — 基础数学工具', () => {
    it('clamp01 钳制范围', () => {
        expect(clamp01(-0.5)).toBe(0);
        expect(clamp01(0)).toBe(0);
        expect(clamp01(0.5)).toBe(0.5);
        expect(clamp01(1)).toBe(1);
        expect(clamp01(1.5)).toBe(1);
        expect(clamp01(NaN)).toBe(0);
        expect(clamp01(Infinity)).toBe(0);
    });

    it('sigmoid 数值稳定 + 标准取值', () => {
        expect(sigmoid(0)).toBeCloseTo(0.5, 6);
        expect(sigmoid(100)).toBeCloseTo(1, 6);
        expect(sigmoid(-100)).toBeCloseTo(0, 6);
        // 数值稳定: x = ±1e6 不应产生 NaN/Inf
        expect(Number.isFinite(sigmoid(1e6))).toBe(true);
        expect(Number.isFinite(sigmoid(-1e6))).toBe(true);
    });
});

describe('objective.js — PB 容忍度', () => {
    it('随 bestScore 单调递减', () => {
        const t500 = overshootTolerance(500);
        const t1500 = overshootTolerance(1500);
        const t4000 = overshootTolerance(4000);
        const t10000 = overshootTolerance(10000);
        const t25000 = overshootTolerance(25000);
        expect(t500).toBeGreaterThan(t1500);
        expect(t1500).toBeGreaterThan(t4000);
        expect(t4000).toBeGreaterThan(t10000);
        expect(t10000).toBeGreaterThan(t25000);
    });

    it('容忍度在 [toleranceMin, toleranceMax] 内', () => {
        const cfg = OBJECTIVE_CONFIG.overshoot;
        for (const best of [100, 500, 1500, 4000, 10000, 25000, 100000]) {
            const t = overshootTolerance(best);
            expect(t).toBeGreaterThanOrEqual(cfg.toleranceMin - 1e-9);
            expect(t).toBeLessThanOrEqual(cfg.toleranceMax + 1e-9);
        }
    });

    it('文档表 §3.2 的目标值近似 (slope=0.24 反推)', () => {
        // 与 docs §3.2 表对照 (±0.03 容差)
        expect(overshootTolerance(500)).toBeGreaterThan(0.39);
        expect(overshootTolerance(500)).toBeLessThan(0.46);
        expect(overshootTolerance(1500)).toBeGreaterThan(0.27);
        expect(overshootTolerance(1500)).toBeLessThan(0.33);
        expect(overshootTolerance(4000)).toBeGreaterThan(0.10);
        expect(overshootTolerance(4000)).toBeLessThan(0.18);
        expect(overshootTolerance(10000)).toBeGreaterThan(0.05);
        expect(overshootTolerance(10000)).toBeLessThan(0.10);
        expect(overshootTolerance(25000)).toBeLessThan(0.07);
    });

    it('边界 bestScore: 0 或负数应回退', () => {
        // 不应 NaN
        const t0 = overshootTolerance(0);
        const tNeg = overshootTolerance(-10);
        expect(Number.isFinite(t0)).toBe(true);
        expect(Number.isFinite(tNeg)).toBe(true);
        // 应等价于 bestScore=1 (最大容忍度)
        expect(t0).toBeGreaterThan(0.35);
    });
});

describe('objective.js — breakHealthScore', () => {
    it('在 [8%, 15%] 区间内为 1', () => {
        expect(breakHealthScore(0.08)).toBe(1);
        expect(breakHealthScore(0.10)).toBe(1);
        expect(breakHealthScore(0.15)).toBe(1);
    });

    it('低于 8% 线性下降', () => {
        expect(breakHealthScore(0)).toBe(0);
        expect(breakHealthScore(0.04)).toBeCloseTo(0.5, 2);
        expect(breakHealthScore(0.08)).toBe(1);
    });

    it('超过 15% 线性下降至 45% 时归零', () => {
        expect(breakHealthScore(0.15)).toBe(1);
        expect(breakHealthScore(0.30)).toBeCloseTo(0.5, 1);
        expect(breakHealthScore(0.45)).toBe(0);
        expect(breakHealthScore(0.60)).toBe(0);
        expect(breakHealthScore(1.0)).toBe(0);
    });
});

describe('objective.js — 子分数', () => {
    it('fairness 最佳行 → 接近 1', () => {
        const row = mkRow({ noMoveRate: 0, firstMoveFreedomMean: 12, fallbackRate: 0 });
        expect(fairnessSubscore(row)).toBeCloseTo(1, 3);
    });

    it('fairness 最差行 → 接近 0', () => {
        const row = mkRow({ noMoveRate: 1, firstMoveFreedomMean: 0, fallbackRate: 0.20 });
        expect(fairnessSubscore(row)).toBe(0);
    });

    it('excitement 最佳行 → 接近 1', () => {
        const row = mkRow({ clearsMean: 40, multiClearRate: 0.5, clearIntervalP90: 5 });
        expect(excitementSubscore(row)).toBeCloseTo(1, 3);
    });

    it('excitement 最差行 → 0', () => {
        const row = mkRow({ clearsMean: 0, multiClearRate: 0, clearIntervalP90: 50 });
        expect(excitementSubscore(row)).toBe(0);
    });

    it('antiInflation 在新手 (best=500) 时对高 overshoot 宽容', () => {
        const row = mkRow({ overshootRate: 0.30, breakPbRate: 0.10 });
        const score = antiInflationSubscore(row, 500);
        // best=500 容忍度 ~0.42, ratio=0.30/0.42 ≈ 0.71 → 1 - 0.71² ≈ 0.50
        expect(score).toBeGreaterThan(0.40);
        expect(score).toBeLessThan(0.80);
    });

    it('antiInflation 在顶尖 (best=25000) 时对相同 overshoot 严厉', () => {
        const row = mkRow({ overshootRate: 0.30, breakPbRate: 0.10 });
        const score = antiInflationSubscore(row, 25000);
        // best=25000 容忍度 ~0.05, ratio=0.30/0.05 = 6 → overshootScore = 0
        // breakHealth(0.10) = 1, 子分 = 0×0.70 + 1×0.30 = 0.30
        // 与新手 (best=500) 得分对比应该明显更低
        expect(score).toBeLessThanOrEqual(0.31);
        // 同时验证: 顶尖比新手严厉
        const novice = antiInflationSubscore(row, 500);
        expect(novice).toBeGreaterThan(score + 0.10);
    });

    it('antiInflation: overshoot=0 + breakPb 健康 → 1', () => {
        const row = mkRow({ overshootRate: 0, breakPbRate: 0.10 });
        expect(antiInflationSubscore(row, 1000)).toBeCloseTo(1, 3);
    });
});

describe('objective.js — 生命周期乘子', () => {
    it('onboarding 优待 fairness & excitement', () => {
        const m = lifecycleMultiplier('onboarding');
        expect(m.fairness).toBe(1.5);
        expect(m.excitement).toBe(1.2);
        expect(m.antiInflation).toBe(0.5);
    });

    it('mature 强调 antiInflation', () => {
        const m = lifecycleMultiplier('mature');
        expect(m.antiInflation).toBe(1.5);
        expect(m.fairness).toBeLessThan(1);
    });

    it('plateau 强调 excitement', () => {
        const m = lifecycleMultiplier('plateau');
        expect(m.excitement).toBe(1.5);
        expect(m.fairness).toBeLessThan(1);
    });

    it('unknown lifecycle 回退到 growth', () => {
        const m = lifecycleMultiplier('unknown_stage');
        expect(m).toEqual({ fairness: 1.0, excitement: 1.0, antiInflation: 1.0 });
    });
});

describe('objective.js — computeObjective 端到端', () => {
    it('返回 4 个子段 + breakdown', () => {
        const result = computeObjective(
            mkRow(),
            { difficulty: 'normal', generator: 'budget-p2', bestScore: 1500, lifecycle: 'growth' },
            { fairness: 70, excitement: 45, antiInflation: 60 }
        );
        expect(result).toHaveProperty('fairness');
        expect(result).toHaveProperty('excitement');
        expect(result).toHaveProperty('antiInflation');
        expect(result).toHaveProperty('composite');
        expect(result).toHaveProperty('breakdown');
        expect(result.breakdown).toHaveProperty('normalizedWeights');
        expect(result.breakdown).toHaveProperty('lifecycleMultipliers');
        expect(result.breakdown).toHaveProperty('subscoreContributions');
        expect(result.breakdown).toHaveProperty('overshootTolerance');
    });

    it('composite ∈ [0, 1]', () => {
        for (const best of [500, 1500, 4000, 10000, 25000]) {
            for (const life of ['onboarding', 'growth', 'mature', 'plateau']) {
                const r = computeObjective(
                    mkRow(),
                    { difficulty: 'normal', generator: 'budget-p2', bestScore: best, lifecycle: life },
                    { fairness: 50, excitement: 50, antiInflation: 50 }
                );
                expect(r.composite).toBeGreaterThanOrEqual(0);
                expect(r.composite).toBeLessThanOrEqual(1);
            }
        }
    });

    it('全 0 权重时回退到等权,不产生 NaN', () => {
        const r = computeObjective(
            mkRow(),
            { difficulty: 'normal', generator: 'budget-p2', bestScore: 1500, lifecycle: 'growth' },
            { fairness: 0, excitement: 0, antiInflation: 0 }
        );
        expect(r.composite).toBeGreaterThan(0);
        expect(Number.isFinite(r.composite)).toBe(true);
        expect(r.breakdown.normalizedWeights.fairness).toBeCloseTo(1 / 3, 4);
    });

    it('权重归一化: 比例不变时 composite 不变', () => {
        const row = mkRow();
        const ctx = { difficulty: 'normal', generator: 'budget-p2', bestScore: 1500, lifecycle: 'growth' };
        const r1 = computeObjective(row, ctx, { fairness: 1, excitement: 1, antiInflation: 1 });
        const r2 = computeObjective(row, ctx, { fairness: 100, excitement: 100, antiInflation: 100 });
        expect(r1.composite).toBeCloseTo(r2.composite, 5);
    });

    it('生命周期切换影响 composite (相同 row,不同阶段)', () => {
        const row = mkRow({ overshootRate: 0.10 });  // 中等膨胀
        const ctx = { difficulty: 'normal', generator: 'budget-p2', bestScore: 4000 };
        const weights = { fairness: 50, excitement: 50, antiInflation: 50 };
        const onboarding = computeObjective(row, { ...ctx, lifecycle: 'onboarding' }, weights);
        const mature = computeObjective(row, { ...ctx, lifecycle: 'mature' }, weights);
        // mature 阶段对 antiInflation 加权 1.5,overshoot=10% 会拉低 composite
        // onboarding 阶段乘子 0.5,影响弱,composite 应更高
        expect(onboarding.composite).toBeGreaterThan(mature.composite);
    });

    it('bestScore 切换影响 antiInflation (相同 overshoot,不同 best)', () => {
        const row = mkRow({ overshootRate: 0.20 });
        const ctx = { difficulty: 'normal', generator: 'budget-p2', lifecycle: 'growth' };
        const weights = { fairness: 0, excitement: 0, antiInflation: 100 };  // 只看 antiInflation
        const lowBest = computeObjective(row, { ...ctx, bestScore: 500 }, weights);
        const highBest = computeObjective(row, { ...ctx, bestScore: 25000 }, weights);
        expect(lowBest.composite).toBeGreaterThan(highBest.composite);
    });

    it('overshootTolerance 与 breakdown 一致', () => {
        const r = computeObjective(
            mkRow(),
            { difficulty: 'normal', generator: 'budget-p2', bestScore: 1500, lifecycle: 'growth' },
            { fairness: 50, excitement: 50, antiInflation: 50 }
        );
        expect(r.breakdown.overshootTolerance).toBeCloseTo(overshootTolerance(1500), 5);
    });
});
