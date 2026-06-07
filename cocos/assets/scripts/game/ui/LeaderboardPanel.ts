import { _decorator, Component, Node, Color, UITransform, Graphics, UIOpacity, Vec3, tween } from 'cc';
import { RankEntry } from '../platform/Leaderboard';
import { Modal, dimBg, label, closeX, TapBus, inheritLayer } from './uiKit';
import { Motion } from '../platform/Motion';
import { t } from '../../core';

const { ccclass } = _decorator;

export interface LeaderboardPanelOptions {
    entries: RankEntry[];
    onClose?: () => void;
}

/** 排行榜专用面板：对齐 web monetization `.mon-panel` / `.mon-lb-row` 风格。 */
@ccclass('LeaderboardPanel')
export class LeaderboardPanel extends Component {
    private _unregDim: (() => void) | null = null;
    private _unregClose: (() => void) | null = null;
    private _closed = false;
    private onCloseCb: (() => void) | null = null;

    private static readonly W = 620;
    private static readonly H = 700;

    static show(parent: Node, opts: LeaderboardPanelOptions): LeaderboardPanel {
        const root = new Node('LeaderboardPanel');
        root.parent = parent;
        root.layer = parent.layer;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const panel = root.addComponent(LeaderboardPanel);
        panel.build(opts);
        if (!Motion.reduced) {
            const op = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
            op.opacity = 0;
            root.setScale(new Vec3(0.94, 0.94, 1));
            tween(op).to(0.18, { opacity: 255 }, { easing: 'cubicOut' }).start();
            tween(root).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
        return panel;
    }

    private build(opts: LeaderboardPanelOptions): void {
        Modal.open();
        this.onCloseCb = opts.onClose ?? null;

        const dim = dimBg(this.node, 2000, 3000, 230);
        this._unregDim = TapBus.add(dim, () => this.close());

        const c = this.card(this.node);
        this._unregClose = closeX(c, LeaderboardPanel.W / 2 - 36, LeaderboardPanel.H / 2 - 38, () => this.close());

        label(c, `🏆 ${t('rank.title')}`, 34, 0, LeaderboardPanel.H / 2 - 58, new Color(255, 220, 130, 255));
        const entries = opts.entries.slice(0, 10);
        if (!entries.length) {
            label(c, t('rank.empty'), 24, 0, 40, new Color(148, 163, 184, 255));
            return;
        }

        let y = LeaderboardPanel.H / 2 - 130;
        entries.forEach((entry, i) => {
            this.row(c, entry, i + 1, y);
            y -= 54;
        });
    }

    private card(parent: Node): Node {
        const n = new Node('leaderboardCard');
        n.parent = parent;
        inheritLayer(n, parent);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        const w = LeaderboardPanel.W;
        const h = LeaderboardPanel.H;
        g.fillColor = new Color(24, 30, 44, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 22);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(90, 110, 150, 235);
        g.roundRect(-w / 2, -h / 2, w, h, 22);
        g.stroke();
        // header 分隔线
        g.fillColor = new Color(255, 255, 255, 12);
        g.rect(-w / 2, h / 2 - 96, w, 1.5);
        g.fill();
        return n;
    }

    private row(parent: Node, e: RankEntry, rank: number, y: number): void {
        const n = new Node(`rank-${rank}`);
        n.parent = parent;
        inheritLayer(n, parent);
        n.setPosition(0, y, 0);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        const w = LeaderboardPanel.W - 48;
        const h = 48;
        const isMe = !!e.you;
        g.fillColor = isMe ? new Color(56, 189, 248, 32) : new Color(255, 255, 255, 10);
        g.roundRect(-w / 2, -h / 2, w, h, 10);
        g.fill();
        if (isMe) {
            g.fillColor = new Color(56, 189, 248, 255);
            g.rect(-w / 2, -h / 2, 4, h);
            g.fill();
        }
        const rankText = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `#${rank}`;
        label(n, rankText, 20, -w / 2 + 38, 0, new Color(148, 163, 184, 255));
        label(n, isMe ? t('rank.you') : this.safeName(e.name), 20, -90, 0, new Color(210, 220, 238, 255));
        label(n, `${e.score}`, 24, w / 2 - 70, 0, new Color(56, 189, 248, 255));
    }

    private safeName(name: string): string {
        const s = String(name || 'Player');
        return s.length > 12 ? `${s.slice(0, 10)}…` : s;
    }

    close(): void {
        if (this._closed) return;
        this._closed = true;
        Modal.close();
        if (this._unregDim) { this._unregDim(); this._unregDim = null; }
        if (this._unregClose) { this._unregClose(); this._unregClose = null; }
        try { this.onCloseCb?.(); } catch { /* ignore */ }
        if (this.node?.isValid) this.node.destroy();
    }
}
