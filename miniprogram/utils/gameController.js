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
const { vibrateShort } = require('../adapters/platform');

class GameController {
  constructor(strategyId = 'normal', opts = {}) {
    this.strategyId = strategyId;
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

    const result = this.grid.checkLines();
    let gain = 0;
    let clears = 0;
    if (result.count > 0) {
      clears = result.count;
      this.totalClears += clears;
      const s = this.scoring;
      if (clears === 1) gain = s.singleLine;
      else if (clears === 2) gain = s.multiLine;
      else gain = s.combo + (clears - 2) * s.multiLine;
      this.score += gain;
      vibrateShort();
      this.onLineClear({ clears, gain, cleared: result.cleared });
    }

    if (this.dock.every((d) => d.placed)) {
      this._spawnDock();
    }

    const remaining = this.dock.filter((d) => !d.placed);
    if (remaining.length > 0 && !this.grid.hasAnyMove(this.dock)) {
      this.gameOver = true;
      this.onGameOver({ score: this.score, steps: this.steps, clears: this.totalClears });
    }

    this.onStateChange(this._snapshot());
    return { gain, clears, cleared: result.cleared || [] };
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
