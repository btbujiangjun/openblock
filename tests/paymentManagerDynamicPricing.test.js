/**
 * @vitest-environment jsdom
 *
 * v1.49.x P1-3 — paymentManager 动态定价矩阵 stage × unifiedRisk
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDynamicPricingBonus, getPaymentManager } from '../web/src/monetization/paymentManager.js';
import { setFlag } from '../web/src/monetization/featureFlags.js';

beforeEach(() => {
    try { localStorage.clear(); } catch {}
    setFlag('dynamicPricing', true);
});
afterEach(() => {
    try { localStorage.clear(); } catch {}
});

describe('getDynamicPricingBonus', () => {
    it('S0 玩家高风险 → 较大额外折扣（≥16）', () => {
        expect(getDynamicPricingBonus('S0', 0.55)).toBeGreaterThanOrEqual(12);
        expect(getDynamicPricingBonus('S0', 0.85)).toBeGreaterThanOrEqual(16);
    });

    it('S3+ 玩家低风险 → 不打折（甚至 -10 缩水）', () => {
        expect(getDynamicPricingBonus('S3+', 0.05)).toBeLessThanOrEqual(0);
    });

    it('S4 沉默回流：默认就比常态高一档', () => {
        expect(getDynamicPricingBonus('S4', 0.0)).toBeGreaterThan(0);
    });

    it('flag off → 0', () => {
        setFlag('dynamicPricing', false);
        expect(getDynamicPricingBonus('S0', 0.85)).toBe(0);
        setFlag('dynamicPricing', true);
    });
});

describe('PaymentManager.calculateDiscountedPrice 动态加成', () => {
    it('lifecycleHints 高风险新手 → 比纯静态折扣价格更低', () => {
        const pm = getPaymentManager();
        // 模拟一个 LIMITED_OFFERS 条目的 product（priceNum）：
        const product = { id: 'starter_pack', priceNum: 100 };
        // 假设当前没有 active offer（不传 offerId） + 新手高风险
        const baseline = pm.calculateDiscountedPrice(product, null, null);
        const dynamic = pm.calculateDiscountedPrice(product, null, { stageCode: 'S0', unifiedRisk01: 0.85 });

        expect(dynamic.dynamicBonus).toBeGreaterThan(0);
        expect(dynamic.discounted).toBeLessThan(baseline.discounted);
        // 总折扣不超 80%（防穿透）
        expect(dynamic.discountPercent).toBeLessThanOrEqual(80);
    });
});
