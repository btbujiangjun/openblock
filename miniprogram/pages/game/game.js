/**
 * Open Block 微信小程序 — 游戏页面逻辑。
 *
 * 核心流程：
 * 1. onReady: 获取 Canvas 实例 → 初始化 GameRenderer + GameController
 * 2. touch 事件：dock 块拖拽到棋盘区域 → 计算网格坐标 → 放置
 * 3. 每步放置后重绘 Canvas
 */
const { GameRenderer } = require('../../utils/renderer');
const { GameController } = require('../../utils/gameController');
const { getScreenSize } = require('../../adapters/platform');
const storage = require('../../adapters/storage');
const { PERFECT_CLEAR_MULT, bonusEffectHoldMs } = require('../../core/bonusScoring');
const { getActiveSkin, setActiveSkinId } = require('../../core/skins');
const { setLanguage, t } = require('../../core/i18n');
const { createAudioFx } = require('../../utils/audioFx');
const { createFeedbackToggles } = require('../../utils/feedbackToggles');

/* v1.46 触屏速度感知曲线（与 web/src/config.js 对齐，参考桌面 OS pointer ballistics）：
 *   speed ≤ TOUCH_DRAG_SPEED_SLOW (px/ms) → TOUCH_DRAG_GAIN_MIN（1.05，对位精准不抢跑）
 *   speed ≥ TOUCH_DRAG_SPEED_FAST (px/ms) → TOUCH_DRAG_GAIN（1.7，快速一甩到对岸省力）
 *   中间段线性插值
 *
 * 旧的恒定 1.12 增益太弱，玩家从 dock 拖到盘面对岸要走完整物理距离；调高就毁掉
 * 对位手感。速度感知曲线把"精准 / 省力"两个目标解耦，再叠加 startBoost 与
 * 累计偏移上限上调，让小幅手势即可完成落子。 */
const TOUCH_DRAG_GAIN = 1.7;
const TOUCH_DRAG_GAIN_MIN = 1.05;
const TOUCH_DRAG_SPEED_SLOW_PX_MS = 0.10;
const TOUCH_DRAG_SPEED_FAST_PX_MS = 0.80;
const TOUCH_DRAG_GAIN_MAX_OFFSET_CELLS = 6.0;
/* 触屏起手 boost：抓起候选块时给 preview 一次性向上偏移 N 格，把"dock→盘面下缘"
 * 这段固定物理距离免掉。0 = 关闭。 */
const TOUCH_DRAG_BOOST_CELLS = 1.4;
const TOUCH_DRAG_LIFT_GAP_CELLS = 0.35;
const TOUCH_DRAG_LIFT_MAX_CELLS = 2.4;
/* 悬停（移动中）snap 半径：保守，避免 preview 跳到太远的"全局好点" */
const PLACE_HOVER_SNAP_RADIUS = 2;
/* 释放（touchend）snap 半径：更宽容，"既然已经放手，就尽量帮忙落成"。
 * v1.46：3 → 4 格，配合速度感知 + 起手 boost 让"小幅拖动即可落子"。 */
const PLACE_RELEASE_SNAP_RADIUS = 4;
/* 落子失败时 preview 抖动 + 隐藏的总时长（与 wxss keyframes 对齐） */
const REJECT_ANIM_MS = 240;

Page({
  data: {
    score: 0,
    steps: 0,
    totalClears: 0,
    dock: [],
    gameOver: false,
    canvasW: 0,
    canvasH: 0,
    dockSlotSize: 80,
    dockCellSize: 18,
    pageStyle: '',
    gridWrapperStyle: '',
    dockStyle: '',
    dragIdx: -1,
    dragPreviewVisible: false,
    dragPreviewStyle: '',
    dragPreviewCells: [],
    bestScore: 0,
    bestGap: 0,
    bestGapVisible: false,
    floatScoreVisible: false,
    floatScoreText: '',
    floatScoreClass: '',
    /* v1.46 HUD 分数滚动强化：每次 score 变化时根据 delta 分档（small/medium/large）
     * 给 stat-value 临时挂上 score-burst--N class 触发 wxss 内的 scale + 高亮动画。
     * 小程序 setData 性能开销较大，不做"逐帧滚动"——一次性写入 + CSS 脉冲已经能让
     * 玩家感知到分数刚跳；既有 _showFloatScore 提供的"+N 飘字"是补充。 */
    scoreBurstClass: '',
    bestGapText: '',
    scoreText: '',
    clearsText: '',
    audioOn: true,
    visualOn: true,
    visualIcon: '✨',
    visualLabel: '',
    qualityMode: 'high',
    qualityIcon: '🌈',
    qualityLabel: '',
    text: {},
  },

  // --- 私有状态 ---
  _renderer: null,
  _controller: null,
  _canvas: null,
  _cellSize: 0,
  _gridOffset: { x: 0, y: 0 },
  _dragging: false,
  _dragBlockIdx: -1,
  _dragGx: -1,
  _dragGy: -1,
  _dragTrail: [],
  _dragStartTouch: null,
  _gridRect: null,
  _particleRafId: null,
  _clearCellsTimer: null,
  _floatScoreTimer: null,
  _scoreBurstTimer: null,
  _lastDisplayedScore: null,
  _gameOverTimer: null,
  _gameOverAudioTimer: null,
  _gameOverQuietUntil: 0,
  _newBestCelebrated: false,
  _canvasInitAttempts: 0,
  _dockCellSize: 18,
  _layoutKey: '',
  _resizeTimer: null,
  _audio: null,
  _toggles: null,

  onLoad(query) {
    const strategyId = query.strategy || 'normal';
    this._strategyId = strategyId;
    if (query.lang) setLanguage(query.lang);
    if (query.skin) setActiveSkinId(query.skin);
    this._skin = getActiveSkin();
    this._audio = createAudioFx();
    const audioPrefs = this._audio.getPrefs?.() || { sound: true };
    if (audioPrefs.sound) this._audio.warmup(['tick', 'place', 'clear']);
    const bestKey = `openblock_best_${strategyId}`;
    const best = Number(storage.getItem(bestKey) || 0) || 0;
    this._bestScore = best;
    this._newBestCelebrated = false;
    /* renderer 在 onReady 才会创建，先用空 renderer 初始化偏好控制器，
       等 renderer 就绪后再 _wireRendererToggles() 把当前偏好套回去。 */
    this._initToggles();
    this._refreshText();
    this.setData({
      bestScore: best,
      audioOn: audioPrefs.sound !== false,
    });
  },

  _initToggles() {
    if (this._toggles) return;
    this._toggles = createFeedbackToggles({
      renderer: null,
      onChange: ({ visualEnabled, qualityMode }) => {
        const visualMeta = this._toggles.getVisualMeta();
        const qualityMeta = this._toggles.getQualityMeta();
        this.setData({
          visualOn: visualEnabled,
          visualIcon: visualMeta.icon,
          visualLabel: t(visualMeta.labelKey),
          qualityMode,
          qualityIcon: qualityMeta.icon,
          qualityLabel: t(qualityMeta.labelKey),
        });
      },
    });
  },

  _wireRendererToggles() {
    if (!this._toggles || !this._renderer) return;
    /* 把首屏读取到的偏好同步到刚创建的 renderer。 */
    const { visualEnabled, qualityMode } = this._toggles.getState();
    this._renderer.setQualityMode?.(qualityMode);
    this._renderer.setEffectsEnabled?.(visualEnabled);
  },

  onToggleVisual() {
    if (!this._toggles) this._initToggles();
    this._wireRendererToggles();
    this._toggles.toggleVisual();
    /* 反馈一下开关动作；关闭特效但保留音效（走的是 audio-toggle 路径，互不影响）。 */
    if (this._audio?.getPrefs?.().sound !== false) {
      this._audio.play('tick', { force: true });
    }
    this._redraw?.();
  },

  onCycleQuality() {
    if (!this._toggles) this._initToggles();
    this._wireRendererToggles();
    this._toggles.cycleQualityMode();
    if (this._audio?.getPrefs?.().sound !== false) {
      this._audio.play('tick', { force: true });
    }
    this._redraw?.();
  },

  onToggleAudio() {
    if (!this._audio) this._audio = createAudioFx();
    const current = this._audio.getPrefs?.() || { sound: true };
    const next = !current.sound;
    this._audio.setEnabled(next);
    this.setData({ audioOn: next });
    if (next) {
      this._audio.warmup(['tick', 'place', 'clear']);
      this._audio.play('tick');
    } else {
      this._audio.vibrate('tick');
    }
  },

  _refreshText() {
    this.setData({
      text: {
        score: t('score'),
        steps: t('steps'),
        clears: t('clears'),
        best: t('best'),
        gameOver: t('gameOver'),
        restart: t('restart'),
        audioOn: t('audioOn'),
        audioOff: t('audioOff'),
      },
    });
  },

  _dockViewData(dock, dragIdx = this.data.dragIdx) {
    const cell = this._fitDockCellSize(dock);
    const slot = cell * 5;
    return dock.map((d, i) => {
      const classes = ['dock-slot'];
      if (d.placed) classes.push('dock-slot--placed');
      if (dragIdx === i) classes.push('dock-slot--dragging');
      return {
        placed: d.placed,
        colorIdx: d.colorIdx,
        className: classes.join(' '),
        slotStyle: `width:${slot}px;height:${slot}px`,
      };
    });
  },

  _fitDockCellSize(dock) {
    if (!Array.isArray(dock) || dock.length === 0) return this._dockCellSize;
    const screen = getScreenSize();
    const width = Math.max(300, Number(screen.width) || 375);
    const pagePad = this._clampNumber(Math.round(width * 0.034), 10, 18);
    const dockGap = this._clampNumber(Math.round(width * 0.036), 8, 22);
    const available = Math.max(160, width - pagePad * 2 - dockGap * Math.max(0, dock.length - 1));
    const totalCols = Math.max(1, dock.length * 5);
    const maxDockCell = this._cellSize;
    const fitted = this._clampNumber(Math.floor(available / totalCols), 22, maxDockCell);
    this._dockCellSize = fitted;
    return fitted;
  },

  _shapeBounds(shape) {
    const rows = Array.isArray(shape) ? shape.length : 0;
    const cols = rows > 0 ? Math.max(...shape.map((r) => r.length)) : 0;
    return { rows, cols };
  },

  onUnload() {
    this._stopParticleLoop();
    if (this._floatScoreTimer) {
      clearTimeout(this._floatScoreTimer);
      this._floatScoreTimer = null;
    }
    if (this._clearCellsTimer) {
      clearTimeout(this._clearCellsTimer);
      this._clearCellsTimer = null;
    }
    if (this._gameOverTimer) {
      clearTimeout(this._gameOverTimer);
      this._gameOverTimer = null;
    }
    if (this._gameOverAudioTimer) {
      clearTimeout(this._gameOverAudioTimer);
      this._gameOverAudioTimer = null;
    }
    if (this._resizeTimer) {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = null;
    }
  },

  _touchPoint(e) {
    return (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]) || null;
  },

  _touchDragLiftPx(block) {
    if (!block || !this._cellSize) return 0;
    const bounds = this._shapeBounds(block.shape);
    const lift = (bounds.rows / 2 + TOUCH_DRAG_LIFT_GAP_CELLS) * this._cellSize;
    return Math.min(lift, TOUCH_DRAG_LIFT_MAX_CELLS * this._cellSize);
  },

  /**
   * 触屏控制点：preview / 落点判定使用的"虚拟指针"位置。
   *
   * 关键不变量（与 web 端 _applyDragPointerGain 同源）：preview = 触点 + _dragExtraOffset，
   * _dragExtraOffset 单调累加而不重算——已经被加速放大的部分不会因后续慢速回调被退回，
   * 跨帧 preview 严格连续，不会跳跃。同时把 preview 整体上移 `_touchDragLiftPx`，
   * 避免手指压住候选块中心。
   */
  _touchControlPoint(e, block) {
    const touch = this._touchPoint(e);
    if (!touch) return null;
    if (!this._dragStartTouch) {
      this._dragStartTouch = { x: touch.clientX, y: touch.clientY };
    }
    if (!this._dragExtraOffset) {
      this._dragExtraOffset = { x: 0, y: 0 };
    }

    /* v1.46：与 web 端 _applyDragPointerGain 同款速度感知曲线
     *   speed ≤ SLOW → MIN_GAIN（对位精准不抢跑）
     *   speed ≥ FAST → MAX_GAIN（快速一甩到对岸省力）
     *   中间段线性插值
     * 首帧无 last 时按 1（高速）处理——抓起后立即抬手必然是位移意图。 */
    const last = this._dragLastTouch;
    const now = Date.now();
    const span = Math.max(0.001, TOUCH_DRAG_SPEED_FAST_PX_MS - TOUCH_DRAG_SPEED_SLOW_PX_MS);
    let velocityFactor = 1;
    if (last) {
      const dt = Math.max(1, now - (last.t || now));
      const dist = Math.hypot(touch.clientX - last.x, touch.clientY - last.y);
      const speed = dist / dt;
      velocityFactor = Math.max(0, Math.min(1, (speed - TOUCH_DRAG_SPEED_SLOW_PX_MS) / span));
    }
    const effectiveGain = TOUCH_DRAG_GAIN_MIN + (TOUCH_DRAG_GAIN - TOUCH_DRAG_GAIN_MIN) * velocityFactor;
    const stepGain = Math.max(0, effectiveGain - 1);

    if (last && stepGain > 0) {
      this._dragExtraOffset.x += (touch.clientX - last.x) * stepGain;
      this._dragExtraOffset.y += (touch.clientY - last.y) * stepGain;
    }
    this._dragLastTouch = { x: touch.clientX, y: touch.clientY, t: now };

    const maxExtra = TOUCH_DRAG_GAIN_MAX_OFFSET_CELLS * (this._cellSize || 0);
    if (maxExtra > 0) {
      const len = Math.hypot(this._dragExtraOffset.x, this._dragExtraOffset.y);
      if (len > maxExtra) {
        const clamp = maxExtra / len;
        this._dragExtraOffset.x *= clamp;
        this._dragExtraOffset.y *= clamp;
      }
    }

    return {
      clientX: touch.clientX + this._dragExtraOffset.x,
      clientY: touch.clientY + this._dragExtraOffset.y - this._touchDragLiftPx(block),
    };
  },

  onReady() {
    this._initCanvas();
  },

  onResize() {
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this._resizeTimer = null;
      this._relayoutCanvas();
    }, 120);
  },

  _clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  _computeAdaptiveLayout(screen) {
    const width = Math.max(300, Number(screen.width) || 375);
    const height = Math.max(480, Number(screen.height) || 667);
    const gridN = 8;
    const pagePad = this._clampNumber(Math.round(width * 0.034), 10, 18);
    const topReserve = this._clampNumber(Math.round(height * 0.128), 74, 104);
    const gridPadY = this._clampNumber(Math.round(height * 0.013), 6, 12);
    const dockPadTop = this._clampNumber(Math.round(height * 0.028), 12, 28);
    const dockPadBottom = this._clampNumber(Math.round(height * 0.036), 18, 42);
    const dockGap = this._clampNumber(Math.round(width * 0.036), 8, 22);
    const maxCell = width >= 700 ? 64 : width >= 430 ? 58 : 52;
    const minCell = height < 600 || width < 340 ? 30 : 34;
    const maxGridWidth = width - pagePad * 2;
    const dockRowsReserve = 3;
    const verticalChrome = topReserve + dockPadTop + dockPadBottom + gridPadY * 2;
    const maxGridHeight = Math.floor((height - verticalChrome) * (gridN / (gridN + dockRowsReserve)));
    const rawCell = Math.floor(Math.min(maxGridWidth, Math.max(gridN * minCell, maxGridHeight)) / gridN);
    const cellSize = this._clampNumber(rawCell, minCell, maxCell);
    const gridPx = cellSize * gridN;

    const dockFitWidth = Math.max(180, width - pagePad * 2 - dockGap * 2);
    const dockCellSize = this._clampNumber(Math.floor(dockFitWidth / 15), 22, cellSize);
    const dockSlotSize = this._clampNumber(
      Math.round(dockCellSize * 2.25),
      dockCellSize,
      width >= 700 ? 150 : 132
    );

    return {
      cellSize,
      gridPx,
      dockSlotSize,
      dockCellSize,
      pageStyle: `padding-left:${pagePad}px;padding-right:${pagePad}px;`,
      gridWrapperStyle: `padding:${gridPadY}px 0 ${Math.max(6, gridPadY - 2)}px;`,
      dockStyle: `gap:${dockGap}px;padding:${dockPadTop}px 0 ${dockPadBottom}px;`,
      key: [
        width,
        height,
        cellSize,
        dockSlotSize,
        dockCellSize,
        pagePad,
        gridPadY,
        dockPadTop,
        dockPadBottom,
        dockGap,
      ].join(':'),
    };
  },

  _initCanvas() {
    const screen = getScreenSize();
    const layout = this._computeAdaptiveLayout(screen);

    this._layoutKey = layout.key;
    this._cellSize = layout.cellSize;
    this._dockCellSize = layout.dockCellSize;
    this._gridOffset = { x: 0, y: 0 };

    this.setData({
      canvasW: layout.gridPx,
      canvasH: layout.gridPx,
      dockSlotSize: layout.dockSlotSize,
      dockCellSize: layout.dockCellSize,
      pageStyle: layout.pageStyle,
      gridWrapperStyle: layout.gridWrapperStyle,
      dockStyle: layout.dockStyle,
    }, () => {
      this._queryCanvasAndStart(screen, layout.gridPx);
    });
  },

  _relayoutCanvas() {
    if (this._dragging) {
      this._dragging = false;
      this._dragBlockIdx = -1;
      this._dragGx = -1;
      this._dragGy = -1;
      this._dragTrail = [];
      this._dragStartTouch = null;
      this._hideDragPreview();
      this.setData({ dragIdx: -1 });
    }
    const screen = getScreenSize();
    const layout = this._computeAdaptiveLayout(screen);
    if (layout.key === this._layoutKey && this._canvas) {
      this._refreshGridRect();
      return;
    }

    this._layoutKey = layout.key;
    this._cellSize = layout.cellSize;
    this._dockCellSize = layout.dockCellSize;
    this.setData({
      canvasW: layout.gridPx,
      canvasH: layout.gridPx,
      dockSlotSize: layout.dockSlotSize,
      dockCellSize: layout.dockCellSize,
      pageStyle: layout.pageStyle,
      gridWrapperStyle: layout.gridWrapperStyle,
      dockStyle: layout.dockStyle,
      dock: this._controller ? this._dockViewData(this._controller.dock, -1) : this.data.dock,
    }, () => {
      this._queryCanvasAndStart(screen, layout.gridPx);
    });
  },

  _queryCanvasAndStart(screen, gridPx) {
    const query = this.createSelectorQuery();
    query.select('#game-canvas')
      .fields({ node: true, size: true, rect: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          this._canvasInitAttempts += 1;
          if (this._canvasInitAttempts <= 3) {
            setTimeout(() => this._queryCanvasAndStart(screen, gridPx), 80);
            return;
          }
          console.error('Canvas 节点获取失败', res);
          wx.showToast({ title: '画布初始化失败，请重试', icon: 'none' });
          return;
        }
        this._canvasInitAttempts = 0;
        const canvas = res[0].node;
        const dpr = screen.dpr;

        canvas.width = gridPx * dpr;
        canvas.height = gridPx * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('Canvas 2D 上下文获取失败');
          wx.showToast({ title: '画布初始化失败，请重试', icon: 'none' });
          return;
        }
        ctx.scale(dpr, dpr);

        this._canvas = canvas;
        this._setGridRect(res[0], gridPx);
        this._refreshGridRect();
        this._renderer = new GameRenderer(canvas, dpr);
        this._renderer._ctx = ctx;
        this._renderer.setSkin(this._skin || getActiveSkin());
        this._wireRendererToggles();

        if (!this._controller) {
          this._controller = new GameController(this._strategyId, {
            skin: this._skin || getActiveSkin(),
            onStateChange: (snap) => this._onStateChange(snap),
            onLineClear: (info) => this._onLineClear(info),
            onGameOver: (info) => this._onGameOver(info),
          });
        }

        this._redraw();
        wx.nextTick(() => this._drawDockBlocks());
        setTimeout(() => this._audio?.warmup?.(['multi', 'combo', 'perfect', 'bonus', 'gameOver']), 800);
      });
  },

  _onStateChange(snap) {
    const best = this._bestScore != null ? this._bestScore : this.data.bestScore;
    const gap = Math.max(0, best - snap.score);
    const gameOverQuietMs = snap.gameOver ? Math.max(0, this._gameOverQuietUntil - Date.now()) : 0;
    if (this._gameOverTimer) {
      clearTimeout(this._gameOverTimer);
      this._gameOverTimer = null;
    }
    if (gameOverQuietMs > 0) {
      this._gameOverTimer = setTimeout(() => {
        this.setData({ gameOver: true });
        this._gameOverTimer = null;
      }, gameOverQuietMs);
    }
    /* v1.46 HUD 分数 burst：
     *   delta>0 → 按档位挂 score-burst--small/medium/large，wxss 触发 scale + 高亮脉冲
     *   delta=0 / 减分（重开局）→ 不触发，避免误反馈
     * _lastDisplayedScore 为 null 表示首帧 / 重开局，不算 delta（避免"老分数→0"反向触发）
     */
    const prev = this._lastDisplayedScore;
    const delta = (prev != null) ? (snap.score - prev) : 0;
    let burstClass = '';
    if (delta > 0) {
      burstClass = delta >= 80 ? 'score-burst--large'
                 : delta >= 20 ? 'score-burst--medium'
                 : 'score-burst--small';
    }
    this._lastDisplayedScore = snap.score;

    const dataPatch = {
      score: snap.score,
      steps: snap.steps,
      totalClears: snap.totalClears,
      dock: this._dockViewData(snap.dock),
      gameOver: snap.gameOver && gameOverQuietMs <= 0,
      bestScore: best,
      bestGap: gap,
      bestGapVisible: best > 0 && gap > 0,
      bestGapText: t('bestGap', { n: gap }),
      scoreText: t('finalScore', { n: snap.score }),
      clearsText: t('finalClears', { n: snap.totalClears }),
    };
    if (burstClass) {
      dataPatch.scoreBurstClass = burstClass;
      if (this._scoreBurstTimer) clearTimeout(this._scoreBurstTimer);
      /* v1.46.1：与 web 端 HUD_BURST_DURATION 对齐——延长到玩家可看清的时长，与滚动节奏相称 */
      const burstMs = burstClass === 'score-burst--large' ? 1100
                    : burstClass === 'score-burst--medium' ? 800 : 540;
      this._scoreBurstTimer = setTimeout(() => {
        this._scoreBurstTimer = null;
        this.setData({ scoreBurstClass: '' });
      }, burstMs);
    }
    this.setData(dataPatch);
  },

  _onLineClear(info) {
    const g = this._controller;
    const r = this._renderer;
    if (!r || !g) return;
    const perfectClear = g.grid.getFillRatio() === 0;
    const isCombo = info.clears >= 3;
    const isDouble = info.clears === 2;

    r.setClearCells(info.cells || []);
    r.setPreviewClearCells([]);
    r.addClearBurst(info.cells || [], perfectClear ? 7 : isCombo ? 6 : isDouble ? 5 : 4, this._cellSize);
    if (perfectClear) {
      r.triggerPerfectFlash();
      r.setShake(16, 720);
    } else if (isCombo) {
      r.triggerComboFlash(info.clears);
      r.triggerDoubleWave({ rows: info.rows || [], cols: info.cols || [] });
      r.addMultiClearBurst({ rows: info.rows || [], cols: info.cols || [] }, info.cells || [], info.clears, this._cellSize);
      r.setShake(11, 520);
    } else if (isDouble) {
      r.triggerDoubleWave({ rows: info.rows || [], cols: info.cols || [] });
      r.addMultiClearBurst({ rows: info.rows || [], cols: info.cols || [] }, info.cells || [], info.clears, this._cellSize);
      r.setShake(8, 400);
    } else {
      r.setShake(5, 280);
    }

    const bls = info.bonusLines || [];
    if (bls.length > 0) {
      r.triggerBonusMatchFlash(bls.length);
      r.triggerBigBlast(bls.length);
      r.addBigBlast(info.cells || [], bls, this._cellSize);
      r.setShake(perfectClear ? 20 : 14, perfectClear ? 900 : 720);
      const palette = r._skin.blockColors;
      const n = g.grid.size;
      const cs = this._cellSize;
      for (const bl of bls) {
        const css = palette[bl.colorIdx % palette.length] || '#FFD700';
        r.addBonusLineBurst(bl, css, 64, n, cs);
      }
    }
    this._audio?.feedback(this._lineFeedbackType({ perfectClear, bonusCount: bls.length, clears: info.clears }));
    const madeNewBest = this._maybeCelebrateNewBest(info.score || g.score || 0);
    this._showFloatScore(info.gain, {
      linesCleared: info.clears,
      bonusCount: bls.length,
      newBest: madeNewBest,
      perfectClear,
    });

    const baseDuration = perfectClear ? 1250 : bls.length > 0 ? 1120 : isCombo ? 860 : isDouble ? 680 : 500;
    this._scheduleClearCellRestore(Math.min(baseDuration, 680));
    const bonusHold = bls.length > 0 ? bonusEffectHoldMs(bls.length) : 0;
    const maxMs = Math.max(bls.length > 0 ? Math.max(baseDuration, bonusHold) : baseDuration, madeNewBest ? 1800 : 0);
    this._gameOverQuietUntil = Math.max(this._gameOverQuietUntil || 0, Date.now() + maxMs + 450);
    this._startParticleLoop(maxMs);
  },

  _scheduleClearCellRestore(ms) {
    if (this._clearCellsTimer) {
      clearTimeout(this._clearCellsTimer);
      this._clearCellsTimer = null;
    }
    this._clearCellsTimer = setTimeout(() => {
      if (this._renderer) {
        this._renderer.setClearCells([]);
        this._redraw();
      }
      this._clearCellsTimer = null;
    }, Math.max(180, ms || 500));
  },

  _onGameOver(info) {
    const bestKey = `openblock_best_${this._strategyId}`;
    const prev = Number(storage.getItem(bestKey) || 0) || 0;
    const next = Math.max(prev, info.score || 0);
    if (next > prev) {
      storage.setItem(bestKey, String(next));
    }
    this._scheduleGameOverFeedback();
    this._bestScore = next;
    this.setData({
      bestScore: next,
      scoreText: t('finalScore', { n: info.score || 0 }),
      clearsText: t('finalClears', { n: info.clears || 0 }),
    });
  },

  _scheduleGameOverFeedback() {
    if (this._gameOverAudioTimer) {
      clearTimeout(this._gameOverAudioTimer);
      this._gameOverAudioTimer = null;
    }
    const delay = Math.max(0, (this._gameOverQuietUntil || 0) - Date.now());
    this._gameOverAudioTimer = setTimeout(() => {
      this._gameOverAudioTimer = null;
      this._audio?.feedback('gameOver', { force: true });
    }, delay);
  },

  _stopParticleLoop() {
    if (this._canvas && this._particleRafId != null) {
      this._canvas.cancelAnimationFrame(this._particleRafId);
      this._particleRafId = null;
    }
  },

  /** @param {number} maxMs 最长驱动时长，粒子提前散尽则提前结束 */
  _startParticleLoop(maxMs) {
    if (!this._canvas || !this._renderer) return;
    this._stopParticleLoop();
    const t0 = Date.now();
    const step = () => {
      this._renderer.updateShake();
      this._renderer.updateParticles();
      this._renderer.decayAllFx();
      this._redraw();
      const elapsed = Date.now() - t0;
      if (elapsed >= maxMs) {
        this._renderer.setClearCells([]);
      }
      const cont = this._renderer.hasActiveFx() && elapsed < maxMs + 700 && elapsed < 3200;
      if (cont) {
        this._particleRafId = this._canvas.requestAnimationFrame(step);
      } else {
        this._renderer.clearParticles();
        this._renderer.setClearCells([]);
        this._redraw();
        this._particleRafId = null;
      }
    };
    this._particleRafId = this._canvas.requestAnimationFrame(step);
  },

  _redraw() {
    if (!this._renderer || !this._controller) return;
    const r = this._renderer;
    const g = this._controller;
    let ghostBlock = null;
    let draggingBlock = null;
    let previewCells = [];

    if (this._dragging && this._dragGx >= 0 && this._dragGy >= 0) {
      const b = g.dock[this._dragBlockIdx];
      draggingBlock = b && !b.placed ? b : null;
      if (b && !b.placed && g.grid.canPlace(b.shape, this._dragGx, this._dragGy)) {
        const preview = g.grid.previewClearOutcome(b.shape, this._dragGx, this._dragGy, b.colorIdx);
        previewCells = preview && preview.cells.length ? preview.cells : [];
        ghostBlock = b;
      }
    }
    r.setPreviewClearCells(previewCells);
    r.drawGridWithEffects(g.grid, this._cellSize, 0, 0);
    if (draggingBlock) {
      r.drawGhostTrail(draggingBlock.shape, this._dragTrail, this._cellSize, 0, 0, draggingBlock.colorIdx);
    }
    if (ghostBlock) {
      r.drawGhost(ghostBlock.shape, this._dragGx, this._dragGy, this._cellSize, 0, 0, ghostBlock.colorIdx);
    }
  },

  _drawDockBlocks() {
    if (!this._controller) return;
    this.setData({ dock: this._dockViewData(this._controller.dock) }, () => {
      this._drawDockCanvases();
    });
  },

  _drawDockCanvases() {
    if (!this._controller) return;
    const screen = getScreenSize();
    const dpr = screen.dpr;
    this._controller.dock.forEach((block, i) => {
      if (!block || block.placed) return;
      const cell = this._dockCellSize;
      const bounds = this._shapeBounds(block.shape);
      const w = cell * 5;
      const h = cell * 5;
      const query = this.createSelectorQuery();
      query.select(`#dock-canvas-${i}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const c = res[0].node;
          c.width = w * dpr;
          c.height = h * dpr;
          const ctx = c.getContext('2d');
          if (!ctx) return;
          ctx.scale(dpr, dpr);
          const renderer = new GameRenderer(c, dpr);
          renderer._ctx = ctx;
          renderer.setSkin(this._skin || getActiveSkin());
          const ox = Math.floor((w - bounds.cols * cell) / 2);
          const oy = Math.floor((h - bounds.rows * cell) / 2);
          renderer.drawDockBlock(block.shape, block.colorIdx, ox, oy, cell);
        });
    });
  },

  // --- 棋盘 touch（备用：直接点击棋盘放置） ---
  onGridTouchStart(_e) {},
  onGridTouchMove(e) {
    if (!this._dragging) return;
    this._updateDragPositionFromEvent(e);
  },
  onGridTouchEnd(e) {
    if (!this._dragging || this._dragBlockIdx < 0) return;
    this._finishDrag(e);
  },

  // --- Dock touch（拖拽放置） ---
  onDockTouchStart(e) {
    if (!this._controller) return;
    const idx = Number(e.currentTarget.dataset.idx);
    const b = this._controller.dock[idx];
    if (!b || b.placed) return;
    this._audio?.play('tick');
    this._refreshGridRect();

    // 上一次失败落子触发的 preview 抖动若仍在播放 → 立刻取消，由本次拖拽接管
    if (this._previewRejectTimer) {
      clearTimeout(this._previewRejectTimer);
      this._previewRejectTimer = null;
    }
    if (this.data.dragPreviewRejected) {
      this.setData({ dragPreviewRejected: false });
    }

    this._dragging = true;
    this._dragBlockIdx = idx;
    this._dragGx = -1;
    this._dragGy = -1;
    this._dragTrail = [];
    const touch = this._touchPoint(e);
    this._dragStartTouch = touch ? { x: touch.clientX, y: touch.clientY } : null;
    this._dragLastTouch = this._dragStartTouch ? { ...this._dragStartTouch, t: Date.now() } : null;
    /* v1.46 起手 boost：抓起候选块时给 preview 一次性向上偏移，
     * 把"dock→盘面下缘"这段固定物理距离免掉。 */
    const initialBoostY = -1 * (TOUCH_DRAG_BOOST_CELLS || 0) * (this._cellSize || 0);
    this._dragExtraOffset = { x: 0, y: initialBoostY };
    this._updateDragPreviewFromEvent(e, b);
    this.setData({
      dragIdx: idx,
      dock: this._dockViewData(this._controller.dock, idx),
    }, () => {
      this._drawDockCanvases();
    });
  },

  onDockTouchMove(e) {
    if (!this._dragging) return;
    this._updateDragPositionFromEvent(e);
  },

  onDockTouchEnd(e) {
    if (!this._dragging) return;
    this._finishDrag(e);
  },

  _finishDrag(e) {
    /* 释放时使用更宽 snap 半径（PLACE_RELEASE_SNAP_RADIUS = 3 vs hover 时 2），
     * 让"差一点点"的释放也能放成功——只要用户表达了"我要放在这附近"，就尽量挽救。 */
    const placedPos = this._smartPlacementFromEvent(e, PLACE_RELEASE_SNAP_RADIUS);
    const idx = this._dragBlockIdx;

    this._dragging = false;
    this._dragBlockIdx = -1;
    this._dragGx = -1;
    this._dragGy = -1;
    this._dragTrail = [];
    this._dragStartTouch = null;
    this._dragLastTouch = null;
    this._dragExtraOffset = null;

    if (placedPos) {
      /* 成功：立即收掉 preview，让消行 / 落子动效成为视觉焦点。
       * audio.feedback('place') 始终调用——之前只在非消行时调，导致消行时少了"咬合"反馈；
       * audio 内部 priority 节流会保证 'place' 不会与同帧的 'clear' 双响（'clear' 优先）。 */
      this._hideDragPreview();
      this._audio?.feedback('place');
      this._controller.place(idx, placedPos.x, placedPos.y);
      this.setData({
        dragIdx: -1,
        dock: this._dockViewData(this._controller.dock, -1),
      }, () => {
        this._drawDockCanvases();
      });
      this._redraw();
    } else {
      /* 失败：preview 在原位"抖动 + 红光淡出"，配 tick 音 + 'select' 触感作为负反馈
       * —— 让玩家立刻明白"刚刚那个位置不行"，而不是疑惑游戏出 bug 了。 */
      this._audio?.play('tick', { force: true });
      this._audio?.vibrate('select');
      if (this._previewRejectTimer) clearTimeout(this._previewRejectTimer);
      this.setData({ dragPreviewRejected: true });
      this._previewRejectTimer = setTimeout(() => {
        this._previewRejectTimer = null;
        if (this._dragging) return;   // 抖动期间用户已开始下一次拖拽 → 由 onDockTouchStart 接管
        this._hideDragPreview();
        this.setData({ dragPreviewRejected: false });
      }, REJECT_ANIM_MS);
      this.setData({
        dragIdx: -1,
        dock: this._dockViewData(this._controller.dock, -1),
      }, () => {
        this._drawDockCanvases();
      });
      this._redraw();
    }
  },

  _lineFeedbackType({ perfectClear = false, bonusCount = 0, clears = 0 } = {}) {
    if (perfectClear) return 'perfect';
    if (bonusCount > 0) return 'bonus';
    if (clears >= 3) return 'combo';
    if (clears === 2) return 'multi';
    return 'clear';
  },

  _updateDragPositionFromEvent(e) {
    const placedPos = this._smartPlacementFromEvent(e);
    const gx = placedPos ? placedPos.x : -1;
    const gy = placedPos ? placedPos.y : -1;
    const block = this._controller?.dock?.[this._dragBlockIdx];
    if (block && !block.placed) this._updateDragPreviewFromEvent(e, block);

    const changed = gx !== this._dragGx || gy !== this._dragGy;
    this._dragGx = gx;
    this._dragGy = gy;
    if (placedPos) this._appendDragTrail(placedPos);
    if (changed) this._redraw();
  },

  _appendDragTrail(pos) {
    const last = this._dragTrail[this._dragTrail.length - 1];
    if (last && last.x === pos.x && last.y === pos.y) return;
    this._dragTrail.push({ x: pos.x, y: pos.y });
    if (this._dragTrail.length > 8) this._dragTrail.shift();
  },

  _hideDragPreview() {
    this.setData({
      dragPreviewVisible: false,
      dragPreviewStyle: '',
    });
  },

  _updateDragPreviewFromEvent(e, block) {
    const touch = this._touchControlPoint(e, block);
    if (!touch || !block || !this._cellSize) return;
    const bounds = this._shapeBounds(block.shape);
    const w = bounds.cols * this._cellSize;
    const h = bounds.rows * this._cellSize;
    if (!w || !h) return;
    const left = Math.round(touch.clientX - w / 2);
    const top = Math.round(touch.clientY - h / 2);
    const style = `width:${w}px;height:${h}px;transform:translate(${left}px,${top}px);`;
    this.setData({
      dragPreviewVisible: true,
      dragPreviewStyle: style,
    }, () => {
      this._drawDragPreviewCanvas(block, w, h);
    });
  },

  _drawDragPreviewCanvas(block, w, h) {
    const query = this.createSelectorQuery();
    query.select('#drag-preview-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node || !block || block.placed) return;
        const screen = getScreenSize();
        const dpr = screen.dpr;
        const c = res[0].node;
        c.width = w * dpr;
        c.height = h * dpr;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.scale(dpr, dpr);
        const renderer = new GameRenderer(c, dpr);
        renderer._ctx = ctx;
        renderer.setSkin(this._skin || getActiveSkin());
        renderer.drawDockBlock(block.shape, block.colorIdx, 0, 0, this._cellSize);
      });
  },

  _smartPlacementFromEvent(e, snapRadius = PLACE_HOVER_SNAP_RADIUS) {
    if (!this._controller || this._dragBlockIdx < 0) return null;
    const block = this._controller.dock[this._dragBlockIdx];
    const touch = this._touchControlPoint(e, block);
    const rect = this._gridRect;
    if (!block || !touch || !rect || !this._cellSize) return null;

    const relX = touch.clientX - rect.left;
    const relY = touch.clientY - rect.top;
    const pad = this._cellSize;
    const overBoard = relX >= -pad && relY >= -pad
      && relX <= rect.width + pad && relY <= rect.height + pad;
    if (!overBoard) return null;

    const aimCx = relX / this._cellSize;
    const aimCy = relY / this._cellSize;
    const anchor = this._naiveAnchorFromAim(block.shape, aimCx, aimCy);
    return this._controller.grid.pickNearestLocalPlacement(
      block.shape,
      aimCx,
      aimCy,
      anchor.anchorX,
      anchor.anchorY,
      snapRadius
    );
  },

  _naiveAnchorFromAim(shape, aimCx, aimCy) {
    const gridXi = Math.floor(aimCx);
    const gridYi = Math.floor(aimCy);
    const w = shape[0].length;
    const h = shape.length;
    return {
      anchorX: gridXi - Math.floor(w / 2),
      anchorY: gridYi - Math.floor(h / 2),
    };
  },

  _setGridRect(rect, fallbackSize = this.data.canvasW) {
    if (!rect) return;
    this._gridRect = {
      left: Number.isFinite(rect.left) ? rect.left : 0,
      top: Number.isFinite(rect.top) ? rect.top : 0,
      width: Number.isFinite(rect.width) ? rect.width : fallbackSize,
      height: Number.isFinite(rect.height) ? rect.height : fallbackSize,
    };
  },

  _refreshGridRect() {
    const query = this.createSelectorQuery();
    query.select('#game-canvas').boundingClientRect((rect) => {
      if (rect) this._setGridRect(rect);
    }).exec();
  },

  onRestart() {
    this._newBestCelebrated = false;
    this._gameOverQuietUntil = 0;
    if (this._gameOverTimer) {
      clearTimeout(this._gameOverTimer);
      this._gameOverTimer = null;
    }
    if (this._gameOverAudioTimer) {
      clearTimeout(this._gameOverAudioTimer);
      this._gameOverAudioTimer = null;
    }
    if (this._clearCellsTimer) {
      clearTimeout(this._clearCellsTimer);
      this._clearCellsTimer = null;
    }
    this._controller.reset();
    this._renderer.clearParticles();
    this._renderer.setClearCells([]);
    /* 重开局：清理 score burst 基线，避免新局首次 _onStateChange 出现"老分数→0"反向计算 delta */
    this._lastDisplayedScore = null;
    if (this._scoreBurstTimer) {
      clearTimeout(this._scoreBurstTimer);
      this._scoreBurstTimer = null;
    }
    this.setData({
      floatScoreVisible: false,
      scoreBurstClass: '',
    });
    this._redraw();
    this._drawDockBlocks();
  },

  _maybeCelebrateNewBest(score) {
    if (this._newBestCelebrated) return false;
    const previousBest = this._bestScore || 0;
    if (score <= previousBest || score <= 0) return false;

    this._newBestCelebrated = true;
    this._bestScore = score;
    this.setData({
      bestScore: score,
      bestGap: 0,
      bestGapVisible: false,
    });
    if (this._renderer) {
      this._renderer.triggerBonusMatchFlash(3);
      this._renderer.triggerPerfectFlash();
      this._renderer.setShake(18, 900);
    }
    return true;
  },

  _showFloatScore(score, { linesCleared = 0, bonusCount = 0, newBest = false, perfectClear = false } = {}) {
    const tags = [];
    if (newBest) tags.push(t('effectNewRecord'));
    if (perfectClear) tags.push(`${t('effectPerfectClear')} ×${PERFECT_CLEAR_MULT}`);
    else if (linesCleared >= 3) tags.push(t('effectMultiClear', { n: linesCleared }));
    else if (linesCleared === 2) tags.push(t('effectDoubleClear'));
    if (bonusCount > 0) tags.push(`${t('effectIconBonus')} ×${bonusCount}`);
    const suffix = tags.length ? ` (${tags.join(' · ')})` : '';
    const cls = newBest ? 'float-score--new-best' : perfectClear || linesCleared >= 3 ? 'float-score--combo' : bonusCount > 0 ? 'float-score--bonus' : '';
    this.setData({
      floatScoreVisible: true,
      floatScoreText: newBest ? `${t('effectNewRecord')} +${score}${suffix}` : `+${score}${suffix}`,
      floatScoreClass: cls,
    });
    if (this._floatScoreTimer) clearTimeout(this._floatScoreTimer);
    this._floatScoreTimer = setTimeout(() => {
      this.setData({ floatScoreVisible: false });
      this._floatScoreTimer = null;
    }, newBest ? 1800 : 900);
  },
});
