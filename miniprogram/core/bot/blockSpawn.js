/**
 * 候选块出块算法层：依赖 Grid + 策略里的 shapeWeights + spawnHints。
 *
 * spawnHints（来自自适应引擎）：
 *   clearGuarantee  (0-3) 三连块中至少 N 个能触发即时消行
 *   sizePreference  (-1~1) 负=偏小块，正=偏大块
 *   diversityBoost  (0~1) 越高→三连块品类越多样
 *
 * 核心不变量：
 *   1. 在中高填充下仍验证 tripletSequentiallySolvable（避免不公平死局）
 *   2. 保证最低机动性（minMobilityTarget）
 */

const { getAllShapes, getShapeCategory, pickShapeByCategoryWeights } = require('../shapes');

const MAX_SPAWN_ATTEMPTS = 18;
const FILL_SURVIVABILITY_ON = 0.52;
const SURVIVE_SEARCH_BUDGET = 14000;

/** @param {number[][]} data */
function shapeCellCount(data) {
    let n = 0;
    for (let y = 0; y < data.length; y++) {
        for (let x = 0; x < data[y].length; x++) {
            if (data[y][x]) {
                n++;
            }
        }
    }
    return n;
}

/**
 * @param {import('../grid.js').Grid} grid
 * @param {number[][]} shapeData
 */
function countLegalPlacements(grid, shapeData) {
    let c = 0;
    const n = grid.size;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.canPlace(shapeData, x, y)) {
                c++;
            }
        }
    }
    return c;
}

/** @param {number[][]} a @param {number[][]} b @param {number[][]} c */
function permutations3(a, b, c) {
    return [
        [a, b, c],
        [a, c, b],
        [b, a, c],
        [b, c, a],
        [c, a, b],
        [c, b, a]
    ];
}

/**
 * @param {import('../grid.js').Grid} grid
 * @param {number[][]} shapeData
 */
function placeAndClear(grid, shapeData, gx, gy) {
    const g = grid.clone();
    g.place(shapeData, 0, gx, gy);
    g.checkLines();
    return g;
}

/**
 * @param {import('../grid.js').Grid} grid
 * @param {number[][][]} orderedShapes
 * @param {number} depth
 * @param {{ n: number }} budget
 * @returns {boolean}
 */
function dfsPlaceOrder(grid, orderedShapes, depth, budget) {
    if (depth >= orderedShapes.length) {
        return true;
    }
    const s = orderedShapes[depth];
    const n = grid.size;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (!grid.canPlace(s, x, y)) {
                continue;
            }
            if (budget.n <= 0) {
                return true;
            }
            budget.n--;
            const next = placeAndClear(grid, s, x, y);
            if (dfsPlaceOrder(next, orderedShapes, depth + 1, budget)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 是否存在某种放下顺序，使三块均能落下（每步后执行消行/列）。
 * @param {import('../grid.js').Grid} grid
 * @param {number[][][]} threeData
 */
function tripletSequentiallySolvable(grid, threeData) {
    if (threeData.length !== 3) {
        return true;
    }
    const [a, b, c] = threeData;
    const budget = { n: SURVIVE_SEARCH_BUDGET };
    for (const perm of permutations3(a, b, c)) {
        if (dfsPlaceOrder(grid, perm, 0, budget)) {
            return true;
        }
        if (budget.n <= 0) {
            return true;
        }
    }
    return false;
}

/**
 * 盘面越满，对「最少合法落点数」要求越高（用于重试门槛）。
 * @param {number} fill
 * @param {number} attempt
 */
function minMobilityTarget(fill, attempt) {
    const relax = Math.floor(attempt / 5);
    let t = 1;
    if (fill >= 0.88) {
        t = 8;
    } else if (fill >= 0.75) {
        t = 5;
    } else if (fill >= 0.62) {
        t = 3;
    } else if (fill >= 0.48) {
        t = 2;
    }
    return Math.max(1, t - relax);
}

/**
 * @param {import('../grid.js').Grid} grid
 * @param {{ shape: { id: string, data: number[][] }, placements: number }[]} chosen
 */
function minPlacementsOf(chosen) {
    if (chosen.length === 0) {
        return 999;
    }
    return Math.min(...chosen.map((c) => c.placements));
}

/**
 * @param {import('../grid.js').Grid} grid
 * @param {object} strategyConfig
 * @returns {Array<{ id: string, name?: string, category: string, data: number[][] }>}
 */
function generateDockShapes(grid, strategyConfig) {
    const weights = strategyConfig.shapeWeights || {};
    const hints = strategyConfig.spawnHints || {};
    const clearTarget = Math.max(0, Math.min(3, hints.clearGuarantee ?? 1));
    const sizePref = hints.sizePreference ?? 0;
    const divBoost = hints.diversityBoost ?? 0;

    const allShapes = getAllShapes();
    const fill = grid.getFillRatio();

    const scored = allShapes
        .map((shape) => {
            const canPlace = grid.canPlaceAnywhere(shape.data);
            const gapFills = canPlace ? grid.countGapFills(shape.data) : 0;
            const category = getShapeCategory(shape.id);
            const weight = weights[category] ?? 1;
            const placements = canPlace ? countLegalPlacements(grid, shape.data) : 0;
            return { shape, canPlace, gapFills, weight, category, placements };
        })
        .filter((s) => s.canPlace);

    if (scored.length === 0) {
        return [];
    }

    scored.sort((a, b) => b.gapFills - a.gapFills);

    const pickWeighted = (pool) => {
        const totalWeight = pool.reduce((sum, s) => sum + s.w, 0);
        let rand = Math.random() * totalWeight;
        let idx = 0;
        for (let i = 0; i < pool.length; i++) {
            rand -= pool[i].w;
            if (rand <= 0) {
                idx = i;
                break;
            }
        }
        return pool[idx];
    };

    for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
        const blocks = [];
        const usedIds = {};
        const usedCategories = {};
        const mobTarget = minMobilityTarget(fill, attempt);
        const chosenMeta = [];
        let clearCount = 0;

        /* -- 阶段 1：填充消行候选（受 clearGuarantee 控制）-- */
        const clearCandidates = scored.filter((s) => s.gapFills > 0);
        const clearSeats = Math.min(clearTarget, clearCandidates.length, 2);
        for (let ci = 0; ci < clearSeats; ci++) {
            const avail = clearCandidates.filter(s => !usedIds[s.shape.id]);
            if (avail.length === 0) break;
            const k = Math.min(3, avail.length);
            const pick = avail[Math.floor(Math.random() * k)];
            blocks.push(pick.shape);
            usedIds[pick.shape.id] = true;
            usedCategories[pick.category] = (usedCategories[pick.category] || 0) + 1;
            chosenMeta.push({ shape: pick.shape, placements: pick.placements });
            clearCount++;
        }

        /* -- 阶段 2：加权抽样补齐 -- */
        const augmentPool = (list) => {
            const bulkyCells = chosenMeta.reduce((s, m) => s + shapeCellCount(m.shape.data), 0);
            const wantSmall = fill > 0.52 && bulkyCells >= 10;
            return list.map((s) => {
                let w = s.weight;
                const pc = s.placements;
                w *= 1 + Math.log1p(pc) * (0.35 + fill * 0.55);
                if (fill > 0.45 && minPlacementsOf(chosenMeta) < mobTarget + 2) {
                    w *= 1 + pc / (8 + fill * 24);
                }

                /* sizePreference: <0 偏小块, >0 偏大块 */
                const cells = shapeCellCount(s.shape.data);
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

                /* diversityBoost: 惩罚已选品类 */
                if (divBoost > 0 && usedCategories[s.category]) {
                    w *= Math.max(0.2, 1 - divBoost * usedCategories[s.category]);
                }

                /* clearGuarantee: 还差消行块时提升消行候选权重 */
                if (clearCount < clearTarget && s.gapFills > 0) {
                    w *= 1.6;
                }

                return { entry: s, w };
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
            chosenMeta.push({ shape: entry.shape, placements: entry.placements });
            if (entry.gapFills > 0) clearCount++;
            remaining = scored.filter((s) => !usedIds[s.shape.id]);
        }

        while (blocks.length < 3) {
            const p = pickShapeByCategoryWeights(weights);
            if (!p) break;
            blocks.push(p);
            chosenMeta.push({ shape: p, placements: countLegalPlacements(grid, p.data) });
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

        for (let i = triplet.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [triplet[i], triplet[j]] = [triplet[j], triplet[i]];
        }
        return triplet;
    }

    /* 兜底：尽量带机动性加权的一次抽样 */
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
    return blocks.slice(0, 3);
}

/** @deprecated 使用 generateDockShapes */
const generateBlocksForGrid = generateDockShapes;

module.exports = { generateBlocksForGrid, generateDockShapes };
