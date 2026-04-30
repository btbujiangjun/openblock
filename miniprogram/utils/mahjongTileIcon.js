/**
 * 与 web/src/mahjongTileIcon.js 同步：无牌块底，21:29 虚拟区内大字。
 */

const MAHJONG_TILE_INK = [
  '#E8FFFC',
  '#FFF6F3',
  '#0E301C',
  '#E9F0FA',
  '#F3FFF0',
  '#2C1400',
  '#FFFAF2',
  '#141808',
];

const FONT_STACK = '"Segoe UI Symbol","Noto Sans Symbols","PingFang SC","Songti SC","SimSun","Microsoft YaHei",serif';

const TILE_WH_RATIO = 21 / 29;

function mahjongLayoutRect(size) {
  let fh = size * 0.94;
  let fw = fh * TILE_WH_RATIO;
  const maxW = size * 0.96;
  if (fw > maxW) {
    fw = maxW;
    fh = fw / TILE_WH_RATIO;
  }
  return { fw, fh };
}

function fitMahjongGlyphPx(ctx, icon, tw, th, fontStack) {
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

function placeGlyphAlphabetic(ctx, icon, boxX, boxY, boxW, boxH) {
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

function paintMahjongTileIcon(ctx, bx, by, size, icon, colorIdx) {
  const idx = ((colorIdx % 8) + 8) % 8;
  const ink = MAHJONG_TILE_INK[idx];

  const { fw, fh } = mahjongLayoutRect(size);
  const fx = bx + (size - fw) * 0.5;
  const fy = by + (size - fh) * 0.5;

  const ti = Math.min(fw, fh) * 0.018;
  const textW = Math.max(4, fw - ti * 2);
  const textH = Math.max(4, fh - ti * 2);
  const textX = fx + ti;
  const textY = fy + ti;

  const fs = fitMahjongGlyphPx(ctx, icon, textW, textH, FONT_STACK);
  ctx.font = `${fs}px ${FONT_STACK}`;
  const { ax, ay } = placeGlyphAlphabetic(ctx, icon, textX, textY, textW, textH);

  ctx.fillStyle = ink;
  ctx.fillText(icon, ax, ay);
}

module.exports = {
  paintMahjongTileIcon,
};
