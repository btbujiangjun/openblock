/* 自动生成 —— 请勿手改。源：web/src/bot/constructiveSpawn.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * 构造式出块辅助（有界 · 纯几何 · 只读）
 *
 * 设计动机（见 docs/algorithms/ALGORITHMS_SPAWN.md「构造式出块」）：
 * 现有 generateDockShapes 是「选择式」——只能从 scored 候选里采样，命中清屏取决于
 * 「恰好有目录形状的 footprint 匹配当前缺口」。当 clearCandidates 为空（没有任何形状
 * 能补当前近满缺口）时，选择式无法重塑盘面，低压清屏达成率被卡住。
 *
 * 本模块在【固定 40 形状词表】内提供两层有界构造能力，供 blockSpawn 概率式调用：
 *   - findCompleterShapes：逆向「缺口 → 形状」检索。给定一条近满线的精确残缺格
 *     （来自 boardTopology.detectNearClears().rows/cols[].emptyCells），返回词表中
 *     存在某合法放置能【覆盖全部残缺格】的形状（= 放下即补满该线）。解决「补全块
 *     存在但加权采样错过」。
 *   - findSetupShapes：1 步前瞻「先铺后清」。当无单形状可立即补全时，返回放下后能
 *     让某条线变成近满、且该近满线残缺【可被词表某形状补全】的 setup 形状，并给出
 *     目标线（供跨 dock 续接）。解决选择式无法「制造机会」的根本缺陷。
 *
 * 所有函数只读盘面（findSetupShapes 内部对占用矩阵做 mutate/revert，对外不可见），
 * 不依赖 Grid 类，便于单测与 sync-core 镜像到小程序。
 *
 * 复杂度护栏：所有搜索都接受 budget（最多测试的放置数）并在命中 maxResults 时短路；
 * completer 检索用「形状填充格锚定到目标格」把每形状放置数压到 O(填充格数) 而非全盘扫描。
 */

/**
 * @typedef {Array<Array<number>>} ShapeData  形状矩阵（1=填充，0=空）
 * @typedef {{ id: string, data: ShapeData }} CatalogShape
 * @typedef {Array<[number, number]>} CellList  [y, x] 列表
 */

/** 从 grid 读出布尔占用矩阵（true=已占用），与 Grid.canPlace 的 `cells[y][x]!==null` 同口径。 */
function occFromGrid(grid) {
    const size = grid.size;
    const occ = [];
    for (let y = 0; y < size; y++) {
        const row = new Array(size);
        for (let x = 0; x < size; x++) row[x] = grid.cells[y][x] !== null;
        occ[y] = row;
    }
    return { occ, size };
}

/** 形状能否在 (gx,gy) 落子：所有填充格落在界内且未占用。 */
function canPlace(occ, size, data, gx, gy) {
    for (let y = 0; y < data.length; y++) {
        const row = data[y];
        for (let x = 0; x < row.length; x++) {
            if (!row[x]) continue;
            const nx = gx + x;
            const ny = gy + y;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) return false;
            if (occ[ny][nx]) return false;
        }
    }
    return true;
}

/** 形状落子后是否覆盖 targetCells 里的【全部】目标格（用于「补满该线」判定）。 */
function coversAll(data, gx, gy, targetCells) {
    for (let i = 0; i < targetCells.length; i++) {
        const ty = targetCells[i][0];
        const tx = targetCells[i][1];
        const sy = ty - gy;
        const sx = tx - gx;
        if (sy < 0 || sy >= data.length) return false;
        const row = data[sy];
        if (!row || sx < 0 || sx >= row.length || !row[sx]) return false;
    }
    return true;
}

/** 形状填充格数。 */
function filledCount(data) {
    let n = 0;
    for (let y = 0; y < data.length; y++) {
        for (let x = 0; x < data[y].length; x++) if (data[y][x]) n++;
    }
    return n;
}

/** 列出形状落子后占用的棋盘格 [y,x]（已假定 canPlace 通过）。 */
function placedCells(data, gx, gy) {
    const out = [];
    for (let y = 0; y < data.length; y++) {
        for (let x = 0; x < data[y].length; x++) {
            if (data[y][x]) out.push([gy + y, gx + x]);
        }
    }
    return out;
}

/**
 * 在占用矩阵上检测近满行/列（emptyCount ∈ [1, maxEmpty]），返回每条线的残缺格。
 * 与 boardTopology.detectNearClears 同口径，但 requireFillable=false（构造侧自带补全校验）。
 * @returns {Array<{ key: string, type: 'row'|'col', index: number, emptyCells: CellList }>}
 */
function nearFullLines(occ, size, maxEmpty) {
    const lines = [];
    for (let y = 0; y < size; y++) {
        const emptyCells = [];
        for (let x = 0; x < size; x++) if (!occ[y][x]) emptyCells.push([y, x]);
        if (emptyCells.length >= 1 && emptyCells.length <= maxEmpty) {
            lines.push({ key: `r${y}`, type: 'row', index: y, emptyCells });
        }
    }
    for (let x = 0; x < size; x++) {
        const emptyCells = [];
        for (let y = 0; y < size; y++) if (!occ[y][x]) emptyCells.push([y, x]);
        if (emptyCells.length >= 1 && emptyCells.length <= maxEmpty) {
            lines.push({ key: `c${x}`, type: 'col', index: x, emptyCells });
        }
    }
    return lines;
}

/** 在某占用矩阵上，判断是否存在任一词表形状能补全 targetCells（锚定搜索，命中即返回）。 */
function hasCompleterOnOcc(occ, size, targetCells, catalog) {
    if (!targetCells.length) return false;
    const t0y = targetCells[0][0];
    const t0x = targetCells[0][1];
    for (let c = 0; c < catalog.length; c++) {
        const data = catalog[c].data;
        for (let y = 0; y < data.length; y++) {
            for (let x = 0; x < data[y].length; x++) {
                if (!data[y][x]) continue;
                const gx = t0x - x;
                const gy = t0y - y;
                if (canPlace(occ, size, data, gx, gy) && coversAll(data, gx, gy, targetCells)) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * C1 逆向「缺口 → 形状」补全检索。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {CellList} targetCells 目标残缺格（某条近满线的 emptyCells，[y,x] 列表）
 * @param {Array<CatalogShape>} catalog 候选形状（通常 = 当前可放置的常规池）
 * @param {{ maxResults?: number, budget?: number }} [opts]
 * @returns {Array<{ shapeId: string, gx: number, gy: number, exact: boolean, extra: number }>}
 *   exact=true 表示形状填充格数 == 目标格数（无溢出，最干净的补全）；extra=溢出格数。
 *   结果按 exact 优先、extra 升序排序。
 */
export function findCompleterShapes(grid, targetCells, catalog, opts = {}) {
    const maxResults = opts.maxResults ?? 8;
    let budget = opts.budget ?? 4000;
    const out = [];
    if (!grid?.cells?.length || !Array.isArray(targetCells) || targetCells.length === 0) return out;
    const { occ, size } = occFromGrid(grid);
    const t0y = targetCells[0][0];
    const t0x = targetCells[0][1];

    for (let c = 0; c < catalog.length && out.length < maxResults && budget > 0; c++) {
        const shape = catalog[c];
        const data = shape.data;
        const fc = filledCount(data);
        if (fc < targetCells.length) continue; // 填充格不足，无法覆盖全部目标
        let found = null;
        /* 锚定：让形状的每个填充格依次对齐到第一个目标格，把放置数压到 O(填充格数)。 */
        for (let y = 0; y < data.length && !found; y++) {
            for (let x = 0; x < data[y].length && !found; x++) {
                if (!data[y][x]) continue;
                budget--;
                const gx = t0x - x;
                const gy = t0y - y;
                if (canPlace(occ, size, data, gx, gy) && coversAll(data, gx, gy, targetCells)) {
                    found = { gx, gy };
                }
            }
        }
        if (found) {
            out.push({ shapeId: shape.id, gx: found.gx, gy: found.gy, exact: fc === targetCells.length, extra: fc - targetCells.length });
        }
    }
    out.sort((a, b) => (a.exact === b.exact ? a.extra - b.extra : (a.exact ? -1 : 1)));
    return out;
}

/**
 * C2 1 步前瞻「先铺后清」。
 *
 * 当无单形状可立即补全（C1 空）时调用：找出放下后能让某条线变成近满、且该近满线
 * 残缺【可被词表某形状补全】的 setup 形状。返回的 target 供 blockSpawn 写入
 * _spawnContext.pendingClearTarget 做跨 dock 续接。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {Array<CatalogShape>} catalog
 * @param {{ maxEmpty?: number, maxResults?: number, budget?: number, perShapePlacementCap?: number }} [opts]
 * @returns {Array<{ shapeId: string, gx: number, gy: number, target: { type: 'row'|'col', index: number, emptyCells: CellList } }>}
 */
export function findSetupShapes(grid, catalog, opts = {}) {
    const maxEmpty = opts.maxEmpty ?? 2;
    const maxResults = opts.maxResults ?? 4;
    let budget = opts.budget ?? 6000;
    const perShapeCap = opts.perShapePlacementCap ?? 40;
    const out = [];
    if (!grid?.cells?.length) return out;
    const { occ, size } = occFromGrid(grid);

    /* 当前已近满的线 key 集合——只接受 setup 放置「新产生」的近满线，避免把已存在的
     * 近满线误记为造势成果（那本就该走 C1 补全）。 */
    const before = new Set(nearFullLines(occ, size, maxEmpty).map((l) => l.key));

    for (let c = 0; c < catalog.length && out.length < maxResults && budget > 0; c++) {
        const data = catalog[c].data;
        const fc = filledCount(data);
        if (fc === 0) continue;
        let placed = 0;
        for (let gy = 0; gy < size && out.length < maxResults && budget > 0; gy++) {
            for (let gx = 0; gx < size && out.length < maxResults && budget > 0; gx++) {
                if (placed >= perShapeCap) break;
                if (!canPlace(occ, size, data, gx, gy)) continue;
                budget--;
                placed++;
                const cells = placedCells(data, gx, gy);
                /* mutate：临时落子 */
                for (let i = 0; i < cells.length; i++) occ[cells[i][0]][cells[i][1]] = true;
                /* 检测新产生且可补全的近满线 */
                let hit = null;
                const after = nearFullLines(occ, size, maxEmpty);
                for (let li = 0; li < after.length && !hit; li++) {
                    const line = after[li];
                    if (before.has(line.key)) continue; // 已存在，非本次造势
                    if (hasCompleterOnOcc(occ, size, line.emptyCells, catalog)) {
                        hit = line;
                    }
                }
                /* revert：撤销落子 */
                for (let i = 0; i < cells.length; i++) occ[cells[i][0]][cells[i][1]] = false;
                if (hit) {
                    out.push({
                        shapeId: catalog[c].id,
                        gx, gy,
                        target: { type: hit.type, index: hit.index, emptyCells: hit.emptyCells }
                    });
                    break; // 每形状最多记 1 个 setup 放置
                }
            }
        }
    }
    return out;
}

/**
 * C3 多消补全器（v1.70 温暖局）—— 找到一个形状，其某个合法放置能同时填满 ≥ minClears 条候选线。
 *
 * 设计动机：findCompleterShapes 只解决「单线补满」，但温暖局需要主动制造 multiClear。
 * 本函数枚举每个候选形状的每个合法放置，统计该放置能补满几条候选线（候选线可来自 nearFullLines
 * 或外部传入的 candidateLines），返回能补满 ≥ minClears 的方案。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {Array<CatalogShape>} catalog
 * @param {{ minClears?: number, maxResults?: number, budget?: number, candidateLines?: Array }} [opts]
 * @returns {Array<{ shapeId: string, gx: number, gy: number, clears: number, lineKeys: string[] }>}
 *   按 clears 降序排序；同分按形状面积升序（更小的块更易玩家成功放置）。
 */
export function findMultiClearCompleter(grid, catalog, opts = {}) {
    const minClears = Math.max(2, opts.minClears ?? 2);
    const maxResults = opts.maxResults ?? 4;
    let budget = opts.budget ?? 5000;
    const out = [];
    if (!grid?.cells?.length) return out;
    const { occ, size } = occFromGrid(grid);

    /* 候选近满线：外部传入优先；否则就地扫描所有 emptyCount ∈ [1,3] 的行/列。 */
    const lines = Array.isArray(opts.candidateLines) && opts.candidateLines.length
        ? opts.candidateLines
        : nearFullLines(occ, size, 3);
    if (lines.length < minClears) return out;

    for (let c = 0; c < catalog.length && out.length < maxResults && budget > 0; c++) {
        const shape = catalog[c];
        const data = shape.data;
        const fc = filledCount(data);
        if (fc === 0) continue;
        let best = null;
        for (let gy = 0; gy < size && budget > 0; gy++) {
            for (let gx = 0; gx < size && budget > 0; gx++) {
                if (!canPlace(occ, size, data, gx, gy)) continue;
                budget--;
                /* 临时落子统计能补满多少候选线。 */
                const cells = placedCells(data, gx, gy);
                for (let i = 0; i < cells.length; i++) occ[cells[i][0]][cells[i][1]] = true;
                let clears = 0;
                const lineKeys = [];
                for (let li = 0; li < lines.length; li++) {
                    const line = lines[li];
                    let full = true;
                    if (line.type === 'row') {
                        for (let x = 0; x < size; x++) if (!occ[line.index][x]) { full = false; break; }
                    } else {
                        for (let y = 0; y < size; y++) if (!occ[y][line.index]) { full = false; break; }
                    }
                    if (full) { clears++; lineKeys.push(line.key || `${line.type[0]}${line.index}`); }
                }
                for (let i = 0; i < cells.length; i++) occ[cells[i][0]][cells[i][1]] = false;
                if (clears >= minClears && (!best || clears > best.clears)) {
                    best = { shapeId: shape.id, gx, gy, clears, lineKeys, fc };
                }
            }
        }
        if (best) out.push(best);
    }
    out.sort((a, b) => (b.clears - a.clears) || (a.fc - b.fc));
    return out.map(({ fc, ...r }) => r); // eslint-disable-line no-unused-vars
}

/**
 * C4 清屏三连（v1.70 温暖局）—— 在棋盘几近空（剩余空格 ≤ maxRemaining）时搜索可清屏三连。
 *
 * 这是「温暖局救济」的最强武器：找出三个形状的有序组合，使得依次放置后所有空格被填满
 * 且每个形状放置后均能立即消行（最终清屏）。复杂度有界：早剪枝（剩余格数 < ∑ 形状面积时 prune）+
 * budget 限制 + 形状面积排序。
 *
 * 由于复杂度，本函数仅在 boardFill ≤ 0.25 时调用，且只搜 N 最高填充优先的 catalog 前 12 个形状。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {Array<CatalogShape>} catalog
 * @param {{ maxRemaining?: number, budget?: number, topK?: number }} [opts]
 * @returns {Array<{ shapeIds: [string, string, string], placements: Array<{gx:number, gy:number}> }>}
 */
export function findPerfectClearTriplet(grid, catalog, opts = {}) {
    const maxRemaining = opts.maxRemaining ?? 15;
    let budget = opts.budget ?? 8000;
    const topK = opts.topK ?? 12;
    const out = [];
    if (!grid?.cells?.length || !catalog?.length) return out;
    const { occ, size } = occFromGrid(grid);
    /* 统计空格数 */
    let emptyCount = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!occ[y][x]) emptyCount++;
    if (emptyCount === 0 || emptyCount > maxRemaining) return out;

    /* 优先选填充格数较大的形状（更易凑齐）。 */
    const sorted = catalog
        .map((s) => ({ s, fc: filledCount(s.data) }))
        .filter((x) => x.fc > 0)
        .sort((a, b) => b.fc - a.fc)
        .slice(0, topK)
        .map((x) => x.s);

    function placeAndRevert(data, gx, gy, fn) {
        const cells = placedCells(data, gx, gy);
        for (let i = 0; i < cells.length; i++) occ[cells[i][0]][cells[i][1]] = true;
        let r;
        try { r = fn(cells); } finally {
            for (let i = 0; i < cells.length; i++) occ[cells[i][0]][cells[i][1]] = false;
        }
        return r;
    }

    /* DFS 深度 3：每层尝试每个形状的每个 canPlace 放置，要求该放置触发消行（保持温暖体感）。 */
    function dfs(depth, picks, emptyLeft) {
        if (depth === 3) {
            if (emptyLeft === 0) {
                out.push({
                    shapeIds: picks.map((p) => p.shapeId),
                    placements: picks.map((p) => ({ gx: p.gx, gy: p.gy })),
                });
            }
            return out.length >= 1; // 找到一个即可
        }
        for (let c = 0; c < sorted.length && out.length === 0 && budget > 0; c++) {
            const shape = sorted[c];
            const data = shape.data;
            const fc = filledCount(data);
            if (fc > emptyLeft) continue;
            for (let gy = 0; gy < size && out.length === 0 && budget > 0; gy++) {
                for (let gx = 0; gx < size && out.length === 0 && budget > 0; gx++) {
                    if (!canPlace(occ, size, data, gx, gy)) continue;
                    budget--;
                    placeAndRevert(data, gx, gy, () => {
                        picks.push({ shapeId: shape.id, gx, gy });
                        dfs(depth + 1, picks, emptyLeft - fc);
                        picks.pop();
                    });
                }
            }
        }
        return out.length >= 1;
    }
    dfs(0, [], emptyCount);
    return out;
}

/**
 * C5 大块补全器（v1.70 温暖局）—— 找到面积 ≥ minSize 的「大块」形状的合法放置。
 *
 * 温暖局的硬约束：三连中 largeBlockMinRatio 比例必须是大块。调用方用本函数补足缺失大块。
 * 与 findCompleterShapes 不同，本函数不要求补全任何近满线，只要求形状本身足够大且能放下。
 *
 * @param {import('../grid.js').Grid} grid
 * @param {Array<CatalogShape>} catalog
 * @param {{ minSize?: number, maxResults?: number, budget?: number }} [opts]
 * @returns {Array<{ shapeId: string, gx: number, gy: number, size: number }>}
 */
export function findLargeBlockCompleter(grid, catalog, opts = {}) {
    const minSize = opts.minSize ?? 4;
    const maxResults = opts.maxResults ?? 6;
    let budget = opts.budget ?? 2000;
    const out = [];
    if (!grid?.cells?.length) return out;
    const { occ, size } = occFromGrid(grid);
    for (let c = 0; c < catalog.length && out.length < maxResults && budget > 0; c++) {
        const shape = catalog[c];
        const fc = filledCount(shape.data);
        if (fc < minSize) continue;
        for (let gy = 0; gy < size && budget > 0; gy++) {
            for (let gx = 0; gx < size && budget > 0; gx++) {
                budget--;
                if (canPlace(occ, size, shape.data, gx, gy)) {
                    out.push({ shapeId: shape.id, gx, gy, size: fc });
                    break;
                }
            }
            if (out.length > 0 && out[out.length - 1].shapeId === shape.id) break;
        }
    }
    out.sort((a, b) => b.size - a.size);
    return out;
}

/**
 * 校验 pendingClearTarget 是否仍有效（跨 dock 续接前置校验）：
 * 目标线当前仍是「近满、残缺格仍空、且可被词表补全」。盘面已变（玩家自己消掉 / 填爆）则失效。
 * @returns {boolean}
 */
export function isClearTargetValid(grid, target, catalog, opts = {}) {
    const maxEmpty = opts.maxEmpty ?? 2;
    if (!grid?.cells?.length || !target || !Array.isArray(target.emptyCells)) return false;
    const { occ, size } = occFromGrid(grid);
    const empties = [];
    for (const cell of target.emptyCells) {
        const y = cell[0];
        const x = cell[1];
        if (y < 0 || y >= size || x < 0 || x >= size) return false;
        if (occ[y][x]) return false; // 目标残缺格已被填，目标失效
        empties.push([y, x]);
    }
    if (empties.length < 1 || empties.length > maxEmpty) return false;
    return hasCompleterOnOcc(occ, size, empties, catalog);
}
