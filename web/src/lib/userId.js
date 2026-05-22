/**
 * lib/userId.js — 全局唯一的 `bb_user_id` 生成与读取（v1.61.17）
 *
 * 抽取自 database.js / checkinSync.js / localStorageStateSync.js / visitTracker.js
 * 四处重复实现。统一格式：
 *
 *     `u${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
 *
 * 向后兼容：localStorage 中已存在的 ID（无论 substr(2,9) 或 slice(2,11)
 * 生成的）直接读出沿用，永不重写。新装机时按统一格式生成。
 */

const KEY = 'bb_user_id';

/** 读取 user id；首次访问时生成并持久化 */
export function getUserId() {
    try {
        let id = localStorage.getItem(KEY);
        if (id) return id;
        id = `u${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        localStorage.setItem(KEY, id);
        return id;
    } catch {
        /* localStorage 不可用（隐私模式 / SSR）→ 退化为内存生成 */
        return `u${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }
}

/** 仅读取，不生成。供测试 / 调试面板使用。 */
export function peekUserId() {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
