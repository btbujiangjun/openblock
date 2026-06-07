import { _decorator, Component, Graphics, UITransform, Color, tween, Node } from 'cc';
import { ClearResult, Skin } from '../../core';
import { blockFaceColor, clearFlashColor } from '../skin/palette';

const { ccclass } = _decorator;

/**
 * Phase 2 起步：消行闪光特效。在盘面同坐标系上画一层被消格的高亮并淡出。
 * BoardView 与本组件挂在同一节点（共享坐标），通过 boardPx/gap 复刻格子位置。
 */
@ccclass('LineClearFx')
export class LineClearFx extends Component {
    private _g: Graphics | null = null;
    boardPx = 480;
    gap = 2;
    size = 8;

    onLoad(): void {
        this._g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(this.boardPx, this.boardPx);
        uit.setAnchorPoint(0.5, 0.5);
    }

    /** 与盘面同步边长。 */
    setBoardPx(px: number): void {
        this.boardPx = px;
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(px, px);
    }

    play(result: ClearResult, skin: Skin): void {
        const g = this._g!;
        const cell = this.boardPx / this.size;
        const inner = cell - this.gap;
        const half = this.boardPx / 2;
        const node: Node = this.node;
        node.active = true;

        // 闪光色对齐 web skin.clearFlash：先铺各格的方块色高亮，再叠一层皮肤专属 clearFlash 提亮。
        const flash = clearFlashColor(skin);
        const draw = (alpha: number) => {
            g.clear();
            for (const c of result.cells) {
                const px = -half + c.x * cell + this.gap / 2;
                const py = half - (c.y + 1) * cell + this.gap / 2;
                // 用 face color（带 icon 皮肤已降饱和），与盘面方块同质感，避免闪光"偏鲜艳"。
                const base = c.color === null ? new Color(255, 255, 255) : blockFaceColor(skin, c.color);
                g.fillColor = new Color(base.r, base.g, base.b, alpha);
                g.roundRect(px, py, inner, inner, Math.min(6, inner * 0.18));
                g.fill();
                g.fillColor = new Color(flash.r, flash.g, flash.b, Math.round((flash.a / 255) * alpha));
                g.roundRect(px, py, inner, inner, Math.min(6, inner * 0.18));
                g.fill();
            }
        };

        const state = { a: 255 };
        draw(255);
        tween(state)
            .to(0.32, { a: 0 }, { onUpdate: () => draw(Math.max(0, Math.round(state.a))) })
            .call(() => g.clear())
            .start();
    }
}
