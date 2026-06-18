/**
 * KK5: lint-workflows secret 检查规则契约。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/lint-workflows.mjs');

function runIn(dir) {
    return spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 10_000 });
}
function setupWf(content) {
    const tmp = mkdtempSync(join(tmpdir(), 'lintwf-kk5-'));
    const wfDir = join(tmp, '.github/workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'test.yml'), content, 'utf8');
    return tmp;
}

describe('KK5 lint-workflows secret 规则', () => {
    it('脚本含 secret 规则实现', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/secret-name-convention/);
        expect(src).toMatch(/no-echo-secrets/);
    });

    it('合规：UPPER_SNAKE_CASE secret + 不 echo → pass', () => {
        const tmp = setupWf(`
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30
        env:
          TOKEN: \${{ secrets.GITHUB_TOKEN }}
`);
        expect(runIn(tmp).status).toBe(0);
    });

    it('违规：camelCase secret 名 → fail + secret-name-convention', () => {
        const tmp = setupWf(`
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30
        env:
          TOKEN: \${{ secrets.githubToken }}
`);
        const r = runIn(tmp);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/secret-name-convention/);
    });

    it('违规：echo ${{ secrets.X }} → fail + no-echo-secrets', () => {
        const tmp = setupWf(`
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30
      - run: echo "\${{ secrets.SLACK_WEBHOOK }}"
`);
        const r = runIn(tmp);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/no-echo-secrets/);
    });

    it('警告：permissions: write-all → 不 fail（除非 --strict）', () => {
        const tmp = setupWf(`
on: push
permissions: write-all
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30
`);
        expect(runIn(tmp).status).toBe(0); /* 仅 warn */
    });

    it('lower_snake_case secret（如 secrets.my_token）→ fail（必须 UPPER_SNAKE_CASE）', () => {
        const tmp = setupWf(`
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: x
          path: out/
          retention-days: 30
        env:
          TOKEN: \${{ secrets.my_token }}
`);
        const r = runIn(tmp);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/secret-name-convention/);
    });

    it('当前 workflows 全合规（含新规则）', () => {
        const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
        expect(r.status).toBe(0);
    });
});
