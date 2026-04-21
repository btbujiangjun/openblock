/**
 * mosaicLevel.js — 马赛克专属玩法
 *
 * 基于 ClearRuleEngine 的区域消除机制，提供「马赛克」风格关卡：
 * - 棋盘按固定分区划分（如 4 个 2×4 矩形区域）
 * - 当某区域完全填满时整区消除，而非传统行/列消除
 * - 可与行列规则叠加（combo 清法）
 *
 * 视觉叠加层
 * ----------
 * 通过 createZoneOverlay(game, zones) 在游戏画布上添加半透明彩色区域框，
 * 直接使用 CSS position:absolute + canvas getBoundingClientRect 实现精确对齐。
 *
 * 示例用法
 * --------
 *   import { MOSAIC_LEVEL_4ZONE, createZoneOverlay, removeZoneOverlay } from './mosaicLevel.js';
 *   game.start({ levelConfig: MOSAIC_LEVEL_4ZONE });
 *   const overlay = createZoneOverlay(game, MOSAIC_LEVEL_4ZONE.zones);
 *   // 关卡结束后：removeZoneOverlay(overlay);
 */

import { makeZoneClearRule, RowColRule } from '../clearRules.js';

// -----------------------------------------------------------------------
// 预设区域定义（8×8 棋盘）
// -----------------------------------------------------------------------

/** 4 区：上下左右各 4×4 象限 */
export const ZONES_QUADRANT = [
    { x: 0, y: 0, w: 4, h: 4, label: 'A', color: 'rgba(255,80,80,0.18)' },
    { x: 4, y: 0, w: 4, h: 4, label: 'B', color: 'rgba(80,200,80,0.18)' },
    { x: 0, y: 4, w: 4, h: 4, label: 'C', color: 'rgba(80,120,255,0.18)' },
    { x: 4, y: 4, w: 4, h: 4, label: 'D', color: 'rgba(240,180,0,0.18)' },
];

/** 竖条：4 列各占 8×2 */
export const ZONES_STRIPS_V = [
    { x: 0, y: 0, w: 2, h: 8, label: '1', color: 'rgba(255,80,80,0.15)' },
    { x: 2, y: 0, w: 2, h: 8, label: '2', color: 'rgba(80,200,80,0.15)' },
    { x: 4, y: 0, w: 2, h: 8, label: '3', color: 'rgba(80,120,255,0.15)' },
    { x: 6, y: 0, w: 2, h: 8, label: '4', color: 'rgba(240,180,0,0.15)' },
];

/** 横条：4 行各占 2×8 */
export const ZONES_STRIPS_H = [
    { x: 0, y: 0, w: 8, h: 2, label: '①', color: 'rgba(255,80,80,0.15)' },
    { x: 0, y: 2, w: 8, h: 2, label: '②', color: 'rgba(80,200,80,0.15)' },
    { x: 0, y: 4, w: 8, h: 2, label: '③', color: 'rgba(80,120,255,0.15)' },
    { x: 0, y: 6, w: 8, h: 2, label: '④', color: 'rgba(240,180,0,0.15)' },
];

/** 9 格九宫（3×3 每格 2.67≈整除会裂，取 2×2+调整至4个2×2+中心边） */
export const ZONES_RING = [
    { x: 0, y: 0, w: 3, h: 3, label: '↖', color: 'rgba(255,80,80,0.18)' },
    { x: 5, y: 0, w: 3, h: 3, label: '↗', color: 'rgba(80,200,80,0.18)' },
    { x: 0, y: 5, w: 3, h: 3, label: '↙', color: 'rgba(80,120,255,0.18)' },
    { x: 5, y: 5, w: 3, h: 3, label: '↘', color: 'rgba(240,180,0,0.18)' },
    { x: 2, y: 2, w: 4, h: 4, label: '●', color: 'rgba(200,60,200,0.12)' },
];

// -----------------------------------------------------------------------
// 关卡配置导出
// -----------------------------------------------------------------------

/**
 * 四象限马赛克关卡：消除全部 4 个 4×4 区域（共 4 次区域满清）
 */
export const MOSAIC_LEVEL_4ZONE = {
    id: 'mosaic_quadrant',
    name: '马赛克 · 四象限',
    mode: 'level',
    initialBoard: null,
    objective: { type: 'clear', value: 4 },   // 4 次区域清除
    stars: { one: 4, two: 6, three: 8 },
    constraints: { maxPlacements: 40 },
    zones: ZONES_QUADRANT,
    // clearRules 由 game.js 通过 getAllowedClearRules() 读取
    clearRules: [makeZoneClearRule(ZONES_QUADRANT), RowColRule],
    description: '将四个象限分别填满，触发区域消除！',
};

/**
 * 竖条马赛克关卡：消除 4 条竖带
 */
export const MOSAIC_LEVEL_STRIPS = {
    id: 'mosaic_strips_v',
    name: '马赛克 · 竖条',
    mode: 'level',
    initialBoard: null,
    objective: { type: 'clear', value: 4 },
    stars: { one: 4, two: 6, three: 10 },
    constraints: { maxPlacements: 35 },
    zones: ZONES_STRIPS_V,
    clearRules: [makeZoneClearRule(ZONES_STRIPS_V), RowColRule],
    description: '将四条竖列各自填满，触发消除！',
};

/**
 * 环形马赛克关卡：消除四角 + 中心
 */
export const MOSAIC_LEVEL_RING = {
    id: 'mosaic_ring',
    name: '马赛克 · 环形',
    mode: 'level',
    initialBoard: null,
    objective: { type: 'clear', value: 5 },
    stars: { one: 5, two: 7, three: 10 },
    constraints: { maxPlacements: 50 },
    zones: ZONES_RING,
    clearRules: [makeZoneClearRule(ZONES_RING), RowColRule],
    description: '填满四角和中心区域，触发环形消除！',
};

/** 全部内置马赛克关卡列表 */
export const ALL_MOSAIC_LEVELS = [MOSAIC_LEVEL_4ZONE, MOSAIC_LEVEL_STRIPS, MOSAIC_LEVEL_RING];

// -----------------------------------------------------------------------
// 区域叠加层（视觉）
// -----------------------------------------------------------------------

/**
 * 在游戏画布上添加半透明区域叠加层。
 * 使用 position:absolute 的 div 精确覆盖对应格子。
 *
 * @param {import('../game.js').Game} game
 * @param {Array<{x,y,w,h,label,color}>} zones
 * @returns {{ el: HTMLElement, remove: () => void, refresh: () => void }}
 */
export function createZoneOverlay(game, zones) {
    const canvas = game.canvas;
    if (!canvas) return { el: null, remove: () => {}, refresh: () => {} };

    const container = canvas.parentElement || document.body;
    const overlay = document.createElement('div');
    overlay.className = 'zone-overlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
    container.style.position = 'relative';

    const zoneEls = [];

    function refresh() {
        const rect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const offsetX = rect.left - containerRect.left;
        const offsetY = rect.top - containerRect.top;
        const cellW = rect.width / (game.grid?.size || 8);
        const cellH = rect.height / (game.grid?.size || 8);

        overlay.querySelectorAll('.zone-cell').forEach(el => el.remove());

        for (const zone of zones) {
            const el = document.createElement('div');
            el.className = 'zone-cell';
            el.style.cssText = [
                `position:absolute`,
                `left:${Math.round(offsetX + zone.x * cellW)}px`,
                `top:${Math.round(offsetY + zone.y * cellH)}px`,
                `width:${Math.round(zone.w * cellW)}px`,
                `height:${Math.round(zone.h * cellH)}px`,
                `background:${zone.color}`,
                `border:2px solid ${zone.color.replace(/[\d.]+\)$/, '0.7)')}`,
                `border-radius:4px`,
                `box-sizing:border-box`,
                `display:flex`,
                `align-items:center`,
                `justify-content:center`,
                `font-size:${Math.round(cellW * 0.6)}px`,
                `font-weight:700`,
                `color:${zone.color.replace(/[\d.]+\)$/, '0.75)')}`,
                `user-select:none`,
            ].join(';');
            el.textContent = zone.label ?? '';
            overlay.appendChild(el);
            zoneEls.push(el);
        }
    }

    overlay.appendChild(document.createElement('div'));  // placeholder
    container.appendChild(overlay);
    refresh();

    const resizeOb = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(refresh)
        : null;
    if (resizeOb) resizeOb.observe(canvas);

    return {
        el: overlay,
        refresh,
        remove() {
            if (resizeOb) resizeOb.disconnect();
            overlay.remove();
        },
    };
}

/**
 * 移除区域叠加层
 * @param {{ remove: () => void } | null} overlayHandle
 */
export function removeZoneOverlay(overlayHandle) {
    overlayHandle?.remove();
}
