/**
 * @vitest-environment jsdom
 *
 * 覆盖 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P0-3：retentionAnalyzer 的
 * cohort/funnel/趋势三处口径修复。
 *
 *   1) Set users 序列化往返
 *   2) per-user cohort：装机 < period 天的用户不计入 eligible
 *   3) calculateFunnel 直接读 users.size（不依赖 uniqueUsers 字段）
 *   4) getRetentionTrend 不再返回随机模拟值
 */
import { describe, it, expect, beforeEach } from 'vitest';

const mockStorage = {};
Object.defineProperty(globalThis, 'localStorage', {
    value: {
        getItem: (k) => mockStorage[k] ?? null,
        setItem: (k, v) => { mockStorage[k] = v; },
        removeItem: (k) => { delete mockStorage[k]; },
        clear: () => { Object.keys(mockStorage).forEach((k) => delete mockStorage[k]); },
    },
    writable: true,
});

import {
    getRetentionAnalyzer,
    _resetRetentionAnalyzerForTests,
} from '../web/src/monetization/retentionAnalyzer.js';

beforeEach(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    _resetRetentionAnalyzerForTests();
});

describe('P0-3 retentionAnalyzer 修复', () => {
    it('Set users 序列化往返：写入 → 重启 → recordConversion 仍可工作', () => {
        const a = getRetentionAnalyzer();
        a.init();
        a.recordConversion('iap_purchase', 'user_a', { value: 10 });
        a.recordConversion('iap_purchase', 'user_b', { value: 20 });
        expect(a.getConversionData().iap_purchase.uniqueUsers).toBe(2);
        /* 模拟重启：清单例缓存，重新 init 后从 mockStorage 读 */
        _resetRetentionAnalyzerForTests();
        const b = getRetentionAnalyzer();
        b.init();
        expect(b.getConversionData().iap_purchase.uniqueUsers).toBe(2);
        b.recordConversion('iap_purchase', 'user_c', { value: 5 });
        expect(b.getConversionData().iap_purchase.uniqueUsers).toBe(3);
    });

    it('per-user cohort：user 装机 < period 天不计入 eligible', () => {
        const a = getRetentionAnalyzer();
        a.init();
        a.recordSession('fresh-user');
        const d7 = a.getRetentionRate(7);
        /* fresh-user 才装机不到 1 天，d7 cohort 应为 0 而不是 100 */
        expect(d7.total).toBe(0);
        expect(d7.rate).toBe(0);
    });

    it('calculateFunnel 直接读 users.size，不依赖 uniqueUsers 字段', () => {
        const a = getRetentionAnalyzer();
        a.init();
        a.recordConversion('register', 'u1');
        a.recordConversion('register', 'u2');
        a.recordConversion('game_start', 'u1');
        const funnel = a.calculateFunnel([
            { name: '注册', event: 'register' },
            { name: '首局', event: 'game_start' },
        ]);
        expect(funnel.steps[0].users).toBe(2);
        expect(funnel.steps[1].users).toBe(1);
        expect(funnel.steps[1].conversionRate).toBe(50);
    });

    it('getRetentionTrend 不再返回随机模拟值', () => {
        const a = getRetentionAnalyzer();
        a.init();
        const empty = a.getRetentionTrend();
        expect(empty).toEqual([]);

        a.recordSession('persistent-user');
        const trend = a.getRetentionTrend();
        expect(Array.isArray(trend)).toBe(true);
        expect(trend.length).toBe(7);
        for (const point of trend) {
            expect(point).toHaveProperty('d1');
            expect(point).toHaveProperty('d7');
            expect(point).toHaveProperty('d30');
            /* 数据应是确定性的 0–100，绝不是 Math.random() 漂移 */
            for (const k of ['d1', 'd7', 'd30']) {
                expect(point[k]).toBeGreaterThanOrEqual(0);
                expect(point[k]).toBeLessThanOrEqual(100);
            }
        }
    });
});
