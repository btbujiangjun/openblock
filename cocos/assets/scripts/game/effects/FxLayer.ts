import { _decorator, Component, Graphics, UITransform, Color, Node, Label, tween, Tween, Vec3, v3, Sprite, SpriteFrame, UIOpacity, resources } from 'cc';
import * as cc from 'cc';
import { ClearResult, Skin, t } from '../../core';
import { blockColor } from '../skin/palette';
import { Motion } from '../platform/Motion';
import { VisualFx } from '../platform/VisualFx';

/**
 * 与 web 主端 `.thumbs-up-toast` / `.float-near-miss` / `.float-pts` 一致的彩色 emoji 字体栈。
 * Cocos Label 默认 fontFamily='Arial'，Arial 不含彩色 emoji glyph → emoji 渲染为方框；必须显式回退到系统彩色字体栈。
 * 与 `skin/blockPaint.ts` 的 `ICON_FONT_FAMILY` 同源，避免维护两份。
 */
const EMOJI_FONT_FAMILY = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif';
/** Web 主端通用文字栈 —— 与 `body { font-family }` 严格对齐。 */
const UI_FONT_FAMILY = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

/**
 * 运行时按需获取 Cocos 的 LabelOutline / LabelShadow 组件类（不同 cocos 版本可能挪位或废弃）。
 * 存在则附加 → 模拟 web 的 `text-shadow` 多层光晕；不存在静默跳过，文字仍可见。
 */
function tryAddOutline(node: Node, color: Color, width: number): void {
    const Ctor = (cc as unknown as Record<string, unknown>).LabelOutline as { new(): unknown } | undefined;
    if (!Ctor) return;
    try {
        const c = node.addComponent(Ctor as unknown as new () => Component) as unknown as { color: Color; width: number };
        c.color = color;
        c.width = width;
    } catch { /* ignore */ }
}
function tryAddShadow(node: Node, color: Color, offsetX: number, offsetY: number, blur: number): void {
    const Ctor = (cc as unknown as Record<string, unknown>).LabelShadow as { new(): unknown } | undefined;
    if (!Ctor) return;
    try {
        const c = node.addComponent(Ctor as unknown as new () => Component) as unknown as {
            color: Color; offset: { x: number; y: number; set?: (x: number, y: number) => void }; blur: number;
        };
        c.color = color;
        if (c.offset && typeof c.offset.set === 'function') c.offset.set(offsetX, offsetY);
        else c.offset = { x: offsetX, y: offsetY };
        c.blur = blur;
    } catch { /* ignore */ }
}

/**
 * 应用 web `.float-*` 通用文字样式：粗体 / 字间距 / 字体栈。
 * 与 `applyIconLabel` 关注点不同：那里只关心 emoji glyph 烘焙；这里关心**字形样式**对齐。
 */
function applyTextStyle(l: Label, opts: {
    fontFamily?: string;
    fontSize: number;
    lineHeight: number;
    color: Color;
    bold?: boolean;
    /** CSS letter-spacing → Cocos Label.letterSpacing（3.7+），低版本字段缺失则忽略。 */
    letterSpacing?: number;
}): void {
    const anyL = l as unknown as {
        useSystemFont: boolean;
        fontFamily: string;
        fontSize: number;
        lineHeight: number;
        isBold: boolean;
        color: Color;
        letterSpacing?: number;
        cacheMode?: unknown;
        node?: Node;
        markForUpdateRenderData?: (force?: boolean) => void;
    };
    try {
        anyL.useSystemFont = true;
        if (opts.fontFamily) anyL.fontFamily = opts.fontFamily;
        anyL.fontSize = opts.fontSize;
        anyL.lineHeight = opts.lineHeight;
        if (opts.bold != null) anyL.isBold = opts.bold;
        if (opts.letterSpacing != null) {
            try { anyL.letterSpacing = opts.letterSpacing; } catch { /* ignore */ }
        }
        // 系统字体直渲，关闭 BITMAP/CHAR 缓存，避免 fontSize/string 变更后的过期 glyph 纹理（iOS 短路问题，详见 blockPaint.applyIconLabel）。
        const CacheModeEnum = (Label as unknown as { CacheMode?: { NONE?: unknown } })?.CacheMode;
        if (CacheModeEnum && CacheModeEnum.NONE != null) anyL.cacheMode = CacheModeEnum.NONE;
        /* 颜色：Cocos 3.x Label 的最终顶点色由所在 Node 的 color 与 UIRenderer 合成 ——
         * 直接写 Label.color 在 useSystemFont=true + cacheMode 切换的几帧里会被 Canvas2D fillStyle
         * 默认值（白）覆盖（已被多名用户反馈"消行飘字全白"）。
         * 同时写 Node.color + Label.color，保证两条路径都拿到指定主色，与 web `.float-X { color }` 一致。 */
        try { (l.node as unknown as { color: Color }).color = opts.color; } catch { /* ignore */ }
        anyL.color = opts.color;
        anyL.markForUpdateRenderData?.(true);
    } catch { /* ignore */ }
}

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
const MAX_CLEAR_PARTICLES = 1200;

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

    /**
     * 把 web fxCanvas 坐标 (cs*x, cs*y) 换算到 cocos 盘面坐标系（中心 (0,0)，y+ 向上）：
     *   wx = web x（左→右增），对应 cocos x = wx - half
     *   wy = web y（上→下增），对应 cocos y = half - wy（y 翻转）
     * 用于 bonus 色块/icon 粒子的位置生成时直接复用 web 公式。
     */
    private webToBoard(wx: number, wy: number): { x: number; y: number } {
        const half = this.boardPx / 2;
        return { x: wx - half, y: half - wy };
    }

    /** 当前活跃的色块 gush 任务（每个 bonusLine 一个），update 内按 web 节奏持续 spawn。 */
    private _colorGushTasks: Array<{
        bonusLine: { type: 'row' | 'col'; idx: number };
        color: Color;
        startMs: number;
        endMs: number;
        spawnAcc: number;
    }> = [];

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
        // 严格对齐 web `renderer.addParticles` 的 lifeDecay：
        //   60fps 下粒子余韵长度 single ≈0.98s / double ≈1.31s / combo ≈1.97s / perfect ≈3.23s。
        // 之前为省电压到 1.8× 加速衰减，粒子刚一爆就消失 → 缺氛围感。还原 web 原值后,
        // MAX_CLEAR_PARTICLES 提到 1200 兜底 perfect 满盘的瞬时高峰（理论 64×24=1536，会被等比削减），
        // 移动端单局 perfect 仅偶发，长期负载与「single+combo」无差异，可承受。
        const lifeDecay = isPerfect ? 0.0085 : isCombo ? 0.012 : isDouble ? 0.016 : 0.020;
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
                        // web 原值 perfect 0.0075 / combo 0.010 → 余韵 ≈3.7s/2.5s，与主粒子节奏一致。
                        decay: isPerfect ? 0.0075 : 0.010,
                        damping: isPerfect ? 0.974 : 0.968,
                        gravityMul: 0.45,
                    });
                }
            }
        }
    }

    /**
     * 同花顺色块爆发 —— 严格对齐 web `addBonusLineBurst(bonusLine, cssColor, count=64)`：
     *
     *   主粒子 N=count(默认 64)：spread π / speed 4.5-22 px/帧 / life 1.45-2.10s / size 7-25px / 主色金/cssColor/白 轮转
     *   内圈高速 36 个：全方位 angle / speed 8-28 px/帧 / life 1.25-1.70s / size 3.5-10.5px / 白与 cssColor 交替
     *   金色火花 36 个：水平 ±18 / 强烈向上 12-28 / life 1.75-2.20s / size 3-9px / 金色 #FFD700
     *
     * 该函数对每条 bonusLine 单独调用；与 burstClear 共用 _particles 队列与渲染管线
     * （update() 内按 web 物理积分：vx/vy×dt + damping^frames + 重力 - vy → cocos y+ 翻转）。
     */
    addBonusLineBurst(bonusLine: { type: 'row' | 'col'; idx: number }, color: Color, count: number = 64): void {
        if (!VisualFx.enabled) return;
        if (Motion.reduced) count = Math.max(8, Math.round(count * 0.3));
        const cs = this.boardPx / this.size;
        const gold: [number, number, number] = [255, 215, 0];
        const white: [number, number, number] = [255, 255, 255];
        const rgb: [number, number, number] = [color.r, color.g, color.b];
        // 预算守卫：与 burstClear 同口径，超出 MAX_CLEAR_PARTICLES 等比削减。
        const intended = count + 36 + 36;
        const budget = MAX_CLEAR_PARTICLES - this._particles.length;
        if (budget <= 0) return;
        const scale = intended > budget ? budget / intended : 1;
        const N = Math.max(1, Math.floor(count * scale));
        const N2 = Math.max(1, Math.floor(36 * scale));
        const N3 = Math.max(1, Math.floor(36 * scale));

        const pickXY = (): { x: number; y: number } => {
            // web: row → x = cs * rand × size, y = cs * (idx+0.5); col 反之
            if (bonusLine.type === 'row') {
                return this.webToBoard(cs * Math.random() * this.size, cs * (bonusLine.idx + 0.5));
            }
            return this.webToBoard(cs * (bonusLine.idx + 0.5), cs * Math.random() * this.size);
        };
        const push = (x: number, y: number, vxFrame: number, vyFrame: number, rgbCol: [number, number, number],
                      life: number, decay: number, size: number, gravityMul: number, damping?: number): void => {
            this._particles.push({
                x, y,
                vx: vxFrame * 60,
                vy: -vyFrame * 60, // cocos y+ 向上
                life, maxLife: life,
                size,
                color: new Color(rgbCol[0], rgbCol[1], rgbCol[2], 255),
                decay, gravityMul,
                damping,
            });
        };

        // ── 主粒子（half-sphere 爆发，金/cssColor/白 三色轮转）─────────────────
        for (let i = 0; i < N; i++) {
            const { x, y } = pickXY();
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 3.20;
            const speed = 4.5 + Math.random() * 17.5;
            const vxFrame = Math.cos(angle) * speed;
            const vyFrame = Math.sin(angle) * speed - (1.5 + Math.random() * 2.5);
            const triple = i % 3;
            const c = triple === 0 ? gold : triple === 1 ? rgb : white;
            push(x, y, vxFrame, vyFrame, c,
                1.45 + Math.random() * 0.65,
                0.0042 + Math.random() * 0.0035,
                7 + Math.random() * 18,
                0.48);
        }
        // ── 内圈高速碎屑（全方位 + 速度更高，营造爆炸内核）───────────────────
        for (let k = 0; k < N2; k++) {
            const { x, y } = pickXY();
            const angle = Math.random() * Math.PI * 2;
            const speed = 8 + Math.random() * 20;
            const vxFrame = Math.cos(angle) * speed;
            const vyFrame = Math.sin(angle) * speed - (1.5 + Math.random() * 2.5);
            const c = k % 2 ? white : rgb;
            push(x, y, vxFrame, vyFrame, c,
                1.25 + Math.random() * 0.45,
                0.0055 + Math.random() * 0.0048,
                3.5 + Math.random() * 7,
                0.34);
        }
        // ── 金色火花（强烈向上飞溅，最长余韵）─────────────────────────────
        for (let j = 0; j < N3; j++) {
            const { x, y } = pickXY();
            const vxFrame = (Math.random() - 0.5) * 36;
            const vyFrame = -(12 + Math.random() * 16);
            const life = 1.75 + Math.random() * 0.45;
            push(x, y, vxFrame, vyFrame, gold,
                life,
                0.0058 + Math.random() * 0.004,
                3 + Math.random() * 6,
                0.40);
        }
    }

    /**
     * 同花顺色块持续涌出 —— 严格对齐 web `beginBonusColorGush(lineSpecs, durationMs)`：
     *
     *   首帧每条 bonusLine 强爆发 42 个 strongBurst 色块；
     *   整段 durationMs 内每 ~33ms 滚一次 spawn：
     *     - t < 0.36：82% × 3 / 18% × 2
     *     - t < 0.76：62% × 2 / 38% × 1
     *     - 末段    ：40% × 1 / 60% × 0
     *   单次粒子参数：spread strong 3.15 / 常规 2.85；speed strong 4.8-20.3 / 常规 3.4-14.4；
     *   life 1.20-1.82s；size 2.8-13.8（strong）/2.8-10.3（常规）；色彩 34% 金 / 34% cssColor / 32% 白
     *
     * 与 OverlayFx.bonusIconGush 同期触发（icon + 色块双层喷涌），构成 web 同花顺的"绚丽感"。
     */
    beginBonusColorGush(lineSpecs: Array<{ bonusLine: { type: 'row' | 'col'; idx: number }; color: Color }>, durationMs: number): void {
        if (!VisualFx.enabled || !lineSpecs.length) return;
        if (Motion.reduced) return;
        const now = Date.now();
        const span = Math.max(520, durationMs);
        for (const spec of lineSpecs) {
            this._colorGushTasks.push({
                bonusLine: spec.bonusLine,
                color: spec.color,
                startMs: now,
                endMs: now + span,
                spawnAcc: 0,
            });
            // 首帧强爆发 42 个
            for (let i = 0; i < 42; i++) {
                this.pushColorGushParticle(spec.bonusLine, spec.color, /*strong*/ true);
            }
        }
    }

    /** 方块涌入落地点缀：在盘面指定格 (gx, gy) 喷射少量碎屑。 */
    burstAtCell(gx: number, gy: number, color: Color, count: number = 4): void {
        if (!VisualFx.enabled || Motion.reduced) return;
        const cs = this.boardPx / this.size;
        const { x, y } = this.webToBoard(cs * (gx + 0.5), cs * (gy + 0.5));
        const gold = new Color(255, 215, 0, 255);
        for (let i = 0; i < count; i++) {
            if (this._particles.length >= MAX_CLEAR_PARTICLES) break;
            const ang = Math.random() * Math.PI * 2;
            const sp = 2 + Math.random() * 5;
            const col = i % 2 === 0 ? color : gold;
            this._particles.push({
                x, y,
                vx: Math.cos(ang) * sp * 60,
                vy: (-Math.sin(ang) * sp + 3) * 60,
                life: 0.5 + Math.random() * 0.3,
                maxLife: 0.8,
                size: 1.5 + Math.random() * 3,
                color: new Color(col.r, col.g, col.b, 255),
                gravityMul: 0.4,
                decay: 0.022,
            });
        }
    }

    /** 单个色块粒子生成（与 web `_pushBonusColorParticle` 1:1）。 */
    private pushColorGushParticle(bonusLine: { type: 'row' | 'col'; idx: number }, color: Color, strong: boolean): void {
        if (this._particles.length >= MAX_CLEAR_PARTICLES) return;
        const cs = this.boardPx / this.size;
        const wx = bonusLine.type === 'row' ? cs * Math.random() * this.size : cs * (bonusLine.idx + 0.5);
        const wy = bonusLine.type === 'row' ? cs * (bonusLine.idx + 0.5) : cs * Math.random() * this.size;
        const { x, y } = this.webToBoard(wx, wy);
        const gold: [number, number, number] = [255, 215, 0];
        const white: [number, number, number] = [255, 255, 255];
        const roll = Math.random();
        const rgb: [number, number, number] = roll < 0.34 ? gold : roll < 0.68 ? [color.r, color.g, color.b] : white;
        const spread = strong ? 3.15 : 2.85;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        const speed = (strong ? 4.8 : 3.4) + Math.random() * (strong ? 15.5 : 11.0);
        const vxFrame = Math.cos(angle) * speed;
        const vyFrame = Math.sin(angle) * speed - (1.4 + Math.random() * 3.0);
        const life = 1.20 + Math.random() * 0.62;
        this._particles.push({
            x, y,
            vx: vxFrame * 60,
            vy: -vyFrame * 60,
            life, maxLife: life,
            size: 2.8 + Math.random() * (strong ? 11 : 7.5),
            color: new Color(rgb[0], rgb[1], rgb[2], 255),
            decay: 0.0036 + Math.random() * 0.0036,
            gravityMul: 0.42 + Math.random() * 0.14,
            // 色块涌出无 damping（web `_pushBonusColorParticle` 不设 damping）
        });
    }

    /** colorGush 调度（在 update 内按 web `_tickColorGushSpawn` 时间窗口节奏 spawn）。 */
    private tickColorGushSpawn(dt: number): void {
        if (!this._colorGushTasks.length) return;
        const now = Date.now();
        // 过期任务清理
        for (let i = this._colorGushTasks.length - 1; i >= 0; i--) {
            if (now >= this._colorGushTasks[i].endMs) this._colorGushTasks.splice(i, 1);
        }
        if (!this._colorGushTasks.length) return;
        // web `particles.length > 620` 上限直接套用
        if (this._particles.length > 620) return;
        for (const task of this._colorGushTasks) {
            task.spawnAcc += dt;
            if (task.spawnAcc < 0.033) continue;
            task.spawnAcc = 0;
            const span = Math.max(1, task.endMs - task.startMs);
            const t = (now - task.startMs) / span;
            let rolls = 0;
            if (t < 0.36) rolls = Math.random() < 0.82 ? 3 : 2;
            else if (t < 0.76) rolls = Math.random() < 0.62 ? 2 : 1;
            else rolls = Math.random() < 0.40 ? 1 : 0;
            const strong = t < 0.15;
            for (let k = 0; k < rolls; k++) {
                if (this._particles.length >= MAX_CLEAR_PARTICLES) break;
                this.pushColorGushParticle(task.bonusLine, task.color, strong);
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
     * 对齐 web `showFloatScore` —— 消行档位完整规格（颜色/字号/动画/时长全部按 CSS 取值）。
     *
     * 锚位：**严格对齐 web `_anchorOnBoard` 默认行为 — 盘面正中央**（不再使用落子格上方偏移）。
     *   原 (gx, gy) 入参保留但不再用作锚位，仅作向后兼容；底层位移完全由各档位关键帧驱动。
     *
     * 档位对照表（与 web `.float-score` / `.float-multi` / `.float-combo` / `.float-perfect` /
     * `.float-new-best` / `.float-icon-bonus` 一一对应）：
     *
     *   normal   单消 +N        | #70AD47（var(--success)）            | 22px         | floatUp 0.7s        | hold 600ms
     *   multi    双消（==2）    | #27ae60 容器 / #2ecc71 label         | 24px (base)  | multiPop 0.9s       | hold 1450ms
     *   combo    多消（≥3）     | #e67e22 容器                         | 30px (base)  | comboScorePop 1.5s  | hold 1450ms
     *   perfect  清屏           | 彩虹渐变（取金黄主色 #ffd166 近似）  | 36px (base)  | perfectPop 2.2s     | hold 2200ms
     *   new-best 新最佳         | 金粉蓝渐变（取金主色 #ffd166）       | 38px (base)  | newBestFloat 2.3s   | hold 2300ms
     *   bonus    同花顺大消除   | 金粉紫渐变（取金主色 #f59e0b）       | 47px (base)  | bonusScoreArtPop 4s | hold 4000ms
     *
     * CSS 多色渐变 Cocos Label 无原生支持 → 用主色 + 强 LabelShadow + LabelOutline 近似，
     * 视觉权重档位差异（小 → 大）严格保留。
     */
    showScoreFloat(amount: number, kind: 'normal' | 'combo' | 'multi' | 'perfect' | 'new-best' | 'bonus' = 'normal', _gx?: number, _gy?: number, label?: string): void {
        if (amount <= 0) return;
        void _gx; void _gy; // 旧入参，与 web 统一为「盘面中央」锚位后不再用作位移；仅作 API 向后兼容。

        // ── 档位规格表（与 CSS 1:1）────────────────────────────────────────────
        // 每行严格对应 main.css 中的 `.float-<kind>` 规则集 + 共享的 `.float-label` / `.float-pts` 默认值。
        // 视觉权重档位差异（小 → 大）= baseSize × {ptsEm × ptsColor × shadow blur} 三者协同；
        // 渐变文字（perfect/new-best/bonus）取 CSS 渐变中段主色作 LabelShadow 单层近似。
        type Spec = {
            /** label 行颜色 — CSS `.float-<kind> .float-label { color }`（或继承容器色） */
            labelColor: Color;
            /** label 阴影 — CSS `.float-<kind> .float-label { text-shadow }`，缺省走 spec.shadowColor */
            labelShadowColor?: Color;
            /** pts 行颜色 — CSS `.float-<kind> { color }`（pts 默认继承容器色） */
            ptsColor: Color;
            /** pts/容器阴影主色 — CSS `text-shadow` 主光晕 */
            shadowColor: Color;
            /** 容器 base font-size — CSS `.float-<kind> { font-size: clamp() }` 取中位 */
            baseSize: number;
            /** label 字号 / base 比例 — CSS `.float-<kind> .float-label { font-size: Xem }` */
            labelEm: number;
            /** pts 字号 / base 比例 — CSS `.float-<kind> .float-pts { font-size: Xem }` */
            ptsEm: number;
            /** 容器级 letter-spacing（em），CSS `.float-<kind> { letter-spacing }` */
            containerLetterEm: number;
            /** label 专属 letter-spacing（em），CSS `.float-<kind> .float-label { letter-spacing }` */
            labelLetterEm: number;
            /** 总动画时长（s），与 CSS animation-duration 一致 */
            animMs: number;
            /** DOM 留存时长（ms），与 web `floatHoldMs` 一致 */
            holdMs: number;
            /** 关键帧档位 id，driveKeyframes 据此驱动 */
            anim: 'floatUp' | 'multiPop' | 'comboScorePop' | 'perfectPop' | 'newBestFloat' | 'bonusScoreArtPop';
        };
        const specs: Record<typeof kind, Spec> = {
            // .float-score: color var(--success)=#70AD47, 22px, label 0.72em letter 0.1em, pts 1.12em letter 0.02em, floatUp 0.7s, hold 600
            normal: {
                labelColor: new Color(112, 173, 71, 255), ptsColor: new Color(112, 173, 71, 255),
                shadowColor: new Color(46, 204, 113, 180),
                baseSize: 22, labelEm: 0.72, ptsEm: 1.12,
                containerLetterEm: 0, labelLetterEm: 0.10,
                animMs: 700, holdMs: 600, anim: 'floatUp',
            },
            // .float-multi: color #27ae60, clamp(20,4.5vw,28) → 桌面上限 28px；shadow 8px 绿；multiPop 0.9s
            // cocos 走"准桌面"展示档（盘面 ≥480px），统一采用 web 桌面上限字号，
            // 之前 24px 在大盘面下飘字明显小于 web 整体氛围。
            multi: {
                labelColor: new Color(46, 204, 113, 255), labelShadowColor: new Color(46, 204, 113, 180),
                ptsColor: new Color(39, 174, 96, 255),
                shadowColor: new Color(39, 174, 96, 200),
                baseSize: 28, labelEm: 0.72, ptsEm: 1.12,
                containerLetterEm: 0, labelLetterEm: 0.10,
                animMs: 900, holdMs: 1450, anim: 'multiPop',
            },
            // .float-combo: color #e67e22, clamp(24,5.5vw,36) → 桌面上限 36px，letter 0.04em；label 0.6em letter 0.14em；comboScorePop 1.5s
            combo: {
                labelColor: new Color(230, 126, 34, 255), ptsColor: new Color(230, 126, 34, 255),
                shadowColor: new Color(255, 200, 80, 240),
                baseSize: 36, labelEm: 0.60, ptsEm: 1.12,
                containerLetterEm: 0.04, labelLetterEm: 0.14,
                animMs: 1500, holdMs: 1450, anim: 'comboScorePop',
            },
            // .float-perfect: 彩虹渐变(红/橙/黄/绿/蓝/紫)→ 取金黄 #ffd166 主色；clamp(28,6vw,44) → 桌面上限 44px；letter 0.06em；label 0.55em letter 0.18em；perfectPop 2.2s
            perfect: {
                labelColor: new Color(255, 209, 102, 255), ptsColor: new Color(255, 209, 102, 255),
                shadowColor: new Color(255, 200, 100, 240),
                baseSize: 44, labelEm: 0.55, ptsEm: 1.12,
                containerLetterEm: 0.06, labelLetterEm: 0.18,
                animMs: 2200, holdMs: 2200, anim: 'perfectPop',
            },
            // .float-new-best: 金粉蓝渐变 → 主色 #ffd166；clamp(30,6.2vw,46) → 桌面上限 46px；letter 0.08em；label 0.5em letter 0.20em；newBestFloat 2.3s
            'new-best': {
                labelColor: new Color(255, 209, 102, 255), ptsColor: new Color(255, 209, 102, 255),
                shadowColor: new Color(255, 122, 217, 220),
                baseSize: 46, labelEm: 0.50, ptsEm: 1.12,
                containerLetterEm: 0.08, labelLetterEm: 0.20,
                animMs: 2300, holdMs: 2300, anim: 'newBestFloat',
            },
            // .float-icon-bonus / .float-bonus-art: 金粉紫渐变 → 主色 #f59e0b；47px 容器 letter 0.018em；label 0.34em letter 0.12em；bonusScoreArtPop 4s
            bonus: {
                labelColor: new Color(253, 230, 138, 255), ptsColor: new Color(245, 158, 11, 255),
                shadowColor: new Color(192, 38, 211, 220),
                baseSize: 47, labelEm: 0.34, ptsEm: 1.00,
                containerLetterEm: 0.018, labelLetterEm: 0.12,
                animMs: 4000, holdMs: 4000, anim: 'bonusScoreArtPop',
            },
        };
        const rawSpec = specs[kind] ?? specs.normal;
        // ── boardPx 适配（cocos 全屏沉浸 vs web 浏览器内嵌）──────────────────
        // web 用 `clamp(min, X vw, max)`，移动端 (375px 视口) combo 仅 ~21px；cocos 是全屏
        // 占位 (没有侧栏/导航/HUD 抢占视觉)，飘字必须比"等宽度移动端 web"更大才能撑住氛围。
        // 把 spec.baseSize 视为"web 桌面上限"基准，再按 boardPx/420 等比放大（不缩小）：
        //   boardPx<420 (低端小屏)        → 维持桌面上限，宁可大一点也不能瘦小
        //   boardPx=420 (典型 5.5 寸全屏) → 1.0× → 与 web 桌面上限一致
        //   boardPx=480 (典型 6.x 寸全屏) → 1.14× → combo 41px / pts 46px
        //   boardPx=600+ (平板/折叠屏)    → 1.43× → combo 51px / pts 58px
        // 把基准从 480 下调到 420：用户反馈"中等盘面也偏小"，相同 boardPx 下统一再大 ~14%，
        // 既补足"cocos 默认中盘"的视觉权重，也避免大盘面下飘字撑不起氛围。
        const sizeScale = Math.max(1.0, this.boardPx / 420);
        const spec: Spec = {
            ...rawSpec,
            baseSize: Math.round(rawSpec.baseSize * sizeScale),
        };

        // ── 节点骨架 ─────────────────────────────────────────────────────────
        // web `_anchorOnBoard({ dyRatio: 0 })` —— 盘面正中央，所有消行飘字共用同一位置；
        // 多档位时间错位 / 视觉权重差异由动画 + 字号自己承担，不靠空间区隔。
        const n = new Node('scoreFloat');
        n.parent = this.node;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        n.setPosition(0, 0, 0);
        const op = n.addComponent(UIOpacity);
        op.opacity = 0;

        // CSS `.float-score { gap: 2px }` —— label 与 pts 之间的间距严格按 2px。
        const GAP_PX = 2;
        const labels: Label[] = [];

        if (label) {
            const tag = new Node('floatTag');
            tag.parent = n;
            // label 顶部锚点：以容器中心为 0，label 上半部分位于 +y，所以锚点 (0.5, 0)
            tag.addComponent(UITransform).setAnchorPoint(0.5, 0);
            tag.setPosition(0, GAP_PX / 2, 0);
            const tl = tag.addComponent(Label);
            tl.string = label;
            const tlSize = Math.max(10, Math.round(spec.baseSize * spec.labelEm));
            // 总字距 = 容器级 + label 级（CSS 自然继承叠加）
            const letterEm = spec.containerLetterEm + spec.labelLetterEm;
            applyTextStyle(tl, {
                fontFamily: UI_FONT_FAMILY,
                fontSize: tlSize,
                lineHeight: tlSize + 4,
                color: spec.labelColor,
                bold: true, // CSS `.float-label { font-weight: 800 }`
                letterSpacing: Math.max(1, Math.round(tlSize * letterEm)),
            });
            // label 专属阴影色（multi 是亮绿、其他档位走容器主光晕）
            tryAddShadow(tag, spec.labelShadowColor ?? spec.shadowColor, 0, 0, 10);
            // CSS `.float-label { opacity: 0.92 }` —— 仅 .float-score 默认值，此处按 web 自然继承统一应用。
            const labelOp = tag.addComponent(UIOpacity);
            labelOp.opacity = 235; // ≈ 0.92 × 255
            labels.push(tl);
        }

        // ── pts/+N 行（bonus 走艺术字双 span 结构，其余走单 label）────────────
        const valNode = label ? new Node('floatVal') : n;
        if (label) {
            valNode.parent = n;
            valNode.addComponent(UITransform).setAnchorPoint(0.5, 1);
            valNode.setPosition(0, -GAP_PX / 2, 0);
        }

        if (kind === 'bonus') {
            /* CSS `.float-bonus-score-row > .float-bonus-num + .float-bonus-mult-wrap`：
             *   .float-bonus-num: 1em（继承容器 47px）, 渐变金粉紫主色 #f59e0b, letter 0.02em
             *   .float-bonus-mult-wrap: 0.4em ≈ 19px, color #fef3c7（米黄）, letter 0.03em, font-weight 800
             * 水平 row 排列；num 在左、`(5x)` 在右。
             */
            const rowNode = valNode;
            // num 主分数
            const numNode = new Node('bonusNum');
            numNode.parent = rowNode;
            numNode.addComponent(UITransform).setAnchorPoint(1, 0.5);
            const numSize = Math.round(spec.baseSize * 1.0);
            const numLabel = numNode.addComponent(Label);
            numLabel.string = `+${amount}`;
            applyTextStyle(numLabel, {
                fontFamily: UI_FONT_FAMILY,
                fontSize: numSize,
                lineHeight: numSize + 6,
                color: spec.ptsColor, // 金主色 #f59e0b
                bold: true,
                letterSpacing: Math.max(1, Math.round(numSize * (spec.containerLetterEm + 0.02))),
            });
            tryAddShadow(numNode, spec.shadowColor, 0, 0, 14);
            tryAddOutline(numNode, new Color(120, 53, 15, 60), 1); // -webkit-text-stroke 1px rgba(120,53,15,.24)
            // (5x) 副字 — 严格对齐 CSS `.float-bonus-mult-wrap`
            const multNode = new Node('bonusMult');
            multNode.parent = rowNode;
            multNode.addComponent(UITransform).setAnchorPoint(0, 0.5);
            const multSize = Math.max(12, Math.round(spec.baseSize * 0.4));
            const multLabel = multNode.addComponent(Label);
            multLabel.string = '(5x)';
            applyTextStyle(multLabel, {
                fontFamily: UI_FONT_FAMILY,
                fontSize: multSize,
                lineHeight: multSize + 2,
                color: new Color(254, 243, 199, 255), // #fef3c7 米黄
                bold: true,
                letterSpacing: Math.max(1, Math.round(multSize * 0.03)),
            });
            // CSS `text-shadow: 0 0 10px rgba(251,191,36,.75), 0 1px 2px rgba(0,0,0,.45)` → 金色光晕
            tryAddShadow(multNode, new Color(251, 191, 36, 190), 0, -1, 10);
            // 水平布局：用 baseSize × ptsEm 的 ~50% 估算 +N 宽度（系统 Label 自适应宽，cocos 没有 inline-flex，
            // 这里取一个保守的水平偏移让两段不重叠也不分裂）。CSS gap 0.03em ≈ 1-2px。
            const NUM_HALF_W = Math.round(numSize * 1.0); // 粗估 +N 半宽（数字 + 加号最多 3-4 字符）
            numNode.setPosition(-2, 0, 0);
            multNode.setPosition(NUM_HALF_W + 4, -Math.round(multSize * 0.04), 0);
            labels.push(numLabel, multLabel);
        } else {
            const l = valNode.addComponent(Label);
            l.string = `+${amount}`;
            const ptsSize = Math.round(spec.baseSize * spec.ptsEm);
            // 总字距 = 容器级 + pts 级（CSS `.float-pts { letter-spacing: 0.02em }` 自然继承叠加）
            const letterEm = spec.containerLetterEm + 0.02;
            applyTextStyle(l, {
                fontFamily: UI_FONT_FAMILY,
                fontSize: ptsSize,
                lineHeight: ptsSize + 6,
                color: spec.ptsColor,
                bold: true, // CSS `.float-pts { font-weight: 950 }`
                letterSpacing: Math.max(1, Math.round(ptsSize * letterEm)),
            });
            /* 阴影：perfect/new-best 主色已是高饱和金/粉，给同色光晕模拟 CSS 多层 drop-shadow；
             *      normal/multi/combo 用浅暗投影模拟 `text-shadow: 0 2px Xpx rgba(0,0,0,.3)`。
             * ⚠️ 不挂 LabelOutline —— 中等字号 1px 描边会涂满 glyph 让主色失真（已被反馈"字变白"）。 */
            tryAddShadow(valNode === n ? n : valNode, spec.shadowColor, 0, 2, kind === 'perfect' || kind === 'new-best' ? 14 : 8);
            labels.push(l);
        }

        // ── 关键帧驱动（按档位精确还原 CSS 6 套 @keyframes）─────────────────
        // 位移幅度同步按 sizeScale 放大（web 的 -36px 在 36px 字号下视觉是"约 1 个字高"
        // 的上浮；cocos 大盘面下 baseSize 已放大，位移也要等比，否则飘字"几乎不动"）。
        this.driveScoreFloatKeyframes(n, op, spec.anim, spec.animMs / 1000, sizeScale);

        // ── 兜底销毁（与 web `setTimeout(() => el.remove(), floatHoldMs)` 同步）────
        // 关键帧自带末段 opacity 0，但显式 hold 兜底防止某些 cocos 版本 tween 残留。
        const destroyDelay = Math.max(spec.animMs, spec.holdMs) / 1000;
        tween(n).delay(destroyDelay).call(() => n.destroy()).start();
        void labels;
    }

    /**
     * 按档位精确还原 CSS 6 套消行飘字关键帧。
     * 每套关键帧的百分比时间点 + scale/translate/opacity 取值与 main.css `@keyframes` 1:1 对应；
     * 此处不近似——任何偏差都会让 web/cocos 双端对账显出落差。
     */
    private driveScoreFloatKeyframes(
        n: Node,
        op: UIOpacity,
        anim: 'floatUp' | 'multiPop' | 'comboScorePop' | 'perfectPop' | 'newBestFloat' | 'bonusScoreArtPop',
        durationS: number,
        sizeScale: number = 1,
    ): void {
        // 各关键帧通用单位转换：web CSS y+ 向下 → cocos y+ 向上，需取负。
        // sizeScale 同步缩放位移（web 像素值在大屏 cocos 上原样使用会显得"几乎不动"）。
        const s = (v: number) => v3(v, v, 1);
        const y = (py: number) => v3(0, -py * sizeScale, 0);

        switch (anim) {
            case 'floatUp': {
                // 0%   opacity 1, y 0, scale 1
                // 70%  opacity 0.8
                // 100% opacity 0, y -36, scale 1.15
                op.opacity = 255;
                n.setScale(1, 1, 1);
                n.setPosition(0, 0, 0);
                tween(n)
                    .to(durationS, { position: y(-36), scale: s(1.15) }, { easing: 'quadOut' })
                    .start();
                tween(op)
                    .delay(durationS * 0.7).to(durationS * 0.3, { opacity: 0 }, { easing: 'quadOut' })
                    .start();
                break;
            }
            case 'multiPop': {
                // 0%   α 0, y +6, scale 0.7
                // 16%  α 1, y  0, scale 1.08
                // 40%  α 1, y -2, scale 1.0
                // 100% α 0, y -30, scale 1.04
                n.setScale(0.7, 0.7, 1);
                n.setPosition(0, -6 * sizeScale, 0);
                op.opacity = 0;
                tween(n)
                    .to(durationS * 0.16, { position: y(0), scale: s(1.08) }, { easing: 'cubicOut' })
                    .to(durationS * 0.24, { position: y(-2), scale: s(1.00) }, { easing: 'cubicInOut' })
                    .to(durationS * 0.60, { position: y(-30), scale: s(1.04) }, { easing: 'cubicOut' })
                    .start();
                tween(op)
                    .to(durationS * 0.16, { opacity: 255 }, { easing: 'quadOut' })
                    .delay(durationS * 0.44)
                    .to(durationS * 0.40, { opacity: 0 }, { easing: 'quadOut' })
                    .start();
                break;
            }
            case 'comboScorePop': {
                // 0%   α 0, y +8, scale 0.65
                // 12%  α 1, y  0, scale 1.15
                // 50%  α 1, y -4, scale 1.00
                // 100% α 0, y -36, scale 1.05
                n.setScale(0.65, 0.65, 1);
                n.setPosition(0, -8 * sizeScale, 0);
                op.opacity = 0;
                tween(n)
                    .to(durationS * 0.12, { position: y(0), scale: s(1.15) }, { easing: 'cubicOut' })
                    .to(durationS * 0.38, { position: y(-4), scale: s(1.00) }, { easing: 'cubicInOut' })
                    .to(durationS * 0.50, { position: y(-36), scale: s(1.05) }, { easing: 'cubicOut' })
                    .start();
                tween(op)
                    .to(durationS * 0.12, { opacity: 255 }, { easing: 'quadOut' })
                    .delay(durationS * 0.58)
                    .to(durationS * 0.30, { opacity: 0 }, { easing: 'quadOut' })
                    .start();
                break;
            }
            case 'perfectPop': {
                // 0%   α 0, y +12, scale 0.40
                // 10%  α 1, y   0, scale 1.25
                // 20%       y  -2, scale 1.00
                // 60%  α 1, y  -6, scale 1.02
                // 100% α 0, y -44, scale 1.08
                n.setScale(0.40, 0.40, 1);
                n.setPosition(0, -12 * sizeScale, 0);
                op.opacity = 0;
                tween(n)
                    .to(durationS * 0.10, { position: y(0), scale: s(1.25) }, { easing: 'cubicOut' })
                    .to(durationS * 0.10, { position: y(-2), scale: s(1.00) }, { easing: 'cubicInOut' })
                    .to(durationS * 0.40, { position: y(-6), scale: s(1.02) }, { easing: 'cubicInOut' })
                    .to(durationS * 0.40, { position: y(-44), scale: s(1.08) }, { easing: 'cubicOut' })
                    .start();
                tween(op)
                    .to(durationS * 0.10, { opacity: 255 }, { easing: 'quadOut' })
                    .delay(durationS * 0.50)
                    .to(durationS * 0.40, { opacity: 0 }, { easing: 'quadOut' })
                    .start();
                break;
            }
            case 'newBestFloat': {
                // 0%   α 0, y +14, scale 0.72
                // 18%  α 1, y   0, scale 1.14
                // 55%  α 1, y  -8, scale 1.00
                // 100% α 0, y -46, scale 0.92
                n.setScale(0.72, 0.72, 1);
                n.setPosition(0, -14 * sizeScale, 0);
                op.opacity = 0;
                tween(n)
                    .to(durationS * 0.18, { position: y(0), scale: s(1.14) }, { easing: 'cubicOut' })
                    .to(durationS * 0.37, { position: y(-8), scale: s(1.00) }, { easing: 'cubicInOut' })
                    .to(durationS * 0.45, { position: y(-46), scale: s(0.92) }, { easing: 'cubicOut' })
                    .start();
                tween(op)
                    .to(durationS * 0.18, { opacity: 255 }, { easing: 'quadOut' })
                    .delay(durationS * 0.37)
                    .to(durationS * 0.45, { opacity: 0 }, { easing: 'quadOut' })
                    .start();
                break;
            }
            case 'bonusScoreArtPop': {
                // 同花顺艺术字：8 段（0/14/24/38/52/68/100），最戏剧的爆发。
                // 0%   α 0, y +18, scale 0.06
                // 14%  α 1,        scale ?  （此处插值到 1.0）
                // 24%       y  -6, scale 1.28
                // 38%       y  +2, scale 0.94
                // 52%       y  -4, scale 1.06
                // 68%  α 1, y   0, scale 1.00
                // 100% α 0, y -16, scale 0.88
                n.setScale(0.06, 0.06, 1);
                n.setPosition(0, -18 * sizeScale, 0);
                op.opacity = 0;
                tween(n)
                    .to(durationS * 0.14, { position: y(0), scale: s(1.00) }, { easing: 'cubicOut' })  // 0→14% 爆入
                    .to(durationS * 0.10, { position: y(-6), scale: s(1.28) }, { easing: 'cubicOut' }) // 14→24% 弹大
                    .to(durationS * 0.14, { position: y(2),  scale: s(0.94) }, { easing: 'cubicInOut' })// 24→38% 回弹
                    .to(durationS * 0.14, { position: y(-4), scale: s(1.06) }, { easing: 'cubicInOut' })// 38→52% 二次弹
                    .to(durationS * 0.16, { position: y(0),  scale: s(1.00) }, { easing: 'cubicInOut' })// 52→68% 稳态
                    .to(durationS * 0.32, { position: y(-16),scale: s(0.88) }, { easing: 'cubicOut' }) // 68→100% 上浮淡出
                    .start();
                tween(op)
                    .to(durationS * 0.14, { opacity: 255 }, { easing: 'quadOut' })
                    .delay(durationS * 0.54)
                    .to(durationS * 0.32, { opacity: 0 }, { easing: 'quadOut' })
                    .start();
                break;
            }
        }
    }

    /**
     * 连续消行 streak 徽章（对齐 web `.streak-badge` 及 `_showStreakBadge`）：
     *
     * 关键定位与字号设计（修复"cocos 端 combo 字样重复"）：
     *   - 位置：盘面 **顶部**（y = +half × 0.78），与 floatScore（盘面正中央）完全错开，
     *     不再用 floatText 默认中央位（之前 sub 行 y=72、main 行 y=116 几乎与 pts 重叠，
     *     用户看到飘字小标签里的 `· combo ×N` 和 streak 徽章里的 `Combo ×N` 紧挨着出现）。
     *   - 字号：web `.streak-badge` 是 clamp(14, 3vw, 20)，明显小于 floatScore（22-46px），
     *     这是 web 视觉上"两处都有 combo 但不显重复"的关键。cocos 同步把徽章字号压到 ~20px
     *     基础 + sizeScale 缩放，与 floatScore 拉开权重差。
     *   - 颜色：web `.streak-badge` 主色 #ff6b35（暖橙），由 streak 强度过渡到金；
     *     `.streak-badge--mult` 的 ×N 子文案是金渐变 → cocos 取金色单色近似。
     *
     * fires 数量随 streak 升级：≥5 三只、≥4 两只、其余一只。
     */
    showStreakBadge(streak: number, comboMultiplier: number = 1): void {
        if (streak < 3) return;
        if (!VisualFx.enabled) return;
        const sizeScale = Math.max(1.0, this.boardPx / 420);
        const intensity = Math.min(1, (streak - 3) / 4);
        const r = Math.round(255);
        const g = Math.round(107 + intensity * 93);   // 107→200（暖橙→金黄）
        const b = Math.round(53 + intensity * 27);    // 53→80
        const mainColor = new Color(r, g, b, 255);
        const fires = streak >= 5 ? '🔥🔥🔥' : streak >= 4 ? '🔥🔥' : '🔥';
        const mainTxt = t('effect.streakCombo', { fires, n: streak });
        const hasMult = Number(comboMultiplier) > 1;

        // 盘面顶部锚位：CSS `_anchorOnBoard` 默认在盘面中央，web 用 `.streak-badge` 的
        // streakSlide 关键帧 translateY(-24px) 上浮，整体仍偏盘面中央。cocos 改为顶部偏上
        // 显式让位 floatScore；视觉权重靠"小字 + 暖色"区分，不靠位置错开（与 web 一致）。
        const half = this.boardPx / 2;
        const baseY = half * 0.78; // 盘面顶部 ~78% 高度
        const container = new Node('streakBadge');
        container.parent = this.node;
        container.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        container.setPosition(0, baseY, 0);
        const op = container.addComponent(UIOpacity);
        op.opacity = 0;

        const mainSize = Math.round(20 * sizeScale); // CSS clamp(14, 3vw, 20) → 桌面上限 20
        const mainNode = new Node('streakMain');
        mainNode.parent = container;
        mainNode.addComponent(UITransform).setAnchorPoint(0.5, hasMult ? 0 : 0.5);
        mainNode.setPosition(0, hasMult ? 2 : 0, 0);
        const mainLabel = mainNode.addComponent(Label);
        mainLabel.string = mainTxt;
        applyTextStyle(mainLabel, {
            fontFamily: `${UI_FONT_FAMILY},${EMOJI_FONT_FAMILY}`,
            fontSize: hasMult ? Math.round(mainSize * 0.7) : mainSize, // .streak-badge--mult .streak-badge-main 0.7em
            lineHeight: (hasMult ? Math.round(mainSize * 0.7) : mainSize) + 4,
            color: hasMult ? new Color(255, 245, 230, 235) : mainColor, // mult 模式下用 #fff5e6
            bold: true,
            letterSpacing: Math.max(1, Math.round(mainSize * 0.06)),
        });
        tryAddShadow(mainNode, new Color(255, 107, 53, 200), 0, 0, 10);

        if (hasMult) {
            // i18n 模板 `effect.comboMultiplier` 形如 `Combo {mult}×` —— 调用方只传数字，
            // × 后缀由模板统一加，与 web `_showStreakBadge` 同口径，避免格式漂移。
            const multTxt = Number.isInteger(comboMultiplier)
                ? `${comboMultiplier}`
                : `${Number(comboMultiplier).toFixed(1)}`;
            const sub = t('effect.comboMultiplier', { mult: multTxt });
            const multSize = Math.round(32 * sizeScale); // CSS clamp(20, 4.5vw, 32) → 桌面上限 32
            const subNode = new Node('streakMult');
            subNode.parent = container;
            subNode.addComponent(UITransform).setAnchorPoint(0.5, 1);
            subNode.setPosition(0, -2, 0);
            const subLabel = subNode.addComponent(Label);
            subLabel.string = sub;
            applyTextStyle(subLabel, {
                fontFamily: UI_FONT_FAMILY,
                fontSize: multSize,
                lineHeight: multSize + 4,
                color: new Color(255, 206, 79, 255), // 金渐变 → 单色近似 #ffce4f
                bold: true,
                letterSpacing: Math.max(1, Math.round(multSize * 0.06)),
            });
            tryAddShadow(subNode, new Color(255, 200, 60, 200), 0, 0, 8);
        }

        // streakSlide / streakMultPop 关键帧：
        //   streakSlide 1.6s：scale 0.7→1.1→1→...→0.95，translateY +10→0→-2→-24
        //   streakMultPop 2.0s：scale 0.6→1.18→1.05→1.02→0.98，translateY +8→-4→-6→-8→-22
        const dur = hasMult ? 2.0 : 1.6;
        container.setScale(hasMult ? 0.6 : 0.7, hasMult ? 0.6 : 0.7, 1);
        container.setPosition(0, baseY - 10 * sizeScale, 0);
        op.opacity = 0;
        if (hasMult) {
            tween(container)
                .to(dur * 0.18, { position: v3(0, baseY + 4 * sizeScale, 0), scale: v3(1.18, 1.18, 1) }, { easing: 'cubicOut' })
                .to(dur * 0.14, { position: v3(0, baseY + 6 * sizeScale, 0), scale: v3(1.05, 1.05, 1) }, { easing: 'cubicInOut' })
                .to(dur * 0.46, { position: v3(0, baseY + 8 * sizeScale, 0), scale: v3(1.02, 1.02, 1) }, { easing: 'cubicInOut' })
                .to(dur * 0.22, { position: v3(0, baseY + 22 * sizeScale, 0), scale: v3(0.98, 0.98, 1) }, { easing: 'cubicOut' })
                .start();
            tween(op)
                .to(dur * 0.18, { opacity: 255 }, { easing: 'quadOut' })
                .delay(dur * 0.60)
                .to(dur * 0.22, { opacity: 0 }, { easing: 'quadOut' })
                .start();
        } else {
            tween(container)
                .to(dur * 0.14, { position: v3(0, baseY, 0), scale: v3(1.1, 1.1, 1) }, { easing: 'cubicOut' })
                .to(dur * 0.16, { position: v3(0, baseY + 2 * sizeScale, 0), scale: v3(1.0, 1.0, 1) }, { easing: 'cubicInOut' })
                .to(dur * 0.70, { position: v3(0, baseY + 24 * sizeScale, 0), scale: v3(0.95, 0.95, 1) }, { easing: 'cubicOut' })
                .start();
            tween(op)
                .to(dur * 0.14, { opacity: 255 }, { easing: 'quadOut' })
                .delay(dur * 0.56)
                .to(dur * 0.30, { opacity: 0 }, { easing: 'quadOut' })
                .start();
        }
        // 兜底销毁
        tween(container).delay(dur + 0.1).call(() => container.destroy()).start();
    }

    /**
     * 「妙手」👍 toast — 严格对齐 web `.thumbs-up-toast` + `@keyframes thumbsPop` (1.5s ease-out)：
     *   - 定位：盘面右下角（CSS `bottom: 12%; right: 6%` → 取盘面坐标 0.44/-0.38 倍 half）
     *   - 字号：emoji ≈48px（与 web 移动端 clamp(36, 7vw, 56) 中位对应）
     *   - 阴影：emoji 自带颜色 + 单层 drop-shadow 由 Cocos Label 暂不支持，
     *     视觉权重靠"摆动 + 缩放回弹"完整复现 thumbsPop 6 段关键帧。
     *
     *   关键帧（与 web 1:1 对照）：
     *     0%   scale 0.30 rotate -20°  α 0
     *     15%  scale 1.25 rotate  +6°  α 1
     *     30%  scale 0.95 rotate  -3°
     *     45%  scale 1.05 rotate  +2°
     *     60%  scale 1.00 rotate   0°  α 1
     *     100% scale 1.10 translateY -20px α 0
     *
     * Tween 段时长：0.225s / 0.225s / 0.225s / 0.225s / 0.600s = 1.500s 总长，
     * 与 CSS animation-duration: 1.5s 严格一致。
     */
    showThumbsUp(): void {
        const half = this.boardPx / 2;
        const n = new Node('thumbsUp');
        n.parent = this.node;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        // web CSS: bottom 12% + right 6% → 盘面坐标 (right=half-6%*boardPx, bottom=-half+12%*boardPx)
        const startX = half - this.boardPx * 0.06;
        const startY = -half + this.boardPx * 0.12;
        n.setPosition(startX, startY, 0);
        const op = n.addComponent(UIOpacity);
        op.opacity = 0;
        const l = n.addComponent(Label);
        l.string = '👍';
        // 关键：emoji 字体栈（Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji），
        // 与 web `body` 系统字体回退一致，避免 Arial 缺 emoji glyph → 渲染方框。
        applyTextStyle(l, {
            fontFamily: EMOJI_FONT_FAMILY,
            fontSize: 48,
            lineHeight: 52,
            color: new Color(255, 255, 255, 255),
            bold: false,
        });
        // web `filter: drop-shadow(0 2px 6px rgba(0,0,0,.35))` → LabelShadow 近似。
        tryAddShadow(n, new Color(0, 0, 0, 90), 0, -2, 6);
        n.setScale(0.30, 0.30, 1);
        n.angle = -20;
        // 序列化六段关键帧（rotation 用 angle 字段；Cocos tween 支持 angle 插值）。
        tween(n)
            .to(0.225, { scale: v3(1.25, 1.25, 1), angle: 6 }, { easing: 'cubicOut' })
            .to(0.225, { scale: v3(0.95, 0.95, 1), angle: -3 }, { easing: 'cubicInOut' })
            .to(0.225, { scale: v3(1.05, 1.05, 1), angle: 2 }, { easing: 'cubicInOut' })
            .to(0.225, { scale: v3(1.00, 1.00, 1), angle: 0 }, { easing: 'cubicInOut' })
            .to(0.600, { scale: v3(1.10, 1.10, 1), position: v3(startX, startY + 20, 0) }, { easing: 'cubicOut' })
            .call(() => n.destroy())
            .start();
        // opacity 包络：0→1（前 15%≈0.225s 快速淡入）→ 1（保持到 60%≈0.9s）→ 0（最后 40%≈0.6s 淡出）
        tween(op)
            .to(0.225, { opacity: 255 }, { easing: 'quadOut' })
            .delay(0.675)
            .to(0.600, { opacity: 0 }, { easing: 'quadOut' })
            .start();
    }

    /**
     * 「差一格就消行」near-miss 飘字 — 严格对齐 web `.float-near-miss` + `@keyframes nearMissFloat` (2.8s ease-out)：
     *   - DOM 结构：单容器垂直堆叠 `<label>` 文案 + `<pts>` emoji，gap 2px（CSS `flex-direction: column`）；
     *     这里用一个父 Node 子 Node 直接还原。
     *   - 颜色：容器主色 #c0392b（深红），label #ff6b6b（亮红），letter-spacing 文字端在 cocos 无对应字段→用字号差替代。
     *   - 字号：容器 base ≈ 32px（对应 clamp(26, 5.5vw, 38) 中位），label 0.72em ≈ 23px，pts 1.05em ≈ 34px。
     *   - 关键帧（与 web 1:1 对照，5 段）：
     *     0%   y+12, scale 0.78, α 0
     *     8%   y 0,  scale 1.16, α 1
     *     20%  y-2,  scale 1.05, α 1
     *     78%  y-6,  scale 1.00, α 1
     *     100% y-44, scale 0.94, α 0
     *   - 总时长 2.8s；ease-out（对应 cubicOut）。
     *
     * 调用方需保证已通过 `shouldShowNearMiss` 控频；与 web 一致，本函数不做去重。
     */
    showNearMiss(text: string): void {
        const n = new Node('floatNearMiss');
        n.parent = this.node;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        // 默认锚位：盘面中央偏下（与 web `_anchorOnBoard` 居中规则对齐；垂直位移由动画驱动）。
        const baseY = -20;
        n.setPosition(0, baseY, 0);
        const op = n.addComponent(UIOpacity);
        op.opacity = 0;

        // CSS 颜色一一对应 —— 容器色 #c0392b 用作 LabelShadow 外发光，label/pts 各自字色独立。
        const containerColor = new Color(192, 57, 43, 255);   // #c0392b（容器主红，用作 shadow 主色）
        const labelColor = new Color(255, 107, 107, 255);     // #ff6b6b（label 亮红）
        // 🎯 是彩色 emoji，Cocos Label.color 仅作灰度调制 → 设白色让 emoji 自带真彩完整呈现。
        const ptsColor = new Color(255, 255, 255, 255);

        // <label> 文案行（上方）
        const labelNode = new Node('nmLabel');
        labelNode.parent = n;
        labelNode.addComponent(UITransform).setAnchorPoint(0.5, 0);
        labelNode.setPosition(0, 2, 0);
        const lab = labelNode.addComponent(Label);
        lab.string = text;
        applyTextStyle(lab, {
            fontFamily: UI_FONT_FAMILY,
            fontSize: 23,            // base ≈32px × 0.72em
            lineHeight: 28,
            color: labelColor,
            bold: true,              // CSS `.float-score { font-weight: 900 }`
            letterSpacing: 3,        // CSS `letter-spacing: 0.15em` ≈ 0.15 × 23 ≈ 3.5（取整）
        });
        // CSS `text-shadow:
        //   0 0 14px rgba(255,80,80,.85),
        //   0 0 28px rgba(255,60,30,.5),
        //   0 2px 5px rgba(0,0,0,.3)`
        // → Cocos 只能挂一个 LabelShadow，取最亮的近似（红色光晕 14px blur）。
        tryAddShadow(labelNode, new Color(255, 80, 80, 220), 0, 0, 14);
        // ⚠️ 不挂 LabelOutline —— 23px 字号 + 2px outline 会把整字涂成描边色，让 #ff6b6b 看起来发暗发白。
        // CSS 多层 text-shadow 的"亮红 + 深红边"层级感，由 LabelShadow 单层 + 容器同色 14px blur 已足够近似。

        // <pts> emoji 行（下方，gap 2px 由两节点锚点 + 偏移自然形成）
        const ptsNode = new Node('nmPts');
        ptsNode.parent = n;
        ptsNode.addComponent(UITransform).setAnchorPoint(0.5, 1);
        ptsNode.setPosition(0, -2, 0);
        const pts = ptsNode.addComponent(Label);
        pts.string = '🎯';
        // pts: CSS `font-size: 1.05em` ≈ 34px，必须用 EMOJI_FONT_FAMILY，否则 🎯 渲染为方框。
        applyTextStyle(pts, {
            fontFamily: EMOJI_FONT_FAMILY,
            fontSize: 34,
            lineHeight: 38,
            color: ptsColor,
            bold: false,             // emoji 不需要 bold（部分系统会渲染失真）
        });
        // emoji 不加 outline（彩色字符 outline 视觉混乱），仅给一层暗投影增立体感。
        tryAddShadow(ptsNode, new Color(0, 0, 0, 80), 0, -2, 5);

        // 容器初始态：0% scale 0.78, y+12, α 0
        n.setScale(0.78, 0.78, 1);
        n.setPosition(0, baseY + 12, 0);

        // 关键帧 → tween 段（按 web 百分比换算时长，总 2.8s）：
        //   0→8%   (0.224s)  弹大入场 0.78→1.16，y+12→0，α 0→1
        //   8→20%  (0.336s)  轻微回弹 1.16→1.05，y 0→-2
        //   20→78% (1.624s)  缓慢停留 1.05→1.00，y -2→-6
        //   78→100%(0.616s)  上浮淡出 1.00→0.94，y -6→-44，α 1→0
        tween(n)
            .to(0.224, { scale: v3(1.16, 1.16, 1), position: v3(0, baseY, 0) }, { easing: 'cubicOut' })
            .to(0.336, { scale: v3(1.05, 1.05, 1), position: v3(0, baseY - 2, 0) }, { easing: 'cubicInOut' })
            .to(1.624, { scale: v3(1.00, 1.00, 1), position: v3(0, baseY - 6, 0) }, { easing: 'cubicInOut' })
            .to(0.616, { scale: v3(0.94, 0.94, 1), position: v3(0, baseY - 44, 0) }, { easing: 'cubicOut' })
            .call(() => n.destroy())
            .start();
        tween(op)
            .to(0.224, { opacity: 255 }, { easing: 'quadOut' })
            .delay(2.176)
            .to(0.4, { opacity: 0 }, { easing: 'quadOut' })
            .start();
    }

    /**
     * 通用浮字（streak 徽章 / 升级提示 / 系统反馈）。
     * 文字样式严格对齐 web `.streak-badge` / `.float-score` 共性：粗体 900 + 字间距 + 暖色光晕 + 暗投影。
     * emoji 与文字混排：调用方传入的字符串若含 emoji，由 EMOJI_FONT_FAMILY fallback 渲染（fontFamily 选 UI 优先栈，
     * 系统找不到字符再依次回退到 emoji 字体）。
     */
    floatText(text: string, color: Color, yOffset = 0): void {
        const n = new Node('floatText');
        n.parent = this.node;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        n.setPosition(0, yOffset, 0);
        const l = n.addComponent(Label);
        l.string = text;
        // 文字栈以 UI 字体优先，emoji 字体在末尾兜底（无字距字段时 letterSpacing 静默忽略）。
        applyTextStyle(l, {
            fontFamily: `${UI_FONT_FAMILY},${EMOJI_FONT_FAMILY}`,
            fontSize: 44,
            lineHeight: 48,
            color,
            bold: true,
            letterSpacing: 2,
        });
        // 双层视觉：同色光晕 + 黑色暗投影（与 web `text-shadow: 0 0 10px <accent>, 0 2px 5px rgba(0,0,0,.3)` 近似）。
        tryAddShadow(n, new Color(color.r, color.g, color.b, 200), 0, 0, 10);
        const end = v3(0, yOffset + 90, 0);
        tween(n)
            .to(0.7, { position: end }, { easing: 'quadOut' })
            .start();
        tween(l)
            .delay(0.3)
            .to(0.4, { color: new Color(color.r, color.g, color.b, 0) })
            .call(() => n.destroy())
            .start();
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
        // bonus 色块持续涌出（与 OverlayFx.bonusIconGush 同期、按 web 时间窗节奏 spawn 进 _particles）
        this.tickColorGushSpawn(dt);
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
