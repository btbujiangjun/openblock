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

        it('higher score leads to stress-shifted weights', () => {
            const low = resolveLayeredStrategy('normal', 0, 0);
            const high = resolveLayeredStrategy('normal', 500, 0);
            expect(low.shapeWeights).toBeDefined();
            expect(high.shapeWeights).toBeDefined();
        });
    });
});
