import { _decorator, Component, Node, Label, UITransform, Color, Graphics } from 'cc';
import { MetaState, Wallet, MissionId, Progression, DailyState, SeasonPass, AchievementState, t } from '../../core';
import { Modal, TapBus, button } from './uiKit';

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
    private _unregBlocker: (() => void) | null = null;

    /** 注入 P1 档案系统（等级/每日菜单/赛季通行证/成就），用于面板展示与领取。 */
    setExtra(progression: Progression, daily: DailyState, seasonPass: SeasonPass, achievements: AchievementState): void {
        this.progression = progression;
        this.daily = daily;
        this.seasonPass = seasonPass;
        this.achievements = achievements;
    }

    setup(meta: MetaState, wallet: Wallet, onChange: () => void): void {
        this.meta = meta;
        this.wallet = wallet;
        this.onChange = onChange;

        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(560, 720);
        uit.setAnchorPoint(0.5, 0.5);

        // 全屏吸收层（不绘制，仅用于 TapBus 命中拦截）：面板打开时拦下面板外的点击，
        // 避免点穿到顶栏按钮/盘面；面板自身按钮在 rebuild 后注册、命中优先级更高。
        this.blocker = new Node('blocker');
        this.blocker.parent = this.node;
        this.blocker.setSiblingIndex(0);
        this.blocker.addComponent(UITransform).setContentSize(2000, 3000);
        this.blocker.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);

        const bg = this.node.addComponent(Graphics);
        bg.fillColor = new Color(12, 16, 28, 240);
        bg.roundRect(-280, -360, 560, 720, 20);
        bg.fill();

        this.content = new Node('content');
        this.content.parent = this.node;
        this.content.addComponent(UITransform).setAnchorPoint(0.5, 0.5);

        this.node.active = false;
    }

    toggle(): void {
        if (this.visible) { this.hide(); return; }
        this.visible = true;
        this.node.active = true;
        // 视为模态：暂停盘面输入与计时，并注册吸收层（注册早于面板按钮 → 按钮命中优先）。
        Modal.open();
        this._unregBlocker = TapBus.add(this.blocker, () => { /* 吸收，不关闭 */ });
        this.rebuild();
    }

    hide(): void {
        if (!this.visible) return;
        this.visible = false;
        this.node.active = false;
        if (this._unregBlocker) { this._unregBlocker(); this._unregBlocker = null; }
        Modal.close();
    }

    private rebuild(): void {
        this.content.removeAllChildren();
        let y = 320;
        this.text('每日 / 赛季', 32, y, new Color(255, 255, 255, 255));
        y -= 50;

        if (this.progression) {
            this.text(t('level.label', { n: this.progression.level }) + `  ${this.progression.xp}/${this.progression.need()}`, 22, y, new Color(180, 230, 255, 255));
            y -= 46;
        }

        // 签到（同时驱动月度里程碑）
        const canCheckin = this.meta.canCheckin();
        this.text(`${t('daily.checkin')} · ${t('daily.streak', { n: this.meta.streak })}`, 22, y, new Color(220, 225, 235, 255), -120);
        this.button(canCheckin ? t('btn.claim') : '✓', 22, 200, y, () => {
            if (!this.meta.canCheckin()) return;
            const reward = this.meta.checkin();
            if (reward > 0) this.wallet.earn(reward);
            if (this.daily) {
                this.daily.checkin();
                const milestone = this.daily.monthlyMilestone();
                if (milestone > 0) this.wallet.earn(milestone);
            }
            this.commit();
            this.rebuild();
        }, { disabled: !canCheckin, primary: canCheckin });
        y -= 56;

        // 每日菜单
        if (this.daily) {
            const dish = this.daily.getDish();
            const ready = dish.progress >= dish.targetLines;
            this.text(`${t('daily.dish')} ${Math.min(dish.progress, dish.targetLines)}/${dish.targetLines}`, 20, y, new Color(200, 230, 200, 255), -120);
            this.button(dish.claimed ? '✓' : ready ? `+${dish.reward}` : '…', 20, 200, y, () => {
                const r = this.daily!.claimDish();
                if (r > 0) { this.wallet.earn(r); this.commit(); this.rebuild(); }
            }, { disabled: dish.claimed || !ready, primary: ready && !dish.claimed });
            y -= 52;
        }

        // 任务
        this.text('今日任务', 26, y, new Color(255, 255, 255, 255));
        y -= 48;
        for (const m of this.meta.missions) {
            this.text(`${m.name}  ${Math.min(m.progress, m.target)}/${m.target}`, 20, y - 4, new Color(200, 206, 218, 255), -120);
            const done = m.progress >= m.target;
            const label = m.claimed ? '已领' : done ? `+${m.reward}` : '进行中';
            this.button(label, 20, 200, y, () => {
                const reward = this.meta.claimMission(m.id as MissionId);
                if (reward > 0) {
                    this.wallet.earn(reward);
                    this.commit();
                    this.rebuild();
                }
            }, { disabled: m.claimed || !done, primary: done && !m.claimed, minWidth: 120 });
            y -= 52;
        }

        y -= 12;
        // 赛季通行证（可一键领取已解锁免费奖励）
        if (this.seasonPass) {
            this.text(`${t('season.title')} · ${t('season.tier', { n: this.seasonPass.tier })}`, 22, y, new Color(180, 220, 255, 255), -120);
            this.button(t('btn.claim'), 20, 200, y, () => {
                const r = this.seasonPass!.claimAllFree();
                if (r > 0) { this.wallet.earn(r); this.commit(); this.rebuild(); }
            });
            y -= 52;
        } else {
            this.text(`赛季等级 Lv.${this.meta.seasonLevel()}  ·  ${this.meta.seasonPoints} 分`, 22, y, new Color(180, 220, 255, 255));
            y -= 52;
        }

        // 成就进度
        if (this.achievements) {
            const p = this.achievements.progress();
            this.text(`🏅 ${p.unlocked}/${p.total}`, 20, y, new Color(255, 220, 130, 255));
            y -= 52;
        }

        y -= 8;
        this.button(t('btn.close'), 24, 0, y, () => this.hide(), { color: new Color(74, 80, 100, 255), minWidth: 200 });
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

    private button(
        text: string,
        size: number,
        x: number,
        y: number,
        onClick: () => void,
        opts?: { disabled?: boolean; primary?: boolean; color?: Color; minWidth?: number },
    ): void {
        button(this.content, text, x, y, size, onClick, opts?.color, {
            disabled: opts?.disabled,
            primary: opts?.primary,
            minWidth: opts?.minWidth ?? 104,
        });
    }

    private commit(): void {
        if (this.onChange) this.onChange();
    }
}
