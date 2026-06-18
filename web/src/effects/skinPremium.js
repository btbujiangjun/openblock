/**
 * skinPremium.js — Web / Capacitor S 级皮肤视觉增强（新手村风格 · 可开关）
 *
 * 默认关闭，用户通过 HUD「精致界面」按钮一键引入/退出，偏好写入 localStorage。
 * Android / iOS 随 dist 打包同源逻辑；小程序 / Cocos 有各自平台适配层。
 */

import { getActiveSkin, onSkinAfterApply } from '../skins.js';
import {
    SKIN_PREMIUM_STORAGE_KEY,
    PREMIUM_VAR_KEYS,
    PREMIUM_ACTIVE_CLASS,
    loadPremiumPrefs,
    savePremiumPrefs,
    computePremiumSkinVars,
    isPremiumRenderEnabled,
} from './skinPremiumCore.js';

let _game = null;
let _enabled = false;

/** 当前端是否支持精致界面（Web + Capacitor 壳均支持） */
export function isWebPremiumClient() {
    return typeof document !== 'undefined';
}

/** renderer / 背景层是否绘制 premium 细节 */
export function isSkinPremiumEnabled() {
    if (!isWebPremiumClient()) return false;
    const root = document.documentElement;
    const qualityMode = root.classList.contains('quality-low') ? 'low'
        : root.classList.contains('quality-balanced') ? 'balanced' : 'high';
    return isPremiumRenderEnabled({
        enabled: _enabled || root.classList.contains(PREMIUM_ACTIVE_CLASS),
        qualityMode,
        qualityOff: document.body?.dataset?.quality === 'off',
    });
}

function _clearPremiumVars() {
    if (typeof document === 'undefined') return;
    for (const k of PREMIUM_VAR_KEYS) {
        document.documentElement.style.removeProperty(k);
    }
}

function _refreshBoard() {
    try { (_game || window.openBlockGame)?.renderer?.invalidateSkinCaches?.(); } catch { /* ignore */ }
    try { (_game || window.openBlockGame)?.markDirty?.(); } catch { /* ignore */ }
}

/**
 * 从当前皮肤推导 accent 与玻璃质感 CSS 变量。
 * @param {import('../skins.js').Skin} skin
 */
export function applyPremiumSkinVars(skin) {
    if (typeof document === 'undefined' || !skin) return;
    const root = document.documentElement;
    for (const k of PREMIUM_VAR_KEYS) root.style.removeProperty(k);
    const vars = computePremiumSkinVars(skin);
    for (const [k, v] of Object.entries(vars)) {
        root.style.setProperty(k, v);
    }
}

/**
 * 开启 / 关闭精致界面（持久化 + 刷新盘面）。
 * @param {boolean} enabled
 * @param {{ persist?: boolean }} [opts]
 */
export function setSkinPremiumEnabled(enabled, { persist = true } = {}) {
    if (!isWebPremiumClient() || typeof document === 'undefined') return false;
    const on = !!enabled;
    const root = document.documentElement;
    _enabled = on;

    if (on) {
        root.classList.add(PREMIUM_ACTIVE_CLASS);
        try { applyPremiumSkinVars(getActiveSkin()); } catch { /* ignore */ }
    } else {
        root.classList.remove(PREMIUM_ACTIVE_CLASS);
        _clearPremiumVars();
    }

    if (persist && typeof localStorage !== 'undefined') {
        savePremiumPrefs(localStorage, { enabled: on });
    }
    _refreshBoard();
    return on;
}

/**
 * 初始化精致界面开关。在 main.js 游戏实例创建后调用。
 * @param {{ game?: object }} [opts]
 */
export function initSkinPremium({ game } = {}) {
    if (!isWebPremiumClient()) return;
    _game = game || null;

    const prefs = typeof localStorage !== 'undefined'
        ? loadPremiumPrefs(localStorage)
        : { enabled: false };
    setSkinPremiumEnabled(prefs.enabled, { persist: false });

    onSkinAfterApply(() => {
        if (!isSkinPremiumEnabled()) return;
        try { applyPremiumSkinVars(getActiveSkin()); } catch { /* ignore */ }
    });

    if (typeof window !== 'undefined') {
        window.__skinPremium = {
            enabled: () => isSkinPremiumEnabled(),
            setEnabled: (on) => setSkinPremiumEnabled(on),
            toggle: () => setSkinPremiumEnabled(!isSkinPremiumEnabled()),
            refresh: () => {
                if (!isSkinPremiumEnabled()) return;
                applyPremiumSkinVars(getActiveSkin());
            },
        };
    }
}

/** 测试用 */
export function __resetPremiumForTest() {
    _game = null;
    _enabled = false;
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove(PREMIUM_ACTIVE_CLASS);
        _clearPremiumVars();
    }
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(SKIN_PREMIUM_STORAGE_KEY); } catch { /* ignore */ }
    }
}

export { SKIN_PREMIUM_STORAGE_KEY, PREMIUM_ACTIVE_CLASS };
