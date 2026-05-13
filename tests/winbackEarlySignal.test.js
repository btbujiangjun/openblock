/**
 * @vitest-environment jsdom
 *
 * v1.49.x P3-1 — evaluateEarlyWinbackSignal 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    EARLY_WINBACK_CONFIDENCE_MAX,
    EARLY_WINBACK_FRUSTRATION_MIN,
    _resetWinbackForTests,
    evaluateEarlyWinbackSignal,
    setEarlyWinbackPolicy,
} from '../web/src/retention/winbackProtection.js';

beforeEach(() => {
    _resetWinbackForTests();
    try { localStorage.clear(); } catch {}
});

afterEach(() => {
    setEarlyWinbackPolicy(null);
});

describe('evaluateEarlyWinbackSignal — 规则版', () => {
    it('confidence 高 + frustration 低 → 不触发', () => {
        const r = evaluateEarlyWinbackSignal({
            confidence: 0.8,
            frustrationLevel: 0.1,
            missRate: 0.1,
            daysSinceLastActive: 0,
        });
        expect(r.trigger).toBe(false);
        expect(r.reason).toBeNull();
        expect(r.score).toBeGreaterThanOrEqual(0);
    });

    it('confidence 弱 + frustration 高 → 触发 rule', () => {
        const r = evaluateEarlyWinbackSignal({
            confidence: EARLY_WINBACK_CONFIDENCE_MAX - 0.05,
            frustrationLevel: EARLY_WINBACK_FRUSTRATION_MIN + 0.1,
            missRate: 0.2,
            daysSinceLastActive: 0,
        });
        expect(r.trigger).toBe(true);
        expect(r.reason).toBe('rule');
        expect(r.score).toBeGreaterThan(0.3);
    });

    it('已经满足真实 winback (≥7 天) → 提前信号关闭', () => {
        const r = evaluateEarlyWinbackSignal({
            confidence: 0.1,
            frustrationLevel: 0.9,
            missRate: 0.9,
            daysSinceLastActive: 8,
        });
        expect(r.trigger).toBe(false);
    });
});

describe('setEarlyWinbackPolicy — RL 接口', () => {
    it('注入 policy 时优先于规则版', () => {
        setEarlyWinbackPolicy(() => ({ trigger: true, reason: 'mock_rl', score: 0.42 }));
        const r = evaluateEarlyWinbackSignal({ confidence: 1, frustrationLevel: 0, missRate: 0, daysSinceLastActive: 0 });
        expect(r.trigger).toBe(true);
        expect(r.reason).toBe('mock_rl');
        expect(r.score).toBeCloseTo(0.42, 2);
    });

    it('policy 抛异常时回落规则版', () => {
        setEarlyWinbackPolicy(() => { throw new Error('boom'); });
        const r = evaluateEarlyWinbackSignal({ confidence: 0.9, frustrationLevel: 0, missRate: 0, daysSinceLastActive: 0 });
        expect(r.trigger).toBe(false);
    });
});
