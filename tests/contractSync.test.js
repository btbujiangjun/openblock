/**
 * EX-3：维度 / 契约 CI 校验
 *
 * 守护两类回归：
 *   1) 同步漂移：sync-core.sh / sync-cocos-engine.mjs 列出的每个源文件都必须存在，
 *      且对应平台产物存在（防止"被引用但工作树缺失"——即 ML-2 那类部署事故）。
 *   2) 契约一致：shared/game_rules.json 为合法 JSON 且关键节存在。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function _parseFilesArray(text, marker) {
    // 抓取 `FILES=( ... )`（bash）或 `const FILES = [ ... ]`（mjs）里的引号串
    const start = text.indexOf(marker);
    expect(start, `marker ${marker} not found`).toBeGreaterThan(-1);
    const close = text.indexOf(marker.includes('[') ? ']' : ')', start);
    const body = text.slice(start, close);
    return [...body.matchAll(/['"]([^'"]+\.js)['"]/g)].map((m) => m[1]);
}

describe('EX-3 · sync-core (web → miniprogram)', () => {
    const sh = fs.readFileSync(path.join(ROOT, 'scripts/sync-core.sh'), 'utf8');
    const files = _parseFilesArray(sh, 'FILES=(');

    it('FILES 列表非空', () => {
        expect(files.length).toBeGreaterThan(10);
    });

    it.each(files)('源存在且已同步到 miniprogram: %s', (f) => {
        expect(fs.existsSync(path.join(ROOT, 'web/src', f)), `web/src/${f} 缺失`).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'miniprogram/core', f)), `miniprogram/core/${f} 未同步`).toBe(true);
    });
});

describe('EX-3 · sync-cocos-engine (web → cocos)', () => {
    const mjs = fs.readFileSync(path.join(ROOT, 'scripts/sync-cocos-engine.mjs'), 'utf8');
    const files = _parseFilesArray(mjs, 'const FILES = [');

    it('FILES 列表非空', () => {
        expect(files.length).toBeGreaterThan(10);
    });

    it.each(files)('源存在且已同步到 cocos: %s', (f) => {
        expect(fs.existsSync(path.join(ROOT, 'web/src', f)), `web/src/${f} 缺失`).toBe(true);
        const mjsTarget = path.join(ROOT, 'cocos/assets/scripts/engine', f.replace(/\.js$/, '.mjs'));
        expect(fs.existsSync(mjsTarget), `cocos engine/${f} 未同步`).toBe(true);
    });
});

describe('EX-3 · game_rules.json 契约', () => {
    it('合法 JSON 且关键节存在', () => {
        const raw = fs.readFileSync(path.join(ROOT, 'shared/game_rules.json'), 'utf8');
        const cfg = JSON.parse(raw);
        expect(cfg).toBeTypeOf('object');
        expect(cfg.adaptiveSpawn, 'adaptiveSpawn 节缺失').toBeDefined();
        // RT-1：warmRun 触发器契约（T8_paid_acquisition 已落地）
        expect(cfg.adaptiveSpawn.warmRun?.triggers, 'warmRun.triggers 缺失').toBeDefined();
    });
});
