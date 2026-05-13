/**
 * firstPurchaseFunnel.js - 付费初体验漏斗
 *
 * 追踪玩家付费转化路径，优化首充转化率
 * 与 paymentManager.js 配合
 */

import { getPlayerMaturity } from './playerMaturity.js';
import { getPlayerLifecycleStage } from './playerLifecycleDashboard.js';

const STORAGE_KEY = 'openblock_first_purchase_v1';

const PURCHASE_FUNNEL_STAGES = {
    awareness: {
        name: '认知',
        triggers: ['view_shop', 'view_product'],
        next: 'interest'
    },
    interest: {
        name: '兴趣',
        triggers: ['click_product', 'view_price'],
        next: 'consideration'
    },
    consideration: {
        name: '考虑',
        triggers: ['add_to_cart', 'start_checkout'],
        next: 'purchase'
    },
    purchase: {
        name: '购买',
        triggers: ['complete_purchase'],
        next: null
    },
    retention: {
        name: '复购',
        triggers: ['second_purchase', 'subscription'],
        next: null
    }
};

const FIRST_PURCHASE_OFFERS = {
    starter: {
        id: 'first_purchase_starter',
        price: 1,
        originalPrice: 6,
        name: '首充特惠',
        items: [
            { id: 'hint_token', count: 10 },
            { id: 'coin', count: 100 },
            { id: 'vip_days', count: 3 }
        ],
        bonus: { id: 'hint_token', count: 5 },
        triggerCondition: { daysSinceInstall: [3, 14], totalGames: [10, 100] }
    },
    value: {
        id: 'first_purchase_value',
        price: 6,
        originalPrice: 30,
        name: '超值礼包',
        items: [
            { id: 'hint_token', count: 30 },
            { id: 'coin', count: 500 },
            { id: 'bomb_token', count: 5 },
            { id: 'vip_days', count: 7 }
        ],
        bonus: { id: 'rainbow_token', count: 2 },
        triggerCondition: { daysSinceInstall: [7, 30], totalGames: [30, 200] }
    },
    premium: {
        id: 'first_purchase_premium',
        price: 30,
        originalPrice: 128,
        name: '豪华大礼包',
        items: [
            { id: 'hint_token', count: 100 },
            { id: 'coin', count: 2000 },
            { id: 'bomb_token', count: 20 },
            { id: 'rainbow_token', count: 10 },
            { id: 'skin_fragment', count: 50 },
            { id: 'vip_days', count: 30 }
        ],
        bonus: { id: 'exclusive_skin', count: 1 },
        triggerCondition: { daysSinceInstall: [14, 60], totalGames: [50, 300] }
    }
};

let _funnelDataCache = null;

function _todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getFunnelData() {
    if (_funnelDataCache) {
        return { ..._funnelDataCache };
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            _funnelDataCache = JSON.parse(raw);
            return { ..._funnelDataCache };
        }
    } catch {}

    _funnelDataCache = {
        lastUpdated: _todayYmd(),
        currentStage: 'awareness',
        stageHistory: [{ stage: 'awareness', timestamp: _todayYmd() }],
        events: [],
        purchaseHistory: [],
        firstPurchase: null,
        conversionFunnel: {
            awareness: 0,
            interest: 0,
            consideration: 0,
            purchase: 0,
            retention: 0
        }
    };
    return { ..._funnelDataCache };
}

function _saveFunnelData(data) {
    _funnelDataCache = data;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
}

export function trackFunnelEvent(eventName, metadata = {}) {
    const funnelData = getFunnelData();
    const now = _todayYmd();

    const eventEntry = {
        event: eventName,
        timestamp: now,
        metadata
    };
    funnelData.events.push(eventEntry);

    for (const [stageId, stage] of Object.entries(PURCHASE_FUNNEL_STAGES)) {
        if (stage.triggers.includes(eventName)) {
            if (stage.next && funnelData.currentStage === stageId) {
                funnelData.currentStage = stage.next;
                funnelData.stageHistory.push({ stage: stage.next, timestamp: now });
            }
            if (!funnelData.conversionFunnel[stageId]) {
                funnelData.conversionFunnel[stageId] = 0;
            }
            funnelData.conversionFunnel[stageId]++;
            break;
        }
    }

    funnelData.lastUpdated = now;
    _saveFunnelData(funnelData);

    return {
        currentStage: funnelData.currentStage,
        stageName: PURCHASE_FUNNEL_STAGES[funnelData.currentStage]?.name || '未知'
    };
}

export function recordPurchase(purchaseData) {
    const funnelData = getFunnelData();
    const now = _todayYmd();

    const purchase = {
        id: purchaseData.id || `purchase_${Date.now()}`,
        productId: purchaseData.productId,
        price: purchaseData.price,
        currency: purchaseData.currency || 'CNY',
        timestamp: now,
        isFirst: funnelData.firstPurchase === null
    };

    funnelData.purchaseHistory.push(purchase);

    if (purchase.isFirst) {
        funnelData.firstPurchase = purchase;
        trackFunnelEvent('complete_purchase', { price: purchase.price });
    } else {
        trackFunnelEvent('second_purchase', { price: purchase.price });
    }

    funnelData.lastUpdated = now;
    _saveFunnelData(funnelData);

    return purchase;
}

export function getRecommendedOffer(daysSinceInstall, totalGames) {
    const funnelData = getFunnelData();

    if (funnelData.firstPurchase) {
        return {
            available: false,
            reason: '已完成首充',
            nextOffer: getRePurchaseOffer(funnelData.purchaseHistory)
        };
    }

    const offers = Object.values(FIRST_PURCHASE_OFFERS);

    for (const offer of offers) {
        const [minDays, maxDays] = offer.triggerCondition.daysSinceInstall;
        const [minGames, maxGames] = offer.triggerCondition.totalGames;

        if (daysSinceInstall >= minDays && daysSinceInstall <= maxDays &&
            totalGames >= minGames && totalGames <= maxGames) {
            return {
                available: true,
                offer,
                reason: `满足 ${minDays}-${maxDays}天，${minGames}-${maxGames}局 条件`
            };
        }
    }

    return { available: false, reason: '暂未满足触发条件' };
}

function getRePurchaseOffer(purchaseHistory) {
    const lastPurchase = purchaseHistory[purchaseHistory.length - 1];
    if (!lastPurchase) return null;

    const daysSinceLastPurchase = _daysSince(lastPurchase.timestamp);

    if (daysSinceLastPurchase >= 7) {
        return {
            type: 'weekly_return',
            discount: 0.5,
            message: '回来啦！给您准备了回归特惠'
        };
    }

    if (lastPurchase.price < 6) {
        return {
            type: 'upgrade',
            discount: 0.3,
            message: '升级您的购物体验'
        };
    }

    return null;
}

function _daysSince(timestamp) {
    const [y, m, d] = timestamp.split('-').map(Number);
    const purchaseDate = new Date(y, m - 1, d);
    const today = new Date();
    return Math.floor((today - purchaseDate) / (1000 * 60 * 60 * 24));
}

export function getFunnelAnalytics() {
    const funnelData = getFunnelData();
    const totalEvents = funnelData.events.length;

    const stageConversion = {};
    let prevStage = null;
    for (const [stageId, stage] of Object.entries(PURCHASE_FUNNEL_STAGES)) {
        const count = funnelData.conversionFunnel[stageId] || 0;
        if (prevStage) {
            const prevCount = funnelData.conversionFunnel[prevStage] || 1;
            stageConversion[stageId] = Math.round((count / prevCount) * 100);
        } else {
            stageConversion[stageId] = count > 0 ? 100 : 0;
        }
        prevStage = stageId;
    }

    const firstPurchase = funnelData.firstPurchase;
    const hasSecondPurchase = funnelData.purchaseHistory.length > 1;

    return {
        currentStage: funnelData.currentStage,
        stageName: PURCHASE_FUNNEL_STAGES[funnelData.currentStage]?.name || '未知',
        totalEvents,
        stageConversion,
        conversionRate: firstPurchase ? Math.round((funnelData.purchaseHistory.length / totalEvents) * 100) : 0,
        firstPurchasePrice: firstPurchase?.price || null,
        hasSecondPurchase,
        purchaseCount: funnelData.purchaseHistory.length,
        totalRevenue: funnelData.purchaseHistory.reduce((sum, p) => sum + (p.price || 0), 0)
    };
}

export function invalidateFunnelCache() {
    _funnelDataCache = null;
}

/**
 * v1.49.x P3-3：首充时机优化（规则版）。
 *
 * 在玩家"自信高 + 心流稳 + 处于推荐 offer 触发窗口"时返回 trigger=true，
 * 让 lifecycleOrchestrator 主动 emit lifecycle:offer_available。
 *
 * 规则：
 *   - 没有 firstPurchase
 *   - 命中 getRecommendedOffer.available
 *   - confidence ≥ 0.55  且  flowState ≥ 0.50  且  frustrationLevel ≤ 0.40
 *
 * 命中后给出 score = 0.5 + 0.3 * confidence + 0.2 * flowState（钳到 [0,1]），
 * 用作 push / Toast 排序的优先级权重。
 *
 * 仍保留接口给 RL 注入（setFirstPurchaseTimingPolicy）；规则版作为 fallback。
 */
let _firstPurchaseTimingPolicy = null;

export function evaluateFirstPurchaseTimingSignal(input = {}) {
    const daysSinceInstall = Number(input.daysSinceInstall ?? 0);
    const totalGames = Number(input.totalGames ?? 0);
    const confidence = Number(input.confidence ?? 0);
    const flowState = Number(input.flowState ?? 0);
    const frustrationLevel = Number(input.frustrationLevel ?? 0);

    if (typeof _firstPurchaseTimingPolicy === 'function') {
        try {
            const r = _firstPurchaseTimingPolicy({ daysSinceInstall, totalGames, confidence, flowState, frustrationLevel });
            if (r && typeof r === 'object') {
                return {
                    trigger: !!r.trigger,
                    reason: r.trigger ? (r.reason || 'policy') : null,
                    score: Math.max(0, Math.min(1, Number(r.score ?? 0))),
                    recommendedOfferId: r.recommendedOfferId ?? null,
                };
            }
        } catch { /* fallthrough */ }
    }

    const recommended = getRecommendedOffer(daysSinceInstall, totalGames);
    if (!recommended.available) {
        return { trigger: false, reason: null, score: 0, recommendedOfferId: null };
    }

    const confidenceOk = confidence >= 0.55;
    const flowOk = flowState >= 0.50;
    const frustOk = frustrationLevel <= 0.40;
    const trigger = confidenceOk && flowOk && frustOk;
    const score = Math.max(0, Math.min(1, 0.5 + 0.3 * confidence + 0.2 * flowState));
    return {
        trigger,
        reason: trigger ? 'rule' : null,
        score,
        recommendedOfferId: trigger ? recommended.offer?.id ?? null : null,
    };
}

/** 注入 RL/远端策略；传入 null 恢复规则版。 */
export function setFirstPurchaseTimingPolicy(fn) {
    _firstPurchaseTimingPolicy = typeof fn === 'function' ? fn : null;
}