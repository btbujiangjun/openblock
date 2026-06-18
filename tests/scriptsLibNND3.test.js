/**
 * NN-D3: scripts/_lib/ 公共工具单测。
 */
import { describe, it, expect } from 'vitest';
import { cliArg, cliFlag, cliNumber, parseArgs } from '../scripts/_lib/cli.mjs';
import { sparkline, pctDelta, mdTable, fmtBytes } from '../scripts/_lib/markdownReport.mjs';

describe('NN-D3 scripts/_lib/cli', () => {
    it('cliArg 读 --name value', () => {
        expect(cliArg('--foo', 'def', ['--foo', 'bar'])).toBe('bar');
        expect(cliArg('--missing', 'def', ['--foo', 'bar'])).toBe('def');
    });
    it('cliFlag 读布尔', () => {
        expect(cliFlag('--strict', ['--strict', '--x', '1'])).toBe(true);
        expect(cliFlag('--missing', ['--x', '1'])).toBe(false);
    });
    it('cliNumber + NaN 守护', () => {
        expect(cliNumber('--n', 10, ['--n', '42'])).toBe(42);
        expect(cliNumber('--n', 10, ['--n', 'NaN'])).toBe(10);
        expect(cliNumber('--n', 10, [])).toBe(10);
    });
    it('parseArgs 解析 args/flags/positional', () => {
        /* parseArgs 规则：--name 后跟非 -- 即 value；连续 -- 之间为 flag。
         * 这里 --strict 后跟非 -- 的 file2.json → strict 被当 value，
         * file2.json 不再是 positional。这是设计妥协（GNU getopt 同行为）。 */
        const r = parseArgs(['file1.json', '--out', 'x.md', '--strict']);
        expect(r.args.out).toBe('x.md');
        expect(r.flags.has('strict')).toBe(true);
        expect(r.positional).toEqual(['file1.json']);
    });
});

describe('NN-D3 scripts/_lib/markdownReport', () => {
    it('sparkline 8-tone', () => {
        const s = sparkline([1, 2, 4, 8]);
        expect(s.length).toBe(4);
        /* 单调上升 → 字符 codepoint 单调不降 */
        for (let i = 1; i < s.length; i++) {
            expect(s.codePointAt(i)).toBeGreaterThanOrEqual(s.codePointAt(i - 1));
        }
    });
    it('sparkline 空 / 全等', () => {
        expect(sparkline([])).toBe('');
        expect(sparkline([5, 5, 5])).toBe('▄▄▄');
    });
    it('sparkline NaN 容错', () => {
        const s = sparkline([1, NaN, 3]);
        expect(s.length).toBe(3);
        expect(s[1]).toBe('·');
    });
    it('pctDelta', () => {
        expect(pctDelta(110, 100)).toBe('+10.0%');
        expect(pctDelta(90, 100)).toBe('-10.0%');
        expect(pctDelta(100, 100)).toBe('0.0%');
        expect(pctDelta(1, 0)).toBe('—');
        expect(pctDelta(NaN, 100)).toBe('—');
    });
    it('mdTable', () => {
        const t = mdTable(['a', 'b'], [[1, 2], [3, 4]]);
        expect(t).toContain('| a | b |');
        expect(t).toContain('| --- | --- |');
        expect(t).toContain('| 1 | 2 |');
        expect(t).toContain('| 3 | 4 |');
    });
    it('fmtBytes', () => {
        expect(fmtBytes(500)).toBe('500 B');
        expect(fmtBytes(2048)).toBe('2.0 KB');
        expect(fmtBytes(5 * 1024 ** 2)).toBe('5.0 MB');
        expect(fmtBytes(3 * 1024 ** 3)).toBe('3.00 GB');
        expect(fmtBytes(-1)).toBe('—');
    });
});
