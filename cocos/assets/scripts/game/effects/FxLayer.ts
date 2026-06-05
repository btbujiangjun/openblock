import { _decorator, Component, Graphics, UITransform, Color, Node, Label, tween, Vec3, v3 } from 'cc';
import { ClearResult, Skin } from '../../core';
import { blockColor } from '../skin/palette';

const { ccclass } = _decorator;

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: Color;
}

/**
 * Phase 2 综合特效层（与盘面共享坐标系，挂在盘面同位置的 overlay 节点）。
 * - 消行碎屑粒子（Graphics 每帧重绘）
 * - 连击/完美清屏飘字（Label + tween）
 * 屏幕抖动由 ScreenShake 单独处理（作用于容器节点）。
 */
@ccclass('FxLayer')
export class FxLayer extends Component {
    boardPx = 480;
    gap = 2;
    size = 8;

    private _g: Graphics | null = null;
    private _particles: Particle[] = [];

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.boardPx, this.boardPx);
        uit.setAnchorPoint(0.5, 0.5);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
    }

    /** 与盘面同步边长，保证粒子/高光坐标对齐。 */
    setBoardPx(px: number): void {
        this.boardPx = px;
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(px, px);
    }

    private cellCenter(gx: number, gy: number): { x: number; y: number } {
        const cell = this.boardPx / this.size;
        const half = this.boardPx / 2;
        return { x: -half + (gx + 0.5) * cell, y: half - (gy + 0.5) * cell };
    }

    /** 消行碎屑：每个被消格喷几枚小方块 */
    burstClear(result: ClearResult, skin: Skin): void {
        const perCell = 4;
        for (const c of result.cells) {
            const center = this.cellCenter(c.x, c.y);
            const base = c.color === null ? new Color(255, 255, 255) : blockColor(skin, c.color);
            for (let i = 0; i < perCell; i++) {
                const ang = Math.random() * Math.PI * 2;
                const spd = 60 + Math.random() * 160;
                this._particles.push({
                    x: center.x,
                    y: center.y,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd + 40,
                    life: 0,
                    maxLife: 0.45 + Math.random() * 0.35,
                    size: 4 + Math.random() * 5,
                    color: new Color(base.r, base.g, base.b, 255),
                });
            }
        }
    }

    /** 落子确认：在放置的格上做一层白色高光快速淡出（transient 节点，独立于粒子层） */
    flashPlacement(shape: number[][], gx: number, gy: number, color: Color): void {
        const cell = this.boardPx / this.size;
        const inner = cell - this.gap;
        const half = this.boardPx / 2;
        const n = new Node('placeFlash');
        n.parent = this.node;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        const draw = (alpha: number) => {
            g.clear();
            for (let y = 0; y < shape.length; y++) {
                for (let x = 0; x < shape[y].length; x++) {
                    if (!shape[y][x]) continue;
                    const px = -half + (gx + x) * cell + this.gap / 2;
                    const py = half - (gy + y + 1) * cell + this.gap / 2;
                    g.fillColor = new Color(255, 255, 255, alpha);
                    g.roundRect(px, py, inner, inner, Math.min(6, inner * 0.18));
                    g.fill();
                }
            }
        };
        const st = { a: 150 };
        draw(150);
        tween(st)
            .to(0.18, { a: 0 }, { onUpdate: () => draw(Math.max(0, Math.round(st.a))) })
            .call(() => n.destroy())
            .start();
        void color;
    }

    /** 连击 / 完美清屏 飘字 */
    floatText(text: string, color: Color, yOffset = 0): void {
        const n = new Node('floatText');
        n.parent = this.node;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        n.setPosition(0, yOffset, 0);
        const l = n.addComponent(Label);
        l.string = text;
        l.fontSize = 44;
        l.lineHeight = 48;
        l.color = color;
        const start = v3(0, yOffset, 0);
        const end = v3(0, yOffset + 90, 0);
        tween(n)
            .to(0.7, { position: end }, { easing: 'quadOut' })
            .start();
        tween(l)
            .delay(0.3)
            .to(0.4, { color: new Color(color.r, color.g, color.b, 0) })
            .call(() => n.destroy())
            .start();
        void start;
    }

    /** 近失反馈：在「差一格即可消除」的行/列上闪一道金色提示。 */
    flashNearMiss(lines: Array<{ kind: 'row' | 'col'; idx: number }>): void {
        if (lines.length === 0) return;
        const cell = this.boardPx / this.size;
        const half = this.boardPx / 2;
        const n = new Node('nearMiss');
        n.parent = this.node;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        const draw = (alpha: number) => {
            g.clear();
            g.fillColor = new Color(255, 215, 96, alpha);
            for (const ln of lines) {
                if (ln.kind === 'row') {
                    const py = half - (ln.idx + 1) * cell;
                    g.rect(-half, py, this.boardPx, cell);
                } else {
                    const px = -half + ln.idx * cell;
                    g.rect(px, -half, cell, this.boardPx);
                }
                g.fill();
            }
        };
        const st = { a: 70 };
        draw(70);
        tween(st)
            .to(0.5, { a: 0 }, { onUpdate: () => draw(Math.max(0, Math.round(st.a))) })
            .call(() => n.destroy())
            .start();
    }

    update(dt: number): void {
        const g = this._g;
        if (!g) return;
        if (this._particles.length === 0) {
            return;
        }
        g.clear();
        const gravity = -520;
        const alive: Particle[] = [];
        for (const p of this._particles) {
            p.life += dt;
            if (p.life >= p.maxLife) continue;
            p.vy += gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            const t = 1 - p.life / p.maxLife;
            g.fillColor = new Color(p.color.r, p.color.g, p.color.b, Math.round(255 * t));
            const s = p.size * t + 1;
            g.rect(p.x - s / 2, p.y - s / 2, s, s);
            g.fill();
            alive.push(p);
        }
        this._particles = alive;
        if (alive.length === 0) g.clear();
    }
}
