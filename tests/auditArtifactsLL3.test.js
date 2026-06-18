/**
 * LL3: audit-artifacts.mjs 静态契约测试。
 *
 * 不实际打 GitHub API（需 token，且 CI 外不可达），只验证脚本结构。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/audit-artifacts.mjs');

describe('LL3 audit-artifacts', () => {
    it('脚本存在', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });

    it('npm script audit:artifacts 注册', () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['audit:artifacts']).toBe('node scripts/audit-artifacts.mjs');
    });

    it('脚本含核心接口（CLI flags + ancient/large 检查）', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/--owner/);
        expect(src).toMatch(/--repo/);
        expect(src).toMatch(/--large-mb/);
        expect(src).toMatch(/--ancient-days/);
        expect(src).toMatch(/Large artifacts/);
        expect(src).toMatch(/Ancient alive/);
    });

    it('引用 GitHub API 正确端点', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/api\.github\.com\/repos\/\$\{OWNER\}\/\$\{REPO\}\/actions\/artifacts/);
        expect(src).toMatch(/X-GitHub-Api-Version.*2022-11-28/);
    });

    it('缺 GITHUB_TOKEN 或 owner/repo → exit 1', () => {
        /* 用 -- 后跟 dummy 避免 env vars 干扰 */
        const r = spawnSync('node', [SCRIPT], {
            cwd: ROOT, encoding: 'utf8', timeout: 5_000,
            env: { ...process.env, GITHUB_TOKEN: '', GITHUB_REPOSITORY: '', GITHUB_REPOSITORY_OWNER: '' },
        });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/缺 (--owner|GITHUB_TOKEN)/);
    });

    it('引用 II4 规范文档', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/CI_ARTIFACT_RETENTION\.md|II4/);
    });
});
