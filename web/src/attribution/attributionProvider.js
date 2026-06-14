/**
 * attributionProvider.js — MMP 归因 Provider（UA-1，配置化）
 *
 * - `stub`：无 UTM 时按 `channelMix` 权重随机分配渠道，模拟 MMP（AppsFlyer/Adjust）
 *   安装归因解析结果；有 UTM 时直接采用 UTM。
 * - `appsflyer` / `adjust`：真实 SDK 骨架（读取 conversion data）。
 *
 * 解析出的「规范归因」(media_source/campaign/adset/creative) 通过
 * `/api/attribution/postback` 落库（每用户一次，幂等）。
 */

import { getProviderSection } from '../monetization/providerConfig.js';
import { getSessionAttributionSnapshot } from '../channelAttribution.js';

const POSTED_KEY = 'openblock_attr_posted_v1';

/** 权重随机选取一个渠道。 */
export function pickStubChannel(channelMix, rng = Math.random) {
    const mix = Array.isArray(channelMix) && channelMix.length
        ? channelMix
        : [{ source: 'organic', medium: 'organic', weight: 1 }];
    const total = mix.reduce((s, c) => s + (Number(c.weight) || 0), 0) || 1;
    let r = rng() * total;
    for (const c of mix) {
        r -= (Number(c.weight) || 0);
        if (r <= 0) return c;
    }
    return mix[mix.length - 1];
}

/** 把 UTM / 渠道对象规范化为 MMP 口径。 */
export function toCanonical(src) {
    return {
        media_source: src.source || src.utm_source || 'organic',
        medium: src.medium || src.utm_medium || 'organic',
        campaign: src.campaign || src.utm_campaign || 'unknown',
        adset: src.adset || src.utm_term || '',
        creative: src.content || src.utm_content || '',
    };
}

/**
 * 解析规范归因（纯函数，便于测试）。
 * @param {object} cfg attribution 配置段
 * @param {object|null} utmSnapshot getSessionAttributionSnapshot() 结果
 * @param {() => number} rng
 */
export function resolveAttribution(cfg, utmSnapshot, rng = Math.random) {
    if (utmSnapshot && utmSnapshot.utm_source) {
        return { ...toCanonical(utmSnapshot), resolver: cfg?.type || 'stub', via: 'utm' };
    }
    // 真实 MMP 在此读取 SDK conversion data（骨架：缺凭据则回退到 stub mix）
    const picked = pickStubChannel(cfg?.stub?.channelMix, rng);
    return { ...toCanonical(picked), resolver: cfg?.type || 'stub', via: 'resolved' };
}

function _userId() {
    try { return localStorage.getItem('bb_user_id') || ''; } catch { return ''; }
}

function _alreadyPosted() {
    try { return localStorage.getItem(POSTED_KEY) === '1'; } catch { return false; }
}

/** 解析并上报安装归因（每用户一次，幂等）。 */
export async function reportInstallAttribution({ apiBase = '', force = false } = {}) {
    if (!force && _alreadyPosted()) return null;
    const cfg = getProviderSection('attribution');
    let utm = null;
    try { utm = getSessionAttributionSnapshot(); } catch { utm = null; }
    const canonical = resolveAttribution(cfg, utm);
    const userId = _userId();
    if (!userId) return canonical;
    try {
        const base = (apiBase || '').replace(/\/+$/, '');
        const res = await fetch(`${base}/api/attribution/postback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, ...canonical }),
        });
        if (res && res.ok) {
            try { localStorage.setItem(POSTED_KEY, '1'); } catch { /* ignore */ }
        }
    } catch { /* 网络失败下次再试 */ }
    return canonical;
}
