/**
 * 小程序端启发式三连块出块。
 *
 * CommonJS 版本裁剪自 web/src/bot/blockSpawn.js：保留盘面感知、消行/多消优先、
 * 品类多样性、最低机动性与中高填充顺序可玩性护栏，不迁移画像/RL/面板诊断。
 */
const { getAllShapes, getShapeCategory, pickShapeByCategoryWeights } = require('../core/shapes');

const MAX_SPAWN_ATTEMPTS = 22;
const FILL_SURVIVABILITY_ON = 0.52;
const SURVIVE_SEARCH_BUDGET = 9000;
const CRITICAL_FILL = 0.68;

let _categoryMemory = { categories: [], totalRounds: 0 };
let _lastDiagnostics = null;

function resetSpawnMemory() {
  _categoryMemory = { categories: [], totalRounds: 0 };
  _lastDiagnostics = null;
}

function getLastSpawnDiagnostics() {
  return _lastDiagnostics;
}

function shapeCellCount(data) {
  let n = 0;
  for (let y = 0; y < data.length; y++) {
    for (let x = 0; x < data[y].length; x++) {
      if (data[y][x]) n++;
    }
  }
  return n;
}

function countLegalPlacements(grid, shapeData) {
  let c = 0;
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (grid.canPlace(shapeData, x, y)) c++;
    }
  }
  return c;
}

function countOccupiedCells(grid) {
  let c = 0;
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (grid.cells[y][x] !== null) c++;
    }
  }
  return c;
}

function analyzeBoardTopology(grid) {
  const n = grid.size;
  let nearFullLines = 0;
  const colHeights = new Array(n).fill(0);
  let holes = 0;

  for (let y = 0; y < n; y++) {
    let filled = 0;
    for (let x = 0; x < n; x++) {
      if (grid.cells[y][x] !== null) filled++;
    }
    if (filled >= n - 2 && filled > 0) nearFullLines++;
  }

  for (let x = 0; x < n; x++) {
    let seenBlock = false;
    for (let y = 0; y < n; y++) {
      if (grid.cells[y][x] !== null) {
        seenBlock = true;
        colHeights[x] = Math.max(colHeights[x], n - y);
      } else if (seenBlock) {
        holes++;
      }
    }
    let filled = 0;
    for (let y = 0; y < n; y++) {
      if (grid.cells[y][x] !== null) filled++;
    }
    if (filled >= n - 2 && filled > 0) nearFullLines++;
  }

  const maxColHeight = Math.max(...colHeights);
  const minColHeight = Math.min(...colHeights);
  const flatness = 1 - Math.min(1, (maxColHeight - minColHeight) / Math.max(1, n));
  return { holes, nearFullLines, flatness, maxColHeight };
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
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.canPlace(s, x, y)) continue;
      if (budget.n <= 0) return !!budget.exhaustAsPass;
      budget.n--;
      if (dfsPlaceOrder(placeAndClear(grid, s, x, y), orderedShapes, depth + 1, budget)) return true;
    }
  }
  return false;
}

function tripletSequentiallySolvable(grid, threeData, opts = {}) {
  if (threeData.length !== 3) return true;
  const budget = {
    n: opts.searchBudget ?? SURVIVE_SEARCH_BUDGET,
    exhaustAsPass: opts.exhaustAsPass ?? true,
  };
  for (const perm of permutations3(threeData[0], threeData[1], threeData[2])) {
    if (dfsPlaceOrder(grid, perm, 0, budget)) return true;
    if (budget.n <= 0 && budget.exhaustAsPass) return true;
  }
  return false;
}

function minMobilityTarget(fill, attempt) {
  const relax = Math.floor(attempt / 5);
  let target = 1;
  if (fill >= 0.88) target = 10;
  else if (fill >= 0.75) target = 7;
  else if (fill >= 0.68) target = 5;
  else if (fill >= 0.62) target = 4;
  else if (fill >= 0.48) target = 2;
  return Math.max(1, target - relax);
}

function bestMultiClearPotential(grid, shapeData) {
  let best = 0;
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.canPlace(shapeData, x, y)) continue;
      const preview = grid.previewClearOutcome(shapeData, x, y, 0);
      const lines = preview ? preview.rows.length + preview.cols.length : 0;
      if (lines > best) best = lines;
    }
  }
  return best;
}

function analyzePerfectClearSetup(grid) {
  const n = grid.size;
  const nearFullRows = [];
  const nearFullCols = [];
  for (let y = 0; y < n; y++) {
    let filled = 0;
    for (let x = 0; x < n; x++) if (grid.cells[y][x] !== null) filled++;
    if (filled >= n - 2 && filled > 0) nearFullRows.push({ y, empty: n - filled });
  }
  for (let x = 0; x < n; x++) {
    let filled = 0;
    for (let y = 0; y < n; y++) if (grid.cells[y][x] !== null) filled++;
    if (filled >= n - 2 && filled > 0) nearFullCols.push({ x, empty: n - filled });
  }
  if (nearFullRows.length === 0 && nearFullCols.length === 0) return 0;

  const cleared = {};
  for (const { y } of nearFullRows) {
    for (let x = 0; x < n; x++) cleared[`${x},${y}`] = true;
  }
  for (const { x } of nearFullCols) {
    for (let y = 0; y < n; y++) cleared[`${x},${y}`] = true;
  }

  let remaining = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid.cells[y][x] !== null && !cleared[`${x},${y}`]) remaining++;
    }
  }
  const emptyNeeded = nearFullRows.reduce((s, r) => s + r.empty, 0)
    + nearFullCols.reduce((s, c) => s + c.empty, 0);
  if (remaining === 0 && emptyNeeded <= 11) return 2;
  if (remaining <= 4 && emptyNeeded <= 17) return 1;
  return 0;
}

function bestPerfectClearPotential(grid, shapeData) {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.canPlace(shapeData, x, y)) continue;
      const g = placeAndClear(grid, shapeData, x, y);
      if (g.getFillRatio() === 0) return 2;
    }
  }
  return 0;
}

function pickWeighted(pool) {
  const total = pool.reduce((sum, s) => sum + s.w, 0);
  if (total <= 0) return pool[0];
  let r = Math.random() * total;
  for (const item of pool) {
    r -= item.w;
    if (r <= 0) return item;
  }
  return pool[pool.length - 1];
}

function validateSpawnTriplet(grid, shapes, opts = {}) {
  if (!grid?.cells?.length) return { ok: false, reason: 'invalid-grid' };
  if (!Array.isArray(shapes) || shapes.length < 3) return { ok: false, reason: 'not-enough-shapes' };
  const triplet = shapes.slice(0, 3);
  const ids = {};
  for (const shape of triplet) {
    if (!shape?.id || !Array.isArray(shape.data)) return { ok: false, reason: 'invalid-shape' };
    if (ids[shape.id]) return { ok: false, reason: 'duplicate-shape' };
    ids[shape.id] = true;
    if (!grid.canPlaceAnywhere(shape.data)) return { ok: false, reason: 'shape-not-placeable' };
  }
  const fill = grid.getFillRatio();
  const minPlacements = Math.min(...triplet.map((s) => countLegalPlacements(grid, s.data)));
  if (minPlacements < minMobilityTarget(fill, 0)) return { ok: false, reason: 'low-mobility' };
  if (fill >= FILL_SURVIVABILITY_ON && !tripletSequentiallySolvable(grid, triplet.map((s) => s.data), opts)) {
    return { ok: false, reason: 'not-sequentially-solvable' };
  }
  return { ok: true };
}

function generateDockShapes(grid, strategyConfig, spawnContext = {}) {
  const weights = strategyConfig.shapeWeights || {};
  const hints = strategyConfig.spawnHints || {};
  const allShapes = getAllShapes();
  const fill = grid.getFillRatio();
  const topo = analyzeBoardTopology(grid);
  const pcSetup = analyzePerfectClearSetup(grid);
  const occupied = countOccupiedCells(grid);
  const evalPerfectClear = pcSetup > 0 || occupied <= 22 || fill <= 0.46;
  const nearFullFactor = Math.min(1, topo.nearFullLines / 5);
  const clearTarget = Math.max(0, Math.min(3, hints.clearGuarantee ?? 1));
  const sizePref = hints.sizePreference ?? 0;
  const divBoost = Math.max(0, Math.min(1, hints.diversityBoost ?? 0.12));
  const multiClearBonus = Math.max(0, Math.min(1, hints.multiClearBonus ?? 0.22));
  const multiLineTarget = Math.max(0, Math.min(2, hints.multiLineTarget ?? 0));
  const rhythmPhase = hints.rhythmPhase ?? 'neutral';

  const scored = allShapes.map((shape) => {
    if (!grid.canPlaceAnywhere(shape.data)) return null;
    const category = getShapeCategory(shape.id);
    const placements = countLegalPlacements(grid, shape.data);
    const gapFills = grid.countGapFills(shape.data);
    const multiClear = bestMultiClearPotential(grid, shape.data);
    const pcPotential = evalPerfectClear ? bestPerfectClearPotential(grid, shape.data) : 0;
    return {
      shape,
      category,
      weight: weights[category] ?? 1,
      placements,
      gapFills,
      multiClear,
      pcPotential,
    };
  }).filter(Boolean);

  if (scored.length === 0) return [];
  scored.sort((a, b) => b.pcPotential - a.pcPotential || b.multiClear - a.multiClear || b.gapFills - a.gapFills);

  const recentCats = spawnContext.recentCategories || _categoryMemory.categories.flat();
  const catFreq = {};
  for (const cat of recentCats) catFreq[cat] = (catFreq[cat] || 0) + 1;
  const diagnostics = {
    layer1: {
      fill,
      holes: topo.holes,
      flatness: topo.flatness,
      nearFullLines: topo.nearFullLines,
      maxColHeight: topo.maxColHeight,
      pcSetup,
    },
    chosen: [],
    attempt: 0,
  };

  for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
    const blocks = [];
    const usedIds = {};
    const usedCategories = {};
    const chosenMeta = [];
    let clearCount = 0;
    const mobTarget = minMobilityTarget(fill, attempt);
    const clearCandidates = scored.filter((s) => s.gapFills > 0 || s.multiClear >= 1 || s.pcPotential === 2);
    const clearSeats = pcSetup >= 2
      ? Math.min(3, clearCandidates.length)
      : Math.min(clearTarget, clearCandidates.length, topo.nearFullLines >= 4 ? 3 : 2);

    for (let ci = 0; ci < clearSeats; ci++) {
      const avail = clearCandidates.filter((s) => !usedIds[s.shape.id]);
      if (!avail.length) break;
      let pick;
      if (avail.some((s) => s.pcPotential === 2)) {
        pick = avail.filter((s) => s.pcPotential === 2)[0];
      } else if ((multiClearBonus > 0.3 || multiLineTarget >= 1) && avail.some((s) => s.multiClear >= 2)) {
        pick = avail.filter((s) => s.multiClear >= 2)[0];
      } else {
        pick = avail[Math.floor(Math.random() * Math.min(3, avail.length))];
      }
      blocks.push(pick.shape);
      usedIds[pick.shape.id] = true;
      usedCategories[pick.category] = (usedCategories[pick.category] || 0) + 1;
      chosenMeta.push({ shape: pick.shape, placements: pick.placements, reason: pick.pcPotential ? 'perfectClear' : 'clear' });
      clearCount++;
    }

    const augmentPool = (list) => list.map((s) => {
      let w = s.weight;
      const cells = shapeCellCount(s.shape.data);
      w *= 1 + Math.log1p(s.placements) * (0.35 + fill * 0.55);
      if (s.pcPotential === 2) w *= 18;
      else if (pcSetup >= 1 && s.gapFills > 0) w *= 1 + pcSetup * 3;
      if (s.multiClear >= 1) w *= 1 + s.multiClear * (0.6 + multiClearBonus * 0.6);
      if (multiLineTarget >= 2 && s.multiClear >= 2) w *= 1.45;
      if (nearFullFactor > 0 && s.gapFills > 0) w *= 1 + nearFullFactor * 2.0;
      if (rhythmPhase === 'payoff') {
        if (s.gapFills > 0) w *= 1.7;
        if (s.multiClear >= 2) w *= 1.4;
      }
      if (sizePref < -0.01) {
        if (cells <= 4) w *= 1 + Math.abs(sizePref) * 1.5;
        else if (cells >= 8) w *= 1 - Math.abs(sizePref) * 0.5;
      } else if (sizePref > 0.01) {
        if (cells >= 6) w *= 1 + sizePref * 1.2;
        else if (cells <= 3) w *= 1 - sizePref * 0.4;
      }
      const catPenalty = usedCategories[s.category] || 0;
      const memPenalty = catFreq[s.category] || 0;
      if (catPenalty > 0) w *= Math.max(0.22, 1 - divBoost * catPenalty);
      if (memPenalty > 1) w *= Math.max(0.35, 1 - memPenalty * 0.14);
      if (clearCount < clearTarget && s.gapFills > 0) w *= 1.6;
      return { entry: s, w: Math.max(0.01, w) };
    });

    let remaining = scored.filter((s) => !usedIds[s.shape.id]);
    while (blocks.length < 3 && remaining.length > 0) {
      const selectable = remaining.filter((s) => {
        const used = usedCategories[s.category] || 0;
        const payoff = s.gapFills > 0 || s.multiClear >= 1 || s.pcPotential === 2;
        return used < 2 || payoff || fill >= CRITICAL_FILL;
      });
      const entry = pickWeighted(augmentPool(selectable.length ? selectable : remaining)).entry;
      usedIds[entry.shape.id] = true;
      usedCategories[entry.category] = (usedCategories[entry.category] || 0) + 1;
      blocks.push(entry.shape);
      chosenMeta.push({ shape: entry.shape, placements: entry.placements, reason: 'weighted' });
      if (entry.gapFills > 0) clearCount++;
      remaining = scored.filter((s) => !usedIds[s.shape.id]);
    }

    while (blocks.length < 3) {
      const p = pickShapeByCategoryWeights(weights);
      if (!p || usedIds[p.id]) break;
      usedIds[p.id] = true;
      blocks.push(p);
      chosenMeta.push({ shape: p, placements: countLegalPlacements(grid, p.data), reason: 'fallback' });
    }

    const triplet = blocks.slice(0, 3);
    if (triplet.length < 3) continue;
    const minPc = Math.min(...triplet.map((s) => countLegalPlacements(grid, s.data)));
    if (minPc < mobTarget) continue;
    const strict = fill >= CRITICAL_FILL && attempt < Math.floor(MAX_SPAWN_ATTEMPTS * 0.7);
    if (fill >= FILL_SURVIVABILITY_ON && !tripletSequentiallySolvable(grid, triplet.map((s) => s.data), {
      searchBudget: strict ? SURVIVE_SEARCH_BUDGET * 2 : SURVIVE_SEARCH_BUDGET,
      exhaustAsPass: !strict,
    })) {
      continue;
    }

    for (let i = triplet.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [triplet[i], triplet[j]] = [triplet[j], triplet[i]];
    }

    const chosenCats = triplet.map((s) => getShapeCategory(s.id));
    _categoryMemory.categories.push(chosenCats);
    if (_categoryMemory.categories.length > 3) _categoryMemory.categories.shift();
    _categoryMemory.totalRounds++;
    diagnostics.attempt = attempt;
    diagnostics.chosen = chosenMeta.slice(0, 3).map((m) => ({
      id: m.shape.id,
      category: getShapeCategory(m.shape.id),
      reason: m.reason,
    }));
    _lastDiagnostics = diagnostics;
    return triplet;
  }

  const fallback = scored.slice(0, 3).map((s) => s.shape);
  _lastDiagnostics = { ...diagnostics, attempt: MAX_SPAWN_ATTEMPTS, chosen: fallback.map((s) => ({ id: s.id, reason: 'fallback' })) };
  return fallback;
}

module.exports = {
  generateDockShapes,
  getLastSpawnDiagnostics,
  resetSpawnMemory,
  validateSpawnTriplet,
};
