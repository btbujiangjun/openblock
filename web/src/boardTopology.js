import { getAllShapes } from './shapes.js';

/**
 * 统计“不可覆盖空格”：当前棋盘上没有任何已定义形状能通过合法放置覆盖到的空格。
 *
 * 这不是传统堆叠游戏里的“上方有块、下方为空”口径；OpenBlock 的块可从任意位置落下，
 * 因此只有结合完整形状库仍无法触达的空格，才会真实降低后续可解性。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {Array<{ data:number[][] }>} [shapes]
 */
export function countUnfillableCells(grid, shapes = getAllShapes()) {
    if (!grid?.cells?.length) return 0;
    const coverable = computeCoverableCells(grid, shapes);
    let holes = 0;
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            if (grid.cells[y][x] === null && !coverable[y][x]) holes++;
        }
    }
    return holes;
}

/**
 * 计算每个空格是否能被任一合法形状覆盖。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {Array<{ data:number[][] }>} [shapes]
 * @returns {boolean[][]}
 */
export function computeCoverableCells(grid, shapes = getAllShapes()) {
    if (!grid?.cells?.length) return [];
    const n = grid.size;
    const coverable = Array.from({ length: n }, () => new Array(n).fill(false));

    for (const shape of shapes) {
        const data = shape?.data;
        if (!Array.isArray(data) || data.length === 0) continue;
        for (let gy = 0; gy < n; gy++) {
            for (let gx = 0; gx < n; gx++) {
                if (!grid.canPlace(data, gx, gy)) continue;
                for (let sy = 0; sy < data.length; sy++) {
                    for (let sx = 0; sx < data[sy].length; sx++) {
                        if (!data[sy][sx]) continue;
                        const x = gx + sx;
                        const y = gy + sy;
                        if (x >= 0 && x < n && y >= 0 && y < n) {
                            coverable[y][x] = true;
                        }
                    }
                }
            }
        }
    }
    return coverable;
}

/** @param {import('./grid.js').Grid} grid */
export function analyzeBoardTopology(grid) {
    const n = grid.size;
    const colHeights = new Array(n).fill(0);
    let occupiedCount = 0;

    for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) {
                colHeights[x] = n - y;
                break;
            }
        }
    }
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) occupiedCount++;
        }
    }

    const coverable = computeCoverableCells(grid);
    let holes = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] === null && !coverable[y][x]) holes++;
        }
    }

    let heightVariance = 0;
    const avgHeight = colHeights.reduce((s, h) => s + h, 0) / Math.max(1, n);
    for (let x = 0; x < n; x++) {
        heightVariance += (colHeights[x] - avgHeight) ** 2;
    }
    heightVariance /= Math.max(1, n);
    const flatness = 1 / (1 + heightVariance);

    const maxColHeight = Math.max(...colHeights);

    let nearFullLines = 0;
    let close1 = 0;
    let close2 = 0;
    for (let y = 0; y < n; y++) {
        let filled = 0;
        const emptyCells = [];
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) filled++;
            else emptyCells.push([y, x]);
        }
        const emptyCount = n - filled;
        const fillable = emptyCells.length > 0
            && emptyCells.every(([ey, ex]) => coverable[ey]?.[ex] === true);
        if (fillable && emptyCount <= 2) {
            nearFullLines++;
            if (emptyCount === 1) close1++;
            else if (emptyCount === 2) close2++;
        }
    }
    for (let x = 0; x < n; x++) {
        let filled = 0;
        const emptyCells = [];
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) filled++;
            else emptyCells.push([y, x]);
        }
        const emptyCount = n - filled;
        const fillable = emptyCells.length > 0
            && emptyCells.every(([ey, ex]) => coverable[ey]?.[ex] === true);
        if (fillable && emptyCount <= 2) {
            nearFullLines++;
            if (emptyCount === 1) close1++;
            else if (emptyCount === 2) close2++;
        }
    }

    let rowTransitions = 0;
    let colTransitions = 0;
    for (let y = 0; y < n; y++) {
        let prev = true;
        for (let x = 0; x < n; x++) {
            const cur = grid.cells[y][x] !== null;
            if (cur !== prev) rowTransitions++;
            prev = cur;
        }
        if (!prev) rowTransitions++;
    }
    for (let x = 0; x < n; x++) {
        let prev = true;
        for (let y = 0; y < n; y++) {
            const cur = grid.cells[y][x] !== null;
            if (cur !== prev) colTransitions++;
            prev = cur;
        }
        if (!prev) colTransitions++;
    }

    let wells = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) continue;
            const left = x === 0 || grid.cells[y][x - 1] !== null;
            const right = x === n - 1 || grid.cells[y][x + 1] !== null;
            if (left && right) wells++;
        }
    }

    return {
        holes,
        flatness,
        maxColHeight,
        colHeights,
        nearFullLines,
        close1,
        close2,
        rowTransitions,
        colTransitions,
        wells,
        occupiedCount,
        fillRatio: occupiedCount / Math.max(n * n, 1),
    };
}
