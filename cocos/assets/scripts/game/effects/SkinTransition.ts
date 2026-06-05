import { Node, UITransform, Graphics, UIOpacity, tween, Color } from 'cc';
import { Skin } from '../../core';
import { bgColor } from '../skin/palette';

const HALF_MS = 300;

/**
 * 皮肤切换转场（对齐 web skinTransition.js）：0.6s 主题色覆层淡入 → 中点换肤 → 淡出。
 * 在 apply 回调内执行真正的 setSkin / 重绘，给用户「换了一个世界」的仪式感。
 */
export function playSkinTransition(parent: Node, nextSkin: Skin, apply: () => void): void {
    const root = new Node('SkinTransition');
    root.parent = parent;
    root.layer = parent.layer;
    root.setSiblingIndex(parent.children.length - 1);
    const uit = root.addComponent(UITransform);
    uit.setAnchorPoint(0.5, 0.5);
    uit.setContentSize(2400, 3200);

    const g = root.addComponent(Graphics);
    const c = bgColor(nextSkin);
    g.fillColor = new Color(c.r, c.g, c.b, 255);
    g.rect(-1200, -1600, 2400, 3200);
    g.fill();

    const op = root.addComponent(UIOpacity);
    op.opacity = 0;

    tween(op)
        .to(HALF_MS / 1000, { opacity: 217 }, { easing: 'quadOut' })
        .call(() => {
            apply();
            tween(op)
                .to(HALF_MS / 1000, { opacity: 0 }, { easing: 'quadIn' })
                .call(() => { if (root.isValid) root.destroy(); })
                .start();
        })
        .start();
}
