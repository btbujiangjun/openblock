/**
 * 消行计分与 bonus 检测（与对局、回放、RL 无头模拟器共用）。
 *
 * 注意：不要从本文件 import game.js，避免循环依赖。
 */
import { getStrategy } from './config.js';

/**
 * 在 clearEngine.apply() / grid.checkLines() **之前**（格子尚未被置 null）扫描
 * 满行/满列，判断是否全为同一 icon（优先）或同一 colorIdx（无 icon 皮肤）。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {{ blockIcons?: string[] }|null} skin
 * @returns {Array<{type:'row'|'col', idx:number, colorIdx:number, icon:string|null}>}
 */
export function detectBonusLines(grid, skin) {
    const n = grid.size;
    const blockIcons = skin?.blockIcons;
    const getIcon = ci => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);
    const result = [];

    for (let y = 0; y < n; y++) {
        const row = grid.cells[y];
        if (row.some(c => c === null)) continue;
        const icon0 = getIcon(row[0]);
        const allSame = icon0 !== null
            ? row.every(c => getIcon(c) === icon0)
            : row.every(c => c === row[0]);
        if (allSame) result.push({ type: 'row', idx: y, colorIdx: row[0], icon: icon0 });
    }

    for (let x = 0; x < n; x++) {
        const col = [];
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] === null) { col.length = 0; break; }
            col.push(grid.cells[y][x]);
        }
        if (!col.length) continue;
        const icon0 = getIcon(col[0]);
        const allSame = icon0 !== null
            ? col.every(c => getIcon(c) === icon0)
            : col.every(c => c === col[0]);
        if (allSame) result.push({ type: 'col', idx: x, colorIdx: col[0], icon: icon0 });
    }

    return result;
}

/** 整行/列同色或同 icon：bonus 线在 UI 上按该倍数展示 */
export const ICON_BONUS_LINE_MULT = 5;

/** 同色/同 icon bonus：粒子 + UI 整段时长（目标约 3–5 秒） */
export function bonusEffectHoldMs(bonusCount) {
    if (bonusCount <= 0) return 0;
    return Math.min(5000, Math.max(3000, 3000 + bonusCount * 400));
}

/**
 * @param {string} strategyId
 * @param {{ count: number, bonusLines?: Array<unknown> }} result
 * @param {{ singleLine?: number, multiLine?: number, combo?: number }|null} [scoringOverride] 回放等场景使用 init 帧内嵌的 scoring，避免与当前策略默认值漂移
 * @returns {{ baseScore: number, iconBonusScore: number, clearScore: number }}
 */
export function computeClearScore(strategyId, result, scoringOverride) {
    const scoring = scoringOverride && typeof scoringOverride === 'object'
        ? scoringOverride
        : getStrategy(strategyId).scoring;
    const c = result?.count ?? 0;
    const baseUnit = scoring.singleLine ?? 20;
    const baseScore = c > 0 ? baseUnit * c * c : 0;

    const bonusLines = result?.bonusLines || [];
    const bonusCount = bonusLines.length;
    if (c <= 0 || bonusCount <= 0) {
        return { baseScore, iconBonusScore: 0, clearScore: baseScore };
    }
    const effectiveBonusCount = Math.min(bonusCount, c);
    const lineScore = baseUnit * c;
    const iconBonusScore = lineScore * effectiveBonusCount * (ICON_BONUS_LINE_MULT - 1);
    return { baseScore, iconBonusScore, clearScore: baseScore + iconBonusScore };
}
