/**
 * skinPremium.js — Web 主端 S 级皮肤视觉增强（新手村风格 · 可开关）
 *
 * 默认关闭，用户通过 HUD「精致界面」按钮一键引入/退出，偏好写入 localStorage。
 * 仅在浏览器 Web 主端生效（排除 Capacitor 原生壳）。
 */

import { getActiveSkin, onSkinAfterApply } from '../skins.js';

const STORAGE_KEY = 'openblock_skin_premium_v1';
/** 精致界面激活态：挂载后 CSS / canvas premium 层才生效 */
const PREMIUM_ACTIVE_CLASS = 'web-premium-skin';

const PREMIUM_VAR_KEYS = [
    '--premium-accent',
    '--premium-board-border',
    '--premium-board-glow',
    '--premium-glass-surface',
    '--premium-glass-border',
];

const DEFAULT_PREFS = { enabled: false };

let _game = null;
let _toggleBtn = null;

function _hexToRgba(hex, alpha) {
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

function loadPremiumPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_PREFS };
        return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

function savePremiumPrefs(prefs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch { /* ignore */ }
}

/** 浏览器 Web 主端（非原生壳） */
export function isWebPremiumClient() {
    if (typeof document === 'undefined') return false;
    return !document.documentElement.classList.contains('native-client');
}

/** renderer / 背景层是否绘制 premium 细节 */
export function isSkinPremiumEnabled() {
    if (!isWebPremiumClient()) return false;
    if (typeof document === 'undefined') return false;
    const root = document.documentElement;
    if (!root.classList.contains(PREMIUM_ACTIVE_CLASS)) return false;
    if (root.classList.contains('quality-low')) return false;
    if (document.body?.dataset?.quality === 'off') return false;
    return true;
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

function _syncToggleButton(enabled) {
    if (!_toggleBtn) return;
    const on = !!enabled;
    _toggleBtn.textContent = on ? '💎' : '◇';
    _toggleBtn.setAttribute('aria-pressed', String(on));
    _toggleBtn.setAttribute('aria-label', on ? '关闭精致界面' : '开启精致界面');
    _toggleBtn.title = `精致界面：${on ? '开' : '关'}`;
}

/**
 * 从当前皮肤推导 accent 与玻璃质感 CSS 变量。
 * @param {import('../skins.js').Skin} skin
 */
export function applyPremiumSkinVars(skin) {
    if (typeof document === 'undefined' || !skin) return;
    const root = document.documentElement;
    for (const k of PREMIUM_VAR_KEYS) root.style.removeProperty(k);

    const accent = skin.cssVars?.['--accent-color']
        || skin.cssVars?.['--accent-dark']
        || (skin.uiDark ? '#38bdf8' : '#2563eb');

    root.style.setProperty('--premium-accent', accent);
    root.style.setProperty('--premium-board-border', _hexToRgba(accent, skin.uiDark ? 0.28 : 0.20));
    root.style.setProperty('--premium-board-glow', _hexToRgba(accent, skin.uiDark ? 0.14 : 0.10));
    root.style.setProperty(
        '--premium-glass-surface',
        skin.uiDark
            ? 'linear-gradient(180deg, rgba(30,41,59,.82), rgba(14,20,32,.88))'
            : 'linear-gradient(180deg, rgba(255,255,255,.78), rgba(248,250,252,.86))',
    );
    root.style.setProperty(
        '--premium-glass-border',
        skin.uiDark ? 'rgba(148,163,184,.18)' : 'rgba(15,23,42,.10)',
    );
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

    if (on) {
        root.classList.add(PREMIUM_ACTIVE_CLASS);
        try { applyPremiumSkinVars(getActiveSkin()); } catch { /* ignore */ }
    } else {
        root.classList.remove(PREMIUM_ACTIVE_CLASS);
        _clearPremiumVars();
    }

    if (persist) savePremiumPrefs({ enabled: on });
    _syncToggleButton(on);
    _refreshBoard();
    return on;
}

/**
 * 初始化 Web 主端精致界面开关。在 main.js 游戏实例创建后调用。
 * @param {{ game?: object }} [opts]
 */
export function initSkinPremium({ game } = {}) {
    if (!isWebPremiumClient()) return;
    _game = game || null;
    _toggleBtn = document.getElementById('skin-premium-toggle');

    const prefs = loadPremiumPrefs();
    setSkinPremiumEnabled(prefs.enabled, { persist: false });

    onSkinAfterApply(() => {
        if (!isSkinPremiumEnabled()) return;
        try { applyPremiumSkinVars(getActiveSkin()); } catch { /* ignore */ }
    });

    _toggleBtn?.addEventListener('click', () => {
        const next = !isSkinPremiumEnabled();
        setSkinPremiumEnabled(next);
        try { window.__audioFx?.play?.('tick', { force: true }); } catch { /* ignore */ }
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
    _toggleBtn = null;
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove(PREMIUM_ACTIVE_CLASS);
        _clearPremiumVars();
    }
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
