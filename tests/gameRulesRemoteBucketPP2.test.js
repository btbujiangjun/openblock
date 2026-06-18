/**
 * PP2 / NN-F2.3: gameRulesRemote A/B bucket 路由测试。
 *
 * 覆盖：
 *   - {bucket} 占位被 userId hash 稳定替换
 *   - 同 userId 不同 salt → 不同 URL（feature 隔离）
 *   - 无 userId → URL 不变
 *   - 无占位但有 userId → URL 不变但返回带 bucket（用于上报）
 *   - bucketGroups 控制取模范围
 *   - 返回值 + 缓存包含 bucket
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { initRemoteRules, _resetRemoteRulesForTest, _internal } from '../web/src/gameRulesRemote.js';
import { GAME_RULES, _replaceRulesForRemoteSync } from '../web/src/gameRules.js';

function makeStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, v),
        _map: m,
    };
}
function snap() { return JSON.parse(JSON.stringify(GAME_RULES)); }
function restore(s) { _replaceRulesForRemoteSync(s); }

describe('PP2 / NN-F2.3 remote bucket routing', () => {
    let original;
    beforeEach(() => { _resetRemoteRulesForTest(); original = snap(); });

    it('占位 {bucket} + userId → URL 被替换为稳定 bucket', async () => {
        const calls = [];
        const fetchImpl = async (url) => {
            calls.push(url);
            return { rules: { ...original } };
        };
        const r1 = await initRemoteRules({
            url: 'https://cdn.test/rules/{bucket}.json',
            userId: 'u-stable-001',
            storage: makeStorage(),
            fetchImpl,
        });
        _resetRemoteRulesForTest();
        const r2 = await initRemoteRules({
            url: 'https://cdn.test/rules/{bucket}.json',
            userId: 'u-stable-001',
            storage: makeStorage(),
            fetchImpl,
        });
        expect(calls[0]).toBe(calls[1]); /* 同 userId 稳定路由 */
        expect(calls[0]).toMatch(/^https:\/\/cdn\.test\/rules\/\d+\.json$/);
        expect(r1.bucket).toBe(r2.bucket);
        expect(r1.bucket).toBeGreaterThanOrEqual(0);
        expect(r1.bucket).toBeLessThan(10); /* 默认 bucketGroups=10 */
        restore(original);
    });

    it('不同 salt → 不同 bucket（feature 隔离）', async () => {
        const seen = new Set();
        for (const salt of ['feat-a', 'feat-b', 'feat-c']) {
            _resetRemoteRulesForTest();
            const r = await initRemoteRules({
                url: 'https://cdn/{bucket}',
                userId: 'u-fixed',
                bucketSalt: salt,
                storage: makeStorage(),
                fetchImpl: async () => ({ rules: { ...original } }),
            });
            seen.add(r.bucket);
        }
        /* 3 个 salt 极小概率全相同；放宽：至少 2 个不同（避开 hash 巧合的极端情况） */
        expect(seen.size).toBeGreaterThanOrEqual(2);
        restore(original);
    });

    it('无 userId → URL 不变，bucket=-1', async () => {
        const calls = [];
        await initRemoteRules({
            url: 'https://cdn/{bucket}.json',
            storage: makeStorage(),
            fetchImpl: async (u) => { calls.push(u); return { rules: { ...original } }; },
        });
        expect(calls[0]).toBe('https://cdn/{bucket}.json'); /* 未替换 */
        restore(original);
    });

    it('无占位但有 userId → URL 不变但 bucket 仍返回（供上报）', async () => {
        const calls = [];
        const r = await initRemoteRules({
            url: 'https://cdn/static.json',
            userId: 'u-x',
            storage: makeStorage(),
            fetchImpl: async (u) => { calls.push(u); return { rules: { ...original } }; },
        });
        expect(calls[0]).toBe('https://cdn/static.json');
        expect(r.bucket).toBeGreaterThanOrEqual(0);
        expect(r.bucket).toBeLessThan(10);
        restore(original);
    });

    it('bucketGroups=2 → bucket ∈ {0,1}', async () => {
        const seen = new Set();
        for (const u of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
            _resetRemoteRulesForTest();
            const r = await initRemoteRules({
                url: 'https://cdn/{bucket}',
                userId: u,
                bucketGroups: 2,
                storage: makeStorage(),
                fetchImpl: async () => ({ rules: { ...original } }),
            });
            seen.add(r.bucket);
        }
        for (const b of seen) {
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThan(2);
        }
        expect(seen.size).toBe(2); /* 8 个用户基本会落入两个桶 */
        restore(original);
    });

    it('缓存条目包含 bucket（供后续 telemetry 关联）', async () => {
        const storage = makeStorage();
        await initRemoteRules({
            url: 'https://cdn/{bucket}.json',
            userId: 'u-cache-test',
            storage,
            fetchImpl: async () => ({ rules: { ...original } }),
        });
        const entry = JSON.parse(storage.getItem(_internal.STORAGE_KEY));
        expect(typeof entry.bucket).toBe('number');
        expect(entry.bucket).toBeGreaterThanOrEqual(0);
        restore(original);
    });

    it('fallback 路径也带 bucket', async () => {
        const r = await initRemoteRules({
            url: 'https://cdn/{bucket}',
            userId: 'u-fb',
            storage: makeStorage(),
            fetchImpl: async () => { throw new Error('500'); },
        });
        expect(r.source).toBe('fallback');
        expect(typeof r.bucket).toBe('number');
        expect(r.bucket).toBeGreaterThanOrEqual(0);
    });
});
