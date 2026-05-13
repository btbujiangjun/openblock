/**
 * @vitest-environment jsdom
 *
 * v1.49.x P2-5 — adAdapter ad_show / ad_complete 事件流验证
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _clearAllHandlers, on } from '../web/src/monetization/MonetizationBus.js';
import { setAdProvider, showInterstitialAd, showRewardedAd } from '../web/src/monetization/adAdapter.js';
import { setFlag } from '../web/src/monetization/featureFlags.js';

beforeEach(() => {
    _clearAllHandlers();
    try { localStorage.clear(); } catch {}
    setFlag('adsRewarded', true);
    setFlag('adsInterstitial', true);
    /* 用 stub provider 避免存根 UI 真实绘制 5s。 */
    setAdProvider({
        showRewarded: async () => ({ rewarded: true }),
        showInterstitial: async () => undefined,
    });
});

afterEach(() => {
    setAdProvider(null);
});

describe('adAdapter — P2-5 事件 emit', () => {
    it('showRewardedAd 完整流程触发 ad_show + ad_complete', async () => {
        const events = [];
        on('ad_show', ({ data }) => events.push(['show', data]));
        on('ad_complete', ({ data }) => events.push(['complete', data]));

        const r = await showRewardedAd('continue');
        expect(r.rewarded).toBe(true);

        const types = events.map((e) => e[0]);
        expect(types).toEqual(['show', 'complete']);
        expect(events[0][1]).toMatchObject({ type: 'rewarded', reason: 'continue' });
        expect(events[1][1]).toMatchObject({ type: 'rewarded', rewarded: true });
    });

    it('showInterstitialAd 触发 ad_show + ad_complete', async () => {
        const events = [];
        on('ad_show', ({ data }) => events.push(['show', data]));
        on('ad_complete', ({ data }) => events.push(['complete', data]));

        await showInterstitialAd();

        expect(events.map((e) => e[0])).toEqual(['show', 'complete']);
        expect(events[0][1]).toMatchObject({ type: 'interstitial' });
        expect(events[1][1]).toMatchObject({ type: 'interstitial', rewarded: true });
    });
});
