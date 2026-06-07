import { _decorator, Component, Node, Color, UITransform, UIOpacity, Vec3, tween, Graphics, Label } from 'cc';
import { Modal, dimBg, button, TapBus, inheritLayer, bindEngineClick } from './uiKit';
import { Motion } from '../platform/Motion';

const { ccclass } = _decorator;

export interface GameOverFact { label: string; value: string; }

/** 次级链接；keepOpen=true 时点击不关闭面板（如分享）。 */
export interface GameOverLink { label: string; onClick: () => void; keepOpen?: boolean; }

export interface GameOverOptions {
    /** 模式标签：游戏结束 / 关卡完成 等。 */
    title: string;
    /** 鼓励语副标题（无路可走时显示）。 */
    subtitle?: string | null;
    /** 本局得分（大号橙字）。 */
    score: number;
    /** 经验文案："+253 经验"。 */
    xpText?: string | null;
    /** 升级金色徽章文案（如 "★ Lv.6 学徒"），未升级为空。 */
    levelBadge?: string | null;
    /** 是否本局破纪录（顶部皇冠）。 */
    newBest?: boolean;
    /** 战报子卡标题（i18n，如「◆ 本局战报」由本组件补 ◆）。 */
    digestTitle: string;
    /** 本局战报条目（消行 / 最高连击 / 命中率 / 用时）。 */
    facts: GameOverFact[];
    /** 主 CTA 文案（再来一局）。 */
    againLabel: string;
    /** 主 CTA「再来一局」。 */
    onAgain: () => void;
    /** 次级链接（菜单 / 回放 / 分享）。 */
    links?: GameOverLink[];
}

/**
 * 结束结算卡（严格对齐 web PC `.game-over-card`）：
 *   ┌─────────────────────────────┐
 *   │ 游戏结束 (深灰小标题)        │
 *   │ 棋盘填满，再来一局！💪 (橙)  │
 *   │   1470 (大号橙渐变得分)      │
 *   │ +253 经验 (蓝) [★Lv.6 学徒]  │
 *   │ ┌───── ◆ 本局战报 ─────┐    │  深蓝子卡 + 金色标题/数值
 *   │ │ 消行        24 行     │    │
 *   │ │ 最高连击    2         │    │
 *   │ │ 命中率      94%       │    │
 *   │ │ 用时        20:08     │    │
 *   │ └──────────────────────┘    │
 *   │        [ 再来一局 ]          │  主蓝 CTA
 *   │   菜单 · 回放 · 分享         │  弱化链接
 *   └─────────────────────────────┘
 *
 * 浅色玻璃卡 + 深蓝战报子卡 + 主蓝 CTA + 中点分隔的链接行，配色取自 web main.css。
 */
@ccclass('GameOverPanel')
export class GameOverPanel extends Component {
    private _unregs: Array<() => void> = [];
    private _closed = false;

    // 配色（对齐 web main.css）
    private static readonly CARD_BG = new Color(244, 247, 250, 248);     // 浅玻璃底
    private static readonly CARD_BORDER = new Color(15, 23, 42, 40);
    private static readonly TITLE = new Color(51, 65, 85, 255);          // #334155
    private static readonly SUBTITLE = new Color(211, 84, 0, 255);       // #d35400
    private static readonly SCORE = new Color(233, 126, 34, 255);        // 橙渐变近似
    private static readonly XP = new Color(3, 105, 161, 255);            // #0369a1
    private static readonly DIGEST_BG = new Color(15, 23, 42, 236);      // #0f172a .92
    private static readonly DIGEST_BORDER = new Color(251, 191, 36, 64); // 金 .22
    private static readonly DIGEST_TITLE = new Color(251, 191, 36, 255); // #fbbf24
    private static readonly DIGEST_LABEL = new Color(226, 232, 240, 210);
    private static readonly DIGEST_VALUE = new Color(251, 191, 36, 255);
    private static readonly LINK = new Color(71, 85, 105, 255);          // #475569
    private static readonly LINK_SEP = new Color(148, 163, 184, 255);
    private static readonly GOLD_PILL = new Color(245, 207, 107, 255);
    private static readonly GOLD_PILL_TEXT = new Color(58, 36, 0, 255);
    private static readonly BTN_BLUE = new Color(33, 150, 243, 255);     // #2196f3

    static show(parent: Node, opts: GameOverOptions): GameOverPanel {
        const root = new Node('GameOver');
        root.parent = parent;
        root.layer = parent.layer;
        root.setSiblingIndex(9999);
        root.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const panel = root.addComponent(GameOverPanel);
        try {
            panel.build(opts);
        } catch (err) {
            console.warn('[OpenBlock] GameOverPanel.build failed', err);
            try { panel.close(); } catch { /* best effort */ }
            throw err;
        }
        if (!Motion.reduced) {
            const op = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
            op.opacity = 0;
            root.setScale(new Vec3(0.94, 0.94, 1));
            tween(op).to(0.18, { opacity: 255 }, { easing: 'cubicOut' }).start();
            tween(root).to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
        return panel;
    }

    private build(opts: GameOverOptions): void {
        Modal.open();

        const W = 600;
        const rows = opts.facts.length;
        const hasSub = !!opts.subtitle;
        const hasXp = !!opts.xpText;
        const digestH = 36 + rows * 38 + 18;
        const H = 38                       // pad top
            + 34                            // title
            + (hasSub ? 32 : 0)             // subtitle
            + (opts.newBest ? 40 : 0)       // crown
            + 84                            // score
            + (hasXp ? 34 : 0)             // xp
            + 16                            // gap
            + digestH
            + 22                            // gap
            + 86                            // button
            + 14                            // gap
            + 38                            // links
            + 28;                           // pad bottom

        const dim = dimBg(this.node);
        dim.getComponent(UITransform)!.setContentSize(2000, 3000);
        // 背景吸收点击（对齐 web：结算卡背景不可点关闭，仅靠 CTA / 链接前进）；
        // 按钮 / 链接在下方后注册 → TapBus 逆序命中时优先于背景。
        this._unregs.push(TapBus.add(dim, () => { /* absorb */ }));

        const card = this.buildCard(W, H);

        let y = H / 2 - 38;
        // 标题
        this.mkLabel(card, opts.title, 28, 0, y - 14, GameOverPanel.TITLE, 0.5);
        y -= 34;
        // 副标题（鼓励语）
        if (hasSub) {
            this.mkLabel(card, `${opts.subtitle} 💪`, 22, 0, y - 14, GameOverPanel.SUBTITLE, 0.5);
            y -= 32;
        }
        // 皇冠（破纪录）
        if (opts.newBest) {
            this.mkLabel(card, '🏆', 34, 0, y - 18, new Color(255, 255, 255, 255), 0.5);
            y -= 40;
        }
        // 得分（大号橙）
        this.mkLabel(card, `${opts.score}`, 70, 0, y - 40, GameOverPanel.SCORE, 0.5);
        y -= 84;
        // 经验（蓝）+ 可选金色升级徽章
        if (hasXp) {
            if (opts.levelBadge) {
                this.mkLabel(card, opts.xpText!, 22, -52, y - 14, GameOverPanel.XP, 0.5);
                this.mkGoldPill(card, opts.levelBadge, 70, y - 14);
            } else {
                this.mkLabel(card, opts.xpText!, 22, 0, y - 14, GameOverPanel.XP, 0.5);
            }
            y -= 34;
        }
        y -= 16;
        // 本局战报子卡
        this.buildDigest(card, W - 56, digestH, y, opts.digestTitle, opts.facts);
        y -= digestH + 22;
        // 主 CTA「再来一局」
        const again = button(card, opts.againLabel, 0, y - 43, 28,
            () => this.act(opts.onAgain),
            GameOverPanel.BTN_BLUE, { primary: true, minWidth: 320 });
        this._unregs.push(() => { if (again?.node?.isValid) again.node.destroy(); });
        y -= 86 + 14;
        // 次级链接行：菜单 · 回放 · 分享
        this.buildLinks(card, opts.links ?? [], y - 19);
    }

    /** 浅色玻璃卡背景。 */
    private buildCard(w: number, h: number): Node {
        const n = new Node('card');
        n.parent = this.node;
        inheritLayer(n, this.node);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const g = n.addComponent(Graphics);
        g.fillColor = GameOverPanel.CARD_BG;
        g.roundRect(-w / 2, -h / 2, w, h, 22);
        g.fill();
        // 顶部内高光
        g.fillColor = new Color(255, 255, 255, 150);
        g.roundRect(-w / 2 + 6, h / 2 - 8, w - 12, 4, 4);
        g.fill();
        g.lineWidth = 1.5;
        g.strokeColor = GameOverPanel.CARD_BORDER;
        g.roundRect(-w / 2, -h / 2, w, h, 22);
        g.stroke();
        return n;
    }

    /** 深蓝「本局战报」子卡：◆ 金色标题 + 左标签/右金值的若干行。 */
    private buildDigest(parent: Node, w: number, h: number, topY: number, title: string, facts: GameOverFact[]): void {
        const n = new Node('digest');
        n.parent = parent;
        inheritLayer(n, parent);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        // 子卡中心 = topY - h/2
        n.setPosition(0, topY - h / 2, 0);
        const g = n.addComponent(Graphics);
        g.fillColor = GameOverPanel.DIGEST_BG;
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.fill();
        g.lineWidth = 1.4;
        g.strokeColor = GameOverPanel.DIGEST_BORDER;
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.stroke();

        let yy = h / 2 - 22;
        this.mkLabel(n, `◆ ${title}`, 18, -w / 2 + 16, yy, GameOverPanel.DIGEST_TITLE, 0);
        yy -= 30;
        for (const f of facts) {
            this.mkLabel(n, f.label, 16, -w / 2 + 16, yy, GameOverPanel.DIGEST_LABEL, 0);
            this.mkLabel(n, f.value, 17, w / 2 - 16, yy, GameOverPanel.DIGEST_VALUE, 1);
            yy -= 38;
        }
    }

    /** 链接行（中点分隔，整体居中）。 */
    private buildLinks(parent: Node, links: GameOverLink[], y: number): void {
        if (!links.length) return;
        const sep = 14;
        const sizes = links.map((l) => this.estTextW(l.label, 22));
        const sepW = this.estTextW('·', 20) + sep * 2;
        const total = sizes.reduce((a, b) => a + b, 0) + sepW * (links.length - 1);
        let x = -total / 2;
        links.forEach((lk, i) => {
            const w = sizes[i];
            const cx = x + w / 2;
            const node = this.mkLabel(parent, lk.label, 22, cx, y, GameOverPanel.LINK, 0.5).node;
            const uit = node.getComponent(UITransform)!;
            uit.setContentSize(Math.max(w, 40), 44);
            const fire = () => { if (lk.keepOpen) lk.onClick(); else this.act(lk.onClick); };
            this._unregs.push(TapBus.add(node, fire));
            this._unregs.push(bindEngineClick(node, fire));
            x += w;
            if (i < links.length - 1) {
                this.mkLabel(parent, '·', 20, x + sepW / 2, y, GameOverPanel.LINK_SEP, 0.5);
                x += sepW;
            }
        });
    }

    /** 金色升级徽章（小胶囊）。 */
    private mkGoldPill(parent: Node, text: string, x: number, y: number): void {
        const w = Math.round(this.estTextW(text, 16) + 20);
        const h = 26;
        const n = new Node('lvPill');
        n.parent = parent;
        inheritLayer(n, parent);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        n.setPosition(x, y, 0);
        const g = n.addComponent(Graphics);
        g.fillColor = GameOverPanel.GOLD_PILL;
        g.roundRect(-w / 2, -h / 2, w, h, h / 2);
        g.fill();
        this.mkLabel(n, text, 16, 0, 0, GameOverPanel.GOLD_PILL_TEXT, 0.5);
    }

    /** 创建带水平锚点的 Label（anchorX: 0 左对齐 / 0.5 居中 / 1 右对齐）。 */
    private mkLabel(parent: Node, text: string, size: number, x: number, y: number, color: Color, anchorX: number): Label {
        const n = new Node('label');
        n.parent = parent;
        inheritLayer(n, parent);
        const uit = n.addComponent(UITransform);
        uit.setAnchorPoint(anchorX, 0.5);
        n.setPosition(x, y, 0);
        const l = n.addComponent(Label);
        l.string = text;
        l.fontSize = size;
        l.lineHeight = size + 4;
        l.color = color;
        l.horizontalAlign = anchorX === 0 ? Label.HorizontalAlign.LEFT
            : anchorX === 1 ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
        return l;
    }

    private estTextW(s: string, size: number): number {
        let w = 0;
        for (const ch of s) {
            if (ch === ' ') { w += size * 0.3; continue; }
            const code = ch.codePointAt(0) || 0;
            w += code > 0x2000 ? size : size * 0.56;
        }
        return w;
    }

    /** 执行动作：先关面板，再执行回调（再来一局 / 菜单 / 回放）。 */
    private act(cb: () => void): void {
        this.close();
        try { cb(); } catch (err) { console.warn('[OpenBlock] GameOverPanel action', err); }
    }

    close(): void {
        if (this._closed) return;
        this._closed = true;
        Modal.close();
        for (const u of this._unregs) { try { u(); } catch { /* ignore */ } }
        this._unregs = [];
        if (this.node?.isValid) this.node.destroy();
    }
}
