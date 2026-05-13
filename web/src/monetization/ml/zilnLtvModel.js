/**
 * zilnLtvModel.js — Zero-Inflated Lognormal LTV 推理
 *
 * v1.49.x 算法层 P2-1：
 *   把 ltvPredictor.js 当前的"渠道×分群乘法系数"模型升级为业界标准的
 *   Zero-Inflated Lognormal（ZILN）。ZILN 在游戏 LTV 建模上是 Google Ads /
 *   Facebook AAA 等公开 paper 与 industry tutorial 的默认选择，原因：
 *
 *     1. **零充膨胀**：免费用户占 95%+，普通分布会把均值拉到 0 附近无意义
 *     2. **重尾**：付费用户消费金额近似 lognormal（Pareto 80/20）
 *     3. **可分解**：log-likelihood = BCE(zero head) + LL(amount head | non-zero)
 *
 * 推理形式：
 *
 *     E[LTV30 | x] = (1 - p_zero(x)) · exp(μ(x) + σ²(x) / 2)
 *     Var[LTV30 | x] = (1 - p_zero(x)) · exp(2μ + σ²)·(exp(σ²) - 1)
 *                    + p_zero(x)·(1 - p_zero(x))·exp(μ + σ²/2)²
 *
 *     其中 p_zero, μ, σ 都是特征 x 的函数（线下用 ZILN loss 学出来）。
 *
 * 本模块只做"推理 + 注入"：训练管线（Python / sklearn / pytorch）产出参数 JSON：
 *
 *   {
 *     schemaVersion, fittedAt,
 *     zeroHead: { w: number[], b: number },     // logistic for p_zero
 *     muHead:   { w: number[], b: number },     // linear for log-mean
 *     sigma:    number,                          // 全局共享方差（业界常用 fixed σ）
 *   }
 */

export const ZILN_SCHEMA_VERSION = 1;

/** @typedef {{ schemaVersion:number, fittedAt?:number, source?:string, zeroHead:{w:number[], b:number}, muHead:{w:number[], b:number}, sigma:number }} ZilnParams */

/** 默认参数：所有用户 70% 概率不充值，付费用户均值 ≈ exp(0.5 + 0.32) ≈ 2.27 元，与 BASE_LTV_A.ltv30 相近。 */
function _defaultParams(featureDim) {
    return {
        schemaVersion: ZILN_SCHEMA_VERSION,
        zeroHead: { w: new Array(featureDim).fill(0), b: 1.0 },     // σ(1.0) ≈ 0.73 → p_zero
        muHead:   { w: new Array(featureDim).fill(0), b: 0.5 },     // μ ≈ 0.5
        sigma: 0.8,
    };
}

let _params = _defaultParams(0);
let _meta = { isDefault: true };

function _sigmoid(x) {
    if (x >= 50) return 1;
    if (x <= -50) return 0;
    return 1 / (1 + Math.exp(-x));
}

function _dot(w, x) {
    const len = Math.min(w?.length || 0, x?.length || 0);
    let s = 0;
    for (let i = 0; i < len; i++) s += w[i] * x[i];
    return s;
}

/**
 * 推理一个用户的 ZILN-LTV。
 *
 * @param {number[]|Float32Array} features  来自 buildCommercialFeatureSnapshot.vector
 * @returns {{ pZero:number, mu:number, sigma:number, ltv30Mean:number, ltv30P50:number, ltv30P90:number, hasFitted:boolean }}
 */
export function predictZilnLtv(features) {
    const x = Array.isArray(features) ? features : Array.from(features || []);
    const params = _params.zeroHead.w.length === x.length ? _params : _defaultParams(x.length);
    const pZero = _sigmoid(_dot(params.zeroHead.w, x) + params.zeroHead.b);
    const mu = _dot(params.muHead.w, x) + params.muHead.b;
    const sigma = Math.max(0, params.sigma);

    /* E[LTV] = (1 - pZero) · exp(μ + σ²/2)  -- 标准 lognormal mean。 */
    const expectedAmount = Math.exp(mu + (sigma * sigma) / 2);
    const ltv30Mean = (1 - pZero) * expectedAmount;

    /* P50, P90（中位数 / 90% 分位数；条件于 non-zero）。 */
    const ltv30P50 = (1 - pZero) > 0.5 ? Math.exp(mu) : 0;
    const ltv30P90 = Math.exp(mu + 1.2816 * sigma);

    return {
        pZero,
        mu,
        sigma,
        ltv30Mean,
        ltv30P50,
        ltv30P90,
        hasFitted: !_meta.isDefault,
    };
}

/** 把 ZILN 输出转成与 ltvPredictor.getLTVEstimate 相同 shape 的对象（便于 drop-in）。 */
export function toLegacyLtvShape(features, attribution) {
    const z = predictZilnLtv(features);
    const channel = String(attribution?.channel || 'unknown');
    const conf = z.hasFitted ? 'high' : (z.ltv30Mean > 1 ? 'medium' : 'low');
    return {
        ltv30: z.ltv30Mean,
        ltv60: z.ltv30Mean * 1.6,
        ltv90: z.ltv30Mean * 2.1,
        confidence: conf,
        channel,
        bidRecommendation: Math.max(0.5, z.ltv30Mean * 0.7),
        zilnDetail: z,
    };
}

/* ─────────────────── 注入接口 ─────────────────── */

export function setZilnParams(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.schemaVersion !== ZILN_SCHEMA_VERSION) {
        console.warn(`[ziln] schema mismatch: got ${payload.schemaVersion}, expected ${ZILN_SCHEMA_VERSION}`);
        return false;
    }
    if (!payload.zeroHead || !payload.muHead || !Number.isFinite(payload.sigma)) return false;
    if (!Array.isArray(payload.zeroHead.w) || !Number.isFinite(payload.zeroHead.b)) return false;
    if (!Array.isArray(payload.muHead.w) || !Number.isFinite(payload.muHead.b)) return false;
    if (payload.zeroHead.w.length !== payload.muHead.w.length) return false;
    if (!payload.zeroHead.w.every(Number.isFinite) || !payload.muHead.w.every(Number.isFinite)) return false;
    _params = {
        schemaVersion: ZILN_SCHEMA_VERSION,
        zeroHead: { w: payload.zeroHead.w.slice(), b: Number(payload.zeroHead.b) },
        muHead:   { w: payload.muHead.w.slice(),   b: Number(payload.muHead.b) },
        sigma: Math.max(0, Number(payload.sigma)),
        fittedAt: Number(payload.fittedAt) || Date.now(),
        source: String(payload.source || 'unknown'),
    };
    _meta = { isDefault: false, fittedAt: _params.fittedAt, source: _params.source };
    return true;
}

export function getZilnMeta() { return { ..._meta }; }

/** 仅供测试 reset。 */
export function _resetZilnForTests() {
    _params = _defaultParams(0);
    _meta = { isDefault: true };
}
