/**
 * Open Block - Renderer
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
 * 在方块中心绘制 skin.blockIcons 里对应的小动物 emoji（尺寸足够时）。
 * 会自动添加投影以保证在任何颜色底色上清晰可读。
 * @param {CanvasRenderingContext2D} ctx
 */
function _paintIcon(ctx, bx, by, size, r, color, skin) {
    if (!skin.blockIcons || size < 14) return;
    const colorIdx = skin.blockColors ? skin.blockColors.indexOf(color) : -1;
    const icon = colorIdx >= 0
        ? skin.blockIcons[colorIdx % skin.blockIcons.length]
        : skin.blockIcons[0];
    if (!icon) return;
    const fontSize = Math.max(10, Math.round(size * 0.56));
    ctx.save();
    roundRectPath(ctx, bx, by, size, size, r);
    ctx.clip();
    ctx.font = `${fontSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha  = 0.95;
    // 细腻投影让 emoji 在任何背景上都清晰可辨
    ctx.shadowColor    = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur     = 3;
    ctx.shadowOffsetX  = 0.5;
    ctx.shadowOffsetY  = 1;
    ctx.fillText(icon, bx + size * 0.50, by + size * 0.53);
    ctx.restore();
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

    /* ── cartoon（晶莹透亮版）────────────────────────────────────────── */
    if (skin.blockStyle === 'cartoon') {
        ctx.save();
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.clip();

        // 1. 上浅下稍暗的主色渐变（取代纯平填，立体感更自然）
        const baseG = ctx.createLinearGradient(bx, by, bx, by + size);
        baseG.addColorStop(0,    lightenColor(color, 0.22));
        baseG.addColorStop(0.50, color);
        baseG.addColorStop(1,    darkenColor(color, 0.14));
        ctx.fillStyle = baseG;
        ctx.fillRect(bx, by, size, size);

        // 2. 顶部大面积磨砂白覆层（晶莹感核心，占 50%）
        const hlG = ctx.createLinearGradient(bx, by, bx, by + size * 0.52);
        hlG.addColorStop(0,    'rgba(255,255,255,0.68)');
        hlG.addColorStop(0.40, 'rgba(255,255,255,0.24)');
        hlG.addColorStop(1,    'rgba(255,255,255,0.00)');
        ctx.fillStyle = hlG;
        ctx.fillRect(bx, by, size, size * 0.52);

        // 3. 微弱底部暗角（增强立体感）
        const btG = ctx.createLinearGradient(bx, by + size * 0.70, bx, by + size);
        btG.addColorStop(0, 'rgba(0,0,0,0.00)');
        btG.addColorStop(1, 'rgba(0,0,0,0.14)');
        ctx.fillStyle = btG;
        ctx.fillRect(bx, by + size * 0.70, size, size * 0.30);

        ctx.restore();

        // 4. 亮色内边框（玻璃折射边缘）
        ctx.strokeStyle = 'rgba(255,255,255,0.60)';
        ctx.lineWidth = 1.2;
        roundRectPath(ctx, bx + 0.6, by + 0.6, size - 1.2, size - 1.2, Math.max(0, r - 0.6));
        ctx.stroke();

        // 5. 柔和暗色外框（轻量定界，非粗黑线）
        ctx.strokeStyle = 'rgba(30,15,60,0.32)';
        ctx.lineWidth = 1;
        roundRectPath(ctx, bx + 1, by + 1, size - 2, size - 2, Math.max(0, r - 1));
        ctx.stroke();

        // 6. 左上角高光光斑（点睛）
        const sr = size * 0.09;
        ctx.save();
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath();
        ctx.ellipse(bx + size * 0.27, by + size * 0.23,
            sr * 2.0, sr, -Math.PI / 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 7. emoji icon
        _paintIcon(ctx, bx, by, size, r, color, skin);
        return;
    }

    /* ── jelly（晶莹珠光版）──────────────────────────────────────────── */
    if (skin.blockStyle === 'jelly') {
        const rgb = hexToRgb(color) || { r: 120, g: 150, b: 200 };
        const { r: cr, g: cg, b: cb } = rgb;
        const m = Math.min;

        ctx.save();
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.clip();

        // 1. 半透明主色（顶部略浅，营造光感底色）
        const baseG = ctx.createLinearGradient(bx, by, bx, by + size);
        baseG.addColorStop(0,    `rgba(${m(cr+30,255)},${m(cg+30,255)},${m(cb+30,255)},0.90)`);
        baseG.addColorStop(0.45, `rgba(${cr},${cg},${cb},0.80)`);
        baseG.addColorStop(1,    `rgba(${m(cr+15,255)},${m(cg+15,255)},${m(cb+15,255)},0.88)`);
        ctx.fillStyle = baseG;
        ctx.fillRect(bx, by, size, size);

        // 2. 顶部大面积磨砂白（60-65%，果冻/玻璃感核心）
        const hlG = ctx.createLinearGradient(bx, by, bx, by + size * 0.65);
        hlG.addColorStop(0,    'rgba(255,255,255,0.72)');
        hlG.addColorStop(0.32, 'rgba(255,255,255,0.30)');
        hlG.addColorStop(0.65, 'rgba(255,255,255,0.06)');
        hlG.addColorStop(1,    'rgba(255,255,255,0.00)');
        ctx.fillStyle = hlG;
        ctx.fillRect(bx, by, size, size * 0.65);

        // 3. 径向内发光（珍珠/水晶质感）
        const rg = ctx.createRadialGradient(
            bx + size * 0.50, by + size * 0.35, 0,
            bx + size * 0.50, by + size * 0.50, size * 0.58
        );
        rg.addColorStop(0, 'rgba(255,255,255,0.10)');
        rg.addColorStop(1, 'rgba(0,0,0,0.08)');
        ctx.fillStyle = rg;
        ctx.fillRect(bx, by, size, size);

        ctx.restore();

        // 4. 亮色内描边（玻璃折射边缘，更亮）
        ctx.strokeStyle = `rgba(${m(cr+90,255)},${m(cg+90,255)},${m(cb+90,255)},0.88)`;
        ctx.lineWidth = 1.6;
        roundRectPath(ctx, bx + 0.8, by + 0.8, size - 1.6, size - 1.6, Math.max(0, r - 0.8));
        ctx.stroke();

        // 5. 左上角高光光斑
        const sr = size * 0.09;
        ctx.save();
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.beginPath();
        ctx.ellipse(bx + size * 0.26, by + size * 0.22,
            sr * 2.0, sr, -Math.PI / 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 6. emoji icon
        _paintIcon(ctx, bx, by, size, r, color, skin);
        return;
    }

    /* ── pixel8 ───────────────────────────────────────────────────────── */
    if (skin.blockStyle === 'pixel8') {
        const half = Math.floor(size / 2);
        const rest = size - half;
        // 四象限像素着色（左上最亮，右下最暗，4-tile Gameboy 效果）
        ctx.fillStyle = lightenColor(color, 0.30);
        ctx.fillRect(bx, by, half, half);
        ctx.fillStyle = lightenColor(color, 0.10);
        ctx.fillRect(bx + half, by, rest, half);
        ctx.fillStyle = darkenColor(color, 0.06);
        ctx.fillRect(bx, by + half, half, rest);
        ctx.fillStyle = darkenColor(color, 0.30);
        ctx.fillRect(bx + half, by + half, rest, rest);
        // 深色边框
        ctx.strokeStyle = darkenColor(color, 0.55);
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, size - 1, size - 1);
        // 中轴分隔线（模拟像素 tile）
        ctx.strokeStyle = `rgba(0,0,0,0.20)`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(bx + half, by + 1);
        ctx.lineTo(bx + half, by + size - 1);
        ctx.moveTo(bx + 1, by + half);
        ctx.lineTo(bx + size - 1, by + half);
        ctx.stroke();
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

    // glossy 兜底样式也支持 blockIcons（未来皮肤扩展用）
    _paintIcon(ctx, bx, by, size, r, color, skin);
}

/** 将棋盘实际 CSS 尺寸同步到 CSS 变量，同时让候选区格子与棋盘格子等大 */
export function syncGridDisplayPx(canvas) {
    if (typeof document === 'undefined' || !canvas) return;
    const w = canvas.getBoundingClientRect().width;
    if (w > 1) {
        document.documentElement.style.setProperty('--grid-display-px', `${w}px`);
        const gridN = Math.round(canvas.width / CONFIG.CELL_SIZE) || CONFIG.GRID_SIZE;
        document.documentElement.style.setProperty('--dock-cell-size', `${w / gridN}px`);
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

function syncGridCanvasCssVar(canvas) {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--grid-canvas-width', `${canvas.width}px`);
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
        syncGridCanvasCssVar(this.canvas);
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
        syncGridCanvasCssVar(this.canvas);
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

    /**
     * 悬浮合法落点且将触发消行时：待消除格子的提示（under 在半透明预览下层，over 描边盖在预览上）
     * @param {{ x: number, y: number, color?: number }[]} cells
     * @param {'under' | 'over'} layer
     */
    renderPreviewClearHint(cells, layer) {
        if (!cells || cells.length === 0) return;
        const skin = getActiveSkin();
        const inset = skin.blockInset;
        const br = skin.blockRadius;
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(Date.now() * 0.007));
        const s = this.cellSize;

        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        for (const cell of cells) {
            const px = cell.x * s + inset;
            const py = cell.y * s + inset;
            const full = s - inset * 2;
            const size = full;

            if (layer === 'under') {
                this.ctx.fillStyle = `rgba(255, 210, 90, ${0.12 + 0.18 * pulse})`;
                this.ctx.globalAlpha = 1;
                if (br > 0) {
                    roundRectPath(this.ctx, px, py, size, size, br);
                    this.ctx.fill();
                } else {
                    this.ctx.fillRect(px, py, size, size);
                }
            } else {
                this.ctx.strokeStyle = `rgba(255, 200, 60, ${0.55 + 0.4 * pulse})`;
                this.ctx.lineWidth = 2.25;
                this.ctx.globalAlpha = 0.92;
                this.ctx.shadowColor = 'rgba(255, 220, 120, 0.65)';
                this.ctx.shadowBlur = 5 + 4 * pulse;
                if (br > 0) {
                    roundRectPath(this.ctx, px + 0.5, py + 0.5, size - 1, size - 1, Math.max(0, br - 0.5));
                    this.ctx.stroke();
                } else {
                    this.ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
                }
                this.ctx.shadowBlur = 0;
            }
        }

        this.ctx.restore();
    }

    renderClearCells(cells) {
        if (!cells || cells.length === 0) return;
        const skin = getActiveSkin();
        const inset = skin.blockInset;
        const pulse = 0.65 + 0.35 * Math.abs(Math.sin(Date.now() * 0.008));
        const t = Date.now() * 0.001;
        /* 消除瞬间格块略「跳起」再随 pulse 隐去 */
        const lift = (1.05 - pulse * 0.4) * (2.5 + 3.5 * Math.sin(t * 20));

        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        const br = skin.blockRadius;
        for (const cell of cells) {
            const full = this.cellSize - inset * 2;
            const size = full * (0.92 + 0.08 * pulse);
            const px = cell.x * this.cellSize + inset + (full - size) * 0.5;
            const py = cell.y * this.cellSize + inset + (full - size) * 0.5 - lift;

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

        const perCell = isPerfect ? 24 : isCombo ? 17 : isDouble ? 13 : 10;
        const speed = isPerfect ? 2.15 : isCombo ? 1.65 : isDouble ? 1.35 : 1.08;
        const lifeDecay = isPerfect ? 0.010 : isCombo ? 0.014 : isDouble ? 0.018 : 0.022;
        const baseLife = isPerfect ? 1.55 : isCombo ? 1.30 : isDouble ? 1.18 : 1.10;

        const rainbowColors = ['#FF4444', '#FF8800', '#FFDD00', '#44DD44', '#4488FF', '#AA44FF'];

        for (const cell of cells) {
            const color = isPerfect
                ? rainbowColors[Math.floor(Math.random() * rainbowColors.length)]
                : (palette[cell.color] || '#FFFFFF');
            const cx = cell.x * this.cellSize + this.cellSize / 2;
            const cy = cell.y * this.cellSize + this.cellSize / 2;
            for (let i = 0; i < perCell; i++) {
                const ang = Math.random() * Math.PI * 2;
                const sp = (3.5 + Math.random() * 11) * speed;
                /* 先向上「跳」再受重力下落，横向散开 */
                const jump = 7 + Math.random() * 9;
                this.particles.push({
                    x: cx,
                    y: cy,
                    vx: Math.cos(ang) * sp * 1.35 + (Math.random() - 0.5) * 5,
                    vy: Math.sin(ang) * sp * 0.85 - jump,
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
                        x: cx,
                        y: cy,
                        vx: (Math.random() - 0.5) * (isPerfect ? 26 : 20),
                        vy: (Math.random() - 0.5) * (isPerfect ? 26 : 20) - (8 + Math.random() * 6),
                        color: isPerfect
                            ? rainbowColors[j % rainbowColors.length]
                            : (j % 2 === 0 ? '#FFD700' : '#FFF8DC'),
                        life: isPerfect ? 1.60 : 1.35,
                        lifeDecay: isPerfect ? 0.009 : 0.012,
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
        this._perfectFlash *= 0.968;
        this._perfectHue = (this._perfectHue + 5) % 360;
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
        this._doubleWave *= 0.96;
        if (this._doubleWave < 0.015) this._doubleWave = 0;
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
        this._comboFlash *= 0.94;
        if (this._comboFlash < 0.015) this._comboFlash = 0;
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
            p.vy += 0.35;
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
