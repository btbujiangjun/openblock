/**
 * HMAC-SHA256 客户端验签 — 用 WebCrypto API 实现。
 *
 * 验签流程:
 *   1. 服务端用 secret 对 policy 内容 (canonical JSON) 算 HMAC-SHA256
 *   2. 服务端把 base64 签名塞进 policy.signature
 *   3. 客户端拿同样的 secret 重新算,比对一致才通过
 *
 * 安全模式 (按强度递增,通过 setVerifyMode 切换):
 *   'none'      - 完全不验签,仅信任 HTTPS (开发默认)
 *   'structural'- 只检查 signature 字段非空 + 长度合理 (零信任 baseline,默认)
 *   'hmac-shared'- HMAC-SHA256, secret 与服务端共享 (生产推荐,但要解决密钥分发)
 *
 * 密钥分发策略 (生产部署时三选一):
 *   A. 编译期注入: 通过 Vite define / 环境变量打包进 bundle (简单,但反编译可见)
 *   B. 启动时拉取: GET /api/spawn-tuning/v2/auth/secret + Authorization (推荐,密钥不入 bundle)
 *   C. 派生密钥: 客户端用 user_id + 公开 salt 派生 (无传输,但同 user_id 共享密钥)
 *
 * 当前实现:
 *   - 默认 'structural' 模式 (零配置就生效)
 *   - 用 fetchAndCacheSecret() 支持模式 B (启动时拉取)
 *   - 模式 A 通过 setSharedSecret() 直接注入
 */

let _verifyMode = 'structural';
let _sharedSecret = null;
let _secretFetchedAt = 0;
const SECRET_TTL_MS = 60 * 60 * 1000;  // 1 小时刷新

/**
 * 设置验签模式 (默认 'structural')。
 *
 * @param {'none' | 'structural' | 'hmac-shared'} mode
 */
export function setVerifyMode(mode) {
    if (!['none', 'structural', 'hmac-shared'].includes(mode)) {
        throw new Error(`setVerifyMode: invalid mode "${mode}"`);
    }
    _verifyMode = mode;
}

/**
 * 直接注入 shared secret (模式 A: 编译期注入)。
 *
 * @param {string} secret
 */
export function setSharedSecret(secret) {
    _sharedSecret = secret || null;
    _secretFetchedAt = secret ? Date.now() : 0;
    if (secret) _verifyMode = 'hmac-shared';
}

/**
 * 从 server 拉取 secret 并缓存 (模式 B: 启动时拉取)。
 *
 * 协议: GET /api/spawn-tuning/v2/auth/secret
 * 返回: { secret: 'base64-encoded-bytes', ttl_ms: 3600000 }
 *
 * 安全要求 (生产):
 *   - server 必须验请求 Authorization (例如设备签名/用户 token)
 *   - 必须走 HTTPS
 *   - 失败时回退到 'structural' 模式不阻塞游戏
 *
 * @param {string} apiBaseUrl
 * @param {{authToken?: string, force?: boolean}} [opts]
 * @returns {Promise<boolean>} 是否成功
 */
export async function fetchAndCacheSecret(apiBaseUrl = '', opts = {}) {
    // 已有未过期 secret 时跳过 (除非 force)
    const ageMs = Date.now() - _secretFetchedAt;
    if (!opts.force && _sharedSecret && ageMs < SECRET_TTL_MS) {
        return true;
    }
    try {
        const url = `${(apiBaseUrl || '').replace(/\/+$/, '')}/api/spawn-tuning/v2/auth/secret`;
        const headers = { 'Content-Type': 'application/json' };
        if (opts.authToken) headers['Authorization'] = `Bearer ${opts.authToken}`;
        const r = await fetch(url, { method: 'GET', headers });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (typeof data?.secret !== 'string' || data.secret.length < 16) {
            throw new Error('invalid secret payload');
        }
        _sharedSecret = data.secret;
        _secretFetchedAt = Date.now();
        _verifyMode = 'hmac-shared';
        return true;
    } catch (e) {
        // 失败回退到 structural
        _verifyMode = 'structural';
        if (typeof console !== 'undefined') {
            console.warn('[hmacVerify] failed to fetch secret, fallback to structural:', e?.message);
        }
        return false;
    }
}

/**
 * 清空缓存 (用于轮换密钥或测试)。
 */
export function clearSharedSecret() {
    _sharedSecret = null;
    _secretFetchedAt = 0;
    _verifyMode = 'structural';
}

/**
 * 获取当前验签状态 (用于 dashboard 诊断)。
 */
export function getVerifyStatus() {
    return {
        mode: _verifyMode,
        secretCached: _sharedSecret !== null,
        secretAge: _sharedSecret ? Date.now() - _secretFetchedAt : null,
        secretTtlMs: SECRET_TTL_MS,
    };
}

/**
 * 把对象规范化为字节顺序确定的 JSON 字符串 (避免 key 排序差异)。
 *
 * @param {object} obj
 * @returns {string}
 */
export function canonicalize(obj) {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

/**
 * 把字节数组转 base64 (浏览器/Node 通用)。
 */
function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}

/**
 * 计算 HMAC-SHA256 签名 (base64)。
 *
 * @param {string} message
 * @param {string} secret
 * @returns {Promise<string>}
 */
export async function hmacSha256Base64(message, secret) {
    if (!secret) throw new Error('hmacSha256Base64: secret required');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return bytesToBase64(new Uint8Array(sig));
}

/**
 * 把 policy 内容打包为待签消息 (与 server 端一致, 不含 signature 字段本身)。
 */
function policySignaturePayload(policy) {
    return canonicalize({
        run_id: policy.run_id,
        context_key: policy.context_key,
        theta: policy.theta,
        expected_composite: policy.expected_composite,
    });
}

/**
 * 验证单个 policy 的签名 (根据当前 _verifyMode 选择策略)。
 *
 * - 'none': 永远 true
 * - 'structural': 检查 signature 字段非空 + 长度 ≥8
 * - 'hmac-shared': 用 _sharedSecret 算 HMAC 对比
 *
 * @param {object} policy - 包含 signature 字段
 * @param {string} [secret] - 显式 secret (覆盖模块缓存的 _sharedSecret)
 * @returns {Promise<boolean>}
 */
export async function verifyPolicy(policy, secret) {
    if (!policy?.signature) return false;

    // 显式 secret 优先,否则用 _sharedSecret + _verifyMode 决定
    const effectiveSecret = secret || _sharedSecret;
    const effectiveMode = secret ? 'hmac-shared' : _verifyMode;

    if (effectiveMode === 'none') return true;

    if (effectiveMode === 'structural' || !effectiveSecret) {
        // 结构性检查: 签名非空 + 合理长度
        return typeof policy.signature === 'string' && policy.signature.length >= 8;
    }

    // hmac-shared: 严格 HMAC 验签
    try {
        const expected = await hmacSha256Base64(policySignaturePayload(policy), effectiveSecret);
        return constantTimeEquals(expected, policy.signature);
    } catch {
        return false;
    }
}

/**
 * 等长字符串常量时间比较 (防 timing attack)。
 */
function constantTimeEquals(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * 给一组 policy 提供同步包装的 verify 函数 (用于 clientPolicy.installPolicies)。
 * 调用方需自己 await 等待所有 promise。
 *
 * 用法:
 *   const verified = await Promise.all(policies.map((p) => verifyPolicy(p, secret)));
 *   const valid = policies.filter((_, i) => verified[i]);
 */
export async function verifyPoliciesBatch(policies, secret) {
    const results = await Promise.all(policies.map((p) => verifyPolicy(p, secret)));
    return policies.filter((_, i) => results[i]);
}
