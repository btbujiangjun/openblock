/**
 * weeklyChallenge.js — 周循环活动调度（72h 挑战 + 12-24h 空窗）
 *
 * 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P1-4：
 *   面向 M2+ 人群的"挑战 → 空窗 → 挑战"节律。本模块负责活动周期计算、加入/完成
 *   事件上报、单测可注入时钟，不直接渲染 UI（UI 由 dailyTasks / 通知中心读取）。
 *
 *   - 周期模型：72h 挑战 + 18h 默认空窗 = 90h（一周内可循环约 1.86 次）；
 *   - 加入：weekly_challenge_join；完成：weekly_challenge_complete；
 *   - 与 lifecyclePlaybook 配合：M2+ 玩家的 actions 列表里包含 weekly_challenge_main。
 */
import { ANALYTICS_EVENTS } from './analyticsTracker.js';

const STORAGE_KEY = 'openblock_weekly_challenge_v1';
const HOUR_MS = 60 * 60 * 1000;

const DEFAULT_CONFIG = Object.freeze({
    challengeWindowMs: 72 * HOUR_MS,
    breakWindowMs: 18 * HOUR_MS,
    eligibleBands: ['M2', 'M3', 'M4'],
    eligibleStages: ['S1', 'S2', 'S3'],
});

let _state = null;

function _load() {
    if (_state) return _state;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            _state = JSON.parse(raw);
            return _state;
        }
    } catch {}
    _state = {
        cycleStart: null,
        joins: [],
        completes: [],
    };
    return _state;
}

function _save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch {}
}

/**
 * 给定 now 与配置，判断当前是 challenge / break / idle。
 *   - idle：第一次启动或重置后，cycleStart === null
 *   - challenge：now ∈ [cycleStart, cycleStart + challengeWindowMs)
 *   - break：now ∈ [cycleStart + challengeWindowMs, cycleStart + total)
 *   - 周期到期后自动滚到下一个 cycleStart（懒滚动，无需后台进程）
 */
export function getCurrentPhase({ now = Date.now(), config = DEFAULT_CONFIG } = {}) {
    const state = _load();
    const total = config.challengeWindowMs + config.breakWindowMs;
    if (!state.cycleStart) {
        return { phase: 'idle', cycleStart: null, msUntilNext: 0, cycleId: null };
    }
    let cycleStart = state.cycleStart;
    while (now >= cycleStart + total) {
        cycleStart += total;
    }
    if (cycleStart !== state.cycleStart) {
        state.cycleStart = cycleStart;
        _save();
    }
    const elapsed = now - cycleStart;
    if (elapsed < config.challengeWindowMs) {
        return {
            phase: 'challenge',
            cycleStart,
            cycleId: _cycleId(cycleStart),
            msUntilNext: config.challengeWindowMs - elapsed,
        };
    }
    return {
        phase: 'break',
        cycleStart,
        cycleId: _cycleId(cycleStart),
        msUntilNext: total - elapsed,
    };
}

function _cycleId(ts) {
    return `wc_${new Date(ts).toISOString().slice(0, 10)}_${ts}`;
}

/**
 * 启动一个全新挑战周期；若已有进行中的挑战会幂等返回当前 cycle。
 */
export function startCycle({ now = Date.now(), tracker = null, stage = null, band = null } = {}) {
    const phase = getCurrentPhase({ now });
    if (phase.phase === 'challenge') return phase;
    const state = _load();
    state.cycleStart = now;
    _save();
    const created = getCurrentPhase({ now });
    try {
        tracker?.trackEvent?.(ANALYTICS_EVENTS.WEEKLY_CHALLENGE_JOIN.name, {
            challengeId: created.cycleId,
            cycle: created.cycleId,
            stage,
            band,
        });
    } catch {}
    return created;
}

export function joinChallenge({ now = Date.now(), tracker = null, stage = null, band = null, userId = 'local' } = {}) {
    const phase = getCurrentPhase({ now });
    if (phase.phase !== 'challenge') return null;
    const state = _load();
    state.joins.push({ at: now, cycleId: phase.cycleId, userId });
    _save();
    try {
        tracker?.trackEvent?.(ANALYTICS_EVENTS.WEEKLY_CHALLENGE_JOIN.name, {
            challengeId: phase.cycleId,
            cycle: phase.cycleId,
            stage,
            band,
        });
    } catch {}
    return { cycleId: phase.cycleId, joinedAt: now };
}

export function completeChallenge({ now = Date.now(), tracker = null, score = 0, durationMs = 0, userId = 'local' } = {}) {
    const phase = getCurrentPhase({ now });
    if (phase.phase !== 'challenge') return null;
    const state = _load();
    state.completes.push({ at: now, cycleId: phase.cycleId, score, durationMs, userId });
    _save();
    try {
        tracker?.trackEvent?.(ANALYTICS_EVENTS.WEEKLY_CHALLENGE_COMPLETE.name, {
            challengeId: phase.cycleId,
            cycle: phase.cycleId,
            score,
            durationMs,
        });
    } catch {}
    return { cycleId: phase.cycleId, completedAt: now, score };
}

export function isEligible({ stage, band, config = DEFAULT_CONFIG } = {}) {
    const stageOk = !config.eligibleStages || config.eligibleStages.includes(stage);
    const bandOk = !config.eligibleBands || config.eligibleBands.includes(band);
    return stageOk && bandOk;
}

export function getJoinCount() {
    return _load().joins.length;
}

export function getCompleteCount() {
    return _load().completes.length;
}

/** 仅供测试使用。 */
export function _resetWeeklyChallengeForTests() {
    _state = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

export { DEFAULT_CONFIG };
