/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P2-2 — priceElasticityModel 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    PRICE_ELASTICITY_SCHEMA_VERSION,
    _resetPriceElasticityForTests,
    getPriceElasticityMeta,
    recommendDiscount,
    setDemandCurve,
} from '../web/src/monetization/ml/priceElasticityModel.js';

beforeEach(() => _resetPriceElasticityForTests());
afterEach(() => _resetPriceElasticityForTests());

describe('recommendDiscount', () => {
    it('返回结构完整', () => {
        const out = recommendDiscount({ stageCode: 'S0', riskBucket: 'mid', basePrice: 6 });
        expect(out).toHaveProperty('discount');
        expect(out).toHaveProperty('expectedRevenue');
        expect(out).toHaveProperty('expectedBuyProb');
        expect(out).toHaveProperty('group');
        expect(out.candidates.length).toBeGreaterThan(0);
    });

    it('default groups: discount ∈ [0, 0.5]', () => {
        const out = recommendDiscount({ stageCode: 'S2', riskBucket: 'high', basePrice: 6 });
        expect(out.discount).toBeGreaterThanOrEqual(0);
        expect(out.discount).toBeLessThanOrEqual(0.5);
    });

    it('未注入模型 → fromModel=false', () => {
        const out = recommendDiscount({ stageCode: 'S0', riskBucket: 'low' });
        expect(out.fromModel).toBe(false);
    });

    it('注入模型后 fromModel=true', () => {
        setDemandCurve({
            schemaVersion: PRICE_ELASTICITY_SCHEMA_VERSION,
            groups: { 'S0:low': { alpha: -0.5, beta: 0, baselineP: 0.05, recommendedDiscount: 0.10 } },
        });
        const out = recommendDiscount({ stageCode: 'S0', riskBucket: 'low' });
        expect(out.fromModel).toBe(true);
    });

    it('未知 group 退回 S2:mid', () => {
        const out = recommendDiscount({ stageCode: 'XX', riskBucket: 'YY' });
        expect(out.group).toBe('XX:YY');
        expect(out.expectedBuyProb).toBeGreaterThan(0);
    });
});

describe('setDemandCurve', () => {
    it('schema 错误 → false', () => {
        expect(setDemandCurve({ schemaVersion: 999, groups: {} })).toBe(false);
    });

    it('空 groups → false', () => {
        expect(setDemandCurve({
            schemaVersion: PRICE_ELASTICITY_SCHEMA_VERSION,
            groups: {},
        })).toBe(false);
    });

    it('成功后 meta.isDefault=false', () => {
        setDemandCurve({
            schemaVersion: PRICE_ELASTICITY_SCHEMA_VERSION,
            groups: { 'S0:low': { alpha: -0.5, beta: 0, baselineP: 0.05, recommendedDiscount: 0.10 } },
            fittedAt: 12345,
            source: 'unit-test',
        });
        expect(getPriceElasticityMeta().isDefault).toBe(false);
    });
});
