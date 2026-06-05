/**
 * 商业化适配接口（Phase 4 骨架）。统一广告 / IAP 抽象，具体端在此对接：
 *   - 微信小游戏：wx.createRewardedVideoAd / wx.requestMidasPayment
 *   - iOS/Android（原生壳）：AdMob / AppLovin、StoreKit / Google Billing
 * 默认 NoopAdapter 让游戏在任何端都能跑通（广告直接回调成功，IAP 直接失败）。
 */
export interface RewardedResult {
    completed: boolean;
}

export interface AdsAdapter {
    isReady(placement: string): boolean;
    showRewarded(placement: string): Promise<RewardedResult>;
    showInterstitial(placement: string): Promise<void>;
}

export interface PurchaseResult {
    success: boolean;
    productId: string;
    error?: string;
}

export interface IapAdapter {
    purchase(productId: string): Promise<PurchaseResult>;
    restore(): Promise<string[]>;
}

class NoopAds implements AdsAdapter {
    isReady(): boolean {
        return true;
    }
    async showRewarded(): Promise<RewardedResult> {
        return { completed: true };
    }
    async showInterstitial(): Promise<void> {
        /* no-op */
    }
}

class NoopIap implements IapAdapter {
    async purchase(productId: string): Promise<PurchaseResult> {
        return { success: false, productId, error: 'IAP adapter not configured' };
    }
    async restore(): Promise<string[]> {
        return [];
    }
}

export const Monetization = {
    ads: new NoopAds() as AdsAdapter,
    iap: new NoopIap() as IapAdapter,
    useAds(a: AdsAdapter): void {
        this.ads = a;
    },
    useIap(i: IapAdapter): void {
        this.iap = i;
    },
};
