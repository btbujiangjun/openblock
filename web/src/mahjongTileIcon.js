/**
 * 麻将皮肤：无奶油牌块底；仅在格子正中按 **实体牌宽:高 = 21:29** 的虚拟矩形内
 * 尽可能放大主题色文字并居中，字形更醒目。
 */

/** 与 blockIcons / blockColors 一一对应：按底色选高对比字色（v10.28），凸显字形 */
export const MAHJONG_TILE_INK = [
    '#E8FFFC', // 🀀 东 — 冰白偏青（压青绿块 #3DA88C）
    '#FFF6F3', // 🀁 南 — 亮白暖（压朱砂块 #C4424C）
    '#0E301C', // 🀂 西 — 深松绿（压牙白块 #D4C4A0）
    '#E9F0FA', // 🀃 北 — 浅灰蓝白（压玄墨块 #404858）
    '#F3FFF0', // 🀅 發 — 淡黄白（压翡翠块 #2A8870）
    '#2C1400', // 🀇 万 — 深棕（压蜜蜡块 #E0A040）
    '#FFFAF2', // 🀙 筒 — 暖雪白（压钴蓝块 #3070C0）
    '#141808', // 🀐 索 — 近黑橄榄（压苍黄块 #A8A040）
];

const FONT_STACK = '"Segoe UI Symbol","Noto Sans Symbols","PingFang SC","Songti SC","SimSun","Microsoft YaHei",serif';

/** 实体麻将常见宽约:高约 = 21:29 */
const TILE_WH_RATIO = 21 / 29;

/** 在正方形格内取最大内接的 21:29 竖条区域（用于排版字号） */
function _mahjongLayoutRect(size) {
    let fh = size * 0.94;
    let fw = fh * TILE_WH_RATIO;
    const maxW = size * 0.96;
    if (fw > maxW) {
        fw = maxW;
        fh = fw / TILE_WH_RATIO;
    }
    return { fw, fh };
}

function _fitMahjongGlyphPx(ctx, icon, tw, th, fontStack) {
    const padX = tw * 0.02;
    const padY = th * 0.02;
    const maxW = Math.max(4, tw - padX * 2);
    const maxH = Math.max(4, th - padY * 2);
    let fs = Math.min(maxW, maxH) * 1.12;
    const floorFs = 10;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < 18 && fs >= floorFs; i++) {
        ctx.font = `${fs}px ${fontStack}`;
        const m = ctx.measureText(icon);
        const abl = m.actualBoundingBoxLeft;
        const abr = m.actualBoundingBoxRight;
        const ga = m.actualBoundingBoxAscent;
        const gd = m.actualBoundingBoxDescent;
        const gw = (Number.isFinite(abl) && Number.isFinite(abr))
            ? abl + abr
            : m.width;
        const gh = (Number.isFinite(ga) && Number.isFinite(gd))
            ? ga + gd
            : fs * 0.92;
        if (gw <= maxW && gh <= maxH) break;
        fs *= 0.93;
    }
    return Math.max(floorFs, fs);
}

/** @param {CanvasRenderingContext2D} ctx */
function _placeGlyphAlphabetic(ctx, icon, boxX, boxY, boxW, boxH) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(icon);
    const abl = m.actualBoundingBoxLeft;
    const abr = m.actualBoundingBoxRight;
    const aba = m.actualBoundingBoxAscent;
    const abd = m.actualBoundingBoxDescent;
    const hasInkBox = Number.isFinite(abl) && Number.isFinite(abr)
        && Number.isFinite(aba) && Number.isFinite(abd);
    if (hasInkBox) {
        const aw = abl + abr;
        const ah = aba + abd;
        return {
            ax: boxX + (boxW - aw) * 0.5 + abl,
            ay: boxY + (boxH - ah) * 0.5 + aba,
        };
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    return { ax: boxX + boxW * 0.5, ay: boxY + boxH * 0.5 };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} bx
 * @param {number} by
 * @param {number} size
 * @param {string} icon
 * @param {number} colorIdx
 */
export function paintMahjongTileIcon(ctx, bx, by, size, icon, colorIdx) {
    const idx = ((colorIdx % 8) + 8) % 8;
    const ink = MAHJONG_TILE_INK[idx];

    const { fw, fh } = _mahjongLayoutRect(size);
    const fx = bx + (size - fw) * 0.5;
    const fy = by + (size - fh) * 0.5;

    const ti = Math.min(fw, fh) * 0.018;
    const textW = Math.max(4, fw - ti * 2);
    const textH = Math.max(4, fh - ti * 2);
    const textX = fx + ti;
    const textY = fy + ti;

    const fs = _fitMahjongGlyphPx(ctx, icon, textW, textH, FONT_STACK);
    ctx.font = `${fs}px ${FONT_STACK}`;
    const { ax, ay } = _placeGlyphAlphabetic(ctx, icon, textX, textY, textW, textH);

    ctx.fillStyle = ink;
    ctx.fillText(icon, ax, ay);
}
