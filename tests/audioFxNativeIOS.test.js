/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AudioFx native iOS haptics', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.resetModules();
        document.documentElement.classList.remove('ios-client', 'native-client');
    });

    it('iOS 原生端即使开启减少动态效果，也不屏蔽原生触感', async () => {
        const impact = vi.fn().mockResolvedValue(undefined);
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'ios',
            Plugins: { Haptics: { impact } },
        };
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));

        const { createAudioFx } = await import('../web/src/effects/audioFx.js');
        const audio = createAudioFx();
        audio.vibrate(8);

        await vi.waitFor(() => {
            expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
        });
    });
});
