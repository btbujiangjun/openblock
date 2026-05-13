/**
 * lifecycleOrchestrator.js — 生命周期"编排层"（接线员）
 *
 * 把分散的 retention 模块（churnPredictor / winbackProtection /
 * shouldTriggerIntervention）通过统一的会话钩子接到 `game.js` 的 startGame /
 * endGame，并通过 `MonetizationBus` 广播 `lifecycle:*` 事件，让推送 / 弹窗 /
 * 商业化模块订阅。
 *
 * 设计约束：
 *
 *   - **接线员模式**：本文件不实现新业务逻辑，只把"上层数据触发"翻译成"下层
 *     模块动作 + 总线事件"；读 lifecycleSignals 数据层、写 retention 模块。
 *   - **失败软化**：所有 retention 模块调用都包 try/catch，单点故障不阻塞主流程；
 *     localStorage 在小程序 / 隐私模式下可能不可用。
 *   - **可关闭**：通过 GAME_RULES.lifecycleOrchestration.enabled 控制（默认 on）；
 *     与商业化 / 自适应难度可独立灰度。
 *
 * 事件契约（emit 到 MonetizationBus；权威源为
 * `docs/architecture/MONETIZATION_EVENT_BUS_CONTRACT.md`）：
 *
 *   - `lifecycle:session_start` { snapshot, winback }
 *   - `lifecycle:session_end`   { snapshot, churnUpdate, churnLevel, winback,
 *                                 earlyWinback, firstPurchaseSignal, interventions }
 *   - `lifecycle:intervention`  { type, priority, content, reason, snapshot }
 *   - `lifecycle:offer_available` { type, reason, priority?, recommendedOfferId? }
 *       多路 emit；type ∈ { first_purchase_window, early_winback }
 *   - `lifecycle:early_winback` { reason, score, signals, snapshot }
 */

import { emit as busEmit } from '../monetization/MonetizationBus.js';
import {
    getUnifiedLifecycleSnapshot,
    invalidateLifecycleSnapshotCache,
} from './lifecycleSignals.js';
import {
    activateWinback,
    consumeProtectedRound,
    evaluateEarlyWinbackSignal,
    getActivePreset,
    getWinbackStatus,
} from '../retention/winbackProtection.js';
import { buildPlayerAbilityVector } from '../playerAbilityModel.js';
import {
    evaluateFirstPurchaseTimingSignal,
    getFunnelData,
} from '../retention/firstPurchaseFunnel.js';
import { getFlag } from '../monetization/featureFlags.js';
import {
    recordSessionMetrics,
    getChurnData,
    getChurnRiskLevel,
} from '../retention/churnPredictor.js';
import {
    shouldTriggerIntervention,
    getInterventionContent,
} from '../retention/playerLifecycleDashboard.js';
import { getCommercialChurnRisk01 } from '../monetization/commercialModel.js';
import {
    getCommercialModelContext,
    updateRealtimeSignals,
} from '../monetization/personalization.js';
import { getAdFreqSnapshot } from '../monetization/adTrigger.js';
import { updateMaturity } from '../retention/playerMaturity.js';

let _enabled = true;

/**
 * 全局开关（供 GAME_RULES.lifecycleOrchestration.enabled 灰度 / 单测关闭）。
 */
export function setLifecycleOrchestrationEnabled(enabled) {
    _enabled = !!enabled;
}

export function isLifecycleOrchestrationEnabled() {
    return _enabled;
}

function _safe(fn, label) {
    try { return fn(); } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[lifecycle] ${label} failed:`, e?.message || e);
        return null;
    }
}

/**
 * 会话开始钩子：在 `game.js → startGame()` 中调用。
 *
 *   1. 检查是否符合 winback 触发条件（≥7 天未活跃 + 未在保护期），若是则
 *      激活并写入 localStorage、上报 analytics 事件
 *   2. 失效 lifecycleSignals 缓存（installTs / lastSessionEndTs 可能变化）
 *   3. 广播 `lifecycle:session_start`，让商业化 / 推送等模块拿到 snapshot
 *
 * @param {import('../playerProfile.js').PlayerProfile} profile
 * @param {{ tracker?: object }} [opts]
 * @returns {{ snapshot:object|null, winback:object|null }}
 */
export function onSessionStart(profile, { tracker = null } = {}) {
    if (!_enabled || !profile) return { snapshot: null, winback: null };
    invalidateLifecycleSnapshotCache();
    const snapshot = _safe(() => getUnifiedLifecycleSnapshot(profile), 'snapshot');

    let winback = null;
    if (snapshot?.returning?.isWinbackCandidate) {
        winback = _safe(
            () => activateWinback(profile.lifecyclePayload, { tracker }),
            'activateWinback'
        );
    }

    _safe(() => busEmit('lifecycle:session_start', { snapshot, winback }), 'emit_session_start');
    return { snapshot, winback };
}

/**
 * 会话结束钩子：在 `game.js → endGame()` 内的 `recordSessionEnd` 之后调用。
 *
 *   1. 把本局会话指标写入 churnPredictor，让"近 7 天 vs 前 7 天"的下降率有数据
 *   2. 消耗一轮 winback 保护（如果在保护期内），到达 PROTECTED_ROUNDS 后自动退出
 *   3. 失效 lifecycleSignals 缓存
 *   4. 计算 shouldTriggerIntervention，命中则广播 `lifecycle:intervention`
 *   5. 广播 `lifecycle:session_end`
 *
 * @param {import('../playerProfile.js').PlayerProfile} profile
 * @param {{ score:number, durationMs?:number, clears?:number, placements?:number, misses?:number }} sessionResult
 * @param {{ tracker?: object }} [opts]
 * @returns {{ snapshot:object|null, churnUpdate:object|null, winback:object|null, interventions:Array }}
 */
export function onSessionEnd(profile, sessionResult, { tracker = null } = {}) {
    if (!_enabled || !profile) {
        return { snapshot: null, churnUpdate: null, winback: null, interventions: [] };
    }

    const score = Number(sessionResult?.score) || 0;
    const durationMs = Number(sessionResult?.durationMs) || 0;
    const placements = Number(sessionResult?.placements) || 0;
    const misses = Number(sessionResult?.misses) || 0;

    /* engagement 0..1：综合时长（5 分钟饱和）+ 无失误率（miss/place 越低越高）。
     * 与 churnPredictor 的 engagement 字段语义对齐——它本来期望调用方传 [0,1]，
     * 但全仓没有任何写入方，导致 weight=0.2 的 engagement 项永远是默认 0.5。 */
    const engagement = Math.max(0, Math.min(1,
        0.6 * Math.min(1, durationMs / 300_000)
        + 0.4 * (placements > 0 ? 1 - Math.min(1, misses / Math.max(1, placements)) : 0.5)
    ));

    const churnUpdate = _safe(() => recordSessionMetrics({
        sessionCount: 1,
        duration: durationMs,
        score,
        engagement,
    }), 'recordSessionMetrics');

    /* v1.49.x P0-4：每会话结束后真正调 updateMaturity，让"成熟度家族"产出
     * 实时 skillScore / valueScore / band / churnRisk 标签。
     *
     * 历史问题：updateMaturity 在生产代码无任何调用方（仅单测调用），导致：
     *   - getMaturityInsights() 永远返回首次安装时的 L1/M0 / skillScore=0 默认值
     *   - playerLifecycleDashboard 的 lifecycle×maturity 矩阵永远落在 (S?, M0)
     *   - lifecycleSignals.churn.sources.maturity 永远是 'unknown' → 投票空腿
     *   - playerInsightPanel 的 maturity 区域永远空
     *
     * 这里在每个 sessionEnd 把"本局表现 + 累计支付 + 装机天数"喂给 updateMaturity，
     * 让历史 trace 真按局累积。失败软化：updateMaturity 内部已包 try/catch。 */
    const placedRatio = placements > 0 ? Math.min(1, (placements - misses) / placements) : 0;
    _safe(() => updateMaturity({
        sessionCount: 1,
        lastDuration: durationMs,
        avgDuration: durationMs,
        returnFrequency: 1,
        featureAdoption: placedRatio,
        /* maxLevel 在 maturity 模型里只是上限指标，方块消除游戏没有"等级"概念；
         * 用 score 作为代理（>0 时映射到 1..N 段），让阈值条件不会全 0。 */
        maxLevel: Math.max(0, Math.floor(score / 1000)),
        totalScore: score,
        achievementCount: 0,
        /* lifetimeSpend / lifetimeAdImpressions 当前 PlayerProfile 没有累计字段，
         * Phase 2 的"动态定价矩阵"会引入；此处先传 0 占位，等 P1-3 / P2-5 接通后再回写。 */
        totalSpend: 0,
        adExposureCount: 0,
        daysSinceInstall: profile.daysSinceInstall ?? 0,
        retainedDays: profile.daysSinceInstall ?? 0,
    }), 'updateMaturity');

    const winback = _safe(() => consumeProtectedRound({
        tracker,
        survived: !sessionResult?.gameOver,
        score,
    }), 'consumeProtectedRound');

    invalidateLifecycleSnapshotCache();

    const churnData = _safe(() => getChurnData(), 'getChurnData');
    const predictorRisk01 = churnData?.lastRisk != null
        ? Number(churnData.lastRisk) / 100
        : null;

    /* v1.49.x P0-2：补齐 commercial 那条腿。
     *
     * commercialModel.churnRisk 看 segment + frustration + adFatigue + flowState，
     * 与 churnPredictor（事件驱动）/ playerMaturity（技能斜率）正交；三腿齐全后
     * unifiedRisk 才是"事件 + 技能 + 体感"的真完整投票。
     *
     * 此处仅做"读快照 + 算 vector"的纯函数路径，无网络 / 副作用；失败软化为 null
     * 后由 lifecycleSignals 退化到双腿投票（不至于把整个事件链炸掉）。 */
    const commercialChurnRisk01 = _safe(() => {
        try { updateRealtimeSignals(profile); } catch {}
        const ctx = getCommercialModelContext() ?? {};
        const adFreq = getAdFreqSnapshot() ?? {};
        return getCommercialChurnRisk01({ ...ctx, adFreq });
    }, 'commercialChurnRisk01');

    const snapshot = _safe(
        () => getUnifiedLifecycleSnapshot(profile, { predictorRisk01, commercialChurnRisk01 }),
        'snapshot'
    );

    /* 干预触发：把 dashboard 的 shouldTriggerIntervention 喂上"成熟度 insights"
     * 需要的扁平 playerData（totalSessions / totalSpend / daysAsPlayer）。 */
    const interventions = [];
    const triggers = _safe(() => shouldTriggerIntervention({
        ...profile.lifecyclePayload,
        // dashboard.shouldTriggerIntervention 内会再 getMaturityInsights() 拿 totalSpend / daysAsPlayer，
        // 这里不需要重复传入，但保留 totalSessions 作为兜底
        totalSessions: profile.totalSessions,
    }), 'shouldTriggerIntervention');
    if (Array.isArray(triggers) && triggers.length > 0) {
        for (const t of triggers) {
            const content = _safe(() => getInterventionContent(t.type), 'interventionContent');
            const payload = { ...t, content, snapshot };
            interventions.push(payload);
            _safe(() => busEmit('lifecycle:intervention', payload), 'emit_intervention');
        }
    }

    /* v1.49.x P3-3：首充时机优化（规则版）。
     *
     * 在 sessionEnd 时检查玩家"是否首充未完成 + 处于推荐 offer 窗口 + abilityVector
     * 显示自信高/心流稳/沮丧低"——命中即 emit lifecycle:offer_available，让 Toast /
     * push 立即介入；funnelData.firstPurchase 已有则跳过。 */
    let firstPurchaseSignal = null;
    if (snapshot && getFlag('firstPurchaseTiming')) {
        firstPurchaseSignal = _safe(() => {
            const funnel = getFunnelData?.();
            if (funnel?.firstPurchase) return null;
            const ability = buildPlayerAbilityVector(profile);
            return evaluateFirstPurchaseTimingSignal({
                daysSinceInstall: profile?.daysSinceInstall ?? 0,
                totalGames: profile?.totalSessions ?? profile?.lifetimeGames ?? 0,
                confidence: ability?.confidence,
                flowState: profile?.metrics?.flowState,
                frustrationLevel: profile?.metrics?.frustrationLevel,
            });
        }, 'evaluateFirstPurchaseTimingSignal');

        if (firstPurchaseSignal?.trigger) {
            _safe(() => busEmit('lifecycle:offer_available', {
                type: 'first_purchase_window',
                reason: firstPurchaseSignal.reason,
                priority: 0.55 + 0.45 * firstPurchaseSignal.score,
                recommendedOfferId: firstPurchaseSignal.recommendedOfferId,
            }), 'emit_offer_available_first_purchase');
        }
    }

    /* v1.49.x P3-1：confidence 衰减 → 提前 winback 信号。
     *
     * 使用本局结束时的 abilityVector.confidence + frustrationLevel + missRate 评估，
     * 命中后 emit `lifecycle:early_winback` + `lifecycle:offer_available`，让 push /
     * offer / Toast 三路提前介入；同时不直接 activateWinback 以免与 7 天保护包冲突。
     *
     * RL/远端策略可通过 setEarlyWinbackPolicy 注入；规则版作为 fallback。 */
    let earlyWinback = null;
    if (snapshot && !snapshot?.returning?.protectionActive) {
        earlyWinback = _safe(() => {
            const ability = buildPlayerAbilityVector(profile);
            return evaluateEarlyWinbackSignal({
                confidence: ability?.confidence,
                frustrationLevel: profile?.metrics?.frustrationLevel,
                missRate: profile?.metrics?.missRate,
                daysSinceLastActive: profile?.daysSinceLastActive ?? snapshot?.returning?.daysSinceLastActive ?? 0,
            });
        }, 'evaluateEarlyWinbackSignal');

        if (earlyWinback?.trigger) {
            _safe(() => busEmit('lifecycle:early_winback', {
                reason: earlyWinback.reason,
                score: earlyWinback.score,
                signals: earlyWinback.signals,
                snapshot,
            }), 'emit_early_winback');
            _safe(() => busEmit('lifecycle:offer_available', {
                type: 'early_winback',
                reason: earlyWinback.reason,
                priority: 0.6 + 0.4 * earlyWinback.score,
            }), 'emit_offer_available_early_winback');
        }
    }

    _safe(() => busEmit('lifecycle:session_end', {
        snapshot,
        churnUpdate,
        churnLevel: churnUpdate?.risk != null
            ? getChurnRiskLevel(churnUpdate.risk)
            : 'stable',
        winback,
        earlyWinback,
        firstPurchaseSignal,
        interventions,
    }), 'emit_session_end');

    return { snapshot, churnUpdate, winback, earlyWinback, firstPurchaseSignal, interventions };
}

/**
 * 出块层使用的"winback 保护垫"读取入口；adaptiveSpawn 直接 import 这一个函数，
 * 避免直接 import winbackProtection（保持单向依赖：spawn 层 → lifecycle 层）。
 *
 * @returns {?{ stressCap:number, clearGuaranteeBoost:number, sizePreferenceShift:number, hintCoupons:number, reviveTokens:number }}
 */
export function getActiveWinbackPreset() {
    return _safe(() => getActivePreset(), 'getActivePreset');
}

export function getWinbackProtectionStatus() {
    return _safe(() => getWinbackStatus(), 'getWinbackStatus');
}
