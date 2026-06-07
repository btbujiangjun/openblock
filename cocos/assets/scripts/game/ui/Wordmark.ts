/**
 * Open ✦ Block 像素字标（严格移植自 web `blockWordmark.js` + `main.css` 默认 glossy/rainbow 皮肤）。
 *
 * 用 Graphics 画 7 行像素方块，hue 沿列 0→360 彩虹分布；O 的左上格叠 🎮、B 的左上格叠 🏆。
 * 与 web 对齐的视觉要点（见 .wm-cell--rainbow / crossstar）：
 *   1. 整体 skewX(-6deg) 右倾斜体（按格中心 y 做水平错切）；
 *   2. 单格对角渐变 hsl(h,84,58)→hsl(h+18,74,44) + 顶部白色 gloss + hsla(h,58,34,.5) 暗描边；
 *   3. 圆角 cellW*0.28、格距 cellH*0.08；
 *   4. O/B 顶行 & 每行最左实心格 accent 笔触加粗（×1.14）；
 *   5. 品牌 emoji 字号 cellH*1.5，按 web translate 右上偏移；
 *   6. 中间用 Graphics 画发光「尖锐四角星」（1:2 修长比 + 径向辉光 + 渐变星体 + 高光内核）。
 * 提供单一 `mount(parent, opts)` 入口：在指定父节点下生成一个居中的 Wordmark 子节点，
 * 调用方负责定位（HUD / 主菜单 / 启动屏均可复用）。
 *
 * 与 web 同源 bitmap：7 行 ×（O=6 / p=5 / e=4 / n=7 / B=6 / l=5 / o=5 / c=5 / k=5）。
 * 像素尺寸由 `cellW / cellH` 控制，默认 5×6 出 ~250×42 的版式，竖屏 720 设计宽下居中合适。
 *
 * 实现策略：
 *   - 单 Graphics 一次画完所有格，避免 N 个 Sprite/Node 拖动 → 重绘只在皮肤切换或字号变化时
 *   - 两个 emoji（🎮 / 🏆）用 Label 子节点叠在对应格中心；总共 2 个节点开销
 *   - 不订阅模型事件 / 不参与点击命中（pure 视觉）
 */
import { _decorator, Component, Node, UITransform, Graphics, Color, Label } from 'cc';
import { inheritLayer } from './uiKit';

const { ccclass } = _decorator;

/** 7 行像素 bitmap（'1' = 实心，'0' = 空）。每个字母独立列宽。 */
const LETTERS: Record<string, string[]> = {
    O: ['000110', '110011', '110011', '110011', '110011', '110011', '011110'],
    p: ['11110', '10011', '10011', '11110', '10000', '10000', '10000'],
    e: ['1111', '1001', '1001', '1111', '1000', '1000', '1111'],
    n: ['1000001', '1100001', '1010001', '1001001', '1000101', '1000011', '1000001'],
    B: ['001110', '110011', '110011', '111110', '110011', '110011', '111110'],
    l: ['01000', '01000', '01000', '01000', '01000', '01000', '01111'],
    o: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    c: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    k: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
};

/** 哪些格用 emoji 代替方块（坐标基于 LETTERS 7×N 网格）。 */
const ICON_MAP: Record<string, Array<{ r: number; c: number; emoji: string }>> = {
    O: [{ r: 0, c: 1, emoji: '🎮' }],
    B: [{ r: 0, c: 0, emoji: '🏆' }],
};

const STAR_COL_UNITS = 2.4; // 与 web WORDMARK_STAR_COL_UNITS 对齐：星号占的等效列宽
const ROWS = 7;

// 与 web 字标视觉参数严格对齐：
const SKEW_TAN = Math.tan((6 * Math.PI) / 180); // web transform: skewX(-6deg) → 右倾斜体
const WM_RADIUS_FRAC = 0.28;   // web --skin-wm-radius-frac（圆角 = cellW * 0.28）
const WM_GRIDGAP_FRAC = 0.08;  // web --skin-wm-gridgap-frac（格距 = cellH * 0.08）
const WM_ICON_SCALE = 1.5;     // 品牌 emoji 字号 ≈ cellH * 1.5（对齐 web hero font-size）
const WM_LETTER_GAP_FRAC = 0.42; // 同词内字母间距 ≈ web .app-wordmark-pixel__word gap(0.14em)，cellW 单位

export interface WordmarkOpts {
    /** 单元格宽（设计像素）。默认 5。 */
    cellW?: number;
    /** 单元格高。默认 6（略高于宽 → 修长比例，与 web 4×5.5 同步）。 */
    cellH?: number;
    /** 单元格间隙（让方块之间有亮缝，立体感）。默认 0.6。 */
    gap?: number;
    /**
     * 是否绘制柔和的暗色背板（在像素方块之下）—— HUD 场景建议开启，
     * 让 wordmark 在浅色皮肤盘面上仍具备「视觉重量」，且明确划界、阻挡 stat 卡片"压"上 logo。
     * 启动屏 / 主菜单等纯 logo 场景关闭即可（彼时无干扰元素，背板反而显累赘）。
     */
    plate?: boolean;
}

const WORD_LEFT = ['O', 'p', 'e', 'n'];
const WORD_RIGHT = ['B', 'l', 'o', 'c', 'k'];

function letterWidth(ch: string): number {
    const lines = LETTERS[ch];
    return lines ? lines[0].length : 0;
}

function wordWidth(chars: string[]): number {
    let s = 0;
    for (const c of chars) s += letterWidth(c);
    return s;
}

/** 行内最左侧实心列（用于 O/B accent 左缘加粗，对齐 web leftmostFilledCol）。 */
function leftmostFilledCol(rowStr: string): number {
    for (let i = 0; i < rowStr.length; i++) if (rowStr[i] === '1') return i;
    return -1;
}

/** 经典 HSL→RGB（0..1）→ Color。h 单位为 0..360，s/v 0..1。 */
function hslColor(h: number, s: number, l: number): Color {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hh = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs(hh % 2 - 1));
    let r = 0, g = 0, b = 0;
    if (hh < 1) { r = c; g = x; }
    else if (hh < 2) { r = x; g = c; }
    else if (hh < 3) { g = c; b = x; }
    else if (hh < 4) { g = x; b = c; }
    else if (hh < 5) { r = x; b = c; }
    else { r = c; b = x; }
    const m = l - c / 2;
    return new Color(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), 255);
}

@ccclass('Wordmark')
export class Wordmark extends Component {
    /** 在 parent 下创建一个 Wordmark 子节点；返回组件以便定位。 */
    static mount(parent: Node, opts?: WordmarkOpts): Wordmark {
        const n = new Node('Wordmark');
        n.parent = parent;
        inheritLayer(n, parent);
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const c = n.addComponent(Wordmark);
        c.draw(opts ?? {});
        return c;
    }

    private _g: Graphics | null = null;
    private _iconNodes: Node[] = [];

    /** 重新绘制（皮肤切换/分辨率变化时调用）。 */
    redraw(opts?: WordmarkOpts): void {
        this.draw(opts ?? {});
    }

    private draw(opts: WordmarkOpts): void {
        const cellW = Math.max(2, opts.cellW ?? 5);
        const cellH = Math.max(2, opts.cellH ?? 6);
        // 格距 / 圆角与 web --skin-wm-gridgap-frac(0.08) / --skin-wm-radius-frac(0.28) 对齐
        const gap = Math.max(0, opts.gap ?? Math.max(1, cellH * WM_GRIDGAP_FRAC));
        const radius = Math.max(2, cellW * WM_RADIUS_FRAC);
        const plate = opts.plate ?? false;

        const leftCols = wordWidth(WORD_LEFT);
        const rightCols = wordWidth(WORD_RIGHT);
        // 色相归一化按 bitmap 列（无字母间距）—— 与 web colBase/totalSpan 完全一致，保证彩虹分布不变。
        const totalSpan = leftCols + STAR_COL_UNITS + rightCols;

        // 字母间距（对齐 web .app-wordmark-pixel__word gap + accent/e→n 额外外推）：
        // 像素位置含间距、色相不含 —— 二者解耦，既不糊成一团又保持彩虹色谱与 web 一致。
        const baseGap = cellW * WM_LETTER_GAP_FRAC;
        const gapBeforeLetter = (prev: string, cur: string): number => {
            if (!prev) return 0;                                   // 词首：无前导间距
            let gpx = baseGap;
            if (prev === 'O' || prev === 'B') gpx += baseGap;      // accent O/B 后额外拉开（web +0.14em）
            if (prev === 'e' && cur === 'n') gpx += baseGap * 1.4; // e→n 防粘连（web +0.2em）
            return gpx;
        };
        const wordPxWidth = (chars: string[]): number => {
            let w = 0, prev = '';
            for (const ch of chars) { w += gapBeforeLetter(prev, ch) + letterWidth(ch) * cellW; prev = ch; }
            return w;
        };

        const leftWordPxW = wordPxWidth(WORD_LEFT);
        const rightWordPxW = wordPxWidth(WORD_RIGHT);
        const starRegionPx = STAR_COL_UNITS * cellW;             // 词间（星）留白，沿用 STAR_COL_UNITS
        const totalPxW = leftWordPxW + starRegionPx + rightWordPxW;
        const totalPxH = ROWS * cellH;

        // UITransform 尺寸：让外部对齐时可以按 contentSize 自动定位。
        const uit = this.node.getComponent(UITransform)!;
        uit.setContentSize(totalPxW, totalPxH);
        uit.setAnchorPoint(0.5, 0.5);

        // 清掉旧 emoji 节点（重绘时复用 Graphics 一次清空，但 Label 节点需手动）。
        for (const n of this._iconNodes) if (n?.isValid) n.destroy();
        this._iconNodes = [];

        let g = this._g;
        if (!g) {
            g = this.node.getComponent(Graphics) || this.node.addComponent(Graphics);
            this._g = g;
        }
        g.clear();

        // 暗色背板（可选）：让 wordmark 在浅色盘面/复杂背景上仍清晰可读，并视觉划界阻挡其他元素压上。
        // 圆角矩形 + 半透明 + 外扩 padding，模拟 web wordmark 容器的"卡片化"质感。
        if (plate) {
            const padX = Math.max(8, cellW * 1.6);
            const padY = Math.max(6, cellH * 0.9);
            const plateW = totalPxW + padX * 2;
            const plateH = totalPxH + padY * 2;
            const plateR = Math.min(plateW, plateH) * 0.18;
            // 外圈柔和光晕（暗描边，对比度更强）
            g.fillColor = new Color(0, 0, 0, 110);
            g.roundRect(-plateW / 2 - 1.5, -plateH / 2 - 1.5, plateW + 3, plateH + 3, plateR + 1.5);
            g.fill();
            // 主背板：深蓝紫底（与 HUD CARD_BG 色系一致）
            g.fillColor = new Color(20, 26, 44, 215);
            g.roundRect(-plateW / 2, -plateH / 2, plateW, plateH, plateR);
            g.fill();
            // 顶部高光带
            g.fillColor = new Color(180, 200, 230, 38);
            g.rect(-plateW / 2 + 6, plateH / 2 - 2.5, plateW - 12, 1.2);
            g.fill();
        }

        const drawWord = (chars: string[], startXPx: number, startHueCol: number): void => {
            let xCur = startXPx;        // 像素游标（含字母间距）
            let hueCol = startHueCol;   // 色相列游标（bitmap 列，无间距）
            let prev = '';
            for (const ch of chars) {
                xCur += gapBeforeLetter(prev, ch);
                const lines = LETTERS[ch];
                if (!lines) { prev = ch; continue; }
                const lw = lines[0].length;
                const icons = ICON_MAP[ch] ?? [];
                const iconLookup = new Map<string, string>();
                for (const ic of icons) iconLookup.set(`${ic.r},${ic.c}`, ic.emoji);
                for (let r = 0; r < ROWS; r++) {
                    const row = lines[r];
                    for (let c = 0; c < lw; c++) {
                        const filled = row[c] === '1';
                        const ek = `${r},${c}`;
                        const emoji = iconLookup.get(ek);
                        // 像素 x 含字母间距（xCur）；色相用 bitmap 列（hueCol）—— 与 web 解耦一致。
                        const pxX0 = -totalPxW / 2 + xCur + c * cellW;
                        const pxY = totalPxH / 2 - (r + 1) * cellH;
                        // skewX(-6deg)：按格中心 y 做水平错切，复刻 web 字标的右倾斜体。
                        const pxX = pxX0 + SKEW_TAN * (pxY + cellH / 2);
                        if (emoji) {
                            // 品牌 emoji（🎮/🏆）：字号 ≈ cellH*1.5（对齐 web hero），并按 web translate 规则
                            // 右上偏移（gamepad +46% / badge +92%，均上移 12%），突出于字母左上内侧。
                            const fs = Math.max(10, Math.round(cellH * WM_ICON_SCALE));
                            const offX = (emoji === '🎮' ? 0.46 : 0.92) * fs;
                            const offY = 0.12 * fs;
                            const en = new Node('wm-emoji');
                            en.parent = this.node;
                            inheritLayer(en, this.node);
                            en.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
                            en.setPosition(pxX + cellW / 2 + offX, pxY + cellH / 2 + offY, 0);
                            const l = en.addComponent(Label);
                            l.fontSize = fs;
                            l.lineHeight = fs;
                            l.string = emoji;
                            this._iconNodes.push(en);
                        } else if (filled) {
                            // 列位置归一化 → 彩虹色相（与 web wm-cell--rainbow 同式，按 bitmap 列）。
                            const t = (hueCol + c) / totalSpan;
                            const hue = ((t * 360) % 360 + 360) % 360;
                            // accent：O/B 的顶行 / 每行最左实心格做笔触加粗（web .wm-cell--accent-*）。
                            const isAccent = ch === 'O' || ch === 'B';
                            const isTop = isAccent && r === 0;
                            const isLeft = isAccent && c === leftmostFilledCol(row);
                            let bx = pxX + gap / 2;
                            const by = pxY + gap / 2;
                            let bw = cellW - gap;
                            let bh = cellH - gap;
                            if (isTop) bh *= 1.14;                 // 顶边（top 锚定，向上扩展）
                            if (isLeft) { const nw = bw * 1.14; bx -= nw - bw; bw = nw; } // 左缘（left 锚定，向左扩展）
                            // 体色：对角渐变近似（web 148deg：hsl(h,84,58)→hsl(h+18,74,44)）——下暗铺底 + 上亮覆盖。
                            g!.fillColor = hslColor(hue + 18, 0.74, 0.44);
                            g!.roundRect(bx, by, bw, bh, radius);
                            g!.fill();
                            g!.fillColor = hslColor(hue, 0.84, 0.58);
                            g!.roundRect(bx, by + bh * 0.42, bw, bh * 0.58, radius);
                            g!.fill();
                            // 顶部白色高光带（web inset top white + 180deg gloss）
                            g!.fillColor = new Color(255, 255, 255, 115);
                            g!.roundRect(bx + bw * 0.1, by + bh * 0.56, bw * 0.8, bh * 0.3, radius * 0.7);
                            g!.fill();
                            // 1px 暗描边（web border hsla(h,58,34,0.5)）
                            g!.lineWidth = Math.max(1, cellW * 0.08);
                            const border = hslColor(hue, 0.58, 0.34); border.a = 128;
                            g!.strokeColor = border;
                            g!.roundRect(bx, by, bw, bh, radius);
                            g!.stroke();
                        }
                    }
                }
                xCur += lw * cellW;
                hueCol += lw;
                prev = ch;
            }
        };

        // 左词 Open 从最左开始；右词 Block 从「左词宽 + 星留白」之后开始。色相按 bitmap 列连续递增。
        drawWord(WORD_LEFT, 0, 0);
        drawWord(WORD_RIGHT, leftWordPxW + starRegionPx, leftCols + STAR_COL_UNITS);

        // 中间分隔：用 Graphics 画发光的「尖锐四角星」，复刻 web crossstar SVG
        // （viewBox 24×48 → 1:2 修长比；竖向尖角长、横向尖角短；径向辉光 + 渐变星体 + 高光内核）。
        const starCenterCol = leftCols + STAR_COL_UNITS / 2;
        const sx = -totalPxW / 2 + leftWordPxW + starRegionPx / 2; // 星居两词之间的留白中点（y=0，错切量为 0）
        const hueStar = (starCenterCol / totalSpan) * 360;
        const halfW = cellW * 1.1;        // web 星宽 ≈ cellW*2.2
        const halfH = halfW * 2;          // aspect 1:2（竖向尖角更长）
        const sxScale = halfW / 12;       // viewBox 半宽 12
        const syScale = halfH / 24;       // viewBox 半高 24
        const ix = 1.4 * sxScale;         // 内点横向偏移
        const iy = 3 * syScale;           // 内点纵向偏移
        const pts: Array<[number, number]> = [
            [sx, halfH],          // 上尖
            [sx + ix, iy],
            [sx + halfW, 0],      // 右尖
            [sx + ix, -iy],
            [sx, -halfH],         // 下尖
            [sx - ix, -iy],
            [sx - halfW, 0],      // 左尖
            [sx - ix, iy],
        ];
        // 柔光底（web radialGradient glow）：半透明亮椭圆
        const glow = hslColor(hueStar, 0.88, 0.72); glow.a = 70;
        g!.fillColor = glow;
        g!.ellipse(sx, 0, halfW * 1.1, halfH * 0.72);
        g!.fill();
        // 星体（web linearGradient hueMid±28）：填充 + 暗描边
        g!.fillColor = hslColor(hueStar, 0.92, 0.58);
        g!.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) g!.lineTo(pts[i][0], pts[i][1]);
        g!.close();
        g!.fill();
        g!.lineWidth = Math.max(1, cellW * 0.08);
        g!.strokeColor = hslColor(hueStar, 0.75, 0.38);
        g!.stroke();
        // 高光内核（web 中心 circle）
        g!.fillColor = hslColor(hueStar, 0.4, 0.96);
        g!.circle(sx, 0, Math.max(1.5, halfW * 0.28));
        g!.fill();
    }

    onDestroy(): void {
        for (const n of this._iconNodes) if (n?.isValid) n.destroy();
        this._iconNodes = [];
    }
}
