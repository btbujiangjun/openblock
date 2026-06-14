/* 自动生成 —— 请勿手改。源：web/src/monetization/ltvPredictor.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * LTVPredictor — 用户生命周期价值预测模型
 *
 * 目标
 * ----
 * 结合渠道归因（channelAttribution）+ 用户分群（PlayerProfile.segment5）+
 * 历史行为数据，对每位用户生成 LTV 预测值（30/60/90 天），
 * 辅助 D 类用户的买量出价决策。
 *
 * 模型设计（规则引擎 + 线性加权）
 * ----------------------------------
 * 暂不依赖 ML 模型，采用「规则系数 × 信号」的可解释线性模型：
 *
 *   LTV_30d = base × channel_coeff × segment_coeff × activity_coeff × skill_coeff
 *
 * 系数来源于竞品数据中各分群的 ARPU 比例（A:B:C:D:E = 28:37:9:25:0.8）。
 *
 * 输出
 * ----
 *   { ltv30: number, ltv60: number, ltv90: number,
 *     segment: string, channel: string, confidence: 'low'|'medium'|'high',
 *     bidRecommendation: number }   // 建议 CPI 出价（元）
 *
 * 集成
 * ----
 *   import { getLTVEstimate } from './ltvPredictor.mjs';
 *   const est = getLTVEstimate(playerProfile, attribution);
 */

import { getAttribution, isPaidChannel } from '../channelAttribution.mjs';

// ── 分群基础 ARPU 系数（相对值，基准=A类=1.0） ────────────────────────────
const SEGMENT_ARPU_RATIO = {
    A: 1.0,
    B: 2.64,   // 37/14（37%收入/28%用户 vs A类 28%/60%）
    C: 9.0,    // 9%收入/2%用户
    D: 5.56,   // 25%收入/9%用户
    E: 0.27,   // 0.8%收入/0.6%用户
};

// ── 渠道系数（买量渠道已过滤低质量用户，LTV 更高） ───────────────────────
const CHANNEL_COEFF = {
    applovin: 1.4,
    unity:    1.35,
    ironsource: 1.3,
    mintegral:  1.25,
    facebook:   1.2,
    google_uac: 1.15,
    organic:    1.05,
    unknown:    1.0,
};

// ── A 类基础 LTV（元），基于市场均值估算 ─────────────────────────────────
const BASE_LTV_A = {
    ltv30: 2.5,
    ltv60: 4.0,
    ltv90: 5.2,
};

// ── 置信度门槛（游戏局数）───────────────────────────────────────────────
const CONF_HIGH   = 30;
const CONF_MEDIUM = 8;

/**
 * 计算活跃度系数（基于会话历史丰富度和趋势）
 */
function _activityCoeff(profile) {
    const games = profile._totalLifetimeGames ?? 0;
    const trend = profile.sessionTrend ?? 'stable';
    let base = Math.min(1.3, 0.6 + games * 0.02);  // 最多 +30% 提升
    if (trend === 'rising')    base *= 1.15;
    if (trend === 'declining') base *= 0.85;
    return base;
}

/**
 * 技能系数（高技能玩家更长寿，但 E 类付费少）
 */
function _skillCoeff(profile) {
    const skill = profile.skillLevel ?? 0.3;
    const seg   = profile.segment5 ?? 'A';
    if (seg === 'E') return 0.5;     // 高技能但低付费
    return 0.85 + skill * 0.3;       // 0.85~1.15
}

/**
 * 获取渠道系数
 * @param {string} source utm_source 来源
 */
function _channelCoeff(source) {
    if (!source) return CHANNEL_COEFF.unknown;
    const s = source.toLowerCase();
    for (const [k, v] of Object.entries(CHANNEL_COEFF)) {
        if (s.includes(k)) return v;
    }
    return CHANNEL_COEFF.organic;
}

/**
 * 主预测函数
 * @param {import('../playerProfile.js').PlayerProfile} profile
 * @param {{ first?: {source:string}, last?: {source:string} }} [attribution]
 * @returns {{ ltv30:number, ltv60:number, ltv90:number, segment:string, channel:string,
 *             confidence:'low'|'medium'|'high', bidRecommendation:number,
 *             breakdown: object }}
 */
export function getLTVEstimate(profile, attribution) {
    attribution = attribution ?? getAttribution();
    const segment = profile?.segment5 ?? 'A';
    const source  = attribution?.first?.source ?? attribution?.last?.source ?? 'unknown';

    const segCoeff  = SEGMENT_ARPU_RATIO[segment] ?? 1.0;
    const chanCoeff = _channelCoeff(source);
    const actCoeff  = _activityCoeff(profile);
    const skillCoef = _skillCoeff(profile);
    const multiplier = segCoeff * chanCoeff * actCoeff * skillCoef;

    const ltv30 = +(BASE_LTV_A.ltv30 * multiplier).toFixed(2);
    const ltv60 = +(BASE_LTV_A.ltv60 * multiplier).toFixed(2);
    const ltv90 = +(BASE_LTV_A.ltv90 * multiplier).toFixed(2);

    const games = profile?._totalLifetimeGames ?? 0;
    const confidence = games >= CONF_HIGH ? 'high' : games >= CONF_MEDIUM ? 'medium' : 'low';

    // 建议 CPI 出价 = LTV_30d × ROI目标系数（D类取 0.6，其他 0.4）
    const roiTarget = segment === 'D' ? 0.60 : 0.40;
    const bidRecommendation = +(ltv30 * roiTarget).toFixed(2);

    return {
        ltv30, ltv60, ltv90,
        segment, channel: source,
        confidence,
        bidRecommendation,
        breakdown: {
            segCoeff, chanCoeff, actCoeff, skillCoef,
            base30: BASE_LTV_A.ltv30,
        },
    };
}

/* ── UA-4：真实回流校准 ───────────────────────────────────────────────────
 *
 * 规则线性模型给出的 ltv30/出价建议是「先验」。当某渠道/分群积累了足够的真实
 * 30 日回收样本后，用「真实均值 / 预测均值」做一次保守回归修正，把先验拉向后验：
 *
 *   factor = clamp( realizedAvg / predictedAvg, [1-maxAdj, 1+maxAdj] )
 *   ltv*_cal = ltv* × shrink(factor, n)     // 样本越多越相信后验
 *
 * shrink 用样本量做经验贝叶斯收缩：n<minSamples 时几乎不动先验，n 越大越贴后验。
 * 这样既能在冷启动期保护先验，又能在数据充分时跟上真实 ROAS。 */
const CAL_DEFAULTS = Object.freeze({
    maxAdj: 0.6,        // 单次校准对先验的最大相对调整（±60%）
    minSamples: 20,     // 低于该样本量时收缩力度强（信先验）
    fullSamples: 200,   // 达到该样本量时几乎完全信后验
});

function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

/**
 * 由「预测均值 / 真实均值 / 样本量」计算校准因子（>0）。
 * @param {{ predictedAvg:number, realizedAvg:number, samples:number }} obs
 * @param {object} [cfg]
 * @returns {number} 校准乘子（1=不变）
 */
export function computeCalibrationFactor(obs, cfg = CAL_DEFAULTS) {
    const { maxAdj, minSamples, fullSamples } = { ...CAL_DEFAULTS, ...cfg };
    const predicted = Number(obs?.predictedAvg);
    const realized = Number(obs?.realizedAvg);
    const samples = Math.max(0, Number(obs?.samples) || 0);
    if (!(predicted > 0) || !(realized >= 0)) return 1;

    const raw = _clamp(realized / predicted, 1 - maxAdj, 1 + maxAdj);
    // 经验贝叶斯收缩权重：[0,1]
    const w = _clamp((samples - minSamples) / Math.max(1, fullSamples - minSamples), 0, 1);
    return 1 + (raw - 1) * w;
}

/**
 * 把校准因子作用到一份 LTV 估算上（ltv30/60/90 + 出价建议同步缩放）。
 * @param {ReturnType<typeof getLTVEstimate>} estimate
 * @param {number} factor computeCalibrationFactor 的输出
 */
export function calibrateLtv(estimate, factor) {
    const f = Number(factor);
    if (!Number.isFinite(f) || f <= 0 || f === 1) {
        return { ...estimate, calibrationFactor: 1, calibrated: false };
    }
    return {
        ...estimate,
        ltv30: +(estimate.ltv30 * f).toFixed(2),
        ltv60: +(estimate.ltv60 * f).toFixed(2),
        ltv90: +(estimate.ltv90 * f).toFixed(2),
        bidRecommendation: +(estimate.bidRecommendation * f).toFixed(2),
        calibrationFactor: +f.toFixed(4),
        calibrated: true,
    };
}

/**
 * 一步到位：预测 + 校准（出价建议接入真实 30d 回收回归修正）。
 * @param {import('../playerProfile.js').PlayerProfile} profile
 * @param {{ first?: {source:string}, last?: {source:string} }} [attribution]
 * @param {{ predictedAvg:number, realizedAvg:number, samples:number }} [realized] 渠道/分群真实回收样本
 */
export function getCalibratedLTVEstimate(profile, attribution, realized) {
    const base = getLTVEstimate(profile, attribution);
    if (!realized) return { ...base, calibrationFactor: 1, calibrated: false };
    const factor = computeCalibrationFactor(realized);
    return calibrateLtv(base, factor);
}

/**
 * 渲染 LTV 预测卡片 HTML（供 commercialInsight.js 插入）
 */
export function renderLTVCard(estimate) {
    const confColor = { high: '#22c55e', medium: '#f59e0b', low: '#94a3b8' };
    const c = confColor[estimate.confidence] ?? '#94a3b8';
    const paidBadge = isPaidChannel()
        ? `<span style="background:#dbeafe;color:#1d4ed8;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700">买量</span>`
        : '';
    return `
<div style="margin-top:6px;padding:7px 9px;background:color-mix(in srgb,#5B9BD5 7%,transparent);border:1px solid color-mix(in srgb,#5B9BD5 18%,transparent);border-radius:7px;font-size:9px;line-height:1.5">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
    <span style="font-weight:700;color:var(--text-primary,#1e293b)">LTV 预测</span>
    <span style="display:flex;gap:4px;align-items:center">
      ${paidBadge}
      <span style="color:${c};font-size:8px">●</span>
      <span style="color:var(--text-secondary,#64748b)">${estimate.confidence === 'high' ? '高置信' : estimate.confidence === 'medium' ? '中置信' : '数据不足'}</span>
    </span>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;text-align:center">
    <div><div style="color:var(--text-secondary,#64748b)">30天</div><div style="font-weight:700;color:var(--accent-dark,#4472C4)">¥${estimate.ltv30}</div></div>
    <div><div style="color:var(--text-secondary,#64748b)">60天</div><div style="font-weight:700;color:var(--accent-dark,#4472C4)">¥${estimate.ltv60}</div></div>
    <div><div style="color:var(--text-secondary,#64748b)">90天</div><div style="font-weight:700;color:var(--accent-dark,#4472C4)">¥${estimate.ltv90}</div></div>
  </div>
  <div style="margin-top:5px;padding-top:4px;border-top:1px solid color-mix(in srgb,var(--text-primary,#1e293b) 8%,transparent);display:flex;justify-content:space-between">
    <span style="color:var(--text-secondary,#64748b)">建议 CPI 出价</span>
    <span style="font-weight:700;color:#f59e0b">¥${estimate.bidRecommendation}</span>
  </div>
</div>`;
}
