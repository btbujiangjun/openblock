/**
 * unifiedSignals.js — 增长飞轮「底层信号统一层」（client-side feature store）
 *
 * 背景：调研发现同一信号在多处独立计算、口径分叉（skill 4 套、churn 3 套、LTV 3 套、
 * segment/tier 多套、difficulty/stress 7 层）。结果同一玩家在 UA/体验/变现里被打成
 * 不同档位，决策互相抵消（效率折损）。
 *
 * 本层做一件事：**为每个语义信号选出唯一权威源（SSOT），冻结成一份快照**，并附
 * `provenance`（来源）。所有飞轮动作（unifiedSignals → flywheelObjective → policyArbiter）
 * 在同一决策周期读同一份信号，从根上消除「同名不同源」。
 *
 *   churnRisk   ← lifecycleSignals.getUnifiedChurnRisk（已是三路投票的 SSOT）
 *   ltv/ltvBid  ← ltvPredictor.getCalibratedLTVEstimate（含 UA-4 后验校准）
 *   segment/tier/stage/maturity ← lifecycleSignals 快照（已收敛多套成熟度）
 *   skill/flow/frustration/engagement ← PlayerProfile（局内实时 SSOT）
 *
 * 设计约束：纯聚合、无新 ML、防御式兜底；resolveUnifiedSignals 带 300ms 周期缓存，
 * 保证「同一帧所有消费方拿到完全一致的值」（修复此前 realtimeSignals 拷贝延迟一轮的 skew）。
 */

import { getCachedLifecycleSnapshot } from '../lifecycle/lifecycleSignals.js';
import { getCalibratedLTVEstimate } from '../monetization/ltvPredictor.js';

export const UNIFIED_SCHEMA_VERSION = 1;

/* LTV 归一参考（元）。把 ltv30 压到 [0,1] 作为「共同货币强度」ltvNorm，
 * 供 flywheelObjective 在 revenue 目标里统一加权。可经 RemoteConfig 调。 */
let _ltvNormRef = 20;
export function setLtvNormRef(v) { if (Number.isFinite(v) && v > 0) _ltvNormRef = v; }

function _num(x, d = 0) { return Number.isFinite(Number(x)) ? Number(x) : d; }
function _c01(x) { return Math.max(0, Math.min(1, _num(x))); }

/**
 * 纯函数：把各 SSOT 已取好的原始值合成统一信号 + provenance。
 * 便于单测直接喂值；resolveUnifiedSignals 负责真正去各源取数后调用它。
 *
 * @param {Object} raw
 * @param {{value:number, level?:string}} raw.churn
 * @param {{ltv30:number, bid:number, confidence?:string}} raw.ltv
 * @param {{segment5:string, valueTier?:string, spendTier?:string, lifecycleStage:string, maturityBand?:string}} raw.seg
 * @param {{skill:number, flow:number, frustration:number, engagement:number, nearMiss?:boolean, momentum?:number}} raw.profile
 * @param {{payerScore?:number, adFatigue?:number, winbackActive?:boolean}} [raw.commercial]
 */
export function buildUnifiedSignals(raw = {}) {
    const churn = raw.churn || {};
    const ltv = raw.ltv || {};
    const seg = raw.seg || {};
    const prof = raw.profile || {};
    const com = raw.commercial || {};

    const ltv30 = _num(ltv.ltv30);
    return {
        schemaVersion: UNIFIED_SCHEMA_VERSION,

        // —— 流失（唯一权威：lifecycleSignals 三路投票）——
        churnRisk: _c01(churn.value),
        churnLevel: churn.level || null,

        // —— LTV / 出价（唯一权威：ltvPredictor，含 UA-4 校准）——
        ltv30,
        ltvBid: _num(ltv.bid),
        ltvNorm: _c01(ltv30 / _ltvNormRef),
        ltvConfidence: ltv.confidence || 'low',

        // —— 分群 / 生命周期（唯一权威：lifecycleSignals 收敛后的成熟度家族）——
        segment5: seg.segment5 || 'A',
        valueTier: seg.valueTier || 'T0',
        spendTier: seg.spendTier || 'S0',
        lifecycleStage: seg.lifecycleStage || 'S0',
        maturityBand: seg.maturityBand || 'M0',

        // —— 实时局内（唯一权威：PlayerProfile）——
        skill: _c01(prof.skill),
        flow: _c01(prof.flow),
        frustration: _c01(prof.frustration),
        engagement: _c01(prof.engagement),
        nearMiss: !!prof.nearMiss,
        momentum: _num(prof.momentum),

        // —— 商业化代理（commercialModel / adFreq）——
        payerScore: _c01(com.payerScore),
        adFatigue: _c01(com.adFatigue),
        winbackActive: !!com.winbackActive,

        provenance: Object.freeze({
            churnRisk: 'lifecycleSignals.getUnifiedChurnRisk',
            ltv: 'ltvPredictor.getCalibratedLTVEstimate',
            segment: 'lifecycleSignals.snapshot',
            realtime: 'playerProfile',
            commercial: 'commercialModel/adFreq',
        }),
    };
}

/* 周期缓存：同一帧内多个飞轮消费方共享同一份信号（一致性 + 省去重复 SSOT 读取）。 */
const TTL_MS = 300;
let _cache = null;
let _cacheKey = null;
let _cacheTs = 0;

/**
 * 从各 SSOT 取数 → 统一信号快照。防御式：任一源失败都退到安全默认，不抛错。
 *
 * @param {import('../playerProfile.js').PlayerProfile} profile
 * @param {Object} [ctx]
 * @param {Object} [ctx.attribution]                  归因（给 ltvPredictor）
 * @param {Object} [ctx.realized]                     真实回收（给 UA-4 校准）
 * @param {number} [ctx.predictorRisk01]              churnPredictor risk/100
 * @param {number} [ctx.commercialChurnRisk01]        commercialModel.churnRisk
 * @param {number} [ctx.payerScore]                   commercialModel.payerScore
 * @param {number} [ctx.adFatigue]                    adFreq 疲劳度
 * @param {boolean}[ctx.winbackActive]
 */
export function resolveUnifiedSignals(profile, ctx = {}) {
    const key = `${profile?._installTs || 0}|${profile?._lastSessionEndTs || 0}|${profile?._totalLifetimeGames || 0}|${ctx.predictorRisk01 ?? ''}|${ctx.commercialChurnRisk01 ?? ''}|${ctx.payerScore ?? ''}|${ctx.adFatigue ?? ''}`;
    const now = Date.now();
    if (_cache && _cacheKey === key && (now - _cacheTs) < TTL_MS) return _cache;

    const snap = (() => {
        try {
            return getCachedLifecycleSnapshot(profile, {
                predictorRisk01: ctx.predictorRisk01,
                commercialChurnRisk01: ctx.commercialChurnRisk01,
            });
        } catch { return null; }
    })();

    const ltvEst = (() => {
        try { return getCalibratedLTVEstimate(profile, ctx.attribution, ctx.realized); }
        catch { return { ltv30: 0, bidRecommendation: 0, confidence: 'low' }; }
    })();

    const raw = {
        churn: {
            value: snap?.churn?.unifiedRisk ?? 0,
            level: snap?.churn?.level ?? null,
        },
        ltv: {
            ltv30: ltvEst?.ltv30 ?? 0,
            bid: ltvEst?.bidRecommendation ?? 0,
            confidence: ltvEst?.confidence ?? 'low',
        },
        seg: {
            segment5: snap?.segment?.segment5 ?? profile?.segment5 ?? 'A',
            valueTier: ctx.valueTier,
            spendTier: ctx.spendTier,
            lifecycleStage: snap?.stage?.code ?? 'S0',
            maturityBand: snap?.maturity?.band ?? 'M0',
        },
        profile: {
            skill: profile?.skillLevel,
            flow: profile?.flowState,
            frustration: profile?.frustrationLevel,
            engagement: profile?.engagement ?? profile?.metrics?.engagement,
            nearMiss: profile?.hadNearMiss,
            momentum: profile?.momentum,
        },
        commercial: {
            payerScore: ctx.payerScore,
            adFatigue: ctx.adFatigue,
            winbackActive: ctx.winbackActive ?? snap?.returning?.protectionActive,
        },
    };

    _cache = buildUnifiedSignals(raw);
    _cacheKey = key;
    _cacheTs = now;
    return _cache;
}

export function invalidateUnifiedSignalsCache() {
    _cache = null; _cacheKey = null; _cacheTs = 0;
}
