/* 自动生成 —— 请勿手改。源：web/src/lib/bitmapOpsWasm.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * PP6 / NN-F4.2: 真实 WebAssembly popcount/ctz 实现。
 *
 * 用法：
 *   import { tryLoadWasm } from './bitmapOps.mjs';
 *   import { wasmBitmapLoader } from './bitmapOpsWasm.mjs';
 *   await tryLoadWasm({ loader: wasmBitmapLoader });
 *
 * 设计：
 *   - 60 字节硬编码的 WASM 模块（手工编码，无 build 依赖），导出
 *     popcount32(i32)→i32 和 ctz32(i32)→i32。
 *   - 直接走 `i32.popcnt` (0x69) 和 `i32.ctz` (0x68) 单 opcode，
 *     V8 / SpiderMonkey 在 x86/ARM 上会编译为单条 POPCNT/TZCNT/CLZ。
 *   - 加载是异步、可失败；任何异常（无 WebAssembly / 验证失败 / 平台禁用）
 *     都让 caller 走 JS fallback（bitmapOps 已有此契约）。
 *
 * 跨端约束：
 *   - web / 浏览器：100% 可用（WebAssembly 自 2017 普及）
 *   - cocos creator native：v3.x 大多数版本可用；v2.x 不保证
 *   - 微信小程序：开放 WASM 的版本（基础库 ≥ 2.13）可用，否则 loader 直接返回 null
 *
 * 性能预期（参考 ADR-009）：
 *   - 单调用：WASM ~20ns vs JS ~30ns（提升有限，跨语言调用开销主导）
 *   - 批处理 popcountMask（数百调用聚合）：~2-3x 提升
 *   - 本模块只暴露单调用；批处理优化留作后续（需要 memory 共享）
 */

const WASM_BYTES = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 127, 1, 127,
    3, 3, 2, 0, 0,
    7, 22, 2,
    10, 112, 111, 112, 99, 111, 117, 110, 116, 51, 50, 0, 0,
    5, 99, 116, 122, 51, 50, 0, 1,
    10, 13, 2,
    5, 0, 32, 0, 105, 11,  /* func 0: local.get 0; i32.popcnt; end */
    5, 0, 32, 0, 104, 11,  /* func 1: local.get 0; i32.ctz; end */
]);

let _cached = null;

/**
 * loader：返回 ops 对象（与 bitmapOps.tryLoadWasm 期望一致）。
 * 失败/不可用返回 null —— 上层会把 false 当作"不可用"处理。
 */
export async function wasmBitmapLoader() {
    if (_cached) return _cached;
    if (typeof WebAssembly !== 'object') return null;
    try {
        /* WebAssembly.instantiate 既适配 web 也适配 node，
         * 注意：旧 V8 不支持 instantiate Uint8Array 直接传，要先 Module 包一下。 */
        const mod = await WebAssembly.compile(WASM_BYTES);
        const inst = await WebAssembly.instantiate(mod, {});
        const { popcount32, ctz32 } = inst.exports;
        if (typeof popcount32 !== 'function' || typeof ctz32 !== 'function') return null;

        /* sanity check：保护"WASM 实例化成功但 opcode 没按预期工作"的极端 platform */
        if (popcount32(0xff) !== 8 || ctz32(1) !== 0 || ctz32(0) !== 32) return null;

        _cached = {
            popcount32: (x) => popcount32(x | 0),
            ctz32: (x) => ctz32(x | 0),
            /* popcountMask 暂用 JS 循环逐个调（无 shared memory）；
             * 未来若有性能瓶颈，再让 WASM 接 memory 批处理。 */
            popcountMask: (masks) => {
                let s = 0;
                for (let i = 0; i < masks.length; i++) s += popcount32(masks[i] | 0);
                return s;
            },
            backend: 'wasm',
        };
        return _cached;
    } catch {
        return null;
    }
}

/* 测试 reset */
export function _resetWasmCacheForTest() { _cached = null; }

export const _internal = { WASM_BYTES };
