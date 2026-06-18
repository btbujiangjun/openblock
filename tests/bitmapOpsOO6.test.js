/**
 * OO6 / NN-F4.1: bitmapOps 单元测试。
 *
 * 覆盖：
 *   - popcount32Js 与 grid.js 内联实现等价（200 随机）
 *   - ctz32Js 与 Math.log2 / 标准实现等价（含 x=0 → 32 边界）
 *   - popcountMaskJs 聚合正确
 *   - tryLoadWasm 无 loader → false
 *   - tryLoadWasm 假 loader 成功后 ops 被替换
 *   - reset 恢复 JS 后端
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    popcount32Js, ctz32Js, popcountMaskJs,
    getBitmapOps, createBitmapOps, tryLoadWasm, _resetBitmapOpsForTest,
} from '../web/src/lib/bitmapOps.js';

function refPopcount(x) {
    let c = 0;
    let v = x >>> 0;
    while (v) { c += v & 1; v >>>= 1; }
    return c;
}
function refCtz(x) {
    if (x === 0) return 32;
    let n = 0;
    let v = x >>> 0;
    while ((v & 1) === 0) { v >>>= 1; n++; }
    return n;
}

describe('OO6 / NN-F4.1 bitmapOps', () => {
    beforeEach(() => _resetBitmapOpsForTest());

    it('popcount32Js 与 reference 等价（300 随机 + 边界）', () => {
        const seeds = [0, 1, 0xFFFFFFFF, 0x80000000, 0x55555555, 0xAAAAAAAA];
        for (const s of seeds) expect(popcount32Js(s)).toBe(refPopcount(s));
        for (let i = 0; i < 300; i++) {
            const x = (Math.random() * 0x100000000) >>> 0;
            expect(popcount32Js(x)).toBe(refPopcount(x));
        }
    });

    it('ctz32Js 与 reference 等价（含 0 → 32 边界）', () => {
        expect(ctz32Js(0)).toBe(32);
        expect(ctz32Js(1)).toBe(0);
        expect(ctz32Js(0x80000000)).toBe(31);
        for (let i = 0; i < 300; i++) {
            const x = (Math.random() * 0x100000000) >>> 0;
            expect(ctz32Js(x)).toBe(refCtz(x));
        }
    });

    it('popcountMaskJs 聚合正确', () => {
        expect(popcountMaskJs([])).toBe(0);
        expect(popcountMaskJs([1, 3, 7, 0xFF])).toBe(1 + 2 + 3 + 8);
    });

    it('getBitmapOps 默认 backend=js', () => {
        expect(getBitmapOps().backend).toBe('js');
        expect(getBitmapOps().popcount32(0xFF)).toBe(8);
    });

    it('createBitmapOps 工厂独立，不影响全局', () => {
        const a = createBitmapOps();
        const b = createBitmapOps();
        expect(a).not.toBe(b);
        a.popcount32 = () => 999;
        expect(getBitmapOps().popcount32(0xFF)).toBe(8); /* 全局未受影响 */
    });

    it('tryLoadWasm 无 loader → false', async () => {
        const ok = await tryLoadWasm({});
        expect(ok).toBe(false);
        expect(getBitmapOps().backend).toBe('js');
    });

    it('tryLoadWasm 假 loader 成功 → ops 被替换', async () => {
        const fakeWasm = {
            popcount32: () => 42,
            ctz32: () => 7,
            popcountMask: () => 100,
            backend: 'wasm-fake',
        };
        const ok = await tryLoadWasm({ loader: async () => fakeWasm });
        expect(ok).toBe(true);
        expect(getBitmapOps().backend).toBe('wasm-fake');
        expect(getBitmapOps().popcount32(0xFF)).toBe(42);
    });

    it('tryLoadWasm loader 抛错 → false 且保持 JS', async () => {
        const ok = await tryLoadWasm({ loader: async () => { throw new Error('x'); } });
        expect(ok).toBe(false);
        expect(getBitmapOps().backend).toBe('js');
    });

    it('tryLoadWasm 返回不合规对象 → false', async () => {
        const ok = await tryLoadWasm({ loader: async () => ({ /* no popcount32 */ }) });
        expect(ok).toBe(false);
        expect(getBitmapOps().backend).toBe('js');
    });

    it('_resetBitmapOpsForTest 恢复 JS 后端', async () => {
        await tryLoadWasm({ loader: async () => ({
            popcount32: () => 1, backend: 'wasm',
        })});
        expect(getBitmapOps().backend).toBe('wasm');
        _resetBitmapOpsForTest();
        expect(getBitmapOps().backend).toBe('js');
    });
});
