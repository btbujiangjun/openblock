/**
 * OO4 / NN-F2.1: gameRulesRemote PoC 单元测试。
 *
 * 覆盖：
 *   - 无 URL → fallback
 *   - 远端成功 → 写 cache + 注入 GAME_RULES
 *   - 远端失败 + 旧 cache → 用 stale cache
 *   - 远端失败 + 无 cache → fallback
 *   - schema 未来版本 → fallback（不污染当前 GAME_RULES）
 *   - 签名失败 → fallback
 *   - session 失败预算耗尽 → 不再 fetch
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initRemoteRules, _resetRemoteRulesForTest, _internal } from '../web/src/gameRulesRemote.js';
import { GAME_RULES, _replaceRulesForRemoteSync } from '../web/src/gameRules.js';

function makeStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, v),
        removeItem: (k) => m.delete(k),
        _map: m,
    };
}

function snapshotRules() { return JSON.parse(JSON.stringify(GAME_RULES)); }
function restoreRules(s) { _replaceRulesForRemoteSync(s); }

describe('OO4 / NN-F2.1 gameRulesRemote', () => {
    let original;
    beforeEach(() => {
        _resetRemoteRulesForTest();
        original = snapshotRules();
    });

    it('无 URL → fallback，不动 GAME_RULES', async () => {
        const before = JSON.stringify(GAME_RULES);
        const r = await initRemoteRules({});
        expect(r.source).toBe('fallback');
        expect(JSON.stringify(GAME_RULES)).toBe(before);
    });

    it('远端成功 → 写 cache + 注入 GAME_RULES', async () => {
        const storage = makeStorage();
        const fakeRules = { ...original, schemaVersion: 1, _remoteMarker: 'oo4-test' };
        const r = await initRemoteRules({
            url: 'https://example.test/rules.json',
            storage,
            fetchImpl: async () => ({ rules: fakeRules }),
        });
        expect(r.source).toBe('remote');
        expect(GAME_RULES._remoteMarker).toBe('oo4-test');
        const cached = JSON.parse(storage.getItem(_internal.STORAGE_KEY));
        expect(cached.rules._remoteMarker).toBe('oo4-test');
        restoreRules(original);
    });

    it('远端失败 + 旧 cache 仍可注入', async () => {
        const storage = makeStorage();
        storage.setItem(_internal.STORAGE_KEY, JSON.stringify({
            ts: Date.now() - _internal.REFRESH_INTERVAL_MS * 2, /* stale */
            rules: { ...original, _cacheMarker: 'stale-ok' },
        }));
        const r = await initRemoteRules({
            url: 'https://example.test/rules.json',
            storage,
            fetchImpl: async () => { throw new Error('net down'); },
        });
        expect(r.source).toBe('cache');
        expect(GAME_RULES._cacheMarker).toBe('stale-ok');
        restoreRules(original);
    });

    it('远端失败 + 无 cache → fallback', async () => {
        const storage = makeStorage();
        const r = await initRemoteRules({
            url: 'https://example.test/rules.json',
            storage,
            fetchImpl: async () => { throw new Error('500'); },
        });
        expect(r.source).toBe('fallback');
        expect(r.reason).toContain('500');
    });

    it('schema 未来版本 → fallback，不污染 GAME_RULES', async () => {
        const storage = makeStorage();
        const before = JSON.stringify(GAME_RULES);
        const r = await initRemoteRules({
            url: 'https://example.test/rules.json',
            storage,
            fetchImpl: async () => ({ rules: { ...original, schemaVersion: 9999 } }),
        });
        expect(r.source).toBe('fallback');
        expect(JSON.stringify(GAME_RULES)).toBe(before);
    });

    it('签名验证失败 → fallback', async () => {
        const storage = makeStorage();
        const before = JSON.stringify(GAME_RULES);
        const r = await initRemoteRules({
            url: 'https://example.test/rules.json',
            storage,
            fetchImpl: async () => ({ rules: { ...original }, signature: 'bad' }),
            verifier: () => false,
        });
        expect(r.source).toBe('fallback');
        expect(r.reason).toMatch(/signature/);
        expect(JSON.stringify(GAME_RULES)).toBe(before);
    });

    it('cache 新鲜 → 跳过 fetch', async () => {
        const storage = makeStorage();
        storage.setItem(_internal.STORAGE_KEY, JSON.stringify({
            ts: Date.now(),
            rules: { ...original, _freshMarker: 'fresh' },
        }));
        const fetchSpy = vi.fn();
        const r = await initRemoteRules({
            url: 'https://example.test/rules.json',
            storage,
            fetchImpl: fetchSpy,
        });
        expect(r.source).toBe('cache');
        expect(fetchSpy).not.toHaveBeenCalled();
        restoreRules(original);
    });

    it('session 失败预算耗尽 → 后续直接 fallback 不再 fetch', async () => {
        const storage = makeStorage();
        const fetchSpy = vi.fn(async () => { throw new Error('boom'); });
        for (let i = 0; i < _internal.MAX_FAILURES_PER_SESSION; i++) {
            await initRemoteRules({ url: 'https://x/', storage, fetchImpl: fetchSpy });
        }
        const callsAfterBudget = fetchSpy.mock.calls.length;
        const r = await initRemoteRules({ url: 'https://x/', storage, fetchImpl: fetchSpy });
        expect(r.source).toBe('fallback');
        expect(fetchSpy.mock.calls.length).toBe(callsAfterBudget); /* 不再发新请求 */
    });
});
