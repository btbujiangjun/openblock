/**
 * KK4: perf-check report sparkline + 状态分桶契约。
 *
 * 静态验证脚本含 sparkline 算法 + 分桶汇总段。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SCRIPT = readFileSync(join(ROOT, 'scripts/perf-check.mjs'), 'utf8');

describe('KK4 perf-check sparkline + 分桶', () => {
    it('脚本含 _spark2 实现', () => {
        expect(SCRIPT).toMatch(/_spark2/);
        expect(SCRIPT).toMatch(/▁█|▁▆|▆▁/);
    });

    it('表头新增 trend 列', () => {
        expect(SCRIPT).toMatch(/\| Status \| Scenario \|.+\| trend \|/);
    });

    it('含状态分桶 markdown 段', () => {
        expect(SCRIPT).toMatch(/状态分桶|🚀 gain.*✅ ok.*⚠️ warn.*❌ fail.*🆕 new/);
    });

    /* 验证 spark2 算法（同源拷贝） */
    it('spark2 算法：方向 + 量级判断', () => {
        const _spark2 = (base, cur) => {
            if (!Number.isFinite(base) || !Number.isFinite(cur) || base === 0) return '· ·';
            const pct = (cur - base) / base * 100;
            if (Math.abs(pct) < 1) return '▁▁';
            if (pct > 30) return '▁█';
            if (pct > 10) return '▁▆';
            if (pct > 0) return '▁▃';
            if (pct < -30) return '█▁';
            if (pct < -10) return '▆▁';
            return '▃▁';
        };
        expect(_spark2(100, 100)).toBe('▁▁');     /* 持平 */
        expect(_spark2(100, 150)).toBe('▁█');     /* +50% 大回归 */
        expect(_spark2(100, 120)).toBe('▁▆');     /* +20% 中回归 */
        expect(_spark2(100, 105)).toBe('▁▃');     /* +5% 小回归 */
        expect(_spark2(100, 50)).toBe('█▁');      /* -50% 大提速 */
        expect(_spark2(100, 80)).toBe('▆▁');      /* -20% 中提速 */
        expect(_spark2(100, 95)).toBe('▃▁');      /* -5% 小提速 */
        expect(_spark2(NaN, 50)).toBe('· ·');
        expect(_spark2(0, 50)).toBe('· ·');
    });
});
