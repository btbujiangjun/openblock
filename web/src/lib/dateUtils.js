/**
 * lib/dateUtils.js — 时间 SSOT（v1.71 收敛 8 处 `_todayYmd` 重复 + 后续可继续吸收 DAY_MS 硬编码）
 *
 * 单一职责：以"玩家本地时区"为基准的日期与时长工具函数。
 *
 * 收敛动因：
 *   `_todayYmd` 历史上在 8 个模块各自定义一份（progression / playerMaturity /
 *   churnPredictor / socialIntroTrigger / firstPurchaseFunnel / vipSystem /
 *   leaderboard / dailyTasks），实现等价但样式分两派（块状 padStart vs 一行模板串）。
 *   任何一份语义微调（如改 UTC、改 ISO）都难以"同步"——典型 SSOT 漂移。
 *
 * 约定：
 *   - 全部基于设备本地时区（与各模块原实现保持一致；如未来要切 UTC，只改这一处）
 *   - 不做 RNG / 不做 IO，纯函数
 *
 * 任何模块需要"今天 YYYY-MM-DD"或"两个时间戳间天数"，**统一 import 本文件**，
 * 不再手写 _todayYmd / 24*60*60*1000。
 */

/** 一天的毫秒数（24h）。 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 当前本地日期的 YYYY-MM-DD 字符串（玩家时区）。
 *
 * @returns {string}  e.g. '2025-12-31'
 */
export function todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * 自 ts（毫秒时间戳）到现在的整天数（向下取整、非负兜底）。
 * 用于"自上次活跃 N 天"、"自首次启动 N 天"等召回/留存窗口判定。
 *
 * @param {number} ts 起点毫秒时间戳；非数或未来时间返回 0
 * @returns {number}  整天数 ≥ 0
 */
export function daysSince(ts) {
    const t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) return 0;
    return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}
