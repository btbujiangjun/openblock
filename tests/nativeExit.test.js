/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindNativeExitButtons, exitNativeApp, returnToMainMenu } from '../web/src/nativeExit.js';

describe('nativeExit', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('returnToMainMenu 直接调用游戏实例，不依赖代理点击其它按钮', () => {
        const game = {
            runStreak: 3,
            _updateRunStreakHint: vi.fn(),
            showScreen: vi.fn(),
        };

        expect(returnToMainMenu(game)).toBe(true);

        expect(game.runStreak).toBe(0);
        expect(game._updateRunStreakHint).toHaveBeenCalledOnce();
        expect(game.showScreen).toHaveBeenCalledWith('menu');
    });

    it('移动端关闭按钮绑定 pointerup 后返回菜单', () => {
        document.body.innerHTML = '<button id="mobile-exit-btn"></button>';
        const game = { runStreak: 1, _updateRunStreakHint: vi.fn(), showScreen: vi.fn() };
        window.PointerEvent = function PointerEvent() {};

        bindNativeExitButtons({ game });
        document.getElementById('mobile-exit-btn')
            .dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }));

        expect(game.showScreen).toHaveBeenCalledWith('menu');
    });

    it('退出应用按钮优先调用 Capacitor App 插件', async () => {
        const exitApp = vi.fn().mockResolvedValue(undefined);
        window.Capacitor = { Plugins: { App: { exitApp } } };

        const ok = await exitNativeApp({ fallbackToMenu: false });

        expect(ok).toBe(true);
        expect(exitApp).toHaveBeenCalledOnce();
    });
});
