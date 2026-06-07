import { _decorator, Component, Graphics, UITransform, Color, Node, Label, tween, Tween, Vec3, v3, Sprite, SpriteFrame, UIOpacity, resources } from 'cc';
import { ClearResult, Skin, t } from '../../core';
import { blockColor } from '../skin/palette';
import { Motion } from '../platform/Motion';

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
    // 季节环境粒子（缓慢飘落）：独立 Graphics 层，避免与消行碎屑互相清屏。
    private _ambG: Graphics | null = null;
    private _ambient: Particle[] = [];
    private _ambColor = new Color(180, 210, 255, 255);
    private _ambActive = false;
    /** 复用绘制 Color（每帧逐粒子重设 r/g/b/a；Graphics.fillColor setter 内部拷贝值 → 复用安全）。 */
    private _drawCol = new Color(255, 255, 255, 255);
    // 可选柔光粒子贴图（art/particle）：消行时叠加一层染色光晕；未导入则跳过（碎屑仍为 Graphics）。
    private _glowFrame: SpriteFrame | null = null;
    /** glow 节点对象池：消行时一次最多 16 个 glow，复用避免每次 new Node + destroy 的开销与 GC。 */
    private _glowPool: Node[] = [];

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.boardPx, this.boardPx);
        uit.setAnchorPoint(0.5, 0.5);
        // 环境层置于碎屑层之下（先建的子节点 sibling index 更小、渲染更靠后）。
        const ambNode = new Node('ambient');
        ambNode.parent = this.node;
        ambNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._ambG = ambNode.addComponent(Graphics);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        resources.load('art/particle/spriteFrame', SpriteFrame, (err: unknown, sf: SpriteFrame) => {
            if (err || !sf || !this.node.isValid) return;
            this._glowFrame = sf;
        });
    }

    /** 在 (x,y) 处弹出一枚自回收的染色柔光（scale 弹大 + 淡出）。仅在贴图就绪时调用。 */
    private spawnGlow(x: number, y: number, color: Color, size: number): void {
        const frame = this._glowFrame;
        if (!frame) return;
        let n = this._glowPool.pop();
        let sp: Sprite;
        let op: UIOpacity;
        let ut: UITransform;
        if (n && n.isValid) {
            // 复用：停掉上一轮残留 tween，避免 scale/opacity 动画叠加导致闪烁。
            Tween.stopAllByTarget(n);
            ut = n.getComponent(UITransform)!;
            sp = n.getComponent(Sprite)!;
            op = n.getComponent(UIOpacity)!;
            Tween.stopAllByTarget(op);
        } else {
            n = new Node('glow');
            ut = n.addComponent(UITransform);
            ut.setAnchorPoint(0.5, 0.5);
            sp = n.addComponent(Sprite);
            if (Sprite.SizeMode) sp.sizeMode = Sprite.SizeMode.CUSTOM;
            op = n.addComponent(UIOpacity);
        }
        n.parent = this.node;
        n.active = true;
        ut.setContentSize(size, size);
        n.setPosition(x, y, 0);
        sp.spriteFrame = frame;
        sp.color = new Color(color.r, color.g, color.b, 255);
        op.opacity = 210;
        n.setScale(0.4, 0.4, 1);
        const node = n;
        tween(n).to(0.4, { scale: new Vec3(1.5, 1.5, 1) }, { easing: 'quadOut' }).start();
        tween(op).to(0.4, { opacity: 0 }).call(() => this.recycleGlow(node)).start();
    }

    /** glow 动画结束回收进池（上限 24，超出则销毁），替代 destroy 以省掉 Node 创建/GC。 */
    private recycleGlow(n: Node): void {
        if (!n?.isValid) return;
        n.active = false;
        n.removeFromParent();
        if (this._glowPool.length < 24) this._glowPool.push(n);
        else n.destroy();
    }

    /**
     * 开启季节环境氛围（对齐 web 的「节令感」意图，超出 web weather stub）：
     * 按季节强调色缓慢飘落柔光粒子。color 取 seasonalAccent()。
     * 切肤时换 color：清掉残留的旧氛围粒子，避免新旧调色短时段混色。
     */
    startAmbience(color: [number, number, number]): void {
        const next = new Color(color[0], color[1], color[2], 255);
        if (this._ambActive && (next.r !== this._ambColor.r || next.g !== this._ambColor.g || next.b !== this._ambColor.b)) {
            this._ambient.length = 0;
            this._ambG?.clear();
        }
        this._ambColor = next;
        this._ambActive = true;
    }

    stopAmbience(): void {
        this._ambActive = false;
        this._ambient.length = 0;
        this._ambG?.clear();
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
        // Reduce Motion：碎屑减为 1 颗 + glow 限到 4，避免大幅速度的粒子飞溅刺激前庭。
        const reduced = Motion.reduced;
        const perCell = reduced ? 1 : 4;
        const cell = this.boardPx / this.size;
        let glowBudget = reduced ? 4 : 16;
        for (const c of result.cells) {
            const center = this.cellCenter(c.x, c.y);
            const base = c.color === null ? new Color(255, 255, 255) : blockColor(skin, c.color);
            if (glowBudget > 0 && Math.random() < 0.5) {
                this.spawnGlow(center.x, center.y, base, cell * 1.6);
                glowBudget--;
            }
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

    /**
     * 对齐 web `main.css .is-rejected` 抖动动画：在指定节点（ghost）上做 240ms 水平抖+淡出。
     * 比直接 cancelDrag 更明确地告诉玩家"这一格不能落"。240ms 内禁止操作（由调用方安排）。
     * 调用方需传入 ghost 节点；本函数不修改 ghost 内部内容，仅做容器位移+UIOpacity 淡出，结束后回零。
     */
    ghostRejectShake(target: Node): void {
        if (!target?.isValid) return;
        const op = target.getComponent(UIOpacity) || target.addComponent(UIOpacity);
        const startPos = target.position.clone();
        // 抖动序列：4 段 60ms 水平位移，振幅 12→6→3px 衰减。
        const seq: Array<{ dx: number; dur: number }> = [
            { dx: -12, dur: 0.05 },
            { dx: 12, dur: 0.06 },
            { dx: -6, dur: 0.05 },
            { dx: 6, dur: 0.04 },
            { dx: 0, dur: 0.04 },
        ];
        let chain = tween(target);
        for (const s of seq) {
            chain = chain.to(s.dur, { position: v3(startPos.x + s.dx, startPos.y, startPos.z) }, { easing: 'sineInOut' });
        }
        chain.start();
        // 同时淡出（与 web 0.24s 透明度过渡对齐）。
        op.opacity = 255;
        tween(op).to(0.24, { opacity: 0 }).start();
    }

    /**
     * 对齐 web `showFloatScore` 简化版：在指定盘面格 (gx, gy) 上方飘出 `+N` 数字。
     * 颜色按等级（normal/combo/perfect/bonus）。若不指定坐标，落到盘面中央偏上。
     * 字号按 kind 分级：perfect 最大，bonus 次之，combo 次之，normal 基准；起手弹大回弹+上浮+淡出。
     */
    showScoreFloat(amount: number, kind: 'normal' | 'combo' | 'perfect' | 'bonus' = 'normal', gx?: number, gy?: number, label?: string): void {
        if (amount <= 0) return;
        const color = kind === 'perfect' ? new Color(255, 230, 130, 255)
            : kind === 'bonus' ? new Color(255, 170, 80, 255)
            : kind === 'combo' ? new Color(255, 200, 120, 255)
            : new Color(220, 240, 255, 255);
        // 锚位：传了 (gx,gy) 用格中心；否则盘面中心稍上。
        const cell = this.boardPx / this.size;
        const half = this.boardPx / 2;
        const baseX = gx != null && gy != null ? -half + (gx + 0.5) * cell : 0;
        const baseY = gx != null && gy != null ? half - (gy + 0.5) * cell + cell * 0.6 : 30;
        const n = new Node('scoreFloat');
        n.parent = this.node;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        n.setPosition(baseX, baseY, 0);
        const fontSize = kind === 'perfect' ? 64 : kind === 'bonus' ? 56 : kind === 'combo' ? 52 : 44;
        const labels: Label[] = [];
        // 对齐 web `showFloatScore`：消行分级（双消/N消/清屏）时，上方叠一行标签，下方 `+N`。
        if (label) {
            const tag = new Node('floatTag');
            tag.parent = n;
            tag.addComponent(UITransform).setAnchorPoint(0.5, 0);
            tag.setPosition(0, fontSize * 0.5, 0);
            const tl = tag.addComponent(Label);
            tl.string = label;
            tl.fontSize = Math.round(fontSize * 0.62);
            tl.lineHeight = tl.fontSize + 4;
            tl.color = color;
            labels.push(tl);
        }
        const valNode = label ? new Node('floatVal') : n;
        if (label) {
            valNode.parent = n;
            valNode.addComponent(UITransform).setAnchorPoint(0.5, 1);
            valNode.setPosition(0, fontSize * 0.35, 0);
        }
        const l = valNode.addComponent(Label);
        l.string = `+${amount}`;
        l.fontSize = fontSize;
        l.lineHeight = l.fontSize + 6;
        l.color = color;
        labels.push(l);
        n.setScale(1.25, 1.25, 1);
        tween(n).to(0.18, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
        tween(n).to(0.9, { position: v3(baseX, baseY + 130, 0) }, { easing: 'quadOut' }).start();
        const fadeTo = new Color(color.r, color.g, color.b, 0);
        for (const lab of labels) tween(lab).delay(0.45).to(0.45, { color: fadeTo }).start();
        tween(n).delay(0.9).call(() => n.destroy()).start();
    }

    /**
     * 连续消行 streak 徽章（对齐 web `.streak-badge`）：在盘面顶部弹出一个金色徽章，
     * 显示 `STREAK xN`；3 行连续起步，颜色随 streak 升级。
     */
    showStreakBadge(streak: number): void {
        if (streak < 3) return;
        const intensity = Math.min(1, (streak - 3) / 4);
        const r = Math.round(255);
        const g = Math.round(200 - intensity * 80);
        const b = Math.round(80 - intensity * 60);
        // 对齐 web `.streak-badge` 文案「🔥 N 连消」（本地化）。
        this.floatText(t('effect.streak', { n: streak }), new Color(r, g, b, 255), 100);
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

    /** 季节环境粒子积分 + 重绘（低密度、缓慢飘落、靠近边缘淡出）。 */
    private updateAmbience(dt: number): void {
        const ag = this._ambG;
        if (!ag) return;
        if (!this._ambActive && this._ambient.length === 0) return;
        const half = this.boardPx / 2;
        const target = Math.max(8, Math.round(this.boardPx / 42));
        // 按需补充：从盘面顶部随机位置生成，向下缓慢飘落带轻微横向漂移。
        if (this._ambActive && this._ambient.length < target && Math.random() < 0.35) {
            const maxLife = 3.2 + Math.random() * 2.6;
            this._ambient.push({
                x: (Math.random() - 0.5) * this.boardPx,
                y: half + 8,
                vx: (Math.random() - 0.5) * 16,
                vy: -(18 + Math.random() * 26),
                life: 0,
                maxLife,
                size: 3 + Math.random() * 4,
                color: this._ambColor,
            });
        }
        ag.clear();
        const alive: Particle[] = [];
        for (const p of this._ambient) {
            p.life += dt;
            p.y += p.vy * dt;
            p.x += p.vx * dt + Math.sin(p.life * 2) * 6 * dt;
            if (p.life >= p.maxLife || p.y < -half - 8) continue;
            // 进入/离开两端各做 0.6s 淡入淡出，整体压到很低透明度（氛围而非干扰）。
            const fadeIn = Math.min(1, p.life / 0.6);
            const fadeOut = Math.min(1, (p.maxLife - p.life) / 0.6);
            const a = Math.round(70 * Math.min(fadeIn, fadeOut));
            if (a > 0) {
                const col = this._drawCol;
                col.r = this._ambColor.r; col.g = this._ambColor.g; col.b = this._ambColor.b; col.a = a;
                ag.fillColor = col;
                ag.circle(p.x, p.y, p.size);
                ag.fill();
            }
            alive.push(p);
        }
        this._ambient = alive;
    }

    update(dt: number): void {
        this.updateAmbience(dt);
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
            const col = this._drawCol;
            col.r = p.color.r; col.g = p.color.g; col.b = p.color.b; col.a = Math.round(255 * t);
            g.fillColor = col;
            const s = p.size * t + 1;
            g.rect(p.x - s / 2, p.y - s / 2, s, s);
            g.fill();
            alive.push(p);
        }
        this._particles = alive;
        if (alive.length === 0) g.clear();
    }
}
