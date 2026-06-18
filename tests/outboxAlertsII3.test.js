/**
 * II3: reporting_outbox_window.alerts.yml 契约测试。
 *
 * 验证 4 条告警存在 + 关键 metric 名 + 严重等级齐全。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const ALERTS_PATH = join(ROOT, 'ops/grafana/reporting_outbox_window.alerts.yml');

describe('II3 reporting_outbox alerts.yml', () => {
    it('alerts.yml 存在', () => {
        expect(existsSync(ALERTS_PATH)).toBe(true);
    });

    const yml = existsSync(ALERTS_PATH) ? readFileSync(ALERTS_PATH, 'utf8') : '';

    it('group 命名 openblock.reporting_outbox', () => {
        expect(yml).toMatch(/name:\s*openblock\.reporting_outbox/);
    });

    it('包含 4 条 alert（P0 quota / P1 quota 持续 / P2 queue 高位 / P2 shed 突增）', () => {
        const alerts = yml.match(/-\s*alert:\s*\w+/g) || [];
        expect(alerts.length).toBe(4);
    });

    it('严重等级齐全（P0 + P1 + 2×P2）', () => {
        expect(yml).toMatch(/severity:\s*P0/);
        expect(yml).toMatch(/severity:\s*P1/);
        const p2Count = (yml.match(/severity:\s*P2/g) || []).length;
        expect(p2Count).toBeGreaterThanOrEqual(2);
    });

    it('引用 GG3/HH3 关键 metric', () => {
        expect(yml).toMatch(/openblock_reporting_outbox_quota_trips/);
        expect(yml).toMatch(/openblock_reporting_outbox_quota_shed_records/);
        expect(yml).toMatch(/openblock_reporting_outbox_total_queued/);
    });

    it('P0 告警的 for 窗口 ≤ 10m（短窗强响应）', () => {
        const p0Block = yml.match(/severity:\s*P0[\s\S]*?(?=- alert:|$)/);
        expect(p0Block).toBeTruthy();
        /* P0 排版上 for 在 severity 之前的 alert 块内 */
        const fullP0Alert = yml.match(/- alert:[^]*?severity:\s*P0[^]*?(?=- alert:|$)/);
        expect(fullP0Alert).toBeTruthy();
        const forMatch = fullP0Alert[0].match(/for:\s*(\d+)m/);
        expect(forMatch).toBeTruthy();
        expect(parseInt(forMatch[1], 10)).toBeLessThanOrEqual(10);
    });

    it('README 同步更新 reporting_outbox 映射表', () => {
        const readme = readFileSync(join(ROOT, 'ops/grafana/README.md'), 'utf8');
        expect(readme).toMatch(/reporting_outbox_window\.alerts\.yml/);
        expect(readme).toMatch(/openblock_reporting_outbox_quota_trips/);
    });
});
