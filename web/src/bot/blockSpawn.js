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

function permutations3(a, b, c) {
    return [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
}

function placeAndClear(grid, shapeData, gx, gy) {
    const g = grid.clone();
    g.place(shapeData, 0, gx, gy);
    g.checkLines();
    return g;
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
 * @param {import('../grid.js').Grid} grid
 * @param {number[][][]} orderedShapes
 * @param {number} depth
 * @param {{ count: number, cap: number, truncated: boolean }} accum
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
        return;
    }
    const s = orderedShapes[depth];
    const n = grid.size;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (accum.count >= accum.cap || budget.n <= 0) return;
            if (!grid.canPlace(s, x, y)) continue;
            budget.n--;
            const next = placeAndClear(grid, s, x, y);
            dfsCountSolutions(next, orderedShapes, depth + 1, accum, budget);
        }
    }
}

/**
 * 估算三连块在当前盘面下的「解空间体量」。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {number[][][]} threeData
 * @param {{ leafCap?: number, budget?: number }} [opts]
 * @returns {{
 *   validPerms: number,        // 6 种顺序里至少有 1 解的顺序数（0~6）
 *   solutionCount: number,     // 6 种顺序累计的叶子数（截断到 leafCap）
 *   capped: boolean,           // 是否撞到 leafCap（实际解 ≥ leafCap）
 *   truncated: boolean,        // 是否被 budget 截断（结果不可信，过滤时跳过）
 *   firstMoveFreedom: number,  // 三块独立放置时的最小合法点数（"瓶颈块自由度"）
 *   perPermCounts: number[]    // 每种顺序贡献的叶子数（按 permutations3 顺序）
 * }}
 */
export function evaluateTripletSolutions(grid, threeData, opts = {}) {
    if (!Array.isArray(threeData) || threeData.length !== 3) {
        return { validPerms: 0, solutionCount: 0, capped: false, truncated: false, firstMoveFreedom: 0, perPermCounts: [] };
    }

    const cap = Math.max(1, opts.leafCap ?? SOLUTION_LEAF_CAP_DEFAULT);
    const budget = { n: Math.max(100, opts.budget ?? SOLUTION_BUDGET_DEFAULT) };
    const accum = { count: 0, cap, truncated: false };

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

    return {
        validPerms,
        solutionCount: accum.count,
        capped: accum.count >= cap,
        truncated: accum.truncated,
        firstMoveFreedom,
        perPermCounts
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
function analyzePerfectClearSetup(grid) {
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

    const clearTarget = Math.max(0, Math.min(3, hints.clearGuarantee ?? 1));
    const sizePref = hints.sizePreference ?? 0;
    const divBoost = hints.diversityBoost ?? 0;
    const comboChain = hints.comboChain ?? 0;
    const multiClearBonus = hints.multiClearBonus ?? 0;
    const multiLineTarget = Math.max(0, Math.min(2, hints.multiLineTarget ?? 0));
    const delightBoost = Math.max(0, Math.min(1, hints.delightBoost ?? 0));
    const perfectClearBoost = Math.max(0, Math.min(1, hints.perfectClearBoost ?? 0));
    const delightMode = hints.delightMode ?? 'neutral';
    const rhythmPhase = hints.rhythmPhase ?? 'neutral';
    const targetSolutionRange = hints.targetSolutionRange || null;
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
            const gapFills = grid.countGapFills(shape.data);
            const category = getShapeCategory(shape.id);
            const weight = weights[category] ?? 1;
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
            targetSolutionRange
        },
        layer2: { comboChain, multiClearBonus, multiLineTarget, delightBoost, perfectClearBoost, delightMode, rhythmPhase, divBoost, spawnTargets: { ...spawnTargets }, recentCatFreq: { ...catFreq } },
        layer3: { scoreMilestone: ctx.scoreMilestone || false, roundsSinceClear: ctx.roundsSinceClear ?? 0, totalRounds: ctx.totalRounds ?? mem.totalRounds },
        chosen: [],
        attempt: 0,
        // v9：解法过滤的统计（被拒次数）
        solutionRejects: { tooFew: 0, tooMany: 0 }
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
            chosenMeta.push({ shape: pick.shape, placements: pick.placements, reason: pcSetup >= 1 ? 'perfectClear' : 'clear' });
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
            chosenMeta.push({ shape: entry.shape, placements: entry.placements, reason: 'weighted' });
            if (entry.gapFills > 0) clearCount++;
            remaining = scored.filter((s) => !usedIds[s.shape.id]);
        }

        while (blocks.length < 3) {
            const p = pickShapeByCategoryWeights(weights);
            if (!p) break;
            blocks.push(p);
            chosenMeta.push({ shape: p, placements: countLegalPlacements(grid, p.data), reason: 'fallback' });
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
        }

        /* 通过校验 — 打乱顺序 + 记录诊断 */
        for (let i = triplet.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [triplet[i], triplet[j]] = [triplet[j], triplet[i]];
        }

        const chosenCats = triplet.map(s => getShapeCategory(s.id));
        mem.categories.push(chosenCats);
        if (mem.categories.length > 3) mem.categories.shift();
        mem.totalRounds++;

        diagnostics.attempt = attempt;
        diagnostics.chosen = chosenMeta.slice(0, 3).map(m => ({
            id: m.shape.id, category: getShapeCategory(m.shape.id), reason: m.reason
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
        id: s.id, category: getShapeCategory(s.id), reason: 'fallback'
    }));
    _lastDiagnostics = diagnostics;

    return blocks.slice(0, 3);
}

/** @deprecated 使用 generateDockShapes */
export const generateBlocksForGrid = generateDockShapes;

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

    // 复用原始评分逻辑（仅分层，不重复打分代码）
    const rawResult = generateDockShapes(grid, config, spawnHints, spawnContext);
    return rawResult; // 当前退化为原函数；三层逻辑在 spawnLayers.js 可独立验证
}
