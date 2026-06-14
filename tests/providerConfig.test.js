/**
 * @vitest-environment jsdom
 * A 类配置化 Provider：providerConfig / adProviders / attributionProvider 纯函数。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const _store = vi.hoisted(() => {
    let m = {};
    return {
        getItem: (k) => (k in m ? m[k] : null),
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: (k) => { delete m[k]; },
        clear: () => { m = {}; },
    };
});
vi.stubGlobal('localStorage', _store);

import {
    DEFAULT_PROVIDER_CONFIG,
    getProviderConfig,
    getProviderSection,
    setProviderConfigOverride,
    __clearProviderConfigCache,
} from '../web/src/monetization/providerConfig.js';
import {
    simulateAdRevenueMinor,
    resolveAdProvider,
    createAdMobProvider,
} from '../web/src/monetization/adProviders.js';
import {
    pickStubChannel,
    toCanonical,
    resolveAttribution,
} from '../web/src/attribution/attributionProvider.js';

beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    delete globalThis.__OPENBLOCK_PROVIDERS__;
    __clearProviderConfigCache();
});

describe('providerConfig', () => {
    it('默认全部 stub', () => {
        const cfg = getProviderConfig();
        expect(cfg.ad.type).toBe('stub');
        expect(cfg.iap.type).toBe('stub');
        expect(cfg.attribution.type).toBe('stub');
    });
    it('localStorage override 深合并', () => {
        setProviderConfigOverride({ ad: { type: 'admob', admob: { appId: 'x' } } });
        const ad = getProviderSection('ad');
        expect(ad.type).toBe('admob');
        expect(ad.admob.appId).toBe('x');
        // 未覆盖字段保留
        expect(ad.stub.fillRate).toBe(DEFAULT_PROVIDER_CONFIG.ad.stub.fillRate);
    });
    it('globalThis 注入覆盖', () => {
        globalThis.__OPENBLOCK_PROVIDERS__ = { iap: { type: 'stripe' } };
        __clearProviderConfigCache();
        expect(getProviderSection('iap').type).toBe('stripe');
    });
});

describe('adProviders', () => {
    it('fillRate=1 命中 eCPM 收益', () => {
        const r = simulateAdRevenueMinor({ fillRate: 1, ecpmCny: { rewarded: 22 } }, 'rewarded');
        expect(r.filled).toBe(true);
        expect(r.revenueMinor).toBe(Math.round(22 / 1000 * 100)); // 2
    });
    it('fillRate=0 无收益', () => {
        const r = simulateAdRevenueMinor({ fillRate: 0, ecpmCny: { rewarded: 22 } }, 'rewarded');
        expect(r.filled).toBe(false);
        expect(r.revenueMinor).toBe(0);
    });
    it('按次计费：激励 ¥0.05=5分、插屏 ¥0.02=2分', () => {
        const cfg = { fillRate: 1, revenuePerShowCny: { rewarded: 0.05, interstitial: 0.02 } };
        expect(simulateAdRevenueMinor(cfg, 'rewarded', () => 0).revenueMinor).toBe(5);
        expect(simulateAdRevenueMinor(cfg, 'interstitial', () => 0).revenueMinor).toBe(2);
    });
    it('默认配置即为按次计费口径', () => {
        const stub = DEFAULT_PROVIDER_CONFIG.ad.stub;
        expect(stub.revenuePerShowCny.rewarded).toBe(0.05);
        expect(stub.revenuePerShowCny.interstitial).toBe(0.02);
        expect(DEFAULT_PROVIDER_CONFIG.acquisition.cpiCny).toBe(2);
    });
    it('resolveAdProvider stub→null, admob→对象', () => {
        expect(resolveAdProvider({ type: 'stub' })).toBeNull();
        const p = resolveAdProvider({ type: 'admob', admob: {} });
        expect(typeof p.showRewarded).toBe('function');
    });
    it('admob 未配置时回退 not-filled', async () => {
        const p = createAdMobProvider({});
        const r = await p.showRewarded('x');
        expect(r.rewarded).toBe(false);
    });
});

describe('attributionProvider', () => {
    it('toCanonical 映射 utm', () => {
        const c = toCanonical({ utm_source: 'applovin', utm_campaign: 'al', utm_content: 'cr1' });
        expect(c.media_source).toBe('applovin');
        expect(c.campaign).toBe('al');
        expect(c.creative).toBe('cr1');
    });
    it('pickStubChannel 权重命中', () => {
        const mix = [{ source: 'a', weight: 0 }, { source: 'b', weight: 1 }];
        expect(pickStubChannel(mix, () => 0.99).source).toBe('b');
    });
    it('resolveAttribution 有 utm 走 utm', () => {
        const r = resolveAttribution({ type: 'stub', stub: { channelMix: [] } }, { utm_source: 'unity' });
        expect(r.media_source).toBe('unity');
        expect(r.via).toBe('utm');
    });
    it('resolveAttribution 无 utm 走 stub mix', () => {
        const r = resolveAttribution(
            { type: 'stub', stub: { channelMix: [{ source: 'applovin', weight: 1 }] } },
            null,
            () => 0.5,
        );
        expect(r.media_source).toBe('applovin');
        expect(r.via).toBe('resolved');
    });
});
