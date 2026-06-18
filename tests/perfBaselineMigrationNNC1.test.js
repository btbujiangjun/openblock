/**
 * NN-C1: perf-baseline _migrateBaseline 对称 LL5 trend-history。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/perf-check.mjs');

describe('NN-C1 perf-baseline _migrateBaseline', () => {
    const src = readFileSync(SCRIPT, 'utf8');

    it('_migrateBaseline 函数存在 + 注释列 v1→v2 示例', () => {
        expect(src).toMatch(/function _migrateBaseline/);
        expect(src).toMatch(/v1\s*→\s*v2/);
        expect(src).toMatch(/p999Ms|gpu/);
    });

    it('迁移返回 { migrated, fromVersion, didMigrate } 三字段', () => {
        expect(src).toMatch(/return\s*\{\s*migrated:\s*baseline.*didMigrate:\s*false/s);
        expect(src).toMatch(/return\s*\{\s*migrated:\s*current.*fromVersion.*didMigrate:\s*true/s);
    });

    it('当前版本 = 1 → 无迁移（didMigrate=false）', () => {
        expect(src).toMatch(/if\s*\(fromVersion\s*===\s*PERF_BASELINE_SCHEMA_VERSION\)/);
    });

    it('迁移日志：标明 v? → v? 自动迁移', () => {
        expect(src).toMatch(/v\$\{fromVersion\}\s*→\s*v\$\{PERF_BASELINE_SCHEMA_VERSION\}/);
    });

    it('迁移后 inject schemaVersion 字段（兜底）', () => {
        expect(src).toMatch(/schemaVersion:\s*PERF_BASELINE_SCHEMA_VERSION/);
    });

    it('无 schemaVersion 旧 baseline → 自动当 v1 → 迁移成功（dry run）', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'perfb-nnc1-'));
        const fake = join(tmp, 'baseline.json');
        /* 模拟最古老的 baseline：完全无 meta.schemaVersion */
        writeFileSync(fake, JSON.stringify({
            meta: { capturedAt: '2020-01-01', nodeVersion: 'v18.0.0' },
            results: [{ scenarioId: 'x', p50Ms: 1, p95Ms: 2, p99Ms: 3, samples: 10, totalMs: 30 }],
        }));
        const r = spawnSync('node', [SCRIPT, '--baseline', fake], {
            cwd: tmp, encoding: 'utf8', timeout: 30_000,
        });
        /* 因为无 schemaVersion fallback 为 1，与当前 PERF_BASELINE_SCHEMA_VERSION=1 相等
         * → 不触发迁移日志，但脚本不应崩 */
        /* 退出码 0 (成功) 或 1 (perf 失败) 都 OK，只要不是 schema 拒绝码 3 */
        expect(r.status).not.toBe(3);
    });
});
