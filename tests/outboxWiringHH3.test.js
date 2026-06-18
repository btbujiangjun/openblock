/**
 * HH3: main.js outbox 上报 wire-up + Grafana panel 静态契约。
 *
 * 不真启动 main.js（依赖大），改用静态扫描验证 wiring 关键字。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HH3 outbox 上报 wire-up 契约', () => {
    const mainSrc = readFileSync('web/src/main.js', 'utf8');

    it('main.js 导入 reportingOutbox 的 getOutboxStats / resetOutboxStats', () => {
        expect(mainSrc).toMatch(/['"]\.\/net\/reportingOutbox\.js['"]/);
        expect(mainSrc).toMatch(/getOutboxStats/);
        expect(mainSrc).toMatch(/resetOutboxStats/);
    });

    it('main.js 用 60s + pagehide 模式接入（与 X1/Y3/Y4 同模式）', () => {
        expect(mainSrc).toMatch(/reporting_outbox_window/);
        const idx = mainSrc.indexOf('reporting_outbox_window');
        const slice = mainSrc.slice(Math.max(0, idx - 800), idx + 800);
        expect(slice).toMatch(/FLUSH_INTERVAL_MS\s*=\s*60_000/);
        expect(slice).toMatch(/setInterval/);
        expect(slice).toMatch(/pagehide/);
    });

    it('main.js 跳过条件：quotaTrips===0 && totalQueued===0（避免噪声 0 事件）', () => {
        const idx = mainSrc.indexOf('reporting_outbox_window');
        const slice = mainSrc.slice(Math.max(0, idx - 1000), idx);
        expect(slice).toMatch(/quotaTrips === 0/);
        expect(slice).toMatch(/totalQueued === 0/);
    });

    it('Grafana reporting_outbox_window dashboard 含 GG3 quotaTrips 核心 panel', () => {
        const dash = JSON.parse(readFileSync('ops/grafana/reporting_outbox_window.dashboard.json', 'utf8'));
        /* title 含中文，按 expr 查更稳 */
        const quotaPanel = dash.panels.find((p) =>
            (p.targets || []).some((t) => /quota_trips/.test(t.expr || '')));
        expect(quotaPanel).toBeDefined();
        expect(quotaPanel.targets[0].expr).toContain('quota_trips');
    });

    it('OBSERVABILITY_WINDOW_SCHEMA.md 含 reporting_outbox_window 字段表', () => {
        const md = readFileSync('docs/engineering/OBSERVABILITY_WINDOW_SCHEMA.md', 'utf8');
        expect(md).toMatch(/`reporting_outbox_window`/);
        expect(md).toMatch(/quotaTrips/);
        expect(md).toMatch(/quotaShedRecords/);
        expect(md).toMatch(/HH3 跳过条件/);
    });
});
