/**
 * MM4: lint-workflows no-untrusted-input-shell 规则契约。
 *
 * 防 CVE-2023-37896 同类 shell injection 漏洞。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/lint-workflows.mjs');

function setupWf(content) {
    const tmp = mkdtempSync(join(tmpdir(), 'lintwf-mm4-'));
    const wfDir = join(tmp, '.github/workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'test.yml'), content, 'utf8');
    return tmp;
}
function run(dir) {
    return spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 10_000 });
}

describe('MM4 no-untrusted-input-shell 规则', () => {
    it('脚本含 DANGEROUS_REFS + no-untrusted-input-shell 规则实现', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/DANGEROUS_REFS/);
        expect(src).toMatch(/no-untrusted-input-shell/);
        expect(src).toContain('github\\\\.event\\\\.issue\\\\.title');
    });

    const wfBase = (run) => `
on: issues
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ${run}
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30
`;

    it('安全模式（env 中转）→ pass', () => {
        const wf = `
on: issues
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: safe
        env:
          TITLE: \${{ github.event.issue.title }}
        run: echo "$TITLE"
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30
`;
        expect(run(setupWf(wf)).status).toBe(0);
    });

    it('危险：run 直接拼 github.event.issue.title → fail', () => {
        const r = run(setupWf(wfBase('echo "${{ github.event.issue.title }}"')));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-untrusted-input-shell/);
    });

    it('危险：run 直接拼 github.event.comment.body → fail', () => {
        const r = run(setupWf(wfBase('echo "${{ github.event.comment.body }}"')));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-untrusted-input-shell/);
    });

    it('危险：run 直接拼 github.event.head_commit.message → fail', () => {
        const r = run(setupWf(wfBase('git log -1 --format="${{ github.event.head_commit.message }}"')));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-untrusted-input-shell/);
    });

    it('危险：run 直接拼 github.head_ref → fail', () => {
        const r = run(setupWf(wfBase('echo "${{ github.head_ref }}"')));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-untrusted-input-shell/);
    });

    it('安全：run 拼 github.sha / github.run_id（系统受控字段）→ pass', () => {
        const r = run(setupWf(wfBase('echo "${{ github.sha }} run ${{ github.run_id }}"')));
        expect(r.status).toBe(0);
    });

    it('安全：env 拼 dangerous ref（不出现在 run 直接拼接）→ pass', () => {
        /* env 段拼 dangerous ref 没问题，因 shell parser 不解析 env value */
        const wf = `
on: issues
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - env:
          BODY: \${{ github.event.issue.body }}
        run: |
          echo "$BODY" | wc -l
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30
`;
        expect(run(setupWf(wf)).status).toBe(0);
    });

    it('当前仓库 workflows 仍合规', () => {
        const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(0);
    });
});
