/**
 * adProviders.js — 广告 SDK Provider 工厂（MO-1）
 *
 * - `stub`：返回 null（adAdapter 使用内置模拟 UI + 配置化 eCPM 计收益）。
 * - `admob` / `applovin`：真实 SDK 骨架。检测到 SDK 全局对象与配置 key 时接管；
 *   否则打印告警并回退（rewarded:false），保证未配置时不崩。
 *
 * 收益口径：eCPM(元/千次) → 单次曝光收益(分) = round(ecpmCny / 1000 * 100)。
 */

/**
 * 配置化模拟一次曝光的收益（分）。按「每次展示」计费（revenuePerShowCny）。
 * 兼容旧 eCPM 配置（ecpmCny，元/千次）。fillRate 未命中→0。
 */
export function simulateAdRevenueMinor(stubCfg, kind, rng = Math.random) {
    const fill = Number(stubCfg?.fillRate ?? 0.9);
    if (rng() > fill) return { filled: false, revenueMinor: 0 };
    let perShowCny = stubCfg?.revenuePerShowCny?.[kind];
    if (perShowCny == null && stubCfg?.ecpmCny?.[kind] != null) {
        perShowCny = Number(stubCfg.ecpmCny[kind]) / 1000; // 旧口径兜底
    }
    const revenueMinor = Math.max(0, Math.round((Number(perShowCny) || 0) * 100));
    return { filled: true, revenueMinor };
}

function _warnOnce(key, msg) {
    _warnOnce._seen = _warnOnce._seen || new Set();
    if (_warnOnce._seen.has(key)) return;
    _warnOnce._seen.add(key);
    if (typeof console !== 'undefined') console.warn(`[adProviders] ${msg}`);
}

/** AdMob 骨架（Web/IMA 或移动桥接）。未配置 appId/unitId 时回退。 */
export function createAdMobProvider(cfg) {
    const sdk = (typeof globalThis !== 'undefined') ? (globalThis.admob || globalThis.AdMob) : null;
    return {
        showRewarded: async (reason) => {
            if (!sdk || !cfg?.rewardedUnitId) {
                _warnOnce('admob_rw', 'AdMob 未配置 rewardedUnitId 或 SDK 缺失，回退 not-filled');
                return { rewarded: false, revenue_minor: 0 };
            }
            return new Promise((resolve) => sdk.showRewarded({
                adUnitId: cfg.rewardedUnitId,
                onRewarded: (info) => resolve({ rewarded: true, revenue_minor: Math.round((info?.value || 0) * 100) }),
                onDismissed: () => resolve({ rewarded: false, revenue_minor: 0 }),
            }, reason));
        },
        showInterstitial: async () => {
            if (!sdk || !cfg?.interstitialUnitId) {
                _warnOnce('admob_is', 'AdMob 未配置 interstitialUnitId 或 SDK 缺失，跳过');
                return;
            }
            return new Promise((resolve) => sdk.showInterstitial({ adUnitId: cfg.interstitialUnitId, onDismissed: resolve }));
        },
    };
}

/** AppLovin MAX 骨架。未配置 sdkKey/unitId 时回退。 */
export function createAppLovinProvider(cfg) {
    const sdk = (typeof globalThis !== 'undefined') ? (globalThis.AppLovinMAX || globalThis.applovin) : null;
    return {
        showRewarded: async () => {
            if (!sdk || !cfg?.sdkKey || !cfg?.rewardedUnitId) {
                _warnOnce('al_rw', 'AppLovin 未配置 sdkKey/rewardedUnitId 或 SDK 缺失，回退 not-filled');
                return { rewarded: false, revenue_minor: 0 };
            }
            return new Promise((resolve) => sdk.showRewardedAd(cfg.rewardedUnitId, {
                onRewarded: (rev) => resolve({ rewarded: true, revenue_minor: Math.round((rev?.revenue || 0) * 100) }),
                onHidden: () => resolve({ rewarded: false, revenue_minor: 0 }),
            }));
        },
        showInterstitial: async () => {
            if (!sdk || !cfg?.interstitialUnitId) {
                _warnOnce('al_is', 'AppLovin 未配置 interstitialUnitId 或 SDK 缺失，跳过');
                return;
            }
            return new Promise((resolve) => sdk.showInterstitialAd(cfg.interstitialUnitId, { onHidden: resolve }));
        },
    };
}

/**
 * 按配置返回广告 Provider；`stub` 返回 null（使用 adAdapter 内置模拟 UI）。
 * @param {{type:string, admob?:object, applovin?:object}} adCfg
 */
export function resolveAdProvider(adCfg) {
    switch (adCfg?.type) {
        case 'admob': return createAdMobProvider(adCfg.admob || {});
        case 'applovin': return createAppLovinProvider(adCfg.applovin || {});
        case 'stub':
        default: return null;
    }
}
