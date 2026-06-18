import { _decorator, Component, Label, Node, UITransform, Color, Graphics, tween, Tween, UIOpacity, Vec3 } from 'cc';
import { t, onLocaleChange } from '../core';
import { Wordmark } from './ui/Wordmark';
import type { PremiumVars } from './platform/SkinPremium';

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
    private bestLbl!: Label;
    private timeLabel!: Label;
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
    private _premiumGlassG: Graphics | null = null;
    private _scoreCardG: Graphics | null = null;
    private _bestCardG: Graphics | null = null;
    private _sepG: Graphics | null = null;
    private _premiumOn = false;
    private _premiumVars: PremiumVars | null = null;

    // 精致模式双层布局（对齐 web 移动端 score-theme-row Tier1/Tier2）
    private static readonly PREM_SCORE_X = -92;
    private static readonly PREM_BEST_X = 92;
    private static readonly PREM_ROW1_Y = 10;
    private static readonly PREM_ROW2_Y = -27;
    private static readonly PREM_LEVEL_X = 0;
    private static readonly PREM_PANEL_W = 600;
    private static readonly PREM_PANEL_H = 92;
    private static readonly PREM_CARD_W = 156;
    private static readonly PREM_CARD_H = 36;
    private static readonly SCORE_GOLD = new Color(252, 211, 77, 255);
    private static readonly SCORE_WHITE = new Color(255, 255, 255, 255);

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
        this._sepG = sepNode.addComponent(Graphics);

        this._scoreCardG = this.makeCardGraphics(this.rowNode, 'ScoreCard');
        this._bestCardG = this.makeCardGraphics(this.rowNode, 'BestCard');
        this._scoreCardG.node.active = false;
        this._bestCardG.node.active = false;

        this.redrawSeparators();

        // 能力：小灰标题 + 金色胶囊
        this.powerCaption = this.makeLabel(this.rowNode, t('hud.caption.power'), 13, Hud.PWR_X, Hud.CAP_Y, Hud.CAPTION);
        this.levelPill = this.makePill(Hud.PWR_X, Hud.CONTENT_Y);
        this.applyLevelPillText();

        // 得分：小灰标题 + 强调色大数字（贴边描边强化，不再用偏移阴影 Label——后者在小字号下成重影）
        this.scoreCaption = this.makeLabel(this.rowNode, t('hud.caption.score'), 13, Hud.SCORE_X, Hud.CAP_Y, Hud.CAPTION);
        this.scoreLbl = this.makeLabel(this.rowNode, '0', 30, Hud.SCORE_X, Hud.CONTENT_Y, this.accent);
        this.applyDigitOutline(this.scoreLbl);

        // 最佳：小灰标题 + 强调色大数字
        this.bestCaption = this.makeLabel(this.rowNode, t('hud.caption.best'), 13, Hud.BEST_X, Hud.CAP_Y, Hud.CAPTION);
        this.bestLbl = this.makeLabel(this.rowNode, '0', 30, Hud.BEST_X, Hud.CONTENT_Y, this.accent);
        this.applyDigitOutline(this.bestLbl);

        // combo 心形（对齐 web `#combo-heart`）：得分上方粉色 pill，默认隐藏，连消 ≥2 弹出。
        this.comboHeart = this.makeHeart(Hud.SCORE_X, 36);
        this.comboHeart.node.active = false;

        // 追 PB 横幅（对齐 web `#best-gap`）：最佳格下方小字「差 N 分 / 本局 +N」，默认空。
        this.bestGapLbl = this.makeLabel(this.rowNode, '', 12, Hud.BEST_X, -28, Hud.GAP_COLOR);

        // 3) 限时提示（HUD 下沿浮动；仅限时态显示，常态为空不占视觉）
        this.timeLabel = this.makeLabel(this.node, '', 16, 0, -64, new Color(255, 140, 140, 255));

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
    }

    /** 固定设计宽 720，无需随可见宽收缩；保留接口供 Bootstrap relayout 调用。 */
    relayoutCols(): void {
        if (this.wordmark?.node?.isValid) {
            this.wordmark.redraw({ cellW: Hud.WM_CELL_W, cellH: Hud.WM_CELL_H, plate: false });
        }
    }

    /** 精致界面：HUD 双层紧凑布局 + 统一玻璃栏（严格对齐 web 移动端 + premium）。 */
    setPremiumGlass(on: boolean, vars?: PremiumVars | null): void {
        if (!this.rowNode?.isValid) return;
        this._premiumOn = on;
        this._premiumVars = on ? (vars ?? null) : null;
        this.applyPremiumLayout(on);
        this.redrawPremiumChrome();
    }

    private makeCardGraphics(parent: Node, name: string): Graphics {
        const n = new Node(name);
        n.parent = parent;
        n.setSiblingIndex(1);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        return n.addComponent(Graphics);
    }

    /** 重绘精致模式玻璃底 + 得分/最佳子卡片。 */
    private redrawPremiumChrome(): void {
        if (!this.rowNode?.isValid) return;
        if (!this._premiumGlassG) {
            const n = new Node('PremiumGlass');
            n.parent = this.rowNode;
            n.setSiblingIndex(0);
            n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
            this._premiumGlassG = n.addComponent(Graphics);
        }
        const g = this._premiumGlassG;
        g.clear();
        const scoreG = this._scoreCardG;
        const bestG = this._bestCardG;
        scoreG?.clear();
        bestG?.clear();

        if (!this._premiumOn || !this._premiumVars) {
            if (scoreG?.node) scoreG.node.active = false;
            if (bestG?.node) bestG.node.active = false;
            this.redrawSeparators();
            return;
        }

        const vars = this._premiumVars;
        const scoreFs = 24;
        const scoreText = this.scoreLbl?.string ?? '0';
        const bestText = this.bestLbl?.string ?? '0';
        const scoreW = Math.min(Hud.PREM_CARD_W, Math.max(116, Math.round(this.estTextW(scoreText, scoreFs) + 34)));
        const bestW = Math.min(Hud.PREM_CARD_W, Math.max(116, Math.round(this.estTextW(bestText, scoreFs) + 34)));
        const cardH = Hud.PREM_CARD_H;
        const cardR = 10;

        if (scoreG?.node) {
            scoreG.node.active = true;
            scoreG.node.setPosition(Hud.PREM_SCORE_X, Hud.PREM_ROW1_Y, 0);
            this.drawStatCard(scoreG, scoreW, cardH, cardR,
                new Color(30, 41, 59, 128), new Color(96, 165, 250, 102));
        }
        if (bestG?.node) {
            bestG.node.active = true;
            bestG.node.setPosition(Hud.PREM_BEST_X, Hud.PREM_ROW1_Y, 0);
            this.drawStatCard(bestG, bestW, cardH, cardR,
                new Color(30, 41, 59, 128), new Color(252, 211, 77, 128));
        }

        const w = Hud.PREM_PANEL_W;
        const h = Hud.PREM_PANEL_H;
        const r = 14;
        const x0 = -w / 2;
        const y0 = -h / 2 + 2;

        g.fillColor = new Color(0, 0, 0, 52);
        g.roundRect(x0 + 1, y0 - 3, w, h, r);
        g.fill();
        const midY = y0 + h * 0.38;
        g.fillColor = vars.glassTop;
        g.roundRect(x0, midY, w, h - (midY - y0), r);
        g.fill();
        g.fillColor = vars.glassBottom;
        g.roundRect(x0, y0, w, midY - y0 + 1, r);
        g.fill();
        g.lineWidth = 1;
        g.strokeColor = vars.glassBorder;
        g.roundRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1, r);
        g.stroke();

        this.redrawSeparators();
    }

    private drawStatCard(
        g: Graphics, w: number, h: number, r: number,
        fill: Color, border: Color,
    ): void {
        g.fillColor = fill;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        g.lineWidth = 1;
        g.strokeColor = border;
        g.roundRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1, r);
        g.stroke();
    }

    /** 精致模式：双层 Tier 布局，隐藏 best-gap，combo 锚定在得分卡右上角。 */
    private applyPremiumLayout(on: boolean): void {
        const showCap = !on;
        if (this.powerCaption?.node?.isValid) this.powerCaption.node.active = showCap;
        if (this.scoreCaption?.node?.isValid) this.scoreCaption.node.active = showCap;
        if (this.bestCaption?.node?.isValid) this.bestCaption.node.active = showCap;

        if (on) {
            const scoreFs = 24;
            if (this.scoreLbl?.node?.isValid) {
                this.scoreLbl.node.setPosition(Hud.PREM_SCORE_X, Hud.PREM_ROW1_Y, 0);
                this.scoreLbl.fontSize = scoreFs;
                this.scoreLbl.lineHeight = scoreFs + 2;
                this.scoreLbl.color = Hud.SCORE_WHITE;
                this.scoreLbl.enableOutline = false;
            }
            if (this.bestLbl?.node?.isValid) {
                this.bestLbl.node.setPosition(Hud.PREM_BEST_X, Hud.PREM_ROW1_Y, 0);
                this.bestLbl.fontSize = scoreFs;
                this.bestLbl.lineHeight = scoreFs + 2;
                this.bestLbl.color = Hud.SCORE_GOLD;
                this.bestLbl.enableOutline = false;
            }
            if (this.levelPill?.node?.isValid) {
                this.levelPill.node.setPosition(Hud.PREM_LEVEL_X, Hud.PREM_ROW2_Y, 0);
            }
            if (this.comboHeart?.node?.isValid) {
                const cardHalf = Hud.PREM_CARD_W / 2;
                this.comboHeart.node.setPosition(Hud.PREM_SCORE_X + cardHalf - 8, Hud.PREM_ROW1_Y + 14, 0);
            }
            if (this.bestGapLbl?.node?.isValid) {
                this.bestGapLbl.node.active = false;
            }
            this.refreshPremiumStatText();
            return;
        }

        if (this.scoreLbl?.node?.isValid) {
            this.scoreLbl.node.setPosition(Hud.SCORE_X, Hud.CONTENT_Y, 0);
            this.scoreLbl.fontSize = 30;
            this.scoreLbl.lineHeight = 34;
            this.scoreLbl.color = this.accent;
            this.applyDigitOutline(this.scoreLbl);
        }
        if (this.bestLbl?.node?.isValid) {
            this.bestLbl.node.setPosition(Hud.BEST_X, Hud.CONTENT_Y, 0);
            this.bestLbl.fontSize = 30;
            this.bestLbl.lineHeight = 34;
            this.bestLbl.color = this.accent;
            this.applyDigitOutline(this.bestLbl);
            this.bestLbl.string = this.stripStatPrefix(this.bestLbl.string);
        }
        if (this.levelPill?.node?.isValid) {
            this.levelPill.node.setPosition(Hud.PWR_X, Hud.CONTENT_Y, 0);
        }
        if (this.comboHeart?.node?.isValid) {
            this.comboHeart.node.setPosition(Hud.SCORE_X, 36, 0);
        }
        if (this.bestGapLbl?.node?.isValid) {
            this.bestGapLbl.node.active = true;
            this.bestGapLbl.node.setPosition(Hud.BEST_X, -28, 0);
            this.bestGapLbl.fontSize = 12;
            this.bestGapLbl.lineHeight = 14;
        }
        if (this.scoreLbl?.node?.isValid) {
            this.scoreLbl.string = this.stripStatPrefix(this.scoreLbl.string);
        }
        if (this.powerCaption?.node?.isValid) this.powerCaption.node.setPosition(Hud.PWR_X, Hud.CAP_Y, 0);
        if (this.scoreCaption?.node?.isValid) this.scoreCaption.node.setPosition(Hud.SCORE_X, Hud.CAP_Y, 0);
        if (this.bestCaption?.node?.isValid) this.bestCaption.node.setPosition(Hud.BEST_X, Hud.CAP_Y, 0);
    }

    private stripStatPrefix(s: string): string {
        return s.replace(/^[⭐🏆]\s*/, '');
    }

    private refreshPremiumStatText(): void {
        if (!this._premiumOn) return;
        if (this.scoreLbl?.node?.isValid) {
            this.scoreLbl.string = `⭐ ${this.stripStatPrefix(this.scoreLbl.string)}`;
        }
        if (this.bestLbl?.node?.isValid) {
            this.bestLbl.string = `🏆 ${this.stripStatPrefix(this.bestLbl.string)}`;
        }
    }

    private redrawSeparators(): void {
        const g = this._sepG;
        if (!g?.node?.isValid) return;
        g.clear();
        if (this._premiumOn) return;
        const h = 32;
        const y0 = -h / 2;
        g.fillColor = Hud.SEP;
        for (const sx of Hud.SEP_X) g.rect(sx - 0.5, y0, 1, h);
        g.fill();
    }

    /** 皮肤强调色：得分 / 最佳数值随皮肤主题上色（对齐 web `--accent-color`）。 */
    setAccent(color: Color): void {
        this.accent = color;
        if (this._premiumOn) {
            this.redrawPremiumChrome();
            return;
        }
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
        this.bestLbl.string = this._premiumOn ? `🏆 ${best}` : `${best}`;
        if (this._premiumOn) this.redrawPremiumChrome();
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


    /** combo 心形（对齐 web `#combo-heart` / `_updateComboHeart`）：
     *   - combo<=0 → 完全隐藏
     *   - combo>0 且 fading=false → 显示「♥ ×N」并弹一下，combo≥4 转金
     *   - combo>0 且 fading=true → "待断" 视觉淡出（透明度降到 ~35%），但 DOM/数值保留，
     *     下次清线（fading=false）立即复活弹一下
     *
     *   ⚠️ combo 计数源是 model.comboCount（grace 窗口模型），不再用旧的"严格连击"阈值（>=2）；
     *   ♥1 也要显示，让玩家从第一次清线起就有 combo 链可视反馈。
     */
    setCombo(combo: number, fading: boolean = false): void {
        const heart = this.comboHeart;
        if (!heart?.node?.isValid) return;
        const op = heart.node.getComponent(UIOpacity) ?? heart.node.addComponent(UIOpacity);
        if (combo <= 0) {
            if (heart.node.active) {
                tween(heart.node)
                    .to(0.16, { scale: new Vec3(0.6, 0.6, 1) })
                    .call(() => { heart.node.active = false; heart.node.setScale(1, 1, 1); op.opacity = 255; })
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
        const wasActive = heart.node.active;
        heart.node.active = true;
        if (this._premiumOn) {
            const cardHalf = Hud.PREM_CARD_W / 2;
            heart.node.setPosition(Hud.PREM_SCORE_X + cardHalf - 8, Hud.PREM_ROW1_Y + 14, 0);
        }
        if (fading) {
            // 待断态：保留数值与 DOM，透明度淡出（与 CSS .combo-heart--fading opacity:0/transform 类比）。
            Tween.stopAllByTarget(op);
            tween(op).to(0.18, { opacity: 90 }, { easing: 'quadOut' }).start();
            return;
        }
        // 复活/新清线：透明度恢复 + 弹一下（与 CSS comboHeartPop 一致）。
        Tween.stopAllByTarget(op);
        op.opacity = 255;
        if (!wasActive) heart.node.setScale(0.6, 0.6, 1);
        heart.node.setScale(1.25, 1.25, 1);
        tween(heart.node).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    }

    /** 追 PB 横幅（对齐 web `#best-gap`）：kind=none 清空，gap 橙色，over 金色。 */
    setBestGap(text: string, kind: 'gap' | 'over' | 'none'): void {
        if (!this.bestGapLbl?.node?.isValid) return;
        if (this._premiumOn) {
            this.bestGapLbl.string = '';
            return;
        }
        this.bestGapLbl.string = kind === 'none' ? '' : text;
        this.bestGapLbl.color = kind === 'over' ? Hud.OVER_COLOR : Hud.GAP_COLOR;
    }

    private setScoreText(s: string): void {
        this.scoreLbl.string = this._premiumOn ? `⭐ ${this.stripStatPrefix(s)}` : s;
        if (this._premiumOn) this.redrawPremiumChrome();
    }

    private applyLevelPillText(): void {
        const text = `★ Lv.${this.level} ${titleForLevel(this.level)}`;
        this.resizePill(this.levelPill, text);
        if (this._premiumOn) this.redrawPremiumChrome();
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
        let fs = 14;
        let w = Math.max(96, Math.round(this.estTextW(text, fs) + 22));
        const maxW = this._premiumOn ? 260 : 260;
        if (w > maxW) {
            fs = 12;
            w = Math.max(96, Math.round(this.estTextW(text, fs) + 20));
        }
        if (w > maxW) w = maxW;
        const h = 25;
        const uit = pill.node.getComponent(UITransform);
        if (uit) uit.setContentSize(w, h);
        pill.lbl.string = text;
        pill.lbl.fontSize = fs;
        pill.lbl.lineHeight = fs + 2;
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

    /**
     * 得分/最佳数字的「贴边描边」强化：用 Label 自带 outline（环绕字形、零偏移）替代旧的偏移阴影
     * Label。旧方案是另起一个 (+1,-2) 的黑色 Label 叠在后面，小字号下两层错位 → 重影、发糊；
     * outline 紧贴字形边缘，既加粗存在感又保持每个数字清晰锐利。
     */
    private applyDigitOutline(l: Label): void {
        l.enableOutline = true;
        l.outlineColor = new Color(20, 28, 38, 170);
        l.outlineWidth = 2;
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
