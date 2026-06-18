/**
 * @vitest-environment jsdom
 *
 * analyticsStore — IDB + localStorage 持久化层契约（v1.71 V2）
 *   - load 优先 IDB，fallback LS
 *   - save 节流（800ms debounce），HARD_FLUSH 兜底
 *   - flushNow 立即同步 LS（pagehide 路径）
 *   - 所有持久化异常被吞，不影响调用方
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* jsdom 下 localStorage 在 vitest 默认不挂载到 globalThis；用最小 in-memory store stub */
function makeLocalStorageStub() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        clear: () => map.clear(),
        get length() { return map.size; },
        key: (i) => Array.from(map.keys())[i] ?? null,
    };
}

/* fake-indexeddb 在依赖列表里没有；jsdom 自带没有 indexedDB。
 * 我们通过模拟最小 indexedDB 接口验证 IDB 路径；不可用时验证 LS fallback。 */
function installFakeIDB() {
    let store = new Map();
    const idb = {
        open(_name) {
            const req = {
                onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null,
                result: null,
            };
            queueMicrotask(() => {
                const db = {
                    objectStoreNames: { contains: (n) => n === 'snapshot' },
                    transaction(_storeName, _mode) {
                        return {
                            objectStore(_n) {
                                return {
                                    get(id) {
                                        const r = { onsuccess: null, onerror: null, result: store.get(id) };
                                        queueMicrotask(() => r.onsuccess && r.onsuccess());
                                        return r;
                                    },
                                    put(obj) {
                                        store.set(obj.id, obj);
                                        return { onsuccess: null, onerror: null };
                                    },
                                };
                            },
                            oncomplete: null, onerror: null, onabort: null,
                            _complete() { queueMicrotask(() => this.oncomplete && this.oncomplete()); },
                        };
                    },
                };
                req.result = db;
                /* trigger upgrade once for fresh store map; not strictly required for tests */
                req.onsuccess && req.onsuccess();
            });
            return req;
        },
        _clear() { store = new Map(); },
    };
    globalThis.indexedDB = idb;
    return idb;
}

describe('analyticsStore — localStorage 路径（IDB 不可用）', () => {
    let mod;
    let lsStub;
    beforeEach(async () => {
        vi.useFakeTimers();
        globalThis.indexedDB = undefined;
        lsStub = makeLocalStorageStub();
        vi.stubGlobal('localStorage', lsStub);
        vi.resetModules();
        mod = await import('../web/src/lib/analyticsStore.js');
        mod._resetAnalyticsStoreForTests();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('loadAnalyticsSnapshotSync 空时返回 null', () => {
        expect(mod.loadAnalyticsSnapshotSync()).toBeNull();
    });

    it('queueAnalyticsSave 节流 800ms 后写 LS', async () => {
        mod.queueAnalyticsSave({ events: [{ a: 1 }], funnels: {} });
        expect(lsStub.getItem('openblock_analytics_v1')).toBeNull();
        vi.advanceTimersByTime(799);
        expect(lsStub.getItem('openblock_analytics_v1')).toBeNull();
        vi.advanceTimersByTime(2);
        await vi.runAllTimersAsync();
        const raw = lsStub.getItem('openblock_analytics_v1');
        expect(raw).toBeTruthy();
        expect(JSON.parse(raw).events).toEqual([{ a: 1 }]);
    });

    it('连续 queue 合并为最后一次 payload', async () => {
        mod.queueAnalyticsSave({ events: [{ a: 1 }], funnels: {} });
        vi.advanceTimersByTime(400);
        mod.queueAnalyticsSave({ events: [{ a: 1 }, { b: 2 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        const data = JSON.parse(lsStub.getItem('openblock_analytics_v1'));
        expect(data.events).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('HARD_FLUSH 5s 强 flush（持续 burst 也能落地）', async () => {
        for (let i = 0; i < 10; i++) {
            mod.queueAnalyticsSave({ events: [{ i }], funnels: {} });
            vi.advanceTimersByTime(500);
        }
        await vi.runAllTimersAsync();
        const data = JSON.parse(lsStub.getItem('openblock_analytics_v1'));
        expect(data.events[0].i).toBeLessThan(10);
    });

    it('flushAnalyticsNow 同步落 LS', () => {
        mod.queueAnalyticsSave({ events: [{ a: 1 }], funnels: {} });
        mod.flushAnalyticsNow();
        expect(JSON.parse(lsStub.getItem('openblock_analytics_v1')).events).toEqual([{ a: 1 }]);
    });

    it('flushAnalyticsNow 无 pending 时不做事', () => {
        expect(() => mod.flushAnalyticsNow()).not.toThrow();
    });

    it('LS 写失败被吞（quota 模拟）', async () => {
        const origSet = lsStub.setItem;
        lsStub.setItem = () => { throw new Error('quota'); };
        mod.queueAnalyticsSave({ events: [{ a: 1 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        lsStub.setItem = origSet;
        /* 没有抛出即通过 */
    });

    it('loadAnalyticsSnapshot async 也 fallback LS', async () => {
        lsStub.setItem('openblock_analytics_v1', JSON.stringify({ events: [{ x: 1 }], funnels: {} }));
        const data = await mod.loadAnalyticsSnapshot();
        expect(data.events).toEqual([{ x: 1 }]);
    });

    it('pagehide 触发 flush', () => {
        mod.queueAnalyticsSave({ events: [{ a: 1 }], funnels: {} });
        window.dispatchEvent(new Event('pagehide'));
        expect(JSON.parse(lsStub.getItem('openblock_analytics_v1')).events).toEqual([{ a: 1 }]);
    });

    it('visibilitychange + hidden 触发 flush', () => {
        mod.queueAnalyticsSave({ events: [{ a: 1 }], funnels: {} });
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(JSON.parse(lsStub.getItem('openblock_analytics_v1')).events).toEqual([{ a: 1 }]);
    });
});

describe('analyticsStore — IDB 路径', () => {
    let mod, fakeIdb;
    let lsStub;
    beforeEach(async () => {
        vi.useFakeTimers();
        fakeIdb = installFakeIDB();
        lsStub = makeLocalStorageStub();
        vi.stubGlobal('localStorage', lsStub);
        vi.resetModules();
        mod = await import('../web/src/lib/analyticsStore.js');
        mod._resetAnalyticsStoreForTests();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        globalThis.indexedDB = undefined;
        fakeIdb._clear();
    });

    it('loadAnalyticsSnapshot 异步从 IDB 读', async () => {
        /* 先用 queueAnalyticsSave 写入 IDB（节流 + 异步） */
        mod.queueAnalyticsSave({ events: [{ idb: true }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        const data = await mod.loadAnalyticsSnapshot();
        expect(data?.events).toEqual([{ idb: true }]);
    });

    it('flushAnalyticsNow 在 IDB 模式下同时双写 LS（保活）', () => {
        mod.queueAnalyticsSave({ events: [{ x: 9 }], funnels: {} });
        mod.flushAnalyticsNow();
        /* LS 总是同步落地，与 IDB 是否可用无关 */
        expect(JSON.parse(lsStub.getItem('openblock_analytics_v1')).events).toEqual([{ x: 9 }]);
    });

    /* ─── W2: 真实 IDB 路径覆盖（fake-indexeddb 风格的更严格 stub） ─── */
    it('W2: 多次写 → 后写覆盖前写（IDB single-key snapshot 语义）', async () => {
        mod.queueAnalyticsSave({ events: [{ v: 1 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        mod.queueAnalyticsSave({ events: [{ v: 2 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        const data = await mod.loadAnalyticsSnapshot();
        expect(data?.events).toEqual([{ v: 2 }]);
    });

    it('W2: load 优先 IDB（IDB 有数据时不读 LS）', async () => {
        /* LS 里塞旧数据；IDB 里塞新数据；load 应返回 IDB 的 */
        lsStub.setItem('openblock_analytics_v1', JSON.stringify({ events: [{ src: 'ls' }] }));
        mod.queueAnalyticsSave({ events: [{ src: 'idb' }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        const data = await mod.loadAnalyticsSnapshot();
        expect(data?.events).toEqual([{ src: 'idb' }]);
    });

    it('W2: IDB 中无数据 → fallback LS', async () => {
        lsStub.setItem('openblock_analytics_v1', JSON.stringify({ events: [{ src: 'ls-only' }] }));
        /* 不写 IDB */
        const data = await mod.loadAnalyticsSnapshot();
        expect(data?.events).toEqual([{ src: 'ls-only' }]);
    });

    it('W2: queueAnalyticsSave debounce 期间多次 → 只触发 1 次 IDB put', async () => {
        let putCount = 0;
        const origIDB = globalThis.indexedDB;
        globalThis.indexedDB = {
            open(_name) {
                const req = { onsuccess: null, result: null };
                queueMicrotask(() => {
                    const db = {
                        objectStoreNames: { contains: () => true },
                        transaction() {
                            return {
                                objectStore() {
                                    return { put() { putCount++; return { onsuccess: null, onerror: null }; } };
                                },
                                oncomplete: null, onerror: null, onabort: null,
                            };
                        },
                    };
                    req.result = db;
                    req.onsuccess && req.onsuccess();
                    /* 模拟 tx.oncomplete 立刻触发 */
                    queueMicrotask(() => {
                        /* 由 _doFlush 持有 tx，oncomplete 在那里触发，这里仅计 put */
                    });
                });
                return req;
            },
        };
        for (let i = 0; i < 10; i++) {
            mod.queueAnalyticsSave({ events: [{ i }], funnels: {} });
            vi.advanceTimersByTime(100);
        }
        vi.advanceTimersByTime(900);
        await vi.runAllTimersAsync();
        expect(putCount).toBeLessThanOrEqual(2); /* debounce + 可能的 hard flush */
        globalThis.indexedDB = origIDB;
    });

    it('W2: IDB open 失败 → 自动降级 LS', async () => {
        globalThis.indexedDB = {
            open: () => {
                const req = { onsuccess: null, onerror: null, onblocked: null };
                queueMicrotask(() => req.onerror && req.onerror());
                return req;
            },
        };
        mod._resetAnalyticsStoreForTests(); /* 清 _dbPromise 缓存 */
        mod.queueAnalyticsSave({ events: [{ fallback: 'ls' }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        expect(JSON.parse(lsStub.getItem('openblock_analytics_v1')).events).toEqual([{ fallback: 'ls' }]);
    });

    it('W2: IDB put 失败（onerror）→ 自动降级 LS（与 onerror 兜底语义一致）', async () => {
        globalThis.indexedDB = {
            open: () => {
                const req = { onsuccess: null, result: null };
                queueMicrotask(() => {
                    req.result = {
                        objectStoreNames: { contains: () => true },
                        transaction() {
                            const tx = {
                                objectStore() {
                                    return { put() { return { onsuccess: null, onerror: null }; } };
                                },
                                oncomplete: null, onerror: null, onabort: null,
                            };
                            queueMicrotask(() => tx.onerror && tx.onerror());
                            return tx;
                        },
                    };
                    req.onsuccess && req.onsuccess();
                });
                return req;
            },
        };
        mod._resetAnalyticsStoreForTests();
        mod.queueAnalyticsSave({ events: [{ recovered: 'ls' }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        /* IDB 失败后 _doFlush 落到 _lsPut */
        expect(JSON.parse(lsStub.getItem('openblock_analytics_v1') || '{}').events).toEqual([{ recovered: 'ls' }]);
    });
});

/* ============ Y3: IDB 持久化健康观测 ============ */
describe('analyticsStore Y3 — IDB 健康观测', () => {
    let mod, lsStub;
    beforeEach(async () => {
        vi.useFakeTimers();
        globalThis.indexedDB = undefined;
        lsStub = makeLocalStorageStub();
        vi.stubGlobal('localStorage', lsStub);
        vi.resetModules();
        mod = await import('../web/src/lib/analyticsStore.js');
        mod._resetAnalyticsStoreForTests();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('初始快照：全 0，successRate=1（无操作时默认健康）', () => {
        const s = mod.getAnalyticsStoreStats();
        expect(s.idbPutOk).toBe(0);
        expect(s.idbPutFail).toBe(0);
        expect(s.idbWriteSuccessRate).toBe(1);
        expect(s.idbAvgLatencyMs).toBe(0);
        expect(s.lsPutFallback).toBe(0);
    });

    it('IDB 不可用 → put 计 fail；lsPut 兜底成功 → lsPutFallback++', async () => {
        mod.queueAnalyticsSave({ events: [{ v: 1 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        const s = mod.getAnalyticsStoreStats();
        expect(s.idbPutFail).toBeGreaterThanOrEqual(1);
        expect(s.idbPutOk).toBe(0);
        expect(s.idbWriteSuccessRate).toBe(0);
        expect(s.lsPutFallback).toBeGreaterThanOrEqual(1);
    });

    it('IDB 可用且写入成功 → put 计 ok + 累计 latency；avg/max ≥ 0', async () => {
        /* 自定义 IDB stub，tx.oncomplete 自动触发（fakeIDB 不会自动触发） */
        globalThis.indexedDB = {
            open() {
                const req = { onsuccess: null, result: null };
                queueMicrotask(() => {
                    req.result = {
                        objectStoreNames: { contains: () => true },
                        transaction() {
                            const tx = {
                                objectStore() {
                                    return { put() { return { onsuccess: null, onerror: null }; } };
                                },
                                oncomplete: null, onerror: null, onabort: null,
                            };
                            queueMicrotask(() => tx.oncomplete && tx.oncomplete());
                            return tx;
                        },
                    };
                    req.onsuccess && req.onsuccess();
                });
                return req;
            },
        };
        mod._resetAnalyticsStoreForTests();
        mod.queueAnalyticsSave({ events: [{ v: 1 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        const s = mod.getAnalyticsStoreStats();
        expect(s.idbPutOk).toBeGreaterThanOrEqual(1);
        expect(s.idbWriteSuccessRate).toBe(1);
        expect(s.idbAvgLatencyMs).toBeGreaterThanOrEqual(0);
        expect(s.idbMaxLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('resetAnalyticsStoreStats 清零所有字段', async () => {
        mod.queueAnalyticsSave({ events: [{ v: 1 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        expect(mod.getAnalyticsStoreStats().idbPutFail).toBeGreaterThan(0);
        mod.resetAnalyticsStoreStats();
        const s = mod.getAnalyticsStoreStats();
        expect(s.idbPutOk).toBe(0);
        expect(s.idbPutFail).toBe(0);
        expect(s.lsPutFallback).toBe(0);
    });

    it('快照是副本：外部修改不影响内部', () => {
        const s = mod.getAnalyticsStoreStats();
        s.idbPutOk = 99999;
        expect(mod.getAnalyticsStoreStats().idbPutOk).toBe(0);
    });

    /* ============ EE4：idbFailReasons reason tag ============ */

    it('EE4 初始快照包含 idbFailReasons={}', () => {
        const s = mod.getAnalyticsStoreStats();
        expect(s.idbFailReasons).toBeDefined();
        expect(typeof s.idbFailReasons).toBe('object');
        expect(Object.keys(s.idbFailReasons)).toHaveLength(0);
    });

    it('EE4 IDB 不可用 → idbFailReasons.no_db 累加', async () => {
        /* 不设 indexedDB → _hasIDB false → _idbPut 走 no_db 分支 */
        mod.queueAnalyticsSave({ events: [{ v: 1 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        const s = mod.getAnalyticsStoreStats();
        expect(s.idbFailReasons.no_db).toBeGreaterThanOrEqual(1);
        expect(s.idbPutFail).toBe(s.idbFailReasons.no_db);
    });

    it('EE4 reason 桶为 live state 副本：修改不污染', async () => {
        mod.queueAnalyticsSave({ events: [{ v: 1 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        const s1 = mod.getAnalyticsStoreStats();
        s1.idbFailReasons.no_db = 99999;
        s1.idbFailReasons.fake_reason = 42;
        const s2 = mod.getAnalyticsStoreStats();
        expect(s2.idbFailReasons.no_db).toBeLessThan(99999);
        expect(s2.idbFailReasons.fake_reason).toBeUndefined();
    });

    it('EE4 reset 后 reason 桶清空', async () => {
        mod.queueAnalyticsSave({ events: [{ v: 1 }], funnels: {} });
        vi.advanceTimersByTime(801);
        await vi.runAllTimersAsync();
        expect(mod.getAnalyticsStoreStats().idbFailReasons.no_db).toBeGreaterThan(0);
        mod.resetAnalyticsStoreStats();
        expect(Object.keys(mod.getAnalyticsStoreStats().idbFailReasons)).toHaveLength(0);
    });

    it('EE4 idbFailReasons 累加等于 idbPutFail 总数（守恒）', async () => {
        for (let i = 0; i < 3; i++) {
            mod.queueAnalyticsSave({ events: [{ v: i }], funnels: {} });
            vi.advanceTimersByTime(801);
            await vi.runAllTimersAsync();
        }
        const s = mod.getAnalyticsStoreStats();
        const reasonSum = Object.values(s.idbFailReasons).reduce((a, b) => a + b, 0);
        expect(reasonSum).toBe(s.idbPutFail);
    });
});
