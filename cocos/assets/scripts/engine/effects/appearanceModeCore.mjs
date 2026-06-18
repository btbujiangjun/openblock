/* 自动生成 —— 请勿手改。源：web/src/effects/appearanceModeCore.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * appearanceModeCore.js — 界面风格三档循环（标准 / 精致 / 精致+特效）
 *
 * 合并原「精致界面 ◇/💎」与「视觉特效 ✦/✨」两个独立开关。
 * 各端 UI 层负责挂载按钮与重绘；本模块只定义契约与纯函数。
 */

export const APPEARANCE_MODES = ['basic', 'premium', 'full'];

const MODE_META = {
    basic: {
        icon: '◇',
        ariaLabel: '切换界面风格：当前标准',
        title: '界面：标准',
        floatText: '界面：标准',
    },
    premium: {
        icon: '💎',
        ariaLabel: '切换界面风格：当前精致',
        title: '界面：精致',
        floatText: '精致界面：开',
    },
    full: {
        icon: '✨',
        ariaLabel: '切换界面风格：当前精致与特效',
        title: '界面：精致+特效',
        floatText: '精致+特效：开',
    },
};

/** @typedef {'basic'|'premium'|'full'} AppearanceMode */

/**
 * 从 legacy 双开关偏好推导当前档位。
 * @param {{ premiumEnabled?: boolean, visualEnabled?: boolean }} prefs
 * @returns {AppearanceMode}
 */
export function resolveAppearanceMode({ premiumEnabled = false, visualEnabled = false } = {}) {
    if (premiumEnabled && visualEnabled) return 'full';
    if (premiumEnabled) return 'premium';
    if (visualEnabled) return 'full';
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
