import { describe, it, expect } from 'vitest';
import {
    SPEND_TIERS,
    VALUE_TIERS,
    deriveSpendTier,
    deriveValueTier,
    deriveSegment5,
    deriveLifecycleStage,
    deriveSegments,
} from '../web/src/segmentation.js';

describe('segmentation SSOT — spend tier', () => {
    it('maps spend to nonpayer/minnow/dolphin/whale', () => {
        expect(deriveSpendTier(0).id).toBe('nonpayer');
        expect(deriveSpendTier(5).id).toBe('minnow');
        expect(deriveSpendTier(49.99).id).toBe('minnow');
        expect(deriveSpendTier(50).id).toBe('dolphin');
        expect(deriveSpendTier(499).id).toBe('dolphin');
        expect(deriveSpendTier(500).id).toBe('whale');
        expect(deriveSpendTier(9999).id).toBe('whale');
    });

    it('handles invalid / negative input safely', () => {
        expect(deriveSpendTier(NaN).id).toBe('nonpayer');
        expect(deriveSpendTier(-100).id).toBe('nonpayer');
        expect(deriveSpendTier(undefined).id).toBe('nonpayer');
    });
});

describe('segmentation SSOT — value tier (adTrigger/VIP 联动)', () => {
    it('maps spend to T0..T5 monotonically', () => {
        expect(deriveValueTier(0).id).toBe('T0');
        expect(deriveValueTier(5).id).toBe('T1');
        expect(deriveValueTier(10).id).toBe('T2');
        expect(deriveValueTier(50).id).toBe('T3');
        expect(deriveValueTier(200).id).toBe('T4');
        expect(deriveValueTier(1000).id).toBe('T5');
    });

    it('LTV-shield 命中 T2+ 一定带去广告权益', () => {
        for (const spend of [10, 50, 200, 1000]) {
            const t = deriveValueTier(spend);
            expect(['T2', 'T3', 'T4', 'T5']).toContain(t.id);
            expect(t.benefits.length).toBeGreaterThan(0);
        }
        expect(deriveValueTier(5).benefits).not.toContain('ad_removal_all');
    });

    it('tiers are sorted descending by threshold (config integrity)', () => {
        for (let i = 1; i < VALUE_TIERS.length; i++) {
            expect(VALUE_TIERS[i - 1].min).toBeGreaterThanOrEqual(VALUE_TIERS[i].min);
        }
        for (let i = 1; i < SPEND_TIERS.length; i++) {
            expect(SPEND_TIERS[i - 1].min).toBeGreaterThanOrEqual(SPEND_TIERS[i].min);
        }
    });
});

describe('segmentation SSOT — segment5', () => {
    it('non-payer mass → A', () => {
        expect(deriveSegment5({ spend: 0, engagement: 0.2, skill: 0.2 })).toBe('A');
    });
    it('non-payer high skill+engagement → E', () => {
        expect(deriveSegment5({ spend: 0, engagement: 0.8, skill: 0.8 })).toBe('E');
    });
    it('light spender organic → B, paid → D', () => {
        expect(deriveSegment5({ spend: 10, isPaidChannel: false })).toBe('B');
        expect(deriveSegment5({ spend: 10, isPaidChannel: true })).toBe('D');
    });
    it('high spender → C / paid whale → D', () => {
        expect(deriveSegment5({ spend: 80 })).toBe('C');
        expect(deriveSegment5({ spend: 300, isPaidChannel: false })).toBe('C');
        expect(deriveSegment5({ spend: 300, isPaidChannel: true })).toBe('D');
    });
});

describe('segmentation SSOT — lifecycle stage', () => {
    it('classifies by install age and idle recency', () => {
        expect(deriveLifecycleStage({ daysSinceInstall: 0 })).toBe('new');
        expect(deriveLifecycleStage({ daysSinceInstall: 4 })).toBe('exploration');
        expect(deriveLifecycleStage({ daysSinceInstall: 20 })).toBe('growth');
        expect(deriveLifecycleStage({ daysSinceInstall: 200, totalSessions: 500 })).toBe('mature');
        expect(deriveLifecycleStage({ daysSinceInstall: 200, daysSinceActive: 10 })).toBe('at_risk');
        expect(deriveLifecycleStage({ daysSinceInstall: 200, daysSinceActive: 40 })).toBe('churned');
    });
});

describe('segmentation SSOT — aggregate', () => {
    it('returns consistent canonical labels in one call', () => {
        const seg = deriveSegments({
            spend: 220, engagement: 0.7, skill: 0.6, isPaidChannel: true,
            daysSinceInstall: 60, daysSinceActive: 1, totalSessions: 300,
        });
        expect(seg.spendTier).toBe('dolphin');
        expect(seg.valueTier).toBe('T4');
        expect(seg.segment5).toBe('D');
        expect(seg.lifecycleStage).toBe('mature');
        expect(seg.isPayer).toBe(true);
        expect(seg.valueBenefits).toContain('ad_removal_all');
    });
});
