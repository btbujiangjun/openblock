import { Color, Graphics } from 'cc';
import { Skin } from '../../core';
import { blockFaceColor, lighten, darken } from './palette';

/**
 * 用 Graphics 近似 web 各 blockStyle 的立体观感（无渐变/材质贴图时的可行近似）：
 *   主色面 + 顶亮内描边（bevel 高光）+ 暗外描边（轮廓），按 style 调整高光强度。
 * web 的逐风格渐变（metal 拉丝 / glass 折射 / jelly 珠光等）在 Graphics 下不可逐像素复刻，
 * 这里用「面色 + 双描边」抓住"哑光瓷砖/按钮"主观感，并与 emoji 图标配合（带 icon 皮肤已降饱和）。
 *
 * @param x,y 方块面左下角（本地坐标）
 * @param size 方块面边长
 */
export function paintBlockFace(
    g: Graphics, x: number, y: number, size: number, radius: number,
    skin: Skin, colorIdx: number, alpha = 255,
): void {
    const face = blockFaceColor(skin, colorIdx, alpha);
    const r = Math.max(0, Math.min(radius, size / 2));
    const style = skin.blockStyle || 'cartoon';

    // 1. 主色面
    g.fillColor = face;
    g.roundRect(x, y, size, size, r);
    g.fill();

    // 顶部高光带（近似自上而下的渐变高光）：在面内上半部叠一层更亮的圆角块。
    // 带 icon 的 neon/cartoon 皮肤 web 会弱化顶光以免洗白 emoji 头部，这里同样压低。
    const hasIcon = !!(skin.blockIcons && skin.blockIcons.length);
    let topLift = 0.18;
    if (style === 'metal') topLift = 0.34;
    else if (style === 'glass' || style === 'jelly') topLift = 0.30;
    else if (style === 'neon') topLift = hasIcon ? 0.12 : 0.26;
    else if (style === 'pixel8') topLift = 0.46;
    const bandH = Math.max(2, size * (style === 'pixel8' ? 0.5 : 0.42));
    const bandInset = Math.max(0.5, r * 0.5);
    g.fillColor = lighten(face, topLift);
    g.roundRect(x + bandInset, y + size - bandH, size - bandInset * 2, bandH - bandInset, Math.max(0, r - 1));
    g.fill();

    // 2. 暗外描边（轮廓，浅盘用暖棕、深盘用黑）
    g.lineWidth = Math.max(1, size * 0.04);
    g.strokeColor = skin.uiDark === false ? new Color(68, 56, 40, 110) : new Color(0, 0, 0, 120);
    g.roundRect(x + 0.5, y + 0.5, size - 1, size - 1, Math.max(0, r - 0.5));
    g.stroke();

    // 3. 顶亮内描边（bevel 高光）
    g.lineWidth = Math.max(1, size * 0.05);
    g.strokeColor = lighten(face, style === 'metal' ? 0.55 : 0.38);
    g.roundRect(x + 1, y + 1, size - 2, size - 2, Math.max(0, r - 1));
    g.stroke();

    // 4. 底部暗角（轻微体积感）
    const shade = darken(face, 0.16);
    shade.a = Math.round(alpha * (skin.uiDark === false ? 0.10 : 0.18));
    g.fillColor = shade;
    g.roundRect(x + bandInset, y + bandInset, size - bandInset * 2, Math.max(2, size * 0.16), Math.max(0, r - 1));
    g.fill();
}

/** 方块中心 emoji 字号（对齐 web：约 face×0.56，过小则不画）。 */
export function iconFontSize(faceSize: number): number {
    if (faceSize < 14) return 0;
    return Math.max(10, Math.round(faceSize * 0.56));
}
