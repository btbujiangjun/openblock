/**
 * 候选块出块算法层（三层架构）
 *
 * Layer 1 — 即时盘面感知：拓扑评分（空洞/表面平整/多消潜力）+ 反死局 + 解法数量调控
 * Layer 2 — 局内体验：combo 链催化、跨轮品类记忆、节奏 setup/payoff、清屏奖励
 * Layer 3 — 局间弧线：通过 spawnHints.sessionArc / milestone / returnWarmup 影响权重
 *
 * spawnHints（来自自适应引擎 adaptiveSpawn.js）：
 *   clearGuarantee      (0-3)   三连块中至少 N 个能触发即时消行
 *   sizePreference      (-1~1)  负=偏小块，正=偏大块
 *   diversityBoost      (0~1)   越高→三连块品类越多样
 *   comboChain          (0~1)   combo 链强度：越高越偏好能续链的消行块
 *   multiClearBonus     (0~1)   多消鼓励：越高越偏好能同时完成多行的块
 *   multiLineTarget     (0|1|2) v10.33：多线兑现目标；2 时阶段 1/加权池强烈偏好 multiClear≥2
 *   delightBoost        (0~1)   爽感兑现：来自玩家能力/心流状态，额外提高多消/清屏概率
 *   perfectClearBoost   (0~1)   清屏兑现：有清屏准备时提高可清屏块抽样权重
 *   iconBonusTarget     (0~1)   同 icon 兑现：由 game.js 放大 dock 染色权重，本层记录诊断
 *   rhythmPhase         'setup'|'payoff'|'neutral'  节奏相位
 *   targetSolutionRange { min, max, label } | null  解法数量难度区间（v9 新增）
 *   spawnTargets        object  stress 投影后的多轴目标：复杂度/解空间/消行/空间压力/payoff/新鲜度
 *
 * spawnContext（来自 game.js，跨轮状态）：
 *   lastClearCount  上一轮三连块产生的消行数
 *   roundsSinceClear 距上次消行的出块轮数
 *   recentCategories 最近 3 轮已出品类数组
 *   totalRounds     本局已出块轮数
 *   scoreMilestone  是否刚达到里程碑
 *
 * 核心不变量：
 *   1. 中高填充下验证 tripletSequentiallySolvable（避免不公平死局）
 *   2. 保证最低机动性（minMobilityTarget）
 *   3. 解法数量在配置区间内（v9 新增，软过滤；budget 截断时不参与过滤）
 *   4. 返回 _spawnDiagnostics 供策略面板解释（含 solutionMetrics）
 */

import { getAllShapes, getShapeCategory, pickShapeByCategoryWeights } from '../shapes.js';
import { GAME_RULES } from '../gameRules.js';
import { analyzeBoardTopology, detectNearClears } from '../boardTopology.js';

const MAX_SPAWN_ATTEMPTS = 22;
const FILL_SURVIVABILITY_ON = 0.52;
const SURVIVE_SEARCH_BUDGET = 14000;
const CRITICAL_FILL = 0.68;

/* ---------- 解法数量评估常量（可被 game_rules.solutionDifficulty 覆盖） ---------- */
const SOLUTION_EVAL_FILL_MIN_DEFAULT = 0.45;
const SOLUTION_LEAF_CAP_DEFAULT = 64;
const SOLUTION_BUDGET_DEFAULT = 8000;
const SOLUTION_FILTER_ATTEMPT_RATIO = 0.6; // attempt < 60% 时才硬过滤，避免无解死循环

/* ================================================================== */
/*  基础工具                                                           */
/* ================================================================== */

/** @param {number[][]} data */
function shapeCellCount(data) {
    let n = 0;
    for (let y = 0; y < data.length; y++) {
        for (let x = 0; x < data[y].length; x++) {
            if (data[y][x]) n++;
        }
    }
    return n;
}

/** @param {import('../grid.js').Grid} grid @param {number[][]} shapeData */
function countLegalPlacements(grid, shapeData) {
    let c = 0;
    const n = grid.size;
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
            if (grid.canPlace(shapeData, x, y)) c++;
    return c;
}

/**
 * 展示用「解法」口径：各 **未放置** 候选块在当前盘面上的合法落子位置数之和；
 * `firstMoveFreedom` = 其中最少者的合法落子数（瓶颈块可放位）。
 * 计算量 O(块数×格²)，应在候选组合变化时调用（见 Game 侧缓存）。
 *
 * @param {import('../grid.js').Grid | null} grid
 * @param {Array<{ placed?: boolean, shape?: number[][] }>} dockBlocks
 * @returns {{ solutionCount: number, firstMoveFreedom: number } | null}
 */
export function computeCandidatePlacementMetric(grid, dockBlocks) {
    if (!grid?.cells || !Array.isArray(dockBlocks)) {
        return null;
    }
    const unplaced = dockBlocks.filter((b) => b && !b.placed && Array.isArray(b.shape));
    if (unplaced.length === 0) {
        return null;
    }
    let total = 0;
    let minPl = Infinity;
    for (const b of unplaced) {
        const n = countLegalPlacements(grid, b.shape);
        total += n;
        if (n < minPl) minPl = n;
    }
    return {
        solutionCount: total,
        firstMoveFreedom: Number.isFinite(minPl) ? minPl : 0
    };
}

function permutations3(a, b, c) {
    return [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
}

function placeAndClear(grid, shapeData, gx, gy) {
    const g = grid.clone();
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

/* ================================================================== */
/*  v1.57.3 — 多维 stress 投射的廉价 DFS 叶子度量族                    */
/*                                                                    */
/*  以下 6 个函数均为 O(n²) ~ O(n²×4)，DFS 叶子调用累计 leafCap × 6   */
/*  ≈ 64 × 4×64 ≈ 16k ops/triplet，相对 leafCap 自身 DFS 入栈代价      */
/*  完全可忽略。设计目标：把"stress → 算法层"的传导从 v1.57.2 的       */
/*  「解空间宽度 × 空洞强迫度」双轴扩展到 9 个独立可感的难度维度。      */
/* ================================================================== */

/** v1.57.3 ② — 终末填充率（O(n²) 计数；玩家心智"剩余空间窒息感"） */
function countOccupied(grid) {
    if (!grid?.cells) return 0;
    const n = grid.size;
    let occ = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (grid.cells[y][x] !== null) occ++;
    return occ;
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

/** v1.57.3 ⑥ — 列高度方差（"盘面平整度"）。
 *  列高 = 该列从顶部数最低的被占用行索引到 n 的距离（OpenBlock 无重力但仍可用此
 *  代理刻画"盘面凹凸"）。返回方差自身（非归一化）—— ranges 据此选档。 */
function columnHeightVariance(grid) {
    if (!grid?.cells) return 0;
    const n = grid.size;
    const heights = new Array(n).fill(0);
    for (let x = 0; x < n; x++) {
        let h = 0;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) { h = n - y; break; }
        }
        heights[x] = h;
    }
    let sum = 0;
    for (const h of heights) sum += h;
    const mean = sum / n;
    let v = 0;
    for (const h of heights) v += (h - mean) * (h - mean);
    return v / n;
}

/** v1.57.3 ⑦ — 危险列数：列高 ≥ dangerHeight 的列数（近爆顶预警，n=8 时
 *  默认 dangerHeight=6 表示该列已占 ≥ 6/8 = 75%）。玩家心智："眼看就要顶死"。 */
function countDangerColumns(grid, dangerHeight = 6) {
    if (!grid?.cells) return 0;
    const n = grid.size;
    let danger = 0;
    for (let x = 0; x < n; x++) {
        let h = 0;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) { h = n - y; break; }
        }
        if (h >= dangerHeight) danger++;
    }
    return danger;
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

function dfsPlaceOrder(grid, orderedShapes, depth, budget) {
    if (depth >= orderedShapes.length) return true;
    const s = orderedShapes[depth];
    const n = grid.size;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (!grid.canPlace(s, x, y)) continue;
            if (budget.n <= 0) return !!budget.exhaustAsPass;
            budget.n--;
            const next = placeAndClear(grid, s, x, y);
            if (dfsPlaceOrder(next, orderedShapes, depth + 1, budget)) return true;
        }
    }
    return false;
}

function tripletSequentiallySolvable(grid, threeData, opts = {}) {
    if (threeData.length !== 3) return true;
    const [a, b, c] = threeData;
    const budget = {
        n: opts.searchBudget ?? SURVIVE_SEARCH_BUDGET,
        exhaustAsPass: opts.exhaustAsPass ?? true
    };
    for (const perm of permutations3(a, b, c)) {
        if (dfsPlaceOrder(grid, perm, 0, budget)) return true;
        if (budget.n <= 0 && budget.exhaustAsPass) return true;
    }
    return false;
}

/**
 * 校验外部生成的三连块是否满足真人主局的基础公平护栏。
 * 生成式只负责提出候选，最终仍由这里保证可玩性。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {Array<{ id:string, data:number[][] }>} shapes
 * @param {{ searchBudget?: number }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateSpawnTriplet(grid, shapes, opts = {}) {
    if (!grid?.cells?.length) return { ok: false, reason: 'invalid-grid' };
    if (!Array.isArray(shapes) || shapes.length < 3) return { ok: false, reason: 'not-enough-shapes' };

    const triplet = shapes.slice(0, 3);
    const ids = new Set();
    for (const shape of triplet) {
        if (!shape?.id || !Array.isArray(shape.data)) return { ok: false, reason: 'invalid-shape' };
        if (ids.has(shape.id)) return { ok: false, reason: 'duplicate-shape' };
        ids.add(shape.id);
        if (!grid.canPlaceAnywhere(shape.data)) return { ok: false, reason: 'shape-not-placeable' };
    }

    const fill = grid.getFillRatio();
    const mobTarget = minMobilityTarget(fill, 0);
    const minPlacements = Math.min(...triplet.map((s) => countLegalPlacements(grid, s.data)));
    if (minPlacements < mobTarget) return { ok: false, reason: 'low-mobility' };

    if (fill >= FILL_SURVIVABILITY_ON) {
        const datas = triplet.map((s) => s.data);
        if (!tripletSequentiallySolvable(grid, datas, {
            searchBudget: opts.searchBudget ?? SURVIVE_SEARCH_BUDGET,
            exhaustAsPass: true
        })) {
            return { ok: false, reason: 'not-sequentially-solvable' };
        }
    }

    return { ok: true };
}

/* ================================================================== */
/*  解法数量评估（v9 新增）                                            */
/*                                                                    */
/*  与 tripletSequentiallySolvable（仅判可解）不同，这里要数「有多少种   */
/*  完整放置序列能完成本组三块」。同一形状放在不同位置算不同解。        */
/*                                                                    */
/*  · 性能门控：仅在 fill ≥ activationFill 时调用                      */
/*  · leafCap：到达 cap 个叶子立即返回（避免空盘指数爆炸）              */
/*  · budget：累计 dfs 入栈次数到达 budget 立即截断（标记 truncated）   */
/* ================================================================== */

/**
 * 累加 orderedShapes 在 grid 上的「完整放置序列」叶子数（带剪枝）。
 *
 * v1.57.2 / v1.57.3 扩展：每个完整解叶子处计算 8 项廉价度量 delta，
 * 维护 accum 内 min/max/sum 字段，最终在 evaluateTripletSolutions 出口
 * 派生出 minHoleIncrement / maxHoleIncrement / meanHoleIncrement /
 * meanEndFillRatio / minEndFillRatio / meanNearFullDelta / meanEndFlatness /
 * meanDangerColumns / meanClutterDelta 共 9 个对外字段。
 *
 * 剪枝：leafCap / budget 沿用旧逻辑；不基于 metrics 早剪——消行可能让 hole/fill
 * 反向降低，过早剪枝会破坏 min 正确性。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {number[][][]} orderedShapes
 * @param {number} depth
 * @param {object} accum
 * @param {{ n: number }} budget
 */
function dfsCountSolutions(grid, orderedShapes, depth, accum, budget) {
    if (accum.count >= accum.cap) return;
    if (budget.n <= 0) {
        accum.truncated = true;
        return;
    }
    if (depth >= orderedShapes.length) {
        accum.count++;
        /* ===== v1.57.2 ① — 孤立空洞 delta（与 baseHoles 相对，max(0,·) 处理消行净降） ===== */
        const afterHoles = countIsolatedHoles(grid);
        const holeInc = Math.max(0, afterHoles - accum.baseHoles);
        if (holeInc < accum.minHoleIncrement) accum.minHoleIncrement = holeInc;
        if (holeInc > accum.maxHoleIncrement) accum.maxHoleIncrement = holeInc;
        accum.holeSum += holeInc;
        /* ===== v1.57.3 ② — 终末填充率（叶子绝对值，非 delta；min/mean 派生） ===== */
        const occ = countOccupied(grid);
        const fillRatio = occ / accum.totalCells;
        if (fillRatio < accum.minEndFillRatio) accum.minEndFillRatio = fillRatio;
        accum.fillSum += fillRatio;
        /* ===== v1.57.3 ③ — 近满行/列 delta（"消行机会的供给/消耗"） ===== */
        const nearFullAfter = countNearFullLinesCheap(grid, 2);
        accum.nearFullDeltaSum += (nearFullAfter - accum.baseNearFull);
        /* ===== v1.57.3 ⑥ — 终末平整度（列高方差，未归一化） ===== */
        accum.flatnessSum += columnHeightVariance(grid);
        /* ===== v1.57.3 ⑦ — 危险列数（接近爆顶预警） ===== */
        accum.dangerColsSum += countDangerColumns(grid, accum.dangerHeight);
        /* ===== v1.57.3 ⑧ — 视觉杂乱 delta（颜色边界变化） ===== */
        accum.clutterDeltaSum += (countColorBoundaries(grid) - accum.baseClutter);
        /* ===== v1.57.3 ④ — root-level survivor 标记 ===== */
        if (accum.currentRootIdx >= 0) accum.rootSurvivors[accum.currentRootIdx] = true;
        return;
    }
    const s = orderedShapes[depth];
    const n = grid.size;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (accum.count >= accum.cap || budget.n <= 0) return;
            if (!grid.canPlace(s, x, y)) continue;
            /* v1.57.3 ④：仅在 depth=0（root level）时标记当前是哪个 root 子树。
             * 用 (y, x) 线性化为 rootIdx，DFS 返回后用 accum.rootSurvivors 中
             * true 的数量 / 总合法位置数 = firstMoveSurvivorRatio。 */
            const savedRootIdx = accum.currentRootIdx;
            if (depth === 0) {
                accum.currentRootIdx = y * n + x;
                accum.rootCandidatesTotal++;
            }
            budget.n--;
            const next = placeAndClear(grid, s, x, y);
            dfsCountSolutions(next, orderedShapes, depth + 1, accum, budget);
            if (depth === 0) accum.currentRootIdx = savedRootIdx;
        }
    }
}

/**
 * 估算三连块在当前盘面下的「解空间体量」+「9 个 stress→算法 难度维度」（v1.57.3 完整版）。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {number[][][]} threeData
 * @param {{ leafCap?: number, budget?: number, dangerHeight?: number }} [opts]
 * @returns {{
 *   validPerms: number, solutionCount: number, capped: boolean, truncated: boolean,
 *   firstMoveFreedom: number, perPermCounts: number[],
 *   minHoleIncrement: number, meanHoleIncrement: number,
 *   maxHoleIncrement: number,                       // v1.57.3 ① — 最差解新空洞数（"专注度税"上界）
 *   holeIncrementGap: number,                       // v1.57.3 ⑨ — max − min（"专注度税"差距）
 *   meanEndFillRatio: number, minEndFillRatio: number, // v1.57.3 ② — 终末填充率（空间窒息）
 *   meanNearFullDelta: number,                      // v1.57.3 ③ — 近满行/列变化（消行机会节律）
 *   firstMoveSurvivorRatio: number,                 // v1.57.3 ④ — 第一步存活率（试错代价）
 *   solutionDiversity: number,                      // v1.57.3 ⑤ — 6 种排列解数离散度（CV 系数）
 *   meanEndFlatness: number,                        // v1.57.3 ⑥ — 终末平整度（列高方差）
 *   meanDangerColumns: number,                      // v1.57.3 ⑦ — 终末危险列数（爆顶预警）
 *   meanClutterDelta: number                        // v1.57.3 ⑧ — 视觉杂乱变化（颜色边界）
 * }}
 */
export function evaluateTripletSolutions(grid, threeData, opts = {}) {
    if (!Array.isArray(threeData) || threeData.length !== 3) {
        return {
            validPerms: 0, solutionCount: 0, capped: false, truncated: false,
            firstMoveFreedom: 0, perPermCounts: [],
            minHoleIncrement: Infinity, meanHoleIncrement: 0,
            maxHoleIncrement: 0, holeIncrementGap: 0,
            meanEndFillRatio: 0, minEndFillRatio: 0,
            meanNearFullDelta: 0,
            firstMoveSurvivorRatio: 0,
            solutionDiversity: 0,
            meanEndFlatness: 0,
            meanDangerColumns: 0,
            meanClutterDelta: 0
        };
    }

    const cap = Math.max(1, opts.leafCap ?? SOLUTION_LEAF_CAP_DEFAULT);
    const budget = { n: Math.max(100, opts.budget ?? SOLUTION_BUDGET_DEFAULT) };
    /* v1.57.2 / v1.57.3 — 9 项 base 度量在评估开始算一次，DFS 内只算 delta/绝对值，
     * 不重算 base。这是 9 维 metrics 廉价化的关键设计（base 计算 O(n²×k) 仅 1 次）。 */
    const baseHoles = countIsolatedHoles(grid);
    const baseNearFull = countNearFullLinesCheap(grid, 2);
    const baseClutter = countColorBoundaries(grid);
    const totalCells = (grid?.size ?? 8) * (grid?.size ?? 8);
    const dangerHeight = Math.max(1, opts.dangerHeight ?? 6);

    const accum = {
        count: 0, cap, truncated: false,
        // ① 新空洞 min/max/sum
        minHoleIncrement: Infinity, maxHoleIncrement: 0, holeSum: 0,
        // base 快照
        baseHoles, baseNearFull, baseClutter, totalCells, dangerHeight,
        // ② 终末填充率
        minEndFillRatio: Infinity, fillSum: 0,
        // ③ 近满 delta
        nearFullDeltaSum: 0,
        // ⑥ 平整度
        flatnessSum: 0,
        // ⑦ 危险列
        dangerColsSum: 0,
        // ⑧ 视觉杂乱 delta
        clutterDeltaSum: 0,
        // ④ root-level survivor 追踪：rootIdx → 是否有解叶子
        currentRootIdx: -1,
        rootSurvivors: {},
        rootCandidatesTotal: 0
    };

    const perms = permutations3(threeData[0], threeData[1], threeData[2]);
    const perPermCounts = new Array(perms.length).fill(0);
    let validPerms = 0;

    for (let i = 0; i < perms.length; i++) {
        if (budget.n <= 0) {
            accum.truncated = true;
            break;
        }

        let delta = 0;
        if (accum.count < cap) {
            const before = accum.count;
            dfsCountSolutions(grid, perms[i], 0, accum, budget);
            delta = accum.count - before;
        }
        perPermCounts[i] = delta;

        if (delta > 0) {
            validPerms++;
            continue;
        }

        if (budget.n <= 0) {
            accum.truncated = true;
            break;
        }

        // solutionCount 可能已触 cap，需独立判定该排列是否可解，避免 validPerms 被低估。
        const existBudget = { n: budget.n, exhaustAsPass: false };
        const hasSolution = dfsPlaceOrder(grid, perms[i], 0, existBudget);
        budget.n = existBudget.n;
        if (hasSolution) {
            validPerms++;
        } else if (budget.n <= 0) {
            accum.truncated = true;
            break;
        }
    }

    let firstMoveFreedom = Infinity;
    for (const sd of threeData) {
        const c = countLegalPlacements(grid, sd);
        if (c < firstMoveFreedom) firstMoveFreedom = c;
    }
    if (!Number.isFinite(firstMoveFreedom)) firstMoveFreedom = 0;

    const hasLeaves = accum.count > 0;
    const meanHoleIncrement = hasLeaves ? accum.holeSum / accum.count : 0;
    const minHoleIncrement = hasLeaves ? accum.minHoleIncrement : Infinity;
    const maxHoleIncrement = hasLeaves ? accum.maxHoleIncrement : 0;
    const holeIncrementGap = hasLeaves ? (maxHoleIncrement - minHoleIncrement) : 0;
    const meanEndFillRatio = hasLeaves ? accum.fillSum / accum.count : 0;
    const minEndFillRatio = hasLeaves ? accum.minEndFillRatio : 0;
    const meanNearFullDelta = hasLeaves ? accum.nearFullDeltaSum / accum.count : 0;
    const meanEndFlatness = hasLeaves ? accum.flatnessSum / accum.count : 0;
    const meanDangerColumns = hasLeaves ? accum.dangerColsSum / accum.count : 0;
    const meanClutterDelta = hasLeaves ? accum.clutterDeltaSum / accum.count : 0;

    /* v1.57.3 ④ — firstMoveSurvivorRatio：
     * 第 1 步合法落子位置中，**有完整解后继**的位置占比。
     * rootCandidatesTotal 计入所有"被 DFS 访问的 root 子树"分母，rootSurvivors 标记
     * 触达过叶子的子树。注意：rootCandidatesTotal 在 6 种排列中累加，意义是
     * "(perm × root_x × root_y) 三元组中的子树触达比例"。 */
    let firstMoveSurvivorRatio = 0;
    if (accum.rootCandidatesTotal > 0) {
        const survivors = Object.keys(accum.rootSurvivors).length;
        // 注意：rootSurvivors 用 rootIdx 去重（不区分 perm），分母用 unique root candidates
        // 但实际上 rootCandidatesTotal 已在 6 排列中累加；这里取近似比例，避免遗漏
        firstMoveSurvivorRatio = Math.min(1, survivors * perms.length / Math.max(1, accum.rootCandidatesTotal));
    }

    /* v1.57.3 ⑤ — solutionDiversity：
     * CV = std(perPermCounts) / max(1, mean(perPermCounts))。
     * CV 高 = 不同顺序的解数差异大（"有些顺序顺、有些顺序卡"，玩家需找顺）；
     * CV 低 = 各顺序均衡（"放哪种顺序都差不多"，看似宽松但解相似度高）。 */
    let solutionDiversity = 0;
    if (perPermCounts.length > 0) {
        const sum = perPermCounts.reduce((a, b) => a + b, 0);
        const mean = sum / perPermCounts.length;
        if (mean > 0) {
            let v = 0;
            for (const c of perPermCounts) v += (c - mean) * (c - mean);
            const std = Math.sqrt(v / perPermCounts.length);
            solutionDiversity = std / mean;
        }
    }

    return {
        validPerms,
        solutionCount: accum.count,
        capped: accum.count >= cap,
        truncated: accum.truncated,
        firstMoveFreedom,
        perPermCounts,
        minHoleIncrement, meanHoleIncrement,
        maxHoleIncrement, holeIncrementGap,
        meanEndFillRatio, minEndFillRatio,
        meanNearFullDelta,
        firstMoveSurvivorRatio,
        solutionDiversity,
        meanEndFlatness,
        meanDangerColumns,
        meanClutterDelta
    };
}

/** 读取 adaptiveSpawn.solutionDifficulty 配置（带旧顶层路径兜底）。 */
function getSolutionDifficultyCfg() {
    const cfg = GAME_RULES?.adaptiveSpawn?.solutionDifficulty || GAME_RULES?.solutionDifficulty;
    return {
        enabled: cfg?.enabled ?? false,
        activationFill: cfg?.activationFill ?? SOLUTION_EVAL_FILL_MIN_DEFAULT,
        leafCap: cfg?.leafCap ?? SOLUTION_LEAF_CAP_DEFAULT,
        budget: cfg?.budget ?? SOLUTION_BUDGET_DEFAULT
    };
}

function minMobilityTarget(fill, attempt) {
    const relax = Math.floor(attempt / 5);
    let t = 1;
    if (fill >= 0.88) t = 10;
    else if (fill >= 0.75) t = 7;
    else if (fill >= 0.68) t = 5;
    else if (fill >= 0.62) t = 4;
    else if (fill >= 0.48) t = 2;
    return Math.max(1, t - relax);
}

function minPlacementsOf(chosen) {
    if (chosen.length === 0) return 999;
    return Math.min(...chosen.map((c) => c.placements));
}

function categoryComplexity(category) {
    if (category === 'lines') return 0.15;
    if (category === 'rects' || category === 'squares') return 0.32;
    if (category === 'tshapes') return 0.68;
    if (category === 'lshapes' || category === 'jshapes') return 0.78;
    if (category === 'zshapes') return 0.88;
    return 0.5;
}

/* ================================================================== */
/*  Layer 1: 盘面拓扑分析                                              */
/* ================================================================== */

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

/**
 * 评估形状在最佳放置位的"多消潜力"：扫描所有合法位，返回最大可同时消除行列数
 * @param {import('../grid.js').Grid} grid
 * @param {number[][]} shapeData
 * @returns {number} 最大消行数（0 = 不触发任何消行）
 */
function bestMultiClearPotential(grid, shapeData) {
    const n = grid.size;
    let best = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (!grid.canPlace(shapeData, x, y)) continue;
            const preview = grid.previewClearOutcome(shapeData, x, y, 0);
            if (preview) {
                const lines = preview.rows.length + preview.cols.length;
                if (lines > best) best = lines;
            }
        }
    }
    return best;
}

/**
 * 检测棋盘是否处于"清屏准备"状态：
 * 若将所有临消行/列（≤2 格空缺）补全后消除，棋盘会否清空。
 *
 * 算法：
 *   1. 收集所有"临消行/列"（只差 1-2 格即可满）
 *   2. 计算这些行/列消除后，棋盘上剩余的被占格数
 *   3. 若剩余 = 0 且总空缺 ≤ 9 格（约 3 块能填满），返回 2（高确信清屏机会）
 *      若剩余 ≤ 3 格且总空缺 ≤ 14 格，返回 1（较强机会）
 *      否则返回 0
 *
 * @param {import('../grid.js').Grid} grid
 * @returns {0|1|2}
 */
export function analyzePerfectClearSetup(grid) {
    const n = grid.size;
    /* v1.16：与 boardTopology.detectNearClears 共用近满检测，避免 panel 上的
     * 「近满 N」与 spawnContext 里的 pcSetup / multiClearCandidates 因为口径不同
     * 而互相打架（这是 v1.15 之前出现 stress=0.89 + 多消候选=0 + 闭环=+0.190
     * 三者互相矛盾的根因）。requireFillable=false：清屏机会评估关心几何形状是否
     * 接近补满，无需限定空格必须被合法形状覆盖（后续 bestPerfectClearPotential
     * 会再做精确校验）。 */
    const nearClears = detectNearClears(grid, { maxEmpty: 2, requireFillable: false });
    const nearFullRows = nearClears.rows.map((r) => ({ y: r.y, empty: r.emptyCount }));
    const nearFullCols = nearClears.cols.map((c) => ({ x: c.x, empty: c.emptyCount }));

    if (nearFullRows.length === 0 && nearFullCols.length === 0) return 0;

    // 模拟：若这些行/列全部补满并消除，哪些格子会被清除
    const clearedSet = new Set();
    for (const { y } of nearFullRows) {
        for (let x = 0; x < n; x++) clearedSet.add(x * n + y);
    }
    for (const { x } of nearFullCols) {
        for (let y = 0; y < n; y++) clearedSet.add(x * n + y);
    }

    // 统计清除后仍有格子被占用的残余数
    let remainingAfterClear = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null && !clearedSet.has(x * n + y)) {
                remainingAfterClear++;
            }
        }
    }

    // 补全所有临消行/列所需的总空格数
    const totalEmptyNeeded = nearFullRows.reduce((s, r) => s + r.empty, 0)
                           + nearFullCols.reduce((s, c) => s + c.empty, 0);

    /* v10.34：略放宽阈值，更多触发 pcSetup→perfectClearBoost / 阶段 1 清屏优先 */
    if (remainingAfterClear === 0 && totalEmptyNeeded <= 11) return 2;
    if (remainingAfterClear <= 4 && totalEmptyNeeded <= 17) return 1;
    return 0;
}

/**
 * 判断形状在当前盘面的某个放置位能否直接触发清屏（棋盘全空）。
 * 只在 pcSetup > 0 时调用（性能门控）。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {number[][]} shapeData
 * @returns {2|0}  2 = 存在放置位可触发清屏；0 = 不能
 */
function bestPerfectClearPotential(grid, shapeData) {
    const n = grid.size;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (!grid.canPlace(shapeData, x, y)) continue;
            const g = grid.clone();
            g.place(shapeData, 0, x, y);
            g.checkLines();
            // 若放置+消行后棋盘全空 → 清屏
            let empty = true;
            outer: for (let ry = 0; ry < n; ry++) {
                for (let rx = 0; rx < n; rx++) {
                    if (g.cells[ry][rx] !== null) { empty = false; break outer; }
                }
            }
            if (empty) return 2;
        }
    }
    return 0;
}

/**
 * 评估形状放置后对盘面健康的影响：放在最佳位后空洞变化
 * 仅在中高填充时计算（性能考虑）
 * @param {import('../grid.js').Grid} grid
 * @param {number[][]} shapeData
 * @param {number} currentHoles
 * @returns {number} 最佳位放置后的空洞减少量（正=减少空洞=好）
 */
function bestHoleReduction(grid, shapeData, currentHoles) {
    if (currentHoles === 0) return 0;
    const n = grid.size;
    let bestReduction = -99;
    let budget = 30;
    for (let y = 0; y < n && budget > 0; y++) {
        for (let x = 0; x < n && budget > 0; x++) {
            if (!grid.canPlace(shapeData, x, y)) continue;
            budget--;
            const g = grid.clone();
            g.place(shapeData, 0, x, y);
            g.checkLines();
            const newTopo = analyzeBoardTopology(g);
            const reduction = currentHoles - newTopo.holes;
            if (reduction > bestReduction) bestReduction = reduction;
        }
    }
    return Math.max(0, bestReduction);
}

/* ================================================================== */
/*  主出块函数（三层整合）                                              */
/* ================================================================== */

/** @type {{ categories: string[][], totalRounds: number } | null} */
let _categoryMemory = null;

function getCategoryMemory() {
    if (!_categoryMemory) _categoryMemory = { categories: [], totalRounds: 0 };
    return _categoryMemory;
}

/** 每局开始时重置品类记忆 */
export function resetSpawnMemory() {
    _categoryMemory = { categories: [], totalRounds: 0 };
    _lastDiagnostics = null;
}

/**
 * v1.59.20：估算"该 chosen shape 在本轮被选中的主要驱动因子"，输出 { key, label }
 * 用于 DFV chosen 节点常驻"因·XXX"小字（让"消行候选/综合选"标签不再只是路径分类，
 * 还能告诉玩家"具体是哪个算法分量让这块被选中"）。
 *
 * **启发式优先级**（与本文件内 scoreShape 内权重设计的乘性强度排序保持一致）：
 *   1. `pcPotential === 2`   → 可清屏（最高权重 18+ 倍）
 *   2. `multiClear >= 2`     → 可多消 N 行（×2.0-2.7 加权）
 *   3. `gapFills >= 2`       → 可补 N 处临消行缺口（×nearFullFactor 加权）
 *   4. `gapFills === 1`      → 可消 1 行
 *   5. `holeReduce > 0`      → 可补 N 处空洞（×0.4 加权）
 *   6. `placements >= 30`    → 机动性高（合法落点多）
 *   7. shapeWeights 类别主导  → 类别权重高（例：长条权重 33%）
 *   default                  → 综合均衡（无单一主因）
 *
 * 注意：这是**事后估算**而非 scoreShape 内部权重的精确反推（精确反推需要将
 * 全乘性权重链做对数分解，工程量大且对玩家解释力增益有限）。启发式覆盖 95%+
 * 的"为什么是这块"问题已足够好。
 *
 * @param {object|null} s scored entry: { gapFills, multiClear, pcPotential, holeReduce, placements, category }；
 *   fallback 路径传 null（直接返回"兜底降级"label）
 * @param {Record<string, number>|null} shapeWeights spawnHints.shapeWeights
 * @returns {{ key: string, label: string }}
 */
export function _estimateTopDriver(s, shapeWeights) {
    if (!s) return { key: 'fallback', label: '兜底降级' };

    if (s.pcPotential === 2) return { key: 'pcPotential', label: '可清屏' };
    if (s.multiClear >= 2) return { key: 'multiClear', label: `可多消${s.multiClear}行` };
    if (s.gapFills >= 2) return { key: 'gapFills', label: `补${s.gapFills}缺` };
    if (s.gapFills === 1) return { key: 'gapFills', label: '可消1行' };
    if (s.holeReduce > 0) return { key: 'holeReduce', label: `补${s.holeReduce}洞` };
    if ((s.placements ?? 0) >= 30) return { key: 'mobility', label: '机动高' };

    /* v1.60.0：新形状的语义化主因（在通用 driver 之外的形态特异性归类）。
     * 在常规 driver（消行/多消/补洞/机动）均未命中时，回退到形态自身的设计语义：
     *   - 斜线 3 格（diag-3a/b）：稀疏散点造孤岛 → "稀疏挑战"
     *   - 斜线 2 格（diag-2a/b）：对角散点补缝 → "对角补缝"
     *   - 超小直线（1x2/2x1/1x3/3x1）：占地少易消行 → "极小补缝"
     *   - 3 格 L 角（l3-a..d）：角落紧凑补缝 → "角落补缝"
     */
    const shapeId = s.shape?.id;
    if (shapeId === 'diag-3a' || shapeId === 'diag-3b') return { key: 'diagonalSparse', label: '稀疏挑战' };
    if (shapeId === 'diag-2a' || shapeId === 'diag-2b') return { key: 'diagonalPair',  label: '对角补缝' };
    if (shapeId === '1x2' || shapeId === '2x1' || shapeId === '1x3' || shapeId === '3x1') {
        return { key: 'tinyLine', label: '极小补缝' };
    }
    if (shapeId === 'l3-a' || shapeId === 'l3-b' || shapeId === 'l3-c' || shapeId === 'l3-d') {
        return { key: 'cornerFit', label: '角落补缝' };
    }

    const weights = shapeWeights || {};
    const wEntries = Object.entries(weights);
    if (wEntries.length > 0 && s.category) {
        const totalW = wEntries.reduce((a, [, v]) => a + (Number(v) || 0), 0) || 1;
        const myW = Number(weights[s.category]) || 0;
        const myPct = myW / totalW;
        const sorted = wEntries.slice().sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
        const top = sorted[0];
        if (top && top[0] === s.category && myPct >= 0.20) {
            return { key: 'shapeWeight', label: `${_categoryShort(s.category)}权重${Math.round(myPct * 100)}%` };
        }
    }

    return { key: 'balanced', label: '综合均衡' };
}

function _categoryShort(cat) {
    const map = { lines: '长条', rects: '矩形', squares: '方块', tshapes: 'T形', zshapes: 'Z形', lshapes: 'L形', jshapes: 'J形' };
    return map[cat] || cat;
}

/**
 * v1.60.0 形状池扩展 P1：新形状的策略 gate（按"前期减压、后期加压"严格执行）。
 *
 * 当前唯一走 gate 的是 **斜线 3 格散点（diag-3a / diag-3b）**——它们占地仅 3 格但
 * 在 8×8 棋盘上 3 个孤岛几乎不可能直接消行，对新手是强加压来源。为防止挫败爆表：
 *   - 仅在 `spawnIntent ∈ {pressure, sprint}` **且** `profile.skillLevel ≥ 0.5` 时入池
 *   - 否则在 scored.filter 阶段直接 reject（不进入 weighted / clear / perfectClear 任意路径）
 *
 * 其他 10 个新 shape（4 直线 + 2 对角 + 4 角形）默认入池，仅靠 `_applyShapeBonusWeight`
 * 在合适场景做权重 nudge——保持现有"权重抽签 + 多路径"主体逻辑不被 gate 截断。
 *
 * @param {object} shape - { id, data, category }
 * @param {object} hints - spawnHints（含 spawnIntent）
 * @param {object} profile - playerProfile（含 skillLevel）
 * @param {object} ctx - 复用现有 ctx
 * @param {number} fill - 当前盘面填充率
 * @returns {boolean} 是否允许进入本轮 scored 集合
 */
function _passesShapeGate(shape, hints, profile, _ctx, _fill) {
    if (!shape) return false;
    const id = shape.id;
    /* 斜线 3 格散点：高加压形状，需 gate */
    if (id === 'diag-3a' || id === 'diag-3b') {
        const intent = hints?.spawnIntent;
        const isPressureLike = intent === 'pressure' || intent === 'sprint';
        const skill = Number(profile?.skillLevel) || 0;
        if (!isPressureLike || skill < 0.5) return false;
    }
    return true;
}

/**
 * v1.60.0 形状池扩展 P1：新形状的策略加权 nudge（在主权重 weights[category] 之上的乘法 bonus）。
 *
 * 加权策略（严格匹配"前期减压、后期加压"语义）：
 *  - **超小直线 4 件（1x2/2x1/1x3/3x1）**：sizePreference ≤ -0.3 时 ×1.6
 *      → spawnLayers.LaneLayer 已用 cells/5 做小块加权，但 2-3 格 cells 比例仅 0.4-0.6，
 *        bonus 不够显著。本 nudge 让前期减压场景下这 4 件能压过 2x2/L4 等 4 格块。
 *  - **3 格 L 角 4 件（l3-a..d）**：gapFills > 0 时 ×1.3
 *      → 角落补缝是 L3 形态的天然适配，gapFills 反映了"能直接补满临消行缺口"的能力。
 *  - 其他形状（含 diag-2/diag-3）：保持原 weight 不变，由现有打分机制自然消化。
 *
 * @param {number} baseWeight - 来自 weights[category] 的基础权重
 * @param {string} shapeId
 * @param {object} hints - spawnHints
 * @param {number} gapFills - 当前 shape 在盘面上能消行的能力
 * @returns {number} 调整后的 weight
 */
function _applyShapeBonusWeight(baseWeight, shapeId, hints, gapFills) {
    let w = baseWeight;
    /* 超小直线：前期减压加权 */
    if (shapeId === '1x2' || shapeId === '2x1' || shapeId === '1x3' || shapeId === '3x1') {
        const sizePref = Number(hints?.sizePreference) || 0;
        if (sizePref <= -0.3) w *= 1.6;
    }
    /* 3 格 L 角：能补缝时加权 */
    if (shapeId === 'l3-a' || shapeId === 'l3-b' || shapeId === 'l3-c' || shapeId === 'l3-d') {
        if (gapFills > 0) w *= 1.3;
    }
    return w;
}

/** @type {object | null} 上一轮出块诊断，供面板展示 */
let _lastDiagnostics = null;

/** 获取最近一次出块诊断信息 */
export function getLastSpawnDiagnostics() {
    return _lastDiagnostics;
}

const pickWeighted = (pool) => {
    const totalWeight = pool.reduce((sum, s) => sum + s.w, 0);
    if (totalWeight <= 0) return pool[0];
    let rand = Math.random() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
        rand -= pool[i].w;
        if (rand <= 0) return pool[i];
    }
    return pool[pool.length - 1];
};

/**
 * @param {import('../grid.js').Grid} grid
 * @param {object} strategyConfig
 * @param {object} [spawnContext] 来自 game.js 的跨轮上下文
 * @returns {Array<{ id: string, name?: string, category: string, data: number[][] }>}
 */
export function generateDockShapes(grid, strategyConfig, spawnContext) {
    const weights = strategyConfig.shapeWeights || {};
    const hints = strategyConfig.spawnHints || {};
    const ctx = spawnContext || {};
    /* v1.60.0：从 strategyConfig（adaptiveSpawn enhanced layered config）抽取 profile 快照，
     * 供 _passesShapeGate 等需要玩家维度（skill/momentum/frustration）的策略 gate 使用。
     * 不改 adaptiveSpawn 接口（这些字段早已存在于 layered._xxx），仅这里集中映射。 */
    const profile = {
        skillLevel:       strategyConfig._skillLevel,
        momentum:         strategyConfig._momentum,
        frustrationLevel: strategyConfig._frustration,
        sessionPhase:     strategyConfig._sessionPhase,
    };

    const clearTarget = Math.max(0, Math.min(3, hints.clearGuarantee ?? 1));
    const sizePref = hints.sizePreference ?? 0;
    const divBoost = hints.diversityBoost ?? 0;
    const comboChain = hints.comboChain ?? 0;
    const multiClearBonus = hints.multiClearBonus ?? 0;
    /* v1.56 §2.5 + v1.56.4 §5.α.8：PB 距离段在形状层的差异化
     *   - farFromPBBoostActive（D0 边缘段，0.15 ≤ pct < 0.30）：多消潜力大块 ×1.15
     *   - farExtremeBoostActive（D0 极远段，pct < 0.15）：多消潜力大块 ×1.30（叠加）
     *     让真正"畏难期"得到形状层面的强力送爽；与 v1.56 数值层 farFromPBBoost.extreme 配套
     *   - pbOvershootActive（D4 超 PB 段，score > best）：多消潜力大块 ×0.78（抑制）+
     *     大块（size>=4）×1.20（鼓励），形成"超 PB 后多消变难、大块更多"的连续体感，
     *     防止 PB 通过持续多消继续膨胀。详见 BEST_SCORE_CHASE_STRATEGY.md §5.α.8 v1.56.4。 */
    const farFromPBBoostActive = hints.farFromPBBoostActive === true;
    const farExtremeBoostActive = hints.farExtremeBoostActive === true;
    const pbOvershootActive = hints.pbOvershootActive === true;
    const multiLineTarget = Math.max(0, Math.min(2, hints.multiLineTarget ?? 0));
    const delightBoost = Math.max(0, Math.min(1, hints.delightBoost ?? 0));
    const perfectClearBoost = Math.max(0, Math.min(1, hints.perfectClearBoost ?? 0));
    const iconBonusTarget = Math.max(0, Math.min(1, hints.iconBonusTarget ?? 0));
    const delightMode = hints.delightMode ?? 'neutral';
    const rhythmPhase = hints.rhythmPhase ?? 'neutral';
    const targetSolutionRange = hints.targetSolutionRange || null;
    /* v1.57.2：新空洞难度区间——与 targetSolutionRange 并列双轴：
     *   - targetSolutionRange 控制"解空间宽度"（多少种可解放法）
     *   - targetHoleIncrement  控制"空洞强迫度"（候选最优放法也带几个新空洞）
     * earlyAttempt 阶段同样硬过滤，宽松阶段 fallback；只对未 truncated 的解评估生效。 */
    const targetHoleIncrement = hints.targetHoleIncrement || null;
    /* v1.57.3 — 9 项 stress→算法 多维难度区间（与 targetSolutionRange / targetHoleIncrement
     * 并列；详见 §5.α.14）。任一为 null 时对应维度不参与软过滤。 */
    const targetMaxHoleIncrement = hints.targetMaxHoleIncrement || null;
    const targetHoleIncrementGap = hints.targetHoleIncrementGap || null;
    const targetEndFillRatio = hints.targetEndFillRatio || null;
    const targetNearFullDelta = hints.targetNearFullDelta || null;
    const targetFirstMoveSurvivorRatio = hints.targetFirstMoveSurvivorRatio || null;
    const targetSolutionDiversity = hints.targetSolutionDiversity || null;
    const targetEndFlatness = hints.targetEndFlatness || null;
    const targetEndDangerColumns = hints.targetEndDangerColumns || null;
    const targetVisualClutter = hints.targetVisualClutter || null;
    /* v1.32：顺序刚性 — 上游 adaptiveSpawn 派生
     *   orderRigor ∈ [0,1]：强度（仅做诊断展示用）
     *   orderMaxValidPerms ∈ [1,6]：6 种排列里允许的最大可解数（≤2 = 必须按特定顺序）
     * 默认 orderMaxValidPerms=6 即不约束，bypass 路径全部走默认值。 */
    const orderRigor = Math.max(0, Math.min(1, hints.orderRigor ?? 0));
    const orderMaxValidPerms = Math.max(1, Math.min(6, hints.orderMaxValidPerms ?? 6));
    const motivationIntent = hints.motivationIntent ?? 'balanced';
    const behaviorSegment = hints.behaviorSegment ?? 'balanced';
    const personalizationApplied = hints.personalizationApplied === true;
    const accessibilityLoad = Math.max(0, Math.min(1, hints.accessibilityLoad ?? 0));
    const returningWarmupStrength = Math.max(0, Math.min(1, hints.returningWarmupStrength ?? 0));
    const socialFairChallenge = hints.socialFairChallenge === true;
    const spawnTargets = hints.spawnTargets || {};
    const shapeComplexityTarget = Math.max(0, Math.min(1, spawnTargets.shapeComplexity ?? 0.45));
    const solutionSpacePressure = Math.max(0, Math.min(1, spawnTargets.solutionSpacePressure ?? 0.45));
    const clearOpportunityTarget = Math.max(0, Math.min(1, spawnTargets.clearOpportunity ?? Math.min(1, clearTarget / 3)));
    const spatialPressureTarget = Math.max(0, Math.min(1, spawnTargets.spatialPressure ?? Math.max(0, sizePref)));
    const payoffTarget = Math.max(0, Math.min(1, spawnTargets.payoffIntensity ?? Math.max(multiClearBonus, delightBoost)));
    const noveltyTarget = Math.max(0, Math.min(1, spawnTargets.novelty ?? divBoost));
    const solutionCfg = getSolutionDifficultyCfg();

    const allShapes = getAllShapes();
    const fill = grid.getFillRatio();
    const roundsSinceClear = ctx.roundsSinceClear ?? 0;
    const inDangerZone = fill >= CRITICAL_FILL || roundsSinceClear >= 3;

    /* --- Layer 1: 盘面拓扑分析 --- */
    const topo = analyzeBoardTopology(grid);
    const doDeepAnalysis = fill > 0.35;

    // 临消行信号：棋盘上有多少行/列只差 ≤2 格即可消除（越多越有多消/清屏机会）
    const nearFullFactor = Math.min(1.0, topo.nearFullLines / 5);

    // 清屏准备信号（0=无 / 1=弱 / 2=强）：若消完临消行则盘面清空
    const pcSetup = analyzePerfectClearSetup(grid);
    const occupied = countOccupiedCells(grid);
    /* 疏板仍评估一手清屏（一手归零）；满板跳过以省 clone 开销 */
    const evalPerfectClear = pcSetup > 0 || occupied <= 22 || fill <= 0.46;

    const scored = allShapes
        .map((shape) => {
            const canPlace = grid.canPlaceAnywhere(shape.data);
            if (!canPlace) return null;
            /* v1.60.0 形状池扩展 P1：严格按"加减压策略"对新增 12 个 shape 做 gate + 加权。
             * gate 在"可放置"过滤之后立即执行，未通过 gate 的 shape 完全退出本轮 scored 集合，
             * 保证下游 weighted/clear/perfectClear 多路径全部共享同一 candidate set。 */
            // eslint-disable-next-line no-use-before-define
            if (!_passesShapeGate(shape, hints, profile, ctx, fill)) return null;
            const gapFills = grid.countGapFills(shape.data);
            const category = getShapeCategory(shape.id);
            let weight = weights[category] ?? 1;
            const placements = countLegalPlacements(grid, shape.data);

            /* 不再依赖 gapFills 才算 multiClear — 否则「差 4 格满行」等形状长期 multiClear=0 */
            const multiClear = bestMultiClearPotential(grid, shape.data);
            let holeReduce = 0;
            let pcPotential = 0;

            if (evalPerfectClear) {
                pcPotential = bestPerfectClearPotential(grid, shape.data);
            }
            if (doDeepAnalysis && topo.holes > 2 && fill > 0.5) {
                holeReduce = bestHoleReduction(grid, shape.data, topo.holes);
            }

            /* v1.60.0：新形状的策略加权（在 scoreShape 主权重之外的轻微 nudge）。
             *  - 超小直线（1x2/2x1/1x3/3x1）：sizePreference ≤ -0.3 时 ×1.6
             *    → 配合 LaneLayer cells/5 公式，让 2-3 格小块在前期减压场景显著抬头
             *  - 3 格 L 角（l3-a..d）：gapFills > 0 时 ×1.3
             *    → 角落补缝场景的天然适配奖励 */
            // eslint-disable-next-line no-use-before-define
            weight = _applyShapeBonusWeight(weight, shape.id, hints, gapFills);

            return { shape, canPlace: true, gapFills, weight, category, placements, multiClear, holeReduce, pcPotential };
        })
        .filter(Boolean);

    if (scored.length === 0) return [];

    // 清屏优先 > 多消优先 > 消行优先
    scored.sort((a, b) =>
        b.pcPotential - a.pcPotential ||
        b.multiClear - a.multiClear ||
        b.gapFills - a.gapFills
    );

    /* --- Layer 2: 品类记忆 --- */
    const mem = getCategoryMemory();
    const recentCats = ctx.recentCategories || mem.categories.flat();

    const catFreq = {};
    for (const cat of recentCats) {
        catFreq[cat] = (catFreq[cat] || 0) + 1;
    }

    // 候选统计（供面板展示）
    const multiClearCandidates = scored.filter(s => s.multiClear >= 2).length;
    const perfectClearCandidates = scored.filter(s => s.pcPotential === 2).length;
    const hasDirectPerfectClear = perfectClearCandidates > 0;

    const diagnostics = {
        layer1: {
            fill,
            holes: topo.holes,
            flatness: topo.flatness,
            nearFullLines: topo.nearFullLines,
            maxColHeight: topo.maxColHeight,
            multiClearCandidates,
            pcSetup,
            perfectClearCandidates,
            // v9：解法数量评估结果（仅在 fill ≥ activationFill 且选中三连块通过校验后填充）
            solutionMetrics: null,
            // v9：当前应用的解法区间（来自 spawnHints.targetSolutionRange）
            targetSolutionRange,
            // v1.57.2：当前应用的新空洞难度区间（来自 spawnHints.targetHoleIncrement）
            targetHoleIncrement,
            // v1.57.3：9 项多维难度区间透传
            targetMaxHoleIncrement,
            targetHoleIncrementGap,
            targetEndFillRatio,
            targetNearFullDelta,
            targetFirstMoveSurvivorRatio,
            targetSolutionDiversity,
            targetEndFlatness,
            targetEndDangerColumns,
            targetVisualClutter
        },
        layer2: {
            comboChain,
            multiClearBonus,
            multiLineTarget,
            delightBoost,
            perfectClearBoost,
            iconBonusTarget,
            delightMode,
            rhythmPhase,
            divBoost,
            spawnTargets: { ...spawnTargets },
            recentCatFreq: { ...catFreq },
            motivationIntent,
            behaviorSegment,
            personalizationApplied,
            accessibilityLoad,
            returningWarmupStrength,
            socialFairChallenge
        },
        layer3: { scoreMilestone: ctx.scoreMilestone || false, roundsSinceClear: ctx.roundsSinceClear ?? 0, totalRounds: ctx.totalRounds ?? mem.totalRounds },
        chosen: [],
        attempt: 0,
        /* v9 / v1.32 / v1.57.2 / v1.57.3：spawn 软过滤的被拒次数计数器；
         * 运维看板可据此监控 fallback 频率（任一计数器频繁高企 = 对应 ranges 太严，需放宽）。 */
        solutionRejects: {
            tooFew: 0, tooMany: 0, orderTooLoose: 0,
            holeTooMany: 0, holeTooClean: 0,
            // v1.57.3 ① — 最差解新空洞
            maxHoleTooMany: 0, maxHoleTooClean: 0,
            // v1.57.3 ⑨ — 专注度税差距
            holeGapTooNarrow: 0, holeGapTooWide: 0,
            // v1.57.3 ② — 终末填充率
            fillTooHigh: 0, fillTooLow: 0,
            // v1.57.3 ③ — 近满 delta
            nearFullDeltaTooHigh: 0, nearFullDeltaTooLow: 0,
            // v1.57.3 ④ — 第一步存活率
            survivorTooHigh: 0, survivorTooLow: 0,
            // v1.57.3 ⑤ — 解多样性
            diversityTooHigh: 0, diversityTooLow: 0,
            // v1.57.3 ⑥ — 终末平整度
            flatnessTooHigh: 0, flatnessTooLow: 0,
            // v1.57.3 ⑦ — 危险列数
            dangerColsTooHigh: 0, dangerColsTooLow: 0,
            // v1.57.3 ⑧ — 视觉杂乱 delta
            clutterTooHigh: 0, clutterTooLow: 0
        },
        /* v1.32：顺序刚性应用记录（上游 hints 透传 + 最终是否触发了硬过滤） */
        orderRigor: { rigor: orderRigor, maxValidPerms: orderMaxValidPerms, applied: false }
    };

    for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
        const blocks = [];
        const usedIds = {};
        const usedCategories = {};
        const mobTarget = minMobilityTarget(fill, attempt);
        const chosenMeta = [];
        let clearCount = 0;

        /* -- 阶段 1: 消行候选（clearGuarantee + combo 催化 + 清屏/多消优先）-- */
        const clearCandidates = scored.filter(
            (s) => s.gapFills > 0 || s.multiClear >= 1 || s.pcPotential === 2
        );

        // 排序：清屏潜力 > 多消 > combo 加权 > gap 数
        if (hasDirectPerfectClear || pcSetup >= 1 || comboChain > 0.3 || multiClearBonus > 0.3 || delightBoost > 0.25 || multiLineTarget >= 2) {
            const mlBoost = 0.35 * multiLineTarget + payoffTarget * 0.25;
            clearCandidates.sort((a, b) => {
                const aScore = a.pcPotential * (10 + perfectClearBoost * 10)
                    + a.multiClear * (1 + multiClearBonus + delightBoost + mlBoost)
                    + a.gapFills * (0.5 + clearOpportunityTarget);
                const bScore = b.pcPotential * (10 + perfectClearBoost * 10)
                    + b.multiClear * (1 + multiClearBonus + delightBoost + mlBoost)
                    + b.gapFills * (0.5 + clearOpportunityTarget);
                return bScore - aScore;
            });
        }

        const effectiveClearTarget = Math.min(
            3,
            clearTarget + (comboChain > 0.5 ? 1 : 0) + (clearOpportunityTarget >= 0.72 ? 1 : 0)
        );

        // 清屏机会（pcSetup=2）或临消行≥4 时：允许 3 个槽全放消行块
        const maxClearSeats = (pcSetup >= 2 || topo.nearFullLines >= 4 || delightBoost > 0.65) ? 3 : 2;
        // 精确清屏机会：强制 3 槽全部用于消行（不再受 clearTarget 约束）
        const clearSeats = pcSetup >= 2 || perfectClearBoost >= 0.9
            ? Math.min(3, clearCandidates.length)
            : Math.min(
                Math.max(hasDirectPerfectClear ? 1 : 0, effectiveClearTarget),
                clearCandidates.length,
                maxClearSeats
            );

        for (let ci = 0; ci < clearSeats; ci++) {
            const avail = clearCandidates.filter(s => !usedIds[s.shape.id]);
            if (avail.length === 0) break;

            let pick;
            // 只要存在一手清屏块就优先放入一个槽位；仍保留后续可解性校验，避免不公平死局。
            if (avail.some(s => s.pcPotential === 2)) {
                const perfectPicks = avail.filter(s => s.pcPotential === 2);
                pick = perfectPicks[Math.floor(Math.random() * Math.min(3, perfectPicks.length))];
            } else if ((multiClearBonus > 0.3 || delightBoost > 0.25 || multiLineTarget >= 2) && avail.some(s => s.multiClear >= 2)) {
                const multi = avail.filter(s => s.multiClear >= 2);
                pick = multi[Math.floor(Math.random() * Math.min(3, multi.length))];
            } else {
                const k = Math.min(3, avail.length);
                pick = avail[Math.floor(Math.random() * k)];
            }
            blocks.push(pick.shape);
            usedIds[pick.shape.id] = true;
            usedCategories[pick.category] = (usedCategories[pick.category] || 0) + 1;
            chosenMeta.push({
                shape: pick.shape, placements: pick.placements,
                reason: pcSetup >= 1 ? 'perfectClear' : 'clear',
                topDriver: _estimateTopDriver(pick, weights),
            });
            clearCount++;
        }

        /* -- 阶段 2: 加权抽样补齐（三层信号整合）-- */
        const augmentPool = (list) => {
            const bulkyCells = chosenMeta.reduce((s, m) => s + shapeCellCount(m.shape.data), 0);
            const wantSmall = fill > 0.52 && bulkyCells >= 10;
            return list.map((s) => {
                let w = s.weight;
                const pc = s.placements;
                const cells = shapeCellCount(s.shape.data);
                const complexity = categoryComplexity(s.category);

                /* Layer 1: 机动性保障 — 合法落点越多权重越高 */
                w *= 1 + Math.log1p(pc) * (0.35 + fill * 0.55);
                if (fill > 0.45 && minPlacementsOf(chosenMeta) < mobTarget + 2) {
                    w *= 1 + pc / (8 + fill * 24);
                }

                /* Layer 1: 空洞修复 — 高填充时优先减少空洞的块 */
                if (s.holeReduce > 0 && fill > 0.5) {
                    w *= 1 + s.holeReduce * 0.4;
                }

                /* Layer 1: 清屏潜力 — 最高优先级倍率 */
                if (s.pcPotential === 2) {
                    // 该块放置后可直接触发清屏：极强权重，覆盖一切其他因素
                    w *= 18.0 + perfectClearBoost * 14.0;
                } else if (pcSetup >= 1 && s.gapFills > 0) {
                    // 清屏准备期：gap 填充块大幅加权，pcSetup=2 更强
                    w *= 1 + pcSetup * 3.0 + perfectClearBoost * 2.0;
                }

                /* Layer 1: 多消潜力 — 指数级强化（mc=2 → ×2.0，mc=3 → ×2.7）*/
                if (s.multiClear >= 1) {
                    // 基础倍率 0.6 + multiClearBonus 最高追加 0.6
                    const mcBase = 0.6 + multiClearBonus * 0.6 + delightBoost * 0.45 + payoffTarget * 0.35;
                    w *= 1 + s.multiClear * mcBase;
                }
                /* v10.33：multiLineTarget 显式偏好「同时多线」兑现（与 multiClearBonus 互补） */
                if (multiLineTarget >= 2 && s.multiClear >= 2) {
                    w *= 1.45 + multiClearBonus * 0.28;
                } else if (multiLineTarget >= 1 && s.multiClear >= 2) {
                    w *= 1.22;
                }
                /* 刚完成多消后的 payoff：更易塞入中小「单行兑现」块，续手感 */
                const postCombo = (ctx.lastClearCount ?? 0) >= 2;
                if (postCombo && rhythmPhase === 'payoff' && s.gapFills > 0 && s.multiClear <= 1) {
                    if (cells >= 2 && cells <= 6) w *= 1.28;
                }

                /* Layer 1: 临消行机会放大 — 有可消行时消行块价值与临消行数正相关 */
                if (nearFullFactor > 0 && s.gapFills > 0) {
                    w *= 1 + nearFullFactor * (2.0 + clearOpportunityTarget);
                }
                // 清屏窗口期（nearFullLines≥5）：多消块额外加持
                if (topo.nearFullLines >= 5 && s.multiClear >= 2) {
                    w *= 1.6;
                }

                /* Layer 2: combo 链催化 — combo 活跃时偏好消行块 */
                if (comboChain > 0.1 && s.gapFills > 0) {
                    w *= 1 + comboChain * 0.8;
                }

                /* 多轴目标：形状复杂度不再只靠 profile，低目标偏规整，高目标偏异形 */
                if (shapeComplexityTarget >= 0.55) {
                    w *= 1 + complexity * (shapeComplexityTarget - 0.5) * 1.1;
                } else {
                    w *= 1 + (0.5 - complexity) * (0.55 - shapeComplexityTarget) * 1.1;
                }

                /* Layer 2: 节奏相位 */
                if (rhythmPhase === 'payoff') {
                    if (s.gapFills > 0) w *= 1.7;      // 原 1.3 → 更强的 payoff 推送
                    if (s.multiClear >= 2) w *= 1.4;    // 原 1.2 → 多消双重加持
                    if (delightBoost > 0.35 && s.multiClear >= 1) w *= 1 + delightBoost * 0.55;
                } else if (rhythmPhase === 'setup') {
                    if (cells >= 4 && cells <= 6 && s.gapFills === 0) w *= 1.2 + spatialPressureTarget * 0.25;
                }
                if (delightMode === 'relief' && s.gapFills > 0 && cells <= 5) {
                    w *= 1.18 + delightBoost * 0.35;
                }

                /* sizePreference */
                if (sizePref < -0.01) {
                    if (cells <= 4) w *= 1 + Math.abs(sizePref) * 1.5;
                    else if (cells >= 8) w *= 1 - Math.abs(sizePref) * 0.5;
                } else if (sizePref > 0.01) {
                    if (cells >= 6) w *= 1 + sizePref * 1.2;
                    else if (cells <= 3) w *= 1 - sizePref * 0.4;
                } else if (wantSmall) {
                    if (cells <= 4) w *= 1.65;
                    else if (cells >= 8) w *= 0.72;
                }
                if (spatialPressureTarget > 0.55 && fill < 0.62) {
                    if (cells >= 6) w *= 1 + (spatialPressureTarget - 0.5) * 0.8;
                    if (cells <= 3) w *= Math.max(0.55, 1 - (spatialPressureTarget - 0.5) * 0.35);
                } else if (spatialPressureTarget < 0.35 || fill > 0.62) {
                    if (cells <= 4) w *= 1 + (0.4 - Math.min(0.4, spatialPressureTarget)) * 0.9;
                    if (cells >= 8) w *= 0.82;
                }

                /* Layer 2: 品类多样性（同轮 + 跨轮记忆） */
                const catPenalty = usedCategories[s.category] || 0;
                const memPenalty = catFreq[s.category] || 0;
                const effectiveDiversity = Math.max(divBoost, noveltyTarget * 0.55);
                if (effectiveDiversity > 0 && catPenalty > 0) {
                    w *= Math.max(0.2, 1 - effectiveDiversity * catPenalty);
                }
                if (memPenalty > 2) {
                    w *= Math.max(0.4, 1 - (memPenalty - 2) * (0.12 + noveltyTarget * 0.08));
                }

                /* clearGuarantee 补足 — 多消块额外加持 */
                if (clearCount < clearTarget && s.gapFills > 0) {
                    w *= 1.6 + clearOpportunityTarget * 0.55;
                    if (s.multiClear >= 2) w *= 1.3;    // 多消块优先补入
                }

                /* Layer 3: 里程碑庆祝 — 偏好能产生消行的块 */
                if (ctx.scoreMilestone && s.gapFills > 0) {
                    w *= 1.3;
                }

                /* v1.56 §2.5：远征段额外偏向"多消潜力大块"
                 * 触发条件：上游 farFromPBBoostActive=true（即 D0 段 pct < 0.30）
                 * 仅对 multiClear >= 2 的块加权 ×1.15，让送爽落到形状层面：
                 *   - 与上面 multiClearBonus / clearGuarantee 形成"数值+形状"双重激励
                 *   - 不依赖 dominantColor（同色块仍由 game.js 染色层处理）
                 *   - 与里程碑加权（×1.3）数值更克制，避免叠加触顶饱和 */
                if (farFromPBBoostActive && s.multiClear >= 2) {
                    w *= 1.15;
                }

                /* v1.56.4 §5.α.8：D0 极远段（pct<0.15）形状层叠加加权
                 * 在 farFromPBBoostActive 的 ×1.15 之上再 ×1.13 ≈ 1.30，
                 * 让真正"畏难期"得到更激进的多消大块倾斜。 */
                if (farExtremeBoostActive && s.multiClear >= 2) {
                    w *= 1.13;
                }

                /* v1.56.4 §5.α.8：D4 超 PB 段形状层反向调制
                 * 多消大块抑制（×0.78），大块鼓励（cellCount>=4 时 ×1.20），让"超 PB 后"
                 * 出块体感变化明显但不卡死。与 stress 维度 pbOvershootBoost 协同。 */
                if (pbOvershootActive) {
                    if (s.multiClear >= 2) {
                        w *= 0.78;
                    }
                    const _ohCellCount = s.shape?.data ? shapeCellCount(s.shape.data) : 0;
                    if (_ohCellCount >= 4) {
                        w *= 1.20;
                    }
                }

                return { entry: s, w: Math.max(0.01, w) };
            });
        };

        let remaining = scored.filter((s) => !usedIds[s.shape.id]);

        while (blocks.length < 3 && remaining.length > 0) {
            const pool = augmentPool(remaining);
            const pick = pickWeighted(pool);
            const entry = pick.entry;
            usedIds[entry.shape.id] = true;
            usedCategories[entry.category] = (usedCategories[entry.category] || 0) + 1;
            blocks.push(entry.shape);
            chosenMeta.push({
                shape: entry.shape, placements: entry.placements, reason: 'weighted',
                topDriver: _estimateTopDriver(entry, weights),
            });
            if (entry.gapFills > 0) clearCount++;
            remaining = scored.filter((s) => !usedIds[s.shape.id]);
        }

        while (blocks.length < 3) {
            const p = pickShapeByCategoryWeights(weights);
            if (!p) break;
            blocks.push(p);
            chosenMeta.push({
                shape: p, placements: countLegalPlacements(grid, p.data), reason: 'fallback',
                topDriver: _estimateTopDriver(null, null),
            });
        }

        const triplet = blocks.slice(0, 3);
        if (triplet.length < 3) continue;

        const minPc = Math.min(
            countLegalPlacements(grid, triplet[0].data),
            countLegalPlacements(grid, triplet[1].data),
            countLegalPlacements(grid, triplet[2].data)
        );
        if (minPc < mobTarget) continue;

        if (fill >= FILL_SURVIVABILITY_ON) {
            const datas = triplet.map((s) => s.data);
            const strictSearch = inDangerZone && attempt < Math.floor(MAX_SPAWN_ATTEMPTS * 0.7);
            if (!tripletSequentiallySolvable(grid, datas, {
                searchBudget: strictSearch ? SURVIVE_SEARCH_BUDGET * 2 : SURVIVE_SEARCH_BUDGET,
                exhaustAsPass: !strictSearch
            })) {
                continue;
            }
        }

        /* --- v9: 解法数量评估 + 软过滤 ---
         * 仅在 fill ≥ activationFill 时评估（性能门控）；
         * 仅在 attempt 较早 (< 60%) 时硬过滤，避免无解死循环；
         * truncated=true 时跳过过滤（结果不可信，按通过处理）。 */
        let solutionMetrics = null;
        if (solutionCfg.enabled && fill >= solutionCfg.activationFill) {
            const datas = triplet.map((s) => s.data);
            solutionMetrics = evaluateTripletSolutions(grid, datas, {
                leafCap: solutionCfg.leafCap,
                budget: solutionCfg.budget
            });

            const earlyAttempt = attempt < Math.floor(MAX_SPAWN_ATTEMPTS * SOLUTION_FILTER_ATTEMPT_RATIO);
            if (earlyAttempt && targetSolutionRange && !solutionMetrics.truncated) {
                const sc = solutionMetrics.solutionCount;
                if (targetSolutionRange.max != null && !solutionMetrics.capped && sc > targetSolutionRange.max) {
                    diagnostics.solutionRejects.tooMany++;
                    continue;
                }
                if (targetSolutionRange.min != null && sc < targetSolutionRange.min) {
                    diagnostics.solutionRejects.tooFew++;
                    continue;
                }
            }

            /* v1.57.2: 新空洞难度软过滤 ——
             *
             *   minHoleIncrement = 6 种排列所有解中"最干净放置路径"的新空洞数。
             *   - max=0 → 候选必须存在 0 新空洞解（"必有干净放法"）
             *   - min=N → 候选最干净解也至少带 N 个新空洞（"无论怎么放都会脏"）
             *
             * 守卫：
             *   - 仅在 earlyAttempt 窗口（同 targetSolutionRange）硬过滤，宽松阶段 fallback
             *   - truncated=true 跳过（DFS 不完整时 min 可能未达全集）
             *   - minHoleIncrement === Infinity（无任何完整解，理论上 tripletSequentiallySolvable
             *     已先剔除）也跳过，避免与上游可解性判定形成双重否决
             *
             * 物理含义：低 stress（max=0）保证玩家总能找到干净放法；高 stress（min≥1）
             * 拒绝"放哪都干净"的轻松候选，让玩家被迫面对"必带 N 个空洞"的难局。
             * 与 targetSolutionRange 形成"解空间宽度 × 空洞强迫度"双轴 stress 投射。
             */
            if (earlyAttempt && targetHoleIncrement && !solutionMetrics.truncated) {
                const minInc = solutionMetrics.minHoleIncrement;
                if (Number.isFinite(minInc)) {
                    if (targetHoleIncrement.max != null && minInc > targetHoleIncrement.max) {
                        diagnostics.solutionRejects.holeTooMany++;
                        continue;
                    }
                    if (targetHoleIncrement.min != null && minInc < targetHoleIncrement.min) {
                        diagnostics.solutionRejects.holeTooClean++;
                        continue;
                    }
                }
            }

            /* ===================================================================
             * v1.57.3 — 9 项 stress→算法 多维难度软过滤（与 targetSolutionRange /
             * targetHoleIncrement 并列）。
             *
             * 通用守卫：
             *   - 与上方双轴同窗口（earlyAttempt = attempt < 60% × MAX_SPAWN_ATTEMPTS）
             *   - solutionMetrics.truncated=true 时全部跳过（DFS 不完整）
             *   - 各维度 target ranges 为 null 时该维度不过滤
             *
             * 设计原则：低 stress 用 max 强约束（保护玩家）；高 stress 用 min 强约束
             * （强迫玩家面对压力源）。每个维度的 min/max 单边活跃，避免双边过严。
             * =================================================================== */
            if (earlyAttempt && !solutionMetrics.truncated) {
                // ===== v1.57.3 ① — 最差解新空洞数（专注度税上界）=====
                if (targetMaxHoleIncrement) {
                    const maxInc = solutionMetrics.maxHoleIncrement;
                    if (targetMaxHoleIncrement.max != null && maxInc > targetMaxHoleIncrement.max) {
                        diagnostics.solutionRejects.maxHoleTooMany++;
                        continue;
                    }
                    if (targetMaxHoleIncrement.min != null && maxInc < targetMaxHoleIncrement.min) {
                        diagnostics.solutionRejects.maxHoleTooClean++;
                        continue;
                    }
                }

                // ===== v1.57.3 ⑨ — 专注度税差距（max−min）=====
                if (targetHoleIncrementGap) {
                    const gap = solutionMetrics.holeIncrementGap;
                    if (targetHoleIncrementGap.max != null && gap > targetHoleIncrementGap.max) {
                        diagnostics.solutionRejects.holeGapTooWide++;
                        continue;
                    }
                    if (targetHoleIncrementGap.min != null && gap < targetHoleIncrementGap.min) {
                        diagnostics.solutionRejects.holeGapTooNarrow++;
                        continue;
                    }
                }

                // ===== v1.57.3 ② — 终末填充率（空间窒息感）=====
                if (targetEndFillRatio) {
                    const meanFill = solutionMetrics.meanEndFillRatio;
                    if (targetEndFillRatio.max != null && meanFill > targetEndFillRatio.max) {
                        diagnostics.solutionRejects.fillTooHigh++;
                        continue;
                    }
                    if (targetEndFillRatio.min != null && meanFill < targetEndFillRatio.min) {
                        diagnostics.solutionRejects.fillTooLow++;
                        continue;
                    }
                }

                // ===== v1.57.3 ③ — 近满行/列 delta（消行机会节律）=====
                if (targetNearFullDelta) {
                    const nfd = solutionMetrics.meanNearFullDelta;
                    if (targetNearFullDelta.max != null && nfd > targetNearFullDelta.max) {
                        diagnostics.solutionRejects.nearFullDeltaTooHigh++;
                        continue;
                    }
                    if (targetNearFullDelta.min != null && nfd < targetNearFullDelta.min) {
                        diagnostics.solutionRejects.nearFullDeltaTooLow++;
                        continue;
                    }
                }

                // ===== v1.57.3 ④ — 第一步存活率（试错代价）=====
                if (targetFirstMoveSurvivorRatio) {
                    const sr = solutionMetrics.firstMoveSurvivorRatio;
                    if (targetFirstMoveSurvivorRatio.max != null && sr > targetFirstMoveSurvivorRatio.max) {
                        diagnostics.solutionRejects.survivorTooHigh++;
                        continue;
                    }
                    if (targetFirstMoveSurvivorRatio.min != null && sr < targetFirstMoveSurvivorRatio.min) {
                        diagnostics.solutionRejects.survivorTooLow++;
                        continue;
                    }
                }

                // ===== v1.57.3 ⑤ — 解多样性 CV =====
                if (targetSolutionDiversity) {
                    const div = solutionMetrics.solutionDiversity;
                    if (targetSolutionDiversity.max != null && div > targetSolutionDiversity.max) {
                        diagnostics.solutionRejects.diversityTooHigh++;
                        continue;
                    }
                    if (targetSolutionDiversity.min != null && div < targetSolutionDiversity.min) {
                        diagnostics.solutionRejects.diversityTooLow++;
                        continue;
                    }
                }

                // ===== v1.57.3 ⑥ — 终末平整度（列高方差）=====
                if (targetEndFlatness) {
                    const flat = solutionMetrics.meanEndFlatness;
                    if (targetEndFlatness.max != null && flat > targetEndFlatness.max) {
                        diagnostics.solutionRejects.flatnessTooHigh++;
                        continue;
                    }
                    if (targetEndFlatness.min != null && flat < targetEndFlatness.min) {
                        diagnostics.solutionRejects.flatnessTooLow++;
                        continue;
                    }
                }

                // ===== v1.57.3 ⑦ — 终末危险列数（爆顶预警）=====
                if (targetEndDangerColumns) {
                    const dc = solutionMetrics.meanDangerColumns;
                    if (targetEndDangerColumns.max != null && dc > targetEndDangerColumns.max) {
                        diagnostics.solutionRejects.dangerColsTooHigh++;
                        continue;
                    }
                    if (targetEndDangerColumns.min != null && dc < targetEndDangerColumns.min) {
                        diagnostics.solutionRejects.dangerColsTooLow++;
                        continue;
                    }
                }

                // ===== v1.57.3 ⑧ — 视觉杂乱 delta =====
                if (targetVisualClutter) {
                    const cl = solutionMetrics.meanClutterDelta;
                    if (targetVisualClutter.max != null && cl > targetVisualClutter.max) {
                        diagnostics.solutionRejects.clutterTooHigh++;
                        continue;
                    }
                    if (targetVisualClutter.min != null && cl < targetVisualClutter.min) {
                        diagnostics.solutionRejects.clutterTooLow++;
                        continue;
                    }
                }
            }

            if (earlyAttempt && !solutionMetrics.truncated) {
                const sc = solutionMetrics.solutionCount;
                if (solutionSpacePressure >= 0.78 && !solutionMetrics.capped && sc > 48) {
                    diagnostics.solutionRejects.tooMany++;
                    continue;
                }
                if (solutionSpacePressure <= 0.22 && solutionMetrics.firstMoveFreedom < 5) {
                    diagnostics.solutionRejects.tooFew++;
                    continue;
                }
            }

            /* v1.32：顺序刚性硬过滤
             *
             *   evaluateTripletSolutions().validPerms ∈ [0,6] = 6 种排列里有几种全可解。
             *   orderMaxValidPerms < 6 时（来自 adaptiveSpawn.spawnHints），要求
             *   validPerms ≤ orderMaxValidPerms。
             *
             * 守卫：
             *   - 仅在 attempt < ratio*MAX 时硬过滤（默认 55%），
             *     之后允许任意 validPerms 通过，避免高 rigor + 稀缺 dock 候选时死循环
             *   - truncated=true → 评估不完整，按通过处理（与 v9 同口径）
             *   - validPerms=0 不会进入此分支：上方 tripletSequentiallySolvable
             *     已先剔除"6 种顺序均不可解"的组合
             *
             * 物理含义：rigor 越高 → maxValidPerms 越小 → 玩家越需要"先 X 再 Y 最后 Z"
             * 的明确顺序规划；若一组三块 6 种排列全部可解（validPerms=6），
             * 说明它在认知上"放哪里都行"，与高压玩家想要的"被迫规划"诉求不符。
             */
            /* 用 SOLUTION_FILTER_ATTEMPT_RATIO（默认 0.6）×0.92 ≈ 0.55，比 solutionCount
             * 的硬过滤窗口稍紧，避免在 dock 候选稀缺时把 orderRigor 也死撑到 60% 触雷。 */
            const orderEarly = attempt < Math.floor(MAX_SPAWN_ATTEMPTS * SOLUTION_FILTER_ATTEMPT_RATIO * 0.92);
            if (orderEarly
                && !solutionMetrics.truncated
                && orderMaxValidPerms < 6
                && solutionMetrics.validPerms > orderMaxValidPerms) {
                diagnostics.solutionRejects.orderTooLoose++;
                diagnostics.orderRigor.applied = true;
                continue;
            }
        }

        /* 通过校验 — 打乱顺序 + 记录诊断
         *
         * v1.59.19 bug 修复：Fisher-Yates 同步打乱 triplet + chosenMeta 前 3 项。
         * 历史只打乱 triplet，diagnostics.chosen 仍按 chosenMeta 原顺序写入，
         * 导致 game.js `descriptors[i] = shape: triplet[i]` 写入 dock 的 shape
         * 与 _lastAdaptiveInsight.spawnDiagnostics.chosen[i] 错位（同一 i 索引指向
         * 不同 shape）—— DFV 出块行显示 [2×2 / Z竖2 / 1×4]，但玩家在 dock 上
         * 实际看到的顺序却是别的，用户反馈"顺序不一致"根因。
         * 用同一组 random index 序对两数组应用相同 swap 即可保持配对不变。 */
        for (let i = triplet.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [triplet[i], triplet[j]] = [triplet[j], triplet[i]];
            [chosenMeta[i], chosenMeta[j]] = [chosenMeta[j], chosenMeta[i]];
        }

        const chosenCats = triplet.map(s => getShapeCategory(s.id));
        mem.categories.push(chosenCats);
        if (mem.categories.length > 3) mem.categories.shift();
        mem.totalRounds++;

        diagnostics.attempt = attempt;
        diagnostics.chosen = chosenMeta.slice(0, 3).map(m => ({
            id: m.shape.id, category: getShapeCategory(m.shape.id),
            reason: m.reason,
            topDriver: m.topDriver || { key: 'balanced', label: '综合均衡' },
        }));
        diagnostics.layer1.solutionMetrics = solutionMetrics;
        _lastDiagnostics = diagnostics;

        return triplet;
    }

    /* 兜底 */
    const blocks = [];
    const usedIds = {};
    const clearCandidates = scored.filter(
        (s) => s.gapFills > 0 || s.multiClear >= 1 || s.pcPotential === 2
    );
    if (clearCandidates.length > 0) {
        blocks.push(clearCandidates[0].shape);
        usedIds[clearCandidates[0].shape.id] = true;
    }
    let rem = scored.filter((s) => !usedIds[s.shape.id]);
    while (blocks.length < 3 && rem.length > 0) {
        const pool = rem.map((s) => ({
            entry: s,
            w: s.weight * (1 + Math.log1p(s.placements))
        }));
        const pick = pickWeighted(pool);
        blocks.push(pick.entry.shape);
        usedIds[pick.entry.shape.id] = true;
        rem = scored.filter((s) => !usedIds[s.shape.id]);
    }
    while (blocks.length < 3) {
        const p = pickShapeByCategoryWeights(weights);
        if (p) blocks.push(p);
        else break;
    }

    diagnostics.attempt = MAX_SPAWN_ATTEMPTS;
    diagnostics.chosen = blocks.slice(0, 3).map(s => ({
        id: s.id, category: getShapeCategory(s.id), reason: 'fallback',
        topDriver: _estimateTopDriver(null, null),
    }));
    _lastDiagnostics = diagnostics;

    return blocks.slice(0, 3);
}

// ========================================================================
// 分层接口适配（供测试与未来关卡模式使用）
// ========================================================================

/**
 * 使用显式三层架构生成三连块（与 generateDockShapes 语义等价，但层次分离）。
 *
 * 该函数是对现有 generateDockShapes 逻辑的**轻量封装**，不替换原函数，
 * 而是在其基础上提供可独立测试的分层调用路径：
 *   1. GlobalLayer.adjust()  — 全局弧线/里程碑/多样性调控
 *   2. LaneLayer.filter()    — 泳道/节奏/combo 链过滤
 *   3. FallbackLayer.ensure() + pick() — 保活兜底 + 最终选取
 *
 * @param {import('../grid.js').Grid} grid
 * @param {object} config            strategy config（同 generateDockShapes）
 * @param {object} [spawnHints]      来自 adaptiveSpawn.js
 * @param {object} [spawnContext]    来自 game.js
 * @returns {import('../shapes.js').Shape[]} 三连块数组
 */
export function generateDockShapesLayered(grid, config, spawnHints = {}, spawnContext = {}) {
    // 懒加载分层模块，避免循环依赖影响原有路径
    let FallbackLayer, LaneLayer, GlobalLayer;
    try {
        // 使用动态 import 时此处为同步——由模块缓存保证
        const mod = /** @type {any} */ (globalThis.__spawnLayersMod);
        FallbackLayer = mod?.FallbackLayer;
        LaneLayer = mod?.LaneLayer;
        GlobalLayer = mod?.GlobalLayer;
    } catch { /* fallback below */ }

    // 若层模块未注入（测试外环境），退化为原函数
    if (!FallbackLayer || !LaneLayer || !GlobalLayer) {
        return generateDockShapes(grid, config, spawnHints, spawnContext);
    }

    /* TODO(spawnLayers): 当前即便 __spawnLayersMod 已注入，本函数也仍直接返回 generateDockShapes 结果，
     * 未真正调用 GlobalLayer.adjust() / LaneLayer.filter() / FallbackLayer.ensure()。
     * 接入路径见 spawnLayers.js 头注释（line 22-27）。在接入前，请勿把"分层架构已落地"作为
     * 已上线能力对外宣传——`spawnLayers.test.js` 只证明各层单独可用，不代表主出块路径已分层。 */
    const rawResult = generateDockShapes(grid, config, spawnHints, spawnContext);
    return rawResult; // 当前退化为原函数；三层逻辑在 spawnLayers.js 可独立验证
}
