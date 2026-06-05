import { _decorator, Component, Node, UITransform, Label, Color, tween, Vec3 } from 'cc';
import { getCompanion, t } from '../../core';
import { TapBus, inheritLayer } from '../ui/uiKit';

const { ccclass } = _decorator;

/**
 * 屏上虚拟伙伴（对齐并超出 web companion stub）：随当前皮肤切换外观的浮动 emoji，
 * 待机轻微上下浮动，消行时蹦一下；点击打开伙伴面板。挂在 HUD 之下的空白区。
 */
@ccclass('CompanionView')
export class CompanionView extends Component {
    private iconNode!: Node;
    private icon!: Label;
    // 注意：不要用 `name`，会与基类 Component(CCObject).name 冲突（原生端要求 string，赋 Label 会 CC_ABORT 崩溃）。
    private nameLabel!: Label;
    private onTap: (() => void) | null = null;
    private _unreg: (() => void) | null = null;

    setup(onTap: () => void): void {
        this.onTap = onTap;
        if (this.node.parent) inheritLayer(this.node, this.node.parent);
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(120, 120);

        this.iconNode = new Node('cIcon');
        this.iconNode.parent = this.node;
        this.iconNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this.iconNode.setPosition(0, 14, 0);
        this.icon = this.iconNode.addComponent(Label);
        this.icon.fontSize = 52;
        this.icon.lineHeight = 56;
        this.icon.color = new Color(255, 255, 255, 255);

        const nameNode = new Node('cName');
        nameNode.parent = this.node;
        nameNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        nameNode.setPosition(0, -34, 0);
        this.nameLabel = nameNode.addComponent(Label);
        this.nameLabel.fontSize = 18;
        this.nameLabel.lineHeight = 20;
        this.nameLabel.color = new Color(200, 215, 235, 255);

        this._unreg = TapBus.add(this.node, () => { if (this.onTap) this.onTap(); });
        this.startIdle();
    }

    /** 切换皮肤伙伴外观 + 刷新名牌。 */
    setSkin(skinId: string, level: number): void {
        const c = getCompanion(skinId);
        this.icon.string = c.icon;
        this.nameLabel.string = `${c.name} ${t('companion.level', { n: level })}`;
    }

    setLevel(skinId: string, level: number): void {
        this.setSkin(skinId, level);
    }

    /** 待机浮动：缓慢上下漂浮的循环。 */
    private startIdle(): void {
        const n = this.iconNode;
        tween(n)
            .repeatForever(
                tween(n)
                    .to(1.1, { position: new Vec3(0, 22, 0) }, { easing: 'sineInOut' })
                    .to(1.1, { position: new Vec3(0, 8, 0) }, { easing: 'sineInOut' }),
            )
            .start();
    }

    /** 消行庆祝：蹦一下。 */
    react(): void {
        const n = this.iconNode;
        tween(n)
            .to(0.08, { scale: new Vec3(1.25, 1.25, 1) })
            .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    onDestroy(): void {
        if (this._unreg) this._unreg();
        this._unreg = null;
    }
}
