/**
 * NN-B3: pull_request_target + checkout PR head 反模式（P0 supply chain）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/lint-workflows.mjs');

function setupWf(content) {
    const tmp = mkdtempSync(join(tmpdir(), 'lintwf-nnb3-'));
    const wfDir = join(tmp, '.github/workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'test.yml'), content, 'utf8');
    return tmp;
}
function run(dir) {
    return spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 10_000 });
}

const baseRet = `
      - uses: actions/upload-artifact@v4
        with: { name: x, path: out/, retention-days: 30 }`;

describe('NN-B3 pull_request_target + checkout head 反模式', () => {
    it('脚本含 no-prt-checkout-head 规则 + securitylab 参考', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/no-prt-checkout-head/);
        expect(src).toMatch(/securitylab\.github\.com.*pwn-requests/);
    });

    it('危险：pull_request_target + checkout PR head sha → fail', () => {
        const wf = `
on: pull_request_target
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm test
${baseRet}
`;
        const r = run(setupWf(wf));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-prt-checkout-head/);
    });

    it('危险：pull_request_target + checkout PR head ref → fail', () => {
        const wf = `
on: pull_request_target
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.ref }}
${baseRet}
`;
        const r = run(setupWf(wf));
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-prt-checkout-head/);
    });

    it('安全：pull_request_target + checkout 默认 ref（base） → pass', () => {
        const wf = `
on: pull_request_target
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "labeling PR"
${baseRet}
`;
        const r = run(setupWf(wf));
        expect(r.status).toBe(0);
    });

    it('安全：pull_request（非 _target） + checkout PR head → pass（低权限上下文）', () => {
        const wf = `
on: pull_request
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm test
${baseRet}
`;
        const r = run(setupWf(wf));
        expect(r.status).toBe(0);
    });

    it('当前 repo workflows 仍合规', () => {
        const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(0);
    });
});
