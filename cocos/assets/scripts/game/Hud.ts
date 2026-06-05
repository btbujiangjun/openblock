import { _decorator, Component, Label, Node, UITransform, Color, tween, Vec3 } from 'cc';
import { t } from '../core';

const { ccclass } = _decorator;

/**
 * 顶部 HUD —— 对齐 web 的单行统计布局（score-theme-row）：
 * 左「能力(Lv)」· 中「得分」(大号 + 滚动动画) · 右「最佳」，金币挂在最佳下方，
 * 限时/结束提示居中于得分下方。每格为「小灰标题 + 大号数值」的 stat-box 形态。
 */
@ccclass('Hud')
export class Hud extends Component {
    private scoreLabel!: Label;
    private bestLabel!: Label;
    private coinLabel!: Label;
    private levelLabel!: Label;
    private timeLabel!: Label;
    private overLabel!: Label;

    private shownScore = 0;
    private targetScore = 0;
    private scoreTween: ReturnType<typeof tween> | null = null;

    private static readonly CAPTION = new Color(150, 160, 180, 255);

    onLoad(): void {
        const colL = -250;
        const colR = 250;

        // 能力（左）
        this.makeCaption('能力', colL, 24);
        this.levelLabel = this.makeValue(t('level.label', { n: 1 }), 26, colL, -6, new Color(150, 210, 255, 255));

        // 得分（中，大号）
        this.makeCaption('得分', 0, 34);
        this.scoreLabel = this.makeValue('0', 48, 0, -8, new Color(255, 255, 255, 255));

        // 最佳（右）
        this.makeCaption('最佳', colR, 24);
        this.bestLabel = this.makeValue('0', 26, colR, -6, new Color(235, 240, 250, 255));

        // 金币（右下）
        this.coinLabel = this.makeValue(t('hud.coins', { n: 0 }), 22, colR, -42, new Color(255, 215, 120, 255));

        // 限时 / 结束（得分下方居中）
        this.timeLabel = this.makeValue('', 24, 0, -48, new Color(255, 150, 150, 255));
        this.overLabel = this.makeValue('', 30, 0, -92, new Color(255, 209, 96, 255));
    }

    private makeCaption(text: string, x: number, y: number): Label {
        return this.makeLabel(text, 18, x, y, Hud.CAPTION);
    }

    private makeValue(text: string, size: number, x: number, y: number, color: Color): Label {
        return this.makeLabel(text, size, x, y, color);
    }

    private makeLabel(text: string, size: number, x: number, y: number, color: Color): Label {
        const n = new Node('label');
        n.parent = this.node;
        const uit = n.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        n.setPosition(x, y, 0);
        const l = n.addComponent(Label);
        l.string = text;
        l.fontSize = size;
        l.lineHeight = size + 4;
        l.color = color;
        return l;
    }

    /** 分数滚动动画：从当前显示值补间到目标值（仅数字，标题固定）。 */
    setScore(score: number): void {
        // 先停掉上一段补间，避免新开局归零时被旧补间的收尾回调覆盖成旧分（“得分未清零”根因）。
        if (this.scoreTween) { this.scoreTween.stop(); this.scoreTween = null; }
        this.targetScore = score;
        // 归零/下降（新开局、撤销、复活清盘）直接置位，不做上滚动画。
        if (score <= this.shownScore) {
            this.shownScore = score;
            this.scoreLabel.string = `${score}`;
            return;
        }
        const st = { v: this.shownScore };
        this.scoreTween = tween(st)
            .to(0.35, { v: score }, {
                easing: 'quadOut',
                onUpdate: () => {
                    this.shownScore = Math.round(st.v);
                    this.scoreLabel.string = `${this.shownScore}`;
                },
            })
            .call(() => { this.shownScore = this.targetScore; this.scoreLabel.string = `${this.targetScore}`; this.scoreTween = null; })
            .start();
        tween(this.scoreLabel.node)
            .to(0.08, { scale: new Vec3(1.12, 1.12, 1) })
            .to(0.12, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    /** 即时把显示分数归零（新开局调用，保证不残留上一局分数）。 */
    resetScore(): void {
        if (this.scoreTween) { this.scoreTween.stop(); this.scoreTween = null; }
        this.shownScore = 0;
        this.targetScore = 0;
        this.scoreLabel.string = '0';
    }

    setBest(best: number): void {
        this.bestLabel.string = `${best}`;
    }

    setCoins(coins: number): void {
        this.coinLabel.string = t('hud.coins', { n: coins });
    }

    setLevel(level: number): void {
        this.levelLabel.string = t('level.label', { n: level });
    }

    setTimeLeft(sec: number | null): void {
        this.timeLabel.string = sec == null ? '' : t('hud.timeleft', { n: Math.max(0, Math.ceil(sec)) });
    }

    setGameOver(over: boolean): void {
        this.overLabel.string = over ? t('hud.gameover') : '';
    }
}
