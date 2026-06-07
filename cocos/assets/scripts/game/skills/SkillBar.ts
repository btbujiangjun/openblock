import { _decorator, Component, Node, Label, UITransform, Color, Graphics } from 'cc';
import { SKILL_ORDER, SKILLS, SkillId, Wallet } from '../../core';
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
    private static readonly GLASS = new Color(255, 255, 255, 34);       // 主体半透明白（≈0.13）
    private static readonly GLASS_HI = new Color(255, 255, 255, 48);    // 顶部内高光
    private static readonly BORDER = new Color(255, 255, 255, 46);      // 细描边（≈0.18）
    private static readonly DISABLED_BG = new Color(8, 12, 24, 150);    // 不可负担暗底
    private static readonly DISABLED_BORDER = new Color(255, 255, 255, 20);
    private static readonly ACTIVE_BG = new Color(72, 132, 226, 235);
    private static readonly ACTIVE_BORDER = new Color(140, 190, 255, 255);
    private static readonly BADGE_OK = new Color(34, 197, 94, 240);     // 可负担=绿 #22c55e
    private static readonly BADGE_NO = new Color(82, 92, 112, 230);     // 不可负担=灰
    private static readonly ICON_ON = new Color(255, 255, 255, 235);
    private static readonly ICON_OFF = new Color(255, 255, 255, 92);

    setup(onActivate: (id: SkillId) => void, wallet: Wallet): void {
        this.onActivate = onActivate;
        this.wallet = wallet;
        this.build();
        // 钱包任意通货变更（宝箱入账 / 技能消耗）即时刷新徽章余额。
        // 放在 build() 之后注册：build 会清空 _unregs，故钱包监听单独存放。
        this._walletUnreg?.();
        this._walletUnreg = wallet.onAnyChange(() => this.refresh());
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

            this.slots.push({ id, node: n, icon, bg, badge });
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
            g.fillColor = SkillBar.ACTIVE_BG;
            g.roundRect(-half, -half, SLOT, SLOT, RADIUS);
            g.fill();
            g.lineWidth = 2.4;
            g.strokeColor = SkillBar.ACTIVE_BORDER;
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

    /** 依据钱包道具余额刷新每个技能槽的可用态与数量徽章。 */
    refresh(): void {
        for (const s of this.slots) {
            const kind = SKILLS[s.id].tokenKind;
            // aim 无消耗 → 始终可用；其余按余额（库存 + 当日免费）判定。
            const count = kind && this.wallet ? this.wallet.getBalance(kind) : 0;
            const affordable = kind ? count > 0 : true;
            const active = this.activeId === s.id;
            this.drawBg(s, active, affordable);
            s.icon.color = (affordable || active) ? SkillBar.ICON_ON : SkillBar.ICON_OFF;
            if (s.badge) {
                // 余额为 0 时隐藏徽章（对齐 web 0 不显数字），否则显示数量（>99 显示 99+）。
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
}
