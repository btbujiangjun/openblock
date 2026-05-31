/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindNativeExitButtons, exitNativeApp, initBackButtonHandler, returnToMainMenu } from '../web/src/nativeExit.js';

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

    describe('initBackButtonHandler', () => {
        it('菜单页按返回键第一次显示提示 toast', () => {
            document.body.innerHTML = '<div id="menu" class="screen active"></div>';
            document.documentElement.setAttribute('lang', 'zh-CN');
            const addListener = vi.fn();
            window.Capacitor = { Plugins: { App: { addListener, exitApp: vi.fn() } } };

            initBackButtonHandler();

            expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
            const handler = addListener.mock.calls[0][1];

            handler();
            const toast = document.getElementById('exit-back-toast');
            expect(toast).toBeTruthy();
            expect(toast.textContent).toBe('再按一次退出应用');

            handler();
            const toast2 = document.getElementById('exit-back-toast');
            expect(toast2).toBeTruthy();
        });

        it('游戏内按返回键调用 returnToMainMenu', () => {
            document.body.innerHTML = '<div id="menu" class="screen"></div>';
            const addListener = vi.fn();
            window.Capacitor = { Plugins: { App: { addListener, exitApp: vi.fn() } } };
            const game = { runStreak: 5, _updateRunStreakHint: vi.fn(), showScreen: vi.fn() };

            initBackButtonHandler({ game });

            const handler = addListener.mock.calls[0][1];
            handler();

            expect(game.showScreen).toHaveBeenCalledWith('menu');
            expect(game.runStreak).toBe(0);
        });

        it('连续两次按返回键退出应用', async () => {
            document.body.innerHTML = '<div id="menu" class="screen active"></div>';
            const exitApp = vi.fn().mockResolvedValue(undefined);
            const addListener = vi.fn();
            window.Capacitor = { Plugins: { App: { addListener, exitApp } } };

            initBackButtonHandler();
            const handler = addListener.mock.calls[0][1];

            handler();
            await vi.waitFor(() => {
                expect(document.getElementById('exit-back-toast')).toBeTruthy();
            });

            handler();

            await vi.waitFor(() => {
                expect(exitApp).toHaveBeenCalled();
            });
        });
    });
});
