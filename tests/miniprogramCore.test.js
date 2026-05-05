import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsCache = new Map();

function resolveCjs(request, basedir = __dirname) {
  if (!request.startsWith('.')) return request;
  const base = path.resolve(basedir, request);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  const match = candidates.find((p) => fs.existsSync(p));
  if (!match) throw new Error(`Cannot resolve ${request} from ${basedir}`);
  return match;
}

function requireCjs(request, basedir = __dirname) {
  const filename = resolveCjs(request, basedir);
  if (!path.isAbsolute(filename)) return require(filename);
  if (cjsCache.has(filename)) return cjsCache.get(filename).exports;
  if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));

  const module = { exports: {} };
  cjsCache.set(filename, module);
  const dirname = path.dirname(filename);
  const localRequire = (next) => requireCjs(next, dirname);
  const source = fs.readFileSync(filename, 'utf8');
  const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`;
  vm.runInThisContext(wrapped, { filename })(module.exports, localRequire, module, filename, dirname);
  return module.exports;
}

const { Grid } = requireCjs('../miniprogram/core/grid.js');
const {
  ICON_BONUS_LINE_MULT,
  PERFECT_CLEAR_MULT,
  computeClearScore,
  detectBonusLines,
  monoNearFullLineColorWeights,
  pickThreeDockColors,
} = requireCjs('../miniprogram/core/bonusScoring.js');
const { GAME_RULES } = requireCjs('../miniprogram/core/gameRules.js');
const { GameController } = requireCjs('../miniprogram/utils/gameController.js');
const { SKIN_LIST } = requireCjs('../miniprogram/core/skins.js');
const { skinName } = requireCjs('../miniprogram/core/i18n.js');
const {
  generateDockShapes,
  resetSpawnMemory,
  validateSpawnTriplet,
} = requireCjs('../miniprogram/utils/spawnHeuristic.js');

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function luma(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0.5;
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

function fillRow(grid, row, values) {
  for (let x = 0; x < grid.size; x++) grid.cells[row][x] = values[x];
}

describe('miniprogram core parity', () => {
  it('uses gameplay scoring multipliers from miniprogram rules', () => {
    expect(ICON_BONUS_LINE_MULT).toBe(GAME_RULES.clearScoring.iconBonusLineMult);
    expect(PERFECT_CLEAR_MULT).toBe(GAME_RULES.clearScoring.perfectClearMult);
  });

  it('scores line clears with the same square base, icon bonus, and perfect multiplier formula', () => {
    expect(computeClearScore('normal', { count: 1, bonusLines: [] })).toEqual({
      baseScore: 20,
      iconBonusScore: 0,
      clearScore: 20,
    });
    expect(computeClearScore('normal', { count: 2, bonusLines: [{ type: 'row', idx: 0 }] })).toEqual({
      baseScore: 80,
      iconBonusScore: 160,
      clearScore: 240,
    });
    expect(computeClearScore('normal', {
      count: 2,
      bonusLines: [{ type: 'row', idx: 0 }],
      perfectClear: true,
    })).toEqual({
      baseScore: 80,
      iconBonusScore: 160,
      clearScore: 2400,
    });
  });

  it('detects same icon bonus lines before clearing', () => {
    const grid = new Grid(8);
    fillRow(grid, 3, [0, 4, 8, 12, 0, 4, 8, 12]);
    const bonus = detectBonusLines(grid, { blockIcons: ['A', 'B', 'C', 'D'] });
    expect(bonus).toHaveLength(1);
    expect(bonus[0]).toMatchObject({ type: 'row', idx: 3, icon: 'A' });
  });

  it('biases dock colors toward near-full same icon or same color lanes', () => {
    const grid = new Grid(8);
    fillRow(grid, 5, [0, 4, 8, 12, 0, 4, null, null]);
    const weights = monoNearFullLineColorWeights(grid, { blockIcons: ['A', 'B', 'C', 'D'] });
    expect(weights[0]).toBeGreaterThan(0);
    expect(weights[4]).toBeGreaterThan(0);

    const colors = pickThreeDockColors([50, 0, 0, 0, 0, 0, 0, 0], () => 0);
    expect(colors).toContain(0);
    expect(new Set(colors).size).toBe(3);
  });

  it('starts with a playable dock', () => {
    for (const strategy of ['easy', 'normal', 'hard']) {
      const game = new GameController(strategy);
      expect(game.dock).toHaveLength(3);
      expect(game.grid.hasAnyMove(game.dock)).toBe(true);
    }
  });

  it('uses the miniprogram heuristic spawn guard instead of pure random dock picks', () => {
    resetSpawnMemory();
    const game = new GameController('normal');
    const shapes = generateDockShapes(game.grid, {
      ...game.config,
      spawnHints: {
        clearGuarantee: 1,
        diversityBoost: 0.24,
        multiClearBonus: 0.22,
      },
    });
    expect(shapes).toHaveLength(3);
    expect(new Set(shapes.map((s) => s.id)).size).toBe(3);
    expect(validateSpawnTriplet(game.grid, shapes).ok).toBe(true);
  });

  it('keeps all 34 miniprogram skins mobile optimized and readable', () => {
    expect(SKIN_LIST).toHaveLength(34);
    for (const skin of SKIN_LIST) {
      expect(skin.mobileOptimized).toBe(true);
      expect(skin.blockColors).toHaveLength(8);
      const gridLuma = luma(skin.gridCell);
      expect(luma(skin.gridOuter)).toBeLessThan(gridLuma);
      expect(gridLuma).toBeGreaterThanOrEqual(0.90);
      expect(gridLuma).toBeLessThanOrEqual(0.98);
      for (const color of skin.blockColors) {
        const lum = luma(color);
        expect(lum).toBeGreaterThanOrEqual(0.25);
        expect(lum).toBeLessThanOrEqual(0.70);
        expect(Math.abs(lum - gridLuma)).toBeGreaterThanOrEqual(0.26);
      }
    }
  });

  it('localizes all miniprogram skin names', () => {
    for (const skin of SKIN_LIST) {
      expect(skinName(skin.id, '', 'zh-CN')).not.toBe('');
      expect(skinName(skin.id, '', 'en')).not.toBe('');
    }
    expect(skinName('titanium', '', 'zh-CN')).toBe('💎 钛晶矩阵');
    expect(skinName('titanium', '', 'en')).toBe('💎 Titanium Matrix');
  });
});
