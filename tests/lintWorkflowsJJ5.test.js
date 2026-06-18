/**
 * JJ5: lint-workflows.mjs 契约测试。
 *
 * 验证：
 *   1. 脚本存在且 npm script 注册
 *   2. CI ci.yml 调用 lint:workflows
 *   3. 真实跑通过（所有 workflow 已合规）
 *   4. mock 违规 workflow 时正确报错
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/lint-workflows.mjs');

describe('JJ5 lint-workflows', () => {
    it('脚本存在', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });

    it('npm script lint:workflows 注册', () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['lint:workflows']).toBe('node scripts/lint-workflows.mjs');
    });

    it('CI ci.yml 调用 lint:workflows', () => {
        const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
        expect(ci).toMatch(/npm run lint:workflows/);
    });

    it('当前 workflows 全部合规（exit 0）', () => {
        const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/0 violations/);
    });

    it('mock 违规 workflow → exit 1 + 报 upload-artifact-needs-retention', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'lintwf-jj5-'));
        const wfDir = join(tmp, '.github/workflows');
        mkdirSync(wfDir, { recursive: true });
        writeFileSync(join(wfDir, 'bad.yml'), `
name: bad
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: report
          path: out/
`, 'utf8');
        const r = spawnSync('node', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/upload-artifact-needs-retention/);
    });

    it('mock 合规 workflow → exit 0', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'lintwf-jj5-ok-'));
        const wfDir = join(tmp, '.github/workflows');
        mkdirSync(wfDir, { recursive: true });
        writeFileSync(join(wfDir, 'ok.yml'), `
name: ok
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: report
          path: out/
          retention-days: 30
`, 'utf8');
        const r = spawnSync('node', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(0);
    });
});
