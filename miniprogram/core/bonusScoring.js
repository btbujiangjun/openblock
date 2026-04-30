/**
 * 与 web/src/game.js 中消行加分逻辑对齐：整行/列同色 bonus 倍率与 clearScore。
 * 不依赖 DOM；供 GameController 与后续特效时长使用。
 */
const { getStrategy } = require('./config');

const ICON_BONUS_LINE_MULT = 5;

/** 与 web/src/clearScoring.js `MONO_NEAR_FULL_COLOR_WEIGHT` 对齐 */
const MONO_NEAR_FULL_COLOR_WEIGHT = 0.55;

function dockSlot(ci) {
  return ((ci % 8) + 8) % 8;
}

function bonusEffectHoldMs(bonusCount) {
  if (bonusCount <= 0) return 0;
  return Math.min(5000, Math.max(3000, 3000 + bonusCount * 400));
}

/**
 * 在 checkLines 前基于皮肤 icon 规则检测 bonus 行/列。
 * @param {{ size:number, cells:number[][] }} grid
 * @param {{ blockIcons?: string[] }|null} skin
 * @returns {Array<{type:'row'|'col', idx:number, colorIdx:number, icon:string|null}>}
 */
function detectBonusLines(grid, skin) {
  const n = grid.size;
  const blockIcons = skin?.blockIcons;
  const getIcon = (ci) => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);
  const result = [];

  for (let y = 0; y < n; y++) {
    const row = grid.cells[y];
    if (row.some((c) => c === null)) continue;
    const icon0 = getIcon(row[0]);
    const allSame = icon0 !== null
      ? row.every((c) => getIcon(c) === icon0)
      : row.every((c) => c === row[0]);
    if (allSame) result.push({ type: 'row', idx: y, colorIdx: row[0], icon: icon0 });
  }

  for (let x = 0; x < n; x++) {
    const col = [];
    for (let y = 0; y < n; y++) {
      if (grid.cells[y][x] === null) {
        col.length = 0;
        break;
      }
      col.push(grid.cells[y][x]);
    }
    if (!col.length) continue;
    const icon0 = getIcon(col[0]);
    const allSame = icon0 !== null
      ? col.every((c) => getIcon(c) === icon0)
      : col.every((c) => c === col[0]);
    if (allSame) result.push({ type: 'col', idx: x, colorIdx: col[0], icon: icon0 });
  }
  return result;
}

/**
 * @param {string} strategyId
 * @param {{ count: number, bonusLines?: Array<unknown> }} result
 * @returns {{ baseScore: number, iconBonusScore: number, clearScore: number }}
 */
function computeClearScore(strategyId, result, scoringOverride) {
  const scoring = scoringOverride && typeof scoringOverride === 'object'
    ? scoringOverride
    : getStrategy(strategyId).scoring;
  const c = result?.count ?? 0;
  const baseUnit = scoring.singleLine ?? 20;
  const baseScore = c > 0 ? baseUnit * c * c : 0;

  const bonusLines = result?.bonusLines || [];
  const bonusCount = bonusLines.length;
  if (c <= 0 || bonusCount <= 0) {
    return { baseScore, iconBonusScore: 0, clearScore: baseScore };
  }
  // 每条消除线价值随总消除数增长：lineScore = baseUnit * c。
  // bonus 只放大相同 icon/同色的线，公式本身保证整十，且全 bonus 等价于 baseScore × MULT。
  const effectiveBonusCount = Math.min(bonusCount, c);
  const lineScore = baseUnit * c;
  const iconBonusScore = lineScore * effectiveBonusCount * (ICON_BONUS_LINE_MULT - 1);
  return { baseScore, iconBonusScore, clearScore: baseScore + iconBonusScore };
}

/**
 * 近满行/列同 icon 或同色的 dock 色偏置（与 web 主局 spawn 一致）
 * @param {{ size:number, cells:number[][] }} grid
 * @param {{ blockIcons?: string[] }|null} [skin]
 * @returns {number[]}
 */
function monoNearFullLineColorWeights(grid, skin = null) {
  const w = new Array(8).fill(0);
  if (!grid?.cells) return w;
  const n = grid.size;
  const blockIcons = skin?.blockIcons;
  const getIcon = (ci) => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);

  function addNearFull(filledVals) {
    if (filledVals.length === 0) return;
    const icon0 = getIcon(filledVals[0]);
    const monoIcon = icon0 !== null && filledVals.every((c) => getIcon(c) === icon0);
    const monoColor = icon0 === null && filledVals.every((c) => c === filledVals[0]);
    if (!monoIcon && !monoColor) return;
    if (monoIcon) {
      const distinctDock = [...new Set(filledVals.map(dockSlot))];
      const share = MONO_NEAR_FULL_COLOR_WEIGHT / distinctDock.length;
      for (const s of distinctDock) w[s] += share;
    } else {
      w[dockSlot(filledVals[0])] += MONO_NEAR_FULL_COLOR_WEIGHT;
    }
  }

  for (let y = 0; y < n; y++) {
    const filled = [];
    for (let x = 0; x < n; x++) {
      const c = grid.cells[y][x];
      if (c !== null) filled.push(c);
    }
    const empty = n - filled.length;
    if (empty >= 1 && empty <= 2) addNearFull(filled);
  }
  for (let x = 0; x < n; x++) {
    const filled = [];
    for (let y = 0; y < n; y++) {
      const c = grid.cells[y][x];
      if (c !== null) filled.push(c);
    }
    const empty = n - filled.length;
    if (empty >= 1 && empty <= 2) addNearFull(filled);
  }
  return w;
}

/**
 * 8 色无放回加权抽三色
 * @param {number[]} biasWeights
 * @param {() => number} [rnd]
 * @returns {[number, number, number]}
 */
function pickThreeDockColors(biasWeights, rnd = Math.random) {
  const bias = biasWeights || [];
  const pool = [0, 1, 2, 3, 4, 5, 6, 7];
  const out = [];
  for (let k = 0; k < 3; k++) {
    let total = 0;
    for (const c of pool) total += 1 + (bias[c] || 0);
    let r = rnd() * total;
    let chosen = pool[0];
    for (const c of pool) {
      r -= 1 + (bias[c] || 0);
      if (r <= 0) {
        chosen = c;
        break;
      }
    }
    out.push(chosen);
    pool.splice(pool.indexOf(chosen), 1);
  }
  return out;
}

module.exports = {
  ICON_BONUS_LINE_MULT,
  MONO_NEAR_FULL_COLOR_WEIGHT,
  bonusEffectHoldMs,
  detectBonusLines,
  computeClearScore,
  monoNearFullLineColorWeights,
  pickThreeDockColors,
};
