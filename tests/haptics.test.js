/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('haptics adapter', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('iOS Capacitor 原生端优先使用全局 Haptics 插件兜底', async () => {
        const impact = vi.fn().mockResolvedValue(undefined);
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'ios',
            Plugins: {
                Haptics: { impact },
            },
        };
        const { vibrate } = await import('../web/src/effects/haptics.js');

        vibrate(8);

        await vi.waitFor(() => {
            expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
        });
    });

    it('isNativePlatform 缺失时也能通过 getPlatform/Plugins 判定原生触感可用', async () => {
        const impact = vi.fn().mockResolvedValue(undefined);
        window.Capacitor = {
            getPlatform: () => 'ios',
            Plugins: {
                Haptics: { impact },
            },
        };
        const { vibrate } = await import('../web/src/effects/haptics.js');

        vibrate(22);

        await vi.waitFor(() => {
            expect(impact).toHaveBeenCalledWith({ style: 'MEDIUM' });
        });
    });
});
