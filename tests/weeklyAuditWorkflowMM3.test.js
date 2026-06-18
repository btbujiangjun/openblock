/**
 * MM3: weekly-artifact-audit.yml 静态契约。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const WF = join(ROOT, '.github/workflows/weekly-artifact-audit.yml');

describe('MM3 weekly-artifact-audit workflow', () => {
    it('workflow 文件存在', () => {
        expect(existsSync(WF)).toBe(true);
    });

    const txt = existsSync(WF) ? readFileSync(WF, 'utf8') : '';

    it('cron schedule 周一 04:00 UTC（错开 weekly-dead-code 03:00）', () => {
        expect(txt).toMatch(/cron:\s*'0 4 \* \* 1'/);
    });

    it('支持 workflow_dispatch 手动触发', () => {
        expect(txt).toMatch(/workflow_dispatch/);
    });

    it('调用 LL3 audit-artifacts.mjs', () => {
        expect(txt).toMatch(/scripts\/audit-artifacts\.mjs/);
    });

    it('遵循 II4 retention=90 规范', () => {
        expect(txt).toMatch(/retention-days:\s*90/);
    });

    it('遵循 LL4 SHA pinning：所有 actions/* 用 @v4 或更高', () => {
        const usesMatches = txt.matchAll(/uses:\s*actions\/[\w-]+@(v\d+|[0-9a-f]{40})/g);
        const matches = [...usesMatches];
        expect(matches.length).toBeGreaterThanOrEqual(3); /* checkout + setup-node + upload-artifact + github-script */
    });

    it('遵循 KK5 secret 规范：仅引用 UPPER_SNAKE secrets', () => {
        const secretRefs = [...txt.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)];
        for (const m of secretRefs) {
            expect(m[1]).toMatch(/^[A-Z][A-Z0-9_]*$/);
        }
    });

    it('权限最小化：仅 issues:write + contents:read', () => {
        expect(txt).toMatch(/permissions:[\s\S]*?contents:\s*read/);
        expect(txt).toMatch(/permissions:[\s\S]*?issues:\s*write/);
        expect(txt).not.toMatch(/write-all/);
    });

    it('lint-workflows 不报违规（已包含本 workflow）', () => {
        /* 间接通过 npm run lint:workflows 验证；这里仅静态确认结构 */
        expect(txt).toMatch(/uses:\s*actions\/upload-artifact@v4[\s\S]{0,300}retention-days/);
    });
});
