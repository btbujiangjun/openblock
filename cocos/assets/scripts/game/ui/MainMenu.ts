import { _decorator, Component, Node, UITransform, Graphics, Color, BlockInputEvents } from 'cc';
import { GameMode, t, flag } from '../../core';
import { Modal, TapBus, button, label, inheritLayer } from './uiKit';

const { ccclass } = _decorator;

export interface MainMenuOpts {
    /** 历史最佳分（顶部展示）。 */
    best: number;
    /** 当前/默认模式。 */
    mode: GameMode;
    /** 是否存在可继续的存档（决定主按钮文案：继续/开始）。 */
    resumable: boolean;
    /** 点击开始：传入所选模式。 */
    onPlay: (mode: GameMode) => void;
    onSkin: () => void;
    onMeta: () => void;
    onLore: () => void;
    onReplay: () => void;
    onLeaderboard?: (() => void) | null;
    onWheel?: (() => void) | null;
}

/**
 * 主菜单首屏（对齐 web `#menu`）：品牌字标 + 最佳分 + 主 CTA「开始/继续」+
 * 皮肤/每日/排行/转盘次级入口。无模式芯片（web 主菜单亦无经典/禅/闪电选择，默认 classic）。
 * 作为全屏模态盖在游戏之上（Modal + TapBus 吸收层），点「开始」后露出已就绪牌局。
 */
@ccclass('MainMenu')
export class MainMenu extends Component {
    private opts!: MainMenuOpts;
    private blocker!: Node;
    private _unregBlocker: (() => void) | null = null;
    private selected: GameMode = 'classic';
    private visible = false;

    setup(opts: MainMenuOpts): void {
        this.opts = opts;
        this.selected = opts.mode;

        // 根节点仅作容器，不设大命中盒（避免 Graphics/UITransform 吞掉子按钮触摸）。
        const rootUit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        rootUit.setAnchorPoint(0.5, 0.5);
        rootUit.setContentSize(1, 1);
        this.node.addComponent(BlockInputEvents);

        // 全屏品牌深色底（独立子节点，不参与按钮命中竞争）。
        const bg = new Node('menuBg');
        bg.parent = this.node;
        inheritLayer(bg, this.node);
        bg.setSiblingIndex(0);
        const bgU = bg.addComponent(UITransform);
        bgU.setAnchorPoint(0.5, 0.5);
        bgU.setContentSize(2000, 3000);
        const g = bg.addComponent(Graphics);
        g.fillColor = new Color(15, 21, 37, 255);
        g.rect(-1000, -1500, 2000, 3000);
        g.fill();

        // 吸收层：先注册 TapBus（逆序命中时按钮优先于本层）。
        this.blocker = new Node('blocker');
        this.blocker.parent = this.node;
        inheritLayer(this.blocker, this.node);
        this.blocker.setSiblingIndex(1);
        const bu = this.blocker.addComponent(UITransform);
        bu.setAnchorPoint(0.5, 0.5);
        bu.setContentSize(2000, 3000);

        this.node.active = false;
    }

    show(): void {
        if (this.visible) return;
        this.visible = true;
        this.node.active = true;
        const parent = this.node.parent;
        if (parent) {
            // 启动屏未销毁时会挡在最上层，导致「继续游戏」点不动。
            const splash = parent.getChildByName('Splash');
            if (splash?.isValid) splash.destroy();
            this.node.setSiblingIndex(parent.children.length - 1);
        }
        Modal.open();
        this._unregBlocker = TapBus.add(this.blocker, () => { /* 吸收，不关闭 */ });
        this.rebuild();
    }

    hide(): void {
        if (!this.visible) return;
        this.visible = false;
        if (this._unregBlocker) { this._unregBlocker(); this._unregBlocker = null; }
        Modal.close();
        // 销毁菜单节点，彻底注销 TapBus 注册，避免隐藏后仍拦截顶栏/弹窗点击。
        this.node.destroy();
    }

    private rebuild(): void {
        // 保留 bg + blocker，销毁其余 UI 子节点。
        for (let i = this.node.children.length - 1; i >= 0; i--) {
            const ch = this.node.children[i];
            if (ch !== this.blocker && ch.name !== 'menuBg') ch.destroy();
        }

        const root = this.node;
        label(root, 'OPEN BLOCK', 72, 0, 430, new Color(120, 220, 255, 255));
        label(root, t('menu.tagline'), 26, 0, 362, new Color(150, 170, 200, 255));
        label(root, t('hud.best', { n: this.opts.best }), 30, 0, 292, new Color(220, 228, 240, 255));

        // 主 CTA：有存档则「继续」，否则「开始」。
        const cta = this.opts.resumable ? t('menu.continue') : t('menu.start');
        const ctaBtn = button(root, cta, 0, 48, 38, () => {
            this.hide();
            this.opts.onPlay(this.selected);
        }, new Color(45, 120, 210, 255), { primary: true, minWidth: 360, height: 94 });
        // 保证主按钮绘制/命中在最上层（高于 blocker 与启动残留层）。
        ctaBtn.node.setSiblingIndex(this.node.children.length - 1);

        const defs: Array<{ label: string; cb: () => void }> = [];
        defs.push({ label: '🎨 ' + t('btn.skin'), cb: () => this.opts.onSkin() });
        defs.push({ label: '📖 ' + t('btn.lore'), cb: () => this.opts.onLore() });
        defs.push({ label: '📺 ' + t('btn.replay'), cb: () => this.opts.onReplay() });
        defs.push({ label: '📅 ' + t('btn.daily'), cb: () => this.opts.onMeta() });
        if (this.opts.onLeaderboard) defs.push({ label: '🏆', cb: () => this.opts.onLeaderboard!() });
        if (this.opts.onWheel) defs.push({ label: '🎡', cb: () => this.opts.onWheel!() });
        const sStep = 180;
        const sStart = -((defs.length - 1) * sStep) / 2;
        defs.forEach((d, i) => {
            button(root, d.label, sStart + i * sStep, -110, 24, d.cb, new Color(40, 48, 66, 255), { minWidth: 150 });
        });
    }
}
