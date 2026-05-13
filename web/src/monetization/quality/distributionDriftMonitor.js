/**
 * distributionDriftMonitor.js — 训练 vs 线上特征分布漂移监控
 *
 * v1.49.x 算法层 P2-3：
 *   离线训练时建模假设的特征分布会随时间漂移（新版本上线 / 节日活动 / 投放策略
 *   变化）。如果不监控，模型用着用着就"过期"——AUC 还看着可以但是关键 segment
 *   的预测值已经偏离真实分布。
 *
 * 本模块实现：
 *
 *   1. **训练分布快照**：训练完成时，把每个特征的 P(X)（用 KDE / 直方图）固化为
 *      base distribution，存为 JSON：
 *        { schemaVersion, fittedAt, bins: { feature_i: {edges:[], probs:[]} } }
 *   2. **线上分布累积**：每次 buildCommercialFeatureSnapshot() 调用后异步 record，
 *      内存里维护"当天线上每个特征的直方图"
 *   3. **KL divergence 计算**：getDriftReport() 输出每个特征的 KL(p_live || p_train)，
 *      KL > 0.10 时建议触发重训练；KL > 0.25 时强烈建议下线模型
 *
 * KL 公式：
 *   KL(p || q) = Σ_i p(i) · log(p(i) / q(i))
 *   （加 1e-7 平滑防止 log(0)）
 *
 * 注：
 *   - 这是观测层，**不直接干预决策**；只在看板上展示，运营 / 算法看到后决定是否
 *     回滚 / 重训练
 *   - 维护成本低：直方图固定 10 bins，每个特征 O(1) 写入 + O(10) 读取
 */

import { FEATURE_SCHEMA, FEATURE_SCHEMA_SIZE } from '../commercialFeatureSnapshot.js';

export const DRIFT_SCHEMA_VERSION = 1;
const HIST_BINS = 10;
const MAX_LIVE_SAMPLES_PER_FEATURE = 5000;
const STORAGE_KEY = 'openblock_drift_live_v1';

/** @typedef {{ edges: number[], probs: number[] }} Histogram */
/** @typedef {{ schemaVersion:number, fittedAt:number, bins: Record<string, Histogram> }} TrainingDistributionPayload */

/** 训练分布（snapshot 注入）。默认是均匀分布，意思"没有训练分布注入，drift 必然为 0"。 */
let _trainBins = null;
let _trainMeta = { isDefault: true };

/** 线上累积：feature → counts[HIST_BINS]。 */
const _liveCounts = new Map();
let _liveTotalSamples = 0;

/* ─────────────────── 持久化 ─────────────────── */

function _loadLive() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj?.day === _todayKey() && obj?.counts) {
                Object.entries(obj.counts).forEach(([k, arr]) => {
                    if (Array.isArray(arr) && arr.length === HIST_BINS) {
                        _liveCounts.set(k, arr.slice());
                    }
                });
                _liveTotalSamples = Number(obj.total) || 0;
            }
        }
    } catch { /* ignore */ }
}

function _saveLive() {
    try {
        const counts = {};
        _liveCounts.forEach((v, k) => { counts[k] = v; });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            day: _todayKey(),
            total: _liveTotalSamples,
            counts,
        }));
    } catch { /* ignore */ }
}

function _todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

_loadLive();

/* ─────────────────── 写入 ─────────────────── */

let _writesSinceFlush = 0;

/** 把一个 snapshot.vector 累积到线上直方图（固定 10 bins，定义域 [0, 1]）。 */
export function recordSnapshotForDrift(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.vector)) return;
    if (_liveTotalSamples >= MAX_LIVE_SAMPLES_PER_FEATURE * FEATURE_SCHEMA_SIZE) {
        /* 保护：超过 5000×schema 总样本就不再 record，避免无限增长 */
        return;
    }
    for (let i = 0; i < FEATURE_SCHEMA.length; i++) {
        const key = FEATURE_SCHEMA[i].key;
        const v = Math.max(0, Math.min(1, Number(snapshot.vector[i]) || 0));
        const bin = Math.min(HIST_BINS - 1, Math.floor(v * HIST_BINS));
        let arr = _liveCounts.get(key);
        if (!arr) {
            arr = new Array(HIST_BINS).fill(0);
            _liveCounts.set(key, arr);
        }
        arr[bin] += 1;
    }
    _liveTotalSamples += 1;
    _writesSinceFlush += 1;
    if (_writesSinceFlush >= 50) {
        _writesSinceFlush = 0;
        _saveLive();
    }
}

/* ─────────────────── KL ─────────────────── */

function _toProbs(counts) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total <= 0) return new Array(counts.length).fill(1 / counts.length);
    return counts.map((c) => c / total);
}

function _klDivergence(p, q) {
    const eps = 1e-7;
    let kl = 0;
    for (let i = 0; i < p.length; i++) {
        const pi = p[i] + eps;
        const qi = q[i] + eps;
        kl += pi * Math.log(pi / qi);
    }
    return Math.max(0, kl);
}

function _driftLevel(kl) {
    if (kl > 0.25) return 'critical';
    if (kl > 0.10) return 'high';
    if (kl > 0.05) return 'medium';
    return 'stable';
}

/**
 * 训练 vs 线上的特征级 KL 报告。
 *
 * @returns {{ ts:number, totalSamples:number, perFeature: Array<{key, kl, level}>, hasTrainBaseline:boolean }}
 */
export function getDriftReport() {
    const perFeature = [];
    for (const spec of FEATURE_SCHEMA) {
        const liveArr = _liveCounts.get(spec.key) || new Array(HIST_BINS).fill(0);
        const live = _toProbs(liveArr);
        const train = _trainBins?.[spec.key]?.probs || new Array(HIST_BINS).fill(1 / HIST_BINS);
        const kl = _klDivergence(live, train);
        perFeature.push({ key: spec.key, kl, level: _driftLevel(kl) });
    }
    perFeature.sort((a, b) => b.kl - a.kl);
    return {
        ts: Date.now(),
        totalSamples: _liveTotalSamples,
        perFeature,
        hasTrainBaseline: !_trainMeta.isDefault,
    };
}

/* ─────────────────── 训练分布注入 ─────────────────── */

export function setTrainingDistribution(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.schemaVersion !== DRIFT_SCHEMA_VERSION) {
        console.warn(`[drift] schema mismatch: got ${payload.schemaVersion}, expected ${DRIFT_SCHEMA_VERSION}`);
        return false;
    }
    if (!payload.bins || typeof payload.bins !== 'object') return false;
    const out = {};
    for (const k of Object.keys(payload.bins)) {
        const h = payload.bins[k];
        if (!Array.isArray(h?.probs) || h.probs.length !== HIST_BINS) continue;
        if (!h.probs.every(Number.isFinite)) continue;
        const sum = h.probs.reduce((a, b) => a + b, 0);
        if (sum <= 0) continue;
        out[k] = { edges: h.edges, probs: h.probs.map((p) => p / sum) };
    }
    _trainBins = out;
    _trainMeta = { isDefault: false, fittedAt: Number(payload.fittedAt) || Date.now() };
    return true;
}

export function getDriftMeta() { return { ..._trainMeta, totalSamples: _liveTotalSamples }; }

export function flushDrift() { _saveLive(); _writesSinceFlush = 0; }

/** 仅供测试。 */
export function _resetDriftForTests() {
    _trainBins = null;
    _trainMeta = { isDefault: true };
    _liveCounts.clear();
    _liveTotalSamples = 0;
    _writesSinceFlush = 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export const _DRIFT_INTERNALS = { HIST_BINS, MAX_LIVE_SAMPLES_PER_FEATURE };
