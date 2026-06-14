/**
 * experimentUnified.js — 统一实验入口（DA-5：双 A/B 系统合并）
 *
 * 背景：仓内存在两套 A/B —— `abTest.js`（客户端哈希分桶 + EXPERIMENTS 注册表）与
 * `experimentPlatform.js / lifecycleExperiments.js`（生命周期实验）。本模块收敛为
 * **单一事实**：
 *   - 分桶口径统一走 `abTest.getBucket`（稳定哈希）；
 *   - 注册表合并（abTest.EXPERIMENTS ∪ 传入的 lifecycle 实验）；
 *   - 尊重 DA-3 护栏暂停：实验被暂停时强制回退对照桶 0；
 *   - 上报统一走 `abTest.trackEvent`。
 */

import { getBucket, EXPERIMENTS as AB_EXPERIMENTS, trackEvent as abTrack } from '../../abTest.js';

/**
 * 解析变体（纯函数，便于测试）。
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.experiment
 * @param {Array} p.variants
 * @param {Set<string>} [p.pausedSet] 已暂停实验集合（DA-3）
 * @param {Object} [p.overrides] QA 覆写 { [experiment]: bucketIndex }
 * @returns {{ bucket:number, value:any, paused:boolean, forced:boolean }}
 */
export function resolveVariant({ userId, experiment, variants, pausedSet = new Set(), overrides = {} }) {
    const vs = Array.isArray(variants) && variants.length ? variants : [undefined];
    if (pausedSet.has(experiment)) {
        return { bucket: 0, value: vs[0], paused: true, forced: false };
    }
    if (overrides[experiment] !== undefined) {
        const idx = Math.min(Number(overrides[experiment]) || 0, vs.length - 1);
        return { bucket: idx, value: vs[idx], paused: false, forced: true };
    }
    const bucket = getBucket(userId, experiment, vs.length);
    return { bucket, value: vs[bucket], paused: false, forced: false };
}

/** 合并实验注册表（abTest 内置 ∪ 额外 lifecycle 实验）。 */
export function mergeRegistries(extra = {}) {
    return { ...AB_EXPERIMENTS, ...extra };
}

let _pausedSet = new Set();

/** 从服务端拉取已暂停实验（DA-3），缓存到内存。 */
export async function refreshPausedExperiments(apiBase = '') {
    try {
        const base = (apiBase || '').replace(/\/+$/, '');
        const res = await fetch(`${base}/api/experiment/state`);
        if (res && res.ok) {
            const arr = await res.json();
            _pausedSet = new Set((arr || []).filter((e) => e.paused).map((e) => e.experiment));
        }
    } catch { /* 离线保持旧集合 */ }
    return _pausedSet;
}

/** 运行期取变体（含暂停回退 + 上报曝光）。 */
export function getUnifiedVariant(userId, experiment, variants, { report = true } = {}) {
    const r = resolveVariant({ userId, experiment, variants, pausedSet: _pausedSet });
    if (report && !r.paused) {
        try { abTrack(userId, experiment, 'exposure', { bucket: r.bucket }); } catch { /* ignore */ }
    }
    return r;
}

/** 测试用：设置暂停集合。 */
export function __setPausedForTest(set) { _pausedSet = set instanceof Set ? set : new Set(set); }
