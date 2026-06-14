/**
 * 广告/IAP 外观（Phase P0 变现）。统一封装激励视频与内购，业务层只调本facade。
 * 非微信/未配 adUnitId 时走 Noop（激励视频直接成功），保证开发期与无广告端可玩。
 */
import { Monetization } from './Monetization';
import { Analytics, ANALYTICS_EVENTS, getConfig } from '../../core';
import { ReportingOutbox } from './ReportingOutbox';

/* 按次计费口径（分），与 web/src/monetization/providerConfig.js 对齐：
 *   激励 ¥0.05 = 5 分；插屏 ¥0.02 = 2 分。填充率 0.92。 */
const AD_REVENUE_MINOR = { rewarded: 5, interstitial: 2 };
const AD_FILL_RATE = 0.92;

export const Ads = {
    /** 播放激励视频，resolve(true) 表示完整观看可发奖。 */
    async rewarded(placement: string): Promise<boolean> {
        Analytics.track(ANALYTICS_EVENTS.adShow, { placement });
        try {
            const res = await Monetization.ads.showRewarded(placement);
            const filled = Math.random() < AD_FILL_RATE;
            if (res.completed) {
                Analytics.track(ANALYTICS_EVENTS.adComplete, { placement });
                ReportingOutbox.ad('rewarded', filled ? AD_REVENUE_MINOR.rewarded : 0, filled, true);
            } else {
                ReportingOutbox.ad('rewarded', 0, false, false);
            }
            return res.completed;
        } catch {
            return false;
        }
    },

    /** 播放插屏广告（展示即按次计费）。 */
    async interstitial(placement: string): Promise<void> {
        Analytics.track(ANALYTICS_EVENTS.adShow, { placement });
        try {
            await Monetization.ads.showInterstitial(placement);
        } catch { /* ignore */ }
        const filled = Math.random() < AD_FILL_RATE;
        ReportingOutbox.ad('interstitial', filled ? AD_REVENUE_MINOR.interstitial : 0, filled, true);
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
