/**
 * 消行计分与 bonus 检测（与对局、回放、RL 无头模拟器共用）。
 *
 * RL / 训练路径与主局对齐：`shared/game_rules.json` → `rlBonusScoring` +
 * `skins.js` 的 `getRlTrainingBonusLineSkin()`（固定 canonical 主题下的 blockIcons，
 * 不是玩家当前皮肤）；策略观测仍不得包含出块算法内部状态。
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

/**
 * 每条「差 1～2 格就满、且已占格同 icon / 同色」的行列给相关颜色加的采样权重（出块染色与加分目标对齐）。
 */
export const MONO_NEAR_FULL_COLOR_WEIGHT = 0.55;

/**
 * 扫描近满行/列：已填入部分若已为同一 icon（优先）或同色（无 icon），则提高对应颜色在本轮 dock 的出现概率。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {{ blockIcons?: string[] } | null} [skin]
 * @returns {number[]} length 8
 */
export function monoNearFullLineColorWeights(grid, skin = null) {
    const w = new Array(8).fill(0);
    if (!grid?.cells) return w;

    const n = grid.size;
    const blockIcons = skin?.blockIcons;
    const getIcon = (ci) => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);
    const dockSlot = (ci) => ((ci % 8) + 8) % 8;

    /**
     * @param {number[]} filledVals row/col 上非 null 的 colorIdx（有序）
     */
    function addWeightsForNearFullLine(filledVals) {
        if (filledVals.length === 0) return;
        const icon0 = getIcon(filledVals[0]);
        const monoIcon = icon0 !== null && filledVals.every((c) => getIcon(c) === icon0);
        const monoColor = icon0 === null && filledVals.every((c) => c === filledVals[0]);
        if (!monoIcon && !monoColor) return;

        if (monoIcon) {
            const distinctDock = [...new Set(filledVals.map(dockSlot))];
            const share = MONO_NEAR_FULL_COLOR_WEIGHT / distinctDock.length;
            for (const s of distinctDock) w[s] += share;
        } else {
            w[dockSlot(filledVals[0])] += MONO_NEAR_FULL_COLOR_WEIGHT;
        }
    }

    for (let y = 0; y < n; y++) {
        const filled = [];
        for (let x = 0; x < n; x++) {
            const c = grid.cells[y][x];
            if (c !== null) filled.push(c);
        }
        const empty = n - filled.length;
        if (empty >= 1 && empty <= 2) addWeightsForNearFullLine(filled);
    }

    for (let x = 0; x < n; x++) {
        const filled = [];
        for (let y = 0; y < n; y++) {
            const c = grid.cells[y][x];
            if (c !== null) filled.push(c);
        }
        const empty = n - filled.length;
        if (empty >= 1 && empty <= 2) addWeightsForNearFullLine(filled);
    }

    return w;
}

/**
 * 三连块颜色：在 8 色中无放回加权抽样，偏置仍保持随机性（与纯洗牌相比略提高「急需色」占比）。
 *
 * @param {number[]} biasWeights length 8
 * @param {() => number} [rnd]
 * @returns {[number, number, number]}
 */
export function pickThreeDockColors(biasWeights, rnd = Math.random) {
    const bias = biasWeights || [];
    const pool = [0, 1, 2, 3, 4, 5, 6, 7];
    const out = [];
    for (let k = 0; k < 3; k++) {
        let total = 0;
        for (const c of pool) {
            total += 1 + (bias[c] || 0);
        }
        let r = rnd() * total;
        let chosen = pool[0];
        for (const c of pool) {
            r -= 1 + (bias[c] || 0);
            if (r <= 0) {
                chosen = c;
                break;
            }
        }
        out.push(chosen);
        pool.splice(pool.indexOf(chosen), 1);
    }
    return /** @type {[number, number, number]} */ (out);
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
