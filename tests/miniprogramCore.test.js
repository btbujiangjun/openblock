import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* v1.60.47：web↔小程序 出块特殊块契约 parity —— 直接引 web ESM 源做对照基准。 */
import {
  _tryInjectSpecial as webInject,
  _reliefGapShapeIds as webGap,
  _pressureHoleForcing as webForce,
  RELIEF_FILL_FLOOR_MILD as WEB_RELIEF_FILL_FLOOR_MILD,
  RELIEF_HOLE_FILL_MIN as WEB_RELIEF_HOLE_FILL_MIN,
} from '../web/src/bot/blockSpawn.js';
import { Grid as WebGrid } from '../web/src/grid.js';
import { getAllShapes as webGetAllShapes } from '../web/src/shapes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const cjsCache = new Map();

function resolveCjs(request, basedir = __dirname) {
  if (!request.startsWith('.')) return request;
  const base = path.resolve(basedir, request);
  /* v1.60.45：候选顺序前置 .js / .json，避免与同名目录冲突
   * （例：require('./config') 与 ./config/ 目录共存时，旧版会先选目录导致 EISDIR）。 */
  const candidates = [`${base}.js`, `${base}.json`, base, path.join(base, 'index.js')];
  const match = candidates.find((p) => {
      try { return fs.existsSync(p) && fs.statSync(p).isFile(); }
      catch { return false; }
  });
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
  _tryInjectSpecial: mpInject,
  _reliefGapShapeIds: mpGap,
  _pressureHoleForcing: mpForce,
  RELIEF_FILL_FLOOR_MILD: MP_RELIEF_FILL_FLOOR_MILD,
  RELIEF_HOLE_FILL_MIN: MP_RELIEF_HOLE_FILL_MIN,
} = requireCjs('../miniprogram/core/bot/blockSpawn.js');
const { getAllShapes: mpGetAllShapes } = requireCjs('../miniprogram/core/shapes.js');

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

  it('mirrors Web spawnContext counters for special and duplicate gates', () => {
    const game = new GameController('normal');
    expect(game._spawnContext.totalRounds).toBeGreaterThanOrEqual(1);
    expect(game._spawnContext).toMatchObject({
      specialShapeUsed: expect.any(Number),
      specialReliefUsed: expect.any(Number),
      specialPressureUsed: expect.any(Number),
      totalClears: expect.any(Number),
      roundsSinceSpecial: expect.any(Number),
      dupInjectUsed: expect.any(Number),
      roundsSinceDupInject: expect.any(Number),
    });

    const beforeRounds = game._spawnContext.totalRounds;
    const beforeDupGap = game._spawnContext.roundsSinceDupInject;
    game._spawnDock();
    expect(game._spawnContext.totalRounds).toBe(beforeRounds + 1);
    expect(game._spawnContext.roundsSinceDupInject).toBeGreaterThanOrEqual(beforeDupGap);
    expect(game._spawnContext.scoreMilestone).toBe(false);
  });

  it('does not use modulo score milestones in the miniprogram controller', () => {
    const game = new GameController('normal', { bestScore: 1000 });
    game.score = 100;
    game._roundClearCount = 0;
    game._advanceSpawnContext();
    expect(game._spawnContext.scoreMilestone).toBe(false);
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

  /**
   * v1.60.46：spawn fallback 不应一次性给出 3 个 special 块。
   *
   * 用户截图复盘：iOS 小程序 dock 出现 1×2 + 2×1 + 1×3 三连 special——
   * 与 §10.7 "12 个特殊小块仅由 _tryInjectSpecial 事件注入" 契约相违。
   * 根因：旧版 _spawnDock fallback 使用 getAllShapes() 包含全部 40 个形状
   * （含 12 special）。修正为 getRegularShapes() + isSpecialShapeId 双校验。
   */
  it('v1.60.46 — _spawnDock 不批量倾倒 special；唯一允许的 special 是 monoFlush 彩蛋（1×2/2×1）', () => {
    const { isSpecialShapeId } = requireCjs('../miniprogram/core/shapes.js');
    /* 50 次随机初始化 → 校验 dock 不出现「3 special 倾倒」契约违例（用户截图复盘根因）。
     *
     * §10.7 例外：monoFlush「同花顺彩蛋」会让 1×2/2×1 绕过 _passesShapeGate 经
     * monoFlush 路径进入 dock（见 blockSpawn.test.js monoFlush 用例）。_initPlayableBoard
     * 以 normal fillRatio(~0.2) 预填盘面，可能出现同色近满线 → 彩蛋合法触发。因此断言为：
     *   ① 每个 dock special 数 ≤1（杜绝原 bug 的「3 连 special」）；
     *   ② 任何出现的 special 必须是 monoFlush 彩蛋形状（1×2/2×1），其余 10 个 special
     *      （1×3 / 3×1 / l3 / diag 系列）仍绝不可经采样/fallback 进入。
     *
     * v2.2 锁定 Math.random 为可重放 LCG，确定性覆盖 150 个独立抽样位置。 */
    const MONO_EGG_IDS = new Set(['1x2', '2x1']);
    const originalRandom = Math.random;
    let lcg = 1234567;
    Math.random = () => {
      lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
      return lcg / 0x100000000;
    };
    try {
      for (let trial = 0; trial < 50; trial++) {
        const game = new GameController('normal');
        expect(game.dock).toHaveLength(3);
        const specials = game.dock.filter((slot) => isSpecialShapeId(slot.id)).map((slot) => slot.id);
        expect(specials.length, `trial ${trial} 出现批量 special: ${specials.join(',')}`).toBeLessThanOrEqual(1);
        for (const id of specials) {
          expect(MONO_EGG_IDS.has(id), `trial ${trial} 出现非彩蛋 special: ${id}`).toBe(true);
        }
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  /**
   * v1.60.46：progression（XP / 等级 / 称号）镜像 web。
   * 验证 loadProgress → getLevelProgress → titleForLevel 全链路可用。
   */
  it('v1.60.46 — progression 镜像：getLevelFromTotalXp / titleForLevel 公式与 web 一致', () => {
    const {
      getLevelFromTotalXp,
      getLevelProgress,
      titleForLevel,
    } = requireCjs('../miniprogram/core/progression.js');

    /* 公式 Lv = 1 + floor(sqrt(xp / 100)) */
    expect(getLevelFromTotalXp(0)).toBe(1);
    expect(getLevelFromTotalXp(99)).toBe(1);
    expect(getLevelFromTotalXp(100)).toBe(2);
    expect(getLevelFromTotalXp(400)).toBe(3);
    expect(getLevelFromTotalXp(900)).toBe(4);

    const p = getLevelProgress(150);
    expect(p.level).toBe(2);
    expect(p.levelStartXp).toBe(100);
    expect(p.nextLevelXp).toBe(400);
    expect(p.frac).toBeCloseTo((150 - 100) / 300, 3);

    /* 称号 6 档（与 web titleForLevel 完全一致） */
    expect(titleForLevel(1)).toBe('新手');
    expect(titleForLevel(5)).toBe('学徒');
    expect(titleForLevel(10)).toBe('熟练');
    expect(titleForLevel(20)).toBe('高手');
    expect(titleForLevel(35)).toBe('大师');
    expect(titleForLevel(50)).toBe('传奇');
    expect(titleForLevel(99)).toBe('传奇');
  });

  /**
   * v1.60.46：playerProfile 爽感闭环已镜像（v1.60.45 §5 web → miniprogram）。
   * gameController 在 _spawnDock 后 tickRoundForDelight；在 multi/pcClear 等触发时 recordDelight。
   */
  it('v1.60.46 — gameController tickRoundForDelight 自动累加；isDelightStarved 阈值 5 / 7', () => {
    const game = new GameController('normal');
    const profile = game._profile;
    /* GameController 构造 → reset → _initPlayableBoard → _spawnDock 会触发首次 tickRoundForDelight，
     * 故 _roundsSinceLastDelight 已 ≥ 1。下方测试用显式 reset 验证累加 + 饥渴阈值。 */
    expect(profile._roundsSinceLastDelight).toBeGreaterThanOrEqual(1);

    const { _setPlatformForTest } = requireCjs('../miniprogram/core/config/platformProfile.js');
    _setPlatformForTest('android');
    try {
      profile._roundsSinceLastDelight = 0;
      for (let i = 0; i < 4; i++) profile.tickRoundForDelight();
      expect(profile.isDelightStarved()).toBe(false);
      profile.tickRoundForDelight();
      expect(profile.isDelightStarved()).toBe(true);

      profile.recordDelight('multiClear');
      expect(profile._roundsSinceLastDelight).toBe(0);
      expect(profile.isDelightStarved()).toBe(false);
    } finally {
      _setPlatformForTest(null);
    }
  });
});

/**
 * v1.60.47：web↔小程序 特殊块契约 parity（P1 fill 地板 / P2 缺口匹配 / 契约A holeFill /
 * 契约B 加压造洞）。两端跑同一组场景，断言行为一致——防止 CJS 镜像与 web 源再次漂移。
 */
describe('web↔miniprogram 特殊块契约 parity', () => {
  /** 用指定 Grid 类构造"满盘仅留 2x2 空腔（左上角）"的盘面 */
  function cavityGrid(GridClass) {
    const g = new GridClass(8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 0;
    g.cells[0][0] = null; g.cells[0][1] = null; g.cells[1][0] = null; g.cells[1][1] = null;
    return g;
  }

  /** 用指定 Grid 类构造"行连续3空 + 列连续2空"互不交叉缺口盘面 */
  function gapGrid(GridClass) {
    const g = new GridClass(10);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) g.cells[y][x] = 0;
    g.cells[0][0] = null; g.cells[0][1] = null; g.cells[0][2] = null;
    g.cells[8][5] = null; g.cells[9][5] = null;
    return g;
  }

  it('常量同口径：RELIEF_FILL_FLOOR_MILD / RELIEF_HOLE_FILL_MIN 两端相等', () => {
    expect(MP_RELIEF_FILL_FLOOR_MILD).toBe(WEB_RELIEF_FILL_FLOOR_MILD);
    expect(MP_RELIEF_HOLE_FILL_MIN).toBe(WEB_RELIEF_HOLE_FILL_MIN);
  });

  it('P2 _reliefGapShapeIds：两端对同一盘面返回相同朝向偏好序列', () => {
    const web = webGap(gapGrid(WebGrid));
    const mp = mpGap(gapGrid(Grid));
    expect(mp).toEqual(web);
    expect(web).toEqual(['2x1', '1x3']);
  });

  it('契约B _pressureHoleForcing：两端对 2x2 空腔/空盘给出相同造洞下限', () => {
    const diagWeb = webGetAllShapes().find(s => s.id === 'diag-2a');
    const diagMp = mpGetAllShapes().find(s => s.id === 'diag-2a');
    expect(mpForce(cavityGrid(Grid), diagMp.data)).toBe(webForce(cavityGrid(WebGrid), diagWeb.data));
    expect(webForce(cavityGrid(WebGrid), diagWeb.data)).toBe(1);
    expect(mpForce(new Grid(8), diagMp.data)).toBe(webForce(new WebGrid(8), diagWeb.data));
    expect(webForce(new WebGrid(8), diagWeb.data)).toBe(0);
  });

  it('P1 fill 地板：reliefUrgent=false + fill=0.30 两端均不注入', () => {
    const mk = (GridClass, getAllShapes) => {
      const triplet = getAllShapes().slice(0, 3);
      const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null, multiClear: 0 }));
      const hints = { spawnIntent: 'relief', reliefUrgent: false };
      const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5, totalRounds: 11 };
      const scored = [
        { shape: triplet[0], gapFills: 0, multiClear: 0, exactFit: 1.0 },
        { shape: triplet[1], gapFills: 0, multiClear: 0, exactFit: 0 },
        { shape: triplet[2], gapFills: 0, multiClear: 0, exactFit: 0 },
      ];
      const topo = { nearFullLines: 0, holes: 0, enclosedVoidCells: 0 };
      return { triplet, chosenMeta, hints, ctx, scored, topo };
    };
    const w = mk(WebGrid, webGetAllShapes);
    const m = mk(Grid, mpGetAllShapes);
    const webRes = webInject(w.triplet, w.chosenMeta, w.hints, w.ctx, new WebGrid(8), 0.30, w.topo, 0, w.scored);
    const mpRes = mpInject(m.triplet, m.chosenMeta, m.hints, m.ctx, new Grid(8), 0.30, m.topo, 0, m.scored);
    expect(webRes).toBeNull();
    expect(mpRes).toBeNull();
  });

  it('契约A holeFill：holes≥2 无清行机会，两端均以 reliefTrigger=holeFill 注入', () => {
    const mk = (getAllShapes) => {
      const triplet = getAllShapes().slice(0, 3);
      const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null, multiClear: 0 }));
      const hints = { spawnIntent: 'relief' };
      const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5, totalRounds: 11 };
      const scored = triplet.map(s => ({ shape: s, gapFills: 0, multiClear: 0, exactFit: 0 }));
      const topo = { nearFullLines: 0, holes: 2, enclosedVoidCells: 2 };
      return { triplet, chosenMeta, hints, ctx, scored, topo };
    };
    const w = mk(webGetAllShapes);
    const m = mk(mpGetAllShapes);
    const webRes = webInject(w.triplet, w.chosenMeta, w.hints, w.ctx, new WebGrid(8), 0.55, w.topo, 0, w.scored);
    const mpRes = mpInject(m.triplet, m.chosenMeta, m.hints, m.ctx, new Grid(8), 0.55, m.topo, 0, m.scored);
    expect(webRes?.reliefTrigger).toBe('holeFill');
    expect(mpRes?.reliefTrigger).toBe('holeFill');
  });
});
