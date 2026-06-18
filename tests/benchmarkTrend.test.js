/**
 * EE5: benchmark-suite trend 对比烟雾测试。
 * 验证 --write-trend / --trend-baseline 协议。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* OO1: spawn 一次 benchmark-suite 需 ~10s（dead-code 扫 + dfs）。
 * 在并发 worker 下 CPU 拥堵会令默认 60s timeout 偶发触发，导致 stdout=''，断言空失败。
 * 修法：
 *   1) timeout 提升到 120s，留充足余量；
 *   2) 失败时（被 timeout 杀 / 输出为空）retry 1 次；
 *   3) 用 `describe.sequential` 禁文件内 4 个 case 并发抢核（vitest 默认 it 已串行，
 *      此处显式声明强化语义并防回归）。
 */
function runSuite(args, timeoutMs = 120_000) {
    const exec = () => {
        const r = spawnSync('node', ['scripts/benchmark-suite.mjs', ...args], {
            encoding: 'utf8', timeout: timeoutMs,
        });
        return {
            stdout: r.stdout || '',
            stderr: r.stderr || '',
            status: r.status,
            signal: r.signal,
            error: r.error,
        };
    };
    let res = exec();
    /* timeout / 空输出 → 重试一次（最常见 flaky 模式） */
    if (res.signal === 'SIGTERM' || res.error?.code === 'ETIMEDOUT' || (!res.stdout && res.status !== 0)) {
        res = exec();
    }
    return res;
}

describe.sequential('EE5 benchmark-suite trend', () => {
    it('--write-trend 生成 schema v1 snapshot 文件', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ob-trend-'));
        const file = join(dir, 'snap.json');
        const r = runSuite(['--skip-perf', '--write-trend', file]);
        expect(r.status === 0 || r.status === 1).toBe(true); /* dead code 可能 fail，但 snapshot 仍写出 */
        expect(existsSync(file)).toBe(true);
        const snap = JSON.parse(readFileSync(file, 'utf8'));
        expect(snap.schemaVersion).toBe(1);
        expect(typeof snap.ts).toBe('number');
        expect(snap.deadCode).toBeDefined();
        expect(snap.dfs).toBeDefined();
        expect(snap.dist).toBeDefined();
    }, 240_000);

    it('--trend-baseline 与已有 snapshot 对比，输出"维度 5"段', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ob-trend-'));
        const file = join(dir, 'base.json');
        /* 人工写一个伪 baseline，所有值偏小 → 当前值看起来更"大"（恶化但不超 10% 阈值） */
        writeFileSync(file, JSON.stringify({
            schemaVersion: 1,
            ts: Date.now() - 86400000,
            deadCode: { unusedCount: 70, totalExports: 9999 },
            dfs: { truncatedRatio: 0, cappedRatio: 0.25, totalCalls: 1000 },
            dist: { bytes: 6_100_000 },
        }), 'utf8');
        const r = runSuite(['--skip-perf', '--trend-baseline', file]);
        expect(r.stdout).toContain('维度 5');
        expect(r.stdout).toMatch(/基线时间/);
        expect(r.stdout).toMatch(/dead code unused/);
        expect(r.stdout).toMatch(/DFS cappedRatio/);
    }, 240_000);

    it('--trend-fail-on-regress + 巨大基线（当前严重退化）→ exit 1', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ob-trend-'));
        const file = join(dir, 'baseline-tiny.json');
        /* baseline 是"理想很低值"，当前现实数值远超 → 触发 >10% 退化 */
        writeFileSync(file, JSON.stringify({
            schemaVersion: 1, ts: 0,
            deadCode: { unusedCount: 1, totalExports: 1 },
            dfs: { truncatedRatio: 0, cappedRatio: 0.001, totalCalls: 1 },
            dist: { bytes: 1 },
        }), 'utf8');
        const r = runSuite(['--skip-perf', '--trend-baseline', file, '--trend-fail-on-regress']);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/trend 检测到.+退化/);
    }, 240_000);

    it('无 baseline → "维度 5" 提示"未指定"', () => {
        const r = runSuite(['--skip-perf']);
        expect(r.stdout).toContain('维度 5');
        expect(r.stdout).toMatch(/未指定.+trend-baseline/);
    }, 240_000);
});
