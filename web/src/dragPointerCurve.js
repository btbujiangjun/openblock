/**
 * 拖拽指针速度感知曲线（pointer ballistics）。
 *
 * 与桌面操作系统的鼠标加速曲线同构，被 web 端 `Game._applyDragPointerGain` 与
 * 小程序端 `_touchControlPoint` 各自 inline 复用（小程序不直接 import ESM）。
 *
 * 模型：
 *   speed ≤ slow → minGain（对位精准，不抢跑）
 *   speed ≥ fast → maxGain（快速一甩到对岸省力）
 *   中间段在两端线性插值
 *
 * `stepGain = effectiveGain - 1` 是给增量积分式累加用的——
 * 每帧把"本帧位移 × stepGain"累加进 `_extraOffset`，
 * `ghost = 鼠标 + _extraOffset`，单调累加保证不抖。
 *
 * 抽离原因：把这段简单但关键的数学独立测试，避免每次调阈值都要起完整 Game
 * 实例做 e2e 才能验证。
 */

/**
 * 把瞬时速度（px/ms）归一到 [0, 1] 的"速度因子"。
 * @param {number} speedPxMs
 * @param {number} slowSpeed
 * @param {number} fastSpeed
 * @returns {number}
 */
export function velocityFactor(speedPxMs, slowSpeed, fastSpeed) {
    if (!Number.isFinite(speedPxMs)) return 0;
    const lo = Number.isFinite(slowSpeed) ? slowSpeed : 0;
    const hi = Number.isFinite(fastSpeed) ? fastSpeed : 1;
    const span = Math.max(0.001, hi - lo);
    return Math.max(0, Math.min(1, (speedPxMs - lo) / span));
}

/**
 * 在 [minGain, maxGain] 之间按速度因子线性插值。
 * @param {number} factor
 * @param {number} minGain
 * @param {number} maxGain
 * @returns {number}
 */
export function effectiveGain(factor, minGain, maxGain) {
    const f = Math.max(0, Math.min(1, Number(factor) || 0));
    const lo = Number.isFinite(minGain) ? minGain : 1;
    const hi = Number.isFinite(maxGain) ? maxGain : lo;
    return lo + (hi - lo) * f;
}

/**
 * 直接由速度算 stepGain（增量增益，仅作用于本帧位移）。
 * @param {number} speedPxMs
 * @param {{ slow:number, fast:number, minGain:number, maxGain:number }} cfg
 * @returns {number}
 */
export function computeStepGain(speedPxMs, cfg) {
    const f = velocityFactor(speedPxMs, cfg.slow, cfg.fast);
    const g = effectiveGain(f, cfg.minGain, cfg.maxGain);
    return Math.max(0, g - 1);
}
