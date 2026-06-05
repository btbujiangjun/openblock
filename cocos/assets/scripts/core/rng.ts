/**
 * 引擎无关 PRNG —— 由 miniprogram/core/lib/seededRng.js 忠实移植为 TS。
 * 用于可复现的出块顺序、洗牌、抽签（record-replay / A/B 实验）。
 */

export type Rng = () => number;

export const defaultRng: Rng = () => Math.random();

/** Mulberry32：确定性、可序列化的轻量伪随机源 */
export function createMulberry32(seed: number): Rng {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function pickIndex(rng: Rng, length: number): number {
    if (length <= 0) return -1;
    return Math.floor((rng ?? defaultRng)() * length);
}

export function fisherYatesInPlace<T>(
    arr: T[],
    rng: Rng = defaultRng,
    onSwap?: (i: number, j: number) => void,
): void {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        if (i !== j) {
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
            if (onSwap) onSwap(i, j);
        }
    }
}

export function fnv1a(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
}
