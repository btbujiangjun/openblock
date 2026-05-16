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
  resolveAdaptiveStrategy,
  resetAdaptiveMilestone,
} = require('../core/adaptiveSpawn');
const {
  computeCandidatePlacementMetric,
  generateDockShapes,
  getLastSpawnDiagnostics,
  resetSpawnMemory,
  validateSpawnTriplet,
} = require('../core/bot/blockSpawn');
const { PlayerProfile } = require('../core/playerProfile');

class GameController {
  constructor(strategyId = 'normal', opts = {}) {
    this.strategyId = strategyId;
    this.skin = opts.skin || null;
    this._bestScore = Math.max(0, Number(opts.bestScore) || 0);
    this._runStreak = Math.max(0, Number(opts.runStreak) || 0);
    this.onStateChange = opts.onStateChange || (() => {});
    this.onLineClear = opts.onLineClear || (() => {});
    this.onGameOver = opts.onGameOver || (() => {});

    this._profile = PlayerProfile.load();
    if (opts.historicalStats && typeof this._profile.ingestHistoricalStats === 'function') {
      try { this._profile.ingestHistoricalStats(opts.historicalStats); } catch (_) {}
    }

    this._maxCombo = 0;
    this._missCount = 0;

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
    this._maxCombo = 0;
    this._missCount = 0;
    if (this._profile && typeof this._profile.recordNewGame === 'function') {
      this._profile.recordNewGame();
    }
    this._spawnContext = {
      lastClearCount: 0,
      roundsSinceClear: 0,
      recentCategories: [],
      totalRounds: 0,
      scoreMilestone: false,
      bestScore: this._bestScore,
      bottleneckTrough: Infinity,
      bottleneckSolutionTrough: Infinity,
      bottleneckSamples: 0,
    };
    resetSpawnMemory();
    resetAdaptiveMilestone();
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
    const allShapes = getAllShapes();
    const layered = this._resolveSpawnStrategy();
    let shapes = generateDockShapes(this.grid, layered, this._spawnContext);
    const valid = validateSpawnTriplet(this.grid, shapes, { searchBudget: 14000 });
    if (!valid.ok || (ensureMove && !shapes.some((s) => this.grid.canPlaceAnywhere(s.data)))) {
      const fallback = allShapes.filter((s) => this.grid.canPlaceAnywhere(s.data)).slice(0, 3);
      shapes = fallback.length >= 3 ? fallback : allShapes.slice(0, 3);
    }

    const iconBonusTarget = Math.max(0, Math.min(1, layered.spawnHints?.iconBonusTarget ?? 0));
    const colorBias = monoNearFullLineColorWeights(this.grid, this.skin)
      .map((w) => w * (1 + iconBonusTarget * 2.5));
    const colors = pickThreeDockColors(colorBias);
    this.dock = shapes.map((s, i) => ({
      id: s.id,
      shape: s.data,
      colorIdx: colors[i % colors.length],
      placed: false,
    }));
    this._commitSpawnContext(layered);
    if (this._profile && typeof this._profile.recordSpawn === 'function') {
      this._profile.recordSpawn();
    }
  }

  _resolveSpawnStrategy() {
    const fill = this.grid?.getFillRatio?.() || 0;
    return resolveAdaptiveStrategy(
      this.strategyId,
      this._profile,
      this.score,
      this._runStreak,
      fill,
      {
        ...(this._spawnContext || {}),
        bestScore: this._bestScore,
        _gridRef: this.grid,
        _dockShapePool: (this.dock || [])
          .filter((b) => b && !b.placed && Array.isArray(b.shape))
          .map((b) => ({ data: b.shape })),
      },
    );
  }

  _commitSpawnContext(layered) {
    /* v1.55.17：prevAdaptiveStress 写入 raw 域，与 adaptiveSpawn.smoothStress 单位一致；
     * 详见 web/src/adaptiveSpawn.js 顶部 normalizeStress JSDoc。 */
    this._spawnContext.prevAdaptiveStress = layered?._adaptiveStressRaw ?? layered?._adaptiveStress;
    if (Number.isFinite(layered?._occupancyFillAnchor)) {
      this._spawnContext._occupancyFillAnchor = layered._occupancyFillAnchor;
    }

    const diag = getLastSpawnDiagnostics();
    this._spawnContext.nearFullLines = diag?.layer1?.nearFullLines ?? 0;
    this._spawnContext.close1 = diag?.layer1?.close1 ?? 0;
    this._spawnContext.close2 = diag?.layer1?.close2 ?? 0;
    this._spawnContext.pcSetup = diag?.layer1?.pcSetup ?? 0;
    this._spawnContext.holes = diag?.layer1?.holes ?? 0;
    this._spawnContext.multiClearCandidates = diag?.layer1?.multiClearCandidates ?? 0;
    this._spawnContext.perfectClearCandidates = diag?.layer1?.perfectClearCandidates ?? 0;
    this._resetBottleneckTrough();
  }

  _resetBottleneckTrough() {
    this._spawnContext.bottleneckTrough = Infinity;
    this._spawnContext.bottleneckSolutionTrough = Infinity;
    this._spawnContext.bottleneckSamples = 0;
  }

  _updateBottleneckTrough() {
    const snap = computeCandidatePlacementMetric(this.grid, this.dock);
    if (!snap) return;
    const fmf = Number(snap.firstMoveFreedom);
    const sc = Number(snap.solutionCount);
    if (Number.isFinite(fmf)) {
      const prev = Number(this._spawnContext.bottleneckTrough);
      this._spawnContext.bottleneckTrough = Number.isFinite(prev) ? Math.min(prev, fmf) : fmf;
    }
    if (Number.isFinite(sc)) {
      const prev = Number(this._spawnContext.bottleneckSolutionTrough);
      this._spawnContext.bottleneckSolutionTrough = Number.isFinite(prev) ? Math.min(prev, sc) : sc;
    }
    this._spawnContext.bottleneckSamples = (Number(this._spawnContext.bottleneckSamples) || 0) + 1;
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
      this._maxCombo = Math.max(this._maxCombo, clears);
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
    if (this._profile && typeof this._profile.recordPlace === 'function') {
      this._profile.recordPlace(clears > 0, clears, this.grid.getFillRatio());
    }
    this._updateBottleneckTrough();

    if (this.dock.every((d) => d.placed)) {
      this._advanceSpawnContext();
      this._spawnDock();
    }

    const remaining = this.dock.filter((d) => !d.placed);
    if (!this.gameOver && remaining.length > 0 && !this.grid.hasAnyMove(this.dock)) {
      this.gameOver = true;
      this._finalizeSession();
      this.onGameOver({
        score: this.score,
        steps: this.steps,
        clears: this.totalClears,
      });
    }

    this.onStateChange(this._snapshot());
    return { gain, clears, cleared: result.cells || [] };
  }

  /**
   * 局末同步画像：写入会话历史 + 持久化。
   * 同时被 game over 路径与外部「主动放弃」入口调用，保证两条路径一致。
   */
  _finalizeSession() {
    if (!this._profile) return;
    try {
      if (typeof this._profile.recordSessionEnd === 'function') {
        this._profile.recordSessionEnd({
          score: this.score,
          placements: this.steps,
          clears: this.totalClears,
          misses: this._missCount || 0,
          maxCombo: this._maxCombo || 0,
          mode: this.config?.mode || 'endless',
        });
      }
      if (typeof this._profile.save === 'function') {
        this._profile.save();
      }
    } catch (_) {
      // 持久化失败（隐私模式 / 存储满）不阻塞游戏流程
    }
  }

  /** 供 page 在用户主动结束（弃局、退出）时调用，确保画像与持久化收口。 */
  abandonRun() {
    if (this.gameOver) return;
    this.gameOver = true;
    this._finalizeSession();
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
