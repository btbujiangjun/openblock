/**
 * PP7 / NN-F3.6: gen-dsl-rules-doc 脚本契约测试。
 *
 * 覆盖：
 *   - 脚本存在
 *   - 直接生成模式 → exit 0 + 写出文件
 *   - --check 模式：文件同步 → exit 0；漂移 → exit 1
 *   - 产物含所有当前规则 id
 *   - package.json 已注册 gen/check 脚本，preflight 包含 check:dsl-docs
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE_RULES_DSL } from '../web/src/spawn/baseRulesDsl.js';

const REPO = resolve(__dirname, '..');
const OUT = resolve(REPO, 'docs/engineering/spawn-rules.md');
const SCRIPT = ['node', 'scripts/gen-dsl-rules-doc.mjs'];

function run(args = []) {
    return spawnSync(SCRIPT[0], [SCRIPT[1], ...args], {
        cwd: REPO, encoding: 'utf8', timeout: 30_000,
    });
}

describe('PP7 / NN-F3.6 gen-dsl-rules-doc', () => {
    it('脚本存在', () => {
        expect(existsSync(resolve(REPO, 'scripts/gen-dsl-rules-doc.mjs'))).toBe(true);
    });

    it('直接生成模式：exit 0 + 文件存在', () => {
        const r = run();
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/wrote/);
        expect(existsSync(OUT)).toBe(true);
    });

    it('--check 模式：文件同步 → exit 0', () => {
        run(); /* 先确保最新 */
        const r = run(['--check']);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/OK/);
    });

    it('--check 模式：人为漂移 → exit 1', () => {
        run(); /* 先 reset */
        const original = readFileSync(OUT, 'utf8');
        try {
            writeFileSync(OUT, original + '\n<!-- drift -->\n', 'utf8');
            const r = run(['--check']);
            expect(r.status).toBe(1);
            expect(r.stderr).toMatch(/DRIFT/);
        } finally {
            writeFileSync(OUT, original, 'utf8'); /* restore */
        }
    });

    it('产物含所有当前规则 id', () => {
        run();
        const md = readFileSync(OUT, 'utf8');
        for (const r of BASE_RULES_DSL) {
            expect(md).toContain(r.id);
        }
    });

    it('package.json 注册 gen/check + preflight 引用', () => {
        const pkg = JSON.parse(readFileSync(resolve(REPO, 'package.json'), 'utf8'));
        expect(pkg.scripts['gen:dsl-docs']).toMatch(/gen-dsl-rules-doc\.mjs/);
        expect(pkg.scripts['check:dsl-docs']).toMatch(/--check/);
        expect(pkg.scripts.preflight).toMatch(/check:dsl-docs/);
    });
});
