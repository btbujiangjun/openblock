/**
 * 微信小游戏 广告 / IAP 适配（Phase 4）。在 Platform.isWechat() 时由 registerWechat() 注入。
 * 仅依赖运行时的全局 wx；非微信环境不会被加载执行。
 */
import { AdsAdapter, IapAdapter, RewardedResult, PurchaseResult, Monetization } from '../Monetization';

interface WxRewardedAd {
    show(): Promise<void>;
    load(): Promise<void>;
    onClose(cb: (res: { isEnded: boolean }) => void): void;
    offClose(cb: (res: { isEnded: boolean }) => void): void;
    onError(cb: (e: unknown) => void): void;
}

interface WxApi {
    createRewardedVideoAd(opts: { adUnitId: string }): WxRewardedAd;
    requestMidasPayment?: (opts: Record<string, unknown>) => void;
}

function wx(): WxApi | null {
    return (globalThis as unknown as { wx?: WxApi }).wx ?? null;
}

export class WechatAds implements AdsAdapter {
    private ads: Record<string, WxRewardedAd> = {};
    private unitIds: Record<string, string>;

    constructor(unitIds: Record<string, string>) {
        this.unitIds = unitIds;
    }

    private get(placement: string): WxRewardedAd | null {
        const api = wx();
        if (!api) return null;
        if (this.ads[placement]) return this.ads[placement];
        const adUnitId = this.unitIds[placement];
        if (!adUnitId) return null;
        const ad = api.createRewardedVideoAd({ adUnitId });
        this.ads[placement] = ad;
        return ad;
    }

    isReady(placement: string): boolean {
        return !!this.get(placement);
    }

    showRewarded(placement: string): Promise<RewardedResult> {
        const ad = this.get(placement);
        if (!ad) return Promise.resolve({ completed: false });
        return new Promise<RewardedResult>((resolve) => {
            const onClose = (res: { isEnded: boolean }) => {
                ad.offClose(onClose);
                resolve({ completed: !!(res && res.isEnded) });
            };
            ad.onClose(onClose);
            ad.show().catch(() => ad.load().then(() => ad.show()).catch(() => {
                ad.offClose(onClose);
                resolve({ completed: false });
            }));
        });
    }

    async showInterstitial(): Promise<void> {
        /* 可按需接入 wx.createInterstitialAd */
    }
}

export class WechatIap implements IapAdapter {
    async purchase(productId: string): Promise<PurchaseResult> {
        const api = wx();
        if (!api?.requestMidasPayment) return { success: false, productId, error: 'midas unavailable' };
        return new Promise<PurchaseResult>((resolve) => {
            try {
                api.requestMidasPayment!({
                    mode: 'game',
                    success: () => resolve({ success: true, productId }),
                    fail: (e: { errMsg?: string }) => resolve({ success: false, productId, error: e?.errMsg }),
                });
            } catch (e) {
                resolve({ success: false, productId, error: String(e) });
            }
        });
    }

    async restore(): Promise<string[]> {
        return [];
    }
}

/** 在启动时调用：把微信适配器注入全局 Monetization。 */
export function registerWechat(adUnitIds: Record<string, string>): void {
    Monetization.useAds(new WechatAds(adUnitIds));
    Monetization.useIap(new WechatIap());
}
