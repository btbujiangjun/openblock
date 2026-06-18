/**
 * PP6 / NN-F4.2: 真实 WASM popcount/ctz 端到端测试。
 *
 * 覆盖：
 *   - WASM 模块成功实例化
 *   - popcount32 与 JS 等价（500 随机 + 边界）
 *   - ctz32 与 JS 等价（500 随机 + 0/0x80000000 边界）
 *   - tryLoadWasm + wasmBitmapLoader 集成：ops.backend → 'wasm'
 *   - 加载后 getBitmapOps() 拿到 WASM 实现
 *   - cache：重复 loader 调用复用模块
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { wasmBitmapLoader, _resetWasmCacheForTest, _internal as wasmInternal } from '../web/src/lib/bitmapOpsWasm.js';
import {
    popcount32Js, ctz32Js,
    tryLoadWasm, getBitmapOps, _resetBitmapOpsForTest,
} from '../web/src/lib/bitmapOps.js';

function refPopcount(x) { let c = 0, v = x >>> 0; while (v) { c += v & 1; v >>>= 1; } return c; }

describe('PP6 / NN-F4.2 bitmapOpsWasm', () => {
    beforeEach(() => {
        _resetBitmapOpsForTest();
        _resetWasmCacheForTest();
    });

    it('wasm 模块成功加载', async () => {
        const ops = await wasmBitmapLoader();
        expect(ops).not.toBeNull();
        expect(ops.backend).toBe('wasm');
        expect(typeof ops.popcount32).toBe('function');
    });

    it('WASM popcount32 与 JS 等价（500 随机 + 边界）', async () => {
        const ops = await wasmBitmapLoader();
        const cases = [0, 1, 0xff, 0xffffffff, 0x80000000, 0x55555555, 0xaaaaaaaa];
        for (const x of cases) {
            expect(ops.popcount32(x)).toBe(refPopcount(x));
        }
        for (let i = 0; i < 500; i++) {
            const x = (Math.random() * 0x100000000) >>> 0;
            expect(ops.popcount32(x)).toBe(popcount32Js(x));
        }
    });

    it('WASM ctz32 与 JS 等价（含 0→32, 0x80000000→31 边界）', async () => {
        const ops = await wasmBitmapLoader();
        expect(ops.ctz32(0)).toBe(32);
        expect(ops.ctz32(1)).toBe(0);
        expect(ops.ctz32(0x80000000)).toBe(31);
        for (let i = 0; i < 500; i++) {
            const x = (Math.random() * 0x100000000) >>> 0;
            expect(ops.ctz32(x)).toBe(ctz32Js(x));
        }
    });

    it('WASM popcountMask 聚合等价', async () => {
        const ops = await wasmBitmapLoader();
        const arr = [];
        let expSum = 0;
        for (let i = 0; i < 100; i++) {
            const x = (Math.random() * 0x100000000) >>> 0;
            arr.push(x); expSum += popcount32Js(x);
        }
        expect(ops.popcountMask(arr)).toBe(expSum);
    });

    it('tryLoadWasm + wasmBitmapLoader 集成 → 全局 ops 切到 WASM', async () => {
        expect(getBitmapOps().backend).toBe('js');
        const ok = await tryLoadWasm({ loader: wasmBitmapLoader });
        expect(ok).toBe(true);
        expect(getBitmapOps().backend).toBe('wasm');
        expect(getBitmapOps().popcount32(0xff)).toBe(8);
    });

    it('cache：第二次 loader 调用不重新实例化', async () => {
        const a = await wasmBitmapLoader();
        const b = await wasmBitmapLoader();
        expect(a).toBe(b); /* 同一对象引用 */
    });

    it('WASM 模块大小 < 100 字节（防膨胀回归）', () => {
        expect(wasmInternal.WASM_BYTES.length).toBeLessThan(100);
    });
});
