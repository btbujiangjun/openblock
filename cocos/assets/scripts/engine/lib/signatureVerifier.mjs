/* 自动生成 —— 请勿手改。源：web/src/lib/signatureVerifier.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * PP1 / NN-F2.2: Signature Verifier（remote config 防篡改）
 *
 * 目标：验证远端 payload（典型为 game_rules JSON）未被 CDN 中间人/缓存毒化篡改。
 *
 * 设计原则：
 *   - 算法可插拔：默认尝试 Ed25519（WebCrypto SubtleCrypto），失败/不可用时
 *     回退到 HMAC-SHA256（对称密钥，适合小程序内嵌密钥的最小防护场景）；
 *   - **绝不**自己实现非对称密码学（避免实现错误带来的安全风险）；
 *   - 错误一律返回 false，不抛错（让调用方走 fallback 而非崩溃）；
 *   - 全异步 API（SubtleCrypto.verify 是 Promise）。
 *
 * 输入约定（与 gameRulesRemote 对齐）：
 *   verify({
 *     payload:   any,                // 通常是 rules object，会按 canonical JSON 字节序列化
 *     signature: string,             // base64 编码
 *     algorithm: 'Ed25519' | 'HMAC-SHA256',
 *     key:       string | CryptoKey, // base64 公钥 (Ed25519) 或 base64 秘钥 (HMAC)
 *   }) → Promise<boolean>
 *
 * Canonical 序列化：JSON.stringify with sorted keys。对端必须用同样方式。
 *
 * 注意：此模块是"机制"。运营 / 部署侧需另选 KMS / 密钥分发方案
 * （硬编码公钥 / 远端 key endpoint / pinned）；不在本 PoC 范围。
 */

/* ---------------- canonical JSON ---------------- */

/**
 * canonicalJson：对象按键排序后 JSON.stringify。
 * 满足：a/b 任意键序生成的字节流相同 → 签名稳定。
 * 限制：循环引用会抛错（应在远端配置场景不出现）。
 */
export function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return '[' + value.map(canonicalJson).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
        if (value[k] === undefined) continue; /* JSON 规范，undefined 跳过 */
        parts.push(JSON.stringify(k) + ':' + canonicalJson(value[k]));
    }
    return '{' + parts.join(',') + '}';
}

/* ---------------- base64 helpers（不依赖 Buffer） ---------------- */

function _getBuffer() {
    /* node 环境兜底；globalThis.Buffer 而非裸 Buffer，避免 ESLint no-undef */
    return typeof globalThis !== 'undefined' ? globalThis.Buffer : undefined;
}

function _b64ToBytes(b64) {
    if (typeof atob === 'function') {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    const B = _getBuffer();
    if (B) return new Uint8Array(B.from(b64, 'base64'));
    throw new Error('no base64 decoder');
}

function _bytesToB64(bytes) {
    if (typeof btoa === 'function') {
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    }
    const B = _getBuffer();
    if (B) return B.from(bytes).toString('base64');
    throw new Error('no base64 encoder');
}

function _utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    const B = _getBuffer();
    if (B) return new Uint8Array(B.from(str, 'utf8'));
    throw new Error('no utf8 encoder');
}

/* ---------------- SubtleCrypto wrappers ---------------- */

function _subtle() {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
    return null;
}

/**
 * Ed25519 verify。底层走 WebCrypto；不可用返回 false。
 * 公钥应为 raw 32-byte（base64），符合 RFC 8410 raw 格式。
 */
export async function verifyEd25519({ messageBytes, signatureBytes, publicKeyBytes }) {
    const subtle = _subtle();
    if (!subtle) return false;
    try {
        const key = await subtle.importKey(
            'raw', publicKeyBytes,
            { name: 'Ed25519' }, false, ['verify'],
        );
        return await subtle.verify('Ed25519', key, signatureBytes, messageBytes);
    } catch {
        return false;
    }
}

/**
 * HMAC-SHA256 verify。对称密钥，适合小程序内嵌密钥的最小防护
 * （注意：内嵌的对称密钥可被逆向，仅防被动 CDN 毒化，不防主动攻击者）。
 */
export async function verifyHmacSha256({ messageBytes, signatureBytes, keyBytes }) {
    const subtle = _subtle();
    if (!subtle) return false;
    try {
        const key = await subtle.importKey(
            'raw', keyBytes,
            { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
        );
        return await subtle.verify('HMAC', key, signatureBytes, messageBytes);
    } catch {
        return false;
    }
}

/**
 * 统一 verifier 入口。调用方：
 *   const ok = await verify({ payload, signature, algorithm, key });
 *
 * 任何缺字段 / 算法未知 / 底层失败 → false（不抛）。
 */
export async function verify({ payload, signature, algorithm, key }) {
    if (!signature || !algorithm || !key) return false;
    let messageBytes, signatureBytes, keyBytes;
    try {
        messageBytes = _utf8Bytes(canonicalJson(payload));
        signatureBytes = _b64ToBytes(signature);
        keyBytes = _b64ToBytes(key);
    } catch { return false; }

    switch (algorithm) {
        case 'Ed25519':
            return verifyEd25519({ messageBytes, signatureBytes, publicKeyBytes: keyBytes });
        case 'HMAC-SHA256':
            return verifyHmacSha256({ messageBytes, signatureBytes, keyBytes });
        default:
            return false;
    }
}

/**
 * 工厂：构造一个 verifier 闭包，固定 algorithm + key，方便 gameRulesRemote 注入。
 *
 * 示例：
 *   const v = createVerifier({ algorithm:'Ed25519', key: PUBLIC_KEY_B64 });
 *   initRemoteRules({ url, verifier: v });
 */
export function createVerifier({ algorithm, key }) {
    return async ({ payload, signature }) => verify({ payload, signature, algorithm, key });
}

/* ---------- 测试辅助 ---------- */
export const _internal = { _b64ToBytes, _bytesToB64, _utf8Bytes };
