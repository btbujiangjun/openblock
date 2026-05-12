/**
 * @vitest-environment jsdom
 * firstPurchaseFunnel.test.js - 付费漏斗测试
 */

import { describe, it, expect, beforeEach } from 'vitest';

const mockStorage = {};

Object.defineProperty(globalThis, 'localStorage', {
    value: {
        getItem: (key) => mockStorage[key] ?? null,
        setItem: (key, value) => { mockStorage[key] = value; },
        removeItem: (key) => { delete mockStorage[key]; },
        clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
    },
    writable: true
});

import {
    trackFunnelEvent,
    recordPurchase,
    getRecommendedOffer,
    getFunnelAnalytics
} from '../web/src/retention/firstPurchaseFunnel.js';

describe('First Purchase Funnel', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    describe('trackFunnelEvent', () => {
        it('should track awareness events', () => {
            const result = trackFunnelEvent('view_shop');
            expect(result.currentStage).toBeDefined();
        });

        it('should progress through funnel stages', () => {
            trackFunnelEvent('view_shop');
            trackFunnelEvent('click_product');
            trackFunnelEvent('view_price');
            trackFunnelEvent('add_to_cart');
            const result = trackFunnelEvent('start_checkout');
            expect(['consideration', 'purchase']).toContain(result.currentStage);
        });
    });

    describe('recordPurchase', () => {
        it('should record first purchase', () => {
            const purchase = recordPurchase({
                productId: 'starter_pack',
                price: 1
            });
            expect(purchase.isFirst).toBe(true);
            expect(purchase.price).toBe(1);
        });

        it('should mark second purchase', () => {
            recordPurchase({ productId: 'starter', price: 1 });
            const second = recordPurchase({ productId: 'value', price: 6 });
            expect(second.isFirst).toBe(false);
        });
    });

    describe('getRecommendedOffer', () => {
        it('should return offer based on conditions', () => {
            const offer = getRecommendedOffer(7, 30);
            expect(offer.available).toBeDefined();
        });

        it('should not offer after first purchase', () => {
            recordPurchase({ productId: 'starter', price: 1 });
            const offer = getRecommendedOffer(10, 50);
            expect(offer.available).toBe(false);
        });
    });

    describe('getFunnelAnalytics', () => {
        it('should return analytics data', () => {
            trackFunnelEvent('view_shop');
            trackFunnelEvent('click_product');
            
            const analytics = getFunnelAnalytics();
            expect(analytics.currentStage).toBeDefined();
            expect(analytics.stageConversion).toBeDefined();
            expect(analytics.conversionRate).toBeDefined();
        });
    });
});