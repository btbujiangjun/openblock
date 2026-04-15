/**
 * 候选块出块算法层（三层架构）
 *
 * Layer 1 — 即时盘面感知：拓扑评分（空洞/表面平整/多消潜力）+ 反死局
 * Layer 2 — 局内体验：combo 链催化、跨轮品类记忆、节奏 setup/payoff、清屏奖励
 * Layer 3 — 局间弧线：通过 spawnHints.sessionArc / milestone / returnWarmup 影响权重
 *
 * spawnHints（来自自适应引擎 adaptiveSpawn.js）：
 *   clearGuarantee  (0-3)   三连块中至少 N 个能触发即时消行
 *   sizePreference  (-1~1)  负=偏小块，正=偏大块
 *   diversityBoost  (0~1)   越高→三连块品类越多样
 *   comboChain      (0~1)   combo 链强度：越高越偏好能续链的消行块
 *   multiClearBonus (0~1)   多消鼓励：越高越偏好能同时完成多行的块
 *   rhythmPhase     'setup'|'payoff'|'neutral'  节奏相位
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
 *   3. 返回 _spawnDiagnostics 供策略面板解释
 */

import { getAllShapes, getShapeCategory, pickShapeByCategoryWeights } from '../shapes.js';

const MAX_SPAWN_ATTEMPTS = 22;
const FILL_SURVIVABILITY_ON = 0.52;
const SURVIVE_SEARCH_BUDGET = 14000;

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
            if (budget.n <= 0) return true;
            budget.n--;
            const next = placeAndClear(grid, s, x, y);
            if (dfsPlaceOrder(next, orderedShapes, depth + 1, budget)) return true;
        }
    }
    return false;
}

function tripletSequentiallySolvable(grid, threeData) {
    if (threeData.length !== 3) return true;
    const [a, b, c] = threeData;
    const budget = { n: SURVIVE_SEARCH_BUDGET };
    for (const perm of permutations3(a, b, c)) {
        if (dfsPlaceOrder(grid, perm, 0, budget)) return true;
        if (budget.n <= 0) return true;
    }
    return false;
}

function minMobilityTarget(fill, attempt) {
    const relax = Math.floor(attempt / 5);
    let t = 1;
    if (fill >= 0.88) t = 8;
    else if (fill >= 0.75) t = 5;
    else if (fill >= 0.62) t = 3;
    else if (fill >= 0.48) t = 2;
    return Math.max(1, t - relax);
}

function minPlacementsOf(chosen) {
    if (chosen.length === 0) return 999;
    return Math.min(...chosen.map((c) => c.placements));
}

/* ================================================================== */
/*  Layer 1: 盘面拓扑分析                                              */
/* ================================================================== */

/**
 * 分析盘面拓扑健康度：空洞、表面平整度、列高度分布
 * @param {import('../grid.js').Grid} grid
 * @returns {{ holes: number, flatness: number, maxColHeight: number, colHeights: number[], nearFullLines: number }}
 */
function analyzeBoardTopology(grid) {
    const n = grid.size;
    const colHeights = new Array(n).fill(0);

    for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) {
                colHeights[x] = n - y;
                break;
            }
        }
    }

    let holes = 0;
    for (let x = 0; x < n; x++) {
        let foundBlock = false;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) foundBlock = true;
            else if (foundBlock) holes++;
        }
    }

    let heightVariance = 0;
    const avgHeight = colHeights.reduce((s, h) => s + h, 0) / n;
    for (let x = 0; x < n; x++) {
        heightVariance += (colHeights[x] - avgHeight) ** 2;
    }
    heightVariance /= n;
    const flatness = 1 / (1 + heightVariance);

    const maxColHeight = Math.max(...colHeights);

    let nearFullLines = 0;
    for (let y = 0; y < n; y++) {
        let filled = 0;
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) filled++;
        }
        if (filled >= n - 2 && filled < n) nearFullLines++;
    }
    for (let x = 0; x < n; x++) {
        let filled = 0;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) filled++;
        }
        if (filled >= n - 2 && filled < n) nearFullLines++;
    }

    return { holes, flatness, maxColHeight, colHeights, nearFullLines };
}

/**
 * 评估形状在最佳放置位的"多消潜力"：扫描所有合法位，返回最大可同时消除行列数
 * 限制搜索预算，高填充时只采样部分位置
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
    const rhythmPhase = hints.rhythmPhase ?? 'neutral';

    const allShapes = getAllShapes();
    const fill = grid.getFillRatio();

    /* --- Layer 1: 盘面拓扑分析 --- */
    const topo = analyzeBoardTopology(grid);
    const doDeepAnalysis = fill > 0.35;

    const scored = allShapes
        .map((shape) => {
            const canPlace = grid.canPlaceAnywhere(shape.data);
            if (!canPlace) return null;
            const gapFills = grid.countGapFills(shape.data);
            const category = getShapeCategory(shape.id);
            const weight = weights[category] ?? 1;
            const placements = countLegalPlacements(grid, shape.data);

            let multiClear = 0;
            let holeReduce = 0;
            if (doDeepAnalysis) {
                multiClear = bestMultiClearPotential(grid, shape.data);
                if (topo.holes > 2 && fill > 0.5) {
                    holeReduce = bestHoleReduction(grid, shape.data, topo.holes);
                }
            }

            return { shape, canPlace: true, gapFills, weight, category, placements, multiClear, holeReduce };
        })
        .filter(Boolean);

    if (scored.length === 0) return [];

    scored.sort((a, b) => b.gapFills - a.gapFills || b.multiClear - a.multiClear);

    /* --- Layer 2: 品类记忆 --- */
    const mem = getCategoryMemory();
    const recentCats = ctx.recentCategories || mem.categories.flat();

    const catFreq = {};
    for (const cat of recentCats) {
        catFreq[cat] = (catFreq[cat] || 0) + 1;
    }

    const diagnostics = {
        layer1: { fill, holes: topo.holes, flatness: topo.flatness, nearFullLines: topo.nearFullLines, maxColHeight: topo.maxColHeight },
        layer2: { comboChain, multiClearBonus, rhythmPhase, divBoost, recentCatFreq: { ...catFreq } },
        layer3: { scoreMilestone: ctx.scoreMilestone || false, roundsSinceClear: ctx.roundsSinceClear ?? 0, totalRounds: ctx.totalRounds ?? mem.totalRounds },
        chosen: [],
        attempt: 0
    };

    for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
        const blocks = [];
        const usedIds = {};
        const usedCategories = {};
        const mobTarget = minMobilityTarget(fill, attempt);
        const chosenMeta = [];
        let clearCount = 0;

        /* -- 阶段 1: 消行候选（clearGuarantee + combo 催化 + 多消优先）-- */
        const clearCandidates = scored.filter((s) => s.gapFills > 0);
        if (comboChain > 0.3 || multiClearBonus > 0.3) {
            clearCandidates.sort((a, b) => {
                const aScore = a.multiClear * (1 + multiClearBonus) + a.gapFills * 0.5;
                const bScore = b.multiClear * (1 + multiClearBonus) + b.gapFills * 0.5;
                return bScore - aScore;
            });
        }

        const effectiveClearTarget = comboChain > 0.5
            ? Math.min(3, clearTarget + 1)
            : clearTarget;
        const clearSeats = Math.min(effectiveClearTarget, clearCandidates.length, 2);
        for (let ci = 0; ci < clearSeats; ci++) {
            const avail = clearCandidates.filter(s => !usedIds[s.shape.id]);
            if (avail.length === 0) break;

            let pick;
            if (multiClearBonus > 0.3 && avail.some(s => s.multiClear >= 2)) {
                const multi = avail.filter(s => s.multiClear >= 2);
                pick = multi[Math.floor(Math.random() * Math.min(3, multi.length))];
            } else {
                const k = Math.min(3, avail.length);
                pick = avail[Math.floor(Math.random() * k)];
            }
            blocks.push(pick.shape);
            usedIds[pick.shape.id] = true;
            usedCategories[pick.category] = (usedCategories[pick.category] || 0) + 1;
            chosenMeta.push({ shape: pick.shape, placements: pick.placements, reason: 'clear' });
            clearCount++;
        }

        /* -- 阶段 2: 加权抽样补齐（三层信号整合）-- */
        const augmentPool = (list) => {
            const bulkyCells = chosenMeta.reduce((s, m) => s + shapeCellCount(m.shape.data), 0);
            const wantSmall = fill > 0.52 && bulkyCells >= 10;
            return list.map((s) => {
                let w = s.weight;
                const pc = s.placements;

                /* Layer 1: 机动性保障 — 合法落点越多权重越高 */
                w *= 1 + Math.log1p(pc) * (0.35 + fill * 0.55);
                if (fill > 0.45 && minPlacementsOf(chosenMeta) < mobTarget + 2) {
                    w *= 1 + pc / (8 + fill * 24);
                }

                /* Layer 1: 空洞修复 — 高填充时优先减少空洞的块 */
                if (s.holeReduce > 0 && fill > 0.5) {
                    w *= 1 + s.holeReduce * 0.4;
                }

                /* Layer 1: 多消潜力 — 能同时消多行的块加权 */
                if (s.multiClear >= 2) {
                    w *= 1 + (s.multiClear - 1) * (0.3 + multiClearBonus * 0.5);
                }

                /* Layer 2: combo 链催化 — combo 活跃时偏好消行块 */
                if (comboChain > 0.1 && s.gapFills > 0) {
                    w *= 1 + comboChain * 0.8;
                }

                /* Layer 2: 节奏相位 */
                const cells = shapeCellCount(s.shape.data);
                if (rhythmPhase === 'payoff') {
                    if (s.gapFills > 0) w *= 1.3;
                    if (s.multiClear >= 2) w *= 1.2;
                } else if (rhythmPhase === 'setup') {
                    if (cells >= 4 && cells <= 6 && s.gapFills === 0) w *= 1.15;
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

                /* Layer 2: 品类多样性（同轮 + 跨轮记忆） */
                const catPenalty = usedCategories[s.category] || 0;
                const memPenalty = catFreq[s.category] || 0;
                if (divBoost > 0 && catPenalty > 0) {
                    w *= Math.max(0.2, 1 - divBoost * catPenalty);
                }
                if (memPenalty > 2) {
                    w *= Math.max(0.4, 1 - (memPenalty - 2) * 0.12);
                }

                /* clearGuarantee 补足 */
                if (clearCount < clearTarget && s.gapFills > 0) {
                    w *= 1.6;
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
            if (!tripletSequentiallySolvable(grid, datas)) continue;
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
        _lastDiagnostics = diagnostics;

        return triplet;
    }

    /* 兜底 */
    const blocks = [];
    const usedIds = {};
    const clearCandidates = scored.filter((s) => s.gapFills > 0);
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
