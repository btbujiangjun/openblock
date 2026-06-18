/**
 * GG5: Grafana dashboard 静态契约测试。
 *
 * 防 panel JSON 被无意删除/格式破坏，让 EE4 / FF4 在监控侧
 * "有名有姓"的可视化能力不丢。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('GG5 Grafana panel 契约', () => {
    const analyticsDash = JSON.parse(readFileSync('ops/grafana/analytics_store_window.dashboard.json', 'utf8'));
    const monBusDash = JSON.parse(readFileSync('ops/grafana/monetization_bus_window.dashboard.json', 'utf8'));

    it('analytics_store dashboard 含 EE4 fail reasons panel (id=5)', () => {
        const p5 = analyticsDash.panels.find((p) => p.id === 5);
        expect(p5).toBeDefined();
        expect(p5.title).toContain('reason');
        const expr = p5.targets[0].expr;
        expect(expr).toContain('idb_fail_reasons');
        expect(expr).toContain('reason'); /* group_by reason label */
    });

    it('analytics_store dashboard 含 GG5 reason 百分比 stack panel (id=6)', () => {
        const p6 = analyticsDash.panels.find((p) => p.id === 6);
        expect(p6).toBeDefined();
        expect(p6.fieldConfig.defaults.custom.stacking.mode).toBe('percent');
        expect(p6.fieldConfig.defaults.unit).toBe('percentunit');
    });

    it('monetization_bus dashboard 含 FF4 circuit trip byType panel (id=5)', () => {
        const p5 = monBusDash.panels.find((p) => p.id === 5);
        expect(p5).toBeDefined();
        expect(p5.title).toContain('FF4');
        const expr = p5.targets[0].expr;
        expect(expr).toContain('circuit_trips_by_type');
        expect(expr).toContain('event_type');
    });

    it('所有 panel 都有 id / title / type / targets（基础 schema）', () => {
        for (const dash of [analyticsDash, monBusDash]) {
            for (const p of dash.panels) {
                expect(p.id).toBeTypeOf('number');
                expect(p.title).toBeTypeOf('string');
                expect(p.type).toBeTypeOf('string');
                expect(Array.isArray(p.targets)).toBe(true);
            }
        }
    });

    it('panel id 在单个 dashboard 内唯一', () => {
        for (const dash of [analyticsDash, monBusDash]) {
            const ids = dash.panels.map((p) => p.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });
});
