/* 自动生成 —— 请勿手改。源：web/src/evaluation/roundQuality.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * roundQuality.js — 一轮（dock 三块）放块质量评估
 *
 * 在 placementQuality 之上做轮级聚合，**额外**显式拆解"决策失误"来源：
 *   - orderRegret：玩家排列 vs 最优排列
 *   - pathRegret： 同一排列下，玩家放法 vs 该排列最佳放法
 *   - payoffRegret：玩家未兑现 vs 排列最大可消行数
 *
 * 设计：
 *   - 不重复枚举：只对 6! / 3! = 6 个排列做 BFS，每个排列 3 步直接调用 evaluatePlacement
 *     取该步在该 board 上的 bestAbs，避免 O(N²) 全枚举每一步两次；
 *   - 公平性门控：bestRoundAbs < forcedBadThreshold → classification='forced_bad'，
 *     不把 regret 算到玩家头上；bestRoundAbs < salvageThreshold 但 optimality 高 → 'salvage'。
 *
 * 输入由 caller 准备（见 docs/algorithms/SESSION_EVALUATION.md §3）：
 *   {
 *     boardBefore: cells,            // 本轮 spawn 后、第一步落子前的盘面
 *     dockShapes: [s0, s1, s2],      // dock 上的三个形状（顺序无关）
 *     moves: [                       // 玩家三步（按时间顺序）
 *       { dockIndex, pos:{x,y}, linesCleared, ts },
 *       ...
 *     ],
 *     config?: { weights, regretBlend, salvageThreshold, forcedBadThreshold }
 *   }
 *
 * 输出（稳定契约）：
 *   {
 *     absScore, optimality,
 *     regrets: { order, path, payoff, total },
 *     components: { solutionUsage, pathQuality, payoffRealized, endFlatness, continuity },
 *     classification: 'optimal'|'payoff_missed'|'order_wrong'|'placement_wrong'
 *                     |'forced_bad'|'salvage'|'incomplete',
 *     bestPermutation: number[],     // dockIndex 排列
 *     bestPositions: Array<{x,y}>,   // 最佳排列每步的最佳落点
 *     placements: Array<moveQuality>,// 三步逐步评估
 *   }
 */

import { evaluatePlacement } from './placementQuality.mjs';
import { analyzeBoardTopology } from '../boardTopology.mjs';
import { wrapCellsAsGrid } from './gridAdapter.mjs';

const DEFAULT_WEIGHTS = Object.freeze({
    solutionUsage: 0.25,
    pathQuality: 0.25,
    payoffRealized: 0.20,
    endFlatness: 0.15,
    continuity: 0.15,
});

const DEFAULT_REGRET_BLEND = Object.freeze({ order: 0.4, path: 0.4, payoff: 0.2 });

const DEFAULT_THRESHOLDS = Object.freeze({
    salvageThreshold: 0.5,
    forcedBadThreshold: 0.4,
    optimalRegret: 0.05,
    classifyDominantDelta: 0.15,
});

const PERMUTATIONS = Object.freeze([
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0],
]);

function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function cloneCells(cells) { return cells.map((row) => row.slice()); }

function applyShape(cells, shape, gx, gy) {
    const out = cloneCells(cells);
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x]) out[gy + y][gx + x] = 1;
        }
    }
    return out;
}

function clearLines(cells) {
    const N = cells.length;
    const fullR = [];
    const fullC = [];
    for (let r = 0; r < N; r++) {
        let f = true;
        for (let c = 0; c < N; c++) if (cells[r][c] === null) { f = false; break; }
        if (f) fullR.push(r);
    }
    for (let c = 0; c < N; c++) {
        let f = true;
        for (let r = 0; r < N; r++) if (cells[r][c] === null) { f = false; break; }
        if (f) fullC.push(c);
    }
    if (!fullR.length && !fullC.length) return { cells, lines: 0 };
    const out = cloneCells(cells);
    for (const r of fullR) for (let c = 0; c < N; c++) out[r][c] = null;
    for (const c of fullC) for (let r = 0; r < N; r++) out[r][c] = null;
    return { cells: out, lines: fullR.length + fullC.length };
}

function canPlace(cells, shape, gx, gy) {
    const N = cells.length;
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (!shape[y][x]) continue;
            const tx = gx + x;
            const ty = gy + y;
            if (tx < 0 || tx >= N || ty < 0 || ty >= N) return false;
            if (cells[ty][tx] !== null) return false;
        }
    }
    return true;
}

function enumerateBest(cells, shape, remaining, weights) {
    // 复用 evaluatePlacement，但只关心 absScore 与 lines。
    const N = cells.length;
    let bestAbs = -Infinity;
    let bestPos = null;
    let bestLines = 0;
    let bestCells = cells;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            if (!canPlace(cells, shape, x, y)) continue;
            const q = evaluatePlacement({
                boardBefore: cells,
                shape,
                pos: { x, y },
                remainingShapes: remaining,
                config: { weights: weights.placement || undefined },
            });
            if (q.absScore > bestAbs) {
                bestAbs = q.absScore;
                bestPos = { x, y };
                /* v1.69.2 修复（P2）：直接读 evaluatePlacement 返回的真实 lines，避免
                 * 从 components.payoff 反推（PAYOFF_LADDER 阶梯在自定义权重时失真）。 */
                bestLines = Number(q.lines) || 0;
                const placed = applyShape(cells, shape, x, y);
                bestCells = clearLines(placed).cells;
            }
        }
    }
    if (bestPos === null) return null;
    return { absScore: bestAbs, pos: bestPos, lines: bestLines, afterCells: bestCells };
}

/** 枚举给定 dock 排列的最佳总分（greedy per-step 上界）。 */
function bestForPermutation(boardBefore, dockShapes, perm, weights) {
    let cells = boardBefore;
    let total = 0;
    let totalLines = 0;
    const positions = [];
    for (let k = 0; k < perm.length; k++) {
        const idx = perm[k];
        const shape = dockShapes[idx];
        if (!shape) return null;
        const remaining = perm.slice(k + 1).map((i) => dockShapes[i]);
        const step = enumerateBest(cells, shape, remaining, weights);
        if (!step) return null;
        total += step.absScore;
        totalLines += step.lines;
        positions.push(step.pos);
        cells = step.afterCells;
    }
    return {
        avgAbs: total / perm.length,
        lines: totalLines,
        positions,
        endCells: cells,
    };
}

function recoverActualPermutation(moves) {
    const indices = moves.map((m) => m.dockIndex);
    return indices.length === 3 ? indices : null;
}

function actualEval(boardBefore, dockShapes, moves, weights) {
    let cells = boardBefore;
    const placements = [];
    let totalAbs = 0;
    let totalLines = 0;
    for (let k = 0; k < moves.length; k++) {
        const m = moves[k];
        const shape = dockShapes[m.dockIndex];
        if (!shape || !m.pos) return null;
        const remaining = moves.slice(k + 1)
            .map((mm) => dockShapes[mm.dockIndex])
            .filter(Boolean);
        const q = evaluatePlacement({
            boardBefore: cells,
            shape,
            pos: m.pos,
            remainingShapes: remaining,
            config: { weights: weights.placement || undefined },
        });
        placements.push(q);
        totalAbs += q.absScore;
        const placed = applyShape(cells, shape, m.pos.x, m.pos.y);
        const cleared = clearLines(placed);
        totalLines += cleared.lines;
        cells = cleared.cells;
    }
    return {
        avgAbs: totalAbs / moves.length,
        lines: totalLines,
        placements,
        endCells: cells,
    };
}

function classify(roundAbs, regrets, thresholds, components) {
    /* v1.69.2 修复（P0）：forced_bad 衡量的是"算法给的本轮形状/盘面在最优放法下也
     * 打不出好局"——即**算法责任**。判定指标必须是 bestRoundAbs（全局枚举的上界），
     * 而非 roundAbs（玩家实际放法 + 5 维 components 加权分）。
     *
     * 此前用 roundAbs 会让"玩家放得差导致 roundAbs 低"也被算成 forced_bad，错把
     * 玩家失误归责给算法；RL 训练侧（`_outcome_weight_factor` ×0.6 / `_pb_reward`
     * -0.10）因此长期收到错误信号。详见 docs/algorithms/PLACEMENT_QUALITY.md §3.3。 */
    if (components.bestRoundAbs < thresholds.forcedBadThreshold) return 'forced_bad';
    if (regrets.total <= thresholds.optimalRegret) return 'optimal';
    if (components.optimality >= 0.85 && components.bestRoundAbs < thresholds.salvageThreshold) {
        return 'salvage';
    }
    const dominant = Object.entries({
        order: regrets.order, path: regrets.path, payoff: regrets.payoff,
    }).reduce((a, b) => (a[1] >= b[1] ? a : b));
    if (dominant[1] < thresholds.classifyDominantDelta) return 'optimal';
    if (dominant[0] === 'payoff') return 'payoff_missed';
    if (dominant[0] === 'order') return 'order_wrong';
    return 'placement_wrong';
}

/* ─────────────────────────── 主入口 ─────────────────────────── */

export function evaluateRound(args) {
    const { boardBefore, dockShapes, moves, config = {} } = args || {};
    const weights = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };
    const regretBlend = { ...DEFAULT_REGRET_BLEND, ...(config.regretBlend || {}) };
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(config.thresholds || {}) };
    weights.placement = config.placementWeights;

    if (!Array.isArray(boardBefore) || !Array.isArray(dockShapes) || dockShapes.length !== 3
        || !Array.isArray(moves) || moves.length !== 3) {
        return incompleteResult();
    }

    const actualPerm = recoverActualPermutation(moves);
    const actual = actualEval(boardBefore, dockShapes, moves, weights);
    if (!actual) return incompleteResult();

    // 枚举所有 6 个排列的最优均分。
    let bestPermResult = null;
    let bestPerm = null;
    let bestLinesAcrossPerms = 0;
    const permScores = new Map();
    for (const perm of PERMUTATIONS) {
        const r = bestForPermutation(boardBefore, dockShapes, perm, weights);
        if (!r) continue;
        permScores.set(perm.join(','), r);
        if (r.lines > bestLinesAcrossPerms) bestLinesAcrossPerms = r.lines;
        if (!bestPermResult || r.avgAbs > bestPermResult.avgAbs) {
            bestPermResult = r;
            bestPerm = perm;
        }
    }
    if (!bestPermResult) return incompleteResult();

    // path regret：把 actual 顺序投回最佳排列上对比。
    let actualPermBest = null;
    if (actualPerm) {
        const k = actualPerm.join(',');
        actualPermBest = permScores.get(k) || null;
    }

    const endAnalysis = analyzeBoardTopology(wrapCellsAsGrid(actual.endCells));

    // 5 维 round components。
    const solutionUsage = (() => {
        if (!actualPermBest) return 0;
        const ranked = Array.from(permScores.values())
            .map((r) => r.avgAbs)
            .sort((a, b) => b - a);
        const idx = ranked.indexOf(actualPermBest.avgAbs);
        if (idx < 0) return 0;
        return clamp01(1 - idx / Math.max(1, ranked.length - 1));
    })();
    const pathQuality = actualPermBest && actualPermBest.avgAbs > 0
        ? clamp01(actual.avgAbs / actualPermBest.avgAbs)
        : 0;
    const payoffRealized = bestLinesAcrossPerms > 0
        ? clamp01(actual.lines / bestLinesAcrossPerms)
        : 1;
    const endFlatness = clamp01(endAnalysis.flatness);
    const continuity = (() => {
        const maxColH = endAnalysis.maxColHeight ?? 0;
        const N = endAnalysis.colHeights?.length ?? 1;
        return clamp01(1 - maxColH / Math.max(1, N));
    })();

    const components = {
        solutionUsage, pathQuality, payoffRealized, endFlatness, continuity,
    };
    const roundAbs = clamp01(
        solutionUsage * weights.solutionUsage
        + pathQuality * weights.pathQuality
        + payoffRealized * weights.payoffRealized
        + endFlatness * weights.endFlatness
        + continuity * weights.continuity,
    );

    const orderRegret = clamp01(bestPermResult.avgAbs - (actualPermBest?.avgAbs ?? bestPermResult.avgAbs));
    const pathRegret = actualPermBest
        ? clamp01(actualPermBest.avgAbs - actual.avgAbs)
        : clamp01(bestPermResult.avgAbs - actual.avgAbs);
    const payoffRegret = bestLinesAcrossPerms > 0
        ? clamp01((bestLinesAcrossPerms - actual.lines) / bestLinesAcrossPerms)
        : 0;
    const total = clamp01(
        orderRegret * regretBlend.order
        + pathRegret * regretBlend.path
        + payoffRegret * regretBlend.payoff,
    );

    const optimality = bestPermResult.avgAbs > 0
        ? clamp01(actual.avgAbs / bestPermResult.avgAbs)
        : 1;
    const classification = classify(roundAbs,
        { order: orderRegret, path: pathRegret, payoff: payoffRegret, total },
        thresholds,
        { optimality, bestRoundAbs: bestPermResult.avgAbs });

    return {
        absScore: roundAbs,
        optimality,
        regrets: { order: orderRegret, path: pathRegret, payoff: payoffRegret, total },
        components,
        classification,
        bestPermutation: bestPerm,
        bestPositions: bestPermResult.positions,
        placements: actual.placements,
        bestRoundAbs: bestPermResult.avgAbs,
        bestLinesAcrossPerms,
    };
}

function incompleteResult() {
    return {
        absScore: 0,
        optimality: 0,
        regrets: { order: 0, path: 0, payoff: 0, total: 0 },
        components: {
            solutionUsage: 0, pathQuality: 0, payoffRealized: 0,
            endFlatness: 0, continuity: 0,
        },
        classification: 'incomplete',
        bestPermutation: null,
        bestPositions: null,
        placements: [],
        bestRoundAbs: 0,
        bestLinesAcrossPerms: 0,
    };
}

export const ROUND_DEFAULT_WEIGHTS = DEFAULT_WEIGHTS;
export const ROUND_DEFAULT_REGRET_BLEND = DEFAULT_REGRET_BLEND;
export const ROUND_DEFAULT_THRESHOLDS = DEFAULT_THRESHOLDS;
