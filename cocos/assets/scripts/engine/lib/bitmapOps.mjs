/* 自动生成 —— 请勿手改。源：web/src/lib/bitmapOps.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * OO6 / NN-F4.1: Bitmap Ops 抽象层（WASM-ready）
 *
 * 当前 grid.js 内联了 `_popcount32` / `_ctz32` 等位运算。
 * 本模块提供与之等价的 JS 实现 + 一个 `tryLoadWasm()` 钩子。
 * 后续真接 AssemblyScript / Rust + WebAssembly 时，只改 tryLoadWasm 即可
 * 让 grid.js（或任何上层）切换实现，无 API 破坏。
 *
 * 设计原则（ADR-009）：
 *   - 单一暴露：popcount32 / ctz32 / popcountMask（聚合）
 *   - 始终有 JS fallback（小程序 / 老浏览器无 WASM 时不退化）
 *   - 工厂模式：`createBitmapOps()` 返回包含可替换函数的对象，
 *     允许 grid.js 在初始化时拿到 ops，运行时 0 间接调用开销（JS engine inline）
 *
 * 本次仅落 JS 实现 + WASM 加载入口（异步、可失败）。
 */

/* 经典 SWAR popcount，与 grid.js _popcount32 完全等价 */
export function popcount32Js(x) {
    let v = x >>> 0;
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    v = (v + (v >>> 4)) & 0x0f0f0f0f;
    return (v * 0x01010101) >>> 24;
}

/* count trailing zeros，与 grid.js _ctz32 等价；x=0 返回 32 */
export function ctz32Js(x) {
    if (x === 0) return 32;
    /* Math.log2 + 位魔法都可，简单兜底用 de Bruijn 序列 */
    let n = 0;
    let v = x >>> 0;
    if ((v & 0xFFFF) === 0) { n += 16; v >>>= 16; }
    if ((v & 0xFF) === 0)   { n += 8;  v >>>= 8;  }
    if ((v & 0xF) === 0)    { n += 4;  v >>>= 4;  }
    if ((v & 0x3) === 0)    { n += 2;  v >>>= 2;  }
    if ((v & 0x1) === 0)    { n += 1; }
    return n;
}

/* 聚合 helper：把一段位图数组（typed/普通 array）所有 popcount 求和。
 * 后续 WASM 实现以批处理形式更显优势（避免 JS↔WASM 跨界开销） */
export function popcountMaskJs(masks) {
    let s = 0;
    for (let i = 0; i < masks.length; i++) s += popcount32Js(masks[i]);
    return s;
}

/**
 * 全局 ops 单例。默认 JS。`tryLoadWasm()` 成功后会就地替换字段，
 * 已持有 ops 引用的调用方自动看到新实现（因属性查找而非闭包捕获）。
 */
const _ops = {
    popcount32: popcount32Js,
    ctz32: ctz32Js,
    popcountMask: popcountMaskJs,
    backend: 'js',
};

export function getBitmapOps() { return _ops; }

/**
 * 工厂：返回独立 ops（测试用，不影响全局）。
 */
export function createBitmapOps() {
    return {
        popcount32: popcount32Js,
        ctz32: ctz32Js,
        popcountMask: popcountMaskJs,
        backend: 'js',
    };
}

/**
 * 异步加载 WASM 实现。当前 PoC 阶段：永远返回 false（无 WASM 资源）。
 * 真接 AssemblyScript 后，此处 fetch + WebAssembly.instantiate。
 *
 * 失败情况（也按 false 处理）：
 *   - 平台不支持 WebAssembly（小程序部分版本）
 *   - 网络/包加载失败
 *   - 校验失败
 *
 * @returns {Promise<boolean>} true=切到 WASM，false=继续 JS
 */
export async function tryLoadWasm(opts = {}) {
    if (typeof WebAssembly !== 'object') return false;
    const loader = opts.loader ?? null;
    if (!loader) return false; /* PoC：默认无 loader */
    try {
        const wasmOps = await loader();
        if (!wasmOps || typeof wasmOps.popcount32 !== 'function') return false;
        _ops.popcount32 = wasmOps.popcount32;
        _ops.ctz32 = wasmOps.ctz32 ?? ctz32Js;
        _ops.popcountMask = wasmOps.popcountMask ?? popcountMaskJs;
        _ops.backend = wasmOps.backend ?? 'wasm';
        return true;
    } catch { return false; }
}

/* 测试 reset */
export function _resetBitmapOpsForTest() {
    _ops.popcount32 = popcount32Js;
    _ops.ctz32 = ctz32Js;
    _ops.popcountMask = popcountMaskJs;
    _ops.backend = 'js';
}
