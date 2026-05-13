/**
 * modelQualityMonitor.js — propensity 模型质量在线监控
 *
 * v1.49.x 算法层 P0-2：
 *   定期采样 (rawPropensity, calibratedPropensity, label) 三元组，计算
 *   PR-AUC / Brier score / log-loss / hit-rate@k 等指标，提供 `getModelQualityReport()`
 *   给运营看板（/api/ops/dashboard）显示"过去 24h/7d 的模型表现"。
 *
 * 设计：
 *   - **环形缓冲**：每个 task 保留最近 N=2000 样本，过期的丢弃（O(1) 写入）
 *   - **批量计算**：metrics 不是每次写入都重算，而是 `compute()` 时遍历缓冲一次
 *   - **localStorage 持久化**：粗略持久（每 50 样本 flush 一次），避免重启丢数
 *   - **多任务**：iap / rewarded / interstitial / churn 各自独立缓冲
 *
 * 业界对照：
 *   - **Brier score**：均方误差形式的概率评分，越小越好；公式 (1/N) Σ (p - y)^2
 *   - **PR-AUC**（Precision-Recall AUC）：高度不平衡数据（IAP 转化率往往 < 5%）下
 *     比 ROC-AUC 更敏感，业界推荐
 *   - **log-loss**：-(1/N) Σ [y·log(p) + (1-y)·log(1-p)]，对极端错误惩罚最重
 *   - **hit-rate@k**：top-k 高分用户里命中正样本的比例（推荐系统常用）
 */

const STORAGE_KEY = 'openblock_model_quality_v1';
const MAX_SAMPLES_PER_TASK = 2000;
const FLUSH_EVERY_N = 50;

/** @typedef {{ raw:number, calibrated:number, label:0|1, ts:number, sampleId?:string }} QualitySample */

/** @type {Record<string, QualitySample[]>} */
let _buffers = _loadBuffers();

let _writesSinceFlush = 0;

function _loadBuffers() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                /* 防御：每个 task 截断到上限 */
                const out = {};
                for (const k of Object.keys(parsed)) {
                    if (Array.isArray(parsed[k])) {
                        out[k] = parsed[k].slice(-MAX_SAMPLES_PER_TASK);
                    }
                }
                return out;
            }
        }
    } catch { /* ignore */ }
    return {};
}

function _flush() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_buffers));
    } catch { /* quota / 隐私模式 */ }
}

/**
 * 记录一个样本（推荐 / 实际行为发生后调用）。
 *
 * @param {string} task    'iap' | 'rewarded' | 'interstitial' | 'churn'
 * @param {number} raw     原始 propensity ∈ [0, 1]
 * @param {number} calibrated  校准后概率 ∈ [0, 1]
 * @param {0|1|boolean} label  实际是否发生（true/1 = 正样本）
 * @param {object} [meta]  { sampleId, ts }
 */
export function recordSample(task, raw, calibrated, label, meta = {}) {
    if (!task) return;
    const sample = {
        raw: Math.max(0, Math.min(1, Number(raw) || 0)),
        calibrated: Math.max(0, Math.min(1, Number(calibrated) || 0)),
        label: label ? 1 : 0,
        ts: Number(meta.ts) || Date.now(),
        sampleId: meta.sampleId || undefined,
    };
    if (!_buffers[task]) _buffers[task] = [];
    _buffers[task].push(sample);
    if (_buffers[task].length > MAX_SAMPLES_PER_TASK) {
        _buffers[task] = _buffers[task].slice(-MAX_SAMPLES_PER_TASK);
    }
    _writesSinceFlush += 1;
    if (_writesSinceFlush >= FLUSH_EVERY_N) {
        _writesSinceFlush = 0;
        _flush();
    }
}

/* ─────────────────── 指标计算 ─────────────────── */

/** Brier score：均方差形式。越小越好。 */
function _brier(samples, useCalibrated) {
    if (!samples.length) return null;
    let sum = 0;
    for (const s of samples) {
        const p = useCalibrated ? s.calibrated : s.raw;
        const diff = p - s.label;
        sum += diff * diff;
    }
    return sum / samples.length;
}

/** Log-loss：-mean(y·log(p) + (1-y)·log(1-p))。越小越好。 */
function _logloss(samples, useCalibrated) {
    if (!samples.length) return null;
    const eps = 1e-7;
    let sum = 0;
    for (const s of samples) {
        const p = Math.max(eps, Math.min(1 - eps, useCalibrated ? s.calibrated : s.raw));
        sum += s.label === 1 ? -Math.log(p) : -Math.log(1 - p);
    }
    return sum / samples.length;
}

/** PR-AUC（trapezoidal）：把样本按 score 降序，逐步累计 P/R。不平衡数据敏感。 */
function _prAuc(samples, useCalibrated) {
    if (samples.length < 2) return null;
    const totalPositives = samples.reduce((acc, s) => acc + s.label, 0);
    if (totalPositives === 0) return 0;

    const sorted = [...samples].sort((a, b) => {
        const pa = useCalibrated ? a.calibrated : a.raw;
        const pb = useCalibrated ? b.calibrated : b.raw;
        return pb - pa;
    });

    let tp = 0;
    let fp = 0;
    let prevR = 0;
    let auc = 0;
    for (const s of sorted) {
        if (s.label === 1) tp += 1;
        else fp += 1;
        const precision = tp / (tp + fp);
        const recall = tp / totalPositives;
        if (recall > prevR) {
            auc += precision * (recall - prevR);
            prevR = recall;
        }
    }
    return auc;
}

/** Hit-rate@k：top-k 比例样本里的正样率。 */
function _hitRateAtK(samples, useCalibrated, k = 0.1) {
    if (samples.length === 0) return null;
    const topK = Math.max(1, Math.floor(samples.length * k));
    const sorted = [...samples].sort((a, b) => {
        const pa = useCalibrated ? a.calibrated : a.raw;
        const pb = useCalibrated ? b.calibrated : b.raw;
        return pb - pa;
    });
    const top = sorted.slice(0, topK);
    const positives = top.reduce((acc, s) => acc + s.label, 0);
    return positives / topK;
}

/**
 * 当前时刻该 task 的质量指标。
 *
 * @param {string} task
 * @param {Object} [opts] { sinceMs: 24h 默认；useCalibrated: 默认 true（生产推理基准） }
 * @returns {{ task, n, positiveRate, brier, logloss, prAuc, hitAt10, raw:{brier,logloss,prAuc,hitAt10} }|null}
 */
export function getTaskQuality(task, opts = {}) {
    const sinceMs = Number(opts.sinceMs) || 24 * 3600 * 1000;
    const cutoff = Date.now() - sinceMs;
    const all = _buffers[task] || [];
    const samples = all.filter((s) => s.ts >= cutoff);
    if (samples.length === 0) return null;

    const positives = samples.reduce((acc, s) => acc + s.label, 0);
    return {
        task,
        n: samples.length,
        positiveRate: positives / samples.length,
        brier:    _brier(samples, true),
        logloss:  _logloss(samples, true),
        prAuc:    _prAuc(samples, true),
        hitAt10:  _hitRateAtK(samples, true, 0.1),
        /* 同时报"未校准"指标，便于对照校准是否真的有提升 */
        raw: {
            brier:   _brier(samples, false),
            logloss: _logloss(samples, false),
            prAuc:   _prAuc(samples, false),
            hitAt10: _hitRateAtK(samples, false, 0.1),
        },
    };
}

/** 全 task 报告（看板入口）。 */
export function getModelQualityReport(opts = {}) {
    const tasks = Object.keys(_buffers);
    const now = Date.now();
    return {
        ts: now,
        sinceMs: Number(opts.sinceMs) || 24 * 3600 * 1000,
        tasks: tasks.map((t) => getTaskQuality(t, opts)).filter(Boolean),
    };
}

/** 仅供测试 reset。 */
export function _resetModelQualityForTests() {
    _buffers = {};
    _writesSinceFlush = 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** 主动 flush（暴露给页面卸载钩子）。 */
export function flushModelQuality() {
    _flush();
    _writesSinceFlush = 0;
}

export const _QUALITY_INTERNALS = { MAX_SAMPLES_PER_TASK, FLUSH_EVERY_N };
