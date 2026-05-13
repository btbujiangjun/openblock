/**
 * @vitest-environment jsdom
 *
 * v1.49.x P1-4 — abilitySegment（prudent / speed / strategic / impulsive / balanced）
 */
import { describe, expect, it } from 'vitest';
import { getAbilitySegment, getAbilitySegmentMeta } from '../web/src/monetization/personalization.js';

describe('getAbilitySegment', () => {
    const baseMetrics = { samples: 20, missRate: 0.05, pickToPlaceMs: 1500, thinkMs: 2000 };

    it('样本不足 → balanced（避免冷启动错配）', () => {
        const ab = { boardPlanning: 0.9, confidence: 0.9 };
        expect(getAbilitySegment(ab, { samples: 3, thinkMs: 2500 })).toBe('balanced');
    });

    it('boardPlanning 高 + thinkMs 长 + confidence 高 → strategic', () => {
        const ab = { boardPlanning: 0.7, confidence: 0.65, controlScore: 0.6 };
        expect(getAbilitySegment(ab, { ...baseMetrics, thinkMs: 2500 })).toBe('strategic');
    });

    it('boardPlanning 中高 + risk 低 + miss 低 → prudent', () => {
        const ab = { boardPlanning: 0.6, riskLevel: 0.2, controlScore: 0.4 };
        expect(getAbilitySegment(ab, { ...baseMetrics, missRate: 0.05 })).toBe('prudent');
    });

    it('反应极快 + 控制中等 → speed', () => {
        const ab = { boardPlanning: 0.3, controlScore: 0.6, riskLevel: 0.5, skillScore: 0.5 };
        expect(getAbilitySegment(ab, { ...baseMetrics, pickToPlaceMs: 700, missRate: 0.15 })).toBe('speed');
    });

    it('低规划 + miss 高 → impulsive', () => {
        const ab = { boardPlanning: 0.2, controlScore: 0.3, riskLevel: 0.7, skillScore: 0.3 };
        expect(getAbilitySegment(ab, { ...baseMetrics, missRate: 0.25 })).toBe('impulsive');
    });

    it('元数据齐全（icon/label/color）', () => {
        for (const seg of ['prudent', 'speed', 'strategic', 'impulsive', 'balanced']) {
            const m = getAbilitySegmentMeta(seg);
            expect(m.icon).toBeTruthy();
            expect(m.label).toBeTruthy();
            expect(m.color).toMatch(/^#/);
        }
    });
});
