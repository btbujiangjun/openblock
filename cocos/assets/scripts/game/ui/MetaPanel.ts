import { _decorator, Component, Node, Label, UITransform, Color, Graphics } from 'cc';
import { MetaState, grantCheckinReward, listSkinIds, grantSeasonReward, Wallet, MissionId, Progression, DailyState, SeasonPass, AchievementState, t } from '../../core';
import { Modal, TapBus, button, inheritLayer } from './uiKit';

const { ccclass } = _decorator;

/**
 * 元系统面板（Phase 3）：每日签到 + 任务领取 + 赛季等级。
 * 由 GameController 注入 meta/wallet 与变更回调（用于持久化 + HUD 刷新）。
 */
@ccclass('MetaPanel')
export class MetaPanel extends Component {
    private meta!: MetaState;
    private wallet!: Wallet;
    private onChange: (() => void) | null = null;
    private content!: Node;
    private visible = false;
    private progression: Progression | null = null;
    private daily: DailyState | null = null;
    private seasonPass: SeasonPass | null = null;
    private achievements: AchievementState | null = null;
    private blocker!: Node;
    private overlayRoot: Node | null = null;
    private cardRoot: Node | null = null;
    private _unregBlocker: (() => void) | null = null;
    /** 下钻入口：签到 → 7 日签到日历；赛季 → 赛季通行证轨道（由 GameController 注入）。 */
    private onOpenCheckin: (() => void) | null = null;
    private onOpenSeasonPass: (() => void) | null = null;

    /** 注入 P1 档案系统（等级/每日菜单/赛季通行证/成就），用于面板展示与领取。 */
    setExtra(progression: Progression, daily: DailyState, seasonPass: SeasonPass, achievements: AchievementState): void {
        this.progression = progression;
        this.daily = daily;
        this.seasonPass = seasonPass;
        this.achievements = achievements;
    }

    /** 注入下钻面板入口（签到日历 / 赛季轨道）。设置后，对应行按钮改为「打开专用面板」。 */
    setDrilldowns(onCheckin: () => void, onSeasonPass: () => void): void {
        this.onOpenCheckin = onCheckin;
        this.onOpenSeasonPass = onSeasonPass;
    }

    /** 专用面板关闭后回调：若 MetaPanel 仍打开则重绘（同步最新签到/赛季状态）。 */
    refresh(): void {
        if (this.visible) this.rebuild();
    }

    setup(meta: MetaState, wallet: Wallet, onChange: () => void): void {
        this.meta = meta;
        this.wallet = wallet;
        this.onChange = onChange;

        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        // 常驻节点只作为控制器，不再承载实际渲染。真正面板每次 toggle 时动态创建，
        // 避免隐藏节点/历史 siblingIndex 在真机上造成背板不绘制、只剩文字浮在棋盘上。
        uit.setContentSize(1, 1);
        uit.setAnchorPoint(0.5, 0.5);

        this.node.active = false;
    }

    toggle(): void {
        if (this.visible) { this.hide(); return; }
        this.visible = true;
        this.node.active = true;
        this.buildOverlay();
        // 视为模态：暂停盘面输入与计时，并注册吸收层（注册早于面板按钮 → 按钮命中优先）。
        Modal.open();
        // 提到父节点最上层，确保面板按钮命中优先于顶栏图标。
        const parent = this.overlayRoot?.parent;
        if (parent && this.overlayRoot) this.overlayRoot.setSiblingIndex(parent.children.length - 1);
        this._unregBlocker = TapBus.add(this.blocker, () => { /* 吸收，不关闭 */ });
        this.rebuild();
    }

    hide(): void {
        if (!this.visible) return;
        this.visible = false;
        this.node.active = false;
        if (this._unregBlocker) { this._unregBlocker(); this._unregBlocker = null; }
        Modal.close();
        if (this.overlayRoot?.isValid) this.overlayRoot.destroy();
        this.overlayRoot = null;
        this.cardRoot = null;
    }

    private buildOverlay(): void {
        if (this.overlayRoot?.isValid) this.overlayRoot.destroy();
        const parent = this.node.parent || this.node;
        const root = new Node('MetaPanelOverlay');
        root.parent = parent;
        root.layer = parent.layer;
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this.overlayRoot = root;

        this.blocker = new Node('dim');
        this.blocker.parent = root;
        inheritLayer(this.blocker, root);
        this.blocker.setSiblingIndex(0);
        const bt = this.blocker.addComponent(UITransform);
        bt.setContentSize(2000, 3000);
        bt.setAnchorPoint(0.5, 0.5);
        const dim = this.blocker.addComponent(Graphics);
        dim.fillColor = new Color(0, 0, 0, 245);
        dim.rect(-1000, -1500, 2000, 3000);
        dim.fill();

        const cardNode = new Node('metaCard');
        cardNode.parent = root;
        inheritLayer(cardNode, root);
        this.cardRoot = cardNode;
        const ct = cardNode.addComponent(UITransform);
        ct.setContentSize(560, 720);
        ct.setAnchorPoint(0.5, 0.5);
        const bg = cardNode.addComponent(Graphics);
        bg.fillColor = new Color(18, 24, 38, 255);
        bg.roundRect(-280, -360, 560, 720, 20);
        bg.fill();
        bg.lineWidth = 3;
        bg.strokeColor = new Color(92, 110, 150, 255);
        bg.roundRect(-280, -360, 560, 720, 20);
        bg.stroke();
        bg.fillColor = new Color(255, 255, 255, 14);
        bg.roundRect(-268, 248, 536, 88, 18);
        bg.fill();

        this.content = new Node('content');
        this.content.parent = cardNode;
        inheritLayer(this.content, cardNode);
        this.content.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
    }

    private rebuild(): void {
        this.content.removeAllChildren();
        let y = 318;
        this.text(t('meta.title'), 32, y, new Color(255, 255, 255, 255));
        y -= 62;

        if (this.progression) {
            this.text(t('level.label', { n: this.progression.level }) + `  ${this.progression.xp}/${this.progression.need()}`, 22, y, new Color(180, 230, 255, 255));
            y -= 58;
        }

        // 签到（同时驱动月度里程碑）
        const canCheckin = this.meta.canCheckin();
        this.text(`${t('daily.checkin')} · ${t('daily.streak', { n: this.meta.streak })}`, 22, y, new Color(220, 225, 235, 255), -120);
        if (this.onOpenCheckin) {
            // 下钻：打开 7 日签到日历（对齐 web 独立 `#checkin-panel`）。
            this.button(canCheckin ? t('btn.claim') : '✓', 20, 200, y, () => this.onOpenCheckin!(),
                { primary: canCheckin, disabled: !canCheckin, minWidth: 112 });
        } else {
            this.button(canCheckin ? t('btn.claim') : '✓', 20, 200, y, () => {
                if (!this.meta.canCheckin()) return;
                const res = this.meta.checkin();
                if (res) grantCheckinReward(this.wallet, res.day, res.reward, listSkinIds());
                if (this.daily) {
                    this.daily.checkin();
                    const milestone = this.daily.monthlyMilestone();
                    if (milestone > 0) this.wallet.earn(milestone);
                }
                this.commit();
                this.rebuild();
            }, { disabled: !canCheckin, primary: canCheckin, minWidth: 112 });
        }
        y -= 68;

        // 每日菜单
        if (this.daily) {
            const dish = this.daily.getDish();
            const ready = dish.progress >= dish.targetLines;
            this.text(`${t('daily.dish')} ${Math.min(dish.progress, dish.targetLines)}/${dish.targetLines}`, 20, y, new Color(200, 230, 200, 255), -120);
            this.button(dish.claimed ? '✓' : ready ? `+${dish.reward}` : '…', 18, 200, y, () => {
                const r = this.daily!.claimDish();
                if (r > 0) { this.wallet.earn(r); this.commit(); this.rebuild(); }
            }, { disabled: dish.claimed || !ready, primary: ready && !dish.claimed, minWidth: 104 });
            y -= 64;
        }

        // 任务
        this.text(t('meta.todayMissions'), 26, y, new Color(255, 255, 255, 255));
        y -= 56;
        for (const m of this.meta.missions) {
            this.text(`${m.name}  ${Math.min(m.progress, m.target)}/${m.target}`, 20, y - 4, new Color(200, 206, 218, 255), -120);
            const done = m.progress >= m.target;
            const label = m.claimed ? t('mission.claimed') : done ? `+${m.reward}` : t('mission.inProgress');
            this.button(label, 18, 200, y, () => {
                const reward = this.meta.claimMission(m.id as MissionId);
                if (reward > 0) {
                    this.wallet.earn(reward);
                    this.commit();
                    this.rebuild();
                }
            }, { disabled: m.claimed || !done, primary: done && !m.claimed, minWidth: 104 });
            y -= 62;
        }

        y -= 18;
        // 赛季通行证（可一键领取已解锁免费奖励）
        if (this.seasonPass) {
            this.text(`${this.seasonPass.season.name} · ${t('season.points', { n: this.seasonPass.points })}`, 20, y, new Color(180, 220, 255, 255), -120);
            if (this.onOpenSeasonPass) {
                // 下钻：打开赛季通行证轨道（对齐 web 独立 `#season-pass-panel`）。
                this.button('›', 20, 200, y, () => this.onOpenSeasonPass!(), { primary: true, minWidth: 92 });
            } else {
                this.button(t('btn.claim'), 18, 200, y, () => {
                    const claims = this.seasonPass!.claimAll();
                    if (claims.length) {
                        for (const c of claims) grantSeasonReward(this.wallet, c.reward, c.source);
                        this.commit();
                        this.rebuild();
                    }
                }, { minWidth: 104 });
            }
            y -= 66;
        } else {
            this.text(`赛季等级 Lv.${this.meta.seasonLevel()}  ·  ${this.meta.seasonPoints} 分`, 22, y, new Color(180, 220, 255, 255));
            y -= 66;
        }

        // 成就进度
        if (this.achievements) {
            const p = this.achievements.progress();
            this.text(`🏅 ${p.unlocked}/${p.total}`, 20, y, new Color(255, 220, 130, 255));
        }

        // Close 固定在卡片底部，让内容区更均匀铺满整张浮层。
        this.button(t('btn.close'), 22, 0, -322, () => this.hide(), { color: new Color(74, 80, 100, 255), minWidth: 200 });
    }

    private rowCard(
        y: number,
        title: string,
        sub: string,
        action: { text: string; onClick: () => void; disabled?: boolean; primary?: boolean; minWidth?: number } | null,
    ): void {
        const w = 500;
        const h = 56;
        const n = new Node('rowCard');
        n.parent = this.content;
        inheritLayer(n, this.content);
        n.setPosition(0, y, 0);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(31, 39, 56, 150);
        g.roundRect(-w / 2, -h / 2, w, h, 12);
        g.fill();
        g.lineWidth = 1.2;
        g.strokeColor = new Color(70, 84, 112, 150);
        g.roundRect(-w / 2, -h / 2, w, h, 12);
        g.stroke();

        this.textBox(n, title, 18, -w / 2 + 18, 8, 260, new Color(226, 234, 248, 255), 'left');
        this.textBox(n, sub, 16, -w / 2 + 18, -14, 260, new Color(168, 184, 208, 255), 'left');
        if (action) {
            this.button(action.text, 18, w / 2 - 86, 0, action.onClick, {
                disabled: action.disabled,
                primary: action.primary,
                minWidth: action.minWidth ?? 112,
            });
        }
    }

    private text(s: string, size: number, y: number, color: Color, x = 0): void {
        const n = new Node('t');
        n.parent = this.content;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        n.setPosition(x, y, 0);
        const l = n.addComponent(Label);
        l.string = s;
        l.fontSize = size;
        l.lineHeight = size + 4;
        l.color = color;
    }

    private textBox(
        parent: Node,
        text: string,
        size: number,
        x: number,
        y: number,
        width: number,
        color: Color,
        align: 'left' | 'center' | 'right' = 'left',
    ): Label {
        const n = new Node('tb');
        n.parent = parent;
        inheritLayer(n, parent);
        n.setPosition(x + width / 2, y, 0);
        const uit = n.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(width, size + 8);
        const l = n.addComponent(Label);
        l.string = text;
        l.fontSize = size;
        l.lineHeight = size + 4;
        l.color = color;
        if (Label.HorizontalAlign) {
            l.horizontalAlign = align === 'right'
                ? Label.HorizontalAlign.RIGHT
                : align === 'center'
                    ? Label.HorizontalAlign.CENTER
                    : Label.HorizontalAlign.LEFT;
        }
        if (Label.VerticalAlign) l.verticalAlign = Label.VerticalAlign.CENTER;
        if (Label.Overflow) l.overflow = Label.Overflow.SHRINK;
        return l;
    }

    private button(
        text: string,
        size: number,
        x: number,
        y: number,
        onClick: () => void,
        opts?: { disabled?: boolean; primary?: boolean; color?: Color; minWidth?: number },
    ): void {
        // 本面板的奖励/领取按钮只作为行内操作，不使用强主按钮高光，避免 +60/+20 等数字过强。
        const color = opts?.color ?? (opts?.primary
            ? new Color(48, 86, 122, 225)
            : new Color(54, 62, 82, 220));
        button(this.content, text, x, y, size, onClick, color, {
            disabled: opts?.disabled,
            primary: false,
            minWidth: opts?.minWidth ?? 104,
        });
    }

    private commit(): void {
        if (this.onChange) this.onChange();
    }
}
