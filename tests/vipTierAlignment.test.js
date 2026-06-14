import { describe, it, expect } from 'vitest';
import { getCurrentTier, tierHasBenefit } from '../web/src/retention/vipSystem.js';
import { deriveValueTier } from '../web/src/segmentation.js';

describe('SG-2 VIP↔adTrigger tier alignment', () => {
    it('getCurrentTier 与 segmentation.deriveValueTier 同口径', () => {
        for (const spend of [0, 5, 10, 50, 200, 1000]) {
            expect(getCurrentTier(spend).id).toBe(deriveValueTier(spend).id);
        }
    });

    it('T2+ 命中 adTrigger 护盾正则 ^T[2-5]$', () => {
        const re = /^T[2-5]$/;
        expect(re.test(getCurrentTier(10).id)).toBe(true);
        expect(re.test(getCurrentTier(200).id)).toBe(true);
        expect(re.test(getCurrentTier(5).id)).toBe(false);
        expect(re.test(getCurrentTier(0).id)).toBe(false);
    });

    it('权益自动联动：高 tier 解锁去广告', () => {
        expect(tierHasBenefit('ad_removal_all', 500)).toBe(true);
        expect(tierHasBenefit('ad_removal_all', 5)).toBe(false);
    });

    it('无效输入回退 T0', () => {
        expect(getCurrentTier(-50).id).toBe('T0');
    });
});
