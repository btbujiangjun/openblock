/**
 * BB5: lib/beaconSender 单测 —— sendBeacon 优先 / fetch fallback / 重试缓冲。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBeaconSender } from '../web/src/lib/beaconSender.js';

const URL = 'https://api.example.com/logs';
const sampleBatch = () => [
    { ts: 1, level: 'error', tag: 'm1', args: ['boom'] },
    { ts: 2, level: 'error', tag: 'm2', args: ['oops'] },
];

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('BB5 createBeaconSender 工厂约束', () => {
    it('url 缺失 → 抛 TypeError', () => {
        expect(() => createBeaconSender('')).toThrow(TypeError);
        expect(() => createBeaconSender(null)).toThrow(TypeError);
    });

    it('返回 { send, getStats, _resetForTests }', () => {
        const s = createBeaconSender(URL);
        expect(typeof s.send).toBe('function');
        expect(typeof s.getStats).toBe('function');
    });
});

describe('BB5 sendBeacon 优先路径', () => {
    it('navigator.sendBeacon 可用 → 调用 + stats.beaconUsed++', () => {
        const beacon = vi.fn(() => true);
        vi.stubGlobal('navigator', { sendBeacon: beacon });
        vi.stubGlobal('Blob', class { constructor(arr) { this.size = arr[0].length; } });

        const s = createBeaconSender(URL);
        s.send(sampleBatch());

        expect(beacon).toHaveBeenCalledTimes(1);
        expect(beacon.mock.calls[0][0]).toBe(URL);
        const stats = s.getStats();
        expect(stats.beaconUsed).toBe(1);
        expect(stats.fetchUsed).toBe(0);
        expect(stats.sent).toBe(1);
    });

    it('sendBeacon 返回 false → fallback fetch', () => {
        const beacon = vi.fn(() => false);
        const fetch = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { sendBeacon: beacon });
        vi.stubGlobal('fetch', fetch);
        vi.stubGlobal('Blob', class { constructor(arr) { this.size = arr[0].length; } });

        const s = createBeaconSender(URL);
        s.send(sampleBatch());

        const stats = s.getStats();
        expect(stats.beaconUsed).toBe(0); /* false 不算成功 */
        expect(stats.fetchUsed).toBe(1);
        expect(fetch).toHaveBeenCalledWith(URL, expect.objectContaining({
            method: 'POST',
            keepalive: true,
        }));
    });

    it('sendBeacon throw → fallback fetch', () => {
        const beacon = vi.fn(() => { throw new Error('csp'); });
        const fetch = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { sendBeacon: beacon });
        vi.stubGlobal('fetch', fetch);
        vi.stubGlobal('Blob', class { constructor(arr) { this.size = arr[0].length; } });

        const s = createBeaconSender(URL);
        s.send(sampleBatch());

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(s.getStats().fetchUsed).toBe(1);
    });
});

describe('BB5 完全无传输能力 → 进 retry buffer', () => {
    it('无 navigator + 无 fetch → failed++ + retry buffer 入队', () => {
        vi.stubGlobal('navigator', undefined);
        vi.stubGlobal('fetch', undefined);

        const s = createBeaconSender(URL, { maxRetries: 3, retryBackoffMs: [1, 1, 1] });
        s.send(sampleBatch());

        const stats = s.getStats();
        expect(stats.failed).toBe(1);
        expect(stats.retried).toBe(1);
        expect(stats.retryBufferSize).toBe(1);
        expect(stats.retryBufferBytes).toBeGreaterThan(0);
    });

    it('maxRetries=0 → 失败立即丢弃', () => {
        vi.stubGlobal('navigator', undefined);
        vi.stubGlobal('fetch', undefined);

        const s = createBeaconSender(URL, { maxRetries: 0 });
        s.send(sampleBatch());

        const stats = s.getStats();
        expect(stats.failed).toBe(1);
        expect(stats.retried).toBe(0);
        expect(stats.dropped).toBe(1);
        expect(stats.retryBufferSize).toBe(0);
    });
});

describe('BB5 retry buffer：到期 batch 自动重发', () => {
    it('入队 + 推时间 + 下次 send 触发重发', async () => {
        /* 第一次失败入队 */
        vi.stubGlobal('navigator', undefined);
        vi.stubGlobal('fetch', undefined);

        const s = createBeaconSender(URL, { maxRetries: 3, retryBackoffMs: [1, 1, 1] });
        s.send(sampleBatch());
        expect(s.getStats().retryBufferSize).toBe(1);

        /* 让 backoff 过期 */
        await new Promise(r => setTimeout(r, 5));

        /* 恢复 transport */
        const beacon = vi.fn(() => true);
        vi.stubGlobal('navigator', { sendBeacon: beacon });
        vi.stubGlobal('Blob', class { constructor(arr) { this.size = arr[0].length; } });

        /* 再发新 batch → 同时 retry 旧的 */
        s.send([{ ts: 99, level: 'error', tag: 't', args: ['new'] }]);

        /* 应至少调用 sendBeacon 2 次（旧 retry + 新 batch） */
        expect(beacon.mock.calls.length).toBeGreaterThanOrEqual(2);
        const stats = s.getStats();
        expect(stats.retryBufferSize).toBe(0);
        expect(stats.sent).toBeGreaterThanOrEqual(2);
    });
});

describe('BB5 retry buffer 内存上限', () => {
    it('超 maxRetryBufferBytes → 老条目被丢弃 + dropped++', () => {
        vi.stubGlobal('navigator', undefined);
        vi.stubGlobal('fetch', undefined);

        const s = createBeaconSender(URL, {
            maxRetries: 3,
            retryBackoffMs: [10_000, 10_000, 10_000], /* 保证不立即重发 */
            maxRetryBufferBytes: 200, /* 极小 cap */
        });
        /* 反复入队，每次 batch JSON ~80 bytes，几条后就超 cap */
        for (let i = 0; i < 10; i++) {
            s.send([{ ts: i, level: 'error', tag: 't', args: [`m${i}`] }]);
        }
        const stats = s.getStats();
        expect(stats.retryBufferBytes).toBeLessThanOrEqual(200);
        expect(stats.dropped).toBeGreaterThan(0);
    });
});

describe('BB5 序列化兜底', () => {
    it('自定义 serialize 抛错 → 走 fallback shape（不丢失基本信息）', () => {
        const beacon = vi.fn(() => true);
        vi.stubGlobal('navigator', { sendBeacon: beacon });
        vi.stubGlobal('Blob', class { constructor(arr) { this.payload = arr[0]; this.size = arr[0].length; } });

        const s = createBeaconSender(URL, { serialize: () => { throw new Error('boom'); } });
        s.send(sampleBatch());

        const blob = beacon.mock.calls[0][1];
        const parsed = JSON.parse(blob.payload);
        expect(parsed.serializeError).toBe(true);
        expect(parsed.items).toHaveLength(2);
        expect(parsed.items[0]).toHaveProperty('ts');
        expect(parsed.items[0]).toHaveProperty('level');
        expect(parsed.items[0]).toHaveProperty('tag');
    });
});

describe('BB5 空 batch 早返', () => {
    it('空数组 / 非数组 → 不调用 sender', () => {
        const beacon = vi.fn(() => true);
        vi.stubGlobal('navigator', { sendBeacon: beacon });

        const s = createBeaconSender(URL);
        s.send([]);
        s.send(null);
        s.send(undefined);
        expect(beacon).not.toHaveBeenCalled();
    });
});

describe('BB5 与 loggerBatchSink 集成形态', () => {
    it('createBeaconSender(...).send 满足 createBatchSink 入参签名 (batch:Array)', async () => {
        const beacon = vi.fn(() => true);
        vi.stubGlobal('navigator', { sendBeacon: beacon });
        vi.stubGlobal('Blob', class { constructor(arr) { this.size = arr[0].length; } });

        const { createBatchSink } = await import('../web/src/lib/loggerBatchSink.js');
        const sender = createBeaconSender(URL, { maxRetries: 1 });
        const batch = createBatchSink(sender.send, { maxBatch: 2, maxDelayMs: 100 });

        batch.sink({ ts: 1, level: 'error', tag: 't', args: ['a'] });
        batch.sink({ ts: 2, level: 'error', tag: 't', args: ['b'] });
        batch.flush();
        expect(beacon).toHaveBeenCalled();
    });
});
