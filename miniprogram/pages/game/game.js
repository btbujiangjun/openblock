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
const { getActiveSkin, setActiveSkinId, getSkinAccent } = require('../../core/skins');
const { setLanguage, t } = require('../../core/i18n');
const { createAudioFx } = require('../../utils/audioFx');
const { createFeedbackToggles } = require('../../utils/feedbackToggles');
/* v1.60.46：HUD 等级 + 称号 与 web 字标对齐——progression 共用同一
 * localStorage key（'openblock_progression_v1'），跨端 / 跨设备同步天然一致。 */
const { loadProgress, getLevelProgress, titleForLevel, applyGameEndProgression } = require('../../core/progression');

/* v1.46 触屏速度感知曲线（与 web/src/config.js 对齐，参考桌面 OS pointer ballistics）：
 *   speed ≤ TOUCH_DRAG_SPEED_SLOW (px/ms) → TOUCH_DRAG_GAIN_MIN（1.6，对位精准不抢跑）
 *   speed ≥ TOUCH_DRAG_SPEED_FAST (px/ms) → TOUCH_DRAG_GAIN（2.8，快速一甩到对岸省力）
 *   中间段线性插值
 *
 * 旧的恒定 1.12 增益太弱，玩家从 dock 拖到盘面对岸要走完整物理距离；调高就毁掉
 * 对位手感。速度感知曲线把"精准 / 省力"两个目标解耦，再叠加 startBoost 与
 * 累计偏移上限上调，让小幅手势即可完成落子。 */
const TOUCH_DRAG_GAIN = 2.8;
const TOUCH_DRAG_GAIN_MIN = 1.6;
const TOUCH_DRAG_SPEED_SLOW_PX_MS = 0.10;
const TOUCH_DRAG_SPEED_FAST_PX_MS = 0.80;
const TOUCH_DRAG_GAIN_MAX_OFFSET_CELLS = 12.0;
/* 触屏起手 boost：抓起候选块时给 preview 一次性向上偏移 N 格，把"dock→盘面下缘"
 * 这段固定物理距离免掉。0 = 关闭。 */
const TOUCH_DRAG_BOOST_CELLS = 1.4;
const TOUCH_DRAG_LIFT_GAP_CELLS = 0.35;
const TOUCH_DRAG_LIFT_MAX_CELLS = 2.4;
/* 悬停（移动中）snap 半径：保守，避免 preview 跳到太远的"全局好点" */
const PLACE_HOVER_SNAP_RADIUS = 2;
/* 释放容错半径（曼哈顿格）：允许 2 格内微调，进一步减少「明明拖到了目标格却释放失败」的
 * 边界抖动 miss；曼哈顿距离权重避免对角"窜两格"。
 * 与 web `CONFIG.PLACE_RELEASE_SNAP_RADIUS` / cocos `SNAP.placeReleaseRadius` 同名同值。 */
const PLACE_RELEASE_SNAP_RADIUS = 2;
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
    /* v1.60.46：HUD 等级/称号/连续日（与 web .header-level 同字段语义） */
    level: 1,
    levelTitle: '新手',
    streakText: '',
    streakVisible: false,
    /* v1.60.47：本局是否破 PB——game-over 卡片顶部展示 🏆 + "新纪录" 副标题 */
    isNewBest: false,
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
  _floodRafId: null,
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
    this._audio.setSkinTheme?.(this._skin?.id);
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
    /* v1.60.46：onLoad 立即渲染 HUD 等级 / 称号，避免首屏一段时间显示默认 "Lv.1 新手" */
    this._refreshProgressionHud();
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
    this._audio.setHaptic?.(next);
    this.setData({ audioOn: next });
    if (next) {
      this._audio.warmup(['tick', 'place', 'clear', 'unlock']);
      this._audio.play('tick');
    }
  },

  _refreshText() {
    this.setData({
      text: {
        score: t('score'),
        steps: t('steps'),
        clears: t('clears'),
        best: t('best'),
        /* v1.60.46：与 web ui.stat.ability 同 key 语义；i18n 缺该 key 时回退中文 */
        ability: t('ability') || '能力',
        gameOver: t('gameOver'),
        /* v1.60.47：破 PB 副标题（与 web effect.newRecord 同语义） */
        newRecord: t('newRecord') || '新纪录',
        restart: t('restart'),
        audioOn: t('audioOn'),
        audioOff: t('audioOff'),
      },
    });
  },

  /**
   * v1.60.46：刷新 HUD 等级 + 称号 + 连续日字段（与 web _updateProgressionHud 同步）。
   * 读 progression.js 持久化 totalXp → 派生 level / title；
   * dailyStreak ≥ 2 才显示"连战 N 天"副线（与 web 一致）。
   */
  _refreshProgressionHud() {
    try {
      const state = loadProgress();
      const { level } = getLevelProgress(state.totalXp);
      const title = titleForLevel(level, t);
      const streak = Math.max(0, Number(state.dailyStreak) || 0);
      const streakVisible = streak >= 2;
      this.setData({
        level,
        levelTitle: title,
        streakText: streakVisible ? `连战 ${streak} 天` : '',
        streakVisible,
      });
    } catch { /* ignore: progression 缺失不阻断 HUD */ }
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
      pageStyle: (() => {
        const accent = getSkinAccent((this._skin || getActiveSkin()).id);
        return `padding-left:${pagePad}px;padding-right:${pagePad}px;--accent:${accent};`;
      })(),
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
      const colorSpecs = [];
      for (const bl of bls) {
        const css = palette[bl.colorIdx % palette.length] || '#FFD700';
        r.addBonusLineBurst(bl, css, 64, n, cs);
        colorSpecs.push({ bonusLine: bl, cssColor: css });
      }
      // 严格对齐 web 主端 playClearEffect：除一次性色块爆发外，还要叠加按
      // 时间窗节奏持续涌出的 strongBurst 色块层（首帧 42/条），与 icon 喷涌同期，
      // 构成"同花顺三层喷涌"的绚丽感。缺此层 cocos/miniprogram 整体氛围会明显落差。
      r.beginBonusColorGush(colorSpecs, bonusEffectHoldMs(bls.length), n, cs);
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
    const score = Number(info.score) || 0;
    const next = Math.max(prev, score);
    /* v1.60.47：破 PB 判定——严格大于（等于不算）+ 至少 ≥ 50 分（避免 0 分误触发）。
     * 数据依据：与 web Game._showNewBestCelebration 同口径（score > previousBest + EPS）。
     * isNewBest 用于驱动 game-over 卡片顶部 🏆 + "新纪录" 副标题 + 金色描边光晕。 */
    const isNewBest = score > prev && score >= 50;
    if (next > prev) {
      storage.setItem(bestKey, String(next));
    }
    this._startBoardFlood();
    this._scheduleGameOverFeedback();
    this._bestScore = next;
    this.setData({
      bestScore: next,
      scoreText: t('finalScore', { n: score }),
      clearsText: t('finalClears', { n: info.clears || 0 }),
      isNewBest,
    });
    /* v1.60.46：局末累加 progression XP + 刷新 HUD 等级 / 称号
     * （与 web Game.endGame 同步：xp = base*mul + firstOfDayBonus + streakBonus + runBonus）。
     * 失败兜底：不阻断 game-over 流程，仅放弃本次更新。 */
    try {
      applyGameEndProgression({
        score: info.score || 0,
        gameStats: { clears: info.clears || 0, maxLinesCleared: info.maxCombo || 0 },
        strategy: this._strategyId,
        runStreak: 0,
      });
      this._refreshProgressionHud();
    } catch { /* ignore */ }
  },

  _startBoardFlood() {
    const g = this._controller;
    const r = this._renderer;
    if (!g || !g.grid || !r || !this._canvas) return;
    const n = g.grid.size;
    const skin = this._skin || r._skin;
    const palette = skin?.blockColors || [];
    const colorCount = palette.length || 8;
    const cs = this._cellSize;

    const fillDir = ['up', 'down', 'right', 'left'][Math.floor(Math.random() * 4)];
    const fillVertical = fillDir === 'up' || fillDir === 'down';
    const fillLines = [];
    for (let i = 0; i < n; i++) fillLines.push(i);
    if (fillDir === 'up' || fillDir === 'left') fillLines.reverse();

    const rows = [];
    for (const line of fillLines) {
      const row = [];
      for (let k = 0; k < n; k++) {
        const gx = fillVertical ? k : line;
        const gy = fillVertical ? line : k;
        if (g.grid.cells[gy][gx] === null) {
          row.push({ gx, gy, colorIdx: Math.floor(Math.random() * colorCount), jit: Math.random(), jit2: Math.random() });
        }
      }
      if (row.length) {
        let dist;
        if (fillDir === 'up') dist = n - 1 - line;
        else if (fillDir === 'down') dist = line;
        else if (fillDir === 'right') dist = line;
        else dist = n - 1 - line;
        rows.push({ cells: row, offset: dist + 4, startTime: 0, done: false });
      }
    }
    if (!rows.length) return;

    const SLIDE_MS = 500;
    const ROW_DELAY = Math.min(140, 3000 / Math.max(rows.length, 1));
    // 填满 + 翻转波(~2000) + 竹简飞散(~1600) 的总时长，确保 gameOver 音效在整段动效后再响。
    const totalMs = rows.length * ROW_DELAY + SLIDE_MS + 4100;
    this._gameOverQuietUntil = Math.max(this._gameOverQuietUntil || 0, Date.now() + totalMs);

    const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
    const gold = '#FFD700';
    const t0 = Date.now();
    let rowIdx = 0;
    let lastRowTime = t0;
    let doneCount = 0;

    const tick = () => {
      const now = Date.now();
      const elapsed = now - t0;
      r.clear();

      if (rowIdx < rows.length && now - lastRowTime >= ROW_DELAY) {
        const row = rows[rowIdx];
        row.startTime = now;
        rowIdx++;
        lastRowTime = now;
      }

      for (let ri = 0; ri < rowIdx; ri++) {
        const row = rows[ri];
        if (row.done) continue;
        const t = (now - row.startTime) / SLIDE_MS;
        if (t >= 1 && !row.done) {
          row.done = true;
          doneCount++;
          for (const c of row.cells) {
            g.grid.cells[c.gy][c.gx] = c.colorIdx;
          }
          for (const c of row.cells) {
            const cx = c.gx * cs + cs / 2;
            const cy = c.gy * cs + cs / 2;
            const color = palette[c.colorIdx % palette.length] || gold;
            for (let j = 0; j < 3; j++) {
              const ang = Math.random() * Math.PI * 2;
              const sp = 1.5 + Math.random() * 3;
              r.particles.push({
                x: cx, y: cy,
                vx: Math.cos(ang) * sp,
                vy: Math.sin(ang) * sp - 2,
                color: j === 0 ? gold : color,
                life: 0.4 + Math.random() * 0.2,
                lifeDecay: 0.028,
                size: 1.5 + Math.random() * 2,
                gravityMul: 0.3,
              });
            }
          }
        }
      }

      const fctx = r._ctx || r.ctx;
      for (let ri = 0; ri < rowIdx; ri++) {
        const row = rows[ri];
        if (row.done) continue;
        const remaining = 1 - easeOutCubic((now - row.startTime) / SLIDE_MS);
        const slide = row.offset * remaining * cs;
        for (const c of row.cells) {
          const color = palette[c.colorIdx % palette.length] || gold;
          // 每格独立抖动 → 落入错落有致；顺向 lag 让同行/列参差不齐，随 remaining 衰减落定归零。
          const jLag = c.jit * cs * 2.2 * remaining;
          const jPerp = (c.jit2 - 0.5) * cs * 1.4 * remaining;
          let x = c.gx * cs;
          let y = c.gy * cs;
          if (fillDir === 'up') { y += slide + jLag; x += jPerp; }
          else if (fillDir === 'down') { y -= slide + jLag; x += jPerp; }
          else if (fillDir === 'right') { x -= slide + jLag; y += jPerp; }
          else { x += slide + jLag; y += jPerp; }

          // 风吹飘动 + 适度扭曲：横向摆动 + 顺向拉伸/侧向挤压（每格振幅/相位各异）
          const phase = now * 0.011 + (c.gx + c.gy) * 0.8 + c.jit2 * 6.283;
          const windAmp = cs * (0.5 + 0.8 * c.jit) * remaining;
          const sway = windAmp * Math.sin(phase);
          if (fillVertical) x += sway; else y += sway;
          const rot = (0.14 + 0.18 * c.jit) * remaining * Math.sin(phase + 0.6);
          const sAlong = 1 + (0.14 + 0.18 * c.jit) * remaining;
          const sPerp = 1 - 0.12 * remaining;
          const sx = fillVertical ? sPerp : sAlong;
          const sy = fillVertical ? sAlong : sPerp;

          const cxp = x + cs / 2;
          const cyp = y + cs / 2;
          fctx.save();
          fctx.translate(cxp, cyp);
          fctx.rotate(rot);
          fctx.scale(sx, sy);
          fctx.translate(-cxp, -cyp);
          r._paintCell(x, y, cs, color);
          fctx.restore();
        }
      }

      r.drawGrid(g.grid, cs, 0, 0);

      r.updateShake();
      r.updateParticles();
      r.renderParticles();

      const allDone = rowIdx >= rows.length && doneCount >= rows.length;
      if (!allDone) {
        this._floodRafId = this._canvas.requestAnimationFrame(tick);
      } else {
        this._floodRafId = null;
        this._startRowFlipWave(g, r, n, cs, palette);
      }
    };
    this._floodRafId = this._canvas.requestAnimationFrame(tick);
  },

  _startRowFlipWave(g, r, n, cs, palette) {
    const TOTAL_MS = 2000;
    const FLIP_MS = 300;
    const STAGGER = Math.min(180, (TOTAL_MS - FLIP_MS) / Math.max(n - 1, 1));
    const flipStart = Date.now();

    // 翻转方向随机：down=下翻 / up=上翻（绕水平轴，scaleY）；right=右翻 / left=左翻（绕竖直轴，scaleX）
    const flipDir = ['down', 'up', 'right', 'left'][Math.floor(Math.random() * 4)];
    const flipVertical = flipDir === 'down' || flipDir === 'up';
    const orderPos = (lineIdx) => {
      if (flipDir === 'down' || flipDir === 'right') return lineIdx;
      return n - 1 - lineIdx;
    };

    const newColors = [];
    for (let gy = 0; gy < n; gy++) {
      const row = [];
      for (let gx = 0; gx < n; gx++) {
        const cur = g.grid.cells[gy][gx];
        if (cur === null) { row.push(null); continue; }
        let nc;
        do { nc = Math.floor(Math.random() * palette.length); } while (nc === cur && palette.length > 1);
        row.push(nc);
      }
      newColors.push(row);
    }

    const committed = new Array(n).fill(false);

    const flipTick = () => {
      const elapsed = Date.now() - flipStart;
      r.clear();

      const ctx = r._ctx || r.ctx;
      for (let lineIdx = 0; lineIdx < n; lineIdx++) {
        const k = orderPos(lineIdx);
        const t = Math.max(0, Math.min(1, (elapsed - k * STAGGER) / FLIP_MS));

        if (t >= 1 && !committed[lineIdx]) {
          committed[lineIdx] = true;
          for (let m = 0; m < n; m++) {
            const gx = flipVertical ? m : lineIdx;
            const gy = flipVertical ? lineIdx : m;
            if (newColors[gy][gx] !== null) {
              g.grid.cells[gy][gx] = newColors[gy][gx];
            }
          }
        }

        const scale = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2;

        for (let m = 0; m < n; m++) {
          const gx = flipVertical ? m : lineIdx;
          const gy = flipVertical ? lineIdx : m;
          const v = g.grid.cells[gy][gx];
          if (v === null) continue;
          const color = palette[v % palette.length];
          if (!color) continue;
          const cx = gx * cs + cs / 2;
          const cy = gy * cs + cs / 2;
          ctx.save();
          ctx.translate(cx, cy);
          if (flipVertical) ctx.scale(1, scale);
          else ctx.scale(scale, 1);
          ctx.translate(-cx, -cy);
          r._paintCell(gx * cs, gy * cs, cs, color);
          ctx.restore();
        }
      }

      r.updateParticles();
      r.renderParticles();

      const allFlipped = elapsed >= (n - 1) * STAGGER + FLIP_MS;
      if (!allFlipped) {
        this._floodRafId = this._canvas.requestAnimationFrame(flipTick);
      } else {
        this._floodRafId = null;
        this._startBoardFlyOut(g, r, n, cs, palette);
      }
    };
    this._floodRafId = this._canvas.requestAnimationFrame(flipTick);
  },

  /**
   * 竹简飞散（收尾）：翻转完成后整盘以「竹帘脱钩坠落」方式飞出 ——
   * 每列当作一条竹简，逐列错峰释放，绕顶端钟摆摇摆（曲线变形），越靠下摆幅越大，
   * 整体受重力加速下坠 + 远端透视压缩 + 渐隐，结束后盘面清空。
   */
  _startBoardFlyOut(g, r, n, cs, palette) {
    const FLYOUT_MS = 1600;
    const boardPx = n * cs;
    const N = Math.max(n - 1, 1);
    const start = Date.now();
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const ctx = r._ctx || r.ctx;

    // 每格独立随机种子 → 脱钩时刻/下坠速度/淡出时机各异，飞散错落有致（飞出无需收敛）
    const jitA = [];
    const jitB = [];
    for (let gy = 0; gy < n; gy++) {
      const ra = [];
      const rb = [];
      for (let gx = 0; gx < n; gx++) { ra.push(Math.random()); rb.push(Math.random()); }
      jitA.push(ra); jitB.push(rb);
    }

    const tick = () => {
      const t = clamp01((Date.now() - start) / FLYOUT_MS);
      r.clear();

      for (let gx = 0; gx < n; gx++) {
        const colNorm = gx / N;
        const lt = clamp01((t - colNorm * 0.22) / 0.78);
        const ang = 0.5 * Math.sin(lt * Math.PI * 1.6 + colNorm * Math.PI) * (0.35 + 0.65 * lt);
        const driftX = cs * 1.4 * Math.sin(colNorm * Math.PI * 2 - t * 3) * lt;
        const sinA = Math.sin(ang);
        const cosA = Math.cos(ang);
        const pivotX = gx * cs + cs / 2;
        const sX = Math.max(0.3, 1 - 0.3 * lt);

        for (let gy = 0; gy < n; gy++) {
          const v = g.grid.cells[gy][gx];
          if (v === null) continue;
          const color = palette[v % palette.length];
          if (!color) continue;
          const jA = jitA[gy][gx];
          const jB = jitB[gy][gx];
          const rowNorm = gy / N;
          const len = gy * cs + cs / 2;
          // 每格独立脱钩时刻 → 同列方块参差散开
          const ltc = clamp01((t - colNorm * 0.22 - jA * 0.14) / 0.78);
          const lttc = ltc * ltc;
          const grav = (1 + 1.4 * lttc * rowNorm) * (0.85 + 0.3 * jB);
          const wave = cs * 1.7 * Math.sin(rowNorm * 4.5 - t * 11 + colNorm * 1.2 + jB * 3) * (0.15 + 0.85 * rowNorm) * ltc;
          const dropY = boardPx * (3.4 * lttc + 1.8 * ltc * lttc) * (0.8 + 0.4 * jA);
          const cx = pivotX + driftX - len * sinA + wave;
          const cy = dropY + len * cosA * grav;
          const sY = Math.max(0.2, 1 - 0.7 * ltc * rowNorm);
          const alpha = clamp01(1 - (ltc - (0.5 + jB * 0.2)) / 0.4);
          if (alpha <= 0.02) continue;
          const baseCx = gx * cs + cs / 2;
          const baseCy = gy * cs + cs / 2;

          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(cx, cy);
          ctx.rotate(ang);
          ctx.scale(sX, sY);
          ctx.translate(-baseCx, -baseCy);
          r._paintCell(gx * cs, gy * cs, cs, color);
          ctx.restore();
        }
      }

      r.updateParticles();
      r.renderParticles();

      if (t < 1) {
        this._floodRafId = this._canvas.requestAnimationFrame(tick);
      } else {
        this._floodRafId = null;
        r.clear();
        const empty = { size: n, cells: Array.from({ length: n }, () => new Array(n).fill(null)) };
        try { r.drawGrid(empty, cs, 0, 0); } catch { /* ignore */ }
      }
    };
    this._floodRafId = this._canvas.requestAnimationFrame(tick);
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
    if (this._canvas && this._floodRafId != null) {
      this._canvas.cancelAnimationFrame(this._floodRafId);
      this._floodRafId = null;
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
    const placedPos = this._previewClearPlacement() || this._smartPlacementFromEvent(e, PLACE_RELEASE_SNAP_RADIUS);
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
      /* 失败：立即收掉 preview 并恢复候选槽，避免 ghost 停在非法盘面位置造成"像是放上去了"的误读。 */
      this._audio?.play('tick', { force: true });
      this._audio?.vibrate('select');
      if (this._previewRejectTimer) clearTimeout(this._previewRejectTimer);
      this._previewRejectTimer = null;
      this._hideDragPreview();
      this.setData({
        dragIdx: -1,
        dock: this._dockViewData(this._controller.dock, -1),
      }, () => {
        this._drawDockCanvases();
      });
      this._redraw();
    }
  },

  _previewClearPlacement() {
    if (!this._controller || !this._dragging || this._dragBlockIdx < 0) return null;
    if (this._dragGx < 0 || this._dragGy < 0) return null;
    const block = this._controller.dock[this._dragBlockIdx];
    if (!block || block.placed) return null;
    if (!this._controller.grid.canPlace(block.shape, this._dragGx, this._dragGy)) return null;
    const preview = this._controller.grid.previewClearOutcome(block.shape, this._dragGx, this._dragGy, block.colorIdx);
    return preview?.cells?.length ? { x: this._dragGx, y: this._dragGy } : null;
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
    if (this._floodRafId != null && this._canvas) {
      this._canvas.cancelAnimationFrame(this._floodRafId);
      this._floodRafId = null;
    }
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
      /* v1.60.47：重开局清掉破 PB 标志，避免新局开局 game-over 卡片瞬间金边 */
      isNewBest: false,
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
    if (perfectClear) tags.push(`${t('effectPerfectClear')} ${PERFECT_CLEAR_MULT}×`);
    else if (linesCleared >= 3) tags.push(t('effectMultiClear', { n: linesCleared }));
    else if (linesCleared === 2) tags.push(t('effectDoubleClear'));
    if (bonusCount > 0) tags.push(`${t('effectIconBonus')} ${bonusCount}×`);
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
