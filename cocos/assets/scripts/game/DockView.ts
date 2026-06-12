import { _decorator, Component, Graphics, UITransform, Node, Label, Color, sys } from 'cc';
import { DockBlock, Skin } from '../core';
import { drawShapeFaces, ICON_FONT_FAMILY } from './skin/blockPaint';
import { inheritLayer, screenToLocal } from './ui/uiKit';

const { ccclass, property } = _decorator;

/** 与 web CONFIG.DOCK_PREVIEW_MAX_CELLS 一致：每槽 5×5 预览画布。 */
const DOCK_PREVIEW_MAX_CELLS = 5;

/**
 * 候选区渲染：3 个等宽 slot，块在 slot 内居中按 cell 绘制（立体面 + emoji，与盘面一致）。
 *
 * 激活方式对齐 web `populateDockUI` + `_dockPointerHitsBlockShape`：
 * - 每槽独立 5×cell 方形触控区（等同 web 每块 canvas）
 * - 仅 shape 实体格命中才触发起手（槽内留白/块间空隙不激活）
 */
@ccclass('DockView')
export class DockView extends Component {
    @property
    dockWidth = 480;

    @property
    dockHeight = 110;

    @property
    cell = 26;

    private _g: Graphics | null = null;
    private _blocks: DockBlock[] = [];
    private _skin: Skin | null = null;
    private _iconRoot: Node | null = null;
    private _icons: Label[] = [];
    /** 与 web `.dock-block canvas` 等价的每槽触控节点（5×cell 方形）。 */
    /** 每槽 5×cell 命中参照节点（仅用于 pickBlock 坐标换算，不注册节点级触摸，避免 iOS 断触）。 */
    private _pickNodes: Node[] = [];
    /** 正在拖拽的槽位（对齐 web dock canvas opacity:0.3）。 */
    private _draggingSlot = -1;
    /**
     * 拖拽过程中指尖是否回到了 dock 区域。true 时该槽位以半透明形式画回去，作为"松手放回原位"的视觉提示；
     * false 时槽位完全空——此为默认态，候选块完全在指尖（ghost）上。
     */
    private _hoverBackOverDock = false;
    /**
     * 本次拖拽中指尖是否已经离开过 dock 区域至少一次。
     * 必要性：激活那一刻手指自然就在 dock 区域内（点击 dock 候选才触发），
     * 如果不加这个门，hover-back 会立刻 true，dock 仍画半透明候选 → 看起来"激活后 dock 还在画两个"。
     * 只有当手指明确"先离开 dock 然后又回来"，才把这是判定为"想取消放回"。
     */
    private _hasLeftDockOnce = false;

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.dockWidth, this.dockHeight);
        uit.setAnchorPoint(0.5, 0.5);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        this._iconRoot = new Node('icons');
        this._iconRoot.parent = this.node;
        inheritLayer(this._iconRoot, this.node);
        this._iconRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        // 图标层应位于 Graphics 之上，避免被立体面盖住。
        this._iconRoot.setSiblingIndex(9999);
        this.layoutPickNodes();
    }

    /** web 每槽 canvas 边长 = 5 × cell。 */
    get slotPx(): number {
        return DOCK_PREVIEW_MAX_CELLS * this.cell;
    }

    get slotWidth(): number {
        return this.dockWidth / 3;
    }

    /** slot 中心的本地 x */
    slotCenterX(index: number): number {
        return -this.dockWidth / 2 + this.slotWidth * (index + 0.5);
    }

    /**
     * 激活拖拽：候选块从 dock 槽腾空（默认不再绘制原槽）。
     * `_hoverBackOverDock=true` 时切换为"半透明回放可见"，提示玩家"松手即取消放回此处"——
     * 触发条件由 GameController 在 updateSnap 时根据指尖坐标动态切换 setHoverBackOverDock(true/false)。
     */
    setDraggingSlot(index: number): void {
        if (this._draggingSlot === index) return;
        this._draggingSlot = index;
        this._hoverBackOverDock = false;
        this._hasLeftDockOnce = false;
        if (this._skin) this.render(this._blocks, this._skin);
    }

    clearDraggingSlot(): void {
        if (this._draggingSlot < 0) return;
        this._draggingSlot = -1;
        this._hoverBackOverDock = false;
        this._hasLeftDockOnce = false;
        if (this._skin) this.render(this._blocks, this._skin);
    }

    /**
     * 拖拽中指尖是否回到了 dock 区域。`hover=true` 仅在玩家"已经把手指拖离 dock 一次后再回到 dock 上"
     * 时才真正切换为半透明回放——避免激活那一刻就误判为"立刻想取消"。
     */
    setHoverBackOverDock(hover: boolean): void {
        if (this._draggingSlot < 0) return;
        // 手指首次离开 dock 后才解锁 hover-back 判定。
        if (!hover) {
            this._hasLeftDockOnce = true;
        }
        const effective = hover && this._hasLeftDockOnce;
        if (this._hoverBackOverDock === effective) return;
        this._hoverBackOverDock = effective;
        if (this._skin) this.render(this._blocks, this._skin);
    }

    /** 屏幕坐标是否落在 dock 节点的 AABB 内（不要求命中具体的 shape cell）。 */
    isScreenInDockArea(screenX: number, screenY: number): boolean {
        const uit = this.node.getComponent(UITransform);
        if (!uit) return false;
        const local = screenToLocal(this.node, screenX, screenY);
        return Math.abs(local.x) <= uit.contentSize.width / 2 && Math.abs(local.y) <= uit.contentSize.height / 2;
    }

    /**
     * 屏幕坐标命中哪一块候选（-1 = 未命中）。
     * 供全局 input 兜底；逻辑与 web `_dockPointerHitsBlockShape` 相同。
     */
    pickBlock(screenX: number, screenY: number): number {
        for (let i = 0; i < 3; i++) {
            if (this.pointerHitsBlockShape(i, screenX, screenY)) return i;
        }
        return -1;
    }

    /**
     * 指针是否落在指定槽位 block 的实体格上。
     *
     * v1.62.2 触屏命中策略大改：
     *  - 桌面端（鼠标）：沿用 web 严格 shape-cell 命中（精确点中实体格才激活）。
     *  - 触屏端（iOS / Android / web-mobile / 微信小游戏）：iOS HIG 推荐触摸目标 ≥44pt，
     *    指尖中心比视觉锚点常偏低 8~12px。沿用严格 cell 命中会导致用户"明明点到了候选块
     *    但激活不了" —— 实测日志 `dock-miss sx=697 sy=162 local=(246,-67) placed=110`
     *    证实：手指落在 shape AABB 下方 4~8px。
     *
     *    触屏改为「整槽 + shape AABB 容差并集」：
     *      1) 优先严格 shape-cell 命中（细小形状的精确度仍保留）；
     *      2) 落空时在 shape AABB 周围加 12px 容差环并扫描最近的实心 cell；
     *      3) 仍落空时回退到「整槽矩形」—— 该槽如果是唯一活的候选，整片 210×210 都可激活。
     *      第 3 步用户感受最直接：每槽就一个块，整槽命中就是「肯定知道我要选这个」。
     */
    pointerHitsBlockShape(slotIndex: number, screenX: number, screenY: number): boolean {
        const block = this._blocks[slotIndex];
        if (!block || block.placed || !block.shape?.length) return false;
        // 拖拽中的槽位视为"已腾空"：候选块已搬到 ghost，dock 也不画——hit 区也同步关闭，
        // 避免玩家误触原槽位（虽然 beginDockDrag 二次激活已被 dragIndex 守卫拦下，但此处提前返回更高效且语义清晰）。
        if (slotIndex === this._draggingSlot) return false;
        const pick = this._pickNodes[slotIndex];
        if (!pick?.isValid) return false;

        const local = screenToLocal(pick, screenX, screenY);
        const slotPx = this.slotPx;
        // 槽节点锚点 0.5：转为 web canvas 左上角原点坐标（y 向下）。
        const lx = local.x + slotPx / 2;
        const ly = slotPx / 2 - local.y;

        const cell = this.cell;
        const bw = block.shape[0].length;
        const bh = block.shape.length;
        const ox = (slotPx - bw * cell) / 2;
        const oy = (slotPx - bh * cell) / 2;

        // 严格 cell 命中（与 web `_dockPointerHitsBlockShape` 完全同源）。
        if (lx >= ox && ly >= oy) {
            const gx = Math.floor((lx - ox) / cell);
            const gy = Math.floor((ly - oy) / cell);
            if (gx >= 0 && gy >= 0 && gx < bw && gy < bh && block.shape[gy][gx]) return true;
        }

        // 桌面端到此为止：沿用 web 严格语义，避免误激活。
        const touchPlatform = sys.isMobile || sys.isNative;
        if (!touchPlatform) return false;

        // 触屏容差 1：shape AABB 外扩 12px。若落入扩边框 → 视为命中（最近的实心 cell 作为锚）。
        const PICK_PAD = 12;
        const blockL = ox - PICK_PAD;
        const blockR = ox + bw * cell + PICK_PAD;
        const blockT = oy - PICK_PAD;
        const blockB = oy + bh * cell + PICK_PAD;
        if (lx >= blockL && lx <= blockR && ly >= blockT && ly <= blockB) return true;

        // 触屏容差 2：整槽命中。槽内只有一个候选块，整片触摸区域都用于激活它 —— 这是
        // iOS HIG「44pt 触摸目标」最直接的实现。代价是「点击槽内的空白也激活」，但每槽
        // 只可能有一个块，所以语义上不会误激活别的东西，对用户预期反而更友好。
        if (lx >= 0 && lx <= slotPx && ly >= 0 && ly <= slotPx) return true;

        return false;
    }

    /** 布局层调用：同步候选区尺寸与方块格大小，必要时重绘。 */
    setLayout(width: number, height: number, cell: number): void {
        const changed = this.dockWidth !== width || this.dockHeight !== height || this.cell !== cell;
        this.dockWidth = width;
        this.dockHeight = height;
        this.cell = cell;
        const uit = this.node.getComponent(UITransform);
        if (uit) uit.setContentSize(width, height);
        this.layoutPickNodes();
        if (changed && this._skin) this.render(this._blocks, this._skin);
    }

    private ensurePickNodes(): void {
        for (let i = 0; i < 3; i++) {
            if (this._pickNodes[i]?.isValid) continue;
            const n = new Node(`pick-${i}`);
            n.parent = this.node;
            inheritLayer(n, this.node);
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            this._pickNodes[i] = n;
        }
    }

    private layoutPickNodes(): void {
        this.ensurePickNodes();
        const px = this.slotPx;
        for (let i = 0; i < 3; i++) {
            const n = this._pickNodes[i];
            n.getComponent(UITransform)!.setContentSize(px, px);
            n.setPosition(this.slotCenterX(i), 0, 0);
        }
    }

    private icon(i: number): Label {
        let l = this._icons[i];
        if (!l) {
            const n = new Node('ic');
            n.parent = this._iconRoot!;
            inheritLayer(n, this._iconRoot!);
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            l = n.addComponent(Label);
            l.color = new Color(255, 255, 255, 255);
            l.useSystemFont = true;
            l.fontFamily = ICON_FONT_FAMILY;
            if (Label.Overflow) l.overflow = Label.Overflow.NONE;
            if (Label.HorizontalAlign) l.horizontalAlign = Label.HorizontalAlign.CENTER;
            if (Label.VerticalAlign) l.verticalAlign = Label.VerticalAlign.CENTER;
            this._icons[i] = l;
        }
        return l;
    }

    render(blocks: DockBlock[], skin: Skin): void {
        this._blocks = blocks;
        this._skin = skin;
        const g = this._g!;
        g.clear();
        const cell = this.cell;
        let iconCursor = 0;
        for (const b of blocks) {
            if (b.placed) continue;
            // 拖拽中的槽位默认完全不画（候选块已"被拿到指尖"）。
            // 当 _hoverBackOverDock=true（指尖回到 dock 区域）时，画半透明占位提示"松手放回这里"。
            const isDragging = b.index === this._draggingSlot;
            if (isDragging && !this._hoverBackOverDock) continue;
            const shape = b.shape;
            const w = shape[0].length * cell;
            const h = shape.length * cell;
            const cx = this.slotCenterX(b.index);
            const startIcon = iconCursor;
            const used = drawShapeFaces(
                g,
                skin,
                {
                    shape,
                    colorIdx: b.colorIdx,
                    cell,
                    left: cx - w / 2,
                    top: h / 2,
                    // hover-back 占位用半透明，对齐 web `dockCanvas.style.opacity = 0.3` 的语义。
                    alpha: isDragging ? 90 : 255,
                },
                {
                    getIcon: (i) => this.icon(startIcon + i),
                    hideRemaining: () => { /* Dock 累计 icon 数 → 由本方法最后统一回收 */ },
                },
            );
            iconCursor += used;
        }
        for (let i = iconCursor; i < this._icons.length; i++) this._icons[i].node.active = false;
        // 已放置 + 拖拽中的槽位关闭触控：避免拖拽中再次点击原槽位激活第二次（web 也走 disable 路径）。
        for (let i = 0; i < 3; i++) {
            const pick = this._pickNodes[i];
            if (pick) pick.active = !blocks[i]?.placed && i !== this._draggingSlot;
        }
    }

    onDestroy(): void {
        this._pickNodes = [];
    }
}
