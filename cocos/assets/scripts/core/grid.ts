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

        return { count: fullRows.length + fullCols.length, cells: clearedCells, bonusLines };
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

    previewClearOutcome(shape: ShapeMatrix, gx: number, gy: number, colorIdx: number): PreviewOutcome | null {
        if (!this.canPlace(shape, gx, gy)) return null;
        const temp = this.cells.map((row) => [...row]);
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) temp[gy + y][gx + x] = colorIdx;
            }
        }
        const rows: number[] = [];
        const cols: number[] = [];
        for (let y = 0; y < this.size; y++) {
            if (temp[y].every((c) => c !== null)) rows.push(y);
        }
        for (let x = 0; x < this.size; x++) {
            let colFull = true;
            for (let y = 0; y < this.size; y++) {
                if (temp[y][x] === null) { colFull = false; break; }
            }
            if (colFull) cols.push(x);
        }
        const set: Record<string, boolean> = {};
        const cells: PreviewOutcome['cells'] = [];
        for (const y of rows) for (let x = 0; x < this.size; x++) {
            const k = `${x},${y}`;
            if (!set[k]) { set[k] = true; cells.push({ x, y, color: temp[y][x] }); }
        }
        for (const x of cols) for (let y = 0; y < this.size; y++) {
            const k = `${x},${y}`;
            if (!set[k]) { set[k] = true; cells.push({ x, y, color: temp[y][x] }); }
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
                const outcome = this.previewClearOutcome(shape, gx, gy, opts.colorIdx ?? 0);
                const clearLines = (outcome?.rows?.length || 0) + (outcome?.cols?.length || 0);
                const clearCells = outcome?.cells?.length || 0;
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
