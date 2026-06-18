/**
 * NN-B4: if: 表达式内 dangerous ref 注入。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/lint-workflows.mjs');

function setupWf(c) {
    const tmp = mkdtempSync(join(tmpdir(), 'lintwf-nnb4-'));
    const d = join(tmp, '.github/workflows'); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 't.yml'), c, 'utf8');
    return tmp;
}
const run = (d) => spawnSync('node', [SCRIPT], { cwd: d, encoding: 'utf8', timeout: 10_000 });
const ret = `\n      - uses: actions/upload-artifact@v4\n        with: { name: x, path: out/, retention-days: 30 }`;

describe('NN-B4 no-untrusted-input-if', () => {
    it('脚本含规则实现', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/no-untrusted-input-if/);
    });

    it('危险：if 拼 contains(github.event.issue.title, ...) → fail', () => {
        const wf = `
on: issues
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - if: \${{ contains(github.event.issue.title, 'release') }}
        run: ./deploy.sh${ret}
`;
        const r = run(setupWf(wf));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-untrusted-input-if/);
    });

    it('危险：if 拼 head_commit.message → fail', () => {
        const wf = `
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - if: \${{ contains(github.event.head_commit.message, '[skip-tests]') }}
        run: echo skipping${ret}
`;
        const r = run(setupWf(wf));
        expect(r.status).toBe(1);
    });

    it('安全：if 用 github.actor 系统字段 → pass', () => {
        const wf = `
on: pull_request
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - if: \${{ github.actor == 'admin' }}
        run: echo admin${ret}
`;
        expect(run(setupWf(wf)).status).toBe(0);
    });

    it('安全：if 用 github.event_name + ref → pass', () => {
        const wf = `
on: [push, pull_request]
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - if: \${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
        run: ./prod-deploy.sh${ret}
`;
        expect(run(setupWf(wf)).status).toBe(0);
    });

    it('当前 repo workflows 仍合规', () => {
        const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(0);
    });
});
