/**
 * 商业化模型化输出层。
 *
 * 参考业界做法：LTV / Churn / IAP propensity / ad propensity / frequency guard
 * 分开估计，最后用可解释的 action score 做决策。当前为端侧规则模型，
 * 保留 modelBaseline 入口，后续可替换为 LightGBM/TFLite/服务端预测。
 *
 * v1.49.x P1-1：abilityVector 灰度接入。
 *   - 入参 ctx.ability ?: AbilityVector（来自 playerAbilityModel.buildPlayerAbilityVector）
 *   - 影响 payerScore / iapPropensity / churnRisk / interstitialPropensity 四个维度：
 *     · boardPlanning ↑ → IAP 倾向 ↑（"高规划玩家更接受付费提速"）
 *     · confidence ↑ → 流失风险 ↓（"高自信玩家短期流失风险更低"）
 *     · clearEfficiency ↑ → 插屏倾向 ↓（"清行高手在 flow 中，少打扰"）
 *     · riskLevel ↑ → 激励广告倾向 ↑（"高风险玩家更愿意救济"）
 *   - feature flag `abilityCommercial`（默认 on）控制是否启用；off 时返回旧版 vector。
 */
import { getStrategyConfig } from './strategy/index.js';
import { getFlag } from './featureFlags.js';
import { buildCommercialFeatureSnapshot, featureSnapshotDigest } from './commercialFeatureSnapshot.js';
import { calibratePropensityVector } from './calibration/propensityCalibrator.js';
import { predictAllTasks } from './ml/multiTaskEncoder.js';
import { recordSnapshotForDrift } from './quality/distributionDriftMonitor.js';

const COMMERCIAL_MODEL_VERSION = 1;

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
 * v1.49.x P1-1：abilityVector → 商业化决策的偏置量。
 * 返回四个维度上的小幅修正项（[-0.15..+0.15]），加到对应 propensity 后再 clamp01。
 * 关闭灰度（abilityCommercial=false）或 ability 缺失时全部返回 0。
 */
function _abilityBias(ability) {
    const empty = { iap: 0, payer: 0, churn: 0, interstitial: 0, rewarded: 0 };
    if (!ability || typeof ability !== 'object') return empty;
    if (!getFlag('abilityCommercial')) return empty;

    const planning = clamp01(ability.boardPlanning ?? 0);
    const confidence = clamp01(ability.confidence ?? 0);
    const clearEff = clamp01(ability.clearEfficiency ?? 0);
    const risk = clamp01(ability.riskLevel ?? 0);
    const skill = clamp01(ability.skillScore ?? 0);

    return {
        /* 高规划 + 高技能 → IAP 倾向上调，反之下调；规划 0.7+ 时玩家更接受付费提速。
         * 中心化在 0.5 让平庸玩家偏置接近 0；幅度 ±0.12（小步增量，不掩盖原信号）。 */
        iap: ((planning - 0.5) * 0.16) + ((skill - 0.5) * 0.08),
        /* 高规划 → 付费潜力 ↑（计划性强者通常变现更高）。 */
        payer: (planning - 0.5) * 0.12,
        /* 高自信 → 短期流失风险 ↓，但低自信不一定流失（对应"挫败"已在原模型）。 */
        churn: -((confidence - 0.5) * 0.14),
        /* 清行效率高 → 玩家在 flow 中，少打扰；插屏倾向 ↓。 */
        interstitial: -((clearEff - 0.5) * 0.12),
        /* 高 riskLevel → 玩家正在挣扎，更愿意看激励广告救济；倾向 ↑。 */
        rewarded: (risk - 0.5) * 0.18,
    };
}

/**
 * @param {{
 *   persona?: object,
 *   realtime?: object,
 *   ltv?: object,
 *   adFreq?: object,
 *   profile?: object,
 *   ability?: object,
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
    const payerScoreBaseBlended = baselineConf > 0
        ? clamp01(payerScoreBase * (1 - baselineConf * payerBlendScale) + clamp01(baseline.payerScore) * baselineConf * payerBlendScale)
        : payerScoreBase;

    /* P1-1：abilityVector 偏置叠加 —— 受 feature flag `abilityCommercial` 灰度。 */
    const aBias = _abilityBias(ctx.ability);
    const payerScore = clamp01(payerScoreBaseBlended + aBias.payer);

    const churnRisk = clamp01(
        (1 - activityScore) * num(churnWeights.inactivity, 0.26)
        + Math.min(1, frust / num(norms.frustrationChurn, 6)) * num(churnWeights.frustration, 0.24)
        + (flowState === 'anxious' ? num(churnWeights.anxiousFlow, 0.18) : 0)
        + (flowState === 'flow' ? num(churnWeights.flowRelief, -0.08) : 0)
        + frustrationAvg * num(churnWeights.frustrationAvg, 0.12)
        + adFatigueRisk * num(churnWeights.adFatigue, 0.20)
        + aBias.churn
    );

    const iapPropensity = clamp01(
        payerScore * num(iapWeights.payerScore, 0.55)
        + Math.min(1, frust / num(norms.frustrationIap, 5)) * num(iapWeights.frustration, 0.15)
        + (flowState === 'bored' ? num(iapWeights.boredFlow, 0.10) : 0)
        + (flowState === 'anxious' ? num(iapWeights.anxiousFlow, 0.05) : 0)
        + ltvConfidence * num(iapWeights.ltvConfidence, 0.10)
        + adFatigueRisk * num(iapWeights.adFatigue, -0.08)
        + aBias.iap
    );

    const rewardedAdPropensity = clamp01(
        (1 - payerScore) * num(rewardedWeights.nonPayer, 0.18)
        + nearMissRate * num(rewardedWeights.nearMissRate, 0.18)
        + (hadNearMiss ? num(rewardedWeights.hadNearMiss, 0.28) : 0)
        + Math.min(1, frust / num(norms.frustrationRewarded, 5)) * num(rewardedWeights.frustration, 0.18)
        + (1 - adFatigueRisk) * num(rewardedWeights.lowFatigue, 0.18)
        + aBias.rewarded
    );

    const interstitialPropensity = clamp01(
        (1 - payerScore) * num(interstitialWeights.nonPayer, 0.36)
        + (1 - churnRisk) * num(interstitialWeights.lowChurn, 0.22)
        + (1 - adFatigueRisk) * num(interstitialWeights.lowFatigue, 0.22)
        + (flowState === 'flow' ? num(interstitialWeights.flowPenalty, -0.18) : 0)
        + (persona.segment === 'minnow' ? num(interstitialWeights.minnowBonus, 0.16) : 0)
        + aBias.interstitial
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

    /* v1.49.x 算法层 P0-1 / P0-2 / P1-2：
     *   - 构造统一 snapshot（commercialFeatureSnapshot），用于训练-推理 skew 防御
     *   - 输出 calibrated 字段（calibratePropensityVector）；线下未注入校准表时等价 raw
     *   - 输出 multiTask（multiTaskEncoder）：默认 identity encoder + uniform head 时
     *     与 raw 接近但**不等价**（共享 latent 引入了不同 prior），仅供 dashboard 对照，
     *     不参与 recommendedAction 决策（feature flag 控制是否启用决策路径） */
    try {
        const snapshot = buildCommercialFeatureSnapshot({
            persona,
            realtime,
            lifecycle: ctx.lifecycle,
            adFreq,
            ltv,
            ability: ctx.ability,
            commercial: { unifiedChurnRisk: vector.churnRisk },
        });
        vector.snapshot = snapshot;
        vector.snapshotDigest = featureSnapshotDigest(snapshot);

        const cal = calibratePropensityVector({
            iapPropensity: vector.iapPropensity,
            rewardedAdPropensity: vector.rewardedAdPropensity,
            interstitialPropensity: vector.interstitialPropensity,
            churnRisk: vector.churnRisk,
            payerScore: vector.payerScore,
        });
        vector.calibrated = {
            iap: round(cal.iap),
            rewarded: round(cal.rewarded),
            interstitial: round(cal.interstitial),
            churn: round(cal.churn),
            payer: round(cal.payer),
        };

        if (getFlag('multiTaskEncoder')) {
            const mtl = predictAllTasks(snapshot.vector);
            vector.mtl = {
                iap: round(mtl.iap),
                rewarded: round(mtl.rewarded),
                interstitial: round(mtl.interstitial),
                churn: round(mtl.churn),
            };
        }

        if (getFlag('distributionDriftMonitoring')) {
            try { recordSnapshotForDrift(snapshot); } catch { /* ignore */ }
        }
    } catch {
        /* snapshot / calibration 任何异常都不能阻塞推理主链路 */
    }

    return vector;
}

/* v1.49.x 算法层工程改进 eng-1：getCommercialChurnRisk01 缓存。
 *
 * orchestrator 在 onSessionEnd 流程里会对同一 ctx 先后调 getCommercialChurnRisk01
 * 与 buildCommercialModelVector，导致整个推理链路（含 _abilityBias / snapshot / calibration）
 * 被算两次。这里加 50ms 短缓存，命中即复用——足够覆盖一次会话回调，但不会跨帧泄漏。 */
let _churnCacheKey = null;
let _churnCacheValue = null;
let _churnCacheTs = 0;
const CHURN_CACHE_TTL_MS = 50;

function _churnCtxKey(ctx) {
    /* 用 persona/realtime/adFreq 的稳定字段做 cheap key；ability 只取 confidence。 */
    const p = ctx.persona ?? {};
    const r = ctx.realtime ?? {};
    const a = ctx.adFreq ?? {};
    const ab = ctx.ability ?? {};
    return [
        p.segment, p.whaleScore, p.activityScore, p.skillScore,
        r.frustration, r.flowState, r.hadNearMiss ? 1 : 0,
        a.experienceScore, a.rewardedCount, a.interstitialCount,
        ab.confidence,
    ].map((v) => (v == null ? '_' : String(v))).join('|');
}

/**
 * v1.49.x P0-2：从已有的 commercialModelContext + adFreq 快照计算单标量 churnRisk[0..1]，
 * 供 lifecycleSignals.getUnifiedChurnRisk 的"商业化"那条腿使用。
 *
 * 之前 orchestrator 调 getUnifiedLifecycleSnapshot 时只传了 predictorRisk01，
 * commercial 那条权重 0.20 永远为 null（被跳过），unifiedRisk 实际只有 65%/100% 的有效投票。
 *
 * 入参与 buildCommercialModelVector 完全相同；返回 null 表示无法计算（上层会 fallback）。
 */
export function getCommercialChurnRisk01(ctx = {}) {
    if (!ctx || (!ctx.persona && !ctx.realtime)) return null;
    const key = _churnCtxKey(ctx);
    const now = Date.now();
    if (_churnCacheKey === key && now - _churnCacheTs < CHURN_CACHE_TTL_MS) {
        return _churnCacheValue;
    }
    try {
        const v = buildCommercialModelVector(ctx);
        const r = Number(v?.churnRisk);
        const out = Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : null;
        _churnCacheKey = key;
        _churnCacheValue = out;
        _churnCacheTs = now;
        return out;
    } catch {
        return null;
    }
}

/** 仅供测试 reset。 */
export function _resetCommercialModelCacheForTests() {
    _churnCacheKey = null;
    _churnCacheValue = null;
    _churnCacheTs = 0;
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
