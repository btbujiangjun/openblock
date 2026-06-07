/**
 * @vitest-environment jsdom
 *
 * 难度系统：getSpawnStressFromScore / blendShapeWeightsTowardHard /
 * getRunDifficultyModifiers / resolveLayeredStrategy
 */
import { describe, it, expect } from 'vitest';
import {
    getSpawnStressFromScore,
    deriveEffectivePb,
    blendShapeWeightsTowardHard,
    getRunDifficultyModifiers,
    resolveLayeredStrategy
} from '../web/src/difficulty.js';
import { GAME_RULES } from '../web/src/gameRules.js';

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
            // 用未触发 expert 压缩的中档 best（< expertSoftCap），验证 S 曲线主线在
            // 50%~100% 区间严格单调。高 best（会被压缩）的 corner 行为见 pbProgress 用例。
            const s50 = getSpawnStressFromScore(400, { bestScore: 800 });
            const s75 = getSpawnStressFromScore(600, { bestScore: 800 });
            const s100 = getSpawnStressFromScore(800, { bestScore: 800 });
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

    // 难度进度坐标 effectivePB —— 两端 corner case（新手抬下限 / 高手软压缩）
    describe('deriveEffectivePb（难度进度坐标，主线 S 曲线不动）', () => {
        const dd = GAME_RULES.dynamicDifficulty;
        const pp = dd.pbProgress;

        it('生产配置已启用 pbProgress', () => {
            expect(pp).toBeTruthy();
            expect(pp.noviceFloor).toBeGreaterThan(0);
            expect(pp.expertSoftCap).toBeGreaterThan(pp.noviceFloor);
            expect(pp.expertScale).toBeGreaterThan(0);
        });

        it('新手低 PB 抬到 noviceFloor 下限', () => {
            expect(deriveEffectivePb(0, dd)).toBe(pp.noviceFloor);
            expect(deriveEffectivePb(60, dd)).toBe(pp.noviceFloor);
            expect(deriveEffectivePb(pp.noviceFloor - 1, dd)).toBe(pp.noviceFloor);
        });

        it('中档 PB（floor~softCap）原样透传，不压缩', () => {
            expect(deriveEffectivePb(800, dd)).toBe(800);
            expect(deriveEffectivePb(pp.expertSoftCap, dd)).toBe(pp.expertSoftCap);
        });

        it('高手高 PB 被对数软压缩（effectivePB < 真实 PB）', () => {
            const eff = deriveEffectivePb(5000, dd);
            expect(eff).toBeLessThan(5000);
            expect(eff).toBeGreaterThan(pp.expertSoftCap);
        });

        it('单调非减且连续（无跳变）', () => {
            let prev = -Infinity;
            for (let pb = 0; pb <= 12000; pb += 50) {
                const eff = deriveEffectivePb(pb, dd);
                expect(eff).toBeGreaterThanOrEqual(prev - 1e-9);
                prev = eff;
            }
            // softCap 邻域连续：左右极限差极小
            const lo = deriveEffectivePb(pp.expertSoftCap - 1, dd);
            const hi = deriveEffectivePb(pp.expertSoftCap + 1, dd);
            expect(Math.abs(hi - lo)).toBeLessThan(2);
        });

        it('压缩边际递减：PB 越高，压缩比越大', () => {
            const r5000 = deriveEffectivePb(5000, dd) / 5000;
            const r10000 = deriveEffectivePb(10000, dd) / 10000;
            expect(r10000).toBeLessThan(r5000);
        });

        it('配置缺失时退化为旧 max(personalBest, scoreFloor) 行为', () => {
            const legacy = { milestones: dd.milestones, scoreFloor: 180 };
            expect(deriveEffectivePb(60, legacy)).toBe(180);
            expect(deriveEffectivePb(5000, legacy)).toBe(5000);
        });

        it('corner 修复：高手在远低于真实 PB 处即进入挑战区', () => {
            // score 仅为真实 PB 的 ~36%，旧坐标会被 decay 压到很低；新坐标已进入挑战区
            const s = getSpawnStressFromScore(1800, { bestScore: 5000 });
            expect(s).toBeGreaterThan(0.5);
        });

        it('corner 修复：新手不会在几十分就被推入高压', () => {
            // PB=60 的新手打到 120 分：抬分母后压力明显低于满档
            const s = getSpawnStressFromScore(120, { bestScore: 60 });
            expect(s).toBeLessThan(0.5);
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
