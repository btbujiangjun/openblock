/**
 * propensityCalibrator.js — 倾向打分校准（Calibration）
 *
 * v1.49.x 算法层 P0-1：
 *   解决 commercialModel 的 propensity 不是真实概率的问题。
 *
 * 当前 `iapPropensity = 0.7` 是单调评分，**不是** P(buy|x) = 70%。这意味着：
 *   - 阈值（如 iapRecommend=0.68）没有概率语义
 *   - 任何系数微调都会让分布右移，但真实购买率不变 → 系统行为漂移而看不到
 *
 * 校准做法（业界标准）：
 *   - **Isotonic Regression**（保单调，无参数）：把原始 score 分桶，每桶用样本里
 *     真实正样率作为校准后概率；适合大数据量、不假设 sigmoid 形状
 *   - **Platt Scaling**（参数化 sigmoid）：fit P(y=1|score) = σ(a·score + b)；适合
 *     小数据量；当训练样本不足以保证 isotonic 单调时退化使用
 *
 * 本模块只做"推理 + 注入"：
 *   - 离线训练管线产出 calibration 表（JSON），通过 setCalibrationTable() 热更
 *   - 推理时 calibrateScore(rawScore, taskName) 返回 [0, 1] 上的"已校准概率"
 *   - 所有 calibration 表都按 schemaVersion 标记；版本不匹配的表会被拒绝
 *
 * 训练管线（不在本模块内，留给后端 / Python 侧）：
 *   1. 拉 30 天 (snapshot, raw_propensity_X, label_y) 三元组
 *   2. 对 X ∈ {iap, rewarded, interstitial, churn} 各跑一次 isotonic
 *   3. 输出 JSON：{ schemaVersion, fittedAt, tables: { iap: {...}, ... } }
 *   4. 通过 RemoteConfig push → 前端 setCalibrationTable()
 */

export const CALIBRATION_SCHEMA_VERSION = 1;

/** @typedef {{ method: 'isotonic', bins: Array<{lo:number, hi:number, p:number}> } | { method: 'platt', a: number, b: number } | { method: 'identity' }} CalibrationTable */

/** @typedef {Record<'iap'|'rewarded'|'interstitial'|'churn'|'payer', CalibrationTable>} CalibrationBundle */

/**
 * 默认 identity 校准（线上未注入校准表时使用，等价于"不做校准"）。
 * @type {CalibrationBundle}
 */
const IDENTITY_BUNDLE = Object.freeze({
    iap:          { method: 'identity' },
    rewarded:     { method: 'identity' },
    interstitial: { method: 'identity' },
    churn:        { method: 'identity' },
    payer:        { method: 'identity' },
});

/** @type {CalibrationBundle} 当前激活的校准表（由训练管线热更）。 */
let _activeBundle = IDENTITY_BUNDLE;

/** @type {{ schemaVersion: number, fittedAt: number, source: string }|null} 元数据 */
let _meta = null;

/* ─────────────────── 推理函数 ─────────────────── */

function _clamp01(x) {
    const n = Number(x);
    if (Number.isNaN(n)) return 0;
    if (!Number.isFinite(n)) return n > 0 ? 1 : 0;
    return Math.max(0, Math.min(1, n));
}

/**
 * Isotonic 推理：在已排序 bins 上做 binary search，命中 bin 则返回 bin.p；
 * 落在两个 bin 之间则做线性插值。
 */
function _applyIsotonic(score, bins) {
    if (!Array.isArray(bins) || bins.length === 0) return score;
    const s = _clamp01(score);
    /* 二分找第一个 hi >= s 的 bin。 */
    let lo = 0, hi = bins.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bins[mid].hi < s) lo = mid + 1;
        else hi = mid;
    }
    const bin = bins[lo];
    if (s <= bin.lo) {
        /* 落入边界以左：用前一 bin 与本 bin 做线性插值（无前 bin 时返回 bin.p）。 */
        if (lo === 0) return _clamp01(bin.p);
        const prev = bins[lo - 1];
        const span = bin.lo - prev.hi;
        if (span <= 0) return _clamp01(bin.p);
        const t = (s - prev.hi) / span;
        return _clamp01(prev.p * (1 - t) + bin.p * t);
    }
    return _clamp01(bin.p);
}

/** Platt 推理：σ(a·s + b)。 */
function _applyPlatt(score, a, b) {
    const z = a * _clamp01(score) + b;
    return 1 / (1 + Math.exp(-z));
}

/** 单点校准：score → calibrated probability。 */
export function calibrateScore(rawScore, taskName) {
    const table = _activeBundle?.[taskName] ?? IDENTITY_BUNDLE[taskName];
    if (!table || table.method === 'identity') return _clamp01(rawScore);
    if (table.method === 'isotonic') return _applyIsotonic(rawScore, table.bins);
    if (table.method === 'platt') return _applyPlatt(rawScore, table.a, table.b);
    /* 未知 method 时退化为 identity，避免线上炸 */
    return _clamp01(rawScore);
}

/**
 * 批量校准：把 commercialModelVector 的 4 个 propensity 一次性校准。
 * @param {{iapPropensity?:number, rewardedAdPropensity?:number, interstitialPropensity?:number, churnRisk?:number, payerScore?:number}} vector
 * @returns {{iap:number, rewarded:number, interstitial:number, churn:number, payer:number}} calibrated probabilities
 */
export function calibratePropensityVector(vector = {}) {
    return {
        iap:          calibrateScore(vector.iapPropensity ?? 0, 'iap'),
        rewarded:     calibrateScore(vector.rewardedAdPropensity ?? 0, 'rewarded'),
        interstitial: calibrateScore(vector.interstitialPropensity ?? 0, 'interstitial'),
        churn:        calibrateScore(vector.churnRisk ?? 0, 'churn'),
        payer:        calibrateScore(vector.payerScore ?? 0, 'payer'),
    };
}

/* ─────────────────── 注入接口（训练管线 → 推理） ─────────────────── */

/**
 * 注入 calibration 表（一般在 Remote Config 拉取后调用）。
 * @param {{ schemaVersion:number, fittedAt:number, source?:string, tables: Partial<CalibrationBundle> }} payload
 * @returns {boolean} 是否生效
 */
export function setCalibrationBundle(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.schemaVersion !== CALIBRATION_SCHEMA_VERSION) {
        console.warn(`[calibration] schema mismatch: got ${payload.schemaVersion}, expected ${CALIBRATION_SCHEMA_VERSION}`);
        return false;
    }
    const tables = payload.tables ?? {};
    /* 校验 table 合法性，不合法的 task 退回 identity（不让一项坏掉就坏全表）。 */
    const merged = { ...IDENTITY_BUNDLE };
    for (const task of Object.keys(IDENTITY_BUNDLE)) {
        const t = tables[task];
        if (_isValidTable(t)) merged[task] = Object.freeze(t);
    }
    _activeBundle = Object.freeze(merged);
    _meta = {
        schemaVersion: payload.schemaVersion,
        fittedAt: Number(payload.fittedAt) || Date.now(),
        source: String(payload.source || 'unknown'),
    };
    return true;
}

function _isValidTable(t) {
    if (!t || typeof t !== 'object') return false;
    if (t.method === 'identity') return true;
    if (t.method === 'platt') return Number.isFinite(t.a) && Number.isFinite(t.b);
    if (t.method === 'isotonic') {
        return Array.isArray(t.bins) && t.bins.length > 0
            && t.bins.every((b) => Number.isFinite(b.lo) && Number.isFinite(b.hi)
                && Number.isFinite(b.p) && b.lo <= b.hi);
    }
    return false;
}

/** 元信息（UI / 日志用）。 */
export function getCalibrationMeta() {
    return _meta ? { ..._meta, isIdentity: _activeBundle === IDENTITY_BUNDLE } : { isIdentity: true };
}

/** 仅供测试 reset。 */
export function _resetCalibrationForTests() {
    _activeBundle = IDENTITY_BUNDLE;
    _meta = null;
}

/** 获取激活 bundle 的拷贝（调试 / 看板用）。 */
export function getActiveCalibrationBundle() {
    return JSON.parse(JSON.stringify(_activeBundle));
}
