/**
 * policyArbiter.js — 跨飞轮策略协调器（增长飞轮的「大脑」）
 *
 * 输入：unifiedSignals 的统一信号快照（所有飞轮读同一份）。
 * 输出：一份**一致的指令束**（uaBid / experience / ad / offer），一次算清，互不打架。
 *
 * 决策范式（见调研）：
 *   1. 每个动作 → flywheelObjective.objectiveVector 的 {revenue,retention,experience}；
 *   2. flywheelObjective.constraints 先砍掉越界动作（flow 不插屏 / 高churn 不加压加价 …）；
 *   3. 对安全候选集用 scalarize（损失厌恶）打分排序 → 确定性最优在首位；
 *   4. coordinationBandit 在安全集内做受治理探索（默认 sealed → 用首位，不改线上）。
 *
 * 这样三飞轮在「同一信号 + 同一目标函数 + 同一约束」下决策，从机制上消除拉扯：
 *   高 churn → experience=relief + ad 抑制 + offer=retention_gift + 不加价 + 降 UA 出价
 *   付费玩家心流中 → 插屏被 payer/flow 约束砍掉，offer=none，体验中性
 */

import {
    objectiveVector,
    scalarize,
    constraints as evalConstraints,
    getObjectiveWeights,
} from './flywheelObjective.js';
import { getCoordinationBandit, contextKey } from './coordinationBandit.js';

const DOMAIN_CANDIDATES = Object.freeze({
    ad: ['none', 'rewarded', 'interstitial'],
    offer: ['none', 'first_purchase', 'retention_gift', 'dynamic_markup'],
    experience: ['neutral', 'pressure', 'relief'],
});

/** 某 domain 下，按硬约束过滤候选。 */
function _safeCandidates(domain, signals, gates) {
    const all = DOMAIN_CANDIDATES[domain] || [];
    return all.filter((choice) => {
        if (domain === 'ad' && choice === 'interstitial') return gates.allowInterstitial;
        if (domain === 'ad' && choice === 'rewarded') return gates.allowRewarded;
        if (domain === 'offer' && choice === 'dynamic_markup') return gates.allowDynamicMarkup;
        if (domain === 'experience' && choice === 'pressure') return gates.allowDifficultyPressure;
        return true;
    });
}

/**
 * 单 domain 仲裁。
 * @returns {{choice, ranked:Array<{choice,utility}>, why:string[], explored:boolean}}
 */
export function arbitrate(domain, signals, { gates, userId = '', useBandit = true } = {}) {
    const g = gates || evalConstraints(signals);
    const weights = getObjectiveWeights();
    const safe = _safeCandidates(domain, signals, g);

    const ranked = safe
        .map((choice) => ({
            choice,
            utility: scalarize(objectiveVector({ domain, choice }, signals), weights),
        }))
        .sort((x, y) => y.utility - x.utility);

    const ordered = ranked.map((r) => r.choice);
    let choice = ordered[0] ?? 'none';
    let explored = false;

    if (useBandit && ordered.length > 1) {
        // 老虎机上下文按 domain 命名空间隔离：'none' 等臂名在 ad/offer/experience
        // 三域都出现，不隔离会串台污染（仅在 bandit 放量时影响，提前修正）。
        const { arm, explored: ex } = getCoordinationBandit().select(_banditCtx(domain, signals), ordered, userId);
        if (arm) { choice = arm; explored = ex; }
    }

    const why = [...g.reasons];
    if (explored) why.push('bandit_explore');

    return { choice, ranked, why, explored };
}

/**
 * 一致 UA 出价：以统一 LTV 出价为基，按留存健康度收缩。
 * 高 churn 的脆弱 cohort 不该高价买量（与体验 relief / 变现抑制方向一致）。
 */
export function arbitrateUaBid(signals) {
    const base = Number(signals.ltvBid) || 0;
    const retentionHealth = 1 - 0.3 * Math.max(0, Math.min(1, signals.churnRisk));
    return {
        bid: +(base * retentionHealth).toFixed(2),
        baseBid: base,
        retentionHealth: +retentionHealth.toFixed(3),
    };
}

/**
 * 一次产出全飞轮一致指令束。所有子决策共享同一 signals / 约束 / 目标权重。
 *
 * @param {Object} signals  unifiedSignals 快照
 * @param {Object} [opts]   { userId, useBandit }
 */
export function coordinate(signals, opts = {}) {
    const gates = evalConstraints(signals);
    const ad = arbitrate('ad', signals, { ...opts, gates });
    const offer = arbitrate('offer', signals, { ...opts, gates });
    const experience = arbitrate('experience', signals, { ...opts, gates });
    const uaBid = arbitrateUaBid(signals);

    return {
        signals,
        gates,
        weights: getObjectiveWeights(),
        uaBid,
        ad: {
            choice: ad.choice,
            allowInterstitial: gates.allowInterstitial && ad.choice === 'interstitial',
            allowRewarded: gates.allowRewarded,
            why: ad.why,
            ranked: ad.ranked,
        },
        offer: {
            choice: offer.choice,
            allowDynamicMarkup: gates.allowDynamicMarkup && offer.choice === 'dynamic_markup',
            why: offer.why,
            ranked: offer.ranked,
        },
        experience: {
            intent: experience.choice,
            // 体验指令给 spawn 的可消费旋钮：relief 降 stress cap，pressure 抬一点
            stressCapMul: experience.choice === 'relief' ? 0.85
                : experience.choice === 'pressure' ? 1.1 : 1.0,
            why: experience.why,
            ranked: experience.ranked,
        },
    };
}

/** 老虎机上下文键：domain 命名空间 + 信号离散 key（与 arbitrate 一致）。 */
function _banditCtx(domain, signals) { return `${domain}|${contextKey(signals)}`; }

/**
 * 把一次决策的真实结果回填给 bandit（LTV 折算 reward）。
 * 由调用方在拿到 outcome（购买/留存/完播）后调用。须传与决策同一 domain。
 */
export function recordOutcome(domain, signals, choice, reward01) {
    try {
        getCoordinationBandit().update(_banditCtx(domain, signals), choice, reward01);
    } catch { /* ignore */ }
}

export { DOMAIN_CANDIDATES };
