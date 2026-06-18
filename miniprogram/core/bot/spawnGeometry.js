/**
 * bot/spawnGeometry.js — 出块路径廉价几何度量族（v1.71 从 blockSpawn.js 抽出）
 *
 * 单一职责：提供 spawn 决策与 DFS 叶子节点用的轻量 O(n²) 几何度量。
 * 这些函数都共享几点：
 *   - 输入：grid（或 grid + shapeData / 标量参数）
 *   - 输出：标量
 *   - 零模块状态、无副作用
 *   - 调用方为 DFS / scoreShape / validateSpawnTriplet / evaluateTripletSolutions
 *
 * 设计说明（v1.57.3 注释保留）：
 *   以下 6 个函数（countOccupied / countNearFullLinesCheap / columnHeightVariance /
 *   countDangerColumns / countColorBoundaries）均为 O(n²) ~ O(n²×4)，
 *   DFS 叶子调用累计 leafCap × 6 ≈ 64 × 4×64 ≈ 16k ops/triplet，相对 leafCap
 *   自身 DFS 入栈代价完全可忽略。设计目标：把"stress → 算法层"的传导从 v1.57.2
 *   的"解空间宽度 × 空洞强迫度"双轴扩展到 9 个独立可感的难度维度。
 *
 * **行为契约**：与抽出前严格一致。
 */

/** shape 数据中占用 cell 数（"形状尺寸"）。 */
function shapeCellCount(data) {
    let n = 0;
    for (let y = 0; y < data.length; y++) {
        for (let x = 0; x < data[y].length; x++) {
            if (data[y][x]) n++;
        }
    }
    return n;
}

/** 三块的 6 种排列（DFS 顺序枚举用）。 */
function permutations3(a, b, c) {
    return [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
}

/**
 * 克隆 grid，在 (gx,gy) 放下 shape 后执行 checkLines（消行结算）；返回新 grid。
 *
 * v1.71 X3：DFS 内层（dfsCountSolutions / dfsPlaceOrder）调用 placeAndClear
 * 上万次/triplet。这里走 clone({ skipMeta: true }) fast path——
 * 跳过 cellMeta 浅拷贝（DFS 深层不读 meta），高 fill 场景显著降低 GC 与 Map 拷贝成本。
 *
 * 业务行为契约不变：返回的 grid 仍可正常 canPlace / checkLines / 序列化。
 * cellMeta 在 fast path 后会是空 Map——但 DFS 不依赖 meta，业务路径也不会复用 DFS 返回的 grid。
 */
function placeAndClear(grid, shapeData, gx, gy) {
    const g = grid.clone({ skipMeta: true });
    g.place(shapeData, 0, gx, gy);
    g.checkLines();
    return g;
}

/**
 * v1.57.2 廉价"孤立空格"hole 计数：四面（上下左右；出界算非空边墙）都是非空的空格。
 *
 * 设计选择理由：
 *   - boardTopology.countUnfillableCells 是 O(shapes × n²) 重量级（用于"任意形状能否覆盖"
 *     的严谨语义），DFS 内部反复调用代价过高
 *   - Tetris-style "stacking holes"（被上方占用堵住的空格）在 OpenBlock 里语义不成立——
 *     OpenBlock 没有重力，方块可从任意位置落，"被上方堵住"不是物理 hole
 *   - "四面非空围住的空格"= 必须用 1×1 形状才能填的格子，这才是玩家心智里的"漏洞"
 *     （O(n²×4)=256 ops/叶子，仍然完全可忽略）
 *
 * @param {import('../grid.js').Grid} grid
 * @returns {number}
 */
function countIsolatedHoles(grid) {
    if (!grid?.cells) return 0;
    const n = grid.size;
    let holes = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) continue;
            const u = y === 0 || grid.cells[y - 1][x] !== null;
            const d = y === n - 1 || grid.cells[y + 1][x] !== null;
            const l = x === 0 || grid.cells[y][x - 1] !== null;
            const r = x === n - 1 || grid.cells[y][x + 1] !== null;
            if (u && d && l && r) holes++;
        }
    }
    return holes;
}

/** v1.57.3 ② — 终末填充率（O(n²) 计数；玩家心智"剩余空间窒息感"） */
function countOccupied(grid) {
    if (!grid?.cells) return 0;
    const n = grid.size;
    let occ = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (grid.cells[y][x] !== null) occ++;
    return occ;
}

/** 与 countOccupied 同义；保留作为兼容入口（blockSpawn 主体某分支调用）。 */
function countOccupiedCells(grid) {
    const n = grid.size;
    let c = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) c++;
        }
    }
    return c;
}

/** v1.57.3 ③ — 近满行/列数（差 ≤ maxEmpty 即消的行 + 列总数；与 analyzeBoardTopology
 *  的 nearFull1+nearFull2 同语义但**廉价版**：不调用 shapes 覆盖性校验、不区分 1/2 档）。
 *  玩家心智："这盘还有几条快满的线，下一手能不能消"。 */
function countNearFullLinesCheap(grid, maxEmpty = 2) {
    if (!grid?.cells) return 0;
    const n = grid.size;
    let near = 0;
    for (let y = 0; y < n; y++) {
        let empty = 0;
        for (let x = 0; x < n; x++) if (grid.cells[y][x] === null) empty++;
        if (empty > 0 && empty <= maxEmpty) near++;
    }
    for (let x = 0; x < n; x++) {
        let empty = 0;
        for (let y = 0; y < n; y++) if (grid.cells[y][x] === null) empty++;
        if (empty > 0 && empty <= maxEmpty) near++;
    }
    return near;
}

/**
 * v1.71 Z3：列高度合并扫描——一次 O(n²) 同时算出 variance + dangerCount + heights。
 *
 * 抽出动机：DFS evaluateTripletSolutions 每个叶子调用 columnHeightVariance +
 * countDangerColumns 是 2 次完全独立的"列扫描" → 重复的 O(n²) 工作。
 *
 * 调用方收益：合并后 DFS 叶子的列度量从 2 次 O(n²) 降到 1 次。
 * 单值访问入口保留（columnHeightVariance / countDangerColumns）以维持 API。
 *
 * @returns {{ heights: number[], variance: number, dangerCount: number, sum: number }}
 */
function computeColumnHeightSummary(grid, dangerHeight = 6) {
    if (!grid?.cells) return { heights: [], variance: 0, dangerCount: 0, sum: 0 };
    const n = grid.size;
    const heights = new Array(n);
    let sum = 0;
    let danger = 0;
    for (let x = 0; x < n; x++) {
        let h = 0;
        const cells = grid.cells;
        for (let y = 0; y < n; y++) {
            if (cells[y][x] !== null) { h = n - y; break; }
        }
        heights[x] = h;
        sum += h;
        if (h >= dangerHeight) danger++;
    }
    const mean = sum / n;
    let v = 0;
    for (let i = 0; i < n; i++) {
        const d = heights[i] - mean;
        v += d * d;
    }
    return { heights, variance: v / n, dangerCount: danger, sum };
}

/** v1.57.3 ⑥ — 列高度方差（"盘面平整度"）。
 *  列高 = 该列从顶部数最低的被占用行索引到 n 的距离（OpenBlock 无重力但仍可用此
 *  代理刻画"盘面凹凸"）。返回方差自身（非归一化）—— ranges 据此选档。
 *
 *  v1.71 Z3：底层走 computeColumnHeightSummary（dangerHeight 参数不影响 variance）。 */
function columnHeightVariance(grid) {
    return computeColumnHeightSummary(grid).variance;
}

/** v1.57.3 ⑦ — 危险列数：列高 ≥ dangerHeight 的列数（近爆顶预警，n=8 时
 *  默认 dangerHeight=6 表示该列已占 ≥ 6/8 = 75%）。玩家心智："眼看就要顶死"。
 *
 *  v1.71 Z3：底层走 computeColumnHeightSummary（O(n²) 一次扫描出 variance + danger）。 */
function countDangerColumns(grid, dangerHeight = 6) {
    return computeColumnHeightSummary(grid, dangerHeight).dangerCount;
}

/** v1.57.3 ⑧ — 视觉杂乱度：相邻两 cell 颜色不同的边数（不含 null-null 边）。
 *  O(n²×2) 廉价；玩家心智："盘面看起来花花绿绿 vs 整齐成片"的审美焦虑。 */
function countColorBoundaries(grid) {
    if (!grid?.cells) return 0;
    const n = grid.size;
    let b = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const c = grid.cells[y][x];
            if (c === null) continue;
            if (x + 1 < n) {
                const r = grid.cells[y][x + 1];
                if (r !== null && r !== c) b++;
            }
            if (y + 1 < n) {
                const d = grid.cells[y + 1][x];
                if (d !== null && d !== c) b++;
            }
        }
    }
    return b;
}

module.exports = { columnHeightVariance, computeColumnHeightSummary, countColorBoundaries, countDangerColumns, countIsolatedHoles, countNearFullLinesCheap, countOccupied, countOccupiedCells, permutations3, placeAndClear, shapeCellCount };
