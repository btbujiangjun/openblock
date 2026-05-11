import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
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
  if (!path.isAbsolute(filename)) return nodeRequire(filename);
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
} = requireCjs('../miniprogram/core/bot/blockSpawn.js');

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

  it('uses the synced web rule-track spawn guard instead of pure random dock picks', () => {
    resetSpawnMemory();
    const game = new GameController('normal');
    const strategy = game._resolveSpawnStrategy();
    expect(strategy.spawnHints).toBeDefined();
    expect(strategy.spawnHints.spawnTargets).toBeDefined();
    expect(typeof strategy.spawnHints.orderMaxValidPerms).toBe('number');

    const shapes = generateDockShapes(game.grid, strategy, game._spawnContext);
    expect(shapes).toHaveLength(3);
    expect(new Set(shapes.map((s) => s.id)).size).toBe(3);
    expect(validateSpawnTriplet(game.grid, shapes).ok).toBe(true);
  });

  it('uses the real synced PlayerProfile and persists it via localStorage between runs', () => {
    const { PlayerProfile } = requireCjs('../miniprogram/core/playerProfile.js');
    const store = new Map();
    const previous = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => store.clear(),
    };
    try {
      const game = new GameController('normal');
      expect(game._profile).toBeInstanceOf(PlayerProfile);
      expect(typeof game._profile.recordPlace).toBe('function');
      expect(typeof game._profile.skillLevel).toBe('number');

      const before = game._profile._totalLifetimePlacements;
      const action = game.getLegalActions()[0];
      expect(action).toBeDefined();
      game.place(action.blockIdx, action.gx, action.gy);
      expect(game._profile._totalLifetimePlacements).toBe(before + 1);

      game.abandonRun();
      expect(store.has('openblock_player_profile')).toBe(true);

      const next = new GameController('normal');
      expect(next._profile._totalLifetimeGames).toBeGreaterThan(0);
      expect(next._profile._sessionHistory.length).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previous;
    }
  });

  it('keeps all 34 miniprogram skins mobile optimized and readable', () => {
    expect(SKIN_LIST).toHaveLength(34);
    for (const skin of SKIN_LIST) {
      expect(skin.mobileOptimized).toBe(true);
      expect(skin.blockColors).toHaveLength(8);
      const gridLuma = luma(skin.gridCell);
      expect(luma(skin.gridOuter)).toBeLessThan(gridLuma);
      expect(skin.boardWatermark?.icons?.length).toBeGreaterThan(0);
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

  it('mirrors web feedbackToggles: persists visual + quality prefs and applies to a renderer-like target', () => {
    const store = new Map();
    const originalWx = globalThis.wx;
    globalThis.wx = {
      getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
      setStorageSync: (k, v) => { store.set(k, v); },
      removeStorageSync: (k) => { store.delete(k); },
      clearStorageSync: () => store.clear(),
    };
    try {
      const { createFeedbackToggles, QUALITY_MODES } = requireCjs('../miniprogram/utils/feedbackToggles.js');
      const calls = { effects: [], quality: [], cleared: 0 };
      const renderer = {
        setEffectsEnabled(v) { calls.effects.push(v); this._fx = !!v; },
        setQualityMode(m) { calls.quality.push(m); this._q = m; },
        clearFx() { calls.cleared += 1; },
      };
      const toggles = createFeedbackToggles({ renderer });
      expect(renderer._fx).toBe(true);
      expect(renderer._q).toBe('high');

      toggles.toggleVisual();
      expect(renderer._fx).toBe(false);
      expect(calls.cleared).toBeGreaterThan(0);
      expect(JSON.parse(store.get('openblock_visualfx_v1'))).toEqual({ enabled: false });

      const next = toggles.cycleQualityMode();
      expect(QUALITY_MODES.includes(next)).toBe(true);
      expect(renderer._q).toBe(next);
      expect(JSON.parse(store.get('openblock_quality_v1'))).toEqual({ mode: next });

      const reborn = createFeedbackToggles({ renderer: { setEffectsEnabled() {}, setQualityMode() {}, clearFx() {} } });
      expect(reborn.getState()).toEqual({ visualEnabled: false, qualityMode: next });
    } finally {
      if (originalWx === undefined) delete globalThis.wx;
      else globalThis.wx = originalWx;
    }
  });

  it('miniprogram renderer guards: disabling effects no-ops particle/shake/flash triggers and clears state', () => {
    const { GameRenderer } = requireCjs('../miniprogram/utils/renderer.js');
    /* 桩 canvas/ctx：renderer 仅依赖 width/height/ctx.scale + fillRect 等，本测试只验证守卫语义。 */
    const ctx = new Proxy({}, { get: () => () => {} });
    const canvas = { width: 240, height: 240, getContext: () => ctx };
    const r = new GameRenderer(canvas, 1);
    r._cellSizeForFx = 30;
    r._gridLogicalSize = 240;

    r.setEffectsEnabled(true);
    r.setQualityMode('high');
    r.addClearBurst([{ x: 0, y: 0, color: 0 }], 4, 30);
    r.setShake(10, 200);
    r.triggerComboFlash(4);
    expect(r.particles.length).toBeGreaterThan(0);
    expect(r.shakeDuration).toBe(200);
    expect(r._comboFlash).toBeGreaterThan(0);

    r.setEffectsEnabled(false);
    expect(r.particles.length).toBe(0);
    expect(r.shakeDuration).toBe(0);

    r.addClearBurst([{ x: 0, y: 0, color: 0 }], 4, 30);
    r.setShake(10, 200);
    r.triggerComboFlash(4);
    r.triggerPerfectFlash();
    r.triggerBigBlast(2);
    expect(r.particles.length).toBe(0);
    expect(r.shakeDuration).toBe(0);
    expect(r._comboFlash).toBe(0);
    expect(r._perfectFlash).toBe(0);
    expect(r._blastWave).toBe(0);

    r.setEffectsEnabled(true);
    r.setQualityMode('low');
    r.addClearBurst([{ x: 0, y: 0, color: 0 }], 8, 30);
    const lowCount = r.particles.length;
    r.clearParticles();
    r.setQualityMode('high');
    r.addClearBurst([{ x: 0, y: 0, color: 0 }], 8, 30);
    expect(r.particles.length).toBeGreaterThan(lowCount);
  });
});
