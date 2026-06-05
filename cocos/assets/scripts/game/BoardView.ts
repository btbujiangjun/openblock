import { _decorator, Component, Graphics, UITransform, Node, Label, Color } from 'cc';
import { Grid, Skin } from '../core';
import { blockColor, cellEmptyColor, gridOuterColor, blockMetrics, blockIcon } from './skin/palette';
import { paintBlockFace, iconFontSize } from './skin/blockPaint';

const { ccclass, property } = _decorator;

/**
 * 盘面渲染（Graphics + emoji Label）。坐标：节点锚点居中，grid (gx,gy) 的 gy=0 在顶部。
 * 立体面 + 中心 emoji 与 web renderer 对齐（带 icon 皮肤显示对应字形）。
 */
@ccclass('BoardView')
export class BoardView extends Component {
    @property
    boardPx = 480;

    @property
    gap = 2;

    private _g: Graphics | null = null;
    private _size = 8;
    private _skin: Skin | null = null;
    private _iconRoot: Node | null = null;
    private _icons: Label[] = [];

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.boardPx, this.boardPx);
        uit.setAnchorPoint(0.5, 0.5);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        this._iconRoot = new Node('icons');
        this._iconRoot.parent = this.node;
        this._iconRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
    }

    get cellSize(): number {
        return this.boardPx / this._size;
    }

    setSkin(skin: Skin): void {
        this._skin = skin;
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

    render(grid: Grid, skin: Skin): void {
        this._size = grid.size;
        this._skin = skin;
        const g = this._g!;
        const cell = this.cellSize;
        const half = this.boardPx / 2;
        const { inset, radius } = blockMetrics(skin, cell);
        g.clear();

        // 盘面外框底色（对齐 web skin.gridOuter）。
        const framePad = this.gap;
        g.fillColor = gridOuterColor(skin);
        g.roundRect(-half - framePad, -half - framePad, this.boardPx + framePad * 2, this.boardPx + framePad * 2, 10);
        g.fill();

        let iconN = 0;
        for (let gy = 0; gy < grid.size; gy++) {
            for (let gx = 0; gx < grid.size; gx++) {
                const cellX = -half + gx * cell;
                const cellY = half - (gy + 1) * cell;
                const v = grid.cells[gy][gx];
                if (v === null) {
                    const inn = cell - this.gap;
                    g.fillColor = cellEmptyColor(skin);
                    g.roundRect(cellX + this.gap / 2, cellY + this.gap / 2, inn, inn, Math.min(6, inn * 0.18));
                    g.fill();
                    continue;
                }
                const fsize = cell - inset * 2;
                paintBlockFace(g, cellX + inset, cellY + inset, fsize, radius, skin, v);
                const em = blockIcon(skin, v);
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
        for (let i = iconN; i < this._icons.length; i++) this._icons[i].node.active = false;
    }

    /** 高亮预览（ghost 落点）：半透明叠加 */
    renderGhost(grid: Grid, skin: Skin, shape: number[][], gx: number, gy: number, colorIdx: number): void {
        const g = this._g!;
        const cell = this.cellSize;
        const inner = cell - this.gap;
        const half = this.boardPx / 2;
        const col = blockColor(skin, colorIdx, 120);
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (!shape[y][x]) continue;
                const cx = gx + x;
                const cy = gy + y;
                if (cx < 0 || cx >= grid.size || cy < 0 || cy >= grid.size) continue;
                const px = -half + cx * cell + this.gap / 2;
                const py = half - (cy + 1) * cell + this.gap / 2;
                g.fillColor = col;
                g.roundRect(px, py, inner, inner, Math.min(6, inner * 0.18));
                g.fill();
            }
        }
    }
}
