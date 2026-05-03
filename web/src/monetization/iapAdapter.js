/**
 * IAP（应用内购买）适配层（OPT-02）
 *
 * 设计：
 *   - 统一产品目录 + 购买状态持久化
 *   - 默认存根模式：弹出确认对话框模拟支付
 *   - 真实 SDK（Stripe Web / Apple IAP JS / Google Play Billing）通过 setIapProvider 热替换
 *   - 购买成功后触发 'iap_purchase' 事件（通过 MonetizationBus.emit）
 */

import { getFlag } from './featureFlags.js';
import { emit } from './MonetizationBus.js';
import { setAdsRemoved } from './adAdapter.js';
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';

const STORAGE_KEY = 'openblock_mon_purchases_v1';

/** 产品目录 */
export const PRODUCTS = {
    // ── 基础商品 ──────────────────────────────────────────────────────────────
    remove_ads: {
        id: 'remove_ads',
        name: '移除广告',
        desc: '永久关闭所有插屏与 Banner 广告',
        price: '¥18',
        priceNum: 18,
        type: 'one_time',
        tag: null,
    },
    hint_pack_5: {
        id: 'hint_pack_5',
        name: '提示包 ×5',
        desc: '获得 5 次步骤提示',
        price: '¥6',
        priceNum: 6,
        type: 'consumable',
        qty: 5,
        tag: null,
    },
    // ── 订阅 ──────────────────────────────────────────────────────────────────
    weekly_pass: {
        id: 'weekly_pass',
        name: '周卡',
        desc: '7 天每日奖励翻倍',
        price: '¥12',
        priceNum: 12,
        type: 'subscription',
        durationDays: 7,
        tag: null,
    },
    monthly_pass: {
        id: 'monthly_pass',
        name: '月卡',
        desc: '30 天每日奖励翻倍 + 专属标识',
        price: '¥28',
        priceNum: 28,
        type: 'subscription',
        durationDays: 30,
        tag: '推荐',
    },
    annual_pass: {
        id: 'annual_pass',
        name: '年度通行证',
        desc: '365天每日奖励翻倍 + 全皮肤解锁 + 永久去广告',
        price: '¥88',
        priceNum: 88,
        type: 'subscription',
        durationDays: 365,
        tag: '超值',
    },
    // ── 礼包（首购引导 + 限时折扣） ───────────────────────────────────────────
    starter_pack: {
        id: 'starter_pack',
        name: '🎁 新手礼包',
        desc: '提示×3 + 皮肤 1 款（仅首次购买可用）',
        price: '¥3',        // 低门槛首购引导
        priceNum: 3,
        type: 'one_time',
        firstPurchaseOnly: true,  // 首购限定
        tag: '限购',
    },
    weekly_pass_discount: {
        id: 'weekly_pass_discount',
        name: '⚡ 限时周卡',
        desc: '7天每日奖励翻倍，限时7折特惠（48小时内有效）',
        price: '¥8',
        priceNum: 8,
        type: 'limited_time',
        durationDays: 7,
        expireHours: 48,    // 礼包本身在48h内可购买
        tag: '7折',
    },
};

let _provider = null;

/**
 * @typedef {Object} IapProvider
 * @property {(productId: string) => Promise<{ success: boolean, receipt?: string }>} purchase
 *   发起购买；失败时 resolve({success:false})，不应 reject
 * @property {() => Promise<string[]>} restore
 *   恢复历史购买，返回 productId 列表
 * @property {(productId: string) => boolean} isPurchased
 *   同步检查本地缓存（用于 UI 展示，无需网络）
 */

/**
 * 热替换 IAP SDK Provider（运行时调用，无需重载页面）
 *
 * @param {IapProvider} p 实现了 purchase / restore / isPurchased 接口的 Provider 对象
 *
 * @example
 * // 接入 Stripe Web SDK
 * setIapProvider({
 *   purchase: async (productId) => {
 *     const { error } = await stripe.redirectToCheckout({ lineItems: [{ price: productId, quantity: 1 }], mode: 'payment' });
 *     return { success: !error };
 *   },
 *   restore: async () => [],  // Stripe 不支持恢复，返回空
 *   isPurchased: (productId) => !!localStorage.getItem(`stripe_${productId}`),
 * });
 */
export function setIapProvider(p) { _provider = p; }

function _loadPurchases() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {};
}

function _savePurchases(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
}

/** 检查某产品是否已购买（one_time）或有效期内（subscription / limited_time） */
export function isPurchased(productId) {
    const purchases = _loadPurchases();
    const rec = purchases[productId];
    if (!rec) return false;
    if (rec.type === 'one_time') return true;
    if (rec.type === 'subscription' || rec.type === 'limited_time') {
        return Date.now() < rec.expiresAt;
    }
    return false;
}

/** 检查新手礼包是否可购买（首购限定且还未购买过任何商品） */
export function canPurchaseStarterPack() {
    const purchases = _loadPurchases();
    // 已购买过任何商品则不再展示
    const hasPurchased = Object.keys(purchases).length > 0;
    return !hasPurchased && !isPurchased('starter_pack');
}

/**
 * 获取限时礼包的剩余秒数（0 = 已过期或未创建）
 * @param {string} productId
 */
export function getLimitedTimeRemaining(productId) {
    const purchases = _loadPurchases();
    const rec = purchases[`${productId}_offer_created`];
    if (!rec) return 0;
    const product = PRODUCTS[productId];
    const expireMs = (product?.expireHours ?? 48) * 3600_000;
    const remaining = rec.createdAt + expireMs - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
}

/**
 * 创建限时礼包的展示倒计时（首次展示时调用）
 * @param {string} productId
 */
export function createLimitedTimeOffer(productId) {
    const purchases = _loadPurchases();
    const key = `${productId}_offer_created`;
    if (!purchases[key]) {
        purchases[key] = { createdAt: Date.now() };
        _savePurchases(purchases);
    }
}

/** 获取消耗品剩余数量 */
export function getConsumableCount(productId) {
    const purchases = _loadPurchases();
    return Number(purchases[productId]?.count ?? 0);
}

/** 消耗一次消耗品（如使用提示） */
export function consumeOne(productId) {
    const purchases = _loadPurchases();
    const rec = purchases[productId];
    if (!rec || rec.type !== 'consumable' || (rec.count ?? 0) <= 0) return false;
    rec.count--;
    _savePurchases(purchases);
    return true;
}

/** 存根购买 UI */
function _stubPurchase(product) {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') {
            resolve({ success: true });
            return;
        }
        const ok = window.confirm(
            `[模拟购买]\n${product.name}\n${product.desc}\n价格：${product.price}\n\n确认购买？`
        );
        resolve({ success: ok });
    });
}

/** 应用购买结果到本地状态 */
async function _syncPurchaseToServer(product, receiptHint) {
    if (!isSqliteClientDatabase()) return;
    try {
        const base = getApiBaseUrl().replace(/\/+$/, '');
        let uid = '';
        try {
            uid = localStorage.getItem('bb_user_id') || '';
        } catch {
            /* ignore */
        }
        const providerRef = receiptHint || `stub_${product.id}_${Date.now()}`;
        const expSec =
            product.type === 'subscription' || product.type === 'limited_time'
                ? Math.floor(Date.now() / 1000) + (product.durationDays ?? 30) * 86400
                : undefined;
        await fetch(`${base}/api/payment/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: uid,
                sku: product.id,
                provider: 'stub',
                provider_ref: providerRef,
                idempotency_key: `iap_${uid}_${product.id}_${providerRef}`.slice(0, 120),
                amount_minor: Math.round(Number(product.priceNum || 0) * 100),
                currency: 'CNY',
                status: 'completed',
                expires_at: expSec,
            }),
        });
    } catch {
        /* 网络失败不阻断本地权益 */
    }
}

function _applyPurchase(product) {
    const purchases = _loadPurchases();
    if (product.type === 'one_time') {
        purchases[product.id] = { type: 'one_time', purchasedAt: Date.now() };
    } else if (product.type === 'subscription' || product.type === 'limited_time') {
        const durationMs = (product.durationDays ?? 30) * 86400_000;
        purchases[product.id] = { type: product.type, expiresAt: Date.now() + durationMs };
    } else if (product.type === 'consumable') {
        const prev = purchases[product.id]?.count ?? 0;
        const qty = product.qty ?? 5;
        purchases[product.id] = { type: 'consumable', count: prev + qty };
    }
    _savePurchases(purchases);

    // 副作用：移除广告（remove_ads / annual_pass / starter_pack 包含去广告权益）
    if (['remove_ads', 'annual_pass', 'starter_pack'].includes(product.id)) {
        setAdsRemoved(true);
    }
    // 副作用：提示包（hint_pack_5 和 starter_pack 都给提示）
    if (product.id === 'hint_pack_5') {
        const p = _loadPurchases();
        if (!p.hint_pack_5) p.hint_pack_5 = { type: 'consumable', count: 0 };
        p.hint_pack_5.count = (p.hint_pack_5.count ?? 0) + (product.qty ?? 5);
        _savePurchases(p);
    }
    if (product.id === 'starter_pack') {
        const p = _loadPurchases();
        if (!p.hint_pack_5) p.hint_pack_5 = { type: 'consumable', count: 0 };
        p.hint_pack_5.count = (p.hint_pack_5.count ?? 0) + 3;
        _savePurchases(p);
    }
}

/**
 * 发起购买
 * @param {string} productId
 * @returns {Promise<{ success: boolean, productId: string }>}
 */
export async function purchase(productId) {
    if (!getFlag('iap')) return { success: false, productId, reason: 'iap_disabled' };

    const product = PRODUCTS[productId];
    if (!product) return { success: false, productId, reason: 'unknown_product' };

    let result;
    if (_provider) {
        result = await _provider.purchase(productId);
    } else {
        result = await _stubPurchase(product);
    }

    if (result.success) {
        _applyPurchase(product);
        const receipt = result.receipt || result.transactionId || '';
        void _syncPurchaseToServer(product, receipt);
        emit('iap_purchase', { productId, product });
    }

    return { ...result, productId };
}

/** 获取所有购买状态快照（调试用） */
export function getPurchasesSnapshot() {
    return _loadPurchases();
}
