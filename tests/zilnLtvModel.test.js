/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P2-1 — ZILN-LTV 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    ZILN_SCHEMA_VERSION,
    _resetZilnForTests,
    getZilnMeta,
    predictZilnLtv,
    setZilnParams,
    toLegacyLtvShape,
} from '../web/src/monetization/ml/zilnLtvModel.js';

beforeEach(() => _resetZilnForTests());
afterEach(() => _resetZilnForTests());

describe('predictZilnLtv', () => {
    it('默认参数：ltv30Mean ≥ 0', () => {
        const out = predictZilnLtv([0.5, 0.5, 0.5]);
        expect(out.ltv30Mean).toBeGreaterThanOrEqual(0);
        expect(out.pZero).toBeGreaterThan(0);
        expect(out.pZero).toBeLessThan(1);
    });

    it('注入参数后 ltv30Mean 反映新 μ', () => {
        setZilnParams({
            schemaVersion: ZILN_SCHEMA_VERSION,
            zeroHead: { w: [0, 0], b: -3 },  // p_zero ≈ 0.047
            muHead: { w: [0, 0], b: 2.0 },   // E[amount] ≈ exp(2.0 + 0.32) ≈ 10.2
            sigma: 0.8,
        });
        const out = predictZilnLtv([0.5, 0.5]);
        expect(out.pZero).toBeLessThan(0.1);
        expect(out.ltv30Mean).toBeGreaterThan(8);
    });
});

describe('toLegacyLtvShape', () => {
    it('返回 { ltv30, ltv60, ltv90, confidence } 形态', () => {
        const out = toLegacyLtvShape([0.4, 0.3, 0.2], { channel: 'organic' });
        expect(out).toHaveProperty('ltv30');
        expect(out).toHaveProperty('ltv60');
        expect(out).toHaveProperty('ltv90');
        expect(out.channel).toBe('organic');
        expect(out.zilnDetail).toBeDefined();
    });
});

describe('setZilnParams 校验', () => {
    it('schema 不一致 → false', () => {
        expect(setZilnParams({ schemaVersion: 999 })).toBe(false);
    });

    it('字段缺失 → false', () => {
        expect(setZilnParams({ schemaVersion: ZILN_SCHEMA_VERSION })).toBe(false);
    });

    it('成功后 meta.isDefault=false', () => {
        setZilnParams({
            schemaVersion: ZILN_SCHEMA_VERSION,
            zeroHead: { w: [0], b: 0 },
            muHead: { w: [0], b: 0 },
            sigma: 0.5,
        });
        expect(getZilnMeta().isDefault).toBe(false);
    });
});
