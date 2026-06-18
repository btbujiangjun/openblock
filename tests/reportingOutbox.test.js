/**
 * @vitest-environment jsdom
 * reportingOutbox：无网络本地缓存 + 联网批量上报 + 去重 + 断网重发。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const _store = vi.hoisted(() => {
    let m = {};
    return {
        getItem: (k) => (k in m ? m[k] : null),
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: (k) => { delete m[k]; },
        clear: () => { m = {}; },
    };
});
vi.stubGlobal('localStorage', _store);

// config.js 在 jsdom 下需要的最小桩
vi.mock('../web/src/config.js', () => ({
    getApiBaseUrl: () => 'http://test.local',
    isSqliteClientDatabase: () => true,
}));

import {
    enqueue,
    flush,
    pendingCount,
    initReportingOutbox,
    getNetConfig,
    __resetForTest,
} from '../web/src/net/reportingOutbox.js';

beforeEach(() => {
    localStorage.clear();
    __resetForTest();
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', _store);
    initReportingOutbox({ apiBase: 'http://test.local', platform: 'web', appVersion: '9.9.9', enabled: true, flushIntervalMs: 999999 });
});

describe('reportingOutbox', () => {
    it('enqueue 持久化到本地（离线也不丢）', () => {
        enqueue('behavior', { event_type: 'game_start', user_id: 'u1' });
        enqueue('ad', { kind: 'rewarded', revenue_minor: 5 });
        expect(pendingCount('behavior')).toBe(1);
        expect(pendingCount('ad')).toBe(1);
        expect(pendingCount()).toBe(2);
        // 持久化：读回 localStorage 应含记录
        const raw = JSON.parse(localStorage.getItem('openblock_outbox_behavior'));
        expect(raw[0].event_type).toBe('game_start');
        expect(raw[0].event_id).toBeTruthy(); // 自动补 event_id（服务端去重）
    });

    it('flush 成功后出队', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        enqueue('behavior', { event_type: 'place', user_id: 'u1' });
        enqueue('ad', { kind: 'interstitial', revenue_minor: 2 });
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(2); // behavior + ad 两个 channel
        expect(pendingCount()).toBe(0);
        // 校验 body 用 { events: [...] } 包裹
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(Array.isArray(body.events)).toBe(true);
    });

    it('断网（fetch 失败）保留队列，重连后补传', async () => {
        const failing = vi.fn(async () => { throw new Error('offline'); });
        vi.stubGlobal('fetch', failing);
        enqueue('behavior', { event_type: 'game_end', user_id: 'u1' });
        await flush();
        expect(pendingCount('behavior')).toBe(1); // 失败不出队

        const ok = vi.fn(async () => ({ ok: true }));
        vi.stubGlobal('fetch', ok);
        await flush();
        expect(pendingCount('behavior')).toBe(0); // 重连补传成功
    });

    it('navigator.onLine=false 时不发起请求', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('navigator', { onLine: false });
        enqueue('behavior', { event_type: 'x', user_id: 'u1' });
        await flush();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(pendingCount('behavior')).toBe(1);
    });

    it('统一配置 + envelope：每条盖 platform/app_version（分端统计）', () => {
        const cfg = getNetConfig();
        expect(cfg.platform).toBe('web');
        expect(cfg.appVersion).toBe('9.9.9');
        expect(cfg.batchSize).toBe(200);
        enqueue('behavior', { event_type: 'game_start', user_id: 'u1' });
        const raw = JSON.parse(localStorage.getItem('openblock_outbox_behavior'));
        expect(raw[0].platform).toBe('web');
        expect(raw[0].app_version).toBe('9.9.9');
        expect(raw[0].ts).toBeTruthy();
    });

    it('入队已带 platform 时不覆盖（如 cocos 自带）', () => {
        enqueue('ad', { kind: 'rewarded', revenue_minor: 5, platform: 'wechat_game' });
        const raw = JSON.parse(localStorage.getItem('openblock_outbox_ad'));
        expect(raw[0].platform).toBe('wechat_game');
    });

    it('flush 批次级 meta 带 platform/app_version', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        enqueue('behavior', { event_type: 'place', user_id: 'u1' });
        await flush();
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.platform).toBe('web');
        expect(body.app_version).toBe('9.9.9');
        expect(Array.isArray(body.events)).toBe(true);
    });

    /* ─── W5: hot cache 行为契约（避免每次 enqueue parse 整列） ─── */
    it('W5: 多次 enqueue 仅触发首次 LS getItem（hot cache 命中）', () => {
        const spy = vi.spyOn(_store, 'getItem');
        spy.mockClear();
        enqueue('behavior', { event_type: 'a', user_id: 'u' });
        enqueue('behavior', { event_type: 'b', user_id: 'u' });
        enqueue('behavior', { event_type: 'c', user_id: 'u' });
        /* 第一次 enqueue 会读一次（cache miss），后续两次 cache 命中 → 仅 1 次 getItem */
        const calls = spy.mock.calls.filter((c) => String(c[0]).includes('openblock_outbox_behavior'));
        expect(calls.length).toBeLessThanOrEqual(1);
        spy.mockRestore();
    });

    it('W5: enqueue 仍同步写 LS（断电不丢契约）', () => {
        enqueue('behavior', { event_type: 'a', user_id: 'u' });
        /* 直接从底层 store 读应能立刻看到 */
        const raw = _store.getItem('openblock_outbox_behavior');
        expect(JSON.parse(raw)[0].event_type).toBe('a');
    });

    it('W5: __resetForTest 清 hot cache（外部修改 LS 仍能被识别）', () => {
        enqueue('behavior', { event_type: 'a', user_id: 'u' });
        expect(pendingCount('behavior')).toBe(1);
        __resetForTest();
        initReportingOutbox({ apiBase: 'http://test.local', platform: 'web', appVersion: '9.9.9', enabled: true, flushIntervalMs: 999999 });
        /* 重置后队列应空（LS 也被清掉了） */
        expect(pendingCount('behavior')).toBe(0);
    });

    it('W5: cache 与 LS 永远同步（after enqueue → flush success → cache 与 LS 一致）', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ accepted: 1 }) }));
        vi.stubGlobal('fetch', fetchMock);
        enqueue('behavior', { event_type: 'a', user_id: 'u' });
        enqueue('behavior', { event_type: 'b', user_id: 'u' });
        await flush();
        /* 应清空：cache 与 LS */
        expect(pendingCount('behavior')).toBe(0);
        const raw = _store.getItem('openblock_outbox_behavior');
        expect(JSON.parse(raw || '[]')).toEqual([]);
    });
});
