#!/usr/bin/env node
/* global process, console */
/**
 * perf-check.mjs — CPU 基线回归检测
 *
 * 设计目标
 * --------
 * 1. 加载现有基线（tests/perf-baseline.json）
 * 2. 跑一次 perf-bench-cli 拿到当前结果
 * 3. 对每个场景做 p50 对比；超过阈值时标 warn / fail
 * 4. 阈值在脚本顶部声明，与 README 同步
 *
 * 退出码
 * ------
 *   0 = 全部 OK 或仅 warn（用于 `npm run perf:check`）
 *   1 = 至少一个场景 p50 退化 > FAIL_PCT 或场景缺失
 *   2 = 加载基线失败（基线文件缺/坏）
 *
 * 用法
 * ----
 *   npm run perf:baseline            → 当前结果写入基线
 *   npm run perf:check               → 跑回归（输出表 + 退出码）
 *   node scripts/perf-check.mjs --strict   → warn 也算失败
 *   node scripts/perf-check.mjs --time 800 → 自定义采样时长
 *
 * 阈值说明（为什么这么定）
 * ----------------------
 * 不同场景的噪声水平不同。微秒级（hz > 1e6）单点 rme% 经常因为 JIT/GC 抖动，
 * 单次运行可能 -20% +20%，所以这种场景容忍度更高；ms 级路径稳定，容忍度更低。
 *
 *  - microsecond scenarios（p50 < 0.01ms）: warn 40%, fail 80%
 *  - ms 级 scenarios（p50 ≥ 0.01ms）        : warn 15%, fail 30%
 *
 * 如果你做的是有意的性能优化，跑 `npm run perf:baseline` 更新基线；
 * 如果是无意的退化，本脚本会在 CI / release:check 里把你拦下来。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const cliArg = (k, fallback) => {
    const i = argv.indexOf(k);
    if (i === -1) return fallback;
    return argv[i + 1] ?? fallback;
};
const hasFlag = (k) => argv.includes(k);
const STRICT = hasFlag('--strict');
const TIME_MS = Number(cliArg('--time', 800)) || 800;
const WARMUP_MS = Number(cliArg('--warmup', 150)) || 150;
const BASELINE_PATH = cliArg('--baseline', 'tests/perf-baseline.json');
const REPORT_PATH = cliArg('--report', '');  /* 可选：输出 markdown 报告路径 */

const FAST_THRESHOLD_MS = 0.01;
const FAST_WARN_PCT = 40;
const FAST_FAIL_PCT = 80;
const SLOW_WARN_PCT = 15;
const SLOW_FAIL_PCT = 30;

/* MM5 + NN-C1: perf-baseline.json schema 演进 + 自动迁移（对称 LL5 trend-history）
 * v1：初版（meta + results[]）。
 * v2：预留——若未来加新 meta 字段或 results 结构变化时 bump。
 *
 * 与 LL5 同模式：
 *   - 未来版本 → fail（拒绝误解读）
 *   - 旧版本 → 自动 _migrateBaseline 升级到当前
 *   - 无 schemaVersion 字段 → 视作 v1 → 走 v1→v2 迁移路径 */
const PERF_BASELINE_SCHEMA_VERSION = 1;

/**
 * NN-C1: 把任意 v<current 的 baseline 迁移到当前 schema 版本。
 * 当 v2 出现时在此扩展（添加 v1→v2 转换分支）。
 *
 * @param {object} baseline 已 JSON.parse 的 raw baseline
 * @returns {{ migrated: object, fromVersion: number, didMigrate: boolean }}
 */
function _migrateBaseline(baseline) {
    const fromVersion = baseline?.meta?.schemaVersion ?? 1;
    if (fromVersion === PERF_BASELINE_SCHEMA_VERSION) {
        return { migrated: baseline, fromVersion, didMigrate: false };
    }
    let current = baseline;
    /* v1 → v2 占位（未来添加：results 加 p999 字段 / meta 加 gpu 字段等）
     * 示例迁移代码：
     *   if (fromVersion < 2) {
     *     current = { ...current, meta: { ...current.meta, schemaVersion: 2 },
     *       results: current.results.map(r => ({ ...r, p999Ms: r.p99Ms })) };
     *   }
     */
    /* 兜底：仅 bump schemaVersion 字段（无字段补字段） */
    current = {
        ...current,
        meta: { ...(current.meta || {}), schemaVersion: PERF_BASELINE_SCHEMA_VERSION },
    };
    return { migrated: current, fromVersion, didMigrate: true };
}

/* 从命令行读基线 */
let baseline;
try {
    const raw = await readFile(resolve(process.cwd(), BASELINE_PATH), 'utf8');
    baseline = JSON.parse(raw);
    if (!Array.isArray(baseline?.results) || baseline.results.length === 0) {
        throw new Error('baseline missing results[]');
    }
    /* MM5: schemaVersion 校验 */
    const baseVer = baseline?.meta?.schemaVersion ?? 1; /* 无字段→当作 v1（最早版本） */
    if (baseVer > PERF_BASELINE_SCHEMA_VERSION) {
        console.error(`[perf-check] baseline schemaVersion=${baseVer} > 脚本支持的 ${PERF_BASELINE_SCHEMA_VERSION}`);
        console.error('             → 升级 perf-check.mjs 后再跑（防止字段误解读）');
        process.exit(3);
    }
    if (baseVer < 1) {
        console.error(`[perf-check] baseline schemaVersion=${baseVer} 不合法（应 >=1）`);
        process.exit(3);
    }
    /* NN-C1: 自动迁移旧 baseline 到当前 schema */
    const { migrated, fromVersion, didMigrate } = _migrateBaseline(baseline);
    if (didMigrate) {
        console.error(`[perf-check] baseline v${fromVersion} → v${PERF_BASELINE_SCHEMA_VERSION} 自动迁移（内存，不写回文件）`);
        baseline = migrated;
    }
} catch (e) {
    console.error(`[perf-check] failed to load baseline ${BASELINE_PATH}: ${e.message}`);
    console.error('         → run `npm run perf:baseline` first.');
    process.exit(2);
}

console.error(`[perf-check] baseline: ${BASELINE_PATH}`);
console.error(`             captured=${baseline.meta?.capturedAt}  node=${baseline.meta?.nodeVersion}  scenarios=${baseline.results.length}`);
console.error(`             baseline machine: ${baseline.meta?.platform}/${baseline.meta?.arch}  cpuCount=${baseline.meta?.cpuCount}`);
console.error(`[perf-check] running fresh bench (time=${TIME_MS}ms, warmup=${WARMUP_MS}ms) ...`);

/* 直接 spawn 子进程跑 perf-bench-cli，拿 JSON。这样保证当前进程的 V8 状态不会
 * 被 bench 自身的长跑污染。 */
const subResult = spawnSync(process.execPath, [
    'scripts/perf-bench-cli.mjs',
    '--json',
    '--time', String(TIME_MS),
    '--warmup', String(WARMUP_MS),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (subResult.status !== 0) {
    console.error(`[perf-check] bench failed (exit ${subResult.status})`);
    console.error(subResult.stderr || '');
    process.exit(1);
}

let current;
{
    /* 兜底：vite 等子进程偶尔会向 stdout 喷非 JSON 前缀（例如
     * "Re-optimizing dependencies because vite config has changed"）。
     * 优先严格 parse，失败时剥离前置噪声重试（取第一个 '{' 起到对应的 '}' 段）。 */
    const raw = subResult.stdout;
    try {
        current = JSON.parse(raw);
    } catch {
        const firstBrace = raw.indexOf('{');
        const lastBrace = raw.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                current = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
                console.error(`[perf-check] (warn) bench stdout had ${firstBrace} non-JSON prefix bytes (stripped)`);
            } catch (e2) {
                console.error(`[perf-check] failed to parse bench output: ${e2.message}`);
                console.error('--- bench stdout (first 400 chars) ---');
                console.error(raw.slice(0, 400));
                process.exit(1);
            }
        } else {
            console.error(`[perf-check] failed to parse bench output (no JSON found)`);
            console.error('--- bench stdout (first 400 chars) ---');
            console.error(raw.slice(0, 400));
            process.exit(1);
        }
    }
}

/* 机器上下文一致性检查：CPU 数 / 平台 / 架构差异较大时给出明显警告，
 * 因为 baseline 与 current 跨硬件对比时 -30% / +30% 可能纯粹是机器差异。
 * 这里只警告不失败（让本地开发者也能 `npm run perf:check`）。 */
const baseMeta = baseline.meta || {};
const curMeta = current.meta || {};
const machineMismatch = [];
if (baseMeta.platform && curMeta.platform && baseMeta.platform !== curMeta.platform) {
    machineMismatch.push(`platform ${baseMeta.platform} → ${curMeta.platform}`);
}
if (baseMeta.arch && curMeta.arch && baseMeta.arch !== curMeta.arch) {
    machineMismatch.push(`arch ${baseMeta.arch} → ${curMeta.arch}`);
}
if (baseMeta.cpuCount && curMeta.cpuCount && Math.abs(baseMeta.cpuCount - curMeta.cpuCount) >= 2) {
    machineMismatch.push(`cpuCount ${baseMeta.cpuCount} → ${curMeta.cpuCount}`);
}
if (baseMeta.nodeVersion && curMeta.nodeVersion && baseMeta.nodeVersion.split('.')[0] !== curMeta.nodeVersion.split('.')[0]) {
    machineMismatch.push(`node major ${baseMeta.nodeVersion} → ${curMeta.nodeVersion}`);
}
if (machineMismatch.length > 0) {
    console.error('');
    console.error(`[perf-check] ⚠️  机器上下文不一致，结果仅供参考、不应据此更新基线：`);
    for (const m of machineMismatch) console.error(`             - ${m}`);
    console.error(`             建议在与 baseline 同型号机器上运行才能比较；或先 npm run perf:baseline 重建基线。`);
}

const byName = new Map();
for (const r of baseline.results) byName.set(r.name, r);

const rows = [];
let warnCount = 0;
let failCount = 0;
let missingFromBaseline = 0;

for (const cur of current.results) {
    const base = byName.get(cur.name);
    if (!base) {
        missingFromBaseline++;
        rows.push({ name: cur.name, status: 'new', deltaPct: NaN, basePMs: NaN, curPMs: cur.p50Ms });
        continue;
    }
    const deltaPct = base.p50Ms > 0 ? ((cur.p50Ms - base.p50Ms) / base.p50Ms) * 100 : 0;
    const isFast = base.p50Ms < FAST_THRESHOLD_MS;
    const warnPct = isFast ? FAST_WARN_PCT : SLOW_WARN_PCT;
    const failPct = isFast ? FAST_FAIL_PCT : SLOW_FAIL_PCT;
    let status = 'ok';
    if (deltaPct >= failPct) { status = 'fail'; failCount++; }
    else if (deltaPct >= warnPct) { status = 'warn'; warnCount++; }
    else if (deltaPct <= -warnPct) { status = 'gain'; }   // 性能提升，仅展示
    rows.push({ name: cur.name, status, deltaPct, basePMs: base.p50Ms, curPMs: cur.p50Ms });
}

const removed = baseline.results.filter((b) => !current.results.find((c) => c.name === b.name));

/* 打印对比表（stderr，CI 可看到）。状态色用 emoji 避免依赖 ANSI。 */
const fmt = (n) => (Number.isFinite(n) ? (n < 0.001 ? n.toExponential(2) : n.toFixed(4)) : '–');
const fmtPct = (n) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '–');
const tag = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', gain: 'GAIN', new: 'NEW ' };

console.error('');
console.error('name'.padEnd(54), 'baseline'.padStart(10), 'current'.padStart(10), 'delta'.padStart(10), 'status'.padStart(7));
console.error('─'.repeat(96));
for (const r of rows) {
    console.error(
        r.name.padEnd(54),
        fmt(r.basePMs).padStart(10),
        fmt(r.curPMs).padStart(10),
        fmtPct(r.deltaPct).padStart(10),
        tag[r.status].padStart(7),
    );
}
console.error('─'.repeat(96));
console.error(`scenarios=${rows.length}  warn=${warnCount}  fail=${failCount}  new=${missingFromBaseline}  removed-from-baseline=${removed.length}`);
console.error(`阈值: 微秒级 (p50<${FAST_THRESHOLD_MS}ms) warn ${FAST_WARN_PCT}%/fail ${FAST_FAIL_PCT}%；其他 warn ${SLOW_WARN_PCT}%/fail ${SLOW_FAIL_PCT}%`);

/* 可选：写 markdown 报告（供 CI artifact / PR 评论） */
if (REPORT_PATH) {
    const statusEmoji = { ok: '✅', warn: '⚠️', fail: '❌', gain: '🚀', new: '🆕' };
    const lines = [];
    lines.push(`# Perf Check Report`);
    lines.push('');
    lines.push(`- **Captured at**: ${current.meta?.capturedAt}`);
    lines.push(`- **Baseline**: ${BASELINE_PATH} (captured ${baseMeta.capturedAt})`);
    lines.push(`- **Machine**: baseline ${baseMeta.platform}/${baseMeta.arch} cpuCount=${baseMeta.cpuCount} node=${baseMeta.nodeVersion} → current ${curMeta.platform}/${curMeta.arch} cpuCount=${curMeta.cpuCount} node=${curMeta.nodeVersion}`);
    if (machineMismatch.length > 0) {
        lines.push(`- ⚠️ **机器上下文不一致**：${machineMismatch.join('; ')} — 数字仅供参考，不要据此更新 baseline`);
    }
    lines.push(`- **Summary**: ${rows.length} scenarios, ${warnCount} warn, ${failCount} fail, ${missingFromBaseline} new, ${removed.length} removed`);
    lines.push('');
    lines.push(`| Status | Scenario | Baseline p50 (ms) | Current p50 (ms) | Δ | trend |`);
    lines.push(`|---|---|---|---|---|---|`);
    /* 按 |Δ%| 倒序，让回归/提速浮到顶部 */
    const sorted = [...rows].sort((a, b) => Math.abs(b.deltaPct || 0) - Math.abs(a.deltaPct || 0));
    /* KK4：mini sparkline——基于 [base, cur] 两点的方向标，无需历史文件 */
    const _spark2 = (base, cur) => {
        if (!Number.isFinite(base) || !Number.isFinite(cur) || base === 0) return '· ·';
        const pct = (cur - base) / base * 100;
        if (Math.abs(pct) < 1) return '▁▁';        /* 持平 */
        if (pct > 30) return '▁█';                 /* 大回归 */
        if (pct > 10) return '▁▆';                 /* 中回归 */
        if (pct > 0)  return '▁▃';                 /* 小回归 */
        if (pct < -30) return '█▁';                /* 大提速 */
        if (pct < -10) return '▆▁';                /* 中提速 */
        return '▃▁';                                /* 小提速 */
    };
    for (const r of sorted) {
        const emoji = statusEmoji[r.status] || '·';
        const sp = _spark2(r.basePMs, r.curPMs);
        lines.push(`| ${emoji} ${r.status.toUpperCase()} | \`${r.name}\` | ${fmt(r.basePMs)} | ${fmt(r.curPMs)} | ${fmtPct(r.deltaPct)} | \`${sp}\` |`);
    }
    /* KK4：分桶汇总段——按 status 计数，PR reviewer 一眼看大盘 */
    const buckets = { gain: 0, ok: 0, warn: 0, fail: 0, new: 0 };
    for (const r of rows) if (buckets[r.status] != null) buckets[r.status]++;
    lines.push('');
    lines.push('### 状态分桶（KK4）');
    lines.push('');
    lines.push(`- 🚀 gain：${buckets.gain}　✅ ok：${buckets.ok}　⚠️ warn：${buckets.warn}　❌ fail：${buckets.fail}　🆕 new：${buckets.new}`);
    lines.push('');
    if (removed.length > 0) {
        lines.push('');
        lines.push(`### Removed from current run (still in baseline)`);
        for (const r of removed) lines.push(`- \`${r.name}\` (baseline p50=${fmt(r.p50Ms)})`);
    }
    lines.push('');
    /* CI 友好 summary：在表格之上多一行明显状态，便于 PR 阅读 */
    const overallStatus = failCount > 0
        ? `❌ ${failCount} 项性能退化 ≥ fail 阈值`
        : warnCount > 0
            ? `⚠️ ${warnCount} 项 ≥ warn 阈值（未达 fail）`
            : '✅ 所有场景在阈值内';
    lines.splice(7, 0, `- **Overall**: ${overallStatus}`); // 紧跟 Summary 后
    lines.push(`> 阈值: 微秒级 (p50<${FAST_THRESHOLD_MS}ms) warn ${FAST_WARN_PCT}%/fail ${FAST_FAIL_PCT}%；其他 warn ${SLOW_WARN_PCT}%/fail ${SLOW_FAIL_PCT}%`);
    lines.push(`> 如果是有意优化，跑 \`npm run perf:baseline\` 更新基线`);
    lines.push('');
    lines.push(`<!-- sticky-comment: perf-check; do not edit by hand -->`);
    const target = resolve(process.cwd(), REPORT_PATH);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, lines.join('\n') + '\n', 'utf8');
    console.error(`[perf-check] wrote markdown report to ${REPORT_PATH}`);
}

if (failCount > 0) {
    console.error(`[perf-check] FAILED: ${failCount} scenarios regressed beyond fail threshold`);
    console.error('             → 如果是有意优化导致基线轮换，运行 `npm run perf:baseline` 更新基线');
    process.exit(1);
}
if (STRICT && warnCount > 0) {
    console.error(`[perf-check] STRICT mode: ${warnCount} warn(s) treated as fail`);
    process.exit(1);
}
console.error(`[perf-check] OK`);
process.exit(0);
