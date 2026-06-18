/**
 * II4: CI artifact retention 规范契约。
 *
 * 所有 actions/upload-artifact 调用必须显式声明 retention-days。
 * 防 default 回滚 / 静默 90 → 7 切换。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const WF_DIR = join(ROOT, '.github/workflows');

function listWorkflows() {
    if (!existsSync(WF_DIR)) return [];
    return readdirSync(WF_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
}

describe('II4 CI artifact retention 规范', () => {
    it('文档存在并登记规则', () => {
        const doc = readFileSync(join(ROOT, 'docs/engineering/CI_ARTIFACT_RETENTION.md'), 'utf8');
        expect(doc).toMatch(/retention-days/);
        expect(doc).toMatch(/趋势.*基线/);
        expect(doc).toMatch(/诊断 artifact/);
    });

    it('所有 upload-artifact 块必须有 retention-days', () => {
        const offenders = [];
        for (const wf of listWorkflows()) {
            const txt = readFileSync(join(WF_DIR, wf), 'utf8');
            /* 分块：每个 - uses: actions/upload-artifact 到下一个 - name/uses 或文档头 */
            const blocks = txt.split(/(?=uses:\s*actions\/upload-artifact)/);
            for (let i = 1; i < blocks.length; i++) {
                /* 取该 block 下到下个 `      - ` 或 `  \w+:` 之间的 with 段 */
                const block = blocks[i].split(/\n(?=\s{6}- |jobs?:|on:|name:\s)/)[0];
                if (!/retention-days:/.test(block)) {
                    offenders.push(wf);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('benchmark / dead-code 趋势类 artifact retention ≥ 90', () => {
        const trend = ['weekly-dead-code.yml', 'benchmark-trend-rolling.yml'];
        for (const wf of trend) {
            const p = join(WF_DIR, wf);
            if (!existsSync(p)) continue;
            const txt = readFileSync(p, 'utf8');
            const matches = txt.match(/retention-days:\s*(\d+)/g) || [];
            expect(matches.length).toBeGreaterThan(0);
            for (const m of matches) {
                const n = parseInt(m.match(/(\d+)/)[1], 10);
                expect(n).toBeGreaterThanOrEqual(90);
            }
        }
    });

    it('coverage artifact retention ≤ 30（避免空间浪费）', () => {
        const txt = readFileSync(join(WF_DIR, 'ci.yml'), 'utf8');
        /* 匹配 web-coverage / python-coverage 后续 retention-days */
        const covBlocks = txt.match(/(?:web|python)-coverage[\s\S]{0,250}/g) || [];
        expect(covBlocks.length).toBeGreaterThanOrEqual(2);
        for (const b of covBlocks) {
            const m = b.match(/retention-days:\s*(\d+)/);
            expect(m).toBeTruthy();
            expect(parseInt(m[1], 10)).toBeLessThanOrEqual(30);
        }
    });
});
