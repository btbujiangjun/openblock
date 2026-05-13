/**
 * priceElasticityModel.js — 价格弹性 / Demand curve 推理（DML scaffolding）
 *
 * v1.49.x 算法层 P2-2：
 *   把 paymentManager.DYNAMIC_PRICING_MATRIX 的"经验查表"升级为可注入的 *demand
 *   curve* 模型。线下用 DML（Double Machine Learning）从历史 (price, buy) 对中
 *   反事实识别出 ATE（Average Treatment Effect of price），输出形式：
 *
 *     P(buy | x, discount) = σ( w_x · x + α · discount + β · discount² + b )
 *
 *   其中 (α, β) 是对每个 (stage, riskBucket) 子群标定出的"价格-购买"曲线斜率。
 *   推理时给定 features + 候选 discount 集合 → 选 argmax_d  E[revenue | x, d]。
 *
 * 这是 *scaffolding*：默认推理函数返回与 paymentManager 当前矩阵等价的折扣推荐，
 * 但接口允许 setDemandCurve(...) 注入真 DML 学到的参数。
 *
 * 与 paymentManager 的关系：
 *   - paymentManager.calculateDiscountedPrice 仍是单一调用入口
 *   - 当 feature flag `priceElasticityModel` 开启时，paymentManager 内部
 *     先调 `recommendDiscount({stage, risk, features})` 拿"模型推荐折扣"
 *     再回到原代码计算 finalPrice
 *   - feature flag off 时退回到既有静态矩阵（兼容现有 P1-3）
 *
 * DML 推理函数（线下产出 → 注入）：
 *
 *   {
 *     schemaVersion, fittedAt,
 *     groups: {
 *       'S0:low':  { alpha: -0.8,  beta: 0,    bucket: { discount: 0.10, lift: 1.05 } },
 *       'S0:mid':  { alpha: -0.6,  beta: 0,    bucket: { discount: 0.15, lift: 1.10 } },
 *       ...
 *     }
 *   }
 */

export const PRICE_ELASTICITY_SCHEMA_VERSION = 1;

const DISCOUNT_CANDIDATES = [0, 0.05, 0.10, 0.15, 0.20];

/** 默认弹性参数（与 paymentManager.DYNAMIC_PRICING_MATRIX 等价的稀松版）。 */
const DEFAULT_GROUPS = {
    'S0:low':   { alpha: -0.6, beta: 0, baselineP: 0.04, recommendedDiscount: 0.10 },
    'S0:mid':   { alpha: -0.6, beta: 0, baselineP: 0.04, recommendedDiscount: 0.15 },
    'S0:high':  { alpha: -0.6, beta: 0, baselineP: 0.04, recommendedDiscount: 0.20 },
    'S1:low':   { alpha: -0.7, beta: 0, baselineP: 0.06, recommendedDiscount: 0.05 },
    'S1:mid':   { alpha: -0.7, beta: 0, baselineP: 0.06, recommendedDiscount: 0.10 },
    'S1:high':  { alpha: -0.7, beta: 0, baselineP: 0.06, recommendedDiscount: 0.18 },
    'S2:low':   { alpha: -0.8, beta: 0, baselineP: 0.08, recommendedDiscount: 0.05 },
    'S2:mid':   { alpha: -0.8, beta: 0, baselineP: 0.08, recommendedDiscount: 0.10 },
    'S2:high':  { alpha: -0.8, beta: 0, baselineP: 0.08, recommendedDiscount: 0.15 },
    'S3:low':   { alpha: -0.9, beta: 0, baselineP: 0.10, recommendedDiscount: 0.00 },
    'S3:mid':   { alpha: -0.9, beta: 0, baselineP: 0.10, recommendedDiscount: 0.05 },
    'S3:high':  { alpha: -0.9, beta: 0, baselineP: 0.10, recommendedDiscount: 0.12 },
    'S4:low':   { alpha: -0.5, beta: 0, baselineP: 0.05, recommendedDiscount: 0.20 },
    'S4:mid':   { alpha: -0.5, beta: 0, baselineP: 0.05, recommendedDiscount: 0.20 },
    'S4:high':  { alpha: -0.5, beta: 0, baselineP: 0.05, recommendedDiscount: 0.20 },
};

let _activeGroups = { ...DEFAULT_GROUPS };
let _meta = { isDefault: true };

function _sigmoid(x) {
    if (x >= 50) return 1;
    if (x <= -50) return 0;
    return 1 / (1 + Math.exp(-x));
}

function _bucketKey(stageCode, riskBucket) {
    const stage = String(stageCode || 'S2');
    const risk = String(riskBucket || 'mid');
    return `${stage}:${risk}`;
}

/** 给定 group + discount，返回 P(buy)。 */
function _predictBuy(group, discount) {
    const d = Math.max(0, Math.min(0.5, Number(discount) || 0));
    const baselineLogit = Math.log((group.baselineP || 0.05) / (1 - (group.baselineP || 0.05)));
    return _sigmoid(baselineLogit + group.alpha * (-d) + group.beta * d * d);
}

/**
 * 核心推理：在 candidate discount 集合上选 argmax_d  E[revenue | x, d]。
 * 即使 baselineP 很低，加 +20% 折扣也最多让转化率翻倍 → revenue 不一定更高。
 *
 * @param {Object} ctx
 * @param {string} ctx.stageCode  'S0' | 'S1' | ... | 'S4'
 * @param {'low'|'mid'|'high'} ctx.riskBucket
 * @param {number} [ctx.basePrice]   用于计算 expected revenue（未传时只比较概率）
 * @returns {{ discount:number, expectedRevenue:number, expectedBuyProb:number, group:string, fromModel:boolean, candidates:Array<{discount:number, prob:number, revenue:number}> }}
 */
export function recommendDiscount(ctx = {}) {
    const key = _bucketKey(ctx.stageCode, ctx.riskBucket);
    const group = _activeGroups[key] || DEFAULT_GROUPS['S2:mid'];
    const basePrice = Math.max(0, Number(ctx.basePrice) || 1);

    const evaluated = DISCOUNT_CANDIDATES.map((d) => {
        const prob = _predictBuy(group, d);
        const revenue = (1 - d) * basePrice * prob;
        return { discount: d, prob, revenue };
    });

    /* 选 expectedRevenue 最大的折扣；并列时取折扣较小者（保守）。 */
    let best = evaluated[0];
    for (const c of evaluated) {
        if (c.revenue > best.revenue + 1e-9) best = c;
        else if (Math.abs(c.revenue - best.revenue) < 1e-9 && c.discount < best.discount) best = c;
    }

    return {
        discount: best.discount,
        expectedRevenue: best.revenue,
        expectedBuyProb: best.prob,
        group: key,
        fromModel: !_meta.isDefault,
        candidates: evaluated,
    };
}

/* ─────────────────── 注入接口 ─────────────────── */

export function setDemandCurve(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.schemaVersion !== PRICE_ELASTICITY_SCHEMA_VERSION) {
        console.warn(`[priceElasticity] schema mismatch: got ${payload.schemaVersion}, expected ${PRICE_ELASTICITY_SCHEMA_VERSION}`);
        return false;
    }
    if (!payload.groups || typeof payload.groups !== 'object') return false;
    const next = { ...DEFAULT_GROUPS };
    let touched = 0;
    for (const k of Object.keys(payload.groups)) {
        const g = payload.groups[k];
        if (!g || !Number.isFinite(g.alpha) || !Number.isFinite(g.baselineP)) continue;
        next[k] = {
            alpha: Number(g.alpha),
            beta: Number(g.beta) || 0,
            baselineP: Math.max(1e-4, Math.min(0.999, Number(g.baselineP))),
            recommendedDiscount: Number(g.recommendedDiscount) || 0,
        };
        touched += 1;
    }
    if (touched === 0) return false;
    _activeGroups = next;
    _meta = {
        isDefault: false,
        fittedAt: Number(payload.fittedAt) || Date.now(),
        source: String(payload.source || 'unknown'),
    };
    return true;
}

export function getPriceElasticityMeta() { return { ..._meta }; }

export function _resetPriceElasticityForTests() {
    _activeGroups = { ...DEFAULT_GROUPS };
    _meta = { isDefault: true };
}

export const _PRICE_INTERNALS = { DISCOUNT_CANDIDATES, DEFAULT_GROUPS };
