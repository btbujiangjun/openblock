/**
 * flywheelObjective.js — 增长飞轮「共同货币 + 多目标标量化 + 硬约束」
 *
 * 解决的核心问题：发行(UA) / 体验(留存) / 变现(广告·IAP) 三条飞轮各自最优会互相拉扯
 * （插屏抬收入却伤 flow、动态加价与首充窗冲突、PB 追逐与 warmRun 救济争夺 spawnIntent）。
 *
 * 前沿做法（见 docs：调研引用）：
 *   - 把所有决策折算到同一货币——**期望增量 LTV**（predictive-LTV bidding / GRePO-LTV）。
 *   - 用**多目标向量** {revenue, retention, experience} 表达每个动作的贡献，避免单标量贪婪。
 *   - 用**损失厌恶标量化**（MORL: 放大损失多于收益）把向量压成单一效用，保证「不烧用户」。
 *   - 用**硬约束**（flow 中不插屏、高 churn 不加压/不加价、保护付费/新手）防止越界。
 *
 * 设计约束：纯函数、无副作用、无 DOM；权重可经 RemoteConfig 注入；强单测。
 * 信号口径见 coordination/unifiedSignals.js（统一 SSOT，所有动作读同一份信号）。
 */

export const OBJECTIVES = Object.freeze(['revenue', 'retention', 'experience']);

/* 默认权重偏向 retention/experience —— 休闲游戏可规模化增长的瓶颈是「承接」，
 * 变现激进只会抬高 CPI 回收压力却折损 D1/D7。和 = 1。 */
export const DEFAULT_OBJECTIVE_WEIGHTS = Object.freeze({
    revenue: 0.34,
    retention: 0.40,
    experience: 0.26,
});

let _weights = { ...DEFAULT_OBJECTIVE_WEIGHTS };

export function setObjectiveWeights(w) {
    if (!w || typeof w !== 'object') return false;
    const next = { ...DEFAULT_OBJECTIVE_WEIGHTS };
    let touched = false;
    for (const k of OBJECTIVES) {
        const v = Number(w[k]);
        if (Number.isFinite(v) && v >= 0) { next[k] = v; touched = true; }
    }
    if (!touched) return false;
    const sum = OBJECTIVES.reduce((s, k) => s + next[k], 0);
    if (sum <= 0) return false;
    _weights = Object.fromEntries(OBJECTIVES.map((k) => [k, next[k] / sum]));
    return true;
}

export function getObjectiveWeights() { return { ..._weights }; }
export function resetObjectiveWeights() { _weights = { ...DEFAULT_OBJECTIVE_WEIGHTS }; }

function _clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : 0)); }
const _c1 = (x) => _clamp(x, -1, 1);
const _c01 = (x) => _clamp(x, 0, 1);

/**
 * 损失厌恶标量化（MORL 保守变换）：收益做边际递减（gainDamping<1 的凹变换），
 * 损失放大 lossAversion 倍。⇒ 同样幅度下「伤留存」比「抬收入」权重更大，
 * 天然避免变现把用户烧掉。x∈[-1,1]。
 */
export function shapeContribution(x, { lossAversion = 2.0, gainDamping = 0.85 } = {}) {
    const v = _c1(x);
    if (v >= 0) return Math.pow(v, gainDamping);
    return -lossAversion * Math.pow(-v, gainDamping);
}

/** 把目标向量按权重 + 损失厌恶压成单一效用标量。 */
export function scalarize(vec, weights = _weights, opts = {}) {
    let u = 0;
    for (const k of OBJECTIVES) {
        const w = Number(weights?.[k]) || 0;
        u += w * shapeContribution(vec?.[k] ?? 0, opts);
    }
    return u;
}

/**
 * 候选动作 → 三目标贡献向量（[-1,1]）。signals 为 unifiedSignals 统一口径。
 * 所有飞轮动作在此用**同一信号**评估，保证策略一致、互不打架。
 *
 * action: { domain:'ad'|'offer'|'experience'|'ua', choice:string }
 */
export function objectiveVector(action, signals = {}) {
    const churn = _c01(signals.churnRisk);
    const flow = _c01(signals.flow);
    const frustration = _c01(signals.frustration);
    const payer = _c01(signals.payerScore);
    const fatigue = _c01(signals.adFatigue);
    const ltvN = _c01(signals.ltvNorm);        // 归一后的 LTV（共同货币强度）
    const isNew = signals.lifecycleStage === 'S0';
    const z = { revenue: 0, retention: 0, experience: 0 };

    switch (`${action.domain}:${action.choice}`) {
        case 'ad:none':
            return z;
        case 'ad:rewarded':
            // 激励：用户主动换奖励——收入正、体验略正、对疲劳/挫败敏感
            z.revenue = 0.45 * (1 - 0.4 * fatigue);
            z.experience = 0.12 * (1 - flow) - 0.25 * fatigue;
            z.retention = 0.06 - 0.12 * fatigue;
            return z;
        case 'ad:interstitial':
            // 插屏：收入更高但强打断——flow/付费/新手/高churn 下重罚留存与体验
            z.revenue = 0.6 * (1 - 0.3 * fatigue) * (1 - 0.5 * payer);
            z.retention = -(0.25 + 0.5 * churn + 0.3 * flow);
            z.experience = -(0.3 + 0.45 * flow + 0.3 * frustration + (isNew ? 0.25 : 0));
            return z;

        case 'offer:none':
            return z;
        case 'offer:first_purchase':
            // 首充窗：高 LTV 潜力 + 高 confidence/低挫败时正收益；打断成本小
            z.revenue = 0.5 * ltvN * (1 - 0.5 * frustration);
            z.retention = 0.05;
            z.experience = -0.08 * flow;
            return z;
        case 'offer:retention_gift':
            // 召回/留存礼包：不直接变现，但救留存与体验（高 churn 时价值最大）
            z.revenue = 0.05;
            z.retention = 0.35 + 0.4 * churn;
            z.experience = 0.18 + 0.2 * frustration;
            return z;
        case 'offer:dynamic_markup':
            // 动态加价：仅对低 churn / 高 LTV 才正；高 churn 会把人推走
            z.revenue = 0.4 * ltvN - 0.2;
            z.retention = -(0.15 + 0.6 * churn);
            z.experience = -0.05;
            return z;

        case 'experience:neutral':
            return z;
        case 'experience:pressure':
            // 加压（PB 追逐/挑战）：对低 churn 高心流玩家是正爽感；高 churn/高挫败则伤留存
            z.revenue = 0.05;
            z.retention = 0.18 * (1 - churn) - 0.45 * churn;
            z.experience = 0.25 * (1 - frustration) - 0.5 * frustration;
            return z;
        case 'experience:relief':
            // 救济（warmRun/relief）：救留存与体验，对高挫败/高 churn 价值最大
            z.revenue = -0.03;
            z.retention = 0.12 + 0.4 * churn;
            z.experience = 0.15 + 0.4 * frustration - 0.2 * flow;
            return z;

        default:
            return z;
    }
}

/**
 * 硬约束（不可越界的安全门）。返回各类动作是否被允许 + 触发原因。
 * 这是「避免拉扯」的兜底：即使标量化打分偏高，越界动作也被直接禁掉。
 */
export function constraints(signals = {}) {
    const churn = _c01(signals.churnRisk);
    const flow = _c01(signals.flow);
    const payer = _c01(signals.payerScore);
    const valueTier = String(signals.valueTier || 'T0');
    const isNew = signals.lifecycleStage === 'S0';
    const winback = !!signals.winbackActive;
    const highValue = payer >= 0.6 || valueTier >= 'T3';

    const reasons = [];
    const block = (cond, key) => { if (cond) reasons.push(key); return cond; };

    const noInterstitial =
        block(flow >= 0.66, 'flow_protect') ||
        block(highValue, 'payer_protect') ||
        block(isNew, 'newbie_protect') ||
        block(winback, 'winback_protect');

    const noDifficultyPressure =
        block(churn >= 0.6, 'churn_protect') ||
        block(winback, 'winback_relief') ||
        block(frustrationHigh(signals), 'frustration_protect');

    const noDynamicMarkup =
        block(churn >= 0.5, 'churn_no_markup') ||
        block(isNew, 'newbie_no_markup');

    return {
        allowInterstitial: !noInterstitial,
        allowRewarded: true,                 // 激励视频用户主动，恒允许
        allowDifficultyPressure: !noDifficultyPressure,
        allowDynamicMarkup: !noDynamicMarkup,
        reasons,
    };
}

function frustrationHigh(signals) { return _c01(signals.frustration) >= 0.66; }
