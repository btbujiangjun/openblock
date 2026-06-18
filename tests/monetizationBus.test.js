/**
 * MonetizationBus 可观测性 / 错误处理契约（v1.71 加固）
 *
 * 覆盖：
 *   - 基本订阅 / emit / off / unsubscribe 闭包
 *   - handler 抛错不传染其他 handler
 *   - 失败计数（总数 / 连续数）+ 成功后连续计数清零
 *   - 连续失败 ≥ 5 次后熔断（不再被调用）
 *   - getStats 反映 emit / 订阅 / 熔断状态
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    on, off, emit, _clearAllHandlers, getStats, getHandlerFailCount, resetStats,
} from '../web/src/monetization/MonetizationBus.js';

beforeEach(() => {
    _clearAllHandlers();
    /* 屏蔽 logger 输出避免污染测试日志 */
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('MonetizationBus — 订阅 / emit / off', () => {
    it('on() 注册 handler，emit() 调用它', () => {
        const h = vi.fn();
        on('foo', h);
        emit('foo', { a: 1 });
        expect(h).toHaveBeenCalledTimes(1);
        expect(h.mock.calls[0][0]).toMatchObject({ data: { a: 1 } });
    });

    it('on() 返回的 unsubscribe 函数能取消订阅', () => {
        const h = vi.fn();
        const unsub = on('bar', h);
        emit('bar');
        unsub();
        emit('bar');
        expect(h).toHaveBeenCalledTimes(1);
    });

    it('off() 也能取消', () => {
        const h = vi.fn();
        on('baz', h);
        off('baz', h);
        emit('baz');
        expect(h).not.toHaveBeenCalled();
    });

    it('无 handler 的 eventType emit 不报错', () => {
        expect(() => emit('nobody-listens', {})).not.toThrow();
    });
});

describe('MonetizationBus — 错误隔离', () => {
    it('一个 handler 抛错不影响其他 handler', () => {
        const bad = vi.fn(() => { throw new Error('boom'); });
        const good = vi.fn();
        on('e', bad);
        on('e', good);
        expect(() => emit('e')).not.toThrow();
        expect(bad).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledTimes(1);
    });

    it('失败计数：total 与 consecutive 同时累加', () => {
        const bad = () => { throw new Error('e'); };
        on('x', bad);
        emit('x'); emit('x'); emit('x');
        const s = getHandlerFailCount(bad);
        expect(s.total).toBe(3);
        expect(s.consecutive).toBe(3);
        expect(s.circuitOpen).toBe(false);
    });

    it('一次成功后 consecutive 清零，total 保留', () => {
        let fail = true;
        const sometimes = () => { if (fail) throw new Error('e'); };
        on('x', sometimes);
        emit('x'); emit('x');
        fail = false;
        emit('x');
        const s = getHandlerFailCount(sometimes);
        expect(s.total).toBe(2);
        expect(s.consecutive).toBe(0);
    });
});

describe('MonetizationBus — 熔断', () => {
    it('连续失败 ≥ 5 次后熔断；之后不再调用', () => {
        const bad = vi.fn(() => { throw new Error('e'); });
        on('x', bad);
        for (let i = 0; i < 7; i++) emit('x');
        expect(bad).toHaveBeenCalledTimes(5); // 第 5 次失败后熔断
        const s = getHandlerFailCount(bad);
        expect(s.circuitOpen).toBe(true);
        expect(s.total).toBe(5);
    });

    it('其他 handler 不受熔断影响', () => {
        const bad = () => { throw new Error('e'); };
        const good = vi.fn();
        on('x', bad);
        on('x', good);
        for (let i = 0; i < 10; i++) emit('x');
        expect(good).toHaveBeenCalledTimes(10);
    });
});

describe('MonetizationBus — getStats', () => {
    it('emit 计数 + 订阅 handler 数 + 熔断数', () => {
        const h1 = () => {};
        const h2 = () => {};
        on('a', h1);
        on('a', h2);
        on('b', h1);
        emit('a'); emit('a'); emit('b');
        const s = getStats();
        expect(s.events).toEqual({ a: 2, b: 1 });
        expect(s.eventTypes).toBe(2);
        expect(s.totalHandlers).toBe(3); // a:h1, a:h2, b:h1
        expect(s.circuitOpenCount).toBe(0);
    });

    it('熔断的 handler 在 circuitOpenCount 中可见', () => {
        const bad = () => { throw new Error('e'); };
        on('x', bad);
        for (let i = 0; i < 6; i++) emit('x');
        const s = getStats();
        expect(s.circuitOpenCount).toBe(1);
    });
});

/* ============ Y4: 全局观测指标 ============ */
describe('MonetizationBus Y4 — 全局观测指标', () => {
    it('初始 getStats：累计字段全 0', () => {
        const s = getStats();
        expect(s.totalEmits).toBe(0);
        expect(s.totalHandlerFails).toBe(0);
        expect(s.totalCircuitTrips).toBe(0);
        expect(s.handlerFailRate).toBe(0);
        expect(s.eventsFailed).toEqual({});
    });

    it('totalEmits 累计所有事件 emit', () => {
        on('a', () => {});
        on('b', () => {});
        emit('a'); emit('a'); emit('b'); emit('c'); /* c 无订阅，仍计 */
        expect(getStats().totalEmits).toBe(4);
    });

    it('totalHandlerFails / eventsFailed / handlerFailRate', () => {
        const bad = () => { throw new Error('e'); };
        on('x', bad);
        emit('x'); emit('x'); emit('x'); /* 3 emit、3 fail，未到熔断（5）阈值 */
        const s = getStats();
        expect(s.totalHandlerFails).toBe(3);
        expect(s.eventsFailed).toEqual({ x: 3 });
        expect(s.handlerFailRate).toBeCloseTo(1.0); /* 3/3 */
    });

    it('totalCircuitTrips 在第 5 次连续失败时 +1', () => {
        const bad = () => { throw new Error('e'); };
        on('y', bad);
        for (let i = 0; i < 7; i++) emit('y');
        expect(getStats().totalCircuitTrips).toBe(1);
        expect(getStats().circuitOpenCount).toBe(1);
    });

    it('resetStats 清零所有累计字段（不影响 handlers / circuit 状态）', () => {
        const bad = () => { throw new Error('e'); };
        on('z', bad);
        for (let i = 0; i < 6; i++) emit('z'); /* 触发熔断 */
        expect(getStats().totalCircuitTrips).toBe(1);
        resetStats();
        const s = getStats();
        expect(s.totalEmits).toBe(0);
        expect(s.totalHandlerFails).toBe(0);
        expect(s.totalCircuitTrips).toBe(0);
        expect(s.eventsFailed).toEqual({});
        /* 但熔断仍生效（live state） */
        expect(s.circuitOpenCount).toBe(1);
    });

    it('handlerFailRate 在零 emit 时返回 0（不除零）', () => {
        const s = getStats();
        expect(s.handlerFailRate).toBe(0);
    });

    /* ============ FF4: circuitTripsByType ============ */

    it('FF4 初始 getStats 含 circuitTripsByType={}', () => {
        const s = getStats();
        expect(s.circuitTripsByType).toBeDefined();
        expect(s.circuitTripsByType).toEqual({});
    });

    it('FF4 单 eventType 熔断 → circuitTripsByType[type]=1', () => {
        const bad = () => { throw new Error('e'); };
        on('ad_show', bad);
        for (let i = 0; i < 6; i++) emit('ad_show');
        const s = getStats();
        expect(s.circuitTripsByType).toEqual({ ad_show: 1 });
        expect(s.totalCircuitTrips).toBe(1);
    });

    it('FF4 多 eventType 各自独立熔断 → 各自 trip 计数', () => {
        /* 各自 handler — 同 handler 第一次 trip 后被 short-circuit，不会重复熔断 */
        const bad1 = () => { throw new Error('ad'); };
        const bad2 = () => { throw new Error('iap'); };
        on('ad_show', bad1);
        on('iap_pay', bad2);
        for (let i = 0; i < 6; i++) emit('ad_show');
        for (let i = 0; i < 6; i++) emit('iap_pay');
        const s = getStats();
        expect(s.circuitTripsByType).toEqual({ ad_show: 1, iap_pay: 1 });
        expect(s.totalCircuitTrips).toBe(2);
        /* 守恒律：sum(circuitTripsByType.*) === totalCircuitTrips */
        const sum = Object.values(s.circuitTripsByType).reduce((a, b) => a + b, 0);
        expect(sum).toBe(s.totalCircuitTrips);
    });

    it('FF4 circuitTripsByType 是副本：外部修改不污染 live state', () => {
        const bad = () => { throw new Error('e'); };
        on('ftue_step', bad);
        for (let i = 0; i < 6; i++) emit('ftue_step');
        const s1 = getStats();
        s1.circuitTripsByType.ftue_step = 99999;
        s1.circuitTripsByType.fake = 42;
        const s2 = getStats();
        expect(s2.circuitTripsByType.ftue_step).toBe(1);
        expect(s2.circuitTripsByType.fake).toBeUndefined();
    });

    it('FF4 resetStats 清空 circuitTripsByType', () => {
        const bad = () => { throw new Error('e'); };
        on('ad_show', bad);
        for (let i = 0; i < 6; i++) emit('ad_show');
        expect(Object.keys(getStats().circuitTripsByType)).toHaveLength(1);
        resetStats();
        expect(getStats().circuitTripsByType).toEqual({});
    });
});
