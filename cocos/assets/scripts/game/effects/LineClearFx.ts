import { _decorator, Component, Graphics, UITransform, Color, tween, Tween, Node } from 'cc';
import { ClearResult, Skin } from '../../core';
import { clearFlashColor } from '../skin/palette';
import { Motion } from '../platform/Motion';
import { VisualFx } from '../platform/VisualFx';

const { ccclass } = _decorator;

/**
 * 消行高亮特效 —— 严格对齐 web `renderer.renderClearCells` + `_renderClearDissolveBands`：
 *   - 逐格「径向辉光」：clearFlash 亮核 → 暖琥珀 → 透明，随时间脉冲（sin）并略微抬起（lift）；
 *   - 整行/整列「溶解带」：沿被清满线扫一串柔光点，比单格更有「整条线被点亮」的体感。
 *
 * cc.Graphics 无 CanvasGradient → 用「外暗内亮多层同心圆 / 椭圆」近似 web 的 radial/elliptic 渐变。
 * 整体走一个 ~0.48s 的包络（前段维持、后段淡出），由单个 tween 驱动逐帧重绘（独立层，零盘面重画）。
 *
 * 比旧实现（0.32s 平铺 roundRect 淡出）显著更亮/更有层次，与 web 主端的发光消行观感一致。
 */
@ccclass('LineClearFx')
export class LineClearFx extends Component {
    private _g: Graphics | null = null;
    boardPx = 480;
    gap = 2;
    size = 8;

    /** 单一动画进度状态：复用并在新一次 play 前 stop，避免两次消行动画同时写 _g 抖动。 */
    private _anim = { p: 0 };
    /** 复用绘制 Color：消行期每帧可调用 glowDot 数百次（逐格 + 溶解带逐点），
     *  逐次 new Color 会造成可观 GC 抖动。Graphics.fillColor setter 内部拷贝值 → 复用安全。 */
    private _col = new Color(255, 255, 255, 255);

    private col(r: number, g: number, b: number, a: number): Color {
        const c = this._col;
        c.r = r; c.g = g; c.b = b; c.a = a;
        return c;
    }

    onLoad(): void {
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.boardPx, this.boardPx);
        uit.setAnchorPoint(0.5, 0.5);
    }

    /** 与盘面同步边长。 */
    setBoardPx(px: number): void {
        this.boardPx = px;
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(px, px);
    }

    play(result: ClearResult, skin: Skin): void {
        const g = this._g;
        if (!g || !VisualFx.enabled) return;
        const cell = this.boardPx / this.size;
        const half = this.boardPx / 2;
        const flash = clearFlashColor(skin);
        const cells = result.cells;
        const rows = result.rows || [];
        const cols = result.cols || [];
        const node: Node = this.node;
        node.active = true;

        // Reduce Motion：不做持续脉冲/抬起（前庭友好），退化为一次性柔和淡出（仍比无特效明显）。
        const reduced = Motion.reduced;
        const durationS = reduced ? 0.28 : 0.48;
        const startMs = Date.now();

        const render = (): void => {
            const k = Math.max(0, Math.min(1, this._anim.p)); // 0..1 进度
            // 包络：前 30% 维持满强，其后线性淡出到 0（对齐 web「高亮窗口 + 收尾淡出」观感）。
            const env = k < 0.3 ? 1 : Math.max(0, 1 - (k - 0.3) / 0.7);
            // 脉冲与抬起：对齐 web renderClearCells 的 pulse / lift 公式（reduced 时关闭脉冲取定值）。
            const pulse = reduced ? 0.85 : 0.65 + 0.35 * Math.abs(Math.sin((startMs + k * durationS * 1000) * 0.008));
            const lift = reduced ? 0 : (1.05 - pulse * 0.4) * (2.2 + 2.8 * pulse);
            g.clear();
            if (env <= 0.001) return;
            // 溶解带（整行/整列被清满线）：先画在底层，逐格辉光叠在其上。
            this.drawDissolveBands(g, rows, cols, cell, half, flash, 0.34 * pulse * env);
            // 逐格径向辉光。
            for (const c of cells) {
                const cx = -half + (c.x + 0.5) * cell;
                const cy = half - (c.y + 0.5) * cell + lift * 0.35; // y 向上：lift 让辉光略微上抬
                const r = cell * (0.46 + 0.18 * pulse);
                this.glowDot(g, cx, cy, r, r, flash, 0.9 * pulse * env);
            }
        };

        Tween.stopAllByTarget(this._anim);
        this._anim.p = 0;
        render();
        tween(this._anim)
            .to(durationS, { p: 1 }, { onUpdate: () => render() })
            .call(() => g.clear())
            .start();
    }

    /**
     * 单点径向辉光近似（外暗内亮三层同心椭圆）：
     *   stop0 中心 = clearFlash 亮核；stop0.42 = 暖琥珀；外缘透明。a = 总不透明度（已含 pulse/env）。
     */
    private glowDot(g: Graphics, cx: number, cy: number, rx: number, ry: number, flash: Color, a: number): void {
        const A = Math.max(0, Math.min(1, a));
        if (A <= 0.001) return;
        const amberA = Math.round(0.28 * A * 255);
        if (amberA > 0) {
            g.fillColor = this.col(255, 240, 180, amberA);
            g.ellipse(cx, cy, rx, ry);
            g.fill();
        }
        const midA = Math.round(0.42 * A * 255);
        if (midA > 0) {
            g.fillColor = this.col(255, 240, 180, midA);
            g.ellipse(cx, cy, rx * 0.55, ry * 0.55);
            g.fill();
        }
        const coreA = Math.round((flash.a / 255) * A * 255);
        if (coreA > 0) {
            g.fillColor = this.col(flash.r, flash.g, flash.b, coreA);
            g.ellipse(cx, cy, rx * 0.34, ry * 0.34);
            g.fill();
        }
    }

    /** 沿被清满的整行/整列扫一串柔光点（对齐 web _renderClearDissolveBands）。 */
    private drawDissolveBands(g: Graphics, rows: number[], cols: number[], cell: number, half: number, flash: Color, a: number): void {
        if (a <= 0.001) return;
        const step = cell * 0.52;
        for (const y of rows) {
            const cy = half - (y + 0.5) * cell;
            for (let x = cell * 0.5; x <= this.boardPx; x += step) {
                this.glowDot(g, -half + x, cy, cell * 0.72, cell * 0.46, flash, a);
            }
        }
        for (const x of cols) {
            const cx = -half + (x + 0.5) * cell;
            for (let y = cell * 0.5; y <= this.boardPx; y += step) {
                this.glowDot(g, cx, half - y, cell * 0.46, cell * 0.72, flash, a);
            }
        }
    }
}
