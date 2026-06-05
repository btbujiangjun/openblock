/* 自动生成 —— 请勿手改。源：web/src/lib/seededRng.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * 共享 PRNG 工具（v1.60.1：Issue 4 修复 — 让 _tryInjectSpecial / Fisher-Yates 可种子化）
 *
 * 设计目标：
 *   - 提供轻量、确定性、可序列化的伪随机数源，给"事件注入 / 洗牌 / 公平抽签"等
 *     需要 record-replay 与 A/B 实验可复现性的路径使用
 *   - 与 dailyMaster.js 原 _mulberry32 兼容（同算法、同输出），将来可统一替换
 *   - 不打包额外依赖（mulberry32 即 32-bit 哈希混合，约 12 行）
 *
 * 用法：
 *   import { createMulberry32, defaultRng } from './lib/seededRng.mjs';
 *
 *   // 1. 不在乎可复现：直接传 defaultRng（= Math.random）
 *   const r1 = defaultRng();
 *
 *   // 2. 按 seed 复现：
 *   const rng = createMulberry32(0xdeadbeef);
 *   for (let i = 0; i < 10; i++) console.log(rng());  // 同 seed 永远同序列
 *
 *   // 3. 公用工具：
 *   const idx = pickIndex(rng, arr.length);
 *   fisherYatesInPlace(arr, rng);
 *
 * 与 dailyMaster.js _mulberry32 关系：
 *   - 算法完全等价（同一 32-bit Mulberry32 实现）
 *   - dailyMaster 仍保留私有实现以避免运行时循环依赖；v1.60.1 后续若稳定可统一收编。
 */

/** 默认 RNG：等同于 Math.random，无可复现性 */
export const defaultRng = () => Math.random();

/**
 * 创建一个 Mulberry32 伪随机数生成器。
 *
 * @param {number} seed - 任意 32-bit 整数（实际取 uint32）
 * @returns {() => number} 一个无参数函数，每次调用返回 [0, 1) 浮点数
 */
export function createMulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 在 [0, length) 范围内挑一个均匀整数 index。
 * 用 rng() * length 后向下取整（与 Math.floor(Math.random() * len) 行为一致）。
 *
 * @param {() => number} rng
 * @param {number} length
 * @returns {number}
 */
export function pickIndex(rng, length) {
    if (length <= 0) return -1;
    return Math.floor((rng ?? defaultRng)() * length);
}

/**
 * 原地 Fisher-Yates 洗牌。
 *
 * v1.60.1：从 blockSpawn.js 内联实现抽出，支持自定义 rng 让出块顺序可复现。
 *
 * @template T
 * @param {T[]} arr  - 被洗的数组（原地修改）
 * @param {() => number} [rng]  - 默认 Math.random
 * @param {(i: number, j: number) => void} [onSwap]  - 可选钩子：每次 swap(i, j) 时调用，
 *   用于同步打乱"并行数组"（如 triplet 与 chosenMeta 必须保持同序）
 */
export function fisherYatesInPlace(arr, rng, onSwap) {
    const r = rng ?? defaultRng;
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        if (i !== j) {
            const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            if (onSwap) onSwap(i, j);
        }
    }
}

/**
 * 32-bit FNV-1a 字符串哈希 — 可用于把 sessionId / ymd 等字符串映射为 seed。
 *
 * 与 dailyMaster.js `_fnv1a` 等价（同算法）。
 *
 * @param {string} str
 * @returns {number} uint32
 */
export function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
}
