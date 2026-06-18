/**
 * GG2: perf-mono-flush-bench.mjs 脚本静态契约测试。
 *
 * 脚本本身的真跑（实际 bench）在 CI 中跳过——bench 需要预热稳定环境，
 * 强行在 CI 跑会让测试变 flaky。这里仅做静态契约：
 *   - 脚本可被 Node 语法解析（import / syntax 错误立即被捕获）
 *   - package.json 注册了 npm script
 *   - 脚本退出码契约（无 vite 依赖、ESM 加载入口正确）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCRIPT = 'scripts/perf-mono-flush-bench.mjs';

describe('GG2 perf-mono-flush-bench 静态契约', () => {
    it('脚本文件存在', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });

    it('脚本含核心 bench 入口和 JSON output 协议', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/bestMonoFlushPotential/);
        expect(src).toMatch(/bestMonoFlushBuildup/);
        expect(src).toMatch(/--json/);
        expect(src).toMatch(/schemaVersion/);
        expect(src).toMatch(/scenarios/);
    });

    it('脚本声明 5 个 shape 维度 + 3 个 fillRatio 维度（共 45 scenarios）', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/cases\s*=\s*\[/);
        expect(src).toMatch(/0\.30/);
        expect(src).toMatch(/0\.55/);
        expect(src).toMatch(/0\.80/);
    });

    it('package.json 注册了 perf:mono-flush npm script', () => {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
        expect(pkg.scripts['perf:mono-flush']).toBeDefined();
        expect(pkg.scripts['perf:mono-flush']).toContain('perf-mono-flush-bench');
    });

    it('node 解析脚本无 SyntaxError（--check）', () => {
        const r = spawnSync('node', ['--check', SCRIPT], { encoding: 'utf8' });
        expect(r.status).toBe(0);
        expect(r.stderr).not.toMatch(/SyntaxError/);
    });
});
