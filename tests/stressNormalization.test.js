/**
 * v1.55.17 stress 对外归一化（B-Clean）契约测试
 *
 * 单元覆盖：
 *   - normalizeStress / denormalizeStress 函数级正确性、边界与对称性
 *   - resolveAdaptiveStrategy 返回的 _adaptiveStress 必落入 [0, 1]
 *   - _adaptiveStressRaw 保留 raw 域 [-0.2, 1]，且与归一化等式相符
 *   - stressMeter 入口语义：STRESS_LEVELS 阈值切到 norm 域后档位一一映射
 */

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    normalizeStress,
    denormalizeStress,
    STRESS_NORM_OFFSET,
    STRESS_NORM_SCALE,
    resolveAdaptiveStrategy,
    resetAdaptiveMilestone,
} from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { STRESS_LEVELS, getStressLevel } from '../web/src/stressMeter.js';

describe('normalizeStress / denormalizeStress（v1.55.17）', () => {
    it('常量保持文档承诺的 0.2 / 1.2', () => {
        expect(STRESS_NORM_OFFSET).toBe(0.2);
        expect(STRESS_NORM_SCALE).toBe(1.2);
    });

    it('关键锚点：-0.2 → 0、baseline 0 → 1/6、上界 1 → 1', () => {
        expect(normalizeStress(-0.2)).toBeCloseTo(0, 6);
        expect(normalizeStress(0)).toBeCloseTo(1 / 6, 6);
        expect(normalizeStress(1)).toBeCloseTo(1, 6);
    });

    it('常用阈值映射符合文档', () => {
        expect(normalizeStress(0.5)).toBeCloseTo(0.5833, 4);
        expect(normalizeStress(0.7)).toBeCloseTo(0.75, 6);
        expect(normalizeStress(0.79)).toBeCloseTo(0.825, 6);
        expect(normalizeStress(0.85)).toBeCloseTo(0.875, 6);
        expect(normalizeStress(0.325)).toBeCloseTo(0.4375, 6); // _stressTarget 中性锚
    });

    it('超界输入被夹到 [0, 1]', () => {
        expect(normalizeStress(-5)).toBe(0);
        expect(normalizeStress(99)).toBe(1);
        expect(normalizeStress(NaN)).toBe(0);
        expect(normalizeStress(undefined)).toBe(0);
    });

    it('denormalize 是 normalize 的左逆（raw 在 [-0.2, 1] 时往返一致）', () => {
        for (const raw of [-0.2, -0.1, 0, 0.1, 0.3, 0.5, 0.7, 0.85, 1.0]) {
            const round = denormalizeStress(normalizeStress(raw));
            expect(round).toBeCloseTo(raw, 6);
        }
    });

    it('denormalize 的越界保护：输入 0/1 直接落回 raw 端点', () => {
        expect(denormalizeStress(0)).toBeCloseTo(-0.2, 6);
        expect(denormalizeStress(1)).toBeCloseTo(1, 6);
        expect(denormalizeStress(NaN)).toBe(0);
    });
});

describe('resolveAdaptiveStrategy 对外字段域契约', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    function makeProfile(overrides = {}) {
        const p = new PlayerProfile(15);
        if (overrides.smoothSkill != null) p._smoothSkill = overrides.smoothSkill;
        if (overrides.lifetimeGames != null) p._totalLifetimeGames = overrides.lifetimeGames;
        if (overrides.lifetimePlacements != null) p._totalLifetimePlacements = overrides.lifetimePlacements;
        return p;
    }

    it('_adaptiveStress 始终落在 [0, 1]', () => {
        for (const score of [0, 100, 500, 1500, 3000, 8000, 15000]) {
            const s = resolveAdaptiveStrategy('normal', makeProfile({ lifetimeGames: 5, lifetimePlacements: 100 }), score, 0, 0.3);
            expect(typeof s._adaptiveStress).toBe('number');
            expect(s._adaptiveStress).toBeGreaterThanOrEqual(0);
            expect(s._adaptiveStress).toBeLessThanOrEqual(1);
        }
    });

    it('_adaptiveStressRaw 保留 raw 域 [-0.2, 1]，且与 _adaptiveStress 满足 normalize 关系', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile({ lifetimeGames: 5 }), 500, 0, 0.3);
        expect(typeof s._adaptiveStressRaw).toBe('number');
        expect(s._adaptiveStressRaw).toBeGreaterThanOrEqual(-0.2);
        expect(s._adaptiveStressRaw).toBeLessThanOrEqual(1);
        expect(s._adaptiveStress).toBeCloseTo(normalizeStress(s._adaptiveStressRaw), 6);
    });

    it('_stressTarget 也在 norm 域（中性锚 ≈ 0.4375）', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 100, 0, 0.3);
        expect(s._stressTarget).toBeCloseTo(0.4375, 4);
        expect(s._stressTargetRaw).toBeCloseTo(0.325, 6);
    });
});

describe('stressMeter STRESS_LEVELS 与归一化阈值一一映射', () => {
    it('档位边界与 norm 公式一致（左闭右开）', () => {
        const expected = [
            { id: 'calm',    minNorm: -Infinity, maxNorm: normalizeStress(-0.05) },
            { id: 'easy',    minNorm: normalizeStress(-0.05), maxNorm: normalizeStress(0.20) },
            { id: 'flow',    minNorm: normalizeStress(0.20), maxNorm: normalizeStress(0.45) },
            { id: 'engaged', minNorm: normalizeStress(0.45), maxNorm: normalizeStress(0.65) },
            { id: 'tense',   minNorm: normalizeStress(0.65), maxNorm: normalizeStress(0.80) },
            { id: 'intense', minNorm: normalizeStress(0.80), maxNorm: Infinity },
        ];
        for (const exp of expected) {
            const lv = STRESS_LEVELS.find((l) => l.id === exp.id);
            expect(lv).toBeTruthy();
            if (Number.isFinite(exp.minNorm)) expect(lv.min).toBeCloseTo(exp.minNorm, 3);
            else expect(lv.min).toBe(exp.minNorm);
            if (Number.isFinite(exp.maxNorm)) expect(lv.max).toBeCloseTo(exp.maxNorm, 3);
            else expect(lv.max).toBe(exp.maxNorm);
        }
    });

    it('给定一系列归一化 stress，档位归属符合直觉', () => {
        expect(getStressLevel(0).id).toBe('calm');           // raw -0.2 ~ norm 0
        expect(getStressLevel(0.10).id).toBe('calm');        // norm < 0.125
        expect(getStressLevel(0.20).id).toBe('easy');        // 0.125 ≤ x < 0.333
        expect(getStressLevel(0.40).id).toBe('flow');        // 0.333 ≤ x < 0.542
        expect(getStressLevel(0.60).id).toBe('engaged');     // 0.542 ≤ x < 0.708
        expect(getStressLevel(0.75).id).toBe('tense');       // 0.708 ≤ x < 0.833 (raw 0.7=norm 0.75)
        expect(getStressLevel(0.90).id).toBe('intense');     // ≥ 0.833
    });
});
