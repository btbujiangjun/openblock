/**
 * 与 web/src/game.js 中消行加分逻辑对齐：整行/列同色 bonus 倍率与 clearScore。
 * 不依赖 DOM；供 GameController 与后续特效时长使用。
 */
const { getStrategy } = require('./config');

const ICON_BONUS_LINE_MULT = 5;

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
function computeClearScore(strategyId, result) {
  const scoring = getStrategy(strategyId).scoring;
  const c = result?.count ?? 0;
  let baseScore = 0;
  if (c === 1) baseScore = scoring.singleLine * c;
  else if (c === 2) baseScore = scoring.multiLine;
  else if (c >= 3) baseScore = scoring.combo + (c - 2) * scoring.multiLine;

  const bonusLines = result?.bonusLines || [];
  const bonusCount = bonusLines.length;
  if (c <= 0 || bonusCount <= 0) {
    return { baseScore, iconBonusScore: 0, clearScore: baseScore };
  }
  const perLine = Math.round(baseScore / c);
  const iconBonusScore = perLine * bonusCount * (ICON_BONUS_LINE_MULT - 1);
  return { baseScore, iconBonusScore, clearScore: baseScore + iconBonusScore };
}

module.exports = {
  ICON_BONUS_LINE_MULT,
  bonusEffectHoldMs,
  detectBonusLines,
  computeClearScore,
};
