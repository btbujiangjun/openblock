import { _decorator, Component, Node, Color, UITransform } from 'cc';
import { getMode, t } from '../../core';
import { Modal, dimBg, card, label, button, closeX, TapBus } from './uiKit';
import { ReplayStore } from '../platform/ReplayStore';
import { ReplayViewer } from './ReplayViewer';

const { ccclass } = _decorator;

/**
 * 回放列表（对齐 web replay 列表）：展示本地保存的对局（分数/模式/步数/日期），
 * 点选打开回看器。全屏模态，背景或 × 关闭。
 */
@ccclass('ReplayPanel')
export class ReplayPanel extends Component {
    private _unregDim: (() => void) | null = null;
    private _unregClose: (() => void) | null = null;

    static show(parent: Node): ReplayPanel {
        const root = new Node('ReplayPanel');
        root.parent = parent;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const p = root.addComponent(ReplayPanel);
        p.build();
        return p;
    }

    private build(): void {
        Modal.open();
        const list = ReplayStore.list();

        const dim = dimBg(this.node, 2000, 3000);
        this._unregDim = TapBus.add(dim, () => this.close());

        const w = 600;
        const h = Math.min(900, 220 + Math.max(1, list.length) * 70);
        const c = card(this.node, w, h);
        let y = h / 2 - 64;
        label(c, t('replay.title'), 36, 0, y, new Color(255, 220, 130, 255));
        y -= 70;

        if (list.length === 0) {
            label(c, t('replay.empty'), 24, 0, 0, new Color(180, 190, 210, 255));
        } else {
            for (const r of list) {
                const modeName = t(getMode(r.mode as never).nameKey);
                const dateStr = new Date(r.date).toLocaleDateString();
                const lbl = `${t('replay.item', { score: r.score, mode: modeName, moves: r.moves.length })}  ·  ${dateStr}`;
                button(c, lbl, 0, y, 22, () => ReplayViewer.show(this.node.parent || this.node, r), new Color(48, 58, 80, 255), { width: w - 60, minWidth: w - 60 });
                y -= 70;
            }
        }

        this._unregClose = closeX(c, w / 2 - 44, h / 2 - 44, () => this.close());
    }

    close(): void {
        Modal.close();
        if (this._unregDim) { this._unregDim(); this._unregDim = null; }
        if (this._unregClose) { this._unregClose(); this._unregClose = null; }
        this.node.destroy();
    }
}
