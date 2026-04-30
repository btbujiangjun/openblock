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
    this.shakeOffset = { x: 0, y: 0 };
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeStart = 0;
    this._comboFlash = 0;
    this._perfectFlash = 0;
    this._perfectHue = 0;
    this._doubleWave = 0;
    this._doubleWaveRows = [];
    this._bonusMatchFlash = 0;
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
          this._drawCellIcon(cx, cy, cs, colorIdx);
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

  _drawCellIcon(x, y, size, colorIdx) {
    const icons = this._skin.blockIcons;
    if (!icons || !icons.length || size < 14) return;
    const icon = icons[colorIdx % icons.length];
    if (!icon) return;
    const ctx = this._ctx;
    const skin = this._skin;
    const ins = skin.blockInset ?? 2;
    const bx = x + ins;
    const by = y + ins;
    const s = Math.max(1, size - ins * 2);
    const r = skin.blockRadius ?? 5;
    ctx.save();
    if (skin.id === 'mahjong') {
      roundRect(ctx, bx, by, s, s, r);
      ctx.clip();
      paintMahjongTileIcon(ctx, bx, by, s, icon, colorIdx);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(10, Math.floor(size * 0.58))}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.fillText(icon, x + size / 2, y + size / 2 + 0.5);
    }
    ctx.restore();
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
          this._drawCellIcon(cx, cy, cellSize, colorIdx);
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

  drawGridWithEffects(grid, cellSize, offsetX = 0, offsetY = 0) {
    this.clear();
    this.drawGrid(grid, cellSize, offsetX, offsetY);
    this.renderClearCells(offsetX, offsetY);
    this.renderComboFlash();
    this.renderPerfectFlash();
    this.renderDoubleWave();
    this.renderBonusMatchFlash();
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
      ctx.beginPath();
      ctx.arc(p.x + this.shakeOffset.x, p.y + this.shakeOffset.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  clearParticles() {
    this.particles = [];
    this._comboFlash = 0;
    this._perfectFlash = 0;
    this._doubleWave = 0;
    this._bonusMatchFlash = 0;
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
    this._doubleWaveRows = clearedRows || [];
  }

  triggerComboFlash(lineCount) {
    const n = Math.max(3, lineCount || 3);
    this._comboFlash = Math.min(0.95, 0.28 + n * 0.09);
  }

  triggerBonusMatchFlash(bonusLineCount = 1) {
    const n = Math.max(1, bonusLineCount);
    this._bonusMatchFlash = Math.min(1, 0.42 + n * 0.14);
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
      this._bonusMatchFlash *= 0.972;
      if (this._bonusMatchFlash < 0.012) this._bonusMatchFlash = 0;
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
    if (!this._doubleWave || !this._doubleWaveRows.length || this._cellSizeForFx <= 0) return;
    const a = this._doubleWave;
    const logical = this._gridLogicalSize || (this._canvas.width / this._dpr);
    const spread = (1 - a) * logical * 0.6;
    this._ctx.save();
    this._ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
    for (const row of this._doubleWaveRows) {
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

  hasActiveFx() {
    return this.hasParticles()
      || this._comboFlash > 0
      || this._perfectFlash > 0
      || this._doubleWave > 0
      || this._bonusMatchFlash > 0
      || this.shakeDuration > 0;
  }
}

module.exports = { GameRenderer, CLASSIC_PALETTE, DEFAULT_SKIN };
