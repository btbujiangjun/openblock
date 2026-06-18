/**
 * @vitest-environment jsdom
 *
 * GG3: reportingOutbox quota 应对 + 健康度统计。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* jsdom 无 fetch 自动；占位 mock 防 enqueue 后周期触发出错。
 * 本测试只关心 enqueue 写 LS 行为，不验证 flush 网络路径。 */
function makeLocalStorageStub(quotaBytes = 5_000_000) {
    const map = new Map();
    let total = 0;
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem(k, v) {
            const s = String(v);
            const oldSize = map.has(k) ? map.get(k).length : 0;
            const newTotal = total - oldSize + s.length;
            if (newTotal > quotaBytes) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            map.set(k, s);
            total = newTotal;
        },
        removeItem(k) {
            if (map.has(k)) { total -= map.get(k).length; map.delete(k); }
        },
        clear() { map.clear(); total = 0; },
        get length() { return map.size; },
        key: (i) => Array.from(map.keys())[i] ?? null,
    };
}

async function freshOutbox(ls) {
    vi.resetModules();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    const mod = await import('../web/src/net/reportingOutbox.js');
    mod.__resetForTest();
    return mod;
}

describe('GG3 reportingOutbox quota 应对', () => {
    beforeEach(() => { vi.unstubAllGlobals(); });

    it('初始 getOutboxStats 全 0', async () => {
        const ls = makeLocalStorageStub();
        const mod = await freshOutbox(ls);
        const s = mod.getOutboxStats();
        expect(s.quotaTrips).toBe(0);
        expect(s.quotaShedRecords).toBe(0);
        expect(s.lastQuotaReason).toBe('');
        expect(s.totalQueued).toBe(0);
    });

    it('正常 enqueue 不触发 quota', async () => {
        const ls = makeLocalStorageStub();
        const mod = await freshOutbox(ls);
        mod.enqueue('behavior', { event: 'click' });
        const s = mod.getOutboxStats();
        expect(s.quotaTrips).toBe(0);
        expect(s.totalQueued).toBe(1);
    });

    it('quota 触顶 → 自动丢尾部 30% 重试 → 写入成功 + stats 累加', async () => {
        /* 小 quota：每条 ~100 字符 × 100 条就 ~10KB；设 4KB quota 让必触发 */
        const ls = makeLocalStorageStub(4_000);
        const mod = await freshOutbox(ls);
        for (let i = 0; i < 50; i++) {
            mod.enqueue('behavior', { event: 'e', i, padding: 'x'.repeat(80) });
        }
        const s = mod.getOutboxStats();
        expect(s.quotaTrips).toBeGreaterThanOrEqual(1);
        expect(s.quotaShedRecords).toBeGreaterThan(0);
        expect(s.lastQuotaReason).toContain('Quota');
        /* 至少最终 LS 有数据（不为空） */
        expect(ls.length).toBeGreaterThan(0);
    });

    it('quota 应对保留头部（最旧）记录 — FIFO 服务端去重契约', async () => {
        const ls = makeLocalStorageStub(2_000);
        const mod = await freshOutbox(ls);
        for (let i = 0; i < 30; i++) {
            mod.enqueue('behavior', { event: 'e', seq: i, padding: 'p'.repeat(60) });
        }
        /* 解析 LS 看保留的是否包含最早的 seq=0 */
        const raw = ls.getItem('openblock_outbox_behavior');
        if (raw) {
            const list = JSON.parse(raw);
            if (list.length > 0) {
                /* 头部应是较小 seq（FIFO 保留最旧） */
                expect(list[0].seq).toBeLessThan(15);
            }
        }
    });

    it('resetOutboxStats 清零（但 _channelCache 仍含数据）', async () => {
        const ls = makeLocalStorageStub(4_000);
        const mod = await freshOutbox(ls);
        for (let i = 0; i < 30; i++) {
            mod.enqueue('behavior', { event: 'e', i, padding: 'x'.repeat(80) });
        }
        expect(mod.getOutboxStats().quotaTrips).toBeGreaterThan(0);
        mod.resetOutboxStats();
        const s = mod.getOutboxStats();
        expect(s.quotaTrips).toBe(0);
        expect(s.quotaShedRecords).toBe(0);
        expect(s.lastQuotaReason).toBe('');
        /* totalQueued 仍非零（cache 数据未清） */
        expect(s.totalQueued).toBeGreaterThan(0);
    });

    it('__resetForTest 清 quota stats', async () => {
        const ls = makeLocalStorageStub(4_000);
        const mod = await freshOutbox(ls);
        for (let i = 0; i < 30; i++) {
            mod.enqueue('behavior', { event: 'e', i, padding: 'x'.repeat(80) });
        }
        expect(mod.getOutboxStats().quotaTrips).toBeGreaterThan(0);
        mod.__resetForTest();
        expect(mod.getOutboxStats().quotaTrips).toBe(0);
    });
});
