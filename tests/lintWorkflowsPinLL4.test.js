/**
 * LL4: lint-workflows action SHA pinning 规则契约。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/lint-workflows.mjs');

function setupWf(content) {
    const tmp = mkdtempSync(join(tmpdir(), 'lintwf-ll4-'));
    const wfDir = join(tmp, '.github/workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'test.yml'), content, 'utf8');
    return tmp;
}
function run(dir, extra = []) {
    return spawnSync('node', [SCRIPT, ...extra], { cwd: dir, encoding: 'utf8', timeout: 10_000 });
}

const wfBase = (uses) => `
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: ${uses}
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30
`;

describe('LL4 lint-workflows action SHA pinning', () => {
    it('@<40-hex SHA> → pass（最佳）', () => {
        const r = run(setupWf(wfBase('actions/checkout@a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0')));
        expect(r.status).toBe(0);
    });

    it('actions/checkout@v4（可信组织 + @vN）→ pass 无 warning', () => {
        const r = run(setupWf(wfBase('actions/checkout@v4')));
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/0 violations/);
    });

    it('第三方 @vN → warning（不 fail），--strict 才 fail', () => {
        const wf = setupWf(wfBase('marocchino/sticky-pull-request-comment@v2'));
        expect(run(wf).status).toBe(0);
        expect(run(wf, ['--strict']).status).toBe(1);
    });

    it('@main / @latest / @master → hard fail', () => {
        for (const danger of ['main', 'master', 'latest', 'HEAD']) {
            const r = run(setupWf(wfBase(`actions/checkout@${danger}`)));
            expect(r.status, `@${danger} 应 fail`).toBe(1);
            expect(r.stderr).toMatch(/pin-action-version/);
        }
    });

    it('无 @ → hard fail', () => {
        const r = run(setupWf(wfBase('actions/checkout')));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/未指定版本/);
    });

    it('本地 action (./.github/actions/x) 跳过检查', () => {
        const r = run(setupWf(wfBase('./.github/actions/build')));
        expect(r.status).toBe(0);
    });

    it('docker:// 镜像跳过检查', () => {
        const r = run(setupWf(wfBase('docker://ghcr.io/owner/img:latest')));
        expect(r.status).toBe(0);
    });

    it('当前仓库工作流全合规（含新规则）', () => {
        const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(0);
    });

    it('脚本含 TRUSTED_ORGS 白名单 + SHA 正则', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/TRUSTED_ORGS/);
        expect(src).toMatch(/\[0-9a-f\]\{40\}/);
        expect(src).toMatch(/pin-action-sha/);
    });
});
