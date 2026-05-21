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

const { getAllShapes, getShapeCategory, pickShapeByCategoryWeights, isSpecialShapeId } = require('../shapes');
const { GAME_RULES } = require('../gameRules');
const { analyzeBoardTopology, detectNearClears } = require('../boardTopology');
const { defaultRng, pickIndex, fisherYatesInPlace } = require('../lib/seededRng');
const { pickByPlatform } = require('../config/platformProfile');

/** v1.32+v1.60.0：独立库（事件注入特殊形状）—— 不参与正常概率出块。
 *
 * v1.60.1（Issue 5 单源化）：以下 3 个常量来自硬编码，但所属契约真源是 `shared/shapes.json`
 * 的 `specialShapeIds`。`shapes.js` 已暴露 `isSpecialShapeId(id)`，外部代码应优先调用 helper。
 * 本文件保留 RELIEF/PRESSURE 分类常量是因为业务上需要"减压池 vs 加压池"语义二分，
 * 这是 blockSpawn 私有的策略层划分，不属于数据层。 */
const SPECIAL_RELIEF_SHAPES = ['1x2', '2x1', '1x3', '3x1', 'l3-a', 'l3-b', 'l3-c', 'l3-d'];
const SPECIAL_PRESSURE_SHAPES = ['diag-2a', 'diag-2b', 'diag-3a', 'diag-3b'];
const SPECIAL_SHAPES = [...SPECIAL_RELIEF_SHAPES, ...SPECIAL_PRESSURE_SHAPES];

/**
 * v1.60.6 缺口 #2 修复 — 形状内部权重（取代 uniform Fisher-Yates）。
 *
 * 设计原则：
 *   - **Relief 池**（救济）：越易消行/越短的越常见。
 *     1x2/2x1 (2 格) 权重 3，最容易补一片缝；1x3/3x1 (3 格) 权重 2，中等；
 *     l3-* (3 格 L 角) 权重 1，更稀有更"独特"（角落补缝场景才出彩）。
 *   - **Pressure 池**（加压）：散点权重应略高于稀疏挑战，避免直接给玩家造一大堆孤洞。
 *     diag-2* (2 格对角) 权重 2；diag-3* (3 格对角) 权重 1（更稀有，3 格散点能造的乱比 2 格大）。
 *
 * 总权重之和故意不归一化，方便季节/活动覆写（_resolveSpecialPools）按需替换单个 entry。
 */
const SPECIAL_SHAPE_WEIGHTS = {
    '1x2': 3, '2x1': 3,
    '1x3': 2, '3x1': 2,
    'l3-a': 1, 'l3-b': 1, 'l3-c': 1, 'l3-d': 1,
    'diag-2a': 2, 'diag-2b': 2,
    'diag-3a': 1, 'diag-3b': 1,
};

/**
 * v1.60.6 缺口 #3 修复 — 季节/活动覆写。
 *
 * 解析 ctx 上的可选覆写，与默认 SPECIAL_RELIEF/PRESSURE_SHAPES + SPECIAL_SHAPE_WEIGHTS 合并。
 *
 * **覆写来源**（优先级从高到低）：
 *   1. `ctx.specialOverride`：调用方主动注入（推荐——可来自远端配置/活动框架）
 *   2. `localStorage['openblock_special_override_v1']`（仅 web 环境，未做强制持久化保证）
 *   3. 默认池 + 默认权重
 *
 * **覆写 schema**（任何字段可选）：
 *   ```
 *   {
 *       relief?: string[],                      // 替换 relief 池整张
 *       pressure?: string[],                    // 替换 pressure 池整张
 *       reliefAppend?: string[],                // 在默认 relief 池基础上追加（不去重）
 *       pressureAppend?: string[],              // 在默认 pressure 池基础上追加
 *       weights?: Record<string, number>,       // 部分覆写形状权重（merge over default）
 *       reliefLimitFactor?: number,             // 覆写 relief 子配额因子（默认 0.07）
 *       pressureLimitFactor?: number,           // 覆写 pressure 子配额因子（默认 0.05）
 *   }
 *   ```
 *
 * @param {object} [ctx]
 * @returns {{ relief: string[], pressure: string[], weights: Record<string, number>, reliefLimitFactor: number, pressureLimitFactor: number }}
 */
function _resolveSpecialPools(ctx) {
    let override = ctx?.specialOverride || null;
    if (!override && typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem('openblock_special_override_v1');
            if (raw) override = JSON.parse(raw);
        } catch (_e) { /* tolerate malformed JSON / privacy mode */ }
    }
    const o = override || {};
    const relief = Array.isArray(o.relief)
        ? o.relief.slice()
        : SPECIAL_RELIEF_SHAPES.slice();
    if (Array.isArray(o.reliefAppend)) relief.push(...o.reliefAppend);
    const pressure = Array.isArray(o.pressure)
        ? o.pressure.slice()
        : SPECIAL_PRESSURE_SHAPES.slice();
    if (Array.isArray(o.pressureAppend)) pressure.push(...o.pressureAppend);
    const weights = { ...SPECIAL_SHAPE_WEIGHTS, ...(o.weights || {}) };
    const reliefLimitFactor = Number.isFinite(o.reliefLimitFactor) ? o.reliefLimitFactor : 0.07;
    const pressureLimitFactor = Number.isFinite(o.pressureLimitFactor) ? o.pressureLimitFactor : 0.05;
    return { relief, pressure, weights, reliefLimitFactor, pressureLimitFactor };
}

const MAX_SPAWN_ATTEMPTS = 22;
const FILL_SURVIVABILITY_ON = 0.52;
const SURVIVE_SEARCH_BUDGET = 14000;
const CRITICAL_FILL = 0.68;

/* ---------- 解法数量评估常量（可被 game_rules.solutionDifficulty 覆盖） ---------- */
const SOLUTION_EVAL_FILL_MIN_DEFAULT = 0.45;
const SOLUTION_LEAF_CAP_DEFAULT = 64;
const SOLUTION_BUDGET_DEFAULT = 8000;
const SOLUTION_FILTER_ATTEMPT_RATIO = 0.6; // attempt < 60% 时才硬过滤，避免无解死循环

/**
 * v1.60.28：monoFlush（同花顺消除）chosen pick 概率 —— "乐趣 / 彩蛋"语义。
 *
 * **设计动机**：v1.60.19~27 经多轮修复后，monoFlush 判定（bestMonoFlushPotential）准确、
 * 染色强制绑定（v1.60.27）保证一旦命中必触发 ×5 iconBonus。但若 chosen 100% 必选 monoFlush
 * 候选，同花顺将常态出现，反而失去"惊喜彩蛋"语义——玩家会习以为常，且常态遮蔽其他
 * 乐趣（multiClear / pcPotential / exactFit）。
 *
 * 25% 概率 ≈ 玩家每 4 次 dock 命中 1 次同花顺机会，足够提供惊喜感而不喧宾夺主。
 * pcPotential（清屏）仍 100% 优先（清屏是终极目标，不节流）。
 */
/* v1.60.31：0.25→0.10；v1.60.34：再降 2/3 到 0.033（让位给清屏大奖）*/
/* v1.60.45：按平台分发（详见 web/src/bot/blockSpawn.js 同段注释 + docs/operations/
 * RETENTION_SIGNALS_CROSS_PLATFORM.md §2.2）。
 * 小程序壳在 miniprogram/app.js 注入 globalThis.__OPENBLOCK_PLATFORM__='wechat'，
 * 走 Android-like 档（0.050）。 */
const MONO_FLUSH_PICK_PROBABILITY = pickByPlatform({
    ios:     0.033,
    android: 0.050,
    wechat:  0.050,
    web:     0.033,
    default: 0.033,
});
const MONO_FLUSH_PROB_CAP = pickByPlatform({
    ios:     0.10,
    android: 0.15,
    wechat:  0.15,
    web:     0.10,
    default: 0.10,
});

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
function computeCandidatePlacementMetric(grid, dockBlocks) {
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
 * @param {{ searchBudget?: number, allowDuplicates?: boolean }} [opts]
 *   - `allowDuplicates`：v1.60.21 新增，跳过 duplicate-shape 拒绝（仅 `_tryInjectDuplicates`
 *     使用，配合高度/极度 novelty 场景注入 2/3 同款）
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validateSpawnTriplet(grid, shapes, opts = {}) {
    if (!grid?.cells?.length) return { ok: false, reason: 'invalid-grid' };
    if (!Array.isArray(shapes) || shapes.length < 3) return { ok: false, reason: 'not-enough-shapes' };

    const triplet = shapes.slice(0, 3);
    const ids = new Set();
    for (const shape of triplet) {
        if (!shape?.id || !Array.isArray(shape.data)) return { ok: false, reason: 'invalid-shape' };
        if (!opts.allowDuplicates && ids.has(shape.id)) return { ok: false, reason: 'duplicate-shape' };
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
function evaluateTripletSolutions(grid, threeData, opts = {}) {
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
 * v1.60.9：多步可达清盘检测（"清盘逻辑"严格语义）—— 检查 triplet 中是否存在
 * 某顺序放完后盘面清空。bestPerfectClearPotential 只检测**单步**，
 * 此函数补充**任意子集 ≥ 1 块的有序组合**枚举：
 *   长度 1：3 种（任一单块）—— 等同 bestPerfectClearPotential 在该 triplet 内的并集
 *   长度 2：6 种（3P2）
 *   长度 3：6 种（3!）
 * 总组合：3 + 6 + 6 = 15 种顺序，每个顺序最多 n² 个放置位 × 块数。
 *
 * 性能保护（关键）：传入 `budget`（默认 8000 次模拟），超 budget 立刻返 false。
 * 这是"探测式保护"——超 budget 时保守认为不能 PC，让上层继续走原决策。
 * 现实负载（8×8 fill≈0.45，~25 合法位/块）：最坏 ~3600 模拟，budget 8000 足够。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {Array<{data:number[][]}>} triplet 三块（顺序不影响结果，函数内部全排列枚举）
 * @param {object} [opts]
 * @param {number} [opts.budget=8000] 最多模拟次数，超过返 false（保守）
 * @returns {boolean} true=存在某有序子集放完后盘面清空
 */
function canTripletPerfectClear(grid, triplet, opts = {}) {
    if (!grid || !Array.isArray(triplet) || triplet.length === 0) return false;
    /* 防御：过滤掉 undefined/null/缺 data 字段的成员，保证 DFS 不崩 */
    const validShapes = triplet.filter(s => s && Array.isArray(s.data));
    if (validShapes.length === 0) return false;
    const budget = opts.budget ?? 8000;
    let used = 0;

    const n = grid.size;

    /* 启发式必要条件：剩余 cells（已占据 + 将被放入的）必须 ≥ 1 个 row/col 长度，
     * 否则即使放下也无法触发任何消行——既然无消行就更不可能清空。 */
    let occupied = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) occupied++;
        }
    }
    /* 语义：本函数仅当"当前盘面非空、且存在 3 块组合可让其清空"时返 true，
     * 用于保护清盘机会。空盘（开局）不构成"清盘机会"——3 块放下只会让盘面更满，
     * 此时返 false 让上层决策走常规路径。 */
    if (occupied === 0) return false;

    /* 检查棋盘全空 helper */
    function isEmpty(g) {
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (g.cells[y][x] !== null) return false;
            }
        }
        return true;
    }

    function countOccupied(g) {
        let c = 0;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (g.cells[y][x] !== null) c++;
            }
        }
        return c;
    }

    /* DFS：当前 grid + 剩余可选块集（数组） + 已经使用步数（≥1 才考虑判清空）
     *
     * 关键剪枝（性能必要）：每步放置 + 消行后，occupied 必须**严格减少**。
     *   理由：清盘要求 occupied 最终归零，3 步内只有"每步都消行"路径能实现；
     *         "铺垫一步不消行→后续大消"在 8×8 三块场景几乎不存在（块累计 cells ≤ 9）。
     *   不消行的路径直接剪枝可让 DFS 从指数级降到线性级（实测 8×8 fill=0.45 < 500 模拟）。
     */
    function dfs(currentGrid, remainingShapes, depth) {
        if (used >= budget) return false;
        if (depth > 0 && isEmpty(currentGrid)) return true;
        if (remainingShapes.length === 0) return false;

        const prevCells = countOccupied(currentGrid);

        for (let i = 0; i < remainingShapes.length; i++) {
            const shape = remainingShapes[i];
            const rest = remainingShapes.slice(0, i).concat(remainingShapes.slice(i + 1));
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    if (used >= budget) return false;
                    if (!currentGrid.canPlace(shape.data, x, y)) continue;
                    used++;
                    const g = currentGrid.clone();
                    g.place(shape.data, 0, x, y);
                    g.checkLines();
                    const newCells = countOccupied(g);
                    /* 剪枝：放置 + 消行后 cells 数不严格减少 → 这条路径不可能在剩余步数内清盘 */
                    if (newCells >= prevCells) continue;
                    if (dfs(g, rest, depth + 1)) return true;
                }
            }
        }
        return false;
    }

    return dfs(grid, validShapes, 0);
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
function resetSpawnMemory() {
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
 *   2. `monoFlush >= 1`      → 可凑 N 同花顺（v1.60.19：×5 倍 iconBonus 硬 payoff，仅次于清屏）
 *   3. `exactFit >= 0.999`   → 完美卡入（v1.60.20：几何 100% 嵌入是确定性极致信号；含消行）
 *   4. `multiClear >= 1`     → 可消 N 行（v1.60.16 文案统一）— 真模拟 previewClearOutcome
 *   5. `exactFit >= 0.85`    → 紧凑卡入 N%（v1.60.18：高度契合但未达完美级，让位给消行）
 *   6. `gapFills >= 2`       → 补 N 缺（×nearFullFactor 加权差缺分，不保证消行）
 *   7. `gapFills === 1`      → 近满补 1（v1.60.15：弱差缺，不保证消行）
 *   8. `holeReduce > 0`      → 可补 N 处空洞（×0.4 加权）
 *   9. `placements >= 30`    → 机动性高（合法落点多）
 *  10. shapeWeights 类别主导  → 类别权重高（例：长条权重 33%）
 *   default                  → 综合均衡（无单一主因）
 *
 * **v1.60.15 语义对齐修复**：拆分 multiClear=1 与 gapFills=1 两个独立 driver。
 *   旧版 `gapFills === 1 → '可消1行'` 是**误导**：gapFills 只算"shape 能落进近满 gap"
 *   的加权差缺分（差 4 格 gap 贡献 1 分，但放下后行/列仍差 1+ 格），**不模拟消行**。
 *   真正"放下能消 1 行"的判定是 `bestMultiClearPotential(grid, shapeData) === 1`
 *   （扫所有合法位 + previewClearOutcome 真实模拟）。
 *   v1.60.15 后（v1.60.16 文案统一为"可消X行"）：
 *     - "可消N行" 严格对应 multiClear（真模拟 previewClearOutcome）
 *     - "补N缺/近满补1" 严格对应 gapFills（加权差缺分，不保证消）
 *   同时 DRIVER_NODE_PATHS 在 multiClear=1 时也走 multiClear path（点亮
 *   multiClearBonus + multiLineTarget），与 multiClear>=2 一致。
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
function _estimateTopDriver(s, shapeWeights) {
    if (!s) return { key: 'fallback', label: '兜底降级' };

    if (s.pcPotential === 2) return { key: 'pcPotential', label: '可清屏' };
    /* v1.60.19：monoFlush 同花顺消除潜力 — 紧随 pcPotential 之后。
     * 优先级动机：iconBonus 是 ×5 倍得分（仅次于 PERFECT_CLEAR_MULT=10），数值上比
     * 普通 multiClear×N 行更值钱，必须显式标注让玩家/可解释面板能看到。 */
    if ((s.monoFlush ?? 0) >= 1) {
        return { key: 'monoFlush', label: `可凑${s.monoFlush}同花顺` };
    }
    /* v1.60.20：exactFit=1.0（完美卡入）提升到 multiClear 之前。
     * 用户反馈"优先适配完美卡入"——完美卡入是**几何上确定性的极致信号**（shape 外周
     * 一圈 100% 被填/边界），这种 shape 是盘面"等待已久"的精确解，比"可消N行"更
     * 应优先标注；同时几何精确嵌入往往**也能消行**（边界完全闭合 → 大概率补满相邻 line），
     * 显示"完美卡入"比"可消1行"信息密度更高（前者含后者）。
     *
     * **紧凑卡入**（exactFit ∈ [0.85, 1.0)）保留 v1.60.18 在 multiClear 之后的位置：
     * 紧凑卡入并非 100% 确定性嵌入，让位给真模拟消行 payoff 更稳妥。 */
    if ((s.exactFit ?? 0) >= 0.999) {
        return { key: 'exactFit', label: '完美卡入' };
    }
    /* v1.60.15：multiClear 真模拟优先级整体高于 gapFills 加权分（同等数值时优先消行 driver）
     * v1.60.16：文案统一为"可消X行"（X=1/2/3...），不再区分"可消1行"vs"可多消N行"，
     * 用户反馈"4×1/5×1/1×4 三块都标'可多消2行'，文案前缀冗余且不一致"。 */
    if (s.multiClear >= 1) return { key: 'multiClear', label: `可消${s.multiClear}行` };
    /* v1.60.26：移除 v1.60.25 monoFlushBuildup driver label。
     *
     * 用户严格定义"同花块" = **构成消行 + 全 line 同 icon**。
     * monoFlushBuildup 是"朝 8 同色累积"的建设期信号 —— shape 放下**不消行**，
     * 因此不算同花块。driver 标 "建N同花" 会误导玩家以为有 iconBonus，撤销。
     *
     * `bestMonoFlushBuildup` 函数保留作为 scoreShape 内部加权信号（让建设期 shape
     * 有偏向，但不暴露为 driver 标签），DFV/可解释面板按 `monoFlush` 为唯一同花判定。 */
    /* v1.60.18：紧凑卡入（exactFit ∈ [0.85, 1.0)）— 在 gapFills 之前判定，
     * 反映"高度契合"的独立价值，但不到完美级（让位给 multiClear）。 */
    if ((s.exactFit ?? 0) >= 0.85) {
        const pct = Math.round((s.exactFit ?? 0) * 100);
        return { key: 'exactFit', label: `紧凑卡入${pct}%` };
    }
    if (s.gapFills >= 2) return { key: 'gapFills', label: `补${s.gapFills}缺` };
    if (s.gapFills === 1) return { key: 'gapFills', label: '近满补1' };
    if (s.holeReduce > 0) return { key: 'holeReduce', label: `补${s.holeReduce}洞` };
    if ((s.placements ?? 0) >= 30) return { key: 'mobility', label: '机动高' };

    /* v1.60.13：清理 v1.60.0 的 4 段死代码（diagonalSparse/diagonalPair/tinyLine/cornerFit）。
     *
     * **死代码确证**：本函数在 scoreShape 内部调用（_lookupTriplet / weighted / fallback 三处），
     * 输入的 `s` 来自 `scored` 数组。`scored` 在生成阶段被 `_passesShapeGate` 过滤：
     *   if (SPECIAL_SHAPES.includes(id)) return false;   // line 1057
     * 即 12 个 special shape（diag-3a/b、diag-2a/b、1x2/2x1/1x3/3x1、l3-a..d）**永远不会**
     * 进入 scoreShape 路径。它们的唯一出路是 `_tryInjectSpecial` 注入，而注入逻辑（line 1333）
     * 直接硬编码 `topDriver: { key: 'relief' | 'pressure', label: '特殊减压'|'特殊加压' }`，
     * 也不调用本函数。所以原 line 1004-1011 的 4 段判定**永远不会执行**。
     *
     * 真实的 chosenMeta.topDriver.key 全集（按 driver_node_paths.js 同步）：
     *   常规 scoreShape 路径（本函数）：pcPotential / multiClear / gapFills / holeReduce /
     *                                    mobility / shapeWeight / balanced / fallback
     *   _tryInjectSpecial 注入路径（不走本函数）：relief / pressure
     *
     * 若未来解除 _passesShapeGate 限制（让 special shape 走常规评分），需在此处恢复并同步
     * decisionFlowViz.js DRIVER_NODE_PATHS 增加对应 path。 */

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
    /* v1.32+v1.60.0：所有 12 个特殊加减压形状不参与正常概率出块，
     * 仅在极端条件下由 _injectSpecialBlock 条件注入（每局严格限制出现次数）。 */
    if (SPECIAL_SHAPES.includes(id)) return false;
    return true;
}

/**
 * v1.60.0 形状池扩展 P1：新形状的策略加权 nudge（在主权重 weights[category] 之上的乘法 bonus）。
 * v1.32 优化：特殊形状不再进入此函数（被 _passesShapeGate 拦截），本函数仅处理非特殊形状。
 *
 * @param {number} baseWeight - 来自 weights[category] 的基础权重
 * @param {string} shapeId
 * @param {object} hints - spawnHints
 * @param {number} gapFills - 当前 shape 在盘面上能消行的能力
 * @returns {number} 调整后的 weight
 */
function _applyShapeBonusWeight(baseWeight, _shapeId, _hints, _gapFills) {
    return baseWeight;
}

/**
 * v1.32+v1.60.0：极端加减压下将特殊形状注入 triplet。
 *
 * 注入条件基于盘面几何：
 *   减压（加速得分）：清屏准备/临消行≥2/高填充+可补缝+有空洞
 *   加压（构造空洞）：加压意图 + 有空间 + 无过多空洞
 *
 * 全局上限：max(totalClears × 10%, 3) — 所有特殊形状共享同一计数器。
 *
 * @param {Array} triplet
 * @param {Array} chosenMeta
 * @param {object} hints  spawnHints
 * @param {object} ctx    spawnContext（含 specialShapeUsed / totalClears）
 * @param {import('../grid.js').Grid} grid
 * @param {number} fill
 * @param {object} topo   盘面拓扑（nearFullLines, holes）
 * @param {number} pcSetup 清屏准备信号
 * @param {Array} scored  scored 数组
 * @returns {null | { triplet: Array, chosenMeta: Array, isRelief: boolean, injected: string }}
 */
/**
 * v1.60.1 全面重构（修复 Issue 1/3/4/6/7）：
 *
 * 1. **Issue 1 修复 — 注入后复校**：注入后立即调用 `validateSpawnTriplet` 二次校验，
 *    失败则降级尝试（换 candidate → 换 replaceIdx → 最后放弃注入），保证下发到 dock 的
 *    triplet 永远满足原有 hard constraint（firstMoveFreedom / canPlaceAnywhere /
 *    not-sequentially-solvable 等十余项 spec）。
 *
 * 2. **Issue 3 修复 — 优先级**：拆 mutual exclusion：
 *    - `sprint intent`（玩家主动加压）：**强制 pressure**，relief 信号被忽略
 *    - `pressure intent`：低 fill 时优先 pressure；否则尝试 relief
 *    - 其他 intent：保持原 relief 优先逻辑
 *
 * 3. **Issue 4 修复 — RNG 可注入**：candidate 选择接受 `opts.rng`，daily/replay 模式
 *    可传 mulberry32 seed 实现可复现。默认 `Math.random`（行为不变）。
 *
 * 4. **Issue 6 修复 — 智能 replaceIdx**：按 chosenMeta 的"重要性评分"升序枚举槽位，
 *    优先替换最弱的（fallback / 评分最低），保留高价值 slot（清屏/多消候选）。
 *
 * 5. **Issue 7 修复 — audit trail**：chosenMeta[i] 写入 `original` 字段保留被替换的
 *    原 shape，DFV 后续可加 ⚡badge 提示"事件注入"，决策可解释性提升。
 *
 * @param {Array} triplet
 * @param {Array} chosenMeta
 * @param {object} hints
 * @param {object} ctx
 * @param {import('../grid.js').Grid} grid
 * @param {number} fill
 * @param {object} topo
 * @param {number} pcSetup
 * @param {Array}  scored
 * @param {{ rng?: () => number }} [opts]  v1.60.1：RNG 注入，daily/replay 用
 * @returns {null | { triplet: Array, chosenMeta: Array, isRelief: boolean, injected: string, replaceIdx: number }}
 */
function _tryInjectSpecial(triplet, chosenMeta, hints, ctx, grid, fill, topo, pcSetup, scored, opts) {
    const rng = typeof opts?.rng === 'function' ? opts.rng : defaultRng;

    /* v1.60.6 缺口 #5：信号侧用 enclosedVoidCells（玩家心智小空腔）替代 coverable holes，
     * 与 UI / spawnGeo 同口径——这样 bot 判断"加压会不会让局面太糟"和玩家直觉一致。
     * topo 若没有 enclosedVoidCells（旧调用方），降级到 coverable holes。 */
    const holesSignal = Number.isFinite(topo?.enclosedVoidCells)
        ? topo.enclosedVoidCells
        : (topo?.holes ?? 0);

    /* === Step 1：减压/加压条件评估（v1.60.44 阶段绑定 + 三类触发分级） ===
     *
     * **设计契约（用户 v1.60.44 诉求）**：
     *   12 个特殊小块仅在对应"阶段"下生效：
     *     - **Relief 减压阶段**（`intent === 'relief'`，priority 100，由 intentResolver 派生）
     *       承接三类触发，按优先级排序：
     *         (1) 清屏       — `pcSetup >= 1`         （最强信号：盘面接近 PC）
     *         (2) 完美卡入   — `scored.exactFit >= 0.999` （shape 几何 100% 嵌入）
     *         (3) 消行(低优) — `scored.multiClear >= 1` ，且 chosen 自身无 multiClear
     *                          （低优先级：chosen 主路径已能消行时让位，避免双重铺垫）
     *       monoFlush 是"同色消行"的特殊形态，归并入 (3) 子触发，但不受
     *       "chosen 无 multiClear" 压制——它的 ×5 倍 iconBonus 价值不可替代。
     *
     *     - **Pressure 强加压阶段**（`intent ∈ {'pressure', 'sprint'}`）
     *       承接单一触发：**制造空洞**——diag-2/3 散点形状专为"低填充期播种孤洞"设计。
     *       - `pressure`（priority 70）= challengeBoost>0 ∨ delightMode='challenge_payoff'+stress≥0.55
     *       - `sprint`（priority 60）= stress ∈ [0.45, 0.55) 渐紧过渡带（玩家主动选自虐）
     *
     * **旧版差异**（v1.60.0 → v1.60.43）：
     *   ❌ relief 不要求 `intent === 'relief'`，仅看几何信号（`hasClearSetup ‖
     *      highFillFillHoles ‖ monoFlush`）—— 导致 harvest/maintain 等中性意图下也会
     *      注入 1×2/l3-* "减压块"，与 chosen 主路径的消行候选语义冲突（v1.60.37 Bug A/B 起源）。
     *   ❌ `highFillFillHoles`（fill>0.7+gapFills+holes>5）是"高填充补缝"的几何启发式，
     *      但语义混杂——把"补缝（gapFills）"和"压力释放（fill>0.7）"绑在一起，难以独立调试。
     *
     * **新版做法**：
     *   ✓ relief 增加 `isReliefPhase` 硬门（与 intentResolver 单源对齐）
     *   ✓ 三类触发独立可观测（reliefTrigger 字段，DFV / spawnDiagnostics 消费）
     *   ✓ 消行触发被 chosen 自身能力压制（"低优先级"语义形式化）
     *   ✓ pressure 强加压阶段保留 sprint/pressure 双 intent（priority>=60），但
     *      不再吸收"无 intent + roomForHoles"裸 pressure（无 intent 时永不注入）
     */
    const skin = ctx?.skin ?? null;
    const monoFlushLines = (typeof grid.findNearFullMonoLines === 'function')
        ? grid.findNearFullMonoLines(skin)
        : [];
    /* v1.60.29：L2 注入路径检查 chosen 中已有 monoFlush 块 — 若已有则关闭 monoFlushSignal，
     * 与 Stage 1/Stage 2 限制一致（单 dock monoFlush ≤ 1，避免视觉单调 + 彩蛋过载）。 */
    const chosenAlreadyHasMonoFlush = (chosenMeta || []).some(m => (m?.monoFlush ?? 0) >= 1);
    const monoFlushSignal = !chosenAlreadyHasMonoFlush && monoFlushLines.length > 0;

    /* v1.60.38：monoFlush 注入命中受 MONO_FLUSH_PICK_PROBABILITY 节流。
     * `monoFlushRound=false` 时即使真模拟通过也降级为 'special-relief'（不标 monoFlush 字段）。 */
    const allowMonoFlushLabel = opts ? opts.monoFlushRound !== false : true;

    const intent = hints?.spawnIntent;
    const isReliefPhase = intent === 'relief';
    const isSprint = intent === 'sprint';
    const isPressureIntent = isSprint || intent === 'pressure';

    /* v1.60.44 三类 relief 触发分级（仅在 isReliefPhase 下评估） */
    const hasClearSetup = pcSetup >= 1;
    const hasExactFitSetup = Array.isArray(scored)
        && scored.some(s => (s?.exactFit ?? 0) >= 0.999);
    /* 消行触发"低优先级"语义形式化：chosen 主路径若已能消行（≥1 块 multiClear≥1），
     * 单独的消行触发不再激活 —— 让位给主路径的高价值消行候选 */
    const chosenHasMultiClear = (chosenMeta || []).some(m => (m?.multiClear ?? 0) >= 1);
    const hasMultiClearScored = Array.isArray(scored)
        && scored.some(s => (s?.multiClear ?? 0) >= 1);
    const multiClearLowPriorityActive = hasMultiClearScored && !chosenHasMultiClear;

    /* 触发分类（用于 audit trail，DFV 可展开 "为什么注入" 因果链） */
    let reliefTrigger = null;
    if (isReliefPhase) {
        if (hasClearSetup) reliefTrigger = 'pcSetup';                  /* 清屏（最强） */
        else if (hasExactFitSetup) reliefTrigger = 'exactFit';          /* 完美卡入 */
        else if (monoFlushSignal) reliefTrigger = 'monoFlush';          /* 同色消行（彩蛋） */
        else if (multiClearLowPriorityActive) reliefTrigger = 'multiClear'; /* 消行（低优先级） */
    }
    const reliefSignal = reliefTrigger != null;

    /* pressure 强加压阶段：单一触发 = "制造空洞"。
     * roomForHoles 限制 fill<0.45（盘面足够空才有意义播种孤洞），
     * notAlreadyFullOfHoles 限制 holesSignal<4（避免雪上加霜）。 */
    const roomForHoles = fill < 0.45;
    const notAlreadyFullOfHoles = holesSignal < 4;
    const pressureSignal = isPressureIntent && roomForHoles && notAlreadyFullOfHoles;

    /* v1.60.44 阶段绑定后的优先级矩阵（替换原 v1.60.1 几何驱动矩阵）：
     *
     *   sprint intent + pressureSignal     → 强制 pressure（玩家主动选自虐）
     *   pressure intent + pressureSignal   → pressure
     *   relief intent + reliefSignal       → relief
     *
     *   非 'relief' 意图永不触发 relief，非 'pressure'/'sprint' 意图永不触发 pressure。
     *   两路径互斥（_tryInjectSpecial 每轮最多注入 1 块）。
     *
     * 注：删去旧版"裸 pressureSignal without intent → pressure"分支——按新契约，
     * 无 intent 时永不进入特殊池（强加压必须有意图信号）。 */
    let isRelief = false;
    let isPressure = false;
    if (isPressureIntent && pressureSignal) {
        isPressure = true;
    } else if (isReliefPhase && reliefSignal) {
        isRelief = true;
    }

    if (!isRelief && !isPressure) return null;

    /* === Step 1.5：v1.60.7 新开局 warmup 保护 ===
     *
     * 即便 reliefSignal/pressureSignal 满足，新一局前 5 轮（onboarding 期）也绝不注入 special：
     *   - 空盘 / 接近空盘出现 1x2 / l3-* 等"减压块"在玩家视角下违和（"我还没遇到困难，怎么就来救济？"）
     *   - 与 §10.7 设计原则一致：special 是"事件注入"——必须有明确的局内事件触发，新局开局没有事件
     *   - 与 game.js warmupRemaining 哲学一致：前 N 轮渐进过渡，避免任何"非常规"决策干扰
     *
     * 阈值 5 = roundsSinceSpecial 间隔门同源（既然间隔 ≥ 5 才能注入，warmup 也 ≥ 5 自然衔接）。
     *
     * 兼容性：旧调用方 ctx 若未显式提供 totalRounds（undefined）则跳过本 gate；
     * game.js _spawnContext 总会带 totalRounds（初始化 0，每次 _commitSpawn ++）→ 实际生效。 */
    const totalRounds = ctx?.totalRounds;
    if (Number.isFinite(totalRounds) && totalRounds < 5) return null;

    /* === Step 1.7：v1.60.7 fill 下限保护 ===
     *
     * relief（减压）：玩家必须身处实质对弈期（fill ≥ 0.25），空盘谈不上"需要救济"——
     *   即使 pcSetup 因边界条件错误返回 ≥ 1，这道门也兜底"空盘出 1x2 救济块"的违和注入。
     * pressure（加压）：fill ≥ 0.10（避免新开局立即出 diag-3 散点造孤洞，玩家还没建立心智）
     *
     * 这是"代码事实满足条件"与"玩家体验语义"之间的最后保险——
     * §10.7 special 的核心使命是回应**真实场景**，空盘不构成场景。
     *
     * 兼容性：fill 是 number（generateDockShapes 强制 grid.getFillRatio()），无空保护需要。 */
    if (isRelief && fill < 0.25) return null;
    if (isPressure && fill < 0.10) return null;

    /* === Step 1.8：v1.60.8 清盘候选保护（前置门） ===
     *
     * "清盘逻辑"严格定义：放置候选块、或多个候选块按特定顺序放置后，盘面全部消除。
     *   - 单步可达：chosenMeta 中某块 pcPotential === 2（bestPerfectClearPotential 已验证）
     *   - 多步可达：3 块按某序放置后清空 —— 当前未做精确枚举，但单步可达必蕴含多步可达
     *
     * 若 chosen 已含真清盘候选（pcPotential >= 2），整体跳过 relief 注入：
     *   - reliefSignal 的核心 `hasClearSetup = pcSetup >= 1` 与清盘准备期同时触发
     *   - 两路径都在"清盘期"生效 → reliefSignal 想塞减压块 vs spawn 路径已给出清盘候选
     *   - 这是 v1.60.7 截图根因：chosen 三块都标 "送清屏" 但中间被替换成 1x3，
     *     清盘候选阵容被破坏。让清盘机会跑赢减压注入。
     *
     * 注：pressure 注入不受影响——pressure 与 clear 不直接冲突，pressure intent 玩家
     *      主动选难度，让 1x3 替代清盘候选反而违背意图。 */
    if (isRelief && chosenMeta.some(m => (m?.pcPotential ?? 0) >= 2)) {
        return null;
    }

    /* === Step 1.85：v1.60.9 多步可达清盘保护 ===
     *
     * Step 1.8 拦截了"单步可达"（chosen 含 pcPotential>=2）。
     * 但用户对"清盘逻辑"的严格定义是 **多个候选块按特定顺序放置后盘面清空** ——
     * 即使没有任一单块能清盘，三块组合可能存在某顺序能清盘。
     * 这个组合若被破坏（特殊块注入替换其中一块），玩家就失去了多步 PC 机会。
     *
     * 触发条件（窄）：
     *   - isRelief（仅减压注入需保护；pressure 不冲突 clear，且 Step 4 槽兜底）
     *   - pcSetup >= 1（几何上有清盘准备期 → 才有必要做多步枚举，避免无谓性能开销）
     *
     * 性能：canTripletPerfectClear 自带 budget=8000 模拟保护，超 budget 保守返 false，
     * 即"探测失败时按可注入处理"——不阻塞主流程。 */
    if (isRelief && (pcSetup ?? 0) >= 1) {
        if (canTripletPerfectClear(grid, triplet, { budget: 8000 })) {
            return null;
        }
    }

    /* === Step 1.86：v1.60.37 → v1.60.44 chosen 已具强消行能力时兜底抑制 relief ===
     *
     * **v1.60.44 关系澄清**：
     *   信号层（Step 1）已对 reliefTrigger='multiClear'（消行触发）做压制——chosen 有
     *   ≥1 块 multiClear≥1 时该触发不激活。本 gate 是兜底的"硬抑制"，覆盖 pcSetup /
     *   exactFit 两条 trigger 路径：chosen 已稳消 ≥2 行时，即使 pcSetup/exactFit 信号
     *   激活，relief 注入的边际收益已被 chosen 的强消行能力压扁——special 是"事件注入"，
     *   主路径已给出充足消行就不该再加配菜（v1.60.37 R11 截图根因）。
     *
     * 拦截条件（窄）：
     *   - isRelief 且触发不是 monoFlush（同色消行的 ×5 倍 iconBonus 不可被普通消行替代）
     *   - chosenMeta 中 multiClear>=1 的块数 ≥ 2（**两块**而非一块——
     *     单块消行候选可能被替换为更强候选，三块全保留才是最稳）
     */
    if (isRelief && reliefTrigger !== 'monoFlush') {
        const chosenMultiClearCount = chosenMeta.filter(m => (m?.multiClear ?? 0) >= 1).length;
        if (chosenMultiClearCount >= 2) {
            return null;
        }
    }

    /* === Step 2：节流（间隔 + 双层上限） ===
     *
     * v1.60.1 Issue 2 修复：与 game.js `_commitSpawn` 改造配合，roundsSinceSpecial 已在
     * generateDockShapes 入口 +1，此处直接读即可获得"自上次注入后已 spawn 的轮数"。
     *
     * v1.60.6 缺口 #1 修复 — 拆 relief / pressure 配额：
     *   - 全局上限保留（`max(totalClears×10%, 3)`）—— 防止整体喷过头
     *   - 子配额（`reliefSubLimit / pressureSubLimit`）—— 保证两类不会互相吃掉对方配额
     *
     * 双层 gate 同时满足才允许通过。 */
    if ((ctx.roundsSinceSpecial ?? 0) < 5) return null;

    const globalUsed = ctx.specialShapeUsed ?? 0;
    const globalLimit = Math.max(Math.floor((ctx.totalClears ?? 0) * 0.1), 3);
    if (globalUsed >= globalLimit) return null;

    /* v1.60.6：解析覆写（默认 SPECIAL_RELIEF/PRESSURE_SHAPES + SPECIAL_SHAPE_WEIGHTS） */
    const pools = _resolveSpecialPools(ctx);
    const totalClears = ctx.totalClears ?? 0;
    const reliefSubLimit = Math.max(Math.floor(totalClears * pools.reliefLimitFactor), 2);
    const pressureSubLimit = Math.max(Math.floor(totalClears * pools.pressureLimitFactor), 2);

    const subUsed = isRelief
        ? (ctx.specialReliefUsed ?? 0)
        : (ctx.specialPressureUsed ?? 0);
    const subLimit = isRelief ? reliefSubLimit : pressureSubLimit;
    if (subUsed >= subLimit) return null;

    /* === Step 3：候选池（按可放置过滤 + 形状权重排序，v1.60.6 缺口 #2） ===
     *
     * 旧版用 fisherYatesInPlace(uniform) 随机化顺序，等概率枚举 candidate；
     * 新版按 SPECIAL_SHAPE_WEIGHTS（含覆写）做"加权抽签排序"——把当前权重最高的
     * 候选最先尝试，次高第二，依此类推。当某 candidate 因 hard constraint 复校失败时，
     * 仍能降级到下一权重档，行为退化到旧的"全枚举"形式。 */
    const pool = isRelief ? pools.relief : pools.pressure;
    const allShapes = getAllShapes();
    const candidates = allShapes.filter(
        s => pool.includes(s.id) && grid.canPlaceAnywhere(s.data)
    );
    if (candidates.length === 0) return null;

    /* 加权抽签排序：连续 N 次 pickWeighted（不重复抽），形成"按权重期望"的尝试序列；
     * pickWeighted 内部已用注入 rng，daily / replay 仍可复现。 */
    const weighted = candidates
        .map(s => ({ shape: s, w: Math.max(1, pools.weights[s.id] ?? 1) }));
    let candidateOrder = [];
    const remaining = weighted.slice();
    while (remaining.length > 0) {
        const picked = pickWeighted(remaining, rng);
        candidateOrder.push(picked.shape);
        const idx = remaining.indexOf(picked);
        if (idx >= 0) remaining.splice(idx, 1);
    }

    /* v1.60.23：monoFlush 触发时，方向 + 尺寸匹配的小竖/横块优先尝试。
     *
     * 匹配规则（仅 empty=2 才有靠注入捕获的价值——empty=1 的 monoFlush 任何形状的主路径
     * scoreShape · bestMonoFlushPotential 都能识别，不必走特殊池）：
     *   - row 上连续 2 空 → 提升 1x2（横块 [[1,1]]）
     *   - col 上连续 2 空 → 提升 2x1（竖块 [[1],[1]]）
     *
     * 优先级提升 ≠ 强制选定：若 1x2/2x1 在槽位复校失败（如 newTriplet 被
     * validateSpawnTriplet 判 duplicate-shape 等硬约束拒绝），仍降级到权重表的其他候选，
     * 行为退化到 v1.60.6 加权抽签序列。 */
    if (monoFlushSignal) {
        const targetIds = new Set();
        for (const line of monoFlushLines) {
            if (line.empty !== 2) continue;
            const cs = line.emptyCells;
            const adjacent = (line.type === 'row' && Math.abs(cs[0].x - cs[1].x) === 1)
                || (line.type === 'col' && Math.abs(cs[0].y - cs[1].y) === 1);
            if (!adjacent) continue;
            targetIds.add(line.type === 'row' ? '1x2' : '2x1');
        }
        if (targetIds.size > 0) {
            const priority = candidateOrder.filter(s => targetIds.has(s.id));
            const rest = candidateOrder.filter(s => !targetIds.has(s.id));
            candidateOrder = [...priority, ...rest];
        }
    }

    /* === Step 4：智能 replaceIdx（Issue 6 + v1.60.8 槽保护增强） ===
     *
     * 按 chosenMeta[i] 的"重要性评分"升序枚举槽位，优先替换最弱的（fallback / 评分低）。
     * 评分公式（越高越重要、越不应被替换）：
     *   weighted_score = pcPotential*4 + multiClear*2 + gapFills + (placements / 50)
     *
     * fallback / reason='special-relief'/'special-pressure' 这类无评分的 slot 默认评分 0，
     * 自然优先替换。
     *
     * v1.60.8 槽保护硬约束（兜底 Step 1.8）：
     *   pcPotential >= 2 的槽位（真清盘候选）从 slotPriority 整体过滤掉——绝不替换。
     *   这道兜底覆盖 pressure 注入路径（Step 1.8 仅拦截 relief）和
     *   ctx.specialOverride 调高加压配额场景下"加压块抢走清盘机会"的边界。
     *   若过滤后无槽可换 → 放弃注入，return null（与 candidate 全 unplaceable 同义）。 */
    const slotPriority = chosenMeta.slice(0, 3).map((m, i) => ({
        idx: i,
        score: (m?.pcPotential ?? 0) * 4
             + (m?.multiClear  ?? 0) * 2
             + (m?.gapFills    ?? 0)
             + ((m?.placements ?? 0) / 50),
    }))
        .filter(s => (chosenMeta[s.idx]?.pcPotential ?? 0) < 2)
        .sort((a, b) => a.score - b.score);

    if (slotPriority.length === 0) return null;

    /* === Step 5：候选 × 槽位 双层枚举 + 注入后复校（Issue 1） === */
    for (const candidate of candidateOrder) {
        for (const { idx: replaceIdx } of slotPriority) {
            const newTriplet = [...triplet];
            const newMeta = [...chosenMeta];

            const originalShape = newTriplet[replaceIdx];
            const originalMeta = newMeta[replaceIdx];

            newTriplet[replaceIdx] = candidate;
            /* === v1.60.38 Bug 修复：monoFlush 命中判定从"看 id"改为"真模拟" ===
             *
             * **截图复盘**（R24 / harvest / fill=0.44 / row 7 差 2 格）：
             * `findNearFullMonoLines` 命中 row 7（type='row'，empty=2），Step 3 候选
             * 排序把 1×2 排前，但 1×2 在所有槽位 validateSpawnTriplet 失败（如 duplicate-id
             * 等硬约束），candidate 降级到 **2×1（竖块）**。旧版 `isMonoFlushCandidate`
             * 仅判 `candidate.id ∈ {1×2, 2×1}` → 2×1 也满足 → 标 'special-monoFlush' +
             * topDriver "补满同色1线" → **labeling 撒谎**：2×1 是竖块，无法落在 row 7 的
             * **横向**2 格空缺上，玩家以为放下能 ×5 倍奖励，实际放在任何列都不会触发。
             *
             * **新版严格定义**（与 scored 数组的 monoFlush 字段同口径）：
             * 用 `grid.bestMonoFlushPotential(candidate.data, skin)` 真模拟枚举所有
             * 合法 placement，判定"shape 放下后是否消行 + 全 line 同 icon"——
             * **count >= 1 才算 monoFlush 命中**。同时返回 targetCi 透传给染色阶段
             * （game.js:1613）锁定 shape 颜色 = line 同色，确保几何潜力真转化为实际同花。
             *
             * 不满足时降级 reason='special-relief'，topDriver=特殊减压，DFV 不撒谎。 */
            const isMonoFlushSizeCandidate = isRelief && monoFlushSignal && allowMonoFlushLabel
                && (candidate.id === '1x2' || candidate.id === '2x1');
            let injMonoFlushCount = 0;
            let injMonoFlushTargetCi = null;
            if (isMonoFlushSizeCandidate && typeof grid.bestMonoFlushPotential === 'function') {
                const res = grid.bestMonoFlushPotential(candidate.data, ctx?.skin || null, { returnTarget: true });
                injMonoFlushCount = res?.count || 0;
                injMonoFlushTargetCi = Number.isInteger(res?.targetCi) ? res.targetCi : null;
            }
            const isMonoFlushCandidate = injMonoFlushCount >= 1;
            newMeta[replaceIdx] = {
                shape: candidate,
                placements: countLegalPlacements(grid, candidate.data),
                reason: isMonoFlushCandidate
                    ? 'special-monoFlush'
                    : (isRelief ? 'special-relief' : 'special-pressure'),
                topDriver: isMonoFlushCandidate
                    ? { key: 'monoFlush', label: `补满同色${injMonoFlushCount}线` }
                    : { key: isRelief ? 'relief' : 'pressure', label: isRelief ? '特殊减压' : '特殊加压' },
                /* v1.60.38：monoFlush 真命中才写 count + targetCi。
                 *   - monoFlush: game.js 染色绑定 game.js:1613 触发条件之一
                 *   - monoFlushTargetCi: 染色阶段强制 dockColors[i] = targetCi，
                 *     确保 shape 颜色匹配 line 同色，几何潜力 → 实际 ×5 倍 iconBonus */
                monoFlush: isMonoFlushCandidate ? injMonoFlushCount : 0,
                monoFlushTargetCi: isMonoFlushCandidate ? injMonoFlushTargetCi : null,
                /* Issue 7 / v1.60.6：audit trail —— DFV ⚡ badge 即从这些字段渲染：
                 *   original / originalMeta : 被替换的原 shape + 原决策摘要
                 *   injectedAt              : 槽位索引
                 *   subType                 : 'relief' | 'pressure' —— v1.60.6 新增，
                 *                              方便 DFV/分析按 relief/pressure 分类聚合 */
                original: originalShape,
                originalMeta: { reason: originalMeta?.reason, topDriver: originalMeta?.topDriver },
                injectedAt: replaceIdx,
                /* v1.60.38：subType 细分严格走 `isMonoFlushCandidate`（真模拟通过），
                 * 与 reason/topDriver/monoFlushTargetCi 三字段保持一致语义。
                 * 旧版按 `candidate.id ∈ {1×2, 2×1}` 判定 → 与 reason 一起撒谎，
                 * 导致 ctx.specialReliefUsed 误计为 monoFlush 子类。 */
                subType: isRelief
                    ? (isMonoFlushCandidate ? 'monoFlush' : 'relief')
                    : 'pressure',
                /* v1.60.7：spawn 时上下文快照 —— 供 DFV / replay 审计"为什么这一刻能注入"。
                 * 记录注入决策那一刻的 fill / pcSetup / holesSignal / totalRounds，
                 * 当后续玩家觉得"这块出得不合理"时可对照排查。 */
                spawnCtx: {
                    fill: Number.isFinite(fill) ? Number(fill.toFixed(3)) : null,
                    pcSetup: pcSetup ?? 0,
                    holesSignal,
                    totalRounds,
                    intent: intent ?? null,
                    /* v1.60.44：reliefTrigger 记录"该轮 relief 注入是被哪个触发激活的"，
                     * 取值范围 'pcSetup' | 'exactFit' | 'multiClear' | 'monoFlush' | null
                     * （null 仅 pressure 注入），DFV/审计/分析可按触发类型聚合统计。 */
                    reliefTrigger: isRelief ? reliefTrigger : null,
                    /* v1.60.23：monoFlush 触发时附带"近满同色 line 摘要"，
                     * DFV tooltip / 审计可追溯"为什么注入了 2×1 而不是其他"。 */
                    monoFlushLines: monoFlushSignal
                        ? monoFlushLines.map(l => ({ type: l.type, idx: l.idx, empty: l.empty }))
                        : null,
                },
            };

            /* Issue 1：注入后调用 validateSpawnTriplet 复校；任一硬约束失败则
             * 试下一槽位 → 下一 candidate；全失败则放弃注入，返回原 triplet。 */
            const validation = validateSpawnTriplet(grid, newTriplet);
            if (validation?.ok) {
                /* === Bug C 修复（v1.60.37）：注入后事后复算"块实际能消行"，
                 * 避免 DFV labeling 与块真实能力背离 ===
                 *
                 * 旧：注入块 reason 一律 'special-relief'/'special-pressure'，
                 *   DFV 标"送减压"——但 1×2/L 块在某些盘面恰好能补满某行/列剩 2 格
                 *   空缺 → **实际能消行**，玩家看"送减压"会误判它"不能消行"，
                 *   损失"先放它兑现 + 主路径块续 combo"的清晰规划心智。
                 *
                 * 新：用 bestMultiClearPotential 真模拟复算注入块在当前 grid 上的最优消行能力，
                 *   若 ≥1 → reason 升级为 'clear'，topDriver 改"可消N行"，与主路径"送消行"
                 *   块同语义。audit trail 字段（subType / spawnCtx / original / originalMeta /
                 *   injectedAt）全保留——DFV ⚡ badge 仍能展开"该块来自注入" + 配额计数
                 *   （ctx.specialReliefUsed 走 inj.subType）不受影响。
                 *
                 * 例外：monoFlush 注入块（isMonoFlushCandidate=true）保留独立 reason
                 *   'special-monoFlush'——"补满同色线 → ×5 倍 iconBonus" 是独立爽点，
                 *   不能被通用 'clear' 覆盖（DFV 紫粉色 monoFlush 徽章 / hub 同花顺解读
                 *   都依赖此 reason）。 */
                if (!isMonoFlushCandidate) {
                    const injMc = bestMultiClearPotential(grid, candidate.data);
                    if (injMc >= 1) {
                        newMeta[replaceIdx].reason = 'clear';
                        newMeta[replaceIdx].topDriver = { key: 'clear', label: `可消${injMc}行` };
                        newMeta[replaceIdx].multiClear = injMc;
                        newMeta[replaceIdx].reasonUpgradedFrom = isRelief
                            ? 'special-relief'
                            : 'special-pressure';
                    }
                }
                return {
                    triplet: newTriplet,
                    chosenMeta: newMeta,
                    isRelief,
                    injected: candidate.id,
                    replaceIdx,
                    subType: newMeta[replaceIdx].subType,
                    spawnCtx: newMeta[replaceIdx].spawnCtx,
                    /* v1.60.44：导出 reliefTrigger 供 game.js / spawnDiagnostics 直读，
                     * 避免下游再从 spawnCtx 里挖。pressure 注入时返回 null。 */
                    reliefTrigger: isRelief ? reliefTrigger : null,
                };
            }
        }
    }

    /* 所有 candidate × 所有 replaceIdx 都校验失败：放弃注入 */
    return null;
}

/**
 * v1.60.21 ——「重复注入」配置：高/极度 novelty 场景下小概率允许 chosen 中出现重复 shape。
 *
 * **用户需求**（截图反馈）：
 *   - **高度新奇**（`novelty ≥ HIGH_THRESHOLD`，默认 0.65）：小概率允许 2 个候选块相同；
 *   - **极度新奇**（`novelty ≥ EXTREME_THRESHOLD`，默认 0.85）：允许 3 个候选块相同；
 *   - **单局累积**两者合计 ≤ `MAX_PER_RUN`（默认 3 次）；
 *   - **轮次间隔** > `MIN_ROUND_GAP`（默认 10，即至少间隔 11 轮）。
 *
 * **触发概率**（"小概率"）：
 *   - HIGH：5% 概率注入 dup2；
 *   - EXTREME：10% 概率注入——其中 50% dup2 / 50% dup3。
 *
 * **节流计数**（驻留 `ctx.dupInjectUsed` / `ctx.roundsSinceDupInject`）：
 *   - 由 `game.js` 在 `spawnBlocks` 入口 `roundsSinceDupInject++`、`_commitSpawn` 时若注入归 0；
 *   - `dupInjectUsed` 由 `generateDockShapes` 在调用 `_tryInjectDuplicates` 成功后 +1。
 *
 * **与 `_tryInjectSpecial` 互斥**：同一轮若已注入 special shape，跳过 duplicate 注入
 * （避免叠加 2 项不可解释的"特殊化"事件，让 DFV/可解释面板叙事简洁）。
 */
const DUP_INJECT_CONFIG = Object.freeze({
    HIGH_THRESHOLD:    0.65,
    EXTREME_THRESHOLD: 0.85,
    PROB_HIGH:         0.05, /* dup2 概率 */
    PROB_EXTREME:      0.10, /* dup2 or dup3 总概率 */
    PROB_DUP3_GIVEN_EXTREME: 0.5, /* extreme 内部 dup2 vs dup3 五五开 */
    MAX_PER_RUN:       3,
    MIN_ROUND_GAP:     10,
});

/**
 * v1.60.21 ——「重复注入」：根据 novelty 高/极度阈值 + 节流，把 chosen 中 N 个槽位替换为
 * 与"主块"相同的 shape，制造"双胞胎/三胞胎"特殊视觉/玩法瞬间。
 *
 * 流程：
 *   Step 1 — 门控：novelty 阈值 + 单局配额 + 轮次间隔 + 与 special 注入互斥；
 *   Step 2 — 概率掷点：HIGH→PROB_HIGH dup2；EXTREME→PROB_EXTREME 内部 50/50 dup2/dup3；
 *   Step 3 — 选主块：从 chosenMeta 中选 placements 最多者（最大 dup3 仍可解的安全网）；
 *   Step 4 — 选副槽：dup2 选除主槽外评分最低 1 个槽位；dup3 选其他 2 个槽位；
 *   Step 5 — 注入 + 复校：复制主块替换副槽 shape 与 data；调 `validateSpawnTriplet({allowDuplicates:true})`；
 *   Step 6 — 失败 revert：若复校 fail（如 dup3 三大块顺序不可解），还原全部副槽并返回 null。
 *
 * **chosenMeta 标记**（DFV 渲染 ⧈ badge 与 audit trail）：
 *   - 副槽 meta 标 `duplicateGroup: 'dup2' | 'dup3'`，`duplicateRole: 'replica'`，`originalShape`/`originalMeta` 保留；
 *   - 主槽 meta 标 `duplicateRole: 'main'`，便于 DFV 高亮主块"被复制"的因。
 *
 * @param {Array} triplet      三连块（in-place 修改）
 * @param {Array} chosenMeta   chosen 元数据（in-place 修改）
 * @param {object} hints       layered.spawnHints（读 spawnTargets.novelty）
 * @param {object} ctx         spawnContext（读/写 dupInjectUsed / roundsSinceDupInject）
 * @param {import('../grid.js').Grid} grid
 * @param {{ rng?: () => number, specialInjected?: boolean }} [opts]
 * @returns {null | { mode: 'dup2'|'dup3', mainIdx: number, replicaIdxs: number[] }}
 */
function _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, opts = {}) {
    /* Step 1 — 与 special 注入互斥：同一轮已注入 special 则跳过 dup */
    if (opts.specialInjected === true) return null;

    /* 基础参数 */
    const cfg = DUP_INJECT_CONFIG;
    const novelty = Math.max(0, Math.min(1, hints?.spawnTargets?.novelty ?? 0));
    const usedRun = Number(ctx?.dupInjectUsed) || 0;
    const roundsSince = Number(ctx?.roundsSinceDupInject) || 0;

    /* 门控 1：单局配额 */
    if (usedRun >= cfg.MAX_PER_RUN) return null;
    /* 门控 2：轮次间隔（"大于10" → roundsSince ≤ 10 时拒绝） */
    if (roundsSince <= cfg.MIN_ROUND_GAP) return null;
    /* 门控 3：novelty 阈值 */
    if (novelty < cfg.HIGH_THRESHOLD) return null;
    /* 门控 4：triplet 完整 */
    if (!Array.isArray(triplet) || triplet.length < 3) return null;
    if (!Array.isArray(chosenMeta) || chosenMeta.length < 3) return null;

    const rng = typeof opts.rng === 'function' ? opts.rng : defaultRng;

    /* Step 2 — 概率掷点 + 模式判定 */
    let mode = null;
    if (novelty >= cfg.EXTREME_THRESHOLD) {
        if (rng() < cfg.PROB_EXTREME) {
            mode = rng() < cfg.PROB_DUP3_GIVEN_EXTREME ? 'dup3' : 'dup2';
        }
    } else if (rng() < cfg.PROB_HIGH) {
        mode = 'dup2';
    }
    if (!mode) return null;

    /* Step 3 — 选主块：placements 最多者（dup3 仍可解的安全网），平级取 driver 评分高者 */
    const driverScore = (m) => {
        const k = m?.topDriver?.key;
        /* 优先级评分：pcPotential > monoFlush > exactFit > multiClear > 其他 */
        if (k === 'pcPotential') return 100;
        if (k === 'monoFlush') return 80;
        if (k === 'exactFit') return 70;
        if (k === 'multiClear') return 50;
        if (k === 'gapFills') return 30;
        return 10;
    };
    const ranked = chosenMeta
        .map((m, i) => ({ i, placements: m?.placements ?? 0, drv: driverScore(m) }))
        .sort((a, b) => (b.placements - a.placements) || (b.drv - a.drv));
    const mainIdx = ranked[0].i;

    /* dup2 安全护栏：主块 placements < 6 时拒绝（2 块同形需至少 6 个落点避免互相挤死） */
    if (mode === 'dup2' && (chosenMeta[mainIdx].placements ?? 0) < 6) return null;
    /* dup3 安全护栏：主块 placements < 9 → 拒绝（3 块同形需至少 9 个落点） */
    if (mode === 'dup3' && (chosenMeta[mainIdx].placements ?? 0) < 9) return null;

    /* Step 4 — 选副槽 */
    const others = ranked.slice(1); /* 已按 placements desc */
    const replicaIdxs = mode === 'dup3'
        ? [others[0].i, others[1].i]
        : [others[others.length - 1].i]; /* dup2 替换评分最低槽 */

    /* Step 5 — 注入：复制主块的 shape ref 到副槽（in-place 备份） */
    const mainShape = triplet[mainIdx];
    const backup = replicaIdxs.map((i) => ({
        idx: i, shape: triplet[i], meta: chosenMeta[i],
    }));

    for (const i of replicaIdxs) {
        triplet[i] = mainShape;
        /* 复制主块 meta 的评分字段；标 duplicateGroup + duplicateRole 给 DFV/可解释面板 */
        const mainMeta = chosenMeta[mainIdx];
        chosenMeta[i] = {
            ...chosenMeta[i],
            shape: mainShape,
            placements: mainMeta.placements,
            topDriver: { key: 'duplicate', label: mode === 'dup3' ? '三胞胎·新奇' : '双胞胎·新奇' },
            pcPotential: mainMeta.pcPotential ?? 0,
            multiClear:  mainMeta.multiClear ?? 0,
            gapFills:    mainMeta.gapFills ?? 0,
            exactFit:    mainMeta.exactFit ?? 0,
            monoFlush:   mainMeta.monoFlush ?? 0,
            /* v1.60.21 audit trail：保留被替换的原 shape/meta，DFV 可渲染 ⧈ badge 解释。
             * 不存 mainIdx：fisherYates 洗牌后 idx 失效，依赖 duplicateRole 反查更稳。 */
            duplicateGroup: mode,
            duplicateRole: 'replica',
            originalShape: backup.find(b => b.idx === i)?.shape,
            originalMeta: { ...backup.find(b => b.idx === i)?.meta },
            injectedAt: Number(ctx?.totalRounds) || 0,
        };
    }
    /* 主槽也标 role，便于 DFV 高亮"被复制的因" */
    chosenMeta[mainIdx] = {
        ...chosenMeta[mainIdx],
        duplicateGroup: mode,
        duplicateRole: 'main',
    };

    /* Step 6 — 复校：3 块同形可能违反 sequentially-solvable → revert */
    const validation = validateSpawnTriplet(grid, triplet, { allowDuplicates: true });
    if (!validation.ok) {
        /* revert：原 backup 还原 */
        for (const b of backup) {
            triplet[b.idx] = b.shape;
            chosenMeta[b.idx] = b.meta;
        }
        /* 主槽 role 也清除 */
        const { duplicateGroup: _dg, duplicateRole: _dr, ...mainRest } = chosenMeta[mainIdx];
        chosenMeta[mainIdx] = mainRest;
        return null;
    }

    return { mode, mainIdx, replicaIdxs: [...replicaIdxs] };
}

/** @type {object | null} 上一轮出块诊断，供面板展示 */
let _lastDiagnostics = null;

/** 获取最近一次出块诊断信息 */
function getLastSpawnDiagnostics() {
    return _lastDiagnostics;
}

/**
 * v1.60.1（Issue 4）：加权抽签支持注入 rng。
 *
 * 默认行为不变（Math.random）。daily / replay / A/B 模式可传 mulberry32 让加权决策
 * 可复现，与 _tryInjectSpecial / fisherYatesInPlace 形成全链路 seeded 随机性。
 *
 * @template T
 * @param {Array<T & { w: number }>} pool
 * @param {() => number} [rng]
 */
const pickWeighted = (pool, rng) => {
    const r = rng ?? defaultRng;
    const totalWeight = pool.reduce((sum, s) => sum + s.w, 0);
    if (totalWeight <= 0) return pool[0];
    let rand = r() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
        rand -= pool[i].w;
        if (rand <= 0) return pool[i];
    }
    return pool[pool.length - 1];
};

/**
 * v1.32+v1.60.0 → v1.60.1：兜底选块时排除特殊形状。
 *
 * 历史方案：靠 12 次重抽 + 概率收敛（约 99.96% 命中非特殊）。
 * 当前方案（Issue 5 根因修复）：`pickShapeByCategoryWeights` 默认 `includeSpecial=false`，
 *   数据源已切断特殊形状泄漏 → 单次抽签即足够。本函数仅作为语义清晰的别名保留，
 *   防御性兜底逻辑（grid.canPlaceAnywhere check）由调用方负责。
 */
function _pickFallbackSafe(weights) {
    return pickShapeByCategoryWeights(weights);
}

/**
 * v1.32+v1.60.0 → v1.60.1：最终安全网 — 替换 arr 中任何特殊形状为非特殊随机块。
 *
 * v1.60.1 后此函数主要供 **模型路径**（_spawnBlocksWithModel）防御使用——SpawnTransformer
 * checkpoint 的 vocab 仍含 40 个 id（含 special），若推理结果含 special 必须 sanitize。
 * Rule 路径理论上不应再触发本函数（数据源已切断 + gate + post-validate 三重防御）；
 * 保留作为最后一道防线（depth-in-defense）。
 */
function _sanitizeShapeArr(arr, grid, weights) {
    for (let i = 0; i < arr.length; i++) {
        if (isSpecialShapeId(arr[i].id)) {
            const safe = _pickFallbackSafe(weights);
            if (safe && grid.canPlaceAnywhere(safe.data)) {
                arr[i] = safe;
            } else {
                const all = getAllShapes().filter(s => !isSpecialShapeId(s.id) && grid.canPlaceAnywhere(s.data));
                if (all.length > 0) arr[i] = all[Math.floor(Math.random() * all.length)];
            }
        }
    }
}

/** v1.32+v1.60.0 → v1.60.1：检查 shapes 数组是否包含特殊形状（供 game.js 模型路径使用） */
function hasSpecialShape(shapes) {
    return Array.isArray(shapes) && shapes.some(s => isSpecialShapeId(s.id));
}

/**
 * @param {import('../grid.js').Grid} grid
 * @param {object} strategyConfig
 * @param {object} [spawnContext] 来自 game.js 的跨轮上下文
 * @returns {Array<{ id: string, name?: string, category: string, data: number[][] }>}
 */
function generateDockShapes(grid, strategyConfig, spawnContext) {
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

    /* v1.60.24 — monoFlush 信号放行特殊形状进主路径：
     *
     * 旧 v1.60.23 把 monoFlush 触发推迟到 `_tryInjectSpecial`，但那条路径受 8 道 gate
     * 制约（warmup / fill / 单/多步 PC / 节流 / 全局上限 / 子配额 / 复校）——对
     * "近满同色 line"这种**局内随时可发生**的高 payoff 信号过严：
     *   - 任一 gate 拒绝 → monoFlush 注入完全失效（截图复现的场景）；
     *   - 主路径 `scored` 列表中又没有 1×2/2×1（被 _passesShapeGate 一刀切拒绝）；
     *   - 形成"两层都未命中"悖论。
     *
     * **修复**：检测到 monoFlushSignal 后，把方向 + 尺寸匹配的特殊形状（1×2 / 2×1）
     * **临时放行**进入 scored 列表——
     *   - `scoreShape × monoFlush × iconBonusTarget` 加权（v1.60.19）会让它高分；
     *   - `_estimateTopDriver` 走 monoFlush 分支 → DFV 显示"可凑N同花顺"；
     *   - 不受 8 道注入 gate 限制（这些 gate 是为"稀有事件"设计），但仍受
     *     `validateSpawnTriplet` 硬约束（duplicate-shape / low-mobility / 可解性）保护。
     *
     * **方向匹配规则**（只放行真正能补满同色 line 的尺寸/方向）：
     *   - empty=1 line：主路径任意 shape 占 1 cell 即可命中，不需要放行特殊形状；
     *   - empty=2 line + 2 空连续：row 方向 → 放行 '1x2'；col 方向 → 放行 '2x1'；
     *   - empty=2 line + 2 空不相邻：无法补满，不放行。
     *
     * **与 _tryInjectSpecial 关系**：保留 _tryInjectSpecial 的 monoFlush 兜底——
     * 当主路径加权未能让 1×2/2×1 进 chosen（例如其他形状有更高 multiClear/pcPotential
     * 抢占）时，仍有第二道命中通道。 */
    const skin = ctx?.skin ?? null;
    const monoFlushLines = (typeof grid.findNearFullMonoLines === 'function')
        ? grid.findNearFullMonoLines(skin)
        : [];

    /* v1.60.34：cap 0.30→0.10，斜率 0.05→0.017，0.02→0.007（同花降 2/3 让位给清屏）*/
    const monoFlushNearLines = monoFlushLines.filter(l => l.empty <= 2).length;
    const monoFlushBuildupLines = monoFlushLines.filter(l => l.empty >= 3 && l.empty <= 5).length;
    const adaptiveMonoFlushProbability = Math.min(MONO_FLUSH_PROB_CAP, Math.max(
        MONO_FLUSH_PICK_PROBABILITY,
        MONO_FLUSH_PICK_PROBABILITY + monoFlushNearLines * 0.017 + monoFlushBuildupLines * 0.007
    ));

    /* v1.60.28（保留注释供历史参考）：每轮 dock 25% 概率开放 monoFlush 评估。
     *   - 命中（25%）：scored 正常评估 monoFlush + targetCi，1×2/2×1 放行进 scored，
     *     scoreShape 加权让 chosen 大概率含 monoFlush 候选，driver 标 "可凑N同花顺"，
     *     v1.60.27 染色绑定保证玩家放下 100% 触发 ×5 iconBonus。
     *   - 未命中（75%）：所有 shape 的 monoFlush=0，driver 不会标 'monoFlush'，
     *     1×2/2×1 仍走原 _passesShapeGate 拒绝（不破坏特殊形状常规独立池语义）。
     *
     * **设计动机**：v1.60.19~27 修复了同花顺判定与染色绑定的正确性，但 100% 命中
     * 让同花顺成为常态遮蔽其他乐趣（multiClear/pcPotential/exactFit）。25% 概率
     * ≈ 玩家每 4 次 dock 命中 1 次，足够提供惊喜感而不喧宾夺主。pcPotential（清屏）
     * 仍 100% 优先（终极目标不节流）。 */
    const monoFlushRound = Math.random() < adaptiveMonoFlushProbability;
    const monoFlushAllowIds = new Set();
    /* v1.60.30：识别 always-on —— monoFlushAllowIds 始终基于盘面真实信号 populate */
    for (const line of monoFlushLines) {
        if (line.empty !== 2) continue;
        const cs = line.emptyCells;
        const adjacent = (line.type === 'row' && Math.abs(cs[0].x - cs[1].x) === 1)
            || (line.type === 'col' && Math.abs(cs[0].y - cs[1].y) === 1);
        if (!adjacent) continue;
        monoFlushAllowIds.add(line.type === 'row' ? '1x2' : '2x1');
    }

    const scored = allShapes
        .map((shape) => {
            const canPlace = grid.canPlaceAnywhere(shape.data);
            if (!canPlace) return null;
            /* v1.60.0 形状池扩展 P1：严格按"加减压策略"对新增 12 个 shape 做 gate + 加权。
             * gate 在"可放置"过滤之后立即执行，未通过 gate 的 shape 完全退出本轮 scored 集合，
             * 保证下游 weighted/clear/perfectClear 多路径全部共享同一 candidate set。
             *
             * v1.60.24 monoFlush 例外：方向匹配的特殊形状（1×2/2×1）在 monoFlush 信号下放行
             * 进入 scored，让主路径加权直接命中（详见上方 monoFlushAllowIds 注释）。 */
            if (monoFlushAllowIds.has(shape.id)) {
                /* 放行，跳过 _passesShapeGate 拒绝；下游 scoreShape × monoFlush 加权接力 */
            } else if (!_passesShapeGate(shape, hints, profile, ctx, fill)) { // eslint-disable-line no-use-before-define
                return null;
            }
            const gapFills = grid.countGapFills(shape.data);
            const category = getShapeCategory(shape.id);
            let weight = weights[category] ?? 1;
            const placements = countLegalPlacements(grid, shape.data);

            /* 不再依赖 gapFills 才算 multiClear — 否则「差 4 格满行」等形状长期 multiClear=0 */
            const multiClear = bestMultiClearPotential(grid, shape.data);
            let holeReduce = 0;
            let pcPotential = 0;
            /* v1.60.18：exactFit 完美卡入契合度 ∈ [0,1]——shape 外周邻居中已填/边界的比例。
             * 配合 scoreShape 加权和 _estimateTopDriver，让 2×2 凹槽 + 2×2 块这类"几何精确
             * 嵌入"在 chosen 选择上显式表达（之前只能间接走 holeReduce/gapFills 路径，
             * 但 holeReduce 要 fill>0.5 + topo.holes>2 才计算，凹槽场景常因填充率低被跳过）。 */
            const exactFit = grid.bestExactFit ? grid.bestExactFit(shape.data) : 0;
            /* v1.60.19：monoFlush 同花顺消除潜力 ∈ {0,1,2,...}——shape 放下后可补满
             * "已填部分本就同 icon"的 line 数。配合 scoreShape × iconBonusTarget 加权 +
             * 染色阶段 monoNearFullLineColorWeights 双向锁定 ×5 倍 iconBonus 得分。
             * skin 缺失时退化为同 colorIdx 比较，行为一致。 */
            /* v1.60.27：除返回 count，同时获取此 shape 命中的 line 同色 ci ——
             * 染色阶段（game.js）据此**强制绑定** shape ci = targetCi，让"几何同花潜力"
             * 真转化为"实际同花消除"。修复 v1.60.26 前版本染色 bias 仅"概率倾斜"不绑定的漏标问题。
             *
             * v1.60.30：识别 always-on，bestMonoFlushPotential 始终调用——
             * 修复 v1.60.28 在 75% 轮次强信号场景下的漏识别 bug。
             * 频率节流移到 Stage 1 pick 分支 + monoBoost 加权强度（见 monoFlushRound）。 */
            const monoFlushRes = grid.bestMonoFlushPotential
                ? grid.bestMonoFlushPotential(shape.data, ctx?.skin || null, { returnTarget: true })
                : { count: 0, targetCi: null };
            const monoFlush = monoFlushRes.count;
            const monoFlushTargetCi = monoFlushRes.targetCi;
            /* v1.60.25：monoFlush 建设期信号（与 monoFlushPotential 互补）。
             * 当盘面已成型大片同色区域但任一 line 仍 empty ≥ 3（不达"近满"阈值）时，
             * monoFlushPotential=0 完全无识别——本字段补齐"朝 8 同色累积"的建设期信号。
             * 返回 shape 放下后能贡献给某 same-icon line 的最大 cells 数（要求该 line 累计 ≥ 6 同色）。 */
            const monoFlushBuildup = grid.bestMonoFlushBuildup
                ? grid.bestMonoFlushBuildup(shape.data, ctx?.skin || null, 6)
                : 0;

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

            return { shape, canPlace: true, gapFills, weight, category, placements, multiClear, holeReduce, pcPotential, exactFit, monoFlush, monoFlushTargetCi, monoFlushBuildup };
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

    /* -- 阶段 1 基础集合（attempt 循环外预计算）--
     *
     * clearCandidates / clearSeats / MAX_MONO_FLUSH_PER_DOCK 的所有输入均在 scored 构建后
     * 不再变化，可提前计算一次供 22 次 attempt 共用，省去每轮重复的 filter + sort。
     * usedIds 过滤推迟到每 ci 迭代的 avail = clearCandidates.filter(s => !usedIds[s.shape.id])。
     *
     * v1.60.24：把 `monoFlush >= 1` 加入 clearCandidates —— 同花顺消除（×5 iconBonus）
     * 与普通消行同属"消行/消除"语义，必须享受"消行 seat"的优先选拔通道。 */
    const clearCandidates = scored.filter(
        (s) => s.gapFills > 0 || s.multiClear >= 1 || s.pcPotential === 2 || (s.monoFlush ?? 0) >= 1
    );

    // 排序：清屏潜力 > 同花顺(×5) > 多消 > combo 加权 > gap 数
    // v1.60.24：clearCandidates 中存在 monoFlush 时也必须走排序——否则按默认顺序
    // 1×2/2×1 可能排在末尾，pick 阶段抽不到。
    const hasMonoFlushCandidate = clearCandidates.some(s => (s.monoFlush ?? 0) >= 1);
    if (hasDirectPerfectClear || pcSetup >= 1 || comboChain > 0.3 || multiClearBonus > 0.3 || delightBoost > 0.25 || multiLineTarget >= 2 || hasMonoFlushCandidate) {
        const mlBoost = 0.35 * multiLineTarget + payoffTarget * 0.25;
        clearCandidates.sort((a, b) => {
            /* v1.60.28：monoFlush 排序权重从 (5 + iconBonusTarget*3) 降到
             * (2 + iconBonusTarget*1.5)，让 multiClear/gapFills 也有 fair 排序机会。
             * pick 阶段 25% 概率门槛已经节流命中率，此处再降权重避免 monoFlush
             * 始终排在最前导致 pickWithPlacements 优先选到它。 */
            /* v1.60.34：清屏排序权重 (10+pcb×10) → (15+pcb×15) */
            const aScore = a.pcPotential * (15 + perfectClearBoost * 15)
                + (a.monoFlush ?? 0) * (2 + iconBonusTarget * 1.5)
                + a.multiClear * (1 + multiClearBonus + delightBoost + mlBoost)
                + a.gapFills * (0.5 + clearOpportunityTarget);
            const bScore = b.pcPotential * (15 + perfectClearBoost * 15)
                + (b.monoFlush ?? 0) * (2 + iconBonusTarget * 1.5)
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

    /* v1.60.29 + v1.60.31：avail 统一硬过滤（双条件：monoFlushRound=false 或 ≥1 已选；
     * pcPotential===2 例外永远保留）—— 修复 v1.60.29 计数泄漏 + v1.60.30 频率过高 */
    const MAX_MONO_FLUSH_PER_DOCK = 1;

    for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
        const blocks = [];
        const usedIds = {};
        const usedCategories = {};
        const mobTarget = minMobilityTarget(fill, attempt);
        const chosenMeta = [];
        let clearCount = 0;

        for (let ci = 0; ci < clearSeats; ci++) {
            let avail = clearCandidates.filter(s => !usedIds[s.shape.id]);
            if (avail.length === 0) break;

            const currentMonoFlushCount = chosenMeta.filter(m => (m?.monoFlush ?? 0) >= 1).length;
            if (!monoFlushRound || currentMonoFlushCount >= MAX_MONO_FLUSH_PER_DOCK) {
                const filtered = avail.filter(s => (s.monoFlush ?? 0) === 0 || s.pcPotential === 2);
                if (filtered.length > 0) avail = filtered;
            }

            let pick;
            if (avail.some(s => s.pcPotential === 2)) {
                const perfectPicks = avail.filter(s => s.pcPotential === 2);
                pick = perfectPicks[Math.floor(Math.random() * Math.min(3, perfectPicks.length))];
            } else if (monoFlushRound && currentMonoFlushCount < MAX_MONO_FLUSH_PER_DOCK
                       && avail.some(s => (s.monoFlush ?? 0) >= 1)) {
                const mono = avail.filter(s => (s.monoFlush ?? 0) >= 1);
                mono.sort((a, b) => (b.monoFlush ?? 0) - (a.monoFlush ?? 0));
                pick = mono[Math.floor(Math.random() * Math.min(3, mono.length))];
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
            /* v1.60.26：reason 按 **shape 自身能否真清屏** 派生（严格用户定义）。
             *
             * **旧版 bug**（v1.60.24）：`reason: pcSetup >= 1 ? 'perfectClear' : 'clear'` —
             * `pcSetup` 是**全局信号**（盘面是否处于近清屏期），不区分 chosen 的具体 shape
             * 是否真能清屏。结果：盘面 pcSetup≥1 时，所有 chosen 块（哪怕只能消2行，
             * pcPotential=0）都被错误标 reason='perfectClear' → DFV badge 显示"送清屏"。
             *
             * **严格用户定义**（v1.60.26）：清屏块 = 候选块放下后**构成消除** +
             * **无块在消除行/列之外**（消除后盘面清零）。这等价于 `pick.pcPotential === 2`
             * （bestPerfectClearPotential 精确模拟：place → checkLines → 全空校验）。
             *
             * 修复后：
             *   - `pick.pcPotential === 2` → reason='perfectClear' → DFV "送清屏" badge
             *   - 仅 multiClear/gapFills/monoFlush 满足 → reason='clear' → DFV "送消行" badge
             *     driver 由 _estimateTopDriver 区分（pcPotential / monoFlush / multiClear / ...） */
            /* v1.60.35：reason + monoFlush 字段受预算守卫（与 web 版同步修复）。
             * topDriver 也同步修正，防止 reason='clear' 但 driverLabel='可凑N同花顺' 矛盾。 */
            const monoFlushAllowed = currentMonoFlushCount < MAX_MONO_FLUSH_PER_DOCK;
            const reasonKey = (pick.pcPotential ?? 0) === 2 ? 'perfectClear'
                            : (monoFlushAllowed && (pick.monoFlush ?? 0) >= 1) ? 'monoFlush'
                            : 'clear';
            const pickForDriver = monoFlushAllowed ? pick : { ...pick, monoFlush: 0 };
            chosenMeta.push({
                shape: pick.shape, placements: pick.placements,
                reason: reasonKey,
                topDriver: _estimateTopDriver(pickForDriver, weights),
                pcPotential: pick.pcPotential ?? 0,
                multiClear:  pick.multiClear ?? 0,
                gapFills:    pick.gapFills ?? 0,
                exactFit:    pick.exactFit ?? 0,
                monoFlush:   monoFlushAllowed ? (pick.monoFlush ?? 0) : 0,
                monoFlushTargetCi: monoFlushAllowed ? (pick.monoFlushTargetCi ?? null) : null,
                monoFlushBuildup: pick.monoFlushBuildup ?? 0,
            });
            clearCount++;
        }

        /* -- 阶段 2: 加权抽样补齐（三层信号整合）-- */
        const augmentPool = (list) => {
            const bulkyCells = chosenMeta.reduce((s, m) => s + shapeCellCount(m.shape.data), 0);
            const wantSmall = fill > 0.52 && bulkyCells >= 10;
            /* 性能：minPlacementsOf(chosenMeta) 和 alreadyHasMonoFlush 对同一 augmentPool
             * 调用内的所有候选完全相同，提前计算一次，省去 |remaining| 次重复扫描。 */
            const _minPlOf = fill > 0.45 ? minPlacementsOf(chosenMeta) : Infinity;
            const _alreadyHasMono = chosenMeta.some(m => (m?.monoFlush ?? 0) >= 1);
            return list.map((s) => {
                let w = s.weight;
                const pc = s.placements;
                const cells = shapeCellCount(s.shape.data);
                const complexity = categoryComplexity(s.category);

                /* Layer 1: 机动性保障 — 合法落点越多权重越高 */
                w *= 1 + Math.log1p(pc) * (0.35 + fill * 0.55);
                if (fill > 0.45 && _minPlOf < mobTarget + 2) {
                    w *= 1 + pc / (8 + fill * 24);
                }

                /* Layer 1: 空洞修复 — 高填充时优先减少空洞的块 */
                if (s.holeReduce > 0 && fill > 0.5) {
                    w *= 1 + s.holeReduce * 0.4;
                }

                /* Layer 1: 清屏潜力 — 最高优先级倍率 */
                if (s.pcPotential === 2) {
                    // 该块放置后可直接触发清屏：极强权重，覆盖一切其他因素
                    /* v1.60.34：清屏潜力 18+14→25+20（峰值 32→45 倍）*/
                    w *= 25.0 + perfectClearBoost * 20.0;
                } else if (pcSetup >= 1 && s.gapFills > 0) {
                    // 清屏准备期：gap 填充块大幅加权，pcSetup=2 更强
                    /* v1.60.34：pcSetup 准备期 pcSetup*3+pcb*2 → pcSetup*5+pcb*4 */
                    w *= 1 + pcSetup * 5.0 + perfectClearBoost * 4.0;
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
                /* v1.60.18：exactFit 完美卡入加权 — shape 外周邻居高度被填/边界比例时强化。
                 * 用户反馈"2×2 凹槽场景算法未识别 2×2 候选块的完美匹配"——这条让
                 * scoreShape 在多消/补缺之外，也明确奖励"几何精确嵌入"的 shape：
                 *   exactFit=1.00（完美卡入）→ ×1.75 主导加权（与多消单消等量级）
                 *   exactFit=0.85（高度契合）→ ×1.36
                 *   exactFit=0.70（中度契合）→ ×1.21
                 *   exactFit<0.5（漂浮）   → ×1.0（无影响）
                 *
                 * 仅在 exactFit ≥ 0.5 时触发，避免空盘场景所有 shape 都被 ×1.x 平移；
                 * 系数 0.75 让"接近完美"的 shape 显著抬头但不至于覆盖 multiClear>=2 的硬 payoff。 */
                if (s.exactFit >= 0.5) {
                    w *= 1 + (s.exactFit - 0.5) * 1.5;
                }
                /* v1.60.20：完美卡入额外强化（exactFit ≥ 0.999） —— 用户反馈"优先适配完美卡入"。
                 * 在 v1.60.18 基础 ×1.75 之上再 ×1.4 → 总 ×2.45，与 multiClear>=2 的硬 payoff
                 * 接近（multiClear=2 + nearFullFactor 联动可达 ×2-3），确保完美卡入 shape
                 * 进入 chosen 的概率显著超过同类紧凑卡入/普通消行 shape。
                 *
                 * 不进一步强化 0.85-0.99 的紧凑卡入：紧凑卡入并非确定性闭合，过度抬头会挤压
                 * multiClear/holeReduce 的真模拟 payoff 价值。 */
                if (s.exactFit >= 0.999) {
                    w *= 1.4;
                }
                /* v1.60.19：monoFlush 同花顺消除潜力加权 — shape 能补满"已填同 icon"的 line。
                 * 与调度参数 iconBonusTarget（0~1）协同：基础加权 + iconBonusTarget 强化。
                 *   monoFlush=1 + iconBonusTarget=0.0 → ×1.40（基础奖励，与 multiClear×1 相当）
                 *   monoFlush=1 + iconBonusTarget=0.5 → ×1.70
                 *   monoFlush=1 + iconBonusTarget=1.0 → ×2.00（强化阶段）
                 *   monoFlush=2 → 再次叠乘，理论上限 ×4
                 *
                 * 设计动机：iconBonus 是 ×5 倍得分硬 payoff（PERFECT_CLEAR_MULT=10 之外的最大乘数），
                 * 但 chosen 阶段此前完全无识别——染色阶段虽有 monoNearFullLineColorWeights bias，
                 * 但若 chosen 阶段没选到能补满的 shape，染色多匹配也无用。本权重让 chosen 主动
                 * 倾向"能凑同花顺"的 shape，配合染色 bias 形成双向锁定。 */
                if (s.monoFlush >= 1) {
                    /* v1.60.29：chosen 已含 monoFlush → 跳过 monoBoost（单 dock ≤1 限制）
                     * v1.60.30：monoFlushRound=false 轮次 monoBoost ×0.3 弱保留
                     * 性能：_alreadyHasMono 已在 augmentPool 顶部提前计算，直接引用。 */
                    if (!_alreadyHasMono) {
                        let monoBoost = 1 + s.monoFlush * (0.4 + iconBonusTarget * 0.6);
                        if (s.shape.id === '1x2' || s.shape.id === '2x1') {
                            monoBoost *= 1.5;
                        }
                        if (!monoFlushRound) {
                            monoBoost = 1 + (monoBoost - 1) * 0.3;
                        }
                        w *= monoBoost;
                    }
                }

                /* v1.60.25：monoFlushBuildup 建设期加权——朝 8 同色累积的 shape 也加权，
                 * 但远低于 monoFlush（未来潜力 vs 立即兑现）。
                 * 不与 iconBonusTarget 协同（建设期还未到染色 bias 触发条件）。 */
                if ((s.monoFlushBuildup ?? 0) >= 1) {
                    w *= 1 + s.monoFlushBuildup * 0.25;
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

        /* v1.60.29 + v1.60.31：Stage 2 硬过滤（双条件：!monoFlushRound 或 ≥1 已选；pcPotential===2 例外）
         * 性能优化：remaining 改为增量维护——
         *   - 初始化：一次 scored.filter 建立可用集合
         *   - 每次抽取后：splice 删除已选 entry（O(|remaining|)，list 小）
         *   - monoFlush 排除标志首次 false→true 时：一次性过滤 monoFlush 候选 */
        let _excludeMono = !monoFlushRound || chosenMeta.some(m => (m?.monoFlush ?? 0) >= 1);
        let remaining = scored.filter((s) => {
            if (usedIds[s.shape.id]) return false;
            if (_excludeMono && (s.monoFlush ?? 0) >= 1 && s.pcPotential !== 2) return false;
            return true;
        });

        while (blocks.length < 3 && remaining.length > 0) {
            const pool = augmentPool(remaining);
            const pick = pickWeighted(pool, ctx?.rng);
            const entry = pick.entry;
            usedIds[entry.shape.id] = true;
            usedCategories[entry.category] = (usedCategories[entry.category] || 0) + 1;
            blocks.push(entry.shape);
            /* v1.60.35：Stage 2 同样受预算守卫（与 web 版同步修复）。
             * topDriver 也同步修正，防止 reason='weighted' 但 driverLabel='可凑N同花顺' 矛盾。 */
            const s2MonoFlushAllowed = chosenMeta.filter(m => (m?.monoFlush ?? 0) >= 1).length
                                       < MAX_MONO_FLUSH_PER_DOCK;
            const stage2Reason = (entry.pcPotential ?? 0) === 2 ? 'perfectClear'
                               : (s2MonoFlushAllowed && (entry.monoFlush ?? 0) >= 1) ? 'monoFlush'
                               : 'weighted';
            const entryForDriver = s2MonoFlushAllowed ? entry : { ...entry, monoFlush: 0 };
            chosenMeta.push({
                shape: entry.shape, placements: entry.placements,
                reason: stage2Reason,
                topDriver: _estimateTopDriver(entryForDriver, weights),
                pcPotential: entry.pcPotential ?? 0,
                multiClear:  entry.multiClear ?? 0,
                gapFills:    entry.gapFills ?? 0,
                exactFit:    entry.exactFit ?? 0,
                monoFlush:   s2MonoFlushAllowed ? (entry.monoFlush ?? 0) : 0,
                monoFlushTargetCi: s2MonoFlushAllowed ? (entry.monoFlushTargetCi ?? null) : null,
                monoFlushBuildup: entry.monoFlushBuildup ?? 0,
            });
            if (entry.gapFills > 0) clearCount++;
            /* 增量维护 remaining：splice 删除已选 entry；monoFlush 排除首次激活时一次性过滤 */
            const _prevExclude = _excludeMono;
            _excludeMono = !monoFlushRound || chosenMeta.some(m => (m?.monoFlush ?? 0) >= 1);
            const _ri = remaining.indexOf(entry);
            if (_ri >= 0) remaining.splice(_ri, 1);
            if (!_prevExclude && _excludeMono) {
                remaining = remaining.filter(s => (s.monoFlush ?? 0) === 0 || s.pcPotential === 2);
            }
        }

        while (blocks.length < 3) {
            const p = _pickFallbackSafe(weights);
            if (!p) break;
            blocks.push(p);
            chosenMeta.push({
                shape: p, placements: countLegalPlacements(grid, p.data), reason: 'fallback',
                topDriver: _estimateTopDriver(null, null),
                /* v1.60.8：fallback 块未经评分，三项指标均为 0；保留字段一致性供 Step 4 评分公式 */
                pcPotential: 0,
                multiClear:  0,
                gapFills:    0,
                exactFit:    0,
                monoFlush:   0,
            });
        }

        const triplet = blocks.slice(0, 3);
        if (triplet.length < 3) continue;

        /* 性能：placements 在 Stage 1/2/fallback push 时已由 countLegalPlacements 算入
         * chosenMeta[i].placements，直接复用，省去每 attempt 3 次 O(n²) 重算。 */
        const minPc = Math.min(
            chosenMeta[0].placements, chosenMeta[1].placements, chosenMeta[2].placements
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

        /* v1.32+v1.60.0/v1.60.1：校验通过后，根据盘面几何注入特殊形状（已含 post-validate） */
        let specialInjected = false;
        {
            /* v1.60.38：透传 monoFlushRound，让注入路径也受 MONO_FLUSH_PICK_PROBABILITY 节流。 */
            const inj = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, grid, fill, topo, pcSetup, scored, { rng: ctx?.rng, monoFlushRound });
            if (inj) {
                for (let i = 0; i < triplet.length; i++) {
                    triplet[i] = inj.triplet[i];
                    chosenMeta[i] = inj.chosenMeta[i];
                }
                /* v1.60.6 缺口 #1：双层计数器同步——全局 + 子配额。 */
                ctx.specialShapeUsed = (ctx.specialShapeUsed ?? 0) + 1;
                if (inj.subType === 'relief') {
                    ctx.specialReliefUsed = (ctx.specialReliefUsed ?? 0) + 1;
                } else if (inj.subType === 'pressure') {
                    ctx.specialPressureUsed = (ctx.specialPressureUsed ?? 0) + 1;
                }
                specialInjected = true;
            }
        }

        /* v1.60.21：高/极度 novelty 场景下的"双胞胎/三胞胎"注入（与 special 注入互斥） */
        {
            const dup = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, {
                rng: ctx?.rng,
                specialInjected,
            });
            if (dup) {
                ctx.dupInjectUsed = (ctx.dupInjectUsed ?? 0) + 1;
                ctx.roundsSinceDupInject = 0; /* 由 game.js 在下一轮 spawnBlocks 入口 +1 */
                /* 注：mainIdx/replicaIdxs 在 fisherYates 洗牌后会失效，仅记录 mode + novelty + run 计数 */
                diagnostics.dupInject = {
                    mode: dup.mode,
                    novelty: hints?.spawnTargets?.novelty ?? 0,
                    usedInRun: ctx.dupInjectUsed,
                };
            }
        }

        /* 通过校验 — 打乱顺序 + 记录诊断
         *
         * v1.59.19 bug 修复：Fisher-Yates 同步打乱 triplet + chosenMeta 前 3 项，避免
         * dock 与 DFV chosen 顺序错位（详见旧注释）。
         * v1.60.1（Issue 4 同步）：洗牌接受 ctx.rng（默认 Math.random），daily/replay
         * 路径可传 mulberry32 让最终 dock 顺序可复现。 */
        fisherYatesInPlace(triplet, ctx?.rng, (i, j) => {
            const tmpMeta = chosenMeta[i]; chosenMeta[i] = chosenMeta[j]; chosenMeta[j] = tmpMeta;
        });

        const chosenCats = triplet.map(s => getShapeCategory(s.id));
        mem.categories.push(chosenCats);
        if (mem.categories.length > 3) mem.categories.shift();
        mem.totalRounds++;

        diagnostics.attempt = attempt;
        /* v1.60.8：serialized chosen 现在透传评分字段（pcPotential/multiClear/gapFills/placements）+
         * v1.60.6 audit 字段（original/originalMeta/injectedAt/subType/spawnCtx），让 DFV
         * 可以渲染 ⚡ badge tooltip、可解释性面板可以读"为什么这块出现"。
         * 之前裁剪只保留 id/category/reason/topDriver 导致 audit/评分全部丢失，
         * v1.60.6 智能 replaceIdx 实际无用、DFV ⚡ badge 不展开等多个隐性 bug 都源于此。 */
        diagnostics.chosen = chosenMeta.slice(0, 3).map(m => ({
            id: m.shape.id, category: getShapeCategory(m.shape.id),
            reason: m.reason,
            topDriver: m.topDriver || { key: 'balanced', label: '综合均衡' },
            pcPotential: m.pcPotential ?? 0,
            multiClear:  m.multiClear ?? 0,
            gapFills:    m.gapFills ?? 0,
            /* v1.60.18：透传 exactFit 给 DFV chosen tooltip + 后续 RL/解释面板使用 */
            exactFit:    m.exactFit ?? 0,
            /* v1.60.19：透传 monoFlush 给 DFV chosen tooltip + 同花顺潜力可解释面板 */
            monoFlush:   m.monoFlush ?? 0,
            /* v1.60.27：透传 monoFlushTargetCi —— game.js 染色阶段据此强制绑定 shape ci */
            monoFlushTargetCi: m.monoFlushTargetCi ?? null,
            /* v1.60.25：透传 monoFlushBuildup 建设期信号 */
            monoFlushBuildup: m.monoFlushBuildup ?? 0,
            /* v1.60.21：透传 duplicate audit 字段给 DFV 渲染 ⧈ 双胞胎/三胞胎 badge */
            duplicateGroup: m.duplicateGroup,
            duplicateRole:  m.duplicateRole,
            placements:  m.placements ?? 0,
            /* v1.60.6 audit（注入块才有；非注入块为 undefined）—— DFV 据此渲染 ⚡ badge */
            original:     m.original,
            originalMeta: m.originalMeta,
            injectedAt:   m.injectedAt,
            subType:      m.subType,
            spawnCtx:     m.spawnCtx,
        }));
        diagnostics.layer1.solutionMetrics = solutionMetrics;
        _lastDiagnostics = diagnostics;

        return triplet;
    }

    /* 兜底 */
    const blocks = [];
    const usedIds = {};
    const _fallbackClears = scored.filter(
        (s) => s.gapFills > 0 || s.multiClear >= 1 || s.pcPotential === 2
    );
    if (_fallbackClears.length > 0) {
        blocks.push(_fallbackClears[0].shape);
        usedIds[_fallbackClears[0].shape.id] = true;
    }
    let rem = scored.filter((s) => !usedIds[s.shape.id]);
    while (blocks.length < 3 && rem.length > 0) {
        const pool = rem.map((s) => ({
            entry: s,
            w: s.weight * (1 + Math.log1p(s.placements))
        }));
        const pick = pickWeighted(pool, ctx?.rng);
        blocks.push(pick.entry.shape);
        usedIds[pick.entry.shape.id] = true;
        rem = scored.filter((s) => !usedIds[s.shape.id]);
    }
    while (blocks.length < 3) {
            const p = _pickFallbackSafe(weights);
        if (p) blocks.push(p);
        else break;
    }

    diagnostics.attempt = MAX_SPAWN_ATTEMPTS;
    /* v1.60.8：兜底路径 chosen 也带评分字段（全 0）保持 schema 一致 */
    diagnostics.chosen = blocks.slice(0, 3).map(s => ({
        id: s.id, category: getShapeCategory(s.id), reason: 'fallback',
        topDriver: _estimateTopDriver(null, null),
        pcPotential: 0, multiClear: 0, gapFills: 0, exactFit: 0, monoFlush: 0, monoFlushBuildup: 0, placements: 0,
    }));
    _lastDiagnostics = diagnostics;

    /* v1.32+v1.60.0：最终安全网 — 确保兜底输出不含特殊形状 */
    _sanitizeShapeArr(blocks, grid, weights);

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
function generateDockShapesLayered(grid, config, spawnHints = {}, spawnContext = {}) {
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

module.exports = { _estimateTopDriver, _resolveSpecialPools, _sanitizeShapeArr, _tryInjectDuplicates, _tryInjectSpecial, analyzePerfectClearSetup, canTripletPerfectClear, computeCandidatePlacementMetric, DUP_INJECT_CONFIG, evaluateTripletSolutions, generateDockShapes, generateDockShapesLayered, getLastSpawnDiagnostics, hasSpecialShape, resetSpawnMemory, SPECIAL_PRESSURE_SHAPES, SPECIAL_RELIEF_SHAPES, SPECIAL_SHAPE_WEIGHTS, SPECIAL_SHAPES, validateSpawnTriplet };
