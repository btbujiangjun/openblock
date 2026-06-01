/**
 * @vitest-environment jsdom
 *
 * lib/userId.js — 稳定匿名身份多层存储 + 服务端软恢复
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function makeLocalStorageMock() {
    const store = Object.create(null);
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        get length() { return Object.keys(store).length; },
        key: (i) => Object.keys(store)[i] ?? null,
    };
}
const _mockLS = makeLocalStorageMock();
vi.stubGlobal('localStorage', _mockLS);

import {
    getUserId,
    peekUserId,
    computeDeviceFingerprint,
    reconcileUserId,
    __resetReconcileForTest,
} from '../web/src/lib/userId.js';

function clearCookies() {
    document.cookie.split(';').forEach((c) => {
        const name = c.split('=')[0].trim();
        if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
    });
}

beforeEach(() => {
    _mockLS.clear();
    clearCookies();
    __resetReconcileForTest();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('getUserId — 同步多层（localStorage + cookie）', () => {
    it('首次访问生成合法 id 并同时写入 localStorage 与 cookie', () => {
        const id = getUserId();
        expect(id).toMatch(/^u\d+_[a-z0-9]+$/i);
        expect(localStorage.getItem('bb_user_id')).toBe(id);
        expect(document.cookie).toContain(`bb_uid=${encodeURIComponent(id)}`);
    });

    it('再次调用返回同一个 id（幂等）', () => {
        const a = getUserId();
        const b = getUserId();
        expect(a).toBe(b);
    });

    it('localStorage 被清理后，用 cookie 恢复同一个 id（不新建用户）', () => {
        const original = getUserId();
        _mockLS.clear();              // 只清 localStorage，cookie still there
        const recovered = getUserId();
        expect(recovered).toBe(original);
        // 顺带把 localStorage 写回
        expect(localStorage.getItem('bb_user_id')).toBe(original);
    });

    it('cookie 被清理后，用 localStorage 回写 cookie', () => {
        const original = getUserId();
        clearCookies();
        const again = getUserId();
        expect(again).toBe(original);
        expect(document.cookie).toContain('bb_uid=');
    });
});

describe('peekUserId — 只读不生成', () => {
    it('无存储时返回空串', () => {
        expect(peekUserId()).toBe('');
    });
    it('有 cookie 无 localStorage 时也能读到', () => {
        const id = getUserId();
        _mockLS.clear();
        expect(peekUserId()).toBe(id);
    });
});

describe('computeDeviceFingerprint — 稳定指纹', () => {
    it('返回 fp1_ 前缀且多次调用稳定', () => {
        const a = computeDeviceFingerprint();
        const b = computeDeviceFingerprint();
        expect(a).toMatch(/^fp1_[0-9a-f]{16}$/);
        expect(a).toBe(b);
    });
});

describe('reconcileUserId — 服务端软恢复', () => {
    it('serverEnabled=false 时只对齐本地层，返回本地 id', async () => {
        const local = getUserId();
        const fetchImpl = vi.fn();
        const out = await reconcileUserId({ serverEnabled: false, fetchImpl });
        expect(out).toBe(local);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('服务端返回 canonical id 时，写回所有同步层', async () => {
        getUserId(); // 先有一个本地 id 作为 candidate
        const canonical = 'u17000000001_servrcvr';
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ user_id: canonical, recovered: true }),
        });

        const out = await reconcileUserId({
            apiBaseUrl: 'http://x',
            serverEnabled: true,
            fetchImpl,
        });

        expect(out).toBe(canonical);
        expect(localStorage.getItem('bb_user_id')).toBe(canonical);
        expect(peekUserId()).toBe(canonical);
        // 请求体里带了 candidate_id 和 fingerprint
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body).toHaveProperty('candidate_id');
        expect(body.fingerprint).toMatch(/^fp1_/);
    });

    it('服务端不可达（fetch 抛错）时回退本地 id，不抛错', async () => {
        const local = getUserId();
        const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
        const out = await reconcileUserId({
            apiBaseUrl: 'http://x',
            serverEnabled: true,
            fetchImpl,
        });
        expect(out).toBe(local);
    });

    it('全新设备 + 服务端不可达 → 本地生成合法 id', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
        const out = await reconcileUserId({
            apiBaseUrl: 'http://x',
            serverEnabled: true,
            fetchImpl,
        });
        expect(out).toMatch(/^u\d+_[a-z0-9]+$/i);
        expect(localStorage.getItem('bb_user_id')).toBe(out);
    });

    it('幂等：第二次调用直接返回，不再请求服务端', async () => {
        getUserId();
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ user_id: 'u17000000002_abcdef0', recovered: false }),
        });
        await reconcileUserId({ apiBaseUrl: 'http://x', serverEnabled: true, fetchImpl });
        await reconcileUserId({ apiBaseUrl: 'http://x', serverEnabled: true, fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
