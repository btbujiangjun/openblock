/**
 * 空间规划（Spatial Planning）—— 盘面"可用空间结构"的确定性度量 SSOT。
 *
 * 背景（详见 docs/algorithms/ALGORITHMS_SPAWN.md §15 空间规划）：
 *   填充率只衡量"占了多少"，无法区分"占得整齐"与"占得稀碎"。本模块从**拓扑结构、
 *   熵增、形状词表机动性**三个互补视角刻画"玩家/出块把盘面推向多可用的状态"，
 *   既评单步，也评三块组合与放置序列后的终局结构。
 *
 * 分层（与 spawnStepDifficulty 的"廉价特征 vs 全枚举"同构）：
 *   - 廉价层 `spatialPlanningFeatures(grid)`：3 维纯几何（单次 BFS，O(n²)），
 *     进 RL 落子 state 标量段与生成式 behaviorContext。不扫形状词表，可热路径调用。
 *   - 完整层 `computeSpatialPlanning(grid, opts)`：对整个形状词表算可放性
 *     （vocabMobility / familyCoverage / largeShapeCompat / optionEntropy），
 *     供出块诊断、玩家能力、面板/透视仪消费（非 MCTS 每节点）。
 *   - 序列层 `computeTopologyDelta(before, after)`：消费两次 analyzeBoardTopology
 *     的全部几何信号，合成带符号的"结构损伤/保全"分，用于落子/三块序列质量。
 *
 * 纯函数、无副作用、不依赖 DOM / 网络；Python 镜像见 rl_pytorch/spatial_planning.py
 * （cheap 3 维必须逐位一致，跨语言契约测试见 tests/spatialPlanning.test.js 与
 * tests/test_spatial_planning.py）。
 */

let _softDeps_math = {}; try { _softDeps_math = require('./lib/math'); } catch (_e) { /* miniprogram 不分发 lib/ 子目录，软依赖回退空骨架 */ } const { clamp01 } = _softDeps_math;
const { getAllShapes, getRegularShapes, getShapeCategory } = require('./shapes');

const SPATIAL_PLANNING_VERSION = 1;

/** 廉价 RL 子向量维度（state 标量段扩增量）。 */
const SPATIAL_PLANNING_FEATURE_DIM = 3;

/** 默认配置（可被 game_rules.json `spatialPlanning` 覆盖）。 */
const DEFAULT_SPATIAL_PLANNING_CONFIG = Object.freeze({
    boardSize: 8,
    /* 「小死腔」尺寸上界：≤ 此格数的 4-连通空腔视为难以利用的碎块 */
    smallRegionMaxSize: 4,
    /* 「大块」格数下界：词表里 ≥ 此格数的形状计入 largeShapeCompat */
    largeShapeMinCells: 5,
    /* 词表机动性的形状池：'regular'(28，玩家可自然抽到) | 'all'(40) */
    pool: 'regular',
    /* 统一拓扑 Δ 的分项权重（对 analyzeBoardTopology 各几何信号的增量） */
    topologyDelta: {
        weights: {
            holes: 0.30,
            enclosedVoid: 0.24,
            concave: 0.14,
            regions: 0.16,
            transitions: 0.08,
            wells: 0.08
        },
        /* 把"原始加权 Δ"压到 [0,1] 损伤的归一化分母（一次落子可接受的结构恶化预算） */
        damageScale: 6
    },
    /* 玩家空间规划能力合成权重（computeSpatialPlanningScore） */
    abilityWeights: {
        preservation: 0.30,
        vocabMobility: 0.26,
        consolidation: 0.18,
        familyCoverage: 0.16,
        optionEntropy: 0.10
    }
});

function mergeConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return DEFAULT_SPATIAL_PLANNING_CONFIG;
    const d = DEFAULT_SPATIAL_PLANNING_CONFIG;
    return {
        ...d,
        ...cfg,
        topologyDelta: {
            ...d.topologyDelta,
            ...(cfg.topologyDelta || {}),
            weights: { ...d.topologyDelta.weights, ...((cfg.topologyDelta || {}).weights || {}) }
        },
        abilityWeights: { ...d.abilityWeights, ...(cfg.abilityWeights || {}) }
    };
}

/* ============================================================================
 * 数学工具
 * ========================================================================== */

/**
 * 香农熵（自然对数），可选归一化分母。
 * @param {number[]} counts 非负计数/权重
 * @param {number} [normDenom] 归一化分母（如 ln(类别数)）；>0 时返回 H/normDenom
 * @returns {number}
 */
function shannonEntropy(counts, normDenom) {
    let total = 0;
    for (const c of counts) {
        if (Number.isFinite(c) && c > 0) total += c;
    }
    if (total <= 0) return 0;
    let h = 0;
    for (const c of counts) {
        if (Number.isFinite(c) && c > 0) {
            const p = c / total;
            h -= p * Math.log(p);
        }
    }
    if (Number.isFinite(normDenom) && normDenom > 0) {
        return clamp01(h / normDenom);
    }
    return h;
}

/* ============================================================================
 * 空白区域扫描（4-连通分量尺寸）
 * ========================================================================== */

/**
 * 单次 BFS 扫描所有"空格 4-连通分量"的尺寸。
 * 与 boardTopology.countEmptyRegions 同口径（空=cells===null），但额外返回尺寸分布，
 * 是 regionEntropy / largestRegionRatio / smallRegionCellRatio 的共同数据源。
 *
 * @param {{cells:Array<Array<*>>, size:number}} grid
 * @returns {{ sizes:number[], emptyCells:number, regionCount:number, maxSize:number, smallCells:number }}
 */
function scanEmptyRegions(grid, cfg) {
    const c = mergeConfig(cfg);
    const empty = { sizes: [], emptyCells: 0, regionCount: 0, maxSize: 0, smallCells: 0 };
    if (!grid?.cells?.length) return empty;
    const n = grid.size;
    const visited = Array.from({ length: n }, () => new Array(n).fill(false));
    const queue = new Array(n * n);
    for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
            if (grid.cells[sy][sx] !== null || visited[sy][sx]) continue;
            let head = 0;
            let tail = 0;
            queue[tail++] = (sy << 8) | sx;
            visited[sy][sx] = true;
            let size = 0;
            while (head < tail) {
                const packed = queue[head++];
                const cx = packed & 0xff;
                const cy = packed >>> 8;
                size++;
                const nbrs = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
                for (const [nx, ny] of nbrs) {
                    if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
                    if (visited[ny][nx] || grid.cells[ny][nx] !== null) continue;
                    visited[ny][nx] = true;
                    queue[tail++] = (ny << 8) | nx;
                }
            }
            empty.sizes.push(size);
            empty.emptyCells += size;
            empty.regionCount++;
            if (size > empty.maxSize) empty.maxSize = size;
            if (size <= c.smallRegionMaxSize) empty.smallCells += size;
        }
    }
    return empty;
}

/* ============================================================================
 * 廉价层：RL state / behaviorContext 子向量
 * ========================================================================== */

/**
 * 廉价 3 维空间规划特征（纯几何、单次 BFS、无形状词表扫描）。
 *
 *   [0] regionEntropy       空白区域尺寸熵（按格数加权）/ ln(空格数) —— 越高越碎
 *   [1] largestRegionRatio  最大空白区 / 空格数 —— 越高开放空间越整片（好）
 *   [2] smallRegionCellRatio 处于"小死腔(≤smallRegionMaxSize)"的空格占比 —— 越高越糟
 *
 * 与 contiguousRegions/concaveCorners（已在 state）正交：那两个是"被切几块/几个内凹角"，
 * 这三个是"被切得多不均匀/开放空间是否整片/死腔占比"。
 *
 * @param {{cells:Array<Array<*>>, size:number}} grid
 * @param {object} [cfg]
 * @returns {number[]} 长度 3，均已 clamp 到 [0,1]
 */
function spatialPlanningFeatures(grid, cfg) {
    const scan = scanEmptyRegions(grid, cfg);
    if (scan.emptyCells <= 0) return [0, 0, 0];
    const regionEntropy = shannonEntropy(scan.sizes, Math.log(Math.max(2, scan.emptyCells)));
    const largestRegionRatio = clamp01(scan.maxSize / scan.emptyCells);
    const smallRegionCellRatio = clamp01(scan.smallCells / scan.emptyCells);
    return [regionEntropy, largestRegionRatio, smallRegionCellRatio];
}

/* ============================================================================
 * 完整层：形状词表机动性 + 选项熵
 * ========================================================================== */

function shapeCellCount(data) {
    if (!Array.isArray(data)) return 0;
    let n = 0;
    for (let y = 0; y < data.length; y++) {
        const row = data[y];
        if (!Array.isArray(row)) continue;
        for (let x = 0; x < row.length; x++) if (row[x]) n++;
    }
    return n;
}

function countLegal(grid, data) {
    let cnt = 0;
    const n = grid.size;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.canPlace(data, x, y)) cnt++;
        }
    }
    return cnt;
}

function resolvePool(cfg) {
    return cfg.pool === 'all' ? getAllShapes() : getRegularShapes();
}

/**
 * 对整个形状词表评估盘面的"未来可放性"与"选项均衡度"。
 *
 * 这是对现有 `computeCandidatePlacementMetric`（只看当前 dock 三块）的正交补充：
 * 衡量"盘面对所有可能形状还剩多少入口"，回答"高手是否保留了多种形状的落点"。
 *
 * @param {{cells:Array<Array<*>>, size:number, canPlace:Function}} grid
 * @param {object} [opts]
 * @param {Array<{id?:string, data:number[][]}>} [opts.shapes] 自定义词表（缺省按 cfg.pool）
 * @param {object} [opts.cfg]
 * @returns {{
 *   vocabMobility:number, familyCoverage:number, largeShapeCompat:number,
 *   optionEntropy:number, placeableShapes:number, totalShapes:number,
 *   familyLegal:Record<string,number>
 * }}
 */
function computeVocabularyMobility(grid, opts = {}) {
    const cfg = mergeConfig(opts.cfg);
    const empty = {
        vocabMobility: 0, familyCoverage: 0, largeShapeCompat: 0,
        optionEntropy: 0, placeableShapes: 0, totalShapes: 0, familyLegal: {}
    };
    if (!grid?.cells?.length || typeof grid.canPlace !== 'function') return empty;
    const pool = Array.isArray(opts.shapes) ? opts.shapes : resolvePool(cfg);
    if (!pool.length) return empty;

    const familyLegal = {};
    const familySet = new Set();
    let placeable = 0;
    let largeTotal = 0;
    let largePlaceable = 0;

    for (const shape of pool) {
        const data = shape?.data || shape;
        if (!Array.isArray(data)) continue;
        const fam = shape?.id ? getShapeCategory(shape.id) : (shape?.category || 'squares');
        familySet.add(fam);
        const cells = shapeCellCount(data);
        const isLarge = cells >= cfg.largeShapeMinCells;
        if (isLarge) largeTotal++;
        const legal = countLegal(grid, data);
        familyLegal[fam] = (familyLegal[fam] || 0) + legal;
        if (legal > 0) {
            placeable++;
            if (isLarge) largePlaceable++;
        }
    }

    const familiesPresent = familySet.size;
    const familiesWithLegal = Object.values(familyLegal).filter((v) => v > 0).length;
    const optionEntropy = shannonEntropy(
        Object.values(familyLegal),
        Math.log(Math.max(2, familiesPresent))
    );

    return {
        vocabMobility: clamp01(placeable / pool.length),
        familyCoverage: familiesPresent > 0 ? clamp01(familiesWithLegal / familiesPresent) : 0,
        largeShapeCompat: largeTotal > 0 ? clamp01(largePlaceable / largeTotal) : 1,
        optionEntropy,
        placeableShapes: placeable,
        totalShapes: pool.length,
        familyLegal
    };
}

/* ============================================================================
 * 序列层：带符号拓扑 Δ（落子 / 三块序列结构变化）
 * ========================================================================== */

function geoSum(t) {
    return {
        holes: Math.max(0, Number(t?.holes) || 0),
        enclosedVoid: Math.max(0, Number(t?.enclosedVoidCells) || 0),
        concave: Math.max(0, Number(t?.concaveCorners) || 0),
        regions: Math.max(0, Number(t?.contiguousRegions) || 0),
        transitions: Math.max(0, Number(t?.rowTransitions) || 0) + Math.max(0, Number(t?.colTransitions) || 0),
        wells: Math.max(0, Number(t?.wells) || 0)
    };
}

/**
 * 统一带符号拓扑 Δ：消费两次 analyzeBoardTopology 的全部几何信号，合成结构损伤分。
 *
 * 正损伤 = 结构变糟（更多洞/死腔/凹角/碎片/沟壑/起伏）；负损伤 = 结构改善（通常伴随消行）。
 * 与 placementQuality 的 holeSafety/tidiness 互补：那两项只看 holes+flatness，
 * 本函数纳入 concave/regions/transitions/wells，是"空间规划"的结构落点。
 *
 * @param {object} before analyzeBoardTopology(放置前)
 * @param {object} after  analyzeBoardTopology(放置后/消行后)
 * @param {object} [cfg]
 * @returns {{ rawDamage:number, damage:number, preservation:number, deltas:object }}
 */
function computeTopologyDelta(before, after, cfg) {
    const c = mergeConfig(cfg);
    const w = c.topologyDelta.weights;
    const b = geoSum(before);
    const a = geoSum(after);
    const deltas = {
        holes: a.holes - b.holes,
        enclosedVoid: a.enclosedVoid - b.enclosedVoid,
        concave: a.concave - b.concave,
        regions: a.regions - b.regions,
        transitions: a.transitions - b.transitions,
        wells: a.wells - b.wells
    };
    const rawDamage = w.holes * deltas.holes
        + w.enclosedVoid * deltas.enclosedVoid
        + w.concave * deltas.concave
        + w.regions * deltas.regions
        + w.transitions * deltas.transitions
        + w.wells * deltas.wells;
    const scale = Math.max(1e-6, c.topologyDelta.damageScale);
    const damage = clamp01(rawDamage / scale);
    return {
        rawDamage,
        damage,
        preservation: clamp01(1 - damage),
        deltas
    };
}

/* ============================================================================
 * 顶层聚合：盘面空间规划画像 + 玩家能力分
 * ========================================================================== */

/**
 * 盘面级空间规划画像（廉价几何 + 词表机动性合一），供出块诊断 / 面板 / 透视仪。
 *
 * @param {{cells:Array<Array<*>>, size:number, canPlace:Function}} grid
 * @param {object} [opts]
 * @param {boolean} [opts.includeVocabulary=true] 是否计算形状词表机动性（热路径可关）
 * @param {Array} [opts.shapes] 自定义词表
 * @param {object} [opts.cfg]
 * @returns {object}
 */
function computeSpatialPlanning(grid, opts = {}) {
    const cfg = mergeConfig(opts.cfg);
    const scan = scanEmptyRegions(grid, cfg);
    const [regionEntropy, largestRegionRatio, smallRegionCellRatio] = scan.emptyCells > 0
        ? [
            shannonEntropy(scan.sizes, Math.log(Math.max(2, scan.emptyCells))),
            clamp01(scan.maxSize / scan.emptyCells),
            clamp01(scan.smallCells / scan.emptyCells)
        ]
        : [0, 0, 0];

    const vocab = opts.includeVocabulary === false
        ? null
        : computeVocabularyMobility(grid, { shapes: opts.shapes, cfg });

    return {
        version: SPATIAL_PLANNING_VERSION,
        emptyCells: scan.emptyCells,
        regionCount: scan.regionCount,
        largestRegionSize: scan.maxSize,
        regionEntropy,
        largestRegionRatio,
        smallRegionCellRatio,
        vocabMobility: vocab ? vocab.vocabMobility : null,
        familyCoverage: vocab ? vocab.familyCoverage : null,
        largeShapeCompat: vocab ? vocab.largeShapeCompat : null,
        optionEntropy: vocab ? vocab.optionEntropy : null
    };
}

/**
 * 玩家空间规划能力分 [0,1]：把"结构保全 + 词表机动性 + 开放空间整片度 +
 * 形状家族覆盖 + 选项均衡"合成单分，供 playerAbilityModel.boardPlanning 增强消费。
 *
 * @param {object} input
 * @param {number} [input.preservation] computeTopologyDelta().preservation（缺省 0.5 中性）
 * @param {number} [input.vocabMobility]
 * @param {number} [input.largestRegionRatio]
 * @param {number} [input.smallRegionCellRatio]
 * @param {number} [input.familyCoverage]
 * @param {number} [input.optionEntropy]
 * @param {object} [cfg]
 * @returns {number}
 */
function computeSpatialPlanningScore(input = {}, cfg) {
    const c = mergeConfig(cfg);
    const w = c.abilityWeights;
    const preservation = Number.isFinite(input.preservation) ? clamp01(input.preservation) : 0.5;
    const vocabMobility = clamp01(Number(input.vocabMobility) || 0);
    const familyCoverage = clamp01(Number(input.familyCoverage) || 0);
    const optionEntropy = clamp01(Number(input.optionEntropy) || 0);
    /* consolidation：开放空间越整片(largestRegionRatio↑) 且 小死腔越少(smallRegionCellRatio↓) 越好 */
    const consolidation = clamp01(
        0.6 * (Number.isFinite(input.largestRegionRatio) ? input.largestRegionRatio : 0.5)
        + 0.4 * (1 - (Number.isFinite(input.smallRegionCellRatio) ? input.smallRegionCellRatio : 0.5))
    );
    return clamp01(
        preservation * w.preservation
        + vocabMobility * w.vocabMobility
        + consolidation * w.consolidation
        + familyCoverage * w.familyCoverage
        + optionEntropy * w.optionEntropy
    );
}

module.exports = { computeSpatialPlanning, computeSpatialPlanningScore, computeTopologyDelta, computeVocabularyMobility, DEFAULT_SPATIAL_PLANNING_CONFIG, scanEmptyRegions, shannonEntropy, SPATIAL_PLANNING_FEATURE_DIM, SPATIAL_PLANNING_VERSION, spatialPlanningFeatures };
