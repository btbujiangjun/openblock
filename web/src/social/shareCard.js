/**
 * shareCard.js — v10.18 分享海报艺术化
 *
 * 设计目标
 * --------
 * 把海报当作一张「展品宣传海报」：
 *   - 顶部产品 logo 用与游戏内同源的「Open ★ Block」彩虹像素字标（直接复用 blockWordmark.js 字模）。
 *   - 分数弱化为棋盘下方「展品标签」上的一个小字。
 *   - 棋盘是绝对视觉主体，居中放大并叠加多层光环 + 四角十字定位 + 放射聚光线。
 *   - 文字采用宋体衬线 + 衬线西文 + 等宽 URL，告别 sans-serif 的工业感。
 *
 * 视觉层级
 * --------
 *   ┌────────────────────────────────────┐
 *   │       [ Open ★ Block ]             │ 像素 logo（与游戏一致）
 *   │       —— 本局战绩 · No.001 ——        │ 衬线斜体 caption + 主色 hairline
 *   │                                    │
 *   │   ╋──────────────────────────────╋ │ 棋盘四角十字
 *   │   │                              │ │
 *   │   │       棋盘 · 600×600          │ │ 三层光环 + 椭圆投影 + 内顶高光
 *   │   │                              │ │
 *   │   ╋──────────────────────────────╋ │
 *   │                                    │
 *   │   ●  美食盛宴  SKIN     360 PTS     │ 展品标签条（皮肤 + 弱化分数）
 *   │   ──────────────────────────────   │
 *   │   你能玩到第几关？        ┌─QR─┐    │ 衬线 hook + URL + QR + 印鉴
 *   │   ▸ github.com/...        └────┘    │
 *   │   OPEN BLOCK · ENDLESS ARENA · 2026 │
 *   └────────────────────────────────────┘
 *
 * 技术约束
 * --------
 * - 零外部依赖：纯 Canvas 2D
 * - API 兼容：保持 generatePoster / downloadPoster / sharePoster / window.__shareCard 不变
 * - logo 数据复用 blockWordmark.js 的 LETTERS / ICON_MAP，不再硬编码副本
 */

import { getActiveSkin } from '../skins.js';
import {
    ICON_MAP as WM_ICON_MAP,
    WORDMARK_STAR_COL_UNITS as WM_STAR_COL,
    letterBitmapWidth as wmLetterWidth,
    lookupBitmap as wmLookupBitmap,
    wordWidth as wmWordWidth,
} from '../blockWordmark.js';
import { t } from '../i18n/i18n.js';

const POSTER_W = 720;
const POSTER_H = 1280;
/* 输出 2× 物理像素以避免棋盘缩放时模糊；逻辑坐标仍按 720×1280 写。 */
const POSTER_DPR = 2;

/* ---- 字体 stack：以衬线为主，提升艺术感；中文宋体优先，西文 Cormorant 兜底 ---- */
const FONT_SERIF = '"Songti SC", "STSongti-SC-Regular", "STSong", "STZhongsong", "Noto Serif SC", "Source Han Serif SC", "Cormorant Garamond", "EB Garamond", "Playfair Display", "Didot", "Times New Roman", serif';
const FONT_MONO = '"SF Mono", "Menlo", "Consolas", "Courier New", monospace';

let _audio = null;

/**
 * v10.18.3：不再自动注入按钮。
 * 结算卡内的分享入口由 index.html 的 #share-btn 静态承载，
 * 由 main.js 统一在 initShareCard 之后绑定 click → generatePoster + share/download。
 */
export function initShareCard({ game, audio = null } = {}) {
    _audio = audio;
    void game;
    if (typeof window !== 'undefined') {
        window.__shareCard = { generatePoster, downloadPoster, sharePoster, getAudio: () => _audio };
    }
}

/* ============================================================
 *  Canvas 海报合成
 * ========================================================== */

export async function generatePoster() {
    const canvas = document.createElement('canvas');
    canvas.width = POSTER_W * POSTER_DPR;
    canvas.height = POSTER_H * POSTER_DPR;
    const ctx = canvas.getContext('2d');
    /* 让所有绘制坐标继续按 720×1280 写，由 DPR 放大到物理像素；
     * 同时打开高质量插值，避免棋盘 / emoji 在缩放时出现锯齿模糊。 */
    ctx.scale(POSTER_DPR, POSTER_DPR);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const skin = getActiveSkin();
    const palette = _derivePalette(skin);
    const score = (window.openBlockGame?.score | 0) || 0;
    const gameCanvas = typeof document !== 'undefined' ? document.getElementById('game-grid') : null;

    /* 自下而上图层堆叠：背景渐变 + 暗化 ghost wordmark + 放射光，不再撒色块 confetti（用户反馈干扰主体）。 */
    _drawBackdrop(ctx, palette);
    _drawGhostWordmark(ctx, palette);
    _drawRadialRays(ctx, palette);

    /* logo：优先 1:1 复刻游戏 DOM；DOM 不可用时回退手绘字模。
     * 收敛字标视觉权重（460<580），避免压过棋盘。
     * italic 仅靠 DOM 自带的 skewX(-6deg) 即可——若再叠加 ctx skew，相邻字母 cell 的
     * axis-aligned boundingRect 会重叠，把 letter gap (0.38em) 吃掉，导致 "OP" / "OC" 黏连。 */
    if (!_captureDomLogo(ctx, { y: 60, w: 460 })) {
        _drawBrandLogo(ctx, { y: 70, cellW: 9, cellH: 14, italicSkew: 0.12, letterGap: 4 });
    }

    /* 不再绘制独立分数 plate：分数已并入 footer 主 hook（"你能击败 X 分吗？"），
     * 棋盘下方的留白让出呼吸感。 */
    _drawBoardStage(ctx, gameCanvas, palette);
    _drawFooter(ctx, palette, score);

    return canvas.toDataURL('image/png', 0.95);
}

export function downloadPoster(dataUrl) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `openblock-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

export async function sharePoster(dataUrl) {
    if (!navigator.share) return downloadPoster(dataUrl);
    try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'openblock-share.png', { type: 'image/png' });
        await navigator.share({
            title: t('share.poster.shareTitle'),
            text: t('share.poster.shareText'),
            files: [file],
        });
    } catch {
        downloadPoster(dataUrl);
    }
}

/* ============================================================
 *  分区绘制
 * ========================================================== */

/** 背景：皮肤色驱动的深色径向渐变 + 顶部辉光 + 暗角 vignette。 */
function _drawBackdrop(ctx, palette) {
    const { deep, deeper, accent } = palette;

    const radial = ctx.createRadialGradient(
        POSTER_W * 0.5, POSTER_H * 0.45, 80,
        POSTER_W * 0.5, POSTER_H * 0.55, POSTER_W * 1.0
    );
    radial.addColorStop(0, deep);
    radial.addColorStop(1, deeper);
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);

    const topGlow = ctx.createLinearGradient(0, 0, 0, 320);
    topGlow.addColorStop(0, _rgba(accent, 0.18));
    topGlow.addColorStop(1, _rgba(accent, 0));
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, POSTER_W, 320);

    const vignette = ctx.createRadialGradient(
        POSTER_W * 0.5, POSTER_H * 0.5, POSTER_W * 0.45,
        POSTER_W * 0.5, POSTER_H * 0.55, POSTER_W * 0.95
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);
}

/** 背景超大 OPEN / BLOCK outline ghost wordmark，作编辑感衬底纹理。 */
function _drawGhostWordmark(ctx, palette) {
    const { accent } = palette;
    ctx.save();
    ctx.translate(POSTER_W / 2, POSTER_H / 2);
    ctx.rotate(-Math.PI * 0.035);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 240px ${FONT_SERIF}`;
    ctx.lineWidth = 2;
    ctx.strokeStyle = _rgba(accent, 0.06);
    ctx.strokeText('OPEN', 0, -110);
    ctx.strokeText('BLOCK', 0, 130);
    ctx.restore();
}

/** 棋盘背后的极简放射聚光线。 */
function _drawRadialRays(ctx, palette) {
    const { accent } = palette;
    const cx = POSTER_W / 2;
    /* 与 _drawBoardStage 中 iy=246 + imgSize/2 对齐，确保放射光以棋盘几何中心为锚。 */
    const cy = 566;
    ctx.save();
    ctx.lineCap = 'round';
    const N = 18;
    for (let i = 0; i < N; i++) {
        const angle = (Math.PI * 2 * i) / N + Math.PI / N;
        const r1 = 360;
        const r2 = 460 + Math.sin(i * 0.83) * 40;
        const alpha = 0.04 + ((i % 3) === 0 ? 0.04 : 0);
        ctx.strokeStyle = _rgba(accent, alpha);
        ctx.lineWidth = (i % 4 === 0) ? 2.4 : 1.2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
        ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * 顶部品牌 logo（首选路径）：直接读取游戏 DOM `h1.app-wordmark .app-wordmark-pixel`，
 * 遍历每个 `.wm-cell` 的 boundingClientRect + computedStyle，在 Canvas 上 1:1 复刻。
 *
 * 这样能 100% 与游戏界面保持一致：
 * - 彩虹色相、皮肤色、cool/warm 分组、背景图、letter-spacing、e→n 拉距等全部继承
 * - 切换皮肤后，海报字标会自动跟着变
 * - 无需在两份代码里维护字模 / 颜色派生的副本
 *
 * 找不到 DOM 时返回 false，由调用方回退到 `_drawBrandLogo` 位图重绘。
 */
function _captureDomLogo(ctx, opts = {}) {
    if (typeof document === 'undefined' || typeof window === 'undefined') return false;
    /* 优先选 hero 版（首页大 logo），其次任意 wordmark，再退化到 header 版 */
    const dom = document.querySelector('.app-wordmark--hero .app-wordmark-pixel')
        || document.querySelector('h1.app-wordmark .app-wordmark-pixel')
        || document.querySelector('.app-wordmark .app-wordmark-pixel')
        || document.querySelector('.app-wordmark-pixel');
    if (!dom) return false;
    const rect = dom.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;

    const targetW = opts.w || 580;
    const scale = targetW / rect.width;
    const targetH = rect.height * scale;
    const ox = opts.x ?? (POSTER_W - targetW) / 2;
    const oy = opts.y ?? 50;
    const italicSkew = opts.italicSkew || 0;

    const cells = dom.querySelectorAll('.wm-cell');
    if (!cells.length) return false;

    /* 以 logo 中心为枢轴施加 skew，让字标整体向右倾斜（标题斜体感），不平移、不变形 cell 自身。 */
    const pivotX = ox + targetW / 2;
    const pivotY = oy + targetH / 2;
    ctx.save();
    if (italicSkew) {
        ctx.translate(pivotX, pivotY);
        ctx.transform(1, 0, -italicSkew, 1, 0, 0);
        ctx.translate(-pivotX, -pivotY);
    }

    for (const cell of cells) {
        if (cell.classList.contains('wm-cell--void')) continue;
        const cr = cell.getBoundingClientRect();
        if (!(cr.width > 0 && cr.height > 0)) continue;
        const x = ox + (cr.left - rect.left) * scale;
        const y = oy + (cr.top - rect.top) * scale;
        const w = cr.width * scale;
        const h = cr.height * scale;
        const cs = window.getComputedStyle(cell);

        if (cell.classList.contains('wm-cell--icon')) {
            const emoji = (cell.textContent || '').trim();
            if (!emoji) continue;
            const fz = (parseFloat(cs.fontSize) || h) * scale;
            ctx.save();
            ctx.font = `${fz}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            /* 已经包含了 transform 影响（getBoundingClientRect 是 layout 后位置） */
            ctx.fillText(emoji, x + w / 2, y + h / 2);
            ctx.restore();
            continue;
        }

        /* 普通色块：优先 backgroundColor；透明则退化到 --wm-rainbow-hue */
        let fill = cs.backgroundColor;
        const isTransparent = !fill || fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent';
        if (isTransparent) {
            const hueRaw = cs.getPropertyValue('--wm-rainbow-hue');
            const hue = parseFloat(hueRaw);
            if (Number.isFinite(hue)) fill = `hsl(${hue}, 92%, 60%)`;
            else fill = 'rgba(255,255,255,0.85)';
        }
        const radius = Math.max(0.5, (parseFloat(cs.borderTopLeftRadius) || 1.5) * scale);
        _roundRect(ctx, x, y, w, h, radius);
        ctx.fillStyle = fill;
        ctx.fill();

        /* 顶部白色高光：模拟游戏内 inset 高光，避免纯平 */
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x, y, w, Math.max(1, h * 0.14));
    }

    /* cross-star：取 SVG 的实际 boundingRect，按 24×48 viewBox 严格还原（保证与游戏一致）。 */
    const star = dom.querySelector('.app-wordmark-pixel__crossstar svg, .app-wordmark-pixel__crossstar');
    if (star) {
        const sr = star.getBoundingClientRect();
        if (sr.width > 0 && sr.height > 0) {
            const sx = ox + (sr.left - rect.left + sr.width / 2) * scale;
            const sy = oy + (sr.top - rect.top + sr.height / 2) * scale;
            const sw = sr.width * scale;
            const sh = sr.height * scale;
            const totalSpan = wmWordWidth('Open') + WM_STAR_COL + wmWordWidth('Block');
            const hue = ((wmWordWidth('Open') + WM_STAR_COL / 2) / totalSpan) * 360;
            _drawCrossStar(ctx, sx, sy, sw, sh, hue);
        }
    }

    ctx.restore();
    return { x: ox, y: oy, w: targetW, h: targetH };
}

/** 顶部品牌 logo（回退路径）：复用 blockWordmark.js 字模 + ICON_MAP，画彩虹像素字标 + cross-star。 */
function _drawBrandLogo(ctx, opts = {}) {
    const phrase = opts.phrase || 'Open·Block';
    const cellW = opts.cellW || 11;
    const cellH = opts.cellH || 17;
    const cellGap = 1;
    const cornerRadius = 1.6;
    const sidePad = 8;
    /* 字母间额外像素间距：让 italic skew 后相邻字母仍可读，与 CSS .app-wordmark-pixel { gap: 0.38em } 等价。 */
    const letterGap = opts.letterGap || 0;

    const [aWord, bWord] = phrase.split('·');
    const wA = wmWordWidth(aWord);
    const wB = wmWordWidth(bWord);
    const totalSpan = wA + WM_STAR_COL + wB;

    /* 估算 Open 内 e→n 字距加宽（与游戏内一致：0.4 cell 视觉间距）*/
    let enBumpA = 0;
    {
        let prev = '';
        for (const ch of aWord) {
            if (ch === ' ') continue;
            if (prev === 'e' && ch === 'n') enBumpA += cellW * 0.4;
            prev = ch;
        }
    }

    const widthA = wA * cellW + enBumpA;
    const widthB = wB * cellW;
    const starW = WM_STAR_COL * cellW;
    const totalW = widthA + sidePad + starW + sidePad + widthB;
    const totalH = 7 * cellH;

    const ox = (POSTER_W - totalW) / 2;
    const oy = opts.y ?? 60;
    const italicSkew = opts.italicSkew || 0;

    /* 以 logo 中心为枢轴施加 skew，保持原有 cell 几何不变。 */
    const pivotX = ox + totalW / 2;
    const pivotY = oy + totalH / 2;
    ctx.save();
    if (italicSkew) {
        ctx.translate(pivotX, pivotY);
        ctx.transform(1, 0, -italicSkew, 1, 0, 0);
        ctx.translate(-pivotX, -pivotY);
    }

    const drawWord = (word, startX, colBase) => {
        let cursorX = startX;
        let prev = '';
        let colCursor = colBase;
        let isFirstChar = true;
        for (const ch of word) {
            if (ch === ' ') continue;
            /* 字母与字母之间施加 letterGap，避免 italic skew 后相邻字母 cell 视觉粘连。 */
            if (!isFirstChar) cursorX += letterGap;
            isFirstChar = false;
            if (prev === 'e' && ch === 'n') cursorX += cellW * 0.4;
            const bitmap = wmLookupBitmap(ch);
            const w = wmLetterWidth(ch);
            const icons = WM_ICON_MAP[ch] || [];
            const iconLookup = {};
            for (const ic of icons) iconLookup[`${ic.r},${ic.c}`] = ic.emoji;

            for (let r = 0; r < bitmap.length; r++) {
                const row = bitmap[r].padEnd(w, '0');
                for (let c = 0; c < w; c++) {
                    const filled = row[c] === '1' || row[c] === '#' || row[c] === '2';
                    const iconEmoji = iconLookup[`${r},${c}`];
                    const x = cursorX + c * cellW;
                    const y = oy + r * cellH;
                    if (iconEmoji) {
                        /* 与游戏内 transform translate(46%,-12%) scale(1.1) 视觉等价 */
                        const sz = cellH * 1.55;
                        ctx.save();
                        ctx.font = `${sz}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(iconEmoji, x + cellW * 0.96, y + cellH * 0.38);
                        ctx.restore();
                    } else if (filled) {
                        const colGlobal = colCursor + c;
                        const t = colGlobal / totalSpan;
                        const hue = ((t * 360) % 360 + 360) % 360;
                        const fill = `hsl(${hue}, 92%, 60%)`;
                        _roundRect(
                            ctx,
                            x + cellGap / 2,
                            y + cellGap / 2,
                            cellW - cellGap,
                            cellH - cellGap,
                            cornerRadius
                        );
                        ctx.fillStyle = fill;
                        ctx.fill();
                        if (r === 0) {
                            ctx.fillStyle = 'rgba(255,255,255,0.22)';
                            ctx.fillRect(x + cellGap / 2, y + cellGap / 2, cellW - cellGap, 1.5);
                        }
                    }
                }
            }
            cursorX += w * cellW;
            colCursor += w;
            prev = ch;
        }
        return { endX: cursorX, endCol: colCursor };
    };

    const after1 = drawWord(aWord, ox, 0);
    const starCx = after1.endX + sidePad + starW / 2;
    const starHueT = (after1.endCol + WM_STAR_COL / 2) / totalSpan;
    const starHue = (((starHueT * 360) % 360) + 360) % 360;
    /* 按 SVG viewBox 1:2（24×48）严格出星形，避免被横向占位 starW 拉宽变形。 */
    const fbStarW = starW;
    const fbStarH = starW * 2;
    _drawCrossStar(ctx, starCx, oy + totalH / 2, fbStarW, fbStarH, starHue);
    drawWord(bWord, after1.endX + sidePad + starW + sidePad, after1.endCol + WM_STAR_COL);

    ctx.restore();
    return { x: ox, y: oy, w: totalW, h: totalH };
}

/** Logo 中间的 4 角十字星（按 blockWordmark.js 内 SVG viewBox 24×48 严格 1:1 还原）。
 *  SVG 结构：椭圆 glow(cx=12,cy=24,rx=8,ry=16) + 星形 path + 中心 core(cx=12,cy=24,r=2.8)。
 *  外接矩形 (cx-w/2, cy-h/2, w, h)；w/h 按 SVG 实际占位决定，因此 cross-star 的形状、glow、
 *  core 与游戏 logo 完全一致，只是颜色按所在色相 hueMid 取彩。 */
function _drawCrossStar(ctx, cx, cy, w, h, hueMid) {
    const sxScale = w / 24;
    const syScale = h / 48;

    ctx.save();
    ctx.translate(cx - w / 2, cy - h / 2);

    /* 椭圆 glow：cx=12, cy=24, rx=8, ry=16（在原 SVG 单位下） */
    const glowCx = 12 * sxScale;
    const glowCy = 24 * syScale;
    const glowRx = 8 * sxScale;
    const glowRy = 16 * syScale;
    const glow = ctx.createRadialGradient(glowCx, glowCy, Math.max(1, glowRy * 0.06), glowCx, glowCy, glowRy);
    glow.addColorStop(0, `hsl(${hueMid}, 95%, 96%)`);
    glow.addColorStop(0.45, `hsla(${hueMid}, 88%, 72%, 0.55)`);
    glow.addColorStop(1, `hsla(${hueMid}, 80%, 55%, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(glowCx, glowCy, glowRx, glowRy, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 4 角星 path：M12 0.5 L13.4 21 L23 24 L13.4 27 L12 47.5 L10.6 27 L1 24 L10.6 21 Z */
    const pathPts = [
        [12, 0.5], [13.4, 21], [23, 24], [13.4, 27],
        [12, 47.5], [10.6, 27], [1, 24], [10.6, 21],
    ];
    ctx.beginPath();
    for (let i = 0; i < pathPts.length; i++) {
        const x = pathPts[i][0] * sxScale;
        const y = pathPts[i][1] * syScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();

    const h0 = (hueMid - 28 + 360) % 360;
    const h1 = (hueMid + 28) % 360;
    const lin = ctx.createLinearGradient(0, 0, w, h);
    lin.addColorStop(0, `hsl(${h0}, 92%, 60%)`);
    lin.addColorStop(1, `hsl(${h1}, 92%, 60%)`);
    ctx.fillStyle = lin;
    ctx.fill();

    ctx.lineWidth = Math.max(0.4, 0.4 * sxScale);
    ctx.strokeStyle = `hsl(${hueMid}, 75%, 38%)`;
    ctx.stroke();

    /* 中心 core：cx=12, cy=24, r=2.8 */
    ctx.beginPath();
    ctx.arc(glowCx, glowCy, 2.8 * sxScale, 0, Math.PI * 2);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = `hsl(${hueMid}, 40%, 96%)`;
    ctx.fill();

    ctx.restore();
}

/** 棋盘舞台：纯净嵌入式——椭圆地面投影 + 黑色背板 + 柔和黑色阴影 + 极淡白色内沿。
 *  之前的红色 accent 描边过于突兀（color halo + shadow 50px），换成中性黑色阴影；
 *  圆角从 32 降到 14，更接近游戏内 .game-grid-container 的工业感。 */
function _drawBoardStage(ctx, gameCanvas, palette) {
    void palette;
    const imgSize = 640;
    const ix = (POSTER_W - imgSize) / 2;
    /* 上下留白对称：logo 底约 y=165，footer hairline y=970，可用区高 805，
     * 棋盘高 640，两侧各留 ≈82px，故 iy=246。 */
    const iy = 246;
    const radius = 14;

    /* 椭圆地面投影：保留唯一的"接地感"锚点。 */
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(POSTER_W / 2, iy + imgSize + 28, imgSize * 0.4, 22, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.filter = 'blur(20px)';
    ctx.fill();
    ctx.restore();

    /* 黑色背板 + 大半径柔和阴影：替代原 accent stroke，给棋盘一个嵌入式投影感。
     * 背板会被 drawImage 完全覆盖，但 ctx.shadow 留在外圈。 */
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 38;
    ctx.shadowOffsetY = 10;
    _roundRect(ctx, ix, iy, imgSize, imgSize, radius);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.restore();

    /* 棋盘内容：高质量缩放 + 圆角剪裁 */
    if (gameCanvas) {
        ctx.save();
        _roundRect(ctx, ix, iy, imgSize, imgSize, radius);
        ctx.clip();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        try {
            const sw = gameCanvas.width || imgSize;
            const sh = gameCanvas.height || imgSize;
            ctx.drawImage(gameCanvas, 0, 0, sw, sh, ix, iy, imgSize, imgSize);
        } catch { /* SecurityError 忽略 */ }

        /* 内顶玻璃高光 */
        const innerTop = ctx.createLinearGradient(0, iy, 0, iy + 100);
        innerTop.addColorStop(0, 'rgba(255,255,255,0.08)');
        innerTop.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = innerTop;
        ctx.fillRect(ix, iy, imgSize, 100);
        ctx.restore();
    }

    /* 极淡白色内沿 hairline：避免棋盘边缘消融在背景上，给"画框感"但不抢戏。 */
    ctx.save();
    _roundRect(ctx, ix + 0.5, iy + 0.5, imgSize - 1, imgSize - 1, Math.max(1, radius - 0.5));
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.stroke();
    ctx.restore();
}

/** 底部行动召唤：CTA caption + 居中粗宋体 hook + 副标 + URL/QR + 印鉴。
 *  hook 含动态 score 占位符，按 i18n 'share.poster.hookHeadline' 渲染；
 *  字号据实测宽度自适应缩小，避免英文等较长语种溢出。 */
function _drawFooter(ctx, palette, score) {
    const { accent } = palette;
    const footerY = POSTER_H - 310;

    /* 顶部细分割线 + 渐隐暗色覆盖 */
    ctx.fillStyle = _rgba(accent, 0.42);
    ctx.fillRect(60, footerY, POSTER_W - 120, 1);

    const footGrad = ctx.createLinearGradient(0, footerY, 0, POSTER_H);
    footGrad.addColorStop(0, 'rgba(0,0,0,0.0)');
    footGrad.addColorStop(0.45, 'rgba(0,0,0,0.32)');
    footGrad.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = footGrad;
    ctx.fillRect(0, footerY + 1, POSTER_W, POSTER_H - footerY);

    /* — CTA caption：居中、衬线斜体小字、accent 色。 — */
    ctx.save();
    ctx.fillStyle = _rgba(accent, 0.92);
    ctx.font = `italic 700 15px ${FONT_SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const captionText = `— ${t('share.poster.callToPlay')} —`;
    ctx.fillText(captionText, POSTER_W / 2, footerY + 36);
    ctx.restore();

    /* — 主 hook：居中、超大粗宋体、动态分数占位、宽度自适应缩小。 — */
    ctx.save();
    const headlineText = t('share.poster.hookHeadline', { score });
    let headlineSize = 46;
    const maxHeadlineW = POSTER_W - 80;
    ctx.font = `bold ${headlineSize}px ${FONT_SERIF}`;
    while (ctx.measureText(headlineText).width > maxHeadlineW && headlineSize > 28) {
        headlineSize -= 1;
        ctx.font = `bold ${headlineSize}px ${FONT_SERIF}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = _rgba(accent, 0.45);
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(headlineText, POSTER_W / 2, footerY + 96);
    ctx.restore();

    /* — 副标：居中、衬线斜体、白色 78%。 — */
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = `italic 500 18px ${FONT_SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let sublineSize = 18;
    const sublineText = t('share.poster.hookSubline');
    while (ctx.measureText(sublineText).width > POSTER_W - 100 && sublineSize > 13) {
        sublineSize -= 1;
        ctx.font = `italic 500 ${sublineSize}px ${FONT_SERIF}`;
    }
    ctx.fillText(sublineText, POSTER_W / 2, footerY + 132);
    ctx.restore();

    /* — QR 白卡 + 上方引导文案。 — */
    const qrSize = 92;
    const qrX = POSTER_W - qrSize - 60;
    const qrY = footerY + 168;

    ctx.save();
    _roundRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 12);
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();

    _drawPseudoQR(ctx, qrX, qrY, qrSize, accent);

    ctx.save();
    ctx.font = `italic 700 12px ${FONT_SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = _rgba(accent, 0.95);
    ctx.fillText(t('share.poster.scanToPk'), qrX + qrSize / 2, qrY - 18);
    ctx.restore();

    /* — URL：accent 三角箭头 + 等宽字体，与 QR 垂直居中对齐。 — */
    const urlBaselineY = qrY + qrSize / 2 + 6;
    ctx.save();
    ctx.fillStyle = _rgba(accent, 0.95);
    ctx.font = `bold 18px ${FONT_SERIF}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('▸', 60, urlBaselineY);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = `500 16px ${FONT_MONO}`;
    ctx.fillText('github.com/btbujiangjun/openblock', 84, urlBaselineY);
    ctx.restore();

    /* — footer 印鉴：底部时代感小字，靠左、字距加宽。 — */
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.font = `italic 500 11px ${FONT_SERIF}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const stamp = t('share.poster.stamp');
    let cursor = 60;
    for (const ch of stamp) {
        ctx.fillText(ch, cursor, POSTER_H - 22);
        cursor += ctx.measureText(ch).width + 1.6;
    }
    ctx.restore();
}

/* ============================================================
 *  几何 & 颜色工具
 * ========================================================== */

function _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** 从皮肤推导自洽色板：deep / deeper（背景）+ accent / accent2（主辅色）。 */
function _derivePalette(skin) {
    const accent = _normalizeHex(skin?.blockColors?.[0]) || '#FFD160';
    const accent2 = _normalizeHex(skin?.blockColors?.[3]) || _shiftHue(accent, 35);
    const baseBg = _normalizeHex(skin?.cssBg) || _normalizeHex(skin?.gridOuter) || '#0F1014';
    const deep = _mix(baseBg, '#0A0C13', 0.55);
    const deeper = _mix(baseBg, '#05060B', 0.78);
    return { accent, accent2, deep, deeper };
}

function _normalizeHex(input) {
    if (!input || typeof input !== 'string') return null;
    const m3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(input);
    if (m3) return '#' + m3[1] + m3[1] + m3[2] + m3[2] + m3[3] + m3[3];
    const m6 = /^#?([0-9a-f]{6})$/i.exec(input);
    if (m6) return '#' + m6[1];
    return null;
}

function _hexToRgb(hex) {
    const norm = _normalizeHex(hex) || '#000000';
    const v = parseInt(norm.slice(1), 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function _rgba(hex, a) {
    const { r, g, b } = _hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
}

function _mix(c1, c2, t) {
    const a = _hexToRgb(c1);
    const b = _hexToRgb(c2);
    const k = Math.max(0, Math.min(1, t));
    const r = Math.round(a.r * (1 - k) + b.r * k);
    const g = Math.round(a.g * (1 - k) + b.g * k);
    const bl = Math.round(a.b * (1 - k) + b.b * k);
    return '#' + [r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function _shiftHue(hex, deg) {
    const { r, g, b } = _hexToRgb(hex);
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d !== 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        const rr = r / 255, gg = g / 255, bb = b / 255;
        if (max === rr) h = ((gg - bb) / d) % 6;
        else if (max === gg) h = (bb - rr) / d + 2;
        else h = (rr - gg) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    h = (h + deg + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rp = 0, gp = 0, bp = 0;
    if (h < 60)        { rp = c; gp = x; bp = 0; }
    else if (h < 120)  { rp = x; gp = c; bp = 0; }
    else if (h < 180)  { rp = 0; gp = c; bp = x; }
    else if (h < 240)  { rp = 0; gp = x; bp = c; }
    else if (h < 300)  { rp = x; gp = 0; bp = c; }
    else               { rp = c; gp = 0; bp = x; }
    const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return '#' + to(rp) + to(gp) + to(bp);
}

function _drawPseudoQR(ctx, x, y, size, accent) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x - 4, y - 4, size + 8, size + 8);
    const cells = 8;
    const cs = size / cells;

    /* 三个定位框 */
    const drawAnchor = (cx, cy) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(x + cx * cs, y + cy * cs, 3 * cs, 3 * cs);
        ctx.fillStyle = '#FFF';
        ctx.fillRect(x + cx * cs + cs * 0.5, y + cy * cs + cs * 0.5, 2 * cs, 2 * cs);
        ctx.fillStyle = accent;
        ctx.fillRect(x + cx * cs + cs, y + cy * cs + cs, cs, cs);
    };
    drawAnchor(0, 0); drawAnchor(5, 0); drawAnchor(0, 5);

    /* 散点（模拟二维码数据区） */
    ctx.fillStyle = '#000';
    let seed = 42;
    const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
            if ((i < 3 && j < 3) || (i > 4 && j < 3) || (i < 3 && j > 4)) continue;
            if (rng() > 0.55) ctx.fillRect(x + i * cs, y + j * cs, cs - 1, cs - 1);
        }
    }
}
