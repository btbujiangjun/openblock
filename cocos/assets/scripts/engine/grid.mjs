/* 自动生成 —— 请勿手改。源：web/src/grid.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * Open Block - Grid Logic
 * Manages the game board and line detection
 */
import { pickShapeByCategoryWeights } from './shapes.mjs';

/* ── v1.71 DD3：bitmap helpers（popcount / count-trailing-zeros）──
 * 用于 8×8 棋盘 Int32 mask 的位操作（findGapPositions 等热点）。
 * 不依赖 Math.clz32 fallback（V8/JSC 都已支持 ≥ 5 年）。 */
function _popcount32(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function _ctz32(v) {
    if (v === 0) return 32;
    return 31 - Math.clz32(v & -v);
}

export class Grid {
    constructor(size = 8) {
        this.size = size;
        this.cells = this.createEmptyGrid();
        /**
         * v1.60.1：cell 来源元数据（运行时，不入 toJSON / 不持久化）。
         *
         * Map<"x,y", { placedBy: string, isSpecial: boolean }>
         *   placedBy: 该格被填充时的 shape id
         *   isSpecial: 是否独立库形状（v1.32+v1.60.0 12 个事件注入形状）
         *
         * 用途："独立库块产生的空洞不算"——analyzeBoardTopology 在统计 holes 时
         * 跳过"邻接特殊块"的空格，避免因事件注入造成的散点孔洞被错误计入玩家失误指标
         * （distress 信号 / difficulty 调控 / stress）。
         *
         * 序列化约定：toJSON 不导出 _cellMeta；fromJSON 重置为空 Map。
         *   - record-replay：从 spawn 帧重建时按 dock.id ∈ specialShapeIds 重新打标（详见 game.js 回放路径）
         *   - SQLite 持久化：盘面快照不带 meta，下次加载视为"全部 isSpecial=false"——这是
         *     有意的语义弱化：跨 session 我们不追究历史块的特殊性，只保证当局 distress 正确
         */
        this._cellMeta = new Map();
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
        if (this._cellMeta) this._cellMeta.clear();
        else this._cellMeta = new Map();
    }

    /**
     * 性能：clone 是出块 DFS 最内层热点。
     *
     * v1.71 X3：新增 `{ skipMeta: true }` fast path。
     *   DFS 内的 placeAndClear 不需要 cellMeta（深层路径仅做 canPlace / cells 读），
     *   每次都拷 N 个 plain-object entry 是浪费。skipMeta 直接给空 Map，
     *   高 fill + cellMeta 较大时 DFS 整路径吞吐显著提升。
     *
     * 业务路径调用 `clone()` 不带参数 → 行为 100% 不变（默认浅拷 meta）。
     *
     * @param {{ skipMeta?: boolean }} [opts]
     */
    clone(opts) {
        const grid = Object.create(Grid.prototype);
        grid.size = this.size;
        const n = this.size;
        const src = this.cells;
        const cells = new Array(n);
        for (let y = 0; y < n; y++) cells[y] = src[y].slice();
        grid.cells = cells;
        if (opts && opts.skipMeta === true) {
            /* DFS fast path：跳过 meta 浅拷贝（深层 grid 不写 meta，读路径也仅查 cells） */
            grid._cellMeta = new Map();
        } else {
            grid._cellMeta = (this._cellMeta && this._cellMeta.size)
                ? new Map(this._cellMeta)
                : new Map();
        }
        return grid;
    }

    /** v1.60.1：cell 元数据读写 helpers（pure） */
    _metaKey(x, y) { return x + ',' + y; }

    /**
     * 返回 (x, y) 处的 cell 元数据，无则 undefined。
     * @returns {{ placedBy: string, isSpecial: boolean } | undefined}
     */
    getCellMeta(x, y) {
        return this._cellMeta?.get(this._metaKey(x, y));
    }

    /**
     * 检查 (x, y) 的 4 邻居（上下左右）是否至少有一个 isSpecial=true 的填充格。
     * 用于 boardTopology.holes 统计时豁免"邻接特殊块"的空格——这就是
     * "独立库块产生的空洞不算"在拓扑层面的精确语义。
     *
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    isCellNearSpecial(x, y) {
        if (!this._cellMeta || this._cellMeta.size === 0) return false;
        const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dx, dy] of deltas) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= this.size || ny < 0 || ny >= this.size) continue;
            if (this.cells[ny][nx] === null) continue;
            const meta = this._cellMeta.get(this._metaKey(nx, ny));
            if (meta && meta.isSpecial) return true;
        }
        return false;
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

    /**
     * 把形状落到 (gx, gy)。
     *
     * @param {number[][]} shape
     * @param {number}     colorIdx
     * @param {number}     gx
     * @param {number}     gy
     * @param {{ shapeId?: string, isSpecial?: boolean }} [opts]
     *   v1.60.1：可选 meta，未来 holes 统计/distress 信号可豁免独立库块产生的空洞。
     *   - shapeId: 该形状的 id（如 '1x2' / '2x2'）
     *   - isSpecial: 是否独立库形状（不传则默认 false）
     */
    place(shape, colorIdx, gx, gy, opts) {
        const shapeId = opts?.shapeId;
        const isSpecial = opts?.isSpecial === true;
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (shape[y][x]) {
                    const cx = gx + x;
                    const cy = gy + y;
                    this.cells[cy][cx] = colorIdx;
                    if (shapeId !== undefined && this._cellMeta) {
                        this._cellMeta.set(this._metaKey(cx, cy), { placedBy: shapeId, isSpecial });
                    }
                }
            }
        }
    }

    /**
     * 检查并清除所有满行/满列，返回结算结果。
     *
     * v1.71 Z5：内部拆为 4 个私有 helper（公开 API 与返回值 1:1 不变）。
     *   1. _detectFullRowsCols  — 仅扫描，返回 { fullRows, fullCols }
     *   2. _detectBonusLines    — 同色行/列检测（必须在清除前）
     *   3. _collectClearedCells — 去重收集要清除的 cells（含原 color）
     *   4. _clearCellsAndMeta   — 实际清除 cells + cellMeta
     *
     * 关键时序契约：bonusLines / clearedCells 必须在 _clearCellsAndMeta **之前**完成，
     * 因为它们读 this.cells[y][x] 的原 colorIdx；清除后即为 null。
     *
     * @returns {{ count: number, cells: Array, bonusLines: Array, rows: number[], cols: number[] }}
     */
    checkLines() {
        const { fullRows, fullCols } = this._detectFullRowsCols();
        const bonusLines = this._detectBonusLines(fullRows, fullCols);
        const clearedCells = this._collectClearedCells(fullRows, fullCols);
        this._clearCellsAndMeta(fullRows, fullCols);
        return {
            count: fullRows.length + fullCols.length,
            cells: clearedCells,
            bonusLines,
            rows: fullRows,
            cols: fullCols,
        };
    }

    /** Z5 step 1：扫描所有满行 / 满列。纯读，无副作用。 */
    _detectFullRowsCols() {
        const fullRows = [];
        const fullCols = [];
        const n = this.size;
        for (let y = 0; y < n; y++) {
            if (this.cells[y].every(c => c !== null)) fullRows.push(y);
        }
        for (let x = 0; x < n; x++) {
            let colFull = true;
            for (let y = 0; y < n; y++) {
                if (this.cells[y][x] === null) { colFull = false; break; }
            }
            if (colFull) fullCols.push(x);
        }
        return { fullRows, fullCols };
    }

    /** Z5 step 2：在清除前检测同色（同 icon）行/列，用于加分和特效。 */
    _detectBonusLines(fullRows, fullCols) {
        const bonusLines = [];
        const n = this.size;
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
                for (let y = 1; y < n; y++) {
                    if (this.cells[y][x] !== first) { allSame = false; break; }
                }
                if (allSame) bonusLines.push({ type: 'col', idx: x, colorIdx: first });
            }
        }
        return bonusLines;
    }

    /** Z5 step 3：去重收集要清除的 cells（含原 colorIdx）。 */
    _collectClearedCells(fullRows, fullCols) {
        const clearedCells = [];
        const clearedSet = {};
        const n = this.size;
        for (const y of fullRows) {
            for (let x = 0; x < n; x++) {
                const key = x + ',' + y;
                if (!clearedSet[key]) {
                    clearedSet[key] = true;
                    clearedCells.push({ x, y, color: this.cells[y][x] });
                }
            }
        }
        for (const x of fullCols) {
            for (let y = 0; y < n; y++) {
                const key = x + ',' + y;
                if (!clearedSet[key]) {
                    clearedSet[key] = true;
                    clearedCells.push({ x, y, color: this.cells[y][x] });
                }
            }
        }
        return clearedCells;
    }

    /** Z5 step 4：实际清除 cells + cellMeta（破坏性操作，调在最后）。 */
    _clearCellsAndMeta(fullRows, fullCols) {
        const n = this.size;
        for (const y of fullRows) {
            for (let x = 0; x < n; x++) {
                this.cells[y][x] = null;
                /* v1.60.1：清行同时清除对应 cellMeta，避免 isSpecial=true 残留误判 */
                if (this._cellMeta) this._cellMeta.delete(this._metaKey(x, y));
            }
        }
        for (const x of fullCols) {
            for (let y = 0; y < n; y++) {
                this.cells[y][x] = null;
                if (this._cellMeta) this._cellMeta.delete(this._metaKey(x, y));
            }
        }
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

    /* ── v1.71 U2：canPlaceAnywhere / countValidPlacements 局部 bitmap 优化 ──
     * AA2：抽出共享 _buildBitmapView 减少 80% 重复代码，逻辑更清晰。
     *
     * 这两个方法都是 n×n× canPlace 的扫描，是 DFS 出块 / 死局检测等热点。
     * 在方法内部一次性把 cells / shape 投影为 Int32Array bitmap，然后逐位置
     * 用单行 AND 判断冲突——无需缓存失效（局部状态），向后兼容（API 不变）。
     * n ≤ 30 时启用（OpenBlock 默认 n=8）；超出时回退到原 canPlace 路径。 */

    /**
     * AA2 helper：把 grid + shape 投影为 bitmap 视图。
     *
     * 返回 null 当：n > 30 / shape 非数组或空 / sw=0 / shape 全空
     * 返回 null 时调用方应回退到 canPlace 慢路径。
     *
     * @param {number[][]} shapeData
     * @returns {{ occRows: Int32Array, rowMasks: Int32Array, sh: number, sw: number,
     *             maxGy: number, maxGx: number, n: number } | null}
     */
    _buildBitmapView(shapeData) {
        const n = this.size;
        if (n > 30 || !Array.isArray(shapeData) || shapeData.length === 0) return null;
        const sh = shapeData.length;
        let sw = 0;
        for (let y = 0; y < sh; y++) {
            const len = shapeData[y]?.length || 0;
            if (len > sw) sw = len;
        }
        if (sw === 0) return null;
        const rowMasks = new Int32Array(sh);
        let anyCell = false;
        for (let y = 0; y < sh; y++) {
            const row = shapeData[y];
            if (!row) continue;
            let m = 0;
            for (let x = 0; x < row.length; x++) if (row[x]) { m |= (1 << x); anyCell = true; }
            rowMasks[y] = m;
        }
        if (!anyCell) return null;
        const occRows = new Int32Array(n);
        const cells = this.cells;
        for (let y = 0; y < n; y++) {
            const row = cells[y];
            let m = 0;
            for (let x = 0; x < n; x++) if (row[x] !== null) m |= (1 << x);
            occRows[y] = m;
        }
        return { occRows, rowMasks, sh, sw, maxGy: n - sh, maxGx: n - sw, n };
    }

    canPlaceAnywhere(shapeData) {
        const view = this._buildBitmapView(shapeData);
        if (!view) {
            /* 慢路径回退：n > 30 / 形状无效 / 全空 shape */
            const n = this.size;
            if (!Array.isArray(shapeData) || shapeData.length === 0) return false;
            for (let y = 0; y < n; y++)
                for (let x = 0; x < n; x++)
                    if (this.canPlace(shapeData, x, y)) return true;
            return false;
        }
        const { occRows, rowMasks, sh, maxGy, maxGx } = view;
        for (let gy = 0; gy <= maxGy; gy++) {
            for (let gx = 0; gx <= maxGx; gx++) {
                let conflict = false;
                for (let sy = 0; sy < sh; sy++) {
                    if ((occRows[gy + sy] & (rowMasks[sy] << gx)) !== 0) { conflict = true; break; }
                }
                if (!conflict) return true;
            }
        }
        return false;
    }

    /** 返回该形状在当前盘面上的合法放置位数量 */
    countValidPlacements(shapeData) {
        const view = this._buildBitmapView(shapeData);
        if (!view) {
            const n = this.size;
            if (!Array.isArray(shapeData) || shapeData.length === 0) return 0;
            let count = 0;
            for (let y = 0; y < n; y++)
                for (let x = 0; x < n; x++)
                    if (this.canPlace(shapeData, x, y)) count++;
            return count;
        }
        const { occRows, rowMasks, sh, maxGy, maxGx } = view;
        let count = 0;
        for (let gy = 0; gy <= maxGy; gy++) {
            for (let gx = 0; gx <= maxGx; gx++) {
                let conflict = false;
                for (let sy = 0; sy < sh; sy++) {
                    if ((occRows[gy + sy] & (rowMasks[sy] << gx)) !== 0) { conflict = true; break; }
                }
                if (!conflict) count++;
            }
        }
        return count;
    }

    /* ── v1.71 BB3：wouldClear 复用 bitmap 路径（避免 O(n²) 数组分配 + every） ──
     * 原实现 8x8 每次约 64 + 8×8 + 8×8 ≈ 192 ops 含 GC 压力；
     * bitmap 路径仅 8 (shape mask shift) + 8 (row check) + ≤8 (col check) ≈ 24 ops，
     * 0 GC（栈上 Int32 局部）。位运算保持 1:1 行为：
     *   - rowFull: (occRows[y] | shapeRow) === fullMask
     *   - colFull: 所有 y 的 (occRows[y] | shapeRow) 对应位 = 1
     * 慢路径回退覆盖 n > 30 / shape 无效 / canPlace 失败等边界。 */
    wouldClear(shapeData, gx, gy) {
        const n = this.size;
        /* 无效输入 / 大盘 fallback */
        if (n > 30 || !Array.isArray(shapeData) || shapeData.length === 0) {
            return this._wouldClearSlow(shapeData, gx, gy);
        }
        const sh = shapeData.length;
        if (gy < 0 || gx < 0 || gy + sh > n) return false; /* 越界视为 false（与原实现行为一致：访问越界 cell 抛错 → 视为不会消） */
        /* 构建 shape rowMasks（按 gx 平移） */
        const shifted = new Int32Array(n);
        const cells = this.cells;
        const fullMask = (n >= 31) ? -1 : ((1 << n) - 1);
        for (let sy = 0; sy < sh; sy++) {
            const row = shapeData[sy];
            if (!row) continue;
            let m = 0;
            for (let x = 0; x < row.length; x++) if (row[x]) m |= (1 << x);
            if (m === 0) continue;
            const shiftedMask = m << gx;
            if ((shiftedMask & ~fullMask) !== 0) return false; /* shape 列越界 → 与原 temp[..][gx+x] 访问越界等价 */
            shifted[gy + sy] = shiftedMask;
        }
        /* 行检查：(occRow | shifted) === fullMask 即整行满 */
        for (let y = 0; y < n; y++) {
            const row = cells[y];
            let occRow = 0;
            for (let x = 0; x < n; x++) if (row[x] !== null) occRow |= (1 << x);
            if (((occRow | shifted[y]) & fullMask) === fullMask) return true;
        }
        /* 列检查：每列 x 上，所有 y 的 (occRow | shifted) 都包含 (1<<x) */
        for (let x = 0; x < n; x++) {
            const bit = 1 << x;
            let colFull = true;
            for (let y = 0; y < n; y++) {
                const row = cells[y];
                const occBit = (row[x] !== null) ? bit : 0;
                if (((occBit | (shifted[y] & bit))) === 0) { colFull = false; break; }
            }
            if (colFull) return true;
        }
        return false;
    }

    _wouldClearSlow(shapeData, gx, gy) {
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

    /**
     * 轻量版 previewClearOutcome：只返回"放置后会消除的行数 + 列数"，**不分配整盘 temp 拷贝、
     * 不构造 cells 数组**。语义与 `previewClearOutcome(shapeData,gx,gy,*).rows.length + .cols.length`
     * 完全一致（不可放置时返回 0）。
     *
     * 用途：bestMultiClearPotential / adaptiveSpawn 这类"只关心消几条"的热点扫描，在 scored
     * 阶段对 40 形状 × 64 落点反复调用——省去每次 64 格 temp 数组分配，显著降低出块期 GC 压力。
     * 行为完全等价：与 previewClearOutcome 同样全量扫描所有行/列（不依赖"盘面无预存满线"假设）。
     */
    /* ── v1.71 CC3：countClearLines bitmap 路径（与 BB3 wouldClear 同理） ──
     * 原实现 8×8×2 嵌套循环 + 多次跳过判断 ≈ 256+ ops，热路径每帧调几百次。
     * Bitmap 实现：构建 occ ∪ shifted 后，行检查 = (combined[y] === fullMask)，
     * 列检查 = "所有 y 的该位都为 1"，整体 ≈ 32-40 ops，0 GC。
     * 慢路径回退 _countClearLinesSlow 覆盖 n > 30 / 越界等场景。 */
    countClearLines(shapeData, gx, gy) {
        if (!this.canPlace(shapeData, gx, gy)) return 0;
        const n = this.size;
        if (n > 30 || !Array.isArray(shapeData) || shapeData.length === 0) {
            return this._countClearLinesSlow(shapeData, gx, gy);
        }
        const sh = shapeData.length;
        const cells = this.cells;
        const fullMask = (n >= 31) ? -1 : ((1 << n) - 1);
        /* 构建 occ ∪ shifted shape，得到放置后的盘面 bitmap */
        const combined = new Int32Array(n);
        for (let y = 0; y < n; y++) {
            const row = cells[y];
            let m = 0;
            for (let x = 0; x < n; x++) if (row[x] !== null) m |= (1 << x);
            combined[y] = m;
        }
        for (let sy = 0; sy < sh; sy++) {
            const row = shapeData[sy];
            if (!row) continue;
            let m = 0;
            for (let x = 0; x < row.length; x++) if (row[x]) m |= (1 << x);
            if (m === 0) continue;
            const shifted = m << gx;
            const ty = gy + sy;
            if (ty < 0 || ty >= n) continue;
            combined[ty] |= shifted;
        }
        let lines = 0;
        /* 行检查 */
        for (let y = 0; y < n; y++) {
            if ((combined[y] & fullMask) === fullMask) lines++;
        }
        /* 列检查 */
        for (let x = 0; x < n; x++) {
            const bit = 1 << x;
            let full = true;
            for (let y = 0; y < n; y++) {
                if ((combined[y] & bit) === 0) { full = false; break; }
            }
            if (full) lines++;
        }
        return lines;
    }

    _countClearLinesSlow(shapeData, gx, gy) {
        const n = this.size;
        const sh = shapeData.length;
        const cells = this.cells;
        let lines = 0;
        for (let y = 0; y < n; y++) {
            const ry = y - gy;
            const shRow = (ry >= 0 && ry < sh) ? shapeData[ry] : null;
            let full = true;
            const row = cells[y];
            for (let x = 0; x < n; x++) {
                if (row[x] !== null) continue;
                const rx = x - gx;
                if (shRow && rx >= 0 && rx < shRow.length && shRow[rx]) continue;
                full = false;
                break;
            }
            if (full) lines++;
        }
        for (let x = 0; x < n; x++) {
            const rx = x - gx;
            let full = true;
            for (let y = 0; y < n; y++) {
                if (cells[y][x] !== null) continue;
                const ry = y - gy;
                if (ry >= 0 && ry < sh) {
                    const shRow = shapeData[ry];
                    if (rx >= 0 && rx < shRow.length && shRow[rx]) continue;
                }
                full = false;
                break;
            }
            if (full) lines++;
        }
        return lines;
    }

    /* ── v1.71 DD3：findGapPositions bitmap 路径 ──
     * 原实现 8×8×2 嵌套循环每帧多次分配空数组（绝大多数被丢弃，>4 空格的行/列不入结果）。
     * Bitmap 路径：
     *   1. 一次扫描构 occRows[n]（每行 bitmap）
     *   2. 行空格数 = n - popcount(occRows[y])，只在 1..4 范围内才提取位置
     *   3. 列空格数 = n - popcount(列方向投影)，同样过滤后提取
     *   4. 跳过 >4 空的"绝大多数行/列"→ 数组分配少 >70%
     * 慢路径回退 _findGapPositionsSlow 覆盖 n>30。 */
    findGapPositions() {
        const n = this.size;
        if (n > 30) return this._findGapPositionsSlow();
        const cells = this.cells;
        const fullMask = (n >= 31) ? -1 : ((1 << n) - 1);
        const occRows = new Int32Array(n);
        for (let y = 0; y < n; y++) {
            const row = cells[y];
            let m = 0;
            for (let x = 0; x < n; x++) if (row[x] !== null) m |= (1 << x);
            occRows[y] = m;
        }
        const gaps = [];
        /* 行扫描 */
        for (let y = 0; y < n; y++) {
            const occ = occRows[y];
            const emptyMask = (~occ) & fullMask;
            const empty = _popcount32(emptyMask);
            if (empty >= 1 && empty <= 4) {
                const positions = new Array(empty);
                let i = 0;
                let mm = emptyMask;
                while (mm !== 0) {
                    const x = _ctz32(mm);
                    positions[i++] = { x, y };
                    mm &= mm - 1; /* 清最低位 */
                }
                gaps.push({ type: 'row', y, empty, positions });
            }
        }
        /* 列扫描：构造列方向投影一次 */
        const colOcc = new Int32Array(n); /* colOcc[x] = 占位位掩码（位 y） */
        for (let y = 0; y < n; y++) {
            let occ = occRows[y];
            while (occ !== 0) {
                const x = _ctz32(occ);
                colOcc[x] |= (1 << y);
                occ &= occ - 1;
            }
        }
        for (let x = 0; x < n; x++) {
            const emptyMask = (~colOcc[x]) & fullMask;
            const empty = _popcount32(emptyMask);
            if (empty >= 1 && empty <= 4) {
                const positions = new Array(empty);
                let i = 0;
                let mm = emptyMask;
                while (mm !== 0) {
                    const y = _ctz32(mm);
                    positions[i++] = { x, y };
                    mm &= mm - 1;
                }
                gaps.push({ type: 'col', x, empty, positions });
            }
        }
        gaps.sort((a, b) => a.empty - b.empty);
        return gaps;
    }

    _findGapPositionsSlow() {
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

    /* ── v1.71 EE3：countGapFills 直接调 bitmap helper（绕开 findGapPositions 中转） ──
     * findGapPositions 为通用 API 必须分配 positions 数组；countGapFills 只用
     * "每行/列空格 mask + empty 数"两项数据，分配 positions 是浪费。
     * 直接复用 DD3 的 _popcount32 + bit 迭代，0 数组分配。
     * 注：当 fills 已抬到 N 还可以继续算（与原版一致——多种 gap 类型都计），
     * 不做提前 break；与 findGapPositions 同样的"行 + 列"全扫。 */
    countGapFills(shapeData) {
        const n = this.size;
        if (n > 30) return this._countGapFillsSlow(shapeData);
        const cells = this.cells;
        const fullMask = (n >= 31) ? -1 : ((1 << n) - 1);
        /* 一次构 occRows */
        const occRows = new Int32Array(n);
        for (let y = 0; y < n; y++) {
            const row = cells[y];
            let m = 0;
            for (let x = 0; x < n; x++) if (row[x] !== null) m |= (1 << x);
            occRows[y] = m;
        }
        let fills = 0;
        /* 行扫描：对每行 emptyMask popcount → 1..4 才需要尝试 placement */
        for (let y = 0; y < n; y++) {
            const emptyMask = (~occRows[y]) & fullMask;
            const empty = _popcount32(emptyMask);
            if (empty < 1 || empty > 4) continue;
            let mm = emptyMask;
            while (mm !== 0) {
                const x = _ctz32(mm);
                if (this.canPlace(shapeData, x, y)) {
                    fills += Math.max(1, 4 - empty);
                    break; /* 与原版一致：行内找到一个即跳出 */
                }
                mm &= mm - 1;
            }
        }
        /* 列扫描：构 colOcc */
        const colOcc = new Int32Array(n);
        for (let y = 0; y < n; y++) {
            let occ = occRows[y];
            while (occ !== 0) {
                const x = _ctz32(occ);
                colOcc[x] |= (1 << y);
                occ &= occ - 1;
            }
        }
        for (let x = 0; x < n; x++) {
            const emptyMask = (~colOcc[x]) & fullMask;
            const empty = _popcount32(emptyMask);
            if (empty < 1 || empty > 4) continue;
            let mm = emptyMask;
            while (mm !== 0) {
                const y = _ctz32(mm);
                if (this.canPlace(shapeData, x, y)) {
                    fills += Math.max(1, 4 - empty);
                    break;
                }
                mm &= mm - 1;
            }
        }
        return fills;
    }

    _countGapFillsSlow(shapeData) {
        let fills = 0;
        const gaps = this._findGapPositionsSlow();
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
     * v1.60.18：扫所有合法 placement，返回 shape 在盘面上的最佳"完美卡入"契合度 ∈ [0, 1]。
     *
     * **定义**：契合度 = shape 占用格的"外周 4-邻居"中，已被填充或越出边界的比例。
     *   - 1.0  → shape 周边一圈全部被填/边界，**完美嵌入凹槽**（视觉上"卡进去"）
     *   - ≥0.85 → 大部分边界已填，紧凑契合（仍可能留 1 个外角缺口）
     *   - ≤0.5 → shape 像"漂浮"在空旷区域，不会形成嵌入
     *
     * **算法**：对每个 shape cell (dx,dy)：
     *   - 枚举 4 个邻居方向 (dx±1, dy±1)
     *   - 若邻居仍在 shape 内部，跳过（不算作"外周"）
     *   - 若邻居越出棋盘 / 已被填充 → borderFilled++
     *   - 累计 borderTotal++
     *   contact = borderFilled / borderTotal
     *
     * **设计动机**（用户反馈"截图中 2×2 候选块能完美填空但算法无识别"）：
     *   现有 multiClear / gapFills / holeReduce 都不奖励"几何精确嵌入"——形如盘面上
     *   有 2×2 凹槽时，2×2 块即使不消行/不补洞，放下去也是**最优局部决策**（不会制造
     *   外悬挂、不会缩窄解空间）。本指标补齐了这一盲区。
     *
     * **复杂度**：O(n² × cells)，n=size=10、cells≤25 → 每次调用 ≤ 2500 次邻居检查；
     *   命中 1.0 立即 short-circuit 返回（绝大多数盘面在前几次 placement 就命中）。
     *
     * @param {number[][]} shapeData
     * @returns {number} 最佳契合度 ∈ [0, 1]；shape 无合法 placement 时返回 0
     */
    bestExactFit(shapeData) {
        if (!shapeData || !Array.isArray(shapeData) || shapeData.length === 0) return 0;
        const sh = shapeData.length;
        const sw = shapeData[0].length;
        const n = this.size;

        /* v1.55.11 perf：预收集 shape 占用 cell 偏移；过滤掉"邻居仍落在 shape 内"的方向，
         * 让内层循环不再做"邻居是否仍属 shape"的判断（旧版用 Set<string>"x,y" 查询，
         * bench 显示 fill=0.55 时单形状 ~2.4μs，是主循环 17% 成本的主力）。
         *
         * shapeData[dy][dx] 是 0/1 矩阵，直接索引比 Set.has 快约 5x。 */
        const shapeCells = [];
        for (let dy = 0; dy < sh; dy++) {
            const row = shapeData[dy];
            for (let dx = 0; dx < sw; dx++) {
                if (!row[dx]) continue;
                /* 收集 cell 的"外向邻居"列表（已剔除内部邻居）。每个外向邻居只算 1 次。 */
                const ext = [];
                /* 左 */
                if (dx === 0 || !shapeData[dy][dx - 1]) ext.push([-1, 0]);
                /* 右 */
                if (dx === sw - 1 || !shapeData[dy][dx + 1]) ext.push([1, 0]);
                /* 上 */
                if (dy === 0 || !shapeData[dy - 1] || !shapeData[dy - 1][dx]) ext.push([0, -1]);
                /* 下 */
                if (dy === sh - 1 || !shapeData[dy + 1] || !shapeData[dy + 1][dx]) ext.push([0, 1]);
                if (ext.length > 0) shapeCells.push([dx, dy, ext]);
            }
        }
        if (shapeCells.length === 0) return 0;

        let best = 0;
        for (let oy = 0; oy <= n - sh; oy++) {
            for (let ox = 0; ox <= n - sw; ox++) {
                if (!this.canPlace(shapeData, ox, oy)) continue;
                let borderTotal = 0, borderFilled = 0;
                for (let i = 0; i < shapeCells.length; i++) {
                    const cell = shapeCells[i];
                    const dx = cell[0], dy = cell[1], dirs = cell[2];
                    for (let d = 0; d < dirs.length; d++) {
                        const ddx = dirs[d][0], ddy = dirs[d][1];
                        borderTotal++;
                        const tx = ox + dx + ddx, ty = oy + dy + ddy;
                        if (tx < 0 || tx >= n || ty < 0 || ty >= n) {
                            borderFilled++;
                        } else if (this.cells[ty][tx] !== null) {
                            borderFilled++;
                        }
                    }
                }
                const score = borderTotal > 0 ? borderFilled / borderTotal : 0;
                if (score > best) best = score;
                if (best >= 0.999) return 1;
            }
        }
        return best;
    }

    /**
     * v1.60.19：扫所有合法 placement，返回 shape 放下后可触发的"同花顺消除"（iconBonus）
     * line 数最大值。
     *
     * v1.60.22 关键修复（用户截图反馈"方框中同花顺判断逻辑不对"）：
     *   与染色阶段 `clearScoring.monoNearFullLineColorWeights` **完全同口径**——只对
     *   **原本已填 ≥ 8 格的近满 line**（`empty ≤ 2`）才计 monoFlush。
     *
     *   之前的 bug：shape 占 9 格 + 已填 1 格同色 → 算法误识别为 monoFlush=1，
     *   但染色阶段（`empty=9 > 2` 不加 bias）根本不会给对应色 bias，玩家命中率 ≈ 1/8 等同
     *   不匹配。"可凑1同花顺"成为虚假承诺。
     *
     *   修复后语义对齐："chosen 阶段识别为 monoFlush=N" ⟺ "染色阶段会给对应色加 bias"
     *   ⟺ "形状 + 颜色双向锁定的真实概率提升"。
     *
     * **业务定义**（与 `clearScoring.detectBonusLines` 完全对齐）：
     *   - iconBonus 触发条件：整行/整列**全部为同一 icon**（或皮肤无 icon 时同 colorIdx）
     *   - 触发后该行/列得分 ×ICON_BONUS_LINE_MULT（默认 5 倍）
     *
     * **本函数语义**：识别"shape 放下后能补满若干 line，且这些 line 上**除 shape 占用格之外**
     * 的已填部分**(a) 至少 8 格 (b) 全部同 icon**"——即**形状端的潜力**，与染色阶段
     * `monoNearFullLineColorWeights` 完全同口径，形状/颜色双向锁定。
     *
     * 返回值 ∈ {0, 1, 2, ...}：
     *   - 0 → 完全不可能触发 iconBonus（无任何 placement 能补满"近满已填同色" line）
     *   - 1 → 至少一个 placement 能补满 1 条近满已填同色 line
     *   - 2+ → 单次放下可补满多条近满已填同色 line（极佳情境）
     *
     * **算法**：对每个合法 placement (ox, oy)：
     *   1. 收集 shape 影响的 row/col 集合，标记 shapeOccupied cells
     *   2. 对每条受影响 row：
     *      a. 先数 row 上"非 shape 占用"的预填格子数 `preFilled`；
     *      b. **如果 `preFilled < n - 2 = 8`，跳过**（不构成近满 line，染色阶段也不加 bias）；
     *      c. 再检查这些预填格子是否**全部同 icon**；若是 → bonusCount++
     *   3. 对每条受影响 col：同理
     *   4. 取所有 placement 的 bonusCount 最大值
     *
     * **复杂度**：O(n² × cells × n)；n=10、cells≤25 → ≤ 25000 次检查，可接受。
     *
     * @param {number[][]} shapeData
     * @param {{ blockIcons?: string[] }|null} [skin]  皮肤；不传则按 colorIdx 同色比较
     * @returns {number} 最佳 placement 下可触发 iconBonus 的 line 数
     */
    bestMonoFlushPotential(shapeData, skin = null, opts = {}) {
        const returnTarget = opts && opts.returnTarget === true;
        if (!shapeData || !Array.isArray(shapeData) || shapeData.length === 0) {
            return returnTarget ? { count: 0, targetCi: null } : 0;
        }
        const sh = shapeData.length;
        const sw = shapeData[0].length;
        const n = this.size;
        /* v1.60.26：撤销 v1.60.22 的 NEAR_FULL_MIN_PREFILLED 阈值。
         *
         * **旧版 bug**：v1.60.22 强制 `preFilled >= n - 2 = 8`，意图与 `monoNearFullLineColorWeights`
         * 的 `empty ∈ [1, 2]` 同口径，但等价于"shape 只能占该 line ≤ 2 cells"——
         * 漏掉了 shape 占 K ≥ 3 cells 的合法同花 case（如 3×1 竖块占 col 上 3 cells +
         * non-shape 7 cells 全同色 → 满 10 + 同 icon = **真同花**）。
         *
         * **严格定义同口径**（用户 v1.60.26 反馈）：
         *   候选块放下**构成消行**（line 满）+ 被消的 line 上**所有 cells 同 icon** → 同花块。
         *   `allFilled` 已保证 non-shape 部分全填（即 shape 放下后 line 满 = 消行），
         *   `allSame` 已保证 non-shape 部分全同 icon，shape 假设乐观染色为 match icon。
         *   两条件足够 — 无需额外阈值。
         *
         * **染色 bias 同口径** 通过修改 `monoNearFullLineColorWeights` 也支持 `empty > 2`
         * 但已 mono 的 line 染色 bias 达成（见 clearScoring.js v1.60.26）—— 确保 shape
         * 选定后染色阶段也尽力 match line icon，让"几何潜力"真转化为"实际同花"。 */

        const blockIcons = skin?.blockIcons;
        const getIcon = (ci) => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);
        /* 同色判定：有 icon 优先按 icon 比；无 icon 退化到 colorIdx 严格相等 */
        const sameAs = (refCi, ci) => {
            if (refCi == null || ci == null) return false;
            const refIcon = getIcon(refCi);
            if (refIcon !== null) return getIcon(ci) === refIcon;
            return ci === refCi;
        };

        /* 预收集 shape 占用 cell 偏移 */
        const shapeCells = [];
        for (let dy = 0; dy < sh; dy++) {
            for (let dx = 0; dx < sw; dx++) {
                if (shapeData[dy][dx]) shapeCells.push([dx, dy]);
            }
        }
        if (shapeCells.length === 0) return returnTarget ? { count: 0, targetCi: null } : 0;

        /* HH2 阶段 1：预计算每行/列 emptyCount（基于 bitmap）+ shape 每行/列占用 count。
         * placement 上 mono flush 的硬约束是"shape 放下后该 line 全填"，即
         * (line empty cells) === (shape contributes cells to this line)。
         * 任何不满足的 placement 直接跳过 sameAs 检查（之前是 O(n) per line × 2 lines）。
         *
         * 与 _buildBitmapView 不复用：bestMonoFlushPotential 需要的是
         * `emptyCount per row/col`，不是单 mask；自有数据结构更直接。
         *
         * II1 阶段 2：rowOccBitmap 与 shapeRowBitmap 同时存下，让 canPlace 走
         * "ANY (rowOcc & shapeBits)" 一次 AND 判定，省掉每 placement 重走
         * shapeCells 列表。n=8 时整 row 8 bit 一次完成。 */
        const fullMask = (n >= 31) ? -1 : ((1 << n) - 1);
        const rowOccBitmap = new Int32Array(n); /* II1: occupied mask per row */
        const colEmptyCount = new Int32Array(n);
        const rowEmptyCount = new Int32Array(n);
        for (let y = 0; y < n; y++) {
            const row = this.cells[y];
            let occ = 0;
            for (let x = 0; x < n; x++) if (row[x] !== null) occ |= (1 << x);
            rowOccBitmap[y] = occ;
            rowEmptyCount[y] = _popcount32((~occ) & fullMask);
        }
        for (let x = 0; x < n; x++) {
            let occCol = 0;
            for (let y = 0; y < n; y++) if (this.cells[y][x] !== null) occCol |= (1 << y);
            colEmptyCount[x] = _popcount32((~occCol) & fullMask);
        }
        /* shape 每行/列占用 cell 计数 + II1 行 bitmap（含 dx/dy 偏移） */
        const shapeRowFill = new Int32Array(sh);
        const shapeColFill = new Int32Array(sw);
        const shapeRowBits = new Int32Array(sh); /* II1: bit mask of shape cells per row（未平移） */
        for (let k = 0; k < shapeCells.length; k++) {
            const dx = shapeCells[k][0];
            const dy = shapeCells[k][1];
            shapeColFill[dx]++;
            shapeRowFill[dy]++;
            shapeRowBits[dy] |= (1 << dx);
        }

        /* v1.55.11 perf：受影响 row/col 用 Uint8Array 标记位（8 位足够 n=8），
         * shape 占用 cell 直接通过坐标算术判断（sx = x - ox, sy = y - oy）回查 shapeData，
         * 完全去掉每 placement 3 个 new Set() 与字符串 key 操作。 */
        const rowMask = new Uint8Array(n);
        const colMask = new Uint8Array(n);

        let best = 0;
        let bestTargetCi = null;
        for (let oy = 0; oy <= n - sh; oy++) {
            for (let ox = 0; ox <= n - sw; ox++) {
                /* II1 阶段 2：用 row bitmap AND 取代 canPlace 的 O(shapeCells) 循环。
                 * 对每行 shape 占用 mask 左移 ox 后与 rowOcc 求交，任一非零即冲突。
                 * 因 dx ∈ [0, sw) 平移 ox 后 ∈ [ox, ox+sw)，不会越界（fullMask 保护）。 */
                let collide = false;
                for (let dy = 0; dy < sh; dy++) {
                    const bits = shapeRowBits[dy];
                    if (bits === 0) continue;
                    if ((rowOccBitmap[oy + dy] & (bits << ox)) !== 0) { collide = true; break; }
                }
                if (collide) continue;

                rowMask.fill(0);
                colMask.fill(0);
                for (let k = 0; k < shapeCells.length; k++) {
                    rowMask[oy + shapeCells[k][1]] = 1;
                    colMask[ox + shapeCells[k][0]] = 1;
                }

                let bonusCount = 0;
                let placementTargetCi = null;

                /* 行检查：非 shape 占用部分须全填 + 全同 icon。
                 * HH2 阶段 1：先用 emptyCount 硬剪枝——shape 放下后该 row 必须全填，
                 * 即 rowEmptyCount[y] === shapeRowFill[y - oy]。
                 * 这把"sameAs O(n) 全扫"在多数无效 placement 上变成 O(1) 比较跳过。 */
                for (let y = 0; y < n; y++) {
                    if (!rowMask[y]) continue;
                    const sy = y - oy;
                    if (rowEmptyCount[y] !== shapeRowFill[sy]) continue; /* HH2 剪枝 */
                    const shapeRow = shapeData[sy];
                    let allFilled = true;
                    let refCi = null;
                    let allSame = true;
                    const cellRow = this.cells[y];
                    for (let x = 0; x < n; x++) {
                        const sx = x - ox;
                        if (sx >= 0 && sx < sw && shapeRow[sx]) continue;
                        const c = cellRow[x];
                        if (c === null) { allFilled = false; break; }
                        if (refCi === null) refCi = c;
                        else if (!sameAs(refCi, c)) { allSame = false; break; }
                    }
                    if (!allFilled) continue;
                    if (!allSame || refCi === null) continue;
                    bonusCount++;
                    if (placementTargetCi === null) placementTargetCi = refCi;
                }

                for (let x = 0; x < n; x++) {
                    if (!colMask[x]) continue;
                    const sx = x - ox;
                    if (colEmptyCount[x] !== shapeColFill[sx]) continue; /* HH2 剪枝 */
                    let allFilled = true;
                    let refCi = null;
                    let allSame = true;
                    for (let y = 0; y < n; y++) {
                        const sy = y - oy;
                        if (sy >= 0 && sy < sh && shapeData[sy][sx]) continue;
                        const c = this.cells[y][x];
                        if (c === null) { allFilled = false; break; }
                        if (refCi === null) refCi = c;
                        else if (!sameAs(refCi, c)) { allSame = false; break; }
                    }
                    if (!allFilled) continue;
                    if (!allSame || refCi === null) continue;
                    bonusCount++;
                    if (placementTargetCi === null) placementTargetCi = refCi;
                }

                if (bonusCount > best) {
                    best = bonusCount;
                    bestTargetCi = placementTargetCi;
                }
            }
        }
        if (returnTarget) return { count: best, targetCi: bestTargetCi };
        return best;
    }

    /**
     * v1.60.25：同花顺**建设期**信号 —— `bestMonoFlushPotential` 的互补信号。
     *
     * **设计动机**：
     *   - `bestMonoFlushPotential`（v1.60.19/22）严格要求 row/col 上 `empty ∈ [1, 2]`，
     *     即"立即可补满"——与 `monoNearFullLineColorWeights` 染色 bias 双向锁定。
     *   - 但截图场景是大片同色区域已成型（如 5×5 同 icon 块），单 line 上仍 `empty ≥ 3`，
     *     不达"近满"阈值——`bestMonoFlushPotential = 0`，算法**完全无识别**。
     *   - 用户语义中的"同花顺机会"涵盖"**朝 8 同色累积**"的建设期，而非仅"立即兑现"。
     *
     * **定义**：shape 放在某位置后，存在 row/col 满足：
     *   1. 该 line 上 shape 占 ≥ 1 cell（不算 buildup 否则与 shape 无关）；
     *   2. 该 line 上 non-shape 部分已填同 icon cells 数 = K（基线）；
     *   3. 若 shape 的 ci ∈ {期望同 icon ci 集}，则 buildup = K + shapeCellsOnLine - K = shapeCellsOnLine；
     *      否则 buildup = 0（shape 引入杂色破坏 mono）；
     *   4. 仅当 K + buildup ≥ minBuildup（默认 6）时计入。
     *
     * **重要**：此函数**不依赖 shape ci**（spawn 阶段 shape 颜色还未确定），假设理想情况
     * shape 染色会被 `monoNearFullLineColorWeights` 染成 match 该 line 的 icon——
     * 这是与染色阶段的"乐观契约"，与 `bestMonoFlushPotential` 同源（后者也是假设 shape ci match）。
     *
     * **返回值**：所有合法放置中 max(K + buildup) 中 buildup 最大值（即"最佳推进量"）。
     *
     * @param {number[][]} shapeData
     * @param {{ blockIcons?: string[] }|null} [skin]
     * @param {number} [minBuildup=6]
     * @returns {number}
     */
    bestMonoFlushBuildup(shapeData, skin = null, minBuildup = 6) {
        const n = this.size;
        const blockIcons = skin?.blockIcons;
        const getIcon = (ci) => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);
        const sameAs = (refCi, ci) => {
            if (refCi == null || ci == null) return false;
            const refIcon = getIcon(refCi);
            if (refIcon !== null) return getIcon(ci) === refIcon;
            return ci === refCi;
        };

        const sh = shapeData.length;
        const sw = shapeData[0]?.length || 0;
        if (sh === 0 || sw === 0) return 0;

        const shapeCells = [];
        for (let dy = 0; dy < sh; dy++) {
            for (let dx = 0; dx < sw; dx++) {
                if (shapeData[dy][dx]) shapeCells.push([dx, dy]);
            }
        }
        if (shapeCells.length === 0) return 0;

        /* v1.55.11 perf：同 bestMonoFlushPotential 优化——
         * Uint8Array 标记受影响行列，shape 占用通过坐标算术回查 shapeData。 */
        const rowMask = new Uint8Array(n);
        const colMask = new Uint8Array(n);

        let best = 0;
        for (let oy = 0; oy <= n - sh; oy++) {
            for (let ox = 0; ox <= n - sw; ox++) {
                if (!this.canPlace(shapeData, ox, oy)) continue;

                rowMask.fill(0);
                colMask.fill(0);
                for (let k = 0; k < shapeCells.length; k++) {
                    rowMask[oy + shapeCells[k][1]] = 1;
                    colMask[ox + shapeCells[k][0]] = 1;
                }

                /* 行扫描 */
                for (let y = 0; y < n; y++) {
                    if (!rowMask[y]) continue;
                    const sy = y - oy;
                    const shapeRow = shapeData[sy];
                    const cellRow = this.cells[y];
                    let refCi = null;
                    let mono = true;
                    let preFilled = 0;
                    let shapeCellsOnLine = 0;
                    for (let x = 0; x < n; x++) {
                        const sx = x - ox;
                        if (sx >= 0 && sx < sw && shapeRow[sx]) { shapeCellsOnLine++; continue; }
                        const c = cellRow[x];
                        if (c === null) continue;
                        preFilled++;
                        if (refCi === null) refCi = c;
                        else if (!sameAs(refCi, c)) { mono = false; break; }
                    }
                    if (!mono || refCi === null) continue;
                    const totalSame = preFilled + shapeCellsOnLine;
                    if (totalSame < minBuildup) continue;
                    if (shapeCellsOnLine > best) best = shapeCellsOnLine;
                }

                /* 列扫描 */
                for (let x = 0; x < n; x++) {
                    if (!colMask[x]) continue;
                    const sx = x - ox;
                    let refCi = null;
                    let mono = true;
                    let preFilled = 0;
                    let shapeCellsOnLine = 0;
                    for (let y = 0; y < n; y++) {
                        const sy = y - oy;
                        if (sy >= 0 && sy < sh && shapeData[sy][sx]) { shapeCellsOnLine++; continue; }
                        const c = this.cells[y][x];
                        if (c === null) continue;
                        preFilled++;
                        if (refCi === null) refCi = c;
                        else if (!sameAs(refCi, c)) { mono = false; break; }
                    }
                    if (!mono || refCi === null) continue;
                    const totalSame = preFilled + shapeCellsOnLine;
                    if (totalSame < minBuildup) continue;
                    if (shapeCellsOnLine > best) best = shapeCellsOnLine;
                }
            }
        }
        return best;
    }

    /**
     * v1.60.23：扫描盘面所有"近满同色 line"（与 monoNearFullLineColorWeights 同口径）。
     *
     * **用途**：`_tryInjectSpecial` 的 monoFlush 触发路径——找到近满同色 line 后，
     * 注入方向匹配 + 尺寸匹配的 special shape（如 col 上差 2 格 → 2×1 竖块；row 上差 1 格 →
     * 1×2 横块的第一段）以最大化"形状 + 颜色双向锁定"的命中率。
     *
     * **业务对齐**：与 `clearScoring.monoNearFullLineColorWeights` 完全同口径
     *   - `empty ∈ [1, 2]` 才算近满
     *   - 预填部分必须全部同 icon（皮肤无 icon 时退化 colorIdx 严格相等）
     *
     * @param {{ blockIcons?: string[] }|null} [skin]
     * @returns {Array<{ type: 'row'|'col', idx: number, empty: number, emptyCells: Array<{x:number,y:number}>, refCi: number }>}
     */
    findNearFullMonoLines(skin = null) {
        const n = this.size;
        const blockIcons = skin?.blockIcons;
        const getIcon = (ci) => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);
        const sameAs = (refCi, ci) => {
            if (refCi == null || ci == null) return false;
            const refIcon = getIcon(refCi);
            if (refIcon !== null) return getIcon(ci) === refIcon;
            return ci === refCi;
        };

        const out = [];
        /* 行扫描 */
        for (let y = 0; y < n; y++) {
            const emptyCells = [];
            let refCi = null;
            let mono = true;
            for (let x = 0; x < n; x++) {
                const c = this.cells[y][x];
                if (c === null) { emptyCells.push({ x, y }); continue; }
                if (refCi === null) refCi = c;
                else if (!sameAs(refCi, c)) { mono = false; break; }
            }
            if (!mono) continue;
            if (refCi === null) continue;
            const empty = emptyCells.length;
            if (empty < 1 || empty > 2) continue;
            out.push({ type: 'row', idx: y, empty, emptyCells, refCi });
        }

        /* 列扫描 */
        for (let x = 0; x < n; x++) {
            const emptyCells = [];
            let refCi = null;
            let mono = true;
            for (let y = 0; y < n; y++) {
                const c = this.cells[y][x];
                if (c === null) { emptyCells.push({ x, y }); continue; }
                if (refCi === null) refCi = c;
                else if (!sameAs(refCi, c)) { mono = false; break; }
            }
            if (!mono) continue;
            if (refCi === null) continue;
            const empty = emptyCells.length;
            if (empty < 1 || empty > 2) continue;
            out.push({ type: 'col', idx: x, empty, emptyCells, refCi });
        }

        return out;
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
    initBoard(fillRatio, weights, rng = Math.random) {
        this.clear();
        const targetCells = Math.floor(this.size * this.size * fillRatio);
        let placedCells = 0;
        let noProgressStreak = 0;

        while (placedCells < targetCells && noProgressStreak < 25) {
            const shape = pickShapeByCategoryWeights(weights, { rng });
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
                    const score = bottomBonus - holes * 2.5 + rng() * 0.6;

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
            const colorIdx = Math.floor(rng() * 8);
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

    /* FF3: 8×8 主流盘走 bitmap 行 popcount，N² 比较 + 计数变成 N 次 popcount。
     * 每行 32 bit 内可塞下（n ≤ 30），用 _popcount32 一次性 popcount 整行。
     * dynamicLeafCap 入口每次 DFS triplet eval 都要算一次，是热点。
     * n > 30 走原 N² 慢路径（向后兼容大盘面）。 */
    getFillRatio() {
        const n = this.size;
        if (n > 30) return this._getFillRatioSlow();
        const fullMask = (n >= 31) ? -1 : ((1 << n) - 1);
        let filled = 0;
        for (let y = 0; y < n; y++) {
            const row = this.cells[y];
            let m = 0;
            for (let x = 0; x < n; x++) if (row[x] !== null) m |= (1 << x);
            filled += _popcount32(m & fullMask);
        }
        return filled / (n * n);
    }

    _getFillRatioSlow() {
        let filled = 0;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.cells[y][x] !== null) filled++;
            }
        }
        return filled / (this.size * this.size);
    }

    /**
     * 几何近失指标：返回所有行/列中"填充率最高"的那一条的填充比例（0–1）。
     *
     * 用途：定义"差一点消行"——当某行/列已经填到 ≥ 0.78（8 格中 ≥ 7 格、即只差 1–2 格即可消）时，
     * 调用方可视为玩家处于真正几何意义上的近失状态，触发对应反馈。
     * 与 getFillRatio()（盘面整体填充率）正交：盘面整体只有 0.55 时，单行单列也可能已经 0.875。
     */
    getMaxLineFill() {
        return this.getMaxLineFillLines().maxFill;
    }

    /**
     * v1.51.1：返回最大行/列填充率以及"达到该填充率"的所有行/列索引。
     *
     * 用于 nearMissPlaceFeedback 把"差一格"判定与玩家本次落子精准绑定：
     * 仅当玩家本次落子的某格 (x, y) 落在一条 fill ≥ 阈值的 line 上时才触发，
     * 避免"瞬时触发→延时 toast"在玩家继续操作后与盘面脱节。
     *
     * `fillThreshold` 默认 0.875：返回所有占用比例 ≥ 该阈值的 line（不限于 max）。
     * 设为 1.0 时只会返回真正的 maxFill line（向后兼容旧行为）。
     *
     * @param {number} [fillThreshold=0.875] 0~1
     * @returns {{
     *   maxFill: number,
     *   lines: Array<{ type:'row'|'col', index:number, count:number, fill:number }>
     * }}
     */
    getMaxLineFillLines(fillThreshold = 0.875) {
        if (!this.size) return { maxFill: 0, lines: [] };
        const rowCounts = new Array(this.size).fill(0);
        const colCounts = new Array(this.size).fill(0);
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.cells[y][x] !== null) {
                    rowCounts[y]++;
                    colCounts[x]++;
                }
            }
        }
        let maxCount = 0;
        for (let i = 0; i < this.size; i++) {
            if (rowCounts[i] > maxCount) maxCount = rowCounts[i];
            if (colCounts[i] > maxCount) maxCount = colCounts[i];
        }
        const minCount = Math.ceil(fillThreshold * this.size);
        const lines = [];
        for (let i = 0; i < this.size; i++) {
            if (rowCounts[i] >= minCount) {
                lines.push({ type: 'row', index: i, count: rowCounts[i], fill: rowCounts[i] / this.size });
            }
            if (colCounts[i] >= minCount) {
                lines.push({ type: 'col', index: i, count: colCounts[i], fill: colCounts[i] / this.size });
            }
        }
        return { maxFill: maxCount / this.size, lines };
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
        /* v1.60.1：cellMeta 不持久化（toJSON 也不导出），fromJSON 重置为空 Map。
         * 跨 session 我们不追究历史块特殊性，只保证当局 distress 信号正确。 */
        if (this._cellMeta) this._cellMeta.clear();
        else this._cellMeta = new Map();
    }
}
