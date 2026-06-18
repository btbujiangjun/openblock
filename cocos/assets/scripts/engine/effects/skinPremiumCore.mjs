/* 自动生成 —— 请勿手改。源：web/src/effects/skinPremiumCore.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * skinPremiumCore.js — 精致界面 / S 级渲染开关（引擎无关 · 多端同步）
 *
 * 权威源：Web `skinPremium.js` 的存储键、偏好 schema、accent 推导。
 * 各端 UI 层负责挂载 class / 重绘；本模块只定义契约与纯函数。
 */

export const SKIN_PREMIUM_STORAGE_KEY = 'openblock_skin_premium_v1';

export const PREMIUM_VAR_KEYS = [
    '--premium-accent',
    '--premium-board-border',
    '--premium-board-glow',
    '--premium-glass-surface',
    '--premium-glass-border',
];

export const PREMIUM_ACTIVE_CLASS = 'web-premium-skin';

const DEFAULT_PREFS = { enabled: false };

export function hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== 'string') return `rgba(56,189,248,${alpha})`;
    const h = hex.replace('#', '');
    if (h.length !== 3 && h.length !== 6) return `rgba(56,189,248,${alpha})`;
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return `rgba(56,189,248,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
}

export function loadPremiumPrefs(storage) {
    try {
        const raw = storage?.getItem?.(SKIN_PREMIUM_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_PREFS };
        return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

export function savePremiumPrefs(storage, prefs) {
    try {
        storage?.setItem?.(SKIN_PREMIUM_STORAGE_KEY, JSON.stringify(prefs));
    } catch { /* ignore */ }
}

/**
 * 从皮肤对象推导 premium CSS 变量（各端可映射到 style / Graphics 参数）。
 * @param {{ uiDark?: boolean, cssVars?: Record<string, string> }} skin
 * @returns {Record<string, string>}
 */
export function computePremiumSkinVars(skin) {
    if (!skin) return {};
    const accent = skin.cssVars?.['--accent-color']
        || skin.cssVars?.['--accent-dark']
        || (skin.uiDark ? '#38bdf8' : '#2563eb');
    return {
        '--premium-accent': accent,
        '--premium-board-border': hexToRgba(accent, skin.uiDark ? 0.28 : 0.20),
        '--premium-board-glow': hexToRgba(accent, skin.uiDark ? 0.14 : 0.10),
        '--premium-glass-surface': skin.uiDark
            ? 'linear-gradient(180deg, rgba(30,41,59,.82), rgba(14,20,32,.88))'
            : 'linear-gradient(180deg, rgba(255,255,255,.78), rgba(248,250,252,.86))',
        '--premium-glass-border': skin.uiDark ? 'rgba(148,163,184,.18)' : 'rgba(15,23,42,.10)',
    };
}

/**
 * renderer 是否绘制 S 级 premium 细节。
 * @param {{ enabled?: boolean, qualityMode?: string, qualityOff?: boolean }} [opts]
 */
export function isPremiumRenderEnabled({
    enabled = false,
    qualityMode = 'high',
    qualityOff = false,
} = {}) {
    if (!enabled) return false;
    if (qualityOff) return false;
    if (qualityMode === 'low' || qualityMode === 'off') return false;
    return true;
}
