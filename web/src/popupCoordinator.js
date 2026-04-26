/**
 * 轻量弹窗协调器：避免广告、成就、复活、破纪录等遮罩连续叠出。
 *
 * 目标不是做复杂全局状态机，而是在高频触发点提供两个能力：
 * 1. 识别当前是否有「短时打断弹窗」正在展示；
 * 2. 为广告等非关键弹窗等待一个安静窗口，超时则跳过。
 */

const TRANSIENT_POPUP_SELECTORS = [
    '.mon-ad-overlay',
    '.revive-overlay',
    '.no-moves-overlay',
    '.new-best-popup',
    '.achievement-popup',
];

const DEFAULT_GAP_MS = 900;
let _quietUntil = 0;

function _now() {
    return Date.now();
}

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function notePopupShown(estimatedDurationMs = 0, gapMs = DEFAULT_GAP_MS) {
    _quietUntil = Math.max(_quietUntil, _now() + Math.max(0, estimatedDurationMs) + gapMs);
}

export function isTransientPopupActive() {
    if (typeof document === 'undefined') return false;
    return TRANSIENT_POPUP_SELECTORS.some((sel) => Boolean(document.querySelector(sel)));
}

export function isGameOverScreenActive() {
    if (typeof document === 'undefined') return false;
    return Boolean(document.getElementById('game-over')?.classList.contains('active'));
}

export function isPopupQuiet() {
    return !isTransientPopupActive() && _now() >= _quietUntil;
}

/**
 * 等待弹窗安静窗口后执行 action。若等待超时或 skipIf 返回 true，则跳过。
 *
 * @param {() => Promise<unknown>|unknown} action
 * @param {{ minDelayMs?: number, timeoutMs?: number, pollMs?: number, skipIf?: () => boolean }} [opts]
 * @returns {Promise<boolean>} 是否执行了 action
 */
export async function runAfterPopupQuiet(action, opts = {}) {
    const minDelayMs = opts.minDelayMs ?? 0;
    const timeoutMs = opts.timeoutMs ?? 3000;
    const pollMs = opts.pollMs ?? 250;
    const start = _now();

    if (minDelayMs > 0) {
        await _sleep(minDelayMs);
    }

    while (true) {
        if (opts.skipIf?.()) return false;
        if (isPopupQuiet()) {
            await action();
            return true;
        }
        if (_now() - start >= timeoutMs) {
            return false;
        }
        await _sleep(pollMs);
    }
}

