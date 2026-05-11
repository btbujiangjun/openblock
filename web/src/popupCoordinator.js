/**
 * 轻量弹窗协调器：避免广告、成就、复活、破纪录等遮罩连续叠出。
 *
 * 目标不是做复杂全局状态机，而是在高频触发点提供两个能力：
 * 1. 识别当前是否有「短时打断弹窗」正在展示；
 * 2. 为广告等非关键弹窗等待一个安静窗口，超时则跳过。
 *
 * v10.17 扩展（防御-①）
 * --------------------
 * - 每会话「主弹窗」上限：requestPrimary(id) 拒绝同会话第 2 次主弹窗，
 *   解决 D1 起首日礼包+签到+战令+节日推荐+大师挑战在 5s 内全部弹出的轰炸问题
 * - 主弹窗优先级：P0(回归礼包/首日礼包) > P1(签到) > P2(节日推荐/大师挑战) > P3(战令更新)
 * - 兜底：高优先级到达时若已展示低优先级，将其延迟到下次会话
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

function isTransientPopupActive() {
    if (typeof document === 'undefined') return false;
    return TRANSIENT_POPUP_SELECTORS.some((sel) => Boolean(document.querySelector(sel)));
}

export function isGameOverScreenActive() {
    if (typeof document === 'undefined') return false;
    return Boolean(document.getElementById('game-over')?.classList.contains('active'));
}

function isPopupQuiet() {
    return !isTransientPopupActive() && _now() >= _quietUntil;
}

/* ───────────────────────────── v10.17 主弹窗优先级队列 ───────────────────────────── */

const PRIMARY_PRIORITY = {
    welcomeBack:       0,    // 沉默回归礼包（最高）
    firstDayPack:      0,    // 首日大礼包（与 welcomeBack 互斥，二选一）
    checkIn:           1,    // 7 日签到日历
    seasonalRecommend: 2,    // 节日 / 时段皮肤推荐
    dailyMaster:       2,    // 每日大师挑战
    seasonPassUpdate:  3,    // 战令更新提示（最低）
};

/* 单次会话已经展示过主弹窗的 id；下次刷新 / 启动会话才清空 */
const _shownPrimaryThisSession = new Set();
let _currentPrimaryPriority = Infinity;

/**
 * 申请展示一个「主弹窗」。同会话内仅允许一个主弹窗展示。
 * 若已有主弹窗：
 *   - 申请优先级 ≥ 现有 → 拒绝
 *   - 申请优先级 < 现有 → 接受（高优先级抢占；低优先级被延后到下次会话）
 *
 * @param {keyof typeof PRIMARY_PRIORITY} id
 * @returns {boolean} 是否允许展示
 */
export function requestPrimaryPopup(id) {
    const prio = PRIMARY_PRIORITY[id];
    if (prio === undefined) {
        console.warn('[popupCoordinator] unknown primary popup id:', id);
        return true;   // 未注册的允许通过（向后兼容）
    }
    if (_shownPrimaryThisSession.has(id)) return false;
    if (prio >= _currentPrimaryPriority) return false;
    _shownPrimaryThisSession.add(id);
    _currentPrimaryPriority = prio;
    return true;
}

/**
 * 主弹窗关闭时调用，让下一次更高优先级有机会展示。
 * （注意：不会重置已展示集合，已展示就不会再重弹）
 */
export function releasePrimaryPopup() {
    _currentPrimaryPriority = Infinity;
}

/** 测试用 */
export function __resetPrimaryForTest() {
    _shownPrimaryThisSession.clear();
    _currentPrimaryPriority = Infinity;
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

