/**
 * 商业化模型化输出层。
 *
 * 参考业界做法：LTV / Churn / IAP propensity / ad propensity / frequency guard
 * 分开估计，最后用可解释的 action score 做决策。当前为端侧规则模型，
 * 保留 modelBaseline 入口，后续可替换为 LightGBM/TFLite/服务端预测。
 */
import { getStrategyConfig } from './strategy/index.js';

export const COMMERCIAL_MODEL_VERSION = 1;

function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function round(v, digits = 3) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const k = 10 ** digits;
    return Math.round(n * k) / k;
}

function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function modelConfig(ctx = {}) {
    return {
        ...(getStrategyConfig().commercialModel ?? {}),
        ...(ctx.config?.commercialModel ?? {}),
    };
}

function ltvNorm(ltv, cfg) {
    return clamp01(Number(ltv?.ltv30 ?? 0) / num(cfg.ltvNormMax, 20));
}

function confidenceNumber(conf, cfg) {
    const confCfg = cfg.ltvConfidence ?? {};
    if (conf === 'high') return num(confCfg.high, 0.9);
    if (conf === 'medium') return num(confCfg.medium, 0.6);
    if (conf === 'low') return num(confCfg.low, 0.25);
    return clamp01(conf ?? 0);
}

function scoreBand(v, cfg) {
    const bands = cfg.bands ?? {};
    if (v >= num(bands.high, 0.72)) return 'high';
    if (v >= num(bands.mid, 0.42)) return 'mid';
    return 'low';
}

function recommendedAction(v, cfg) {
    const t = cfg.actionThresholds ?? {};
    if (v.guardrail.suppressAll) return 'suppress';
    if (v.iapPropensity >= num(t.iapRecommend, 0.68) && !v.guardrail.protectPayer) return 'iap_offer';
    if (v.rewardedAdPropensity >= num(t.rewardedRecommend, 0.55)) return 'rewarded_ad';
    if (v.interstitialPropensity >= num(t.interstitialRecommend, 0.5)) return 'interstitial';
    if (v.churnRisk >= num(t.churnTask, 0.62) || v.payerScore < num(t.lowPayerTask, 0.35)) return 'task_or_push';
    return 'observe';
}

function explain(v, cfg) {
    const t = cfg.actionThresholds ?? {};
    const g = cfg.guardrail ?? {};
    const out = [];
    if (v.payerScore >= num(g.protectPayerScore, 0.68)) out.push('付费潜力高，优先 IAP 与免插屏保护');
    if (v.rewardedAdPropensity >= num(t.rewardedRecommend, 0.55)) out.push('激励广告接受度高，适合在近失/救援节点展示');
    if (v.interstitialPropensity >= num(t.interstitialRecommend, 0.5)) out.push('插屏收益可接受，但仅限自然断点');
    if (v.churnRisk >= num(g.suppressInterstitialChurnRisk, 0.62)) out.push('流失风险偏高，应减少打断并转向救援/任务');
    if (v.adFatigueRisk >= num(g.suppressInterstitialFatigue, 0.55)) out.push('广告疲劳升高，进入降频保护');
    if (out.length === 0) out.push('商业化信号平稳，维持当前策略');
    return out.slice(0, 3);
}

/**
 * @param {{
 *   persona?: object,
 *   realtime?: object,
 *   ltv?: object,
 *   adFreq?: object,
 *   profile?: object,
 *   modelBaseline?: object
 * }} ctx
 */
export function buildCommercialModelVector(ctx = {}) {
    const cfg = modelConfig(ctx);
    const fatigueCfg = cfg.adFatigue ?? {};
    const fatigueWeights = fatigueCfg.weights ?? {};
    const payerWeights = cfg.payerScoreWeights ?? {};
    const churnWeights = cfg.churnRiskWeights ?? {};
    const propensityWeights = cfg.propensityWeights ?? {};
    const iapWeights = propensityWeights.iap ?? {};
    const rewardedWeights = propensityWeights.rewarded ?? {};
    const interstitialWeights = propensityWeights.interstitial ?? {};
    const norms = cfg.norms ?? {};
    const guardCfg = cfg.guardrail ?? {};
    const persona = ctx.persona ?? {};
    const realtime = ctx.realtime ?? {};
    const adFreq = ctx.adFreq ?? {};
    const ltv = ctx.ltv ?? {};
    const baseline = ctx.modelBaseline ?? null;

    const whaleScore = clamp01(persona.whaleScore ?? 0);
    const activityScore = clamp01(persona.activityScore ?? 0);
    const skillScore = clamp01(persona.skillScore ?? realtime.skill ?? 0);
    const nearMissRate = clamp01(persona.nearMissRate ?? 0);
    const frustrationAvg = clamp01(persona.frustrationAvg ?? 0);
    const frust = Math.max(0, Number(realtime.frustration ?? 0) || 0);
    const hadNearMiss = Boolean(realtime.hadNearMiss);
    const flowState = realtime.flowState ?? 'flow';
    const ltvScore = ltvNorm(ltv, cfg);
    const ltvConfidence = confidenceNumber(ltv.confidence, cfg);

    const experienceScore = clamp01((adFreq.experienceScore ?? 100) / 100);
    const rewardedCount = Math.max(0, Number(adFreq.rewardedCount ?? 0) || 0);
    const interstitialCount = Math.max(0, Number(adFreq.interstitialCount ?? 0) || 0);
    const adFatigueRisk = clamp01(
        (1 - experienceScore) * num(fatigueWeights.experience, 0.5)
        + Math.min(1, rewardedCount / num(fatigueCfg.rewardedMax, 12)) * num(fatigueWeights.rewardedCount, 0.2)
        + Math.min(1, interstitialCount / num(fatigueCfg.interstitialMax, 6)) * num(fatigueWeights.interstitialCount, 0.3)
    );

    const payerScoreBase = clamp01(
        whaleScore * num(payerWeights.whaleScore, 0.34)
        + ltvScore * num(payerWeights.ltvScore, 0.28)
        + activityScore * num(payerWeights.activityScore, 0.18)
        + skillScore * num(payerWeights.skillScore, 0.10)
        + (persona.segment === 'whale' ? num(payerWeights.segmentWhaleBonus, 0.10) : persona.segment === 'dolphin' ? num(payerWeights.segmentDolphinBonus, 0.04) : 0)
    );
    const baselineConf = clamp01(baseline?.confidence ?? 0);
    const payerBlendScale = num(cfg.baseline?.payerBlendScale, 0.35);
    const payerScore = baselineConf > 0
        ? clamp01(payerScoreBase * (1 - baselineConf * payerBlendScale) + clamp01(baseline.payerScore) * baselineConf * payerBlendScale)
        : payerScoreBase;

    const churnRisk = clamp01(
        (1 - activityScore) * num(churnWeights.inactivity, 0.26)
        + Math.min(1, frust / num(norms.frustrationChurn, 6)) * num(churnWeights.frustration, 0.24)
        + (flowState === 'anxious' ? num(churnWeights.anxiousFlow, 0.18) : 0)
        + (flowState === 'flow' ? num(churnWeights.flowRelief, -0.08) : 0)
        + frustrationAvg * num(churnWeights.frustrationAvg, 0.12)
        + adFatigueRisk * num(churnWeights.adFatigue, 0.20)
    );

    const iapPropensity = clamp01(
        payerScore * num(iapWeights.payerScore, 0.55)
        + Math.min(1, frust / num(norms.frustrationIap, 5)) * num(iapWeights.frustration, 0.15)
        + (flowState === 'bored' ? num(iapWeights.boredFlow, 0.10) : 0)
        + (flowState === 'anxious' ? num(iapWeights.anxiousFlow, 0.05) : 0)
        + ltvConfidence * num(iapWeights.ltvConfidence, 0.10)
        + adFatigueRisk * num(iapWeights.adFatigue, -0.08)
    );

    const rewardedAdPropensity = clamp01(
        (1 - payerScore) * num(rewardedWeights.nonPayer, 0.18)
        + nearMissRate * num(rewardedWeights.nearMissRate, 0.18)
        + (hadNearMiss ? num(rewardedWeights.hadNearMiss, 0.28) : 0)
        + Math.min(1, frust / num(norms.frustrationRewarded, 5)) * num(rewardedWeights.frustration, 0.18)
        + (1 - adFatigueRisk) * num(rewardedWeights.lowFatigue, 0.18)
    );

    const interstitialPropensity = clamp01(
        (1 - payerScore) * num(interstitialWeights.nonPayer, 0.36)
        + (1 - churnRisk) * num(interstitialWeights.lowChurn, 0.22)
        + (1 - adFatigueRisk) * num(interstitialWeights.lowFatigue, 0.22)
        + (flowState === 'flow' ? num(interstitialWeights.flowPenalty, -0.18) : 0)
        + (persona.segment === 'minnow' ? num(interstitialWeights.minnowBonus, 0.16) : 0)
    );

    const guardrail = {
        protectPayer: payerScore >= num(guardCfg.protectPayerScore, 0.68) || persona.segment === 'whale',
        suppressInterstitial: payerScore >= num(guardCfg.suppressInterstitialPayerScore, 0.55)
            || churnRisk >= num(guardCfg.suppressInterstitialChurnRisk, 0.62)
            || adFatigueRisk >= num(guardCfg.suppressInterstitialFatigue, 0.55)
            || flowState === 'flow',
        suppressRewarded: adFatigueRisk >= num(guardCfg.suppressRewardedFatigue, 0.72),
        suppressAll: Boolean(adFreq.inRecoveryPeriod) || adFatigueRisk >= num(guardCfg.suppressAllFatigue, 0.82),
    };

    const vector = {
        version: COMMERCIAL_MODEL_VERSION,
        segment: persona.segment ?? 'minnow',
        payerScore: round(payerScore),
        iapPropensity: round(iapPropensity),
        rewardedAdPropensity: round(rewardedAdPropensity),
        interstitialPropensity: round(interstitialPropensity),
        churnRisk: round(churnRisk),
        adFatigueRisk: round(adFatigueRisk),
        ltv30: round(ltv.ltv30 ?? 0, 2),
        ltvConfidence: round(ltvConfidence),
        band: {
            payer: scoreBand(payerScore, cfg),
            iap: scoreBand(iapPropensity, cfg),
            rewarded: scoreBand(rewardedAdPropensity, cfg),
            interstitial: scoreBand(interstitialPropensity, cfg),
            churn: scoreBand(churnRisk, cfg),
        },
        guardrail,
        recommendedAction: 'observe',
        explain: [],
        features: {
            whaleScore: round(whaleScore),
            activityScore: round(activityScore),
            skillScore: round(skillScore),
            nearMissRate: round(nearMissRate),
            frustration: frust,
            hadNearMiss,
            flowState,
            experienceScore: round(experienceScore),
        },
    };
    vector.recommendedAction = recommendedAction(vector, cfg);
    vector.explain = explain(vector, cfg);
    return vector;
}

export function shouldAllowMonetizationAction(vector, action) {
    const t = getStrategyConfig().commercialModel?.actionThresholds ?? {};
    const allowThreshold = num(t.allowAction, 0.45);
    if (!vector || vector.guardrail?.suppressAll) return false;
    if (action === 'interstitial') {
        return !vector.guardrail.suppressInterstitial && vector.interstitialPropensity >= allowThreshold;
    }
    if (action === 'rewarded') {
        return !vector.guardrail.suppressRewarded && vector.rewardedAdPropensity >= allowThreshold;
    }
    if (action === 'iap') {
        return vector.iapPropensity >= allowThreshold;
    }
    return true;
}
