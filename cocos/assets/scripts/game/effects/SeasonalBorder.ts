import { _decorator, Component, Graphics, UITransform, Color } from 'cc';
import { Motion } from '../platform/Motion';
import { VisualFx } from '../platform/VisualFx';

const { ccclass } = _decorator;

/**
 * 季节限定盘面外光晕（移植 web `effects/seasonalBorder.js`）：节日当天在盘面四周叠一圈流动彩带。
 * 非节日日期零开销（不绘制）。挂在 Play 容器、盘面坐标系（原点居中），随 boardPx 调整外框。
 *
 * 与 web 对齐：
 *  - 节日表按 'M-D' / 'YYYY-M-D'（农历节日带年份）匹配，半小时刷新一次活动状态。
 *  - 每条颜色一条沿周长流动的亮带（phase 随时间推进），底色为暗淡边。
 *  - `!VisualFx.enabled` → 不绘制（与其它特效层一致受「视觉特效」总开关约束）；
 *    `Motion.reduced` → 仅画静态暗边、不流动（避免持续运动刺激前庭）。
 */
const FESTIVAL_BORDERS: Record<string, { name: string; colors: string[] }> = {
    '1-1': { name: '元旦', colors: ['#FFD160', '#7EE8FA', '#EEC0E5'] },
    '2-14': { name: '情人节', colors: ['#FF8FA3', '#FFD0E0'] },
    '4-5': { name: '清明', colors: ['#9BCBA8'] },
    '10-1': { name: '国庆', colors: ['#E84A4A', '#FFD160'] },
    '10-31': { name: '万圣节', colors: ['#FF8C40', '#5028B0'] },
    '12-24': { name: '圣诞夜', colors: ['#1A8C4A', '#E84A4A'] },
    '12-25': { name: '圣诞节', colors: ['#1A8C4A', '#E84A4A'] },
    '12-31': { name: '跨年', colors: ['#FFD160', '#7EE8FA', '#EEC0E5', '#A4D9F2'] },
    // 春节 / 中秋等农历节日按年份对接（与 seasonalSkin dates 同源）。
    '2026-2-17': { name: '春节', colors: ['#E84A4A', '#FFD160'] },
    '2026-3-3': { name: '元宵', colors: ['#FF8C40', '#FFD160'] },
    '2026-9-25': { name: '中秋', colors: ['#FFD160', '#5060C8'] },
};

function hexToColor(hex: string): Color {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return new Color(r, g, b, 255);
}

@ccclass('SeasonalBorder')
export class SeasonalBorder extends Component {
    boardPx = 480;
    margin = 14;

    private _g: Graphics | null = null;
    private _colors: Color[] = [];
    private _active = false;
    private _time = 0;
    private _drewStatic = false;
    /** 复用绘制 Color：流动期每帧绘制 baseEdges + 多条 band（各 1-2 次 fillColor），避免逐帧 new Color 的 GC。 */
    private _col = new Color(255, 255, 255, 255);

    private col(r: number, g: number, b: number, a: number): Color {
        const c = this._col;
        c.r = r; c.g = g; c.b = b; c.a = a;
        return c;
    }

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(this.boardPx, this.boardPx);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        this.refreshActive();
        // 半小时刷新活动状态（对齐 web setInterval 30min），覆盖跨节日边界长时间挂机。
        this.schedule(this.refreshActive, 1800);
    }

    setBoardPx(px: number): void {
        this.boardPx = px;
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(px, px);
        this._drewStatic = false;
    }

    private refreshActive(): void {
        const d = new Date();
        const k1 = `${d.getMonth() + 1}-${d.getDate()}`;
        const k2 = `${d.getFullYear()}-${k1}`;
        const border = FESTIVAL_BORDERS[k2] || FESTIVAL_BORDERS[k1] || null;
        this._active = !!border;
        this._colors = border ? border.colors.map(hexToColor) : [];
        this._drewStatic = false;
        if (!this._active) this._g?.clear();
    }

    update(dt: number): void {
        const g = this._g;
        if (!g) return;
        if (!this._active || this._colors.length === 0 || !VisualFx.enabled) {
            if (this._time !== 0 || !this._drewStatic) { g.clear(); this._time = 0; this._drewStatic = false; }
            return;
        }
        if (Motion.reduced) {
            // 静态暗边一次性绘制，之后不再每帧重绘（省开销）。
            if (this._drewStatic) return;
            g.clear();
            this.drawBaseEdges(g, this._colors[0], 40);
            this._drewStatic = true;
            return;
        }
        this._time += dt;
        g.clear();
        this.drawBaseEdges(g, this._colors[0], 26);
        const half = this.boardPx / 2;
        const outer = half + this.margin;
        const span = outer * 2;
        const bandLen = span * 0.32;
        const t = this._time / 2.4;
        for (let i = 0; i < this._colors.length; i++) {
            const phase = ((t * 0.4 + i * 0.18) % 1 + 1) % 1;
            const c = this._colors[i];
            const off = i * 1.5;
            // 垂直两边：亮带从顶向下流动。
            const cy = outer - phase * span;
            this.drawBand(g, c, -outer + off, cy, 5, bandLen, true);
            this.drawBand(g, c, outer - 5 - off, cy, 5, bandLen, true);
            // 水平两边：亮带从左向右流动。
            const cx = -outer + phase * span;
            this.drawBand(g, c, cx, outer - 5 - off, bandLen, 5, false);
            this.drawBand(g, c, cx, -outer + off, bandLen, 5, false);
        }
    }

    /** 四条暗淡底边（节日色），alpha 低，营造常驻外框。 */
    private drawBaseEdges(g: Graphics, c: Color, alpha: number): void {
        const half = this.boardPx / 2;
        const outer = half + this.margin;
        const span = outer * 2;
        g.fillColor = this.col(c.r, c.g, c.b, alpha);
        g.rect(-outer, -outer, 5, span);          // 左
        g.rect(outer - 5, -outer, 5, span);        // 右
        g.rect(-outer, outer - 5, span, 5);        // 上
        g.rect(-outer, -outer, span, 5);           // 下
        g.fill();
    }

    /** 一段流动亮带（vertical=true 时 x 固定、沿 y 铺 len；否则 y 固定、沿 x 铺 len），含两层 alpha falloff 近似。 */
    private drawBand(g: Graphics, c: Color, x: number, y: number, w: number, h: number, vertical: boolean): void {
        const half = this.boardPx / 2;
        const outer = half + this.margin;
        if (vertical) {
            const y0 = Math.max(-outer, y - h / 2);
            const y1 = Math.min(outer, y + h / 2);
            if (y1 <= y0) return;
            g.fillColor = this.col(c.r, c.g, c.b, 50);
            g.rect(x, y0, w, y1 - y0);
            g.fill();
            const iy0 = Math.max(-outer, y - h / 4);
            const iy1 = Math.min(outer, y + h / 4);
            if (iy1 > iy0) { g.fillColor = this.col(c.r, c.g, c.b, 95); g.rect(x, iy0, w, iy1 - iy0); g.fill(); }
        } else {
            const x0 = Math.max(-outer, x - w / 2);
            const x1 = Math.min(outer, x + w / 2);
            if (x1 <= x0) return;
            g.fillColor = this.col(c.r, c.g, c.b, 50);
            g.rect(x0, y, x1 - x0, h);
            g.fill();
            const ix0 = Math.max(-outer, x - w / 4);
            const ix1 = Math.min(outer, x + w / 4);
            if (ix1 > ix0) { g.fillColor = this.col(c.r, c.g, c.b, 95); g.rect(ix0, y, ix1 - ix0, h); g.fill(); }
        }
    }

    onDestroy(): void {
        this.unschedule(this.refreshActive);
    }
}
