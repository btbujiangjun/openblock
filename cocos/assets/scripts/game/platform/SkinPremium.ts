/**
 * SkinPremium.ts — Cocos 精致界面 / S 级渲染开关（对齐 web skinPremium.js）
 */
import { Color } from 'cc';
import { Skin } from '../../core';
import { Storage, STORAGE_KEYS } from './Storage';
import { VisualFx } from './VisualFx';
import { Motion } from './Motion';
import { accentColor, accentDarkColor, parseColor } from '../skin/palette';
// @ts-ignore 引擎同步纯逻辑
import {
    loadPremiumPrefs,
    savePremiumPrefs,
    computePremiumSkinVars,
    isPremiumRenderEnabled,
} from '../../engine/effects/skinPremiumCore.mjs';

export { SKIN_PREMIUM_STORAGE_KEY } from '../../engine/effects/skinPremiumCore.mjs';
export {
    PREMIUM_BOARD_BLEED_PX,
    PREMIUM_WRAPPER_PAD_PX,
    PREMIUM_WRAPPER_RADIUS_PX,
    premiumBoardCornerRadiusPx,
} from '../../engine/effects/skinPremiumCore.mjs';

export interface PremiumVars {
    accent: Color;
    accentDark: Color;
    boardBorder: Color;
    boardGlow: Color;
    glassBorder: Color;
    /** HUD / 托盘玻璃顶色（对齐 core `--premium-glass-surface` 上沿）。 */
    glassTop: Color;
    /** HUD / 托盘玻璃底色。 */
    glassBottom: Color;
    /** 盘面外框包装顶色（对齐 web `#game-wrapper` 渐变上沿）。 */
    wrapperTop: Color;
    /** 盘面外框包装底色。 */
    wrapperBottom: Color;
}

let _enabled = false;
let _vars: PremiumVars | null = null;
let _getSkin: (() => Skin) | null = null;
let _onRefresh: (() => void) | null = null;
const _listeners: Array<(enabled: boolean) => void> = [];

const storageAdapter = {
    getItem: (k: string) => Storage.get(k, null),
    setItem: (k: string, v: string) => { Storage.set(k, v); },
};

function colorToHex(c: Color): string {
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function parseRgba(str: string, fallback: Color): Color {
    try {
        return parseColor(str, fallback.a);
    } catch {
        return fallback;
    }
}

function skinForCore(skin: Skin): { uiDark?: boolean; cssVars?: Record<string, string> } {
    const accent = accentColor(skin);
    const dark = accentDarkColor(skin);
    return {
        uiDark: skin.uiDark !== false,
        cssVars: {
            '--accent-color': colorToHex(accent),
            '--accent-dark': colorToHex(dark),
        },
    };
}

function applyVarsFromSkin(skin: Skin): void {
    const raw = computePremiumSkinVars(skinForCore(skin));
    const accent = accentColor(skin);
    const accentDark = accentDarkColor(skin);
    const uiDark = skin.uiDark !== false;
    _vars = {
        accent,
        accentDark,
        boardBorder: parseRgba(raw['--premium-board-border'] || '', new Color(accent.r, accent.g, accent.b, 72)),
        boardGlow: parseRgba(raw['--premium-board-glow'] || '', new Color(accent.r, accent.g, accent.b, 36)),
        glassBorder: parseRgba(raw['--premium-glass-border'] || '', new Color(148, 163, 184, 46)),
        glassTop: uiDark ? new Color(30, 41, 59, 209) : new Color(255, 255, 255, 199),
        glassBottom: uiDark ? new Color(14, 20, 32, 224) : new Color(248, 250, 252, 219),
        wrapperTop: uiDark ? new Color(15, 23, 42, 235) : new Color(241, 245, 249, 230),
        wrapperBottom: uiDark ? new Color(15, 23, 42, 250) : new Color(248, 250, 252, 240),
    };
}

/** 初始化偏好；可在建模后再次传入 getSkin / onRefresh 挂钩。 */
export function initSkinPremium(opts?: {
    getSkin?: () => Skin;
    onRefresh?: () => void;
}): void {
    if (opts?.getSkin) _getSkin = opts.getSkin;
    if (opts?.onRefresh) _onRefresh = opts.onRefresh;
    const prefs = loadPremiumPrefs(storageAdapter);
    setSkinPremiumEnabled(prefs.enabled, { persist: false });
}

export function isSkinPremiumEnabled(): boolean {
    if (Motion.reduced) return false;
    return isPremiumRenderEnabled({
        enabled: _enabled,
        qualityMode: VisualFx.enabled ? 'high' : 'balanced',
        qualityOff: false,
    });
}

export function getPremiumVars(): PremiumVars | null {
    return isSkinPremiumEnabled() ? _vars : null;
}

export function getPremiumAccent(): Color {
    return _vars?.accent ?? new Color(56, 189, 248, 255);
}

export function refreshPremiumSkin(skin: Skin): void {
    if (!_enabled) return;
    applyVarsFromSkin(skin);
    _onRefresh?.();
}

export function setSkinPremiumEnabled(
    enabled: boolean,
    opts: { persist?: boolean; skin?: Skin } = {},
): boolean {
    const on = !!enabled;
    _enabled = on;
    if (on) {
        const skin = opts.skin ?? _getSkin?.();
        if (skin) applyVarsFromSkin(skin);
    } else {
        _vars = null;
    }
    if (opts.persist !== false) {
        savePremiumPrefs(storageAdapter, { enabled: on });
    }
    for (const fn of _listeners.slice()) {
        try { fn(on); } catch { /* ignore */ }
    }
    _onRefresh?.();
    return on;
}

export function togglePremium(skin?: Skin): boolean {
    return setSkinPremiumEnabled(!isSkinPremiumEnabled(), { skin: skin ?? _getSkin?.() ?? undefined });
}

export function onPremiumChange(fn: (enabled: boolean) => void): () => void {
    _listeners.push(fn);
    return () => {
        const i = _listeners.indexOf(fn);
        if (i >= 0) _listeners.splice(i, 1);
    };
}
