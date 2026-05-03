/**
 * ChannelAttribution — 渠道归因
 *
 * 功能
 * ----
 * - 解析 URL 中的 UTM 参数（utm_source / utm_medium / utm_campaign / utm_content）
 * - 首次访问时持久化到 localStorage（不覆盖已有首次归因，仅追加最近一次）
 * - 供商业化分析面板展示来源，并辅助 D 类用户的 LTV 预测
 *
 * UTM 参数规范
 * -----------
 *   utm_source   来源渠道（如 applovin / unity / google / organic）
 *   utm_medium   媒介类型（如 cpi / cpm / organic）
 *   utm_campaign 活动名称（如 2026q2_dau / season1_launch）
 *   utm_content  具体创意 ID（可选）
 *
 * 使用方式
 * -------
 *   import { initChannelAttribution, getAttribution } from './channelAttribution.js';
 *   initChannelAttribution();
 *   const attr = getAttribution();
 *   // attr.first.source === 'applovin'
 */

const STORAGE_KEY = 'openblock_channel_attr';

/** @typedef {{ source:string, medium:string, campaign:string, content:string, ts:number }} AttrRecord */

/**
 * 从当前 URL 解析 UTM 参数
 * @returns {AttrRecord|null}
 */
function parseUTM() {
    try {
        const params = new URLSearchParams(window.location.search);
        let source = params.get('utm_source') || '';
        const gclid = params.get('gclid') || '';
        const fbclid = params.get('fbclid') || '';
        if (!source && gclid) source = 'google_gclid';
        if (!source && fbclid) source = 'facebook_fbclid';
        if (!source) return null;
        return {
            source,
            medium: params.get('utm_medium') || 'unknown',
            campaign: params.get('utm_campaign') || 'unknown',
            content: params.get('utm_content') || '',
            gclid: gclid || undefined,
            fbclid: fbclid || undefined,
            ts: Date.now(),
        };
    } catch {
        return null;
    }
}

/**
 * 初始化归因：解析 UTM，写入 localStorage
 */
export function initChannelAttribution() {
    const utm = parseUTM();
    if (!utm) return;

    try {
        const raw  = localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};

        // 首次归因：永远保留
        if (!data.first) data.first = utm;

        // 最近一次归因（每次覆盖）
        data.last = utm;

        // 历史记录（最多保留 20 条）
        data.history = data.history ?? [];
        data.history.push(utm);
        if (data.history.length > 20) data.history = data.history.slice(-20);

        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

        // 清理 URL 中的 UTM 参数，避免用户分享含归因链接
        try {
            const url = new URL(window.location.href);
            ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'gclid', 'fbclid'].forEach(k =>
                url.searchParams.delete(k)
            );
            window.history.replaceState({}, '', url.toString());
        } catch { /* ignore */ }
    } catch { /* localStorage 不可用 */ }
}

/**
 * 获取归因数据
 * @returns {{ first: AttrRecord|null, last: AttrRecord|null, history: AttrRecord[] }}
 */
export function getAttribution() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        return {
            first:   data.first   ?? null,
            last:    data.last    ?? null,
            history: data.history ?? [],
        };
    } catch {
        return { first: null, last: null, history: [] };
    }
}

/**
 * 判断用户是否来自买量渠道（Applovin / Unity 等）
 * 用于 D 类用户识别
 */
export function isPaidChannel() {
    const attr = getAttribution();
    const src = (attr.first?.source ?? attr.last?.source ?? '').toLowerCase();
    return ['applovin', 'unity', 'ironsource', 'mintegral', 'vungle', 'facebook', 'google_uac'].some(s => src.includes(s));
}

/**
 * 写入会话 API 的扁平归因载荷（sessions.attribution）
 * @returns {Record<string, unknown>}
 */
export function getSessionAttributionSnapshot() {
    const a = getAttribution();
    const ref = a.first || a.last;
    if (!ref) return {};
    return {
        utm_source: ref.source,
        utm_medium: ref.medium,
        utm_campaign: ref.campaign,
        utm_content: ref.content,
        gclid: ref.gclid,
        fbclid: ref.fbclid,
        ts: ref.ts,
    };
}
