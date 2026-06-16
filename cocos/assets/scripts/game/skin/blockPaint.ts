import { Color, Graphics, Label, Sprite, UITransform, sys } from 'cc';
import { Skin } from '../../core';
import { blockFaceColor, lightenInto, darkenInto, blockMetrics, blockIcon, isLightBoard } from './palette';
import { skinHasImageBlocks, getSkinBlockFrame } from './skinSprites';

/**
 * 仅 iOS / macOS 原生端为 true。Android / Web / 小游戏均为 false。
 * iOS 原生 Cocos 对 system-font + Apple Color Emoji 的 glyph 栅格化存在「大字号上限」：
 * 请求字号超过某阈值后，实际 bitmap 不再增大（仍以小 bitmap 渲染在大字框内 → 表现为「小图」）。
 * 该阈值随 iOS / 引擎版本略有差异，但「小字号区间」在各版本上都稳定按请求尺寸出图。
 * 因此 iOS 统一走「烘焙字号 = min(目标字号, 安全上限) + 节点放大」，对高/低版本都保证尺寸正确：
 *   - 目标 ≤ 安全上限：原字号烘焙、scale=1 → 完全清晰（dock 候选块等小图标即此路径）；
 *   - 目标 > 安全上限：在安全上限烘焙再 upscale → 尺寸正确，且是 Label 路径在该机能拿到的最高分辨率。
 * 其余平台无此上限，按目标字号直接烘焙即清晰（= Android 渲染效果）。
 */
const IS_IOS_NATIVE = sys.isNative && (sys.os === sys.OS.IOS || sys.os === sys.OS.OSX);

/**
 * iOS emoji 烘焙「安全上限」（节点局部坐标 px）。取值原则：
 *   - 必须 ≤ 各 iOS/引擎版本的实际钳制阈值，否则大图标在某些版本上仍会出小图；
 *   - 又要尽量大以减少大图标的放大糊化。
 * 实测当前主流版本钳制阈值 ≈20；取 20 在「现役机型尺寸最准/最清」与「老版本不出小图」间取平衡
 * （若个别老版本阈值更低，大图标仅略偏小 + 略糊，不会出现严重小图）。
 */
const IOS_EMOJI_BAKE_CEILING = 20;

/**
 * 逐格绘制复用的 scratch Color（避免 paintBlockFace 每格 5-6 次 new Color 的 GC 压力：
 * 一次全盘 render 64 格曾产生 ~300+ 次临时 Color 分配，落子/消行/换肤时成批触发）。
 *
 * 安全前提：cc.Graphics 的 `fillColor`/`strokeColor` setter 内部 `_color.set(value)` 会拷贝值，
 * 因此「写 scratch → 赋给 g.fillColor → 立即 fill/stroke」期间 scratch 可被下一段复写，互不影响。
 * `face` 仍由 blockFaceColor 单独分配（既作主色 fill，又作 lighten/darken 的输入，需与 scratch 区分）。
 */
const _tmp = new Color(255, 255, 255, 255);
/** 写入并返回 scratch（常量色路径用）。 */
function col(r: number, g: number, b: number, a: number): Color {
    _tmp.r = r; _tmp.g = g; _tmp.b = b; _tmp.a = a;
    return _tmp;
}

/**
 * 按 `skin.blockStyle` 路由到 web 同款渲染分支。每条分支严格对齐 web `paintBlockCell` 的同名分支：
 *   - cartoon : 哑光磨砂瓷砖（25+ 皮肤的默认；浅/深盘 alpha 系列与 web 完全一致）
 *   - bevel3d : 4 梯形浮雕 + 中心对角渐变（classic 同款"圆润按钮"）
 *   - neon    : 主色面 + 亮色边描 + 顶部高光（neonCity / dawn 同款）
 *   - metal   : 多段横向亮带模拟拉丝（titanium 同款）
 *   - glass   : 主色 + 顶部白光高光 + 双描边（halo / koi 同款）
 *   - jelly   : 主色 + 顶部磨砂 + 左上光斑 + 亮边
 *   - pixel8  : 4 边浮雕（8-bit 凸起瓦片）
 *   - flat    : 纯色 + 极弱描边
 *
 * 共同约定：
 *   - 颜色「面色」由 `blockFaceColor` 处理（带 icon 皮肤已降饱和）；调用方传 `colorIdx`。
 *   - alpha 参数 0-255，分发到所有 fill/stroke 的 alpha 通道，支持 ghost 半透明（alpha=140）。
 *   - cocos 坐标系 y 上为正，`(x, y)` 是 face 的"左下角"。web 的"顶部"对应 cocos `y + size`。
 *
 * @param x,y    方块面左下角（本地坐标）
 * @param size   方块面边长（cell - inset*2）
 * @param radius 圆角半径（已按 blockMetrics 缩放）
 */
export function paintBlockFace(
    g: Graphics, x: number, y: number, size: number, radius: number,
    skin: Skin, colorIdx: number, alpha = 255,
): void {
    const face = blockFaceColor(skin, colorIdx, alpha);
    const r = Math.max(0, Math.min(radius, size / 2));
    const style = skin.blockStyle || 'cartoon';

    // 带 emoji icon 的皮肤统一走简洁渲染：纯色面 + 轻描边，让 emoji 突出。
    // Graphics 无渐变能力，复杂高光/色带在小格子上会产生杂乱条纹遮挡 emoji。
    // 对齐 web v10.9 cartoon 的设计意图："去掉顶部白光层，emoji 100% 清晰"。
    const hasIcon = !!(skin.blockIcons && skin.blockIcons.length);
    if (hasIcon) return paintCartoon(g, x, y, size, r, face, alpha, skin);

    if (style === 'bevel3d') return paintBevel3d(g, x, y, size, r, face, alpha);
    if (style === 'neon') return paintNeon(g, x, y, size, r, face, alpha, skin);
    if (style === 'metal') return paintMetal(g, x, y, size, r, face, alpha);
    if (style === 'glass') return paintGlass(g, x, y, size, r, face, alpha, skin);
    if (style === 'jelly') return paintJelly(g, x, y, size, r, face, alpha);
    if (style === 'pixel8') return paintPixel8(g, x, y, size, face, alpha);
    if (style === 'flat') return paintFlat(g, x, y, size, r, face, alpha);
    return paintCartoon(g, x, y, size, r, face, alpha, skin);
}

/**
 * cartoon —— 哑光磨砂瓷砖（对齐 web `paintBlockCell` 的 cartoon 分支）。
 * web 用 createLinearGradient 做主色弱渐变（顶 lighten topLift → 50% color → 底 darken botDark）+
 * 底部弱暗角；Graphics 无渐变能力，这里用「主色 fill + 顶亮 band + 底暗 band」三段近似 +
 * 严格按 web alpha 数值的双描边（外暖棕/黑、内白），把"圆润按钮"观感保住。
 *
 * web 数值（已 1:1 复刻，浅/深盘差异化）：
 *   topLift          = lightBoard ? 0.08 : 0.16     主色顶端提亮幅度
 *   botDark          = lightBoard ? 0.04 : 0.12     主色底端压暗幅度
 *   botShadeAlpha    = lightBoard ? 0.05 : 0.14     底部黑色暗角 alpha
 *   outerStroke      = lightBoard ? rgba(68,56,40,0.42) : rgba(0,0,0,0.48)   外圈轮廓
 *   innerStrokeWhite = lightBoard ? rgba(255,255,255,0.46) : rgba(255,255,255,0.34)  内圈高光
 *   outerLineWidth   = 1.35  内 = 1
 */
function paintCartoon(
    g: Graphics, x: number, y: number, size: number, r: number,
    face: Color, alpha: number, skin: Skin,
): void {
    const lightBoard = isLightBoard(skin);

    // 绘制顺序：外描边 → 主色面 → 内描边。
    // 先画较粗外描边，再 fill 主色覆盖其内侧——主色 fill 边缘的锯齿被外描边遮住，
    // 外描边外侧的锯齿因颜色接近背景而不可见。这是 Cocos Graphics 消除毛刺的标准技巧。

    // 1. 外暗描边（轮廓——浅盘暖棕、深盘黑）
    g.lineWidth = 2;
    g.fillColor = lightBoard
        ? col(68, 56, 40, Math.round(alpha * 0.42))
        : col(0, 0, 0, Math.round(alpha * 0.48));
    g.strokeColor = g.fillColor;
    g.roundRect(x, y, size, size, r);
    g.stroke();

    // 2. 主色面（略缩进 1px，覆盖外描边内侧，边缘完全被外描边遮住）
    g.fillColor = face;
    g.roundRect(x + 1, y + 1, size - 2, size - 2, Math.max(1, r - 1));
    g.fill();

    // 3. 内白描边（轻高光，对齐 web innerStroke）
    g.lineWidth = 1;
    g.strokeColor = col(255, 255, 255, Math.round(alpha * (lightBoard ? 0.46 : 0.34)));
    g.roundRect(x + 1.5, y + 1.5, size - 3, size - 3, Math.max(0, r - 1.5));
    g.stroke();
}

/**
 * bevel3d —— 4 梯形浮雕 + 中心面（对齐 web `paintBlockCell` 的 bevel3d 分支）。
 * 模拟左上方斜光：顶斜切 lighten 0.18 / 左斜切 +0.06 / 右斜切 −0.16 / 底斜切 −0.32 / 中心 +0.12（近似对角渐变中段）。
 * 零描边（web 注释强调）—— 仅靠色面差异表达体积。bevel 宽度 ~13% size。
 */
function paintBevel3d(
    g: Graphics, x: number, y: number, size: number, _r: number,
    face: Color, alpha: number,
): void {
    const bevel = Math.max(2, Math.round(size * 0.13));
    const ix = x + bevel;
    const iy = y + bevel;
    const is = size - bevel * 2;

    // 顶斜切（web 顶在 by=0，cocos 顶在 y+size；4 顶点：外边两个上角 + 内边两个上角）
    g.fillColor = lightenInto(_tmp, face, 0.18);
    g.fillColor.a = alpha;
    g.moveTo(x, y + size);
    g.lineTo(x + size, y + size);
    g.lineTo(ix + is, iy + is);
    g.lineTo(ix, iy + is);
    g.close();
    g.fill();

    // 左斜切（lighten 0.06）
    g.fillColor = lightenInto(_tmp, face, 0.06);
    g.fillColor.a = alpha;
    g.moveTo(x, y + size);
    g.lineTo(ix, iy + is);
    g.lineTo(ix, iy);
    g.lineTo(x, y);
    g.close();
    g.fill();

    // 右斜切（darken 0.16）
    g.fillColor = darkenInto(_tmp, face, 0.16);
    g.fillColor.a = alpha;
    g.moveTo(x + size, y + size);
    g.lineTo(x + size, y);
    g.lineTo(ix + is, iy);
    g.lineTo(ix + is, iy + is);
    g.close();
    g.fill();

    // 底斜切（darken 0.32 —— 投影面）
    g.fillColor = darkenInto(_tmp, face, 0.32);
    g.fillColor.a = alpha;
    g.moveTo(x, y);
    g.lineTo(ix, iy);
    g.lineTo(ix + is, iy);
    g.lineTo(x + size, y);
    g.close();
    g.fill();

    // 中心面（用 lighten 0.12 近似 web 对角渐变中段；不刷白，保留饱和度）
    g.fillColor = lightenInto(_tmp, face, 0.12);
    g.fillColor.a = alpha;
    g.rect(ix, iy, is, is);
    g.fill();
}

/**
 * neon —— 主色面 + 亮色加宽描边 + 顶部高光（仅无 icon 皮肤）。
 * 对齐 web `paintBlockCell` 的 neon 分支：主色横向渐变 → 亮色外描边 lineWidth 1.5 → 顶部白渐变。
 * Graphics 无渐变，主色用单色 fill 近似；亮边用 lighten(face, 0.22)；顶部高光用 alpha=0.28 的白带。
 */
function paintNeon(
    g: Graphics, x: number, y: number, size: number, r: number,
    face: Color, alpha: number, skin: Skin,
): void {
    // 先描边后填充——消除 fill 边缘毛刺
    g.strokeColor = lightenInto(_tmp, face, 0.22);
    g.strokeColor.a = alpha;
    g.lineWidth = 2;
    g.roundRect(x, y, size, size, r);
    g.stroke();

    // 主色面（内缩 1px）
    g.fillColor = face;
    g.roundRect(x + 1, y + 1, size - 2, size - 2, Math.max(1, r - 1));
    g.fill();

    // 顶部白色高光（仅无 icon 皮肤）
    const hasIcon = !!(skin.blockIcons && skin.blockIcons.length);
    if (!hasIcon) {
        const bandInset = Math.max(1, r * 0.5);
        const topH = Math.max(2, size * 0.42);
        g.fillColor = col(255, 255, 255, Math.round(alpha * 0.28));
        g.roundRect(x + bandInset, y + size - topH, size - bandInset * 2, topH - bandInset, Math.max(0, r - 1));
        g.fill();
    }
}

/**
 * metal —— 多段横向亮带模拟拉丝（对齐 web `paintBlockCell` 的 metal 分支）。
 * web 用 7 色阶垂直渐变（顶 lighten 0.32 → 0.12 darken 0.08 → 0.42 lighten 0.18 → 0.48 lighten 0.38 → ...）。
 * Graphics 无渐变，分 5 段横向 band 近似拉丝节奏：从上到下 lighten 0.32 / lighten 0.18 / lighten 0.38(最亮窄带) / 主色 / darken 0.28。
 * 加白色外描边 + 黑色细内框（web 同款 strokes）。
 */
function paintMetal(
    g: Graphics, x: number, y: number, size: number, r: number,
    face: Color, alpha: number,
): void {
    // 先描边后填充——消除 fill 边缘毛刺
    g.strokeColor = col(255, 255, 255, Math.round(alpha * 0.55));
    g.lineWidth = 2;
    g.roundRect(x, y, size, size, r);
    g.stroke();

    // 主色面（内缩 1px，边缘被白色外描边遮住）
    g.fillColor = darkenInto(_tmp, face, 0.28);
    g.fillColor.a = alpha;
    g.roundRect(x + 1, y + 1, size - 2, size - 2, Math.max(1, r - 1));
    g.fill();

    // 5 段拉丝 band（从顶到底）
    const bandInset = Math.max(1, r * 0.5);
    const bands: Array<[number, number]> = [
        [0.32, 0.12],
        [0.18, 0.30],
        [0.38, 0.06],
        [0.00, 0.30],
        [-0.08, 0.22],
    ];
    let cursorH = size - 1;
    for (const [lift, frac] of bands) {
        const h = Math.max(1, (size - 2) * frac);
        const topY = y + cursorH;
        const bandFace = lift >= 0 ? lightenInto(_tmp, face, lift) : darkenInto(_tmp, face, -lift);
        bandFace.a = alpha;
        g.fillColor = bandFace;
        g.rect(x + bandInset, topY - h, size - bandInset * 2, h);
        g.fill();
        cursorH -= h;
    }

    // 黑色细内框
    g.strokeColor = col(0, 0, 0, Math.round(alpha * 0.32));
    g.lineWidth = 1;
    g.roundRect(x + 1.5, y + 1.5, size - 3, size - 3, Math.max(0, r - 1.5));
    g.stroke();
}

/**
 * glass —— 主色 + 顶部白色高光 + 双描边（对齐 web 的 glass 分支）。
 * web 用主色垂直渐变 + 顶部 0.5/0.14/0.0 三停白渐变；Graphics 近似为
 * 主色 fill + 顶部 alpha 渐弱白色 band。
 */
function paintGlass(
    g: Graphics, x: number, y: number, size: number, r: number,
    face: Color, alpha: number, skin: Skin,
): void {
    const dark = !!skin.uiDark;

    // 先描边（外轮廓）再填充——消除 fill 边缘毛刺
    g.strokeColor = col(255, 255, 255, Math.round(alpha * (dark ? 0.42 : 0.32)));
    g.lineWidth = 2;
    g.roundRect(x, y, size, size, r);
    g.stroke();

    // 主色面（内缩 1px）
    g.fillColor = face;
    g.roundRect(x + 1, y + 1, size - 2, size - 2, Math.max(1, r - 1));
    g.fill();

    // 顶部白色高光（cocos y 向上，"顶部"对应高 y）
    const bandInset = Math.max(1, r * 0.5);
    g.fillColor = col(255, 255, 255, Math.round(alpha * 0.35));
    g.roundRect(x + bandInset, y + size * 0.72, size - bandInset * 2, size * 0.28 - bandInset, Math.max(0, r - 1));
    g.fill();

    // 内细描边
    g.strokeColor = dark
        ? col(0, 0, 0, Math.round(alpha * 0.10))
        : col(15, 23, 42, Math.round(alpha * 0.20));
    g.lineWidth = 1;
    g.roundRect(x + 1.5, y + 1.5, size - 3, size - 3, Math.max(0, r - 1.5));
    g.stroke();
}

/**
 * jelly —— 主色 + 顶部磨砂白 + 亮边（对齐 web jelly 分支，珠光感）。
 * web 还有径向白光斑 + 左上角小光斑椭圆；cocos Graphics 简化为顶部白带 + 亮内描边。
 */
function paintJelly(
    g: Graphics, x: number, y: number, size: number, r: number,
    face: Color, alpha: number,
): void {
    // 先描边后填充——消除 fill 边缘毛刺
    g.strokeColor = lightenInto(_tmp, face, 0.55);
    g.strokeColor.a = Math.round(alpha * 0.80);
    g.lineWidth = 2;
    g.roundRect(x, y, size, size, r);
    g.stroke();

    // 主色面（内缩 1px）
    g.fillColor = face;
    g.roundRect(x + 1, y + 1, size - 2, size - 2, Math.max(1, r - 1));
    g.fill();

    // 顶磨砂白
    const bandInset = Math.max(1, r * 0.5);
    g.fillColor = col(255, 255, 255, Math.round(alpha * 0.45));
    g.roundRect(x + bandInset, y + size * 0.75, size - bandInset * 2, size * 0.25 - bandInset, Math.max(0, r - 1));
    g.fill();

    // 深色细轮廓
    g.strokeColor = darkenInto(_tmp, face, 0.30);
    g.strokeColor.a = Math.round(alpha * 0.30);
    g.lineWidth = 1;
    g.roundRect(x + 1.5, y + 1.5, size - 3, size - 3, Math.max(0, r - 1.5));
    g.stroke();
}

/**
 * pixel8 —— 8-bit 凸起瓦片（对齐 web pixel8 分支）。
 * 顶/左 高光边 + 右/底 阴影边 + 中心面（darken 0.10 弱压底）。零圆角。
 */
function paintPixel8(
    g: Graphics, x: number, y: number, size: number,
    face: Color, alpha: number,
): void {
    const ew = Math.max(1, Math.round(size * 0.14));

    // 主体填色
    g.fillColor = face;
    g.fillColor.a = alpha;
    g.rect(x, y, size, size);
    g.fill();

    // 内陷主体（略压暗）
    g.fillColor = darkenInto(_tmp, face, 0.10);
    g.fillColor.a = alpha;
    g.rect(x + ew, y + ew, size - ew * 2, size - ew * 2);
    g.fill();

    // 顶部亮边（web 中"顶"= 屏幕顶 = cocos y+size）
    g.fillColor = lightenInto(_tmp, face, 0.55);
    g.fillColor.a = alpha;
    g.rect(x + ew, y + size - ew, size - ew * 2, ew);
    g.fill();

    // 左侧亮边
    g.fillColor = lightenInto(_tmp, face, 0.32);
    g.fillColor.a = alpha;
    g.rect(x, y + ew, ew, size - ew * 2);
    g.fill();

    // 右侧暗边
    g.fillColor = darkenInto(_tmp, face, 0.32);
    g.fillColor.a = alpha;
    g.rect(x + size - ew, y + ew, ew, size - ew * 2);
    g.fill();

    // 底部暗边
    g.fillColor = darkenInto(_tmp, face, 0.55);
    g.fillColor.a = alpha;
    g.rect(x + ew, y, size - ew * 2, ew);
    g.fill();
}

/** flat —— 纯色 + 极弱描边（对齐 web flat 分支）。先描边后填充消除 fill 边缘毛刺。 */
function paintFlat(
    g: Graphics, x: number, y: number, size: number, r: number,
    face: Color, alpha: number,
): void {
    g.strokeColor = col(0, 0, 0, Math.round(alpha * 0.14));
    g.lineWidth = 2;
    g.roundRect(x, y, size, size, r);
    g.stroke();

    g.fillColor = face;
    g.roundRect(x + 1, y + 1, size - 2, size - 2, Math.max(1, r - 1));
    g.fill();
}

/** 方块中心 emoji 字号（对齐 web：约 face×0.56，过小则不画）。 */
export function iconFontSize(faceSize: number): number {
    if (faceSize < 14) return 0;
    return Math.max(10, Math.round(faceSize * 0.56));
}

/**
 * iOS 原生（cocos 3.8.8）系统字体 Label 字号变更的 glyph 重烘焙补丁。
 *
 * 故障表现：
 *   候选块（dock，cell≈26~32px）激活变成拖拽 ghost（cell=board.cellSize≈50~60px）后，
 *   方块面正确放大，但 emoji 仍维持 dock 字号 → "方块大了 emoji 没大"。
 *   iOS 独有；Android / Web 正常。
 *
 * 根因：iOS 原生在 system-font + emoji 字形（Apple Color Emoji）的 glyph 纹理生成路径上，
 *   对 `Label.string` 不变 + 仅 `fontSize` 变化的情况，会复用旧 fontSize 的 glyph 纹理，
 *   不重新烘焙；安卓走的是另一套 typeface 渲染路径，没有这条 short-circuit。
 *
 * 修复（应用于 dock 与 ghost 共用的 icon 渲染路径，每次都执行）：
 *   1) 先把 `string` 置空 → 让 iOS 把下一次设值视作"新文本"，绕过短路；
 *   2) 设新 fontSize / lineHeight；
 *   3) 设 string 回 emoji；
 *   4) `cacheMode = NONE`：避开 BITMAP/CHAR 缓存持有过期 fontSize 的纹理；
 *   5) `markForUpdateRenderData(true)`：显式标脏，触发立即重烘焙。
 *
 * 任何旧 cocos 版本缺少对应字段时（typeof 检查不通过），catch 静默退回原行为。
 */
export function applyIconLabel(l: Label, em: string, fs: number): void {
    try {
        const anyL = l as unknown as {
            string: string;
            useSystemFont: boolean;
            fontFamily: string;
            fontSize: number;
            lineHeight: number;
            cacheMode?: unknown;
            markForUpdateRenderData?: (force?: boolean) => void;
        };
        // 1. 先清空 string 让 iOS 视作"新文本"，破除 fontSize-only 变更的 short-circuit。
        anyL.string = '';
        // 2. 设字体栈 + 字号（dock 与 ghost 同 setter）。
        anyL.useSystemFont = true;
        anyL.fontFamily = ICON_FONT_FAMILY;
        anyL.fontSize = fs;
        anyL.lineHeight = fs;
        // 3. 重新设 string，触发以新 fontSize 烘焙 glyph。
        anyL.string = em;
        // 4. 关闭 BITMAP/CHAR 缓存（emoji 纯系统字体直渲，开销极小且杜绝过期纹理）。
        const CacheModeEnum = (Label as unknown as { CacheMode?: { NONE?: unknown } })?.CacheMode;
        if (CacheModeEnum && CacheModeEnum.NONE != null) {
            anyL.cacheMode = CacheModeEnum.NONE;
        }
        // 5. 显式标脏，避免 iOS 原生延迟到下一帧（与 ghost pop 0.6→1.0 同帧时 emoji 缺失同源）。
        anyL.markForUpdateRenderData?.(true);
    } catch {
        // 兜底：旧版本 API 缺失时按原 setter 路径继续，至少在 Android/Web 上保持原行为。
        try { l.useSystemFont = true; l.fontFamily = ICON_FONT_FAMILY; l.fontSize = fs; l.lineHeight = fs; l.string = em; } catch { /* ignore */ }
    }
}

/**
 * 与 web `_paintIcon` 完全同源的 emoji 字体栈。
 * Cocos Label 默认 fontFamily='Arial' —— Arial 不含彩色 emoji 字形，
 * web/小游戏平台会渲染为方框或空字符，导致候选块/拖拽 ghost 上"看不到 icon"。
 * 必须显式设这一栈，Canvas2D 在每个平台按顺序回退到本地可用的彩色 emoji 字体。
 * iOS/macOS → Apple Color Emoji；Win → Segoe UI Emoji；Android → Noto Color Emoji；最后 serif 兜底。
 */
export const ICON_FONT_FAMILY = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif';

/**
 * 跨平台稳健图标设置 —— 按平台分流，保证「与 Android 渲染效果一致 + 全部 iOS 版本（高/低）尺寸正确」：
 *
 *  ● 非 iOS（Android / Web / 小游戏）：**按目标字号直接烘焙 glyph，scale=1** → 原生分辨率清晰
 *    （= Android 原本效果）。这些平台无 emoji 字号上限，无需任何缩放绕过。
 *
 *  ● iOS 原生：**烘焙字号 = min(目标字号, IOS_EMOJI_BAKE_CEILING) + 节点缩放到目标**：
 *      - 目标 ≤ 上限（dock 候选块等小图标）：原字号烘焙、scale=1 → 完全清晰；
 *      - 目标 > 上限（盘面大图标）：在安全上限烘焙再 upscale → 尺寸正确，且是 Label 路径该机最高分辨率。
 *    关键：烘焙字号被钳到 ≤ 安全上限，落在「各 iOS 版本都按请求尺寸出图」的稳定区间 → 高/低版本都不出小图。
 *    同一图标池目标字号固定 → 烘焙字号固定 → 不触发 iOS「仅 fontSize 变化不重烘焙」短路（只烘焙一次）。
 *
 * 各路都显式设 overflow=NONE + 居中对齐（对齐 ghost），避免大字号下 Label 自动换行/裁剪导致字形变形。
 *
 * @param l        复用的 Label
 * @param em       emoji 字符串
 * @param targetFs 目标视觉字号（= iconFontSize(faceSize)，或动画期的缩放后字号）；<=0 则隐藏节点
 */
export function applyIconLabelScaled(l: Label, em: string, targetFs: number): void {
    const node = l.node;
    if (targetFs <= 0) { node.active = false; return; }
    try {
        const anyL = l as unknown as {
            string: string;
            useSystemFont: boolean;
            fontFamily: string;
            fontSize: number;
            lineHeight: number;
            cacheMode?: unknown;
        };
        anyL.useSystemFont = true;
        anyL.fontFamily = ICON_FONT_FAMILY;
        // 大字号下避免自动换行/裁剪把字形压小变形（与 drawGhostIconsScaled 同设）。
        if (Label.Overflow) l.overflow = Label.Overflow.NONE;
        if (Label.HorizontalAlign) l.horizontalAlign = Label.HorizontalAlign.CENTER;
        if (Label.VerticalAlign) l.verticalAlign = Label.VerticalAlign.CENTER;
        const CacheModeEnum = (Label as unknown as { CacheMode?: { NONE?: unknown } })?.CacheMode;
        if (CacheModeEnum && CacheModeEnum.NONE != null) anyL.cacheMode = CacheModeEnum.NONE;

        if (IS_IOS_NATIVE) {
            // 烘焙字号钳到安全上限内（各版本稳定按请求出图），目标更大时由 node.setScale 放大。
            const targetR = Math.max(1, Math.round(targetFs));
            const bakeFs = Math.min(targetR, IOS_EMOJI_BAKE_CEILING);
            if (anyL.fontSize !== bakeFs) { anyL.fontSize = bakeFs; anyL.lineHeight = bakeFs; }
            if (anyL.string !== em) anyL.string = em;
            const s = targetFs / bakeFs;
            node.setScale(s, s, 1);
        } else {
            // 非 iOS：按目标字号直接烘焙，scale=1 → 原生分辨率清晰（与 Android 一致）。
            const fsR = Math.max(1, Math.round(targetFs));
            if (anyL.fontSize !== fsR) { anyL.fontSize = fsR; anyL.lineHeight = fsR; }
            if (anyL.string !== em) anyL.string = em;
            node.setScale(1, 1, 1);
        }
    } catch {
        // 兜底：旧版本 API 缺失时退回 fontSize 直设（Android/Web 正常；iOS 退化为旧行为）。
        try {
            l.useSystemFont = true; l.fontFamily = ICON_FONT_FAMILY;
            l.fontSize = targetFs; l.lineHeight = targetFs; l.string = em;
            l.node.setScale(1, 1, 1);
        } catch { /* ignore */ }
    }
}

/** 形状绘制参数：把"在 (left, top) 处按 cell 平铺一组实体格 + 可选 emoji"抽象为一处实现。 */
export interface DrawShapeOpts {
    /** 形状矩阵：1 = 实体格，0 = 空白。 */
    shape: number[][];
    /** 颜色索引（用于面色与 icon 选择）。 */
    colorIdx: number;
    /** 每格边长（本地坐标）。 */
    cell: number;
    /** 形状外接矩形左下角对应的本地坐标（gx=0 列的左边界 / gy=0 行的"顶部"= top）。
     *  与 BoardView/DockView/Ghost 现有约定一致：x = left + gx*cell；y = top - (gy+1)*cell。 */
    left: number;
    top: number;
    /** 面色透明度（0–255）。半透明用于落点预览 / 候选区拖拽态。 */
    alpha?: number;
    /** 越界裁剪：返回 true 则跳过该格（仅 BoardGhost 在盘面外时用）。 */
    skipCell?: (gx: number, gy: number) => boolean;
}

/** Icon 池回调：调用方按"第 i 个 emoji"自行管理 Label 节点池。 */
export interface DrawShapeIconPool {
    /** 返回（或按需创建）第 i 个 emoji Label；返回 null 则本格不画 icon。 */
    getIcon: (i: number) => Label | null;
    /** 把超出本次使用数量的 icon 全部 hide，避免上次绘制的残留 emoji 飘在角落。 */
    hideRemaining: (fromIndex: number) => void;
}

/** Sprite 池回调：图片皮肤（blockIconAssets）用整面贴图渲染方块，复用 emoji 同款池模式。 */
export interface DrawShapeSpritePool {
    /** 返回（或按需创建）第 i 个方块 Sprite；返回 null 则本格回退绘面。 */
    getSprite: (i: number) => Sprite | null;
    /** 把超出本次使用数量的 Sprite 全部 hide。 */
    hideRemaining: (fromIndex: number) => void;
}

/** Sprite 着色 scratch（白色 × alpha，避免逐格 new Color）。 */
const _spriteTint = new Color(255, 255, 255, 255);

/**
 * 共享方块"形状面"绘制：BoardView 的落点 ghost、DockView 的候选块、GameController 的拖拽 ghost、
 * 以及 SkinPanel 的迷你预览均走同一管线，避免三处分别推演产生质感漂移。
 *
 * 调用方负责：
 *  - 准备 Graphics 上下文与坐标基点（left, top）
 *  - 提供 IconPool（如不需要 icon 则不传）
 *  - 处理外层布局（卡片背板、滚动等）
 */
export function drawShapeFaces(
    g: Graphics,
    skin: Skin,
    opts: DrawShapeOpts,
    iconPool?: DrawShapeIconPool,
    spritePool?: DrawShapeSpritePool,
): number {
    const { shape, colorIdx, cell, left, top, alpha = 255, skipCell } = opts;
    const { inset, radius } = blockMetrics(skin, cell);
    const fsize = cell - inset * 2;
    // 图片皮肤：整面贴图替代绘面 + emoji（与 web blockIconAssets 一致）。
    const imgSkin = skinHasImageBlocks(skin);
    const imgSize = Math.max(1, cell - Math.max(2, Math.round(cell * 0.06)));
    let iconN = 0;
    let spriteN = 0;
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (!shape[y][x]) continue;
            if (skipCell?.(x, y)) continue;
            const cellX = left + x * cell;
            const cellY = top - (y + 1) * cell;
            let drewSprite = false;
            if (imgSkin && spritePool) {
                const sf = getSkinBlockFrame(skin, colorIdx);
                if (sf) {
                    const s = spritePool.getSprite(spriteN);
                    if (s) {
                        s.node.active = true;
                        if (s.spriteFrame !== sf) s.spriteFrame = sf;
                        (s.node.getComponent(UITransform) || s.node.addComponent(UITransform)).setContentSize(imgSize, imgSize);
                        s.node.setPosition(cellX + cell / 2, cellY + cell / 2, 0);
                        _spriteTint.set(255, 255, 255, alpha);
                        s.color = _spriteTint;
                        spriteN++;
                        drewSprite = true;
                    }
                }
            }
            if (!drewSprite) {
                // 非图片皮肤，或贴图尚未加载完成 → 绘面占位（图片皮肤不画 emoji）。
                paintBlockFace(g, cellX + inset, cellY + inset, fsize, radius, skin, colorIdx, alpha);
            }
            if (!imgSkin && iconPool) {
                const em = blockIcon(skin, colorIdx);
                const fs = em ? iconFontSize(fsize) : 0;
                if (em && fs > 0) {
                    const l = iconPool.getIcon(iconN);
                    if (l) {
                        l.node.active = true;
                        l.node.setPosition(cellX + cell / 2, cellY + cell / 2, 0);
                        // 字号 + emoji 通过 applyIconLabel 设置 —— iOS 原生在仅 fontSize 变化时
                        // 不会重烘焙系统字体 glyph 纹理（dock→ghost 时方块变大、emoji 滞留小字号），
                        // 该函数清 string + 重设 + 标脏 + cacheMode=NONE 修复此差异。详见函数注释。
                        applyIconLabel(l, em, fs);
                        l.color = new Color(255, 255, 255, alpha);
                        iconN++;
                    }
                }
            }
        }
    }
    iconPool?.hideRemaining(iconN);
    spritePool?.hideRemaining(spriteN);
    return iconN;
}
