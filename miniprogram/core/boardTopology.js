const { getAllShapes } = require('./shapes');

function canPlaceShapeAt(grid, shape, gx, gy) {
    for (let y = 0; y < shape.length; y++) {
        const row = shape[y];
        for (let x = 0; x < row.length; x++) {
            if (!row[x]) continue;
            const px = gx + x;
            const py = gy + y;
            if (px < 0 || px >= grid.size || py < 0 || py >= grid.size) return false;
            if (grid.cells[py][px] !== null) return false;
        }
    }
    return true;
}

function countUnfillableCells(grid, shapes = getAllShapes()) {
    if (!grid?.cells || !Array.isArray(grid.cells)) return 0;
    const coverable = computeCoverableCells(grid, shapes);
    const n = grid.size || grid.cells.length;
    let holes = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] === null && !coverable[y][x]) holes++;
        }
    }
    return holes;
}

function computeCoverableCells(grid, shapes = getAllShapes()) {
    if (!grid?.cells || !Array.isArray(grid.cells)) return [];
    const n = grid.size || grid.cells.length;
    const coverable = Array.from({ length: n }, () => Array(n).fill(false));

    for (const shapeInfo of shapes) {
        const shape = shapeInfo?.data || shapeInfo;
        if (!shape?.length || !shape[0]?.length) continue;
        const h = shape.length;
        const w = shape[0].length;
        for (let gy = 0; gy <= n - h; gy++) {
            for (let gx = 0; gx <= n - w; gx++) {
                if (!canPlaceShapeAt(grid, shape, gx, gy)) continue;
                for (let sy = 0; sy < h; sy++) {
                    for (let sx = 0; sx < w; sx++) {
                        if (shape[sy][sx]) coverable[gy + sy][gx + sx] = true;
                    }
                }
            }
        }
    }
    return coverable;
}

function analyzeBoardTopology(grid) {
    const n = grid.size || grid.cells.length;
    const coverable = computeCoverableCells(grid);
    let holes = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] === null && !coverable[y][x]) holes++;
        }
    }
    const colHeights = Array(n).fill(0);
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

    const avgHeight = colHeights.reduce((s, h) => s + h, 0) / Math.max(1, n);
    const heightVariance = colHeights.reduce((s, h) => s + (h - avgHeight) ** 2, 0) / Math.max(1, n);
    const flatness = 1 / (1 + heightVariance);

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
        const fillable = emptyCells.length > 0 && emptyCells.every(([ey, ex]) => coverable[ey]?.[ex] === true);
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
        const fillable = emptyCells.length > 0 && emptyCells.every(([ey, ex]) => coverable[ey]?.[ex] === true);
        if (fillable && emptyCount <= 2) {
            nearFullLines++;
            if (emptyCount === 1) close1++;
            else if (emptyCount === 2) close2++;
        }
    }

    return {
        holes,
        flatness,
        maxColHeight: Math.max(...colHeights),
        colHeights,
        nearFullLines,
        close1,
        close2,
        occupiedCount,
        fillRatio: occupiedCount / Math.max(n * n, 1),
    };
}

module.exports = { analyzeBoardTopology, computeCoverableCells, countUnfillableCells };
