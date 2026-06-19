/* 自动生成 —— 请勿手改。源：web/src/effects/appearanceModeCore.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * appearanceModeCore.js — 界面风格四档循环（标准 / 标准+动效 / 精致 / 精致+动效）
 *
 * 合并原「精致界面 ◇/💎」与「视觉特效 ✦/✨」两个独立开关，并新增「标准+动效」档
 * 作为冷启动默认（既保留低端机友好的轻量盘面观感，又让消行特效/水印漂移/环境粒子可见）。
 * 各端 UI 层负责挂载按钮与重绘；本模块只定义契约与纯函数。
 *
 * 顺序（cycleAppearanceMode）：basic → effects → premium → full → basic
 *   - basic   ◇ 标准：盘面/HUD 标准渲染，无装饰性视觉特效
 *   - effects ✦ 标准+动效：盘面/HUD 标准渲染 + 装饰性视觉特效（默认）
 *   - premium 💎 精致：盘面玻璃 + HUD 玻璃，无装饰性视觉特效
 *   - full    ✨ 精致+动效：精致渲染 + 全部视觉特效
 */

export const APPEARANCE_MODES = ['basic', 'effects', 'premium', 'full'];

/** 新装/无偏好时的默认档位（对齐 VisualFx 默认 true、Premium 默认 false 的合成态）。 */
export const DEFAULT_APPEARANCE_MODE = 'effects';

const MODE_META = {
    basic: {
        icon: '◇',
        ariaLabel: '切换界面风格：当前标准',
        title: '界面：标准',
        floatText: '界面：标准',
    },
    effects: {
        icon: '✦',
        ariaLabel: '切换界面风格：当前标准+动效',
        title: '界面：标准+动效',
        floatText: '标准+动效：开',
    },
    premium: {
        icon: '💎',
        ariaLabel: '切换界面风格：当前精致',
        title: '界面：精致',
        floatText: '精致界面：开',
    },
    full: {
        icon: '✨',
        ariaLabel: '切换界面风格：当前精致与动效',
        title: '界面：精致+动效',
        floatText: '精致+动效：开',
    },
};

/** @typedef {'basic'|'effects'|'premium'|'full'} AppearanceMode */

/**
 * 从 legacy 双开关偏好推导当前档位。
 * 新装（两个偏好都未持久化）由各端 UI 层在 init 处兜底为 DEFAULT_APPEARANCE_MODE，
 * 本函数只负责把已存在的两开关组合映射到四档。
 * @param {{ premiumEnabled?: boolean, visualEnabled?: boolean }} prefs
 * @returns {AppearanceMode}
 */
export function resolveAppearanceMode({ premiumEnabled = false, visualEnabled = false } = {}) {
    if (premiumEnabled && visualEnabled) return 'full';
    if (premiumEnabled) return 'premium';
    if (visualEnabled) return 'effects';
    return 'basic';
}

/**
 * @param {AppearanceMode} mode
 * @returns {{ premiumEnabled: boolean, visualEnabled: boolean }}
 */
export function getAppearanceState(mode) {
    switch (mode) {
        case 'premium':
            return { premiumEnabled: true, visualEnabled: false };
        case 'full':
            return { premiumEnabled: true, visualEnabled: true };
        case 'effects':
            return { premiumEnabled: false, visualEnabled: true };
        default:
            return { premiumEnabled: false, visualEnabled: false };
    }
}

/**
 * @param {AppearanceMode} mode
 */
export function getAppearanceMeta(mode) {
    return MODE_META[mode] || MODE_META.basic;
}

/**
 * @param {AppearanceMode} current
 * @returns {AppearanceMode}
 */
export function cycleAppearanceMode(current) {
    const idx = APPEARANCE_MODES.indexOf(current);
    const base = idx >= 0 ? idx : 0;
    return APPEARANCE_MODES[(base + 1) % APPEARANCE_MODES.length];
}

/**
 * @param {AppearanceMode} mode
 */
export function isAppearanceActive(mode) {
    return mode !== 'basic';
}
