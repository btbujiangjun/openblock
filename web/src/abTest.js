/**
 * A/B 测试框架（轻量、无后端依赖）
 *
 * 设计原则
 * --------
 * - 按 userId × 实验名 做哈希分桶，同一用户在同一实验中永远分到同一桶
 * - 不依赖后端，分桶在客户端确定；实验数据上报到 /api/ab/report（可选）
 * - 新增实验不影响已有实验的分桶结果
 *
 * 使用方式
 * --------
 *   import { getVariant, trackEvent } from './abTest.js';
 *
 *   // 获取实验变体
 *   const delay = getVariant(userId, 'interstitial_delay', [3000, 0]);
 *   // → 用户稳定分到 3000 或 0
 *
 *   // 上报转化事件
 *   trackEvent(userId, 'interstitial_delay', 'ad_watched');
 *
 * 内置实验
 * --------
 *   interstitial_delay    插屏延迟（0ms vs 3000ms）
 *   rewarded_threshold    激励视频挫败阈值（3次 vs 5次）
 *   iap_starter_price     新手礼包价格（¥3 vs ¥6）
 *   revive_countdown      复活倒计时（4s vs 8s）
 *   minigoal_difficulty   小目标难度系数（0.8 vs 1.0）
 */

const AB_SALT = 'openblock_ab_v1';
const STORAGE_KEY = 'openblock_ab_overrides';
const REPORT_ENDPOINT = '/api/ab/report';

// ── 实验注册表 ────────────────────────────────────────────────────────────────
export const EXPERIMENTS = {
    /** 插屏广告延迟时间：0ms（立即）vs 3000ms（稍后） */
    interstitial_delay: {
        variants: [3000, 0],
        description: '插屏广告延迟展示时间（ms）',
    },
    /** 激励视频触发挫败连续未消行阈值 */
    rewarded_threshold: {
        variants: [5, 3],
        description: '连续未消行触发激励视频的次数阈值',
    },
    /** 新手礼包价格展示 */
    iap_starter_price: {
        variants: ['¥3', '¥6'],
        priceNums: [3, 6],
        description: '新手礼包价格档位',
    },
    /** 复活倒计时 */
    revive_countdown: {
        variants: [4, 8],
        description: '复活弹层自动跳过倒计时（秒）',
    },
    /** 小目标难度系数（实际 target × coeff） */
    minigoal_difficulty: {
        variants: [0.8, 1.0],
        description: '小目标目标值系数（降低难度 vs 原始难度）',
    },
};

// ── 核心算法 ──────────────────────────────────────────────────────────────────

/**
 * 稳定哈希分桶
 * @param {string} userId
 * @param {string} experiment
 * @param {number} buckets
 * @returns {number} 0 ~ buckets-1
 */
export function getBucket(userId, experiment, buckets = 2) {
    const key = `${AB_SALT}:${experiment}:${userId}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    }
    return hash % buckets;
}

/**
 * 获取实验变体值
 * @template T
 * @param {string} userId
 * @param {string} experiment  实验名（见 EXPERIMENTS）
 * @param {T[]} variants       各桶的参数值
 * @returns {T}
 */
export function getVariant(userId, experiment, variants) {
    // 运营覆写（用于 QA 强制指定某桶）
    const overrides = _loadOverrides();
    if (overrides[experiment] !== undefined) {
        const idx = Number(overrides[experiment]);
        return variants[Math.min(idx, variants.length - 1)];
    }
    const bucket = getBucket(userId, experiment, variants.length);
    return variants[bucket];
}

/**
 * 获取内置实验的变体（自动读取 EXPERIMENTS 定义）
 * @param {string} userId
 * @param {string} experiment
 * @returns {*}
 */
export function getBuiltinVariant(userId, experiment) {
    const exp = EXPERIMENTS[experiment];
    if (!exp) return undefined;
    return getVariant(userId, experiment, exp.variants);
}

// ── 事件上报 ──────────────────────────────────────────────────────────────────

/**
 * 上报实验转化事件（异步，失败静默）
 * @param {string} userId
 * @param {string} experiment
 * @param {string} event       事件名（如 'ad_watched', 'iap_purchased'）
 * @param {object} [meta]      附加数据
 */
export function trackEvent(userId, experiment, event, meta = {}) {
    const bucket = getBucket(userId, experiment, EXPERIMENTS[experiment]?.variants?.length ?? 2);
    const payload = {
        userId, experiment, bucket, event,
        ts: Date.now(),
        ...meta,
    };
    // 异步上报，不阻塞主流程
    fetch(REPORT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).catch(() => { /* 离线时静默 */ });
}

// ── 运营覆写（QA 工具） ────────────────────────────────────────────────────────

function _loadOverrides() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

/**
 * 强制覆写某实验的桶（0 = 对照组，1 = 实验组……）
 * 用于 QA 验证特定变体体验。
 * @param {string} experiment
 * @param {number} bucket
 */
export function forceVariant(experiment, bucket) {
    const overrides = _loadOverrides();
    overrides[experiment] = bucket;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch { /* ignore */ }
}

/** 清除所有覆写，恢复哈希分桶 */
export function clearOverrides() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** 获取当前所有实验的分桶信息（调试用） */
export function debugReport(userId) {
    const overrides = _loadOverrides();
    return Object.entries(EXPERIMENTS).map(([name, exp]) => {
        const bucket = getBucket(userId, name, exp.variants.length);
        const override = overrides[name];
        return {
            experiment: name,
            bucket: override !== undefined ? Number(override) : bucket,
            forced: override !== undefined,
            value: exp.variants[override !== undefined ? Number(override) : bucket],
            description: exp.description,
        };
    });
}
