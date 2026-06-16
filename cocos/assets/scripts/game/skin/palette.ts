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

/**
 * 皮肤强调色（与 web `cssVars['--accent-color']` 同源）—— 用于 HUD 得分/最佳数值上色，
 * 让顶栏数字随皮肤主题变化（如恐龙世界=草绿、海洋=湖蓝），严格对齐 web PC 主端。
 * cocos skins.ts 未移植 cssVars（属 DOM 主题），故在此维护一份 id→accent 映射，缺省回退 web 默认天蓝。
 */
const SKIN_ACCENT: Record<string, [string, string]> = {
    classic:    ['#4FB8E8', '#FFC428'],    titanium:   ['#7eb8ff', '#a5d8ff'],
    aurora:     ['#38D89E', '#72EAB8'],    neonCity:   ['#00E5FF', '#76FF03'],
    ocean:      ['#48CAE4', '#90E0EF'],    sunset:     ['#FF8E3A', '#FFD638'],
    sakura:     ['#FF4490', '#FF80C0'],    koi:        ['#38A8B8', '#60C8D8'],
    candy:      ['#FF44BB', '#CC2288'],    toon:       ['#AA00FF', '#DD40FF'],
    pixel8:     ['#FF2050', '#FF6020'],    dawn:       ['#D98232', '#A85F20'],
    summer:     ['#3078C0', '#1E5CA0'],    cafe:       ['#A87040', '#C89860'],
    garden:     ['#50A060', '#80C888'],    nordic:     ['#5088A8', '#78B0D0'],
    food:       ['#F09020', '#F8D020'],    music:      ['#E040FF', '#FF3060'],
    pets:       ['#C05820', '#904010'],    universe:   ['#6040C8', '#9060E8'],
    fantasy:    ['#9828D8', '#BB50F0'],    greece:     ['#C8A010', '#E8C038'],
    demon:      ['#CC1830', '#E83050'],    jurassic:   ['#5AC030', '#80E050'],
    fairy:      ['#D060F0', '#E890FF'],    industrial: ['#D49640', '#B86838'],
    forbidden:  ['#E8B83C', '#C8222C'],    mahjong:    ['#E0A040', '#C88430'],
    boardgame:  ['#D49830', '#B87828'],    sports:     ['#4F9050', '#70B870'],
    outdoor:    ['#4FA8C8', '#78C8E0'],    vehicles:   ['#E84020', '#FF6040'],
    forest:     ['#38A878', '#60C898'],    pirate:     ['#C8923C', '#E0B060'],
    farm:       ['#78B860', '#A0D880'],    desert:     ['#C89438', '#E0B058'],
    doodle:     ['#4488CC', '#66AAEE'],    zen:        ['#88A888', '#A8C8A8'],
    cyberpunk:  ['#FF00CC', '#00FFCC'],    fiesta:     ['#FF6020', '#FFD020'],
    zodiac:     ['#D02020', '#FFD700'],    apple:      ['#8868D8', '#A888F0'],
    arcadeCabinet:  ['#35E06F', '#FF3B6B'],  circuitBoard:   ['#2FE68A', '#D6F75A'],
    spaceDock:      ['#4AD8FF', '#8C7CFF'],  botanicalStudy: ['#5F8A68', '#486A50'],
    inkGarden:      ['#8E4A4A', '#4A5858'],  mineralCave:    ['#54D3D8', '#B38AF6'],
    winterCabin:    ['#A05A48', '#2F6F88'],  rainyWindow:    ['#6AA0D0', '#D8B858'],
    toyBox:         ['#E8527A', '#42A7E8'],  alchemyLab:     ['#8BD450', '#D8B04A'],
    dungeonLoot:    ['#B88438', '#C6A64A'],  origamiPaper:   ['#D86A88', '#8CA0B8'],
    museumRelic:    ['#C0A05A', '#B0703C'],
};

export function accentColor(skin: Skin, alpha = 255): Color {
    const pair = SKIN_ACCENT[skin.id];
    return hexToColor(pair ? pair[0] : '#38bdf8', alpha);
}

/** 皮肤强调色的深色变体（与 web `--accent-dark` 同源），用于按钮渐变/激活态。 */
export function accentDarkColor(skin: Skin, alpha = 255): Color {
    const pair = SKIN_ACCENT[skin.id];
    return hexToColor(pair ? pair[1] : '#7dd3fc', alpha);
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

/**
 * `lighten` 的零分配变体：把结果写入 `out` 并返回 `out`，供逐格高频绘制（blockPaint）复用 scratch。
 * 与 `lighten` 数值完全一致。
 */
export function lightenInto(out: Color, c: Color, p: number): Color {
    out.r = Math.min(255, Math.round(c.r + (255 - c.r) * p));
    out.g = Math.min(255, Math.round(c.g + (255 - c.g) * p));
    out.b = Math.min(255, Math.round(c.b + (255 - c.b) * p));
    out.a = c.a;
    return out;
}

/** `darken` 的零分配变体（写入 `out` 并返回）。与 `darken` 数值完全一致。 */
export function darkenInto(out: Color, c: Color, p: number): Color {
    out.r = Math.max(0, Math.round(c.r * (1 - p)));
    out.g = Math.max(0, Math.round(c.g * (1 - p)));
    out.b = Math.max(0, Math.round(c.b * (1 - p)));
    out.a = c.a;
    return out;
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
    // 严格对齐 web `_paintBackgroundUnder`：cell 以 `gridCell` 在 `gridOuter` 上 0.96 alpha 叠加。
    // 由于 Cocos Graphics 不便实现"每格独立 alpha 混合"，这里把 web 的混色结果预先解算出来：
    //   result = 0.96 * gridCell + 0.04 * gridOuter
    // 对于 pets(浅盘) 等结果≈gridCell，几乎无可见变化；对于 universe(深盘) 同样保留接近 gridCell 的暗色。
    // 不再用粗暴的 lighten/darken hack——黑乎乎的边由 BoardView 改成"块下垫 cellEmpty"解决，
    // 这里只负责把颜色配置忠实地搬过来，避免和 web 端的视觉差异。
    const cell = hexToColor(skin.gridCell, alpha);
    const outer = hexToColor(skin.gridOuter || skin.cssBg || '#000000', alpha);
    return new Color(
        Math.round(cell.r * 0.96 + outer.r * 0.04),
        Math.round(cell.g * 0.96 + outer.g * 0.04),
        Math.round(cell.b * 0.96 + outer.b * 0.04),
        alpha,
    );
}

/** 盘面外框底色（对齐 web skin.gridOuter；缺省回退到背景色）。 */
export function gridOuterColor(skin: Skin, alpha = 255): Color {
    return hexToColor(skin.gridOuter || skin.cssBg, alpha);
}

/**
 * 网格线颜色 —— 对齐 web renderer._paintBackgroundOver：
 *   - skin.gridLine === false        → 该皮肤显式关闭网格线
 *   - skin.gridLine 是字符串         → 用皮肤指定值（支持 'rgba(...)'）
 *   - 缺省                            → 深盘更亮白线，浅盘深线；保证移动端原生屏幕上清晰分格
 * 返回 null 表示「不要画」。
 */
export function gridLineColor(skin: Skin): Color | null {
    const v = skin.gridLine;
    if (v === false) return null;
    if (typeof v === 'string' && v) {
        return parseColor(v);
    }
    return skin.uiDark === false
        ? new Color(15, 23, 42, 88)
        : new Color(255, 255, 255, 118);
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
