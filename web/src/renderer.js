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

        ctx.strokeStyle = 'rgba(255,255,255,0.42)';
        ctx.lineWidth = 1.15;
        if (r > 0) {
            roundRectPath(ctx, bx + 0.5, by + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
            ctx.stroke();
        } else {
            ctx.strokeRect(bx + 0.5, by + 0.5, size - 1, size - 1);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
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

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.cellSize = CONFIG.CELL_SIZE;
        this.gridSize = CONFIG.GRID_SIZE;
        this.canvas.width = this.gridSize * this.cellSize;
        this.canvas.height = this.gridSize * this.cellSize;
        this.particles = [];
        this.clearCells = [];
        this.shakeOffset = { x: 0, y: 0 };
        this.shakeIntensity = 0;
        this.shakeDuration = 0;
        this.shakeStart = 0;
    }

    /** 与逻辑层 Grid 尺寸对齐（策略可改边长） */
    setGridSize(size) {
        const n = Math.max(1, Math.floor(size));
        this.gridSize = n;
        this.canvas.width = n * this.cellSize;
        this.canvas.height = n * this.cellSize;
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

        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        const br = skin.blockRadius;
        for (const cell of cells) {
            const px = cell.x * this.cellSize + inset;
            const py = cell.y * this.cellSize + inset;
            const size = this.cellSize - inset * 2;

            this.ctx.fillStyle = skin.clearFlash;
            this.ctx.globalAlpha = 0.92;
            if (br > 0) {
                roundRectPath(this.ctx, px, py, size, size, br);
                this.ctx.fill();
            } else {
                this.ctx.fillRect(px, py, size, size);
            }
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

    addParticles(cells) {
        const palette = getBlockColors();
        for (const cell of cells) {
            const color = palette[cell.color] || '#FFFFFF';
            for (let i = 0; i < 8; i++) {
                this.particles.push({
                    x: cell.x * this.cellSize + this.cellSize / 2,
                    y: cell.y * this.cellSize + this.cellSize / 2,
                    vx: (Math.random() - 0.5) * 12,
                    vy: (Math.random() - 0.5) * 12 - 3,
                    color,
                    life: 1,
                    size: 4 + Math.random() * 4
                });
            }
        }
    }

    updateParticles() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.5;
            p.life -= 0.03;
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
    }

    setClearCells(cells) {
        this.clearCells = cells || [];
    }

    render() {
        this.updateShake();
        this.updateParticles();
    }
}
