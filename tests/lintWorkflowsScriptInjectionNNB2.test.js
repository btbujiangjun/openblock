/**
 * NN-B2: github-script with.script JS 注入检测契约。
 *
 * actions/github-script 的 with.script 字段是 JS，${{ }} 在 JS parse 前展开
 * → 与 shell 同等危险，必须走 env: + process.env 中转。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/lint-workflows.mjs');

function setupWf(content) {
    const tmp = mkdtempSync(join(tmpdir(), 'lintwf-nnb2-'));
    const wfDir = join(tmp, '.github/workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'test.yml'), content, 'utf8');
    return tmp;
}
function run(dir) {
    return spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 10_000 });
}

describe('NN-B2 no-untrusted-input-script 规则', () => {
    it('脚本含 no-untrusted-input-script 规则实现', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/no-untrusted-input-script/);
        expect(src).toMatch(/with\.script/);
    });

    const baseRetention = `
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30`;

    it('危险：github-script with.script 拼 github.event.issue.title → fail', () => {
        const wf = `
on: issues
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/github-script@v7
        with:
          script: |
            const title = \`\${{ github.event.issue.title }}\`;
            console.log(title);
${baseRetention}
`;
        const r = run(setupWf(wf));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-untrusted-input-script/);
    });

    it('危险：with.script 拼 github.event.comment.body → fail', () => {
        const wf = `
on: issue_comment
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/github-script@v7
        with:
          script: |
            const body = \`\${{ github.event.comment.body }}\`;
            await github.rest.issues.create({ body });
${baseRetention}
`;
        const r = run(setupWf(wf));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-untrusted-input-script/);
    });

    it('安全：with.script 通过 env + process.env 中转 → pass', () => {
        const wf = `
on: issues
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/github-script@v7
        env:
          TITLE: \${{ github.event.issue.title }}
        with:
          script: |
            const title = process.env.TITLE;
            console.log(title);
${baseRetention}
`;
        expect(run(setupWf(wf)).status).toBe(0);
    });

    it('安全：with.script 拼系统受控字段 github.run_id → pass', () => {
        const wf = `
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/github-script@v7
        with:
          script: |
            console.log(\`run \${{ github.run_id }} sha \${{ github.sha }}\`);
${baseRetention}
`;
        expect(run(setupWf(wf)).status).toBe(0);
    });

    it('当前 repo workflows（含 MM3 weekly-audit）仍合规', () => {
        const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(0);
    });
});
