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

/** 触控/原生客户端：不启用悬停 help 等非必须交互 */
export function isTouchLikeClient() {
    try {
        if (document.documentElement.classList.contains('native-client')) return true;
        if (typeof window !== 'undefined' && window.__isNativeClient) return true;
        if (isNativeClient()) return true;
        return !!window.matchMedia?.('(pointer: coarse)')?.matches;
    } catch {
        return false;
    }
}

function suppressBrowserChrome(e) {
    if (shouldAllowBrowserChrome(e.target)) return;
    e.preventDefault();
}

/** @param {Node|null|undefined} node */
function _nodeToElement(node) {
    if (node instanceof Element) return node;
    if (node?.parentElement instanceof Element) return node.parentElement;
    return null;
}

/** iOS / Android 常在 selectstart 之后仍留下选区，需主动清除 */
export function clearDisallowedSelection() {
    try {
        const sel = document.getSelection?.();
        if (!sel || sel.isCollapsed) return;
        const anchor = _nodeToElement(sel.anchorNode);
        const focus = _nodeToElement(sel.focusNode);
        if (shouldAllowBrowserChrome(anchor) || shouldAllowBrowserChrome(focus)) return;
        sel.removeAllRanges();
    } catch {
        /* ignore */
    }
}

function markTouchGuardClass() {
    if (isTouchLikeClient()) {
        document.documentElement.classList.add('browser-chrome-guards-touch');
    }
}

/**
 * @param {{ nativeStricter?: boolean; touchGuards?: boolean }} [options]
 * @returns {() => void} teardown
 */
export function installBrowserChromeGuards(options = {}) {
    if (typeof document === 'undefined') return () => {};
    if (document.documentElement.dataset.browserChromeGuards === '1') return () => {};
    if (guardsDisabledByUrl()) return () => {};

    const nativeStricter = options.nativeStricter !== false && isNativeClient();
    const touchGuards = options.touchGuards !== false && isTouchLikeClient();

    const onContextMenu = suppressBrowserChrome;

    const onSelectStart = (e) => {
        suppressBrowserChrome(e);
        if (touchGuards) clearDisallowedSelection();
    };

    const onClipboard = (e) => {
        if (e.type !== 'copy' && e.type !== 'cut') return;
        suppressBrowserChrome(e);
    };

    const onDragStart = (e) => {
        if (shouldAllowBrowserChrome(e.target)) return;
        const el = e.target;
        const blockAll = nativeStricter
            || touchGuards
            || el instanceof HTMLImageElement
            || el instanceof HTMLCanvasElement
            || el instanceof SVGElement;
        if (blockAll) e.preventDefault();
    };

    const onAuxClick = (e) => {
        if (e.button === 0) return;
        suppressBrowserChrome(e);
    };

    const onKeyDown = (e) => {
        if (!shouldBlockKey(e)) return;
        e.preventDefault();
        e.stopPropagation();
    };

    const onGesture = suppressBrowserChrome;

    const isBoardArea = (target) => {
        if (!(target instanceof Element)) return false;
        return !!target.closest(
            '#game-wrapper, #game-grid, #game-grid-bg, #game-grid-wm, #game-grid-fx, .game-board-flow-bg',
        );
    };

    /* iOS 盘面（canvas）长按会弹系统 callout / 选择放大镜。对盘面区 touchstart
     * preventDefault 即可抑制长按手势；不 stopPropagation，故技能瞄准的 grid 监听、
     * 候选区起手拖块（touchstart 在 dock 而非盘面）、按钮点击均不受影响。 */
    const onTouchStart = (e) => {
        if (!touchGuards) return;
        if (shouldAllowBrowserChrome(e.target)) return;
        if (isBoardArea(e.target) && e.cancelable) e.preventDefault();
    };

    const onTouchMove = (e) => {
        if (!touchGuards) return;
        if (shouldAllowBrowserChrome(e.target)) return;
        if (e.touches && e.touches.length > 1) e.preventDefault();
        clearDisallowedSelection();
    };

    const onTouchEnd = () => {
        if (touchGuards) clearDisallowedSelection();
    };

    const onSelectionChange = () => {
        if (touchGuards) clearDisallowedSelection();
    };

    const cap = { capture: true };
    const touchCap = { capture: true, passive: false };
    document.addEventListener('contextmenu', onContextMenu, cap);
    document.addEventListener('selectstart', onSelectStart, cap);
    document.addEventListener('copy', onClipboard, cap);
    document.addEventListener('cut', onClipboard, cap);
    document.addEventListener('dragstart', onDragStart, cap);
    document.addEventListener('auxclick', onAuxClick, cap);
    document.addEventListener('keydown', onKeyDown, cap);

    if (touchGuards) {
        document.addEventListener('gesturestart', onGesture, touchCap);
        document.addEventListener('gesturechange', onGesture, touchCap);
        document.addEventListener('gestureend', onGesture, touchCap);
        document.addEventListener('touchstart', onTouchStart, touchCap);
        document.addEventListener('touchmove', onTouchMove, touchCap);
        document.addEventListener('touchend', onTouchEnd, cap);
        document.addEventListener('touchcancel', onTouchEnd, cap);
        document.addEventListener('selectionchange', onSelectionChange);
    }

    document.documentElement.dataset.browserChromeGuards = '1';
    markTouchGuardClass();
    if (nativeStricter) document.documentElement.classList.add('browser-chrome-guards-native');

    return () => {
        document.removeEventListener('contextmenu', onContextMenu, cap);
        document.removeEventListener('selectstart', onSelectStart, cap);
        document.removeEventListener('copy', onClipboard, cap);
        document.removeEventListener('cut', onClipboard, cap);
        document.removeEventListener('dragstart', onDragStart, cap);
        document.removeEventListener('auxclick', onAuxClick, cap);
        document.removeEventListener('keydown', onKeyDown, cap);
        if (touchGuards) {
            document.removeEventListener('gesturestart', onGesture, touchCap);
            document.removeEventListener('gesturechange', onGesture, touchCap);
            document.removeEventListener('gestureend', onGesture, touchCap);
            document.removeEventListener('touchstart', onTouchStart, touchCap);
            document.removeEventListener('touchmove', onTouchMove, touchCap);
            document.removeEventListener('touchend', onTouchEnd, cap);
            document.removeEventListener('touchcancel', onTouchEnd, cap);
            document.removeEventListener('selectionchange', onSelectionChange);
        }
        delete document.documentElement.dataset.browserChromeGuards;
        document.documentElement.classList.remove('browser-chrome-guards-native');
    };
}

export const __test_only__ = {
    shouldAllowBrowserChrome,
    shouldBlockKey,
    isNativeClient,
    isTouchLikeClient,
    guardsDisabledByUrl,
    clearDisallowedSelection,
};
