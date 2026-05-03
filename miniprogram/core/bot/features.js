/**
 * 观测编码（state + action φ）：常数与归一化来自 shared/game_rules.json → FEATURE_ENCODING。
 * state=181 (42 scalars + 64 grid + 75 dock), action=12, phi=193。
 */
const { FEATURE_ENCODING } = require('../gameRules');

const enc = FEATURE_ENCODING;
const AF = enc.almostFullLineRatio ?? 0.78;
const DOCK_SLOTS = enc.dockSlots ?? 3;
const AN = enc.actionNorm || {};
const MAX_GRID = enc.maxGridWidth ?? 8;
const DOCK_MASK_SIDE = enc.dockMaskSide ?? 5;
const STATE_SCALAR_DIM = enc.stateScalarDim ?? 23;
const COLOR_COUNT = enc.colorCount ?? 8;

const STATE_FEATURE_DIM = enc.stateDim;
const ACTION_FEATURE_DIM = enc.actionDim;
const PHI_DIM = enc.phiDim ?? enc.stateDim + enc.actionDim;

const _gridFlat = MAX_GRID * MAX_GRID;
const _dockFlat = DOCK_SLOTS * DOCK_MASK_SIDE * DOCK_MASK_SIDE;
const _expectState = STATE_SCALAR_DIM + _gridFlat + _dockFlat;
if (STATE_FEATURE_DIM !== _expectState) {
    throw new Error(
        `featureEncoding.stateDim=${STATE_FEATURE_DIM} 与标量+棋盘+待选区期望 ${_expectState} 不一致`
    );
}

const _MAX_HOLES = AN.maxHoles ?? 16;
const _MAX_TRANS = AN.maxTransitions ?? 64;
const _MAX_WELLS = AN.maxWellDepth ?? 24;
const _MAX_MOB = AN.maxMobility ?? 192;

/**
 * @param {import('../grid.js').Grid} grid
 */
function encodeGridOccupancy(grid) {
    const n = grid.size;
    const out = new Float32Array(_gridFlat);
    for (let y = 0; y < Math.min(n, MAX_GRID); y++) {
        for (let x = 0; x < Math.min(n, MAX_GRID); x++) {
            out[y * MAX_GRID + x] = grid.cells[y][x] !== null ? 1 : 0;
        }
    }
    return out;
}

/**
 * @param {number[][]} shape
 */
function encodeShapeMask(shape) {
    const h = shape.length;
    const w = h ? shape[0].length : 0;
    const side = DOCK_MASK_SIDE;
    const canvas = new Float32Array(side * side);
    if (!h || !w) {
        return canvas;
    }
    const offY = Math.max(0, Math.floor((side - h) / 2));
    const offX = Math.max(0, Math.floor((side - w) / 2));
    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            if (shape[py][px]) {
                const cy = offY + py;
                const cx = offX + px;
                if (cy >= 0 && cy < side && cx >= 0 && cx < side) {
                    canvas[cy * side + cx] = 1;
                }
            }
        }
    }
    return canvas;
}

/**
 * @param {{ shape: number[][], colorIdx: number, placed: boolean }[]} dock
 */
function encodeDockSpatial(dock) {
    const parts = [];
    for (let i = 0; i < DOCK_SLOTS; i++) {
        const b = dock[i];
        if (b && !b.placed) {
            parts.push(encodeShapeMask(b.shape));
        } else {
            parts.push(new Float32Array(DOCK_MASK_SIDE * DOCK_MASK_SIDE));
        }
    }
    const total = DOCK_SLOTS * DOCK_MASK_SIDE * DOCK_MASK_SIDE;
    const out = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

/**
 * 颜色摘要：棋盘颜色占比、同色线潜力、dock 颜色。
 * @param {import('../grid.js').Grid} grid
 * @param {{ shape: number[][], colorIdx: number, placed: boolean }[]} dock
 */
function encodeColorSummary(grid, dock) {
    const n = grid.size;
    const area = Math.max(n * n, 1);
    const counts = new Float32Array(COLOR_COUNT);
    const monoPotential = new Float32Array(COLOR_COUNT);

    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const c = grid.cells[y][x];
            if (c !== null && c >= 0 && c < COLOR_COUNT) {
                counts[c] += 1;
            }
        }
    }

    for (let c = 0; c < COLOR_COUNT; c++) {
        let best = 0;
        for (let y = 0; y < n; y++) {
            let ok = true;
            let same = 0;
            for (let x = 0; x < n; x++) {
                const v = grid.cells[y][x];
                if (v !== null && v !== c) { ok = false; break; }
                if (v === c) same++;
            }
            if (ok) best = Math.max(best, same);
        }
        for (let x = 0; x < n; x++) {
            let ok = true;
            let same = 0;
            for (let y = 0; y < n; y++) {
                const v = grid.cells[y][x];
                if (v !== null && v !== c) { ok = false; break; }
                if (v === c) same++;
            }
            if (ok) best = Math.max(best, same);
        }
        monoPotential[c] = best / Math.max(n, 1);
    }

    const dockColors = new Float32Array(DOCK_SLOTS);
    const denom = Math.max(COLOR_COUNT - 1, 1);
    for (let i = 0; i < DOCK_SLOTS; i++) {
        const b = dock[i];
        if (b && !b.placed) {
            dockColors[i] = (b.colorIdx ?? 0) / denom;
        }
    }

    const out = new Float32Array(COLOR_COUNT * 2 + DOCK_SLOTS);
    for (let i = 0; i < COLOR_COUNT; i++) out[i] = counts[i] / area;
    out.set(monoPotential, COLOR_COUNT);
    out.set(dockColors, COLOR_COUNT * 2);
    return out;
}

// ---------------------------------------------------------------------------
// Board structure analysis helpers (mirrors Python features.py)
// ---------------------------------------------------------------------------

/** @param {import('../grid.js').Grid} grid */
function countHoles(grid) {
    const n = grid.size;
    let holes = 0;
    for (let x = 0; x < n; x++) {
        let blockFound = false;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) {
                blockFound = true;
            } else if (blockFound) {
                holes++;
            }
        }
    }
    return holes;
}

/** @param {import('../grid.js').Grid} grid */
function countTransitions(grid) {
    const n = grid.size;
    let rowTrans = 0;
    let colTrans = 0;
    for (let y = 0; y < n; y++) {
        let prev = true;
        for (let x = 0; x < n; x++) {
            const cur = grid.cells[y][x] !== null;
            if (cur !== prev) rowTrans++;
            prev = cur;
        }
        if (!prev) rowTrans++;
    }
    for (let x = 0; x < n; x++) {
        let prev = true;
        for (let y = 0; y < n; y++) {
            const cur = grid.cells[y][x] !== null;
            if (cur !== prev) colTrans++;
            prev = cur;
        }
        if (!prev) colTrans++;
    }
    return { rowTrans, colTrans };
}

/** @param {import('../grid.js').Grid} grid */
function wellDepthSum(grid) {
    const n = grid.size;
    let total = 0;
    for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) continue;
            const leftBlocked = x === 0 || grid.cells[y][x - 1] !== null;
            const rightBlocked = x === n - 1 || grid.cells[y][x + 1] !== null;
            if (leftBlocked && rightBlocked) total++;
        }
    }
    return total;
}

/** @param {import('../grid.js').Grid} grid */
function linesCloseToClear(grid) {
    const n = grid.size;
    let close1 = 0;
    let close2 = 0;
    for (let y = 0; y < n; y++) {
        let f = 0;
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) f++;
        }
        if (f === n - 1) close1++;
        else if (f === n - 2) close2++;
    }
    for (let x = 0; x < n; x++) {
        let f = 0;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) f++;
        }
        if (f === n - 1) close1++;
        else if (f === n - 2) close2++;
    }
    return { close1, close2 };
}

/** @param {import('../grid.js').Grid} grid @param {{ shape: number[][], placed: boolean }[]} dock */
function dockMobility(grid, dock) {
    const n = grid.size;
    let total = 0;
    for (const b of dock) {
        if (b.placed) continue;
        for (let gy = 0; gy < n; gy++) {
            for (let gx = 0; gx < n; gx++) {
                if (grid.canPlace(b.shape, gx, gy)) total++;
            }
        }
    }
    return total;
}

// ---------------------------------------------------------------------------
// State features (181-dim)
// ---------------------------------------------------------------------------

/**
 * @param {import('../grid.js').Grid} grid
 * @param {{ shape: number[][], colorIdx: number, placed: boolean }[]} dock
 */
function extractStateFeatures(grid, dock) {
    const n = grid.size;
    const area = n * n;
    let filled = 0;
    const rowFill = [];
    const colFill = [];

    for (let y = 0; y < n; y++) {
        let r = 0;
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) {
                r++;
                filled++;
            }
        }
        rowFill.push(r / n);
    }

    for (let x = 0; x < n; x++) {
        let c = 0;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) {
                c++;
            }
        }
        colFill.push(c / n);
    }

    const maxRow = Math.max(...rowFill, 0);
    const minRow = rowFill.length ? Math.min(...rowFill) : 0;
    const maxCol = Math.max(...colFill, 0);
    const minCol = colFill.length ? Math.min(...colFill) : 0;

    let almostFullRows = 0;
    let almostFullCols = 0;
    for (const rf of rowFill) {
        if (rf >= AF && rf < 1) {
            almostFullRows++;
        }
    }
    for (const cf of colFill) {
        if (cf >= AF && cf < 1) {
            almostFullCols++;
        }
    }

    const unplaced = dock.filter((b) => !b.placed).length / DOCK_SLOTS;

    const holes = countHoles(grid);
    const { rowTrans, colTrans } = countTransitions(grid);
    const wells = wellDepthSum(grid);
    const { close1, close2 } = linesCloseToClear(grid);
    const mobility = dockMobility(grid, dock);

    const colHeights = new Array(n);
    for (let x = 0; x < n; x++) {
        let h = 0;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) { h = n - y; break; }
        }
        colHeights[x] = h;
    }
    const heightStd = stdDev(colHeights.map(h => h / n));

    const baseScalars = [
        filled / area,
        maxRow,
        minRow,
        maxCol,
        minCol,
        almostFullRows / n,
        almostFullCols / n,
        unplaced,
        rowFill.reduce((a, b) => a + b, 0) / n,
        colFill.reduce((a, b) => a + b, 0) / n,
        stdDev(rowFill),
        stdDev(colFill),
        maxRow - minRow,
        maxCol - minCol,
        (almostFullRows + almostFullCols) / (2 * n),
        Math.min(holes / _MAX_HOLES, 1.0),
        Math.min(rowTrans / _MAX_TRANS, 1.0),
        Math.min(colTrans / _MAX_TRANS, 1.0),
        Math.min(wells / _MAX_WELLS, 1.0),
        Math.min(close1 / n, 1.0),
        Math.min(close2 / n, 1.0),
        Math.min(mobility / _MAX_MOB, 1.0),
        heightStd,
    ];
    const colorSummary = encodeColorSummary(grid, dock);
    const scalars = new Float32Array(baseScalars.length + colorSummary.length);
    scalars.set(baseScalars, 0);
    scalars.set(colorSummary, baseScalars.length);
    if (scalars.length !== STATE_SCALAR_DIM) {
        throw new Error(`标量段长度 ${scalars.length} != stateScalarDim ${STATE_SCALAR_DIM}`);
    }

    const gridFlat = encodeGridOccupancy(grid);
    const dockFlat = encodeDockSpatial(dock);
    const out = new Float32Array(STATE_FEATURE_DIM);
    out.set(scalars, 0);
    out.set(gridFlat, STATE_SCALAR_DIM);
    out.set(dockFlat, STATE_SCALAR_DIM + _gridFlat);
    return out;
}

function stdDev(arr) {
    if (!arr.length) {
        return 0;
    }
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
    return Math.sqrt(v);
}

const _NEAR_FULL_THRESH = AN.nearFullThreshold ?? 0.75;
const _MAX_ADJ = AN.maxAdjacent ?? 20;

/**
 * 12 维动作特征（v4）：原 7 + 5 棋盘交互特征。
 * @param {Float32Array} stateFeat
 * @param {number} blockIdx
 * @param {number} gx
 * @param {number} gy
 * @param {number[][]} shape
 * @param {number} wouldClear
 * @param {number} gridSize
 * @param {import('../grid.js').Grid} [grid] 传入时才计算后 5 维
 * @param {{ shape: number[][], placed: boolean }[]} [dock]
 */
function extractActionFeatures(
    stateFeat, blockIdx, gx, gy, shape, wouldClear, gridSize,
    grid, dock,
) {
    let cellCount = 0;
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x]) cellCount++;
        }
    }
    const h = shape.length;
    const w = shape[0].length;
    const divB = AN.maxBlockIndex ?? 3;
    const divSh = AN.shapeSpan ?? 5;
    const divCells = AN.maxCells ?? 10;
    const divClr = AN.maxClearsHint ?? 5;

    let nearFull = 0, blocksRemain = 0, adjRatio = 0, heightAfter = 0, holesRisk = 0;
    if (grid) {
        const n = grid.size;
        const thresh = _NEAR_FULL_THRESH * n;
        let nfCount = 0;
        const blockSet = new Set();
        for (let sy = 0; sy < h; sy++) {
            for (let sx = 0; sx < w; sx++) {
                if (!shape[sy][sx]) continue;
                blockSet.add(`${gy + sy},${gx + sx}`);
            }
        }
        for (let sy = 0; sy < h; sy++) {
            for (let sx = 0; sx < w; sx++) {
                if (!shape[sy][sx]) continue;
                const py = gy + sy, px = gx + sx;
                let rowF = 0, colF = 0;
                for (let x2 = 0; x2 < n; x2++) { if (grid.cells[py][x2] !== null) rowF++; }
                for (let y2 = 0; y2 < n; y2++) { if (grid.cells[y2][px] !== null) colF++; }
                if (rowF >= thresh || colF >= thresh) nfCount++;
            }
        }
        nearFull = nfCount / Math.max(cellCount, 1);

        if (dock) {
            const unplacedAfter = dock.filter(b => !b.placed).length - 1;
            blocksRemain = Math.max(0, unplacedAfter) / 3;
        }

        let adj = 0;
        for (const key of blockSet) {
            const [py, px] = key.split(',').map(Number);
            for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const ny = py + dy, nx = px + dx;
                if (ny >= 0 && ny < n && nx >= 0 && nx < n
                    && !blockSet.has(`${ny},${nx}`)
                    && grid.cells[ny][nx] !== null) {
                    adj++;
                }
            }
        }
        adjRatio = Math.min(adj / _MAX_ADJ, 1.0);
        heightAfter = Math.max(gy + h, 0) / gridSize;

        let holesCount = 0;
        for (let sy = 0; sy < h; sy++) {
            for (let sx = 0; sx < w; sx++) {
                if (!shape[sy][sx]) continue;
                const px = gx + sx, py = gy + sy;
                for (let below = py + 1; below < n; below++) {
                    if (grid.cells[below][px] === null) { holesCount++; break; }
                }
            }
        }
        holesRisk = Math.min(holesCount / Math.max(cellCount, 1), 1.0);
    }

    const actionPart = new Float32Array([
        blockIdx / divB,
        gx / gridSize,
        gy / gridSize,
        w / divSh,
        h / divSh,
        cellCount / divCells,
        wouldClear / divClr,
        nearFull,
        blocksRemain,
        adjRatio,
        heightAfter,
        holesRisk,
    ]);
    const out = new Float32Array(stateFeat.length + actionPart.length);
    out.set(stateFeat, 0);
    out.set(actionPart, stateFeat.length);
    return out;
}

/**
 * @param {import('./simulator.js').OpenBlockSimulator} sim
 * @returns {{ legal: { blockIdx: number, gx: number, gy: number }[], stateFeat: Float32Array, phiList: Float32Array[] }}
 */
function buildDecisionBatch(sim) {
    const legal = sim.getLegalActions();
    const stateFeat = extractStateFeatures(sim.grid, sim.dock);
    const phiList = [];
    for (const a of legal) {
        const wouldClear = sim.countClearsIfPlaced(a.blockIdx, a.gx, a.gy);
        phiList.push(
            extractActionFeatures(
                stateFeat,
                a.blockIdx,
                a.gx,
                a.gy,
                sim.dock[a.blockIdx].shape,
                wouldClear,
                sim.grid.size,
                sim.grid,
                sim.dock,
            )
        );
    }
    return { legal, stateFeat, phiList };
}

module.exports = { ACTION_FEATURE_DIM, buildDecisionBatch, countHoles, extractActionFeatures, extractStateFeatures, PHI_DIM, STATE_FEATURE_DIM };
