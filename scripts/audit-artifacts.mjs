#!/usr/bin/env node
/* global process, console */
/**
 * audit-artifacts.mjs — GitHub Actions artifact 审计（v1.71 LL3）
 *
 * 目的：II4 文档化 + JJ5 lint 拦下"未声明 retention"。但仍可能：
 *   - 上传时声明 90 天，过几个月有人改成 7 但旧 artifact 提前被删
 *   - 旧 workflow 移除 upload-artifact 步骤后历史 artifact 还在
 *   - artifact 体积异常大（占存储 quota）
 * 本脚本拉取仓库所有 artifact 列表，输出审计报告（不删除）。
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node scripts/audit-artifacts.mjs --owner X --repo Y
 *   node scripts/audit-artifacts.mjs --owner X --repo Y --out audit.md
 *
 * 退出码：
 *   0 = 审计成功（无问题或仅警告）
 *   1 = 调用失败 / 异常 artifact 数量超阈值
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const argv = process.argv.slice(2);
const cliArg = (k, fb) => { const i = argv.indexOf(k); return i === -1 ? fb : (argv[i + 1] ?? fb); };

const OWNER = cliArg('--owner', process.env.GITHUB_REPOSITORY_OWNER);
const REPO = cliArg('--repo', (process.env.GITHUB_REPOSITORY || '').split('/')[1]);
const OUT = cliArg('--out', '');
const TOKEN = process.env.GITHUB_TOKEN;
const LARGE_MB = Number(cliArg('--large-mb', 100)); /* > 100 MB 算大 */
const ANCIENT_DAYS = Number(cliArg('--ancient-days', 100)); /* > 100 天算超长（II4 trend 限 90） */

if (!OWNER || !REPO) {
    console.error('[audit] 缺 --owner / --repo（或环境变量 GITHUB_REPOSITORY_OWNER / GITHUB_REPOSITORY）');
    process.exit(1);
}
if (!TOKEN) {
    console.error('[audit] 缺 GITHUB_TOKEN 环境变量');
    process.exit(1);
}

async function listArtifacts(page = 1, perPage = 100) {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/artifacts?per_page=${perPage}&page=${page}`;
    const r = await fetch(url, {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!r.ok) throw new Error(`GitHub API ${r.status}: ${await r.text()}`);
    return r.json();
}

const all = [];
for (let page = 1; page < 100; page++) {
    const data = await listArtifacts(page, 100);
    const items = data.artifacts || [];
    all.push(...items);
    if (items.length < 100) break;
}

const now = Date.now();
function daysSince(iso) { return (now - Date.parse(iso)) / 86400000; }

const stats = {
    total: all.length,
    expired: all.filter(a => a.expired).length,
    totalBytes: all.reduce((s, a) => s + (a.size_in_bytes || 0), 0),
    large: all.filter(a => (a.size_in_bytes || 0) > LARGE_MB * 1024 * 1024),
    ancient: all.filter(a => daysSince(a.created_at) > ANCIENT_DAYS && !a.expired),
};

const lines = [];
lines.push(`# CI Artifact Audit (${OWNER}/${REPO})`);
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(`- Total artifacts: ${stats.total}`);
lines.push(`- Expired: ${stats.expired} (will be auto-cleaned by GitHub)`);
lines.push(`- Total size: ${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB`);
lines.push(`- Large (> ${LARGE_MB} MB): ${stats.large.length}`);
lines.push(`- Ancient alive (> ${ANCIENT_DAYS} days): ${stats.ancient.length} ⚠️ 超 II4 趋势类 90d 上限`);
lines.push('');

if (stats.large.length > 0) {
    lines.push(`## ⚠️ Large artifacts (top 10)`);
    lines.push('');
    lines.push('| Name | Workflow | Size (MB) | Age (d) | Expired |');
    lines.push('|---|---|---|---|---|');
    const sorted = [...stats.large].sort((a, b) => b.size_in_bytes - a.size_in_bytes).slice(0, 10);
    for (const a of sorted) {
        lines.push(`| ${a.name} | ${a.workflow_run?.head_branch || '?'} | ${(a.size_in_bytes / 1024 / 1024).toFixed(1)} | ${daysSince(a.created_at).toFixed(0)} | ${a.expired ? 'yes' : 'no'} |`);
    }
    lines.push('');
}

if (stats.ancient.length > 0) {
    lines.push(`## ⚠️ Ancient alive artifacts (top 10)`);
    lines.push('');
    lines.push('| Name | Workflow | Age (d) | Size (MB) |');
    lines.push('|---|---|---|---|');
    const sorted = [...stats.ancient].sort((a, b) => daysSince(b.created_at) - daysSince(a.created_at)).slice(0, 10);
    for (const a of sorted) {
        lines.push(`| ${a.name} | ${a.workflow_run?.head_branch || '?'} | ${daysSince(a.created_at).toFixed(0)} | ${(a.size_in_bytes / 1024 / 1024).toFixed(1)} |`);
    }
    lines.push('');
}

lines.push('---');
lines.push('> 本脚本仅审计不删除。删除策略：');
lines.push('> 1. expired artifact GitHub 自动清理');
lines.push('> 2. ancient alive：跑 ' + '`gh api -X DELETE repos/' + OWNER + '/' + REPO + '/actions/artifacts/<id>`');
lines.push('> 3. 规范：II4 CI_ARTIFACT_RETENTION.md（trend ≤ 90d / diagnostic ≤ 30d）');

const report = lines.join('\n') + '\n';

if (OUT) {
    const target = resolve(process.cwd(), OUT);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, report, 'utf8');
    console.error(`[audit] report → ${target}`);
} else {
    process.stdout.write(report);
}

/* 软告警：ancient > 5 个 → exit 1，提醒清理 */
if (stats.ancient.length > 5) {
    console.error(`[audit] FAIL: ${stats.ancient.length} ancient alive artifacts > 5 阈值`);
    process.exit(1);
}
