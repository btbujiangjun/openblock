/**
 * PaymentManager - 支付管理器
 * 
 * 功能：
 * 1. 首充优惠系统
 * 2. 限时折扣系统
 * 3. 订单追踪
 * 4. 支付回调处理
 */
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';
import { getWallet } from '../skills/wallet.js';
import { getFlag } from './featureFlags.js';

const PROMO_STORAGE_KEY = 'openblock_promo_state_v1';

/* v1.49.x P1-3：动态定价矩阵 stage × unifiedRisk。
 *
 * 业界做法：高流失风险 × 早期玩家给最高折扣（钩住未付费），
 * 低流失风险 × 高 LTV 鲸鱼几乎不打折（保利润）。
 * 矩阵值是"在原 LIMITED_OFFERS.discountPercent 上的*额外*折扣百分点"，
 * 范围 -10..+20；负值用于"流失低 + veteran 鲸鱼"场景的小幅缩水（防滥发）。
 *
 * stage 取自 lifecycleSignals.snapshot.stage.code（S0..S4），
 * unifiedRisk 取自 lifecycleSignals.snapshot.churn.unifiedRisk[0..1]。
 *
 * 表格设计原则：
 *   - 同一行（stage 固定）随 risk 单调递增；同一列（risk 固定）S0/S4 偏高
 *     （新手 + 沉默回流），S2/S3 偏低（成熟玩家不需要狂打折）。
 *   - 总加成 ≤ +20%，避免与 promo 叠加后让某些产品变 0 元。 */
const DYNAMIC_PRICING_MATRIX = Object.freeze({
    /* stage → [riskLow,  riskMid, riskHigh, riskCritical] */
    S0:   [0,   8,  16, 20], // 新手：风险高时大力托底
    S1:   [-2,  6,  12, 18],
    S2:   [-5,  4,  10, 15],
    S3:   [-8,  2,   8, 12], // 成熟：基本不加；只在临死时给点折
    'S3+': [-10, 0,   6, 10],
    S4:   [5,  10,  18, 20], // 沉默回流：默认就比常态高一档
});

function _riskBucket(risk01) {
    const r = Number(risk01) || 0;
    if (r >= 0.70) return 3; // critical
    if (r >= 0.50) return 2; // high
    if (r >= 0.30) return 1; // mid
    return 0;                // low/stable
}

/**
 * v1.49.x P1-3：返回当前 stage × risk 的动态额外折扣（百分点）。
 * 失败 / 关闭 feature flag 时返回 0，与旧版 LIMITED_OFFERS.discountPercent 完全等价。
 */
export function getDynamicPricingBonus(stageCode, unifiedRisk01) {
    if (!getFlag('dynamicPricing')) return 0;
    const row = DYNAMIC_PRICING_MATRIX[stageCode] || DYNAMIC_PRICING_MATRIX.S0;
    return Number(row[_riskBucket(unifiedRisk01)]) || 0;
}

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
    },
    /* v1.49.x P0-6：补 winback_user offer。
     *
     * 之前 lifecycleAwareOffers._onSessionStart 已在调 paymentManager.triggerOffer('winback_user', ...)
     * 但 LIMITED_OFFERS 中没有此 key，triggerOffer 直接 `return null`，
     * 整条沉默回流促销的最后一公里被悄悄丢弃；
     * 现在补上：≥7 天未活跃的玩家在下次开局时拿到 7 折回流券，覆盖首充包/月卡/年卡。
     *
     * 与 returning_user 的区别：
     *   - returning_user 看"上次付费时间"≥30 天，专为流失付费玩家设计；
     *   - winback_user 看"上次活跃时间"≥7 天，覆盖更多沉默用户（含未付费）；
     *   两者可同时生效但互不冲突，前端 UI 按 priority 取 winback_user > returning_user。 */
    winback_user: {
        id: 'winback_user',
        name: '回流欢迎包',
        desc: '欢迎回来！7 折迎新礼包等你领取',
        discountPercent: 30,
        validHours: 72,
        products: ['first_purchase_starter', 'starter_pack', 'monthly_pass'],
        priority: 10, // 高于 returning_user
        triggerCondition: (_purchaseHistory, daysSinceLastActive = 0) => {
            return Number(daysSinceLastActive) >= 7;
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
     *
     * v1.49.x P0-5：localStorage 在 jsdom / 小程序 / 隐私模式下可能 throw；
     * 之前 `localStorage.getItem` / `setItem` 直接调用会让单点失败炸掉 getActiveOffers，
     * 进而拖垮 commercialInsight 面板渲染和 lifecycleAwareOffers 链路。
     * 内存中的 _activeOffers Map 是单一权威源，localStorage 仅做持久化兜底。
     */
    _checkActiveOffers() {
        const now = Date.now();

        for (const [id, offer] of Object.entries(LIMITED_OFFERS)) {
            const offerKey = `offer_${id}_valid_until`;
            let validUntil = 0;
            try {
                validUntil = parseInt(localStorage.getItem(offerKey) || '0', 10) || 0;
            } catch { validUntil = 0; }

            if (validUntil > now) {
                this._activeOffers.set(id, { ...offer, validUntil });
            }
        }
    }

    /**
     * 触发限时优惠
     *
     * v1.49.x P0-5：localStorage 写入失败时只跳过持久化，仍写入内存 _activeOffers，
     * 让本进程剩余流程可见 offer；下次冷启动会重新触发（幂等）。
     */
    triggerOffer(offerId, purchaseHistory = [], daysSinceRegister = 0) {
        const offer = LIMITED_OFFERS[offerId];
        if (!offer) return null;

        const lastPurchaseDate = this._lastPurchaseTimestamp
            ? new Date(this._lastPurchaseTimestamp).getTime()
            : null;

        if (offer.triggerCondition(purchaseHistory, daysSinceRegister, lastPurchaseDate)) {
            const validUntil = Date.now() + offer.validHours * 60 * 60 * 1000;
            try {
                localStorage.setItem(`offer_${offerId}_valid_until`, String(validUntil));
            } catch { /* localStorage 不可用时仅跳过持久化 */ }
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
     *
     * v1.49.x P1-3：可选第三参 lifecycleHints 用于动态定价。
     * 当 feature flag `dynamicPricing` 开启且传入 stageCode/unifiedRisk01 时，
     * 在原折扣基础上叠加 stage×risk 矩阵给出的额外百分点（最高 +20）。
     *
     * @param {object} product
     * @param {string|null} offerId
     * @param {{ stageCode?: string, unifiedRisk01?: number }} [lifecycleHints]
     */
    calculateDiscountedPrice(product, offerId = null, lifecycleHints = null) {
        const basePrice = product.priceNum;
        let discountPercent = 0;

        if (offerId && this._activeOffers.has(offerId)) {
            discountPercent = this._activeOffers.get(offerId).discountPercent;
        } else {
            for (const offer of this._activeOffers.values()) {
                if (offer.products && offer.products.includes(product.id)) {
                    discountPercent = Math.max(discountPercent, offer.discountPercent);
                    break;
                }
            }
        }

        let dynamicBonus = 0;
        if (lifecycleHints && (lifecycleHints.stageCode || lifecycleHints.unifiedRisk01 != null)) {
            dynamicBonus = getDynamicPricingBonus(
                lifecycleHints.stageCode || 'S0',
                lifecycleHints.unifiedRisk01 ?? 0,
            );
        }
        const totalDiscount = Math.max(0, Math.min(80, discountPercent + dynamicBonus));

        const discounted = Math.round(basePrice * (100 - totalDiscount) / 100);
        return {
            original: basePrice,
            discounted,
            discountPercent: totalDiscount,
            baseDiscountPercent: discountPercent,
            dynamicBonus,
            savings: basePrice - discounted,
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