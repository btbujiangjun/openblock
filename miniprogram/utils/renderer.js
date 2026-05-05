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

const { paintMahjongTileIcon } = require('./mahjongTileIcon.js');

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

const ICON_FONT_STACK = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","PingFang SC","Microsoft YaHei",sans-serif';

function normalizeCanvasIcon(icon) {
  const text = String(icon || '')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/\u200D.+/u, '');
  return text || String(icon || '');
}

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

/** 与 web renderer 一致的 bonus 粒子缩放/透明度曲线 */
function bonusParticleGrowAlpha(p) {
  const lm = p.lifeMax;
  if (lm == null || lm <= 0) return null;
  const u = 1 - Math.max(0, p.life) / lm;
  let scale;
  if (u < 0.42) {
    scale = 0.14 + 0.86 * ((u / 0.42) ** 0.5);
  } else if (u < 0.78) {
    scale = 1 + 0.06 * Math.sin(((u - 0.42) / 0.36) * Math.PI * 2);
  } else {
    scale = Math.max(0.08, 1 - 0.9 * ((u - 0.78) / 0.22));
  }
  const alphaMul = u > 0.84 ? Math.max(0, 1 - (u - 0.84) / 0.16) : 1;
  return { scale, alphaMul };
}

class GameRenderer {
  constructor(canvas, dpr = 2) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._dpr = dpr;
    this._skin = DEFAULT_SKIN;
    /** @type {Array<{x:number,y:number,vx:number,vy:number,color:string,life:number,lifeMax?:number,lifeDecay?:number,size:number,gravityMul?:number}>} */
    this.particles = [];
    this.clearCells = [];
    this.previewClearCells = [];
    this.shakeOffset = { x: 0, y: 0 };
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeStart = 0;
    this._comboFlash = 0;
    this._perfectFlash = 0;
    this._perfectHue = 0;
    this._doubleWave = 0;
    this._doubleWaveLines = { rows: [], cols: [] };
    this._bonusMatchFlash = 0;
    this._blastWave = 0;
    this._blastWaveCount = 0;
    this._cellSizeForFx = 0;
    this._gridLogicalSize = 0;
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
    this._cellSizeForFx = cellSize;
    this._gridLogicalSize = total;

    ctx.fillStyle = skin.gridOuter || '#f2f4f1';
    roundRect(ctx, offsetX, offsetY, total, total, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.96)';
    ctx.lineWidth = 1;
    roundRect(ctx, offsetX + 0.5, offsetY + 0.5, total - 1, total - 1, 6);
    ctx.stroke();

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cx = offsetX + x * cellSize + skin.gridGap;
        const cy = offsetY + y * cellSize + skin.gridGap;
        const cs = cellSize - skin.gridGap * 2;

        if (grid.cells[y][x] !== null) {
          const colorIdx = grid.cells[y][x];
          const color = skin.blockColors[colorIdx % skin.blockColors.length];
          this._paintCell(cx, cy, cs, color);
          this._drawCellIcon(cx, cy, cs, colorIdx);
        } else {
          ctx.fillStyle = skin.gridCell || '#fbfbf7';
          roundRect(ctx, cx, cy, cs, cs, this._cellRadius(cs));
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.88)';
          ctx.lineWidth = 1;
          roundRect(ctx, cx + 0.5, cy + 0.5, cs - 1, cs - 1, Math.max(0, this._cellRadius(cs) - 0.5));
          ctx.stroke();
        }
      }
    }
  }

  _cellInset(size) {
    const skinInset = this._skin.blockInset ?? 2;
    return Math.max(1, Math.min(skinInset, size * 0.055));
  }

  _cellRadius(paintedSize) {
    const skinRadius = this._skin.blockRadius ?? 5;
    return Math.max(3, Math.min(skinRadius, paintedSize * 0.16));
  }

  /** 绘制单个方块格子 */
  _paintCell(x, y, size, color) {
    const ctx = this._ctx;
    const skin = this._skin;
    const ins = this._cellInset(size);
    const s = Math.max(1, size - ins * 2);
    const bx = x + ins;
    const by = y + ins;
    const r = this._cellRadius(s);

    // bevel3d：四向梯形浮雕（与 web/src/renderer.js 一致 — 圆润按钮光照模型）
    if (skin.blockStyle === 'bevel3d') {
      const bevel = Math.max(2, Math.round(s * 0.13));
      const ix = bx + bevel;
      const iy = by + bevel;
      const is = s - bevel * 2;

      ctx.save();
      if (r > 0) {
        roundRect(ctx, bx, by, s, s, r);
        ctx.clip();
      }

      ctx.fillStyle = lighten(color, 0.18);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + s, by);
      ctx.lineTo(ix + is, iy);
      ctx.lineTo(ix, iy);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = lighten(color, 0.06);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(ix, iy);
      ctx.lineTo(ix, iy + is);
      ctx.lineTo(bx, by + s);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = darken(color, 0.16);
      ctx.beginPath();
      ctx.moveTo(bx + s, by);
      ctx.lineTo(bx + s, by + s);
      ctx.lineTo(ix + is, iy + is);
      ctx.lineTo(ix + is, iy);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = darken(color, 0.32);
      ctx.beginPath();
      ctx.moveTo(bx, by + s);
      ctx.lineTo(ix, iy + is);
      ctx.lineTo(ix + is, iy + is);
      ctx.lineTo(bx + s, by + s);
      ctx.closePath();
      ctx.fill();

      // 中心面：左上提亮（lighten 12%）→ 右下主色，对角渐变保留饱和度
      ctx.fillStyle = lighten(color, 0.10);
      ctx.fillRect(ix, iy, is, is);

      ctx.restore();
      return;
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.20)';
    ctx.shadowBlur = Math.max(0, size * 0.065);
    ctx.shadowOffsetY = Math.max(1, size * 0.032);
    ctx.fillStyle = color;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();
    ctx.restore();

    // 只保留轻量边界，避免方块本身过度立体化。
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, Math.max(0, r - 0.5));
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, Math.max(0, r - 0.5));
    ctx.stroke();
  }

  _drawCellIcon(x, y, size, colorIdx) {
    const icons = this._skin.blockIcons;
    const safeSize = Number.isFinite(size) && size > 0 ? size : 0;
    if (!icons || !icons.length || safeSize < 14) return;
    const icon = icons[colorIdx % icons.length];
    if (!icon) return;
    const canvasIcon = normalizeCanvasIcon(icon);
    const ctx = this._ctx;
    const skin = this._skin;
    const ins = this._cellInset(size);
    const bx = x + ins;
    const by = y + ins;
    const s = Math.max(1, size - ins * 2);
    const r = this._cellRadius(s);
    ctx.save();
    if (skin.id === 'mahjong') {
      roundRect(ctx, bx, by, s, s, r);
      ctx.clip();
      paintMahjongTileIcon(ctx, bx, by, s, canvasIcon, colorIdx);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(10, Math.floor(safeSize * 0.58))}px ${ICON_FONT_STACK}`;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.fillText(canvasIcon, x + safeSize / 2, y + safeSize / 2 + 0.5);
    }
    ctx.restore();
  }

  /** 绘制候选块（dock 区域中的小预览） */
  drawDockBlock(shape, colorIdx, x, y, cellSize) {
    if (!Array.isArray(shape) || !Number.isFinite(cellSize) || cellSize <= 0) return;
    const ctx = this._ctx;
    const color = this._skin.blockColors[colorIdx % this._skin.blockColors.length];
    for (let sy = 0; sy < shape.length; sy++) {
      for (let sx = 0; sx < shape[sy].length; sx++) {
        if (shape[sy][sx]) {
          const cx = x + sx * cellSize;
          const cy = y + sy * cellSize;
          this._paintCell(cx, cy, cellSize, color);
          this._drawCellIcon(cx, cy, cellSize, colorIdx);
        }
      }
    }
  }

  /** 绘制拖拽时的半透明幽灵 */
  drawGhost(shape, gx, gy, cellSize, offsetX = 0, offsetY = 0, colorIdx = null) {
    const ctx = this._ctx;
    const color = colorIdx == null ? null : this._skin.blockColors[colorIdx % this._skin.blockColors.length];
    ctx.globalAlpha = 0.62;
    for (let sy = 0; sy < shape.length; sy++) {
      for (let sx = 0; sx < shape[sy].length; sx++) {
        if (shape[sy][sx]) {
          const cx = offsetX + (gx + sx) * cellSize;
          const cy = offsetY + (gy + sy) * cellSize;
          if (color) {
            this._paintCell(cx, cy, cellSize, color);
            this._drawCellIcon(cx, cy, cellSize, colorIdx);
          } else {
            ctx.fillStyle = '#ffffff';
            roundRect(ctx, cx + 2, cy + 2, cellSize - 4, cellSize - 4, 4);
            ctx.fill();
          }
        }
      }
    }
    ctx.globalAlpha = 1.0;
  }

  /** 绘制最近几个合法吸附落点，帮助判断拖拽轨迹 */
  drawGhostTrail(shape, trail, cellSize, offsetX = 0, offsetY = 0, colorIdx = null) {
    if (!Array.isArray(shape) || !Array.isArray(trail) || trail.length === 0) return;
    const ctx = this._ctx;
    const color = colorIdx == null ? '#FFFFFF' : this._skin.blockColors[colorIdx % this._skin.blockColors.length];
    const start = Math.max(0, trail.length - 6);
    ctx.save();
    for (let ti = start; ti < trail.length; ti++) {
      const point = trail[ti];
      const rank = ti - start + 1;
      const alpha = 0.08 + (rank / (trail.length - start + 1)) * 0.24;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, cellSize * 0.035);
      for (let sy = 0; sy < shape.length; sy++) {
        for (let sx = 0; sx < shape[sy].length; sx++) {
          if (!shape[sy][sx]) continue;
          const cx = offsetX + (point.x + sx) * cellSize;
          const cy = offsetY + (point.y + sy) * cellSize;
          roundRect(ctx, cx + cellSize * 0.18, cy + cellSize * 0.18, cellSize * 0.64, cellSize * 0.64, Math.max(3, cellSize * 0.1));
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  drawGridWithEffects(grid, cellSize, offsetX = 0, offsetY = 0) {
    this.clear();
    this.drawGrid(grid, cellSize, offsetX, offsetY);
    this.renderClearCells(offsetX, offsetY);
    this.renderPreviewClearCells(offsetX, offsetY);
    this.renderComboFlash();
    this.renderPerfectFlash();
    this.renderDoubleWave();
    this.renderBonusMatchFlash();
    this.renderBigBlastWave();
    this.renderParticles();
  }

  /** 消行闪白动画帧 */
  flashCells(cells, cellSize, progress, offsetX = 0, offsetY = 0) {
    const ctx = this._ctx;
    const alpha = 1.0 - progress;
    ctx.fillStyle = this._skin.clearFlash.replace(/[\d.]+\)$/, `${alpha})`);
    for (const cell of cells) {
      const x = Array.isArray(cell) ? cell[0] : cell.x;
      const y = Array.isArray(cell) ? cell[1] : cell.y;
      ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
    }
  }

  setClearCells(cells) {
    this.clearCells = cells || [];
  }

  setPreviewClearCells(cells) {
    this.previewClearCells = cells || [];
  }

  renderPreviewClearCells(offsetX = 0, offsetY = 0) {
    if (!this.previewClearCells || this.previewClearCells.length === 0 || this._cellSizeForFx <= 0) return;
    const ctx = this._ctx;
    const cs = this._cellSizeForFx;
    ctx.save();
    ctx.globalAlpha = 0.68;
    ctx.fillStyle = 'rgba(255, 238, 120, 0.26)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = Math.max(1, cs * 0.045);
    for (const c of this.previewClearCells) {
      const x = c.x ?? c[0];
      const y = c.y ?? c[1];
      const px = offsetX + x * cs;
      const py = offsetY + y * cs;
      ctx.fillRect(px, py, cs, cs);
      ctx.strokeRect(px + 2, py + 2, cs - 4, cs - 4);
    }
    ctx.restore();
  }

  renderClearCells(offsetX = 0, offsetY = 0) {
    if (!this.clearCells || this.clearCells.length === 0 || this._cellSizeForFx <= 0) return;
    this._ctx.save();
    this._ctx.globalAlpha = 0.82;
    this._ctx.fillStyle = this._skin.clearFlash;
    for (const c of this.clearCells) {
      const x = c.x ?? c[0];
      const y = c.y ?? c[1];
      this._ctx.fillRect(offsetX + x * this._cellSizeForFx, offsetY + y * this._cellSizeForFx, this._cellSizeForFx, this._cellSizeForFx);
    }
    this._ctx.restore();
  }

  addClearBurst(cells, countPerCell = 4, cellSize = this._cellSizeForFx) {
    if (!Array.isArray(cells) || !cells.length || !cellSize) return;
    const maxParticles = 96;
    const palette = this._skin.blockColors || CLASSIC_PALETTE;
    let emitted = 0;
    for (const cell of cells) {
      if (emitted >= maxParticles) break;
      const x = cell.x ?? cell[0];
      const y = cell.y ?? cell[1];
      const colorIdx = cell.color ?? 0;
      const baseColor = palette[colorIdx % palette.length] || '#FFFFFF';
      for (let i = 0; i < countPerCell && emitted < maxParticles; i++) {
        const life = 0.72 + Math.random() * 0.32;
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.4 + Math.random() * 4.8;
        this.particles.push({
          x: (x + 0.35 + Math.random() * 0.3) * cellSize,
          y: (y + 0.35 + Math.random() * 0.3) * cellSize,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          color: i % 3 === 0 ? '#FFFFFF' : baseColor,
          life,
          size: 2.5 + Math.random() * 4.5,
          lifeDecay: 0.025 + Math.random() * 0.012,
          gravityMul: 0.35,
        });
        emitted++;
      }
    }
  }

  addMultiClearBurst(lines = {}, cells = [], lineCount = 2, cellSize = this._cellSizeForFx) {
    if (!cellSize) return;
    const rows = lines.rows || [];
    const cols = lines.cols || [];
    const n = Math.max(1, this._gridLogicalSize / cellSize || 8);
    const strength = Math.max(2, lineCount || rows.length + cols.length);
    const maxParticles = Math.min(140, 44 + strength * 22);
    let emitted = 0;
    const colors = ['#FFFFFF', '#5AD487', '#7DD3FC', '#FFD166'];
    const push = (x, y, angle, speed, color) => {
      if (emitted >= maxParticles) return;
      const life = 0.86 + Math.random() * 0.34;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.8,
        color,
        life,
        lifeMax: life,
        lifeDecay: 0.015 + Math.random() * 0.008,
        size: 3 + Math.random() * 6,
        gravityMul: 0.20,
        kind: emitted % 4 === 0 ? 'spark' : 'dot',
      });
      emitted++;
    };

    for (const row of rows) {
      const y = (row + 0.5) * cellSize;
      for (let i = 0; i < 18 + strength * 3; i++) {
        const x = Math.random() * n * cellSize;
        const dir = i % 2 === 0 ? 0 : Math.PI;
        push(x, y, dir + (Math.random() - 0.5) * 0.45, 4 + Math.random() * 9, colors[i % colors.length]);
      }
    }
    for (const col of cols) {
      const x = (col + 0.5) * cellSize;
      for (let i = 0; i < 18 + strength * 3; i++) {
        const y = Math.random() * n * cellSize;
        const dir = i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
        push(x, y, dir + (Math.random() - 0.5) * 0.45, 4 + Math.random() * 9, colors[(i + 1) % colors.length]);
      }
    }

    const sourceCells = Array.isArray(cells) && cells.length ? cells : [];
    for (let i = 0; i < Math.min(36, sourceCells.length * 2); i++) {
      const c = sourceCells[i % sourceCells.length];
      const x = ((c?.x ?? c?.[0] ?? 0) + 0.5) * cellSize;
      const y = ((c?.y ?? c?.[1] ?? 0) + 0.5) * cellSize;
      push(x, y, Math.random() * Math.PI * 2, 3 + Math.random() * 7, colors[(i + 2) % colors.length]);
    }
  }

  addBigBlast(cells = [], bonusLines = [], cellSize = this._cellSizeForFx) {
    if (!cellSize) return;
    const logical = this._gridLogicalSize || (this._canvas.width / this._dpr);
    const source = Array.isArray(cells) && cells.length ? cells : [{ x: 3.5, y: 3.5 }];
    const center = source.reduce((acc, c) => {
      acc.x += (c.x ?? c[0] ?? 3.5) + 0.5;
      acc.y += (c.y ?? c[1] ?? 3.5) + 0.5;
      return acc;
    }, { x: 0, y: 0 });
    const cx = (center.x / source.length) * cellSize;
    const cy = (center.y / source.length) * cellSize;
    const palette = this._skin.blockColors || CLASSIC_PALETTE;
    const gold = '#FFD700';
    const white = '#FFFFFF';
    const purple = '#B794F4';
    const count = Math.min(180, 72 + (bonusLines.length || 1) * 34);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 16;
      const life = 1.10 + Math.random() * 0.70;
      const line = bonusLines[i % Math.max(1, bonusLines.length)];
      const lineColor = line ? palette[line.colorIdx % palette.length] : palette[i % palette.length];
      this.particles.push({
        x: cx + (Math.random() - 0.5) * cellSize * 0.7,
        y: cy + (Math.random() - 0.5) * cellSize * 0.7,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (2 + Math.random() * 4),
        color: i % 4 === 0 ? gold : i % 4 === 1 ? white : i % 4 === 2 ? purple : lineColor,
        life,
        lifeMax: life,
        lifeDecay: 0.008 + Math.random() * 0.006,
        size: 4 + Math.random() * 12,
        gravityMul: 0.28,
        kind: i % 3 === 0 ? 'spark' : 'dot',
      });
    }

    for (let k = 0; k < Math.min(28, source.length); k++) {
      const c = source[k];
      const x = ((c.x ?? c[0] ?? 0) + 0.5) * cellSize;
      const y = ((c.y ?? c[1] ?? 0) + 0.5) * cellSize;
      const angle = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 0.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * (9 + Math.random() * 12),
        vy: Math.sin(angle) * (9 + Math.random() * 12) - 4,
        color: k % 2 ? gold : white,
        life: 1.35,
        lifeMax: 1.35,
        lifeDecay: 0.010,
        size: 5 + Math.random() * 8,
        gravityMul: 0.18,
        kind: 'spark',
      });
    }

    this._blastWaveCount = Math.max(1, bonusLines.length || 1);
    this._blastOrigin = {
      x: Math.max(0, Math.min(logical, cx)),
      y: Math.max(0, Math.min(logical, cy)),
    };
  }

  /**
   * 同色整行/列消除：沿行或列喷射粒子（与 web/src/renderer.js addBonusLineBurst 对齐）
   * @param {{ type:'row'|'col', idx:number }} bonusLine
   * @param {string} cssColor
   * @param {number} [count=48]
   * @param {number} gridSize
   * @param {number} cellSize
   */
  addBonusLineBurst(bonusLine, cssColor, count = 48, gridSize, cellSize) {
    const n = gridSize;
    const cs = cellSize;
    const gold = '#FFD700';
    const white = '#FFFFFF';
    const pushBurst = (x, y, angle, speed, color, life, decay, sz, gMul) => {
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (1.5 + Math.random() * 2.5),
        color,
        life,
        lifeMax: life,
        lifeDecay: decay,
        size: sz,
        gravityMul: gMul,
      });
    };
    for (let i = 0; i < count; i++) {
      let x;
      let y;
      if (bonusLine.type === 'row') {
        x = cs * (Math.random() * n);
        y = cs * (bonusLine.idx + 0.5);
      } else {
        x = cs * (bonusLine.idx + 0.5);
        y = cs * (Math.random() * n);
      }
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.75;
      const speed = 3.5 + Math.random() * 12;
      const color = i % 3 === 0 ? gold : i % 3 === 1 ? cssColor : white;
      pushBurst(x, y, angle, speed, color,
        1.15 + Math.random() * 0.55,
        0.0055 + Math.random() * 0.0045,
        6 + Math.random() * 12,
        0.52);
    }
    for (let k = 0; k < 22; k++) {
      let x;
      let y;
      if (bonusLine.type === 'row') {
        x = cs * (Math.random() * n);
        y = cs * (bonusLine.idx + 0.5);
      } else {
        x = cs * (bonusLine.idx + 0.5);
        y = cs * (Math.random() * n);
      }
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 14;
      pushBurst(x, y, angle, speed, k % 2 ? white : cssColor,
        1.0 + Math.random() * 0.35,
        0.007 + Math.random() * 0.006,
        3 + Math.random() * 5,
        0.38);
    }
    for (let j = 0; j < 22; j++) {
      let x;
      let y;
      if (bonusLine.type === 'row') {
        x = cs * (Math.random() * n);
        y = cs * (bonusLine.idx + 0.5);
      } else {
        x = cs * (bonusLine.idx + 0.5);
        y = cs * (Math.random() * n);
      }
      const lj = 1.45 + Math.random() * 0.35;
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 26,
        vy: -(9 + Math.random() * 12),
        color: gold,
        life: lj,
        lifeMax: lj,
        lifeDecay: 0.0075 + Math.random() * 0.004,
        size: 2.5 + Math.random() * 4.5,
        gravityMul: 0.45,
      });
    }
  }

  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35 * (p.gravityMul ?? 1);
      const decay = p.lifeDecay ?? 0.03;
      p.life -= decay;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }
  
  renderParticles() {
    const ctx = this._ctx;
    for (const p of this.particles) {
      const ga = bonusParticleGrowAlpha(p);
      let rad;
      let alpha;
      if (ga) {
        rad = p.size * ga.scale;
        alpha = Math.min(1, p.life * 1.05) * ga.alphaMul;
      } else {
        rad = p.size * p.life;
        alpha = p.life;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      const px = p.x + this.shakeOffset.x;
      const py = p.y + this.shakeOffset.y;
      if (p.kind === 'spark') {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate((p.vx + p.vy) * 0.08);
        ctx.fillRect(-rad * 0.18, -rad, rad * 0.36, rad * 2);
        ctx.fillRect(-rad, -rad * 0.18, rad * 2, rad * 0.36);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  clearParticles() {
    this.particles = [];
    this.previewClearCells = [];
    this._comboFlash = 0;
    this._perfectFlash = 0;
    this._doubleWave = 0;
    this._doubleWaveLines = { rows: [], cols: [] };
    this._bonusMatchFlash = 0;
    this._blastWave = 0;
    this._blastWaveCount = 0;
    this.shakeDuration = 0;
    this.shakeOffset = { x: 0, y: 0 };
  }

  hasParticles() {
    return this.particles.length > 0;
  }

  setShake(intensity, duration) {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeStart = Date.now();
  }

  updateShake() {
    if (!this.shakeDuration) {
      this.shakeOffset = { x: 0, y: 0 };
      return;
    }
    const elapsed = Date.now() - this.shakeStart;
    if (elapsed >= this.shakeDuration) {
      this.shakeOffset = { x: 0, y: 0 };
      this.shakeDuration = 0;
      return;
    }
    const progress = elapsed / this.shakeDuration;
    const damp = 1 - progress;
    const intensity = this.shakeIntensity * damp;
    const wobble = (elapsed / 1000) * 38;
    this.shakeOffset = {
      x: Math.sin(wobble) * intensity * 0.55,
      y: Math.sin(wobble * 1.3 + 0.7) * intensity * 0.5,
    };
  }

  triggerPerfectFlash() {
    this._perfectFlash = 1.0;
    this._perfectHue = 0;
  }

  triggerDoubleWave(clearedRows) {
    this._doubleWave = 1.0;
    if (Array.isArray(clearedRows)) {
      this._doubleWaveLines = { rows: clearedRows, cols: [] };
    } else {
      this._doubleWaveLines = {
        rows: clearedRows?.rows || [],
        cols: clearedRows?.cols || [],
      };
    }
  }

  triggerComboFlash(lineCount) {
    const n = Math.max(3, lineCount || 3);
    this._comboFlash = Math.min(0.95, 0.28 + n * 0.09);
  }

  triggerBonusMatchFlash(bonusLineCount = 1) {
    const n = Math.max(1, bonusLineCount);
    this._bonusMatchFlash = Math.min(1, 0.55 + n * 0.18);
  }

  triggerBigBlast(bonusLineCount = 1) {
    const n = Math.max(1, bonusLineCount);
    this._blastWave = 1.0;
    this._blastWaveCount = n;
  }

  decayAllFx() {
    if (this._comboFlash > 0) {
      this._comboFlash *= 0.94;
      if (this._comboFlash < 0.015) this._comboFlash = 0;
    }
    if (this._perfectFlash > 0) {
      this._perfectFlash *= 0.968;
      this._perfectHue = (this._perfectHue + 5) % 360;
      if (this._perfectFlash < 0.02) this._perfectFlash = 0;
    }
    if (this._doubleWave > 0) {
      this._doubleWave *= 0.96;
      if (this._doubleWave < 0.015) this._doubleWave = 0;
    }
    if (this._bonusMatchFlash > 0) {
      this._bonusMatchFlash *= 0.980;
      if (this._bonusMatchFlash < 0.010) this._bonusMatchFlash = 0;
    }
    if (this._blastWave > 0) {
      this._blastWave *= 0.955;
      if (this._blastWave < 0.012) this._blastWave = 0;
    }
  }

  renderPerfectFlash() {
    if (!this._perfectFlash) return;
    const a = this._perfectFlash;
    const logical = this._gridLogicalSize || (this._canvas.width / this._dpr);
    const cx = logical * 0.5;
    const cy = logical * 0.5;
    const r = logical * 0.85;
    const g = this._ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const h = this._perfectHue;
    g.addColorStop(0, `hsla(${h}, 100%, 75%, ${0.3 * a})`);
    g.addColorStop(0.3, `hsla(${(h + 60) % 360}, 100%, 65%, ${0.15 * a})`);
    g.addColorStop(0.6, `hsla(${(h + 120) % 360}, 100%, 60%, ${0.06 * a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    this._ctx.save();
    this._ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
    this._ctx.fillStyle = g;
    this._ctx.fillRect(-this.shakeOffset.x, -this.shakeOffset.y, logical, logical);
    this._ctx.restore();
  }

  renderDoubleWave() {
    const rows = this._doubleWaveLines?.rows || [];
    const cols = this._doubleWaveLines?.cols || [];
    if (!this._doubleWave || (!rows.length && !cols.length) || this._cellSizeForFx <= 0) return;
    const a = this._doubleWave;
    const logical = this._gridLogicalSize || (this._canvas.width / this._dpr);
    const spread = (1 - a) * logical * 0.6;
    this._ctx.save();
    this._ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
    for (const row of rows) {
      const cy = (row + 0.5) * this._cellSizeForFx;
      const g = this._ctx.createLinearGradient(
        logical * 0.5 - spread,
        cy,
        logical * 0.5 + spread,
        cy
      );
      g.addColorStop(0, 'rgba(46,204,113,0)');
      g.addColorStop(0.3, `rgba(46,204,113,${0.25 * a})`);
      g.addColorStop(0.5, `rgba(255,255,255,${0.35 * a})`);
      g.addColorStop(0.7, `rgba(46,204,113,${0.25 * a})`);
      g.addColorStop(1, 'rgba(46,204,113,0)');
      this._ctx.fillStyle = g;
      this._ctx.fillRect(0, cy - this._cellSizeForFx * 0.6, logical, this._cellSizeForFx * 1.2);
    }
    for (const col of cols) {
      const cx = (col + 0.5) * this._cellSizeForFx;
      const g = this._ctx.createLinearGradient(
        cx,
        logical * 0.5 - spread,
        cx,
        logical * 0.5 + spread
      );
      g.addColorStop(0, 'rgba(46,204,113,0)');
      g.addColorStop(0.3, `rgba(46,204,113,${0.25 * a})`);
      g.addColorStop(0.5, `rgba(255,255,255,${0.35 * a})`);
      g.addColorStop(0.7, `rgba(46,204,113,${0.25 * a})`);
      g.addColorStop(1, 'rgba(46,204,113,0)');
      this._ctx.fillStyle = g;
      this._ctx.fillRect(cx - this._cellSizeForFx * 0.6, 0, this._cellSizeForFx * 1.2, logical);
    }
    this._ctx.restore();
  }

  renderComboFlash() {
    if (!this._comboFlash) return;
    const a = this._comboFlash;
    const logical = this._gridLogicalSize || (this._canvas.width / this._dpr);
    const cx = logical * 0.5;
    const cy = logical * 0.5;
    const r = logical * 0.72;
    const g = this._ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,230,140,${0.22 * a})`);
    g.addColorStop(0.35, `rgba(255,170,60,${0.12 * a})`);
    g.addColorStop(0.65, `rgba(255,120,40,${0.05 * a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    this._ctx.save();
    this._ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
    this._ctx.fillStyle = g;
    this._ctx.fillRect(-this.shakeOffset.x, -this.shakeOffset.y, logical, logical);
    this._ctx.restore();
  }

  renderBonusMatchFlash() {
    if (!this._bonusMatchFlash) return;
    const a = this._bonusMatchFlash;
    const logical = this._gridLogicalSize || (this._canvas.width / this._dpr);
    const cx = logical * 0.5;
    const cy = logical * 0.5;
    const r = logical * 0.88;
    const g = this._ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,220,120,${0.26 * a})`);
    g.addColorStop(0.22, `rgba(200,120,255,${0.18 * a})`);
    g.addColorStop(0.5, `rgba(140,80,220,${0.10 * a})`);
    g.addColorStop(0.78, `rgba(80,40,160,${0.04 * a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    this._ctx.save();
    this._ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
    this._ctx.fillStyle = g;
    this._ctx.fillRect(-this.shakeOffset.x, -this.shakeOffset.y, logical, logical);
    this._ctx.restore();
  }

  renderBigBlastWave() {
    if (!this._blastWave) return;
    const a = this._blastWave;
    const logical = this._gridLogicalSize || (this._canvas.width / this._dpr);
    const origin = this._blastOrigin || { x: logical * 0.5, y: logical * 0.5 };
    const progress = 1 - a;
    const maxR = logical * (0.55 + Math.min(0.25, this._blastWaveCount * 0.04));
    const r = logical * 0.08 + progress * maxR;
    const ctx = this._ctx;
    ctx.save();
    ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
    ctx.strokeStyle = `rgba(255, 214, 102, ${0.62 * a})`;
    ctx.lineWidth = Math.max(2, logical * 0.018 * a);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
    ctx.stroke();

    const g = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, r * 1.25);
    g.addColorStop(0, `rgba(255,255,255,${0.20 * a})`);
    g.addColorStop(0.25, `rgba(255,215,0,${0.16 * a})`);
    g.addColorStop(0.58, `rgba(183,148,244,${0.10 * a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-this.shakeOffset.x, -this.shakeOffset.y, logical, logical);
    ctx.restore();
  }

  hasActiveFx() {
    return this.hasParticles()
      || this._comboFlash > 0
      || this._perfectFlash > 0
      || this._doubleWave > 0
      || this._bonusMatchFlash > 0
      || this._blastWave > 0
      || this.shakeDuration > 0;
  }
}

module.exports = { GameRenderer, CLASSIC_PALETTE, DEFAULT_SKIN };
