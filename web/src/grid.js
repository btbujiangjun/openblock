/**
 * Block Blast - Grid Logic
 * Manages the game board and line detection
 */
import { pickShapeByCategoryWeights } from './shapes.js';

export class Grid {
    constructor(size = 8) {
        this.size = size;
        this.cells = this.createEmptyGrid();
    }

    createEmptyGrid() {
        const grid = [];
        for (let i = 0; i < this.size; i++) {
            grid[i] = [];
            for (let j = 0; j < this.size; j++) {
                grid[i][j] = null;
            }
        }
        return grid;
    }

    clear() {
        this.cells = this.createEmptyGrid();
    }

    clone() {
        const grid = new Grid(this.size);
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                grid.cells[y][x] = this.cells[y][x];
            }
        }
        return grid;
    }

    canPlace(shape, gx, gy) {
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) {
                    const nx = gx + x;
                    const ny = gy + y;
                    if (nx < 0 || nx >= this.size || ny < 0 || ny >= this.size) {
                        return false;
                    }
                    if (this.cells[ny][nx] !== null) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    /**
     * 形状以 (gx,gy) 落子后，各格中心在棋盘上的平均坐标（格坐标系，可为小数）
     */
    static shapeCenterOnBoard(shape, gx, gy) {
        let sxa = 0;
        let sya = 0;
        let n = 0;
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) {
                    sxa += gx + x + 0.5;
                    sya += gy + y + 0.5;
                    n++;
                }
            }
        }
        if (!n) {
            return { x: gx + 0.5, y: gy + 0.5 };
        }
        return { x: sxa / n, y: sya / n };
    }

    /**
     * 仅在锚点 (anchorX, anchorY) 附近（切比雪夫半径 radius）的合法落点中，
     * 选形状重心离 (aimCx, aimCy) 最近的一处——只纠偏，不按消除数选全盘最优。
     */
    pickNearestLocalPlacement(shape, aimCx, aimCy, anchorX, anchorY, radius) {
        let best = null;
        let bestDist = Infinity;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const gx = anchorX + dx;
                const gy = anchorY + dy;
                if (!this.canPlace(shape, gx, gy)) {
                    continue;
                }

                const com = Grid.shapeCenterOnBoard(shape, gx, gy);
                const distSq = (com.x - aimCx) ** 2 + (com.y - aimCy) ** 2;

                if (best === null) {
                    best = { x: gx, y: gy };
                    bestDist = distSq;
                    continue;
                }

                if (distSq < bestDist - 1e-8) {
                    best = { x: gx, y: gy };
                    bestDist = distSq;
                } else if (Math.abs(distSq - bestDist) <= 1e-8) {
                    if (gy < best.y || (gy === best.y && gx < best.x)) {
                        best = { x: gx, y: gy };
                    }
                }
            }
        }
        return best;
    }

    place(shape, colorIdx, gx, gy) {
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) {
                    this.cells[gy + y][gx + x] = colorIdx;
                }
            }
        }
    }

    checkLines() {
        const fullRows = [];
        const fullCols = [];
        const clearedCells = [];
        const clearedSet = {};

        for (let y = 0; y < this.size; y++) {
            if (this.cells[y].every(c => c !== null)) {
                fullRows.push(y);
            }
        }

        for (let x = 0; x < this.size; x++) {
            let colFull = true;
            for (let y = 0; y < this.size; y++) {
                if (this.cells[y][x] === null) {
                    colFull = false;
                    break;
                }
            }
            if (colFull) {
                fullCols.push(x);
            }
        }

        for (const y of fullRows) {
            for (let x = 0; x < this.size; x++) {
                const key = x + ',' + y;
                if (!clearedSet[key]) {
                    clearedSet[key] = true;
                    clearedCells.push({ x, y, color: this.cells[y][x] });
                }
            }
        }

        for (const x of fullCols) {
            for (let y = 0; y < this.size; y++) {
                const key = x + ',' + y;
                if (!clearedSet[key]) {
                    clearedSet[key] = true;
                    clearedCells.push({ x, y, color: this.cells[y][x] });
                }
            }
        }

        for (const y of fullRows) {
            for (let x = 0; x < this.size; x++) {
                this.cells[y][x] = null;
            }
        }

        for (const x of fullCols) {
            for (let y = 0; y < this.size; y++) {
                this.cells[y][x] = null;
            }
        }

        const lines = fullRows.length + fullCols.length;
        return { count: lines, cells: clearedCells };
    }

    hasAnyMove(blocks) {
        for (const block of blocks) {
            if (!block || block.placed) continue;
            for (let y = 0; y < this.size; y++) {
                for (let x = 0; x < this.size; x++) {
                    if (this.canPlace(block.shape, x, y)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    canPlaceAnywhere(shapeData) {
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.canPlace(shapeData, x, y)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** 返回该形状在当前盘面上的合法放置位数量 */
    countValidPlacements(shapeData) {
        let count = 0;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.canPlace(shapeData, x, y)) count++;
            }
        }
        return count;
    }

    wouldClear(shapeData, gx, gy) {
        const temp = this.cells.map(row => [...row]);
        for (let y = 0; y < shapeData.length; y++) {
            for (let x = 0; x < shapeData[y].length; x++) {
                if (shapeData[y][x]) {
                    temp[gy + y][gx + x] = 1;
                }
            }
        }

        for (let y = 0; y < this.size; y++) {
            if (temp[y].every(c => c !== null)) {
                return true;
            }
        }

        for (let x = 0; x < this.size; x++) {
            let colFull = true;
            for (let y = 0; y < this.size; y++) {
                if (temp[y][x] === null) {
                    colFull = false;
                    break;
                }
            }
            if (colFull) return true;
        }

        return false;
    }

    /**
     * 推演：若在此位置放置方块，放置后哪些整行/整列会被填满（与 checkLines 判定一致，不落子）。
     * @param {number[][]} shapeData
     * @param {number} gx
     * @param {number} gy
     * @param {number} colorIdx 与真实落子一致，用于着色推演
     * @returns {{ rows: number[], cols: number[], cells: { x: number, y: number, color: number }[] } | null} 不可放置时为 null
     */
    previewClearOutcome(shapeData, gx, gy, colorIdx) {
        if (!this.canPlace(shapeData, gx, gy)) {
            return null;
        }
        const temp = this.cells.map((row) => [...row]);
        for (let y = 0; y < shapeData.length; y++) {
            for (let x = 0; x < shapeData[y].length; x++) {
                if (shapeData[y][x]) {
                    temp[gy + y][gx + x] = colorIdx;
                }
            }
        }

        const fullRows = [];
        const fullCols = [];
        for (let y = 0; y < this.size; y++) {
            if (temp[y].every((c) => c !== null)) {
                fullRows.push(y);
            }
        }
        for (let x = 0; x < this.size; x++) {
            let colFull = true;
            for (let y = 0; y < this.size; y++) {
                if (temp[y][x] === null) {
                    colFull = false;
                    break;
                }
            }
            if (colFull) {
                fullCols.push(x);
            }
        }

        const clearedSet = {};
        const cells = [];
        for (const y of fullRows) {
            for (let x = 0; x < this.size; x++) {
                const key = `${x},${y}`;
                if (!clearedSet[key]) {
                    clearedSet[key] = true;
                    cells.push({ x, y, color: temp[y][x] });
                }
            }
        }
        for (const x of fullCols) {
            for (let y = 0; y < this.size; y++) {
                const key = `${x},${y}`;
                if (!clearedSet[key]) {
                    clearedSet[key] = true;
                    cells.push({ x, y, color: temp[y][x] });
                }
            }
        }

        return { rows: fullRows, cols: fullCols, cells };
    }

    findGapPositions() {
        const gaps = [];

        for (let y = 0; y < this.size; y++) {
            let empty = 0;
            const positions = [];
            for (let x = 0; x < this.size; x++) {
                if (this.cells[y][x] === null) {
                    empty++;
                    positions.push({ x, y });
                }
            }
            if (empty >= 1 && empty <= 3) {
                gaps.push({ type: 'row', y, empty, positions });
            }
        }

        for (let x = 0; x < this.size; x++) {
            let empty = 0;
            const positions = [];
            for (let y = 0; y < this.size; y++) {
                if (this.cells[y][x] === null) {
                    empty++;
                    positions.push({ x, y });
                }
            }
            if (empty >= 1 && empty <= 3) {
                gaps.push({ type: 'col', x, empty, positions });
            }
        }

        gaps.sort((a, b) => a.empty - b.empty);
        return gaps;
    }

    countGapFills(shapeData) {
        let fills = 0;
        const gaps = this.findGapPositions();
        for (const gap of gaps) {
            for (const pos of gap.positions) {
                if (this.canPlace(shapeData, pos.x, pos.y)) {
                    fills += (4 - gap.empty);
                    break;
                }
            }
        }
        return fills;
    }

    initBoard(fillRatio, weights) {
        this.clear();
        let placedCells = 0;
        const targetCells = Math.floor(this.size * this.size * fillRatio);

        for (let attempts = 0; attempts < 100 && placedCells < targetCells; attempts++) {
            const shape = pickShapeByCategoryWeights(weights);
            if (!shape) {
                break;
            }
            const x = Math.floor(Math.random() * (this.size - shape.data[0].length + 1));
            const y = Math.floor(Math.random() * (this.size - shape.data.length + 1));

            if (this.canPlace(shape.data, x, y) && !this.wouldClear(shape.data, x, y)) {
                const colorIdx = Math.floor(Math.random() * 8);
                this.place(shape.data, colorIdx, x, y);
                placedCells += shape.data.flat().filter(c => c).length;
            }
        }
    }

    getFillRatio() {
        let filled = 0;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.cells[y][x] !== null) filled++;
            }
        }
        return filled / (this.size * this.size);
    }

    toJSON() {
        return {
            size: this.size,
            cells: this.cells.map(row => [...row])
        };
    }

    fromJSON(data) {
        this.size = data.size || 8;
        this.cells = data.cells.map(row => [...row]);
    }
}
