/**
 * seasonalBorder.js — v10.16 季节限定盘面外光晕（P2）
 *
 * 在 v10.13 renderEdgeFalloff 之上叠加节日装饰光晕：
 *   春节 — 朱红 + 鎏金
 *   元宵 — 暖橘 + 金黄（灯笼意象）
 *   圣诞 — 翠绿 + 朱红
 *   万圣 — 暗紫 + 橙
 *   元旦 — 多彩流光
 *
 * 实施
 * ----
 * - 装饰 renderer.renderEdgeFalloff()，调原方法后追加节日光晕
 * - 当前日期不在节日列表则零开销
 */

const FESTIVAL_BORDERS = {
    /* keys 为 'M-D' 格式 */
    '1-1':   { name: '元旦',   colors: ['#FFD160', '#7EE8FA', '#EEC0E5'] },
    '2-14':  { name: '情人节', colors: ['#FF8FA3', '#FFD0E0'] },
    '4-5':   { name: '清明',   colors: ['#9BCBA8'] },
    '10-1':  { name: '国庆',   colors: ['#E84A4A', '#FFD160'] },
    '10-31': { name: '万圣节', colors: ['#FF8C40', '#5028B0'] },
    '12-24': { name: '圣诞夜', colors: ['#1A8C4A', '#E84A4A'] },
    '12-25': { name: '圣诞节', colors: ['#1A8C4A', '#E84A4A'] },
    '12-31': { name: '跨年',   colors: ['#FFD160', '#7EE8FA', '#EEC0E5', '#A4D9F2'] },
    /* 春节 / 中秋等农历节日由 seasonalSkin.js 的 dates 列表对接 */
    '2026-2-17': { name: '春节',   colors: ['#E84A4A', '#FFD160'] },
    '2026-3-3':  { name: '元宵',   colors: ['#FF8C40', '#FFD160'] },
    '2026-9-25': { name: '中秋',   colors: ['#FFD160', '#5060C8'] },
};

let _audio = null;
let _activeBorder = null;
let _refreshTimer = null;

export function initSeasonalBorder({ game } = {}) {
    if (!game?.renderer) return;
    void _audio;
    _refreshActive();
    _refreshTimer = setInterval(_refreshActive, 60_000 * 30);   // 半小时检查
    _hookRenderer(game.renderer);
}

function _refreshActive() {
    const d = new Date();
    const k1 = `${d.getMonth() + 1}-${d.getDate()}`;
    const k2 = `${d.getFullYear()}-${k1}`;
    _activeBorder = FESTIVAL_BORDERS[k2] || FESTIVAL_BORDERS[k1] || null;
}

function _hookRenderer(r) {
    const orig = r.renderEdgeFalloff?.bind(r);
    if (!orig) return;
    r.renderEdgeFalloff = function () {
        orig();
        if (_activeBorder) _drawBorder(r, _activeBorder);
    };
}

function _drawBorder(r, border) {
    const ctx = r.fxCtx;
    if (!ctx) return;
    const lw = r.logicalW;
    const lh = r.logicalH;
    const m = r._paintMargin || 0;
    if (!m) return;

    const t = performance.now() / 2400;
    const colors = border.colors || ['#FFD160'];

    ctx.save();
    /* 4 边各画一条流动彩带 */
    const stripes = colors.length;
    for (let i = 0; i < stripes; i++) {
        const phase = (t * 0.4 + i * 0.18) % 1;
        const c = colors[i];

        /* 左 + 右两条垂直 */
        const gradV = ctx.createLinearGradient(0, 0, 0, lh);
        gradV.addColorStop(Math.max(0, phase - 0.18), 'rgba(0,0,0,0)');
        gradV.addColorStop(phase, c);
        gradV.addColorStop(Math.min(1, phase + 0.18), 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = gradV;
        ctx.fillRect(-m + i * 1.5, -m, 5, lh + m * 2);
        ctx.fillRect(lw + m - 6 - i * 1.5, -m, 5, lh + m * 2);

        /* 上 + 下两条水平 */
        const gradH = ctx.createLinearGradient(0, 0, lw, 0);
        gradH.addColorStop(Math.max(0, phase - 0.18), 'rgba(0,0,0,0)');
        gradH.addColorStop(phase, c);
        gradH.addColorStop(Math.min(1, phase + 0.18), 'rgba(0,0,0,0)');
        ctx.fillStyle = gradH;
        ctx.fillRect(-m, -m + i * 1.5, lw + m * 2, 5);
        ctx.fillRect(-m, lh + m - 6 - i * 1.5, lw + m * 2, 5);
    }
    ctx.restore();
}

export const __test_only__ = { FESTIVAL_BORDERS };
