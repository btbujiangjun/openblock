/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
    DIFFICULTIES,
    GENERATORS,
    BEST_SCORE_BINS,
    LIFECYCLE_STAGES,
    LIFECYCLE_THRESHOLDS,
    getBestScoreBin,
    getLifecycleStage,
    makeContextKey,
    parseContextKey,
    validateContext,
    enumerateAllContexts,
    contextToEvalParams,
    getContextSpaceSize,
} from '../../web/src/tuning/contextSpace.js';

describe('contextSpace.js — 常量空间', () => {
    it('总 context 数为 120', () => {
        expect(getContextSpaceSize()).toBe(120);
        expect(enumerateAllContexts()).toHaveLength(120);
    });

    it('枚举无重复', () => {
        const all = enumerateAllContexts();
        const keys = all.map(makeContextKey);
        expect(new Set(keys).size).toBe(120);
    });

    it('每维度取值正确', () => {
        expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
        expect(GENERATORS).toEqual(['triplet-p1', 'budget-p2']);
        expect(BEST_SCORE_BINS).toEqual([500, 1500, 4000, 10000, 25000]);
        expect(LIFECYCLE_STAGES).toEqual(['onboarding', 'growth', 'mature', 'plateau']);
    });
});

describe('contextSpace.js — bestScore 分档', () => {
    it('边界值映射正确', () => {
        expect(getBestScoreBin(0)).toBe(500);
        expect(getBestScoreBin(100)).toBe(500);
        expect(getBestScoreBin(749)).toBe(500);
        expect(getBestScoreBin(750)).toBe(1500);
        expect(getBestScoreBin(2499)).toBe(1500);
        expect(getBestScoreBin(2500)).toBe(4000);
        expect(getBestScoreBin(6999)).toBe(4000);
        expect(getBestScoreBin(7000)).toBe(10000);
        expect(getBestScoreBin(16999)).toBe(10000);
        expect(getBestScoreBin(17000)).toBe(25000);
        expect(getBestScoreBin(100000)).toBe(25000);
    });

    it('单调不减 (bestScore 升 → bin 不变或升)', () => {
        let prevBin = -1;
        for (let b = 0; b <= 100000; b += 100) {
            const bin = getBestScoreBin(b);
            expect(bin).toBeGreaterThanOrEqual(prevBin);
            prevBin = bin;
        }
    });

    it('异常值回退到最小档', () => {
        expect(getBestScoreBin(NaN)).toBe(500);
        expect(getBestScoreBin(-100)).toBe(500);
        expect(getBestScoreBin(undefined)).toBe(500);
    });
});

describe('contextSpace.js — 生命周期判定', () => {
    it('rounds < 20 → onboarding', () => {
        expect(getLifecycleStage(0, 0)).toBe('onboarding');
        expect(getLifecycleStage(10, 0)).toBe('onboarding');
        expect(getLifecycleStage(19, 0)).toBe('onboarding');
        // 即使 daysSincePb > 7 也不抢: onboarding 优先
        expect(getLifecycleStage(5, 30)).toBe('onboarding');
    });

    it('20 ≤ rounds < 200 → growth', () => {
        expect(getLifecycleStage(20, 0)).toBe('growth');
        expect(getLifecycleStage(100, 0)).toBe('growth');
        expect(getLifecycleStage(199, 0)).toBe('growth');
    });

    it('200 ≤ rounds & daysSincePb ≤ 7 → mature', () => {
        expect(getLifecycleStage(200, 0)).toBe('mature');
        expect(getLifecycleStage(500, 3)).toBe('mature');
        expect(getLifecycleStage(1000, 7)).toBe('mature');
        expect(getLifecycleStage(10000, 0)).toBe('mature');
    });

    it('daysSincePb > 7 → plateau (仅当 rounds ≥ 200)', () => {
        expect(getLifecycleStage(200, 8)).toBe('plateau');
        expect(getLifecycleStage(500, 14)).toBe('plateau');
        expect(getLifecycleStage(5000, 30)).toBe('plateau');
    });

    it('异常值处理', () => {
        expect(getLifecycleStage(NaN, NaN)).toBe('onboarding'); // 0 rounds
        expect(getLifecycleStage(-5, 100)).toBe('onboarding');
    });
});

describe('contextSpace.js — context key 序列化', () => {
    it('makeContextKey 格式正确', () => {
        const key = makeContextKey({
            difficulty: 'normal',
            generator: 'budget-p2',
            bestScore_bin: 1500,
            lifecycle_stage: 'growth',
        });
        expect(key).toBe('normal:budget-p2:1500:growth');
    });

    it('parseContextKey 还原结构', () => {
        const original = {
            difficulty: 'hard',
            generator: 'triplet-p1',
            bestScore_bin: 10000,
            lifecycle_stage: 'mature',
        };
        const key = makeContextKey(original);
        const parsed = parseContextKey(key);
        expect(parsed).toEqual(original);
    });

    it('parseContextKey 拒绝畸形输入', () => {
        expect(() => parseContextKey('not:enough')).toThrow();
        expect(() => parseContextKey('a:b:c:d:e:extra')).toThrow();
        expect(() => parseContextKey(null)).toThrow();
        expect(() => parseContextKey(123)).toThrow();
    });

    it('120 个 context key 全部可往返', () => {
        for (const ctx of enumerateAllContexts()) {
            const key = makeContextKey(ctx);
            const parsed = parseContextKey(key);
            expect(parsed).toEqual(ctx);
        }
    });
});

describe('contextSpace.js — validateContext', () => {
    it('合法 context 通过', () => {
        const ctx = {
            difficulty: 'normal',
            generator: 'budget-p2',
            bestScore_bin: 1500,
            lifecycle_stage: 'growth',
        };
        expect(validateContext(ctx)).toEqual({ ok: true });
    });

    it('非法 difficulty 报错', () => {
        const r = validateContext({
            difficulty: 'extreme',
            generator: 'budget-p2',
            bestScore_bin: 1500,
            lifecycle_stage: 'growth',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/difficulty/);
    });

    it('非法 generator 报错', () => {
        const r = validateContext({
            difficulty: 'normal',
            generator: 'baseline',  // baseline 不在寻参空间
            bestScore_bin: 1500,
            lifecycle_stage: 'growth',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/generator/);
    });

    it('非法 bin 报错', () => {
        const r = validateContext({
            difficulty: 'normal',
            generator: 'budget-p2',
            bestScore_bin: 3000,  // 不在 5 档内
            lifecycle_stage: 'growth',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/bestScore_bin/);
    });

    it('非法 lifecycle 报错', () => {
        const r = validateContext({
            difficulty: 'normal',
            generator: 'budget-p2',
            bestScore_bin: 1500,
            lifecycle_stage: 'churn',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/lifecycle_stage/);
    });
});

describe('contextSpace.js — contextToEvalParams', () => {
    it('正确映射到 spawnEvaluation 入参', () => {
        const params = contextToEvalParams({
            difficulty: 'hard',
            generator: 'triplet-p1',
            bestScore_bin: 4000,
            lifecycle_stage: 'mature',  // 不传给评估器
        });
        expect(params).toEqual({
            strategy: 'hard',
            spawnGenerator: 'triplet-p1',
            bestScore: 4000,
        });
        expect(params).not.toHaveProperty('lifecycle');  // 不应泄露
    });
});

describe('contextSpace.js — LIFECYCLE_THRESHOLDS', () => {
    it('阈值在合理范围', () => {
        expect(LIFECYCLE_THRESHOLDS.onboardingMaxRounds).toBeGreaterThan(0);
        expect(LIFECYCLE_THRESHOLDS.onboardingMaxRounds).toBeLessThan(LIFECYCLE_THRESHOLDS.growthMaxRounds);
        expect(LIFECYCLE_THRESHOLDS.growthMaxRounds).toBeLessThan(LIFECYCLE_THRESHOLDS.matureMaxRounds);
        expect(LIFECYCLE_THRESHOLDS.plateauDaysSincePb).toBeGreaterThan(0);
    });
});
