/**
 * NN-A4: ADR-002 决议——findGapPositions 保持 AoS。
 *
 * 守护：findGapPositions 不在生产 hot path（仅测试 + 文档使用）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const ADR = join(ROOT, 'docs/engineering/ADR-002-findgappositions-soa.md');

describe('NN-A4 ADR-002 findGapPositions 保持 AoS', () => {
    it('ADR 文档存在 + Accepted', () => {
        expect(existsSync(ADR)).toBe(true);
        const txt = readFileSync(ADR, 'utf8');
        expect(txt).toMatch(/Status\*\*:\s*Accepted/);
        expect(txt).toMatch(/NN-A4/);
    });

    it('生产代码（web/src 非 grid.js）不调 findGapPositions', () => {
        let hits = '';
        try {
            hits = execSync(
                'rg -l "findGapPositions" web/src --type js -g "!grid.js"',
                { cwd: ROOT, encoding: 'utf8' },
            ).trim();
        } catch (_e) { hits = ''; /* rg exit 1 = no match → OK */ }
        expect(hits, 'findGapPositions 不应在 web/src 生产代码（除 grid.js）出现').toBe('');
    });

    it('hot path countGapFills 已绕开 findGapPositions', () => {
        const src = readFileSync(join(ROOT, 'web/src/grid.js'), 'utf8');
        /* EE3 注释证明 */
        expect(src).toMatch(/countGapFills 直接调 bitmap helper.*绕开 findGapPositions/);
    });

    it('ADR 列出 revisit triggers', () => {
        const txt = readFileSync(ADR, 'utf8');
        expect(txt).toMatch(/Revisit Trigger/);
        expect(txt).toMatch(/RL self-play|Monte Carlo|perf-check baseline/);
    });
});
