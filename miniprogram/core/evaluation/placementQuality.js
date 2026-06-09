/**
 * placementQuality.js — 单步放块质量评估（per-move）
 *
 * 纯函数：给定"放置前盘面 cells + 块形状 + 实际落点"，枚举该块在棋盘上的
 * 所有合法落点，计算 5 维分量评分（contact / tidiness / holeSafety / payoff /
 * unlocking），同时给出该步 absScore、对照最优落点的 regret 以及单标签
 * badnessTag，供 sessionEvaluator 聚合与 strategyAdvisor 解释。
 *
 * 设计原则（见 docs/algorithms/PLACEMENT_QUALITY.md）：
 *   - 不读全局状态：所有输入由 caller 传入；
 *   - 不做副作用：盘面只读，所有"假落子"都在临时副本上做；
 *   - 节流：当解空间太松（fill 低 + 候选位多）跳过 enumerate；
 *   - 与 boardTopology / countLegalPlacements 同口径，不引入新几何概念。
 *
 * cells 约定：与 web/src/grid.js 一致，`null`=空格、非 null=已占用。
 *
 * 输出形状（稳定契约）：
 *   {
 *     absScore: number,            // [0,1]，5 维加权和
 *     regret: number,              // [0,1]，bestAbs - absScore
 *     optimality: number,          // [0,1]，absScore / bestAbs
 *     components: { contact, tidiness, holeSafety, payoff, unlocking },
 *     optimalPos: { x, y } | null,
 *     badnessTag: 'optimal' | 'created_hole' | 'top_stacking'
 *                 | 'wasted_payoff' | 'fine',
 *     evaluated: boolean,          // false=节流跳过，使用默认乐观值
 *     candidateCount: number,
 *   }
 */

const { analyzeBoardTopology } = require('../boardTopology');
const { wrapCellsAsGrid } = require('./gridAdapter');

const DEFAULT_WEIGHTS = Object.freeze({
    contact: 0.20,
    tidiness: 0.20,
    holeSafety: 0.30,
    payoff: 0.20,
    unlocking: 0.10,
});

const DEFAULT_THROTTLE = Object.freeze({
    skipWhenFillBelow: 0.25,
    skipWhenCandidatesAbove: 500,
});

const DEFAULT_BADNESS = Object.freeze({
    createdHoleDelta: 2,
    topStackingHeightDelta: 2,
    wastedPayoffNearFullLines: 2,
});

const PAYOFF_LADDER = Object.freeze([0, 0.4, 0.7, 1.0]); // 0/1/2/3+ 行

/* ─────────────────────────── 工具 ─────────────────────────── */

function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function cloneCells(cells) {
    return cells.map((row) => row.slice());
}

function shapeCellCount(shape) {
    let n = 0;
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) if (shape[y][x]) n++;
    }
    return n;
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

function place(cells, shape, gx, gy) {
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
    const fullRows = [];
    const fullCols = [];
    for (let r = 0; r < N; r++) {
        let full = true;
        for (let c = 0; c < N; c++) if (cells[r][c] === null) { full = false; break; }
        if (full) fullRows.push(r);
    }
    for (let c = 0; c < N; c++) {
        let full = true;
        for (let r = 0; r < N; r++) if (cells[r][c] === null) { full = false; break; }
        if (full) fullCols.push(c);
    }
    if (!fullRows.length && !fullCols.length) return { cells, lines: 0 };
    const out = cloneCells(cells);
    for (const r of fullRows) for (let c = 0; c < N; c++) out[r][c] = null;
    for (const c of fullCols) for (let r = 0; r < N; r++) out[r][c] = null;
    return { cells: out, lines: fullRows.length + fullCols.length };
}

function analyzeCells(cells) {
    return analyzeBoardTopology(wrapCellsAsGrid(cells));
}

/** flatness = 1/(1+heightVariance) → heightVariance = 1/flatness - 1。 */
function invFlatness(f) {
    if (!Number.isFinite(f) || f <= 0) return 0;
    return Math.max(0, 1 / f - 1);
}

/* ─────────────────────────── 评分 ─────────────────────────── */

function neighborContact(cells, shape, gx, gy) {
    const N = cells.length;
    let adj = 0;
    let edge = 0;
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (!shape[y][x]) continue;
            const tx = gx + x;
            const ty = gy + y;
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
                const sx = x + dx;
                const sy = y + dy;
                // 形状内部相邻格不计入"对外接触"。
                if (sx >= 0 && sy >= 0 && sx < shape[y].length
                    && sy < shape.length && shape[sy] && shape[sy][sx]) continue;
                const nx = tx + dx;
                const ny = ty + dy;
                if (nx < 0 || nx >= N || ny < 0 || ny >= N) { edge++; continue; }
                if (cells[ny][nx] !== null) adj++;
            }
        }
    }
    return { adj, edge };
}

function contactScore(adj, edge, cellCount) {
    const denom = Math.max(1, cellCount * 4);
    return clamp01((adj + 0.5 * edge) / denom);
}

function minLegalAcross(cells, shapes) {
    if (!shapes || !shapes.length) return 0;
    let mn = Number.POSITIVE_INFINITY;
    for (const s of shapes) {
        if (!s || !s.length) continue;
        let cnt = 0;
        for (let y = 0; y < cells.length; y++) {
            for (let x = 0; x < cells.length; x++) {
                if (canPlace(cells, s, x, y)) cnt++;
            }
        }
        if (cnt < mn) mn = cnt;
    }
    return Number.isFinite(mn) ? mn : 0;
}

function scoreCandidate(beforeAnalysis, cells, shape, gx, gy, remainingShapes) {
    const cellCount = shapeCellCount(shape);
    const { adj, edge } = neighborContact(cells, shape, gx, gy);
    const placed = place(cells, shape, gx, gy);
    const { cells: afterCells, lines } = clearLines(placed);
    const after = analyzeCells(afterCells);

    const heightVarDelta = invFlatness(after.flatness) - invFlatness(beforeAnalysis.flatness);
    const holesDelta = after.holes - beforeAnalysis.holes;
    const enclosedDelta = (after.enclosedVoidCells ?? 0)
        - (beforeAnalysis.enclosedVoidCells ?? 0);

    const payoffIdx = Math.min(PAYOFF_LADDER.length - 1, lines);
    const payoff = PAYOFF_LADDER[payoffIdx];

    const contact = contactScore(adj, edge, cellCount);
    const tidiness = clamp01(0.5 - heightVarDelta);
    const holeSafety = 1 - clamp01(sigmoid(0.9 * holesDelta + 0.5 * enclosedDelta) - 0.5);

    let unlocking;
    if (remainingShapes && remainingShapes.length) {
        const beforeMin = minLegalAcross(cells, remainingShapes);
        const afterMin = minLegalAcross(afterCells, remainingShapes);
        unlocking = clamp01((afterMin - beforeMin) / 4 + 0.5);
    } else {
        unlocking = 0.5;
    }

    return {
        contact, tidiness, holeSafety, payoff, unlocking,
        lines, holesDelta, enclosedDelta, heightVarDelta, afterAnalysis: after,
    };
}

function weightedSum(comp, w) {
    return clamp01(
        comp.contact * w.contact
        + comp.tidiness * w.tidiness
        + comp.holeSafety * w.holeSafety
        + comp.payoff * w.payoff
        + comp.unlocking * w.unlocking,
    );
}

function deriveBadnessTag(actual, before, regret, thresholds) {
    if (regret <= 0.05) return 'optimal';
    /* v1.69.2 修复（P1）：badnessTag 是给**玩家**看的，应该用与 spawnGeo.holes
     * 同口径的"玩家视觉敏感空腔"（enclosedVoidCells）作为主信号；coverable holes
     * 在算法严谨性上更对、但玩家心智里"那个我刚围出来的小空腔"主要由 enclosed
     * 捕获（详见 game.js _spawnGeoForSnapshot 的三档口径分层注释）。
     *
     * 取二者最大值：任一口径超阈值即触发 created_hole 提示。 */
    const holesDelta = actual.holesDelta ?? 0;
    const enclosedDelta = actual.enclosedDelta ?? 0;
    if (Math.max(holesDelta, enclosedDelta) >= thresholds.createdHoleDelta) return 'created_hole';
    const heightDelta = invFlatness(actual.afterAnalysis.flatness) - invFlatness(before.flatness);
    if (heightDelta >= thresholds.topStackingHeightDelta) return 'top_stacking';
    if (before.nearFullLines >= thresholds.wastedPayoffNearFullLines
        && (actual.lines ?? 0) === 0) return 'wasted_payoff';
    return 'fine';
}

function enumerateCandidates(cells, shape) {
    const N = cells.length;
    const out = [];
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            if (canPlace(cells, shape, x, y)) out.push({ x, y });
        }
    }
    return out;
}

function emptyResult() {
    return {
        absScore: 0,
        regret: 0,
        optimality: 1,
        components: { contact: 0, tidiness: 0, holeSafety: 1, payoff: 0, unlocking: 0 },
        optimalPos: null,
        badnessTag: 'fine',
        evaluated: false,
        candidateCount: 0,
    };
}

/* ─────────────────────────── 主入口 ─────────────────────────── */

/**
 * @param {object} args
 * @param {Array<Array<*>>} args.boardBefore   放置前棋盘 cells（[y][x]，null=空）
 * @param {number[][]} args.shape              本次落子的形状（0/1 矩阵）
 * @param {{x:number,y:number}} args.pos       实际落点（左上角）
 * @param {number[][][]} [args.remainingShapes] dock 中尚未消费的其余形状
 * @param {object} [args.config]               覆盖 weights / throttle / badness
 */
function evaluatePlacement(args) {
    const { boardBefore, shape, pos, remainingShapes = [], config = {} } = args || {};
    const weights = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };
    const throttle = { ...DEFAULT_THROTTLE, ...(config.throttle || {}) };
    const badnessCfg = { ...DEFAULT_BADNESS, ...(config.badness || {}) };

    if (!Array.isArray(boardBefore) || !Array.isArray(shape) || !pos
        || !Number.isInteger(pos.x) || !Number.isInteger(pos.y)) {
        return emptyResult();
    }

    const before = analyzeCells(boardBefore);
    const candidates = enumerateCandidates(boardBefore, shape);
    const candidateCount = candidates.length;
    if (!canPlace(boardBefore, shape, pos.x, pos.y)) return emptyResult();

    if (before.fillRatio < throttle.skipWhenFillBelow
        && candidateCount >= throttle.skipWhenCandidatesAbove) {
        return {
            absScore: 0.8, regret: 0, optimality: 1,
            components: { contact: 0.5, tidiness: 0.8, holeSafety: 1, payoff: 0, unlocking: 0.8 },
            optimalPos: null, badnessTag: 'fine',
            evaluated: false, candidateCount,
        };
    }

    const actual = scoreCandidate(before, boardBefore, shape, pos.x, pos.y, remainingShapes);
    const actualAbs = weightedSum(actual, weights);

    let bestAbs = actualAbs;
    let bestPos = { x: pos.x, y: pos.y };
    for (const c of candidates) {
        if (c.x === pos.x && c.y === pos.y) continue;
        const comp = scoreCandidate(before, boardBefore, shape, c.x, c.y, remainingShapes);
        const abs = weightedSum(comp, weights);
        if (abs > bestAbs) { bestAbs = abs; bestPos = c; }
    }

    const regret = clamp01(bestAbs - actualAbs);
    const optimality = bestAbs > 0 ? clamp01(actualAbs / bestAbs) : 1;
    return {
        absScore: actualAbs,
        regret,
        optimality,
        components: {
            contact: actual.contact, tidiness: actual.tidiness,
            holeSafety: actual.holeSafety, payoff: actual.payoff,
            unlocking: actual.unlocking,
        },
        optimalPos: bestPos,
        badnessTag: deriveBadnessTag(actual, before, regret, badnessCfg),
        /* v1.69.2：暴露实际消行数 + 增量信号，供 roundQuality 直接读取，避免下游
         * 从 payoff 阶梯反推（PAYOFF_LADDER 0/0.4/0.7/1.0 在权重重映时会失真）。 */
        lines: actual.lines ?? 0,
        holesDelta: actual.holesDelta ?? 0,
        enclosedDelta: actual.enclosedDelta ?? 0,
        evaluated: true,
        candidateCount,
    };
}

const PLACEMENT_DEFAULT_WEIGHTS = DEFAULT_WEIGHTS;
const PLACEMENT_DEFAULT_THROTTLE = DEFAULT_THROTTLE;
const PLACEMENT_DEFAULT_BADNESS = DEFAULT_BADNESS;

module.exports = { evaluatePlacement, PLACEMENT_DEFAULT_BADNESS, PLACEMENT_DEFAULT_THROTTLE, PLACEMENT_DEFAULT_WEIGHTS };
