import { _decorator, Component, Label, Node, UITransform, Color, Graphics, tween, Vec3 } from 'cc';
import { t, onLocaleChange } from '../core';
import { Wordmark } from './ui/Wordmark';

const { ccclass } = _decorator;

/** 等级称号（与 web `titleForLevel` 同源的分档）。 */
function titleForLevel(level: number): string {
    const lv = Math.min(99, Math.max(1, level | 0));
    if (lv >= 50) return t('progress.rank.legend');
    if (lv >= 35) return t('progress.rank.master');
    if (lv >= 20) return t('progress.rank.expert');
    if (lv >= 10) return t('progress.rank.adept');
    if (lv >= 5) return t('progress.rank.apprentice');
    return t('progress.rank.novice');
}

/**
 * 顶部 HUD（v2 · 对齐 web PC `score-theme-row`）：
 *   ┌────────────────────────────────────────────────┐
 *   │              Open ✦ Block (wordmark)            │  像素字标
 *   ├────────────────────────────────────────────────┤
 *   │ 能力        │ 得分 │ 最佳 │ 主题                 │  小灰标题
 *   │ ★Lv.6 学徒  │  0   │ 3480 │ 恐龙世界 ▾           │  金色胶囊 / 强调色数值 / 主题胶囊
 *   └────────────────────────────────────────────────┘
 *
 * 与 web 对齐要点：
 *   1. 单行四段（能力 / 得分 / 最佳 / 主题），段间细竖分隔线（web `.stat-box + .stat-box::before`）；
 *   2. 「能力」= 金色胶囊「★ Lv.N 称号」（web `.header-level .header-level-val`）；
 *   3. 「得分 / 最佳」= 小灰标题 + 皮肤强调色大数字（web `.stat-value` color-mix accent）；
 *   4. 「主题」= 深色圆角胶囊「皮肤名 ▾」，点击打开皮肤面板（web `.skin-picker select`）。
 *
 * 设计宽固定 720（Bootstrap FIXED_WIDTH），故各段坐标用常量，无需随可见宽收缩。
 */
@ccclass('Hud')
export class Hud extends Component {
    private wordmark!: Wordmark;
    private rowNode!: Node;
    private levelPill!: { node: Node; g: Graphics; lbl: Label };
    private scoreLbl!: Label;
    private scoreShadow!: Label;
    private bestLbl!: Label;
    private bestShadow!: Label;
    private timeLabel!: Label;
    private overLabel!: Label;
    private comboHeart!: { node: Node; g: Graphics; lbl: Label };
    private bestGapLbl!: Label;
    private powerCaption!: Label;
    private scoreCaption!: Label;
    private bestCaption!: Label;

    private shownScore = 0;
    private targetScore = 0;
    private scoreTween: ReturnType<typeof tween> | null = null;

    private level = 1;
    private accent = new Color(56, 189, 248, 255); // web 默认 --accent-color #38bdf8
    private _unsubLocale: (() => void) | null = null;
    private _timeLeft: number | null = null;
    private _gameOver = false;

    // 字标尺寸（放大强化的产品 icon）
    private static readonly WM_CELL_W = 9;
    private static readonly WM_CELL_H = 11;

    // 段中心 x（设计宽 720，三段居中铺排）
    private static readonly PWR_X = -120;
    private static readonly SCORE_X = 44;
    private static readonly BEST_X = 156;
    private static readonly SEP_X = [-34, 100]; // 段间分隔线（相邻段中心的中点）

    private static readonly CAPTION = new Color(148, 163, 184, 235); // web --stat-label-color 灰
    private static readonly SEP = new Color(148, 163, 184, 80);
    private static readonly PILL_GOLD = new Color(245, 207, 107, 255);   // web 暗主题金渐变中段
    private static readonly PILL_GOLD_HI = new Color(255, 233, 168, 255);
    private static readonly PILL_GOLD_BORDER = new Color(150, 90, 10, 130);
    private static readonly PILL_GOLD_TEXT = new Color(58, 36, 0, 255);
    private static readonly CAP_Y = 17;
    private static readonly CONTENT_Y = -10;
    // combo 心形（web `#combo-heart`：粉色 pill，≥4 连转金）
    private static readonly HEART_BG = new Color(244, 114, 182, 235);
    private static readonly HEART_BG_HIGH = new Color(250, 204, 21, 255);
    private static readonly HEART_HI = new Color(251, 207, 232, 255);
    private static readonly HEART_TEXT = new Color(80, 8, 40, 255);
    // 追 PB 横幅（web `.best-gap--chase` 橙 / `.best-gap--over` 金）
    private static readonly GAP_COLOR = new Color(234, 88, 12, 255);
    private static readonly OVER_COLOR = new Color(217, 119, 6, 255);

    onLoad(): void {
        // 1) 顶部 wordmark（无背板，直接融入整体背景）
        // 纵向布局：上方按钮行 → 字标 → stats 行 → 盘面，三段间距尽量均匀（约 12px）。
        // 整体较旧版下移：字标 50→44→24、stats 行 -22→-40→-58，填补与盘面之间的空白，视觉更协调。
        this.wordmark = Wordmark.mount(this.node, { cellW: Hud.WM_CELL_W, cellH: Hud.WM_CELL_H, plate: false });
        this.wordmark.node.setPosition(0, 24, 0);

        // 2) 单行三段（能力 / 得分 / 最佳）
        this.rowNode = new Node('HudRow');
        this.rowNode.parent = this.node;
        this.rowNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        this.rowNode.setPosition(0, -58, 0);

        // 段间分隔线
        const sepNode = new Node('sep');
        sepNode.parent = this.rowNode;
        sepNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const sepG = sepNode.addComponent(Graphics);
        sepG.fillColor = Hud.SEP;
        for (const sx of Hud.SEP_X) sepG.rect(sx - 0.5, -16, 1, 32);
        sepG.fill();

        // 能力：小灰标题 + 金色胶囊
        this.powerCaption = this.makeLabel(this.rowNode, t('hud.caption.power'), 13, Hud.PWR_X, Hud.CAP_Y, Hud.CAPTION);
        this.levelPill = this.makePill(Hud.PWR_X, Hud.CONTENT_Y);
        this.applyLevelPillText();

        // 得分：小灰标题 + 强调色大数字（带 1px 投影）
        this.scoreCaption = this.makeLabel(this.rowNode, t('hud.caption.score'), 13, Hud.SCORE_X, Hud.CAP_Y, Hud.CAPTION);
        this.scoreShadow = this.makeLabel(this.rowNode, '0', 30, Hud.SCORE_X + 1, Hud.CONTENT_Y - 2, new Color(0, 0, 0, 120));
        this.scoreLbl = this.makeLabel(this.rowNode, '0', 30, Hud.SCORE_X, Hud.CONTENT_Y, this.accent);

        // 最佳：小灰标题 + 强调色大数字
        this.bestCaption = this.makeLabel(this.rowNode, t('hud.caption.best'), 13, Hud.BEST_X, Hud.CAP_Y, Hud.CAPTION);
        this.bestShadow = this.makeLabel(this.rowNode, '0', 30, Hud.BEST_X + 1, Hud.CONTENT_Y - 2, new Color(0, 0, 0, 120));
        this.bestLbl = this.makeLabel(this.rowNode, '0', 30, Hud.BEST_X, Hud.CONTENT_Y, this.accent);

        // combo 心形（对齐 web `#combo-heart`）：得分上方粉色 pill，默认隐藏，连消 ≥2 弹出。
        this.comboHeart = this.makeHeart(Hud.SCORE_X, 36);
        this.comboHeart.node.active = false;

        // 追 PB 横幅（对齐 web `#best-gap`）：最佳格下方小字「差 N 分 / 本局 +N」，默认空。
        this.bestGapLbl = this.makeLabel(this.rowNode, '', 12, Hud.BEST_X, -28, Hud.GAP_COLOR);

        // 3) 限时 / 结束提示（HUD 下沿浮动；仅限时/结束态显示，常态为空不占视觉）
        this.timeLabel = this.makeLabel(this.node, '', 16, 0, -64, new Color(255, 140, 140, 255));
        this.overLabel = this.makeLabel(this.node, '', 22, 0, -84, new Color(255, 209, 96, 255));

        this._unsubLocale = onLocaleChange(() => this.refreshI18nLabels());
    }

    onDestroy(): void {
        if (this._unsubLocale) { this._unsubLocale(); this._unsubLocale = null; }
    }

    refreshI18nLabels(): void {
        if (this.powerCaption?.node?.isValid) this.powerCaption.string = t('hud.caption.power');
        if (this.scoreCaption?.node?.isValid) this.scoreCaption.string = t('hud.caption.score');
        if (this.bestCaption?.node?.isValid) this.bestCaption.string = t('hud.caption.best');
        // 称号依赖 i18n，语言切换后重绘
        this.applyLevelPillText();
        this.setTimeLeft(this._timeLeft);
        this.setGameOver(this._gameOver);
    }

    /** 固定设计宽 720，无需随可见宽收缩；保留接口供 Bootstrap relayout 调用。 */
    relayoutCols(): void {
        if (this.wordmark?.node?.isValid) {
            this.wordmark.redraw({ cellW: Hud.WM_CELL_W, cellH: Hud.WM_CELL_H, plate: false });
        }
    }

    /** 皮肤强调色：得分 / 最佳数值随皮肤主题上色（对齐 web `--accent-color`）。 */
    setAccent(color: Color): void {
        this.accent = color;
        if (this.scoreLbl?.node?.isValid) this.scoreLbl.color = color;
        if (this.bestLbl?.node?.isValid) this.bestLbl.color = color;
    }

    setScore(score: number): void {
        if (this.scoreTween) { this.scoreTween.stop(); this.scoreTween = null; }
        this.targetScore = score;
        if (score <= this.shownScore) {
            this.shownScore = score;
            this.setScoreText(`${score}`);
            return;
        }
        const st = { v: this.shownScore };
        this.scoreTween = tween(st)
            .to(0.35, { v: score }, {
                easing: 'quadOut',
                onUpdate: () => {
                    this.shownScore = Math.round(st.v);
                    this.setScoreText(`${this.shownScore}`);
                },
            })
            .call(() => { this.shownScore = this.targetScore; this.setScoreText(`${this.targetScore}`); this.scoreTween = null; })
            .start();
        tween(this.scoreLbl.node)
            .to(0.08, { scale: new Vec3(1.12, 1.12, 1) })
            .to(0.12, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    resetScore(): void {
        if (this.scoreTween) { this.scoreTween.stop(); this.scoreTween = null; }
        this.shownScore = 0;
        this.targetScore = 0;
        this.setScoreText('0');
    }

    setBest(best: number): void {
        this.bestLbl.string = `${best}`;
        this.bestShadow.string = `${best}`;
    }

    /** coins 不在 HUD 单行内展示（对齐 web：余额由技能可负担态体现），保留接口避免上层改动。 */
    setCoins(_coins: number): void { /* no-op：web score-theme-row 不含金币位 */ }

    setLevel(level: number): void {
        this.level = level;
        this.applyLevelPillText();
    }

    setTimeLeft(sec: number | null): void {
        this._timeLeft = sec;
        this.timeLabel.string = sec == null ? '' : t('hud.timeleft', { n: Math.max(0, Math.ceil(sec)) });
    }

    setGameOver(over: boolean): void {
        this._gameOver = over;
        this.overLabel.string = over ? t('hud.gameover') : '';
    }

    /** combo 心形（对齐 web `#combo-heart`）：连消计数 <2 淡出隐藏，≥2 显示「♥ ×N」并弹一下，≥4 转金。 */
    setCombo(combo: number): void {
        const heart = this.comboHeart;
        if (!heart?.node?.isValid) return;
        if (combo < 2) {
            if (heart.node.active) {
                tween(heart.node)
                    .to(0.16, { scale: new Vec3(0.6, 0.6, 1) })
                    .call(() => { heart.node.active = false; heart.node.setScale(1, 1, 1); })
                    .start();
            }
            return;
        }
        const text = t('hud.comboHeart', { n: combo });
        const fs = 13;
        const w = Math.max(46, Math.round(this.estTextW(text, fs) + 18));
        const h = 22;
        const uit = heart.node.getComponent(UITransform);
        if (uit) uit.setContentSize(w, h);
        heart.lbl.string = text;
        const g = heart.g;
        g.clear();
        const r = h / 2;
        g.fillColor = combo >= 4 ? Hud.HEART_BG_HIGH : Hud.HEART_BG;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        g.fillColor = Hud.HEART_HI;
        g.roundRect(-w / 2 + 3, h / 2 - h * 0.42, w - 6, h * 0.30, r * 0.6);
        g.fill();
        heart.node.active = true;
        heart.node.setScale(1.25, 1.25, 1);
        tween(heart.node).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    }

    /** 追 PB 横幅（对齐 web `#best-gap`）：kind=none 清空，gap 橙色，over 金色。 */
    setBestGap(text: string, kind: 'gap' | 'over' | 'none'): void {
        if (!this.bestGapLbl?.node?.isValid) return;
        this.bestGapLbl.string = kind === 'none' ? '' : text;
        this.bestGapLbl.color = kind === 'over' ? Hud.OVER_COLOR : Hud.GAP_COLOR;
    }

    private setScoreText(s: string): void {
        this.scoreLbl.string = s;
        this.scoreShadow.string = s;
    }

    private applyLevelPillText(): void {
        const text = `★ Lv.${this.level} ${titleForLevel(this.level)}`;
        this.resizePill(this.levelPill, text);
    }

    /** 创建金色等级胶囊节点。 */
    private makePill(x: number, y: number): { node: Node; g: Graphics; lbl: Label } {
        const n = new Node('LevelPill');
        n.parent = this.rowNode;
        const uit = n.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(110, 26);
        n.setPosition(x, y, 0);
        const g = n.addComponent(Graphics);
        const lbl = this.makeLabel(n, '', 14, 0, 0, Hud.PILL_GOLD_TEXT);
        return { node: n, g, lbl };
    }

    /** 创建 combo 心形粉色胶囊节点（结构同金色胶囊，配色不同）。 */
    private makeHeart(x: number, y: number): { node: Node; g: Graphics; lbl: Label } {
        const n = new Node('ComboHeart');
        n.parent = this.rowNode;
        const uit = n.addComponent(UITransform);
        uit.setAnchorPoint(0.5, 0.5);
        uit.setContentSize(54, 22);
        n.setPosition(x, y, 0);
        const g = n.addComponent(Graphics);
        const lbl = this.makeLabel(n, '', 13, 0, 0, Hud.HEART_TEXT);
        return { node: n, g, lbl };
    }

    /** 按文案估宽重绘金色胶囊背景，并更新文字。 */
    private resizePill(pill: { node: Node; g: Graphics; lbl: Label }, text: string): void {
        const fs = 14;
        const w = Math.max(96, Math.round(this.estTextW(text, fs) + 22));
        const h = 25;
        const uit = pill.node.getComponent(UITransform);
        if (uit) uit.setContentSize(w, h);
        pill.lbl.string = text;
        const g = pill.g;
        g.clear();
        const r = h / 2;
        g.fillColor = Hud.PILL_GOLD;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        // 顶部高光带（模拟金渐变上沿）
        g.fillColor = Hud.PILL_GOLD_HI;
        g.roundRect(-w / 2 + 3, h / 2 - h * 0.42, w - 6, h * 0.32, r * 0.6);
        g.fill();
        g.lineWidth = 1.4;
        g.strokeColor = Hud.PILL_GOLD_BORDER;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.stroke();
    }

    /** 粗略估算文字宽度（CJK/emoji/符号≈1em，ascii≈0.56em，空格≈0.3em）。 */
    private estTextW(s: string, size: number): number {
        let w = 0;
        for (const ch of s) {
            if (ch === ' ') { w += size * 0.3; continue; }
            const code = ch.codePointAt(0) || 0;
            w += code > 0x2000 ? size : size * 0.56;
        }
        return w;
    }

    private makeLabel(parent: Node, text: string, size: number, x: number, y: number, color: Color): Label {
        const n = new Node('label');
        n.parent = parent;
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
}
