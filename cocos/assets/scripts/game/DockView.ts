import { _decorator, Component, Graphics, UITransform, Node, Label, Color, Sprite, sys } from 'cc';
import { DockBlock, Skin } from '../core';
import { drawShapeFaces, ICON_FONT_FAMILY, paintBlockFace } from './skin/blockPaint';
import { blockMetrics } from './skin/palette';
import { skinHasImageBlocks, ensureSkinBlockFrames, skinBlockFramesReady, getSkinBlockFrame, paintAssetOverlay } from './skin/skinSprites';
import { inheritLayer, screenToLocal } from './ui/uiKit';

const { ccclass, property } = _decorator;

/** 与 web CONFIG.DOCK_PREVIEW_MAX_CELLS 一致：每槽 5×5 预览画布。 */
const DOCK_PREVIEW_MAX_CELLS = 5;

/**
 * 候选区渲染：3 个等宽 slot，块在 slot 内居中按 cell 绘制（立体面 + emoji / 整面贴图）。
 *
 * 激活方式对齐 web `populateDockUI` + `_dockPointerHitsBlockShape`：
 * - 每槽独立 5×cell 方形触控区（等同 web 每块 canvas）
 * - 仅 shape 实体格命中才触发起手（槽内留白/块间空隙不激活）
 *
 * 渲染策略：
 *   - 非图片皮肤：Graphics + emoji 单管线（drawShapeFaces）。
 *   - 图片皮肤（inkGarden）：sprite 池铺整面贴图 + Graphics overlay 浮雕；与 web `populateDockUI`
 *     调用 `drawDockBlock → paintBlockCell → drawImage(PNG)` 完全等价。
 *
 * 性能要点：render() 仅在「spawn 新块 / placed / dragging / hover-back / setLayout」时触发，
 *   与 web 同频次（非 60Hz 重绘）；sprite 池跨 render 复用、不创建/销毁节点；
 *   贴图开 mipmap+trilinear（skinSprites.enableMipmap），256→26px 降采样仍锐利不糊。
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
    /** 图片皮肤（blockIconAssets）的候选块贴图层。 */
    private _spriteRoot: Node | null = null;
    private _blockSprites: Sprite[] = [];
    /** 图片皮肤柔光浮雕叠加层（仅 blockBevel.assetOverlay=true，对齐 web _paintAssetSoftOverlay）。 */
    private _overlayRoot: Node | null = null;
    private _overlayG: Graphics | null = null;
    /** 每槽 5×cell 命中参照节点（仅用于 pickBlock 坐标换算，不注册节点级触摸，避免 iOS 断触）。 */
    private _pickNodes: Node[] = [];
    /** 正在拖拽的槽位（对齐 web dock canvas opacity:0.3）。 */
    private _draggingSlot = -1;
    private _hoverBackOverDock = false;
    private _hasLeftDockOnce = false;
    /** sprite 着色复用（避免每帧 new Color，零 alloc）。 */
    private _spriteTint: Color = new Color(255, 255, 255, 255);

    onLoad(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.dockWidth, this.dockHeight);
        uit.setAnchorPoint(0.5, 0.5);
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        // 贴图层：在 Graphics 之上、overlay 之下。
        this._spriteRoot = new Node('blockSprites');
        this._spriteRoot.parent = this.node;
        inheritLayer(this._spriteRoot, this.node);
        this._spriteRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._spriteRoot.setSiblingIndex(5000);
        // 浮雕叠加层位于 sprite 之上、icon 之下。
        this._overlayRoot = new Node('blockOverlay');
        this._overlayRoot.parent = this.node;
        inheritLayer(this._overlayRoot, this.node);
        this._overlayRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._overlayRoot.setSiblingIndex(5500);
        this._overlayG = this._overlayRoot.addComponent(Graphics);
        this._iconRoot = new Node('icons');
        this._iconRoot.parent = this.node;
        inheritLayer(this._iconRoot, this.node);
        this._iconRoot.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        // 图标层应位于 Graphics / sprite / overlay 之上。
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

    setHoverBackOverDock(hover: boolean): void {
        if (this._draggingSlot < 0) return;
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

    pickBlock(screenX: number, screenY: number): number {
        for (let i = 0; i < 3; i++) {
            if (this.pointerHitsBlockShape(i, screenX, screenY)) return i;
        }
        return -1;
    }

    pointerHitsBlockShape(slotIndex: number, screenX: number, screenY: number): boolean {
        const block = this._blocks[slotIndex];
        if (!block || block.placed || !block.shape?.length) return false;
        if (slotIndex === this._draggingSlot) return false;
        const pick = this._pickNodes[slotIndex];
        if (!pick?.isValid) return false;

        const local = screenToLocal(pick, screenX, screenY);
        const slotPx = this.slotPx;
        const lx = local.x + slotPx / 2;
        const ly = slotPx / 2 - local.y;

        const cell = this.cell;
        const bw = block.shape[0].length;
        const bh = block.shape.length;
        const ox = (slotPx - bw * cell) / 2;
        const oy = (slotPx - bh * cell) / 2;

        if (lx >= ox && ly >= oy) {
            const gx = Math.floor((lx - ox) / cell);
            const gy = Math.floor((ly - oy) / cell);
            if (gx >= 0 && gy >= 0 && gx < bw && gy < bh && block.shape[gy][gx]) return true;
        }

        const touchPlatform = sys.isMobile || sys.isNative;
        if (!touchPlatform) return false;

        const PICK_PAD = 12;
        const blockL = ox - PICK_PAD;
        const blockR = ox + bw * cell + PICK_PAD;
        const blockT = oy - PICK_PAD;
        const blockB = oy + bh * cell + PICK_PAD;
        if (lx >= blockL && lx <= blockR && ly >= blockT && ly <= blockB) return true;

        if (lx >= 0 && lx <= slotPx && ly >= 0 && ly <= slotPx) return true;

        return false;
    }

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

    private blockSprite(i: number): Sprite {
        let s = this._blockSprites[i];
        if (!s) {
            const n = new Node('dblk');
            n.parent = this._spriteRoot!;
            inheritLayer(n, this._spriteRoot!);
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            s = n.addComponent(Sprite);
            if (Sprite.SizeMode) s.sizeMode = Sprite.SizeMode.CUSTOM;
            this._blockSprites[i] = s;
        }
        return s;
    }

    render(blocks: DockBlock[], skin: Skin): void {
        this._blocks = blocks;
        this._skin = skin;
        const imgSkin = skinHasImageBlocks(skin);
        // 图片皮肤：候选块贴图按需加载，加载完成后若仍是当前皮肤则重绘一次。
        // ⚠️ 仅当贴图**尚未就绪**时才注册重绘回调。否则命中缓存会**同步**回调 → 又调 render →
        //   再注册 → 无限递归（被 ensureSkinBlockFrames 内层 try/catch 吞掉栈溢出，但每次渲染
        //   会把候选区重绘上千次，正是「候选区不干净」的根因）。已就绪时下面的绘制已用上缓存帧。
        if (imgSkin && !skinBlockFramesReady(skin)) {
            ensureSkinBlockFrames(skin, () => {
                if (this._skin?.id === skin.id && this.node?.isValid) this.render(this._blocks, skin);
            });
        }
        const g = this._g!;
        g.clear();
        this._overlayG?.clear();
        const cell = this.cell;

        let iconCursor = 0;
        let spriteCursor = 0;

        if (imgSkin) {
            // 图片皮肤路径：与 web populateDockUI 同款，每槽内 (slotPx - w*cell)/2 居中铺 PNG。
            // 不走 drawShapeFaces 的 sprite 池抽象 —— 直接 per-cell 管理 sprite 节点，
            // 避免「拖拽槽 continue → spriteCursor 错位 → 残影/形状错乱」类脏状态。
            const { inset, radius } = blockMetrics(skin, cell);
            const fsize = cell - inset * 2;
            // 与 web `_paintIcon` 一致：sprite 实际大小 = fsize - pad*2（pad 由 blockIconInset 决定，
            // inkGarden 0.03 即几乎满铺）。overlay 覆盖整个 fsize（与 web _paintAssetSoftOverlay 同 sizing）。
            const insetFrac = (skin as unknown as { blockIconInset?: number }).blockIconInset ?? 0.18;
            const imgPad = insetFrac <= 0 ? 0 : Math.max(1, Math.round(fsize * insetFrac));
            const imgSize = Math.max(1, fsize - imgPad * 2);
            const ovR = skin.blockRadius ?? 0;

            for (const b of blocks) {
                if (b.placed) continue;
                const isDragging = b.index === this._draggingSlot;
                if (isDragging && !this._hoverBackOverDock) continue;
                const shape = b.shape;
                const sh = shape.length;
                const sw = shape[0].length;
                const cx = this.slotCenterX(b.index);
                // 与 web 一致的 slot 内居中：在 cocos Y 向上坐标系下，块左下角的本地坐标。
                const blockLeft = cx - (sw * cell) / 2;
                const blockTop = (sh * cell) / 2;
                const alpha = isDragging ? 90 : 255;

                for (let y = 0; y < sh; y++) {
                    for (let x = 0; x < sw; x++) {
                        if (!shape[y][x]) continue;
                        const cellX = blockLeft + x * cell;
                        const cellY = blockTop - (y + 1) * cell;
                        // ⭐ 严格对齐 web `paintBlockCell`：每格先画 cartoon 底瓷砖（带描边的实心色块），
                        //   再在其上叠整面 PNG。底瓷砖把相邻格连成一个完整方块，消除「PNG 悬空 →
                        //   候选块残缺不全 / 看似两种图案」的根因（此前仅在 PNG 未加载时才画占位）。
                        //   PNG 已加载时底瓷砖只在 inset 缝隙/PNG 透明边缘可见（与 web 同观感）。
                        paintBlockFace(g, cellX + inset, cellY + inset, fsize, radius, skin, b.colorIdx, alpha);
                        const sf = getSkinBlockFrame(skin, b.colorIdx);
                        if (sf) {
                            const s = this.blockSprite(spriteCursor++);
                            // ⚡ 增量更新：与 BoardView 同款节流（避免无效脏标记拖慢 dock 重排）
                            if (!s.node.active) s.node.active = true;
                            if (s.spriteFrame !== sf) s.spriteFrame = sf;
                            const ut = s.node.getComponent(UITransform) || s.node.addComponent(UITransform);
                            if (ut.contentSize.width !== imgSize || ut.contentSize.height !== imgSize) {
                                ut.setContentSize(imgSize, imgSize);
                            }
                            const px = cellX + cell / 2, py = cellY + cell / 2;
                            const pos = s.node.position;
                            if (pos.x !== px || pos.y !== py) s.node.setPosition(px, py, 0);
                            this._spriteTint.set(255, 255, 255, alpha);
                            s.color = this._spriteTint;
                            // paintAssetOverlay 仅在 skin.blockBevel.assetOverlay=true 时生效；
                            // v1.73 inkGarden 已关闭 overlay → 此分支静默返回，候选块零浮雕开销。
                            if (this._overlayG) {
                                paintAssetOverlay(this._overlayG, skin, cellX + cell / 2 - fsize / 2, cellY + cell / 2 - fsize / 2, fsize, ovR, alpha);
                            }
                        }
                    }
                }
            }
        } else {
            // 非图片皮肤：Graphics + emoji 单管线（与其他 25+ 皮肤一致）。
            for (const b of blocks) {
                if (b.placed) continue;
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
                        alpha: isDragging ? 90 : 255,
                    },
                    {
                        getIcon: (i) => this.icon(startIcon + i),
                        hideRemaining: () => { /* Dock 累计 icon 数 → 由本方法最后统一回收 */ },
                    },
                );
                iconCursor += used;
            }
        }

        for (let i = iconCursor; i < this._icons.length; i++) this._icons[i].node.active = false;
        for (let i = spriteCursor; i < this._blockSprites.length; i++) this._blockSprites[i].node.active = false;
        // 已放置 + 拖拽中的槽位关闭触控。
        for (let i = 0; i < 3; i++) {
            const pick = this._pickNodes[i];
            if (pick) pick.active = !blocks[i]?.placed && i !== this._draggingSlot;
        }
    }

    onDestroy(): void {
        this._pickNodes = [];
    }
}
