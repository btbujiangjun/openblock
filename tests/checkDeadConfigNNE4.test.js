/**
 * NN-E4: check-dead-config-keys.mjs 契约。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/check-dead-config-keys.mjs');

describe('NN-E4 check-dead-config-keys', () => {
    it('脚本存在 + 含豁免规则', () => {
        expect(existsSync(SCRIPT)).toBe(true);
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/META_KEY_RE/);
        expect(src).toMatch(/comment|_.+_note/);
    });

    it('package.json 注册 check:dead-config + preflight 集成', () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['check:dead-config']).toBe('node scripts/check-dead-config-keys.mjs');
        expect(pkg.scripts.preflight).toMatch(/check:dead-config/);
    });

    it('扫多平台：web/src + miniprogram + cocos + rl_backend + scripts + tests', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/web\/src/);
        expect(src).toMatch(/miniprogram/);
        expect(src).toMatch(/cocos/);
        expect(src).toMatch(/rl_backend/);
    });

    it('当前 repo 0 死字段（NN-B1 已修 MM2）', () => {
        const r = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/OK.*all referenced/);
    });

    it('--warn 模式：dead key 也 exit 0', () => {
        const src = readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/WARN_ONLY/);
        expect(src).toMatch(/--warn/);
    });

    it('mock dead key 场景：fail with exit 1', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'deadcfg-'));
        mkdirSync(join(tmp, 'shared'), { recursive: true });
        mkdirSync(join(tmp, 'web/src'), { recursive: true });
        writeFileSync(join(tmp, 'shared/game_rules.json'), JSON.stringify({
            schemaVersion: 1,
            zombieField: 42,
            usedField: 'hello',
        }));
        writeFileSync(join(tmp, 'web/src/x.js'), 'export const c = GAME_RULES.usedField;');
        const r = spawnSync('node', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 30_000 });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/zombieField/);
        expect(r.stderr).not.toMatch(/usedField/);
    });

    it('--warn 模式：mock dead key 不 fail', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'deadcfg-'));
        mkdirSync(join(tmp, 'shared'), { recursive: true });
        writeFileSync(join(tmp, 'shared/game_rules.json'), JSON.stringify({
            schemaVersion: 1,
            zombieField: 42,
        }));
        const r = spawnSync('node', [SCRIPT, '--warn'], { cwd: tmp, encoding: 'utf8', timeout: 30_000 });
        expect(r.status).toBe(0);
    });
});
