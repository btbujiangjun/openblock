/**
 * lib/userBucketing.js — A/B 灰度分桶 helper（v1.71 BB4）
 *
 * 目标：把"按 userId hash 分 0-99 桶 + 配置阈值开关 feature"这一通用模式
 * 抽成单一来源，让 AA5 dynamic leafCap / 后续 feature flag 都按统一契约接入。
 *
 * 设计原则：
 *   - 纯函数：同 (userId, salt) 永远同 bucket（跨设备一致 / 跨会话一致）
 *   - 0 依赖：xfnv1a 32bit hash，无 crypto / 无 wx API（三端通用）
 *   - 显式 salt：每个 feature 用独立 salt，避免不同 feature 用同一 userId 高度相关
 *   - 安全默认：userId 为空 / 配置缺失 → 不启用（默认关）
 *
 * 用法：
 *
 *   const { resolveRolloutFeature } = require('./lib/userBucketing');
 *
 *   // game_rules.json:
 *   //  "rollout": {
 *   //    "dynamicLeafCap": { "enabled": true, "percent": 5, "salt": "dyn-cap-v1" }
 *   //  }
 *   const on = resolveRolloutFeature(userId, GAME_RULES.rollout?.dynamicLeafCap);
 *   if (on) cfg.dynamicLeafCap = true;
 *
 * 不做的事：
 *   - 不存储桶号（无 cookie）。每次按 userId 实时计算（O(len(userId)) 极低）
 *   - 不支持复杂 segment（如"高消费用户灰度 50%"）—— 那是 experimentation 层职责
 */

/**
 * xfnv1a 32-bit hash —— 比 djb2/fnv1a 分布更均匀，适合"按 % 100 取桶"。
 * 参考：https://github.com/bryc/code/blob/master/jshash/PRNGs.md#splitmix32
 *
 * @param {string} str
 * @returns {number} 0..2^32-1（uint32）
 */
function xfnv1aHash(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * 按 userId + salt 把用户分到 0-99 桶。
 *
 * @param {string} userId  非空字符串；空字符串返回 -1（外部需处理）
 * @param {string} [salt]  feature 隔离 salt；同一 userId 不同 feature 应给独立桶
 * @returns {number} 0..99 或 -1（无效）
 */
function getUserBucket(userId, salt = '') {
    if (typeof userId !== 'string' || userId.length === 0) return -1;
    const h = xfnv1aHash(`${userId}|${String(salt)}`);
    return h % 100;
}

/**
 * 解析一个 rollout 配置对象 → 是否对当前 userId 启用。
 *
 * config shape：
 *   { enabled: boolean, percent: number 0-100, salt: string }
 *
 * 语义：
 *   - enabled=false → 永远 false（无视 percent）
 *   - percent ≥ 100 → 永远 true（无视 bucket）
 *   - percent ≤ 0   → 永远 false
 *   - userId 无效   → false（安全默认）
 *   - 其他 → bucket < percent
 *
 * @param {string} userId
 * @param {{ enabled?: boolean, percent?: number, salt?: string } | null | undefined} config
 * @returns {boolean}
 */
function resolveRolloutFeature(userId, config) {
    if (!config || typeof config !== 'object') return false;
    if (config.enabled === false) return false;
    const p = Number(config.percent);
    if (!Number.isFinite(p) || p <= 0) return false;
    if (p >= 100) return true;
    const bucket = getUserBucket(userId, config.salt || '');
    if (bucket < 0) return false;
    return bucket < p;
}

/**
 * 显式获取用户在某 feature 上的桶号 —— 用于日志 / 上报，
 * 方便服务端按桶聚合 KPI（对照组 vs 实验组）。
 *
 * @param {string} userId
 * @param {string} [salt]
 * @returns {number}
 */
function getFeatureBucket(userId, salt = '') {
    return getUserBucket(userId, salt);
}

module.exports = { getFeatureBucket, getUserBucket, resolveRolloutFeature, xfnv1aHash };
