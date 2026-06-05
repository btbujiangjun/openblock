import { _decorator, Component, Graphics, UITransform, Node, Label, Color } from 'cc';
import { DockBlock, Skin } from '../core';
import { blockMetrics, blockIcon } from './skin/palette';
import { paintBlockFace, iconFontSize } from './skin/blockPaint';
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

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.dockWidth, this.dockHeight);
        uit.setAnchorPoint(0.5, 0.5);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        this._iconRoot = new Node('icons');
        this._iconRoot.parent = this.node;
        this._iconRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
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

    /** 激活拖拽：候选块半透明留在原位（对齐 web `dockCanvas.style.opacity = 0.3`）。 */
    setDraggingSlot(index: number): void {
        this._draggingSlot = index;
        if (this._skin) this.render(this._blocks, this._skin);
    }

    clearDraggingSlot(): void {
        if (this._draggingSlot < 0) return;
        this._draggingSlot = -1;
        if (this._skin) this.render(this._blocks, this._skin);
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
     * 指针是否落在指定槽位 block 的实体格上（不含 5×5 预览槽留白）。
     * 移植自 web `Game._dockPointerHitsBlockShape`。
     */
    pointerHitsBlockShape(slotIndex: number, screenX: number, screenY: number): boolean {
        const block = this._blocks[slotIndex];
        if (!block || block.placed || !block.shape?.length) return false;
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
        if (lx < ox || ly < oy) return false;
        const gx = Math.floor((lx - ox) / cell);
        const gy = Math.floor((ly - oy) / cell);
        if (gx < 0 || gy < 0 || gy >= bh || gx >= bw) return false;
        return !!block.shape[gy][gx];
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
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            l = n.addComponent(Label);
            l.color = new Color(255, 255, 255, 255);
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
        const { inset, radius } = blockMetrics(skin, cell);
        let iconN = 0;
        for (const b of blocks) {
            if (b.placed) continue;
            const shape = b.shape;
            const w = shape[0].length * cell;
            const h = shape.length * cell;
            const cx = this.slotCenterX(b.index);
            const left = cx - w / 2;
            const top = h / 2;
            for (let y = 0; y < shape.length; y++) {
                for (let x = 0; x < shape[y].length; x++) {
                    if (!shape[y][x]) continue;
                    const cellX = left + x * cell;
                    const cellY = top - (y + 1) * cell;
                    const fsize = cell - inset * 2;
                    const dim = b.index === this._draggingSlot;
                    const faceA = dim ? 76 : 255;
                    paintBlockFace(g, cellX + inset, cellY + inset, fsize, radius, skin, b.colorIdx, faceA);
                    const em = blockIcon(skin, b.colorIdx);
                    const fs = em ? iconFontSize(fsize) : 0;
                    if (em && fs > 0) {
                        const l = this.icon(iconN++);
                        l.node.active = true;
                        l.node.setPosition(cellX + cell / 2, cellY + cell / 2, 0);
                        l.fontSize = fs;
                        l.lineHeight = fs;
                        l.string = em;
                        l.color = dim ? new Color(255, 255, 255, 76) : new Color(255, 255, 255, 255);
                    }
                }
            }
        }
        for (let i = iconN; i < this._icons.length; i++) this._icons[i].node.active = false;
        // 已放置的槽位关闭触控（对齐 web visibility:hidden）。
        for (let i = 0; i < 3; i++) {
            const pick = this._pickNodes[i];
            if (pick) pick.active = !blocks[i]?.placed;
        }
    }

    onDestroy(): void {
        this._pickNodes = [];
    }
}
