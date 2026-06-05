import { Color } from 'cc';
import { Skin } from '../../core';

/** 把 '#rrggbb' / '#rgb' / 'rgb(a)(...)' 解析为 cc.Color。 */
export function parseColor(input: string, alpha = 255): Color {
    const s = (input || '').trim();
    if (s.startsWith('rgb')) {
        const nums = s.replace(/rgba?\(|\)/g, '').split(',').map((p) => parseFloat(p.trim()));
        const [r, g, b, a] = nums;
        return new Color(r || 0, g || 0, b || 0, a === undefined ? alpha : Math.round(a * 255));
    }
    return hexToColor(s, alpha);
}

/** 把 '#rrggbb' / '#rgb' 解析为 cc.Color。 */
export function hexToColor(hex: string, alpha = 255): Color {
    let h = (hex || '#000000').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    return new Color(r, g, b, alpha);
}

export function blockColor(skin: Skin, colorIdx: number, alpha = 255): Color {
    const arr = skin.blockColors;
    const hex = arr[((colorIdx % arr.length) + arr.length) % arr.length];
    return hexToColor(hex, alpha);
}

/** 向白色插值（对齐 web lightenColor）。 */
export function lighten(c: Color, p: number): Color {
    return new Color(
        Math.min(255, Math.round(c.r + (255 - c.r) * p)),
        Math.min(255, Math.round(c.g + (255 - c.g) * p)),
        Math.min(255, Math.round(c.b + (255 - c.b) * p)),
        c.a,
    );
}

/** 向黑色插值（对齐 web darkenColor）。 */
export function darken(c: Color, p: number): Color {
    return new Color(
        Math.max(0, Math.round(c.r * (1 - p))),
        Math.max(0, Math.round(c.g * (1 - p))),
        Math.max(0, Math.round(c.b * (1 - p))),
        c.a,
    );
}

/** sRGB 相对亮度（用于判定浅色盘面，对齐 web gridCellRelativeLuminance）。 */
function relLuminance(c: Color): number {
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

/** 浅色盘面（奶油/米白格面），对齐 web isLightBoardSkin：gridCell 相对亮度 ≥ 0.78。 */
export function isLightBoard(skin: Skin): boolean {
    return relLuminance(hexToColor(skin.gridCell || '#000000')) >= 0.78;
}

function rgbToHsl(c: Color): [number, number, number] {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
        const d = mx - mn;
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        switch (mx) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4;
        }
        h /= 6;
    }
    return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

function hslToColor(h: number, s: number, l: number, alpha = 255): Color {
    if (s === 0) {
        const v = Math.round(l * 255);
        return new Color(v, v, v, alpha);
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return new Color(
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
        alpha,
    );
}

/** HSL 空间降饱和（对齐 web desaturateColor，保留色相/明度）。 */
export function desaturate(c: Color, factor: number): Color {
    const [h, s, l] = rgbToHsl(c);
    return hslToColor(h, Math.max(0, Math.min(1, s * factor)), l, c.a);
}

/**
 * 方块「面色」：带 icon 皮肤按 web 策略降饱和（深盘 ×0.55 / 浅盘 ×0.92），
 * 让中心 emoji 在哑光底色上更清晰；无 icon 皮肤保持原色。
 */
export function blockFaceColor(skin: Skin, colorIdx: number, alpha = 255): Color {
    const base = blockColor(skin, colorIdx, alpha);
    if (skin.blockIcons && skin.blockIcons.length) {
        return desaturate(base, isLightBoard(skin) ? 0.92 : 0.55);
    }
    return base;
}

/** 取某个色位对应的 emoji 图标（无 icon 皮肤返回 null）。 */
export function blockIcon(skin: Skin, colorIdx: number): string | null {
    const arr = skin.blockIcons;
    if (!arr || !arr.length) return null;
    return arr[((colorIdx % arr.length) + arr.length) % arr.length] || null;
}

/** 方块 inset/圆角随格子尺寸自适应（对齐 web _adaptiveBlockMetrics，基线 38px）。 */
export function blockMetrics(skin: Skin, cell: number): { inset: number; radius: number } {
    const baseInset = skin.blockInset ?? 2;
    const baseR = skin.blockRadius ?? 5;
    const scale = Math.max(0.7, Math.min(1.6, cell / 38));
    return {
        inset: Math.max(1, Math.round(baseInset * scale)),
        radius: Math.max(2, Math.round(baseR * scale)),
    };
}

export function cellEmptyColor(skin: Skin, alpha = 255): Color {
    return hexToColor(skin.gridCell, alpha);
}

/** 盘面外框底色（对齐 web skin.gridOuter；缺省回退到背景色）。 */
export function gridOuterColor(skin: Skin): Color {
    return hexToColor(skin.gridOuter || skin.cssBg, 255);
}

export function bgColor(skin: Skin): Color {
    return hexToColor(skin.cssBg, 255);
}

/** 消行闪光色（对齐 web skin.clearFlash，支持 rgba()）。 */
export function clearFlashColor(skin: Skin, alpha?: number): Color {
    const c = parseColor(skin.clearFlash || '#ffffff', 255);
    if (alpha !== undefined) c.a = alpha;
    return c;
}
