import { DAY_MS } from './lib/dateUtils.js';
/**
 * bestScoreBuckets.js — v1.55 BEST_SCORE_CHASE_STRATEGY §4.4 + §4.7
 *
 * 目标：为"挑战自己最佳"这条主线策略提供两类副 PB：
 *
 *   §4.4 PB 按难度档分桶（bestByStrategy）
 *        - 同一账号下 easy / normal / hard 各维护一个独立 PB；
 *        - HUD 显示当前难度对应的 PB；
 *        - 这是客户端 cache：服务器仍保留单一全账号 PB（getBestScore），
 *          但 strategy 分桶用 localStorage 持久化（key=openblock_best_by_strategy_v1）；
 *        - localStorageStateSync 已把该 key 纳入 core section，自然走跨设备同步。
 *
 *   §4.7 周期 PB（periodBest）
 *        - 维护 weeklyBest / monthlyBest 两个滚动窗口；
 *        - 自动按日期切换：跨周/跨月时重置；
 *        - 用于事件运营（周冠军 / 月冠军）与 D3 段叙事增强。
 *
 * 设计约束：
 *   - 所有持久化操作 try/catch（小程序 / 隐私模式下 localStorage 可能不可用）；
 *   - 跨设备同步靠 localStorageStateSync 透明搬运 JSON 字符串；
 *   - 模块不依赖 DOM / fetch，纯数据层；
 *   - getPeriodKey 在 jsdom 环境下用 Date()，无副作用。
 */

const BEST_BY_STRATEGY_KEY = 'openblock_best_by_strategy_v1';
const PERIOD_BEST_KEY = 'openblock_period_best_v1';
/* v1.60.45：PB 突破时间戳 + 末次分数 —— 用于跨局保护链（次级目标 / 召回 push）。 */
const PB_BREAK_TS_KEY = 'openblock_pb_break_ts_v1';

/** 合法 strategy id（与 config.js 中 STRATEGIES 同源）。未知 id 走 'normal' 兜底。 */
const KNOWN_STRATEGIES = new Set(['easy', 'normal', 'hard']);

function _safeReadJson(key) {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        return obj && typeof obj === 'object' ? obj : null;
    } catch { return null; }
}

function _safeWriteJson(key, obj) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(key, JSON.stringify(obj));
    } catch { /* ignore quota / privacy errors */ }
}

function _normalizeStrategy(strategy) {
    return KNOWN_STRATEGIES.has(strategy) ? strategy : 'normal';
}

/* ────────────────────────────────────────────────────────────────────── */
/*  §4.4  bestByStrategy                                                  */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * 读全部分桶 PB（用于 HUD 渲染、debug 面板）。
 * @returns {{ easy:number, normal:number, hard:number }}
 */
export function getAllBestByStrategy() {
    const stored = _safeReadJson(BEST_BY_STRATEGY_KEY) || {};
    return {
        easy: Number(stored.easy) || 0,
        normal: Number(stored.normal) || 0,
        hard: Number(stored.hard) || 0,
    };
}

/**
 * 读指定难度下 PB；未知 strategy → normal 兜底。
 * @param {string} strategy
 * @returns {number}
 */
export function getBestByStrategy(strategy) {
    const all = getAllBestByStrategy();
    return all[_normalizeStrategy(strategy)] ?? 0;
}

/**
 * 提交某难度的新分数；只有当 score > 现有 PB 时才更新并持久化。
 * 返回 { updated, previousBest, newBest, delta }。
 * @param {string} strategy
 * @param {number} score
 */
export function submitScoreToBucket(strategy, score) {
    const s = _normalizeStrategy(strategy);
    const n = Number(score);
    if (!Number.isFinite(n) || n <= 0) {
        return { updated: false, previousBest: 0, newBest: 0, delta: 0 };
    }
    const all = getAllBestByStrategy();
    const previous = all[s] || 0;
    if (n <= previous) {
        return { updated: false, previousBest: previous, newBest: previous, delta: 0 };
    }
    all[s] = n;
    _safeWriteJson(BEST_BY_STRATEGY_KEY, all);
    return { updated: true, previousBest: previous, newBest: n, delta: n - previous };
}

/* ────────────────────────────────────────────────────────────────────── */
/*  §4.7  periodBest（weeklyBest / monthlyBest）                          */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} PeriodBestRecord
 * @property {number} weeklyBest    本周 PB（按 ISO week 划分）
 * @property {number} monthlyBest   本月 PB（按自然月划分）
 * @property {string} weekKey       'YYYY-Www'
 * @property {string} monthKey      'YYYY-MM'
 */

/**
 * 派生 ISO 周键 'YYYY-Www'（与 ISO 8601 周对齐：周一为一周起点）。
 * @param {Date} [now] 测试可注入
 */
export function deriveWeekKey(now = new Date()) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7; // 周一 = 0
    d.setUTCDate(d.getUTCDate() - dayNum + 3); // 跳到当前周的周四
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const weekNo = 1 + Math.round(((d - firstThursday) / DAY_MS - 3
        + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function deriveMonthKey(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 读当前 weeklyBest / monthlyBest，自动按当前日期切换窗口（跨周/月重置）。
 * 注意：getPeriodBest 不写 localStorage；只有 submitPeriodBest 才写。
 * @param {Date} [now]
 * @returns {PeriodBestRecord}
 */
export function getPeriodBest(now = new Date()) {
    const stored = _safeReadJson(PERIOD_BEST_KEY) || {};
    const wk = deriveWeekKey(now);
    const mk = deriveMonthKey(now);
    const weeklyBest = stored.weekKey === wk ? Number(stored.weeklyBest) || 0 : 0;
    const monthlyBest = stored.monthKey === mk ? Number(stored.monthlyBest) || 0 : 0;
    return { weeklyBest, monthlyBest, weekKey: wk, monthKey: mk };
}

/**
 * 提交一个分数到周期 PB；跨周 / 跨月时窗口自动重置后再比较。
 * 返回 { weeklyUpdated, monthlyUpdated, record }。
 * @param {number} score
 * @param {Date} [now]
 */
export function submitPeriodBest(score, now = new Date()) {
    const n = Number(score);
    const record = getPeriodBest(now); // 已按当前窗口归零
    if (!Number.isFinite(n) || n <= 0) {
        return { weeklyUpdated: false, monthlyUpdated: false, record };
    }
    let weeklyUpdated = false;
    let monthlyUpdated = false;
    if (n > record.weeklyBest) {
        record.weeklyBest = n;
        weeklyUpdated = true;
    }
    if (n > record.monthlyBest) {
        record.monthlyBest = n;
        monthlyUpdated = true;
    }
    if (weeklyUpdated || monthlyUpdated) {
        _safeWriteJson(PERIOD_BEST_KEY, record);
    }
    return { weeklyUpdated, monthlyUpdated, record };
}

/* ────────────────────────────────────────────────────────────────────── */
/*  v1.60.45  PB 突破跨局保护链                                            */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * **设计背景**：留存信号跨平台分析数据揭示，**突破最高分次数 r(D7)=-0.126（iOS）/
 * -0.094（Android），且随时间窗口拉长更负**。"达到高分"是爽感（r 强正），但
 * "突破历史最好"触发"成就完结感"，反而导致流失。
 *
 * v1.56 / v1.60.37 已覆盖**同局**末段救济；本模块补齐**跨局保护**：
 *   1. PB 触发后记录时间戳 + 分数（notePbBreak）
 *   2. 下一局开始时基于 PB 派生次级目标（getNextChallenges），让"达到高分"持续
 *      触发以稀释"绝对 PB"的终结效应
 *   3. PB 后 1d / 3d 智能 push 召回（daysSinceLastPbBreak 提供窗口判定）
 *
 * 数据依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §2.4 / §4.1
 */

/**
 * 记录最近一次 PB 突破事件（时间戳 + 突破分数 + 难度档）。
 * 由 game.js 在 _showNewBestCelebration / endGame submitScoreToBucket 触发后调用。
 *
 * @param {number} score 突破分数
 * @param {string} [strategy] 难度档（'easy' | 'normal' | 'hard'）
 */
export function notePbBreak(score, strategy = 'normal') {
    const n = Number(score);
    if (!Number.isFinite(n) || n <= 0) return;
    _safeWriteJson(PB_BREAK_TS_KEY, {
        ts: Date.now(),
        score: n,
        strategy: _normalizeStrategy(strategy),
    });
}

/**
 * 读最近一次 PB 突破记录。
 * @returns {{ ts: number, score: number, strategy: string } | null}
 */
export function getLastPbBreak() {
    return _safeReadJson(PB_BREAK_TS_KEY);
}

/**
 * 距上次 PB 突破的天数（供 winback push / 跨局保护链时间窗判定）。
 * @returns {number | null} null 表示从未突破
 */
export function daysSinceLastPbBreak() {
    const rec = getLastPbBreak();
    if (!rec || !rec.ts) return null;
    return (Date.now() - rec.ts) / 86_400_000;
}

/**
 * 基于当前难度 PB + 周期 PB 生成"次级目标"列表，避免玩家因"绝对 PB 已达成"
 * 而产生终结感。
 *
 * 返回值已按难度顺序：从近到远（首项是最容易够到的挑战）。
 *
 * @param {string} [strategy] 难度档，默认 'normal'
 * @param {Date} [now] 测试可注入时间
 * @returns {Array<{ id: string, kind: string, target: number, label: string }>}
 */
export function getNextChallenges(strategy = 'normal', now = new Date()) {
    const s = _normalizeStrategy(strategy);
    const pb = getBestByStrategy(s);
    const period = getPeriodBest(now);

    const challenges = [];

    /* 1. 110% PB —— 普惠次级目标 */
    if (pb > 0) {
        challenges.push({
            id: 'pb_110',
            kind: 'percent_pb',
            target: Math.round(pb * 1.1),
            label: `挑战 ${Math.round(pb * 1.1)} 分`,
        });
    }

    /* 2. 周 PB —— 时间维度的"另一种 PB" */
    if (period.weeklyBest > 0 && period.weeklyBest < pb) {
        challenges.push({
            id: 'weekly_pb',
            kind: 'period',
            target: period.weeklyBest,
            label: `本周新高（当前 ${period.weeklyBest}）`,
        });
    }

    /* 3. 月 PB */
    if (period.monthlyBest > 0 && period.monthlyBest < pb) {
        challenges.push({
            id: 'monthly_pb',
            kind: 'period',
            target: period.monthlyBest,
            label: `本月新高（当前 ${period.monthlyBest}）`,
        });
    }

    /* 4. 125% PB —— 更远目标，留给挑战欲强的玩家 */
    if (pb > 0) {
        challenges.push({
            id: 'pb_125',
            kind: 'percent_pb',
            target: Math.round(pb * 1.25),
            label: `挑战 ${Math.round(pb * 1.25)} 分`,
        });
    }

    return challenges;
}

/**
 * 测试辅助：清空所有持久化（不暴露到生产入口）。
 */
export function __resetForTests() {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem(BEST_BY_STRATEGY_KEY);
        localStorage.removeItem(PERIOD_BEST_KEY);
        localStorage.removeItem(PB_BREAK_TS_KEY);
    } catch { /* ignore */ }
}

/** 测试可见的内部 key 常量，便于断言。 */
export const __TEST_KEYS = Object.freeze({
    BEST_BY_STRATEGY_KEY,
    PERIOD_BEST_KEY,
    PB_BREAK_TS_KEY,
});
