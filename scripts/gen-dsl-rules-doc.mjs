#!/usr/bin/env node
/**
 * PP7 / NN-F3.6: 自动生成 DSL 规则一览 Markdown。
 *
 * 扫描 web/src/spawn 下 export 的规则数组（BASE_RULES_DSL 等），
 * 抽取每条规则的 meta 字段（id, priority, abTestKey, since, owner,
 * comment）渲染为 markdown 表，写入 docs/engineering/spawn-rules.md。
 *
 * CI 用法：
 *   - 直接生成：node scripts/gen-dsl-rules-doc.mjs
 *   - 校验同步：node scripts/gen-dsl-rules-doc.mjs --check
 *     若文档与代码不一致 → exit 1（CI gate）
 *
 * 不解析 when/apply 的实现（函数体），只读 meta 字段；
 * 规则作者负责通过 comment 字段表达语义。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CHECK = process.argv.includes('--check');
const OUT = resolve(ROOT, 'docs/engineering/spawn-rules.md');

/* ---------- 1. 加载规则数组（运行时 import，规则自身就是 JS 对象） ---------- */
const sources = [
    'web/src/spawn/baseRulesDsl.js',
    /* 后续 F3.4/F3.5 迁移新规则时在此追加 */
];

const allRules = [];
for (const rel of sources) {
    const p = resolve(ROOT, rel);
    if (!existsSync(p)) {
        console.error(`[gen-dsl-rules-doc] missing: ${rel}`);
        process.exit(1);
    }
    const mod = await import(pathToFileURL(p).href);
    /* 约定：每个文件 export 一个 <NAME>_RULES_DSL 数组 */
    const arrayExportName = Object.keys(mod).find(k => /_RULES_DSL$/.test(k));
    if (!arrayExportName) {
        console.error(`[gen-dsl-rules-doc] ${rel}: no *_RULES_DSL export`);
        process.exit(1);
    }
    const arr = mod[arrayExportName];
    if (!Array.isArray(arr)) {
        console.error(`[gen-dsl-rules-doc] ${rel}: ${arrayExportName} not array`);
        process.exit(1);
    }
    for (const r of arr) {
        allRules.push({ ...r, _source: rel, _group: arrayExportName });
    }
}

/* ---------- 2. 渲染 markdown ---------- */
function escMd(s) {
    return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const groups = new Map();
for (const r of allRules) {
    if (!groups.has(r._group)) groups.set(r._group, []);
    groups.get(r._group).push(r);
}

const lines = [];
lines.push('<!-- 自动生成；请勿手改。源：scripts/gen-dsl-rules-doc.mjs -->');
lines.push('');
lines.push('# Spawn Rules DSL 一览');
lines.push('');
lines.push(`本文件由 \`scripts/gen-dsl-rules-doc.mjs\` 自动生成，扫描 ${sources.length} 个源文件，`);
lines.push(`共 **${allRules.length}** 条规则。`);
lines.push('');
lines.push('> 修改规则元数据后请重新运行 `node scripts/gen-dsl-rules-doc.mjs`；');
lines.push('> CI 会用 `--check` 模式验证文档同步。');
lines.push('');

for (const [groupName, rules] of groups) {
    lines.push(`## ${groupName}（${rules.length} 条）`);
    lines.push('');
    lines.push(`源：\`${rules[0]._source}\``);
    lines.push('');
    lines.push('| Priority | ID | Since | Owner | A/B Key | Comment |');
    lines.push('|---:|---|---|---|---|---|');
    const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const r of sorted) {
        lines.push([
            '',
            String(r.priority ?? 0),
            `\`${escMd(r.id)}\``,
            escMd(r.since || ''),
            escMd(r.owner || ''),
            r.abTestKey ? `\`${escMd(r.abTestKey)}\`` : '',
            escMd(r.comment || ''),
            '',
        ].join('|'));
    }
    lines.push('');
}

lines.push('---');
lines.push('');
lines.push(`总规则数：**${allRules.length}**`);
lines.push('');

const content = lines.join('\n') + '\n';

/* ---------- 3. 写出 / 检查 ---------- */
if (CHECK) {
    const existing = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (existing !== content) {
        console.error('[gen-dsl-rules-doc] DRIFT: docs/engineering/spawn-rules.md 与规则代码不一致');
        console.error('  → 请运行 `node scripts/gen-dsl-rules-doc.mjs` 重新生成并提交');
        process.exit(1);
    }
    console.log('[gen-dsl-rules-doc] OK - docs 与代码同步');
} else {
    writeFileSync(OUT, content, 'utf8');
    console.log(`[gen-dsl-rules-doc] wrote ${OUT} (${allRules.length} rules)`);
}
