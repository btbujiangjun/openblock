/**
 * @vitest-environment jsdom
 *
 * jsdom 没有 WebCrypto subtle.sign 实现, 用 Node 的 crypto polyfill。
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
    canonicalize, hmacSha256Base64, verifyPolicy, verifyPoliciesBatch,
    setVerifyMode, setSharedSecret, clearSharedSecret, getVerifyStatus,
    fetchAndCacheSecret,
} from '../../web/src/tuning/hmacVerify.js';

// 在 jsdom 中注入 Node webcrypto
beforeAll(() => {
    if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
        globalThis.crypto = webcrypto;
    }
});

beforeAll(() => { clearSharedSecret(); });

describe('hmacVerify — canonicalize', () => {
    it('key 排序确定', () => {
        const a = canonicalize({ b: 1, a: 2 });
        const b = canonicalize({ a: 2, b: 1 });
        expect(a).toBe(b);
    });

    it('嵌套对象', () => {
        const s = canonicalize({ x: { b: 2, a: 1 }, y: [3, 2, 1] });
        expect(s).toBe('{"x":{"a":1,"b":2},"y":[3,2,1]}');
    });

    it('数组保序', () => {
        expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    });

    it('null / undefined', () => {
        expect(canonicalize(null)).toBe('null');
        expect(canonicalize(undefined)).toBe('null');
    });
});

describe('hmacVerify — hmacSha256Base64', () => {
    it('同 message + 同 secret → 同签名', async () => {
        const a = await hmacSha256Base64('hello', 'secret');
        const b = await hmacSha256Base64('hello', 'secret');
        expect(a).toBe(b);
    });

    it('不同 message → 不同签名', async () => {
        const a = await hmacSha256Base64('hello', 'secret');
        const b = await hmacSha256Base64('world', 'secret');
        expect(a).not.toBe(b);
    });

    it('不同 secret → 不同签名', async () => {
        const a = await hmacSha256Base64('hello', 'secret1');
        const b = await hmacSha256Base64('hello', 'secret2');
        expect(a).not.toBe(b);
    });

    it('返回 base64 (>= 40 字符 for SHA-256)', async () => {
        const s = await hmacSha256Base64('test', 'k');
        expect(s.length).toBeGreaterThanOrEqual(40);
        expect(/^[A-Za-z0-9+/=]+$/.test(s)).toBe(true);
    });

    it('空 secret 抛错', async () => {
        await expect(hmacSha256Base64('msg', '')).rejects.toThrow();
    });
});

describe('hmacVerify — verifyPolicy', () => {
    const SECRET = 'test-secret-123';

    async function makeSignedPolicy(secret = SECRET) {
        const policy = {
            run_id: 1, context_key: 'normal:budget-p2:1500:growth',
            theta: { temperature: 0.05 },
            expected_composite: 0.75,
        };
        const payload = canonicalize({
            run_id: policy.run_id,
            context_key: policy.context_key,
            theta: policy.theta,
            expected_composite: policy.expected_composite,
        });
        policy.signature = await hmacSha256Base64(payload, secret);
        return policy;
    }

    it('正确签名验证通过', async () => {
        const policy = await makeSignedPolicy();
        const ok = await verifyPolicy(policy, SECRET);
        expect(ok).toBe(true);
    });

    it('错误 secret 验证失败', async () => {
        const policy = await makeSignedPolicy();
        const ok = await verifyPolicy(policy, 'wrong-secret');
        expect(ok).toBe(false);
    });

    it('篡改 theta 验证失败', async () => {
        const policy = await makeSignedPolicy();
        policy.theta.temperature = 0.99;  // 篡改
        const ok = await verifyPolicy(policy, SECRET);
        expect(ok).toBe(false);
    });

    it('缺失 signature → false', async () => {
        const policy = await makeSignedPolicy();
        delete policy.signature;
        expect(await verifyPolicy(policy, SECRET)).toBe(false);
    });

    it('降级模式 (no secret): signature 非空就通过', async () => {
        const policy = { signature: 'somelongsig123' };
        expect(await verifyPolicy(policy, '')).toBe(true);
        expect(await verifyPolicy(policy, null)).toBe(true);
    });

    it('降级模式: signature 太短/缺失也失败', async () => {
        expect(await verifyPolicy({ signature: 'short' }, '')).toBe(false);
        expect(await verifyPolicy({}, '')).toBe(false);
    });
});

describe('hmacVerify — 验签模式', () => {
    beforeAll(() => clearSharedSecret());

    it('setVerifyMode 接受 3 种值,其他抛错', () => {
        setVerifyMode('none');
        expect(getVerifyStatus().mode).toBe('none');
        setVerifyMode('structural');
        expect(getVerifyStatus().mode).toBe('structural');
        setVerifyMode('hmac-shared');
        expect(getVerifyStatus().mode).toBe('hmac-shared');
        expect(() => setVerifyMode('invalid')).toThrow();
    });

    it('mode=none 始终通过 (即使 signature 字段也无所谓)', async () => {
        setVerifyMode('none');
        const p = { signature: 'doesnt-matter' };
        expect(await verifyPolicy(p)).toBe(true);
    });

    it('mode=none 但缺 signature 字段仍 false', async () => {
        setVerifyMode('none');
        expect(await verifyPolicy({})).toBe(false);
    });

    it('mode=structural 检查 signature ≥ 8', async () => {
        setVerifyMode('structural');
        expect(await verifyPolicy({ signature: 'longenough12345' })).toBe(true);
        expect(await verifyPolicy({ signature: 'short' })).toBe(false);
    });

    it('mode=hmac-shared 但未设 secret 退化为 structural', async () => {
        clearSharedSecret();
        setVerifyMode('hmac-shared');
        // 没 secret 时仍走 structural 检查
        expect(await verifyPolicy({ signature: 'longenough12345' })).toBe(true);
    });

    it('setSharedSecret 切换到 hmac-shared 并强验', async () => {
        clearSharedSecret();
        setSharedSecret('test-secret');
        expect(getVerifyStatus().mode).toBe('hmac-shared');
        expect(getVerifyStatus().secretCached).toBe(true);
        // 错的 signature → false
        expect(await verifyPolicy({
            run_id: 1, context_key: 'x:y:1:z', theta: {}, expected_composite: 0.5,
            signature: 'wrong-base64-sig',
        })).toBe(false);
    });

    it('clearSharedSecret 回到 structural', () => {
        setSharedSecret('s');
        clearSharedSecret();
        expect(getVerifyStatus().mode).toBe('structural');
        expect(getVerifyStatus().secretCached).toBe(false);
    });
});

describe('hmacVerify — fetchAndCacheSecret', () => {
    beforeAll(() => clearSharedSecret());

    it('成功 fetch 切换到 hmac-shared', async () => {
        clearSharedSecret();
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ secret: 'server-issued-secret-1234567890abc', ttl_ms: 3600000 }),
        }));
        const ok = await fetchAndCacheSecret('http://localhost');
        expect(ok).toBe(true);
        expect(getVerifyStatus().mode).toBe('hmac-shared');
        expect(getVerifyStatus().secretCached).toBe(true);
    });

    it('HTTP 失败回退到 structural', async () => {
        clearSharedSecret();
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401 }));
        const ok = await fetchAndCacheSecret('');
        expect(ok).toBe(false);
        expect(getVerifyStatus().mode).toBe('structural');
    });

    it('返回的 secret 太短 → 拒绝', async () => {
        clearSharedSecret();
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true, json: () => Promise.resolve({ secret: 'tiny', ttl_ms: 3600000 }),
        }));
        const ok = await fetchAndCacheSecret('');
        expect(ok).toBe(false);
        expect(getVerifyStatus().mode).toBe('structural');
    });

    it('已有未过期 secret 时跳过 fetch', async () => {
        clearSharedSecret();
        setSharedSecret('manually-set-secret-12345');
        global.fetch = vi.fn();
        const ok = await fetchAndCacheSecret('');
        expect(ok).toBe(true);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('force=true 强制重 fetch', async () => {
        clearSharedSecret();
        setSharedSecret('old-secret-12345678');
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true, json: () => Promise.resolve({ secret: 'new-server-secret-fghij', ttl_ms: 3600000 }),
        }));
        await fetchAndCacheSecret('', { force: true });
        expect(global.fetch).toHaveBeenCalledOnce();
    });
});

describe('hmacVerify — verifyPoliciesBatch', () => {
    const SECRET = 'batch-secret';

    async function mk(suffix, secret) {
        const policy = {
            run_id: 1,
            context_key: `normal:budget-p2:1500:${suffix}`,
            theta: { t: suffix },
            expected_composite: 0.5,
        };
        const payload = canonicalize({
            run_id: policy.run_id, context_key: policy.context_key,
            theta: policy.theta, expected_composite: policy.expected_composite,
        });
        policy.signature = await hmacSha256Base64(payload, secret);
        return policy;
    }

    it('过滤掉签名错的 policy', async () => {
        const policies = [
            await mk('growth', SECRET),
            await mk('mature', 'wrong-secret'),  // 错的 secret
            await mk('plateau', SECRET),
        ];
        const valid = await verifyPoliciesBatch(policies, SECRET);
        expect(valid).toHaveLength(2);
        expect(valid.map((p) => p.context_key)).toEqual([
            'normal:budget-p2:1500:growth',
            'normal:budget-p2:1500:plateau',
        ]);
    });
});
