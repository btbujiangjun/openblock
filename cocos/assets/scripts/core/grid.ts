/**
 * 棋盘逻辑 —— 由 miniprogram/core/grid.js 移植（保留核心子集，引擎无关）。
 * 含放置/消行判定/合法性/智能吸附等纯逻辑。
 */
import { ShapeMatrix, ClearResult, PreviewOutcome, DockBlock } from './types';

export class Grid {
    size: number;
    cells: (number | null)[][];

    constructor(size = 8) {
        this.size = size;
        this.cells = this.createEmptyGrid();
    }

    createEmptyGrid(): (number | null)[][] {
        const grid: (number | null)[][] = [];
        for (let i = 0; i < this.size; i++) {
            grid[i] = [];
            for (let j = 0; j < this.size; j++) grid[i][j] = null;
        }
        return grid;
    }

    clear(): void {
        this.cells = this.createEmptyGrid();
    }

    clone(): Grid {
        const g = new Grid(this.size);
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) g.cells[y][x] = this.cells[y][x];
        }
        return g;
    }

    canPlace(shape: ShapeMatrix, gx: number, gy: number): boolean {
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) {
                    const nx = gx + x;
                    const ny = gy + y;
                    if (nx < 0 || nx >= this.size || ny < 0 || ny >= this.size) return false;
                    if (this.cells[ny][nx] !== null) return false;
                }
            }
        }
        return true;
    }

    static shapeCenterOnBoard(shape: ShapeMatrix, gx: number, gy: number): { x: number; y: number } {
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
        if (!n) return { x: gx + 0.5, y: gy + 0.5 };
        return { x: sxa / n, y: sya / n };
    }

    /**
     * 由 ghost **视觉中心**在棋盘的浮点格坐标 `(aimCx, aimCy)` 推算形状的左上角锚点 `(anchorX, anchorY)`。
     *
     * ⚠️ cocos vs web 架构差异（必读，避免再次踩坑回归到 floor 公式）：
     *   - web 端：ghost（DOM canvas 跟手）与落点 preview（grid 上画的半透明）解耦渲染。
     *     用户看 preview 决定 release 位置，所以 ghost 视觉是否与 cell 对齐不要紧 → floor 公式 OK。
     *   - cocos 端：ghost **就是** preview（单层渲染，避免「两个方块」视觉撕裂）→ 必须严格一致：
     *     ghost 视觉覆盖哪些 cell，release 就必须落到那些 cell。否则用户"明明对准了"却 canPlace 失败。
     *
     * 正确公式：`round(aim - w/2)` —— 把 ghost 的左边缘 round 到最近整格边界。等价于 `Math.round`。
     *   例（w=2, aim=4.5, ghost 视觉覆盖列 4-5）：round(3.5) = 4 → block 落 4,5 ✓ 与 ghost 视觉一致
     *   例（w=2, aim=4.0）：round(3.0) = 3 → block 落 3,4（左偏定锚，与 ghost 中心刚好重合）
     *   例（w=3, aim=4.5, ghost 视觉覆盖列 3-5）：round(3.0) = 3 → block 落 3,4,5 ✓
     *
     * 历史教训：曾试图用 floor 公式对齐 web，但 cocos 单层渲染下导致偶宽块在 .5 小数时
     * ghost 视觉 vs 落点错位 1 格 —— 用户拖到"目标位置"释放却失败（canPlace=false）。
     */
    static naiveAnchorFromAim(shape: ShapeMatrix, aimCx: number, aimCy: number): { anchorX: number; anchorY: number } {
        const w = shape[0]?.length ?? 0;
        const h = shape.length;
        return {
            anchorX: Math.round(aimCx - w / 2),
            anchorY: Math.round(aimCy - h / 2),
        };
    }

    place(shape: ShapeMatrix, colorIdx: number, gx: number, gy: number): void {
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) this.cells[gy + y][gx + x] = colorIdx;
            }
        }
    }

    /**
     * 消行判定。bonus 线（同色/同 icon 整行列）判定与 web detectBonusLines 对齐：
     * 有 blockIcons 时按 icon 等价（优先），否则按 colorIdx 等价。
     */
    checkLines(blockIcons?: string[]): ClearResult {
        const fullRows: number[] = [];
        const fullCols: number[] = [];
        const clearedCells: ClearResult['cells'] = [];
        const clearedSet: Record<string, boolean> = {};

        const getIcon = (ci: number): string | null =>
            blockIcons && blockIcons.length ? blockIcons[((ci % blockIcons.length) + blockIcons.length) % blockIcons.length] : null;

        for (let y = 0; y < this.size; y++) {
            if (this.cells[y].every((c) => c !== null)) fullRows.push(y);
        }
        for (let x = 0; x < this.size; x++) {
            let colFull = true;
            for (let y = 0; y < this.size; y++) {
                if (this.cells[y][x] === null) { colFull = false; break; }
            }
            if (colFull) fullCols.push(x);
        }

        const bonusLines: ClearResult['bonusLines'] = [];
        for (const y of fullRows) {
            const first = this.cells[y][0];
            if (first === null) continue;
            const icon0 = getIcon(first);
            const allSame = icon0 !== null
                ? this.cells[y].every((c) => c !== null && getIcon(c) === icon0)
                : this.cells[y].every((c) => c === first);
            if (allSame) bonusLines.push({ type: 'row', idx: y, colorIdx: first });
        }
        for (const x of fullCols) {
            const first = this.cells[0][x];
            if (first === null) continue;
            const icon0 = getIcon(first);
            let allSame = true;
            for (let y = 1; y < this.size; y++) {
                const c = this.cells[y][x];
                const ok = icon0 !== null ? (c !== null && getIcon(c) === icon0) : (c === first);
                if (!ok) { allSame = false; break; }
            }
            if (allSame) bonusLines.push({ type: 'col', idx: x, colorIdx: first });
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

        for (const y of fullRows) for (let x = 0; x < this.size; x++) this.cells[y][x] = null;
        for (const x of fullCols) for (let y = 0; y < this.size; y++) this.cells[y][x] = null;

        return { count: fullRows.length + fullCols.length, cells: clearedCells, bonusLines, rows: fullRows, cols: fullCols };
    }

    hasAnyMove(blocks: DockBlock[]): boolean {
        for (const block of blocks) {
            if (!block || block.placed) continue;
            for (let y = 0; y < this.size; y++) {
                for (let x = 0; x < this.size; x++) {
                    if (this.canPlace(block.shape, x, y)) return true;
                }
            }
        }
        return false;
    }

    canPlaceAnywhere(shape: ShapeMatrix): boolean {
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.canPlace(shape, x, y)) return true;
            }
        }
        return false;
    }

    /**
     * 零分配地判定「在 (gx,gy) 落下 shape 后变满的整行/整列」，结果写入实例级 scratch 数组。
     *
     * 性能要点（拖拽热路径，pickSmartHoverPlacement 每 move 调用 25-49 次）：
     *   - 不再 `this.cells.map((row) => [...row])` 复制整盘（旧实现每候选一次 8×8 深拷贝）；
     *   - 「某格落子后是否被填」= 原本非空 OR 被 shape 覆盖，inline 判定，无临时棋盘；
     *   - 与旧实现严格等价：对每行/每列逐格检查 `cells[y][x] !== null || shapeCovers(x,y)`。
     * 调用方需在下一次调用前消费完 `_clRows` / `_clCols`（单线程同步，天然安全）。
     */
    private _clRows: number[] = [];
    private _clCols: number[] = [];
    private fillFullLines(shape: ShapeMatrix, gx: number, gy: number): void {
        const size = this.size;
        const cells = this.cells;
        const rows = this._clRows; rows.length = 0;
        const cols = this._clCols; cols.length = 0;
        const sh = shape.length;
        for (let y = 0; y < size; y++) {
            const sy = y - gy;
            const srow = sy >= 0 && sy < sh ? shape[sy] : null;
            let full = true;
            for (let x = 0; x < size; x++) {
                if (cells[y][x] !== null) continue;
                if (srow && srow[x - gx]) continue;
                full = false; break;
            }
            if (full) rows.push(y);
        }
        for (let x = 0; x < size; x++) {
            let full = true;
            for (let y = 0; y < size; y++) {
                if (cells[y][x] !== null) continue;
                const sy = y - gy;
                const srow = sy >= 0 && sy < sh ? shape[sy] : null;
                if (srow && srow[x - gx]) continue;
                full = false; break;
            }
            if (full) cols.push(x);
        }
    }

    previewClearOutcome(shape: ShapeMatrix, gx: number, gy: number, colorIdx: number): PreviewOutcome | null {
        if (!this.canPlace(shape, gx, gy)) return null;
        this.fillFullLines(shape, gx, gy);
        const rows = this._clRows.slice();
        const cols = this._clCols.slice();
        const size = this.size;
        // 受影响格颜色 = 原本非空取原值，否则为本次落子色（covered 格）。
        const colorAt = (x: number, y: number): number => {
            const v = this.cells[y][x];
            return v !== null ? v : colorIdx;
        };
        // 用小布尔表标记满行，避免字符串 key Set 做行列交集去重（size≤8，开销可忽略）。
        const rowFull: boolean[] = [];
        for (const y of rows) rowFull[y] = true;
        const cells: PreviewOutcome['cells'] = [];
        for (const y of rows) {
            for (let x = 0; x < size; x++) cells.push({ x, y, color: colorAt(x, y) });
        }
        for (const x of cols) {
            for (let y = 0; y < size; y++) {
                if (rowFull[y]) continue;
                cells.push({ x, y, color: colorAt(x, y) });
            }
        }
        return { rows, cols, cells };
    }

    /** 局部半径内吸附：优先消行，再就近，带轻微粘滞，提升触屏放置手感 */
    pickSmartHoverPlacement(
        shape: ShapeMatrix,
        aimCx: number,
        aimCy: number,
        anchorX: number,
        anchorY: number,
        radius: number,
        opts: {
            colorIdx?: number;
            previous?: { x: number; y: number } | null;
            clearLineBonus?: number;
            clearCellBonus?: number;
            clearAssistWindow?: number;
            stickyBonus?: number;
            stickyWindow?: number;
        } = {},
    ): { x: number; y: number } | null {
        const candidates: Array<{ x: number; y: number; distSq: number; clearLines: number; clearCells: number }> = [];
        let nearestDist = Infinity;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const gx = anchorX + dx;
                const gy = anchorY + dy;
                if (!this.canPlace(shape, gx, gy)) continue;
                const com = Grid.shapeCenterOnBoard(shape, gx, gy);
                const distSq = (com.x - aimCx) ** 2 + (com.y - aimCy) ** 2;
                // 零分配计数：满行 rl + 满列 cl；受影响格数按容斥 = rl*size + cl*size - rl*cl
                // （满行满列交点被两次计入，交点数 = rl*cl）。等价于旧 previewClearOutcome 的 cells.length，
                // 但无 8×8 深拷贝、无字符串 key Set —— 这是拖拽 hover 每帧 25-49 次调用的关键省点。
                this.fillFullLines(shape, gx, gy);
                const rl = this._clRows.length;
                const cl = this._clCols.length;
                const clearLines = rl + cl;
                const clearCells = rl * this.size + cl * this.size - rl * cl;
                candidates.push({ x: gx, y: gy, distSq, clearLines, clearCells });
                if (distSq < nearestDist) nearestDist = distSq;
            }
        }
        if (!candidates.length) return null;

        const clearLineBonus = Number.isFinite(opts.clearLineBonus) ? (opts.clearLineBonus as number) : 0.9;
        const clearCellBonus = Number.isFinite(opts.clearCellBonus) ? (opts.clearCellBonus as number) : 0.015;
        const clearAssistWindow = Number.isFinite(opts.clearAssistWindow) ? (opts.clearAssistWindow as number) : 1.35;
        const stickyBonus = Number.isFinite(opts.stickyBonus) ? (opts.stickyBonus as number) : 0.32;
        const stickyWindow = Number.isFinite(opts.stickyWindow) ? (opts.stickyWindow as number) : 0.75;
        const previous = opts.previous || null;

        let best: { x: number; y: number } | null = null;
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
                if (c.y < best.y || (c.y === best.y && c.x < best.x)) best = { x: c.x, y: c.y };
            }
        }
        return best;
    }

    getFillRatio(): number {
        let filled = 0;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.cells[y][x] !== null) filled++;
            }
        }
        return filled / (this.size * this.size);
    }

    toJSON(): { size: number; cells: (number | null)[][] } {
        return { size: this.size, cells: this.cells.map((row) => [...row]) };
    }

    fromJSON(data: { size?: number; cells: (number | null)[][] }): void {
        this.size = data.size || 8;
        this.cells = data.cells.map((row) => [...row]);
    }
}
