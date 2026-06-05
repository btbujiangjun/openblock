import { _decorator, Component, Node, Color, UITransform, Label } from 'cc';
import { Modal, dimBg, card, label, button, PillButton } from './uiKit';
import { t, WheelResult } from '../../core';

const { ccclass } = _decorator;

export interface WheelOptions {
    rewards: number[];
    /** 执行一次抽取（返回结果索引/金币） */
    spin: () => WheelResult;
    /** 发奖回调 */
    onReward: (coins: number) => void;
    /** 看广告再转（resolve true 表示允许再转一次） */
    adSpin: () => Promise<boolean>;
}

/** 幸运转盘：纵列展示奖励，高亮循环后停在结果项。 */
@ccclass('WheelPanel')
export class WheelPanel extends Component {
    private cells: Label[] = [];
    private spinning = false;
    private opts!: WheelOptions;
    private freeUsed = false;
    private resultLabel: Label | null = null;
    private freeBtn: PillButton | null = null;
    private adBtn: PillButton | null = null;

    static show(parent: Node, opts: WheelOptions): WheelPanel {
        const root = new Node('Wheel');
        root.parent = parent;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const p = root.addComponent(WheelPanel);
        p.build(opts);
        return p;
    }

    private build(opts: WheelOptions): void {
        Modal.open();
        this.opts = opts;
        const rewards = opts.rewards;
        const h = 300 + rewards.length * 44 + 220;
        dimBg(this.node);
        const c = card(this.node, 560, h);
        let y = h / 2 - 70;
        label(c, t('wheel.title'), 40, 0, y, new Color(255, 220, 130, 255));
        y -= 80;
        for (let i = 0; i < rewards.length; i++) {
            const l = label(c, `🪙 ${rewards[i]}`, 28, 0, y);
            this.cells.push(l);
            y -= 44;
        }
        y -= 16;
        // 结果反馈行：未抽时占位，抽中后显示「🎉 +N」（对齐 web 转盘结果展示）。
        this.resultLabel = label(c, '', 30, 0, y, new Color(255, 230, 120, 255));
        y -= 56;
        this.freeBtn = button(c, t('wheel.spin'), 0, y, 30, () => this.doSpin(false), new Color(70, 130, 90, 255), { primary: true });
        y -= 84;
        this.adBtn = button(c, t('wheel.adSpin'), 0, y, 26, () => this.doSpin(true), new Color(120, 90, 60, 255));
        y -= 80;
        button(c, t('btn.close'), 0, y, 24, () => this.close(), new Color(74, 80, 100, 255));
    }

    private doSpin(viaAd: boolean): void {
        if (this.spinning) return;
        const begin = (allowed: boolean) => {
            if (!allowed) {
                // 看广告未完成：恢复广告按钮可点，不消耗任何东西。
                if (viaAd) this.adBtn?.setDisabled(false);
                return;
            }
            this.spinning = true;
            this.freeBtn?.setDisabled(true);
            this.adBtn?.setDisabled(true);
            if (this.resultLabel) this.resultLabel.string = '';
            const result = this.opts.spin();
            const total = 18 + result.index; // 转约 2 圈停在目标
            let step = 0;
            const tick = () => {
                this.highlight(step % this.cells.length);
                step++;
                if (step <= total) {
                    const delay = 0.04 + (step / total) * 0.12;
                    this.scheduleOnce(tick, delay);
                } else {
                    this.spinning = false;
                    this.opts.onReward(result.coins);
                    // 抽奖结果可见反馈：旧实现仅入账、面板无任何提示。
                    if (this.resultLabel) this.resultLabel.string = `🎉 +${result.coins}`;
                    // 恢复按钮：免费抽用过则保持禁用，否则重新可点；看广告再转始终可继续。
                    this.freeBtn?.setDisabled(this.freeUsed);
                    this.adBtn?.setDisabled(false);
                }
            };
            tick();
        };
        if (viaAd) {
            this.adBtn?.setDisabled(true);
            void this.opts.adSpin().then(begin);
        } else {
            if (this.freeUsed) return;
            this.freeUsed = true;
            this.freeBtn?.setText('✓');
            begin(true);
        }
    }

    private highlight(idx: number): void {
        for (let i = 0; i < this.cells.length; i++) {
            this.cells[i].color = i === idx ? new Color(255, 230, 120, 255) : new Color(200, 205, 215, 255);
        }
    }

    close(): void {
        Modal.close();
        this.node.destroy();
    }
}
