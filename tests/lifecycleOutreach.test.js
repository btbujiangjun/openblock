/**
 * @vitest-environment jsdom
 *
 * v1.49.x P2-2 — lifecycleOutreach：lifecycle 事件 → push/share/invite 接线
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _clearAllHandlers, emit } from '../web/src/monetization/MonetizationBus.js';
import { attachLifecycleOutreach, detachLifecycleOutreach } from '../web/src/monetization/lifecycleOutreach.js';

beforeEach(() => {
    _clearAllHandlers();
    try { localStorage.clear(); } catch {}
    detachLifecycleOutreach();
});

afterEach(() => {
    detachLifecycleOutreach();
});

describe('lifecycleOutreach', () => {
    it('attach 是幂等的', () => {
        const u1 = attachLifecycleOutreach();
        const u2 = attachLifecycleOutreach(); // 第二次调用应直接返回 detach
        expect(typeof u1).toBe('function');
        expect(typeof u2).toBe('function');
    });

    it('emit lifecycle:churn_high 不抛异常（push 不可用时静默）', () => {
        attachLifecycleOutreach();
        expect(() => {
            emit('lifecycle:churn_high', { level: 'high', unifiedRisk: 0.6 });
        }).not.toThrow();
    });

    it('emit lifecycle:first_purchase 不抛异常（shareCardGenerator 可缺）', () => {
        attachLifecycleOutreach();
        expect(() => {
            emit('lifecycle:first_purchase', { productId: 'starter_pack', price: 1 });
        }).not.toThrow();
    });
});
