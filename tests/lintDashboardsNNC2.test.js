/**
 * NN-C2: ops/grafana dashboard.json schemaVersion lint contract。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/lint-dashboards.mjs');

function setup(jsonByName) {
    const tmp = mkdtempSync(join(tmpdir(), 'lintdash-'));
    mkdirSync(join(tmp, 'ops/grafana'), { recursive: true });
    for (const [name, obj] of Object.entries(jsonByName)) {
        writeFileSync(join(tmp, 'ops/grafana', name), JSON.stringify(obj, null, 2));
    }
    return tmp;
}
const run = (cwd) => spawnSync('node', [SCRIPT], { cwd, encoding: 'utf8', timeout: 10_000 });

const validDash = (i) => ({
    title: `Dashboard ${i}`,
    uid: `dash-${i}`,
    schemaVersion: 38,
    panels: [],
});

describe('NN-C2 lint-dashboards', () => {
    it('package.json 注册 lint:dashboards script', () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['lint:dashboards']).toBe('node scripts/lint-dashboards.mjs');
    });

    it('当前 repo 4 dashboards 通过（schemaVersion=38 一致）', () => {
        const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/4 dashboards/);
    });

    it('合规 dashboards → pass', () => {
        const tmp = setup({ 'a.dashboard.json': validDash(1), 'b.dashboard.json': validDash(2) });
        expect(run(tmp).status).toBe(0);
    });

    it('缺 schemaVersion → fail', () => {
        const dash = { ...validDash(1) }; delete dash.schemaVersion;
        const r = run(setup({ 'a.dashboard.json': dash }));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/missing-schemaVersion/);
    });

    it('schemaVersion 漂移（38 + 30）→ fail', () => {
        const r = run(setup({
            'a.dashboard.json': { ...validDash(1), schemaVersion: 38 },
            'b.dashboard.json': { ...validDash(2), schemaVersion: 30 },
        }));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/schemaVersion-drift/);
    });

    it('schemaVersion 过老（v15）→ fail', () => {
        const r = run(setup({ 'a.dashboard.json': { ...validDash(1), schemaVersion: 15 } }));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/schemaVersion-too-old/);
    });

    it('缺 title / uid / panels → fail', () => {
        const d = { schemaVersion: 38 };
        const r = run(setup({ 'a.dashboard.json': d }));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/missing-title/);
        expect(r.stderr).toMatch(/missing-uid/);
        expect(r.stderr).toMatch(/missing-panels/);
    });

    it('JSON 损坏 → invalid-json fail', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'lintdash-'));
        mkdirSync(join(tmp, 'ops/grafana'), { recursive: true });
        writeFileSync(join(tmp, 'ops/grafana/a.dashboard.json'), '{not json');
        const r = run(tmp);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/invalid-json/);
    });

    it('空目录 → ok（不强制至少 1 个 dashboard）', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'lintdash-'));
        mkdirSync(join(tmp, 'ops/grafana'), { recursive: true });
        expect(run(tmp).status).toBe(0);
    });

    it('确认所有 4 dashboard schemaVersion 都是 38', () => {
        const dir = join(ROOT, 'ops/grafana');
        const files = readdirSync(dir).filter(f => f.endsWith('.dashboard.json'));
        for (const f of files) {
            const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
            expect(d.schemaVersion).toBe(38);
        }
    });
});
