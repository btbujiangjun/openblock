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
const { bonusEffectHoldMs } = require('../../core/bonusScoring');
const { getActiveSkin, setActiveSkinId } = require('../../core/skins');
const { getLevelById } = require('../../core/levelPack');

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
    dragIdx: -1,
    bestScore: 0,
    bestGap: 0,
    bestGapVisible: false,
    levelMode: 'endless',
    levelName: '',
    levelObjective: '',
    levelStars: 0,
    levelStarsText: '',
    overMode: 'endless',
    floatScoreVisible: false,
    floatScoreText: '',
    floatScoreClass: '',
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
  _particleRafId: null,
  _floatScoreTimer: null,

  onLoad(query) {
    const strategyId = query.strategy || 'normal';
    this._strategyId = strategyId;
    this._mode = query.mode === 'level' ? 'level' : 'endless';
    this._levelId = query.levelId || 'L01';
    if (query.skin) setActiveSkinId(query.skin);
    this._skin = getActiveSkin();
    this._levelConfig = this._mode === 'level' ? getLevelById(this._levelId) : null;
    const bestKey = `openblock_best_${strategyId}`;
    const best = Number(storage.getItem(bestKey) || 0) || 0;
    this._bestScore = best;
    this.setData({
      bestScore: best,
      levelMode: this._mode,
      levelName: this._levelConfig?.name || this._levelConfig?.title || '',
      levelObjective: '',
      levelStars: 0,
      levelStarsText: '',
      overMode: 'endless',
    });
  },

  onUnload() {
    this._stopParticleLoop();
    if (this._floatScoreTimer) {
      clearTimeout(this._floatScoreTimer);
      this._floatScoreTimer = null;
    }
  },

  onReady() {
    this._initCanvas();
  },

  _initCanvas() {
    const screen = getScreenSize();
    const padding = 16;
    const gridN = 8;
    const maxGridWidth = screen.width - padding * 2;
    const cellSize = Math.floor(maxGridWidth / gridN);
    const gridPx = cellSize * gridN;

    this._cellSize = cellSize;
    this._gridOffset = { x: 0, y: 0 };

    this.setData({
      canvasW: gridPx,
      canvasH: gridPx,
      dockSlotSize: Math.floor(cellSize * 2.5),
    });

    const query = this.createSelectorQuery();
    query.select('#game-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          console.error('Canvas 节点获取失败');
          return;
        }
        const canvas = res[0].node;
        const dpr = screen.dpr;

        canvas.width = gridPx * dpr;
        canvas.height = gridPx * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        this._canvas = canvas;
        this._renderer = new GameRenderer(canvas, dpr);
        this._renderer._ctx = ctx;
        this._renderer.setSkin(this._skin || getActiveSkin());

        this._controller = new GameController(this._strategyId, {
          levelConfig: this._levelConfig,
          skin: this._skin || getActiveSkin(),
          onStateChange: (snap) => this._onStateChange(snap),
          onLineClear: (info) => this._onLineClear(info),
          onGameOver: (info) => this._onGameOver(info),
        });

        this._redraw();
        this._drawDockBlocks();
      });
  },

  _onStateChange(snap) {
    const best = this._bestScore != null ? this._bestScore : this.data.bestScore;
    const gap = Math.max(0, best - snap.score);
    this.setData({
      score: snap.score,
      steps: snap.steps,
      totalClears: snap.totalClears,
      dock: snap.dock.map((d) => ({ placed: d.placed, colorIdx: d.colorIdx })),
      gameOver: snap.gameOver,
      bestScore: best,
      bestGap: gap,
      bestGapVisible: best > 0 && gap > 0,
      levelMode: snap.levelMode || this.data.levelMode,
      levelObjective: snap.levelObjective || '',
      levelStars: snap.levelStars || 0,
      levelStarsText: (snap.levelStars || 0) > 0 ? '⭐'.repeat(Math.max(0, Math.min(3, snap.levelStars || 0))) : '',
    });
  },

  _onLineClear(info) {
    const g = this._controller;
    const r = this._renderer;
    if (!r || !g) return;
    const perfectClear = g.grid.getFillRatio() === 0;
    const isCombo = info.clears >= 3;
    const isDouble = info.clears === 2;

    r.setClearCells(info.cells || []);
    if (perfectClear) {
      r.triggerPerfectFlash();
      r.setShake(16, 720);
    } else if (isCombo) {
      r.triggerComboFlash(info.clears);
      r.setShake(11, 520);
    } else if (isDouble) {
      const rows = [...new Set((info.cells || []).map((c) => c.y))];
      r.triggerDoubleWave(rows);
      r.setShake(8, 400);
    } else {
      r.setShake(5, 280);
    }

    const bls = info.bonusLines || [];
    if (bls.length > 0) {
      r.triggerBonusMatchFlash(bls.length);
      const palette = r._skin.blockColors;
      const n = g.grid.size;
      const cs = this._cellSize;
      for (const bl of bls) {
        const css = palette[bl.colorIdx % palette.length] || '#FFD700';
        r.addBonusLineBurst(bl, css, 40, n, cs);
      }
    }
    this._showFloatScore(info.gain, info.clears, bls.length);

    const baseDuration = perfectClear ? 1050 : isCombo ? 780 : isDouble ? 620 : 500;
    const bonusHold = bls.length > 0 ? bonusEffectHoldMs(bls.length) : 0;
    const maxMs = bls.length > 0 ? Math.max(baseDuration, bonusHold) : baseDuration;
    this._startParticleLoop(maxMs);
  },

  _onGameOver(info) {
    const bestKey = `openblock_best_${this._strategyId}`;
    const prev = Number(storage.getItem(bestKey) || 0) || 0;
    const next = Math.max(prev, info.score || 0);
    if (next > prev) {
      storage.setItem(bestKey, String(next));
    }
    this._bestScore = next;
    this.setData({
      bestScore: next,
      overMode: info.mode || 'endless',
      levelStars: info.levelResult?.stars || this.data.levelStars || 0,
      levelStarsText: (info.levelResult?.stars || this.data.levelStars || 0) > 0
        ? '⭐'.repeat(Math.max(0, Math.min(3, info.levelResult?.stars || this.data.levelStars || 0)))
        : '',
      levelObjective: info.levelResult?.objective || this.data.levelObjective,
    });
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
    r.drawGridWithEffects(g.grid, this._cellSize, 0, 0);

    if (this._dragging && this._dragGx >= 0 && this._dragGy >= 0) {
      const b = g.dock[this._dragBlockIdx];
      if (b && !b.placed && g.grid.canPlace(b.shape, this._dragGx, this._dragGy)) {
        r.drawGhost(b.shape, this._dragGx, this._dragGy, this._cellSize, 0, 0);
      }
    }
  },

  _drawDockBlocks() {
    if (!this._controller) return;
    const g = this._controller;
    const slotSize = this.data.dockSlotSize;
    const screen = getScreenSize();
    const dpr = screen.dpr;

    g.dock.forEach((block, i) => {
      if (block.placed) return;
      const query = this.createSelectorQuery();
      query.select(`#dock-canvas-${i}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const c = res[0].node;
          c.width = slotSize * dpr;
          c.height = slotSize * dpr;
          const ctx = c.getContext('2d');
          ctx.scale(dpr, dpr);

          const r = new GameRenderer(c, dpr);
          r._ctx = ctx;

          const shape = block.shape;
          const rows = shape.length;
          const cols = Math.max(...shape.map((r) => r.length));
          const dockCellSize = Math.floor(slotSize / Math.max(rows, cols, 5));
          const ox = Math.floor((slotSize - cols * dockCellSize) / 2);
          const oy = Math.floor((slotSize - rows * dockCellSize) / 2);
          r.drawDockBlock(shape, block.colorIdx, ox, oy, dockCellSize);
        });
    });
  },

  // --- 棋盘 touch（备用：直接点击棋盘放置） ---
  onGridTouchStart(e) {},
  onGridTouchMove(e) {},
  onGridTouchEnd(e) {
    if (!this._dragging || this._dragBlockIdx < 0) return;
    this._finishDrag(e);
  },

  // --- Dock touch（拖拽放置） ---
  onDockTouchStart(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const b = this._controller.dock[idx];
    if (!b || b.placed) return;
    this._dragging = true;
    this._dragBlockIdx = idx;
    this._dragGx = -1;
    this._dragGy = -1;
    this.setData({ dragIdx: idx });
  },

  onDockTouchMove(e) {
    if (!this._dragging) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    // 将屏幕坐标映射到棋盘格坐标
    const query = this.createSelectorQuery();
    query.select('#game-canvas').boundingClientRect((rect) => {
      if (!rect) return;
      const lx = touch.clientX - rect.left;
      const ly = touch.clientY - rect.top;
      const gx = Math.floor(lx / this._cellSize);
      const gy = Math.floor(ly / this._cellSize);

      if (gx !== this._dragGx || gy !== this._dragGy) {
        this._dragGx = gx;
        this._dragGy = gy;
        this._redraw();
      }
    }).exec();
  },

  onDockTouchEnd(e) {
    if (!this._dragging) return;
    this._finishDrag(e);
  },

  _finishDrag(e) {
    const idx = this._dragBlockIdx;
    const gx = this._dragGx;
    const gy = this._dragGy;

    this._dragging = false;
    this._dragBlockIdx = -1;
    this._dragGx = -1;
    this._dragGy = -1;
    this.setData({ dragIdx: -1 });

    if (gx >= 0 && gy >= 0 && this._controller.canPlace(idx, gx, gy)) {
      this._controller.place(idx, gx, gy);
      this._redraw();
      this._drawDockBlocks();
    } else {
      this._redraw();
    }
  },

  onRestart() {
    this._controller.reset();
    this._renderer.clearParticles();
    this._renderer.setClearCells([]);
    this.setData({
      overMode: this.data.levelMode === 'level' ? 'level' : 'endless',
      floatScoreVisible: false,
    });
    this._redraw();
    this._drawDockBlocks();
  },

  _showFloatScore(score, linesCleared = 0, bonusCount = 0) {
    const tags = [];
    if (linesCleared >= 3) tags.push(`${linesCleared}x`);
    if (bonusCount > 0) tags.push(`Bonus ${bonusCount}`);
    const suffix = tags.length ? ` (${tags.join(' · ')})` : '';
    const cls = linesCleared >= 3 ? 'float-score--combo' : bonusCount > 0 ? 'float-score--bonus' : '';
    this.setData({
      floatScoreVisible: true,
      floatScoreText: `+${score}${suffix}`,
      floatScoreClass: cls,
    });
    if (this._floatScoreTimer) clearTimeout(this._floatScoreTimer);
    this._floatScoreTimer = setTimeout(() => {
      this.setData({ floatScoreVisible: false });
      this._floatScoreTimer = null;
    }, 900);
  },
});
