import { _decorator, Component, Node, Color, UITransform, UIOpacity, Vec3, tween, Graphics } from 'cc';
import { Modal, dimBg, label, button, closeX, TapBus, inheritLayer } from './uiKit';
import { Motion } from '../platform/Motion';
import { t, CheckInReward, WalletKind } from '../../core';

const { ccclass } = _decorator;

export interface CheckInOptions {
    /** 当前连续签到天数（展示用）。 */
    streak: number;
    /** 今日将落在周期的第几天（1..7）。 */
    nextDay: number;
    /** 今日是否已签到。 */
    alreadyClaimed: boolean;
    /** 7 日奖励 token 礼包表（对齐 web REWARDS）。 */
    rewards: CheckInReward[];
    /** 领取今日奖励（由上层执行 meta.checkin + 入账 + 持久化）。 */
    onClaim: () => void;
    /** 关闭回调（如刷新 MetaPanel）。 */
    onClose?: () => void;
}

/** token → 紧凑展示 emoji（签到格空间有限，用 emoji×数量 表达礼包）。 */
const TOKEN_EMOJI: Record<WalletKind, string> = {
    hintToken: '💡', undoToken: '↩️', bombToken: '💣', rainbowToken: '🌈',
    freezeToken: '❄️', previewToken: '👁️', rerollToken: '🎲',
    coin: '🪙', trialPass: '🎁', fragment: '🧩',
};

/** 把签到礼包压成紧凑文案（如「💡2 ↩️2」）；试穿券不入主行，由大奖标签展示。 */
function compactReward(reward: CheckInReward): string {
    const parts: string[] = [];
    for (const k of Object.keys(reward.items) as WalletKind[]) {
        const n = reward.items[k] ?? 0;
        if (n > 0) parts.push(`${TOKEN_EMOJI[k]}${n}`);
    }
    return parts.join(' ');
}

/**
 * 7 日签到日历（对齐 web `#checkin-panel`）：
 *   ┌─────────────────────────────────────────┐
 *   │            每日签到            ×          │
 *   │        连续打卡 N 天                       │
 *   │  ┌──┐ ┌──┐ ┌──┐ ┌──┐                      │
 *   │  │D1│ │D2│ │D3│ │D4│   每格：第N天 + 🪙X   │
 *   │  └──┘ └──┘ └──┘ └──┘   已签✓ / 今日高亮     │
 *   │     ┌──┐ ┌──┐ ┌──┐                        │
 *   │     │D5│ │D6│ │D7🏆                        │
 *   │     └──┘ └──┘ └──┘                        │
 *   │          [ 领取今日奖励 ]                   │
 *   └─────────────────────────────────────────┘
 */
@ccclass('CheckInPanel')
export class CheckInPanel extends Component {
    private onCloseCb: (() => void) | null = null;
    private _unregDim: (() => void) | null = null;
    private _unregClose: (() => void) | null = null;
    private _closed = false;

    private static readonly W = 640;
    private static readonly H = 560;
    private static readonly CELL_W = 140;
    private static readonly CELL_H = 150;
    private static readonly ACCENT = new Color(56, 189, 248, 255);

    static show(parent: Node, opts: CheckInOptions): CheckInPanel {
        const root = new Node('CheckInPanel');
        root.parent = parent;
        root.layer = parent.layer;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const panel = root.addComponent(CheckInPanel);
        try {
            panel.build(opts);
        } catch (err) {
            console.warn('[OpenBlock] CheckInPanel.build failed', err);
            try { panel.close(); } catch { /* best effort */ }
            throw err;
        }
        if (!Motion.reduced) {
            const op = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
            op.opacity = 0;
            root.setScale(new Vec3(0.92, 0.92, 1));
            tween(op).to(0.18, { opacity: 255 }, { easing: 'cubicOut' }).start();
            tween(root).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
        return panel;
    }

    private build(opts: CheckInOptions): void {
        Modal.open();
        this.onCloseCb = opts.onClose ?? null;

        const w = CheckInPanel.W;
        const h = CheckInPanel.H;
        const dim = dimBg(this.node, 2000, 3000, 245);
        dim.getComponent(UITransform)!.setContentSize(2000, 3000);
        this._unregDim = TapBus.add(dim, () => this.close());

        const c = this.panelCard(this.node, w, h);
        label(c, t('checkin.title'), 36, 0, h / 2 - 56, new Color(255, 220, 130, 255));
        label(c, t('checkin.sub', { n: opts.streak }), 20, 0, h / 2 - 96, new Color(190, 200, 218, 255));

        // 两行网格：第 1 行 4 格、第 2 行 3 格（居中）
        const rewards = opts.rewards;
        const stepX = CheckInPanel.CELL_W + 12;
        const rowGap = CheckInPanel.CELL_H + 16;
        const row1Y = h / 2 - 96 - 110;
        const row2Y = row1Y - rowGap;
        const row1Xs = [-1.5, -0.5, 0.5, 1.5].map((k) => k * stepX);
        const row2Xs = [-1, 0, 1].map((k) => k * stepX);
        for (let day = 1; day <= 7; day++) {
            const reward = rewards[(day - 1) % rewards.length];
            const rewardText = reward ? compactReward(reward) : '';
            const claimed = opts.nextDay > day || (opts.alreadyClaimed && opts.nextDay === day);
            const today = !opts.alreadyClaimed && opts.nextDay === day;
            const x = day <= 4 ? row1Xs[day - 1] : row2Xs[day - 5];
            const y = day <= 4 ? row1Y : row2Y;
            this.drawCell(c, x, y, day, rewardText, { claimed, today, grand: day === 7 });
        }

        const claimY = -h / 2 + 56;
        button(c, opts.alreadyClaimed ? t('checkin.claimed') : t('checkin.claimToday'), 0, claimY, 26,
            () => { if (!opts.alreadyClaimed) { opts.onClaim(); } this.close(); },
            opts.alreadyClaimed ? new Color(74, 80, 100, 255) : new Color(70, 130, 90, 255),
            { primary: !opts.alreadyClaimed, disabled: opts.alreadyClaimed, minWidth: 320 });

        this._unregClose = closeX(c, w / 2 - 44, h / 2 - 44, () => this.close());
    }

    /** 不透明实体背板：避免签到日历文字/格子直接浮在棋盘上造成混乱。 */
    private panelCard(parent: Node, w: number, h: number): Node {
        const n = new Node('checkinCard');
        n.parent = parent;
        inheritLayer(n, parent);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(18, 24, 38, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 24);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(92, 110, 150, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 24);
        g.stroke();
        // 顶部轻微亮带，让标题区域与格子区分层。
        g.fillColor = new Color(255, 255, 255, 14);
        g.roundRect(-w / 2 + 10, h / 2 - 112, w - 20, 92, 20);
        g.fill();
        return n;
    }

    /** 绘制单个签到格（rounded card + 第N天 + token 礼包 + 状态标记）。 */
    private drawCell(parent: Node, x: number, y: number, day: number, rewardText: string,
        st: { claimed: boolean; today: boolean; grand: boolean }): void {
        const cw = CheckInPanel.CELL_W;
        const ch = CheckInPanel.CELL_H;
        const n = new Node(`cell${day}`);
        n.parent = parent;
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        const r = 14;
        // 底色：大奖金棕、已领暗、常态深蓝
        const bg = st.grand ? new Color(86, 66, 22, 255)
            : st.claimed ? new Color(28, 32, 44, 255)
                : new Color(40, 46, 62, 255);
        g.fillColor = bg;
        g.roundRect(-cw / 2, -ch / 2, cw, ch, r);
        g.fill();
        // 顶部高光
        g.fillColor = new Color(255, 255, 255, st.claimed ? 8 : 18);
        g.roundRect(-cw / 2 + 4, ch / 2 - ch * 0.34, cw - 8, ch * 0.26, r * 0.6);
        g.fill();
        // 边框：今日强调色，大奖金色，其余中性
        g.lineWidth = st.today ? 3 : 2;
        g.strokeColor = st.today ? CheckInPanel.ACCENT
            : st.grand ? new Color(245, 207, 107, 255)
                : new Color(80, 92, 116, 200);
        g.roundRect(-cw / 2, -ch / 2, cw, ch, r);
        g.stroke();

        const dim = st.claimed;
        label(n, t('checkin.day', { n: day }), 18, 0, ch / 2 - 26,
            dim ? new Color(150, 158, 172, 255) : new Color(214, 222, 236, 255));
        label(n, rewardText, st.grand ? 20 : 22, 0, 6,
            dim ? new Color(150, 158, 172, 255) : new Color(255, 215, 120, 255));
        if (st.grand) {
            label(n, t('checkin.grandTag'), 15, 0, -ch / 2 + 24, new Color(255, 226, 150, 255));
        }
        if (st.claimed) {
            label(n, '✓', 40, 0, -2, new Color(120, 220, 150, 230));
        }
    }

    close(): void {
        if (this._closed) return;
        this._closed = true;
        Modal.close();
        if (this._unregDim) { this._unregDim(); this._unregDim = null; }
        if (this._unregClose) { this._unregClose(); this._unregClose = null; }
        try { if (this.onCloseCb) this.onCloseCb(); } catch (err) { console.warn('[OpenBlock] CheckInPanel onClose', err); }
        if (this.node?.isValid) this.node.destroy();
    }
}
