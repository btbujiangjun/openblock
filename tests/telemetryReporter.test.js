/**
 * @vitest-environment jsdom
 *
 * DA-4 telemetryReporter 单测：缓冲、归一化、instrumentedFetch、flush。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    normalizeRecord,
    recordDelivery,
    getBufferSize,
    instrumentedFetch,
    buildReportPayload,
    flush,
    initTelemetryReporter,
    __resetForTest,
} from '../web/src/telemetry/telemetryReporter.js';

beforeEach(() => {
    __resetForTest();
    vi.restoreAllMocks();
});

describe('telemetryReporter · normalizeRecord', () => {
    it('有 ack 且 ack>sent → not lost', () => {
        const r = normalizeRecord({ event: 'e', sentTs: 100, ackTs: 250 });
        expect(r.lost).toBe(false);
        expect(r.ackTs).toBe(250);
    });
    it('无 ack / ack<=sent / lost=true → lost', () => {
        expect(normalizeRecord({ sentTs: 100 }).lost).toBe(true);
        expect(normalizeRecord({ sentTs: 100, ackTs: 50 }).lost).toBe(true);
        expect(normalizeRecord({ sentTs: 100, ackTs: 200, lost: true }).lost).toBe(true);
    });
});

describe('telemetryReporter · buffer + instrumentedFetch', () => {
    it('成功 fetch 记录 not-lost', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true }));
        await instrumentedFetch('/x', {}, 'evt');
        expect(getBufferSize()).toBe(1);
    });
    it('fetch 抛错记录 lost 并 rethrow', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('net'); });
        await expect(instrumentedFetch('/x', {}, 'evt')).rejects.toThrow('net');
        expect(getBufferSize()).toBe(1);
    });
});

describe('telemetryReporter · flush', () => {
    it('成功 flush 清空缓冲并带正确 payload', async () => {
        const calls = [];
        globalThis.fetch = vi.fn(async (url, opts) => {
            calls.push({ url, body: JSON.parse(opts.body) });
            return { ok: true };
        });
        initTelemetryReporter({ userId: 'u1', apiBase: 'http://x', intervalMs: 0 });
        recordDelivery({ event: 'a', sentTs: 1, ackTs: 5 });
        recordDelivery({ event: 'b', sentTs: 2, lost: true });
        const ok = await flush();
        expect(ok).toBe(true);
        expect(getBufferSize()).toBe(0);
        expect(calls[0].url).toContain('/api/telemetry/report');
        expect(calls[0].body.user_id).toBe('u1');
        expect(calls[0].body.records.length).toBe(2);
    });
    it('flush 失败保留缓冲', async () => {
        initTelemetryReporter({ userId: 'u', apiBase: '', intervalMs: 0 });
        recordDelivery({ event: 'a', sentTs: 1, ackTs: 5 });
        globalThis.fetch = vi.fn(async () => ({ ok: false }));
        const ok = await flush();
        expect(ok).toBe(false);
        expect(getBufferSize()).toBe(1);
    });
    it('buildReportPayload 形态', () => {
        const p = buildReportPayload('u', [{ event: 'x' }]);
        expect(p).toEqual({ user_id: 'u', records: [{ event: 'x' }] });
    });
    it('initTelemetryReporter 注册全局 hook', () => {
        initTelemetryReporter({ userId: 'u', apiBase: '', intervalMs: 0 });
        expect(typeof globalThis.__telemetryReporter?.record).toBe('function');
    });
});
