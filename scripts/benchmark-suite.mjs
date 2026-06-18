#!/usr/bin/env node
/* global process, console */
/**
 * benchmark-suite.mjs — 一键统一性能仪表（v1.71 AA3）
 *
 * 目的：把分散的 perf-bench-cli / perf-dfs-stats / scan-unused-exports
 * 三个工具串成一次执行，输出 markdown 仪表盘，方便 owner 周末过一遍
 * "本周代码质量综合健康度"。
 *
 * 用法：
 *   npm run benchmark                  # 默认 markdown 报告到 stdout
 *   npm run benchmark -- --out file.md # 写到文件
 *   npm run benchmark -- --skip-perf   # 跳过耗时长的 perf-bench
 *
 * 设计原则：
 *   - 子工具复用已有 --json 输出，本脚本仅做聚合 / 渲染
 *   - 任何子工具失败都被吞，仪表盘标记 "ERROR" 但不阻塞其他维度
 *   - 不跑 vitest（已有 CI；本脚本聚焦"非测试维度"的健康度）
 */

import { spawnSync } from 'node:child_process';
import { writeFile, mkdir, stat, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const argv = process.argv.slice(2);
const cliArg = (k, fallback) => {
    const i = argv.indexOf(k);
    if (i === -1) return fallback;
    return argv[i + 1] ?? fallback;
};
const OUT_PATH = cliArg('--out', '');
const SKIP_PERF = argv.includes('--skip-perf');
/* EE5：trend 对比 —
 *   --trend-baseline path.json  读旧 snapshot，与本次跑结果做 Δ 对比
 *   --write-trend path.json     写本次 snapshot（CI 在主分支跑时用）
 *   --trend-fail-on-regress     任何关键指标恶化（>10%）时 exit 1
 * snapshot schema 见下方 _buildTrendSnapshot。 */
const TREND_BASELINE = cliArg('--trend-baseline', '');
const TREND_WRITE = cliArg('--write-trend', '');
const TREND_FAIL_ON_REGRESS = argv.includes('--trend-fail-on-regress');

function runNode(script, args = [], timeoutMs = 180_000) {
    const t0 = performance.now();
    const result = spawnSync('node', [script, ...args], {
        encoding: 'utf8',
        timeout: timeoutMs,
        cwd: process.cwd(),
    });
    const dt = performance.now() - t0;
    return {
        ok: result.status === 0 && !result.error,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        elapsedMs: dt,
        status: result.status,
    };
}

function parseJson(s) {
    try { return JSON.parse(s); } catch { return null; }
}

async function dirSize(dirPath) {
    try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        let total = 0;
        for (const ent of entries) {
            const full = join(dirPath, ent.name);
            if (ent.isDirectory()) total += await dirSize(full);
            else { const s = await stat(full); total += s.size; }
        }
        return total;
    } catch { return 0; }
}

/* ============ 1. dead-code scan ============ */
console.error('[benchmark] scanning dead code...');
const deadRes = runNode('scripts/scan-unused-exports.mjs',
    ['--strict', '--baseline', 'docs/engineering/dead-code-baseline.json', '--json'], 60_000);
const deadJson = parseJson(deadRes.stdout);

/* ============ 2. DFS budget stats ============ */
console.error('[benchmark] running DFS stats sim...');
const dfsRes = runNode('scripts/perf-dfs-stats.mjs', ['--json'], 120_000);
const dfsJson = parseJson(dfsRes.stdout);

/* ============ 3. perf-bench-cli (optional) ============ */
let perfRes = null, perfJson = null;
if (!SKIP_PERF) {
    console.error('[benchmark] running perf-bench-cli (慢，可用 --skip-perf 跳过)...');
    perfRes = runNode('scripts/perf-bench-cli.mjs', ['--json'], 300_000);
    perfJson = parseJson(perfRes.stdout);
}

/* ============ 4. dist size (若存在) ============ */
console.error('[benchmark] checking dist/ size...');
const distBytes = await dirSize(resolve(process.cwd(), 'dist'));

/* ============ render markdown ============ */
function fmtBytes(n) {
    if (n === 0) return 'N/A (未 build)';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function fmtMs(ms) { return `${ms.toFixed(0)} ms`; }

const lines = [];
lines.push('# Benchmark Suite Report');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push('');
lines.push('## 维度 1：Dead Code（scan-unused-exports）');
lines.push('');
if (deadRes.ok && deadJson) {
    lines.push(`- 总 export：${deadJson.totalExports}`);
    lines.push(`- 零引用项：${deadJson.unusedCount}`);
    if (deadJson.diff) {
        lines.push(`- 基线项：${deadJson.diff.baselineCount}`);
        lines.push(`- **新增**：${deadJson.diff.added.length} ${deadJson.diff.added.length > 0 ? '⚠️' : '✅'}`);
        lines.push(`- 已解决：${deadJson.diff.removed.length}`);
        if (deadJson.diff.added.length > 0) {
            lines.push('');
            lines.push('### 新增死代码列表');
            for (const a of deadJson.diff.added) {
                lines.push(`- \`${a.file}\` :: \`${a.name}\``);
            }
        }
    }
    lines.push(`- 耗时：${fmtMs(deadRes.elapsedMs)}`);
} else {
    lines.push(`- ❌ ERROR：${deadRes.stderr || deadRes.status}`);
}
lines.push('');

lines.push('## 维度 2：DFS Budget（perf-dfs-stats）');
lines.push('');
if (dfsRes.ok && dfsJson) {
    lines.push(`- 总 DFS 调用：${dfsJson.dfs.totalCalls}`);
    lines.push(`- Truncated：${dfsJson.dfs.truncatedCount} (${(dfsJson.dfs.truncatedRatio * 100).toFixed(2)}%)`);
    lines.push(`- 决策：**[${dfsJson.recommendation.level}]** ${dfsJson.recommendation.advice}`);
    if (dfsJson.leafCap) {
        lines.push(`- leafCap：evalCalls=${dfsJson.leafCap.evalTripletCalls}, capped=${(dfsJson.leafCap.cappedRatio * 100).toFixed(2)}%`);
        lines.push(`- leafCap 决策：**[${dfsJson.leafCapRecommendation.level}]** ${dfsJson.leafCapRecommendation.advice}`);
    }
    lines.push(`- 耗时：${fmtMs(dfsRes.elapsedMs)}`);
} else {
    lines.push(`- ❌ ERROR：${dfsRes.stderr?.slice(0, 200) || dfsRes.status}`);
}
lines.push('');

lines.push('## 维度 3：Perf Bench（perf-bench-cli）');
lines.push('');
if (SKIP_PERF) {
    lines.push('- ⏭️ 跳过（--skip-perf）');
} else if (perfRes?.ok && perfJson) {
    const scenarios = Array.isArray(perfJson.scenarios) ? perfJson.scenarios : [];
    lines.push(`- 场景数：${scenarios.length}`);
    if (scenarios.length > 0) {
        lines.push('');
        lines.push('| 场景 | mean (μs) | p95 (μs) |');
        lines.push('|---|---|---|');
        for (const sc of scenarios.slice(0, 12)) {
            const mean = sc.meanUs?.toFixed?.(2) ?? sc.mean ?? 'N/A';
            const p95 = sc.p95Us?.toFixed?.(2) ?? sc.p95 ?? 'N/A';
            lines.push(`| ${sc.name ?? '?'} | ${mean} | ${p95} |`);
        }
    }
    lines.push(`- 耗时：${fmtMs(perfRes.elapsedMs)}`);
} else {
    lines.push(`- ❌ ERROR：${perfRes?.stderr?.slice(0, 200) || perfRes?.status}`);
}
lines.push('');

lines.push('## 维度 4：Dist Bundle Size');
lines.push('');
lines.push(`- dist/ 总大小：${fmtBytes(distBytes)}`);
lines.push(`- 提示：运行 \`npm run build\` 后再跑可获最新数据`);
lines.push('');

/* ============ 5. Trend 对比（EE5） ============ */
function _buildTrendSnapshot() {
    return {
        schemaVersion: 1,
        ts: Date.now(),
        deadCode: {
            unusedCount: deadJson?.unusedCount ?? null,
            totalExports: deadJson?.totalExports ?? null,
        },
        dfs: {
            truncatedRatio: dfsJson?.dfs?.truncatedRatio ?? null,
            cappedRatio: dfsJson?.leafCap?.cappedRatio ?? null,
            totalCalls: dfsJson?.dfs?.totalCalls ?? null,
        },
        dist: { bytes: distBytes },
    };
}

const snapshot = _buildTrendSnapshot();

let trendBaseline = null;
let regressed = false;
if (TREND_BASELINE) {
    try {
        const raw = await readFile(resolve(process.cwd(), TREND_BASELINE), 'utf8');
        trendBaseline = JSON.parse(raw);
    } catch (e) {
        console.error(`[benchmark] trend baseline 读取失败：${e.message}`);
    }
}

function fmtDeltaPct(curr, base) {
    if (base == null || base === 0 || curr == null) return 'N/A';
    const pct = ((curr - base) / Math.abs(base)) * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
}
function deltaIcon(curr, base, lowerIsBetter = true) {
    if (base == null || curr == null) return '–';
    if (curr === base) return '=';
    const better = lowerIsBetter ? (curr < base) : (curr > base);
    if (better) return '✅';
    /* 退化阈值：超过 10% 视为显著恶化 */
    if (base === 0) return '⚠️';
    const pct = Math.abs((curr - base) / base) * 100;
    return pct > 10 ? '🔴' : '⚠️';
}

lines.push('## 维度 5：Trend 对比（EE5）');
lines.push('');
if (trendBaseline) {
    lines.push(`- 基线时间：${new Date(trendBaseline.ts || 0).toISOString()}`);
    lines.push('');
    lines.push('| 指标 | 基线 | 当前 | Δ | 状态 |');
    lines.push('|---|---|---|---|---|');
    const rows = [
        ['dead code unused', trendBaseline.deadCode?.unusedCount, snapshot.deadCode.unusedCount, true],
        ['DFS truncatedRatio', trendBaseline.dfs?.truncatedRatio, snapshot.dfs.truncatedRatio, true],
        ['DFS cappedRatio', trendBaseline.dfs?.cappedRatio, snapshot.dfs.cappedRatio, true],
        ['dist bytes', trendBaseline.dist?.bytes, snapshot.dist.bytes, true],
    ];
    for (const [name, base, curr, lib] of rows) {
        const icon = deltaIcon(curr, base, lib);
        if (icon === '🔴') regressed = true;
        lines.push(`| ${name} | ${base ?? 'N/A'} | ${curr ?? 'N/A'} | ${fmtDeltaPct(curr, base)} | ${icon} |`);
    }
} else if (TREND_BASELINE) {
    lines.push(`- ⚠️ 基线文件 \`${TREND_BASELINE}\` 不可读，跳过对比`);
} else {
    lines.push('- 未指定 `--trend-baseline`，跳过对比（首次运行用 `--write-trend` 写基线）');
}
lines.push('');

if (TREND_WRITE) {
    try {
        const target = resolve(process.cwd(), TREND_WRITE);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
        console.error(`[benchmark] trend snapshot 已写入 ${target}`);
    } catch (e) {
        console.error(`[benchmark] trend snapshot 写入失败：${e.message}`);
    }
}

lines.push('---');
lines.push('');
lines.push('> 由 `npm run benchmark`（scripts/benchmark-suite.mjs）生成。');
lines.push('> 5 维度数据来源：scan-unused-exports / perf-dfs-stats / perf-bench-cli / dist / trend baseline。');

const report = lines.join('\n') + '\n';

if (OUT_PATH) {
    const target = resolve(process.cwd(), OUT_PATH);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, report, 'utf8');
    console.error(`[benchmark] 报告已写入 ${target}`);
} else {
    process.stdout.write(report);
}

/* 任何一个维度失败就返回非零（CI 可接） */
const anyFail = !deadRes.ok || !dfsRes.ok || (!SKIP_PERF && perfRes && !perfRes.ok);
const trendFail = TREND_FAIL_ON_REGRESS && regressed;
if (trendFail) console.error('[benchmark] ❌ trend 检测到 >10% 退化，按 --trend-fail-on-regress 退出');
process.exit((anyFail || trendFail) ? 1 : 0);
