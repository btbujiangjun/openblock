import { _decorator, Component, Node, Label, UITransform, Color, Graphics } from 'cc';
import { Storage } from '../platform/Storage';
import { Modal, TapBus, card, button } from './uiKit';

const { ccclass } = _decorator;

const TUTORIAL_KEY = 'openblock_cocos_tutorial_done_v1';

/**
 * 首次进入引导（Phase 3）：半透明遮罩 + 几条提示，点击任意处关闭并标记完成。
 */
@ccclass('Tutorial')
export class Tutorial extends Component {
    private _unreg: (() => void) | null = null;

    setup(): void {
        const uit = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        uit.setContentSize(2000, 3000);
        uit.setAnchorPoint(0.5, 0.5);

        // 全屏遮罩单独成节点：先注册 TapBus（低优先级），卡片内按钮后注册可正常命中。
        const blocker = new Node('blocker');
        blocker.parent = this.node;
        const bu = blocker.addComponent(UITransform);
        bu.setAnchorPoint(0.5, 0.5);
        bu.setContentSize(2000, 3000);
        const g = blocker.addComponent(Graphics);
        g.fillColor = new Color(0, 0, 0, 190);
        g.rect(-1000, -1500, 2000, 3000);
        g.fill();

        const lines = [
            '欢迎来到 OpenBlock',
            '',
            '· 从底部候选区拖动方块到棋盘',
            '· 填满整行或整列即可消除得分',
            '· 同色整行/列有额外加成',
            '· 用金币施放技能：提示/撤销/炸弹/彩虹/冻结',
        ];
        // 文案落在卡片内（对齐 web FTUE 卡片样式），底部一个主操作按钮开始。
        const cardW = 700;
        const cardH = 160 + lines.length * 56 + 120;
        const c = card(this.node, cardW, cardH);
        let y = cardH / 2 - 70;
        lines.forEach((s, i) => {
            const isTitle = i === 0;
            const node = new Node('t');
            node.parent = c;
            node.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            node.setPosition(0, y, 0);
            const l = node.addComponent(Label);
            l.string = s;
            l.fontSize = isTitle ? 38 : 25;
            l.lineHeight = (isTitle ? 38 : 25) + 6;
            l.color = isTitle ? new Color(255, 220, 130, 255) : new Color(235, 240, 250, 255);
            y -= isTitle ? 66 : 52;
        });
        button(c, '开始游戏', 0, -cardH / 2 + 64, 30, () => this.dismiss(), new Color(70, 130, 90, 255), { primary: true, minWidth: 240 });

        // 引导期视为模态，暂停盘面输入；点遮罩空白处关闭（按钮命中优先于遮罩）。
        Modal.open();
        this._unreg = TapBus.add(blocker, () => this.dismiss());
    }

    private dismiss(): void {
        Storage.set(TUTORIAL_KEY, '1');
        if (this._unreg) { this._unreg(); this._unreg = null; }
        Modal.close();
        this.node.destroy();
    }

    static shouldShow(): boolean {
        return Storage.get(TUTORIAL_KEY) !== '1';
    }
}
