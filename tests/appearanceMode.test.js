import { describe, expect, it } from 'vitest';
import {
    APPEARANCE_MODES,
    DEFAULT_APPEARANCE_MODE,
    resolveAppearanceMode,
    cycleAppearanceMode,
    getAppearanceState,
    getAppearanceMeta,
    isAppearanceActive,
} from '../web/src/effects/appearanceModeCore.js';

describe('appearanceModeCore', () => {
    it('四档顺序与图标', () => {
        expect(APPEARANCE_MODES).toEqual(['basic', 'effects', 'premium', 'full']);
        expect(getAppearanceMeta('basic').icon).toBe('◇');
        expect(getAppearanceMeta('effects').icon).toBe('✦');
        expect(getAppearanceMeta('premium').icon).toBe('💎');
        expect(getAppearanceMeta('full').icon).toBe('✨');
    });

    it('默认档为 effects（标准+动效）', () => {
        expect(DEFAULT_APPEARANCE_MODE).toBe('effects');
    });

    it('resolveAppearanceMode 合并 legacy 双开关到四档', () => {
        expect(resolveAppearanceMode({ premiumEnabled: false, visualEnabled: false })).toBe('basic');
        expect(resolveAppearanceMode({ premiumEnabled: false, visualEnabled: true })).toBe('effects');
        expect(resolveAppearanceMode({ premiumEnabled: true, visualEnabled: false })).toBe('premium');
        expect(resolveAppearanceMode({ premiumEnabled: true, visualEnabled: true })).toBe('full');
    });

    it('cycleAppearanceMode 循环 basic → effects → premium → full → basic', () => {
        expect(cycleAppearanceMode('basic')).toBe('effects');
        expect(cycleAppearanceMode('effects')).toBe('premium');
        expect(cycleAppearanceMode('premium')).toBe('full');
        expect(cycleAppearanceMode('full')).toBe('basic');
    });

    it('getAppearanceState 映射 premium / visual', () => {
        expect(getAppearanceState('basic')).toEqual({ premiumEnabled: false, visualEnabled: false });
        expect(getAppearanceState('effects')).toEqual({ premiumEnabled: false, visualEnabled: true });
        expect(getAppearanceState('premium')).toEqual({ premiumEnabled: true, visualEnabled: false });
        expect(getAppearanceState('full')).toEqual({ premiumEnabled: true, visualEnabled: true });
    });

    it('isAppearanceActive 只有 basic 视为「未激活」', () => {
        expect(isAppearanceActive('basic')).toBe(false);
        expect(isAppearanceActive('effects')).toBe(true);
        expect(isAppearanceActive('premium')).toBe(true);
        expect(isAppearanceActive('full')).toBe(true);
    });
});
