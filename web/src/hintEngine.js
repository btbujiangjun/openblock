/**
 * 求助提示引擎：枚举当前盘面所有合法落子，用多维启发式评分排序，返回 Top-N 建议。
 *
 * 评分维度（加权合成 totalScore）：
 *   1. clearScore      — 消行数（最重要：得分、腾空间）
 *   2. gapFillScore    — 填补接近满行/满列的缺口
 *   3. mobilityScore   — 落子后剩余块的可放位置数（防呆死）
 *   4. compactScore    — 落子后重心偏低 + 左右对称 → 稳定结构
 *   5. survivalScore   — 落子后全部 3 块能否按某序全放下（轻量 DFS）
 *   6. fillPenalty     — 落子后盘面填充率过高 → 风险惩罚
 */

// Grid imported for JSDoc type references only; actual grid instances come from game.js
// eslint-disable-next-line no-unused-vars
import { Grid } from './grid.js';

const WEIGHTS = {
    clear: 50,
    gapFill: 8,
    mobility: 3,
    compact: 1.5,
    survival: 25,
    fillPenalty: -30,
};

function _cellCount(shape) {
    let c = 0;
    for (const row of shape) for (const v of row) if (v) c++;
    return c;
}

function _centroid(shape, gx, gy) {
    let sx = 0, sy = 0, n = 0;
    for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c]) { sx += gx + c; sy += gy + r; n++; }
        }
    }
    return n > 0 ? { cx: sx / n, cy: sy / n } : { cx: gx, cy: gy };
}

function _countPlacements(grid, shape) {
    let c = 0;
    const n = grid.size;
    for (let gy = 0; gy < n; gy++)
        for (let gx = 0; gx < n; gx++)
            if (grid.canPlace(shape, gx, gy)) c++;
    return c;
}

function _placeAndClear(grid, shape, colorIdx, gx, gy) {
    const g = grid.clone();
    g.place(shape, colorIdx, gx, gy);
    const result = g.checkLines();
    return { grid: g, cleared: result.count };
}

function _canPlaceAll3InSomeOrder(grid, remaining, budget) {
    if (remaining.length === 0) return true;
    for (let i = 0; i < remaining.length; i++) {
        const b = remaining[i];
        const n = grid.size;
        for (let gy = 0; gy < n; gy++) {
            for (let gx = 0; gx < n; gx++) {
                if (budget.v <= 0) return true;
                if (!grid.canPlace(b.shape, gx, gy)) continue;
                budget.v--;
                const after = _placeAndClear(grid, b.shape, b.colorIdx, gx, gy);
                const rest = remaining.filter((_, j) => j !== i);
                if (_canPlaceAll3InSomeOrder(after.grid, rest, budget)) return true;
            }
        }
    }
    return false;
}

/**
 * @param {Grid} grid
 * @param {Array<{id:string, shape:number[][], colorIdx:number, placed:boolean}>} dockBlocks
 * @param {number} [topN=3]
 * @returns {Array<{blockIdx:number, gx:number, gy:number, blockId:string, scores:object, totalScore:number, explain:string[]}>}
 */
export function computeHints(grid, dockBlocks, topN = 3) {
    const n = grid.size;
    const candidates = [];

    for (let bi = 0; bi < dockBlocks.length; bi++) {
        const b = dockBlocks[bi];
        if (b.placed) continue;
        for (let gy = 0; gy < n; gy++) {
            for (let gx = 0; gx < n; gx++) {
                if (!grid.canPlace(b.shape, gx, gy)) continue;

                const after = _placeAndClear(grid, b.shape, b.colorIdx, gx, gy);
                const clearScore = after.cleared;

                const gapFillScore = grid.countGapFills(b.shape) / 10;

                const others = dockBlocks.filter((ob, oi) => oi !== bi && !ob.placed);
                let mobSum = 0;
                for (const ob of others) {
                    mobSum += _countPlacements(after.grid, ob.shape);
                }
                const mobilityScore = Math.min(1, mobSum / Math.max(1, others.length * 15));

                const { cy } = _centroid(b.shape, gx, gy);
                const compactScore = (cy / n) * 0.6 + (1 - Math.abs(gx + b.shape[0].length / 2 - n / 2) / (n / 2)) * 0.4;

                const afterFill = after.grid.getFillRatio();
                const fillPenalty = afterFill > 0.75 ? (afterFill - 0.75) * 4 : 0;

                let survivalScore = 0;
                if (others.length > 0) {
                    const budget = { v: 800 };
                    const remaining = others.map(o => ({ shape: o.shape, colorIdx: o.colorIdx }));
                    survivalScore = _canPlaceAll3InSomeOrder(after.grid, remaining, budget) ? 1 : 0;
                } else {
                    survivalScore = 1;
                }

                const total =
                    WEIGHTS.clear * clearScore +
                    WEIGHTS.gapFill * gapFillScore +
                    WEIGHTS.mobility * mobilityScore +
                    WEIGHTS.compact * compactScore +
                    WEIGHTS.survival * survivalScore +
                    WEIGHTS.fillPenalty * fillPenalty;

                const explain = [];
                if (clearScore > 0) explain.push(`消 ${clearScore} 行（+${(WEIGHTS.clear * clearScore).toFixed(0)} 分）`);
                if (gapFillScore > 0.1) explain.push(`填缺口 +${(WEIGHTS.gapFill * gapFillScore).toFixed(1)}`);
                if (survivalScore > 0) explain.push('剩余块可全放下');
                else explain.push('⚠ 剩余块可能放不下');
                if (fillPenalty > 0.1) explain.push(`填充率偏高 ${(afterFill * 100).toFixed(0)}%`);
                explain.push(`机动性 ${(mobilityScore * 100).toFixed(0)}% · 结构 ${(compactScore * 100).toFixed(0)}%`);

                candidates.push({
                    blockIdx: bi,
                    gx,
                    gy,
                    blockId: b.id,
                    scores: { clearScore, gapFillScore, mobilityScore, compactScore, survivalScore, fillPenalty, afterFill },
                    totalScore: total,
                    explain,
                });
            }
        }
    }

    candidates.sort((a, b) => b.totalScore - a.totalScore);

    const seen = new Set();
    const deduped = [];
    for (const c of candidates) {
        const key = `${c.blockIdx}:${c.gx}:${c.gy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(c);
        if (deduped.length >= topN) break;
    }
    return deduped;
}
