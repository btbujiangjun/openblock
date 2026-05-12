/**
 * winbackProtection.js — 回流前 3 局保护参数集
 *
 * 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P2-3：
 *   定义 S4（近 7/14/30 天未活跃）回流玩家前 3 局的"保护参数包"——更低的 stress
 *   上限、提示券补给、消行兜底等；adaptiveSpawn / dailyTasks 等模块从此读取，
 *   而不直接硬编码"是否减压"的判断。
 *
 *   - 仅当 daysSinceLastActive ≥ 阈值时 active；
 *   - 完成 protectedRounds 后自动退出；
 *   - 全程通过 analyticsTracker `winback_session_started / completed` 上报。
 */
import { ANALYTICS_EVENTS } from '../monetization/analyticsTracker.js';

const STORAGE_KEY = 'openblock_winback_v1';

/**
 * 默认保护包：与 adaptiveSpawn / stressMeter 接口契约对齐。
 *   - stressCap：本期 buildStoryLine 最大 stress 上限（蓝图建议 0.6）
 *   - clearGuaranteeBoost：在 bot/blockSpawn 的 clearGuarantee 上额外 +N
 *   - sizePreferenceShift：sizePreference 强制偏小块（负值）
 *   - hintCoupons：补给券数量；进入 wallet 由调用方触发
 *   - reviveTokens：复活券；同上
 */
const DEFAULT_PROTECTION_PRESET = Object.freeze({
    stressCap: 0.6,
    clearGuaranteeBoost: 1,
    sizePreferenceShift: -0.3,
    hintCoupons: 2,
    reviveTokens: 1,
});

const TRIGGER_DAYS_SINCE_LAST_ACTIVE = 7; /* 蓝图 S4 默认窗口 */
const PROTECTED_ROUNDS = 3;

let _stateCache = null;

function _loadState() {
    if (_stateCache) return _stateCache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            _stateCache = JSON.parse(raw);
            return _stateCache;
        }
    } catch {}
    _stateCache = { active: false, roundsConsumed: 0, startedAt: null, preset: null };
    return _stateCache;
}

function _saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_stateCache));
    } catch {}
}

/** 评估玩家本次进入是否符合 winback 触发条件，但不立即激活。 */
export function evaluateWinbackTrigger(playerData) {
    const days = Number(playerData?.daysSinceLastActive ?? 0);
    return days >= TRIGGER_DAYS_SINCE_LAST_ACTIVE;
}

/**
 * 激活 winback 保护：返回 preset 并写入 state。
 *   tracker 可选；为方便单测注入 mock。
 */
export function activateWinback(playerData, { tracker = null } = {}) {
    const state = _loadState();
    if (state.active) return state.preset; /* 已激活，幂等返回 */
    if (!evaluateWinbackTrigger(playerData)) return null;

    _stateCache = {
        active: true,
        roundsConsumed: 0,
        startedAt: Date.now(),
        preset: { ...DEFAULT_PROTECTION_PRESET },
    };
    _saveState();

    try {
        tracker?.trackEvent?.(ANALYTICS_EVENTS.WINBACK_SESSION_STARTED.name, {
            daysSinceLastActive: playerData?.daysSinceLastActive ?? null,
            protectionPreset: _stateCache.preset,
        });
    } catch {}

    return _stateCache.preset;
}

/**
 * 局结束时调用：消耗一轮保护，达到 PROTECTED_ROUNDS 后自动退出并上报 completed。
 */
export function consumeProtectedRound({ tracker = null, survived = true, score = 0 } = {}) {
    const state = _loadState();
    if (!state.active) return null;

    state.roundsConsumed += 1;
    const finished = state.roundsConsumed >= PROTECTED_ROUNDS;

    if (finished) {
        try {
            tracker?.trackEvent?.(ANALYTICS_EVENTS.WINBACK_SESSION_COMPLETED.name, {
                protectedRounds: state.roundsConsumed,
                survived: !!survived,
                score,
            });
        } catch {}
        state.active = false;
        state.preset = null;
        state.roundsConsumed = 0;
        state.startedAt = null;
    }
    _saveState();

    return {
        active: state.active,
        finished,
        roundsConsumed: state.roundsConsumed,
        preset: state.preset,
    };
}

/** 取当前保护参数；非保护期返回 null。 */
export function getActivePreset() {
    const state = _loadState();
    return state.active ? { ...state.preset } : null;
}

export function getWinbackStatus() {
    const state = _loadState();
    return { ...state };
}

/** 仅供测试使用：清空缓存与持久化。 */
export function _resetWinbackForTests() {
    _stateCache = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

export {
    DEFAULT_PROTECTION_PRESET,
    TRIGGER_DAYS_SINCE_LAST_ACTIVE,
    PROTECTED_ROUNDS,
};
