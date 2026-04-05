/**
 * 观测编码（state + action φ）：常数与归一化来自 shared/game_rules.json → FEATURE_ENCODING。
 * 改玩法规则一般只改 JSON；改特征结构时需改此处并与 Python observation 对齐，并重训模型。
 */
import { FEATURE_ENCODING } from '../gameRules.js';

const enc = FEATURE_ENCODING;
const AF = enc.almostFullLineRatio ?? 0.78;
const DOCK_SLOTS = enc.dockSlots ?? 3;
const AN = enc.actionNorm || {};
const MAX_GRID = enc.maxGridWidth ?? 8;
const DOCK_MASK_SIDE = enc.dockMaskSide ?? 5;
const STATE_SCALAR_DIM = enc.stateScalarDim ?? 15;

export const STATE_FEATURE_DIM = enc.stateDim;
export const ACTION_FEATURE_DIM = enc.actionDim;
export const PHI_DIM = enc.phiDim ?? enc.stateDim + enc.actionDim;

const _gridFlat = MAX_GRID * MAX_GRID;
const _dockFlat = DOCK_SLOTS * DOCK_MASK_SIDE * DOCK_MASK_SIDE;
const _expectState = STATE_SCALAR_DIM + _gridFlat + _dockFlat;
if (STATE_FEATURE_DIM !== _expectState) {
    throw new Error(
        `featureEncoding.stateDim=${STATE_FEATURE_DIM} 与标量+棋盘+待选区期望 ${_expectState} 不一致`
    );
}

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
 * @param {import('../grid.js').Grid} grid
 * @param {{ shape: number[][], colorIdx: number, placed: boolean }[]} dock
 */
export function extractStateFeatures(grid, dock) {
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

    const scalars = new Float32Array([
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
        (almostFullRows + almostFullCols) / (2 * n)
    ]);
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

/**
 * @param {Float32Array} stateFeat
 * @param {number} blockIdx
 * @param {number} gx
 * @param {number} gy
 * @param {number[][]} shape
 * @param {number} wouldClear
 * @param {number} gridSize
 */
export function extractActionFeatures(stateFeat, blockIdx, gx, gy, shape, wouldClear, gridSize) {
    let cells = 0;
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x]) {
                cells++;
            }
        }
    }
    const h = shape.length;
    const w = shape[0].length;
    const divB = AN.maxBlockIndex ?? 3;
    const divSh = AN.shapeSpan ?? 5;
    const divCells = AN.maxCells ?? 10;
    const divClr = AN.maxClearsHint ?? 5;
    const actionPart = new Float32Array([
        blockIdx / divB,
        gx / gridSize,
        gy / gridSize,
        w / divSh,
        h / divSh,
        cells / divCells,
        wouldClear / divClr
    ]);
    const out = new Float32Array(stateFeat.length + actionPart.length);
    out.set(stateFeat, 0);
    out.set(actionPart, stateFeat.length);
    return out;
}

/**
 * @param {import('./simulator.js').BlockBlastSimulator} sim
 * @returns {{ legal: { blockIdx: number, gx: number, gy: number }[], stateFeat: Float32Array, phiList: Float32Array[] }}
 */
export function buildDecisionBatch(sim) {
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
                sim.grid.size
            )
        );
    }
    return { legal, stateFeat, phiList };
}
