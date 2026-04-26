/**
 * Open Block 微信小程序 — 游戏控制器。
 *
 * 纯逻辑层：串联 core/grid、core/shapes、core/gameRules 与渲染器，
 * 管理游戏状态（得分、步数、dock 块、拖拽）。
 *
 * 不直接操作 DOM / WXML，通过回调通知 Page 更新视图。
 */

const { Grid } = require('../core/grid');
const { getAllShapes, pickShapeByCategoryWeights } = require('../core/shapes');
const { GAME_RULES } = require('../core/gameRules');
const { getStrategy } = require('../core/config');
const { computeClearScore, detectBonusLines } = require('../core/bonusScoring');
const { LevelManager } = require('../core/levelManager');
const { vibrateShort } = require('../adapters/platform');

class GameController {
  constructor(strategyId = 'normal', opts = {}) {
    this.strategyId = strategyId;
    this.levelConfig = opts.levelConfig || null;
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
    this.grid = new Grid(this.gridSize);
    this.grid.initBoard(cfg.fillRatio, cfg.shapeWeights);
    this.score = 0;
    this.totalClears = 0;
    this.steps = 0;
    this.dock = [];
    this.gameOver = false;
    this._levelManager = this.levelConfig ? new LevelManager(this.levelConfig) : null;
    this._levelMode = this._levelManager ? 'level' : 'endless';
    this.levelObjective = '';
    this.levelStars = 0;
    if (this._levelManager) {
      this._levelManager.applyInitialBoard(this.grid);
      this.levelObjective = this._levelManager.checkObjective(this).objective || '';
    }
    this._spawnDock();
    this.onStateChange(this._snapshot());
  }

  _spawnDock() {
    const cfg = this.config;
    const shapes = [];
    const allShapes = getAllShapes();
    for (let i = 0; i < 3; i++) {
      const s = pickShapeByCategoryWeights(cfg.shapeWeights) || allShapes[0];
      shapes.push(s);
    }
    const colors = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = colors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [colors[i], colors[j]] = [colors[j], colors[i]];
    }
    this.dock = shapes.map((s, i) => ({
      id: s.id,
      shape: s.data,
      colorIdx: colors[i % colors.length],
      placed: false,
    }));
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
    this._levelManager?.recordPlacement();

    const bonusLinesSnap = detectBonusLines(this.grid, this.skin);
    const result = this.grid.checkLines();
    result.bonusLines = result.count > 0 ? bonusLinesSnap : [];
    let gain = 0;
    let clears = 0;
    if (result.count > 0) {
      clears = result.count;
      this.totalClears += clears;
      const { clearScore } = computeClearScore(this.strategyId, result);
      gain = clearScore;
      this.score += gain;
      vibrateShort();
      this._levelManager?.recordClear(clears);
      this.onLineClear({
        clears,
        gain,
        score: this.score,
        cells: result.cells || [],
        bonusLines: result.bonusLines || [],
      });
    }

    if (this.dock.every((d) => d.placed)) {
      this._levelManager?.recordRound();
      this._spawnDock();
    }

    if (this._levelManager) {
      const objResult = this._levelManager.checkObjective(this);
      this.levelObjective = objResult.objective || '';
      if (objResult.done) {
        this.levelStars = objResult.stars || 0;
        this.gameOver = true;
        this.onGameOver({
          score: this.score,
          steps: this.steps,
          clears: this.totalClears,
          mode: objResult.mode || 'level',
          levelResult: this._levelManager.getResult(this),
        });
      }
    }

    const remaining = this.dock.filter((d) => !d.placed);
    if (!this.gameOver && remaining.length > 0 && !this.grid.hasAnyMove(this.dock)) {
      this.gameOver = true;
      this.onGameOver({
        score: this.score,
        steps: this.steps,
        clears: this.totalClears,
        mode: this._levelMode === 'level' ? 'level-fail' : 'endless',
        levelResult: this._levelManager ? this._levelManager.getResult(this) : null,
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
      levelMode: this._levelMode,
      levelObjective: this.levelObjective,
      levelStars: this.levelStars,
      levelId: this.levelConfig?.id || '',
    };
  }
}

module.exports = { GameController };
