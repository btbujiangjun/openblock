/**
 * HH5: benchmark-suite trend history + 5 周滑动容错。
 *
 * 验证 --trend-history / --trend-fail-streak / --trend-history-write 协议。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runSuite(args, timeoutMs = 60_000) {
    const result = spawnSync('node', ['scripts/benchmark-suite.mjs', ...args], {
        encoding: 'utf8', timeout: timeoutMs,
    });
    return {
        stdout: result.stdout || '', stderr: result.stderr || '', status: result.status,
    };
}

describe('HH5 trend history + streak', () => {
    it('--trend-history-write 在指定文件追加 entry', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hh5-'));
        const baseline = join(dir, 'base.json');
        const history = join(dir, 'hist.json');
        writeFileSync(baseline, JSON.stringify({
            schemaVersion: 1, ts: 0,
            deadCode: { unusedCount: 80, totalExports: 9999 },
            dfs: { truncatedRatio: 0, cappedRatio: 0.30, totalCalls: 1000 },
            dist: { bytes: 6_000_000 },
        }), 'utf8');
        const r = runSuite(['--skip-perf',
            '--trend-baseline', baseline,
            '--trend-history', history,
            '--trend-history-write']);
        expect([0, 1]).toContain(r.status);
        expect(existsSync(history)).toBe(true);
        const h = JSON.parse(readFileSync(history, 'utf8'));
        expect(Array.isArray(h.entries)).toBe(true);
        expect(h.entries.length).toBe(1);
        const e0 = h.entries[0];
        expect(typeof e0.ts).toBe('number');
        expect(typeof e0.regressed).toBe('boolean');
        expect(e0.snapshot).toBeDefined();
    }, 90_000);

    it('history 已有 2 entries → write 后变 3', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hh5-'));
        const history = join(dir, 'hist.json');
        writeFileSync(history, JSON.stringify({
            entries: [
                { ts: 1, regressed: false, snapshot: { schemaVersion: 1 } },
                { ts: 2, regressed: true, snapshot: { schemaVersion: 1 } },
            ],
        }), 'utf8');
        const r = runSuite(['--skip-perf', '--trend-history', history, '--trend-history-write']);
        expect([0, 1]).toContain(r.status);
        const h = JSON.parse(readFileSync(history, 'utf8'));
        expect(h.entries.length).toBe(3);
        expect(h.entries[0].ts).toBe(1); /* 保留旧 entries */
    }, 90_000);

    it('streak=3 + history 已有 2 regress → 本次未 regress → 不 fail', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hh5-'));
        const history = join(dir, 'hist.json');
        const baseline = join(dir, 'base.json');
        writeFileSync(history, JSON.stringify({
            entries: [
                { ts: 1, regressed: true, snapshot: {} },
                { ts: 2, regressed: true, snapshot: {} },
            ],
        }), 'utf8');
        /* 高 baseline（不易 regress） */
        writeFileSync(baseline, JSON.stringify({
            schemaVersion: 1, ts: 0,
            deadCode: { unusedCount: 99999, totalExports: 99999 },
            dfs: { truncatedRatio: 1, cappedRatio: 1, totalCalls: 99999 },
            dist: { bytes: 999_999_999 },
        }), 'utf8');
        const r = runSuite(['--skip-perf',
            '--trend-baseline', baseline,
            '--trend-history', history,
            '--trend-history-write',
            '--trend-fail-on-regress',
            '--trend-fail-streak', '3']);
        /* dead-code scan 可能 exit 1（独立维度），但 trend 本身不应触发 fail */
        const looseFail = (r.stderr || '').includes('trend 连续');
        expect(looseFail).toBe(false);
    }, 90_000);

    it('streak=2 + history 已有 1 regress → 本次 regress → fail', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hh5-'));
        const history = join(dir, 'hist.json');
        const baseline = join(dir, 'base.json');
        writeFileSync(history, JSON.stringify({
            entries: [{ ts: 1, regressed: true, snapshot: {} }],
        }), 'utf8');
        /* 极小 baseline（必 regress） */
        writeFileSync(baseline, JSON.stringify({
            schemaVersion: 1, ts: 0,
            deadCode: { unusedCount: 1, totalExports: 1 },
            dfs: { truncatedRatio: 0, cappedRatio: 0.001, totalCalls: 1 },
            dist: { bytes: 1 },
        }), 'utf8');
        const r = runSuite(['--skip-perf',
            '--trend-baseline', baseline,
            '--trend-history', history,
            '--trend-history-write',
            '--trend-fail-on-regress',
            '--trend-fail-streak', '2']);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/trend 连续\s*2\s*次退化/);
    }, 90_000);

    it('单次 regress 但未达 streak → 仅 warn，不 fail', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hh5-'));
        const history = join(dir, 'hist.json');
        const baseline = join(dir, 'base.json');
        /* 空 history */
        writeFileSync(history, JSON.stringify({ entries: [] }), 'utf8');
        writeFileSync(baseline, JSON.stringify({
            schemaVersion: 1, ts: 0,
            deadCode: { unusedCount: 1, totalExports: 1 },
            dfs: { truncatedRatio: 0, cappedRatio: 0.001, totalCalls: 1 },
            dist: { bytes: 1 },
        }), 'utf8');
        const r = runSuite(['--skip-perf',
            '--trend-baseline', baseline,
            '--trend-history', history,
            '--trend-history-write',
            '--trend-fail-on-regress',
            '--trend-fail-streak', '3']);
        /* 单次 regress + streak=3 → 仅 warn */
        expect(r.stderr).toMatch(/未达 streak 阈值|继续观察/);
    }, 90_000);
});
