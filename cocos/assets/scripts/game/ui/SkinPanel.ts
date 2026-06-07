import { _decorator, Component, Node, Color, UITransform, Label, Graphics, UIOpacity, Vec3, tween } from 'cc';
import { Modal, dimBg, card, label, closeX, TapBus, bindEngineClick, inheritLayer } from './uiKit';
import { SKINS, listSkinIds, Skin, t } from '../../core';
import { blockMetrics, gridOuterColor, cellEmptyColor, blockIcon } from '../skin/palette';
import { paintBlockFace, iconFontSize } from '../skin/blockPaint';
import { Motion } from '../platform/Motion';

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
    private swatches: Map<string, { g: Graphics; skin: Skin; w: number; h: number; node: Node }> = new Map();
    private closed = false;

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
        if (!Motion.reduced) {
            const op = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
            op.opacity = 0;
            root.setScale(new Vec3(0.92, 0.92, 1));
            tween(op).to(0.18, { opacity: 255 }, { easing: 'cubicOut' }).start();
            tween(root).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
        return p;
    }

    private build(): void {
        Modal.open();
        const ids = listSkinIds();
        // 移动端优先：4 列紧凑卡片，避免列表压到底部并被关闭按钮遮挡。
        const cols = 4;
        const swatch = 136;        // 单元宽
        const swatchH = 132;       // 单元高（含名字）
        const gapX = 10;
        const gapY = 10;
        const rows = Math.ceil(ids.length / cols);
        const gridW = cols * swatch + (cols - 1) * gapX;
        const gridH = rows * swatchH + (rows - 1) * gapY;
        const h = gridH + 150;
        const w = gridW + 60;

        // 点背景关闭
        const dim = dimBg(this.node);
        dim.getComponent(UITransform)!.setContentSize(2000, 3000);
        this._unregs.push(TapBus.add(dim, () => this.close()));

        const c = card(this.node, w, h);
        const topY = h / 2 - 54;
        label(c, t('skin.title'), 38, 0, topY, new Color(255, 220, 130, 255));
        // 右上角 × 关闭（对齐 web 弹窗）
        this._unregs.push(closeX(c, w / 2 - 44, h / 2 - 44, () => this.close()));

        const startX = -gridW / 2 + swatch / 2;
        const startY = topY - 72 - swatchH / 2;
        ids.forEach((id, i) => {
            const r = Math.floor(i / cols);
            const col = i % cols;
            const x = startX + col * (swatch + gapX);
            const y = startY - r * (swatchH + gapY);
            this.makeSwatch(c, SKINS[id], x, y, swatch, swatchH);
        });
    }

    private makeSwatch(parent: Node, skin: Skin, x: number, y: number, w: number, h: number): void {
        const n = new Node(`sk-${skin.id}`);
        n.parent = parent;
        inheritLayer(n, parent);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(w, h);
        n.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);

        const g = n.addComponent(Graphics);
        this.swatches.set(skin.id, { g, skin, w, h, node: n });
        this.drawSwatchFrame(g, skin, w, h);

        // 迷你盘面预览（4×4），画在卡片上半部
        const { previewSize, px0, py0 } = this.previewGeom(w, h);
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

        // 选中即生效并关闭面板（对齐 web 主端「点皮肤直接切换并收起」体感）：
        //   - 点击当前皮肤：仅关闭面板（视为"确认当前选择"，无须再触发 onPick 重渲染整个游戏）
        //   - 点击其它皮肤：先触发 onPick 让宿主立即应用（背景能在面板淡出过程中已切到新皮肤，
        //     形成"皮肤跟着面板一起换"的连贯感），然后关闭。
        // 不再在面板内重绘 selected 描边 —— 面板马上消失，描边动画反而显得拖沓。
        const pick = () => {
            if (this.closed) return; // 防双击重入（连点两下避免触发两次 close + 双重 onPick）
            if (this.currentId !== skin.id && this.onPick) {
                this.onPick(skin.id);
            }
            this.close();
        };
        this._unregs.push(TapBus.add(n, pick));
        this._unregs.push(bindEngineClick(n, pick));
    }

    private previewGeom(w: number, h: number): { previewSize: number; px0: number; py0: number } {
        const previewSize = Math.min(w - 36, h - 58);
        const px0 = -previewSize / 2;
        const py0 = h / 2 - 18 - previewSize;
        return { previewSize, px0, py0 };
    }

    private drawSwatchFrame(g: Graphics, skin: Skin, w: number, h: number): void {
        const selected = skin.id === this.currentId;
        g.fillColor = new Color(24, 28, 40, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.fill();
        g.lineWidth = selected ? 4 : 1.5;
        g.strokeColor = selected ? new Color(120, 200, 255, 255) : new Color(70, 84, 110, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.stroke();
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
        if (this.closed) return;
        this.closed = true;
        // 立即解绑所有点击回调，避免淡出过程中再触发 pick / dim / closeX
        for (const u of this._unregs) u();
        this._unregs = [];
        // Modal 状态立即释放，让宿主（GameController）感知到模态已关，不阻塞拖拽等输入
        Modal.close();
        // 与 show() 的开屏动画对称的关屏动画：0.14s 比开屏稍快，让"切换皮肤"的反馈紧凑
        if (Motion.reduced || !this.node.isValid) {
            this.node.destroy();
            return;
        }
        const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        const self = this.node;
        tween(op).to(0.14, { opacity: 0 }, { easing: 'cubicIn' }).start();
        tween(self).to(0.14, { scale: new Vec3(0.94, 0.94, 1) }, { easing: 'cubicIn' })
            .call(() => { if (self.isValid) self.destroy(); })
            .start();
    }

    onDestroy(): void {
        for (const u of this._unregs) u();
        this._unregs = [];
    }
}
