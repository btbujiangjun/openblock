/**
 * KK3: analytics_store + monetization_bus dashboard ↔ alerts.yml 联动。
 *
 * 沿用 JJ3 模式扩展到另外两个 dashboard。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function loadDashAlerts(name) {
    return {
        dash: JSON.parse(readFileSync(join(ROOT, `ops/grafana/${name}.dashboard.json`), 'utf8')),
        alerts: readFileSync(join(ROOT, `ops/grafana/${name}.alerts.yml`), 'utf8'),
    };
}

describe('KK3 analytics_store dashboard ↔ alerts', () => {
    const { dash, alerts } = loadDashAlerts('analytics_store_window');

    it('顶层 links 含 AnalyticsStore alert 入口', () => {
        expect(dash.links).toBeDefined();
        expect(dash.links.some(l => /AnalyticsStore/.test(l.url) && /alerting/.test(l.url))).toBe(true);
    });

    it('panel 含 IdbDegradedP1 / LatencyHighP1 链接', () => {
        const allLinks = dash.panels.flatMap(p => p.links || []);
        const urls = allLinks.map(l => l.url || '');
        expect(urls.some(u => u.includes('OpenBlockAnalyticsStoreIdbDegradedP1'))).toBe(true);
        expect(urls.some(u => u.includes('OpenBlockAnalyticsStoreLatencyHighP1'))).toBe(true);
    });

    it('panel link 指向的 alert name 在 alerts.yml 真实存在', () => {
        const panels = dash.panels || [];
        for (const panel of panels) {
            for (const link of (panel.links || [])) {
                const m = link.url?.match(/queryString=(OpenBlock\w+)/);
                if (!m) continue;
                expect(alerts).toMatch(new RegExp(`alert:\\s*${m[1]}\\b`));
            }
        }
    });
});

describe('KK3 monetization_bus dashboard ↔ alerts', () => {
    const { dash, alerts } = loadDashAlerts('monetization_bus_window');

    it('顶层 links 含 MonetizationBus alert 入口', () => {
        expect(dash.links).toBeDefined();
        expect(dash.links.some(l => /MonetizationBus/.test(l.url) && /alerting/.test(l.url))).toBe(true);
    });

    it('panel 含 CircuitTripP0 / HandlerFailHighP1 / EmitsDropP2 链接', () => {
        const allLinks = dash.panels.flatMap(p => p.links || []);
        const urls = allLinks.map(l => l.url || '');
        for (const a of ['OpenBlockMonetizationBusCircuitTripP0', 'OpenBlockMonetizationBusHandlerFailHighP1', 'OpenBlockMonetizationBusEmitsDropP2']) {
            expect(urls.some(u => u.includes(a)), `缺 link → ${a}`).toBe(true);
        }
    });

    it('panel link 指向的 alert 在 alerts.yml 存在', () => {
        for (const panel of (dash.panels || [])) {
            for (const link of (panel.links || [])) {
                const m = link.url?.match(/queryString=(OpenBlock\w+)/);
                if (!m) continue;
                expect(alerts).toMatch(new RegExp(`alert:\\s*${m[1]}\\b`));
            }
        }
    });

    it('alerting 类 link 都 targetBlank=true', () => {
        const allLinks = [...(dash.links || []), ...dash.panels.flatMap(p => p.links || [])];
        for (const l of allLinks) {
            if (/alerting/.test(l.url || '')) {
                expect(l.targetBlank).toBe(true);
            }
        }
    });
});
