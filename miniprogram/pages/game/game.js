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

  onLoad(query) {
    const strategyId = query.strategy || 'normal';
    this._strategyId = strategyId;
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

        this._controller = new GameController(this._strategyId, {
          onStateChange: (snap) => this._onStateChange(snap),
          onLineClear: (info) => this._onLineClear(info),
          onGameOver: (info) => this._onGameOver(info),
        });

        this._redraw();
        this._drawDockBlocks();
      });
  },

  _onStateChange(snap) {
    this.setData({
      score: snap.score,
      steps: snap.steps,
      totalClears: snap.totalClears,
      dock: snap.dock.map((d) => ({ placed: d.placed, colorIdx: d.colorIdx })),
      gameOver: snap.gameOver,
    });
  },

  _onLineClear(info) {
    // 未来可加消行动画
  },

  _onGameOver(info) {
    // 未来可加结算分享
  },

  _redraw() {
    if (!this._renderer || !this._controller) return;
    const r = this._renderer;
    const g = this._controller;
    r.clear();
    r.drawGrid(g.grid, this._cellSize, 0, 0);

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
    this._redraw();
    this._drawDockBlocks();
  },
});
