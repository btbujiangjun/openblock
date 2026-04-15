/**
 * Open Block 微信小程序 Canvas 2D 渲染器。
 *
 * 使用小程序 Canvas 2D API（Canvas.getContext('2d')）。
 * 与 web/src/renderer.js 逻辑对齐，但接口适配了小程序 Canvas 组件。
 *
 * 用法：
 *   const renderer = new GameRenderer(canvas, dpr);
 *   renderer.setSkin(skinData);
 *   renderer.drawGrid(grid, cellSize);
 *   renderer.drawBlock(shape, colorIdx, gx, gy, cellSize);
 *   renderer.drawGhost(shape, gx, gy, cellSize);
 */

const CLASSIC_PALETTE = [
  '#70AD47', '#5B9BD5', '#ED7D31', '#FFC000',
  '#4472C4', '#9E480E', '#E74856', '#8764B8',
];

const DEFAULT_SKIN = {
  blockColors: CLASSIC_PALETTE,
  gridOuter: '#D0D9E2',
  gridCell: '#E2E9F0',
  gridGap: 1,
  blockInset: 2,
  blockRadius: 5,
  blockStyle: 'glossy',
  clearFlash: 'rgba(255,255,255,0.90)',
};

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function darken(hex, pct) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgb(${Math.floor(c.r * (1 - pct))},${Math.floor(c.g * (1 - pct))},${Math.floor(c.b * (1 - pct))})`;
}

function lighten(hex, pct) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgb(${Math.min(255, Math.floor(c.r + (255 - c.r) * pct))},${Math.min(255, Math.floor(c.g + (255 - c.g) * pct))},${Math.min(255, Math.floor(c.b + (255 - c.b) * pct))})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

class GameRenderer {
  constructor(canvas, dpr = 2) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._dpr = dpr;
    this._skin = DEFAULT_SKIN;
  }

  setSkin(skin) {
    this._skin = { ...DEFAULT_SKIN, ...skin };
  }

  resize(widthPx, heightPx) {
    const d = this._dpr;
    this._canvas.width = widthPx * d;
    this._canvas.height = heightPx * d;
    this._ctx.scale(d, d);
  }

  clear() {
    const c = this._canvas;
    this._ctx.clearRect(0, 0, c.width / this._dpr, c.height / this._dpr);
  }

  /** 绘制棋盘网格背景 */
  drawGrid(grid, cellSize, offsetX = 0, offsetY = 0) {
    const ctx = this._ctx;
    const skin = this._skin;
    const n = grid.size;
    const total = n * cellSize;

    ctx.fillStyle = skin.gridOuter;
    roundRect(ctx, offsetX, offsetY, total, total, 6);
    ctx.fill();

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cx = offsetX + x * cellSize + skin.gridGap;
        const cy = offsetY + y * cellSize + skin.gridGap;
        const cs = cellSize - skin.gridGap * 2;

        if (grid.cells[y][x] !== null) {
          const colorIdx = grid.cells[y][x];
          const color = skin.blockColors[colorIdx % skin.blockColors.length];
          this._paintCell(cx, cy, cs, color);
        } else {
          ctx.fillStyle = skin.gridCell;
          roundRect(ctx, cx, cy, cs, cs, skin.blockRadius);
          ctx.fill();
        }
      }
    }
  }

  /** 绘制单个方块格子 */
  _paintCell(x, y, size, color) {
    const ctx = this._ctx;
    const skin = this._skin;
    const ins = skin.blockInset;
    const s = Math.max(1, size - ins * 2);
    const bx = x + ins;
    const by = y + ins;
    const r = skin.blockRadius;

    ctx.fillStyle = color;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();

    // 简化的高光效果（flat 风格）
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, Math.max(0, r - 0.5));
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, Math.max(0, r - 0.5));
    ctx.stroke();
  }

  /** 绘制候选块（dock 区域中的小预览） */
  drawDockBlock(shape, colorIdx, x, y, cellSize) {
    const ctx = this._ctx;
    const color = this._skin.blockColors[colorIdx % this._skin.blockColors.length];
    for (let sy = 0; sy < shape.length; sy++) {
      for (let sx = 0; sx < shape[sy].length; sx++) {
        if (shape[sy][sx]) {
          const cx = x + sx * cellSize;
          const cy = y + sy * cellSize;
          this._paintCell(cx, cy, cellSize, color);
        }
      }
    }
  }

  /** 绘制拖拽时的半透明幽灵 */
  drawGhost(shape, gx, gy, cellSize, offsetX = 0, offsetY = 0) {
    const ctx = this._ctx;
    ctx.globalAlpha = 0.4;
    for (let sy = 0; sy < shape.length; sy++) {
      for (let sx = 0; sx < shape[sy].length; sx++) {
        if (shape[sy][sx]) {
          const cx = offsetX + (gx + sx) * cellSize;
          const cy = offsetY + (gy + sy) * cellSize;
          ctx.fillStyle = '#ffffff';
          roundRect(ctx, cx + 2, cy + 2, cellSize - 4, cellSize - 4, 4);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1.0;
  }

  /** 消行闪白动画帧 */
  flashCells(cells, cellSize, progress, offsetX = 0, offsetY = 0) {
    const ctx = this._ctx;
    const alpha = 1.0 - progress;
    ctx.fillStyle = this._skin.clearFlash.replace(/[\d.]+\)$/, `${alpha})`);
    for (const [x, y] of cells) {
      ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
    }
  }
}

module.exports = { GameRenderer, CLASSIC_PALETTE, DEFAULT_SKIN };
