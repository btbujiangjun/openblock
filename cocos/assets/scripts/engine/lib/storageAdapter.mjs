/* 自动生成 —— 请勿手改。源：web/src/lib/storageAdapter.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * lib/storageAdapter.js — localStorage SSOT（v1.71 收敛重复 try-catch 包装）
 *
 * 单一职责：把"读 JSON / 写 JSON / 删 key"三个最高频模式封装到无副作用工具函数，
 *   - 自动 try-catch（任何环境异常 → 走 fallback，绝不抛）
 *   - 自动 `typeof localStorage` 检测（cocos 运行时 / node 测试环境兜底）
 *   - 严格不引入新行为：与原"try { JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }"
 *     **逐位等价**——同样的 fallback、同样的 silent-swallow。
 *
 * 收敛动因：
 *   `JSON.parse(localStorage.getItem(KEY) || '{}')` + try-catch 模板在 18 个模块各写一份，
 *   任何一份新增"启用调试日志""容错升级"都难以"同步" — 典型 SSOT 漂移。
 *
 * 用法：
 *   import { safeReadJson, safeWriteJson, safeRemoveKey } from '../lib/storageAdapter.mjs';
 *   const state = safeReadJson(KEY, {});        // 替代 try { JSON.parse(...) || '{}' } catch
 *   safeWriteJson(KEY, state);                  // 替代 try { localStorage.setItem(KEY, JSON.stringify(state)) } catch
 *   safeRemoveKey(KEY);                         // 替代 try { localStorage.removeItem(KEY) } catch
 *
 * **行为契约**：localStorage 不可用、key 不存在、JSON 解析失败 → 返回 fallback；
 *   写入失败 → silently swallow（与原行为一致）。
 */

/** @returns {Storage | null} 当前环境的 localStorage 引用，不可用返回 null。 */
function _ls() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        // node + 严格沙箱可能抛"localStorage is not defined"
        return null;
    }
}

/**
 * 安全读取并 JSON 解析 localStorage 中的值。
 *
 * @template T
 * @param {string} key
 * @param {T} [fallback={}] key 不存在 / 解析失败 / localStorage 不可用时返回的值
 * @returns {T}
 */
export function safeReadJson(key, fallback = {}) {
    const ls = _ls();
    if (!ls) return fallback;
    try {
        const raw = ls.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

/**
 * 安全 JSON 序列化并写入 localStorage。失败 silently swallow（与历史行为一致）。
 *
 * @param {string} key
 * @param {unknown} value 任意可 JSON 序列化值
 * @returns {boolean}  true=写入成功；false=未写入（被 swallow）
 */
export function safeWriteJson(key, value) {
    const ls = _ls();
    if (!ls) return false;
    try {
        ls.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/**
 * 安全删除 localStorage 中的 key。失败 silently swallow。
 *
 * @param {string} key
 * @returns {boolean}  true=删除成功；false=未删除（被 swallow）
 */
export function safeRemoveKey(key) {
    const ls = _ls();
    if (!ls) return false;
    try {
        ls.removeItem(key);
        return true;
    } catch {
        return false;
    }
}
