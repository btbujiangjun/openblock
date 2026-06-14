/**
 * complexityGuard.js — 复杂度/调参治理（EX-1）
 *
 * profileAudit 发现 session-arc「难度单调爬升过快」违反率 67%。本守卫对单局内
 * 难度递增施加**斜率上限**与**回落窗口**，把"持续高压"修正为"压力-释放"节奏：
 *   - 每步难度增量不超过 maxStepDelta；
 *   - 连续上升步数超过 reliefEvery 时，强制一次回落（relief）。
 * 纯函数，供 adaptiveSpawn / difficulty 调用。
 */

export const DEFAULT_ARC_CAPS = {
    maxStepDelta: 0.06,   // 单步难度最大增量
    reliefEvery: 5,       // 连升 N 步后强制回落
    reliefDrop: 0.12,     // 回落幅度
    min: 0.0,
    max: 1.0,
};

/**
 * 治理下一步难度。
 * @param {number} prev 上一步难度（0..1）
 * @param {number} proposed 模型/规则建议难度
 * @param {object} state { risingStreak } 连升计数（调用方持有并回写）
 * @param {object} caps
 * @returns {{ difficulty:number, relief:boolean, risingStreak:number }}
 */
export function governComplexityStep(prev, proposed, state = {}, caps = {}) {
    const c = { ...DEFAULT_ARC_CAPS, ...caps };
    let rising = Math.max(0, Number(state.risingStreak) || 0);
    let next = Number(proposed);
    if (!Number.isFinite(next)) next = prev;

    // 1) 限制单步上升斜率
    if (next > prev + c.maxStepDelta) next = prev + c.maxStepDelta;

    let relief = false;
    if (next > prev) {
        rising += 1;
    } else {
        rising = 0;
    }
    // 2) 连升过久 → 强制回落（压力释放）
    if (rising >= c.reliefEvery) {
        next = prev - c.reliefDrop;
        relief = true;
        rising = 0;
    }
    next = Math.min(c.max, Math.max(c.min, next));
    return { difficulty: +next.toFixed(4), relief, risingStreak: rising };
}

/**
 * 评估一条难度序列的「弧线健康度」：上升斜率是否受控 + 是否含释放。
 * 返回 { ok, maxSlope, reliefCount, violations }。供 profileAudit 复核。
 */
export function evaluateArcHealth(series, caps = {}) {
    const c = { ...DEFAULT_ARC_CAPS, ...caps };
    let maxSlope = 0;
    let reliefCount = 0;
    let violations = 0;
    let risingStreak = 0;
    for (let i = 1; i < (series || []).length; i++) {
        const d = series[i] - series[i - 1];
        if (d > maxSlope) maxSlope = d;
        if (d > c.maxStepDelta + 1e-9) violations += 1;
        if (d < 0) { reliefCount += 1; risingStreak = 0; } else { risingStreak += 1; }
        if (risingStreak > c.reliefEvery) violations += 1;
    }
    return { ok: violations === 0, maxSlope: +maxSlope.toFixed(4), reliefCount, violations };
}
