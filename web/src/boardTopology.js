import { getAllShapes, getRegularShapes } from './shapes.js';

/**
 * 统计"不可覆盖空格"：当前棋盘上没有任何已定义形状能通过合法放置覆盖到的空格。
 *
 * 这不是传统堆叠游戏里的"上方有块、下方为空"口径；OpenBlock 的块可从任意位置落下，
 * 因此只有结合完整形状库仍无法触达的空格，才会真实降低后续可解性。
 *
 * v1.60.2（空洞口径修复）：增加 `excludeSpecial` 选项——独立库的 12 个小块
 *   (1x2 / l3-* / diag-* …) 仅供 `_tryInjectSpecial` 事件注入，玩家自然 dock 永远
 *   抽不到，将其纳入"理论可覆盖"会把真实玩家无法填的孤洞错判为 coverable，
 *   导致 holes 系统性偏低。把 excludeSpecial=true 透传到 computeCoverableCells
 *   即可还原"玩家口径"。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {Array<{ data:number[][] }>} [shapes]   显式 shape 池（兼容旧调用，传入则覆盖 excludeSpecial）
 * @param {{ excludeSpecial?: boolean }} [opts]
 */
export function countUnfillableCells(grid, shapes, opts) {
    if (!grid?.cells?.length) return 0;
    const coverable = computeCoverableCells(grid, shapes, opts);
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
 * v1.60.2：默认 shape 池来自参数 `shapes`；若调用方未显式传入，则按 `opts.excludeSpecial`
 *   在「全部 40 个」与「常规 28 个（剔除特殊小块）」之间二选一。两者共存时 `shapes` 优先，
 *   保持向后兼容（旧调用方传入自定义 shape 池语义不变）。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {Array<{ data:number[][] }>} [shapes]
 * @param {{ excludeSpecial?: boolean }} [opts]
 * @returns {boolean[][]}
 */
/* ── v1.71 性能优化：shape mask 缓存 + bitmap canPlace ───────────────
 * computeCoverableCells 是 boardTopology 模块最热的 5 重循环（pool × n × n × sy × sx）。
 * 原版每个 (shape, gx, gy) 都调 grid.canPlace 走一遍 shape × shape 的双层 if 链 + 边界检查。
 *
 * 这里：
 *  1. 把每个 shape 预编译为 {rowMasks: Int32Array, width, height}
 *     rowMasks[sy] = 该行的 bitmap（位 sx=1 表示该格非空），左对齐
 *  2. 把 grid.cells 投影为 occupiedRows: Int32Array(n)
 *  3. canPlace 变成两步：
 *      a. 边界检查：gx+width ≤ n && gy+height ≤ n
 *      b. 冲突检查：所有 sy 行 (occRows[gy+sy] & (rowMasks[sy] << gx)) === 0
 *  4. 命中后写 coverable 也用 bitmap：coverableRows[y] |= rowMasks[sy] << gx，
 *     最后一次性投影回 boolean[][]
 *
 * 限制：n ≤ 30（位运算用 32 位 int 兼容；OpenBlock 默认 n=8，远小于上限）。
 * 大于该限制时自动回退到原 grid.canPlace 路径（安全兜底）。 */

const _SHAPE_MASK_CACHE = new WeakMap(); // shape.data → { rowMasks, width, height, isEmpty }

function _compileShapeMask(data) {
    let cached = _SHAPE_MASK_CACHE.get(data);
    if (cached !== undefined) return cached;
    let height = data.length;
    let width = 0;
    for (let y = 0; y < height; y++) {
        const rowLen = data[y]?.length || 0;
        if (rowLen > width) width = rowLen;
    }
    const rowMasks = new Int32Array(height);
    let anyCell = false;
    for (let y = 0; y < height; y++) {
        const row = data[y];
        if (!row) continue;
        let m = 0;
        for (let x = 0; x < row.length; x++) {
            if (row[x]) { m |= (1 << x); anyCell = true; }
        }
        rowMasks[y] = m;
    }
    cached = { rowMasks, width, height, isEmpty: !anyCell };
    _SHAPE_MASK_CACHE.set(data, cached);
    return cached;
}

function _projectGridToBitmap(grid, n) {
    const occRows = new Int32Array(n);
    const cells = grid.cells;
    for (let y = 0; y < n; y++) {
        const row = cells[y];
        let m = 0;
        for (let x = 0; x < n; x++) {
            if (row[x] !== null) m |= (1 << x);
        }
        occRows[y] = m;
    }
    return occRows;
}

export function computeCoverableCells(grid, shapes, opts) {
    if (!grid?.cells?.length) return [];
    const pool = Array.isArray(shapes)
        ? shapes
        : (opts?.excludeSpecial === true ? getRegularShapes() : getAllShapes());
    const n = grid.size;
    /* 兼容性兜底：
     *   - n > 30：位运算溢出 32 位 int
     *   - 调用方传入了非标准 grid（自定义 canPlace 不与 cells null 等价；
     *     极少数测试 / mock 场景会这样）— 通过 grid._isBitmapSafe 显式 opt-out，
     *     或当 grid.cells 不是数组阵列时回退
     * OpenBlock 真正的 Grid 实例 canPlace 严格基于 cells null，bitmap 路径与原版语义等价。 */
    if (n > 30 || grid._isBitmapSafe === false) return _computeCoverableCellsFallback(grid, pool, n);

    const occRows = _projectGridToBitmap(grid, n);
    const coverableRows = new Int32Array(n);

    for (let s = 0; s < pool.length; s++) {
        const data = pool[s]?.data;
        if (!Array.isArray(data) || data.length === 0) continue;
        const mask = _compileShapeMask(data);
        if (mask.isEmpty) continue;
        const sh = mask.height;
        const sw = mask.width;
        const rowMasks = mask.rowMasks;
        const maxGy = n - sh;
        const maxGx = n - sw;
        if (maxGy < 0 || maxGx < 0) continue;
        for (let gy = 0; gy <= maxGy; gy++) {
            for (let gx = 0; gx <= maxGx; gx++) {
                /* canPlace via bitmap: 所有 sy 行 (occ & (mask << gx)) === 0 */
                let conflict = false;
                for (let sy = 0; sy < sh; sy++) {
                    if ((occRows[gy + sy] & (rowMasks[sy] << gx)) !== 0) { conflict = true; break; }
                }
                if (conflict) continue;
                /* 命中：更新 coverable 行 bitmap */
                for (let sy = 0; sy < sh; sy++) {
                    coverableRows[gy + sy] |= (rowMasks[sy] << gx);
                }
            }
        }
    }

    /* 投影回 boolean[][]（保持对外契约不变） */
    const coverable = new Array(n);
    for (let y = 0; y < n; y++) {
        const row = new Array(n);
        const m = coverableRows[y];
        for (let x = 0; x < n; x++) row[x] = (m & (1 << x)) !== 0;
        coverable[y] = row;
    }
    return coverable;
}

/* n > 30 时的兜底：原版语义，无 bitmap 加速 */
function _computeCoverableCellsFallback(grid, pool, n) {
    const coverable = Array.from({ length: n }, () => new Array(n).fill(false));
    for (const shape of pool) {
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

/**
 * 空白连通块数 `contiguous_regions`（客观难度·几何）。
 *
 * 4-连通统计棋盘上「空格」组成的连通分量数量。值越大说明剩余空间越碎片化、
 * 越分散，可用大块落点越少 —— 与 `holes` / `scd` 互补的几何难度强信号
 * （holes 看「填不进」，regions 看「被切碎」）。
 *
 * 纯几何、无形状池依赖；与 rl_pytorch/fast_grid.py `_contiguous_regions` 同口径
 * （4-邻接、空=cells===null）。
 *
 * @param {import('./grid.js').Grid} grid
 * @returns {number}
 */
export function countEmptyRegions(grid) {
    if (!grid?.cells?.length) return 0;
    const n = grid.size;
    const visited = Array.from({ length: n }, () => new Array(n).fill(false));
    const queue = new Array(n * n);
    let regions = 0;
    for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
            if (grid.cells[sy][sx] !== null || visited[sy][sx]) continue;
            regions++;
            let head = 0;
            let tail = 0;
            queue[tail++] = (sy << 8) | sx;
            visited[sy][sx] = true;
            while (head < tail) {
                const packed = queue[head++];
                const cx = packed & 0xff;
                const cy = packed >>> 8;
                const nbrs = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
                for (const [nx, ny] of nbrs) {
                    if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
                    if (visited[ny][nx] || grid.cells[ny][nx] !== null) continue;
                    visited[ny][nx] = true;
                    queue[tail++] = (ny << 8) | nx;
                }
            }
        }
    }
    return regions;
}

/**
 * 凹角数 `concave_corners`（客观难度·几何）。
 *
 * 遍历每个「空格」的 4 个对角方向 (±1,±1)，若构成该角的两个正交邻居
 * （竖直 (y+dy,x) 与水平 (y,x+dx)）**都被占用格**填充，则计为一个凹角。
 * 越界视为「未占用」（只看界内方块结构形成的内凹缺口），因此凹角纯由
 * 已落方块的轮廓决定 —— 是「陷阱位 / L 型缺口」温床，直接增加贴合难度，
 * 与刚引入的「放置块吸附」软约束天然互补（凹角即吸附目标）。
 *
 * 与 rl_pytorch/fast_grid.py `_concave_corners` 同口径。
 *
 * @param {import('./grid.js').Grid} grid
 * @returns {number}
 */
export function countConcaveCorners(grid) {
    if (!grid?.cells?.length) return 0;
    const n = grid.size;
    const occ = (y, x) => (y >= 0 && y < n && x >= 0 && x < n && grid.cells[y][x] !== null);
    const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    let count = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) continue;
            for (const [dy, dx] of corners) {
                if (occ(y + dy, x) && occ(y, x + dx)) count++;
            }
        }
    }
    return count;
}

/**
 * 「近完整行/列」检测的单一来源。
 *
 * 行/列只要剩余空格 ≤ `maxEmpty` 即视作「近满」，进一步要求所有空格都能被某个
 * 合法形状覆盖（避免把一辈子也填不上的死格当作"差几格就消"）。
 *
 * 该函数同时被 `analyzeBoardTopology`（topology pill / 自适应 stress）与
 * `bot/blockSpawn.analyzePerfectClearSetup`（清屏机会评估）复用，避免"近满"在不同
 * 视图下口径不一致——这是 v1.16 之前 stress 与 multiClearCandidates 走调的根因。
 *
 * @param {import('./grid.js').Grid} grid
 * @param {object} [opts]
 * @param {number} [opts.maxEmpty=2]            视为「近满」所需的最大空格数
 * @param {boolean} [opts.requireFillable=true] 是否要求所有空格都可被形状覆盖
 * @param {boolean[][]} [opts.coverable]        预先计算的可覆盖矩阵（默认现算）
 * @returns {{
 *   rows: Array<{ y:number, emptyCount:number, emptyCells: Array<[number,number]> }>,
 *   cols: Array<{ x:number, emptyCount:number, emptyCells: Array<[number,number]> }>,
 *   nearFullLines: number,
 *   close1: number,
 *   close2: number
 * }}
 */
export function detectNearClears(grid, opts = {}) {
    if (!grid?.cells?.length) {
        return { rows: [], cols: [], nearFullLines: 0, close1: 0, close2: 0 };
    }
    const n = grid.size;
    const maxEmpty = Math.max(0, Math.min(n, opts.maxEmpty ?? 2));
    const requireFillable = opts.requireFillable !== false;
    const coverable = opts.coverable ?? (requireFillable ? computeCoverableCells(grid) : null);

    /** @type {Array<{ y:number, emptyCount:number, emptyCells: Array<[number,number]> }>} */
    const rows = [];
    /** @type {Array<{ x:number, emptyCount:number, emptyCells: Array<[number,number]> }>} */
    const cols = [];
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
        if (emptyCount === 0 || emptyCount > maxEmpty) continue;
        const fillable = !requireFillable
            || emptyCells.every(([ey, ex]) => coverable?.[ey]?.[ex] === true);
        if (!fillable) continue;
        rows.push({ y, emptyCount, emptyCells });
        if (emptyCount === 1) close1++;
        else if (emptyCount === 2) close2++;
    }
    for (let x = 0; x < n; x++) {
        let filled = 0;
        const emptyCells = [];
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) filled++;
            else emptyCells.push([y, x]);
        }
        const emptyCount = n - filled;
        if (emptyCount === 0 || emptyCount > maxEmpty) continue;
        const fillable = !requireFillable
            || emptyCells.every(([ey, ex]) => coverable?.[ey]?.[ex] === true);
        if (!fillable) continue;
        cols.push({ x, emptyCount, emptyCells });
        if (emptyCount === 1) close1++;
        else if (emptyCount === 2) close2++;
    }

    return {
        rows,
        cols,
        nearFullLines: rows.length + cols.length,
        close1,
        close2
    };
}

/**
 * @param {import('./grid.js').Grid} grid
 * @param {{ skipSpecialCells?: boolean }} [opts]
 *   v1.60.1（新需求 3）：`skipSpecialCells=true` 时，holes 统计豁免"邻接独立库块"的空格。
 *   这就是「独立库块产生的空洞不算」在拓扑层面的精确实现：
 *     - hole 仍按 "无形状能覆盖" 计算（口径不变）
 *     - 但若该空格 4 邻居至少有一个 cellMeta.isSpecial=true 的填充格，
 *       则视为"事件注入造成的散点孔洞"，不计入 holes
 *   下游 adaptiveSpawn / playerAbilityModel / distress 信号应在评估玩家失误时传 true；
 *   bot 模拟 / 拓扑统计场景保持默认（false）即可。
 *
 *   v1.60.2（空洞口径修复，与本截图反馈直接相关）：当 `skipSpecialCells=true` 时
 *   *同时* 把 `excludeSpecial=true` 透传给 `computeCoverableCells`——独立库 12 个
 *   小块（1x2 / l3-* / diag-* …）只走事件注入，玩家自然 dock 抽不到，不应作为
 *   "理论可覆盖"工具。两个开关联动后，"玩家口径 holes"在两个维度上都自洽：
 *     1) coverable 工具池 = 28 个常规 shape（不含独立库）
 *     2) 邻接独立库块占据的孤格 → 计入 `holesNearSpecial` 不计 `holes`
 *   旧 bug：仅做 (2) 时，"理论能用 1×2 / l3 填" 的空格被错判为 coverable，
 *          holes 系统性偏低，玩家面板"空洞 2"实际可能应该是 3~5。
 */
export function analyzeBoardTopology(grid, opts) {
    const skipSpecialCells = opts?.skipSpecialCells === true;
    const n = grid.size;
    const cells = grid.cells;

    /* ── Pass 1: 在一次 O(n²) 遍历内同时计算
     *   - colHeights[x]：列顶高（从顶往下首个非空的高度）
     *   - occupiedCount：占用格总数
     *   - rowTransitions / colTransitions：行/列方向上 occupied↔empty 转换次数
     *   - wells[x][y]：左右两侧均填的空格（井）
     * 原版按 5 次独立遍历分别计算，合并后减少 4 次循环开销与 5 倍 cells[y][x] 索引。
     */
    const colHeights = new Array(n).fill(0);
    const colFirstSeen = new Array(n).fill(false);
    let occupiedCount = 0;
    let rowTransitions = 0;
    let wells = 0;

    /* 行扫一次，同时维护 colHeights 与 wells（需要左右邻），rowTransitions */
    for (let y = 0; y < n; y++) {
        let prevOccupied = true; // 隐式左墙
        for (let x = 0; x < n; x++) {
            const occupied = cells[y][x] !== null;
            if (occupied) {
                occupiedCount++;
                if (!colFirstSeen[x]) {
                    colHeights[x] = n - y;
                    colFirstSeen[x] = true;
                }
            } else {
                /* well: 左侧、右侧均填（边界视为填） */
                const left = x === 0 || cells[y][x - 1] !== null;
                const right = x === n - 1 || cells[y][x + 1] !== null;
                if (left && right) wells++;
            }
            if (occupied !== prevOccupied) rowTransitions++;
            prevOccupied = occupied;
        }
        if (!prevOccupied) rowTransitions++; // 隐式右墙
    }

    /* colTransitions 必须按列遍历（不能与行扫合并） */
    let colTransitions = 0;
    for (let x = 0; x < n; x++) {
        let prevOccupied = true; // 隐式顶墙
        for (let y = 0; y < n; y++) {
            const occupied = cells[y][x] !== null;
            if (occupied !== prevOccupied) colTransitions++;
            prevOccupied = occupied;
        }
        if (!prevOccupied) colTransitions++; // 隐式底墙
    }

    /* v1.60.2：coverable 工具池与 skipSpecialCells 联动，参见上方 jsdoc 末段。
     * computeCoverableCells 是 5 重循环热点；后续如需进一步压热点应在 grid 层做 bitmap. */
    const coverable = computeCoverableCells(grid, undefined, { excludeSpecial: skipSpecialCells });
    let holes = 0;
    let holesNearSpecial = 0;
    const hasNearSpecialFn = skipSpecialCells && typeof grid.isCellNearSpecial === 'function';
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (cells[y][x] !== null || coverable[y][x]) continue;
            if (hasNearSpecialFn && grid.isCellNearSpecial(x, y)) {
                holesNearSpecial++;
            } else {
                holes++;
            }
        }
    }

    /* 由 colHeights 衍生：avg / variance / flatness / max（单次循环避免 reduce + Math.max 两遍） */
    let sumH = 0;
    let maxColHeight = 0;
    for (let x = 0; x < n; x++) {
        const h = colHeights[x];
        sumH += h;
        if (h > maxColHeight) maxColHeight = h;
    }
    const avgHeight = sumH / Math.max(1, n);
    let heightVariance = 0;
    for (let x = 0; x < n; x++) {
        const d = colHeights[x] - avgHeight;
        heightVariance += d * d;
    }
    heightVariance /= Math.max(1, n);
    const flatness = 1 / (1 + heightVariance);

    const nearClears = detectNearClears(grid, { coverable, maxEmpty: 2 });
    const nearFullLines = nearClears.nearFullLines;
    const close1 = nearClears.close1;
    const close2 = nearClears.close2;

    /* ── v1.60.3 / v1.60.5 玩家心智口径"孔洞"双口径 ───────────────────────
     * `holes`（基于 coverable）口径只统计"任何形状都无法覆盖"的空格——但 OpenBlock
     * 的 reg 28 池里有大量 4-cell 形状（2x2 / T/L/Z/J），只要洞旁有 3 个空邻居能
     * 凑出某个 4-cell 形状，洞就算 coverable。结果在"大空区里散布几个填块"的
     * 盘面上，coverable-holes 永远 = 0，与玩家"被填块包围"的视觉直觉脱节。
     *
     * 这里同步暴露 **两条更贴近玩家心智** 的口径：
     *
     *   1) `isolatedHoles`（严格：4-邻全填）
     *      与 bot/blockSpawn.js 的 `countIsolatedHoles` 同口径——单格被 4 邻完全
     *      围住才计。漏掉 2-3 格"L 型小空腔"嵌在密集块群里的视觉直觉洞。
     *
     *   2) `enclosedVoidCells` ← **v1.60.5 新增、UI 默认口径**
     *      4-连通空格分量大小 ≤ ENCLOSED_VOID_MAX_SIZE (默认 5) 的格子全部计入。
     *      涵盖"1 格孤洞 / 2-3 格 L 凹陷 / 5 格小腔"等所有"被填块圈住的小型空腔"，
     *      与用户截图箭头标的位置一一对应。> 5 的分量视为大空区，不计。
     *
     * skipSpecialCells=true 时两种口径都应用"邻接特殊块豁免"。
     */
    const ENCLOSED_VOID_MAX_SIZE = 5;
    let isolatedHoles = 0;
    let isolatedHolesNearSpecial = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) continue;
            const u = y === 0 || grid.cells[y - 1][x] !== null;
            const d = y === n - 1 || grid.cells[y + 1][x] !== null;
            const l = x === 0 || grid.cells[y][x - 1] !== null;
            const r = x === n - 1 || grid.cells[y][x + 1] !== null;
            if (!(u && d && l && r)) continue;
            const nearSpec = skipSpecialCells && typeof grid.isCellNearSpecial === 'function'
                ? grid.isCellNearSpecial(x, y)
                : false;
            if (nearSpec) isolatedHolesNearSpecial++;
            else isolatedHoles++;
        }
    }

    /* v1.60.5：4-连通空格分量扫描（一次 BFS，O(n²)）—— 找出所有"小型局部空腔"。
     * 分量大小 ≤ ENCLOSED_VOID_MAX_SIZE 的整个分量内每个格都算 enclosedVoidCells。
     * 算法：经典 iterative BFS，避免递归爆栈；用 visited 矩阵标记已访问空格。 */
    let enclosedVoidCells = 0;
    let enclosedVoidCellsNearSpecial = 0;
    const visited = Array.from({ length: n }, () => new Array(n).fill(false));
    const queue = new Array(n * n);
    for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
            if (grid.cells[sy][sx] !== null || visited[sy][sx]) continue;
            /* BFS 从 (sx,sy) 出发，收集整个 4-连通空格分量 */
            let head = 0;
            let tail = 0;
            queue[tail++] = (sy << 8) | sx;
            visited[sy][sx] = true;
            const compCells = [];
            while (head < tail) {
                const packed = queue[head++];
                const cx = packed & 0xff;
                const cy = packed >>> 8;
                compCells.push([cx, cy]);
                const nbrs = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
                for (const [nx, ny] of nbrs) {
                    if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
                    if (visited[ny][nx] || grid.cells[ny][nx] !== null) continue;
                    visited[ny][nx] = true;
                    queue[tail++] = (ny << 8) | nx;
                }
            }
            if (compCells.length > ENCLOSED_VOID_MAX_SIZE) continue;
            /* 小空腔：分量内每个格都计入 enclosedVoidCells；
             * 若分量内有任何格 4-邻含 isSpecial → 整个分量按 NearSpecial 豁免计。
             * （邻接 special 即代表整片空腔可能由独立库注入造成，与 holesNearSpecial 哲学一致） */
            let nearSpec = false;
            if (skipSpecialCells && typeof grid.isCellNearSpecial === 'function') {
                for (const [cx, cy] of compCells) {
                    if (grid.isCellNearSpecial(cx, cy)) { nearSpec = true; break; }
                }
            }
            if (nearSpec) enclosedVoidCellsNearSpecial += compCells.length;
            else enclosedVoidCells += compCells.length;
        }
    }

    /* 客观难度·几何（与 RL state 标量 / spawnMeta 落库同口径，详见 countEmptyRegions /
     * countConcaveCorners）。纯几何、无形状池依赖，O(n²)。 */
    const contiguousRegions = countEmptyRegions(grid);
    const concaveCorners = countConcaveCorners(grid);

    return {
        holes,
        /* v1.60.1：被豁免的"邻接特殊块"空格数（仅 skipSpecialCells=true 时 >0）；
         * 供 DFV / 调试面板透视"特殊形状造成多少散点孤岛被豁免" */
        holesNearSpecial,
        /* 空白连通块数 / 凹角数（客观难度·几何，DFV 与离线难度桶聚合复用） */
        contiguousRegions,
        concaveCorners,
        /* v1.60.3：玩家心智口径"孤洞"（4-邻全填）——与 bot.countIsolatedHoles 同口径。 */
        isolatedHoles,
        isolatedHolesNearSpecial,
        /* v1.60.5：玩家心智"小型局部空腔"（4-连通分量 size ≤ 5）——UI 默认展示口径，
         * 涵盖 L 型小凹陷等 isolatedHoles 漏掉的小空腔。详见 §"双口径"注释。 */
        enclosedVoidCells,
        enclosedVoidCellsNearSpecial,
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
