/**
 * dailyChallengePlaybook.js — v1.60.45
 *
 * **Android / 微信小程序"每日高分挑战"任务系统**：利用 Android 上"达到高分次数"
 * 强 r(D7)=0.276 + 弱区分度 21% 的频次激励特征（普遍可达、越多越好），把高分
 * 达成做成日常 task，转化为留存抓手。
 *
 * **数据依据**：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.7 + §留存优化快赢清单
 *
 * **设计契约**
 *   - **仅 Android / 微信小程序启用**（isEnabled() 检查 platformProfile）；
 *     iOS / web 在 task 入口处直接 noop，避免稀释 iOS 稀缺爽感模型
 *   - 高分阈值 = 玩家个人历史中位数 × 0.95（避免新手过高门槛）
 *   - 每日 3 次达成解锁组合奖励：金币 200 / 皮肤试用 1 / 复活机会 +1
 *   - 累计 7 天解锁周礼包（一次性奖励）
 *   - 跨日 / 跨周自动重置——基于本地日期与 ISO 周判定
 *
 * **持久化**：localStorage 单 key `openblock_daily_challenge_v1`；
 *   小程序 / 隐私模式下读写失败 → 返回内存态（不抛错）
 *
 * **集成位置**：
 *   - game.js 玩家达到个人 P50 分数时 → noteHighScore() 触发；返回的 reward 由
 *     业务层 dispatch（皮肤试用 / 复活配额加成）
 *   - 设置面板 / 任务面板 → getProgress() 读取展示进度
 *
 * @file
 */

import { isAndroidLike } from '../config/platformProfile.js';
import { safeWriteJson } from '../lib/storageAdapter.js';

const STORAGE_KEY = 'openblock_daily_challenge_v1';

/** 每日达成目标次数（满足后触发日奖励） */
export const DAILY_TARGET = 3;
/** 累计 7 天 = 21 次（满足后触发周奖励，仅一次） */
export const WEEKLY_TARGET = 21;

/* ────────────────────────────────────────────────────────────────────── */
/*  内部工具                                                              */
/* ────────────────────────────────────────────────────────────────────── */

function _today(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

function _safeReadState() {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        return obj && typeof obj === 'object' ? obj : null;
    } catch { return null; }
}

function _safeWriteState(state) {
    if (typeof localStorage === 'undefined') return;
    safeWriteJson(STORAGE_KEY, state);
}

function _defaultState(today) {
    return {
        date: today,
        count: 0,
        weekStart: today,
        weekCount: 0,
        dailyClaimedAt: null,
        weeklyClaimedAt: null,
    };
}

/**
 * 跨日 / 跨周自动重置：返回经过日期切片后的 state。
 * 不写入 localStorage（由调用方决定是否持久化）。
 */
function _withRolloverApplied(state, now = new Date()) {
    const today = _today(now);
    let s = state ? { ...state } : _defaultState(today);

    /* 跨日：重置 count + dailyClaimedAt */
    if (s.date !== today) {
        s.date = today;
        s.count = 0;
        s.dailyClaimedAt = null;
    }
    /* 跨周（7 天）：重置 weekStart + weekCount + weeklyClaimedAt */
    const ws = s.weekStart ? new Date(s.weekStart).getTime() : 0;
    const weekAgeDays = ws > 0 ? (now.getTime() - ws) / 86_400_000 : Infinity;
    if (weekAgeDays >= 7) {
        s.weekStart = today;
        s.weekCount = 0;
        s.weeklyClaimedAt = null;
    }
    return s;
}

/* ────────────────────────────────────────────────────────────────────── */
/*  公开 API                                                              */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * 仅 Android / 微信小程序启用。iOS / web 调用所有 API 都 noop（返回 null / 空对象）。
 * @returns {boolean}
 */
export function isEnabled() {
    return isAndroidLike();
}

/**
 * 高分事件触发；返回 { dailyDone, weeklyDone, reward, weeklyReward, progress }
 * - 平台不启用时返回 null
 * - reward / weeklyReward 仅在该次触发首次达标时非空（已达标后续触发不发奖）
 *
 * @param {Date} [now] 测试可注入
 * @returns {null | {
 *   dailyDone: boolean,
 *   weeklyDone: boolean,
 *   reward: ({ coins: number, skinTrial: number, reviveBonus: number } | null),
 *   weeklyReward: ({ coins: number, skinUnlock: number } | null),
 *   progress: { daily: { count: number, target: number }, weekly: { count: number, target: number } }
 * }}
 */
export function noteHighScore(now = new Date()) {
    if (!isEnabled()) return null;

    const raw = _safeReadState();
    let state = _withRolloverApplied(raw, now);

    const previousDaily = state.count;
    const previousWeekly = state.weekCount;
    state.count++;
    state.weekCount++;

    /* 仅在"本次触发首次达标"才发奖；已发过的不重复发 */
    const dailyJustReached = previousDaily < DAILY_TARGET && state.count >= DAILY_TARGET
        && !state.dailyClaimedAt;
    const weeklyJustReached = previousWeekly < WEEKLY_TARGET && state.weekCount >= WEEKLY_TARGET
        && !state.weeklyClaimedAt;

    let reward = null;
    let weeklyReward = null;
    if (dailyJustReached) {
        reward = { coins: 200, skinTrial: 1, reviveBonus: 1 };
        state.dailyClaimedAt = now.getTime();
    }
    if (weeklyJustReached) {
        weeklyReward = { coins: 2000, skinUnlock: 1 };
        state.weeklyClaimedAt = now.getTime();
    }

    _safeWriteState(state);

    return {
        dailyDone: state.count >= DAILY_TARGET,
        weeklyDone: state.weekCount >= WEEKLY_TARGET,
        reward,
        weeklyReward,
        progress: {
            daily: { count: state.count, target: DAILY_TARGET },
            weekly: { count: state.weekCount, target: WEEKLY_TARGET },
        },
    };
}

/**
 * 读当前进度（用于 UI / 任务面板展示，不修改 state）。
 * 平台不启用时返回 null。
 *
 * @param {Date} [now]
 * @returns {null | { daily: { count: number, target: number }, weekly: { count: number, target: number }, dailyDone: boolean, weeklyDone: boolean }}
 */
export function getProgress(now = new Date()) {
    if (!isEnabled()) return null;
    const state = _withRolloverApplied(_safeReadState(), now);
    /* 注：getProgress 不写 state（rollover 不强制持久化），避免读操作引起写操作 */
    return {
        daily:  { count: state.count,     target: DAILY_TARGET },
        weekly: { count: state.weekCount, target: WEEKLY_TARGET },
        dailyDone:  state.count >= DAILY_TARGET,
        weeklyDone: state.weekCount >= WEEKLY_TARGET,
    };
}

/**
 * 计算"高分阈值"= 个人历史中位数 × multiplier（默认 0.95，略低于中位数让任务可达）。
 * 历史中位数应从 playerProfile.sessionHistory 取——为避免循环依赖，本函数接受
 * 调用方传入的数组。
 *
 * @param {number[]} sessionScores 玩家历史 session 得分数组
 * @param {number} [multiplier=0.95]
 * @returns {number} 阈值（≤0 表示历史不足，调用方应跳过）
 */
export function computeHighScoreThreshold(sessionScores, multiplier = 0.95) {
    if (!Array.isArray(sessionScores) || sessionScores.length < 3) return 0;
    const sorted = sessionScores
        .filter(s => Number.isFinite(s) && s > 0)
        .slice()
        .sort((a, b) => a - b);
    if (sorted.length < 3) return 0;
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    return Math.round(median * multiplier);
}

/**
 * 测试辅助：清空持久化（不暴露到生产入口）。
 */
export function __resetForTests() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** 测试可见的内部常量。 */
export const __TEST_KEYS = Object.freeze({ STORAGE_KEY });
