/**
 * PP1 / NN-F2.2: signatureVerifier 单元测试。
 *
 * 用 Node 自带 crypto 生成 key + 签名，再走我们的 verifier 校验。
 * 覆盖：
 *   - canonicalJson 键序不影响输出
 *   - verifyEd25519 正/负样本（含篡改 payload / 错误公钥）
 *   - verifyHmacSha256 正/负样本
 *   - verify 路由（未知算法 → false，缺字段 → false）
 *   - createVerifier 闭包注入 gameRulesRemote 跑通
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync, sign, createHmac } from 'node:crypto';
import {
    canonicalJson, verify, createVerifier, verifyEd25519, verifyHmacSha256,
} from '../web/src/lib/signatureVerifier.js';
import { initRemoteRules, _resetRemoteRulesForTest } from '../web/src/gameRulesRemote.js';
import { GAME_RULES, _replaceRulesForRemoteSync } from '../web/src/gameRules.js';

function bytesToB64(bytes) { return Buffer.from(bytes).toString('base64'); }
function rawEd25519PublicKey(keyObj) {
    /* SPKI DER 中 raw 公钥位于末 32 字节 */
    const der = keyObj.export({ type: 'spki', format: 'der' });
    return der.slice(der.length - 32);
}
/* rawEd25519PrivateKey 留作未来扩展（直接用 KeyObject 即可，不必导出种子） */

function snapshot() { return JSON.parse(JSON.stringify(GAME_RULES)); }
function restore(s) { _replaceRulesForRemoteSync(s); }

describe('PP1 / NN-F2.2 signatureVerifier', () => {
    let original;
    beforeEach(() => { _resetRemoteRulesForTest(); original = snapshot(); });

    it('canonicalJson：键序不影响输出', () => {
        const a = { b: 1, a: 2, c: { y: 9, x: 8 } };
        const b = { c: { x: 8, y: 9 }, a: 2, b: 1 };
        expect(canonicalJson(a)).toBe(canonicalJson(b));
        expect(canonicalJson(a)).toBe('{"a":2,"b":1,"c":{"x":8,"y":9}}');
    });

    it('canonicalJson：数组保持顺序，undefined 字段跳过', () => {
        expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
        expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    });

    it('verifyEd25519：合法签名 → true', async () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const payload = { hello: 'world', n: 42 };
        const msg = Buffer.from(canonicalJson(payload), 'utf8');
        const sig = sign(null, msg, privateKey);
        const ok = await verifyEd25519({
            messageBytes: msg,
            signatureBytes: sig,
            publicKeyBytes: rawEd25519PublicKey(publicKey),
        });
        expect(ok).toBe(true);
    });

    it('verifyEd25519：篡改 payload → false', async () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const payload = { hello: 'world' };
        const sig = sign(null, Buffer.from(canonicalJson(payload), 'utf8'), privateKey);
        const tampered = Buffer.from(canonicalJson({ hello: 'WORLD' }), 'utf8');
        const ok = await verifyEd25519({
            messageBytes: tampered,
            signatureBytes: sig,
            publicKeyBytes: rawEd25519PublicKey(publicKey),
        });
        expect(ok).toBe(false);
    });

    it('verifyEd25519：错误公钥 → false', async () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        const { publicKey: wrongPub } = generateKeyPairSync('ed25519');
        const msg = Buffer.from(canonicalJson({ x: 1 }), 'utf8');
        const sig = sign(null, msg, privateKey);
        const ok = await verifyEd25519({
            messageBytes: msg,
            signatureBytes: sig,
            publicKeyBytes: rawEd25519PublicKey(wrongPub),
        });
        expect(ok).toBe(false);
    });

    it('verifyHmacSha256：合法签名 → true', async () => {
        const key = Buffer.from('a'.repeat(32));
        const payload = { y: 1 };
        const msg = Buffer.from(canonicalJson(payload), 'utf8');
        const sig = createHmac('sha256', key).update(msg).digest();
        const ok = await verifyHmacSha256({
            messageBytes: msg, signatureBytes: sig, keyBytes: key,
        });
        expect(ok).toBe(true);
    });

    it('verifyHmacSha256：篡改 → false', async () => {
        const key = Buffer.from('b'.repeat(32));
        const sig = createHmac('sha256', key).update('{"y":1}').digest();
        const ok = await verifyHmacSha256({
            messageBytes: Buffer.from('{"y":2}'),
            signatureBytes: sig, keyBytes: key,
        });
        expect(ok).toBe(false);
    });

    it('verify 路由：未知算法 → false', async () => {
        const ok = await verify({
            payload: { x: 1 }, signature: 'AA==', algorithm: 'RSA-1024', key: 'AA==',
        });
        expect(ok).toBe(false);
    });

    it('verify 路由：缺字段 → false', async () => {
        expect(await verify({ payload: {}, signature: '', algorithm: 'Ed25519', key: 'k' })).toBe(false);
        expect(await verify({ payload: {}, signature: 's', algorithm: '', key: 'k' })).toBe(false);
        expect(await verify({ payload: {}, signature: 's', algorithm: 'Ed25519', key: '' })).toBe(false);
    });

    it('createVerifier：闭包注入 gameRulesRemote，合法签名 → remote 命中', async () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const newRules = { ...original, _ppMarker: 'ed25519-ok' };
        const msg = Buffer.from(canonicalJson(newRules), 'utf8');
        const sig = sign(null, msg, privateKey);
        const verifier = createVerifier({
            algorithm: 'Ed25519',
            key: bytesToB64(rawEd25519PublicKey(publicKey)),
        });
        const r = await initRemoteRules({
            url: 'https://example.test/rules.json',
            storage: { getItem: () => null, setItem: () => {} },
            fetchImpl: async () => ({
                rules: newRules,
                signature: bytesToB64(sig),
            }),
            verifier,
        });
        expect(r.source).toBe('remote');
        expect(GAME_RULES._ppMarker).toBe('ed25519-ok');
        restore(original);
    });

    it('createVerifier：篡改 payload → fallback', async () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const realRules = { ...original, _ppMarker: 'should-fail' };
        const sig = sign(null, Buffer.from(canonicalJson(realRules), 'utf8'), privateKey);
        const tamperedRules = { ...realRules, _ppMarker: 'TAMPERED' };
        const verifier = createVerifier({
            algorithm: 'Ed25519',
            key: bytesToB64(rawEd25519PublicKey(publicKey)),
        });
        const before = JSON.stringify(GAME_RULES);
        const r = await initRemoteRules({
            url: 'https://example.test/rules.json',
            storage: { getItem: () => null, setItem: () => {} },
            fetchImpl: async () => ({ rules: tamperedRules, signature: bytesToB64(sig) }),
            verifier,
        });
        expect(r.source).toBe('fallback');
        expect(r.reason).toMatch(/signature/);
        expect(JSON.stringify(GAME_RULES)).toBe(before);
    });
});
