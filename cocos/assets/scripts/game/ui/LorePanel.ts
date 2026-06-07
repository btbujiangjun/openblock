import { _decorator, Component, Node, Color, UITransform } from 'cc';
import { getSkin, listSkinIds, getLore, getWatermark, t } from '../../core';
import { Modal, dimBg, card, label, button, closeX, TapBus } from './uiKit';

const { ccclass } = _decorator;

/** 卡片背景水印 4 角预设（散落，避开正文）。 */
const LORE_WM: Array<[number, number, number]> = [
    [-230, 300, 46], [230, 300, 52], [-250, -180, 44], [250, -180, 50],
];

/**
 * 皮肤图鉴（对齐 web `lore/skinLore.js`）：全屏分页叙事卡——皮肤名 + 主题计数 + 方块图标行 +
 * 诗句式故事 + 背景水印 + 上/下一款 + 「使用此皮肤」。背景或 × 关闭。
 */
@ccclass('LorePanel')
export class LorePanel extends Component {
    private content!: Node;
    private cardW = 600;
    private cardH = 780;
    private ids: string[] = [];
    private activeId = '';
    private onUse: ((id: string) => void) | null = null;
    private _unregDim: (() => void) | null = null;
    private _unregClose: (() => void) | null = null;
    private _closed = false;

    static show(parent: Node, currentId: string, onUse: (id: string) => void): LorePanel {
        const root = new Node('LorePanel');
        root.parent = parent;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const p = root.addComponent(LorePanel);
        p.build(currentId, onUse);
        return p;
    }

    private build(currentId: string, onUse: (id: string) => void): void {
        Modal.open();
        this.onUse = onUse;
        this.activeId = currentId;
        this.ids = listSkinIds();

        const dim = dimBg(this.node);
        dim.getComponent(UITransform)!.setContentSize(2000, 3000);
        this._unregDim = TapBus.add(dim, () => this.close());

        const c = card(this.node, this.cardW, this.cardH);
        this.content = new Node('content');
        this.content.parent = c;
        this.content.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this._unregClose = closeX(c, this.cardW / 2 - 44, this.cardH / 2 - 44, () => this.close());

        let cursor = this.ids.indexOf(currentId);
        if (cursor < 0) cursor = 0;
        this.renderPage(cursor);
    }

    private renderPage(cursor: number): void {
        const ids = this.ids;
        const id = ids[cursor];
        const skin = getSkin(id);
        this.content.removeAllChildren();

        // 背景水印（复用皮肤盘面 watermark，没有则用 blockIcons 兜底）。
        const wm = getWatermark(id);
        const wmIcons = wm?.icons?.length ? wm.icons : (skin.blockIcons || []).slice(0, 4);
        if (wmIcons.length) {
            LORE_WM.forEach((p, i) => {
                const l = label(this.content, wmIcons[i % wmIcons.length], p[2], p[0], p[1], new Color(255, 255, 255, 40));
                void l;
            });
        }

        const h = this.cardH;
        let y = h / 2 - 70;
        label(this.content, skin.name, 36, 0, y, new Color(255, 220, 130, 255));
        y -= 52;
        label(this.content, t('lore.page', { cur: cursor + 1, total: ids.length }), 20, 0, y, new Color(160, 175, 200, 255));
        y -= 48;

        // 方块图标行（前 8 个 colorIdx 的 emoji；纯色皮肤跳过）。
        const icons = (skin.blockIcons || []).slice(0, 8);
        if (icons.length) {
            const step = 56;
            const startX = -((icons.length - 1) * step) / 2;
            icons.forEach((em, i) => {
                label(this.content, em, 36, startX + i * step, y, new Color(255, 255, 255, 255));
            });
            y -= 64;
        }

        // 故事正文：按 —— 与标点拆成短句，逐行排版。
        const lines = this.formatStory(getLore(id));
        for (const ln of lines) {
            label(this.content, ln.text, ln.pause ? 22 : 24, 0, y, ln.pause ? new Color(150, 165, 190, 255) : new Color(225, 232, 244, 255));
            y -= 38;
        }

        // 底部操作行：上一款 / 使用此皮肤 / 下一款。
        const footY = -h / 2 + 70;
        button(this.content, t('lore.prev'), -200, footY, 22, () => {
            this.renderPage((cursor - 1 + ids.length) % ids.length);
        }, new Color(58, 66, 86, 255), { minWidth: 140 });
        button(this.content, t('lore.next'), 200, footY, 22, () => {
            this.renderPage((cursor + 1) % ids.length);
        }, new Color(58, 66, 86, 255), { minWidth: 140 });
        const isActive = id === this.activeId;
        button(this.content, isActive ? t('lore.using') : t('lore.use'), 0, footY + 64, 24, () => {
            if (isActive) return;
            this.activeId = id;
            if (this.onUse) this.onUse(id);
            this.renderPage(cursor);
        }, isActive ? new Color(74, 80, 100, 255) : new Color(45, 120, 210, 255), { primary: !isActive, minWidth: 240, disabled: isActive });
    }

    /** 故事拆句（对齐 web _formatPoem）：—— 作停顿行，其余按 ，；。： 断句。 */
    private formatStory(story: string): Array<{ text: string; pause: boolean }> {
        const out: Array<{ text: string; pause: boolean }> = [];
        for (const tok of story.split(/(——)/g)) {
            if (!tok) continue;
            if (tok === '——') { out.push({ text: '——', pause: true }); continue; }
            for (const seg of tok.split(/(?<=[，；。：])/)) {
                const s = seg.trim();
                if (s) out.push({ text: s, pause: false });
            }
        }
        return out;
    }

    close(): void {
        if (this._closed) return;
        this._closed = true;
        Modal.close();
        if (this._unregDim) { this._unregDim(); this._unregDim = null; }
        if (this._unregClose) { this._unregClose(); this._unregClose = null; }
        if (this.node?.isValid) this.node.destroy();
    }
}
