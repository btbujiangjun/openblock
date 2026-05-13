/**
 * lifecycleOutreach.js — lifecycle 事件 → 推送 / 分享 / 邀请系统适配器
 *
 * v1.49.x P2-2：把 lifecycle:* 事件接到既有的"孤儿"模块（pushNotificationSystem /
 * shareCardGenerator / inviteRewardSystem），让它们终于跑起来。
 *
 * 之前现状：
 *   - pushNotificationSystem.trigger / scheduleNotification 已实现完整模板，
 *     但全仓 0 调用，CHURN_WARNING / FIRST_PURCHASE_WINDOW 推送永远不发
 *   - shareCardGenerator.getShareCardGenerator() 已实现，但 lifecycle:first_purchase
 *     等关键节点没有人主动生成"首充庆祝卡片"
 *   - inviteRewardSystem 在玩家高互动时段无任何主动提示，邀请漏斗顶层窄
 *
 * 接线规则：
 *   - lifecycle:churn_high          → push.trigger(CHURN_WARNING)
 *   - lifecycle:first_purchase      → push.trigger(SUBSCRIPTION_EXPIRE 等场景占位 + 生成首充分享卡)
 *   - lifecycle:offer_available     → push.trigger(LIMITED_OFFER)
 *
 * 失败软化：每路 try/catch；未导入的孤儿模块跳过；feature flag `pushNotifications` 控制。
 */

import { on } from './MonetizationBus.js';
import { getFlag } from './featureFlags.js';

let _attached = false;
let _unsubscribers = [];
let _pushSystem = null;

async function _ensurePushSystem() {
    if (_pushSystem) return _pushSystem;
    if (!getFlag('pushNotifications')) return null;
    try {
        const mod = await import('./pushNotificationSystem.js');
        _pushSystem = mod.getPushNotificationSystem?.();
        if (_pushSystem && typeof _pushSystem.init === 'function') {
            try { _pushSystem.init(); } catch {}
        }
    } catch { /* 模块不可用时静默 */ }
    return _pushSystem;
}

async function _trigger(eventType, context) {
    const sys = await _ensurePushSystem();
    if (!sys) return;
    try { sys.trigger(eventType, context || {}); } catch {}
}

function _onChurnHigh({ data }) {
    void _trigger('churn_warning', {
        level: data?.level,
        unifiedRisk: data?.unifiedRisk,
    });
}

function _onFirstPurchase({ data }) {
    /* 首充庆祝：尝试生成分享卡片（如果 shareCardGenerator 可用），同时 push 一条"感谢"提示。 */
    void _trigger('high_score', {
        score: data?.price ?? 0,
        title: '感谢首充！',
    });
    void (async () => {
        try {
            const mod = await import('./shareCardGenerator.js');
            const g = mod.getShareCardGenerator?.();
            if (g && typeof g.generate === 'function') {
                g.generate({
                    template: 'first_purchase',
                    title: '我的首充已解锁！',
                    productId: data?.productId,
                });
            }
        } catch { /* shareCardGenerator 未导入或 API 不一致时静默 */ }
    })();
}

function _onOfferAvailable({ data }) {
    void _trigger('limited_offer', {
        type: data?.type,
        reason: data?.reason,
    });
}

export function attachLifecycleOutreach() {
    if (_attached) return detachLifecycleOutreach;
    _attached = true;
    _unsubscribers = [
        on('lifecycle:churn_high', _onChurnHigh),
        on('lifecycle:first_purchase', _onFirstPurchase),
        on('lifecycle:offer_available', _onOfferAvailable),
    ];
    return detachLifecycleOutreach;
}

export function detachLifecycleOutreach() {
    _unsubscribers.forEach((u) => { try { u?.(); } catch {} });
    _unsubscribers = [];
    _attached = false;
    _pushSystem = null;
}

export function isLifecycleOutreachAttached() {
    return _attached;
}
