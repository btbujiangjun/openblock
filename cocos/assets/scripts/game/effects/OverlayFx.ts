import { _decorator, Component, Graphics, UITransform, Color, Node, Label, UIOpacity, tween, Tween, v3 } from 'cc';
import { Motion } from '../platform/Motion';
import { VisualFx } from '../platform/VisualFx';

/**
 * 与 web 主端通用彩色 emoji 字体栈一致；与 skin/blockPaint.ts 的 ICON_FONT_FAMILY 同源，
 * 避免 Cocos 默认 Arial 渲染 emoji 失败（方框）。
 */
const EMOJI_FONT_FAMILY = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif';

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

    /** gush emoji 节点对象池：一次 bonus 消行可喷 36+ × specs 个 Label 节点，复用避免成批 new Node + destroy。 */
    private _gushPool: Node[] = [];
    /** 当前活跃的 icon 喷涌任务（每个 bonusLine 一个），由 update() 调度持续 spawn 直至到期。 */
    private _gushTasks: Array<{
        type: 'row' | 'col';
        idx: number;
        icon: string;
        startMs: number;
        endMs: number;
        spawnAcc: number;
    }> = [];
    /** 当前在屏 icon 粒子数（限流，对齐 web `iconParticles.length > 320` 的硬阀）。 */
    private _gushAlive = 0;
    /** 逐帧驱动的 icon 粒子 ticker（对齐 web updateIconParticles + renderIconParticles 的帧率无关物理积分）。 */
    private _gushTickers: Array<(dt: number) => void> = [];

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

    /**
     * 「同花顺」icon 持续喷涌 —— 严格对齐 web `beginBonusIconGush`（renderer.js）：
     *
     *   1. 首帧每条 bonusLine **强爆发 36 个 icon**（strongBurst：扩散角 3.10rad ≈ 178°，速度 5.5-22.5 单位/帧）；
     *   2. 整段 `durationMs`（默认 ≈ `bonusEffectHoldMs(specCount)` = 3000-5000ms）内**持续 spawn**：
     *      - t < 0.36 段：每 ~33ms 滚 1 次，70% 出 2 个 / 30% 出 1 个；
     *      - t < 0.76 段：每 ~33ms 滚 1 次，55% 出 1 个 / 45% 出 0 个；
     *      - 末段：每 ~33ms 滚 1 次，30% 出 1 个；
     *   3. 在屏并发上限 320（与 web `iconParticles.length > 320` 同），超出当帧停 spawn 等回收。
     *
     * Cocos 没有 `iconParticles[]` 数组渲染，改用 Label 节点 + tween 自驱动 + 对象池回收。
     * Reduce Motion / 总开关关闭 → no-op（与 web 一致）。
     */
    bonusIconGush(specs: Array<{ type: 'row' | 'col'; idx: number; icon: string }>, durationMs?: number): void {
        if (Motion.reduced || !VisualFx.enabled || !specs.length) return;
        const cell = this.boardPx / this.size;
        const half = this.boardPx / 2;
        // duration 兜底：未传时按 web `bonusEffectHoldMs(specs.length)` 估算 3000-5000ms。
        const span = Math.max(520, durationMs ?? Math.min(5000, Math.max(3000, 3000 + specs.length * 400)));
        const now = Date.now();

        // 首帧强爆发：每条 bonusLine 36 个 icon，全方位放射 + 重力 + 自旋（strongBurst=true）。
        for (const s of specs) {
            if (!s.icon) continue;
            for (let i = 0; i < 36; i++) {
                const { x, y } = this.gushSpawnPos(s, cell, half);
                this.spawnGushIcon(s.icon, x, y, cell, /*strongBurst*/ true);
            }
            // 持续 spawn 任务入队（update 内按 web 时间窗口节奏 spawn）。
            this._gushTasks.push({ type: s.type, idx: s.idx, icon: s.icon, startMs: now, endMs: now + span, spawnAcc: 0 });
        }
    }

    /** bonusLine 上随机一格位置（row 沿横向、col 沿纵向均匀分布）。 */
    private gushSpawnPos(s: { type: 'row' | 'col'; idx: number }, cell: number, half: number): { x: number; y: number } {
        if (s.type === 'row') {
            return { x: -half + Math.random() * this.size * cell, y: half - (s.idx + 0.5) * cell };
        }
        return { x: -half + (s.idx + 0.5) * cell, y: -half + Math.random() * this.size * cell };
    }

    /** 整段时长内持续 spawn 调度（每帧节流；时间过期 / 上限超限均跳过）。 */
    private tickGushSpawn(dt: number): void {
        if (!this._gushTasks.length) return;
        const now = Date.now();
        const cell = this.boardPx / this.size;
        const half = this.boardPx / 2;
        // 末端过期清理。
        for (let i = this._gushTasks.length - 1; i >= 0; i--) {
            if (now >= this._gushTasks[i].endMs) this._gushTasks.splice(i, 1);
        }
        if (!this._gushTasks.length) return;
        // web `iconParticles.length > 320` 上限直接套用（cocos Label 渲染开销与 emoji 同量级）。
        if (this._gushAlive > 320) return;
        // 每 ~33ms 触发一次 spawn 滚动（与 web 60fps 节奏对齐：当 dt~16ms 时两帧滚一次）。
        for (const task of this._gushTasks) {
            task.spawnAcc += dt;
            if (task.spawnAcc < 0.033) continue;
            task.spawnAcc = 0;
            const span = Math.max(1, task.endMs - task.startMs);
            const t = (now - task.startMs) / span;
            let rolls = 0;
            if (t < 0.36) rolls = Math.random() < 0.70 ? 2 : 1;
            else if (t < 0.76) rolls = Math.random() < 0.55 ? 1 : 0;
            else rolls = Math.random() < 0.30 ? 1 : 0;
            const burst = t < 0.18;
            for (let k = 0; k < rolls; k++) {
                if (this._gushAlive > 320) break;
                const { x, y } = this.gushSpawnPos(task, cell, half);
                this.spawnGushIcon(task.icon, x, y, cell, burst);
            }
        }
    }

    /**
     * 单个 icon 粒子的生成与动画 —— 严格对齐 web `_pushIconParticle` + `renderIconParticles`：
     *
     * 物理参数：
     *   spread     strongBurst ? 3.10rad ≈ 178° : 2.80rad ≈ 160°
     *   angle      `-π/2 + rand × spread`（基准向上，水平方向大范围随机）
     *   speed      strongBurst ? 5.5-22.5 : 4-18 单位/帧（web 60fps；cocos × 60 = px/s）
     *   life       1.45-2.0 s（cocos 用 tween duration 直接覆盖）
     *   fontSize   36-92px 随机（与 web 完全一致）
     *   rotation   ±π 起始 + rotSpeed ±0.20 rad/帧（cocos × 60 ≈ ±12 rad/s）
     *
     * 渲染：严格对齐 web `renderIconParticles` 的 3 阶段 growScale 曲线
     *   u < 0.44  : growIn  = 0.16 + 0.84 × sqrt(u/0.44)    — 由小爆大
     *   u < 0.78  : oscillate = 1 + 0.07 × sin((u-0.44)/0.34 × 2π) — 呼吸脉冲
     *   u >= 0.78 : shrink = max(0.1, 1 - 0.88 × (u-0.78)/0.22)    — 缩小消失
     *   alphaFade : u > 0.83 时 max(0.12, 1 - (u-0.83)/0.17)
     *   pulse     : 0.9 + 0.1 × sin(u × π)
     */
    private spawnGushIcon(icon: string, x: number, y: number, cell: number, strongBurst: boolean): void {
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
        const fontSize = 36 + Math.floor(Math.random() * 56);
        const anyL = l as unknown as { useSystemFont: boolean; fontFamily: string; fontSize: number; lineHeight: number };
        anyL.useSystemFont = true;
        anyL.fontFamily = EMOJI_FONT_FAMILY;
        anyL.fontSize = fontSize;
        anyL.lineHeight = fontSize;
        l.string = icon;
        op.opacity = 235;

        const spread = strongBurst ? 3.10 : 2.80;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        const speedFrame = (strongBurst ? 5.5 : 4.0) + Math.random() * (strongBurst ? 17.0 : 14.0);
        const vxPxSec = Math.cos(angle) * speedFrame * 60;
        const vyPxSec = Math.sin(angle) * speedFrame * 60;
        const life = 1.45 + Math.random() * 0.55;
        // web: vy += 0.075/帧 → 0.075×3600 = 270 px/s²（icon 用更弱重力，飘屏更久）
        const gravity = 270;
        const lifeDecay = 0.0028 + Math.random() * 0.0022;

        const startAngle = (Math.random() - 0.5) * 360;
        const rotSpeedDeg = (Math.random() - 0.5) * 0.20 * 60 * (180 / Math.PI);
        n.angle = startAngle;
        // web: vx *= 0.988/帧 → 阻尼因子
        const damping = 0.988;

        const node = n;
        void l; // label 配置已完成，后续由 node.scale 驱动视觉缩放
        this._gushAlive++;

        // 用 update 调度逐帧积分（对齐 web updateIconParticles + renderIconParticles 的帧率无关化），
        // 而非 tween 预算终点（tween 只能做线性/缓动插值，无法模拟 web 的逐帧 vx*=damping + vy+=gravity + 3阶段 growScale）。
        const state = {
            x, y, vx: vxPxSec, vy: vyPxSec,
            lifeVal: life, lifeMax: life, lifeDecay,
            rotation: startAngle, rotSpeedDeg,
            baseFontSize: fontSize,
        };
        // 初始缩放：growScale u=0 → 0.16
        n.setScale(0.16, 0.16, 1);

        const ticker = ((dt: number): void => {
            if (!node.isValid) { (ticker as unknown as { _done: boolean })._done = true; return; }
            const frames = dt * 60;
            state.x += state.vx * dt;
            state.y += state.vy * dt;
            state.vx *= Math.pow(damping, frames);
            state.vy -= gravity * dt;
            state.rotation += state.rotSpeedDeg * dt;
            state.lifeVal -= state.lifeDecay * frames;
            if (state.lifeVal <= 0) {
                this.recycleGush(node);
                (ticker as unknown as { _done: boolean })._done = true;
                return;
            }
            node.setPosition(state.x, state.y, 0);
            node.angle = state.rotation;

            // 3 阶段 growScale + pulse（严格 1:1 web renderIconParticles）
            const u = 1 - Math.max(0, state.lifeVal) / Math.max(0.001, state.lifeMax);
            let growScale: number;
            if (u < 0.44) {
                growScale = 0.16 + 0.84 * Math.pow(u / 0.44, 0.5);
            } else if (u < 0.78) {
                growScale = 1 + 0.07 * Math.sin(((u - 0.44) / 0.34) * Math.PI * 2);
            } else {
                growScale = Math.max(0.1, 1 - 0.88 * ((u - 0.78) / 0.22));
            }
            const pulse = 0.9 + 0.1 * Math.sin(u * Math.PI);
            const finalScale = growScale * pulse;
            node.setScale(finalScale, finalScale, 1);

            const alphaFade = u > 0.83 ? Math.max(0.12, 1 - (u - 0.83) / 0.17) : 1;
            op.opacity = Math.round(Math.min(1, state.lifeVal) * alphaFade * 255);

        }) as (dt: number) => void;
        this._gushTickers.push(ticker);
    }

    /** gush 动画结束回收进池（上限 128，超出销毁），替代 destroy。 */
    private recycleGush(n: Node): void {
        if (!n?.isValid) return;
        this._gushAlive = Math.max(0, this._gushAlive - 1);
        n.active = false;
        n.removeFromParent();
        if (this._gushPool.length < 128) this._gushPool.push(n);
        else n.destroy();
    }

    update(dt: number): void {
        // bonus icon 持续 spawn 调度（与 Graphics 闪光独立，关闭/无任务时零开销返回）。
        this.tickGushSpawn(dt);
        // 逐帧驱动 icon 粒子物理积分 + growScale 渲染（对齐 web updateIconParticles）。
        if (this._gushTickers.length) {
            for (let i = this._gushTickers.length - 1; i >= 0; i--) {
                this._gushTickers[i](dt);
            }
            // 清除已失效的 ticker（recycleGush 置 node inactive → ticker 内 node.isValid 短路并标记 done）。
            this._gushTickers = this._gushTickers.filter(fn => !(fn as unknown as { _done?: boolean })._done);
        }

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
