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

/* v1.49.x P3-1：early winback 触发阈值（confidence 衰减 + 沮丧叠加）。
 * 规则版：confidence < 0.30 且 frustrationLevel ≥ 0.55 时提前预热回流挽留卡。
 * 注：early signal 只是 hint（用来提前 push / offer），并不直接 activateWinback；
 * 真实 stress 保护包仍由 daysSinceLastActive ≥ 7 触发。 */
const EARLY_WINBACK_CONFIDENCE_MAX = 0.30;
const EARLY_WINBACK_FRUSTRATION_MIN = 0.55;
const EARLY_WINBACK_MISSRATE_MIN = 0.40;

/* RL/外部策略可通过 setEarlyWinbackPolicy 注入自定义评估器，规则版作为 fallback。 */
let _earlyWinbackPolicy = null;

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
    _earlyWinbackPolicy = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

/**
 * v1.49.x P3-1：评估"提前 winback"信号。
 *
 * 输入字段（全可选，缺失按 0 / 1 处理）：
 *   - confidence: AbilityVector.confidence（0..1，越低越没把握）
 *   - frustrationLevel: profile.metrics.frustrationLevel（0..1，越高越沮丧）
 *   - missRate: profile.metrics.missRate（0..1，最近 N 局没消行的比例）
 *   - daysSinceLastActive: 真实 winback 已经触发时直接返回 trigger=false（避免重复挽留）
 *
 * 返回：
 *   - trigger: 是否触发提前挽留
 *   - reason: 'rule' | 'policy' | null
 *   - score: 0..1 风险打分（供 push/offer 排序）
 *   - signals: { confidence, frustrationLevel, missRate } 原值，便于上层日志
 *
 * 设计：纯函数；不写 storage、不发事件。lifecycleOrchestrator 决定何时调用 + 路由事件。
 */
export function evaluateEarlyWinbackSignal(input = {}) {
    const confidence = Number(input.confidence ?? 1);
    const frustrationLevel = Number(input.frustrationLevel ?? 0);
    const missRate = Number(input.missRate ?? 0);
    const daysSinceLastActive = Number(input.daysSinceLastActive ?? 0);

    /* 已经满足真实 winback 触发条件，提前挽留无意义。 */
    if (daysSinceLastActive >= TRIGGER_DAYS_SINCE_LAST_ACTIVE) {
        return { trigger: false, reason: null, score: 0, signals: { confidence, frustrationLevel, missRate } };
    }

    /* 优先调用注入的策略（RL / 远端配置）。 */
    if (typeof _earlyWinbackPolicy === 'function') {
        try {
            const r = _earlyWinbackPolicy({ confidence, frustrationLevel, missRate, daysSinceLastActive });
            if (r && typeof r === 'object') {
                return {
                    trigger: !!r.trigger,
                    reason: r.trigger ? (r.reason || 'policy') : null,
                    score: Math.max(0, Math.min(1, Number(r.score ?? 0))),
                    signals: { confidence, frustrationLevel, missRate },
                };
            }
        } catch { /* 策略异常时回落到规则版 */ }
    }

    /* 规则版：confidence 弱 + 沮丧高 / missRate 高 → trigger。 */
    const confidenceLow = confidence < EARLY_WINBACK_CONFIDENCE_MAX;
    const frustHigh = frustrationLevel >= EARLY_WINBACK_FRUSTRATION_MIN;
    const missHigh = missRate >= EARLY_WINBACK_MISSRATE_MIN;
    const trigger = confidenceLow && (frustHigh || missHigh);

    /* score = 0.4 * (1 - confidence) + 0.4 * frustrationLevel + 0.2 * missRate（钳到 [0,1]）。
     * 仅当 trigger=true 时上层才使用 score；trigger=false 时保留以便 dashboards 观察临界状态。 */
    const score = Math.max(0, Math.min(1,
        0.4 * (1 - confidence) + 0.4 * frustrationLevel + 0.2 * missRate
    ));

    return {
        trigger,
        reason: trigger ? 'rule' : null,
        score,
        signals: { confidence, frustrationLevel, missRate },
    };
}

/** 注入 RL/远端 winback 策略；传入 null 恢复规则版。 */
export function setEarlyWinbackPolicy(fn) {
    _earlyWinbackPolicy = typeof fn === 'function' ? fn : null;
}

export {
    DEFAULT_PROTECTION_PRESET,
    TRIGGER_DAYS_SINCE_LAST_ACTIVE,
    PROTECTED_ROUNDS,
    EARLY_WINBACK_CONFIDENCE_MAX,
    EARLY_WINBACK_FRUSTRATION_MIN,
    EARLY_WINBACK_MISSRATE_MIN,
};
