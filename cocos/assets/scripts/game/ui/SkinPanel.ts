import { _decorator, Component, Node, Color, UITransform, Label, Graphics } from 'cc';
import { Modal, dimBg, card, label, button, closeX, TapBus, inheritLayer } from './uiKit';
import { SKINS, listSkinIds, getSkin, Skin } from '../../core';
import { blockMetrics, gridOuterColor, cellEmptyColor, blockIcon } from '../skin/palette';
import { paintBlockFace, iconFontSize } from '../skin/blockPaint';

const { ccclass } = _decorator;

/**
 * 皮肤选择面板 —— 对齐 web 的「皮肤列表选择器」（#skin-select：列出全部皮肤、可选任意）。
 * 网格陈列所有皮肤的迷你预览（外框 + 数块方块 + emoji），当前皮肤高亮，点选即应用。
 */
@ccclass('SkinPanel')
export class SkinPanel extends Component {
    private onPick: ((id: string) => void) | null = null;
    private currentId = '';
    private _unregs: Array<() => void> = [];
    private cards: Map<string, Graphics> = new Map();

    static show(parent: Node, currentId: string, onPick: (id: string) => void): SkinPanel {
        const root = new Node('SkinPanel');
        root.parent = parent;
        inheritLayer(root, parent);
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const p = root.addComponent(SkinPanel);
        p.onPick = onPick;
        p.currentId = currentId;
        p.build();
        return p;
    }

    private build(): void {
        Modal.open();
        const ids = listSkinIds();
        const cols = 5;
        const swatch = 126;        // 单元宽
        const swatchH = 150;       // 单元高（含名字）
        const gapX = 6;
        const gapY = 8;
        const rows = Math.ceil(ids.length / cols);
        const gridW = cols * swatch + (cols - 1) * gapX;
        const gridH = rows * swatchH + (rows - 1) * gapY;
        const h = gridH + 200;
        const w = gridW + 60;

        // 点背景关闭
        const dim = dimBg(this.node);
        dim.getComponent(UITransform)!.setContentSize(2000, 3000);
        this._unregs.push(TapBus.add(dim, () => this.close()));

        const c = card(this.node, w, h);
        const topY = h / 2 - 60;
        label(c, '🎨 选择皮肤', 38, 0, topY, new Color(255, 220, 130, 255));
        // 右上角 × 关闭（对齐 web 弹窗）
        this._unregs.push(closeX(c, w / 2 - 44, h / 2 - 44, () => this.close()));

        const startX = -gridW / 2 + swatch / 2;
        const startY = topY - 80 - swatchH / 2;
        ids.forEach((id, i) => {
            const r = Math.floor(i / cols);
            const col = i % cols;
            const x = startX + col * (swatch + gapX);
            const y = startY - r * (swatchH + gapY);
            this.makeSwatch(c, SKINS[id], x, y, swatch, swatchH);
        });

        // 底部关闭按钮（统一胶囊样式）
        const closeBtnY = -h / 2 + 52;
        button(c, '关闭', 0, closeBtnY, 28, () => this.close(), new Color(74, 80, 100, 255), { minWidth: 200 });
    }

    private makeSwatch(parent: Node, skin: Skin, x: number, y: number, w: number, h: number): void {
        const n = new Node(`sk-${skin.id}`);
        n.parent = parent;
        inheritLayer(n, parent);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(w, h);
        n.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);

        const g = n.addComponent(Graphics);
        this.cards.set(skin.id, g);
        this.drawSwatchFrame(g, skin, w, h);

        // 迷你盘面预览（4×4），画在卡片上半部
        const previewSize = w - 28;
        const px0 = -previewSize / 2;
        const py0 = h / 2 - 22 - previewSize;
        this.drawMiniBoard(g, skin, px0, py0, previewSize);

        // 迷你预览里的 emoji（如有）用 Label 叠加
        this.drawMiniIcons(n, skin, px0, py0, previewSize);

        // 皮肤名（截断显示）
        const nameNode = new Node('name');
        nameNode.parent = n;
        nameNode.setPosition(0, -h / 2 + 22, 0);
        nameNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const nl = nameNode.addComponent(Label);
        nl.string = skin.name;
        nl.fontSize = 17;
        nl.lineHeight = 20;
        nl.color = new Color(225, 230, 240, 255);

        this._unregs.push(TapBus.add(n, () => {
            this.currentId = skin.id;
            // 重绘全部边框高亮态
            for (const [id, gg] of this.cards) this.drawSwatchFrame(gg, getSkin(id), w, h, true);
            if (this.onPick) this.onPick(skin.id);
        }));
    }

    private drawSwatchFrame(g: Graphics, skin: Skin, w: number, h: number, redraw = false): void {
        if (redraw) {
            // 仅重画边框层会与预览叠加错乱，这里整卡重绘：清空后补预览。
            g.clear();
        }
        const selected = skin.id === this.currentId;
        g.fillColor = new Color(24, 28, 40, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.fill();
        g.lineWidth = selected ? 4 : 1.5;
        g.strokeColor = selected ? new Color(120, 200, 255, 255) : new Color(70, 84, 110, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.stroke();
        if (redraw) {
            const previewSize = w - 28;
            const px0 = -previewSize / 2;
            const py0 = h / 2 - 22 - previewSize;
            this.drawMiniBoard(g, skin, px0, py0, previewSize);
        }
    }

    /** 画 4×4 迷你盘面：外框 + 交错填充几块方块，呈现该皮肤的底色/方块风格。 */
    private drawMiniBoard(g: Graphics, skin: Skin, x0: number, y0: number, size: number): void {
        const n = 4;
        const cell = size / n;
        const { inset, radius } = blockMetrics(skin, cell);
        // 外框
        g.fillColor = gridOuterColor(skin);
        g.roundRect(x0 - 3, y0 - 3, size + 6, size + 6, 8);
        g.fill();
        // 预设一个固定图案（对角 + 边），用前若干个色位展示
        const pattern = [
            [1, 0, 2, 0],
            [0, 3, 0, 4],
            [5, 0, 6, 0],
            [0, 7, 0, 8],
        ];
        for (let gy = 0; gy < n; gy++) {
            for (let gx = 0; gx < n; gx++) {
                const cx = x0 + gx * cell;
                const cy = y0 + (n - 1 - gy) * cell;
                const v = pattern[gy][gx];
                if (v === 0) {
                    const inn = cell - 2;
                    g.fillColor = cellEmptyColor(skin);
                    g.roundRect(cx + 1, cy + 1, inn, inn, Math.min(5, inn * 0.18));
                    g.fill();
                } else {
                    const fsize = cell - inset * 2;
                    paintBlockFace(g, cx + inset, cy + inset, fsize, radius, skin, v - 1);
                }
            }
        }
    }

    /** 迷你预览里的 emoji 叠加（仅带 icon 皮肤）。 */
    private drawMiniIcons(parent: Node, skin: Skin, x0: number, y0: number, size: number): void {
        if (!skin.blockIcons || !skin.blockIcons.length) return;
        const n = 4;
        const cell = size / n;
        const fs = iconFontSize(cell - (skin.blockInset ?? 2) * 2);
        if (fs <= 0) return;
        const pattern = [
            [1, 0, 2, 0],
            [0, 3, 0, 4],
            [5, 0, 6, 0],
            [0, 7, 0, 8],
        ];
        for (let gy = 0; gy < n; gy++) {
            for (let gx = 0; gx < n; gx++) {
                const v = pattern[gy][gx];
                if (v === 0) continue;
                const em = blockIcon(skin, v - 1);
                if (!em) continue;
                const cx = x0 + gx * cell + cell / 2;
                const cy = y0 + (n - 1 - gy) * cell + cell / 2;
                const ic = new Node('ic');
                ic.parent = parent;
                ic.setPosition(cx, cy, 0);
                ic.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
                const l = ic.addComponent(Label);
                l.string = em;
                l.fontSize = fs;
                l.lineHeight = fs;
            }
        }
    }

    close(): void {
        for (const u of this._unregs) u();
        this._unregs = [];
        Modal.close();
        this.node.destroy();
    }

    onDestroy(): void {
        for (const u of this._unregs) u();
        this._unregs = [];
    }
}
