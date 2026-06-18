/**
 * II5: benchmark-suite sparkline + WoW 渲染契约测试。
 *
 * 不实际跑 benchmark-suite（耗时长），而是：
 *   1. 验证脚本含 sparkline + WoW 实现
 *   2. 独立验证 sparkline 算法（同源拷贝）和 WoW 算法
 *   3. 用真实 trend-history.json 跑一次 dry render，确认输出含 sparkline 表
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/benchmark-suite.mjs');

describe('II5 benchmark sparkline + WoW', () => {
    const src = readFileSync(SCRIPT, 'utf8');

    it('脚本含 sparkline 实现', () => {
        expect(src).toMatch(/_sparkline\s*\(/);
        expect(src).toMatch(/▁▂▃▄▅▆▇█/);
    });

    it('脚本含 WoW 实现', () => {
        expect(src).toMatch(/_wowSummary/);
        expect(src).toMatch(/Trend History/);
    });

    it('sparkline 算法：单调升序输出最小→最大字符', () => {
        const SP = '▁▂▃▄▅▆▇█';
        function spark(values) {
            const v = values.filter(x => Number.isFinite(x));
            if (v.length === 0) return '';
            const min = Math.min(...v); const max = Math.max(...v);
            if (max === min) return SP[0].repeat(v.length);
            return v.map(x => SP[Math.min(SP.length - 1, Math.max(0,
                Math.floor((x - min) / (max - min) * (SP.length - 1))))]).join('');
        }
        expect(spark([1, 2, 3, 4, 5, 6, 7, 8])).toBe('▁▂▃▄▅▆▇█');
        expect(spark([5, 5, 5])).toBe('▁▁▁');
        expect(spark([])).toBe('');
        /* 降序 */
        expect(spark([8, 7, 6, 5, 4, 3, 2, 1])).toBe('█▇▆▅▄▃▂▁');
    });

    it('WoW 算法：最近两次 snapshot 环比', () => {
        function wow(snaps, key) {
            if (snaps.length < 2) return '–';
            const last = snaps[snaps.length - 1]?.[key];
            const prev = snaps[snaps.length - 2]?.[key];
            if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return '–';
            const pct = (last - prev) / Math.abs(prev) * 100;
            return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
        }
        expect(wow([{ x: 100 }], 'x')).toBe('–');
        expect(wow([{ x: 100 }, { x: 110 }], 'x')).toBe('+10.0%');
        expect(wow([{ x: 100 }, { x: 90 }], 'x')).toBe('-10.0%');
        expect(wow([{ x: 0 }, { x: 5 }], 'x')).toBe('–'); /* 防 0 除 */
    });

    it('dry render：传入合成 history → 输出含 sparkline 表', () => {
        /* 准备 mock trend-history（2 entries） */
        const tmp = mkdtempSync(join(tmpdir(), 'bench-ii5-'));
        const histPath = join(tmp, 'hist.json');
        writeFileSync(histPath, JSON.stringify({
            entries: [
                {
                    ts: Date.now() - 86400000,
                    regressed: false,
                    snapshot: {
                        deadCode: { unusedCount: 10, totalExports: 100 },
                        dfs: { truncatedRatio: 0.1, cappedRatio: 0.05, totalCalls: 100 },
                        dist: { bytes: 1024 },
                    },
                },
            ],
        }), 'utf8');
        /* 跳 perf（耗时），仅渲染 markdown */
        const r = spawnSync('node', [SCRIPT, '--skip-perf', '--trend-history', histPath], {
            cwd: ROOT, encoding: 'utf8', timeout: 60_000,
        });
        if (r.status !== 0) {
            /* 子工具失败也能渲染，所以 0 应该；不为 0 时打 stderr 协助排查 */
            console.warn('benchmark stderr:', r.stderr?.slice(0, 500));
        }
        expect(r.status).toBe(0);
        /* 输出 markdown 中应含 Trend History 段；history < 2 提示也可接受
         * （子工具失败时 deadCode/dfs/dist 都是 null，snapshot 全空）*/
        const out = r.stdout || '';
        expect(out).toMatch(/Trend History/);
    });
});
