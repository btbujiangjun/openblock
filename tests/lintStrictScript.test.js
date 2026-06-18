/**
 * GG4: lint:strict CI 契约守护测试。
 * 防 package.json 或 CI workflow 被无意修改导致 strict 退化。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('GG4 lint:strict 契约', () => {
    it('package.json 含 lint:strict npm script', () => {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
        expect(pkg.scripts['lint:strict']).toBeDefined();
        expect(pkg.scripts['lint:strict']).toContain('--max-warnings 0');
    });

    it('lint:strict 覆盖与 lint 相同的目录（web/src tests）', () => {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
        const lint = pkg.scripts.lint;
        const strict = pkg.scripts['lint:strict'];
        /* 普通 lint 的目录列表必须是 strict 的子集 */
        for (const dir of ['web/src', 'tests']) {
            expect(lint).toContain(dir);
            expect(strict).toContain(dir);
        }
    });

    it('CI workflow 接入了 lint:strict（而非 lint）', () => {
        const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
        expect(ci).toMatch(/npm run lint:strict/);
    });
});
