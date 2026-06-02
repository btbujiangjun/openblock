/**
 * 游戏页屏蔽无关浏览器能力：右键菜单、长按呼出、拖拽保存、常见浏览器快捷键等。
 * 输入框与带 data-allow-browser-chrome 的区域除外；?debug=1 时跳过（便于开发调试）。
 */

function isNativeClient() {
    try {
        if (document.documentElement.classList.contains('native-client')) return true;
        const cap = typeof window !== 'undefined' ? window.Capacitor : null;
        if (!cap) return false;
        if (typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform();
        return typeof cap.getPlatform === 'function' ? cap.getPlatform() !== 'web' : false;
    } catch {
        return false;
    }
}

function guardsDisabledByUrl() {
    try {
        return new URLSearchParams(window.location.search).get('debug') === '1';
    } catch {
        return false;
    }
}

/**
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
export function shouldAllowBrowserChrome(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('[data-allow-browser-chrome]')) return true;
    const editable = target.closest(
        'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]',
    );
    return !!editable && !editable.closest('[data-no-browser-chrome]');
}

/**
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function shouldBlockKey(e) {
    if (shouldAllowBrowserChrome(e.target)) return false;

    const key = e.key;
    const code = e.code;
    const mod = e.ctrlKey || e.metaKey;
    const alt = e.altKey;

    if (key === 'ContextMenu' || code === 'ContextMenu') return true;

    if (/^F([1-9]|1[0-2])$/.test(key)) return true;

    if (alt && (key === 'ArrowLeft' || key === 'ArrowRight' || code === 'ArrowLeft' || code === 'ArrowRight')) {
        return true;
    }

    if (!mod) return false;

    const k = (key || '').toLowerCase();
    const blocked = new Set([
        'r', 's', 'p', 'u', 'w', 'n', 'f', 'h', 'a', 'c', 'v', 'x', 'd', 'g', 'l', 'o', 'j', 'k', 'i', 'e',
    ]);
    if (blocked.has(k)) return true;

    if (e.shiftKey && blocked.has(k)) return true;

    return false;
}

/**
 * @param {{ nativeStricter?: boolean }} [options]
 * @returns {() => void} teardown
 */
export function installBrowserChromeGuards(options = {}) {
    if (typeof document === 'undefined') return () => {};
    if (document.documentElement.dataset.browserChromeGuards === '1') return () => {};
    if (guardsDisabledByUrl()) return () => {};

    const nativeStricter = options.nativeStricter !== false && isNativeClient();

    const onContextMenu = (e) => {
        if (!shouldAllowBrowserChrome(e.target)) e.preventDefault();
    };

    const onDragStart = (e) => {
        if (shouldAllowBrowserChrome(e.target)) return;
        const el = e.target;
        if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement) {
            e.preventDefault();
        }
    };

    const onKeyDown = (e) => {
        if (!shouldBlockKey(e)) return;
        e.preventDefault();
        e.stopPropagation();
    };

    document.addEventListener('contextmenu', onContextMenu, { capture: true });
    document.addEventListener('dragstart', onDragStart, { capture: true });
    document.addEventListener('keydown', onKeyDown, { capture: true });

    document.documentElement.dataset.browserChromeGuards = '1';
    if (nativeStricter) document.documentElement.classList.add('browser-chrome-guards-native');

    return () => {
        document.removeEventListener('contextmenu', onContextMenu, { capture: true });
        document.removeEventListener('dragstart', onDragStart, { capture: true });
        document.removeEventListener('keydown', onKeyDown, { capture: true });
        delete document.documentElement.dataset.browserChromeGuards;
        document.documentElement.classList.remove('browser-chrome-guards-native');
    };
}

export const __test_only__ = {
    shouldAllowBrowserChrome,
    shouldBlockKey,
    isNativeClient,
    guardsDisabledByUrl,
};
