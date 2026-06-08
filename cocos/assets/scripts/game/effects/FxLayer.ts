import { _decorator, Component, Graphics, UITransform, Color, Node, Label, tween, Tween, Vec3, v3, Sprite, SpriteFrame, UIOpacity, resources } from 'cc';
import { ClearResult, Skin, t } from '../../core';
import { blockColor } from '../skin/palette';
import { Motion } from '../platform/Motion';
import { VisualFx } from '../platform/VisualFx';

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
    // ── 消行碎屑（web addParticles 同款物理）字段；季节氛围粒子不含、走旧式 life+=dt 路径 ──
    // life 起始为 baseLife（可 >1），每 60fps 帧按 decay 递减；渲染 alpha=min(1,life)、半径=size*life。
    decay?: number;      // 每 60fps 帧的 life 衰减（web lifeDecay）
    damping?: number;    // 每帧速度阻尼（web damping，<1 → 炸开后渐慢）
    gravityMul?: number; // 重力系数（web gravityMul）
}

/** Perfect Clear 彩虹色板（对齐 web addParticles rainbowColors）。 */
const RAINBOW: Array<[number, number, number]> = [
    [255, 68, 68], [255, 136, 0], [255, 221, 0], [68, 221, 68], [68, 136, 255], [170, 68, 255],
];

/**
 * 同时存活的消行碎屑上限（cocos 侧安全阀）。
 *
 * web 用 canvas `arc` 画粒子近乎零成本、对数量无上限；cocos 的 `Graphics.circle` 每帧把所有圆
 * 重新三角化进同一 mesh，成本随存活粒子数线性上升。一次完美清屏（~20 格 ×(24+10)）已 ~680 个，
 * 若连击密集时多次爆发叠加，会长时间维持上千圆/帧 → 在移动 WebView 上累积压垮 GPU / 触发上下文丢失（黑屏）。
 *
 * 取 480：足够容纳「单次最大爆发」的完整观感，仅当多次爆发重叠逼近上限时按比例削减新增，
 * 正常对局碰不到，因此不削弱手感、只杜绝失控。
 */
const MAX_CLEAR_PARTICLES = 480;

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
    /** 季节 ambience 节流累加器（~30Hz 重绘）。 */
    private _ambAcc = 0;
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
    burstClear(result: ClearResult, skin: Skin, opts: { perfectClear?: boolean } = {}): void {
        // 视觉特效总开关（对齐 web renderer.setEffectsEnabled）：关闭时不喷碎屑/高光（连击飘字属玩法反馈、不受此约束）。
        if (!VisualFx.enabled) return;
        const reduced = Motion.reduced;
        const count = result.count || 1;
        // 分级（对齐 web addParticles）：perfect > combo(≥3) > double(==2) > single。
        const isPerfect = !!opts.perfectClear;
        const isCombo = !isPerfect && count >= 3;
        const isDouble = !isPerfect && count === 2;
        let perCell = isPerfect ? 24 : isCombo ? 17 : isDouble ? 13 : 10;
        const speed = isPerfect ? 2.55 : isCombo ? 2.0 : isDouble ? 1.6 : 1.28;
        // 衰减比 web 快约 1.8×（web 0.0085/0.012/0.016/0.020）：保留爆发瞬间的视觉冲击，但砍掉
        // 长达 2-3s 的「余韵尾巴」——尾巴对手感增益小却让 cocos 每帧持续重画上百圆、是移动端发热的主因。
        const lifeDecay = isPerfect ? 0.018 : isCombo ? 0.022 : isDouble ? 0.028 : 0.036;
        const baseLife = isPerfect ? 1.65 : isCombo ? 1.42 : isDouble ? 1.26 : 1.18;
        const damping = isPerfect ? 0.972 : isCombo ? 0.968 : isDouble ? 0.962 : 0.958;
        const gravityMul = isPerfect ? 0.55 : isCombo ? 0.65 : isDouble ? 0.78 : 0.9;
        // Reduce Motion：密度压到 ~30%（仍保留分级强度的层次），避免大批高速粒子飞溅刺激前庭。
        if (reduced) perCell = Math.max(1, Math.round(perCell * 0.3));
        // cocos 侧安全阀：若本次爆发会把存活粒子推过上限，按剩余预算等比削减新增（含火花），
        // 避免连击密集时多次爆发叠加维持上千圆/帧拖垮 GPU。正常对局预算充足、不触发削减。
        const cellCount = result.cells.length || 1;
        const sparkPerCell = (!reduced && (isCombo || isPerfect)) ? (isPerfect ? 10 : 6) : 0;
        const intended = cellCount * (perCell + sparkPerCell);
        const budget = MAX_CLEAR_PARTICLES - this._particles.length;
        if (budget <= 0) return;
        const scale = intended > budget ? budget / intended : 1;
        if (scale < 1) perCell = Math.max(1, Math.floor(perCell * scale));
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
                const sp = (3.5 + Math.random() * 11) * speed; // px/帧（web 口径）
                const jump = 7 + Math.random() * 9;             // 先向上「跳」再受重力下落
                // web canvas y 向下：vy = sin*sp*0.95 - jump（负=向上）。cocos y 向上 → 取负、并 ×60 转 px/秒。
                const vxFrame = Math.cos(ang) * sp * 1.55 + (Math.random() - 0.5) * 5;
                const vyFrame = Math.sin(ang) * sp * 0.95 - jump;
                const rgb = isPerfect ? RAINBOW[(Math.random() * RAINBOW.length) | 0] : [base.r, base.g, base.b] as [number, number, number];
                this._particles.push({
                    x: center.x,
                    y: center.y,
                    vx: vxFrame * 60,
                    vy: -vyFrame * 60,
                    life: baseLife,
                    maxLife: baseLife,
                    size: (isCombo ? 3 : 4) + Math.random() * (isCombo ? 5 : 4),
                    color: new Color(rgb[0], rgb[1], rgb[2], 255),
                    decay: lifeDecay,
                    damping,
                    gravityMul,
                });
            }
            // combo / perfect 额外火花（金/奶白；perfect 走彩虹），更快更亮、寿命更长。
            if (sparkPerCell > 0) {
                const sparkCount = scale < 1 ? Math.max(1, Math.floor(sparkPerCell * scale)) : sparkPerCell;
                for (let j = 0; j < sparkCount; j++) {
                    const vxFrame = (Math.random() - 0.5) * (isPerfect ? 30 : 24);
                    const vyFrame = (Math.random() - 0.5) * (isPerfect ? 30 : 24) - (9 + Math.random() * 7);
                    const rgb = isPerfect
                        ? RAINBOW[j % RAINBOW.length]
                        : (j % 2 === 0 ? [255, 215, 0] as [number, number, number] : [255, 248, 220] as [number, number, number]);
                    this._particles.push({
                        x: center.x,
                        y: center.y,
                        vx: vxFrame * 60,
                        vy: -vyFrame * 60,
                        life: isPerfect ? 1.75 : 1.48,
                        maxLife: isPerfect ? 1.75 : 1.48,
                        size: 2 + Math.random() * (isPerfect ? 4 : 3),
                        color: new Color(rgb[0], rgb[1], rgb[2], 255),
                        decay: isPerfect ? 0.014 : 0.018,
                        damping: isPerfect ? 0.974 : 0.968,
                        gravityMul: 0.45,
                    });
                }
            }
        }
    }

    /** 落子高光复用：单个持久节点 + Graphics（落子串行，同时至多一个高光），避免每次落子 new Node/Graphics 的创建销毁churn。 */
    private _placeFlashNode: Node | null = null;
    private _placeFlashG: Graphics | null = null;
    private _placeFlashState = { a: 0 };

    /** 落子确认：在放置的格上做一层白色高光快速淡出（复用持久层，独立于粒子层） */
    flashPlacement(shape: number[][], gx: number, gy: number, color: Color): void {
        const cell = this.boardPx / this.size;
        const inner = cell - this.gap;
        const half = this.boardPx / 2;
        if (!this._placeFlashNode || !this._placeFlashNode.isValid) {
            const n = new Node('placeFlash');
            n.parent = this.node;
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            this._placeFlashG = n.addComponent(Graphics);
            this._placeFlashNode = n;
        }
        const g = this._placeFlashG!;
        const col = this._drawCol;
        const draw = (alpha: number): void => {
            g.clear();
            if (alpha <= 0) return;
            col.r = 255; col.g = 255; col.b = 255; col.a = alpha;
            g.fillColor = col;
            for (let y = 0; y < shape.length; y++) {
                for (let x = 0; x < shape[y].length; x++) {
                    if (!shape[y][x]) continue;
                    const px = -half + (gx + x) * cell + this.gap / 2;
                    const py = half - (gy + y + 1) * cell + this.gap / 2;
                    g.roundRect(px, py, inner, inner, Math.min(6, inner * 0.18));
                    g.fill();
                }
            }
        };
        // 复用 state：停掉上一轮 tween（若仍在播），从满强重新淡出。
        Tween.stopAllByTarget(this._placeFlashState);
        this._placeFlashState.a = 150;
        draw(150);
        tween(this._placeFlashState)
            .to(0.18, { a: 0 }, { onUpdate: () => draw(Math.max(0, Math.round(this._placeFlashState.a))) })
            .call(() => g.clear())
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
        const col = new Color(255, 215, 96, 70);
        const draw = (alpha: number) => {
            g.clear();
            col.a = alpha;
            g.fillColor = col;
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
        // 视觉特效总开关关 / 减少动效：清掉残留氛围粒子并停更（持续飘落属减动效要规避的刺激，
        // 与 AmbientFx 的 `Motion.reduced || !VisualFx.enabled` 门控保持一致）。
        if (!VisualFx.enabled || Motion.reduced) {
            if (this._ambient.length) { this._ambient.length = 0; ag.clear(); }
            this._ambAcc = 0;
            return;
        }
        if (!this._ambActive && this._ambient.length === 0) return;
        // ~30Hz 节流：缓慢飘落的氛围粒子，30Hz 取样肉眼无差，active 期也省一半积分+重绘。
        this._ambAcc += dt;
        if (this._ambAcc < 1 / 34) return;
        dt = this._ambAcc;
        this._ambAcc = 0;
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
        // web addParticles 同款积分（帧率无关化）：web 是 60fps 逐帧；这里把每帧量换算到 dt。
        //   位移：vx/vy 已存为 px/秒 → ×dt。
        //   阻尼：web 每帧 v*=damping → 这里 v*=pow(damping, dt*60)。
        //   重力：web 每帧 vy+=0.35*gravityMul（canvas y下）→ cocos y上为向下负，0.35×3600=1260 px/秒²。
        //   寿命：web 每帧 life-=decay → 这里 life-=decay*(dt*60)；渲染 alpha=min(1,life)、半径=size*life。
        const frames = dt * 60;
        const alive: Particle[] = [];
        const col = this._drawCol;
        for (const p of this._particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.damping != null) {
                const f = Math.pow(p.damping, frames);
                p.vx *= f; p.vy *= f;
            }
            p.vy -= 1260 * (p.gravityMul ?? 1) * dt;
            p.life -= (p.decay ?? 0.03) * frames;
            if (p.life <= 0) continue;
            const alpha = Math.min(1, p.life);
            const rad = Math.max(0.5, p.size * p.life);
            col.r = p.color.r; col.g = p.color.g; col.b = p.color.b; col.a = Math.round(255 * alpha);
            g.fillColor = col;
            g.circle(p.x, p.y, rad);
            g.fill();
            alive.push(p);
        }
        this._particles = alive;
        if (alive.length === 0) g.clear();
    }
}
