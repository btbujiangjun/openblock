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
    ctx.globalAlpha  = 0.96;
    // 不用 shadowBlur（会导致 emoji 发虚）；改用两次偏移绘制模拟轻量投影
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillText(icon, bx + size * 0.50 + 0.6, by + size * 0.53 + 0.8);
    ctx.fillStyle = 'black'; // fillText 对 emoji 无效，此处重置让浏览器正常渲染彩色 emoji
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
        // 主色渐变 — 直接 fill 圆角路径，获得原生路径抗锯齿
        const vg = ctx.createLinearGradient(bx, by, bx, by + size);
        vg.addColorStop(0,   lightenColor(color, 0.22));
        vg.addColorStop(0.4, color);
        vg.addColorStop(1,   darkenColor(color, 0.06));
        ctx.fillStyle = vg;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        // 顶部高光：渐变在 58% 处淡出，直接 fill 同一路径（不再 clip + fillRect）
        const hl = ctx.createLinearGradient(bx, by, bx, by + size);
        hl.addColorStop(0,    'rgba(255,255,255,0.50)');
        hl.addColorStop(0.28, 'rgba(255,255,255,0.14)');
        hl.addColorStop(0.58, 'rgba(255,255,255,0.00)');
        hl.addColorStop(1,    'rgba(255,255,255,0.00)');
        ctx.fillStyle = hl;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        ctx.strokeStyle = skin.uiDark ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.32)';
        ctx.lineWidth = 1.15;
        if (r > 0) {
            roundRectPath(ctx, bx + 0.5, by + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
            ctx.stroke();
        } else {
            ctx.strokeRect(bx + 0.5, by + 0.5, size - 1, size - 1);
        }
        ctx.strokeStyle = skin.uiDark ? 'rgba(0,0,0,0.10)' : 'rgba(15,23,42,0.20)';
        ctx.lineWidth = 1;
        if (r > 0) {
            roundRectPath(ctx, bx + 1, by + 1, size - 2, size - 2, Math.max(0, r - 1));
            ctx.stroke();
        }
        return;
    }

    if (skin.blockStyle === 'metal') {
        // 金属拉丝渐变 — 直接 fill 圆角路径
        const mg = ctx.createLinearGradient(bx, by, bx, by + size);
        mg.addColorStop(0,    lightenColor(color, 0.32));
        mg.addColorStop(0.12, darkenColor(color, 0.08));
        mg.addColorStop(0.42, lightenColor(color, 0.18));
        mg.addColorStop(0.48, lightenColor(color, 0.38));
        mg.addColorStop(0.54, darkenColor(color, 0.06));
        mg.addColorStop(0.78, lightenColor(color, 0.08));
        mg.addColorStop(1,    darkenColor(color, 0.28));
        ctx.fillStyle = mg;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

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
        // 1. 主色渐变 — 直接 fill 圆角路径，原生路径抗锯齿，彻底消除毛边
        const baseG = ctx.createLinearGradient(bx, by, bx, by + size);
        baseG.addColorStop(0,    lightenColor(color, 0.22));
        baseG.addColorStop(0.50, color);
        baseG.addColorStop(1,    darkenColor(color, 0.14));
        ctx.fillStyle = baseG;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        // 2. 顶部磨砂白：渐变在 52% 处淡出为透明，直接 fill 同一路径（不再 clip）
        const hlG = ctx.createLinearGradient(bx, by, bx, by + size);
        hlG.addColorStop(0,    'rgba(255,255,255,0.68)');
        hlG.addColorStop(0.40, 'rgba(255,255,255,0.24)');
        hlG.addColorStop(0.52, 'rgba(255,255,255,0.00)');
        hlG.addColorStop(1,    'rgba(255,255,255,0.00)');
        ctx.fillStyle = hlG;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        // 3. 底部暗角：渐变在 70% 前透明，直接 fill 同一路径
        const btG = ctx.createLinearGradient(bx, by, bx, by + size);
        btG.addColorStop(0.68, 'rgba(0,0,0,0.00)');
        btG.addColorStop(1,    'rgba(0,0,0,0.14)');
        ctx.fillStyle = btG;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        // 4. 亮色内边框（玻璃折射边缘）
        ctx.strokeStyle = 'rgba(255,255,255,0.62)';
        ctx.lineWidth = 1.2;
        roundRectPath(ctx, bx + 0.6, by + 0.6, size - 1.2, size - 1.2, Math.max(0, r - 0.6));
        ctx.stroke();

        // 5. 柔和暗色外框
        ctx.strokeStyle = 'rgba(30,15,60,0.30)';
        ctx.lineWidth = 1;
        roundRectPath(ctx, bx + 1, by + 1, size - 2, size - 2, Math.max(0, r - 1));
        ctx.stroke();

        // 6. 左上角高光光斑（位置在内部，无需 clip）
        const sr = size * 0.09;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath();
        ctx.ellipse(bx + size * 0.27, by + size * 0.23,
            sr * 2.0, sr, -Math.PI / 4.5, 0, Math.PI * 2);
        ctx.fill();

        // 7. emoji icon
        _paintIcon(ctx, bx, by, size, r, color, skin);
        return;
    }

    /* ── jelly（晶莹珠光版）──────────────────────────────────────────── */
    if (skin.blockStyle === 'jelly') {
        const rgb = hexToRgb(color) || { r: 120, g: 150, b: 200 };
        const { r: cr, g: cg, b: cb } = rgb;
        const m = Math.min;

        // 1. 不透明主色渐变 — 直接 fill 圆角路径，原生路径抗锯齿
        const baseG = ctx.createLinearGradient(bx, by, bx, by + size);
        baseG.addColorStop(0,    `rgba(${m(cr+24,255)},${m(cg+24,255)},${m(cb+24,255)},1.0)`);
        baseG.addColorStop(0.50, `rgba(${cr},${cg},${cb},1.0)`);
        baseG.addColorStop(1,    `rgba(${Math.max(cr-12,0)},${Math.max(cg-12,0)},${Math.max(cb-12,0)},1.0)`);
        ctx.fillStyle = baseG;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        // 2. 顶部磨砂白：渐变在 52% 处淡出，直接 fill（不再 clip）
        const hlG = ctx.createLinearGradient(bx, by, bx, by + size);
        hlG.addColorStop(0,    'rgba(255,255,255,0.60)');
        hlG.addColorStop(0.38, 'rgba(255,255,255,0.20)');
        hlG.addColorStop(0.52, 'rgba(255,255,255,0.00)');
        hlG.addColorStop(1,    'rgba(255,255,255,0.00)');
        ctx.fillStyle = hlG;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        // 3. 底部暗角：渐变在 65% 前透明，直接 fill
        const btG = ctx.createLinearGradient(bx, by, bx, by + size);
        btG.addColorStop(0.63, 'rgba(0,0,0,0.00)');
        btG.addColorStop(1,    'rgba(0,0,0,0.12)');
        ctx.fillStyle = btG;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        // 4. 径向内发光（珍珠光泽）— clip 限制在内部，不影响外边缘
        ctx.save();
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.clip();
        const rg = ctx.createRadialGradient(
            bx + size * 0.50, by + size * 0.32, 0,
            bx + size * 0.50, by + size * 0.50, size * 0.55
        );
        rg.addColorStop(0, 'rgba(255,255,255,0.12)');
        rg.addColorStop(1, 'rgba(0,0,0,0.00)');
        ctx.fillStyle = rg;
        ctx.fillRect(bx, by, size, size);
        ctx.restore();

        // 5. 亮色内描边（玻璃折射边缘）
        ctx.strokeStyle = `rgba(${m(cr+100,255)},${m(cg+100,255)},${m(cb+100,255)},0.80)`;
        ctx.lineWidth = 1.8;
        roundRectPath(ctx, bx + 0.9, by + 0.9, size - 1.8, size - 1.8, Math.max(0, r - 0.9));
        ctx.stroke();

        // 6. 深色细轮廓
        ctx.strokeStyle = `rgba(${Math.max(cr-60,0)},${Math.max(cg-60,0)},${Math.max(cb-60,0)},0.30)`;
        ctx.lineWidth = 1;
        roundRectPath(ctx, bx + 1.5, by + 1.5, size - 3, size - 3, Math.max(0, r - 1.5));
        ctx.stroke();

        // 7. 左上角高光光斑（位置在内部，无需 clip）
        const sr = size * 0.08;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.ellipse(bx + size * 0.26, by + size * 0.22,
            sr * 2.2, sr, -Math.PI / 4.2, 0, Math.PI * 2);
        ctx.fill();

        // 8. emoji icon
        _paintIcon(ctx, bx, by, size, r, color, skin);
        return;
    }

    /* ── pixel8（NES/FC 浮雕凸起）─────────────────────────────────────── */
    if (skin.blockStyle === 'pixel8') {
        // 经典"凸起瓦片"效果：亮顶左 + 暗右下 + 极亮/极暗四角
        const ew = Math.max(1, Math.round(size * 0.14)); // 高光/阴影边缘宽度

        // 1. 主体填色（边缘内侧略微加暗，凸显浮雕对比）
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, size, size);
        ctx.fillStyle = darkenColor(color, 0.10);
        ctx.fillRect(bx + ew, by + ew, size - ew * 2, size - ew * 2);

        // 2. 顶部亮边（最亮，光线从左上方来）
        ctx.fillStyle = lightenColor(color, 0.55);
        ctx.fillRect(bx + ew, by, size - ew * 2, ew);

        // 3. 左侧亮边（略暗于顶部）
        ctx.fillStyle = lightenColor(color, 0.40);
        ctx.fillRect(bx, by + ew, ew, size - ew * 2);

        // 4. 底部阴影边
        ctx.fillStyle = darkenColor(color, 0.50);
        ctx.fillRect(bx + ew, by + size - ew, size - ew * 2, ew);

        // 5. 右侧阴影边
        ctx.fillStyle = darkenColor(color, 0.38);
        ctx.fillRect(bx + size - ew, by + ew, ew, size - ew * 2);

        // 6. 四个角像素（点睛：让边缘交汇处自然过渡）
        ctx.fillStyle = lightenColor(color, 0.72); // 极亮：顶左角
        ctx.fillRect(bx, by, ew, ew);
        ctx.fillStyle = lightenColor(color, 0.48); // 次亮：顶右角
        ctx.fillRect(bx + size - ew, by, ew, ew);
        ctx.fillStyle = darkenColor(color, 0.38); // 次暗：底左角
        ctx.fillRect(bx, by + size - ew, ew, ew);
        ctx.fillStyle = darkenColor(color, 0.62); // 极暗：底右角
        ctx.fillRect(bx + size - ew, by + size - ew, ew, ew);

        // 7. 外轮廓（最深色，清晰定界）
        ctx.strokeStyle = darkenColor(color, 0.72);
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, size - 1, size - 1);
        return;
    }

    if (skin.blockStyle === 'neon') {
        // 主色渐变 — 直接 fill 圆角路径
        const g = ctx.createLinearGradient(bx, by, bx + size, by);
        g.addColorStop(0,    lightenColor(color, 0.10));
        g.addColorStop(0.45, color);
        g.addColorStop(1,    darkenColor(color, 0.18));
        ctx.fillStyle = g;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        ctx.strokeStyle = lightenColor(color, 0.22);
        ctx.lineWidth = 1.5;
        if (r > 0) {
            roundRectPath(ctx, bx + 0.5, by + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
            ctx.stroke();
        } else {
            ctx.strokeRect(bx + 0.5, by + 0.5, size - 1, size - 1);
        }

        // 顶部高光：渐变在 48% 处淡出，直接 fill（不再 clip）
        const hl = ctx.createLinearGradient(bx, by, bx, by + size);
        hl.addColorStop(0,    'rgba(255,255,255,0.28)');
        hl.addColorStop(0.48, 'rgba(255,255,255,0.00)');
        hl.addColorStop(1,    'rgba(255,255,255,0.00)');
        ctx.fillStyle = hl;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();
        return;
    }

    // glossy — 所有层均直接 fill 圆角路径，消除 clip 毛边
    const gradient = ctx.createLinearGradient(bx, by, bx + size, by);
    gradient.addColorStop(0,   darkenColor(color, 0.15));
    gradient.addColorStop(0.2, color);
    gradient.addColorStop(0.5, lightenColor(color, 0.15));
    gradient.addColorStop(1,   darkenColor(color, 0.20));
    ctx.fillStyle = gradient;
    roundRectPath(ctx, bx, by, size, size, r);
    ctx.fill();

    const hl = ctx.createLinearGradient(bx, by, bx, by + size);
    hl.addColorStop(0,   'rgba(255,255,255,0.50)');
    hl.addColorStop(0.50,'rgba(255,255,255,0.00)');
    hl.addColorStop(1,   'rgba(255,255,255,0.00)');
    ctx.fillStyle = hl;
    roundRectPath(ctx, bx, by, size, size, r);
    ctx.fill();

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
        // gridN 从 data 属性读取（Renderer 在 setGridSize/constructor 时写入），
        // 避免依赖 CONFIG.CELL_SIZE（动态 cellSize 时该值已不等于 canvas.width/gridN）
        const gridN = parseInt(canvas.dataset.gridSize || '0') || CONFIG.GRID_SIZE;
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
    // logicalW 存在时用更精确的值（已适配 DPR）；否则回退到原始计算
    const lw = canvas._logicalW != null ? canvas._logicalW
        : canvas.width / ((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    document.documentElement.style.setProperty('--grid-canvas-width', `${lw}px`);
    requestAnimationFrame(() => syncGridDisplayPx(canvas));
}

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.cellSize = CONFIG.CELL_SIZE;
        this.gridSize = CONFIG.GRID_SIZE;
        this.dpr = this._readDpr();
        // 初始按逻辑尺寸设置（layout 完成前 CSS 尺寸未知）
        this.logicalW = this.gridSize * this.cellSize;
        this.logicalH = this.gridSize * this.cellSize;
        this._applyCanvasSize(this.logicalW, this.logicalH);
        this.canvas.dataset.gridSize = String(this.gridSize);
        syncGridCanvasCssVar(this.canvas);
        ensureGridDisplayResizeSync(this.canvas);
        // layout 完成后立即校准到真实 CSS 尺寸
        requestAnimationFrame(() => this._onCanvasResize());
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
        // 监听 CSS 尺寸变化，动态保持 canvas 物理像素 = CSS 像素 × DPR
        this._setupPixelPerfectResize();
    }

    /** 读取当前屏幕 DPR（取整防止非整数倍模糊） */
    _readDpr() {
        return (typeof window !== 'undefined'
            ? Math.round(window.devicePixelRatio || 1)
            : 1) || 1;
    }

    /**
     * 将 canvas 物理像素设为 logicalW × dpr，并重置坐标系缩放。
     * canvas.width 赋值会重置 context 变换，必须重新 scale。
     */
    _applyCanvasSize(lw, lh) {
        this.logicalW = lw;
        this.logicalH = lh;
        this.canvas._logicalW = lw; // 供 syncGridCanvasCssVar 使用
        this.canvas.width  = Math.round(lw * this.dpr);
        this.canvas.height = Math.round(lh * this.dpr);
        this.ctx.scale(this.dpr, this.dpr);
    }

    /**
     * ResizeObserver 回调：当 canvas 的 CSS 显示尺寸改变时，
     * 将 canvas 物理像素精确对齐到 cssWidth × DPR，
     * 从根本上消除因 CSS 缩放导致的模糊/毛边。
     */
    _onCanvasResize() {
        if (typeof window === 'undefined') return;
        const rect = this.canvas.getBoundingClientRect();
        const cssW = rect.width;
        const cssH = rect.height;
        if (cssW < 2 || cssH < 2) return;
        // 更新 DPR（用户可能跨屏幕移动窗口）
        this.dpr = this._readDpr();
        const targetW = Math.round(cssW * this.dpr);
        const targetH = Math.round(cssH * this.dpr);
        if (this.canvas.width === targetW && this.canvas.height === targetH) return;
        // cellSize 随 CSS 尺寸动态调整，保持 gridSize × cellSize = cssW
        this.cellSize = cssW / this.gridSize;
        this._applyCanvasSize(cssW, cssH);
        syncGridDisplayPx(this.canvas);
    }

    /** 启动 ResizeObserver 持续监听 canvas CSS 尺寸变化 */
    _setupPixelPerfectResize() {
        if (typeof ResizeObserver === 'undefined') return;
        if (this._ppResizeObs) return;
        this._ppResizeObs = new ResizeObserver(() => {
            this._onCanvasResize();
        });
        this._ppResizeObs.observe(this.canvas);
    }

    /** 与逻辑层 Grid 尺寸对齐（策略可改边长） */
    setGridSize(size) {
        const n = Math.max(1, Math.floor(size));
        this.gridSize = n;
        this.canvas.dataset.gridSize = String(n);
        // 保持当前 logicalW，只更新 cellSize 和重绘
        this.cellSize = this.logicalW / n;
        // 强制重新对齐物理像素（canvas.width 未变时 _applyCanvasSize 仍重置 ctx scale）
        this._applyCanvasSize(this.logicalW, this.logicalH);
        syncGridCanvasCssVar(this.canvas);
    }

    clear() {
        this.ctx.clearRect(0, 0, this.logicalW, this.logicalH);
    }

    renderBackground() {
        const skin = getActiveSkin();
        const g = skin.gridGap;
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        this.ctx.fillStyle = skin.gridOuter;
        this.ctx.fillRect(-10, -10, this.logicalW + 20, this.logicalH + 20);

        const cs = this.cellSize - 2 * g; // 单格可见尺寸
        this.ctx.fillStyle = skin.gridCell;
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const px = x * this.cellSize + g;
                const py = y * this.cellSize + g;
                this.ctx.fillRect(px, py, cs, cs);
            }
        }

        // 空格凹陷效果（与 pixel8 凸起方块配合，增强视觉深度）
        if (skin.cellStyle === 'sunken' && cs > 4) {
            const ew = Math.max(1, Math.round(cs * 0.11));
            for (let y = 0; y < this.gridSize; y++) {
                for (let x = 0; x < this.gridSize; x++) {
                    const px = x * this.cellSize + g;
                    const py = y * this.cellSize + g;
                    // 顶/左：暗边（凹陷阴影）
                    this.ctx.fillStyle = 'rgba(0,0,0,0.32)';
                    this.ctx.fillRect(px, py, cs, ew);
                    this.ctx.fillRect(px, py + ew, ew, cs - ew);
                    // 底/右：亮边（凹陷反光）
                    this.ctx.fillStyle = 'rgba(255,255,255,0.07)';
                    this.ctx.fillRect(px, py + cs - ew, cs, ew);
                    this.ctx.fillRect(px + cs - ew, py + ew, ew, cs - ew * 2);
                }
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
        const cx = this.logicalW * 0.5;
        const cy = this.logicalH * 0.5;
        const r = Math.max(this.logicalW, this.logicalH) * 0.85;
        const g = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const h = this._perfectHue;
        g.addColorStop(0, `hsla(${h}, 100%, 75%, ${0.3 * a})`);
        g.addColorStop(0.3, `hsla(${(h + 60) % 360}, 100%, 65%, ${0.15 * a})`);
        g.addColorStop(0.6, `hsla(${(h + 120) % 360}, 100%, 60%, ${0.06 * a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
        this.ctx.fillStyle = g;
        this.ctx.fillRect(-this.shakeOffset.x, -this.shakeOffset.y, this.logicalW, this.logicalH);
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
        const spread = (1 - a) * this.logicalW * 0.6;
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
        for (const row of this._doubleWaveRows) {
            const cy = (row + 0.5) * this.cellSize;
            const g = this.ctx.createLinearGradient(
                this.logicalW * 0.5 - spread, cy,
                this.logicalW * 0.5 + spread, cy
            );
            g.addColorStop(0, `rgba(46, 204, 113, 0)`);
            g.addColorStop(0.3, `rgba(46, 204, 113, ${0.25 * a})`);
            g.addColorStop(0.5, `rgba(255, 255, 255, ${0.35 * a})`);
            g.addColorStop(0.7, `rgba(46, 204, 113, ${0.25 * a})`);
            g.addColorStop(1, `rgba(46, 204, 113, 0)`);
            this.ctx.fillStyle = g;
            this.ctx.fillRect(0, cy - this.cellSize * 0.6, this.logicalW, this.cellSize * 1.2);
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
        const cx = this.logicalW * 0.5;
        const cy = this.logicalH * 0.5;
        const r = Math.max(this.logicalW, this.logicalH) * 0.72;
        const g = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255, 230, 140, ${0.22 * a})`);
        g.addColorStop(0.35, `rgba(255, 170, 60, ${0.12 * a})`);
        g.addColorStop(0.65, `rgba(255, 120, 40, ${0.05 * a})`);
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
        this.ctx.fillStyle = g;
        this.ctx.fillRect(-this.shakeOffset.x, -this.shakeOffset.y, this.logicalW, this.logicalH);
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
