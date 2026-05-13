/**
 * survivalPushTiming.js — Cox 比例风险模型推送时机推理
 *
 * v1.49.x 算法层 P3-2：
 *   把 lifecycleAwareOffers / push timing 当前的"days_since_last_active 阈值"
 *   升级为 Survival Analysis（Cox Proportional Hazards）。Cox 模型在用户运营
 *   场景的优势：
 *
 *     1. **处理 censored 数据**：还没流失的用户不能简单忽略
 *     2. **风险时变**：今天 churn 概率 vs 明天 churn 概率不是常数
 *     3. **特征权重可解释**：每个特征的 hazard ratio 可以直接看
 *
 * Cox 模型核心：
 *
 *     h(t | x) = h_0(t) · exp(β^T x)
 *
 *   其中 h_0(t) 是 baseline hazard（与 x 无关的时间函数），exp(β^T x) 是
 *   "线性 risk score 的指数"。本模块只做推理，β 由 Python lifelines 训练后
 *   通过 setSurvivalParams() 注入。
 *
 * 推理函数：
 *   - hazardScore(features) → exp(β^T x)：相对 baseline 的 hazard ratio
 *   - survivalAtT(features, t) → S(t|x) ≈ S_0(t)^{exp(β^T x)}
 *   - recommendPushTime(features) → 何时 S(t|x) 跌破 0.7（"再不推就来不及了"）
 *
 * 注：
 *   - baseline_hazard / S_0(t) 也是离线产出（按天分桶 5..30 天的 baseline survival）
 *   - 默认 baseline 走规则：S_0(t=7d) = 0.6, S_0(t=14d) = 0.4, S_0(t=30d) = 0.2
 */

export const SURVIVAL_SCHEMA_VERSION = 1;

/** 默认 baseline survival（与现行 winback 7 天阈值匹配）。 */
const DEFAULT_BASELINE_SURVIVAL = [
    { day: 1,  S: 0.95 },
    { day: 3,  S: 0.85 },
    { day: 7,  S: 0.60 },
    { day: 14, S: 0.40 },
    { day: 21, S: 0.30 },
    { day: 30, S: 0.20 },
];

let _params = {
    schemaVersion: SURVIVAL_SCHEMA_VERSION,
    beta: null,                  // Float[] 特征权重；null = 退化为规则版
    baselineSurvival: DEFAULT_BASELINE_SURVIVAL.slice(),
};
let _meta = { isDefault: true };

function _dot(w, x) {
    if (!Array.isArray(w) || !Array.isArray(x)) return 0;
    const len = Math.min(w.length, x.length);
    let s = 0;
    for (let i = 0; i < len; i++) s += w[i] * x[i];
    return s;
}

/**
 * 个体相对 baseline 的 hazard ratio：exp(β^T x)。
 * @returns {number} ≥ 0；> 1 表示该用户比平均更危险
 */
export function hazardScore(features) {
    if (!_params.beta) return 1;
    return Math.exp(_dot(_params.beta, features || []));
}

/** 从 baselineSurvival 表中线性插值出 S_0(t)。 */
function _baselineSurvivalAt(day) {
    const tab = _params.baselineSurvival;
    if (!tab.length) return 1;
    if (day <= tab[0].day) return tab[0].S;
    if (day >= tab[tab.length - 1].day) return tab[tab.length - 1].S;
    for (let i = 0; i < tab.length - 1; i++) {
        if (day <= tab[i + 1].day) {
            const t = (day - tab[i].day) / (tab[i + 1].day - tab[i].day);
            return tab[i].S * (1 - t) + tab[i + 1].S * t;
        }
    }
    return tab[tab.length - 1].S;
}

/** S(t | x) ≈ S_0(t)^{hazardScore(x)} （Cox 比例风险）。 */
export function survivalAtT(features, day) {
    const S0 = _baselineSurvivalAt(Math.max(0, Number(day) || 0));
    const hr = hazardScore(features);
    return Math.max(0, Math.min(1, Math.pow(S0, hr)));
}

/**
 * 推荐推送时机：找"S(t|x) 第一次跌破 threshold"的天数。
 * 如果一直没跌破，返回 null（暂不推送）。
 *
 * @param {number[]|Float32Array} features
 * @param {{ threshold?:number, horizon?:number }} [opts]
 * @returns {{ pushAtDay:number|null, currentSurvival:number, hazardRatio:number, urgency:'low'|'medium'|'high' }}
 */
export function recommendPushTime(features, opts = {}) {
    const threshold = Math.max(0, Math.min(1, Number(opts.threshold) || 0.7));
    const horizon = Math.max(1, Number(opts.horizon) || 21);
    const hr = hazardScore(features);
    const currentSurvival = survivalAtT(features, 0);
    let pushAtDay = null;
    for (let d = 1; d <= horizon; d++) {
        const S = survivalAtT(features, d);
        if (S < threshold) { pushAtDay = d; break; }
    }
    let urgency = 'low';
    if (hr >= 1.5 || (pushAtDay != null && pushAtDay <= 3)) urgency = 'high';
    else if (hr >= 1.1 || (pushAtDay != null && pushAtDay <= 7)) urgency = 'medium';
    return { pushAtDay, currentSurvival, hazardRatio: hr, urgency };
}

/* ─────────────────── 注入 ─────────────────── */

export function setSurvivalParams(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.schemaVersion !== SURVIVAL_SCHEMA_VERSION) {
        console.warn(`[survival] schema mismatch: got ${payload.schemaVersion}, expected ${SURVIVAL_SCHEMA_VERSION}`);
        return false;
    }
    if (Array.isArray(payload.beta) && payload.beta.every(Number.isFinite)) {
        _params.beta = payload.beta.slice();
    }
    if (Array.isArray(payload.baselineSurvival) && payload.baselineSurvival.length > 0) {
        const valid = payload.baselineSurvival.filter(
            (p) => Number.isFinite(p?.day) && Number.isFinite(p?.S)
        );
        if (valid.length > 0) {
            valid.sort((a, b) => a.day - b.day);
            _params.baselineSurvival = valid.map((p) => ({
                day: Number(p.day),
                S: Math.max(0, Math.min(1, Number(p.S))),
            }));
        }
    }
    _meta = {
        isDefault: false,
        fittedAt: Number(payload.fittedAt) || Date.now(),
        source: String(payload.source || 'unknown'),
    };
    return true;
}

export function getSurvivalMeta() { return { ..._meta }; }

export function _resetSurvivalForTests() {
    _params = {
        schemaVersion: SURVIVAL_SCHEMA_VERSION,
        beta: null,
        baselineSurvival: DEFAULT_BASELINE_SURVIVAL.slice(),
    };
    _meta = { isDefault: true };
}

export const _SURVIVAL_INTERNALS = { DEFAULT_BASELINE_SURVIVAL };
