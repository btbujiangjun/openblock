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

/** RGB→HSL（与 web/src/renderer.js `_rgbToHsl` 同源）。 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h, s; const l = (mx + mn) / 2;
  if (mx === mn) { h = 0; s = 0; } else {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case r: h = ((g - b) / d) + (g < b ? 6 : 0); break;
      case g: h = ((b - r) / d) + 2; break;
      default: h = ((r - g) / d) + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

/** HSL→RGB（与 web/src/renderer.js `_hslToRgb` 同源）。 */
function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/** HSL 空间降饱和（与 web/src/renderer.js `desaturateColor` 同源，保留色相/明度）。 */
function desaturateColor(hex, factor) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
  const ns = Math.max(0, Math.min(1, s * factor));
  const [r, g, b] = hslToRgb(h, ns, l);
  return `rgb(${r},${g},${b})`;
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
    this._iconAssetCache = new Map();
    /** @type {Array<{x:number,y:number,vx:number,vy:number,color:string,life:number,lifeMax?:number,lifeDecay?:number,size:number,gravityMul?:number}>} */
    this.particles = [];
    // beginBonusColorGush 状态（与 web `_colorGushLines/_colorGushStart/_colorGushEnd` 对齐）
    this._colorGushLines = [];
    this._colorGushStart = 0;
    this._colorGushEnd = 0;
    this._colorGushCs = 0;
    this._colorGushN = 0;
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
    /* 与 web/src/renderer.js 对齐：特效开关 + 画质等级（high/balanced/low）。
       关闭特效时所有粒子/抖动/闪光均被守卫拒绝；省电画质会按比例削减粒子数量。 */
    this._effectsEnabled = true;
    this._qualityMode = 'high';
  }

  setSkin(skin) {
    this._skin = { ...DEFAULT_SKIN, ...skin };
  }

  /** 关闭后所有 trigger/add/setShake 都直接 no-op，并清空已堆积的特效。 */
  setEffectsEnabled(enabled) {
    this._effectsEnabled = !!enabled;
    if (!this._effectsEnabled) {
      this.clearFx();
    }
  }

  getEffectsEnabled() {
    return this._effectsEnabled;
  }

  setQualityMode(mode) {
    const next = ['high', 'balanced', 'low'].includes(mode) ? mode : 'high';
    if (this._qualityMode === next) return;
    this._qualityMode = next;
    /* 切档不强制清空已激活粒子，保留观感连续；下一次发射开始按新档位计算。 */
  }

  getQualityMode() {
    return this._qualityMode || 'high';
  }

  /** 粒子数量缩放：low 0.45 / balanced 0.78 / high 1.0。所有 add* 方法用它统一调节。 */
  _qualityParticleScale() {
    if (this._qualityMode === 'low') return 0.45;
    if (this._qualityMode === 'balanced') return 0.78;
    return 1;
  }

  /** 与 web 端语义一致：把当前所有正在播放的特效（粒子/抖动/闪光/波纹）一次性清空。 */
  clearFx() {
    this.clearParticles();
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeOffset = { x: 0, y: 0 };
    this.clearCells = [];
    this.previewClearCells = [];
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

  /**
   * 绘制棋盘网格背景（严格对齐 web `_paintBackgroundUnder` + `_paintBackgroundOver`）：
   *   Pass 1：outer 全屏铺底
   *   Pass 2：对全部 8×8 格子（包括已放块的）都铺 cellEmpty 底色 —— 这一步是关键，避免
   *           已放块的 inset 留白处露出深色 gridOuter，出现"方块四周黑乎乎一片"的观感。
   *   Pass 3：水印
   *   Pass 4：网格线（只画内部 7 横 7 竖，外框由 outer 圆角承担）
   *   Pass 5：在 cellEmpty 上画方块（块默认带 blockInset 留白 → 周围正好露出 cellEmpty 色）
   */
  drawGrid(grid, cellSize, offsetX = 0, offsetY = 0) {
    const ctx = this._ctx;
    const skin = this._skin;
    const n = grid.size;
    const total = n * cellSize;
    this._cellSizeForFx = cellSize;
    this._gridLogicalSize = total;

    const gridCellColor = skin.gridCell || '#fbfbf7';
    const gridOuterColor = skin.gridOuter || '#f2f4f1';
    const gridCellRgb = hexToRgb(gridCellColor) || { r: 255, g: 255, b: 255 };
    const gridOuterRgb = hexToRgb(gridOuterColor) || gridCellRgb;
    const gridCellLuma = gridCellRgb.r * 0.2126 + gridCellRgb.g * 0.7152 + gridCellRgb.b * 0.0722;
    // 严格对齐 web `isLightBoardSkin`：gridCell 相对亮度 ≥ 0.78 视为浅盘。
    const lightBoard = (gridCellLuma / 255) >= 0.78 || skin.uiDark === false;
    // 严格对齐 web `_paintBackgroundUnder`：cellEmpty = 0.96 * gridCell + 0.04 * gridOuter。
    const emptyR = Math.round(gridCellRgb.r * 0.96 + gridOuterRgb.r * 0.04);
    const emptyG = Math.round(gridCellRgb.g * 0.96 + gridOuterRgb.g * 0.04);
    const emptyB = Math.round(gridCellRgb.b * 0.96 + gridOuterRgb.b * 0.04);
    const emptyCellColor = `rgb(${emptyR},${emptyG},${emptyB})`;

    // Pass 1：outer 圆角铺满
    ctx.fillStyle = gridOuterColor;
    roundRect(ctx, offsetX, offsetY, total, total, 6);
    ctx.fill();

    // Pass 2：所有格子都铺 cellEmpty 底色（包括已放块的）—— 消除"块周围黑边"
    const gap = skin.gridGap ?? 1;
    const cs = cellSize - gap * 2;
    ctx.fillStyle = emptyCellColor;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillRect(offsetX + x * cellSize + gap, offsetY + y * cellSize + gap, cs, cs);
      }
    }

    // Pass 3：盘面水印（在底色之上、网格线/方块之下）
    this._renderBoardWatermark(offsetX, offsetY, total, skin);

    // Pass 4：网格线（对齐 web `_paintBackgroundOver`：只画内部线条；
    //          深盘白线 alpha 0.46 / 浅盘深线 alpha 0.34；外框由 outer 圆角承担，不再画矩形描边）
    if (skin.gridLine !== false) {
      ctx.strokeStyle = (typeof skin.gridLine === 'string' && skin.gridLine)
        ? skin.gridLine
        : (lightBoard ? 'rgba(15,23,42,0.34)' : 'rgba(255,255,255,0.46)');
      ctx.lineWidth = 1;
      ctx.lineCap = 'butt';
      for (let i = 1; i < n; i++) {
        const p = offsetX + i * cellSize + 0.5;
        ctx.beginPath();
        ctx.moveTo(p, offsetY);
        ctx.lineTo(p, offsetY + total);
        ctx.stroke();
      }
      for (let j = 1; j < n; j++) {
        const p = offsetY + j * cellSize + 0.5;
        ctx.beginPath();
        ctx.moveTo(offsetX, p);
        ctx.lineTo(offsetX + total, p);
        ctx.stroke();
      }
    }

    // Pass 5：在 cellEmpty 上画方块（_paintCell 内部按 blockInset 留白，
    //          inset 圈正好露出 cellEmpty 颜色，对齐 web "奶油色边" 视觉）
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (grid.cells[y][x] === null) continue;
        const cx = offsetX + x * cellSize + gap;
        const cy = offsetY + y * cellSize + gap;
        const colorIdx = grid.cells[y][x];
        const color = skin.blockColors[colorIdx % skin.blockColors.length];
        this._paintCell(cx, cy, cs, color);
        this._drawCellIcon(cx, cy, cs, colorIdx);
      }
    }
  }

  /**
   * 盘面水印（小程序 canvas，静态绘制 — 不参与 web 端的 Catmull-Rom 漂浮动画）。
   *
   * v1.49 (2026-05) — HD 模式可选 emoji 换装：
   *   皮肤可在 boardWatermark 上声明 `hdIcons / hdOpacity / hdScale / hdAnchors`，
   *   仅当 _qualityMode='high' 时切换；其他画质保持基础 icons 控制开销。
   *   与 web/src/renderer.js 同字段同语义。
   *   首批接入：mahjong 仅覆盖 hdIcons（基础 ['🀅','🀀'] → HD ['🎲','🀐']
   *   骰子 + 一索/雀），数量 / 亮度 / scale / 锚点全部继承基础值，与所有皮肤一致。
   */
  _renderBoardWatermark(offsetX, offsetY, total, skin) {
    const wm = skin.boardWatermark;
    if (!wm || !Array.isArray(wm.icons) || wm.icons.length === 0 || total <= 0) return;
    const ctx = this._ctx;

    const isHd = this._qualityMode === 'high';
    const useHdSet = isHd && Array.isArray(wm.hdIcons) && wm.hdIcons.length > 0;
    const icons = useHdSet ? wm.hdIcons : wm.icons;
    const opacity = useHdSet ? (wm.hdOpacity ?? wm.opacity ?? 0.045) : (wm.opacity ?? 0.045);
    const scale = useHdSet ? (wm.hdScale ?? wm.scale ?? 0.24) : (wm.scale ?? 0.24);
    const points = (useHdSet && Array.isArray(wm.hdAnchors) && wm.hdAnchors.length > 0)
      ? wm.hdAnchors
      : [
        [0.23, 0.23],
        [0.77, 0.23],
        [0.50, 0.50],
        [0.23, 0.77],
        [0.77, 0.77],
      ];

    const size = Math.round(total * scale);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `${Math.round(size * 0.88)}px ${ICON_FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(55, 65, 81, 0.88)';
    for (let i = 0; i < points.length; i++) {
      const icon = normalizeCanvasIcon(icons[i % icons.length]);
      ctx.fillText(icon, offsetX + total * points[i][0], offsetY + total * points[i][1]);
    }
    ctx.restore();
  }

  _cellInset(size) {
    const skinInset = this._skin.blockInset ?? 2;
    return Math.max(1, Math.min(skinInset, size * 0.055));
  }

  _cellRadius(paintedSize) {
    const skinRadius = this._skin.blockRadius ?? 5;
    return Math.max(3, Math.min(skinRadius, paintedSize * 0.16));
  }

  /**
   * 按 `skin.blockStyle` 路由到与 web/src/renderer.js 同款的渲染分支。
   * 与 web 对齐的分支：
   *   - cartoon (默认，覆盖 25+ 皮肤)：主色弱渐变 + 弱底部暗角 + 暗外描边 + 浅亮内描边
   *   - bevel3d (classic)：4 梯形浮雕 + 中心面
   *   - neon (neonCity / dawn)：主色横向渐变 + 亮色外描边 + 顶部高光
   *   - metal (titanium)：7 段拉丝纵向渐变
   *   - glass (halo / koi)：主色纵向渐变 + 顶部白光高光 + 双描边
   *   - jelly：主色渐变 + 顶部磨砂 + 径向白光斑
   *   - pixel8：8-bit 凸起瓦片
   *   - flat：纯色 + 极弱描边
   */
  _paintCell(x, y, size, color) {
    const skin = this._skin;
    const ins = this._cellInset(size);
    const s = Math.max(1, size - ins * 2);
    const bx = x + ins;
    const by = y + ins;
    const r = this._cellRadius(s);
    const style = skin.blockStyle || 'cartoon';

    // 带 icon 皮肤的方块色降饱和（对齐 web `paintBlockCell`：深盘 ×0.55 / 浅盘 ×0.92），
    // 让中心 emoji 在哑光底色上更清晰。在此入口统一处理，盘面/候选/ghost 三处一致。
    if (skin.blockIcons && skin.blockIcons.length) {
      color = desaturateColor(color, this._isLightBoard() ? 0.92 : 0.55);
    }

    if (style === 'bevel3d') return this._paintBevel3d(bx, by, s, r, color);
    if (style === 'neon') return this._paintNeon(bx, by, s, r, color);
    if (style === 'metal') return this._paintMetal(bx, by, s, r, color);
    if (style === 'glass') return this._paintGlass(bx, by, s, r, color);
    if (style === 'jelly') return this._paintJelly(bx, by, s, r, color);
    if (style === 'pixel8') return this._paintPixel8(bx, by, s, color);
    if (style === 'flat') return this._paintFlat(bx, by, s, r, color);
    return this._paintCartoon(bx, by, s, r, color);
  }

  /** cartoon —— 哑光磨砂瓷砖。完全对齐 web 同名分支的 alpha 与 lift 数值（lightBoard 差异化）。 */
  _paintCartoon(bx, by, s, r, color) {
    const ctx = this._ctx;
    const skin = this._skin;
    const lightBoard = this._isLightBoard();
    const topLift = lightBoard ? 0.08 : 0.16;
    const botDark = lightBoard ? 0.04 : 0.12;
    const botShadeAlpha = lightBoard ? 0.05 : 0.14;
    const innerStroke = lightBoard ? 'rgba(255,255,255,0.46)' : 'rgba(255,255,255,0.34)';
    const outerStroke = lightBoard ? 'rgba(68,56,40,0.42)' : 'rgba(0,0,0,0.48)';

    // 1. 主色弱渐变
    const baseG = ctx.createLinearGradient(bx, by, bx, by + s);
    baseG.addColorStop(0, lighten(color, topLift));
    baseG.addColorStop(0.5, color);
    baseG.addColorStop(1, darken(color, botDark));
    ctx.fillStyle = baseG;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();

    // 2. 底部黑色暗角（弱）
    const btG = ctx.createLinearGradient(bx, by, bx, by + s);
    btG.addColorStop(0.78, 'rgba(0,0,0,0.00)');
    btG.addColorStop(1, `rgba(0,0,0,${botShadeAlpha})`);
    ctx.fillStyle = btG;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();

    // 3. 暗外描边
    ctx.strokeStyle = outerStroke;
    ctx.lineWidth = 1.35;
    roundRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, Math.max(0, r - 0.5));
    ctx.stroke();

    // 4. 浅亮内描边（白色 bevel 高光）
    ctx.strokeStyle = innerStroke;
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 1, by + 1, s - 2, s - 2, Math.max(0, r - 1));
    ctx.stroke();
    void skin;
  }

  /** bevel3d —— 4 梯形浮雕（与 web bevel3d 同光照模型；零描边）。 */
  _paintBevel3d(bx, by, s, r, color) {
    const ctx = this._ctx;
    const bevel = Math.max(2, Math.round(s * 0.13));
    const ix = bx + bevel;
    const iy = by + bevel;
    const is = s - bevel * 2;

    ctx.save();
    if (r > 0) {
      roundRect(ctx, bx, by, s, s, r);
      ctx.clip();
    }
    // 顶斜切
    ctx.fillStyle = lighten(color, 0.18);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + s, by);
    ctx.lineTo(ix + is, iy);
    ctx.lineTo(ix, iy);
    ctx.closePath();
    ctx.fill();
    // 左斜切
    ctx.fillStyle = lighten(color, 0.06);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ix, iy);
    ctx.lineTo(ix, iy + is);
    ctx.lineTo(bx, by + s);
    ctx.closePath();
    ctx.fill();
    // 右斜切
    ctx.fillStyle = darken(color, 0.16);
    ctx.beginPath();
    ctx.moveTo(bx + s, by);
    ctx.lineTo(bx + s, by + s);
    ctx.lineTo(ix + is, iy + is);
    ctx.lineTo(ix + is, iy);
    ctx.closePath();
    ctx.fill();
    // 底斜切
    ctx.fillStyle = darken(color, 0.32);
    ctx.beginPath();
    ctx.moveTo(bx, by + s);
    ctx.lineTo(ix, iy + is);
    ctx.lineTo(ix + is, iy + is);
    ctx.lineTo(bx + s, by + s);
    ctx.closePath();
    ctx.fill();
    // 中心面（对角渐变近似）
    const fg = ctx.createLinearGradient(ix, iy, ix + is, iy + is);
    fg.addColorStop(0, lighten(color, 0.18));
    fg.addColorStop(0.55, lighten(color, 0.06));
    fg.addColorStop(1, color);
    ctx.fillStyle = fg;
    ctx.fillRect(ix, iy, is, is);
    ctx.restore();
  }

  /** neon —— 主色横向渐变 + 亮色加宽描边 + 顶部高光（仅无 icon 皮肤）。 */
  _paintNeon(bx, by, s, r, color) {
    const ctx = this._ctx;
    const skin = this._skin;
    const g = ctx.createLinearGradient(bx, by, bx + s, by);
    g.addColorStop(0, lighten(color, 0.10));
    g.addColorStop(0.45, color);
    g.addColorStop(1, darken(color, 0.18));
    ctx.fillStyle = g;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();

    ctx.strokeStyle = lighten(color, 0.22);
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, Math.max(0, r - 0.5));
    ctx.stroke();

    if (!skin.blockIcons || !skin.blockIcons.length) {
      const hl = ctx.createLinearGradient(bx, by, bx, by + s);
      hl.addColorStop(0, 'rgba(255,255,255,0.28)');
      hl.addColorStop(0.48, 'rgba(255,255,255,0.00)');
      hl.addColorStop(1, 'rgba(255,255,255,0.00)');
      ctx.fillStyle = hl;
      roundRect(ctx, bx, by, s, s, r);
      ctx.fill();
    }
  }

  /** metal —— 7 段拉丝纵向渐变 + 白边/黑内框。 */
  _paintMetal(bx, by, s, r, color) {
    const ctx = this._ctx;
    const mg = ctx.createLinearGradient(bx, by, bx, by + s);
    mg.addColorStop(0, lighten(color, 0.32));
    mg.addColorStop(0.12, darken(color, 0.08));
    mg.addColorStop(0.42, lighten(color, 0.18));
    mg.addColorStop(0.48, lighten(color, 0.38));
    mg.addColorStop(0.54, darken(color, 0.06));
    mg.addColorStop(0.78, lighten(color, 0.08));
    mg.addColorStop(1, darken(color, 0.28));
    ctx.fillStyle = mg;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, Math.max(0, r - 0.5));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 1.2, by + 1.2, s - 2.4, s - 2.4, Math.max(0, r - 1));
    ctx.stroke();
  }

  /** glass —— 主色纵向渐变 + 顶部白光高光 + 双描边。 */
  _paintGlass(bx, by, s, r, color) {
    const ctx = this._ctx;
    const skin = this._skin;
    const vg = ctx.createLinearGradient(bx, by, bx, by + s);
    vg.addColorStop(0, lighten(color, 0.22));
    vg.addColorStop(0.4, color);
    vg.addColorStop(1, darken(color, 0.06));
    ctx.fillStyle = vg;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();

    const hl = ctx.createLinearGradient(bx, by, bx, by + s);
    hl.addColorStop(0, 'rgba(255,255,255,0.50)');
    hl.addColorStop(0.28, 'rgba(255,255,255,0.14)');
    hl.addColorStop(0.58, 'rgba(255,255,255,0.00)');
    hl.addColorStop(1, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = hl;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();

    ctx.strokeStyle = skin.uiDark ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1.15;
    roundRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, Math.max(0, r - 0.5));
    ctx.stroke();

    ctx.strokeStyle = skin.uiDark ? 'rgba(0,0,0,0.10)' : 'rgba(15,23,42,0.20)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 1, by + 1, s - 2, s - 2, Math.max(0, r - 1));
    ctx.stroke();
  }

  /** jelly —— 主色渐变 + 顶部磨砂 + 径向珠光（简化版）。 */
  _paintJelly(bx, by, s, r, color) {
    const ctx = this._ctx;
    const baseG = ctx.createLinearGradient(bx, by, bx, by + s);
    baseG.addColorStop(0, lighten(color, 0.18));
    baseG.addColorStop(0.5, color);
    baseG.addColorStop(1, darken(color, 0.08));
    ctx.fillStyle = baseG;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();

    const hlG = ctx.createLinearGradient(bx, by, bx, by + s);
    hlG.addColorStop(0, 'rgba(255,255,255,0.60)');
    hlG.addColorStop(0.38, 'rgba(255,255,255,0.20)');
    hlG.addColorStop(0.52, 'rgba(255,255,255,0.00)');
    hlG.addColorStop(1, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = hlG;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();

    ctx.strokeStyle = lighten(color, 0.55);
    ctx.lineWidth = 1.8;
    roundRect(ctx, bx + 0.9, by + 0.9, s - 1.8, s - 1.8, Math.max(0, r - 0.9));
    ctx.stroke();
    ctx.strokeStyle = darken(color, 0.30);
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 1.5, by + 1.5, s - 3, s - 3, Math.max(0, r - 1.5));
    ctx.stroke();
  }

  /** pixel8 —— 8-bit 凸起瓦片：4 边亮/暗边 + 内陷主面。 */
  _paintPixel8(bx, by, s, color) {
    const ctx = this._ctx;
    const ew = Math.max(1, Math.round(s * 0.14));
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, s, s);
    ctx.fillStyle = darken(color, 0.10);
    ctx.fillRect(bx + ew, by + ew, s - ew * 2, s - ew * 2);
    ctx.fillStyle = lighten(color, 0.55);
    ctx.fillRect(bx + ew, by, s - ew * 2, ew);
    ctx.fillStyle = lighten(color, 0.32);
    ctx.fillRect(bx, by + ew, ew, s - ew * 2);
    ctx.fillStyle = darken(color, 0.32);
    ctx.fillRect(bx + s - ew, by + ew, ew, s - ew * 2);
    ctx.fillStyle = darken(color, 0.55);
    ctx.fillRect(bx + ew, by + s - ew, s - ew * 2, ew);
  }

  /** flat —— 纯色 + 极弱描边。 */
  _paintFlat(bx, by, s, r, color) {
    const ctx = this._ctx;
    ctx.fillStyle = color;
    roundRect(ctx, bx, by, s, s, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 0.5, by + 0.5, s - 1, s - 1, Math.max(0, r - 0.5));
    ctx.stroke();
  }

  /** isLightBoardSkin 复刻（对齐 web）：gridCell 相对亮度 ≥ 0.78 视为浅盘。 */
  _isLightBoard() {
    const skin = this._skin;
    const rgb = hexToRgb(skin.gridCell || '#000000');
    if (!rgb) return skin.uiDark === false;
    const luma = (rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722) / 255;
    return luma >= 0.78;
  }

  _drawCellIcon(x, y, size, colorIdx) {
    const icons = this._skin.blockIcons;
    const safeSize = Number.isFinite(size) && size > 0 ? size : 0;
    if (!icons || !icons.length || safeSize < 14) return;
    const icon = icons[colorIdx % icons.length];
    if (!icon) return;
    const ctx = this._ctx;
    const skin = this._skin;
    const ins = this._cellInset(size);
    const bx = x + ins;
    const by = y + ins;
    const s = Math.max(1, size - ins * 2);
    const r = this._cellRadius(s);
    ctx.save();
    const assetUrl = Array.isArray(skin.blockIconAssets) ? skin.blockIconAssets[colorIdx % skin.blockIconAssets.length] : null;
    const assetImg = this._getBlockIconAsset(assetUrl);
    if (assetImg) {
      roundRect(ctx, bx, by, s, s, r);
      ctx.clip();
      const pad = Math.max(2, s * 0.18);
      ctx.globalAlpha = 1.0;
      ctx.drawImage(assetImg, bx + pad, by + pad, s - pad * 2, s - pad * 2);
      ctx.restore();
      return;
    }
    const canvasIcon = normalizeCanvasIcon(icon);
    if (skin.id === 'mahjong') {
      roundRect(ctx, bx, by, s, s, r);
      ctx.clip();
      paintMahjongTileIcon(ctx, bx, by, s, canvasIcon, colorIdx);
    } else {
      // 严格对齐 web `_paintIcon`：face×0.56 字号 + cy 偏移 0.53 + 三层阴影（深/浅盘差异化），
      // clip 到方块圆角内。emoji 字体栈一致 → emoji 字形与 web 同步。
      roundRect(ctx, bx, by, s, s, r);
      ctx.clip();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(10, Math.round(s * 0.56))}px ${ICON_FONT_STACK}`;
      const ccx = bx + s * 0.5;
      const ccy = by + s * 0.53;
      ctx.globalAlpha = 1.0;
      const sh = this._isLightBoard()
        ? ['rgba(0,0,0,0.14)', 'rgba(0,0,0,0.08)', '#2C2418']
        : ['rgba(0,0,0,0.34)', 'rgba(0,0,0,0.20)', '#000000'];
      ctx.fillStyle = sh[0];
      ctx.fillText(canvasIcon, ccx + 0.6, ccy + 0.8);
      ctx.fillStyle = sh[1];
      ctx.fillText(canvasIcon, ccx + 1.0, ccy + 1.4);
      ctx.fillStyle = sh[2];
      ctx.fillText(canvasIcon, ccx, ccy);
    }
    ctx.restore();
  }

  _getBlockIconAsset(url) {
    if (!url || !this._canvas || typeof this._canvas.createImage !== 'function') return null;
    let entry = this._iconAssetCache.get(url);
    if (!entry) {
      const img = this._canvas.createImage();
      entry = { img, ready: false, failed: false };
      img.onload = () => { entry.ready = true; };
      img.onerror = () => { entry.failed = true; };
      img.src = url;
      this._iconAssetCache.set(url, entry);
    }
    return entry.ready && !entry.failed ? entry.img : null;
  }

  /** 绘制候选块（dock 区域中的小预览） */
  drawDockBlock(shape, colorIdx, x, y, cellSize) {
    if (!Array.isArray(shape) || !Number.isFinite(cellSize) || cellSize <= 0) return;
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
    /* 关闭特效时仍允许清空（cells 为空），但拒绝新的高亮，避免残留闪烁。 */
    if (!this._effectsEnabled && cells && cells.length) {
      this.clearCells = [];
      return;
    }
    this.clearCells = cells || [];
  }

  setPreviewClearCells(cells) {
    if (!this._effectsEnabled && cells && cells.length) {
      this.previewClearCells = [];
      return;
    }
    this.previewClearCells = cells || [];
  }

  /**
   * 待消除高亮 —— 严格复刻 web/src/renderer.js `renderPreviewClearHint`（under fill + over stroke 二合一）：
   *
   *   pulse = 0.55 + 0.45 * |sin(now * 0.007)|       周期 ~900ms 柔和呼吸
   *   inset = skin.blockInset ?? 2                    高亮 = 块面大小（不是全格）
   *   br    = skin.blockRadius ?? 5                   圆角 = 皮肤方块圆角
   *
   *   under (fill)  : rgba(255, 210, 90, 0.12 + 0.18*pulse), globalAlpha = 1
   *   over  (stroke): rgba(255, 200, 60, 0.55 + 0.40*pulse), globalAlpha = 0.92,
   *                   lineWidth = 2.25,
   *                   shadowColor = rgba(255, 220, 120, 0.65), shadowBlur = 5 + 4*pulse
   *
   * 小程序 Canvas2D 支持 shadowBlur，可与 web 完全等价。
   */
  renderPreviewClearCells(offsetX = 0, offsetY = 0) {
    if (!this.previewClearCells || this.previewClearCells.length === 0 || this._cellSizeForFx <= 0) return;
    const ctx = this._ctx;
    const skin = this._skin || {};
    const cs = this._cellSizeForFx;
    const inset = skin.blockInset != null ? skin.blockInset : 2;
    const br = skin.blockRadius != null ? skin.blockRadius : 5;
    const size = Math.max(1, cs - inset * 2);
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(Date.now() * 0.007));

    ctx.save();

    // === Pass 1: under-fill ===
    ctx.fillStyle = `rgba(255, 210, 90, ${0.12 + 0.18 * pulse})`;
    ctx.globalAlpha = 1;
    for (const c of this.previewClearCells) {
      const x = c.x != null ? c.x : c[0];
      const y = c.y != null ? c.y : c[1];
      const px = offsetX + x * cs + inset;
      const py = offsetY + y * cs + inset;
      if (br > 0) {
        roundRect(ctx, px, py, size, size, br);
        ctx.fill();
      } else {
        ctx.fillRect(px, py, size, size);
      }
    }

    // === Pass 2: over-stroke + shadowBlur 柔光 ===
    ctx.strokeStyle = `rgba(255, 200, 60, ${0.55 + 0.4 * pulse})`;
    ctx.lineWidth = 2.25;
    ctx.globalAlpha = 0.92;
    ctx.shadowColor = 'rgba(255, 220, 120, 0.65)';
    ctx.shadowBlur = 5 + 4 * pulse;
    for (const c of this.previewClearCells) {
      const x = c.x != null ? c.x : c[0];
      const y = c.y != null ? c.y : c[1];
      const px = offsetX + x * cs + inset;
      const py = offsetY + y * cs + inset;
      if (br > 0) {
        roundRect(ctx, px + 0.5, py + 0.5, size - 1, size - 1, Math.max(0, br - 0.5));
        ctx.stroke();
      } else {
        ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
      }
    }
    ctx.shadowBlur = 0;
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
    if (!this._effectsEnabled) return;
    if (!Array.isArray(cells) || !cells.length || !cellSize) return;
    const qScale = this._qualityParticleScale();
    countPerCell = Math.max(1, Math.round(countPerCell * qScale));
    const maxParticles = Math.max(24, Math.round(96 * qScale));
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
    if (!this._effectsEnabled) return;
    if (!cellSize) return;
    const rows = lines.rows || [];
    const cols = lines.cols || [];
    const n = Math.max(1, this._gridLogicalSize / cellSize || 8);
    const strength = Math.max(2, lineCount || rows.length + cols.length);
    const qScale = this._qualityParticleScale();
    const maxParticles = Math.max(24, Math.round(Math.min(140, 44 + strength * 22) * qScale));
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
    if (!this._effectsEnabled) return;
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
    const qScale = this._qualityParticleScale();
    const count = Math.max(20, Math.round(Math.min(180, 72 + (bonusLines.length || 1) * 34) * qScale));

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

    const sparkLimit = Math.max(4, Math.round(28 * qScale));
    for (let k = 0; k < Math.min(sparkLimit, source.length); k++) {
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
   * 同花顺色块爆发 —— 严格对齐 web 主端 `addBonusLineBurst(bonusLine, cssColor, count=64)`：
   *
   *   主粒子 N=count：spread 3.20 / speed 4.5-22 px/帧 / life 1.45-2.10 / size 7-25 / 金·cssColor·白 轮转
   *   内圈高速 36 ：  全方位 angle / speed 8-28 / life 1.25-1.70 / size 3.5-10.5 / 白·cssColor 交替
   *   金色火花 36 ：  水平 ±18 / 强烈向上 12-28 / life 1.75-2.20 / size 3-9 / 纯金 #FFD700
   *
   * 之前 miniprogram 用的是 web 旧 spec（count=48 / spread 2.75 / speed 12 / sideCount 22），
   * 已落后于主端最新数值，导致同花顺粒子明显不如 web 主端绚烂。本轮严格回归 1:1。
   * @param {{ type:'row'|'col', idx:number }} bonusLine
   * @param {string} cssColor
   * @param {number} [count=64]
   * @param {number} gridSize
   * @param {number} cellSize
   */
  addBonusLineBurst(bonusLine, cssColor, count = 64, gridSize, cellSize) {
    if (!this._effectsEnabled) return;
    const n = gridSize;
    const cs = cellSize;
    const qScale = this._qualityParticleScale();
    count = Math.max(8, Math.round(count * qScale));
    const side2 = Math.max(6, Math.round(36 * qScale));
    const side3 = Math.max(6, Math.round(36 * qScale));
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
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 3.20;
      const speed = 4.5 + Math.random() * 17.5;
      const color = i % 3 === 0 ? gold : i % 3 === 1 ? cssColor : white;
      pushBurst(x, y, angle, speed, color,
        1.45 + Math.random() * 0.65,
        0.0042 + Math.random() * 0.0035,
        7 + Math.random() * 18,
        0.48);
    }
    for (let k = 0; k < side2; k++) {
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
      const speed = 8 + Math.random() * 20;
      pushBurst(x, y, angle, speed, k % 2 ? white : cssColor,
        1.25 + Math.random() * 0.45,
        0.0055 + Math.random() * 0.0048,
        3.5 + Math.random() * 7,
        0.34);
    }
    for (let j = 0; j < side3; j++) {
      let x;
      let y;
      if (bonusLine.type === 'row') {
        x = cs * (Math.random() * n);
        y = cs * (bonusLine.idx + 0.5);
      } else {
        x = cs * (bonusLine.idx + 0.5);
        y = cs * (Math.random() * n);
      }
      const lj = 1.75 + Math.random() * 0.45;
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 36,
        vy: -(12 + Math.random() * 16),
        color: gold,
        life: lj,
        lifeMax: lj,
        lifeDecay: 0.0058 + Math.random() * 0.004,
        size: 3 + Math.random() * 6,
        gravityMul: 0.40,
      });
    }
  }

  /**
   * 同花顺色块持续涌出 —— 严格对齐 web 主端 `beginBonusColorGush(lineSpecs, durationMs)`：
   *
   *   首帧每条 bonusLine 强爆发 42 个 strongBurst 色块；
   *   整段 durationMs 内 _tickColorGushSpawn 按时间窗节奏 spawn：
   *     t < 0.36：82% × 3 / 18% × 2
   *     t < 0.76：62% × 2 / 38% × 1
   *     末段    ：40% × 1 / 60% × 0
   *
   * 单次粒子参数同 `_pushBonusColorParticle`：spread strong 3.15 / 常规 2.85；
   * speed strong 4.8-20.3 / 常规 3.4-14.4；life 1.20-1.82；size 2.8-13.8（strong）/2.8-10.3（常规）；
   * 颜色 34% 金 / 34% cssColor / 32% 白。
   *
   * 缺失此层会让"同花顺消除"明显缺氛围；miniprogram 之前完全没接，现补齐。
   * @param {Array<{bonusLine:{type:'row'|'col',idx:number}, cssColor:string}>} lineSpecs
   * @param {number} durationMs
   * @param {number} gridSize
   * @param {number} cellSize
   */
  beginBonusColorGush(lineSpecs, durationMs, gridSize, cellSize) {
    if (!this._effectsEnabled) return;
    if (!lineSpecs || !lineSpecs.length) return;
    this._colorGushLines = lineSpecs.map((s) => ({ bonusLine: s.bonusLine, cssColor: s.cssColor }));
    this._colorGushCs = cellSize;
    this._colorGushN = gridSize;
    const now = Date.now();
    this._colorGushStart = now;
    this._colorGushEnd = now + Math.max(520, durationMs);
    for (const spec of this._colorGushLines) {
      for (let i = 0; i < 42; i++) {
        this._pushBonusColorParticle(spec.bonusLine, spec.cssColor, true);
      }
    }
  }

  /** 单个色块粒子生成（与 web `_pushBonusColorParticle` 1:1）。 */
  _pushBonusColorParticle(bonusLine, cssColor, strong) {
    const n = this._colorGushN;
    const cs = this._colorGushCs;
    if (!n || !cs) return;
    let x;
    let y;
    if (bonusLine.type === 'row') {
      x = cs * (Math.random() * n);
      y = cs * (bonusLine.idx + 0.5);
    } else {
      x = cs * (bonusLine.idx + 0.5);
      y = cs * (Math.random() * n);
    }
    const gold = '#FFD700';
    const white = '#FFFFFF';
    const roll = Math.random();
    const color = roll < 0.34 ? gold : roll < 0.68 ? cssColor : white;
    const spread = strong ? 3.15 : 2.85;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const speed = (strong ? 4.8 : 3.4) + Math.random() * (strong ? 15.5 : 11.0);
    const life0 = 1.20 + Math.random() * 0.62;
    this.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (1.4 + Math.random() * 3.0),
      color,
      life: life0,
      lifeMax: life0,
      lifeDecay: 0.0036 + Math.random() * 0.0036,
      size: 2.8 + Math.random() * (strong ? 11 : 7.5),
      gravityMul: 0.42 + Math.random() * 0.14,
    });
  }

  /** 在 updateParticles 内 tick：按 web 时间窗节奏持续 spawn。 */
  _tickColorGushSpawn() {
    if (!this._colorGushLines || !this._colorGushLines.length) return;
    const now = Date.now();
    if (now >= this._colorGushEnd) {
      this._colorGushLines = [];
      return;
    }
    // web 上限 particles.length > 620 直接套用
    if (this.particles.length > 620) return;
    const span = Math.max(1, this._colorGushEnd - this._colorGushStart);
    const t = (now - this._colorGushStart) / span;
    let rolls = 0;
    if (t < 0.36) rolls = Math.random() < 0.82 ? 3 : 2;
    else if (t < 0.76) rolls = Math.random() < 0.62 ? 2 : 1;
    else rolls = Math.random() < 0.40 ? 1 : 0;
    const strong = t < 0.15;
    for (const spec of this._colorGushLines) {
      for (let k = 0; k < rolls; k++) {
        this._pushBonusColorParticle(spec.bonusLine, spec.cssColor, strong);
      }
    }
  }

  updateParticles() {
    this._tickColorGushSpawn();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.damping != null) {
        p.vx *= p.damping;
        p.vy *= p.damping;
      }
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
    this._colorGushLines = [];
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
    if (!this._effectsEnabled) return;
    /* low 画质：保留抖动但削弱 60%，确保仍有"打击感"。 */
    const damp = this._qualityMode === 'low' ? 0.4 : 1;
    this.shakeIntensity = intensity * damp;
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
    if (!this._effectsEnabled) return;
    this._perfectFlash = 1.0;
    this._perfectHue = 0;
  }

  triggerDoubleWave(clearedRows) {
    if (!this._effectsEnabled) return;
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
    if (!this._effectsEnabled) return;
    const n = Math.max(3, lineCount || 3);
    this._comboFlash = Math.min(0.95, 0.28 + n * 0.09);
  }

  triggerBonusMatchFlash(bonusLineCount = 1) {
    if (!this._effectsEnabled) return;
    const n = Math.max(1, bonusLineCount);
    this._bonusMatchFlash = Math.min(1, 0.55 + n * 0.18);
  }

  triggerBigBlast(bonusLineCount = 1) {
    if (!this._effectsEnabled) return;
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
