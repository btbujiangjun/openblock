/**
 * Context 维度扩展架构 — 让未来加新维度 (device tier / player segment / region 等)
 * 不需要改 contextSpace.js 和所有下游代码。
 *
 * 设计思路:
 *   1. 维度作为「元数据」注册,不硬编码到核心 contextSpace.js
 *   2. context_key 仍保持 4 维主结构 (向后兼容),扩展维度作为后缀
 *   3. 客户端 resolveSpawnTheta 自动按 "全匹配 → 主维度匹配 → coarse" 三层退化
 *
 * 用法 (示例):
 *   import { registerContextDimension } from './contextExtension.js';
 *
 *   registerContextDimension({
 *       key: 'deviceTier',
 *       values: ['low', 'mid', 'high'],
 *       extractor: (ctx) => {
 *           const cores = navigator.hardwareConcurrency || 4;
 *           const mem = navigator.deviceMemory || 4;
 *           if (cores <= 2 || mem <= 2) return 'low';
 *           if (cores >= 8 && mem >= 8) return 'high';
 *           return 'mid';
 *       },
 *       fallback: 'mid',
 *   });
 *
 * 注册后:
 *   - makeExtendedContextKey() 自动追加 ':low' / ':mid' / ':high'
 *   - resolveSpawnTheta 优先精确匹配 4+N 维 key, 失败回退到 4 维主 key
 *   - 寻参数据规模乘以 N 倍 (N=值数量); 用户决定是否启用
 */

const _registeredDimensions = new Map();

/**
 * 注册一个 context 维度。
 *
 * @param {object} def
 * @param {string} def.key - 维度名 (e.g. 'deviceTier')
 * @param {Array<string|number>} def.values - 合法取值集合
 * @param {(ctx: object) => string|number} def.extractor - 从 playerContext 推断值
 * @param {string|number} [def.fallback] - 推断失败时的回退值
 */
export function registerContextDimension(def) {
    if (!def?.key || !Array.isArray(def?.values) || typeof def?.extractor !== 'function') {
        throw new Error('registerContextDimension: invalid definition');
    }
    if (_registeredDimensions.has(def.key)) {
        // 重复注册时静默替换 (便于热更新), 但 warn
        if (typeof console !== 'undefined') {
            console.warn(`[contextExtension] redefining dimension: ${def.key}`);
        }
    }
    _registeredDimensions.set(def.key, {
        key: def.key,
        values: Object.freeze(def.values.slice()),
        extractor: def.extractor,
        fallback: def.fallback ?? def.values[0],
    });
}

/**
 * 注销维度 (回滚到原 4 维)。
 */
export function unregisterContextDimension(key) {
    _registeredDimensions.delete(key);
}

/**
 * 获取所有已注册维度 (用于 dashboard / 调试)。
 */
export function listRegisteredDimensions() {
    return Array.from(_registeredDimensions.values()).map((d) => ({
        key: d.key,
        values: d.values.slice(),
        fallback: d.fallback,
    }));
}

/**
 * 重置所有注册 (主要用于测试)。
 */
export function _clearRegistry() {
    _registeredDimensions.clear();
}

/**
 * 把 4 维 contextKey 扩展为 4+N 维。
 *
 * @param {string} baseKey - 'normal:budget-p2:1500:growth'
 * @param {object} playerCtx - { ...各扩展维度推断需要的字段 }
 * @returns {string} 扩展 key, e.g. 'normal:budget-p2:1500:growth:mid:casual'
 */
export function extendContextKey(baseKey, playerCtx = {}) {
    if (_registeredDimensions.size === 0) return baseKey;
    const parts = [baseKey];
    for (const dim of _registeredDimensions.values()) {
        let val;
        try {
            val = dim.extractor(playerCtx);
        } catch {
            val = dim.fallback;
        }
        if (!dim.values.includes(val)) val = dim.fallback;
        parts.push(String(val));
    }
    return parts.join(':');
}

/**
 * 把扩展 key 拆出主 4 维部分 (用于退化查找)。
 */
export function stripExtendedDimensions(extendedKey) {
    const parts = String(extendedKey).split(':');
    return parts.slice(0, 4).join(':');
}

/**
 * 给 resolveSpawnTheta 用的退化查找链生成器。
 *
 * 返回数组按"精确程度降序": [全 N 维, N-1 维, ..., 主 4 维]
 *
 * @param {string} baseKey - 主 4 维 key
 * @param {object} playerCtx
 * @returns {string[]} 候选 key 数组
 */
export function generateLookupChain(baseKey, playerCtx = {}) {
    if (_registeredDimensions.size === 0) return [baseKey];
    const dims = Array.from(_registeredDimensions.values());
    const values = dims.map((d) => {
        let v;
        try { v = d.extractor(playerCtx); } catch { v = d.fallback; }
        if (!d.values.includes(v)) v = d.fallback;
        return v;
    });

    // 从全维度逐级剥离最后一个: 全→N-1→...→0
    const chain = [];
    for (let i = dims.length; i >= 1; i--) {
        chain.push([baseKey, ...values.slice(0, i)].join(':'));
    }
    chain.push(baseKey);  // 主 4 维兜底
    return chain;
}

/**
 * 获取当前空间总数 (4 维基础 × 各扩展维度数值数)。
 */
export function getExtendedSpaceSize(baseSize = 120) {
    let size = baseSize;
    for (const dim of _registeredDimensions.values()) {
        size *= dim.values.length;
    }
    return size;
}
