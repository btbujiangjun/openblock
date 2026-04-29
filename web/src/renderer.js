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

/** 盘面半透明叠底用 */
function hexToRgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    if (!rgb) return `rgba(0,0,0,${alpha})`;
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
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

/**
 * v10.10: 带 icon 皮肤的方块色 HSL 降饱和。
 * blockColors 原始饱和度多在 70-85%，与中心 emoji 的彩色发生「色冲突」——
 * emoji 看起来"陷"在饱和色块里。在 HSL 空间将 S 乘以 factor (默认 0.55)
 * 得到「哑光彩」方块，明度 L 与色相 H 完全保留，WCAG 对比度反而略增。
 *
 * 仅用于 paintBlockCell 中带 icon 的皮肤；无 icon 皮肤完全不受影响。
 */
function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h, s; const l = (mx + mn) / 2;
    if (mx === mn) { h = 0; s = 0; }
    else {
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
function _hslToRgb(h, s, l) {
    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }
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
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
}
function desaturateColor(hex, factor) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const [h, s, l] = _rgbToHsl(rgb.r, rgb.g, rgb.b);
    const newS = Math.max(0, Math.min(1, s * factor));
    const [r, g, b] = _hslToRgb(h, newS, l);
    return `rgb(${r}, ${g}, ${b})`;
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
 * 在方块中心绘制 skin.blockIcons 里对应 emoji（尺寸足够时）。
 * 单层轻阴影，避免多描边造成「叠影/重影」。
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
    const cx = bx + size * 0.5;
    const cy = by + size * 0.53;
    ctx.globalAlpha = 1.0;
    // 双层阴影增强 icon 在任意底色（深/浅）下的可读性
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillText(icon, cx + 0.6, cy + 0.8);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillText(icon, cx + 1.0, cy + 1.4);
    ctx.fillStyle = 'black';
    ctx.fillText(icon, cx, cy);
    ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cellPx 格左上角 x（整格坐标）
 */
function paintBlockCell(ctx, cellPx, cellPy, cellS, color, skin) {
    const inset = skin.blockInset ?? 2;
    const size = Math.max(1, cellS - inset * 2);
    const bx = cellPx + inset;
    const by = cellPy + inset;
    const r = skin.blockRadius ?? 5;

    // v10.10：带 icon 皮肤的方块色降饱和 (S × 0.55) ——
    // blockColors 原始饱和度多在 70-85%，与中心 emoji 的彩色发生「色冲突」，
    // emoji 看起来"陷"在饱和色块里。HSL 空间降饱和后呈现「哑光彩」，
    // 色相和明度完全保留，emoji 在哑光底色上对比更清晰。
    // originalColor 保留用于 _paintIcon 的 colorIdx 索引查找。
    const originalColor = color;
    if (skin.blockIcons && skin.blockIcons.length) {
        color = desaturateColor(color, 0.55);
    }

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
        _paintIcon(ctx, bx, by, size, r, originalColor, skin);
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
        _paintIcon(ctx, bx, by, size, r, originalColor, skin);
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
        _paintIcon(ctx, bx, by, size, r, originalColor, skin);
        return;
    }

    /* ── cartoon（哑光磨砂瓷砖 · v10.9 icon 友好版）─────────────────────
     *
     * 问题：原 cartoon 风格的 0.68 不透明顶部白光层 + 左上角椭圆光斑会覆盖 emoji
     * 上半部分（emoji 顶部约在方块 25% 处，正好在最强白光区），导致 icon 头部
     * 被洗白，严重影响 icon 呈现。
     *
     * 重构：去掉顶部白光层 + 左上角光斑，只保留弱主色渐变 + 弱底部暗角 +
     *      浅亮内描边 + 暗外描边，呈现「哑光磨砂瓷砖」质感——
     *      方块仍有极轻立体感，但表面无强反光，emoji 100% 清晰。
     */
    if (skin.blockStyle === 'cartoon') {
        // 1. 主色弱渐变 — 上下立体（lighten 12% → color → darken 8%，幅度小于原 22%/14%）
        const baseG = ctx.createLinearGradient(bx, by, bx, by + size);
        baseG.addColorStop(0,    lightenColor(color, 0.12));
        baseG.addColorStop(0.50, color);
        baseG.addColorStop(1,    darkenColor(color, 0.08));
        ctx.fillStyle = baseG;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        // 2. 弱底部暗角 — 让方块底部有"重量感"但不糊化 emoji
        const btG = ctx.createLinearGradient(bx, by, bx, by + size);
        btG.addColorStop(0.78, 'rgba(0,0,0,0.00)');
        btG.addColorStop(1,    'rgba(0,0,0,0.10)');
        ctx.fillStyle = btG;
        roundRectPath(ctx, bx, by, size, size, r);
        ctx.fill();

        // 3. 浅亮内描边（极轻边缘提亮，不像原 0.62 那么强烈）
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1;
        roundRectPath(ctx, bx + 0.5, by + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
        ctx.stroke();

        // 4. 暗外描边（清晰边界，与底色形成对比）
        ctx.strokeStyle = 'rgba(20,15,40,0.30)';
        ctx.lineWidth = 1;
        roundRectPath(ctx, bx + 1, by + 1, size - 2, size - 2, Math.max(0, r - 1));
        ctx.stroke();

        // 5. emoji icon
        _paintIcon(ctx, bx, by, size, r, originalColor, skin);
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
        _paintIcon(ctx, bx, by, size, r, originalColor, skin);
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

        // 8. icon 覆盖
        _paintIcon(ctx, bx, by, size, r, originalColor, skin);
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

        // 顶部高光：仅在不带 icon 时绘制（带 icon 皮肤如 music 跳过此层，避免顶部白光洗白 emoji 头部）
        if (!skin.blockIcons || !skin.blockIcons.length) {
            const hl = ctx.createLinearGradient(bx, by, bx, by + size);
            hl.addColorStop(0,    'rgba(255,255,255,0.28)');
            hl.addColorStop(0.48, 'rgba(255,255,255,0.00)');
            hl.addColorStop(1,    'rgba(255,255,255,0.00)');
            ctx.fillStyle = hl;
            roundRectPath(ctx, bx, by, size, size, r);
            ctx.fill();
        }
        _paintIcon(ctx, bx, by, size, r, originalColor, skin);
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
    _paintIcon(ctx, bx, by, size, r, originalColor, skin);
}

/** 将棋盘实际 CSS 宽度同步到 --grid-display-px。
 *  注意：--dock-cell-size 已改为 CSS :root 中的固定值，不再由此函数动态覆盖，
 *  避免出现"棋盘格子变大 → dock 槽宽溢出 → overflow:hidden 裁掉候选块"的循环问题。 */
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

function syncGridCanvasCssVar(canvas) {
    if (typeof document === 'undefined') return;
    // 注意：不再向 :root 写 --grid-canvas-width；该变量由 main.css 的 clamp() 自适应决定，
    // 写 inline style 会用更高优先级覆盖 CSS 的自适应规则，导致盘面被锁死成 8×CELL_SIZE = 304px。
    // 仅同步实际 CSS 宽度到 --grid-display-px（候选区单格用此值跟随）。
    requestAnimationFrame(() => syncGridDisplayPx(canvas));
}

/**
 * 粒子溢出余量比例（v10.12）：fxCanvas 比盘面 canvas 大 2 × ratio × cellSize，
 * 让爆炸特效粒子和闪光可飞溅到盘面外，增强立体感。
 * fxCanvas 的物理画布 = (gridSize + 2 × ratio) × cellSize，CSS 上以 negative inset
 * 覆盖在 game-wrapper 上方（整体外扩 ratio × cellSize）。
 * fxCtx 的坐标系经 setTransform 对齐：原点 (0,0) 与盘面 ctx 完全一致，
 * 因此所有粒子绘制代码无需改坐标，只需把 ctx 替换为 fxCtx。
 */
const PARTICLE_MARGIN_RATIO_DEFAULT = 1.5;

export class Renderer {
    /**
     * @param {HTMLCanvasElement} canvas         盘面主画布（仅画盘面+方块+水印）
     * @param {{ fxCanvas?: HTMLCanvasElement, particleMarginRatio?: number }} [opts]
     *        fxCanvas: 可选的特效叠加层；未提供时退化为旧行为（粒子画在主 canvas，会被 game-wrapper overflow:hidden 裁剪）
     */
    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.cellSize = CONFIG.CELL_SIZE;
        this.gridSize = CONFIG.GRID_SIZE;
        this.dpr = this._readDpr();
        // 特效叠加层（粒子 + 闪光独立绘制，可溢出盘面）
        this.fxCanvas = opts.fxCanvas || null;
        this.fxCtx = this.fxCanvas ? this.fxCanvas.getContext('2d') : null;
        this.particleMarginRatio = (opts.particleMarginRatio ?? PARTICLE_MARGIN_RATIO_DEFAULT);
        this._paintMargin = 0; // fx 画布的粒子溢出像素余量（CSS px）
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
        this.iconParticles = [];
        /** @type {Array<{ bonusLine: { type:'row'|'col', idx:number }, icon: string }>} */
        this._iconGushLines = [];
        this._iconGushStart = 0;
        this._iconGushEnd = 0;
        /** @type {Array<{ bonusLine: { type:'row'|'col', idx:number }, cssColor: string }>} */
        this._colorGushLines = [];
        this._colorGushStart = 0;
        this._colorGushEnd = 0;
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
        /** 同色/同 icon 整行整列消除：紫金光晕全屏脉冲 0~1 */
        this._bonusMatchFlash = 0;
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
     * 将主盘面 canvas 物理像素设为 logicalW × dpr，并同步设置 fxCanvas 的扩展物理像素。
     * canvas.width 赋值会重置 context 变换，必须重新 scale。
     */
    _applyCanvasSize(lw, lh) {
        this.logicalW = lw;
        this.logicalH = lh;
        this.canvas._logicalW = lw; // 供 syncGridCanvasCssVar 使用
        this.canvas.width  = Math.round(lw * this.dpr);
        this.canvas.height = Math.round(lh * this.dpr);
        this.ctx.scale(this.dpr, this.dpr);
        this._applyFxCanvasSize();
    }

    /**
     * fxCanvas（特效叠加层）的物理像素同步。
     * fxCanvas CSS 尺寸 = (logicalW + 2m) × (logicalH + 2m)，绝对定位以 -m inset 覆盖盘面外扩区。
     * fxCtx 坐标系通过 setTransform 偏移 m，使 (0,0) 与盘面 ctx 完全一致。
     */
    _applyFxCanvasSize() {
        if (!this.fxCanvas || !this.fxCtx) return;
        const m = Math.round(this.cellSize * this.particleMarginRatio);
        this._paintMargin = m;
        const fxW = this.logicalW + 2 * m;
        const fxH = this.logicalH + 2 * m;
        this.fxCanvas.width  = Math.round(fxW * this.dpr);
        this.fxCanvas.height = Math.round(fxH * this.dpr);
        this.fxCanvas.style.width  = `${fxW}px`;
        this.fxCanvas.style.height = `${fxH}px`;
        // 同步 negative inset：让 fxCanvas 中心与盘面中心对齐（外扩 m）
        this.fxCanvas.style.left = `${-m}px`;
        this.fxCanvas.style.top  = `${-m}px`;
        // setTransform：dpr 缩放 + 偏移 m × dpr，使 fxCtx 的 (0,0) = 盘面左上角
        this.fxCtx.setTransform(
            this.dpr, 0, 0, this.dpr,
            Math.round(m * this.dpr), Math.round(m * this.dpr)
        );
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
        if (this.canvas.width === targetW && this.canvas.height === targetH) {
            // 主 canvas 物理尺寸已对齐，但 fxCanvas 仍可能漂移（DPR 切换或首帧），强制同步
            this._applyFxCanvasSize();
            return;
        }
        // cellSize 随 CSS 尺寸动态调整，保持 gridSize × cellSize = cssW
        this.cellSize = cssW / this.gridSize;
        this._applyCanvasSize(cssW, cssH);
        syncGridDisplayPx(this.canvas);
    }

    /**
     * 盘面大水印：梅花 5 点，每点独立相位的缓慢飘移（无离屏缓存，便于随时间动画）。
     */
    _renderBoardWatermark(skin) {
        const wm = skin.boardWatermark;
        if (!wm?.icons?.length) return;
        const W = this.logicalW;
        const H = this.logicalH;
        const icons = wm.icons;
        const sz = Math.round(Math.min(W, H) * (wm.scale ?? 0.24));
        /* 秒级 + 多频正弦叠加：更大包络、轨迹近似随机游走（每点独立系数） */
        const sec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        const base = Math.min(W, H);
        const amp0 = Math.min(36, Math.max(16, base * 0.052));

        this.ctx.save();
        this.ctx.globalAlpha = wm.opacity ?? 0.07;
        this.ctx.font = `${Math.round(sz * 0.88)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const pts = [
            [W * 0.23, H * 0.23],
            [W * 0.77, H * 0.23],
            [W * 0.50, H * 0.50],
            [W * 0.23, H * 0.77],
            [W * 0.77, H * 0.77],
        ];
        pts.forEach(([bx, by], i) => {
            const phx = i * 1.83 + 0.41;
            const phy = i * 2.27 + 0.67;
            const wx1 = 0.37 + (i % 5) * 0.059;
            const wx2 = 1.09 + i * 0.127;
            const wx3 = 0.71 + (i % 4) * 0.11;
            const wy1 = 0.49 + (i % 4) * 0.073;
            const wy2 = 0.86 + i * 0.101;
            const wy3 = 1.21 + (i % 3) * 0.14;
            const t = sec;
            const dx =
                Math.sin(t * wx1 + phx) * amp0 * 0.58 +
                Math.sin(t * wx2 + phx * 0.62) * amp0 * 0.36 +
                Math.cos(t * wx3 + i * 0.88) * amp0 * 0.28;
            const dy =
                Math.cos(t * wy1 + phy) * amp0 * 0.52 +
                Math.sin(t * wy2 + phy * 0.71) * amp0 * 0.34 +
                Math.sin(t * wy3 + i * 1.03) * amp0 * 0.30;
            this.ctx.fillText(icons[i % icons.length], bx + dx, by + dy);
        });
        this.ctx.restore();
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
        // v10.12: 同步清 fxCanvas（粒子+闪光独立层），范围含粒子溢出余量
        if (this.fxCtx) {
            const m = this._paintMargin || 0;
            this.fxCtx.clearRect(-m, -m, this.logicalW + 2 * m, this.logicalH + 2 * m);
        }
    }

    /**
     * 特效绘制 ctx（粒子 / 闪光 / 涟漪）：有 fxCanvas 时返回 fxCtx，否则退回主 ctx。
     * 两者坐标系完全对齐（fxCtx 经 setTransform 平移 paintMargin），调用方无需变换。
     */
    _effectCtx() {
        return this.fxCtx || this.ctx;
    }

    /**
     * v10.15: 注入皮肤环境粒子层（sakura 樱花 / forest 落叶 / fairy 萤火虫 等）。
     * 由 main.js 创建 AmbientParticles 后调用此方法绑定，由 renderAmbient() 每帧驱动。
     */
    setAmbientLayer(layer) {
        this._ambientLayer = layer || null;
    }

    /**
     * v10.15: 渲染皮肤环境粒子（每帧由 game.render() 在 renderEdgeFalloff() 之后调用）。
     * 粒子状态由 AmbientParticles 自管理；renderer 仅提供 fxCtx 和坐标系信息。
     */
    renderAmbient() {
        if (!this._ambientLayer || !this.fxCtx) return;
        this._ambientLayer.tickAndRender(this.fxCtx, {
            logicalW: this.logicalW,
            logicalH: this.logicalH,
            paintMargin: this._paintMargin || 0,
            cellSize: this.cellSize,
        });
    }

    /**
     * v10.15: 标记需要重绘背景（皮肤切换 / cssVars 更新等场景）。
     * 当前 game.render() 每帧都重绘，此方法保留为皮肤切换时的扩展钩子。
     */
    markBackgroundDirty() {
        this._bgDirty = true;
    }

    /**
     * v10.13: 盘面边缘 → fxCanvas 外区 的柔和色彩过渡光晕。
     *
     * 解决 v10.12 引入 fxCanvas 后暴露的「盘面边缘明显外边框感」问题：
     * 盘面 canvas 的 gridOuter 不透明背景与 fxCanvas 透明粒子区之间存在硬过渡，
     * 配合盘面 box-shadow 让盘面看似浮在外区上，边界感强烈。
     *
     * 实现：在 fxCtx 上以盘面 gridOuter 色绘制宽 m（=cellSize×particleMarginRatio）
     * 的环形渐隐光晕，从盘面边内侧的高 alpha 渐变到 fxCanvas 外缘的 alpha=0。
     *  - 4 直边：LinearGradient 矩形（上下左右）
     *  - 4 角：RadialGradient 矩形（从盘面四角向外扩散，避免直边拼接的灯笼角溢出）
     *
     * 调用顺序：clear() → renderBackground() → renderEdgeFalloff() → ……粒子/闪光
     * 这样光晕处于 fxCanvas 最底层，粒子和闪光在其之上，不被遮挡。
     *
     * 复杂度：每帧 8 次 fillRect + 8 次 createGradient，移动端无感开销。
     */
    renderEdgeFalloff() {
        if (!this.fxCtx || !this._paintMargin) return;
        const m = this._paintMargin;
        const skin = getActiveSkin();
        const lw = this.logicalW;
        const lh = this.logicalH;
        const ec = this.fxCtx;

        // 盘面外框色作为光晕色，深皮肤偏暗、浅皮肤偏亮，与盘面背景天然同色
        const edgeColor = skin.gridOuter || '#000000';
        // 浅皮肤盘面偏亮，光晕色 alpha 略高保证可见；深皮肤无需太强
        const lightBoard = skin.uiDark === false;
        const a0 = lightBoard ? 0.50 : 0.42;
        const c0 = hexToRgba(edgeColor, a0);
        const c1 = hexToRgba(edgeColor, 0);

        ec.save();

        // ---- 4 直边 ----
        let g;
        // 上：从盘面顶 (y=0) 向上渐隐至 y=-m
        g = ec.createLinearGradient(0, 0, 0, -m);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ec.fillStyle = g;
        ec.fillRect(0, -m, lw, m);
        // 下
        g = ec.createLinearGradient(0, lh, 0, lh + m);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ec.fillStyle = g;
        ec.fillRect(0, lh, lw, m);
        // 左
        g = ec.createLinearGradient(0, 0, -m, 0);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ec.fillStyle = g;
        ec.fillRect(-m, 0, m, lh);
        // 右
        g = ec.createLinearGradient(lw, 0, lw + m, 0);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ec.fillStyle = g;
        ec.fillRect(lw, 0, m, lh);

        // ---- 4 角（从盘面顶点向外扩散的 radial）----
        const drawCorner = (cx, cy, rx, ry) => {
            const rg = ec.createRadialGradient(cx, cy, 0, cx, cy, m);
            rg.addColorStop(0, c0);
            rg.addColorStop(1, c1);
            ec.fillStyle = rg;
            ec.fillRect(rx, ry, m, m);
        };
        drawCorner(0, 0, -m, -m);   // 左上
        drawCorner(lw, 0, lw, -m);  // 右上
        drawCorner(0, lh, -m, lh);  // 左下
        drawCorner(lw, lh, lw, lh); // 右下

        ec.restore();
    }

    renderBackground() {
        const skin = getActiveSkin();
        const g = skin.gridGap ?? 1;
        const lightBoard = skin.uiDark === false;
        const outerA = lightBoard ? 0.93 : 0.86;
        const cellA = lightBoard ? 0.84 : 0.70;
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        this.ctx.fillStyle = hexToRgba(skin.gridOuter, outerA);
        this.ctx.fillRect(-10, -10, this.logicalW + 20, this.logicalH + 20);

        const cs = this.cellSize - 2 * g; // 单格可见尺寸
        this.ctx.fillStyle = hexToRgba(skin.gridCell, cellA);
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

        // 盘面水印：在空格色之上、网格线之下叠加主题 emoji（离屏缓存，仅皮肤/尺寸变化时重建）
        this._renderBoardWatermark(skin);

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
        const inset = skin.blockInset ?? 2;
        const br = skin.blockRadius ?? 5;
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
        const inset = skin.blockInset ?? 2;
        const pulse = 0.65 + 0.35 * Math.abs(Math.sin(Date.now() * 0.008));
        /* 轻微抬起：不用 epoch 高频 sin，避免高亮阶段过长时「跳动」 */
        const lift = (1.05 - pulse * 0.4) * (2.2 + 2.8 * pulse);

        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        const br = skin.blockRadius ?? 5;
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
        // v10.12: 闪光画在 fxCtx 上，可溢出盘面到粒子余量区
        const ec = this._effectCtx();
        const m = this._paintMargin || 0;
        const g = ec.createRadialGradient(cx, cy, 0, cx, cy, r);
        const h = this._perfectHue;
        g.addColorStop(0, `hsla(${h}, 100%, 75%, ${0.3 * a})`);
        g.addColorStop(0.3, `hsla(${(h + 60) % 360}, 100%, 65%, ${0.15 * a})`);
        g.addColorStop(0.6, `hsla(${(h + 120) % 360}, 100%, 60%, ${0.06 * a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ec.save();
        ec.translate(this.shakeOffset.x, this.shakeOffset.y);
        ec.fillStyle = g;
        ec.fillRect(-m - this.shakeOffset.x, -m - this.shakeOffset.y,
            this.logicalW + 2 * m, this.logicalH + 2 * m);
        ec.restore();
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
        // v10.12: 涟漪画在 fxCtx 上，水平方向也延伸到粒子余量区
        const ec = this._effectCtx();
        const m = this._paintMargin || 0;
        ec.save();
        ec.translate(this.shakeOffset.x, this.shakeOffset.y);
        for (const row of this._doubleWaveRows) {
            const cy = (row + 0.5) * this.cellSize;
            const g = ec.createLinearGradient(
                this.logicalW * 0.5 - spread, cy,
                this.logicalW * 0.5 + spread, cy
            );
            g.addColorStop(0, `rgba(46, 204, 113, 0)`);
            g.addColorStop(0.3, `rgba(46, 204, 113, ${0.25 * a})`);
            g.addColorStop(0.5, `rgba(255, 255, 255, ${0.35 * a})`);
            g.addColorStop(0.7, `rgba(46, 204, 113, ${0.25 * a})`);
            g.addColorStop(1, `rgba(46, 204, 113, 0)`);
            ec.fillStyle = g;
            ec.fillRect(-m, cy - this.cellSize * 0.6, this.logicalW + 2 * m, this.cellSize * 1.2);
        }
        ec.restore();
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
        // v10.12: 闪光画在 fxCtx 上，可溢出盘面
        const ec = this._effectCtx();
        const m = this._paintMargin || 0;
        const g = ec.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255, 230, 140, ${0.22 * a})`);
        g.addColorStop(0.35, `rgba(255, 170, 60, ${0.12 * a})`);
        g.addColorStop(0.65, `rgba(255, 120, 40, ${0.05 * a})`);
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ec.save();
        ec.translate(this.shakeOffset.x, this.shakeOffset.y);
        ec.fillStyle = g;
        ec.fillRect(-m - this.shakeOffset.x, -m - this.shakeOffset.y,
            this.logicalW + 2 * m, this.logicalH + 2 * m);
        ec.restore();
    }

    /** 同色/同 icon 整行整列：全屏紫+金径向脉冲（与粒子叠加） */
    triggerBonusMatchFlash(bonusLineCount = 1) {
        const n = Math.max(1, bonusLineCount);
        // v10.11: 同 icon 全屏光晕起跳更强（0.42→0.55，每多 1 条 +0.18）
        this._bonusMatchFlash = Math.min(1, 0.55 + n * 0.18);
    }

    decayBonusMatchFlash() {
        if (!this._bonusMatchFlash || this._bonusMatchFlash <= 0) return;
        // 衰减更慢（0.972→0.980），让光晕在画面停留更久
        this._bonusMatchFlash *= 0.980;
        if (this._bonusMatchFlash < 0.010) this._bonusMatchFlash = 0;
    }

    renderBonusMatchFlash() {
        if (!this._bonusMatchFlash || this._bonusMatchFlash <= 0) return;
        const a = this._bonusMatchFlash;
        const cx = this.logicalW * 0.5;
        const cy = this.logicalH * 0.5;
        // v10.11: 半径从 0.88 → 1.05（覆盖整屏外圈），alpha 全面提升 ~30%
        const r = Math.max(this.logicalW, this.logicalH) * 1.05;
        // v10.12: 闪光画在 fxCtx 上，1.05× 半径渐变完整呈现
        const ec = this._effectCtx();
        const m = this._paintMargin || 0;
        const g = ec.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255, 220, 120, ${0.34 * a})`);
        g.addColorStop(0.22, `rgba(200, 120, 255, ${0.24 * a})`);
        g.addColorStop(0.5, `rgba(140, 80, 220, ${0.14 * a})`);
        g.addColorStop(0.78, `rgba(80, 40, 160, ${0.06 * a})`);
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ec.save();
        ec.translate(this.shakeOffset.x, this.shakeOffset.y);
        ec.fillStyle = g;
        ec.fillRect(-m - this.shakeOffset.x, -m - this.shakeOffset.y,
            this.logicalW + 2 * m, this.logicalH + 2 * m);
        ec.restore();
    }

    /**
     * 带 lifeMax 的 bonus 粒子：沿寿命「由小到大」再略收束淡出；无 lifeMax 时返回 null（走旧式 size×life）。
     * @returns {{ scale: number, alphaMul: number }|null}
     */
    _bonusParticleGrowAlpha(p) {
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

    updateParticles() {
        this._tickColorGushSpawn();
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
        // v10.12: 粒子画在 fxCtx 上，可飞溅到盘面外
        const ec = this._effectCtx();
        for (const p of this.particles) {
            const ga = this._bonusParticleGrowAlpha(p);
            let rad;
            let alpha;
            if (ga) {
                rad = p.size * ga.scale;
                alpha = Math.min(1, p.life * 1.05) * ga.alphaMul;
            } else {
                rad = p.size * p.life;
                alpha = p.life;
            }
            ec.globalAlpha = alpha;
            ec.fillStyle = p.color;
            ec.beginPath();
            ec.arc(p.x + this.shakeOffset.x, p.y + this.shakeOffset.y, rad, 0, Math.PI * 2);
            ec.fill();
        }
        ec.globalAlpha = 1;
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
        this.iconParticles = [];
        this._iconGushLines = [];
        this._iconGushEnd = 0;
        this._colorGushLines = [];
        this._colorGushEnd = 0;
        this._comboFlash = 0;
        this._perfectFlash = 0;
        this._doubleWave = 0;
        this._bonusMatchFlash = 0;
    }

    _nowMs() {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    /**
     * 单枚 emoji 粒子（出生帧带「爆炸放大」缩放，寿命约 3–5s 与 clear 阶段对齐）
     * @param {{ type:'row'|'col', idx:number }} bonusLine
     * @param {string} icon
     * @param {{ strongBurst?: boolean }} [opts]
     */
    _pushIconParticle(bonusLine, icon, opts = {}) {
        const strong = !!opts.strongBurst;
        const n = this.gridSize;
        const cs = this.cellSize;
        let x, y;
        if (bonusLine.type === 'row') {
            x = cs * (Math.random() * n);
            y = cs * (bonusLine.idx + 0.5);
        } else {
            x = cs * (bonusLine.idx + 0.5);
            y = cs * (Math.random() * n);
        }
        // v10.11: 爆炸范围全面放大 — 扩散角接近 π / 速度 +50% / 寿命 +30% / 字号 +35%
        const spread = strong ? 3.10 : 2.80;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        const speed = (strong ? 5.5 : 4.0) + Math.random() * (strong ? 17.0 : 14.0);
        const life0 = 1.45 + Math.random() * 0.55;
        this.iconParticles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            icon,
            fontSize: 36 + Math.floor(Math.random() * 56),
            life: life0,
            lifeMax: life0,
            lifeDecay: 0.0028 + Math.random() * 0.0022,
            rotation: (Math.random() - 0.5) * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.20
        });
    }

    /**
     * 同色 bonus 色块粒子：持续涌出用，带 lifeMax 以支持「由小到大」绘制。
     */
    _pushBonusColorParticle(bonusLine, cssColor, opts = {}) {
        const strong = !!opts.strongBurst;
        const n = this.gridSize;
        const cs = this.cellSize;
        let x, y;
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
        // v10.11: spread/speed/life/size 全面放大，与 _pushIconParticle 风格一致
        const spread = strong ? 3.15 : 2.85;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        const speed = (strong ? 4.8 : 3.4) + Math.random() * (strong ? 15.5 : 11.0);
        const life0 = 1.20 + Math.random() * 0.62;
        this.particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - (1.4 + Math.random() * 3.0),
            color,
            life: life0,
            lifeMax: life0,
            lifeDecay: 0.0036 + Math.random() * 0.0036,
            size: 2.8 + Math.random() * (strong ? 11 : 7.5),
            gravityMul: 0.42 + Math.random() * 0.14
        });
    }

    /**
     * 与 beginBonusIconGush 同期：色块沿行/列持续涌出，绘制时由小变大。
     */
    beginBonusColorGush(lineSpecs, durationMs) {
        if (!lineSpecs?.length) return;
        this._colorGushLines = lineSpecs.map(s => ({ bonusLine: s.bonusLine, cssColor: s.cssColor }));
        const now = this._nowMs();
        this._colorGushStart = now;
        this._colorGushEnd = now + Math.max(520, durationMs);
        for (const spec of this._colorGushLines) {
            for (let i = 0; i < 42; i++) {
                this._pushBonusColorParticle(spec.bonusLine, spec.cssColor, { strongBurst: true });
            }
        }
    }

    _tickColorGushSpawn() {
        if (!this._colorGushLines.length) return;
        const now = this._nowMs();
        if (now >= this._colorGushEnd) {
            this._colorGushLines = [];
            return;
        }
        if (this.particles.length > 620) return;
        const span = Math.max(1, this._colorGushEnd - this._colorGushStart);
        const t = (now - this._colorGushStart) / span;
        let rolls = 0;
        if (t < 0.36) rolls = Math.random() < 0.82 ? 3 : 2;
        else if (t < 0.76) rolls = Math.random() < 0.62 ? 2 : 1;
        else rolls = Math.random() < 0.40 ? 1 : 0;
        const burst = t < 0.15;
        for (const spec of this._colorGushLines) {
            for (let k = 0; k < rolls; k++) {
                this._pushBonusColorParticle(spec.bonusLine, spec.cssColor, { strongBurst: burst });
            }
        }
    }

    /**
     * 同色 bonus：首帧密集爆炸 + 整段时长内持续沿行/列涌出，末段渐稀直至消失。
     * @param {Array<{ bonusLine: { type:'row'|'col', idx:number }, icon: string }>} lineSpecs
     * @param {number} durationMs 与 playClearEffect / UI 一致
     */
    beginBonusIconGush(lineSpecs, durationMs) {
        if (!lineSpecs?.length) return;
        this._iconGushLines = lineSpecs.map(s => ({ bonusLine: s.bonusLine, icon: s.icon }));
        const now = this._nowMs();
        this._iconGushStart = now;
        this._iconGushEnd = now + Math.max(520, durationMs);
        for (const spec of this._iconGushLines) {
            for (let i = 0; i < 60; i++) {
                this._pushIconParticle(spec.bonusLine, spec.icon, { strongBurst: true });
            }
        }
    }

    _tickIconGushSpawn() {
        if (!this._iconGushLines.length) return;
        const now = this._nowMs();
        if (now >= this._iconGushEnd) {
            this._iconGushLines = [];
            return;
        }
        if (this.iconParticles.length > 560) return;
        const span = Math.max(1, this._iconGushEnd - this._iconGushStart);
        const t = (now - this._iconGushStart) / span;
        let rolls = 0;
        if (t < 0.36) rolls = Math.random() < 0.86 ? 3 : 2;
        else if (t < 0.76) rolls = Math.random() < 0.62 ? 2 : 1;
        else rolls = Math.random() < 0.42 ? 1 : 0;
        const burst = t < 0.18;
        for (const spec of this._iconGushLines) {
            for (let k = 0; k < rolls; k++) {
                this._pushIconParticle(spec.bonusLine, spec.icon, { strongBurst: burst });
            }
        }
    }

    /**
     * 同 icon/色 行/列消除：沿整行或整列喷射 emoji 粒子（单次批次；持续涌出请用 beginBonusIconGush）。
     * @param {{ type:'row'|'col', idx:number }} bonusLine
     * @param {string} icon  emoji 字符
     * @param {number} [count=40]
     */
    addIconParticles(bonusLine, icon, count = 40) {
        for (let i = 0; i < count; i++) {
            this._pushIconParticle(bonusLine, icon, { strongBurst: false });
        }
    }

    /**
     * 同 icon/色 行/列消除：沿行或列喷射彩色方形色块粒子（不依赖 emoji）。
     * @param {{ type:'row'|'col', idx:number }} bonusLine
     * @param {string} cssColor  CSS 颜色字符串
     * @param {number} [count=24]
     */
    addBonusLineBurst(bonusLine, cssColor, count = 72) {
        const n = this.gridSize;
        const cs = this.cellSize;
        const gold = '#FFD700';
        const white = '#FFFFFF';
        const pushBurst = (x, y, angle, speed, color, life, decay, sz, gMul) => {
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - (1.5 + Math.random() * 2.5),
                color,
                life,
                lifeMax: life,
                lifeDecay: decay,
                size: sz,
                gravityMul: gMul
            });
        };
        for (let i = 0; i < count; i++) {
            let x, y;
            if (bonusLine.type === 'row') {
                x = cs * (Math.random() * n);
                y = cs * (bonusLine.idx + 0.5);
            } else {
                x = cs * (bonusLine.idx + 0.5);
                y = cs * (Math.random() * n);
            }
            // v10.11: 主粒子 spread 2.75 → 3.20 (≈π，几乎半球)；速度 3.5-15.5 → 4.5-22；尺寸 6-18 → 7-25
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 3.20;
            const speed = 4.5 + Math.random() * 17.5;
            const color = i % 3 === 0 ? gold : i % 3 === 1 ? cssColor : white;
            pushBurst(x, y, angle, speed, color,
                1.45 + Math.random() * 0.65,
                0.0042 + Math.random() * 0.0035,
                7 + Math.random() * 18,
                0.48);
        }
        // 内圈高速碎屑（数量 +60% / 速度 +30%）
        for (let k = 0; k < 36; k++) {
            let x, y;
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
        // 金色火花（数量 +60% / 速度 +35%）
        for (let j = 0; j < 36; j++) {
            let x, y;
            if (bonusLine.type === 'row') {
                x = cs * (Math.random() * n);
                y = cs * (bonusLine.idx + 0.5);
            } else {
                x = cs * (bonusLine.idx + 0.5);
                y = cs * (Math.random() * n);
            }
            const lj = 1.75 + Math.random() * 0.45;
            this.particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 36,
                vy: -(12 + Math.random() * 16),
                color: gold,
                life: lj,
                lifeMax: lj,
                lifeDecay: 0.0058 + Math.random() * 0.004,
                size: 3 + Math.random() * 6,
                gravityMul: 0.40
            });
        }
    }

    updateIconParticles() {
        this._tickIconGushSpawn();
        for (let i = this.iconParticles.length - 1; i >= 0; i--) {
            const p = this.iconParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.075;   // 略弱重力，飘屏更久
            p.vx *= 0.988;
            p.rotation += p.rotSpeed;
            p.life -= p.lifeDecay;
            if (p.life <= 0) this.iconParticles.splice(i, 1);
        }
    }

    renderIconParticles() {
        if (!this.iconParticles.length) return;
        // v10.12: emoji 粒子画在 fxCtx 上，可飞溅到盘面外
        const ctx = this._effectCtx();
        const sx = this.shakeOffset.x;
        const sy = this.shakeOffset.y;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const p of this.iconParticles) {
            const lm = p.lifeMax ?? p.life;
            const u = 1 - Math.max(0, p.life) / Math.max(0.001, lm);
            let growScale;
            if (u < 0.44) {
                growScale = 0.16 + 0.84 * ((u / 0.44) ** 0.5);
            } else if (u < 0.78) {
                growScale = 1 + 0.07 * Math.sin(((u - 0.44) / 0.34) * Math.PI * 2);
            } else {
                growScale = Math.max(0.1, 1 - 0.88 * ((u - 0.78) / 0.22));
            }
            const alphaFade = u > 0.83 ? Math.max(0.12, 1 - (u - 0.83) / 0.17) : 1;
            ctx.globalAlpha = Math.min(1, p.life) * alphaFade;
            const pulse = 0.9 + 0.1 * Math.sin(u * Math.PI);
            const fs = Math.max(10, Math.round(p.fontSize * growScale * pulse));
            ctx.font = `${fs}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`;
            ctx.save();
            ctx.translate(p.x + sx, p.y + sy);
            ctx.rotate(p.rotation);
            // 轻量描边增强「炸裂」可读性（不用 shadowBlur 避免发虚）
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillText(p.icon, -1.2, 1.2);
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.fillText(p.icon, 1.2, 1.4);
            ctx.fillStyle = 'black';
            ctx.fillText(p.icon, 0, 0);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    setClearCells(cells) {
        this.clearCells = cells || [];
    }

    render() {
        this.updateShake();
        this.updateParticles();
    }
}
