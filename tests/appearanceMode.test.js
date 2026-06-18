import { describe, expect, it } from 'vitest';
import {
    APPEARANCE_MODES,
    resolveAppearanceMode,
    cycleAppearanceMode,
    getAppearanceState,
    getAppearanceMeta,
} from '../web/src/effects/appearanceModeCore.js';

describe('appearanceModeCore', () => {
    it('三档顺序与图标', () => {
        expect(APPEARANCE_MODES).toEqual(['basic', 'premium', 'full']);
        expect(getAppearanceMeta('basic').icon).toBe('◇');
        expect(getAppearanceMeta('premium').icon).toBe('💎');
        expect(getAppearanceMeta('full').icon).toBe('✨');
    });

    it('resolveAppearanceMode 合并 legacy 双开关', () => {
        expect(resolveAppearanceMode({ premiumEnabled: false, visualEnabled: false })).toBe('basic');
        expect(resolveAppearanceMode({ premiumEnabled: true, visualEnabled: false })).toBe('premium');
        expect(resolveAppearanceMode({ premiumEnabled: true, visualEnabled: true })).toBe('full');
        expect(resolveAppearanceMode({ premiumEnabled: false, visualEnabled: true })).toBe('full');
    });

    it('cycleAppearanceMode 循环 basic → premium → full → basic', () => {
        expect(cycleAppearanceMode('basic')).toBe('premium');
        expect(cycleAppearanceMode('premium')).toBe('full');
        expect(cycleAppearanceMode('full')).toBe('basic');
    });

    it('getAppearanceState 映射 premium / visual', () => {
        expect(getAppearanceState('basic')).toEqual({ premiumEnabled: false, visualEnabled: false });
        expect(getAppearanceState('premium')).toEqual({ premiumEnabled: true, visualEnabled: false });
        expect(getAppearanceState('full')).toEqual({ premiumEnabled: true, visualEnabled: true });
    });
});
