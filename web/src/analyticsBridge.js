/**
 * 第三方分析镜像占位：成功时可接 gtag / fbq；失败时写入服务端 DLQ。
 */
import { getApiBaseUrl } from './config.js';
import { isSqliteClientDatabase } from './config.js';

/**
 * @param {string} provider 例如 'ga4' | 'internal'
 * @param {string} eventName
 * @param {Record<string, unknown>} payload
 */
export async function mirrorAnalyticsEvent(provider, eventName, payload = {}) {
    try {
        if (typeof window !== 'undefined' && window.gtag && provider === 'ga4') {
            window.gtag('event', eventName, payload);
            return { ok: true, channel: 'gtag' };
        }
    } catch {
        /* ignore */
    }
    if (!isSqliteClientDatabase()) return { ok: false, channel: 'skip' };
    try {
        const base = getApiBaseUrl().replace(/\/+$/, '');
        await fetch(`${base}/api/enterprise/analytics-mirror`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, event: eventName, payload }),
        });
        return { ok: true, channel: 'dlq' };
    } catch {
        return { ok: false, channel: 'failed' };
    }
}
