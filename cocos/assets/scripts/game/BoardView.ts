import { _decorator, Component, Graphics, UITransform, Node, Label, Color, UIOpacity, Sprite, SpriteFrame, resources } from 'cc';
import { Grid, Skin, getWatermark, flag } from '../core';
import { blockColor, cellEmptyColor, gridOuterColor, blockMetrics, blockIcon } from './skin/palette';
import { paintBlockFace, iconFontSize } from './skin/blockPaint';

/** 盘面水印 5 锚点（四角内缩 + 中心），与 web DEFAULT_WATERMARK_ANCHOR_RATIOS 同思路。 */
const WM_ANCHORS: Array<[number, number]> = [
    [0.22, 0.24], [0.78, 0.24], [0.5, 0.5], [0.22, 0.76], [0.78, 0.76],
];

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
    private _wmRoot: Node | null = null;
    private _wmOp: UIOpacity | null = null;
    private _wm: Label[] = [];
    // 可选 sprite 方块渲染（art/block，可染色灰度贴图）；贴图未导入或开关关闭则回退 Graphics。
    private _spriteRoot: Node | null = null;
    private _blockFrame: SpriteFrame | null = null;
    private _blockSprites: Sprite[] = [];

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.boardPx, this.boardPx);
        uit.setAnchorPoint(0.5, 0.5);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        // 水印层（在盘面底色之上、方块/图标之下；用 UIOpacity 统一压暗，连彩色 emoji 一起变淡）。
        this._wmRoot = new Node('watermark');
        this._wmRoot.parent = this.node;
        this._wmRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._wmOp = this._wmRoot.addComponent(UIOpacity);
        // 方块 sprite 层（水印之上、图标之下）。
        this._spriteRoot = new Node('blocks');
        this._spriteRoot.parent = this.node;
        this._spriteRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._iconRoot = new Node('icons');
        this._iconRoot.parent = this.node;
        this._iconRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        // 容错加载方块贴图：成功则启用 sprite 渲染，失败保持纯代码渲染（与启动屏同款兜底）。
        resources.load('art/block/spriteFrame', SpriteFrame, (err: unknown, sf: SpriteFrame) => {
            if (err || !sf || !this._spriteRoot || !this._spriteRoot.isValid) return;
            this._blockFrame = sf;
        });
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

        this.renderWatermark(skin);

        const useSprites = !!this._blockFrame && flag('spriteBlocks');
        let iconN = 0;
        let spN = 0;
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
                if (useSprites) {
                    const s = this.blockSprite(spN++);
                    s.node.active = true;
                    if (s.spriteFrame !== this._blockFrame) s.spriteFrame = this._blockFrame;
                    (s.node.getComponent(UITransform) || s.node.addComponent(UITransform)).setContentSize(fsize, fsize);
                    s.node.setPosition(cellX + cell / 2, cellY + cell / 2, 0);
                    s.color = blockColor(skin, v);
                } else {
                    paintBlockFace(g, cellX + inset, cellY + inset, fsize, radius, skin, v);
                }
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
        for (let i = spN; i < this._blockSprites.length; i++) this._blockSprites[i].node.active = false;
    }

    /** 盘面水印（对齐 web `_renderBoardWatermark`）：5 锚点低透明度浮层 emoji，随皮肤切换。 */
    private renderWatermark(skin: Skin): void {
        const wm = getWatermark(skin.id);
        const root = this._wmRoot;
        if (!root) return;
        if (!wm || !wm.icons.length) {
            for (const l of this._wm) l.node.active = false;
            return;
        }
        const board = this.boardPx;
        const half = board / 2;
        const fs = Math.round(this.cellSize * 1.9 * (wm.scale ?? 1));
        // web opacity 偏低；cocos 水印叠在不透明盘面之上需略提亮才可见，统一 ×2 并夹在 [10,64]。
        if (this._wmOp) this._wmOp.opacity = Math.max(10, Math.min(64, Math.round(255 * wm.opacity * 2)));
        WM_ANCHORS.forEach((a, i) => {
            let l = this._wm[i];
            if (!l) {
                const n = new Node('wm');
                n.parent = root;
                n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
                l = n.addComponent(Label);
                l.color = new Color(255, 255, 255, 255);
                this._wm[i] = l;
            }
            l.node.active = true;
            l.node.setPosition(-half + a[0] * board, half - a[1] * board, 0);
            l.fontSize = fs;
            l.lineHeight = fs;
            l.string = wm.icons[i % wm.icons.length];
        });
        for (let i = WM_ANCHORS.length; i < this._wm.length; i++) this._wm[i].node.active = false;
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
