/**
 * @vitest-environment jsdom
 *
 * loggerBatchSink — batch 上报包装器契约（v1.71 U3）：
 * - 满 N 条立即 flush
 * - 距上次 flush ≥ T ms 触发 flush（定时器）
 * - sender 抛错 / Promise reject 被兜住
 * - pagehide / visibilitychange=hidden 强制 flush
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBatchSink } from '../web/src/lib/loggerBatchSink.js';

describe('createBatchSink', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    function makeEntry(msg, tag = 't') {
        return { ts: Date.now(), level: 'error', tag, args: [msg] };
    }

    it('满 maxBatch 立即 flush', () => {
        const sender = vi.fn();
        const { sink } = createBatchSink(sender, { maxBatch: 3, maxDelayMs: 5000 });
        sink(makeEntry('a'), []);
        sink(makeEntry('b'), []);
        expect(sender).not.toHaveBeenCalled();
        sink(makeEntry('c'), []);
        expect(sender).toHaveBeenCalledTimes(1);
        expect(sender.mock.calls[0][0]).toHaveLength(3);
        expect(sender.mock.calls[0][0][0].msg).toBe('a');
    });

    it('未达 maxBatch 但 maxDelayMs 后自动 flush', () => {
        const sender = vi.fn();
        const { sink } = createBatchSink(sender, { maxBatch: 10, maxDelayMs: 1000 });
        sink(makeEntry('x'), []);
        expect(sender).not.toHaveBeenCalled();
        vi.advanceTimersByTime(999);
        expect(sender).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2);
        expect(sender).toHaveBeenCalledTimes(1);
        expect(sender.mock.calls[0][0]).toHaveLength(1);
    });

    it('flush 后队列清空，新 entry 重置定时器', () => {
        const sender = vi.fn();
        const { sink, flush } = createBatchSink(sender, { maxBatch: 100, maxDelayMs: 1000 });
        sink(makeEntry('a'), []);
        flush();
        expect(sender).toHaveBeenCalledTimes(1);
        sink(makeEntry('b'), []);
        vi.advanceTimersByTime(1001);
        expect(sender).toHaveBeenCalledTimes(2);
        expect(sender.mock.calls[1][0][0].msg).toBe('b');
    });

    it('手动 flush 空队列不调 sender', () => {
        const sender = vi.fn();
        const { flush } = createBatchSink(sender, {});
        flush();
        expect(sender).not.toHaveBeenCalled();
    });

    it('sender 抛错被兜住，不传染调用方', () => {
        const sender = vi.fn(() => { throw new Error('boom'); });
        const { sink } = createBatchSink(sender, { maxBatch: 1 });
        expect(() => sink(makeEntry('a'), [])).not.toThrow();
        expect(sender).toHaveBeenCalledTimes(1);
    });

    it('sender 返回 reject Promise 不抛 unhandled', async () => {
        const sender = vi.fn(() => Promise.reject(new Error('async boom')));
        const { sink } = createBatchSink(sender, { maxBatch: 1 });
        sink(makeEntry('a'), []);
        await vi.runAllTimersAsync();
        expect(sender).toHaveBeenCalledTimes(1);
    });

    it('entry 转换为轻量 item（保留 ts/level/tag/msg/argCount）', () => {
        const sender = vi.fn();
        const { sink } = createBatchSink(sender, { maxBatch: 1 });
        sink({ ts: 12345, level: 'error', tag: 'x', args: ['hello', { extra: 1 }, 'third'] }, []);
        const item = sender.mock.calls[0][0][0];
        expect(item).toMatchObject({ ts: 12345, level: 'error', tag: 'x', msg: 'hello', argCount: 3 });
    });

    it('recentContext 截取最近 5 条作为 contextTail', () => {
        const sender = vi.fn();
        const { sink } = createBatchSink(sender, { maxBatch: 1 });
        const ctx = Array.from({ length: 10 }, (_, i) => ({ ts: i, level: 'info', tag: 't', args: ['m' + i] }));
        sink(makeEntry('boom'), ctx);
        const item = sender.mock.calls[0][0][0];
        expect(item.contextTail).toHaveLength(5);
        expect(item.contextTail[0].ts).toBe(5);
        expect(item.contextTail[4].ts).toBe(9);
    });

    it('_queueSize 反映当前未 flush 计数', () => {
        const { sink, _queueSize } = createBatchSink(vi.fn(), { maxBatch: 100, maxDelayMs: 10_000 });
        expect(_queueSize()).toBe(0);
        sink(makeEntry('a'), []);
        sink(makeEntry('b'), []);
        expect(_queueSize()).toBe(2);
    });

    it('dispose 清定时器，调用后不再触发自动 flush', () => {
        const sender = vi.fn();
        const { sink, dispose } = createBatchSink(sender, { maxBatch: 10, maxDelayMs: 1000 });
        sink(makeEntry('a'), []);
        dispose();
        vi.advanceTimersByTime(5000);
        expect(sender).not.toHaveBeenCalled();
    });

    it('pagehide 强制 flush', () => {
        const sender = vi.fn();
        const { sink } = createBatchSink(sender, { maxBatch: 100, maxDelayMs: 10_000 });
        sink(makeEntry('a'), []);
        window.dispatchEvent(new Event('pagehide'));
        expect(sender).toHaveBeenCalledTimes(1);
    });

    it('visibilitychange + hidden 触发 flush', () => {
        const sender = vi.fn();
        const { sink } = createBatchSink(sender, { maxBatch: 100, maxDelayMs: 10_000 });
        sink(makeEntry('a'), []);
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(sender).toHaveBeenCalledTimes(1);
    });

    it('sender 非函数抛 TypeError', () => {
        expect(() => createBatchSink(null)).toThrow(TypeError);
        expect(() => createBatchSink({})).toThrow(TypeError);
    });
});
