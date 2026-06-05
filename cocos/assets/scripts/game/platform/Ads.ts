/**
 * 广告/IAP 外观（Phase P0 变现）。统一封装激励视频与内购，业务层只调本facade。
 * 非微信/未配 adUnitId 时走 Noop（激励视频直接成功），保证开发期与无广告端可玩。
 */
import { Monetization } from './Monetization';
import { Analytics, ANALYTICS_EVENTS, getConfig } from '../../core';

export const Ads = {
    /** 播放激励视频，resolve(true) 表示完整观看可发奖。 */
    async rewarded(placement: string): Promise<boolean> {
        Analytics.track(ANALYTICS_EVENTS.adShow, { placement });
        try {
            const res = await Monetization.ads.showRewarded(placement);
            if (res.completed) Analytics.track(ANALYTICS_EVENTS.adComplete, { placement });
            return res.completed;
        } catch {
            return false;
        }
    },

    isReady(placement: string): boolean {
        return Monetization.ads.isReady(placement);
    },

    async purchase(productId: string): Promise<boolean> {
        const res = await Monetization.iap.purchase(productId);
        if (res.success) {
            const prod = getConfig().iapProducts[productId];
            Analytics.track(ANALYTICS_EVENTS.iapPurchase, { productId, coins: prod?.coins ?? 0, priceCNY: prod?.priceCNY ?? 0 });
        }
        return res.success;
    },
};
