/**
 * Open Block 微信小程序 — 游戏控制器。
 *
 * 纯逻辑层：串联 core/grid、core/shapes、core/gameRules 与渲染器，
 * 管理游戏状态（得分、步数、dock 块、拖拽）。
 *
 * 不直接操作 DOM / WXML，通过回调通知 Page 更新视图。
 */

const { Grid } = require('../core/grid');
const { getAllShapes, getShapeCategory } = require('../core/shapes');
const { getStrategy } = require('../core/config');
const {
  computeClearScore,
  detectBonusLines,
  monoNearFullLineColorWeights,
  pickThreeDockColors,
} = require('../core/bonusScoring');
const { vibrateShort } = require('../adapters/platform');
const {
  generateDockShapes,
  resetSpawnMemory,
  validateSpawnTriplet,
} = require('./spawnHeuristic');

class GameController {
  constructor(strategyId = 'normal', opts = {}) {
    this.strategyId = strategyId;
    this.skin = opts.skin || null;
    this.onStateChange = opts.onStateChange || (() => {});
    this.onLineClear = opts.onLineClear || (() => {});
    this.onGameOver = opts.onGameOver || (() => {});
    this.reset();
  }

  reset() {
    const cfg = getStrategy(this.strategyId);
    this.config = cfg;
    this.scoring = cfg.scoring;
    this.gridSize = cfg.gridWidth || 8;
    this.score = 0;
    this.totalClears = 0;
    this.steps = 0;
    this.dock = [];
    this.gameOver = false;
    this._roundClearCount = 0;
    this._spawnContext = {
      lastClearCount: 0,
      roundsSinceClear: 0,
      recentCategories: [],
      totalRounds: 0,
      scoreMilestone: false,
    };
    resetSpawnMemory();
    this._initPlayableBoard();
    this.onStateChange(this._snapshot());
  }

  _initPlayableBoard() {
    const cfg = this.config;
    const baseFill = Number(cfg.fillRatio) || 0;
    const maxAttempts = 18;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const fillRelax = Math.floor(attempt / 6) * 0.06;
      const fillRatio = Math.max(0, baseFill - fillRelax);
      this.grid = new Grid(this.gridSize);
      this.grid.initBoard(fillRatio, cfg.shapeWeights);
      this._spawnDock({ ensureMove: true });
      if (this.grid.hasAnyMove(this.dock)) return;
    }

    this.grid = new Grid(this.gridSize);
    this.grid.initBoard(0, cfg.shapeWeights);
    this._spawnDock({ ensureMove: true });
  }

  _spawnDock({ ensureMove = false } = {}) {
    const cfg = this.config;
    const allShapes = getAllShapes();
    const spawnConfig = {
      ...cfg,
      spawnHints: this._deriveSpawnHints(),
    };
    let shapes = generateDockShapes(this.grid, spawnConfig, this._spawnContext);
    const valid = validateSpawnTriplet(this.grid, shapes, { searchBudget: 9000 });
    if (!valid.ok || (ensureMove && !shapes.some((s) => this.grid.canPlaceAnywhere(s.data)))) {
      const fallback = allShapes.filter((s) => this.grid.canPlaceAnywhere(s.data)).slice(0, 3);
      shapes = fallback.length >= 3 ? fallback : allShapes.slice(0, 3);
    }

    const colorBias = monoNearFullLineColorWeights(this.grid, this.skin);
    const colors = pickThreeDockColors(colorBias);
    this.dock = shapes.map((s, i) => ({
      id: s.id,
      shape: s.data,
      colorIdx: colors[i % colors.length],
      placed: false,
    }));
  }

  _deriveSpawnHints() {
    const fill = this.grid?.getFillRatio?.() || 0;
    const ctx = this._spawnContext || {};
    let clearGuarantee = 1;
    let sizePreference = 0;
    let diversityBoost = 0.16;
    let multiClearBonus = 0.22;
    let multiLineTarget = 0;
    let rhythmPhase = 'neutral';

    if ((ctx.totalRounds || 0) <= 2) {
      clearGuarantee = 2;
      sizePreference = Math.min(sizePreference, -0.2);
      diversityBoost = Math.max(diversityBoost, 0.24);
    }
    if ((ctx.roundsSinceClear || 0) >= 2 || fill > 0.52) {
      clearGuarantee = Math.max(clearGuarantee, 2);
      sizePreference = Math.min(sizePreference, -0.25);
      multiClearBonus = Math.max(multiClearBonus, 0.45);
    }
    if ((ctx.roundsSinceClear || 0) >= 4 || fill > 0.64) {
      clearGuarantee = 3;
      sizePreference = Math.min(sizePreference, -0.35);
      multiLineTarget = Math.max(multiLineTarget, 1);
      rhythmPhase = 'payoff';
    }
    if ((ctx.lastClearCount || 0) >= 2) {
      multiClearBonus = Math.max(multiClearBonus, 0.5);
      multiLineTarget = Math.max(multiLineTarget, 1);
      rhythmPhase = 'payoff';
    }

    return {
      clearGuarantee,
      sizePreference,
      diversityBoost,
      multiClearBonus,
      multiLineTarget,
      rhythmPhase,
    };
  }

  _advanceSpawnContext() {
    const clearCount = this._roundClearCount || 0;
    const cats = this.dock.map((d) => getShapeCategory(d.id));
    const recent = [...(this._spawnContext.recentCategories || []), ...cats].slice(-9);
    this._spawnContext = {
      ...this._spawnContext,
      lastClearCount: clearCount,
      roundsSinceClear: clearCount > 0 ? 0 : (this._spawnContext.roundsSinceClear || 0) + 1,
      recentCategories: recent,
      totalRounds: (this._spawnContext.totalRounds || 0) + 1,
      scoreMilestone: this.score > 0 && this.score % 100 === 0,
    };
    this._roundClearCount = 0;
  }

  getLegalActions() {
    const actions = [];
    for (let bi = 0; bi < this.dock.length; bi++) {
      const b = this.dock[bi];
      if (b.placed) continue;
      for (let gy = 0; gy < this.gridSize; gy++) {
        for (let gx = 0; gx < this.gridSize; gx++) {
          if (this.grid.canPlace(b.shape, gx, gy)) {
            actions.push({ blockIdx: bi, gx, gy });
          }
        }
      }
    }
    return actions;
  }

  canPlace(blockIdx, gx, gy) {
    const b = this.dock[blockIdx];
    return b && !b.placed && this.grid.canPlace(b.shape, gx, gy);
  }

  /** 放置方块，返回 { gain, clears, cleared } 或 null */
  place(blockIdx, gx, gy) {
    if (this.gameOver) return null;
    const b = this.dock[blockIdx];
    if (!b || b.placed || !this.grid.canPlace(b.shape, gx, gy)) return null;

    this.grid.place(b.shape, b.colorIdx, gx, gy);
    this.steps++;
    b.placed = true;

    const bonusLinesSnap = detectBonusLines(this.grid, this.skin);
    const result = this.grid.checkLines();
    result.bonusLines = result.count > 0 ? bonusLinesSnap : [];
    result.perfectClear = result.count > 0 && this.grid.getFillRatio() === 0;
    let gain = 0;
    let clears = 0;
    if (result.count > 0) {
      clears = result.count;
      this._roundClearCount += clears;
      this.totalClears += clears;
      const { clearScore } = computeClearScore(this.strategyId, result);
      gain = clearScore;
      this.score += gain;
      vibrateShort();
      this.onLineClear({
        clears,
        gain,
        score: this.score,
        cells: result.cells || [],
        rows: result.rows || [],
        cols: result.cols || [],
        bonusLines: result.bonusLines || [],
      });
    }

    if (this.dock.every((d) => d.placed)) {
      this._advanceSpawnContext();
      this._spawnDock();
    }

    const remaining = this.dock.filter((d) => !d.placed);
    if (!this.gameOver && remaining.length > 0 && !this.grid.hasAnyMove(this.dock)) {
      this.gameOver = true;
      this.onGameOver({
        score: this.score,
        steps: this.steps,
        clears: this.totalClears,
      });
    }

    this.onStateChange(this._snapshot());
    return { gain, clears, cleared: result.cells || [] };
  }

  _snapshot() {
    return {
      score: this.score,
      steps: this.steps,
      totalClears: this.totalClears,
      dock: this.dock,
      gameOver: this.gameOver,
    };
  }
}

module.exports = { GameController };
