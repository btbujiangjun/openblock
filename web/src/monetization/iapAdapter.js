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

const STORAGE_KEY = 'openblock_mon_purchases_v1';

/** 产品目录 */
export const PRODUCTS = {
    remove_ads: {
        id: 'remove_ads',
        name: '移除广告',
        desc: '永久关闭所有插屏与 Banner 广告',
        price: '¥18',
        priceNum: 18,
        type: 'one_time',
    },
    hint_pack_5: {
        id: 'hint_pack_5',
        name: '提示包 ×5',
        desc: '获得 5 次步骤提示',
        price: '¥6',
        priceNum: 6,
        type: 'consumable',
    },
    weekly_pass: {
        id: 'weekly_pass',
        name: '周卡',
        desc: '7 天每日奖励翻倍',
        price: '¥12',
        priceNum: 12,
        type: 'subscription',
        durationDays: 7,
    },
    monthly_pass: {
        id: 'monthly_pass',
        name: '月卡',
        desc: '30 天每日奖励翻倍 + 专属标识',
        price: '¥28',
        priceNum: 28,
        type: 'subscription',
        durationDays: 30,
    },
    starter_pack: {
        id: 'starter_pack',
        name: '新手礼包',
        desc: '皮肤碎片×3 + 提示×10 + 7天广告关闭',
        price: '¥18',
        priceNum: 18,
        type: 'one_time',
        limitedHours: 24,
    },
};

let _provider = null;

/** 热替换 IAP SDK Provider */
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

/** 检查某产品是否已购买（one_time）或有效期内（subscription） */
export function isPurchased(productId) {
    const purchases = _loadPurchases();
    const rec = purchases[productId];
    if (!rec) return false;
    if (rec.type === 'one_time') return true;
    if (rec.type === 'subscription') {
        return Date.now() < rec.expiresAt;
    }
    return false;
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
function _applyPurchase(product) {
    const purchases = _loadPurchases();
    if (product.type === 'one_time') {
        purchases[product.id] = { type: 'one_time', purchasedAt: Date.now() };
    } else if (product.type === 'subscription') {
        const durationMs = (product.durationDays ?? 30) * 86400_000;
        purchases[product.id] = { type: 'subscription', expiresAt: Date.now() + durationMs };
    } else if (product.type === 'consumable') {
        const prev = purchases[product.id]?.count ?? 0;
        const qty = product.qty ?? 5;
        purchases[product.id] = { type: 'consumable', count: prev + qty };
    }
    _savePurchases(purchases);

    // 副作用：移除广告
    if (product.id === 'remove_ads' || product.id === 'starter_pack') {
        setAdsRemoved(true);
    }
    // 副作用：提示包
    if (product.id === 'hint_pack_5') {
        const p = _loadPurchases();
        if (!p.hint_pack_5) p.hint_pack_5 = { type: 'consumable', count: 0 };
        p.hint_pack_5.count = (p.hint_pack_5.count ?? 0) + 5;
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
        emit('iap_purchase', { productId, product });
    }

    return { ...result, productId };
}

/** 获取所有购买状态快照（调试用） */
export function getPurchasesSnapshot() {
    return _loadPurchases();
}
