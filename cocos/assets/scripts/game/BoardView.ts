import { _decorator, Component, Graphics, UITransform, Node, Label, Color, UIOpacity, Sprite, SpriteFrame, resources } from 'cc';
import { Grid, Skin, getWatermark, flag, ClearedCell } from '../core';
import { blockColor, cellEmptyColor, gridOuterColor, gridLineColor, blockMetrics, blockIcon } from './skin/palette';
import { paintBlockFace, iconFontSize, drawShapeFaces, applyIconLabelScaled } from './skin/blockPaint';
import {
    isSkinPremiumEnabled,
    getPremiumVars,
    PREMIUM_BOARD_BLEED_PX,
    PREMIUM_WRAPPER_PAD_PX,
    PREMIUM_WRAPPER_RADIUS_PX,
    premiumBoardCornerRadiusPx,
} from './platform/SkinPremium';
import { skinHasImageBlocks, getSkinBlockFrame, ensureSkinBlockFrames, skinBlockFramesReady, paintAssetOverlay, skinHasAssetOverlay } from './skin/skinSprites';
import { Motion } from './platform/Motion';
import { VisualFx } from './platform/VisualFx';

/** 盘面水印 5 锚点（四角内缩 + 中心），与 web DEFAULT_WATERMARK_ANCHOR_RATIOS 同思路。 */
const WM_ANCHORS: Array<[number, number]> = [
    [0.22, 0.24], [0.78, 0.24], [0.5, 0.5], [0.22, 0.76], [0.78, 0.76],
];

/**
 * 从池中无重复抽 k 个元素（Fisher-Yates 部分洗牌，O(n) 一次性，无 GC 抖动）。
 * 用于 boardWatermark.hdIcons：每次 setSkin 随机选 5 个意象给 5 锚点。
 */
function pickRandomDistinct<T>(pool: readonly T[], k: number): T[] {
    const n = pool.length;
    if (k >= n) return pool.slice();
    const arr = pool.slice();
    for (let i = 0; i < k; i++) {
        const j = i + Math.floor(Math.random() * (n - i));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, k);
}

/* 水印漂移（严格对齐 web renderer.js 的常量与 _watermarkPointsForFrame）：
 *   - 每个 icon 独立 Catmull-Rom 滑动窗口，段时长 8–14s 随机；
 *   - waypoint 振幅 = 盘面短边 × (0.14 + rand×0.10)，软 clamp 到 [-0.05, 1.05]；
 *   - 段端点切线连续（C¹）→ icon 持续漂浮、无"减速到 0 再加速"的停顿；
 *   - 「换皮不换轨」：drift key 不含皮肤 id，切肤只换 emoji、轨迹连续。 */
const WM_SEGMENT_MIN_MS = 8000;
const WM_SEGMENT_MAX_MS = 14000;
const WM_AMP_BASE = 0.14;
const WM_AMP_RAND = 0.10;
const WM_TARGET_MIN = -0.05;
const WM_TARGET_MAX = 1.05;

/** Catmull-Rom（uniform, τ=0.5），4 控制点对 p1→p2 段插值。与 web `catmullRom` 同式。 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
        (2 * p1)
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
}

const { ccclass, property } = _decorator;

/**
 * 盘面渲染（Graphics + emoji Label）。坐标：节点锚点居中，grid (gx,gy) 的 gy=0 在顶部。
 * 立体面 + 中心 emoji 与 web renderer 对齐（带 icon 皮肤显示对应字形）。
 */
@ccclass('BoardView')
export class BoardView extends Component {
    @property
    boardPx = 480;

    /**
     * 兜底 gap（仅当 skin 没配 `gridGap` 时使用）。
     * ⚠️ 业务渲染路径请走 `skinGap(skin)`，不要直接读这个属性 —— 多数皮肤 explicit 配 1 或 0，
     * 旧版本写死 2 是这条投诉「格子线太长」的根因之一。
     */
    @property
    gap = 1;

    /**
     * 7 层图层结构（自底向上）—— 与 web/src/renderer.js 的渲染顺序严格 1:1 对齐：
     *
     *   Layer 1  bg            self._bgG               outer 全屏 + cellEmpty 8×8     (web _paintBackgroundUnder)
     *   Layer 2  watermark     _wmRoot (Labels)        浮层 emoji × UIOpacity         (web _renderBoardWatermark)
     *   Layer 3  gridLines     _gridLineG              内部 7+7 网格线                 (web _paintBackgroundOver)
     *   Layer 4a blocks(G)     _blocksG                Graphics 方块面（默认路径）       (web grid layer / paintBlockCell)
     *   Layer 4b blocks(spr)   _spriteRoot             Sprite 方块（flag spriteBlocks）  (同上的可染色贴图变体)
     *   Layer 5  icons         _iconRoot (Labels)      方块中心 emoji                   (web _paintIcon)
     *   Layer 6  ghost         _ghostG                 拖拽 / 提示的半透明 ghost          (web renderPreview)
     *   Layer 7  preview-clear _previewClearG          待消除 fill + stroke 二合一       (web renderPreviewClearHint)
     *
     * Cocos 渲染规则：父节点先渲染、再按子节点 sibling index 顺序渲染。所以子节点的
     * sibling index 自小到大即等于自底向上的图层顺序。父节点 self 只承载 Layer 1 (bg)。
     *
     * 之前的 bug：blocks 也画在 self._g（Layer 1 位置）→ wm/gridLines 这两个子节点反而
     * 渲染在已放方块之上，与 web 「方块覆盖水印/网格线」的视觉相反。
     */
    private _bgG: Graphics | null = null;
    private _size = 8;
    private _skin: Skin | null = null;
    private _wmRoot: Node | null = null;
    private _wmOp: UIOpacity | null = null;
    private _wm: Label[] = [];
    /** 当前活跃水印 icon 数（renderWatermark 设置；0 = 无水印，不漂移）。 */
    private _wmActiveCount = 0;
    /** 水印漂移滑动窗口状态（对齐 web `_watermarkDrift`）。 */
    private _wmDrift: { key: string; waypoints: number[][][]; startTs: number[]; durationMs: number[] } | null = null;
    private _gridLineRoot: Node | null = null;
    private _gridLineG: Graphics | null = null;
    /** Layer 4a：Graphics 渲染的方块（默认路径）。每次 render() 重画。 */
    private _blocksRoot: Node | null = null;
    private _blocksG: Graphics | null = null;
    /** Layer 4b：可选 Sprite 方块（flag spriteBlocks 启用，可染色灰度贴图）。 */
    private _spriteRoot: Node | null = null;
    private _blockFrame: SpriteFrame | null = null;
    private _blockSprites: Sprite[] = [];
    /** Layer 4c（仅图片皮肤）：sprite 之上的"柔光浮雕"叠加层（对齐 web blockBevel.assetOverlay）。 */
    private _overlayRoot: Node | null = null;
    private _overlayG: Graphics | null = null;
    /** 最近一次 render 的 grid，用于图片皮肤贴图异步加载完成后重绘一次。 */
    private _grid: Grid | null = null;
    /** 图片皮肤 ghost 贴图池（落点预览，半透明），挂在 _ghostRoot 下。
     *  v1.71 简化：ghost 不再走 sprite 路径（与其他 25+ 皮肤一致用 Graphics 绘面），但保留池字段
     *  避免热路径解构变动；hideGhostSprites 会被 setSkin/cancelDrag 等调用，需要安全 noop。 */
    private _ghostSprites: Sprite[] = [];
    private _iconRoot: Node | null = null;
    private _icons: Label[] = [];
    /** Layer 6：拖拽 / 提示 ghost（半透明）。renderGhost() 仅重画此层，blocks 层保持不变 → 拖拽更省。 */
    private _ghostRoot: Node | null = null;
    private _ghostG: Graphics | null = null;
    /** Layer 7：待消除 preview-clear-hint（fill + stroke 二合一）。 */
    private _previewClearRoot: Node | null = null;
    private _previewClearG: Graphics | null = null;
    private _previewClearCells: ClearedCell[] | null = null;
    /** 节流：30Hz 重画（~33ms）。脉冲频率与 web `Date.now()*0.007` 等价，跨 60/120Hz 屏一致。 */
    private _previewClearLastPaintMs = 0;
    /** 水印漂移节流时间戳：漂移是 wall-time 的解析函数，30Hz 取样足够顺滑（icon 段时长 8-14s），
     *  无需每帧（60fps）推进 → active 期也省一半 setPosition + Catmull-Rom 计算。 */
    private _wmDriftLastMs = 0;
    /** 复用 Color 实例（避免 paintPreviewClearHint 每帧 4 次 new Color：30Hz × 拖拽全程的 GC 压力）。 */
    private _pcFill: Color | null = null;
    private _pcGlow1: Color | null = null;
    private _pcGlow2: Color | null = null;
    private _pcEdge: Color | null = null;

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.boardPx, this.boardPx);
        uit.setAnchorPoint(0.5, 0.5);

        // Layer 1: bg —— outer 全屏 + cellEmpty 8×8（self 自身的 Graphics）
        this._bgG = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);

        // Layer 2: watermark
        this._wmRoot = new Node('L2_watermark');
        this._wmRoot.parent = this.node;
        this._wmRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._wmOp = this._wmRoot.addComponent(UIOpacity);

        // Layer 3: grid lines（与 web _paintBackgroundOver 同位置）
        this._gridLineRoot = new Node('L3_gridLines');
        this._gridLineRoot.parent = this.node;
        this._gridLineRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._gridLineG = this._gridLineRoot.addComponent(Graphics);

        // Layer 4a: Graphics blocks（默认路径，必须在 gridLines 之上 → web 同序）
        this._blocksRoot = new Node('L4a_blocks');
        this._blocksRoot.parent = this.node;
        this._blocksRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._blocksG = this._blocksRoot.addComponent(Graphics);

        // Layer 4b: Sprite blocks（可选，与 4a 同 z 序，互斥使用）
        this._spriteRoot = new Node('L4b_spriteBlocks');
        this._spriteRoot.parent = this.node;
        this._spriteRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);

        // Layer 4c: 图片皮肤柔光浮雕叠加（对齐 web `_paintAssetSoftOverlay` +
        // outerStroke/innerStroke 双描边，让水墨/工艺类贴图皮肤有"瓷砖凸起"立体感）。
        this._overlayRoot = new Node('L4c_assetOverlay');
        this._overlayRoot.parent = this.node;
        this._overlayRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._overlayG = this._overlayRoot.addComponent(Graphics);

        // Layer 5: 方块中心 emoji icons（盖在 blocks 之上）
        this._iconRoot = new Node('L5_icons');
        this._iconRoot.parent = this.node;
        this._iconRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);

        // Layer 6: 拖拽 ghost / hint 脉冲（独立 Graphics → 仅重画 ghost 时不动 blocks）
        this._ghostRoot = new Node('L6_ghost');
        this._ghostRoot.parent = this.node;
        this._ghostRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._ghostG = this._ghostRoot.addComponent(Graphics);

        // Layer 7: preview-clear-hint（最顶层）
        this._previewClearRoot = new Node('L7_previewClearHint');
        this._previewClearRoot.parent = this.node;
        this._previewClearRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._previewClearG = this._previewClearRoot.addComponent(Graphics);

        // 容错加载方块贴图：成功则启用 sprite 渲染，失败保持 Graphics 渲染（与启动屏同款兜底）。
        resources.load('art/block/spriteFrame', SpriteFrame, (err: unknown, sf: SpriteFrame) => {
            if (err || !sf || !this._spriteRoot || !this._spriteRoot.isValid) return;
            this._blockFrame = sf;
        });
    }

    /**
     * 设置当前 ghost 落点的"潜在消行高亮"格列表（null = 关闭）。
     * 调用方（GameController.updateSnap）只在 snap 存在 + canPlace 时算 `previewClearOutcome`，
     * 这里仅负责持久化 + 触发首次重画。后续的脉冲动画由 update() 自驱。
     */
    setPreviewClearHint(cells: ClearedCell[] | null): void {
        const had = !!this._previewClearCells?.length;
        const has = !!cells?.length;
        this._previewClearCells = has ? cells : null;
        // 状态翻转或格列表变化时立即重画一次，避免脉冲下一帧才追上来（玩家会觉得"反馈延迟"）。
        if (had !== has || has) {
            this._previewClearLastPaintMs = 0;
            this.paintPreviewClearHint();
        }
    }

    update(): void {
        const now = Date.now();
        // 水印漂移节流到 ~30Hz（轨迹为 wall-time 解析函数，30Hz 取样已足够顺滑）。
        if (now - this._wmDriftLastMs >= 33) {
            this._wmDriftLastMs = now;
            this.updateWatermarkDrift();
        }
        if (!this._previewClearCells?.length) return;
        // 30Hz 节流：脉冲周期 ~900ms（与 web `Date.now()*0.007` 同步），30Hz 已足够流畅，
        // 60/120Hz 会浪费 CPU 在不必要的重画上（cells 一般 8-16 个，单帧成本极低，但累积也是耗）。
        if (now - this._previewClearLastPaintMs < 33) return;
        this._previewClearLastPaintMs = now;
        this.paintPreviewClearHint();
    }

    /**
     * 待消除高亮 —— 严格复刻 web `renderPreviewClearHint`（under fill + over stroke 二合一）：
     *
     *   pulse = 0.55 + 0.45 * |sin(now * 0.007)|          周期 ~900ms 柔和呼吸
     *   inset = skin.blockInset ?? 2                       直接读皮肤 raw 值（不走 _adaptive）
     *   br    = skin.blockRadius ?? 5                      高亮圆角 = 皮肤方块圆角，视觉与块对齐
     *   size  = cell - inset*2                             高亮覆盖范围 = 块面大小（不是全格）
     *
     *   under (fill)  : rgba(255, 210, 90, 0.12 + 0.18*pulse), globalAlpha = 1
     *   over  (stroke): rgba(255, 200, 60, 0.55 + 0.40*pulse), globalAlpha = 0.92,
     *                   lineWidth = 2.25,
     *                   shadowColor = rgba(255, 220, 120, 0.65), shadowBlur = 5 + 4*pulse
     *
     * cocos Graphics 无 shadowBlur，按"外柔光（宽线 + 低 alpha） + 中柔光 + 锐边"三层叠加
     * 近似 shadowBlur 的高斯渐变。lineWidth/alpha 系数经手感对齐 web 截图。
     */
    private paintPreviewClearHint(): void {
        const g = this._previewClearG;
        if (!g) return;
        g.clear();
        const cells = this._previewClearCells;
        if (!cells?.length || !this._skin) return;
        const skin = this._skin;
        const cell = this.cellSize;
        const half = this.boardPx / 2;
        const inset = skin.blockInset ?? 2;
        const br = skin.blockRadius ?? 5;
        const size = cell - inset * 2;
        if (size <= 0) return;
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(Date.now() * 0.007));

        // 预计算每格 (left, bottom) 本地坐标（cocos y 向上）：
        // web (cell.x*s + inset, cell.y*s + inset) → cocos (-half + x*cell + inset, half - (y+1)*cell + inset)
        const positions: Array<[number, number]> = [];
        for (const c of cells) {
            if (c.x < 0 || c.x >= this._size || c.y < 0 || c.y >= this._size) continue;
            positions.push([-half + c.x * cell + inset, half - (c.y + 1) * cell + inset]);
        }
        if (!positions.length) return;

        // 复用 Color 实例（r/g/b 恒定，仅 alpha 随 pulse 变化）。Graphics.fillColor/strokeColor
        // setter 内部会拷贝值，因此传入复用实例安全，且每帧省去 4 次 new Color 的分配/GC。
        const fill = (this._pcFill ??= new Color(255, 210, 90, 255));
        const glow1 = (this._pcGlow1 ??= new Color(255, 220, 120, 255));
        const glow2 = (this._pcGlow2 ??= new Color(255, 220, 120, 255));
        const edge = (this._pcEdge ??= new Color(255, 200, 60, 255));

        // === Pass 1: under-fill —— 暖黄底色脉冲 rgba(255, 210, 90, 0.12~0.30) ===
        const fillA = Math.round(255 * (0.12 + 0.18 * pulse));
        fill.a = fillA;
        g.fillColor = fill;
        for (const [px, py] of positions) {
            if (br > 0) g.roundRect(px, py, size, size, br);
            else g.rect(px, py, size, size);
            g.fill();
        }

        // === Pass 2-4: over-stroke 三层（外柔光 + 中柔光 + 锐边）模拟 web shadowBlur ===
        // web strokeStyle alpha 0.55~0.95，叠加 globalAlpha=0.92 → 实际 0.51~0.87
        const strokeA = (0.55 + 0.4 * pulse) * 0.92;

        // Pass 2: 外柔光（最宽最淡，模拟 shadowBlur 边缘）—— 用 shadow 颜色 rgba(255,220,120)
        g.lineWidth = 5;
        glow1.a = Math.round(255 * strokeA * 0.18);
        g.strokeColor = glow1;
        for (const [px, py] of positions) {
            if (br > 0) g.roundRect(px + 0.5, py + 0.5, size - 1, size - 1, Math.max(0, br - 0.5));
            else g.rect(px + 0.5, py + 0.5, size - 1, size - 1);
            g.stroke();
        }

        // Pass 3: 中柔光（中等宽度、中等 alpha，模拟 shadowBlur 中段）
        g.lineWidth = 3.25;
        glow2.a = Math.round(255 * strokeA * 0.42);
        g.strokeColor = glow2;
        for (const [px, py] of positions) {
            if (br > 0) g.roundRect(px + 0.5, py + 0.5, size - 1, size - 1, Math.max(0, br - 0.5));
            else g.rect(px + 0.5, py + 0.5, size - 1, size - 1);
            g.stroke();
        }

        // Pass 4: 锐边（与 web lineWidth=2.25 / strokeStyle=rgba(255,200,60,α) 严格一致）
        g.lineWidth = 2.25;
        edge.a = Math.round(255 * strokeA);
        g.strokeColor = edge;
        for (const [px, py] of positions) {
            if (br > 0) g.roundRect(px + 0.5, py + 0.5, size - 1, size - 1, Math.max(0, br - 0.5));
            else g.rect(px + 0.5, py + 0.5, size - 1, size - 1);
            g.stroke();
        }
    }

    get cellSize(): number {
        return this.boardPx / this._size;
    }

    setSkin(skin: Skin): void {
        this._skin = skin;
        // 图片皮肤（水墨雅集等）：预加载方块贴图，加载完成后若仍是当前皮肤则重绘一次。
        // ⚠️ 仅当贴图**尚未就绪**时才注册重绘回调（命中缓存会同步回调→再 render→无限递归，详见
        //   DockView/GameController 同款修复）。已就绪时后续 render 直接用缓存帧即可。
        if (skinHasImageBlocks(skin) && !skinBlockFramesReady(skin)) {
            ensureSkinBlockFrames(skin, () => {
                if (this._skin?.id === skin.id && this._grid && this.node?.isValid) {
                    this.render(this._grid, skin);
                }
            });
        }
    }

    /** 动态调整盘面边长（保持正方形）。由布局层在可见区域/安全区变化时调用。 */
    setBoardPx(px: number): void {
        this.boardPx = px;
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(px, px);
    }

    /** 锚点居中的本地坐标 → 格坐标；越界返回 null */
    localToCell(localX: number, localY: number): { gx: number; gy: number } | null {
        const half = this.boardPx / 2;
        const cell = this.cellSize;
        const gx = Math.floor((localX + half) / cell);
        const gy = Math.floor((half - localY) / cell);
        if (gx < 0 || gx >= this._size || gy < 0 || gy >= this._size) return null;
        return { gx, gy };
    }

    /** 格 (gx,gy) 左下角的本地坐标 */
    cellBottomLeft(gx: number, gy: number): { x: number; y: number } {
        const half = this.boardPx / 2;
        const cell = this.cellSize;
        return { x: -half + gx * cell, y: half - (gy + 1) * cell };
    }

    private blockSprite(i: number): Sprite {
        let s = this._blockSprites[i];
        if (!s) {
            const n = new Node('blk');
            n.parent = this._spriteRoot!;
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            s = n.addComponent(Sprite);
            if (Sprite.SizeMode) s.sizeMode = Sprite.SizeMode.CUSTOM;
            s.spriteFrame = this._blockFrame;
            this._blockSprites[i] = s;
        }
        return s;
    }

    private icon(i: number): Label {
        let l = this._icons[i];
        if (!l) {
            const n = new Node('ic');
            n.parent = this._iconRoot!;
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            l = n.addComponent(Label);
            l.color = new Color(255, 255, 255, 255);
            this._icons[i] = l;
        }
        return l;
    }

    /** 图片皮肤落点 ghost 的贴图节点池（挂在 _ghostRoot 下，半透明）。 */
    private ghostSprite(i: number): Sprite {
        let s = this._ghostSprites[i];
        if (!s) {
            const n = new Node('gblk');
            n.parent = this._ghostRoot!;
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            s = n.addComponent(Sprite);
            if (Sprite.SizeMode) s.sizeMode = Sprite.SizeMode.CUSTOM;
            this._ghostSprites[i] = s;
        }
        return s;
    }

    private hideGhostSprites(from = 0): void {
        for (let i = from; i < this._ghostSprites.length; i++) this._ghostSprites[i].node.active = false;
    }

    /** 隐藏稳态方块贴图池（动画期 hide，让 paintBlockFace 占位接管）。 */
    private hideBlockSprites(from = 0): void {
        for (let i = from; i < this._blockSprites.length; i++) this._blockSprites[i].node.active = false;
    }

    /**
     * 结束动效期为图片皮肤补「整面 PNG」：在 paintBlockFace 底瓷砖之上叠贴图，与 render() 同款
     * （底瓷砖 + 整面贴图）管线，让飞入 / 翻转 / 飞散动效中的方块同样显示皮肤图片
     * （其余皮肤走 emoji 图标）。复用 _blockSprites 池，增量写属性避免每帧大量 GFX 标脏。
     * 不旋转贴图：底瓷砖（Graphics）本就轴对齐绘制，PNG 同步保持轴对齐才不与瓷砖错位。
     * @param spIdx 取池下标 @param cx,cy 面中心（本地坐标） @param faceSize 当前帧该格面尺寸（含缩放）
     * @param imgInsetFrac 贴图相对面的内缩比（与 render 的 blockIconInset 同源） @param a255 透明度 0-255
     * @returns 是否取到贴图（true 时调用方应自增 sprite 计数）
     */
    private paintFlyBlockImage(
        spIdx: number, skin: Skin, colorIdx: number,
        cx: number, cy: number, faceSize: number, imgInsetFrac: number, a255: number,
    ): boolean {
        const sf = getSkinBlockFrame(skin, colorIdx);
        if (!sf) return false;
        const imgPad = imgInsetFrac <= 0 ? 0 : Math.max(1, Math.round(faceSize * imgInsetFrac));
        const imgSize = Math.max(1, faceSize - imgPad * 2);
        const s = this.blockSprite(spIdx);
        if (!s.node.active) s.node.active = true;
        if (s.spriteFrame !== sf) s.spriteFrame = sf;
        const ut = s.node.getComponent(UITransform) || s.node.addComponent(UITransform);
        if (ut.contentSize.width !== imgSize || ut.contentSize.height !== imgSize) ut.setContentSize(imgSize, imgSize);
        const pos = s.node.position;
        if (pos.x !== cx || pos.y !== cy) s.node.setPosition(cx, cy, 0);
        if (s.color.a !== a255) { const c = s.color.clone(); c.a = a255; s.color = c; }
        return true;
    }

    /** 当前皮肤实际生效的 gap（优先 skin.gridGap，缺省 fallback 到 @property `gap`）。 */
    private skinGap(skin: Skin): number {
        return Math.max(0, skin.gridGap ?? this.gap);
    }

    /**
     * 全量重画盘面 —— 与 web/src/renderer.js renderGrid 流程一致：
     *
     *   Step 1 (bg layer)        outer 全屏 + cellEmpty 8×8        → self._bgG
     *   Step 2 (watermark)       浮层 emoji × UIOpacity            → _wmRoot Labels
     *   Step 3 (gridLines)       内部 7+7 网格线                    → _gridLineG
     *   Step 4 (blocks)          paintBlockFace 已放方块            → _blocksG
     *   Step 5 (icons)           方块中心 emoji                     → _iconRoot Labels
     *   Step 6 (clear ghost)     清掉旧 ghost（render() 是状态变更入口） → _ghostG
     *
     * Cocos 节点渲染顺序：父节点先 → 子节点按 sibling index 升序。这里 bg 在 self，
     * 其他都是 self 的子节点，按 onLoad 创建顺序自下而上排好，整组渲染次序与 web 一致。
     *
     * 之前的 bug：bg / cellEmpty / blocks 全画在 self._g，水印/网格线作为子节点反而
     * 渲染在已放方块之上，与 web 「方块覆盖水印/网格线」的视觉相反。
     */
    render(grid: Grid, skin: Skin): void {
        this._size = grid.size;
        this._skin = skin;
        this._grid = grid;
        const bg = this._bgG!;
        const blk = this._blocksG!;
        const cell = this.cellSize;
        const half = this.boardPx / 2;
        const gap = this.skinGap(skin);
        const { inset, radius } = blockMetrics(skin, cell);

        // ─── Step 1: bg layer (outer + cellEmpty) ─────────────────────────────
        bg.clear();
        const premium = isSkinPremiumEnabled();
        const pv = getPremiumVars();

        // 1a-premium. 盘面外框包装（对齐 web `#game-wrapper` 玻璃质感 + 深投影）
        if (premium && pv) {
            const pad = PREMIUM_WRAPPER_PAD_PX;
            const outer = half + pad;
            const wrap = this.boardPx + pad * 2;
            const wr = PREMIUM_WRAPPER_RADIUS_PX;
            bg.fillColor = new Color(0, 0, 0, 48);
            bg.roundRect(-outer + 1, -outer - 4, wrap, wrap, wr);
            bg.fill();
            const mid = -outer + wrap * 0.35;
            bg.fillColor = pv.wrapperBottom;
            bg.roundRect(-outer, -outer, wrap, mid - (-outer) + 1, wr);
            bg.fill();
            bg.fillColor = pv.wrapperTop;
            bg.roundRect(-outer, mid, wrap, -outer + wrap - mid, wr);
            bg.fill();
            bg.lineWidth = 1;
            bg.strokeColor = pv.boardBorder;
            bg.roundRect(-outer + 0.5, -outer + 0.5, wrap - 1, wrap - 1, wr);
            bg.stroke();
            bg.lineWidth = 2;
            bg.strokeColor = pv.boardGlow;
            bg.roundRect(-outer - 2, -outer - 2, wrap + 4, wrap + 4, wr + 2);
            bg.stroke();
        }

        // 1a. outer 圆角铺底（对齐 web `_paintBackgroundUnder`：full-bleed gridOuter + 12px 内圆角）
        const framePad = Math.max(1, gap);
        const boardOuterR = premium ? premiumBoardCornerRadiusPx(this.boardPx) : 10;
        const boardBleed = premium ? PREMIUM_BOARD_BLEED_PX : framePad;
        if (premium) {
            this._drawPremiumFlowBg(bg, half, this.boardPx, boardOuterR, skin);
        }
        bg.fillColor = gridOuterColor(skin);
        bg.roundRect(-half - boardBleed, -half - boardBleed, this.boardPx + boardBleed * 2, this.boardPx + boardBleed * 2, boardOuterR);
        bg.fill();
        // 1b. cellEmpty 8×8 全格（含已放块的格子；块下垫底，消除 inset 黑边）
        //   ⭐ 与 web `_paintBackgroundUnder` 严格一致：格矩形 = `cell - 2*gap`，偏移 `+gap`。
        //     → 相邻格之间留出 `2*gap` 宽的 gridOuter 间隔（深色分割缝）。
        //     旧实现用 `cell - gap` / 偏移 `gap/2` 只留 `gap`(1px) → 间隔只有 web 的一半，
        //     深色皮肤（如 beast：outer #150C04 vs cell #221608）下糊成一片，这是本投诉根因之一。
        const emptyFill = cellEmptyColor(skin);
        const inn = Math.max(1, cell - gap * 2);
        const cellR = premium ? Math.max(2, Math.round((skin.blockRadius ?? 5) * inn / 38)) : 0;
        bg.fillColor = emptyFill;
        for (let gy = 0; gy < grid.size; gy++) {
            for (let gx = 0; gx < grid.size; gx++) {
                const cellX = -half + gx * cell;
                const cellY = half - (gy + 1) * cell;
                const px = cellX + gap;
                const py = cellY + gap;
                if (premium && cellR > 0) {
                    bg.roundRect(px, py, inn, inn, cellR);
                } else {
                    bg.rect(px, py, inn, inn);
                }
                bg.fill();
            }
        }
        if (premium && inn > 4) {
            bg.lineWidth = 0.75;
            bg.strokeColor = new Color(148, 163, 184, 15);
            for (let gy = 0; gy < grid.size; gy++) {
                for (let gx = 0; gx < grid.size; gx++) {
                    const cellX = -half + gx * cell;
                    const cellY = half - (gy + 1) * cell;
                    const px = cellX + gap + 0.5;
                    const py = cellY + gap + 0.5;
                    bg.roundRect(px, py, inn - 1, inn - 1, Math.max(0, cellR - 0.5));
                    bg.stroke();
                }
            }
        }
        if (premium && pv) {
            bg.lineWidth = 1;
            bg.strokeColor = new Color(
                pv.boardBorder.r, pv.boardBorder.g, pv.boardBorder.b,
                Math.round(pv.boardBorder.a * 0.65),
            );
            bg.roundRect(-half + 0.5, -half + 0.5, this.boardPx - 1, this.boardPx - 1, boardOuterR);
            bg.stroke();
            // 玻璃顶部高光带（对齐 web `#game-wrapper::before`）—— 必须画在「盘面外框包装」(wrapper) 上沿，
            // 而非盘面内部。早期 y=-half+boardPx*0.88 → 高光落在盘面**顶行格子上**，把第一行 cellEmpty
            // 整条盖成一抹白底（看截图蓝框：顶行无格分、底色比其余行更浅）。修正为画在 wrapper 顶部
            // 内侧（在 outer 内 +1，跨出盘面 box 上沿 ~pad 像素），bg 层级低于 wm/网格线/方块，不会
            // 干扰盘面内容；高度 = 半个 pad，恰好覆盖外框上沿那条玻璃高光。
            const pad = PREMIUM_WRAPPER_PAD_PX;
            const outerTop = half + pad;
            const hiH = Math.max(4, Math.round(pad * 0.7));
            bg.fillColor = new Color(255, 255, 255, 20);
            bg.roundRect(-half + 1, outerTop - hiH - 1, this.boardPx - 2, hiH, Math.max(2, hiH * 0.6));
            bg.fill();
        }

        // ─── Step 2: watermark ───────────────────────────────────────────────
        this.renderWatermark(skin);

        // ─── Step 3: gridLines（对齐 web `_paintBackgroundOver`：仅内部 7+7）──
        this.renderGridLines(skin);

        // ─── Step 4 + 5: blocks + icons ──────────────────────────────────────
        blk.clear();
        // 图片皮肤（blockIconAssets，如水墨雅集）：整面贴图渲染，跳过绘面 + emoji（与 web 一致）。
        const imgSkin = skinHasImageBlocks(skin);
        const useSprites = !imgSkin && !!this._blockFrame && flag('spriteBlocks') && !premium;
        // 图片皮肤的"面"区域 = cell - inset*2（与 web `paintBlockCell` 的 size 严格一致）；
        // 内部再按 blockIconInset 收一圈作为 PNG 画框边距（水墨雅集 0.03 几乎无可见，但保留对齐）。
        // 关键：sprite 与 overlay 必须用同一 imgSize，否则浮雕描边会与贴图错位。
        const imgInsetFrac = (skin as unknown as { blockIconInset?: number }).blockIconInset ?? 0.18;
        let iconN = 0;
        let spN = 0;
        for (let gy = 0; gy < grid.size; gy++) {
            for (let gx = 0; gx < grid.size; gx++) {
                const v = grid.cells[gy][gx];
                if (v === null) continue;
                const cellX = -half + gx * cell;
                const cellY = half - (gy + 1) * cell;
                const fsize = cell - inset * 2;
                if (imgSkin) {
                    // ⭐ 与 web `paintBlockCell` 同序：先画含描边的 cartoon 底瓷砖（补回方块边框 ——
                    //   web 每格都有 outer/inner 描边，cocos 此前图片皮肤直接铺 PNG 导致"边框缺失"），
                    //   再在面内叠整面 PNG。PNG 未加载完成时仅底瓷砖占位。
                    paintBlockFace(blk, cellX + inset, cellY + inset, fsize, radius, skin, v);
                    const sf = getSkinBlockFrame(skin, v);
                    if (sf) {
                        const imgPad = imgInsetFrac <= 0 ? 0 : Math.max(1, Math.round(fsize * imgInsetFrac));
                        const imgSize = Math.max(1, fsize - imgPad * 2);
                        const s = this.blockSprite(spN++);
                        // ⚡ 增量更新：检测每个属性是否变化才写回，避免 64 格×4 属性=256 次无效 GFX 标记，
                        //   是 iPhone 11 上图片皮肤"释放卡顿"的另一主因（每次 render 大量赃标记触发重排）。
                        if (!s.node.active) s.node.active = true;
                        if (s.spriteFrame !== sf) s.spriteFrame = sf;
                        const ut = s.node.getComponent(UITransform) || s.node.addComponent(UITransform);
                        if (ut.contentSize.width !== imgSize || ut.contentSize.height !== imgSize) {
                            ut.setContentSize(imgSize, imgSize);
                        }
                        const px = cellX + cell / 2, py = cellY + cell / 2;
                        const pos = s.node.position;
                        if (pos.x !== px || pos.y !== py) s.node.setPosition(px, py, 0);
                        // s.color 不写：保持默认 WHITE，避免每帧标脏。
                    }
                    continue;
                }
                if (useSprites) {
                    const s = this.blockSprite(spN++);
                    s.node.active = true;
                    if (s.spriteFrame !== this._blockFrame) s.spriteFrame = this._blockFrame;
                    (s.node.getComponent(UITransform) || s.node.addComponent(UITransform)).setContentSize(fsize, fsize);
                    s.node.setPosition(cellX + cell / 2, cellY + cell / 2, 0);
                    s.color = blockColor(skin, v);
                } else {
                    paintBlockFace(blk, cellX + inset, cellY + inset, fsize, radius, skin, v);
                }
                const em = blockIcon(skin, v);
                const fs = em ? iconFontSize(fsize) : 0;
                if (em && fs > 0) {
                    const l = this.icon(iconN++);
                    l.node.active = true;
                    l.node.setPosition(cellX + cell / 2, cellY + cell / 2, 0);
                    // 稳健版：固定参考字号烘焙 + 节点缩放，与拖拽 ghost 同尺寸同做法，
                    // 规避 iOS「方块放大但 emoji 滞留小字号」（落子后图标变小的根因）。
                    applyIconLabelScaled(l, em, fs);
                }
            }
        }
        for (let i = iconN; i < this._icons.length; i++) this._icons[i].node.active = false;
        for (let i = spN; i < this._blockSprites.length; i++) this._blockSprites[i].node.active = false;

        // ─── Step 4.5: 图片皮肤柔光浮雕叠加（仅 blockBevel.assetOverlay=true 的皮肤） ───
        // 在所有 sprite 之上叠"顶亮 + 底暗 + 双描边"，对齐 web _paintAssetSoftOverlay。
        // 让水墨雅集这类满铺贴图皮肤获得"瓷砖凸起"立体感而非"贴纸平铺"扁平观感。
        // 与 web `_paintIcon` 完全一致：overlay 画在"面"区域（cell - inset*2），不再按
        // blockIconInset 收缩 —— web 中 PNG 在面内 pad、overlay 占整个面（pad 那圈是"画框"留白）。
        const ovG = this._overlayG;
        if (ovG) {
            ovG.clear();
            if (imgSkin && skinHasAssetOverlay(skin)) {
                const ovSize = Math.max(1, cell - inset * 2);
                const ovR = skin.blockRadius ?? 0;
                for (let gy = 0; gy < grid.size; gy++) {
                    for (let gx = 0; gx < grid.size; gx++) {
                        if (grid.cells[gy][gx] === null) continue;
                        const cellX = -half + gx * cell;
                        const cellY = half - (gy + 1) * cell;
                        // overlay 与 sprite 共享中心 = (cellX+cell/2, cellY+cell/2)；
                        // 浮雕左下 = 中心 - ovSize/2，覆盖整个"面"区域。
                        paintAssetOverlay(ovG, skin, cellX + cell / 2 - ovSize / 2, cellY + cell / 2 - ovSize / 2, ovSize, ovR);
                    }
                }
            }
        }

        // ─── Step 6: 清掉旧 ghost ─────────────────────────────────────────────
        // GameController 在状态变更后调 render()；若没紧跟 renderGhost()，旧的 ghost 必须消失。
        // 用独立 _ghostG → 拖拽期间只清/重画此层，blocks 层保持不变，省 60+ 帧的方块重画成本。
        this._ghostG?.clear();
        this.hideGhostSprites();
    }

    /** 精致界面 flow 底色（对齐 web `.game-board-flow-bg`：与盘面同几何 + 12px 圆角，避免四角露出直角包装层）。 */
    private _drawPremiumFlowBg(bg: Graphics, half: number, boardPx: number, outerR: number, skin: Skin): void {
        const bleed = PREMIUM_BOARD_BLEED_PX;
        const x = -half - bleed;
        const y = -half - bleed;
        const w = boardPx + bleed * 2;
        const h = boardPx + bleed * 2;
        const outer = gridOuterColor(skin);
        const empty = cellEmptyColor(skin);
        const accent = getPremiumVars()?.accent ?? new Color(56, 189, 248, 255);
        bg.fillColor = new Color(
            Math.round(outer.r * 0.55 + empty.r * 0.30 + accent.r * 0.15),
            Math.round(outer.g * 0.55 + empty.g * 0.30 + accent.g * 0.15),
            Math.round(outer.b * 0.55 + empty.b * 0.30 + accent.b * 0.15),
            255,
        );
        bg.roundRect(x, y, w, h, outerR);
        bg.fill();
    }

    /**
     * 画网格线（对齐 web `_paintBackgroundOver`）：
     *   - 颜色从 `gridLineColor(skin)` 取（皮肤可显式 false 关闭，可指定 'rgba(...)'）；
     *     缺省深盘 white@0.46、浅盘 ink@0.34 —— 与 web 同值。
     *   - 仅画内部 7 横 7 竖；外边界交给 gridOuter 圆角框。
     *
     * ⚠️ 关键：用 `rect+fill` 而非 `stroke`，并对齐 web 的 `lineWidth = 1`。
     *   web 是 Canvas2D `stroke(1px) @ i*cell+0.5`，crisp 满 alpha；
     *   cocos Graphics 的 `stroke(1)` 在高 DPR 原生屏会把 1px 线 AA 成两行 ~50% 的淡边
     *   → 几乎看不见（「方格糊成一片」的元凶）。改用整数坐标 + 整数宽度的 `rect+fill`：
     *   填充是实心列、满不透明，1px 同样清晰，且数值上忠实复刻 web 的 1px（随格子尺寸到
     *   2px 仅在超大格出现，与 web 在高分屏上的视觉一致）。
     */
    private renderGridLines(skin: Skin): void {
        const lg = this._gridLineG;
        if (!lg) return;
        lg.clear();
        // 精致模式：盘面已用「圆角玻璃空格 + 柔描边」表达格位（对齐 web premium 玻璃盘），
        // 此处的满盘 7+7 硬网格线（深盘 white@0.46）会把每块「框」起来 → 方块割裂、与盘面脱节。
        // web premium 不画这层硬线，故 cocos 同步跳过，让方块融入暖色玻璃盘面。
        if (isSkinPremiumEnabled()) return;
        const lineColor = gridLineColor(skin);
        if (!lineColor) return;
        const cell = this.cellSize;
        const half = this.boardPx / 2;
        const size = this._size;
        // 对齐 web `_paintBackgroundOver` 的 lineWidth=1（× skin.gridLineWidth）：常规格→1px；浅线皮肤可加倍。
        const lineMul = skin.gridLineWidth ?? 1;
        const lw = Math.max(1, Math.round(Math.max(1, Math.round(cell * 0.025)) * lineMul));
        const halfLw = lw / 2;

        lg.fillColor = lineColor;
        for (let i = 1; i < size; i++) {
            const x = Math.round(-half + i * cell);
            lg.rect(x - halfLw, -half, lw, this.boardPx);
            lg.fill();
        }
        for (let j = 1; j < size; j++) {
            const y = Math.round(-half + j * cell);
            lg.rect(-half, y - halfLw, this.boardPx, lw);
            lg.fill();
        }
    }

    /** 盘面水印（对齐 web `_renderBoardWatermark`）：5 锚点低透明度浮层 emoji，随皮肤切换。 */
    private renderWatermark(skin: Skin): void {
        const wm = getWatermark(skin.id);
        const root = this._wmRoot;
        if (!root) return;
        if (!wm || !wm.icons.length) {
            for (const l of this._wm) l.node.active = false;
            this._wmActiveCount = 0;
            this._wmDrift = null;
            return;
        }
        // 高密度池（hdIcons）：每次 setSkin 从池中随机抽 5 个塞到 5 锚点；池里少于 5 个就用 icons 兜底。
        // 缓存到 `wm.icons` 临时覆盖：本帧及后续帧的 `wm.icons[i % len]` 会读到这 5 个 emoji。
        // 这与 web `_renderBoardWatermark` 的 hdIcons 取样逻辑一致：每局视觉小变化，但保持主题统一。
        const sourceIcons = (wm.hdIcons && wm.hdIcons.length >= WM_ANCHORS.length)
            ? pickRandomDistinct(wm.hdIcons, WM_ANCHORS.length)
            : wm.icons;
        const board = this.boardPx;
        const half = board / 2;
        // 严格对齐 web `_renderBoardWatermark` 的尺寸公式：sz = min(W,H) × scale，fontPx = sz × 0.88，
        // scale 缺省 0.24。这样 scale 的语义与 web 一致（如 pixel8=0.72 渲染为大字背景）。
        const fs = Math.round(board * (wm.scale ?? 0.24) * 0.88);
        // 漂移进行中（非减少动效 + 已建滑动窗口）：保留 icon 当前漂移位置，不复位回锚点，
        // 避免每次 render()（落子/换肤）把 icon 弹回锚点造成 1 帧跳动。
        const driftActive = !Motion.reduced && VisualFx.enabled && !!this._wmDrift;
        // 水印透明度——历史上为了让 emoji 在不透明盘面上"看得见"做过 ×2 提亮（旧上限 64/255≈25%），
        // 但实测体感是干扰视觉、与 ghost 落点预览混淆。改为忠实还原 web 配置值（0.055~0.12 → 14~31/255）
        // 并把上限压到 28/255≈11%、下限保留 6/255 防止某些皮肤几乎不可见。
        // 调参建议：若仍嫌强烈，把上限继续降到 ~20；若觉得太隐形，把上限放回 40~48。
        if (this._wmOp) this._wmOp.opacity = Math.max(6, Math.min(28, Math.round(255 * wm.opacity)));
        WM_ANCHORS.forEach((a, i) => {
            let l = this._wm[i];
            const fresh = !l;
            if (!l) {
                const n = new Node('wm');
                n.parent = root;
                n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
                l = n.addComponent(Label);
                l.color = new Color(255, 255, 255, 255);
                this._wm[i] = l;
            }
            l.node.active = true;
            // 仅新建或未漂移时复位到锚点；漂移中保持当前位置（由 updateWatermarkDrift 驱动）。
            if (fresh || !driftActive) {
                l.node.setPosition(-half + a[0] * board, half - a[1] * board, 0);
            }
            l.fontSize = fs;
            l.lineHeight = fs;
            l.string = sourceIcons[i % sourceIcons.length];
        });
        for (let i = WM_ANCHORS.length; i < this._wm.length; i++) this._wm[i].node.active = false;
        this._wmActiveCount = WM_ANCHORS.length;
    }

    /** 水印漂移随机 target（logical 空间，软 clamp 允许擦边）。对齐 web `_randomWatermarkTarget`。 */
    private randWmTarget(base: number[], span: number): [number, number] {
        const board = this.boardPx;
        const amp = Math.max(20, span * (WM_AMP_BASE + Math.random() * WM_AMP_RAND));
        const tx = base[0] + (Math.random() * 2 - 1) * amp;
        const ty = base[1] + (Math.random() * 2 - 1) * amp;
        return [
            Math.max(board * WM_TARGET_MIN, Math.min(board * WM_TARGET_MAX, tx)),
            Math.max(board * WM_TARGET_MIN, Math.min(board * WM_TARGET_MAX, ty)),
        ];
    }

    private randWmSegMs(): number {
        return WM_SEGMENT_MIN_MS + Math.random() * (WM_SEGMENT_MAX_MS - WM_SEGMENT_MIN_MS);
    }

    /**
     * 每帧推进水印漂移（对齐 web `_watermarkPointsForFrame`）：
     *   - Catmull-Rom 滑动窗口，段末 shift waypoint 并补一个新随机 target；
     *   - 位置 = wall-time 的解析函数，帧率抖动只影响取样时刻、不影响轨迹；
     *   - Motion.reduced 时保持静态锚点（不漂移）。
     */
    private updateWatermarkDrift(): void {
        if (Motion.reduced || !VisualFx.enabled) return;
        const count = this._wmActiveCount;
        if (count <= 0) return;
        const board = this.boardPx;
        const half = board / 2;
        const span = board;
        const now = Date.now();
        const key = `${Math.round(board)}:${count}`;

        const basePts: number[][] = [];
        for (let i = 0; i < count; i++) {
            const a = WM_ANCHORS[i % WM_ANCHORS.length];
            basePts.push([a[0] * board, a[1] * board]);
        }

        let drift = this._wmDrift;
        if (!drift || drift.key !== key || drift.waypoints.length !== count) {
            // 初始 waypoints = [base, base, target1, target2]：首帧位置 = 锚点，无跳变；
            // p0=base 让起点切线 = (target1-base)/2 平滑起步。盘面尺寸/数量变化才重建。
            drift = {
                key,
                waypoints: basePts.map((p) => [
                    [p[0], p[1]], [p[0], p[1]],
                    this.randWmTarget(p, span), this.randWmTarget(p, span),
                ]),
                startTs: basePts.map(() => now),
                durationMs: basePts.map(() => this.randWmSegMs()),
            };
            this._wmDrift = drift;
            return;
        }

        for (let i = 0; i < count; i++) {
            const dur = drift.durationMs[i] || WM_SEGMENT_MAX_MS;
            if (now - (drift.startTs[i] || now) >= dur) {
                const w = drift.waypoints[i];
                w.shift();
                w.push(this.randWmTarget(basePts[i], span));
                drift.startTs[i] = now;
                drift.durationMs[i] = this.randWmSegMs();
            }
            const ts = (now - drift.startTs[i]) / drift.durationMs[i];
            const t = ts < 0 ? 0 : ts > 1 ? 1 : ts;
            const w = drift.waypoints[i];
            const lx = catmullRom(w[0][0], w[1][0], w[2][0], w[3][0], t);
            const ly = catmullRom(w[0][1], w[1][1], w[2][1], w[3][1], t);
            const lab = this._wm[i];
            if (lab && lab.node.active) lab.node.setPosition(lx - half, half - ly, 0);
        }
    }

    /**
     * 高亮预览（ghost 落点）：用与盘面方块一致的 `paintBlockFace` 渲染并半透明叠加，
     * 与 web `renderPreview` 的 `globalAlpha=0.5` + 同款 paintBlockCell 路径对齐，
     * 避免预览出现"扁平色块 vs 立体面"的视觉撕裂。
     *
     * 画在独立的 Layer 6 (_ghostG) 上 → 拖拽期间只清/重画 ghost 层，blocks 不动，
     * 60+ Hz 拖拽帧不再为「重画 64 个已放方块」付钱。
     */
    /** 仅清空 Layer 6 ghost（不动 blocks/bg/grid）。用于提示脉冲收尾等「盘面未变、只需移除 ghost」场景。 */
    clearGhost(): void {
        this._ghostG?.clear();
    }

    renderGhost(grid: Grid, skin: Skin, shape: number[][], gx: number, gy: number, colorIdx: number, alpha = 140): void {
        const g = this._ghostG!;
        const cell = this.cellSize;
        const half = this.boardPx / 2;
        g.clear();
        // v1.71 简化：ghost 一律 Graphics 绘面（不论图片皮肤 / 普通皮肤）—— 与其他 25+ 皮肤同款节奏。
        // 之前图片皮肤走 sprite 池在拖拽 60Hz 重新 setPosition/setContentSize 几十个节点导致卡顿；
        // 半透明 (alpha=140 ≈ 0.5) 的预览本就抽象，blockColors 兜底色完全够用，与 web 视觉差异极小。
        this.hideGhostSprites();
        drawShapeFaces(g, skin, {
            shape,
            colorIdx,
            cell,
            // ghost 的 (0,0) 对应盘面 (gx, gy)：换算回本地坐标后即（左边距 + gx*cell, 半高 - gy*cell）。
            left: -half + gx * cell,
            top: half - gy * cell,
            alpha,
            skipCell: (x, y) => {
                const cx = gx + x;
                const cy = gy + y;
                return cx < 0 || cx >= grid.size || cy < 0 || cy >= grid.size;
            },
        });
    }

    /**
     * 方块涌入特效（v5）：起始方向随机（从上到下 / 从下到上 / 从左到右 / 从右到左），
     * 沿该方向逐行（或逐列）从盘面外飞入空格。落满后接 _rowFlipWave 行/列翻转波。约 4s。
     * @param colorCount 皮肤色板数量（随机索引上限）
     * @param onLand 每个方块落地时调用
     */
    floodFill(grid: Grid, skin: Skin, colorCount: number, onLand?: (gx: number, gy: number, colorIdx: number) => void, onRowLand?: () => void, onFlipRow?: () => void, onAllLand?: () => void): Promise<void> {
        const n = grid.size;
        const cell = this.cellSize;
        const half = this.boardPx / 2;
        const { inset, radius } = blockMetrics(skin, cell);
        const fsize = cell - inset * 2;
        // ⭐ 图片皮肤(水墨雅集)动画策略简化：动画期间完全走 Graphics 绘面 + emoji 占位
        // （与其他 25+ 皮肤同款节奏），不再创建/位移逐帧 sprite —— 这是 inkGarden 卡顿/形状错乱
        // 的根因之一（每帧 60Hz 重设几十个 Sprite 节点的 spriteFrame/contentSize/position）。
        // 动画收尾 render() 时再恢复 sprite + overlay。
        const imgSkin = skinHasImageBlocks(skin);
        // 动画期叠整面 PNG（与 render 同款）：仅清浮雕 overlay（位置态，动画中会错位），
        // 方块贴图改由本动画逐帧驱动（paintFlyBlockImage），不再整体 hide。
        const imgInsetFrac = (skin as unknown as { blockIconInset?: number }).blockIconInset ?? 0.18;
        if (imgSkin) this._overlayG?.clear();
        interface FlyCell { gx: number; gy: number; colorIdx: number; jit: number; jit2: number }
        interface RowData { cells: FlyCell[]; offset: number; startTime: number; done: boolean }

        // 起始方向随机：up=从下到上 / down=从上到下 / right=从左到右 / left=从右到左
        const fillDir = (['up', 'down', 'right', 'left'] as const)[Math.floor(Math.random() * 4)];
        const fillVertical = fillDir === 'up' || fillDir === 'down';
        const fillLines: number[] = [];
        for (let i = 0; i < n; i++) fillLines.push(i);
        if (fillDir === 'up' || fillDir === 'left') fillLines.reverse();

        const rows: RowData[] = [];
        for (const line of fillLines) {
            const cells: FlyCell[] = [];
            for (let k = 0; k < n; k++) {
                const gx = fillVertical ? k : line;
                const gy = fillVertical ? line : k;
                if (grid.cells[gy][gx] === null) {
                    cells.push({ gx, gy, colorIdx: Math.floor(Math.random() * colorCount), jit: Math.random(), jit2: Math.random() });
                }
            }
            if (cells.length) {
                // 距入场边的格距 + 4（越远飞行越久）
                let dist: number;
                if (fillDir === 'up') dist = n - 1 - line;
                else if (fillDir === 'down') dist = line;
                else if (fillDir === 'right') dist = line;
                else dist = n - 1 - line;
                rows.push({ cells, offset: dist + 4, startTime: 0, done: false });
            }
        }
        if (!rows.length) {
            onAllLand?.();
            return new Promise<void>((resolve) => {
                this._rowFlipWave(grid, skin, colorCount, onLand, onFlipRow, resolve);
            });
        }

        const SLIDE_MS = 500;
        const ROW_DELAY = Math.min(140, 3000 / Math.max(rows.length, 1));

        const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);
        const flyG = this._blocksG!;
        const fs = iconFontSize(fsize);

        const raf = (typeof requestAnimationFrame === 'function')
            ? requestAnimationFrame
            : (cb: () => void) => setTimeout(cb, 16);

        return new Promise<void>((resolve) => {
            const startTime = Date.now();
            let rowIdx = 0;
            let lastRowTime = startTime;
            let doneCount = 0;

            const tick = () => {
                if (!flyG?.node?.isValid) { resolve(); return; }
                const now = Date.now();

                if (rowIdx < rows.length && now - lastRowTime >= ROW_DELAY) {
                    const row = rows[rowIdx];
                    row.startTime = now;
                    rowIdx++;
                    lastRowTime = now;
                }

                for (let ri = 0; ri < rowIdx; ri++) {
                    const row = rows[ri];
                    if (row.done) continue;
                    const t = (now - row.startTime) / SLIDE_MS;
                    if (t >= 1 && !row.done) {
                        row.done = true;
                        doneCount++;
                        for (const c of row.cells) {
                            grid.cells[c.gy][c.gx] = c.colorIdx;
                            onLand?.(c.gx, c.gy, c.colorIdx);
                        }
                        onRowLand?.();
                    }
                }

                flyG.clear();

                let iconN = 0;
                let spN = 0;
                for (let ri = 0; ri < rowIdx; ri++) {
                    const row = rows[ri];
                    if (row.done) continue;
                    const remaining = 1 - easeOutCubic((now - row.startTime) / SLIDE_MS);
                    const slide = row.offset * remaining * cell;
                    let dx = 0;
                    let dy = 0;
                    if (fillDir === 'up') dy = -slide;
                    else if (fillDir === 'down') dy = slide;
                    else if (fillDir === 'right') dx = -slide;
                    else dx = slide;
                    for (const c of row.cells) {
                        // 与 web 严格一致：每格独立抖动 + 风吹飘动 + rotate + scale 扭曲，随 remaining 衰减归零。
                        const jLag = c.jit * cell * 2.2 * remaining;
                        const jPerp = (c.jit2 - 0.5) * cell * 1.4 * remaining;
                        const phase = now * 0.011 + (c.gx + c.gy) * 0.8 + c.jit2 * 6.283;
                        const sway = cell * (0.5 + 0.8 * c.jit) * remaining * Math.sin(phase);
                        let sdx = dx;
                        let sdy = dy;
                        if (fillDir === 'up') sdy -= jLag;
                        else if (fillDir === 'down') sdy += jLag;
                        else if (fillDir === 'right') sdx -= jLag;
                        else sdx += jLag;
                        if (fillVertical) sdx += sway + jPerp; else sdy += sway + jPerp;

                        // web: rotate(rot) + scale(sx, sy) → Cocos 数学等效
                        const rot = (0.14 + 0.18 * c.jit) * remaining * Math.sin(phase + 0.6);
                        const sAlong = 1 + (0.14 + 0.18 * c.jit) * remaining;
                        const sPerp2 = 1 - 0.12 * remaining;
                        const sx = fillVertical ? sPerp2 : sAlong;
                        const sy = fillVertical ? sAlong : sPerp2;
                        const cosR = Math.cos(rot);
                        const sinR = Math.sin(rot);
                        // 方块相对原位中心偏移
                        const ox = sdx;
                        const oy = sdy;
                        // 变换后的中心（translate → rotate → scale 的等效坐标偏移）
                        const faceCx = -half + c.gx * cell + cell / 2 + (cosR * ox * sx - sinR * oy * sy);
                        const faceCy = half - (c.gy + 1) * cell + cell / 2 + (sinR * ox * sx + cosR * oy * sy);
                        const sz = fsize * Math.min(sx, sy);
                        paintBlockFace(flyG, faceCx - sz / 2, faceCy - sz / 2, sz, radius, skin, c.colorIdx);
                        if (imgSkin) {
                            // 图片皮肤：在底瓷砖上叠整面 PNG（与 render 一致），跟随飞行变换。
                            if (this.paintFlyBlockImage(spN, skin, c.colorIdx, faceCx, faceCy, sz, imgInsetFrac, 255)) spN++;
                        } else {
                            const em = blockIcon(skin, c.colorIdx);
                            if (em && fs > 0) {
                                const l = this.icon(iconN++);
                                l.node.active = true;
                                applyIconLabelScaled(l, em, fs);
                                l.node.setPosition(faceCx, faceCy, 0);
                            }
                        }
                    }
                }

                // Static blocks (already landed) — draw faces + icons
                for (let gy2 = 0; gy2 < n; gy2++) {
                    for (let gx = 0; gx < n; gx++) {
                        const v = grid.cells[gy2][gx];
                        if (v === null) continue;
                        const scx = -half + gx * cell + cell / 2;
                        const scy = half - (gy2 + 1) * cell + cell / 2;
                        paintBlockFace(flyG, -half + gx * cell + inset, half - (gy2 + 1) * cell + inset, fsize, radius, skin, v);
                        if (imgSkin) {
                            if (this.paintFlyBlockImage(spN, skin, v, scx, scy, fsize, imgInsetFrac, 255)) spN++;
                        } else {
                            const em = blockIcon(skin, v);
                            if (em && fs > 0) {
                                const l = this.icon(iconN++);
                                l.node.active = true;
                                applyIconLabelScaled(l, em, fs);
                                l.node.setPosition(scx, scy, 0);
                            }
                        }
                    }
                }
                for (let i = iconN; i < this._icons.length; i++) this._icons[i].node.active = false;
                for (let i = spN; i < this._blockSprites.length; i++) this._blockSprites[i].node.active = false;

                const allDone = rowIdx >= rows.length && doneCount >= rows.length;
                if (!allDone) {
                    raf(tick);
                } else {
                    this.render(grid, skin);
                    onAllLand?.();
                    this._rowFlipWave(grid, skin, colorCount, onLand, onFlipRow, resolve);
                }
            };
            raf(tick);
        });
    }

    private _rowFlipWave(grid: Grid, skin: Skin, colorCount: number, onLand: ((gx: number, gy: number, colorIdx: number) => void) | undefined, onFlipRow: (() => void) | undefined, resolve: () => void): void {
        const n = grid.size;
        const cell = this.cellSize;
        const half = this.boardPx / 2;
        const { inset, radius } = blockMetrics(skin, cell);
        const fsize = cell - inset * 2;
        const fs = iconFontSize(fsize);
        const imgSkin = skinHasImageBlocks(skin);
        const imgInsetFrac = (skin as unknown as { blockIconInset?: number }).blockIconInset ?? 0.18;
        // 翻转波期间浮雕保持原位会错位 → 清掉浮雕；方块贴图改逐帧跟随翻转缩放（paintFlyBlockImage）。
        if (imgSkin) this._overlayG?.clear();
        const TOTAL_MS = 2000;
        const FLIP_MS = 300;
        const STAGGER = Math.min(180, (TOTAL_MS - FLIP_MS) / Math.max(n - 1, 1));
        const startTime = Date.now();
        const flyG = this._blocksG!;

        // 翻转方向随机：down=下翻 / up=上翻（绕水平轴，scaleY）；right=右翻 / left=左翻（绕竖直轴，scaleX）
        const flipDir = (['down', 'up', 'right', 'left'] as const)[Math.floor(Math.random() * 4)];
        const flipVertical = flipDir === 'down' || flipDir === 'up';
        const orderPos = (lineIdx: number): number => {
            if (flipDir === 'down' || flipDir === 'right') return lineIdx;
            return n - 1 - lineIdx;
        };

        const newColors: (number | null)[][] = [];
        for (let gy = 0; gy < n; gy++) {
            const row: (number | null)[] = [];
            for (let gx = 0; gx < n; gx++) {
                const cur = grid.cells[gy][gx];
                if (cur === null) { row.push(null); continue; }
                let nc: number;
                do { nc = Math.floor(Math.random() * colorCount); } while (nc === cur && colorCount > 1);
                row.push(nc);
            }
            newColors.push(row);
        }
        const committed = new Array(n).fill(false);
        const raf2 = (typeof requestAnimationFrame === 'function')
            ? requestAnimationFrame
            : (cb: () => void) => setTimeout(cb, 16);

        const flipTick = () => {
            if (!flyG?.node?.isValid) { resolve(); return; }
            const elapsed = Date.now() - startTime;
            flyG.clear();

            let iconN = 0;
            let spN = 0;
            for (let lineIdx = 0; lineIdx < n; lineIdx++) {
                const k = orderPos(lineIdx);
                const t = Math.max(0, Math.min(1, (elapsed - k * STAGGER) / FLIP_MS));

                if (t >= 1 && !committed[lineIdx]) {
                    committed[lineIdx] = true;
                    for (let m = 0; m < n; m++) {
                        const gx = flipVertical ? m : lineIdx;
                        const gy = flipVertical ? lineIdx : m;
                        if (newColors[gy][gx] !== null) {
                            grid.cells[gy][gx] = newColors[gy][gx]!;
                            onLand?.(gx, gy, newColors[gy][gx]!);
                        }
                    }
                    onFlipRow?.();
                }

                const scale = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2;
                const sizeScaled = Math.max(1, fsize * scale);

                for (let m = 0; m < n; m++) {
                    const gx = flipVertical ? m : lineIdx;
                    const gy = flipVertical ? lineIdx : m;
                    const v = grid.cells[gy][gx];
                    if (v === null) continue;

                    let baseX: number;
                    let baseY: number;
                    let iconX: number;
                    let iconY: number;
                    if (flipVertical) {
                        const rowCenterY = half - (gy + 0.5) * cell;
                        baseX = -half + gx * cell + inset;
                        baseY = rowCenterY - sizeScaled / 2;
                        iconX = -half + gx * cell + cell / 2;
                        iconY = rowCenterY;
                    } else {
                        const colCenterX = -half + (gx + 0.5) * cell;
                        baseX = colCenterX - sizeScaled / 2;
                        baseY = half - (gy + 1) * cell + inset;
                        iconX = colCenterX;
                        iconY = half - (gy + 0.5) * cell;
                    }
                    paintBlockFace(flyG, baseX, baseY, sizeScaled, Math.max(0, radius * scale), skin, v);
                    if (imgSkin) {
                        // 翻转缩放：PNG 取与底瓷砖同心同尺寸（sizeScaled 为方），随翻转一起被压扁/复原。
                        if (this.paintFlyBlockImage(spN, skin, v, baseX + sizeScaled / 2, baseY + sizeScaled / 2, sizeScaled, imgInsetFrac, 255)) spN++;
                    } else {
                        const em = blockIcon(skin, v);
                        if (em && fs > 0) {
                            const l = this.icon(iconN++);
                            l.node.active = true;
                            applyIconLabelScaled(l, em, Math.max(1, fs * scale));
                            l.node.setPosition(iconX, iconY, 0);
                        }
                    }
                }
            }
            for (let i = iconN; i < this._icons.length; i++) this._icons[i].node.active = false;
            for (let i = spN; i < this._blockSprites.length; i++) this._blockSprites[i].node.active = false;

            const allFlipped = elapsed >= (n - 1) * STAGGER + FLIP_MS;
            if (!allFlipped) {
                raf2(flipTick);
            } else {
                this.render(grid, skin);
                this._boardFlyOut(grid, skin, resolve);
            }
        };
        raf2(flipTick);
    }

    /**
     * 竹简飞散（收尾）：翻转完成后整盘以「竹帘脱钩坠落」方式飞出 ——
     * 每列当作一条竹简，逐列错峰释放，绕顶端钟摆摇摆（曲线变形），越靠下摆幅越大，
     * 整体受重力加速下坠 + 远端透视压缩（正方形近似）+ 渐隐，结束后盘面清空。
     * 注：Cocos Graphics 无法对已绘制块做仿射旋转，故曲线主要由钟摆位置体现。
     */
    private _boardFlyOut(grid: Grid, skin: Skin, resolve: () => void): void {
        const n = grid.size;
        const cell = this.cellSize;
        const half = this.boardPx / 2;
        const { inset, radius } = blockMetrics(skin, cell);
        const fsize = cell - inset * 2;
        const fs = iconFontSize(fsize);
        const imgSkin = skinHasImageBlocks(skin);
        const imgInsetFrac = (skin as unknown as { blockIconInset?: number }).blockIconInset ?? 0.18;
        // 飞散期间不画浮雕（避免与飞行贴图错位）；方块贴图改逐帧跟随飞散位置+淡出（paintFlyBlockImage）。
        if (imgSkin) this._overlayG?.clear();
        const flyG = this._blocksG!;
        const FLYOUT_MS = 1600;
        const boardPx = this.boardPx;
        const N = Math.max(n - 1, 1);
        const start = Date.now();
        const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
        const raf3 = (typeof requestAnimationFrame === 'function')
            ? requestAnimationFrame
            : (cb: () => void) => setTimeout(cb, 16);

        // 每格独立随机种子 → 脱钩时刻/下坠速度/淡出时机各异，飞散错落有致（飞出无需收敛）
        const jitA: number[][] = [];
        const jitB: number[][] = [];
        for (let gy = 0; gy < n; gy++) {
            const ra: number[] = [];
            const rb: number[] = [];
            for (let gx = 0; gx < n; gx++) { ra.push(Math.random()); rb.push(Math.random()); }
            jitA.push(ra); jitB.push(rb);
        }

        const tick = () => {
            if (!flyG?.node?.isValid) { resolve(); return; }
            const t = clamp01((Date.now() - start) / FLYOUT_MS);
            flyG.clear();

            let iconN = 0;
            let spN = 0;
            for (let gx = 0; gx < n; gx++) {
                const colNorm = gx / N;
                const lt = clamp01((t - colNorm * 0.22) / 0.78);
                const ang = 0.5 * Math.sin(lt * Math.PI * 1.6 + colNorm * Math.PI) * (0.35 + 0.65 * lt);
                const driftX = cell * 1.4 * Math.sin(colNorm * Math.PI * 2 - t * 3) * lt;
                const sinA = Math.sin(ang);
                const cosA = Math.cos(ang);
                const pivotX = -half + gx * cell + cell / 2;

                // 与 web 严格一致：sX 横向缩窄
                const sX = Math.max(0.3, 1 - 0.3 * lt);

                for (let gy = 0; gy < n; gy++) {
                    const v = grid.cells[gy][gx];
                    if (v === null) continue;
                    const jA = jitA[gy][gx];
                    const jB = jitB[gy][gx];
                    const rowNorm = gy / N;
                    const len = gy * cell + cell / 2;
                    // 每格独立脱钩时刻 → 同列方块参差散开
                    const ltc = clamp01((t - colNorm * 0.22 - jA * 0.14) / 0.78);
                    const lttc = ltc * ltc;
                    // 重力拉伸 + 每格速度差异
                    const grav = (1 + 1.4 * lttc * rowNorm) * (0.85 + 0.3 * jB);
                    // 风吹飘扬：横向行波 + 每格相位扰动
                    const wave = cell * 1.7 * Math.sin(rowNorm * 4.5 - t * 11 + colNorm * 1.2 + jB * 3) * (0.15 + 0.85 * rowNorm) * ltc;
                    // 重力加速下坠（二次 + 三次项）+ 每格速度差异
                    const dropY = boardPx * (3.4 * lttc + 1.8 * ltc * lttc) * (0.8 + 0.4 * jA);

                    const sY = Math.max(0.2, 1 - 0.7 * ltc * rowNorm);
                    // 与 web 一致的位置计算（Cocos y 上为正，dropY 向下故取负）
                    const fcx = pivotX + driftX - len * sinA + wave;
                    const fcy = (half - dropY) - len * cosA * grav;
                    const sz = Math.max(2, fsize * Math.min(sX, sY));
                    // 每格淡出时机错开
                    const alpha = clamp01(1 - (ltc - (0.5 + jB * 0.2)) / 0.4);
                    if (alpha <= 0.02) continue;
                    const a255 = Math.round(alpha * 255);

                    paintBlockFace(flyG, fcx - sz / 2, fcy - sz / 2, sz, Math.max(0, radius * Math.min(sX, sY)), skin, v, a255);
                    if (imgSkin) {
                        // 飞散：PNG 跟随飞行中心 + 缩窄尺寸 + 同步淡出 alpha。
                        if (this.paintFlyBlockImage(spN, skin, v, fcx, fcy, sz, imgInsetFrac, a255)) spN++;
                    } else {
                        const em = blockIcon(skin, v);
                        if (em && fs > 0 && alpha > 0.35) {
                            const l = this.icon(iconN++);
                            l.node.active = true;
                            applyIconLabelScaled(l, em, Math.max(1, fs * Math.min(sX, sY)));
                            l.node.setPosition(fcx, fcy, 0);
                        }
                    }
                }
            }
            for (let i = iconN; i < this._icons.length; i++) this._icons[i].node.active = false;
            for (let i = spN; i < this._blockSprites.length; i++) this._blockSprites[i].node.active = false;

            if (t < 1) {
                raf3(tick);
            } else {
                flyG.clear();
                for (let i = 0; i < this._icons.length; i++) this._icons[i].node.active = false;
                // 盘面清空：贴图池也复位（alpha 复位为不透明，下一局 render 直接复用不残留半透明）。
                for (let i = 0; i < this._blockSprites.length; i++) {
                    const s = this._blockSprites[i];
                    s.node.active = false;
                    if (s.color.a !== 255) { const c = s.color.clone(); c.a = 255; s.color = c; }
                }
                resolve();
            }
        };
        raf3(tick);
    }
}
