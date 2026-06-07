/**
 * Open Block 微信小程序 — 游戏控制器。
 *
 * 纯逻辑层：串联 core/grid、core/shapes、core/gameRules 与渲染器，
 * 管理游戏状态（得分、步数、dock 块、拖拽）。
 *
 * 不直接操作 DOM / WXML，通过回调通知 Page 更新视图。
 */

const { Grid } = require('../core/grid');
const { getAllShapes, getRegularShapes, getShapeCategory, isSpecialShapeId } = require('../core/shapes');
const { getStrategy } = require('../core/config');
const {
  computeClearScore,
  deriveNextComboCount,
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

    /* ⚠️ 历史字段名 _maxCombo —— 实际是「本局最大单手 result.count（空间维度多消）」，
     * 不是 combo 链长度；与 web 端 gameStats.maxCombo 同语义。
     * 时间维度的 combo 链长度见 _comboCount。术语权威：docs/product/CLEAR_SCORING.md §〇。 */
    this._maxCombo = 0;
    this._missCount = 0;
    /** Combo 链（grace 窗口）：清线启动；连续 ≥ gracePlacements 步未清进入"待断"。
     *  进入 computeClearScore → comboMultiplier；与 web 主局 _comboCount / _roundsSinceLastClear 同口径。 */
    this._comboCount = 0;
    this._roundsSinceLastClear = Number.POSITIVE_INFINITY;
    this._lastSpawnIntent = null;
    this._lastSpawnIntentAge = 0;

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
    this._comboCount = 0;
    this._roundsSinceLastClear = Number.POSITIVE_INFINITY;
    this._lastSpawnIntent = null;
    this._lastSpawnIntentAge = 0;
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
      specialShapeUsed: 0,
      specialReliefUsed: 0,
      specialPressureUsed: 0,
      totalClears: 0,
      roundsSinceSpecial: 0,
      dupInjectUsed: 0,
      roundsSinceDupInject: 0,
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
    const layered = this._resolveSpawnStrategy();
    this._captureSpawnIntent(layered);
    /* 与 Web Game.spawnBlocks 对齐：adaptiveSpawn 产出 scoreMilestone 后，
     * 在传入 generateDockShapes 前桥接到 spawnContext；special / duplicate
     * 节流计数也在出块入口 +1，让 blockSpawn 的 gate 读到同一语义。 */
    this._spawnContext.scoreMilestone = layered?.spawnHints?.scoreMilestone === true;
    this._spawnContext.roundsSinceSpecial = (this._spawnContext.roundsSinceSpecial ?? 0) + 1;
    this._spawnContext.roundsSinceDupInject = (this._spawnContext.roundsSinceDupInject ?? 0) + 1;
    this._spawnContext.skin = this.skin;
    let shapes = generateDockShapes(this.grid, layered, this._spawnContext);
    const valid = validateSpawnTriplet(this.grid, shapes, { searchBudget: 14000 });
    if (!valid.ok || (ensureMove && !shapes.some((s) => this.grid.canPlaceAnywhere(s.data)))) {
      /* v1.60.46：fallback 必须使用 getRegularShapes()——12 个 special 小块
       * （1x2 / 2x1 / 1x3 / 3x1 / l3-a..d / diag-2a..3b）按 §10.7 契约仅由
       * _tryInjectSpecial 事件注入产出；fallback 一次性可能给出 3 个 special
       * 块违反契约（用户截图复盘：dock 出现 1×2 + 2×1 + 1×3 三连 special，
       * 与玩家心智不符）。
       * 同时校验 isSpecialShapeId 兜底——即便 getRegularShapes 实现漂移也守住。 */
      const pool = getRegularShapes().filter((s) => !isSpecialShapeId(s.id));
      const fallback = pool.filter((s) => this.grid.canPlaceAnywhere(s.data)).slice(0, 3);
      shapes = fallback.length >= 3 ? fallback : pool.slice(0, 3);
    }
    shapes = this._sanitizeDockShapes(shapes);

    const iconBonusTarget = Math.max(0, Math.min(1, layered.spawnHints?.iconBonusTarget ?? 0));
    const colorBias = monoNearFullLineColorWeights(this.grid, this.skin)
      .map((w) => w * (1 + iconBonusTarget * 2.5));

    /* v1.60.27：monoFlush 染色强制绑定（与 web/src/game.js 同步）
     * v1.60.29：dock 3 块严格无放回，绝不同色（同色仅在 monoFlush 彩蛋时作为锁定色） */
    const spawnDiag = getLastSpawnDiagnostics();
    const chosenMetas = spawnDiag?.chosen || [];
    const dockColorsArr = new Array(3).fill(null);
    const lockedSlots = new Set();

    for (let i = 0; i < 3; i++) {
      const meta = chosenMetas[i];
      if (meta && (meta.monoFlush || 0) >= 1 && Number.isInteger(meta.monoFlushTargetCi)) {
        dockColorsArr[i] = meta.monoFlushTargetCi;
        lockedSlots.add(i);
      }
    }

    if (lockedSlots.size < 3) {
      const usedSet = new Set();
      for (const slot of lockedSlots) usedSet.add(dockColorsArr[slot]);
      const primaryPicks = pickThreeDockColors(colorBias).filter((c) => !usedSet.has(c));
      const fallbackPool = [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => !usedSet.has(c));
      let primaryIdx = 0;
      for (let i = 0; i < 3; i++) {
        if (lockedSlots.has(i)) continue;
        let color = primaryPicks[primaryIdx++];
        if (color == null || usedSet.has(color)) {
          color = fallbackPool.find((c) => !usedSet.has(c));
        }
        if (color == null) color = Math.floor(Math.random() * 8);
        dockColorsArr[i] = color;
        usedSet.add(color);
      }
    }

    this.dock = shapes.map((s, i) => ({
      id: s.id,
      shape: s.data,
      colorIdx: dockColorsArr[i],
      placed: false,
    }));
    this._commitSpawnContext(layered);
    if (this._profile && typeof this._profile.recordSpawn === 'function') {
      this._profile.recordSpawn();
    }
    /* v1.60.45：每轮 spawn 计数 roundsSinceLastDelight +1。
     * 超阈值（Android/微信 5 轮 / iOS 7 轮）→ next spawn 的 _intentInputs
     * 携带 delightStarved=true → adaptiveSpawn 强 relief，与 web 端镜像。 */
    if (this._profile && typeof this._profile.tickRoundForDelight === 'function') {
      this._profile.tickRoundForDelight();
    }
  }

  _sanitizeDockShapes(shapes) {
    const pool = getRegularShapes()
      .filter((s) => s && Array.isArray(s.data) && !isSpecialShapeId(s.id));
    if (pool.length === 0) return Array.isArray(shapes) ? shapes.slice(0, 3) : [];

    const result = [];
    const usedIds = new Set();
    const source = Array.isArray(shapes) ? shapes : [];
    const pickFallback = () => (
      pool.find((s) => !usedIds.has(s.id) && this.grid.canPlaceAnywhere(s.data)) ||
      pool.find((s) => !usedIds.has(s.id)) ||
      pool[0]
    );

    for (let i = 0; i < 3; i++) {
      const candidate = source[i];
      const safe = candidate && Array.isArray(candidate.data)
        ? candidate
        : pickFallback();
      if (!safe) continue;
      result.push(safe);
      usedIds.add(safe.id);
    }

    return result;
  }

  _resolveSpawnStrategy() {
    const fill = this.grid?.getFillRatio?.() || 0;
    const _difficulty = (this.strategyId === 'hard' || this.strategyId === 'normal') ? this.strategyId : 'easy';
    const _generator = (this.strategyId === 'hard') ? 'budget-p2' : 'triplet-p1';
    const _bestScore = Math.max(
      this._bestScore,
      Number(this._profile?.personalBest || this._profile?.bestScore || 0),
    );
    const _pbBin = _bestScore < 500 ? 500
      : _bestScore < 1500 ? 1500
        : _bestScore < 4000 ? 4000
          : _bestScore < 10000 ? 10000 : 25000;
    const _totalRounds = Number(this._profile?.totalRounds || this._spawnContext?.totalRounds || 0);
    const _lifecycle = _totalRounds < 5 ? 'onboarding'
      : _totalRounds < 30 ? 'growth'
        : _totalRounds < 100 ? 'mature' : 'plateau';
    const _tuningCtx = {
      difficulty: _difficulty,
      generator: _generator,
      bot_policy: 'clear-greedy',
      pb_bin: _pbBin,
      lifecycle_stage: _lifecycle,
      userId: this._profile?.userId || '',
    };
    return resolveAdaptiveStrategy(
      this.strategyId,
      this._profile,
      this.score,
      this._runStreak,
      fill,
      {
        ...(this._spawnContext || {}),
        bestScore: this._bestScore,
        tuningV2Context: _tuningCtx,
        prevSpawnIntent: this._lastSpawnIntent ?? null,
        prevSpawnIntentAge: this._lastSpawnIntentAge ?? 0,
        _gridRef: this.grid,
        _dockShapePool: (this.dock || [])
          .filter((b) => b && !b.placed && Array.isArray(b.shape))
          .map((b) => ({ data: b.shape })),
      },
    );
  }

  /** 与 web Game._captureAdaptiveInsight 的 spawnIntent dwell 维护对齐 */
  _captureSpawnIntent(layered) {
    const newIntent = layered?._spawnIntent ?? layered?.spawnHints?.spawnIntent ?? null;
    if (newIntent && this._lastSpawnIntent === newIntent) {
      this._lastSpawnIntentAge = (this._lastSpawnIntentAge ?? 0) + 1;
    } else {
      this._lastSpawnIntentAge = 0;
    }
    this._lastSpawnIntent = newIntent;
  }

  _commitSpawnContext(layered) {
    this._spawnContext.totalRounds = (this._spawnContext.totalRounds || 0) + 1;
    if (this.dock?.some((s) => isSpecialShapeId(s.id))) {
      this._spawnContext.roundsSinceSpecial = 0;
    }
    this._spawnContext.scoreMilestone = false;
    this._spawnContext.totalClears = this.totalClears;
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
      totalClears: this.totalClears,
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

    this.grid.place(
      b.shape,
      b.colorIdx,
      gx,
      gy,
      { shapeId: b.id, isSpecial: isSpecialShapeId(b.id) },
    );
    this.steps++;
    b.placed = true;

    const bonusLinesSnap = detectBonusLines(this.grid, this.skin);
    const result = this.grid.checkLines();
    result.bonusLines = result.count > 0 ? bonusLinesSnap : [];
    result.perfectClear = result.count > 0 && this.grid.getFillRatio() === 0;
    let gain = 0;
    let clears = 0;
    let comboMultiplier = 1;
    if (result.count > 0) {
      clears = result.count;
      this._roundClearCount += clears;
      this.totalClears += clears;
      this._maxCombo = Math.max(this._maxCombo, clears);
      /* Combo (grace 窗口) 推导（与 web 主局 deriveNextComboCount 同公式）：
       *   gap < grace → combo+=1；gap ≥ grace → 重启 = 1。 */
      this._comboCount = deriveNextComboCount(this._comboCount, this._roundsSinceLastClear, true);
      this._roundsSinceLastClear = 0;
      const scoreOut = computeClearScore(this.strategyId, result, undefined, this._comboCount);
      gain = scoreOut.clearScore;
      comboMultiplier = scoreOut.comboMultiplier || 1;
      this.score += gain;
      vibrateShort();

      /* v1.60.45：爽感事件 → 清零 roundsSinceLastDelight（与 web 端镜像，
       * 数据依据 docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.5）。
       *   - 完美清屏 → 'pcClear'（最强）
       *   - 多消 ≥ 2 → 'multiClear'
       *   - 单消但 monoFlush 命中 → 'monoFlush'
       *   - 高 Combo（≥ 4 连击）→ 'comboHigh' */
      if (this._profile && typeof this._profile.recordDelight === 'function') {
        let kind = null;
        if (result.perfectClear) kind = 'pcClear';
        else if (clears >= 2) kind = 'multiClear';
        else if ((result.bonusLines || []).some((b) => b?.kind === 'monoFlush' || (b?.iconBonus || 0) >= 5)) {
          kind = 'monoFlush';
        }
        if (kind) this._profile.recordDelight(kind);
        if (this._maxCombo >= 4) this._profile.recordDelight('comboHigh');
      }

      this.onLineClear({
        clears,
        gain,
        score: this.score,
        cells: result.cells || [],
        rows: result.rows || [],
        cols: result.cols || [],
        bonusLines: result.bonusLines || [],
        comboCount: this._comboCount,
        comboMultiplier,
      });
    } else {
      /* 未清线 → 累加 grace 计数；_comboCount 不在此归零（由下次清线时按 grace 判定） */
      this._roundsSinceLastClear = (this._roundsSinceLastClear === Number.POSITIVE_INFINITY)
        ? Number.POSITIVE_INFINITY
        : this._roundsSinceLastClear + 1;
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
