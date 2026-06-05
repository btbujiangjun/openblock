import { _decorator, Component, Graphics, UITransform, Node, Label, Color } from 'cc';
import { DockBlock, Skin } from '../core';
import { blockMetrics, blockIcon } from './skin/palette';
import { paintBlockFace, iconFontSize } from './skin/blockPaint';

const { ccclass, property } = _decorator;

/**
 * 候选区渲染：3 个等宽 slot，块在 slot 内居中按 cell 绘制（立体面 + emoji，与盘面一致）。
 * 提供 hitSlot(localX) 命中检测，供拖拽起手判断点中了哪一块。
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

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.dockWidth, this.dockHeight);
        uit.setAnchorPoint(0.5, 0.5);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        this._iconRoot = new Node('icons');
        this._iconRoot.parent = this.node;
        this._iconRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
    }

    get slotWidth(): number {
        return this.dockWidth / 3;
    }

    /** slot 中心的本地 x */
    slotCenterX(index: number): number {
        return -this.dockWidth / 2 + this.slotWidth * (index + 0.5);
    }

    hitSlot(localX: number): number {
        const idx = Math.floor((localX + this.dockWidth / 2) / this.slotWidth);
        return idx >= 0 && idx < 3 ? idx : -1;
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
                    paintBlockFace(g, cellX + inset, cellY + inset, fsize, radius, skin, b.colorIdx);
                    const em = blockIcon(skin, b.colorIdx);
                    const fs = em ? iconFontSize(fsize) : 0;
                    if (em && fs > 0) {
                        const l = this.icon(iconN++);
                        l.node.active = true;
                        l.node.setPosition(cellX + cell / 2, cellY + cell / 2, 0);
                        l.fontSize = fs;
                        l.lineHeight = fs;
                        l.string = em;
                    }
                }
            }
        }
        for (let i = iconN; i < this._icons.length; i++) this._icons[i].node.active = false;
    }
}
