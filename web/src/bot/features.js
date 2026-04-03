/**
 * 棋盘与可选动作的状态特征（供线性策略 / 价值函数使用）
 */

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
            if (grid.cells[y][x] !== null) c++;
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
        if (rf >= 0.78 && rf < 1) {
            almostFullRows++;
        }
    }
    for (const cf of colFill) {
        if (cf >= 0.78 && cf < 1) {
            almostFullCols++;
        }
    }

    const unplaced = dock.filter((b) => !b.placed).length / 3;

    return new Float32Array([
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
}

function stdDev(arr) {
    if (!arr.length) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
    return Math.sqrt(v);
}

/**
 * 拼接 (s, a) 特征，维度须与 LinearAgent 一致
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
    const actionPart = new Float32Array([
        blockIdx / 3,
        gx / gridSize,
        gy / gridSize,
        w / 5,
        h / 5,
        cells / 10,
        wouldClear / 5
    ]);
    const out = new Float32Array(stateFeat.length + actionPart.length);
    out.set(stateFeat, 0);
    out.set(actionPart, stateFeat.length);
    return out;
}

export const STATE_FEATURE_DIM = 14;
export const ACTION_FEATURE_DIM = 7;
export const PHI_DIM = STATE_FEATURE_DIM + ACTION_FEATURE_DIM;
