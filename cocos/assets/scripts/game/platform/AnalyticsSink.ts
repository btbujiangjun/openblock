/**
 * 埋点 Sink 平台实现（Phase P2）。微信走 wx.reportEvent / wx.reportAnalytics；
 * 其它端可接 HTTP（此处留 navigator.sendBeacon 兜底）；都不可用时静默。
 * 在 Bootstrap 用 Analytics.useSink(makeAnalyticsSink()) 注入。
 */
import { AnalyticsSink } from '../../core';

interface WxReportApi {
    reportEvent?: (id: string, params: Record<string, unknown>) => void;
    reportAnalytics?: (id: string, params: Record<string, unknown>) => void;
}

function wx(): WxReportApi | null {
    return (globalThis as unknown as { wx?: WxReportApi }).wx ?? null;
}

class PlatformSink implements AnalyticsSink {
    private endpoint: string | null;
    constructor(endpoint: string | null) {
        this.endpoint = endpoint;
    }
    send(event: string, params: Record<string, unknown>): void {
        const api = wx();
        if (api?.reportEvent) { try { api.reportEvent(event, params); return; } catch { /* fall through */ } }
        if (api?.reportAnalytics) { try { api.reportAnalytics(event, params); return; } catch { /* fall through */ } }
        if (this.endpoint) {
            const nav = (globalThis as unknown as { navigator?: { sendBeacon?: (u: string, d: string) => boolean } }).navigator;
            try { nav?.sendBeacon?.(this.endpoint, JSON.stringify({ event, params })); } catch { /* ignore */ }
        }
    }
}

export function makeAnalyticsSink(endpoint: string | null = null): AnalyticsSink {
    return new PlatformSink(endpoint);
}
