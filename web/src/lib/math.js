/**
 * lib/math.js — 公共数学 util（v1.61.17 抽取，避免 10+ 个文件重复实现）
 *
 * 严格版（带 NaN 防护）—— 适用于所有面向用户的指标计算。
 * 若需要"无防护快速版"，请就地 `Math.max(0, Math.min(1, v))`（仅 hot 路径），
 * 但务必先确保上游必产出有限数。
 */

/** 钳制到 [0, 1]；NaN / Infinity / 非数字 → 0 */
export function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

/** 线性归一化到 [0, 1]：value / max；max ≤ 0 或非有限数 → 0 */
export function norm(value, max) {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    return Math.max(0, Math.min(value / max, 1));
}

/** 钳制到 [lo, hi]；NaN → lo（与 clamp01 防护一致） */
export function clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
}
