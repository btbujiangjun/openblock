/**
 * Block Blast - Renderer
 * Canvas rendering；盘面与方块样式随 `skins.js` 当前主题变化
 */
import { CONFIG } from './config.js';
import { getActiveSkin, getBlockColors } from './skins.js';

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function darkenColor(hex, percent) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return `rgb(${Math.floor(rgb.r * (1 - percent))}, ${Math.floor(rgb.g * (1 - percent))}, ${Math.floor(rgb.b * (1 - percent))})`;
}

function lightenColor(hex, percent) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return `rgb(${Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * percent))}, ${Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * percent))}, ${Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * percent))})`;
}

/** @param {CanvasRenderingContext2D} ctx */
function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, rr);
    } else {
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cellPx 格左上角 x（整格坐标）
 */
function paintBlockCell(ctx, cellPx, cellPy, cellS, color, skin) {
    const inset = skin.blockInset;
    const size = Math.max(1, cellS - inset * 2);
    const bx = cellPx + inset;
    const by = cellPy + inset;
    const r = skin.blockRadius;

    if (skin.blockStyle === 'flat') {
        ctx.fillStyle = color;
        if (r > 0) {
            roundRectPath(ctx, bx, by, size, size, r);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.14)';
            ctx.lineWidth = 1;
            roundRectPath(ctx, bx + 0.5, by + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
            ctx.stroke();
        } else {
            ctx.fillRect(bx, by, size, size);
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx + 0.5, by + 0.5, size - 1, size - 1);
        }
        return;
    }

    if (skin.blockStyle === 'glass') {
        ctx.save();
        if (r > 0) {
            roundRectPath(ctx, bx, by, size, size, r);
            ctx.clip();
        }
        const vg = ctx.createLinearGradient(cellPx, cellPy, cellPx, cellPy + cellS);
        vg.addColorStop(0, lightenColor(color, 0.22));
        vg.addColorStop(0.4, color);
        vg.addColorStop(1, darkenColor(color, 0.06));
        ctx.fillStyle = vg;
        ctx.fillRect(bx, by, size, size);
        const hl = ctx.createLinearGradient(cellPx, cellPy, cellPx, cellPy + size * 0.58);
        hl.addColorStop(0, 'rgba(255,255,255,0.5)');
        hl.addColorStop(0.28, 'rgba(255,255,255,0.14)');
        hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl;
        ctx.fillRect(bx, by, size, size * 0.58);
        ctx.restore();

        ctx.strokeStyle = skin.uiDark ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.32)';
        ctx.lineWidth = 1.15;
        if (r > 0) {
            roundRectPath(ctx, bx + 0.5, by + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
            ctx.stroke();
        } else {
            ctx.strokeRect(bx + 0.5, by + 0.5, size - 1, size - 1);
        }
        ctx.strokeStyle = skin.uiDark ? 'rgba(0,0,0,0.1)' : 'rgba(15,23,42,0.2)';
        ctx.lineWidth = 1;
        if (r > 0) {
            roundRectPath(ctx, bx + 1, by + 1, size - 2, size - 2, Math.max(0, r - 1));
            ctx.stroke();
        }
        return;
    }

    if (skin.blockStyle === 'metal') {
        ctx.save();
        if (r > 0) {
            roundRectPath(ctx, bx, by, size, size, r);
            ctx.clip();
        }
        const mg = ctx.createLinearGradient(cellPx, cellPy, cellPx, cellPy + cellS);
        mg.addColorStop(0, lightenColor(color, 0.32));
        mg.addColorStop(0.12, darkenColor(color, 0.08));
        mg.addColorStop(0.42, lightenColor(color, 0.18));
        mg.addColorStop(0.48, lightenColor(color, 0.38));
        mg.addColorStop(0.54, darkenColor(color, 0.06));
        mg.addColorStop(0.78, lightenColor(color, 0.08));
        mg.addColorStop(1, darkenColor(color, 0.28));
        ctx.fillStyle = mg;
        ctx.fillRect(bx, by, size, size);
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.2;
        if (r > 0) {
            roundRectPath(ctx, bx + 0.5, by + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.32)';
        ctx.lineWidth = 1;
        if (r > 0) {
            roundRectPath(ctx, bx + 1.2, by + 1.2, size - 2.4, size - 2.4, Math.max(0, r - 1));
            ctx.stroke();
        }
        return;
    }

    if (skin.blockStyle === 'neon') {
        const g = ctx.createLinearGradient(cellPx, cellPy, cellPx + cellS, cellPy);
        g.addColorStop(0, lightenColor(color, 0.1));
        g.addColorStop(0.45, color);
        g.addColorStop(1, darkenColor(color, 0.18));
        ctx.save();
        if (r > 0) {
            roundRectPath(ctx, bx, by, size, size, r);
            ctx.clip();
        }
        ctx.fillStyle = g;
        ctx.fillRect(bx, by, size, size);
        ctx.restore();

        ctx.strokeStyle = lightenColor(color, 0.22);
        ctx.lineWidth = 1.5;
        if (r > 0) {
            roundRectPath(ctx, bx + 0.5, by + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
            ctx.stroke();
        } else {
            ctx.strokeRect(bx + 0.5, by + 0.5, size - 1, size - 1);
        }

        ctx.save();
        if (r > 0) {
            roundRectPath(ctx, bx, by, size, size, r);
            ctx.clip();
        }
        const hl = ctx.createLinearGradient(cellPx, cellPy, cellPx, cellPy + size * 0.48);
        hl.addColorStop(0, 'rgba(255,255,255,0.28)');
        hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl;
        ctx.fillRect(bx, by, size, size * 0.48);
        ctx.restore();
        return;
    }

    // glossy
    ctx.save();
    if (r > 0) {
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.clip();
    }
    const gradient = ctx.createLinearGradient(cellPx, cellPy, cellPx + cellS, cellPy);
    gradient.addColorStop(0, darkenColor(color, 0.15));
    gradient.addColorStop(0.2, color);
    gradient.addColorStop(0.5, lightenColor(color, 0.15));
    gradient.addColorStop(1, darkenColor(color, 0.2));
    ctx.fillStyle = gradient;
    ctx.fillRect(bx, by, size, size);
    const hl = ctx.createLinearGradient(cellPx, cellPy, cellPx, cellPy + size * 0.5);
    hl.addColorStop(0, 'rgba(255,255,255,0.5)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(bx, by, size, size * 0.5);
    ctx.restore();

    const tri = Math.max(2, size * 0.12);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(bx + tri, by + tri);
    ctx.lineTo(bx + size * 0.38, by + tri);
    ctx.lineTo(bx + tri, by + size * 0.38);
    ctx.closePath();
    ctx.fill();

    if (r > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.42)';
        ctx.lineWidth = 1.25;
        roundRectPath(ctx, bx + 0.5, by + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.26)';
        ctx.lineWidth = 1;
        roundRectPath(ctx, bx + 1, by + 1, size - 2, size - 2, Math.max(0, r - 1));
        ctx.stroke();
    } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, by + size);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + size, by);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(bx + size, by);
        ctx.lineTo(bx + size, by + size);
        ctx.lineTo(bx, by + size);
        ctx.stroke();
    }
}

/** 候选区单槽边长 = 盘面实际显示宽度的一半（4 格 vs 8 格），与格子像素对齐 */
export function syncGridDisplayPx(canvas) {
    if (typeof document === 'undefined' || !canvas) return;
    const w = canvas.getBoundingClientRect().width;
    if (w > 1) {
        document.documentElement.style.setProperty('--grid-display-px', `${w}px`);
    }
}

const _gridDisplayRo = new WeakMap();

/** 监听棋盘 canvas 的 CSS 尺寸（缩放、侧栏挤压等），保持候选块与盘面一格同大 */
export function ensureGridDisplayResizeSync(canvas) {
    if (typeof document === 'undefined' || !canvas || _gridDisplayRo.has(canvas)) {
        return;
    }
    const run = () => {
        requestAnimationFrame(() => syncGridDisplayPx(canvas));
    };
    run();
    window.addEventListener('resize', run);
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(run);
        ro.observe(canvas);
        _gridDisplayRo.set(canvas, ro);
    }
}

function syncGridCanvasCssVar(canvas, cellSize) {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--grid-canvas-width', `${canvas.width}px`);
    if (cellSize != null && cellSize > 0) {
        document.documentElement.style.setProperty('--dock-cell-size', `${cellSize}px`);
    }
    requestAnimationFrame(() => syncGridDisplayPx(canvas));
}

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.cellSize = CONFIG.CELL_SIZE;
        this.gridSize = CONFIG.GRID_SIZE;
        this.canvas.width = this.gridSize * this.cellSize;
        this.canvas.height = this.gridSize * this.cellSize;
        syncGridCanvasCssVar(this.canvas, this.cellSize);
        ensureGridDisplayResizeSync(this.canvas);
        this.particles = [];
        this.clearCells = [];
        this.shakeOffset = { x: 0, y: 0 };
        this.shakeIntensity = 0;
        this.shakeDuration = 0;
        this.shakeStart = 0;
        /** COMBO（多消）全屏暖色闪光强度 0~1，每帧衰减 */
        this._comboFlash = 0;
        this._perfectFlash = 0;
        this._perfectHue = 0;
        /** Double 消除：涟漪扩散效果 0~1 */
        this._doubleWave = 0;
        this._doubleWaveRows = [];
    }

    /** 与逻辑层 Grid 尺寸对齐（策略可改边长） */
    setGridSize(size) {
        const n = Math.max(1, Math.floor(size));
        this.gridSize = n;
        this.canvas.width = n * this.cellSize;
        this.canvas.height = n * this.cellSize;
        syncGridCanvasCssVar(this.canvas, this.cellSize);
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    renderBackground() {
        const skin = getActiveSkin();
        const g = skin.gridGap;
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        this.ctx.fillStyle = skin.gridOuter;
        this.ctx.fillRect(-10, -10, this.canvas.width + 20, this.canvas.height + 20);

        this.ctx.fillStyle = skin.gridCell;
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const px = x * this.cellSize + g;
                const py = y * this.cellSize + g;
                this.ctx.fillRect(px, py, this.cellSize - 2 * g, this.cellSize - 2 * g);
            }
        }

        if (skin.gridLine !== false) {
            const w = this.gridSize * this.cellSize;
            let lineStyle = skin.gridLine;
            if (!lineStyle) {
                lineStyle = skin.uiDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.16)';
            }
            this.ctx.strokeStyle = lineStyle;
            this.ctx.lineWidth = 1;
            this.ctx.lineCap = 'butt';
            for (let i = 1; i < this.gridSize; i++) {
                const p = i * this.cellSize + 0.5;
                this.ctx.beginPath();
                this.ctx.moveTo(p, 0);
                this.ctx.lineTo(p, w);
                this.ctx.stroke();
            }
            for (let j = 1; j < this.gridSize; j++) {
                const p = j * this.cellSize + 0.5;
                this.ctx.beginPath();
                this.ctx.moveTo(0, p);
                this.ctx.lineTo(w, p);
                this.ctx.stroke();
            }
        }

        this.ctx.restore();
    }

    renderGrid(grid) {
        const skin = getActiveSkin();
        const palette = getBlockColors();
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                if (grid.cells[y][x] !== null) {
                    const c = palette[grid.cells[y][x]];
                    if (c) {
                        this.drawBlock(x, y, c, skin);
                    }
                }
            }
        }

        this.ctx.restore();
    }

    renderPreview(x, y, block) {
        if (!block) return;
        const skin = getActiveSkin();
        const palette = getBlockColors();

        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
        this.ctx.globalAlpha = 0.5;

        for (let py = 0; py < block.height; py++) {
            for (let px = 0; px < block.width; px++) {
                if (block.shape[py][px]) {
                    const c = palette[block.colorIdx];
                    if (c) this.drawBlock(x + px, y + py, c, skin);
                }
            }
        }

        this.ctx.restore();
    }

    renderClearCells(cells) {
        if (!cells || cells.length === 0) return;
        const skin = getActiveSkin();
        const inset = skin.blockInset;
        const pulse = 0.65 + 0.35 * Math.abs(Math.sin(Date.now() * 0.008));

        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        const br = skin.blockRadius;
        for (const cell of cells) {
            const px = cell.x * this.cellSize + inset;
            const py = cell.y * this.cellSize + inset;
            const size = this.cellSize - inset * 2;

            this.ctx.fillStyle = skin.clearFlash;
            this.ctx.globalAlpha = 0.92 * pulse;
            if (br > 0) {
                roundRectPath(this.ctx, px, py, size, size, br);
                this.ctx.fill();
            } else {
                this.ctx.fillRect(px, py, size, size);
            }

            this.ctx.globalAlpha = 0.4 * pulse;
            this.ctx.shadowColor = skin.clearFlash;
            this.ctx.shadowBlur = 8;
            if (br > 0) {
                roundRectPath(this.ctx, px, py, size, size, br);
                this.ctx.fill();
            } else {
                this.ctx.fillRect(px, py, size, size);
            }
            this.ctx.shadowBlur = 0;
        }

        this.ctx.restore();
    }

    /** @param {object} [skin] 来自 getActiveSkin()；省略则内部读取 */
    drawBlock(x, y, color, skin) {
        const s = this.cellSize;
        const px = x * s;
        const py = y * s;
        paintBlockCell(this.ctx, px, py, s, color, skin || getActiveSkin());
    }

    drawDockBlock(ctx, x, y, color, cellSize) {
        const s = cellSize || this.cellSize;
        const px = x * s;
        const py = y * s;
        paintBlockCell(ctx, px, py, s, color, getActiveSkin());
    }

    /**
     * @param {{ x: number, y: number, color: number }[]} cells
     * @param {{ lines?: number }} [opts] lines≥3 时视为 COMBO，粒子更密、带金色火花
     */
    addParticles(cells, opts = {}) {
        const lines = opts.lines ?? 1;
        const isPerfect = opts.perfectClear ?? false;
        const isCombo = lines >= 3;
        const isDouble = lines === 2;
        const palette = getBlockColors();

        const perCell = isPerfect ? 22 : isCombo ? 15 : isDouble ? 11 : 8;
        const speed = isPerfect ? 2.0 : isCombo ? 1.55 : isDouble ? 1.25 : 1;
        const lifeDecay = isPerfect ? 0.014 : isCombo ? 0.019 : isDouble ? 0.024 : 0.03;
        const baseLife = isPerfect ? 1.3 : isCombo ? 1.12 : isDouble ? 1.06 : 1;

        const rainbowColors = ['#FF4444', '#FF8800', '#FFDD00', '#44DD44', '#4488FF', '#AA44FF'];

        for (const cell of cells) {
            const color = isPerfect
                ? rainbowColors[Math.floor(Math.random() * rainbowColors.length)]
                : (palette[cell.color] || '#FFFFFF');
            for (let i = 0; i < perCell; i++) {
                const ang = Math.random() * Math.PI * 2;
                const sp = (3 + Math.random() * 10) * speed;
                this.particles.push({
                    x: cell.x * this.cellSize + this.cellSize / 2,
                    y: cell.y * this.cellSize + this.cellSize / 2,
                    vx: Math.cos(ang) * sp + (Math.random() - 0.5) * 3,
                    vy: Math.sin(ang) * sp + (Math.random() - 0.5) * 3 - 4,
                    color,
                    life: baseLife,
                    lifeDecay,
                    size: (isCombo ? 3 : 4) + Math.random() * (isCombo ? 5 : 4)
                });
            }
            if (isCombo || isPerfect) {
                const sparkCount = isPerfect ? 10 : 6;
                for (let j = 0; j < sparkCount; j++) {
                    this.particles.push({
                        x: cell.x * this.cellSize + this.cellSize / 2,
                        y: cell.y * this.cellSize + this.cellSize / 2,
                        vx: (Math.random() - 0.5) * (isPerfect ? 24 : 18),
                        vy: (Math.random() - 0.5) * (isPerfect ? 24 : 18) - 6,
                        color: isPerfect
                            ? rainbowColors[j % rainbowColors.length]
                            : (j % 2 === 0 ? '#FFD700' : '#FFF8DC'),
                        life: isPerfect ? 1.35 : 1.15,
                        lifeDecay: isPerfect ? 0.012 : 0.016,
                        size: 2 + Math.random() * (isPerfect ? 4 : 3)
                    });
                }
            }
        }
    }

    /** Perfect Clear 彩虹脉冲特效 */
    triggerPerfectFlash() {
        this._perfectFlash = 1.0;
        this._perfectHue = 0;
    }

    decayPerfectFlash() {
        if (!this._perfectFlash || this._perfectFlash <= 0) return;
        this._perfectFlash *= 0.955;
        this._perfectHue = (this._perfectHue + 6) % 360;
        if (this._perfectFlash < 0.02) this._perfectFlash = 0;
    }

    renderPerfectFlash() {
        if (!this._perfectFlash || this._perfectFlash <= 0) return;
        const a = this._perfectFlash;
        const cx = this.canvas.width * 0.5;
        const cy = this.canvas.height * 0.5;
        const r = Math.max(this.canvas.width, this.canvas.height) * 0.85;
        const g = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const h = this._perfectHue;
        g.addColorStop(0, `hsla(${h}, 100%, 75%, ${0.3 * a})`);
        g.addColorStop(0.3, `hsla(${(h + 60) % 360}, 100%, 65%, ${0.15 * a})`);
        g.addColorStop(0.6, `hsla(${(h + 120) % 360}, 100%, 60%, ${0.06 * a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
        this.ctx.fillStyle = g;
        this.ctx.fillRect(-this.shakeOffset.x, -this.shakeOffset.y, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    /** Double 消除涟漪：沿消除行扩散的水平光波 */
    triggerDoubleWave(clearedRows) {
        this._doubleWave = 1.0;
        this._doubleWaveRows = clearedRows;
    }

    decayDoubleWave() {
        if (this._doubleWave <= 0) return;
        this._doubleWave *= 0.94;
        if (this._doubleWave < 0.02) this._doubleWave = 0;
    }

    renderDoubleWave() {
        if (this._doubleWave <= 0 || !this._doubleWaveRows.length) return;
        const a = this._doubleWave;
        const spread = (1 - a) * this.canvas.width * 0.6;
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
        for (const row of this._doubleWaveRows) {
            const cy = (row + 0.5) * this.cellSize;
            const g = this.ctx.createLinearGradient(
                this.canvas.width * 0.5 - spread, cy,
                this.canvas.width * 0.5 + spread, cy
            );
            g.addColorStop(0, `rgba(46, 204, 113, 0)`);
            g.addColorStop(0.3, `rgba(46, 204, 113, ${0.25 * a})`);
            g.addColorStop(0.5, `rgba(255, 255, 255, ${0.35 * a})`);
            g.addColorStop(0.7, `rgba(46, 204, 113, ${0.25 * a})`);
            g.addColorStop(1, `rgba(46, 204, 113, 0)`);
            this.ctx.fillStyle = g;
            this.ctx.fillRect(0, cy - this.cellSize * 0.6, this.canvas.width, this.cellSize * 1.2);
        }
        this.ctx.restore();
    }

    /** 多消时全屏边缘暖光（与 _comboFlash 配合） */
    triggerComboFlash(lineCount) {
        const n = Math.max(3, lineCount);
        this._comboFlash = Math.min(0.95, 0.28 + n * 0.09);
    }

    decayComboFlash() {
        if (this._comboFlash <= 0) return;
        /* 略慢于普通消行闪光，使 combo 暖光多停留约半秒量级 */
        this._comboFlash *= 0.91;
        if (this._comboFlash < 0.018) this._comboFlash = 0;
    }

    renderComboFlash() {
        if (this._comboFlash <= 0) return;
        const a = this._comboFlash;
        const cx = this.canvas.width * 0.5;
        const cy = this.canvas.height * 0.5;
        const r = Math.max(this.canvas.width, this.canvas.height) * 0.72;
        const g = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255, 230, 140, ${0.22 * a})`);
        g.addColorStop(0.35, `rgba(255, 170, 60, ${0.12 * a})`);
        g.addColorStop(0.65, `rgba(255, 120, 40, ${0.05 * a})`);
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
        this.ctx.fillStyle = g;
        this.ctx.fillRect(-this.shakeOffset.x, -this.shakeOffset.y, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    updateParticles() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.5;
            const decay = p.lifeDecay ?? 0.03;
            p.life -= decay;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    renderParticles() {
        for (const p of this.particles) {
            this.ctx.globalAlpha = p.life;
            this.ctx.fillStyle = p.color;
            this.ctx.beginPath();
            this.ctx.arc(p.x + this.shakeOffset.x, p.y + this.shakeOffset.y, p.size * p.life, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.globalAlpha = 1;
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
        // 用确定性振荡代替每帧随机偏移，避免与 rAF 叠加产生「频闪」感
        const wobble = (elapsed / 1000) * 38;
        this.shakeOffset = {
            x: Math.sin(wobble) * intensity * 0.55,
            y: Math.sin(wobble * 1.3 + 0.7) * intensity * 0.5
        };
    }

    clearParticles() {
        this.particles = [];
        this._comboFlash = 0;
        this._perfectFlash = 0;
        this._doubleWave = 0;
    }

    setClearCells(cells) {
        this.clearCells = cells || [];
    }

    render() {
        this.updateShake();
        this.updateParticles();
    }
}
