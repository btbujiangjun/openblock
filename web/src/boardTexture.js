/**
 * 盘面 / 候选区背景纹理（极简宣纸：大块晕染 + 少量横丝，避免冗乱）
 */

function _hash01(a, b, c, seed) {
    let h = (seed + a * 374761393 + b * 668265263 + c * 982451653) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {{ opacity?: number, intensity?: number, seed?: number }} [spec]
 * @param {'high' | 'balanced' | 'low' | string} [qualityMode]
 */
export function paintXuanPaperTexture(ctx, x, y, w, h, spec = {}, qualityMode = 'high') {
    if (!ctx || w <= 0 || h <= 0) return;
    const opacity = spec.opacity ?? 0.34;
    const intensity = spec.intensity ?? 0.55;
    const seed = spec.seed ?? 0x1E6B8A11;
    const density = qualityMode === 'low' ? 0.45 : qualityMode === 'balanced' ? 0.7 : 1;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const step = qualityMode === 'low' ? 16 : 12;
    ctx.globalCompositeOperation = 'soft-light';
    for (let py = 0; py < h; py += step) {
        for (let px = 0; px < w; px += step) {
            const n = _hash01(px, py, 1, seed);
            if (n > 0.84) {
                ctx.fillStyle = `rgba(168,148,118,${0.022 * opacity * intensity})`;
                ctx.fillRect(x + px, y + py, step, step);
            } else if (n < 0.1) {
                ctx.fillStyle = `rgba(255,252,245,${0.016 * opacity * intensity})`;
                ctx.fillRect(x + px, y + py, step, step);
            }
        }
    }

    ctx.globalCompositeOperation = 'multiply';
    const hCount = Math.floor(h * 0.7 * intensity * density);
    for (let i = 0; i < hCount; i++) {
        const py = y + _hash01(i, 0, 2, seed) * h;
        const alpha = (0.006 + _hash01(i, 1, 2, seed) * 0.01) * opacity;
        ctx.strokeStyle = `rgba(108,96,82,${alpha})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, py);
        ctx.lineTo(x + w, py + (_hash01(i, 2, 2, seed) - 0.5) * 1.2);
        ctx.stroke();
    }

    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.4, cx, cy, Math.max(w, h) * 0.9);
    vig.addColorStop(0, 'rgba(255,255,255,0)');
    vig.addColorStop(1, `rgba(120,100,78,${0.022 * opacity})`);
    ctx.fillStyle = vig;
    ctx.fillRect(x, y, w, h);

    ctx.restore();
}

/** @param {{ type?: string, opacity?: number, intensity?: number, seed?: number }} | undefined} spec */
export function paintBoardTexture(ctx, x, y, w, h, spec, qualityMode = 'high') {
    if (!spec?.type) return;
    if (spec.type === 'xuanPaper') {
        paintXuanPaperTexture(ctx, x, y, w, h, spec, qualityMode);
    }
}
