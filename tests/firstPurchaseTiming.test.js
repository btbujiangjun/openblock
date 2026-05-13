/**
 * @vitest-environment jsdom
 *
 * v1.49.x P3-3 — evaluateFirstPurchaseTimingSignal 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    evaluateFirstPurchaseTimingSignal,
    invalidateFunnelCache,
    setFirstPurchaseTimingPolicy,
} from '../web/src/retention/firstPurchaseFunnel.js';

beforeEach(() => {
    try { localStorage.clear(); } catch {}
    invalidateFunnelCache();
});

afterEach(() => {
    setFirstPurchaseTimingPolicy(null);
});

describe('evaluateFirstPurchaseTimingSignal', () => {
    it('在推荐 offer 窗口内 + 高 confidence + 高 flow → 触发', () => {
        const r = evaluateFirstPurchaseTimingSignal({
            daysSinceInstall: 5,
            totalGames: 30,
            confidence: 0.7,
            flowState: 0.7,
            frustrationLevel: 0.1,
        });
        expect(r.trigger).toBe(true);
        expect(r.reason).toBe('rule');
        expect(r.recommendedOfferId).toBeTruthy();
    });

    it('窗口外 → 不触发', () => {
        const r = evaluateFirstPurchaseTimingSignal({
            daysSinceInstall: 0,
            totalGames: 1,
            confidence: 1,
            flowState: 1,
            frustrationLevel: 0,
        });
        expect(r.trigger).toBe(false);
    });

    it('confidence 低 → 不触发', () => {
        const r = evaluateFirstPurchaseTimingSignal({
            daysSinceInstall: 5,
            totalGames: 30,
            confidence: 0.3,
            flowState: 0.8,
            frustrationLevel: 0.1,
        });
        expect(r.trigger).toBe(false);
    });

    it('注入 RL policy 优先', () => {
        setFirstPurchaseTimingPolicy(() => ({ trigger: true, score: 0.99, reason: 'mock', recommendedOfferId: 'mock_offer' }));
        const r = evaluateFirstPurchaseTimingSignal({ daysSinceInstall: 0, totalGames: 0, confidence: 0, flowState: 0 });
        expect(r.trigger).toBe(true);
        expect(r.reason).toBe('mock');
        expect(r.recommendedOfferId).toBe('mock_offer');
    });
});
