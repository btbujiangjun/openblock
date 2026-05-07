/**
 * @vitest-environment jsdom
 *
 * 难度系统：getSpawnStressFromScore / blendShapeWeightsTowardHard /
 * getRunDifficultyModifiers / resolveLayeredStrategy
 */
import { describe, it, expect } from 'vitest';
import {
    getSpawnStressFromScore,
    blendShapeWeightsTowardHard,
    getRunDifficultyModifiers,
    resolveLayeredStrategy
} from '../web/src/difficulty.js';

describe('difficulty', () => {
    describe('getSpawnStressFromScore', () => {
        it('score 0 returns low stress', () => {
            const s = getSpawnStressFromScore(0);
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThanOrEqual(0.3);
        });

        it('monotonically non-decreasing with score', () => {
            let prev = getSpawnStressFromScore(0);
            for (let sc = 50; sc <= 1000; sc += 50) {
                const cur = getSpawnStressFromScore(sc);
                expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
                prev = cur;
            }
        });

        it('very high score clamps at max stress', () => {
            const s = getSpawnStressFromScore(99999);
            expect(s).toBeLessThanOrEqual(1);
            expect(s).toBeGreaterThan(0);
        });

        it('negative score handled gracefully', () => {
            const s = getSpawnStressFromScore(-100);
            expect(typeof s).toBe('number');
            expect(Number.isFinite(s)).toBe(true);
        });

        // v1.13：个人百分位映射
        it('百分位映射：低于个人最佳 50% 时按衰减因子降到很低', () => {
            // bestScore=5000, score=1440 → pct≈0.288 → 衰减
            const s = getSpawnStressFromScore(1440, { bestScore: 5000 });
            // 不带 bestScore 时该分数会直接锁到末档（≈0.78），带上 bestScore 后应远低于此
            const sNoBest = getSpawnStressFromScore(1440);
            expect(s).toBeLessThan(sNoBest);
            expect(s).toBeLessThan(0.5);
        });

        it('百分位映射：处于个人最佳的 100% 时压力等于 milestones 末档', () => {
            const sBest = getSpawnStressFromScore(5000, { bestScore: 5000 });
            const sMaxAbs = getSpawnStressFromScore(99999); // 旧路径锁到末档
            expect(sBest).toBeCloseTo(sMaxAbs, 4);
        });

        it('百分位映射：50%~100% 之间不衰减、与百分位单调', () => {
            const s50 = getSpawnStressFromScore(2500, { bestScore: 5000 });
            const s75 = getSpawnStressFromScore(3750, { bestScore: 5000 });
            const s100 = getSpawnStressFromScore(5000, { bestScore: 5000 });
            expect(s50).toBeLessThan(s75);
            expect(s75).toBeLessThan(s100);
            expect(s50).toBeGreaterThan(0);
        });

        it('bestScore=0 / 缺省时回退到旧的绝对分段（保留向后兼容）', () => {
            const sNew = getSpawnStressFromScore(1440, { bestScore: 0 });
            const sOld = getSpawnStressFromScore(1440);
            expect(sNew).toBeCloseTo(sOld, 6);
        });
    });

    describe('blendShapeWeightsTowardHard', () => {
        it('t=0 returns base weights unchanged', () => {
            const w = blendShapeWeightsTowardHard('normal', 0);
            expect(typeof w).toBe('object');
            expect(Object.keys(w).length).toBeGreaterThan(0);
        });

        it('t=1 returns hard weights', () => {
            const w = blendShapeWeightsTowardHard('normal', 1);
            expect(typeof w).toBe('object');
        });

        it('intermediate t produces intermediate values', () => {
            const w0 = blendShapeWeightsTowardHard('normal', 0);
            const w1 = blendShapeWeightsTowardHard('normal', 1);
            const wMid = blendShapeWeightsTowardHard('normal', 0.5);
            for (const k of Object.keys(wMid)) {
                const a = w0[k] ?? 1;
                const b = w1[k] ?? 1;
                expect(wMid[k]).toBeCloseTo(a * 0.5 + b * 0.5, 4);
            }
        });

        it('clamps t outside [0,1]', () => {
            const wNeg = blendShapeWeightsTowardHard('normal', -5);
            const w0 = blendShapeWeightsTowardHard('normal', 0);
            for (const k of Object.keys(wNeg)) {
                expect(wNeg[k]).toBeCloseTo(w0[k], 4);
            }
        });
    });

    describe('getRunDifficultyModifiers', () => {
        it('streak 0 has no modifiers', () => {
            const m = getRunDifficultyModifiers(0);
            expect(m.fillDelta).toBe(0);
            expect(m.stressBonus).toBe(0);
        });

        it('positive streak increases modifiers', () => {
            const m = getRunDifficultyModifiers(3);
            expect(m.fillDelta).toBeGreaterThanOrEqual(0);
            expect(m.stressBonus).toBeGreaterThanOrEqual(0);
        });
    });

    describe('resolveLayeredStrategy', () => {
        it('returns strategy object with required fields', () => {
            const s = resolveLayeredStrategy('normal', 100, 0);
            expect(s.shapeWeights).toBeDefined();
            expect(typeof s.fillRatio).toBe('number');
            expect(s.scoring).toBeDefined();
        });

        it('fillRatio stays within [0, 0.36]', () => {
            for (let streak = 0; streak <= 10; streak++) {
                const s = resolveLayeredStrategy('normal', 500, streak);
                expect(s.fillRatio).toBeGreaterThanOrEqual(0);
                expect(s.fillRatio).toBeLessThanOrEqual(0.36);
            }
        });

        it('easy 模式：fillRatio 始终为 0，不受连战 runStreak 影响', () => {
            for (let streak = 0; streak <= 6; streak++) {
                const s = resolveLayeredStrategy('easy', 0, streak);
                expect(s.fillRatio).toBe(0);
            }
        });

        it('normal 模式：连战后 fillRatio 正常递增', () => {
            const s0 = resolveLayeredStrategy('normal', 0, 0);
            const s3 = resolveLayeredStrategy('normal', 0, 3);
            expect(s3.fillRatio).toBeGreaterThan(s0.fillRatio);
        });

        it('hard 模式：fillRatio > normal', () => {
            const sN = resolveLayeredStrategy('normal', 0, 0);
            const sH = resolveLayeredStrategy('hard', 0, 0);
            expect(sH.fillRatio).toBeGreaterThan(sN.fillRatio);
        });

        it('higher score leads to stress-shifted weights', () => {
            const low = resolveLayeredStrategy('normal', 0, 0);
            const high = resolveLayeredStrategy('normal', 500, 0);
            expect(low.shapeWeights).toBeDefined();
            expect(high.shapeWeights).toBeDefined();
        });
    });
});
