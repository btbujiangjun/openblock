/**
 * lib/math.js — 公共数学 util（v1.61.17 抽取，避免 10+ 个文件重复实现）
 *
 * 严格版（带 NaN 防护）—— 适用于所有面向用户的指标计算。
 * 若需要"无防护快速版"，请就地 `Math.max(0, Math.min(1, v))`（仅 hot 路径），
 * 但务必先确保上游必产出有限数。
 */

/** 钳制到 [0, 1]；NaN / Infinity / 非数字 → 0 */
function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

/** 线性归一化到 [0, 1]：value / max；max ≤ 0 或非有限数 → 0 */
function norm(value, max) {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    return Math.max(0, Math.min(value / max, 1));
}

/** 钳制到 [lo, hi]；NaN → lo（与 clamp01 防护一致） */
function clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
}

/**
 * 一元线性回归斜率（x = 索引 0..n-1）：用于序列趋势（上升/下降）量化。
 * 不足 2 点或分母为 0 → 0。非数字元素按 0 处理（带防护）。
 * @param {number[]} arr 时间序列（按时间升序）
 * @returns {number} 斜率
 */
function regressionSlope(arr) {
    if (!arr || arr.length < 2) return 0;
    const n = arr.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        const y = Number(arr[i]) || 0;
        sumX += i; sumY += y; sumXY += i * y; sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

module.exports = { clamp, clamp01, norm, regressionSlope };
