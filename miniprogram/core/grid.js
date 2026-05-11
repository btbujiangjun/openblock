/**
 * Open Block - Grid Logic
 * Manages the game board and line detection
 */
const { pickShapeByCategoryWeights } = require('./shapes');

class Grid {
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

    /**
     * 鼠标悬停落点策略：仍只在锚点附近局部半径内纠偏，但在“足够近”的候选里：
     * - 优先吸向能消行的位置，降低玩家为补最后一格反复微调的负担；
     * - 对上一帧预览位置加轻微粘滞，避免停在两个格子边界时来回跳。
     *
     * @param {number[][]} shape
     * @param {number} aimCx
     * @param {number} aimCy
     * @param {number} anchorX
     * @param {number} anchorY
     * @param {number} radius
     * @param {{
     *   colorIdx?: number,
     *   previous?: {x:number,y:number} | null,
     *   clearLineBonus?: number,
     *   clearCellBonus?: number,
     *   clearAssistWindow?: number,
     *   stickyBonus?: number,
     *   stickyWindow?: number
     * }} [opts]
     */
    pickSmartHoverPlacement(shape, aimCx, aimCy, anchorX, anchorY, radius, opts = {}) {
        const candidates = [];
        let nearestDist = Infinity;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const gx = anchorX + dx;
                const gy = anchorY + dy;
                if (!this.canPlace(shape, gx, gy)) {
                    continue;
                }

                const com = Grid.shapeCenterOnBoard(shape, gx, gy);
                const distSq = (com.x - aimCx) ** 2 + (com.y - aimCy) ** 2;
                const outcome = this.previewClearOutcome(shape, gx, gy, opts.colorIdx ?? 0);
                const clearLines = (outcome?.rows?.length || 0) + (outcome?.cols?.length || 0);
                const clearCells = outcome?.cells?.length || 0;
                candidates.push({ x: gx, y: gy, distSq, clearLines, clearCells });
                if (distSq < nearestDist) {
                    nearestDist = distSq;
                }
            }
        }

        if (!candidates.length) {
            return null;
        }

        const clearLineBonus = Number.isFinite(opts.clearLineBonus) ? opts.clearLineBonus : 0.9;
        const clearCellBonus = Number.isFinite(opts.clearCellBonus) ? opts.clearCellBonus : 0.015;
        const clearAssistWindow = Number.isFinite(opts.clearAssistWindow) ? opts.clearAssistWindow : 1.35;
        const stickyBonus = Number.isFinite(opts.stickyBonus) ? opts.stickyBonus : 0.32;
        const stickyWindow = Number.isFinite(opts.stickyWindow) ? opts.stickyWindow : 0.75;
        const previous = opts.previous || null;

        let best = null;
        let bestScore = Infinity;
        for (const c of candidates) {
            let score = c.distSq;
            if (c.clearLines > 0 && c.distSq <= nearestDist + clearAssistWindow) {
                score -= c.clearLines * clearLineBonus + c.clearCells * clearCellBonus;
            }
            if (previous && previous.x === c.x && previous.y === c.y && c.distSq <= nearestDist + stickyWindow) {
                score -= stickyBonus;
            }

            if (best === null || score < bestScore - 1e-8) {
                best = { x: c.x, y: c.y };
                bestScore = score;
            } else if (Math.abs(score - bestScore) <= 1e-8) {
                if (c.y < best.y || (c.y === best.y && c.x < best.x)) {
                    best = { x: c.x, y: c.y };
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

        // 在清除格子前检测同色（同icon）行列，用于后续加分和特效
        const bonusLines = [];
        for (const y of fullRows) {
            const first = this.cells[y][0];
            if (first !== null && this.cells[y].every(c => c === first)) {
                bonusLines.push({ type: 'row', idx: y, colorIdx: first });
            }
        }
        for (const x of fullCols) {
            const first = this.cells[0][x];
            if (first !== null) {
                let allSame = true;
                for (let y = 1; y < this.size; y++) {
                    if (this.cells[y][x] !== first) { allSame = false; break; }
                }
                if (allSame) bonusLines.push({ type: 'col', idx: x, colorIdx: first });
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
        return { count: lines, cells: clearedCells, bonusLines };
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
            /* v10.34：含「差 4 格满行」— 旧版仅 1~3 空，大块面临满行时 gapFills 常为 0，消行/清屏候选被低估 */
            if (empty >= 1 && empty <= 4) {
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
            if (empty >= 1 && empty <= 4) {
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
                    fills += Math.max(1, 4 - gap.empty);
                    break;
                }
            }
        }
        return fills;
    }

    /**
     * 初始化棋盘预填充。
     *
     * 改进策略（相比纯随机，显著降低空洞率）：
     *  1. 对每个候选形状枚举全部有效放置位置
     *  2. 按"空洞惩罚 + 底部偏好 + 随机扰动"综合评分
     *  3. 取评分最高的位置放置，形成自然底部堆叠
     *
     * 评分公式（越高越优先）：
     *   score = bottomBonus - holePenalty + jitter
     *   bottomBonus = (y + sh) / size × 3      （放置越靠底得分越高）
     *   holePenalty = newHoles × 2.5            （每新增一个空洞扣分）
     *   jitter      = Math.random() × 0.6       （少量随机性避免完全确定性）
     *
     * @param {number} fillRatio  目标填充率（0~1）
     * @param {object} weights    形状类别权重
     */
    initBoard(fillRatio, weights) {
        this.clear();
        const targetCells = Math.floor(this.size * this.size * fillRatio);
        let placedCells = 0;
        let noProgressStreak = 0;

        while (placedCells < targetCells && noProgressStreak < 25) {
            const shape = pickShapeByCategoryWeights(weights);
            if (!shape) break;

            const sh = shape.data.length;
            const sw = shape.data[0].length;
            const shapeSize = shape.data.flat().filter(Boolean).length;

            // 枚举全部有效位置，评分后择优放置
            let best = null;
            for (let y = 0; y <= this.size - sh; y++) {
                for (let x = 0; x <= this.size - sw; x++) {
                    if (!this.canPlace(shape.data, x, y)) continue;
                    if (this.wouldClear(shape.data, x, y)) continue;

                    const holes = this._countNewHoles(shape.data, x, y);
                    // 底部偏好：形状底边 (y + sh) 占格高比例
                    const bottomBonus = ((y + sh) / this.size) * 3;
                    const score = bottomBonus - holes * 2.5 + Math.random() * 0.6;

                    if (best === null || score > best.score) {
                        best = { x, y, score };
                    }
                }
            }

            if (best === null) {
                noProgressStreak++;
                continue;
            }

            noProgressStreak = 0;
            const colorIdx = Math.floor(Math.random() * 8);
            this.place(shape.data, colorIdx, best.x, best.y);
            placedCells += shapeSize;
        }
    }

    /**
     * 计算将 shapeData 放置在 (px, py) 后，在受影响列中新增的空洞数。
     * 空洞定义：某列中，有占用格正上方存在空格的情况。
     * 只统计放置后新产生的洞，不含放置前已有的洞。
     *
     * @param {number[][]} shapeData
     * @param {number} px  形状左上角列索引
     * @param {number} py  形状左上角行索引
     * @returns {number}
     */
    _countNewHoles(shapeData, px, py) {
        const sh = shapeData.length;
        const sw = shapeData[0].length;
        let newHoles = 0;

        for (let dx = 0; dx < sw; dx++) {
            const col = px + dx;
            if (col >= this.size) continue;

            // 放置前该列的空洞数
            let beforeHoles = 0;
            let hadOccupied = false;
            for (let y = 0; y < this.size; y++) {
                if (this.cells[y][col] !== null) {
                    hadOccupied = true;
                } else if (hadOccupied) {
                    beforeHoles++;
                }
            }

            // 放置后该列的空洞数（加入形状格）
            let afterHoles = 0;
            hadOccupied = false;
            for (let y = 0; y < this.size; y++) {
                const shapeFill =
                    y >= py && y < py + sh && dx < sw
                        ? Boolean(shapeData[y - py][dx])
                        : false;
                const isOccupied = this.cells[y][col] !== null || shapeFill;

                if (isOccupied) {
                    hadOccupied = true;
                } else if (hadOccupied) {
                    afterHoles++;
                }
            }

            newHoles += Math.max(0, afterHoles - beforeHoles);
        }

        return newHoles;
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

module.exports = { Grid };
