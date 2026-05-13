/**
 * lifecycleAwareOffers.js — 商业化"生命周期感知"策略层
 *
 * 落地 v1.48 (2026-05) 架构第三步：在统一数据层（lifecycleSignals）+ 编排层
 * （lifecycleOrchestrator）之上，按"商业化业务需求"消费这些数据：
 *
 *   - 订阅 `lifecycle:session_end` —— 把本局得分喂给 vipSystem 累计 lifetimeScore
 *   - 订阅 `lifecycle:session_start` —— 根据 daysSinceInstall + totalGames 触发
 *     首充漏斗 / 复购促销，把 firstPurchaseFunnel 的"已实装但孤立"模块接进来
 *   - 订阅 `lifecycle:session_end` —— 三套 churnRisk 已被 lifecycleSignals 归一，
 *     这里只看 unifiedRisk，避免商业化模块自己再次决策"信哪一套"
 *
 * 接线方式：在 `monetization/index.js → initMonetization()` 调用 `attach()`，
 * 模块自身订阅 MonetizationBus，与 game 主流程完全解耦；通过 feature flag
 * `GAME_RULES.lifecycleOrchestration.commercialAdapter`（默认 on）开关。
 *
 * 与 commercialModel.js 的关系：
 *   - commercialModel：实时（每帧）报价决策，看 frustration / flowState / segment
 *   - lifecycleAwareOffers：跨日（每会话）促销触发，看 stage / band / 沉默天数
 *   两者互补；前者管"现在能不能弹"，后者管"这局结束后该不该送一张优惠券"。
 */

import { on, emit } from './MonetizationBus.js';
import { getRecommendedOffer, recordPurchase } from '../retention/firstPurchaseFunnel.js';
import { updateVipScore } from '../retention/vipSystem.js';
import { getPaymentManager } from './paymentManager.js';
import { getAnalyticsTracker } from './analyticsTracker.js';

/* v1.49.x P0-1：购买金额 → VIP 经验的转换系数。
 * 设计：1 RMB → 100 VIP 分；vipSystem 的等级阈值是 1k/5k/20k/50k/100k，
 * 即首次 ¥1 starter_pack 拿 100 分（仍在 V0），¥30 大礼包 3000 分（贴近 V1=1000 阈值）。
 * 与传统手游"¥1=1 钻=100 VIP 经验"对齐，便于后续接入服务端校对。 */
const VIP_SCORE_PER_RMB = 100;

let _attached = false;
let _unsubscribers = [];

/**
 * 把 lifecycleAwareOffers 接到 MonetizationBus；幂等。
 *
 * @returns {() => void} 卸载函数
 */
export function attachLifecycleAwareOffers() {
    if (_attached) return detachLifecycleAwareOffers;
    _attached = true;

    const unsubStart = on('lifecycle:session_start', _onSessionStart);
    const unsubEnd = on('lifecycle:session_end', _onSessionEnd);
    const unsubPurchase = on('purchase_completed', _onPurchaseCompleted);

    _unsubscribers = [unsubStart, unsubEnd, unsubPurchase];
    return detachLifecycleAwareOffers;
}

export function detachLifecycleAwareOffers() {
    _unsubscribers.forEach((u) => { try { u?.(); } catch {} });
    _unsubscribers = [];
    _attached = false;
}

/**
 * 会话开始：根据玩家阶段触发首充 / 复购 / 回流促销。
 *
 * 触发逻辑：
 *   - 已首充 → 看 firstPurchaseFunnel.getRePurchaseOffer，≥7 天未购则触发
 *     `weekly_return` 限时折扣（由 paymentManager.triggerOffer 写入 localStorage）
 *   - 未首充且 daysSinceInstall ≥ 1 且 totalSessions ≥ 3 → 推首充包
 *   - winback candidate（≥7 天未活跃）→ paymentManager 已有的 `winback_user` 触发
 *
 * 命中后 emit `lifecycle:offer_available` 让弹窗 / banner / 推送订阅。
 */
function _onSessionStart({ data }) {
    const snapshot = data?.snapshot;
    if (!snapshot) return;

    const offer = _safe(() => getRecommendedOffer(
        snapshot.install.daysSinceInstall,
        snapshot.install.totalSessions,
    ), 'firstPurchaseFunnel.getRecommendedOffer');

    const pm = _safe(() => getPaymentManager(), 'getPaymentManager');

    /* 沉默回流促销：daysSinceLastActive ≥ 7 → winback_user offer
     * paymentManager.triggerOffer 是幂等的（offerKey 时效内不会重复触发）。
     *
     * v1.49.x P0-1：第三参数从 `daysSinceInstall`（错的）改为 `daysSinceLastActive`，
     * 与 paymentManager.LIMITED_OFFERS.winback_user.triggerCondition 的实际参数语义一致。 */
    if (snapshot.returning.isWinbackCandidate && pm) {
        _safe(() => pm.triggerOffer('winback_user', [], snapshot.returning.daysSinceLastActive),
            'triggerOffer.winback_user');
        emit('lifecycle:offer_available', {
            type: 'winback_user',
            stage: snapshot.stage.code,
            band: snapshot.maturity.band,
            reason: `沉默 ${snapshot.returning.daysSinceLastActive} 天回流`,
        });
    }

    /* 首充漏斗：未首充且满足 daysSinceInstall × totalSessions 区间 */
    if (offer?.available && offer.offer) {
        emit('lifecycle:offer_available', {
            type: 'first_purchase',
            stage: snapshot.stage.code,
            band: snapshot.maturity.band,
            offer: offer.offer,
            reason: offer.reason,
        });
    } else if (offer && !offer.available && offer.nextOffer) {
        /* 已首充：根据上次购买间隔推复购 */
        if (pm) {
            _safe(() => pm.triggerOffer('returning_user', [], snapshot.install.daysSinceInstall),
                'triggerOffer.returning_user');
        }
        emit('lifecycle:offer_available', {
            type: offer.nextOffer.type,
            stage: snapshot.stage.code,
            band: snapshot.maturity.band,
            offer: offer.nextOffer,
            reason: '上次购买后超 7 天复购窗口',
        });
    }
}

/**
 * 会话结束：把本局得分累加到 vipSystem 的 lifetimeScore。
 *
 * 此前 vipSystem.updateVipScore 在生产代码无任何调用，VIP 等级永远是初始 V0。
 * 这是该模块第一个真实数据写入点。
 *
 * 跨阶段流失提示：snapshot.churn.unifiedRisk 是三套 churnRisk 归一后的标量；
 * 这里 ≥0.5（high+）时再 emit `lifecycle:churn_high` 让推送 / 任务系统订阅
 * 决定是否发"回归任务"。
 */
function _onSessionEnd({ data }) {
    const snapshot = data?.snapshot;
    const churnLevel = data?.churnLevel;
    if (!snapshot) return;

    const score = Number(data?.churnUpdate?.signals?.[0]?.value) // 优先 churn 写入的当日分
        || snapshot.install.totalPlacements; // 退化：无分时用累计放置数兜底
    if (score > 0) {
        _safe(() => updateVipScore(score), 'updateVipScore');
    }

    if ((snapshot.churn?.unifiedRisk ?? 0) >= 0.5 || churnLevel === 'high' || churnLevel === 'critical') {
        emit('lifecycle:churn_high', {
            level: churnLevel || snapshot.churn.level,
            unifiedRisk: snapshot.churn.unifiedRisk,
            sources: snapshot.churn.sources,
            stage: snapshot.stage.code,
            band: snapshot.maturity.band,
        });
    }
}

/**
 * IAP 完成时三路接线：把购买真正写入留存 + VIP + 分析三个系统。
 *
 * v1.49.x P0-1 之前 `_onPurchaseCompleted` 只调 firstPurchaseFunnel.recordPurchase，
 * 而且事件名不匹配（iapAdapter 只 emit `iap_purchase`），所以 0 调用、漏斗永远空。
 * 现在的接线：
 *
 *   1. firstPurchaseFunnel.recordPurchase  —— 推进首充→复购漏斗（含 isFirst 标记）
 *   2. vipSystem.updateVipScore(price * K)  —— 让 VIP 经验真按购买金额累加
 *      与 `_onSessionEnd` 的"分数累加"形成"会话 + 购买"双源 VIP 涨经验
 *   3. paymentManager.recordPurchase(productId, { isFirstPurchase, ... })
 *      —— 触发首充奖励（钱包 +5 hint）+ "之前购过"等促销
 *   4. analyticsTracker.trackEvent('iap_purchase', { productId, price, ... })
 *      —— 进 IAP 分析事件流，让 funnels.PURCHASE 漏斗 step5 命中
 *
 * 失败软化：每一路都包 _safe，单点故障不阻塞其他三路。
 *
 * 期望载荷（iapAdapter v1.49.x 起）：
 *   { productId, product, price, currency, transactionId, timestamp }
 */
function _onPurchaseCompleted({ data }) {
    if (!data?.productId) return;

    const recorded = _safe(() => recordPurchase(data), 'firstPurchaseFunnel.recordPurchase');
    const isFirst = !!recorded?.isFirst;
    const price = Number(data.price) || 0;

    if (price > 0) {
        _safe(() => updateVipScore(Math.round(price * VIP_SCORE_PER_RMB)), 'updateVipScore.purchase');
    }

    const pm = _safe(() => getPaymentManager(), 'getPaymentManager');
    if (pm) {
        _safe(() => pm.recordPurchase(data.productId, {
            isFirstPurchase: isFirst,
            price,
            currency: data.currency || 'CNY',
            transactionId: data.transactionId || '',
            provider: data.provider || 'stub',
        }), 'paymentManager.recordPurchase');
    }

    _safe(() => getAnalyticsTracker().trackEvent('iap_purchase', {
        productId: data.productId,
        price,
        currency: data.currency || 'CNY',
        isFirst,
        transactionId: data.transactionId || '',
    }), 'analyticsTracker.trackEvent.iap_purchase');

    /* 让 UI 层（offerToast / hudBadge）知道发生了首充，以触发首充祝贺特效。
     * 与 commercialModel 的实时 IAP 推送解耦，避免再嵌一层订阅。 */
    if (isFirst) {
        emit('lifecycle:first_purchase', {
            productId: data.productId,
            price,
            currency: data.currency || 'CNY',
        });
    }
}

function _safe(fn, label) {
    try { return fn(); } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[lifecycleAwareOffers] ${label} failed:`, e?.message || e);
        return null;
    }
}

export function isLifecycleAwareOffersAttached() {
    return _attached;
}
