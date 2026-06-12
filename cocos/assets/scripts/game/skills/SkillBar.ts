import { _decorator, Component, Node, Label, UITransform, Color, Graphics, tween, Tween, UIOpacity, Vec3, v3 } from 'cc';
import { SKILL_ORDER, SKILLS, SkillId, Wallet, WalletKind, WalletChangeDetail } from '../../core';
import { TapBus, bindEngineClick, inheritLayer } from '../ui/uiKit';

const { ccclass } = _decorator;

const SLOT = 54;
const GAP = 78;
const RADIUS = 12;

interface SlotRef {
    id: SkillId;
    node: Node;
    icon: Label;
    bg: Graphics;
    badge: { node: Node; g: Graphics; lbl: Label } | null;
    /** 上一次展示的余额，用于 count-up 动效起始值。 */
    prevCount: number;
}

// web `.skill-btn--*` 的极淡描边色调（hint=绿 / restart 类=橙），其余中性。
const TINT: Partial<Record<SkillId, Color>> = {
    hint: new Color(74, 222, 128, 110),
    reroll: new Color(251, 146, 60, 100),
};

/**
 * 技能栏（对齐 web PC `.skill-bar` / `.skill-btn`）：
 *   · 半透明亮色玻璃胶囊（白渐变 0.22→0.08 + 内高光 + 细描边），圆角 10；
 *   · 右上角小圆 badge 显示**道具余额**（含每日免费配额，对齐 web `wallet.getBalance`）；
 *   · 余额为 0 / 无道具时置灰禁用，选中态蓝光描边；aim 无消耗、始终可用且不显徽章。
 */
@ccclass('SkillBar')
export class SkillBar extends Component {
    private slots: SlotRef[] = [];
    private onActivate: ((id: SkillId) => void) | null = null;
    private activeId: SkillId | null = null;
    private wallet: Wallet | null = null;
    private _unregs: Array<() => void> = [];
    private _walletUnreg: (() => void) | null = null;

    // 配色（与 web main.css .skill-btn 对齐）
    private static readonly GLASS = new Color(255, 255, 255, 34);
    private static readonly GLASS_HI = new Color(255, 255, 255, 48);
    private static readonly BORDER = new Color(255, 255, 255, 46);
    private static readonly DISABLED_BG = new Color(8, 12, 24, 150);
    private static readonly DISABLED_BORDER = new Color(255, 255, 255, 20);
    private static readonly BADGE_OK = new Color(34, 197, 94, 240);
    private static readonly BADGE_NO = new Color(82, 92, 112, 230);
    private static readonly ICON_ON = new Color(255, 255, 255, 235);
    private static readonly ICON_OFF = new Color(255, 255, 255, 92);
    /** 激活态按钮底色 / 描边色 —— 跟随皮肤 accent，由 setSkinAccent() 更新。 */
    private _activeBg = new Color(72, 132, 226, 235);
    private _activeBorder = new Color(140, 190, 255, 255);

    /** 皮肤切换时更新按钮激活态配色（accent → 底色，accent lighten → 描边）。 */
    setSkinAccent(accent: Color, accentDark: Color): void {
        this._activeBg = new Color(accent.r, accent.g, accent.b, 235);
        this._activeBorder = new Color(
            Math.min(255, accent.r + 68), Math.min(255, accent.g + 58), Math.min(255, accent.b + 30), 255,
        );
        if (this.activeId) this.refresh();
    }

    setup(onActivate: (id: SkillId) => void, wallet: Wallet): void {
        this.onActivate = onActivate;
        this.wallet = wallet;
        this.build();
        this._walletUnreg?.();
        this._walletUnreg = wallet.onAnyChange((detail: WalletChangeDetail) => this.refreshWithDetail(detail));
    }

    private build(): void {
        this.node.removeAllChildren();
        for (const u of this._unregs) u();
        this._unregs = [];
        this.slots = [];
        const startX = -((SKILL_ORDER.length - 1) * GAP) / 2;
        SKILL_ORDER.forEach((id, i) => {
            const def = SKILLS[id];
            const n = new Node(`skill-${id}`);
            n.parent = this.node;
            inheritLayer(n, this.node);
            const uit = n.addComponent(UITransform);
            uit.setContentSize(SLOT, SLOT);
            uit.setAnchorPoint(0.5, 0.5);
            n.setPosition(startX + i * GAP, 0, 0);

            const bg = n.addComponent(Graphics);

            const iconNode = new Node('icon');
            iconNode.parent = n;
            inheritLayer(iconNode, n);
            iconNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            iconNode.setPosition(0, 0, 0);
            const icon = iconNode.addComponent(Label);
            icon.string = def.icon;
            icon.fontSize = 27;

            // 余额 badge（右上角小圆）：有消耗道具的技能才显示（aim 无 tokenKind 不显示）
            let badge: SlotRef['badge'] = null;
            if (def.tokenKind) {
                const bn = new Node('cost');
                bn.parent = n;
                inheritLayer(bn, n);
                const bt = bn.addComponent(UITransform);
                bt.setAnchorPoint(0.5, 0.5);
                bt.setContentSize(20, 16);
                bn.setPosition(SLOT / 2 - 4, SLOT / 2 - 4, 0);
                const bg2 = bn.addComponent(Graphics);
                const blbl = new Node('n');
                blbl.parent = bn;
                inheritLayer(blbl, bn);
                blbl.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
                blbl.setPosition(0, 0, 0);
                const l = blbl.addComponent(Label);
                l.string = '0';
                l.fontSize = 12;
                l.color = new Color(255, 255, 255, 255);
                badge = { node: bn, g: bg2, lbl: l };
            }

            const fire = () => { if (this.onActivate) this.onActivate(id); };
            this._unregs.push(TapBus.add(n, fire));
            this._unregs.push(bindEngineClick(n, fire));

            this.slots.push({ id, node: n, icon, bg, badge, prevCount: 0 });
        });
        this.refresh();
    }

    onDestroy(): void {
        for (const u of this._unregs) u();
        this._unregs = [];
        this._walletUnreg?.();
        this._walletUnreg = null;
    }

    private drawBg(s: SlotRef, active: boolean, affordable: boolean): void {
        const g = s.bg;
        g.clear();
        const half = SLOT / 2;
        if (active) {
            g.fillColor = this._activeBg;
            g.roundRect(-half, -half, SLOT, SLOT, RADIUS);
            g.fill();
            g.lineWidth = 2.4;
            g.strokeColor = this._activeBorder;
            g.roundRect(-half, -half, SLOT, SLOT, RADIUS);
            g.stroke();
            return;
        }
        if (!affordable) {
            g.fillColor = SkillBar.DISABLED_BG;
            g.roundRect(-half, -half, SLOT, SLOT, RADIUS);
            g.fill();
            g.lineWidth = 1;
            g.strokeColor = SkillBar.DISABLED_BORDER;
            g.roundRect(-half, -half, SLOT, SLOT, RADIUS);
            g.stroke();
            return;
        }
        // 可负担：半透明亮色玻璃 + 顶部内高光 + 细描边（web .skill-btn）
        g.fillColor = SkillBar.GLASS;
        g.roundRect(-half, -half, SLOT, SLOT, RADIUS);
        g.fill();
        g.fillColor = SkillBar.GLASS_HI;
        g.roundRect(-half + 3, half - SLOT * 0.46, SLOT - 6, SLOT * 0.40, RADIUS * 0.7);
        g.fill();
        g.lineWidth = 1.2;
        g.strokeColor = TINT[s.id] || SkillBar.BORDER;
        g.roundRect(-half, -half, SLOT, SLOT, RADIUS);
        g.stroke();
    }

    private drawBadge(badge: NonNullable<SlotRef['badge']>, affordable: boolean): void {
        const g = badge.g;
        g.clear();
        const w = 20;
        const h = 16;
        g.fillColor = affordable ? SkillBar.BADGE_OK : SkillBar.BADGE_NO;
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fill();
        g.lineWidth = 1;
        g.strokeColor = new Color(0, 0, 0, 70);
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.stroke();
        badge.lbl.color = affordable ? new Color(255, 255, 255, 255) : new Color(220, 224, 232, 255);
    }

    setActive(id: SkillId | null): void {
        this.activeId = id;
        this.refresh();
    }

    /** 钱包变更带明细刷新：根据 detail 的 action/kind 驱动对应槽位的动效。 */
    private refreshWithDetail(detail: WalletChangeDetail): void {
        for (const s of this.slots) {
            const kind = SKILLS[s.id].tokenKind as WalletKind | undefined;
            const count = kind && this.wallet ? this.wallet.getBalance(kind) : 0;
            const affordable = kind ? count > 0 : true;
            const active = this.activeId === s.id;
            this.drawBg(s, active, affordable);
            s.icon.color = (affordable || active) ? SkillBar.ICON_ON : SkillBar.ICON_OFF;
            if (!s.badge || !kind) continue;
            const isTarget = detail.kind === kind;
            const oldCount = s.prevCount;
            s.prevCount = count;
            if (count > 0) {
                s.badge.node.active = true;
                this.drawBadge(s.badge, affordable);
                if (isTarget && detail.action === 'add' && detail.amount > 0) {
                    this.animateBadgeGain(s.badge, oldCount, count, s.node);
                } else if (isTarget && detail.action === 'spend') {
                    this.animateBadgeDrain(s.badge, oldCount, count);
                } else {
                    s.badge.lbl.string = count > 99 ? '99+' : `${count}`;
                }
            } else if (oldCount > 0 && isTarget) {
                this.animateBadgeDrain(s.badge, oldCount, 0);
                this.scheduleNode(0.65, () => {
                    if (s.badge && count <= 0) s.badge.node.active = false;
                });
            } else {
                s.badge.node.active = false;
            }
        }
    }

    /** 依据钱包道具余额刷新每个技能槽的可用态与数量徽章（无动效版，用于初始化/激活态切换）。 */
    refresh(): void {
        for (const s of this.slots) {
            const kind = SKILLS[s.id].tokenKind as WalletKind | undefined;
            const count = kind && this.wallet ? this.wallet.getBalance(kind) : 0;
            const affordable = kind ? count > 0 : true;
            const active = this.activeId === s.id;
            this.drawBg(s, active, affordable);
            s.icon.color = (affordable || active) ? SkillBar.ICON_ON : SkillBar.ICON_OFF;
            s.prevCount = count;
            if (s.badge) {
                if (count > 0) {
                    s.badge.node.active = true;
                    s.badge.lbl.string = count > 99 ? '99+' : `${count}`;
                    this.drawBadge(s.badge, affordable);
                } else {
                    s.badge.node.active = false;
                }
            }
        }
    }

    /**
     * 增益动效（对齐 web badgeAnimator badgePopUp + badgeFloatPlus）：
     *   1. badge scale 1→1.38→0.96→1（弹出回弹）
     *   2. count-up 从 oldVal 缓动到 newVal
     *   3. badge 上方飘出 +N 金色文字
     */
    private animateBadgeGain(
        badge: NonNullable<SlotRef['badge']>,
        oldVal: number,
        newVal: number,
        slotNode: Node,
    ): void {
        const fmt = (n: number): string => {
            const v = Math.max(0, Math.round(n));
            return v > 99 ? '99+' : `${v}`;
        };
        // pulse
        Tween.stopAllByTarget(badge.node);
        badge.node.setScale(1, 1, 1);
        tween(badge.node)
            .to(0.24, { scale: v3(1.38, 1.38, 1) }, { easing: 'cubicOut' })
            .to(0.18, { scale: v3(0.96, 0.96, 1) }, { easing: 'cubicInOut' })
            .to(0.12, { scale: v3(1, 1, 1) }, { easing: 'cubicOut' })
            .start();
        // count-up
        const st = { v: oldVal };
        tween(st)
            .to(0.55, { v: newVal }, {
                easing: 'quadOut',
                onUpdate: () => { badge.lbl.string = fmt(st.v); },
            })
            .call(() => { badge.lbl.string = fmt(newVal); })
            .start();
        // float +N
        const delta = newVal - oldVal;
        if (delta > 0) this.spawnFloatPlus(slotNode, delta);
    }

    /** 消耗动效（对齐 web badgePopDown）：badge scale 1→0.78→1。 */
    private animateBadgeDrain(
        badge: NonNullable<SlotRef['badge']>,
        oldVal: number,
        newVal: number,
    ): void {
        const fmt = (n: number): string => {
            const v = Math.max(0, Math.round(n));
            return v > 99 ? '99+' : `${v}`;
        };
        Tween.stopAllByTarget(badge.node);
        badge.node.setScale(1, 1, 1);
        tween(badge.node)
            .to(0.18, { scale: v3(0.78, 0.78, 1) }, { easing: 'quadOut' })
            .to(0.22, { scale: v3(1, 1, 1) }, { easing: 'cubicOut' })
            .start();
        const st = { v: oldVal };
        tween(st)
            .to(0.45, { v: newVal }, {
                easing: 'quadOut',
                onUpdate: () => { badge.lbl.string = fmt(st.v); },
            })
            .call(() => { badge.lbl.string = fmt(newVal); })
            .start();
    }

    /**
     * 在技能槽上方飘出 "+N" 金色文字（对齐 web `.badge-float-plus` @keyframes badgeFloatPlus）。
     */
    private spawnFloatPlus(slotNode: Node, delta: number): void {
        const parent = slotNode.parent;
        if (!parent?.isValid) return;
        const n = new Node('floatPlus');
        n.parent = parent;
        inheritLayer(n, parent);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const pos = slotNode.position;
        n.setPosition(pos.x, pos.y + SLOT / 2 + 4, 0);
        const op = n.addComponent(UIOpacity);
        op.opacity = 0;
        const l = n.addComponent(Label);
        l.string = `+${delta > 99 ? '99+' : delta}`;
        l.fontSize = 16;
        l.lineHeight = 18;
        l.color = new Color(255, 213, 107, 255);
        (l as unknown as { isBold: boolean }).isBold = true;
        const startY = pos.y + SLOT / 2 + 4;
        n.setScale(0.55, 0.55, 1);
        tween(n)
            .to(0.12, { position: v3(pos.x, startY + 14, 0), scale: v3(1.12, 1.12, 1) }, { easing: 'cubicOut' })
            .to(0.50, { position: v3(pos.x, startY + 38, 0), scale: v3(1, 1, 1) }, { easing: 'cubicOut' })
            .to(0.26, { position: v3(pos.x, startY + 60, 0), scale: v3(0.92, 0.92, 1) }, { easing: 'quadOut' })
            .call(() => n.destroy())
            .start();
        tween(op)
            .to(0.12, { opacity: 255 }, { easing: 'quadOut' })
            .delay(0.50)
            .to(0.26, { opacity: 0 }, { easing: 'quadOut' })
            .start();
    }

    /** 延时执行回调（利用临时节点的 tween，无需 Component 调度）。 */
    private scheduleNode(delaySec: number, fn: () => void): void {
        const timer = new Node('skillBarTimer');
        timer.parent = this.node;
        timer.addComponent(UITransform);
        tween(timer).delay(delaySec).call(() => { fn(); if (timer.isValid) timer.destroy(); }).start();
    }
}
