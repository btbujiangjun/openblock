/**
 * MM5: perf-baseline.json schemaVersion 守护契约。
 *
 * 对称 LL5 trend-history schemaVersion 演进，防止未来 baseline 字段
 * 变更时旧脚本静默误解读。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/perf-check.mjs');
const BASELINE_PROD = join(ROOT, 'tests/perf-baseline.json');

describe('MM5 perf-baseline schemaVersion 演进守护', () => {
    it('perf-check.mjs 声明 PERF_BASELINE_SCHEMA_VERSION', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/PERF_BASELINE_SCHEMA_VERSION\s*=\s*1/);
    });

    it('perf-check.mjs 包含 schemaVersion 校验逻辑', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/baseline\?\.meta\?\.schemaVersion/);
        expect(src).toMatch(/baseVer\s*>\s*PERF_BASELINE_SCHEMA_VERSION/);
        expect(src).toMatch(/process\.exit\(3\)/);
    });

    it('当前 tests/perf-baseline.json 写了 schemaVersion=1', () => {
        const j = JSON.parse(readFileSync(BASELINE_PROD, 'utf8'));
        expect(j.meta.schemaVersion).toBe(1);
    });

    it('perf-bench-cli.mjs 写出 schemaVersion=1', () => {
        const src = readFileSync(join(ROOT, 'scripts/perf-bench-cli.mjs'), 'utf8');
        expect(src).toMatch(/schemaVersion:\s*1/);
    });

    it('未来 v999 baseline → 守护 exit 3（拒绝误解读）', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'perfb-mm5-'));
        const fake = join(tmp, 'baseline.json');
        writeFileSync(fake, JSON.stringify({
            meta: { schemaVersion: 999, capturedAt: '2099-01-01' },
            results: [{ scenarioId: 'x', p50Ms: 1, p95Ms: 2, p99Ms: 3, samples: 1, totalMs: 1 }],
        }));
        const r = spawnSync('node', [SCRIPT, '--baseline', fake], {
            cwd: tmp, encoding: 'utf8', timeout: 20_000,
        });
        expect(r.status).toBe(3);
        expect(r.stderr).toMatch(/schemaVersion=999/);
    });

    it('schemaVersion=0 非法 → exit 3', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'perfb-mm5-'));
        const fake = join(tmp, 'baseline.json');
        writeFileSync(fake, JSON.stringify({
            meta: { schemaVersion: 0 },
            results: [{ scenarioId: 'x', p50Ms: 1, p95Ms: 2, p99Ms: 3, samples: 1, totalMs: 1 }],
        }));
        const r = spawnSync('node', [SCRIPT, '--baseline', fake], {
            cwd: tmp, encoding: 'utf8', timeout: 20_000,
        });
        expect(r.status).toBe(3);
    });

    it('缺 schemaVersion 字段 → 默认 v1（向后兼容老 baseline）', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        /* 静态检查"无字段→v1"的兼容逻辑存在 */
        expect(src).toMatch(/schemaVersion\s*\?\?\s*1/);
    });
});
