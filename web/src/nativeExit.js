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

let _backPressCount = 0;
let _backPressTimer = null;

export function initBackButtonHandler({ game = _currentGame() } = {}) {
    if (typeof window === 'undefined') return;

    const _onBack = () => {
        const menu = document.getElementById('menu');
        const isMenuActive = menu?.classList.contains('active');
        const g = game || _currentGame();
        const inGame = g && typeof g.showScreen === 'function';

        if (isMenuActive) {
            _backPressCount++;
            if (_backPressCount === 1) {
                _showExitToast();
                _backPressTimer = setTimeout(() => {
                    _backPressCount = 0;
                    _backPressTimer = null;
                }, 2000);
            } else if (_backPressCount >= 2) {
                _clearBackPressTimer();
                _backPressCount = 0;
                void exitNativeApp({ game: g, fallbackToMenu: false });
            }
        } else if (inGame) {
            returnToMainMenu(g);
        }
    };

    const capApp = window.Capacitor?.Plugins?.App;
    if (capApp?.addListener) {
        capApp.addListener('backButton', _onBack);
        return;
    }

    import('@capacitor/app').then(({ App }) => {
        App?.addListener?.('backButton', _onBack);
    }).catch(() => {});
}

function _clearBackPressTimer() {
    if (_backPressTimer) {
        clearTimeout(_backPressTimer);
        _backPressTimer = null;
    }
}

function _showExitToast() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('exit-back-toast');
    if (existing) existing.remove();

    const html = document.documentElement;
    const isZh = html?.getAttribute('lang')?.startsWith('zh');
    const text = isZh ? '再按一次退出应用' : 'Press back again to exit';

    const el = document.createElement('div');
    el.id = 'exit-back-toast';
    el.textContent = text;
    Object.assign(el.style, {
        position: 'fixed',
        bottom: '120px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.8)',
        color: '#fff',
        padding: '10px 20px',
        borderRadius: '8px',
        fontSize: '14px',
        zIndex: '9999',
        textAlign: 'center',
        pointerEvents: 'none',
        transition: 'opacity 0.25s',
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '0'; });
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1800);
}
