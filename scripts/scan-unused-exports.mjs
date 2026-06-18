#!/usr/bin/env node
/* global process, console */
/**
 * scan-unused-exports.mjs — Dead Code Tracking 自动化扫描（v1.71 U5）
 *
 * 目的：找出 web/src/**\/*.js 下"零引用"的具名 export，输出 JSON 报告。
 *
 * 用法：
 *   node scripts/scan-unused-exports.mjs              # 文本报告到 stdout
 *   node scripts/scan-unused-exports.mjs --json       # 机器可读 JSON
 *   node scripts/scan-unused-exports.mjs --strict     # 只输出"非入口型"候选（更高置信度）
 *
 * 算法（与 DEAD_CODE_TRACKING.md 描述一致）：
 *   1. 提取 web/src/**\/*.js 每个 `export function|const|class|let X`
 *   2. 跨 web/src + tests + cocos/assets/scripts + miniprogram/core + scripts 全文搜 \bX\b
 *   3. 排除自身定义文件
 *   4. --strict 模式额外排除：
 *        init* / get*Instance / open* / start* / show* / register* / mount*
 *        以及全大写 CONST / VERSION/SCHEMA/DEFAULT/CONFIG 形态
 *
 * 设计原则：保守 — 宁可漏报不可错杀。被本脚本标记"死代码"的项仍需 owner 评审才删。
 */

import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const SRC_DIRS = ['web/src'];
const SEARCH_DIRS = ['web/src', 'tests', 'cocos/assets/scripts', 'miniprogram/core', 'scripts'];
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

/* X5：基线对比模式 — 写/读快照支持 weekly CI 检测新增死代码 */
function cliArg(k, fallback) {
    const i = process.argv.indexOf(k);
    if (i === -1) return fallback;
    return process.argv[i + 1] ?? fallback;
}
const BASELINE_PATH = cliArg('--baseline', '');
const WRITE_BASELINE = cliArg('--write-baseline', '');
const FAIL_ON_NEW = process.argv.includes('--fail-on-new');

async function walk(dir, out = []) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const ent of entries) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist') continue;
        const full = join(dir, ent.name);
        if (ent.isDirectory()) await walk(full, out);
        else if (/\.(m?js|cjs)$/.test(ent.name)) out.push(full);
    }
    return out;
}

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|class|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;

function extractExports(text) {
    const names = [];
    let m;
    EXPORT_RE.lastIndex = 0;
    while ((m = EXPORT_RE.exec(text)) !== null) names.push(m[1]);
    return names;
}

function isPublicShapeName(n) {
    if (/^__/.test(n)) return true;
    if (/^[A-Z_][A-Z0-9_]+$/.test(n)) return true;
    if (/(VERSION|SCHEMA|DEFAULT|CONFIG|PRESET|RULES|EVENTS|TYPES)/.test(n)) return true;
    return false;
}

function isEntryShapeName(n) {
    return /^(init|get.*Instance$|open|start|show|register|mount|attach|setup)/.test(n);
}

async function main() {
    const srcFiles = [];
    for (const d of SRC_DIRS) await walk(join(ROOT, d), srcFiles);

    /* 1) 收集所有 export 名 + 定义文件 */
    const exportsByName = new Map(); // name -> { file, all: [files] }
    for (const file of srcFiles) {
        const text = await readFile(file, 'utf8');
        for (const name of extractExports(text)) {
            if (!exportsByName.has(name)) exportsByName.set(name, { file, all: [file] });
            else exportsByName.get(name).all.push(file);
        }
    }

    /* 2) 跨目录搜引用 */
    const searchFiles = [];
    for (const d of SEARCH_DIRS) await walk(join(ROOT, d), searchFiles);

    /* 把所有搜索文件内容读到内存，避免对 1.4k export 各做一次磁盘读 */
    const blobs = new Map();
    for (const f of searchFiles) {
        try {
            const s = await stat(f);
            if (s.size > 5_000_000) continue; // 跳过 5MB+ 异常文件
            blobs.set(f, await readFile(f, 'utf8'));
        } catch { /* ignore */ }
    }

    const unused = [];
    for (const [name, info] of exportsByName) {
        if (isPublicShapeName(name)) continue;
        if (STRICT && isEntryShapeName(name)) continue;
        /* 排除任何包含 name 的非定义文件即可 */
        const re = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\b');
        let used = false;
        for (const [f, text] of blobs) {
            if (info.all.includes(f)) continue; /* 跳过自定义文件 */
            if (re.test(text)) { used = true; break; }
        }
        if (!used) {
            unused.push({ name, file: relative(ROOT, info.file), entry: isEntryShapeName(name) });
        }
    }

    /* 按文件分组 */
    const byFile = new Map();
    for (const u of unused) {
        if (!byFile.has(u.file)) byFile.set(u.file, []);
        byFile.get(u.file).push(u.name);
    }

    const snapshot = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        strict: STRICT,
        totalExports: exportsByName.size,
        unusedCount: unused.length,
        items: unused.map(u => ({ file: u.file, name: u.name, entry: u.entry })),
        byFile: Array.from(byFile.entries()).map(([file, names]) => ({ file, names: names.slice().sort() })),
    };

    /* X5：write-baseline 模式（保存当前为新基线，weekly job 用） */
    if (WRITE_BASELINE) {
        const target = resolve(ROOT, WRITE_BASELINE);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
        console.error(`[scan-unused-exports] 基线已写入 ${target}（${unused.length} 项）`);
        return;
    }

    /* X5：baseline 对比模式 */
    let diff = null;
    if (BASELINE_PATH) {
        try {
            const baseTxt = await readFile(resolve(ROOT, BASELINE_PATH), 'utf8');
            const base = JSON.parse(baseTxt);
            const baseKeys = new Set((base.items ?? []).map(i => i.file + '::' + i.name));
            const nowKeys = new Set(unused.map(u => u.file + '::' + u.name));
            const added = unused.filter(u => !baseKeys.has(u.file + '::' + u.name));
            const removed = (base.items ?? []).filter(i => !nowKeys.has(i.file + '::' + i.name));
            diff = { added, removed, baselineCount: base.unusedCount, currentCount: unused.length };
        } catch (e) {
            console.error(`[scan-unused-exports] 基线 ${BASELINE_PATH} 读取失败：${e.message}`);
            if (FAIL_ON_NEW) process.exit(1);
        }
    }

    if (JSON_OUT) {
        console.log(JSON.stringify({ ...snapshot, diff }, null, 2));
        if (FAIL_ON_NEW && diff && diff.added.length > 0) process.exit(1);
        return;
    }

    console.log(`扫描完成（${STRICT ? 'STRICT' : 'LOOSE'}）：`);
    console.log(`  总 export：${exportsByName.size}`);
    console.log(`  零引用：${unused.length}（在 ${byFile.size} 文件）`);
    console.log('');
    const files = Array.from(byFile.keys()).sort();
    for (const f of files) {
        console.log(f);
        for (const n of byFile.get(f).sort()) console.log(`  - ${n}`);
    }

    if (diff) {
        console.log('');
        console.log(`基线对比（baseline=${diff.baselineCount}, current=${diff.currentCount}）：`);
        console.log(`  新增死代码：${diff.added.length}`);
        for (const a of diff.added) console.log(`    + ${a.file}::${a.name}`);
        console.log(`  已解决：${diff.removed.length}`);
        for (const r of diff.removed) console.log(`    - ${r.file}::${r.name}`);
        if (FAIL_ON_NEW && diff.added.length > 0) {
            console.error('');
            console.error(`[FAIL] --fail-on-new：检测到 ${diff.added.length} 项新增死代码`);
            process.exit(1);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
