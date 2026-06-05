import { _decorator, Component, Node, Label, UITransform, Color, Graphics } from 'cc';
import { SKILL_ORDER, SKILLS, SkillId } from '../../core';
import { TapBus } from '../ui/uiKit';

const { ccclass } = _decorator;

interface SlotRef {
    id: SkillId;
    node: Node;
    label: Label;
    bg: Graphics;
}

/**
 * 技能栏（Phase 3）：读取 core 的 SKILLS 定义渲染图标 + 价格，按金币可负担与
 * 选中态着色；点击回调 onActivate(id)。
 */
@ccclass('SkillBar')
export class SkillBar extends Component {
    private slots: SlotRef[] = [];
    private onActivate: ((id: SkillId) => void) | null = null;
    private activeId: SkillId | null = null;
    private coins = 0;
    private _unregs: Array<() => void> = [];

    setup(onActivate: (id: SkillId) => void): void {
        this.onActivate = onActivate;
        this.build();
    }

    private build(): void {
        this.node.removeAllChildren();
        for (const u of this._unregs) u();
        this._unregs = [];
        this.slots = [];
        const gap = 96;
        const startX = -((SKILL_ORDER.length - 1) * gap) / 2;
        SKILL_ORDER.forEach((id, i) => {
            const def = SKILLS[id];
            const n = new Node(`skill-${id}`);
            n.parent = this.node;
            const uit = n.addComponent(UITransform);
            uit.setContentSize(84, 84);
            uit.setAnchorPoint(0.5, 0.5);
            n.setPosition(startX + i * gap, 0, 0);

            const bg = n.addComponent(Graphics);
            this.drawBg(bg, false, true);

            const iconNode = new Node('icon');
            iconNode.parent = n;
            iconNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            iconNode.setPosition(0, 10, 0);
            const icon = iconNode.addComponent(Label);
            icon.string = def.icon;
            icon.fontSize = 34;

            const costNode = new Node('cost');
            costNode.parent = n;
            costNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            costNode.setPosition(0, -26, 0);
            const cost = costNode.addComponent(Label);
            cost.string = `${def.cost}`;
            cost.fontSize = 18;
            cost.color = new Color(255, 215, 120, 255);

            this._unregs.push(TapBus.add(n, () => {
                if (this.onActivate) this.onActivate(id);
            }));

            this.slots.push({ id, node: n, label: icon, bg });
        });
    }

    onDestroy(): void {
        for (const u of this._unregs) u();
        this._unregs = [];
    }

    private drawBg(g: Graphics, active: boolean, affordable: boolean): void {
        g.clear();
        g.fillColor = active
            ? new Color(80, 130, 220, 230)
            : affordable
                ? new Color(40, 50, 75, 220)
                : new Color(30, 34, 48, 180);
        g.roundRect(-42, -42, 84, 84, 14);
        g.fill();
        if (active) {
            g.strokeColor = new Color(140, 190, 255, 255);
            g.lineWidth = 4;
            g.roundRect(-42, -42, 84, 84, 14);
            g.stroke();
        }
    }

    setActive(id: SkillId | null): void {
        this.activeId = id;
        this.refresh(this.coins);
    }

    refresh(coins: number): void {
        this.coins = coins;
        for (const s of this.slots) {
            const affordable = coins >= SKILLS[s.id].cost;
            this.drawBg(s.bg, this.activeId === s.id, affordable);
            s.label.color = affordable ? new Color(255, 255, 255, 255) : new Color(150, 150, 160, 255);
        }
    }
}
