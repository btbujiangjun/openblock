/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
    buildCommercialModelVector,
    shouldAllowMonetizationAction
} from '../web/src/monetization/commercialModel.js';

describe('commercialModel', () => {
    it('protects high payer users from interstitial ads', () => {
        const v = buildCommercialModelVector({
            persona: {
                segment: 'whale',
                whaleScore: 0.85,
                activityScore: 0.8,
                skillScore: 0.7,
                nearMissRate: 0.1,
            },
            realtime: { flowState: 'flow', frustration: 1 },
            ltv: { ltv30: 18, confidence: 'high' },
            adFreq: { experienceScore: 95 },
        });

        expect(v.payerScore).toBeGreaterThan(0.6);
        expect(v.guardrail.protectPayer).toBe(true);
        expect(shouldAllowMonetizationAction(v, 'interstitial')).toBe(false);
    });

    it('prefers rewarded ads on near miss and frustration when fatigue is low', () => {
        const v = buildCommercialModelVector({
            persona: {
                segment: 'dolphin',
                whaleScore: 0.35,
                activityScore: 0.5,
                skillScore: 0.45,
                nearMissRate: 0.4,
            },
            realtime: { hadNearMiss: true, frustration: 5, flowState: 'anxious' },
            ltv: { ltv30: 5, confidence: 'medium' },
            adFreq: { experienceScore: 90, rewardedCount: 1, interstitialCount: 0 },
        });

        expect(v.rewardedAdPropensity).toBeGreaterThan(0.5);
        expect(v.recommendedAction).toBe('rewarded_ad');
        expect(shouldAllowMonetizationAction(v, 'rewarded')).toBe(true);
    });

    it('suppresses monetization during ad fatigue recovery', () => {
        const v = buildCommercialModelVector({
            persona: { segment: 'minnow', whaleScore: 0.1, activityScore: 0.2, skillScore: 0.3 },
            realtime: { frustration: 6, flowState: 'anxious' },
            adFreq: { experienceScore: 35, rewardedCount: 12, interstitialCount: 6, inRecoveryPeriod: true },
        });

        expect(v.guardrail.suppressAll).toBe(true);
        expect(v.recommendedAction).toBe('suppress');
        expect(shouldAllowMonetizationAction(v, 'rewarded')).toBe(false);
    });
});
