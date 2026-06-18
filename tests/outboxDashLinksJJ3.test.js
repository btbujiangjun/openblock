/**
 * JJ3: reporting_outbox dashboard ↔ alerts.yml 联动契约。
 *
 * 验证：dashboard 中每个 panel 都按相关 alert 加 links，
 * 且 alerts.yml 真实存在对应 alert name。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const DASH = JSON.parse(readFileSync(join(ROOT, 'ops/grafana/reporting_outbox_window.dashboard.json'), 'utf8'));
const ALERTS = readFileSync(join(ROOT, 'ops/grafana/reporting_outbox_window.alerts.yml'), 'utf8');

describe('JJ3 outbox dashboard ↔ alerts 联动', () => {
    it('dashboard 顶层 links 含 alert 列表入口', () => {
        const links = DASH.links || [];
        expect(links.length).toBeGreaterThanOrEqual(1);
        const alertLink = links.find(l => /Outbox/.test(l.url) && /alerting/.test(l.url));
        expect(alertLink).toBeTruthy();
    });

    it('每个 panel 都引用其相关的 alert（按 metric 表达式映射）', () => {
        const panels = DASH.panels || [];
        const linkMap = {
            'quota_trips': ['QuotaTripsP0', 'QuotaTripsP1'],
            'quota_shed_records': ['ShedSurgeP2'],
            'total_queued': ['QueueHighP2'],
        };
        for (const panel of panels) {
            const expr = panel.targets?.[0]?.expr || '';
            const matched = Object.entries(linkMap).find(([k]) => expr.includes(k));
            if (!matched) continue; /* channel_count 暂无告警，跳过 */
            const [, expectedAlerts] = matched;
            const links = panel.links || [];
            for (const expectedAlert of expectedAlerts) {
                const found = links.some(l => l.url?.includes(expectedAlert));
                expect(found, `panel "${panel.title}" 缺 link → ${expectedAlert}`).toBe(true);
            }
        }
    });

    it('panel link 中的 alert name 都在 alerts.yml 真实存在', () => {
        const panels = DASH.panels || [];
        for (const panel of panels) {
            for (const link of (panel.links || [])) {
                const m = link.url?.match(/queryString=(OpenBlock\w+)/);
                if (!m) continue;
                const alertName = m[1];
                expect(ALERTS, `panel link 指向不存在的 alert: ${alertName}`).toMatch(new RegExp(`alert:\\s*${alertName}\\b`));
            }
        }
    });

    it('targetBlank=true 防告警页面替换 dashboard', () => {
        const allLinks = [
            ...(DASH.links || []),
            ...(DASH.panels || []).flatMap(p => p.links || []),
        ];
        for (const l of allLinks) {
            if (/alerting/.test(l.url)) {
                expect(l.targetBlank).toBe(true);
            }
        }
    });
});
