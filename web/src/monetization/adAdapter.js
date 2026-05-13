/**
 * 广告 SDK 适配层（OPT-01）
 *
 * 设计：
 *   - 统一接口屏蔽具体 SDK（AdMob / AppLovin / ironSource 等）
 *   - 默认为「存根模式」（stubMode）：在浏览器内弹出模拟广告 UI，返回 Promise
 *   - 真实 SDK 通过 setAdProvider(provider) 热替换
 *   - 付费移除广告（removeAds）后，插屏广告静默跳过；激励广告保留（玩家主动触发）
 *
 * 接口：
 *   showRewardedAd(reason)  → Promise<{ rewarded: boolean }>
 *   showInterstitialAd()    → Promise<void>
 *   setAdProvider(p)        — 替换底层 SDK
 *   setAdsRemoved(bool)     — 标记「已移除广告」
 */

import { getFlag } from './featureFlags.js';
import { notePopupShown } from '../popupCoordinator.js';
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';
import { t } from '../i18n/i18n.js';
import { emit } from './MonetizationBus.js';

/* v1.49.x P2-5：把广告生命周期事件 emit 到 MonetizationBus + analyticsTracker。
 * 之前 ad_show / ad_complete 在 ANALYTICS_EVENTS 已声明但全仓 0 emit，
 * funnels.AD_WATCH 漏斗永远停在 ad_trigger 第一步、看板 0 数据。 */
async function _trackAdEvent(eventName, props) {
    try {
        const mod = await import('./analyticsTracker.js');
        mod.getAnalyticsTracker().trackEvent(eventName, props || {});
    } catch { /* analyticsTracker 不可用时静默 */ }
}

const STORAGE_KEY = 'openblock_mon_ads_removed';

let _adsRemoved = false;
let _provider = null; // 自定义 SDK provider（null = 使用存根）

/** 初始化：从 localStorage 读取「移除广告」状态 */
export function initAds() {
    try {
        _adsRemoved = localStorage.getItem(STORAGE_KEY) === '1';
    } catch { /* ignore */ }
}

/** 标记是否已购买「移除广告」 */
export function setAdsRemoved(val) {
    _adsRemoved = Boolean(val);
    try {
        localStorage.setItem(STORAGE_KEY, _adsRemoved ? '1' : '0');
    } catch { /* ignore */ }
}

export function isAdsRemoved() { return _adsRemoved; }

/**
 * @typedef {Object} AdProvider
 * @property {(reason: string) => Promise<{ rewarded: boolean }>} showRewarded
 *   展示激励视频广告；玩家完整观看后 resolve({rewarded:true})；跳过/失败 resolve({rewarded:false})；不应 reject
 * @property {() => Promise<void>} showInterstitial
 *   展示插屏广告；广告关闭后 resolve；不应 reject
 */

/**
 * 热替换底层广告 SDK Provider（运行时调用，无需重载页面）
 *
 * @param {AdProvider} provider 实现了 showRewarded / showInterstitial 接口的 Provider 对象
 *
 * @example
 * // 接入 AdMob（以 Google IMA SDK 为例）
 * setAdProvider({
 *   showRewarded: async (reason) =>
 *     new Promise(resolve => AdMob.showRewarded({
 *       onRewarded: () => resolve({ rewarded: true }),
 *       onDismissed: () => resolve({ rewarded: false }),
 *     })),
 *   showInterstitial: async () =>
 *     new Promise(resolve => AdMob.showInterstitial({ onDismissed: resolve })),
 * });
 */
export function setAdProvider(provider) {
    _provider = provider;
}

// ---------- 存根 UI ----------

function _stubRewardedUI(reason) {
    return new Promise((resolve) => {
        if (typeof document === 'undefined') {
            resolve({ rewarded: true });
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'mon-ad-overlay';
        overlay.innerHTML = `
            <div class="mon-ad-box">
                <div class="mon-ad-label">📺 广告（模拟）</div>
                <div class="mon-ad-reason">${reason}</div>
                <div class="mon-ad-timer" id="mon-ad-timer">5</div>
                <button class="mon-ad-skip" id="mon-ad-skip" disabled>跳过</button>
            </div>`;
        document.body.appendChild(overlay);
        notePopupShown(5000, 900);

        let secondsLeft = 5;
        const timer = overlay.querySelector('#mon-ad-timer');
        const skip = overlay.querySelector('#mon-ad-skip');

        const iv = setInterval(() => {
            secondsLeft--;
            if (timer) timer.textContent = secondsLeft;
            if (secondsLeft <= 0) {
                clearInterval(iv);
                if (skip) { skip.disabled = false; skip.textContent = t('toast.adClaim'); }
            }
        }, 1000);

        overlay.addEventListener('click', (e) => {
            if (e.target === skip && !skip.disabled) {
                clearInterval(iv);
                overlay.remove();
                resolve({ rewarded: t <= 0 });
            }
        });
    });
}

function _stubInterstitialUI() {
    return new Promise((resolve) => {
        if (typeof document === 'undefined') {
            resolve();
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'mon-ad-overlay';
        overlay.innerHTML = `
            <div class="mon-ad-box">
                <div class="mon-ad-label">📺 插屏广告（模拟）</div>
                <button class="mon-ad-close" id="mon-ad-close" style="margin-top:16px">关闭 ×</button>
            </div>`;
        document.body.appendChild(overlay);
        notePopupShown(5000, 900);
        overlay.querySelector('#mon-ad-close').onclick = () => { overlay.remove(); resolve(); };
        // 5s 后自动关闭
        setTimeout(() => { overlay.remove(); resolve(); }, 5000);
    });
}

/** 上报广告曝光占位（items 1–4）；真实 SDK 应在 onAdLoaded/onPaid 回调内调用 */
async function _reportAdImpression(kind, filled, meta = {}) {
    if (!isSqliteClientDatabase()) return;
    try {
        const base = getApiBaseUrl().replace(/\/+$/, '');
        let uid = '';
        try {
            uid = localStorage.getItem('bb_user_id') || '';
        } catch {
            /* ignore */
        }
        await fetch(`${base}/api/enterprise/ad-impression`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: uid,
                kind,
                filled: Boolean(filled),
                revenue_minor: meta.revenue_minor ?? 0,
                meta,
                ts: Date.now(),
            }),
        });
    } catch {
        /* ignore */
    }
}

// ---------- 公开 API ----------

/**
 * 展示激励视频广告
 * @param {string} reason 触发原因（用于 UI 展示，如「续关」「获得提示」）
 * @returns {Promise<{ rewarded: boolean }>}
 */
export async function showRewardedAd(reason = '') {
    if (!getFlag('adsRewarded')) return { rewarded: false };

    /* v1.49.x P2-5：ad_show 事件（玩家看到广告 UI）。 */
    void _trackAdEvent('ad_show', { type: 'rewarded', reason });
    emit('ad_show', { type: 'rewarded', reason });

    const r = _provider
        ? await _provider.showRewarded(reason)
        : await _stubRewardedUI(reason);

    /* P2-5：ad_complete 事件（含完播标记）。 */
    void _trackAdEvent('ad_complete', { type: 'rewarded', reason, rewarded: !!r?.rewarded });
    emit('ad_complete', { type: 'rewarded', reason, rewarded: !!r?.rewarded });

    void _reportAdImpression('rewarded', r?.rewarded, { reason });
    return r;
}

/**
 * 展示插屏广告（付费移除广告后静默跳过）
 * @returns {Promise<void>}
 */
export async function showInterstitialAd() {
    if (!getFlag('adsInterstitial')) return;
    if (_adsRemoved) return;

    void _trackAdEvent('ad_show', { type: 'interstitial' });
    emit('ad_show', { type: 'interstitial' });

    if (_provider) await _provider.showInterstitial();
    else await _stubInterstitialUI();

    void _trackAdEvent('ad_complete', { type: 'interstitial', rewarded: true });
    emit('ad_complete', { type: 'interstitial', rewarded: true });

    void _reportAdImpression('interstitial', true, {});
}
