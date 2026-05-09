/**
 * 统一 cursor:help 提示层：
 * - 仅对 cursor=help 的元素生效；
 * - 悬停等待 delayMs 后显示；
 * - 使用自定义浮层，避免浏览器原生 title 延迟不可控。
 */

const TOOLTIP_ID = 'cursor-help-tooltip';

function _ensureTooltipEl() {
    let el = document.getElementById(TOOLTIP_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = TOOLTIP_ID;
    el.className = 'cursor-help-tooltip';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
}

function _isHelpCursor(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
        return window.getComputedStyle(el).cursor === 'help';
    } catch {
        return false;
    }
}

function _pickHelpTarget(start) {
    if (!(start instanceof Element)) return null;
    let cur = start;
    while (cur && cur !== document.body) {
        const hasTip = cur.hasAttribute('title') || (cur.dataset && cur.dataset.helpTitle);
        if (hasTip && _isHelpCursor(cur)) return cur;
        cur = cur.parentElement;
    }
    return null;
}

function _readTipText(el) {
    if (!el) return '';
    const text = (el.dataset?.helpTitle || el.getAttribute('title') || '').trim();
    return text;
}

function _disableNativeTitle(el) {
    if (!el || !el.hasAttribute('title')) return;
    const t = el.getAttribute('title');
    if (t && !el.dataset.helpTitle) el.dataset.helpTitle = t;
    el.removeAttribute('title');
}

function _restoreNativeTitle(el) {
    if (!el || !el.dataset?.helpTitle) return;
    if (!el.hasAttribute('title')) {
        el.setAttribute('title', el.dataset.helpTitle);
    }
}

function _positionTooltip(tipEl, targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const pad = 8;
    const gap = 10;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    tipEl.style.left = '0px';
    tipEl.style.top = '0px';
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;

    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(pad, Math.min(left, vw - tw - pad));

    let top = rect.bottom + gap;
    if (top + th + pad > vh) {
        top = rect.top - th - gap;
    }
    top = Math.max(pad, Math.min(top, vh - th - pad));

    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
}

export function initCursorHelpTooltip(opts = {}) {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    if (window.__cursorHelpTooltipInited) return;
    window.__cursorHelpTooltipInited = true;

    const delayMs = Math.max(0, Number(opts.delayMs ?? 1500));
    let timer = null;
    let activeTarget = null;
    let shown = false;
    const tipEl = _ensureTooltipEl();

    const clearTimer = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const hideTip = () => {
        clearTimer();
        if (shown) {
            tipEl.classList.remove('is-visible');
            tipEl.setAttribute('aria-hidden', 'true');
            shown = false;
        }
        if (activeTarget) {
            _restoreNativeTitle(activeTarget);
        }
        activeTarget = null;
    };

    const showTip = (target) => {
        if (!target || !document.contains(target)) return;
        const text = _readTipText(target);
        if (!text) return;
        _disableNativeTitle(target);
        tipEl.textContent = text;
        tipEl.classList.add('is-visible');
        tipEl.setAttribute('aria-hidden', 'false');
        _positionTooltip(tipEl, target);
        shown = true;
    };

    const armTip = (target) => {
        clearTimer();
        if (activeTarget && activeTarget !== target) {
            _restoreNativeTitle(activeTarget);
        }
        activeTarget = target;
        _disableNativeTitle(target);
        timer = window.setTimeout(() => {
            timer = null;
            showTip(target);
        }, delayMs);
    };

    document.addEventListener('mouseover', (e) => {
        const target = _pickHelpTarget(e.target);
        if (!target) {
            hideTip();
            return;
        }
        if (target === activeTarget && (timer || shown)) return;
        hideTip();
        armTip(target);
    }, true);

    document.addEventListener('mouseout', (e) => {
        if (!activeTarget) return;
        const rt = e.relatedTarget;
        if (rt instanceof Element && activeTarget.contains(rt)) return;
        hideTip();
    }, true);

    document.addEventListener('focusin', (e) => {
        const target = _pickHelpTarget(e.target);
        if (!target) return;
        hideTip();
        armTip(target);
    }, true);

    document.addEventListener('focusout', () => {
        hideTip();
    }, true);

    ['scroll', 'resize', 'mousedown', 'touchstart', 'keydown'].forEach((evt) => {
        window.addEventListener(evt, hideTip, true);
    });
}

