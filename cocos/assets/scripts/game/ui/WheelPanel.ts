import { _decorator, Component, Node, Color, UITransform, Label, Graphics, tween, Vec3 } from 'cc';
import { Modal, dimBg, label, button, PillButton, TapBus, closeX, inheritLayer } from './uiKit';
import { t, WheelResult, WheelPrize } from '../../core';
import { Storage, STORAGE_KEYS } from '../platform/Storage';
import { AudioManager } from '../audio/AudioManager';
import { Haptics } from '../platform/Haptics';
import { Motion } from '../platform/Motion';

const { ccclass } = _decorator;

export interface WheelOptions {
    /** 奖池（用于渲染各奖品扇区；与 spin 的索引一一对应）。 */
    prizes: WheelPrize[];
    /** 执行一次加权抽取（返回结果索引 + 奖品）。 */
    spin: () => WheelResult;
    /** 把奖品入账钱包；返回实际发到的试穿皮肤 id（无则空串），用于结果文案。 */
    grant: (prize: WheelPrize) => string;
    /** 把奖品格式化为展示文案（传入 trialSkin 时显示具体皮肤名）。 */
    formatPrize: (prize: WheelPrize, trialSkin?: string) => string;
    /** 保留接口兼容旧调用；web 主端当前只有免费抽，不展示看广告再转。 */
    adSpin?: () => Promise<boolean>;
}

interface WheelState {
    lastSpinDate?: string;
    recentResults?: Array<{ prize: string; ymd: string }>;
}

/**
 * 幸运转盘（严格对齐 web `rewards/luckyWheel.js`）：
 * - 周一 / 周五各一次免费抽；
 * - 8 段圆形转盘，顶部固定指针，内盘旋转 2.4s 停到目标扇区；
 * - 奖池为 token / 金币 / 12h 试穿券，必有奖；
 * - 本地状态对齐 web `{ lastSpinDate, recentResults }`。
 */
@ccclass('WheelPanel')
export class WheelPanel extends Component {
    private opts!: WheelOptions;
    private disc: Node | null = null;
    private spinning = false;
    private resultLabel: Label | null = null;
    private spinBtn: PillButton | null = null;
    private _unregs: Array<() => void> = [];
    private _closed = false;

    private static readonly CARD_W = 660;
    private static readonly CARD_H = 720;
    /** web: wheel-disc 是卡片主视觉。移动端用更大披萨盘，减少底部空白。 */
    private static readonly DISC_R = 224;
    private static readonly SEG_COLORS = [
        new Color(255, 209, 96, 255), new Color(255, 140, 64, 255),
        new Color(56, 189, 248, 255), new Color(236, 72, 153, 255),
        new Color(132, 204, 22, 255), new Color(168, 85, 247, 255),
        new Color(249, 115, 22, 255), new Color(148, 163, 184, 255),
    ];

    static show(parent: Node, opts: WheelOptions): WheelPanel {
        const root = new Node('Wheel');
        root.parent = parent;
        root.layer = parent.layer;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const p = root.addComponent(WheelPanel);
        p.build(opts);
        if (!Motion.reduced) {
            root.setScale(new Vec3(0.94, 0.94, 1));
            tween(root).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
        return p;
    }

    private static ymd(): string {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    private static isWheelDay(d = new Date()): boolean {
        const dow = d.getDay();
        return dow === 1 || dow === 5;
    }

    private loadState(): WheelState {
        return Storage.getJSON<WheelState>(STORAGE_KEYS.wheelFreeUsedDate, {});
    }

    private saveState(state: WheelState): void {
        Storage.setJSON(STORAGE_KEYS.wheelFreeUsedDate, state);
    }

    private canSpin(): boolean {
        if (!WheelPanel.isWheelDay()) return false;
        return this.loadState().lastSpinDate !== WheelPanel.ymd();
    }

    private build(opts: WheelOptions): void {
        Modal.open();
        this.opts = opts;
        const dim = dimBg(this.node, 2000, 3000, 214);
        this._unregs.push(TapBus.add(dim, () => { if (!this.spinning) this.close(); }));

        const card = this.card(this.node);
        label(card, '周末幸运转盘', 32, 0, WheelPanel.CARD_H / 2 - 48, new Color(255, 220, 130, 255));

        const discWrap = new Node('wheelDiscWrap');
        discWrap.parent = card;
        inheritLayer(discWrap, card);
        discWrap.setPosition(0, 20, 0);
        discWrap.addComponent(UITransform).setAnchorPoint(0.5, 0.5);

        this.disc = new Node('wheelDiscInner');
        this.disc.parent = discWrap;
        inheritLayer(this.disc, discWrap);
        this.disc.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this.paintDisc(this.disc, opts.prizes);

        // 固定指针：只转内盘，指针保持在 12 点方向。
        this.paintPointer(discWrap);

        this.resultLabel = label(card, '', 23, 0, -230, new Color(245, 176, 32, 255));

        const can = this.canSpin();
        const txt = can ? t('wheel.spin') : (WheelPanel.isWheelDay() ? t('reward.luckyWheel.usedToday') : '今日无免费转盘');
        this.spinBtn = button(card, txt, 0, -288, 24, () => this.doSpin(), new Color(245, 158, 11, 255),
            { primary: can, disabled: !can, minWidth: 270, height: 60 });

        this._unregs.push(closeX(card, WheelPanel.CARD_W / 2 - 36, WheelPanel.CARD_H / 2 - 38, () => this.close()));
    }

    private card(parent: Node): Node {
        const n = new Node('wheelCard');
        n.parent = parent;
        inheritLayer(n, parent);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        const w = WheelPanel.CARD_W;
        const h = WheelPanel.CARD_H;
        g.fillColor = new Color(24, 30, 44, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 24);
        g.fill();
        // web box-shadow 的实体近似：深色外投影 + 顶部柔光。
        g.fillColor = new Color(0, 0, 0, 70);
        g.roundRect(-w / 2 + 8, -h / 2 - 10, w - 16, 20, 18);
        g.fill();
        g.fillColor = new Color(255, 255, 255, 12);
        g.roundRect(-w / 2 + 16, h / 2 - 112, w - 32, 84, 20);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(94, 108, 142, 220);
        g.roundRect(-w / 2, -h / 2, w, h, 24);
        g.stroke();
        return n;
    }

    private paintDisc(parent: Node, prizes: WheelPrize[]): void {
        const g = parent.addComponent(Graphics);
        const r = WheelPanel.DISC_R;
        const seg = Math.PI * 2 / prizes.length;
        const start = -Math.PI / 2; // 第 0 段从顶部开始，和 web conic-gradient 视觉一致。
        // 阴影底圈：模拟 web wheel-disc-inner 的 box-shadow 外投影。
        g.fillColor = new Color(0, 0, 0, 78);
        g.circle(0, -8, r + 16);
        g.fill();
        for (let i = 0; i < prizes.length; i++) {
            const a0 = start + i * seg;
            const a1 = a0 + seg;
            const mid = (a0 + a1) / 2;
            g.fillColor = WheelPanel.SEG_COLORS[i % WheelPanel.SEG_COLORS.length];
            g.moveTo(0, 0);
            g.arc(0, 0, r, a0, a1, false);
            g.close();
            g.fill();
            // 每块披萨片的内侧亮面：从中心向外留一条轻微高光，不覆盖整盘颜色。
            g.fillColor = new Color(255, 255, 255, 22);
            g.moveTo(0, 0);
            g.arc(0, 0, r * 0.54, a0 + 0.025, a1 - 0.025, false);
            g.close();
            g.fill();
            // 外缘暗化只在最外圈 22% 半径，保留披萨块的彩色主体。
            g.fillColor = new Color(0, 0, 0, 34);
            g.moveTo(Math.cos(a0) * r * 0.78, Math.sin(a0) * r * 0.78);
            g.arc(0, 0, r, a0, a1, false);
            g.lineTo(Math.cos(a1) * r * 0.78, Math.sin(a1) * r * 0.78);
            g.arc(0, 0, r * 0.78, a1, a0, true);
            g.close();
            g.fill();
            // 分隔线：从中心到外圈的深色半透明线，模拟 web conic-gradient 的 1deg 分隔。
            g.strokeColor = new Color(0, 0, 0, 82);
            g.lineWidth = 2.5;
            g.moveTo(0, 0);
            g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
            g.stroke();
            // 中轴向外的一条很轻的暖色线，强化“披萨块”边界。
            g.strokeColor = new Color(255, 230, 160, 48);
            g.lineWidth = 1.2;
            g.moveTo(Math.cos(mid) * r * 0.16, Math.sin(mid) * r * 0.16);
            g.lineTo(Math.cos(mid) * r * 0.92, Math.sin(mid) * r * 0.92);
            g.stroke();
            this.wedgeLabel(parent, prizes[i], i, prizes.length);
        }
        // 外圈：黑色主描边 + 金色环 + 半透明白环（web box-shadow 三层近似）。
        g.lineWidth = 9;
        g.strokeColor = new Color(22, 28, 42, 255);
        g.circle(0, 0, r + 1);
        g.stroke();
        g.lineWidth = 4;
        g.strokeColor = new Color(245, 158, 11, 225);
        g.circle(0, 0, r + 8);
        g.stroke();
        g.lineWidth = 5;
        g.strokeColor = new Color(255, 255, 255, 52);
        g.circle(0, 0, r + 14);
        g.stroke();
        // 中央轴帽。
        g.fillColor = new Color(24, 30, 44, 250);
        g.circle(0, 0, 34);
        g.fill();
        g.fillColor = new Color(255, 245, 204, 30);
        g.circle(0, 7, 20);
        g.fill();
        g.strokeColor = new Color(255, 220, 130, 238);
        g.lineWidth = 3.5;
        g.circle(0, 0, 34);
        g.stroke();
    }

    private wedgeLabel(parent: Node, prize: WheelPrize, i: number, total: number): void {
        const angle = -Math.PI / 2 + (i + 0.5) * (Math.PI * 2 / total);
        // 披萨块文字放在中外圈，保持水平可读，避免相邻扇区文字相互遮挡。
        const rr = WheelPanel.DISC_R * 0.78;
        const x = Math.cos(angle) * rr;
        const y = Math.sin(angle) * rr;
        const root = new Node(`wedgeLabel-${i}`);
        root.parent = parent;
        inheritLayer(root, parent);
        root.setPosition(x, y, 0);
        root.angle = 0;
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        // 给每个文字组一个很淡的深色底，解决高亮扇区上白字边界不清的问题。
        const bg = root.addComponent(Graphics);
        bg.fillColor = new Color(60, 10, 18, 54);
        bg.roundRect(-40, -22, 80, 44, 10);
        bg.fill();
        const name = label(root, prize.name, 15, 0, 8, new Color(255, 255, 255, 255));
        const count = label(root, prize.count, 14, 0, -11, new Color(255, 209, 96, 255));
        this.styleWheelText(name, true);
        this.styleWheelText(count, false);
    }

    /** web 的 -webkit-text-stroke + text-shadow 近似：Cocos Label outline。 */
    private styleWheelText(l: Label, isName: boolean): void {
        const anyL = l as unknown as {
            isBold?: boolean;
            enableOutline?: boolean;
            outlineColor?: Color;
            outlineWidth?: number;
        };
        try {
            anyL.isBold = true;
            anyL.enableOutline = true;
            anyL.outlineColor = new Color(122, 15, 28, 255);
            anyL.outlineWidth = isName ? 2.2 : 1.8;
        } catch { /* older Label API: ignore */ }
    }

    /** 固定在 12 点的三角指针，替代纯文字 ▼，更接近 web drop-shadow 指针。 */
    private paintPointer(parent: Node): void {
        const n = new Node('wheelPointer');
        n.parent = parent;
        inheritLayer(n, parent);
        n.setPosition(0, WheelPanel.DISC_R + 18, 0);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(0, 0, 0, 80);
        g.moveTo(-17, 7);
        g.lineTo(17, 7);
        g.lineTo(0, -19);
        g.close();
        g.fill();
        g.fillColor = new Color(245, 248, 255, 255);
        g.moveTo(-15, 10);
        g.lineTo(15, 10);
        g.lineTo(0, -15);
        g.close();
        g.fill();
        g.strokeColor = new Color(22, 28, 42, 230);
        g.lineWidth = 2;
        g.moveTo(-15, 10);
        g.lineTo(15, 10);
        g.lineTo(0, -15);
        g.close();
        g.stroke();
    }

    private doSpin(): void {
        if (this.spinning || !this.canSpin() || !this.disc) return;
        this.spinning = true;
        this.spinBtn?.setDisabled(true);
        this.spinBtn?.setText(t('reward.luckyWheel.spinning'));
        if (this.resultLabel) this.resultLabel.string = '';
        AudioManager.sfxCombo(3);
        Haptics.light();

        const result = this.opts.spin();
        const wedgeAngle = 360 / this.opts.prizes.length;
        const targetAngle = 360 * 4 + result.index * wedgeAngle + wedgeAngle / 2;
        const endAngle = -targetAngle;
        const finish = () => {
            this.spinning = false;
            this.grantResult(result);
        };
        if (Motion.reduced) {
            this.disc.angle = endAngle;
            finish();
        } else {
            tween(this.disc)
                .to(2.4, { angle: endAngle }, { easing: 'cubicOut' })
                .call(finish)
                .start();
        }
    }

    private grantResult(result: WheelResult): void {
        const trialSkin = this.opts.grant(result.prize);
        const ymd = WheelPanel.ymd();
        const state = this.loadState();
        state.lastSpinDate = ymd;
        state.recentResults = [...(state.recentResults || []), { prize: result.prize.id, ymd }].slice(-30);
        this.saveState(state);

        if (this.resultLabel) {
            this.resultLabel.string = `🎉 ${this.opts.formatPrize(result.prize, trialSkin) || result.prize.label}`;
        }
        this.spinBtn?.setText(t('reward.luckyWheel.usedToday'));
        this.spinBtn?.setDisabled(true);
        AudioManager.sfxUnlock();
        Haptics.medium();
    }

    close(): void {
        if (this._closed) return;
        this._closed = true;
        for (const u of this._unregs) u();
        this._unregs = [];
        Modal.close();
        this.node.destroy();
    }
}
