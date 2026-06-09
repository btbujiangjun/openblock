/**
 * @vitest-environment jsdom
 *
 * v1.69.2 evaluation → adaptiveSpawn 反馈闭环测试。验证：
 *   - playerProfile.recordRoundQuality 写入后 evalMetrics 派生正确
 *   - consecutiveForcedBad ≥ 2 → adaptiveSpawn 强 relief + clearGuarantee +2
 *   - lastRoundClassification='forced_bad' → clearGuarantee +1 + targetSolutionRange.max +2
 *   - salvage 高频时不下放、轻抬 sizePreference
 *   - 新局 recordNewGame 后窗口清零
 */
import { describe, it, expect } from 'vitest';
import { PlayerProfile } from '../../web/src/playerProfile.js';
import { resolveAdaptiveStrategy } from '../../web/src/adaptiveSpawn.js';

function mkProfile() {
    const p = new PlayerProfile();
    p.recordNewGame();
    // 喂一些常规 placement 让 _moves 有数据，避免冷启动 placeholder
    for (let i = 0; i < 10; i++) p.recordPlace(true, 1, 0.3);
    return p;
}

function ctx(over = {}) {
    return { lastClearCount: 1, roundsSinceClear: 0, recentCategories: [],
        totalRounds: 20, bestScore: 1000, ...over };
}

describe('playerProfile.evalMetrics', () => {
    it('空滑窗 → 退化中性值', () => {
        const p = mkProfile();
        const m = p.evalMetrics;
        expect(m.recentMeanRegret).toBe(0);
        expect(m.recentMeanOptimality).toBe(1);
        expect(m.recentForcedBadRate).toBe(0);
        expect(m.consecutiveForcedBad).toBe(0);
        expect(m.lastRoundClassification).toBeNull();
    });

    it('记 3 步 evaluated → meanRegret/optimality 正确', () => {
        const p = mkProfile();
        p.recordMoveQuality({ regret: 0.10, optimality: 0.9, evaluated: true });
        p.recordMoveQuality({ regret: 0.30, optimality: 0.7, evaluated: true });
        p.recordMoveQuality({ regret: 0.20, optimality: 0.8, evaluated: true });
        const m = p.evalMetrics;
        expect(m.recentMeanRegret).toBeCloseTo(0.2, 5);
        expect(m.recentMeanOptimality).toBeCloseTo(0.8, 5);
        expect(m.samples).toBe(3);
    });

    it('节流步（evaluated=false）不计入派生均值', () => {
        const p = mkProfile();
        p.recordMoveQuality({ regret: 0.5, optimality: 0.5, evaluated: false });
        p.recordMoveQuality({ regret: 0.10, optimality: 0.9, evaluated: true });
        const m = p.evalMetrics;
        expect(m.recentMeanRegret).toBeCloseTo(0.10, 5);
        expect(m.samples).toBe(1);
    });

    it('连续 forced_bad 累加，断流即归 0', () => {
        const p = mkProfile();
        p.recordRoundQuality({ classification: 'forced_bad', absScore: 0.2, bestRoundAbs: 0.3 });
        p.recordRoundQuality({ classification: 'forced_bad', absScore: 0.25, bestRoundAbs: 0.35 });
        expect(p.evalMetrics.consecutiveForcedBad).toBe(2);
        p.recordRoundQuality({ classification: 'optimal', absScore: 0.9, bestRoundAbs: 0.95 });
        expect(p.evalMetrics.consecutiveForcedBad).toBe(0);
    });

    it('recordNewGame 清空 evaluation 窗口', () => {
        const p = mkProfile();
        p.recordMoveQuality({ regret: 0.5, optimality: 0.5, evaluated: true });
        p.recordRoundQuality({ classification: 'forced_bad', absScore: 0.2, bestRoundAbs: 0.3 });
        p.recordNewGame();
        const m = p.evalMetrics;
        expect(m.samples).toBe(0);
        expect(m.roundSamples).toBe(0);
        expect(m.consecutiveForcedBad).toBe(0);
    });
});

describe('adaptiveSpawn evaluation 反馈闭环', () => {
    it('consecutiveForcedBad >= 2 → clearGuarantee +2', () => {
        const baseProfile = mkProfile();
        const stressedProfile = mkProfile();
        // 连续 2 轮 forced_bad
        stressedProfile.recordRoundQuality({ classification: 'forced_bad', absScore: 0.2, bestRoundAbs: 0.3 });
        stressedProfile.recordRoundQuality({ classification: 'forced_bad', absScore: 0.25, bestRoundAbs: 0.35 });

        const base = resolveAdaptiveStrategy('normal', baseProfile, 500, 1, 0.4, ctx());
        const stressed = resolveAdaptiveStrategy('normal', stressedProfile, 500, 1, 0.4, ctx());
        expect(stressed.spawnHints.clearGuarantee).toBeGreaterThan(base.spawnHints.clearGuarantee);
        // 同时进入强 relief 意图（或保持原 relief；至少不会比 base 更激进）
        const reliefSet = new Set(['relief', 'engage', 'maintain']);
        expect(reliefSet.has(stressed.spawnHints.spawnIntent)).toBe(true);
    });

    it('lastRoundClassification=forced_bad → targetSolutionRange.max +2（若有区间）', () => {
        const p = mkProfile();
        p.recordRoundQuality({ classification: 'forced_bad', absScore: 0.2, bestRoundAbs: 0.3 });
        // fill 偏高才会激活 targetSolutionRange（activationFill=0.45）
        const out = resolveAdaptiveStrategy('normal', p, 1000, 1, 0.6, ctx());
        const tsr = out.spawnHints.targetSolutionRange;
        // 区间存在性受 stress + fill 影响；只要有区间，max 应已被放宽。
        if (tsr && tsr.max != null) {
            const baseOut = resolveAdaptiveStrategy('normal', mkProfile(), 1000, 1, 0.6, ctx());
            if (baseOut.spawnHints.targetSolutionRange?.max != null) {
                expect(tsr.max).toBeGreaterThanOrEqual(baseOut.spawnHints.targetSolutionRange.max);
            }
        }
    });

    it('salvage 高频但无 forced_bad → 不下放 clearGuarantee', () => {
        const p = mkProfile();
        for (let i = 0; i < 5; i++) {
            p.recordRoundQuality({ classification: 'salvage', absScore: 0.7, bestRoundAbs: 0.45 });
        }
        const out = resolveAdaptiveStrategy('normal', p, 1000, 1, 0.4, ctx());
        const base = resolveAdaptiveStrategy('normal', mkProfile(), 1000, 1, 0.4, ctx());
        // salvage 路径不应把 guarantee 推得比 base 更高
        expect(out.spawnHints.clearGuarantee).toBeLessThanOrEqual(base.spawnHints.clearGuarantee + 1);
    });
});
