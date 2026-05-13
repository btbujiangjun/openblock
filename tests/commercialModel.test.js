/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
    buildCommercialModelVector,
    shouldAllowMonetizationAction,
    getCommercialChurnRisk01,
} from '../web/src/monetization/commercialModel.js';
import { setFlag } from '../web/src/monetization/featureFlags.js';

beforeEach(() => {
    try { localStorage.clear(); } catch {}
});

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

/* ============================================================================
 * v1.49.x P1-1 — abilityVector → commercialModel 偏置（feature flag 灰度）
 * ============================================================================ */

describe('v1.49.x P1-1 abilityVector → commercialModel', () => {
    it('高规划 + 高自信玩家 IAP 倾向偏置上调；关闭 flag 后退化', () => {
        const baseCtx = {
            persona: { segment: 'dolphin', whaleScore: 0.4, activityScore: 0.6, skillScore: 0.6 },
            realtime: { flowState: 'flow', frustration: 1 },
            ltv: { ltv30: 10, confidence: 'medium' },
            adFreq: { experienceScore: 90 },
        };
        const ability = { boardPlanning: 0.85, confidence: 0.8, clearEfficiency: 0.7, riskLevel: 0.2, skillScore: 0.7 };

        setFlag('abilityCommercial', true);
        const withAbility = buildCommercialModelVector({ ...baseCtx, ability });
        const baseline = buildCommercialModelVector(baseCtx);
        expect(withAbility.iapPropensity).toBeGreaterThan(baseline.iapPropensity);
        expect(withAbility.churnRisk).toBeLessThanOrEqual(baseline.churnRisk);

        setFlag('abilityCommercial', false);
        const withFlagOff = buildCommercialModelVector({ ...baseCtx, ability });
        // 关闭灰度后行为应与 baseline 完全一致
        expect(withFlagOff.iapPropensity).toBeCloseTo(baseline.iapPropensity, 3);
        expect(withFlagOff.churnRisk).toBeCloseTo(baseline.churnRisk, 3);

        setFlag('abilityCommercial', true);
    });

    it('getCommercialChurnRisk01 给 lifecycleSignals 提供 commercial 那条腿', () => {
        const r = getCommercialChurnRisk01({
            persona: { segment: 'minnow', whaleScore: 0.1, activityScore: 0.2, skillScore: 0.3 },
            realtime: { frustration: 5, flowState: 'anxious' },
            adFreq: { experienceScore: 60 },
        });
        expect(r).not.toBeNull();
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThanOrEqual(1);
    });
});
