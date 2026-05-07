/**
 * PaymentManager - 支付管理器
 * 
 * 功能：
 * 1. 首充优惠系统
 * 2. 限时折扣系统
 * 3. 订单追踪
 * 4. 支付回调处理
 */
// PaymentManager 当前未直接消费 feature flag（promo state 全部本地存储），后续接入时再启用 getFlag。
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';
import { getWallet } from '../skills/wallet.js';

const PROMO_STORAGE_KEY = 'openblock_promo_state_v1';

/**
 * 首充优惠配置
 */
export const FIRST_PURCHASE_BONUS = {
    enabled: true,
    discountPercent: 50, // 5折
    bonusHintTokens: 5,  // 额外赠送5个提示
    bonusDays: 3        // 额外3天
};

/**
 * 限时优惠配置
 */
export const LIMITED_OFFERS = {
    weekly_50_off: {
        id: 'weekly_50_off',
        name: '限时5折',
        desc: '全商品5折，仅限今日！',
        discountPercent: 50,
        validHours: 24,
        products: ['weekly_pass', 'monthly_pass', 'annual_pass'],
        triggerCondition: (purchaseHistory) => {
            // 之前购买过周卡/月卡的用户
            return purchaseHistory.some(p => 
                ['weekly_pass', 'monthly_pass'].includes(p.sku) && 
                Date.now() - p.timestamp > 30 * 24 * 60 * 60 * 1000
            );
        }
    },
    new_user_monthly: {
        id: 'new_user_monthly',
        name: '新人特惠',
        desc: '月卡限时特惠，仅限新用户',
        discountPercent: 40,
        validHours: 72,
        products: ['monthly_pass'],
        triggerCondition: (purchaseHistory, daysSinceRegister) => {
            // 注册7天内的新用户
            return daysSinceRegister <= 7 && purchaseHistory.length === 0;
        }
    },
    returning_user: {
        id: 'returning_user',
        name: '回归特惠',
        desc: '流失用户回归专属优惠',
        discountPercent: 60,
        validHours: 48,
        products: ['monthly_pass', 'annual_pass'],
        triggerCondition: (purchaseHistory, daysSinceRegister, lastPurchaseDate) => {
            // 30天未购买的用户
            if (!lastPurchaseDate) return false;
            const daysSinceLastPurchase = (Date.now() - lastPurchaseDate) / (24 * 60 * 60 * 1000);
            return daysSinceLastPurchase >= 30;
        }
    }
};

class PaymentManager {
    constructor() {
        this._activeOffers = new Map();
        this._firstPurchaseBonusClaimed = false;
        this._lastPurchaseTimestamp = null;
    }

    /**
     * 初始化支付管理器
     */
    init() {
        this._loadPromoState();
        this._checkActiveOffers();
        console.log('[PaymentManager] Initialized');
    }

    /**
     * 加载促销状态
     */
    _loadPromoState() {
        try {
            const stored = localStorage.getItem(PROMO_STORAGE_KEY);
            if (stored) {
                const state = JSON.parse(stored);
                this._firstPurchaseBonusClaimed = state.firstPurchaseBonusClaimed || false;
                this._lastPurchaseTimestamp = state.lastPurchaseTimestamp || null;
            }
        } catch {}
    }

    /**
     * 保存促销状态
     */
    _savePromoState() {
        try {
            localStorage.setItem(PROMO_STORAGE_KEY, JSON.stringify({
                firstPurchaseBonusClaimed: this._firstPurchaseBonusClaimed,
                lastPurchaseTimestamp: this._lastPurchaseTimestamp
            }));
        } catch {}
    }

    /**
     * 检查可用的限时优惠
     */
    _checkActiveOffers() {
        const now = Date.now();
        
        for (const [id, offer] of Object.entries(LIMITED_OFFERS)) {
            // 检查是否在有效期内
            const offerKey = `offer_${id}_valid_until`;
            const validUntil = parseInt(localStorage.getItem(offerKey) || '0');
            
            if (validUntil > now) {
                this._activeOffers.set(id, { ...offer, validUntil });
            }
        }
    }

    /**
     * 触发限时优惠
     */
    triggerOffer(offerId, purchaseHistory = [], daysSinceRegister = 0) {
        const offer = LIMITED_OFFERS[offerId];
        if (!offer) return null;
        
        // 检查触发条件
        const lastPurchaseDate = this._lastPurchaseTimestamp 
            ? new Date(this._lastPurchaseTimestamp).getTime() 
            : null;
            
        if (offer.triggerCondition(purchaseHistory, daysSinceRegister, lastPurchaseDate)) {
            const validUntil = Date.now() + offer.validHours * 60 * 60 * 1000;
            localStorage.setItem(`offer_${offerId}_valid_until`, String(validUntil));
            this._activeOffers.set(offerId, { ...offer, validUntil });
            
            console.log('[PaymentManager] Offer triggered:', offerId);
            return this._activeOffers.get(offerId);
        }
        
        return null;
    }

    /**
     * 获取可用优惠
     */
    getActiveOffers() {
        this._checkActiveOffers();
        return Array.from(this._activeOffers.values());
    }

    /**
     * 计算折扣价格
     */
    calculateDiscountedPrice(product, offerId = null) {
        const basePrice = product.priceNum;
        let discountPercent = 0;
        
        // 优先使用指定优惠
        if (offerId && this._activeOffers.has(offerId)) {
            discountPercent = this._activeOffers.get(offerId).discountPercent;
        } else {
            // 检查是否有适用于该商品的优惠
            for (const offer of this._activeOffers.values()) {
                if (offer.products && offer.products.includes(product.id)) {
                    discountPercent = Math.max(discountPercent, offer.discountPercent);
                    break;
                }
            }
        }
        
        return {
            original: basePrice,
            discounted: Math.round(basePrice * (100 - discountPercent) / 100),
            discountPercent,
            savings: basePrice - Math.round(basePrice * (100 - discountPercent) / 100)
        };
    }

    /**
     * 是否可享受首充优惠
     */
    canClaimFirstPurchaseBonus(purchaseHistory) {
        if (this._firstPurchaseBonusClaimed) return false;
        return purchaseHistory.length === 0;
    }

    /**
     * 标记首充优惠已领取
     *
     * v1.13：之前只标记 _firstPurchaseBonusClaimed=true，但 FIRST_PURCHASE_BONUS.bonusHintTokens
     * 配置写了「+5 提示券」却**从未真正发到钱包**——玩家完成首充后看不到任何 token 入账。
     * 这里把 bonus token 真正写入钱包；source = 'first-purchase-bonus'，钱包流水面板有专属
     * 「💎 首充奖励」标签。bonusDays 暂无承载通货，仅在 toast 文案中体现。
     */
    claimFirstPurchaseBonus() {
        if (this._firstPurchaseBonusClaimed) return;
        this._firstPurchaseBonusClaimed = true;
        this._savePromoState();
        if (!FIRST_PURCHASE_BONUS.enabled) return;
        const bonusHint = FIRST_PURCHASE_BONUS.bonusHintTokens | 0;
        if (bonusHint <= 0) return;
        try {
            getWallet().addBalance('hintToken', bonusHint, 'first-purchase-bonus');
        } catch (e) {
            console.warn('[PaymentManager] first-purchase bonus grant failed', e);
        }
    }

    /**
     * 记录购买（支付成功后调用）
     */
    recordPurchase(productId, purchaseInfo = {}) {
        this._lastPurchaseTimestamp = Date.now();
        
        // 如果是首充，标记已领取
        if (this._firstPurchaseBonusClaimed === false && purchaseInfo.isFirstPurchase) {
            this.claimFirstPurchaseBonus();
        }
        
        this._savePromoState();
        
        // 尝试同步到服务端
        this._syncPurchaseToServer(productId, purchaseInfo);
        
        // 触发相关优惠检查
        this._checkOfferTriggers([{ sku: productId, timestamp: Date.now() }]);
    }

    /**
     * 同步购买到服务端
     */
    async _syncPurchaseToServer(productId, purchaseInfo) {
        if (!isSqliteClientDatabase()) return;
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            await fetch(`${base}/api/payment/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: localStorage.getItem('bb_user_id') || '',
                    sku: productId,
                    provider: purchaseInfo.provider || 'stub',
                    provider_ref: purchaseInfo.transactionId || '',
                    amount_minor: Math.round((purchaseInfo.price || 0) * 100),
                    status: 'completed'
                })
            });
        } catch (e) {
            console.warn('[PaymentManager] Sync failed:', e);
        }
    }

    /**
     * 检查触发新优惠
     */
    _checkOfferTriggers(purchaseHistory) {
        // 检查回归用户优惠
        this.triggerOffer('returning_user', purchaseHistory, 0);
    }

    /**
     * 获取支付状态
     */
    getPaymentStatus() {
        return {
            hasActiveOffers: this._activeOffers.size > 0,
            offers: this.getActiveOffers(),
            canClaimFirstPurchaseBonus: !this._firstPurchaseBonusClaimed,
            lastPurchase: this._lastPurchaseTimestamp
        };
    }

    /**
     * 清除优惠（用于调试）
     */
    clearOffers() {
        this._activeOffers.clear();
        for (const key of Object.keys(LIMITED_OFFERS)) {
            localStorage.removeItem(`offer_${key}_valid_until`);
        }
        console.log('[PaymentManager] Offers cleared');
    }
}

let _instance = null;
export function getPaymentManager() {
    if (!_instance) {
        _instance = new PaymentManager();
    }
    return _instance;
}

export function initPaymentManager() {
    getPaymentManager().init();
}