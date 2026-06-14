/* 自动生成 —— 请勿手改。源：web/src/spawnStepDifficulty.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * 单步出块难度（Spawn Step Difficulty）—— 确定性、可落库的统一难度分。
 *
 * 背景（详见 docs/algorithms/ALGORITHMS_SPAWN.md §14.二）：
 *   本项目是无尽模式，盘面连续演化、`(盘面 × 候选三块)` 几乎不复现，**没有「题目」概念**。
 *   因此难度的最小单元是 **出块决策（spawn step）= 当前盘面 × 本轮候选三块**，由确定性
 *   特征「逐步算出」，而非对「同题多次测量求均值」。
 *
 * 系统此前已有分散的单步难度原语（`boardDifficulty` / DFS `solutionMetrics` / v2 `d_step`），
 * 但未 consolidate 成一个「本次出块内在难度分」并落库。本模块即该 consolidate 层：
 *   - P0 `scdScore`：空间约束密度（纯几何，零依赖）
 *   - P1 `is_killer` / `is_long_bar` / `combo_killer_cnt`：形状级难度抓手（口径在此唯一定义）
 *   - P2 `computeSpawnStepDifficulty`：把上述 + boardDifficulty + 解空间稀缺度合成 0~1 难度分 + 5 档桶
 *
 * 纯函数、无副作用、不依赖 DOM / 网络；Python 镜像见 rl_pytorch/spawn_step_difficulty.py
 * （两侧公式必须保持一致，跨语言契约测试见 tests/spawnStepDifficulty.test.js 与
 * tests/spawn_step_difficulty_test.py）。
 */

export const SPAWN_STEP_DIFFICULTY_VERSION = 1;

/** 5 档难度桶（替代「题目级」聚合主键：按难度桶 × 算法离线聚合）。 */
export const DIFFICULTY_BUCKETS = ['trivial', 'easy', 'standard', 'hard', 'extreme'];

/** 难度桶上界（含）：stepDifficulty ≤ 阈值即归该桶；最后一档兜底 extreme。 */
const BUCKET_UPPER = [0.2, 0.4, 0.6, 0.8];

/** 默认配置（可被 game_rules.json `spawnStepDifficulty` 覆盖）。 */
export const DEFAULT_STEP_DIFFICULTY_CONFIG = Object.freeze({
    boardSize: 8,
    /* P0 空间约束密度档位（scdScore 上界）：< ample 充裕 / < tight 紧张 / 其余 稀缺 */
    scdAmple: 0.3,
    scdTight: 0.5,
    /* scdScore 归一化的饱和点（≥ 此值视为满压 1.0） */
    scdSaturation: 0.6,
    /* P1 killer 判定：格子数下限 + 当前盘面合法落点上限（机动性短板） */
    killerMinCells: 5,
    killerMaxPlacements: 6,
    /* P1 long bar 判定：单行/单列且长度 ≥ 此值 */
    longBarMinLength: 4,
    /* 解空间稀缺度归一化饱和点（solutionCount ≥ 此值视为「解充裕」=0 稀缺） */
    solutionAbundant: 24,
    /* minFlexibility 归一化饱和点（合法落点 ≥ 此值视为「自由」） */
    flexibilityFree: 24,
    /* RL 状态特征：三块总格归一化分母（≈3 块 × 典型 5 格） */
    comboCellsNorm: 15,
    /* v1.67 空间规划：fragmentation 项 = 空白区域熵 + 小死腔占比的合成（来自 spatialPlanning.js）。
     * 仅当 computeSpawnStepDifficulty 收到 spatialFeatures 时生效；缺省自动把该权重重分配给其余项。 */
    fragmentationFrom: { regionEntropy: 0.6, smallRegionCellRatio: 0.4 },
    /* P2 合成权重（和为 1，v1.67 引入 fragmentation 后重平衡） */
    weights: {
        scd: 0.26,
        board: 0.18,
        flexibility: 0.18,
        solution: 0.13,
        killer: 0.13,
        fragmentation: 0.12
    }
});

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

function mergeConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return DEFAULT_STEP_DIFFICULTY_CONFIG;
    return {
        ...DEFAULT_STEP_DIFFICULTY_CONFIG,
        ...cfg,
        weights: { ...DEFAULT_STEP_DIFFICULTY_CONFIG.weights, ...(cfg.weights || {}) }
    };
}

/** @param {number[][]} data 形状矩阵（1=占用） @returns {number} 占用格数 */
export function shapeCellCount(data) {
    if (!Array.isArray(data)) return 0;
    let n = 0;
    for (let y = 0; y < data.length; y++) {
        const row = data[y];
        if (!Array.isArray(row)) continue;
        for (let x = 0; x < row.length; x++) {
            if (row[x]) n++;
        }
    }
    return n;
}

/** 形状包围盒尺寸 {w,h}（剔除全 0 行/列后的实际跨度）。 */
function boundingBox(data) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let y = 0; y < data.length; y++) {
        const row = data[y] || [];
        for (let x = 0; x < row.length; x++) {
            if (row[x]) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < minX) return { w: 0, h: 0 };
    return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * P1：是否为「长条」——结构口径：单行或单列且长度 ≥ longBarMinLength。
 *
 * 注意语义边界（详见 §14.二 风险表）：出块**生成**侧 `categoryComplexity('lines')=0.15`
 * 把长条当作「低复杂度=偏易」（易消行），那是「生成多样性」视角；本函数是「**难度约束**」
 * 视角——长条对行/列完整性要求高、易制造刚性死局，故计入难度抓手。两者口径不同、各司其职。
 *
 * @param {number[][]} data
 * @param {object} [cfg]
 */
export function isLongBar(data, cfg) {
    const c = mergeConfig(cfg);
    const cells = shapeCellCount(data);
    if (cells < c.longBarMinLength) return false;
    const { w, h } = boundingBox(data);
    /* 单行（h=1, w≥L）或单列（w=1, h≥L），且无空洞（cells === 长边） */
    const isSingleRow = h === 1 && w >= c.longBarMinLength && cells === w;
    const isSingleCol = w === 1 && h >= c.longBarMinLength && cells === h;
    return isSingleRow || isSingleCol;
}

/**
 * P1：是否为「致命块」——盘面相关口径：大体积（≥killerMinCells）或长条，
 * 且在当前盘面机动性低（合法落点 ≤ killerMaxPlacements）。`countLegal` 缺省时退化为
 * 纯形状口径（仅看体积/长条），用于无盘面上下文的离线分析。
 *
 * @param {number[][]} data
 * @param {((data:number[][]) => number) | null} [countLegal] 返回该形状在盘面合法落点数
 * @param {object} [cfg]
 */
export function isKillerShape(data, countLegal, cfg) {
    const c = mergeConfig(cfg);
    const cells = shapeCellCount(data);
    const bulkyOrBar = cells >= c.killerMinCells || isLongBar(data, c);
    if (!bulkyOrBar) return false;
    if (typeof countLegal !== 'function') return true; // 无盘面上下文：仅形状口径
    const legal = countLegal(data);
    return Number.isFinite(legal) && legal <= c.killerMaxPlacements;
}

/** 形状家族（lines/rects/squares/...）：优先用传入的 categoryOf，缺省按包围盒粗判。 */
function familyOf(shape, categoryOf) {
    if (typeof categoryOf === 'function') {
        const cat = categoryOf(shape);
        if (cat) return cat;
    }
    const data = shape?.data || shape;
    const { w, h } = boundingBox(data);
    if (w === 1 || h === 1) return 'lines';
    if (w === h) return 'squares';
    return 'rects';
}

/**
 * P1：三连块组合级分类。
 * @param {Array<{data:number[][]}>|number[][][]} shapes 三块（对象带 .data 或裸矩阵）
 * @param {{ countLegal?: (data:number[][])=>number, categoryOf?: (shape:any)=>string }} [ctx]
 * @param {object} [cfg]
 * @returns {{comboTotalCells:number, comboKillerCnt:number, comboLongBarCnt:number,
 *   isHomogeneousFamily:boolean, minFlexibility:number|null}}
 */
export function classifyTriplet(shapes, ctx = {}, cfg) {
    const c = mergeConfig(cfg);
    const list = Array.isArray(shapes) ? shapes : [];
    const datas = list.map((s) => (Array.isArray(s) ? s : s?.data)).filter(Array.isArray);
    const countLegal = typeof ctx.countLegal === 'function' ? ctx.countLegal : null;

    let comboTotalCells = 0;
    let comboKillerCnt = 0;
    let comboLongBarCnt = 0;
    let minFlexibility = null;
    const families = [];

    for (let i = 0; i < datas.length; i++) {
        const data = datas[i];
        comboTotalCells += shapeCellCount(data);
        if (isLongBar(data, c)) comboLongBarCnt++;
        if (isKillerShape(data, countLegal, c)) comboKillerCnt++;
        if (countLegal) {
            const legal = countLegal(data);
            if (Number.isFinite(legal)) {
                minFlexibility = minFlexibility == null ? legal : Math.min(minFlexibility, legal);
            }
        }
        families.push(familyOf(list[i], ctx.categoryOf));
    }

    const isHomogeneousFamily = families.length >= 2 && families.every((f) => f === families[0]);
    return { comboTotalCells, comboKillerCnt, comboLongBarCnt, isHomogeneousFamily, minFlexibility };
}

/**
 * P0：空间约束密度 SCD = 三块总格 / (空格数 + ε)。值越大剩余空间越紧张。
 * @param {number} comboTotalCells
 * @param {number} occupiedCount 盘面已占用格数
 * @param {object} [cfg]
 */
export function scdScore(comboTotalCells, occupiedCount, cfg) {
    const c = mergeConfig(cfg);
    const area = c.boardSize * c.boardSize;
    const free = Math.max(0, area - (Number(occupiedCount) || 0));
    return (Number(comboTotalCells) || 0) / (free + 0.001);
}

/** P0：SCD 档位标签。 */
export function scdLevel(scd, cfg) {
    const c = mergeConfig(cfg);
    if (scd < c.scdAmple) return 'ample';
    if (scd < c.scdTight) return 'tight';
    return 'scarce';
}

/**
 * RL 单步难度特征子向量（SSOT，确定性、廉价、无 DFS/无落点扫描）——
 * 供 `web/src/bot/features.js` 与 `rl_pytorch/features.py` 拼入 RL state 标量段（当前 204 维：
 * 含 4 维单步难度 + 2 维客观几何 contiguousRegions/concaveCorners + 3 维空间规划）。
 * 仅依赖「候选三块几何 + 盘面占用数」，故可在 MCTS 热路径每节点调用。
 *
 * 返回固定 4 维（均已 clamp 到 [0,1]）：
 *   [0] scdNorm           空间约束密度 / 饱和点
 *   [1] comboCellsNorm    三块总格 / comboCellsNorm
 *   [2] comboKillerNorm   致命块数（形状口径）/ dockSlots
 *   [3] comboLongBarNorm  长条数 / dockSlots
 *
 * @param {Array<{data:number[][]}>|number[][][]} shapes 未放置候选三块
 * @param {number} occupiedCount 盘面已占用格数
 * @param {object} [cfg]
 * @returns {number[]} 长度 4
 */
export function spawnStepDifficultyFeatures(shapes, occupiedCount, cfg) {
    const c = mergeConfig(cfg);
    const cls = classifyTriplet(shapes, {}, c);
    const scd = scdScore(cls.comboTotalCells, occupiedCount, c);
    const slots = 3;
    return [
        clamp01(scd / c.scdSaturation),
        clamp01(cls.comboTotalCells / c.comboCellsNorm),
        clamp01(cls.comboKillerCnt / slots),
        clamp01(cls.comboLongBarCnt / slots)
    ];
}

/** RL 难度特征子向量长度（state 标量段扩增量）。 */
export const SPAWN_STEP_DIFFICULTY_FEATURE_DIM = 4;

/** stepDifficulty(0~1) → 5 档桶。 */
export function difficultyBucket(stepDifficulty) {
    const d = clamp01(stepDifficulty);
    for (let i = 0; i < BUCKET_UPPER.length; i++) {
        if (d <= BUCKET_UPPER[i]) return DIFFICULTY_BUCKETS[i];
    }
    return DIFFICULTY_BUCKETS[DIFFICULTY_BUCKETS.length - 1];
}

/**
 * P2：把单步难度原语 consolidate 成 0~1 难度分 + 5 档桶 + 全部分量（用于落库 / 离线分桶）。
 *
 * @param {object} input
 * @param {Array<{data:number[][]}>|number[][][]} input.shapes 本轮候选三块
 * @param {number} input.occupiedCount 盘面已占用格数
 * @param {number} [input.boardDifficulty] 既有原语 clamp01(fill + holePressure*0.8)
 * @param {object|null} [input.solutionMetrics] evaluateTripletSolutions 返回值（可空）
 * @param {(data:number[][])=>number} [input.countLegal] 形状在盘面合法落点数
 * @param {(shape:any)=>string} [input.categoryOf] 形状家族
 * @param {number[]} [input.spatialFeatures] 空间规划廉价 3 维 [regionEntropy, largestRegionRatio, smallRegionCellRatio]
 *   （来自 spatialPlanning.spatialPlanningFeatures）。提供时启用 fragmentation 项；缺省自动重分配其权重。
 * @param {object} [cfg]
 */
export function computeSpawnStepDifficulty(input = {}, cfg) {
    const c = mergeConfig(cfg);
    const {
        shapes = [],
        occupiedCount = 0,
        boardDifficulty = null,
        solutionMetrics = null,
        countLegal = null,
        categoryOf = null,
        spatialFeatures = null
    } = input;

    const cls = classifyTriplet(shapes, { countLegal, categoryOf }, c);
    const scd = scdScore(cls.comboTotalCells, occupiedCount, c);
    const scdNorm = clamp01(scd / c.scdSaturation);

    const boardTerm = clamp01(Number.isFinite(boardDifficulty) ? boardDifficulty : 0);

    /* 机动性短板：minFlexibility 越低越难（1 - 归一化自由度）。无 countLegal 时中性 0.5 */
    const flexTerm = cls.minFlexibility == null
        ? 0.5
        : clamp01(1 - cls.minFlexibility / c.flexibilityFree);

    /* 解空间稀缺度：solutionCount 越少越难。truncated/capped 视为解充裕(0)，无数据中性 0.5 */
    let solutionTerm = 0.5;
    let solutionCount = null;
    if (solutionMetrics && typeof solutionMetrics === 'object') {
        if (solutionMetrics.capped || solutionMetrics.truncated) {
            solutionTerm = 0;
        } else if (Number.isFinite(solutionMetrics.solutionCount)) {
            solutionCount = solutionMetrics.solutionCount;
            solutionTerm = clamp01(1 - solutionCount / c.solutionAbundant);
        }
    }

    /* killer 压力：致命块占比 + 长条占比的较温和合成（各 /3） */
    const killerTerm = clamp01((cls.comboKillerCnt + cls.comboLongBarCnt * 0.5) / 3);

    /* v1.67 fragmentation：空白区域熵 + 小死腔占比的合成（弥补 fill/scd 的片面性）。
     * spatialFeatures 缺省时该项不参与，其权重按比例重分配给其余 5 项（避免难度系统性偏低）。 */
    const ff = c.fragmentationFrom || {};
    let fragmentationTerm = null;
    if (Array.isArray(spatialFeatures) && spatialFeatures.length >= 3) {
        const regionEntropy = clamp01(spatialFeatures[0]);
        const smallRegionCellRatio = clamp01(spatialFeatures[2]);
        fragmentationTerm = clamp01(
            regionEntropy * (Number(ff.regionEntropy) || 0)
            + smallRegionCellRatio * (Number(ff.smallRegionCellRatio) || 0)
        );
    }

    const w = c.weights;
    const wFragActive = fragmentationTerm != null ? (Number(w.fragmentation) || 0) : 0;
    const wSum = (Number(w.scd) || 0) + (Number(w.board) || 0) + (Number(w.flexibility) || 0)
        + (Number(w.solution) || 0) + (Number(w.killer) || 0) + wFragActive;
    const stepDifficulty = wSum > 0 ? clamp01((
        w.scd * scdNorm
        + w.board * boardTerm
        + w.flexibility * flexTerm
        + w.solution * solutionTerm
        + w.killer * killerTerm
        + (fragmentationTerm != null ? wFragActive * fragmentationTerm : 0)
    ) / wSum) : 0;

    return {
        version: SPAWN_STEP_DIFFICULTY_VERSION,
        stepDifficulty,
        bucket: difficultyBucket(stepDifficulty),
        scdScore: scd,
        scdLevel: scdLevel(scd, c),
        comboTotalCells: cls.comboTotalCells,
        comboKillerCnt: cls.comboKillerCnt,
        comboLongBarCnt: cls.comboLongBarCnt,
        isHomogeneousFamily: cls.isHomogeneousFamily,
        minFlexibility: cls.minFlexibility,
        boardDifficulty: Number.isFinite(boardDifficulty) ? boardDifficulty : null,
        solutionCount,
        fragmentation: fragmentationTerm,
        terms: {
            scd: scdNorm,
            board: boardTerm,
            flexibility: flexTerm,
            solution: solutionTerm,
            killer: killerTerm,
            fragmentation: fragmentationTerm != null ? fragmentationTerm : 0
        }
    };
}
