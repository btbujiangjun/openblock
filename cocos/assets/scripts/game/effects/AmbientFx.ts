import { _decorator, Component, Graphics, UITransform, Color } from 'cc';
import { Motion } from '../platform/Motion';
import { VisualFx } from '../platform/VisualFx';

const { ccclass } = _decorator;

/**
 * 皮肤环境粒子层 —— 严格对齐 web `web/src/effects/ambientParticles.js`。
 *
 * 把「配色皮肤」升级为「活的世界观」：在盘面区域低密度持续渲染主题粒子。
 *   sakura   樱花瓣（粉色椭圆 + 旋转下落）
 *   forest   落叶（橙黄椭圆 + 旋转下落 + 叶脉）
 *   ocean    气泡（白色透明圆 + 上浮）
 *   fairy    萤火虫（黄绿发光圆 + 漂浮，多层圆近似径向渐变）
 *   universe 流星（白色拖尾线 + 斜飞）
 *   aurora   极光带（sin 波形流体带，半透明填充近似渐变）
 *   koi      涟漪（同心弧扩散）
 *
 * 与 web 差异（cc.Graphics 限制）：
 *   - 无 CanvasGradient → firefly / aurora / meteor 的渐变用多层 alpha 近似；
 *   - 旋转椭圆用多边形采样点旋转后填充（Graphics 无 path 级旋转）。
 *
 * 坐标：内部沿用 web「左上原点、y 向下」的 logical 空间 [0..boardPx]，
 * 绘制时转成 cocos 节点坐标（中心原点、y 向上）：nodeX = lx - half, nodeY = half - ly。
 * 这样可逐行对照 web 的 spawn/step 数学，重力符号无需翻转。
 *
 * 接入：Bootstrap 在 Play 容器下挂本组件；GameController.applySkin 时调 applySkin(skin.id)，
 * relayout 时调 setBoardPx(px)。Motion.reduced 时整层静默（与 ScreenShake 一致）。
 */

type AmbientKind = 'petal' | 'leaf' | 'bubble' | 'firefly' | 'meteor' | 'aurora-band' | 'ripple';

interface Preset {
    target: number;
    color: string;
    color2?: string;
    color3?: string;
    glow?: string;
    kind: AmbientKind;
    gravity: number;
    wind: number;
    rotateSpeed: number;
    sizeRange: [number, number];
    alphaRange: [number, number];
    speedRange: [number, number];
}

interface AmbientParticle {
    kind: AmbientKind;
    x: number; y: number;
    vx: number; vy: number;
    size: number; alpha: number;
    rot: number; rotV: number;
    phase: number;
}

/** 与 web ambientParticles.js PRESETS 严格同参。 */
const PRESETS: Record<string, Preset> = {
    sakura: { target: 5, color: '#FFB7CE', kind: 'petal', gravity: 0.04, wind: 0.06, rotateSpeed: 0.025, sizeRange: [6, 11], alphaRange: [0.42, 0.62], speedRange: [0.18, 0.42] },
    forest: { target: 5, color: '#D4882C', color2: '#8C5028', kind: 'leaf', gravity: 0.05, wind: 0.04, rotateSpeed: 0.020, sizeRange: [7, 12], alphaRange: [0.45, 0.62], speedRange: [0.15, 0.40] },
    ocean: { target: 6, color: '#E8F4FF', kind: 'bubble', gravity: -0.03, wind: 0.018, rotateSpeed: 0, sizeRange: [3, 9], alphaRange: [0.32, 0.55], speedRange: [0.10, 0.28] },
    fairy: { target: 4, color: '#C0FF80', glow: '#FFFFB0', kind: 'firefly', gravity: 0.0, wind: 0.02, rotateSpeed: 0, sizeRange: [2.4, 4.8], alphaRange: [0.40, 0.78], speedRange: [0.06, 0.18] },
    universe: { target: 3, color: '#FFFFFF', kind: 'meteor', gravity: 0.0, wind: 0.0, rotateSpeed: 0, sizeRange: [1.5, 2.6], alphaRange: [0.55, 0.95], speedRange: [3.6, 6.2] },
    aurora: { target: 1, color: '#7EE8FA', color2: '#EEC0E5', color3: '#FFD160', kind: 'aurora-band', gravity: 0, wind: 0, rotateSpeed: 0, sizeRange: [0, 0], alphaRange: [0.06, 0.12], speedRange: [0, 0] },
    koi: { target: 1, color: '#4070D8', color2: '#E84A6F', kind: 'ripple', gravity: 0, wind: 0, rotateSpeed: 0, sizeRange: [0, 0], alphaRange: [0.07, 0.15], speedRange: [0, 0] },
};

function rand(a: number, b: number): number { return a + Math.random() * (b - a); }

function hexToRGB(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    const v = h.length === 3
        ? h.split('').map((c) => c + c).join('')
        : h;
    const n = parseInt(v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

@ccclass('AmbientFx')
export class AmbientFx extends Component {
    boardPx = 480;

    private _g: Graphics | null = null;
    private _preset: Preset | null = null;
    private _particles: AmbientParticle[] = [];
    private _time = 0;            // 累计秒，驱动 aurora/ripple 相位
    private _acc = 0;             // 节流累加器：~30Hz 重绘（慢速装饰粒子肉眼无差，active 期也省一半）
    private _rgb: [number, number, number] = [255, 255, 255];
    private _rgb2: [number, number, number] = [255, 255, 255];
    private _rgb3: [number, number, number] = [255, 255, 255];
    private _glowRgb: [number, number, number] = [255, 255, 176];
    /** 复用绘制 Color（每帧逐粒子/逐层重设；Graphics.fillColor/strokeColor setter 拷贝值 → 复用安全）。 */
    private _col = new Color(255, 255, 255, 255);

    /** 写入并返回复用的 scratch Color，避免每帧逐粒子 new Color 的 GC 压力。 */
    private col(r: number, g: number, b: number, a: number): Color {
        const c = this._col;
        c.r = r; c.g = g; c.b = b; c.a = a;
        return c;
    }

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.boardPx, this.boardPx);
        uit.setAnchorPoint(0.5, 0.5);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
    }

    setBoardPx(px: number): void {
        this.boardPx = px;
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(px, px);
    }

    /** 皮肤切换：切预设并清空旧粒子（避免新旧形态混渲）。无预设的皮肤零开销。 */
    applySkin(skinId: string): void {
        const next = PRESETS[skinId] || null;
        if (this._preset === next) return;
        this._preset = next;
        this._particles.length = 0;
        this._g?.clear();
        if (next) {
            this._rgb = hexToRGB(next.color);
            this._rgb2 = hexToRGB(next.color2 || next.color);
            this._rgb3 = hexToRGB(next.color3 || next.color);
            this._glowRgb = hexToRGB(next.glow || '#FFFFB0');
        }
    }

    /**
     * 低内存压力下临时释放粒子 buffer，保留 _preset —— 下次 update() 自动重新 spawn。
     * 与 applySkin('') 不同的关键：不丢预设，玩家无感（系统压力解除后立刻恢复环境氛围）。
     */
    trimForLowMemory(): void {
        if (this._particles.length === 0) return;
        this._particles.length = 0;
        this._g?.clear();
    }

    private get half(): number { return this.boardPx / 2; }
    private get margin(): number { return Math.max(12, this.boardPx * 0.08); }

    private nx(lx: number): number { return lx - this.half; }
    private ny(ly: number): number { return this.half - ly; }

    update(dt: number): void {
        const g = this._g;
        const p = this._preset;
        if (!g) return;
        if (!p || Motion.reduced || !VisualFx.enabled) {
            if (this._particles.length) { this._particles.length = 0; g.clear(); }
            this._acc = 0;
            return;
        }
        // ~30Hz 节流：累计 dt，不足一帧间隔就跳过本帧重绘（用累计 dt 步进 → 运动总速度不变）。
        this._acc += dt;
        if (this._acc < 1 / 34) return;
        const fdt = this._acc;
        this._acc = 0;
        this._time += fdt;
        const dtUnit = Math.min(48, fdt * 1000) / 16;
        const lw = this.boardPx;
        const lh = this.boardPx;
        const m = this.margin;

        if (p.kind === 'aurora-band' || p.kind === 'ripple') {
            g.clear();
            if (p.kind === 'aurora-band') this.drawAuroraBand(g, lw, lh);
            else this.drawRipple(g, lw, lh);
            return;
        }

        const target = p.target;
        while (this._particles.length < target) this.spawn(lw, lh, m);

        const survivors: AmbientParticle[] = [];
        for (const pt of this._particles) {
            this.step(pt, dtUnit);
            if (this.inBounds(pt, lw, lh, m)) survivors.push(pt);
        }
        this._particles = survivors;

        g.clear();
        for (const pt of this._particles) this.draw(g, pt, lw, lh, m);
    }

    private spawn(lw: number, lh: number, m: number): void {
        const p = this._preset!;
        const kind = p.kind;
        const size = rand(p.sizeRange[0], p.sizeRange[1]);
        const alpha = rand(p.alphaRange[0], p.alphaRange[1]);
        const speed = rand(p.speedRange[0], p.speedRange[1]);
        const rot = rand(0, Math.PI * 2);
        const rotV = (Math.random() < 0.5 ? -1 : 1) * p.rotateSpeed * (0.6 + Math.random() * 0.8);
        let x: number, y: number, vx: number, vy: number;
        if (kind === 'meteor') {
            x = rand(-m, lw + m); y = -m + rand(0, m * 0.4);
            vx = -rand(0.6, 1.2) * speed; vy = rand(0.7, 1.0) * speed;
        } else if (kind === 'bubble') {
            x = rand(-m * 0.3, lw + m * 0.3); y = lh + rand(0, m);
            vx = rand(-1, 1) * p.wind; vy = -speed;
        } else if (kind === 'firefly') {
            x = rand(-m * 0.2, lw + m * 0.2); y = rand(-m * 0.2, lh + m * 0.2);
            vx = rand(-1, 1) * speed; vy = rand(-1, 1) * speed;
        } else {
            x = rand(-m, lw + m); y = -m + rand(0, m * 0.6);
            vx = rand(-0.5, 1) * p.wind; vy = speed;
        }
        this._particles.push({ kind, x, y, vx, vy, size, alpha, rot, rotV, phase: Math.random() * Math.PI * 2 });
    }

    private step(pt: AmbientParticle, dt: number): void {
        const p = this._preset!;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vy += p.gravity * dt;
        if (p.wind && pt.kind !== 'meteor') {
            pt.vx += Math.sin((pt.y + pt.phase * 30) * 0.012) * p.wind * 0.06 * dt;
        }
        pt.rot += pt.rotV * dt;
        if (pt.kind === 'firefly') {
            pt.phase += 0.06 * dt;
            pt.alpha = p.alphaRange[0] + (p.alphaRange[1] - p.alphaRange[0]) * (0.5 + 0.5 * Math.sin(pt.phase));
        }
    }

    private inBounds(pt: AmbientParticle, lw: number, lh: number, m: number): boolean {
        const pad = m + Math.max(20, pt.size * 4);
        return pt.x > -pad && pt.x < lw + pad && pt.y > -pad && pt.y < lh + pad;
    }

    private edgeFade(pt: AmbientParticle, lw: number, lh: number, m: number): number {
        const fade = Math.max(12, Math.min(36, m * 0.55));
        const dx = Math.min(pt.x - (-m), (lw + m) - pt.x);
        const dy = Math.min(pt.y - (-m), (lh + m) - pt.y);
        return Math.max(0, Math.min(1, dx / fade, dy / fade));
    }

    private a255(alpha: number): number { return Math.max(0, Math.min(255, Math.round(alpha * 255))); }

    private draw(g: Graphics, pt: AmbientParticle, lw: number, lh: number, m: number): void {
        const a = pt.alpha * this.edgeFade(pt, lw, lh, m);
        if (a <= 0.001) return;
        switch (pt.kind) {
            case 'petal': this.drawPetal(g, pt, a); break;
            case 'leaf': this.drawLeaf(g, pt, a); break;
            case 'bubble': this.drawBubble(g, pt, a); break;
            case 'firefly': this.drawFirefly(g, pt, a); break;
            case 'meteor': this.drawMeteor(g, pt, a); break;
            default: break;
        }
    }

    /** 旋转椭圆采样为 14 边形后填充（Graphics 无 path 旋转）。 */
    private fillRotatedEllipse(g: Graphics, cxLogical: number, cyLogical: number, rx: number, ry: number, rot: number, color: Color): void {
        const cx = this.nx(cxLogical);
        const cy = this.ny(cyLogical);
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const seg = 14;
        g.fillColor = color;
        for (let i = 0; i <= seg; i++) {
            const th = (i / seg) * Math.PI * 2;
            const ex = Math.cos(th) * rx;
            const ey = Math.sin(th) * ry;
            // 注意 logical y 向下，节点 y 向上：先在 logical 旋转，再翻 y。
            const lxr = ex * cos - ey * sin;
            const lyr = ex * sin + ey * cos;
            const px = cx + lxr;
            const py = cy - lyr;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.close();
        g.fill();
    }

    private drawPetal(g: Graphics, pt: AmbientParticle, a: number): void {
        this.fillRotatedEllipse(g, pt.x, pt.y, pt.size, pt.size * 0.55, pt.rot,
            this.col(this._rgb[0], this._rgb[1], this._rgb[2], this.a255(a)));
    }

    private drawLeaf(g: Graphics, pt: AmbientParticle, a: number): void {
        const useC2 = Math.sin(pt.phase) <= 0 && this._preset?.color2;
        const c = useC2 ? this._rgb2 : this._rgb;
        this.fillRotatedEllipse(g, pt.x, pt.y, pt.size, pt.size * 0.5, pt.rot,
            this.col(c[0], c[1], c[2], this.a255(a)));
        // 叶脉：一条沿主轴的暗线。
        const cx = this.nx(pt.x), cy = this.ny(pt.y);
        const cos = Math.cos(pt.rot), sin = Math.sin(pt.rot);
        const ex = pt.size * 0.9;
        g.strokeColor = this.col(92, 40, 32, this.a255(a));
        g.lineWidth = 0.8;
        g.moveTo(cx + (-ex * cos), cy - (-ex * sin));
        g.lineTo(cx + (ex * cos), cy - (ex * sin));
        g.stroke();
    }

    private drawBubble(g: Graphics, pt: AmbientParticle, a: number): void {
        const cx = this.nx(pt.x), cy = this.ny(pt.y);
        g.fillColor = this.col(255, 255, 255, this.a255(a * 0.10));
        g.circle(cx, cy, pt.size);
        g.fill();
        g.strokeColor = this.col(this._rgb[0], this._rgb[1], this._rgb[2], this.a255(a));
        g.lineWidth = 0.9;
        g.circle(cx, cy, pt.size);
        g.stroke();
    }

    /** 多层同心圆近似径向渐变发光。 */
    private drawFirefly(g: Graphics, pt: AmbientParticle, a: number): void {
        const cx = this.nx(pt.x), cy = this.ny(pt.y);
        const layers = 4;
        for (let i = layers; i >= 1; i--) {
            const r = pt.size * 3.5 * (i / layers);
            const t = i / layers;                 // 外圈 1 → 内圈靠 0
            const mix = 1 - t;                    // 越内越亮
            const rr = Math.round(this._glowRgb[0] * mix + this._rgb[0] * t);
            const gg = Math.round(this._glowRgb[1] * mix + this._rgb[1] * t);
            const bb = Math.round(this._glowRgb[2] * mix + this._rgb[2] * t);
            const la = a * (0.10 + 0.5 * mix);
            g.fillColor = this.col(rr, gg, bb, this.a255(la));
            g.circle(cx, cy, r);
            g.fill();
        }
    }

    private drawMeteor(g: Graphics, pt: AmbientParticle, a: number): void {
        const hx = this.nx(pt.x), hy = this.ny(pt.y);
        const tx = this.nx(pt.x - pt.vx * 5), ty = this.ny(pt.y - pt.vy * 5);
        g.strokeColor = this.col(this._rgb[0], this._rgb[1], this._rgb[2], this.a255(a * 0.9));
        g.lineWidth = Math.max(1, pt.size);
        g.moveTo(tx, ty);
        g.lineTo(hx, hy);
        g.stroke();
        g.fillColor = this.col(this._rgb[0], this._rgb[1], this._rgb[2], this.a255(a));
        g.circle(hx, hy, pt.size * 0.9);
        g.fill();
    }

    /** 极光带：两条 sin 波形填充带（半透明，alpha 随相位脉动；无渐变，用中段 alpha 近似）。 */
    private drawAuroraBand(g: Graphics, lw: number, lh: number): void {
        const t = this._time / 4.2;
        const p = this._preset!;
        const colors = [this._rgb, this._rgb2, this._rgb3];
        for (let band = 0; band < 2; band++) {
            const baseY = lh * (0.18 + band * 0.13);
            const amp = lh * 0.035 + band * 3;
            const thickness = lh * (0.075 + band * 0.018);
            const phase = t * (0.45 + band * 0.14);
            const top: Array<[number, number]> = [];
            const bottom: Array<[number, number]> = [];
            for (let x = 0; x <= lw; x += 16) {
                const y = baseY + Math.sin(x * 0.011 + phase) * amp + Math.cos(x * 0.021 - phase * 1.3) * (amp * 0.36);
                top.push([x, y]);
                bottom.push([x, y + thickness + Math.sin(x * 0.016 - phase) * (amp * 0.22)]);
            }
            const c = colors[band];
            const alpha = p.alphaRange[0] + (p.alphaRange[1] - p.alphaRange[0]) * (0.5 + 0.5 * Math.sin(t + band));
            g.fillColor = this.col(c[0], c[1], c[2], this.a255(alpha * 0.6));
            g.moveTo(this.nx(top[0][0]), this.ny(top[0][1]));
            for (const [x, y] of top) g.lineTo(this.nx(x), this.ny(y));
            for (let i = bottom.length - 1; i >= 0; i--) g.lineTo(this.nx(bottom[i][0]), this.ny(bottom[i][1]));
            g.close();
            g.fill();
        }
    }

    /** 涟漪：3 道随相位扩散的同心弧。 */
    private drawRipple(g: Graphics, lw: number, lh: number): void {
        const t = this._time / 2.6;
        const p = this._preset!;
        for (let i = 0; i < 3; i++) {
            const phase = (t * 0.22 + i * 0.33) % 1;
            const radius = phase * (lw * 0.34);
            const cx = lw * (0.28 + 0.22 * i);
            const cy = lh * (0.22 + 0.10 * (i % 2));
            const alpha = (1 - phase) * (p.alphaRange[0] + 0.025 * i);
            if (alpha <= 0 || radius <= 0) continue;
            const c = i % 2 === 0 ? this._rgb : this._rgb2;
            g.strokeColor = this.col(c[0], c[1], c[2], this.a255(alpha));
            g.lineWidth = 1.15;
            g.arc(this.nx(cx), this.ny(cy), radius, Math.PI * 0.08, Math.PI * 1.72, false);
            g.stroke();
        }
    }
}
