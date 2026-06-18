/**
 * LL5: trend-history schema version 字段 + migration 契约。
 *
 * 静态验证脚本结构 + dry run 验证 v1 → v2 升级 + 未来版本拒读。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/benchmark-suite.mjs');

describe('LL5 trend-history schema version', () => {
    const src = readFileSync(SCRIPT, 'utf8');

    it('脚本含 HISTORY_SCHEMA_VERSION 常量', () => {
        expect(src).toMatch(/HISTORY_SCHEMA_VERSION\s*=\s*2/);
    });

    it('脚本含 _migrateHistory + v1 → v2 升级', () => {
        expect(src).toMatch(/_migrateHistory/);
        expect(src).toMatch(/v1.*→.*v2.*migration/);
    });

    it('写出时带 schemaVersion 字段', () => {
        expect(src).toMatch(/schemaVersion:\s*HISTORY_SCHEMA_VERSION/);
    });

    it('未来 schemaVersion 主动丢弃 + warn', () => {
        expect(src).toMatch(/未来 schema.*不识别.*丢弃/);
    });

    /* 算法独立验证（同源拷贝） */
    function migrate(parsed) {
        if (parsed == null || typeof parsed !== 'object') return [];
        const sv = parsed.schemaVersion;
        if (sv == null) {
            if (Array.isArray(parsed.entries)) return parsed.entries;
            return [];
        }
        if (sv === 2) return Array.isArray(parsed.entries) ? parsed.entries : [];
        return [];
    }

    it('migrate: v1（无 schemaVersion）→ 透传 entries', () => {
        expect(migrate({ entries: [{ ts: 1, regressed: false, snapshot: {} }] })).toHaveLength(1);
    });
    it('migrate: v2 → 透传 entries', () => {
        expect(migrate({ schemaVersion: 2, entries: [{ ts: 1, regressed: false }] })).toHaveLength(1);
    });
    it('migrate: 未来 v99 → 返回空（拒读）', () => {
        expect(migrate({ schemaVersion: 99, entries: [{ ts: 1 }] })).toEqual([]);
    });
    it('migrate: null / undefined / 非对象 → 空', () => {
        expect(migrate(null)).toEqual([]);
        expect(migrate(undefined)).toEqual([]);
        expect(migrate('garbage')).toEqual([]);
        expect(migrate(42)).toEqual([]);
    });
    it('migrate: 缺 entries → 空', () => {
        expect(migrate({})).toEqual([]);
        expect(migrate({ schemaVersion: 2 })).toEqual([]);
    });

    it('dry run：v1 history → 脚本写出含 schemaVersion=2', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'bench-ll5-'));
        const histPath = join(tmp, 'hist.json');
        /* 写 v1 schema（无 schemaVersion 字段） */
        writeFileSync(histPath, JSON.stringify({
            entries: [{
                ts: Date.now() - 86400000,
                regressed: false,
                snapshot: { deadCode: { unusedCount: 5 }, dfs: {}, dist: { bytes: 100 } },
            }],
        }), 'utf8');
        const r = spawnSync('node', [SCRIPT, '--skip-perf', '--trend-history', histPath, '--trend-history-write'], {
            cwd: ROOT, encoding: 'utf8', timeout: 60_000,
        });
        expect(r.status).toBe(0);
        /* 升级提示应出现 */
        expect(r.stderr).toMatch(/v1 → v2 migration/);
        /* 文件写后应含 schemaVersion */
        const after = JSON.parse(readFileSync(histPath, 'utf8'));
        expect(after.schemaVersion).toBe(2);
        expect(Array.isArray(after.entries)).toBe(true);
    });
});
