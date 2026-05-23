export function returnToMainMenu(game = _currentGame()) {
    const menu = typeof document !== 'undefined' ? document.getElementById('menu') : null;
    if (game && typeof game.showScreen === 'function') {
        game.runStreak = 0;
        game._updateRunStreakHint?.();
        game.showScreen('menu');
        return true;
    }
    if (menu) {
        menu.classList.add('active');
        if (typeof document !== 'undefined') {
            document.body?.classList.add('game-shell-hidden');
        }
        return true;
    }
    return false;
}

export async function exitNativeApp({ game = _currentGame(), fallbackToMenu = true } = {}) {
    try {
        const plugin = typeof window !== 'undefined' ? window.Capacitor?.Plugins?.App : null;
        if (typeof plugin?.exitApp === 'function') {
            await plugin.exitApp();
            return true;
        }
    } catch {
        /* iOS may reject programmatic exits; fall back below. */
    }

    try {
        const mod = await import('@capacitor/app');
        if (typeof mod.App?.exitApp === 'function') {
            await mod.App.exitApp();
            return true;
        }
    } catch {
        /* App plugin unavailable or unsupported on this platform. */
    }

    return fallbackToMenu ? returnToMainMenu(game) : false;
}

export function bindNativeExitButtons({ game = _currentGame(), audioFx = _audioFx() } = {}) {
    _bindReliableTap(document.getElementById('mobile-exit-btn'), () => {
        audioFx?.play?.('tick', { force: true });
        audioFx?.vibrate?.(8);
        returnToMainMenu(game || _currentGame());
    });

    _bindReliableTap(document.getElementById('native-exit-app-btn'), () => {
        audioFx?.play?.('tick', { force: true });
        audioFx?.vibrate?.([10, 20, 10]);
        void exitNativeApp({ game: game || _currentGame(), fallbackToMenu: true });
    });
}

function _bindReliableTap(el, handler) {
    if (!el || el.__openBlockNativeExitBound) return;
    el.__openBlockNativeExitBound = true;
    let lastAt = 0;
    const fire = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const now = Date.now();
        if (now - lastAt < 320) return;
        lastAt = now;
        handler(event);
    };
    if (typeof window !== 'undefined' && window.PointerEvent) {
        el.addEventListener('pointerup', fire);
    } else {
        el.addEventListener('touchend', fire, { passive: false });
    }
    el.addEventListener('click', fire);
}

function _currentGame() {
    return typeof window !== 'undefined' ? window.openBlockGame : null;
}

function _audioFx() {
    return typeof window !== 'undefined' ? window.__audioFx : null;
}
