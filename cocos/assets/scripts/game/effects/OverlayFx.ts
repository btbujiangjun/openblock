import { _decorator, Component, Graphics, UITransform, Color, Node, Label, UIOpacity, tween, Tween, v3 } from 'cc';
import { Motion } from '../platform/Motion';
import { VisualFx } from '../platform/VisualFx';

const { ccclass } = _decorator;

/**
 * 全屏消行闪光叠加层 —— 严格对齐 web `renderer.js` 的四类闪光 + 衰减：
 *   combo  暖金径向光晕      （triggerComboFlash / renderComboFlash）
 *   double 沿消除行水平绿色涟漪（triggerDoubleWave / renderDoubleWave）
 *   bonus  紫金径向脉冲      （triggerBonusMatchFlash / renderBonusMatchFlash）
 *   perfect 彩虹径向脉冲 + 冲击波环（triggerPerfectFlash / renderPerfectFlash）
 *
 * 另含 bonus icon 喷涌（对齐 web beginBonusIconGush 的轻量版：沿同 icon 行喷出 emoji 上浮淡出）。
 *
 * cc.Graphics 无 CanvasGradient → 径向光晕用「外暗内亮多层同心圆」近似；
 * 衰减按 `pow(rate, dt*60)` 做帧率无关化（web 是逐 60fps 帧衰减）。
 *
 * Motion.reduced 时所有 trigger 变 no-op（全屏脉冲对前庭敏感人群不友好），与 ScreenShake 一致。
 *
 * 叠放：挂在 Play 容器最顶层（盘面 / 环境 / 碎屑之上），与 web fxCanvas 全屏闪光同层级。
 */
@ccclass('OverlayFx')
export class OverlayFx extends Component {
    boardPx = 480;
    size = 8;

    private _g: Graphics | null = null;
    private _comboFlash = 0;
    private _doubleWave = 0;
    private _doubleRows: number[] = [];
    private _bonusFlash = 0;
    private _perfectFlash = 0;
    private _perfectShock = 0;
    private _perfectHue = 0;
    /** 上一帧是否有活跃闪光：用于在「无闪光」常态下跳过每帧 g.clear()（只在 active→idle 翻转时清一次）。 */
    private _wasActive = false;
    /** 复用绘制 Color（闪光期每帧逐 stop 重设；Graphics.fillColor/strokeColor setter 拷贝值 → 复用安全）。 */
    private _col = new Color(255, 255, 255, 255);

    private col(r: number, g: number, b: number, a: number): Color {
        const c = this._col;
        c.r = r; c.g = g; c.b = b; c.a = a;
        return c;
    }

    /** gush emoji 节点对象池：一次 bonus 消行可喷 6×specs 个 Label 节点，复用避免成批 new Node + destroy。 */
    private _gushPool: Node[] = [];

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

    // ── triggers（对齐 web 同名函数的起跳强度）─────────────────────────────
    triggerComboFlash(lineCount: number): void {
        if (Motion.reduced || !VisualFx.enabled) return;
        const n = Math.max(3, lineCount);
        this._comboFlash = Math.min(0.95, 0.28 + n * 0.09);
    }

    triggerDoubleWave(rows: number[]): void {
        if (Motion.reduced || !VisualFx.enabled) return;
        this._doubleWave = 1.0;
        this._doubleRows = rows ? rows.slice() : [];
    }

    triggerBonusMatchFlash(bonusLineCount = 1): void {
        if (Motion.reduced || !VisualFx.enabled) return;
        const n = Math.max(1, bonusLineCount);
        this._bonusFlash = Math.min(1, 0.55 + n * 0.18);
    }

    triggerPerfectFlash(): void {
        if (Motion.reduced || !VisualFx.enabled) return;
        this._perfectFlash = 1.0;
        this._perfectShock = 1.0;
    }

    /** bonus icon 喷涌（轻量版）：沿同 icon 行/列喷出若干 emoji，上浮 + 淡出。 */
    bonusIconGush(specs: Array<{ type: 'row' | 'col'; idx: number; icon: string }>): void {
        if (Motion.reduced || !VisualFx.enabled || !specs.length) return;
        const cell = this.boardPx / this.size;
        const half = this.boardPx / 2;
        const per = 6;
        for (const s of specs) {
            if (!s.icon) continue;
            for (let k = 0; k < per; k++) {
                let x: number, y: number;
                if (s.type === 'row') {
                    x = -half + (Math.random() * this.size) * cell;
                    y = half - (s.idx + 0.5) * cell;
                } else {
                    x = -half + (s.idx + 0.5) * cell;
                    y = -half + (Math.random() * this.size) * cell;
                }
                this.spawnGushIcon(s.icon, x, y, cell);
            }
        }
    }

    private spawnGushIcon(icon: string, x: number, y: number, cell: number): void {
        let n = this._gushPool.pop();
        let l: Label;
        let op: UIOpacity;
        if (n && n.isValid) {
            Tween.stopAllByTarget(n);
            l = n.getComponent(Label)!;
            op = n.getComponent(UIOpacity)!;
            Tween.stopAllByTarget(op);
        } else {
            n = new Node('gushIcon');
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            l = n.addComponent(Label);
            op = n.addComponent(UIOpacity);
        }
        n.parent = this.node;
        n.active = true;
        n.setPosition(x, y, 0);
        l.string = icon;
        l.fontSize = Math.round(cell * 0.7);
        l.lineHeight = l.fontSize;
        op.opacity = 235;
        const dx = (Math.random() * 2 - 1) * cell * 1.2;
        const dy = cell * (1.6 + Math.random() * 1.4);
        n.setScale(0.6, 0.6, 1);
        const node = n;
        tween(n).to(0.16, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
        tween(n).to(0.7, { position: v3(x + dx, y + dy, 0) }, { easing: 'quadOut' }).start();
        tween(op).delay(0.32).to(0.38, { opacity: 0 }).call(() => this.recycleGush(node)).start();
    }

    /** gush 动画结束回收进池（上限 32，超出销毁），替代 destroy。 */
    private recycleGush(n: Node): void {
        if (!n?.isValid) return;
        n.active = false;
        n.removeFromParent();
        if (this._gushPool.length < 32) this._gushPool.push(n);
        else n.destroy();
    }

    update(dt: number): void {
        const g = this._g;
        if (!g) return;
        const f = (rate: number) => Math.pow(rate, dt * 60);

        // 衰减（对齐 web decay*）。
        if (this._comboFlash > 0) { this._comboFlash *= f(0.94); if (this._comboFlash < 0.015) this._comboFlash = 0; }
        if (this._doubleWave > 0) { this._doubleWave *= f(0.96); if (this._doubleWave < 0.015) this._doubleWave = 0; }
        if (this._bonusFlash > 0) { this._bonusFlash *= f(0.980); if (this._bonusFlash < 0.010) this._bonusFlash = 0; }
        if (this._perfectFlash > 0) { this._perfectFlash *= f(0.976); if (this._perfectFlash < 0.02) this._perfectFlash = 0; }
        if (this._perfectShock > 0) { this._perfectShock *= f(0.965); if (this._perfectShock < 0.018) this._perfectShock = 0; }
        this._perfectHue = (this._perfectHue + 7 * dt * 60) % 360;

        const active = this._comboFlash > 0 || this._doubleWave > 0 || this._bonusFlash > 0 || this._perfectFlash > 0;
        // 常态（无任何闪光）下不每帧 g.clear()：仅在 active→idle 翻转那一帧清一次，其余帧零开销返回。
        if (!active) {
            if (this._wasActive) { g.clear(); this._wasActive = false; }
            return;
        }
        this._wasActive = true;
        g.clear();

        if (this._bonusFlash > 0) this.drawBonus(g);
        if (this._comboFlash > 0) this.drawCombo(g);
        if (this._doubleWave > 0) this.drawDouble(g);
        if (this._perfectFlash > 0) this.drawPerfect(g);
    }

    /** 外暗内亮多层同心圆近似径向渐变（stops: at∈[0,1] 自中心向外，alpha 已乘 a）。 */
    private radialGlow(g: Graphics, r: number, stops: Array<{ at: number; rgb: [number, number, number]; alpha: number }>): void {
        // 从外向内画，内层覆盖在外层之上形成「中心最亮」的堆叠。
        const ordered = stops.slice().sort((p, q) => q.at - p.at);
        for (const s of ordered) {
            const radius = Math.max(1, r * Math.max(0.04, s.at));
            const a = Math.max(0, Math.min(255, Math.round(s.alpha * 255)));
            if (a <= 0) continue;
            g.fillColor = this.col(s.rgb[0], s.rgb[1], s.rgb[2], a);
            g.circle(0, 0, radius);
            g.fill();
        }
    }

    private drawCombo(g: Graphics): void {
        const a = this._comboFlash;
        const r = this.boardPx * 0.72;
        this.radialGlow(g, r, [
            { at: 0.18, rgb: [255, 230, 140], alpha: 0.22 * a },
            { at: 0.5, rgb: [255, 170, 60], alpha: 0.12 * a },
            { at: 0.85, rgb: [255, 120, 40], alpha: 0.05 * a },
        ]);
    }

    private drawBonus(g: Graphics): void {
        const a = this._bonusFlash;
        const r = this.boardPx * 0.72;
        this.radialGlow(g, r, [
            { at: 0.16, rgb: [255, 220, 120], alpha: 0.22 * a },
            { at: 0.46, rgb: [200, 120, 255], alpha: 0.16 * a },
            { at: 0.82, rgb: [140, 80, 220], alpha: 0.07 * a },
        ]);
    }

    private drawDouble(g: Graphics): void {
        const a = this._doubleWave;
        if (!this._doubleRows.length) return;
        const cell = this.boardPx / this.size;
        const half = this.boardPx / 2;
        const spread = (1 - a) * this.boardPx * 0.6;
        const w = Math.max(cell, spread * 2);
        for (const row of this._doubleRows) {
            const cy = half - (row + 0.5) * cell;
            // 外侧绿、内侧白的水平带（用两层近似 web 的 5-stop 线性渐变）。
            g.fillColor = this.col(46, 204, 113, Math.round(0.22 * a * 255));
            g.rect(-w / 2, cy - cell * 0.6, w, cell * 1.2);
            g.fill();
            g.fillColor = this.col(255, 255, 255, Math.round(0.32 * a * 255));
            g.rect(-w * 0.18, cy - cell * 0.3, w * 0.36, cell * 0.6);
            g.fill();
        }
    }

    private drawPerfect(g: Graphics): void {
        const a = this._perfectFlash;
        const r = this.boardPx * 0.78;
        const hue = this._perfectHue;
        this.radialGlow(g, r, [
            { at: 0.16, rgb: hslToRgb(hue, 0.9, 0.66), alpha: 0.20 * a },
            { at: 0.5, rgb: hslToRgb((hue + 60) % 360, 0.9, 0.6), alpha: 0.13 * a },
            { at: 0.82, rgb: hslToRgb((hue + 140) % 360, 0.85, 0.56), alpha: 0.06 * a },
        ]);
        if (this._perfectShock > 0) {
            const sw = this._perfectShock;
            const cell = this.boardPx / this.size;
            const ringR = r * (1 - sw) * 1.05 + cell * 0.3;
            const rgb = hslToRgb((hue + 200) % 360, 0.95, 0.72);
            g.strokeColor = this.col(rgb[0], rgb[1], rgb[2], Math.round(0.6 * sw * 255));
            g.lineWidth = Math.max(2, cell * 0.16) * (0.4 + 0.6 * sw);
            g.circle(0, 0, Math.max(1, ringR));
            g.stroke();
        }
    }
}

/** HSL→RGB（h∈[0,360), s/l∈[0,1]）→ [r,g,b] 0..255。 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    const m = l - c / 2;
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
