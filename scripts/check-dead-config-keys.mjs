#!/usr/bin/env node
/* global process */
/**
 * v1.71 NN-E4: 扫 shared/game_rules.json 中无代码引用的死字段。
 *
 * 防 MM2 同类 bug：字段加到 JSON 但 helper 没接入，运营改了无效。
 *
 * 实现：
 *   1. 递归提取 JSON 所有叶子 key path（comment / _xxx_note 等元字段跳过）
 *   2. 对每个 leaf key（如 "holeClearGuarantee"）grep web/src 看是否被代码引用
 *   3. 未被引用 → 报告 + exit 1（--warn 模式仅打印不 fail）
 *
 * 已知豁免：
 *   - "comment" / "_*_note" / "description" → 文档字段
 *   - 顶层 schemaVersion / version 等元字段
 *   - 完全数字数组（如 evaluations: [1,2,3]）的 index 不算 key
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from './_lib/cli.mjs';

const ROOT = process.cwd();
const RULES = join(ROOT, 'shared/game_rules.json');
/* 扫所有可能的消费方：web (JS) / mini-program (JS) / cocos (TS+MJS) / rl_backend (Python) */
const SRC_DIRS = ['web/src', 'scripts', 'miniprogram/core', 'miniprogram/utils', 'cocos/assets', 'rl_backend', 'tests'];

const { flags } = parseArgs();
const WARN_ONLY = flags.has('warn');

const META_KEY_RE = /^(comment|_.+_note|description|enabled|_meta)$/;

function collectLeafKeys(obj, path = [], out = new Map()) {
    if (obj === null || typeof obj !== 'object') return out;
    if (Array.isArray(obj)) {
        for (const item of obj) collectLeafKeys(item, path, out);
        return out;
    }
    for (const [k, v] of Object.entries(obj)) {
        if (META_KEY_RE.test(k)) continue;
        const nextPath = [...path, k];
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            collectLeafKeys(v, nextPath, out);
        } else {
            /* leaf */
            const fullPath = nextPath.join('.');
            if (!out.has(k)) out.set(k, []);
            out.get(k).push(fullPath);
        }
    }
    return out;
}

function walk(dir, files = []) {
    try {
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (entry.startsWith('.') || entry === 'node_modules') continue;
            const st = statSync(p);
            if (st.isDirectory()) walk(p, files);
            else if (/\.(m?js|ts|mjs|py)$/.test(entry)) files.push(p);
        }
    } catch { /* dir missing → skip */ }
    return files;
}

const rules = JSON.parse(readFileSync(RULES, 'utf8'));
const leafKeys = collectLeafKeys(rules);

const srcFiles = [];
for (const d of SRC_DIRS) walk(join(ROOT, d), srcFiles);
const allCode = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

const dead = [];
const KEY_RE_CACHE = new Map();
function keyRe(k) {
    if (!KEY_RE_CACHE.has(k)) {
        /* 匹配 .holeClearGuarantee / ["holeClearGuarantee"] / 'holeClearGuarantee' / `holeClearGuarantee` */
        KEY_RE_CACHE.set(k, new RegExp(`[.\\["\\\`']${k}[\\]"\\\`']?`));
    }
    return KEY_RE_CACHE.get(k);
}

for (const [key, paths] of leafKeys.entries()) {
    if (!keyRe(key).test(allCode)) {
        dead.push({ key, paths });
    }
}

if (dead.length === 0) {
    console.log(`[check-dead-config-keys] OK - ${leafKeys.size} keys all referenced`);
    process.exit(0);
}

console.error(`[check-dead-config-keys] ${WARN_ONLY ? 'WARN' : 'FAIL'} - ${dead.length} dead key(s):`);
for (const d of dead) {
    console.error(`  ✖ ${d.key}  (at ${d.paths.join(', ')})`);
}
console.error('');
console.error('解决路径：');
console.error('  1. 删除字段（确认无外部依赖）');
console.error('  2. 接入代码：在 helper 中读取');
console.error('  3. 加入豁免列表（如纯 ops 工具配置）→ 改本脚本');

process.exit(WARN_ONLY ? 0 : 1);
