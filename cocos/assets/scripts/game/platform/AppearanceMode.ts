/**
 * AppearanceMode.ts — Cocos 界面风格三档循环（标准 / 精致 / 精致+特效）
 */
import { Color } from 'cc';
import { Skin } from '../../core';
import { Storage, STORAGE_KEYS } from './Storage';
import { VisualFx } from './VisualFx';
import { setSkinPremiumEnabled } from './SkinPremium';
// @ts-ignore 引擎同步纯逻辑
import {
    resolveAppearanceMode,
    cycleAppearanceMode as cycleAppearanceModeCore,
    getAppearanceState,
    getAppearanceMeta,
    APPEARANCE_MODES,
} from '../../engine/effects/appearanceModeCore.mjs';
// @ts-ignore 引擎同步纯逻辑
import { loadPremiumPrefs } from '../../engine/effects/skinPremiumCore.mjs';

type AppearanceMode = 'basic' | 'premium' | 'full';

const storageAdapter = {
    getItem: (k: string) => Storage.get(k, null),
    setItem: (k: string, v: string) => { Storage.set(k, v); },
};

let _mode: AppearanceMode = 'basic';

function persistVisual(enabled: boolean): void {
    Storage.set(STORAGE_KEYS.visualFx, JSON.stringify({ enabled: !!enabled }));
}

export function initAppearanceMode(): void {
    const premiumPrefs = loadPremiumPrefs(storageAdapter);
    _mode = resolveAppearanceMode({
        premiumEnabled: premiumPrefs.enabled,
        visualEnabled: VisualFx.enabled,
    }) as AppearanceMode;
    applyAppearanceMode(_mode, { persist: false });
}

export function getAppearanceMode(): AppearanceMode {
    return _mode;
}

export function getAppearanceIcon(): string {
    return getAppearanceMeta(_mode).icon;
}

export function getAppearanceFloatText(): { text: string; color: Color } {
    const meta = getAppearanceMeta(_mode);
    if (_mode === 'basic') {
        return { text: meta.floatText, color: new Color(180, 200, 220, 255) };
    }
    return { text: meta.floatText, color: new Color(255, 220, 130, 255) };
}

export function applyAppearanceMode(
    mode: AppearanceMode,
    opts: { persist?: boolean; skin?: Skin } = {},
): AppearanceMode {
    _mode = (APPEARANCE_MODES.includes(mode) ? mode : 'basic') as AppearanceMode;
    const { premiumEnabled, visualEnabled } = getAppearanceState(_mode);
    setSkinPremiumEnabled(premiumEnabled, { persist: opts.persist !== false, skin: opts.skin });
    VisualFx.set(visualEnabled);
    if (opts.persist !== false) persistVisual(visualEnabled);
    return _mode;
}

export function cycleAppearanceMode(skin?: Skin): AppearanceMode {
    _mode = cycleAppearanceModeCore(_mode) as AppearanceMode;
    applyAppearanceMode(_mode, { skin });
    return _mode;
}
