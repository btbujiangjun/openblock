/**
 * ambientParticles.js — v10.15 皮肤环境粒子层（Top 5 高 ROI #2）
 *
 * 把"配色皮肤"升级为"活的世界观"。在 fxCanvas 上以低密度持续渲染主题粒子：
 *   sakura  樱花瓣（粉色椭圆 + 旋转下落）
 *   forest  落叶（橙黄旋转 + 缓慢下落）
 *   ocean   气泡（白色透明圆 + 上浮）
 *   fairy   萤火虫（黄绿发光圆 + 漂浮）
 *   universe 流星（白色拖尾 + 斜飞）
 *
 * 设计要点
 * --------
 * - **零侵入**：复用 v10.12 fxCanvas 体系（fxCtx 的坐标原点 = 盘面 0,0），
 *   通过 renderer.renderAmbient() 单一公开接口接入；fxCanvas 的 4 边羽化 mask
 *   会让粒子自然消散在盘面外缘，与已有特效层零冲突。
 * - **低密度低饱和**：每款皮肤同屏 ≤ 14 粒，alpha ≤ 0.55，避免抢戏 / 影响 icon 识别。
 * - **可关闭**：用户偏好（localStorage `openblock_ambient_v1`）+ prefers-reduced-motion 自动关闭。
 * - **生命周期**：粒子飞出 fxCanvas 边即销毁；以恒定流量补充新粒子保持密度。
 * - **皮肤映射**：仅 5 款示范皮肤（其余 31 款不渲染，零开销）。后续可按相同模式扩展。
 *
 * 接入路径
 * --------
 *   const ambient = createAmbientParticles({ renderer: game.renderer });
 *   game._ambient = ambient;        // 由 game.render() 在 renderEdgeFalloff() 之后调用
 *   ambient.applySkin(skinId);      // 皮肤切换时切预设
 */

const STORAGE_KEY = 'openblock_ambient_v1';
const DEFAULT_PREFS = { enabled: true, density: 1.0 };

const PRESETS = {
    sakura: {
        target: 5,
        color: '#FFB7CE',
        kind: 'petal',
        gravity: 0.04,
        wind: 0.06,
        rotateSpeed: 0.025,
        sizeRange: [6, 11],
        alphaRange: [0.42, 0.62],
        speedRange: [0.18, 0.42],
    },
    forest: {
        target: 5,
        color: '#D4882C',
        color2: '#8C5028',
        kind: 'leaf',
        gravity: 0.05,
        wind: 0.04,
        rotateSpeed: 0.020,
        sizeRange: [7, 12],
        alphaRange: [0.45, 0.62],
        speedRange: [0.15, 0.40],
    },
    ocean: {
        target: 6,
        color: '#E8F4FF',
        kind: 'bubble',
        gravity: -0.03,           // 上浮
        wind: 0.018,
        rotateSpeed: 0,
        sizeRange: [3, 9],
        alphaRange: [0.32, 0.55],
        speedRange: [0.10, 0.28],
    },
    fairy: {
        target: 4,
        color: '#C0FF80',
        glow: '#FFFFB0',
        kind: 'firefly',
        gravity: 0.0,
        wind: 0.02,
        rotateSpeed: 0,
        sizeRange: [2.4, 4.8],
        alphaRange: [0.40, 0.78],
        speedRange: [0.06, 0.18],
    },
    universe: {
        target: 3,
        color: '#FFFFFF',
        kind: 'meteor',
        gravity: 0.0,
        wind: 0.0,
        rotateSpeed: 0,
        sizeRange: [1.5, 2.6],
        alphaRange: [0.55, 0.95],
        speedRange: [3.6, 6.2],
    },
    /* v10.16 流体背景预设（Top P1 #2） — 不是离散粒子而是 sin 波形 / 极光带 */
    aurora: {
        target: 1,
        color: '#7EE8FA',
        color2: '#EEC0E5',
        color3: '#FFD160',
        kind: 'aurora-band',
        gravity: 0,
        wind: 0,
        rotateSpeed: 0,
        sizeRange: [0, 0],
        alphaRange: [0.06, 0.12],
        speedRange: [0, 0],
    },
    koi: {
        target: 1,
        color: '#4070D8',
        color2: '#E84A6F',
        kind: 'ripple',
        gravity: 0,
        wind: 0,
        rotateSpeed: 0,
        sizeRange: [0, 0],
        alphaRange: [0.07, 0.15],
        speedRange: [0, 0],
    },
};

function _loadPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_PREFS };
        return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

function _savePrefs(prefs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function _rand(a, b) { return a + Math.random() * (b - a); }

export class AmbientParticles {
    constructor({ renderer }) {
        this.renderer = renderer;
        this.prefs = _loadPrefs();
        this.preset = null;
        this.particles = [];
        this._lastTickTs = 0;
        this._reducedMotion = this._detectReducedMotion();
    }

    setEnabled(b) { this.prefs.enabled = !!b; _savePrefs(this.prefs); if (!b) this.particles = []; }
    setDensity(d) {
        this.prefs.density = Math.max(0, Math.min(2, +d || 1));
        _savePrefs(this.prefs);
    }
    getPrefs() { return { ...this.prefs }; }
    hasActiveMotion() {
        return Boolean(this.preset && this.prefs.enabled && !this._reducedMotion && this.prefs.density > 0);
    }
    getFrameIntervalMs() {
        if (!this.hasActiveMotion()) return 1000;
        if (this.preset.kind === 'aurora-band' || this.preset.kind === 'ripple') return 1000;
        if (this.preset.kind === 'meteor') return 500;
        return 700;
    }

    /** 切换预设（皮肤切换时调用） */
    applySkin(skinId) {
        const next = PRESETS[skinId] || null;
        if (this.preset === next) return;
        this.preset = next;
        this.particles = [];   // 清空旧粒子，避免视觉污染
    }

    /**
     * 由 renderer.renderAmbient() 在每帧 fxCtx 渲染时调用。
     * 自管理粒子状态，不依赖 game 主循环。
     */
    tickAndRender(fxCtx, ctxState) {
        if (!fxCtx || !this.preset || !this.prefs.enabled || this._reducedMotion) return;

        const lw = ctxState.logicalW;
        const lh = ctxState.logicalH;
        const m  = ctxState.paintMargin || 0;

        const now = performance.now();
        const dt = this._lastTickTs ? Math.min(48, now - this._lastTickTs) : 16;
        this._lastTickTs = now;
        const dtUnit = dt / 16;

        const target = Math.round(this.preset.target * this.prefs.density);
        while (this.particles.length < target) this._spawn(lw, lh, m);

        const survivors = [];
        for (const p of this.particles) {
            this._step(p, dtUnit);
            if (this._inBounds(p, lw, lh, m)) survivors.push(p);
        }
        this.particles = survivors;

        this._draw(fxCtx, lw, lh, m);

        /* v10.16 流体背景：跟特定皮肤的非粒子流场效果（极光带 / 涟漪） */
        if (this.preset.kind === 'aurora-band') {
            this._drawAuroraBand(fxCtx, lw, lh, m);
        } else if (this.preset.kind === 'ripple') {
            this._drawRipple(fxCtx, lw, lh, m);
        }
    }

    _detectReducedMotion() {
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch { return false; }
    }

    _spawn(lw, lh, m) {
        const p = this.preset;
        const kind = p.kind;
        const size = _rand(p.sizeRange[0], p.sizeRange[1]);
        const alpha = _rand(p.alphaRange[0], p.alphaRange[1]);
        const speed = _rand(p.speedRange[0], p.speedRange[1]);

        let x, y, vx, vy, rot, rotV;
        rot = _rand(0, Math.PI * 2);
        rotV = (Math.random() < 0.5 ? -1 : 1) * p.rotateSpeed * (0.6 + Math.random() * 0.8);

        if (kind === 'meteor') {
            x = _rand(-m, lw + m);
            y = -m + _rand(0, m * 0.4);
            vx = -_rand(0.6, 1.2) * speed;
            vy = _rand(0.7, 1.0) * speed;
        } else if (kind === 'bubble') {
            x = _rand(-m * 0.3, lw + m * 0.3);
            y = lh + _rand(0, m);
            vx = _rand(-1, 1) * p.wind;
            vy = -speed;
        } else if (kind === 'firefly') {
            x = _rand(-m * 0.2, lw + m * 0.2);
            y = _rand(-m * 0.2, lh + m * 0.2);
            vx = _rand(-1, 1) * speed;
            vy = _rand(-1, 1) * speed;
        } else {
            x = _rand(-m, lw + m);
            y = -m + _rand(0, m * 0.6);
            vx = _rand(-0.5, 1) * p.wind;
            vy = speed;
        }

        return this.particles.push({
            kind, x, y, vx, vy, size, alpha, rot, rotV,
            phase: Math.random() * Math.PI * 2,
        });
    }

    _step(p, dt) {
        const preset = this.preset;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += preset.gravity * dt;
        if (preset.wind && p.kind !== 'meteor') {
            p.vx += Math.sin((p.y + p.phase * 30) * 0.012) * preset.wind * 0.06 * dt;
        }
        p.rot += p.rotV * dt;
        if (p.kind === 'firefly') {
            p.phase += 0.06 * dt;
            p.alpha = preset.alphaRange[0] +
                (preset.alphaRange[1] - preset.alphaRange[0]) *
                (0.5 + 0.5 * Math.sin(p.phase));
        }
    }

    _inBounds(p, lw, lh, m) {
        const pad = m + Math.max(20, p.size * 4);
        return p.x > -pad && p.x < lw + pad && p.y > -pad && p.y < lh + pad;
    }

    _edgeFade(p, lw, lh, m) {
        const fade = Math.max(12, Math.min(36, m * 0.55));
        const left = -m;
        const top = -m;
        const right = lw + m;
        const bottom = lh + m;
        const dx = Math.min(p.x - left, right - p.x);
        const dy = Math.min(p.y - top, bottom - p.y);
        return Math.max(0, Math.min(1, dx / fade, dy / fade));
    }

    _draw(ctx, lw, lh, m) {
        ctx.save();
        for (const p of this.particles) {
            ctx.globalAlpha = p.alpha * this._edgeFade(p, lw, lh, m);
            switch (p.kind) {
                case 'petal':
                    this._drawPetal(ctx, p);
                    break;
                case 'leaf':
                    this._drawLeaf(ctx, p);
                    break;
                case 'bubble':
                    this._drawBubble(ctx, p);
                    break;
                case 'firefly':
                    this._drawFirefly(ctx, p);
                    break;
                case 'meteor':
                    this._drawMeteor(ctx, p);
                    break;
            }
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    _drawPetal(ctx, p) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = this.preset.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    _drawLeaf(ctx, p) {
        const c = (Math.sin(p.phase) > 0) ? this.preset.color : (this.preset.color2 || this.preset.color);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#5C2820';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.9, 0);
        ctx.lineTo(p.size * 0.9, 0);
        ctx.stroke();
        ctx.restore();
    }

    _drawBubble(ctx, p) {
        ctx.save();
        ctx.strokeStyle = this.preset.color;
        ctx.fillStyle = `rgba(255,255,255,0.10)`;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    _drawFirefly(ctx, p) {
        ctx.save();
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3.5);
        grad.addColorStop(0, this.preset.glow || '#FFFFB0');
        grad.addColorStop(0.4, this.preset.color);
        grad.addColorStop(1, 'rgba(192,255,128,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    _drawAuroraBand(ctx, lw, lh, m) {
        const t = performance.now() / 4200;
        const preset = this.preset;
        const colors = [preset.color, preset.color2, preset.color3 || preset.color];
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, lw, lh);
        ctx.clip();

        for (let band = 0; band < 2; band++) {
            const top = [];
            const bottom = [];
            const baseY = lh * (0.18 + band * 0.13);
            const amp = lh * 0.035 + band * 3;
            const thickness = lh * (0.075 + band * 0.018);
            const phase = t * (0.45 + band * 0.14);

            for (let x = 0; x <= lw; x += 16) {
                const y = baseY + Math.sin(x * 0.011 + phase) * amp + Math.cos(x * 0.021 - phase * 1.3) * (amp * 0.36);
                top.push([x, y]);
                bottom.push([x, y + thickness + Math.sin(x * 0.016 - phase) * (amp * 0.22)]);
            }

            ctx.beginPath();
            ctx.moveTo(top[0][0], top[0][1]);
            for (const [x, y] of top) {
                ctx.lineTo(x, y);
            }
            for (let i = bottom.length - 1; i >= 0; i--) {
                ctx.lineTo(bottom[i][0], bottom[i][1]);
            }
            ctx.closePath();

            const grad = ctx.createLinearGradient(0, baseY - amp, 0, baseY + thickness + amp);
            grad.addColorStop(0, colors[band] + '00');
            grad.addColorStop(0.35, colors[band] + '66');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.globalAlpha = preset.alphaRange[0] + (preset.alphaRange[1] - preset.alphaRange[0]) * (0.5 + 0.5 * Math.sin(t + band));
            ctx.fill();
        }
        void m;
        ctx.restore();
    }

    _drawRipple(ctx, lw, lh, m) {
        const t = performance.now() / 2600;
        const preset = this.preset;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, lw, lh);
        ctx.clip();

        for (let i = 0; i < 3; i++) {
            const phase = (t * 0.22 + i * 0.33) % 1;
            const radius = phase * (lw * 0.34);
            const cx = lw * (0.28 + 0.22 * i);
            const cy = lh * (0.22 + 0.10 * (i % 2));
            const alpha = (1 - phase) * (preset.alphaRange[0] + 0.025 * i);
            ctx.strokeStyle = (i % 2 === 0 ? preset.color : preset.color2) || preset.color;
            ctx.globalAlpha = Math.max(0, alpha);
            ctx.lineWidth = 1.15;
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(0, radius), Math.PI * 0.08, Math.PI * 1.72);
            ctx.stroke();
        }
        void m;
        ctx.restore();
    }

    _drawMeteor(ctx, p) {
        ctx.save();
        const len = 24;
        const tx = p.x - p.vx * 5;
        const ty = p.y - p.vy * 5;
        const grad = ctx.createLinearGradient(tx, ty, p.x, p.y);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, this.preset.color);
        ctx.strokeStyle = grad;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.fillStyle = this.preset.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // 防 "未使用变量" warning：len 仅为可读性常量
        void len;
    }
}

let _instance = null;
export function createAmbientParticles(opts) {
    if (!_instance) {
        _instance = new AmbientParticles(opts);
        if (typeof window !== 'undefined') window.__ambientParticles = _instance;
    }
    return _instance;
}

function _getAmbientParticles() { return _instance; }

const _AMBIENT_PRESETS = Object.freeze({ ...PRESETS });
