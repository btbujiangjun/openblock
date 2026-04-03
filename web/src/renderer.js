/**
 * Block Blast - Renderer
 * Canvas rendering with visual effects
 */
import { CONFIG, COLORS } from './config.js';

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
    return `rgb(${Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * percent))}, ${min(255, Math.floor(rgb.g + (255 - rgb.g) * percent))}, ${Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * percent))})`;
}

function min(a, b) {
    return a < b ? a : b;
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
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        this.ctx.fillStyle = '#D4DDE4';
        this.ctx.fillRect(-10, -10, this.canvas.width + 20, this.canvas.height + 20);

        this.ctx.fillStyle = '#C5D3DE';
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const px = x * this.cellSize + 1;
                const py = y * this.cellSize + 1;
                this.ctx.fillRect(px, py, this.cellSize - 2, this.cellSize - 2);
            }
        }

        this.ctx.restore();
    }

    renderGrid(grid) {
        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                if (grid.cells[y][x] !== null) {
                    this.drawBlock(x, y, COLORS[grid.cells[y][x]]);
                }
            }
        }

        this.ctx.restore();
    }

    renderPreview(x, y, block) {
        if (!block) return;

        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);
        this.ctx.globalAlpha = 0.5;

        for (let py = 0; py < block.height; py++) {
            for (let px = 0; px < block.width; px++) {
                if (block.shape[py][px]) {
                    this.drawBlock(x + px, y + py, COLORS[block.colorIdx]);
                }
            }
        }

        this.ctx.restore();
    }

    renderClearCells(cells) {
        if (!cells || cells.length === 0) return;

        this.ctx.save();
        this.ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

        for (const cell of cells) {
            const px = cell.x * this.cellSize + 2;
            const py = cell.y * this.cellSize + 2;
            const size = this.cellSize - 4;

            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.globalAlpha = 0.9;
            this.ctx.fillRect(px, py, size, size);
        }

        this.ctx.restore();
    }

    drawBlock(x, y, color) {
        const s = this.cellSize;
        const px = x * s;
        const py = y * s;
        const inset = 2;
        const size = s - inset * 2;

        const gradient = this.ctx.createLinearGradient(px, py, px + s, py);
        gradient.addColorStop(0, darkenColor(color, 0.15));
        gradient.addColorStop(0.2, color);
        gradient.addColorStop(0.5, lightenColor(color, 0.15));
        gradient.addColorStop(1, darkenColor(color, 0.2));
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(px + inset, py + inset, size, size);

        const hl = this.ctx.createLinearGradient(px, py, px, py + size * 0.5);
        hl.addColorStop(0, 'rgba(255,255,255,0.5)');
        hl.addColorStop(1, 'rgba(255,255,255,0)');
        this.ctx.fillStyle = hl;
        this.ctx.fillRect(px + inset, py + inset, size, size * 0.5);

        this.ctx.fillStyle = 'rgba(255,255,255,0.6)';
        this.ctx.beginPath();
        this.ctx.moveTo(px + inset + 3, py + inset + 3);
        this.ctx.lineTo(px + inset + size * 0.35, py + inset + 3);
        this.ctx.lineTo(px + inset + 3, py + inset + size * 0.35);
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(px + inset, py + size + inset);
        this.ctx.lineTo(px + inset, py + inset);
        this.ctx.lineTo(px + size + inset, py + inset);
        this.ctx.stroke();

        this.ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        this.ctx.beginPath();
        this.ctx.moveTo(px + size + inset, py + inset);
        this.ctx.lineTo(px + size + inset, py + size + inset);
        this.ctx.lineTo(px + inset, py + size + inset);
        this.ctx.stroke();
    }

    drawDockBlock(ctx, x, y, color, cellSize) {
        const s = cellSize || this.cellSize;
        const px = x * s;
        const py = y * s;
        const inset = 2;
        const size = s - inset * 2;

        const gradient = ctx.createLinearGradient(px, py, px + s, py);
        gradient.addColorStop(0, darkenColor(color, 0.15));
        gradient.addColorStop(0.2, color);
        gradient.addColorStop(0.5, lightenColor(color, 0.15));
        gradient.addColorStop(1, darkenColor(color, 0.2));
        ctx.fillStyle = gradient;
        ctx.fillRect(px + inset, py + inset, size, size);

        const hl = ctx.createLinearGradient(px, py, px, py + size * 0.5);
        hl.addColorStop(0, 'rgba(255,255,255,0.5)');
        hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl;
        ctx.fillRect(px + inset, py + inset, size, size * 0.5);

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.moveTo(px + inset + 3, py + inset + 3);
        ctx.lineTo(px + inset + size * 0.35, py + inset + 3);
        ctx.lineTo(px + inset + 3, py + inset + size * 0.35);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px + inset, py + size + inset);
        ctx.lineTo(px + inset, py + inset);
        ctx.lineTo(px + size + inset, py + inset);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(px + size + inset, py + inset);
        ctx.lineTo(px + size + inset, py + size + inset);
        ctx.lineTo(px + inset, py + size + inset);
        ctx.stroke();
    }

    addParticles(cells) {
        for (const cell of cells) {
            const color = COLORS[cell.color] || '#FFFFFF';
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
        const intensity = this.shakeIntensity * (1 - progress);
        this.shakeOffset = {
            x: (Math.random() - 0.5) * intensity * 2,
            y: (Math.random() - 0.5) * intensity * 2
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
