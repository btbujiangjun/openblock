import { _decorator, Component, Node, Color, UITransform, UIOpacity, Vec3, tween, Graphics, Label } from 'cc';
import { Modal, dimBg, label, closeX, TapBus, inheritLayer, bindEngineClick } from './uiKit';
import { Motion } from '../platform/Motion';
import { SeasonPass, SeasonTaskView } from '../../core';

const { ccclass } = _decorator;

export interface SeasonPassOptions {
    pass: SeasonPass;
    /** 升级高级通行证（可选；未接入时上层给提示）。 */
    onBuyPremium?: () => void;
    /** 关闭回调（如刷新 MetaPanel）。 */
    onClose?: () => void;
}

/**
 * 赛季任务面板（对齐 web `web/src/seasonPass.js` + 截图效果）：
 *   - 标题：🏆 第一赛季 · 方块觉醒
 *   - meta：剩余 N 天 / 积分 N / 升级高级通行证
 *   - 任务列表：label + reward/完成态 + 金色进度条 + x/y
 */
@ccclass('SeasonPassPanel')
export class SeasonPassPanel extends Component {
    private opts!: SeasonPassOptions;
    private content!: Node;
    private onCloseCb: (() => void) | null = null;
    private _unregDim: (() => void) | null = null;
    private _unregClose: (() => void) | null = null;
    private _unregs: Array<() => void> = [];
    private _closed = false;

    private static readonly W = 700;
    private static readonly H = 830;

    static show(parent: Node, opts: SeasonPassOptions): SeasonPassPanel {
        const root = new Node('SeasonPassPanel');
        root.parent = parent;
        root.layer = parent.layer;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const panel = root.addComponent(SeasonPassPanel);
        try {
            panel.build(opts);
        } catch (err) {
            console.warn('[OpenBlock] SeasonPassPanel.build failed', err);
            try { panel.close(); } catch { /* best effort */ }
            throw err;
        }
        if (!Motion.reduced) {
            const op = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
            op.opacity = 0;
            root.setScale(new Vec3(0.94, 0.94, 1));
            tween(op).to(0.18, { opacity: 255 }, { easing: 'cubicOut' }).start();
            tween(root).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
        return panel;
    }

    private build(opts: SeasonPassOptions): void {
        Modal.open();
        this.opts = opts;
        this.onCloseCb = opts.onClose ?? null;

        const dim = dimBg(this.node, 2000, 3000, 214);
        this._unregDim = TapBus.add(dim, () => this.close());

        const c = this.panelCard(this.node, SeasonPassPanel.W, SeasonPassPanel.H);
        this._unregClose = closeX(c, SeasonPassPanel.W / 2 - 30, SeasonPassPanel.H / 2 - 36, () => this.close());

        this.content = new Node('content');
        this.content.parent = c;
        inheritLayer(this.content, c);
        this.content.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this.rebuild();
    }

    private panelCard(parent: Node, w: number, h: number): Node {
        const n = new Node('seasonCard');
        n.parent = parent;
        inheritLayer(n, parent);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(22, 28, 42, 246);
        g.roundRect(-w / 2, -h / 2, w, h, 24);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = new Color(64, 76, 104, 210);
        g.roundRect(-w / 2, -h / 2, w, h, 24);
        g.stroke();
        // 顶部 header 分隔线
        g.fillColor = new Color(255, 255, 255, 10);
        g.rect(-w / 2, h / 2 - 92, w, 1.5);
        g.fill();
        return n;
    }

    private rebuild(): void {
        this.content.removeAllChildren();
        const w = SeasonPassPanel.W;
        const h = SeasonPassPanel.H;
        const pass = this.opts.pass;

        // Header
        label(this.content, '🏆', 32, -w / 2 + 46, h / 2 - 48, new Color(255, 210, 80, 255));
        this.textBox(this.content, pass.season.name, 28, -w / 2 + 86, h / 2 - 49, 420, new Color(242, 246, 255, 255), 'left');

        this.textBox(this.content, `剩余 ${pass.daysLeft} 天`, 20, -w / 2 + 42, h / 2 - 99, 160, new Color(166, 180, 204, 255), 'left');
        this.flatBadge(`积分 ${pass.points}`, -w / 2 + 228, h / 2 - 99, 150, new Color(42, 48, 62, 255), new Color(245, 180, 48, 255));
        if (pass.premium) {
            this.flatBadge('💎 高级通行证', 230, h / 2 - 99, 205, new Color(60, 46, 96, 235), new Color(238, 220, 255, 255));
        } else if (this.opts.onBuyPremium) {
            this.flatAction('高级通行证', 230, h / 2 - 99, 205, () => this.opts.onBuyPremium?.());
        }

        // Tasks
        let y = h / 2 - 180;
        for (const task of pass.views()) {
            this.drawTask(task, y);
            y -= 136;
        }
    }

    private drawTask(task: SeasonTaskView, cy: number): void {
        const w = 640;
        const h = 118;
        const x = 0;
        const n = new Node(`task-${task.id}`);
        n.parent = this.content;
        inheritLayer(n, this.content);
        n.setPosition(x, cy, 0);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        const bgAlpha = task.done ? 130 : 168;
        g.fillColor = new Color(31, 39, 56, bgAlpha);
        g.roundRect(-w / 2, -h / 2, w, h, 12);
        g.fill();
        g.lineWidth = 1.5;
        g.strokeColor = task.done ? new Color(86, 75, 48, 180) : new Color(64, 78, 106, 190);
        g.roundRect(-w / 2, -h / 2, w, h, 12);
        g.stroke();

        const leftPad = 28;
        const rightPad = 28;
        this.textBox(n, task.label, 22, -w / 2 + leftPad, 36, 360,
            task.done ? new Color(210, 214, 224, 210) : new Color(240, 244, 252, 255), 'left');
        const rewardText = task.done ? '✓ 已完成' : task.reward;
        this.textBox(n, rewardText, 18, w / 2 - rightPad - 210, 34, 210, new Color(245, 176, 32, 255), 'right');

        this.drawProgress(n, -w / 2 + leftPad, -24, w - leftPad - rightPad, 8, task.pct, task.done);
        this.textBox(n, `${task.progress} / ${task.target}`, 16, w / 2 - rightPad - 150, -46, 150, new Color(174, 188, 212, 255), 'right');
    }

    private drawProgress(parent: Node, left: number, y: number, w: number, h: number, frac: number, done: boolean): void {
        const n = new Node('progress');
        n.parent = parent;
        inheritLayer(n, parent);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        const r = h / 2;
        g.fillColor = new Color(75, 84, 104, done ? 120 : 170);
        g.roundRect(left, y - h / 2, w, h, r);
        g.fill();
        const fw = Math.max(h, Math.round(w * Math.max(0, Math.min(1, frac))));
        g.fillColor = done ? new Color(196, 138, 45, 215) : new Color(226, 157, 42, 255);
        g.roundRect(left, y - h / 2, fw, h, r);
        g.fill();
    }

    private flatBadge(text: string, x: number, y: number, w: number, bg: Color, fg: Color): void {
        const n = new Node('flatBadge');
        n.parent = this.content;
        inheritLayer(n, this.content);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        g.fillColor = bg;
        g.roundRect(-w / 2, -20, w, 40, 20);
        g.fill();
        g.lineWidth = 1.2;
        g.strokeColor = new Color(255, 255, 255, 34);
        g.roundRect(-w / 2, -20, w, 40, 20);
        g.stroke();
        label(n, text, 18, 0, 0, fg);
    }

    private flatAction(text: string, x: number, y: number, w: number, onClick: () => void): void {
        const n = new Node('flatAction');
        n.parent = this.content;
        inheritLayer(n, this.content);
        n.setPosition(x, y, 0);
        const uit = n.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(w, 42);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(183, 122, 34, 236);
        g.roundRect(-w / 2, -21, w, 42, 21);
        g.fill();
        g.lineWidth = 1.4;
        g.strokeColor = new Color(255, 214, 128, 150);
        g.roundRect(-w / 2, -21, w, 42, 21);
        g.stroke();
        label(n, text, 18, 0, 0, new Color(255, 246, 224, 255));
        const unTap = TapBus.add(n, onClick);
        const unBtn = bindEngineClick(n, onClick);
        this._unregs.push(unTap, unBtn);
    }

    /**
     * 固定宽文本框：避免 Cocos Label 默认居中导致长中文向左/向右溢出。
     * x 为文本框左边界，width 为文本框宽度。
     */
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
        const n = new Node('textBox');
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

    close(): void {
        if (this._closed) return;
        this._closed = true;
        Modal.close();
        if (this._unregDim) { this._unregDim(); this._unregDim = null; }
        if (this._unregClose) { this._unregClose(); this._unregClose = null; }
        for (const u of this._unregs) u();
        this._unregs = [];
        try { if (this.onCloseCb) this.onCloseCb(); } catch (err) { console.warn('[OpenBlock] SeasonPassPanel onClose', err); }
        if (this.node?.isValid) this.node.destroy();
    }
}
