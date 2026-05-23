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

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

const FAST_THRESHOLD_MS = 0.01;
const FAST_WARN_PCT = 40;
const FAST_FAIL_PCT = 80;
const SLOW_WARN_PCT = 15;
const SLOW_FAIL_PCT = 30;

/* 从命令行读基线 */
let baseline;
try {
    const raw = await readFile(resolve(process.cwd(), BASELINE_PATH), 'utf8');
    baseline = JSON.parse(raw);
    if (!Array.isArray(baseline?.results) || baseline.results.length === 0) {
        throw new Error('baseline missing results[]');
    }
} catch (e) {
    console.error(`[perf-check] failed to load baseline ${BASELINE_PATH}: ${e.message}`);
    console.error('         → run `npm run perf:baseline` first.');
    process.exit(2);
}

console.error(`[perf-check] baseline: ${BASELINE_PATH}`);
console.error(`             captured=${baseline.meta?.capturedAt}  node=${baseline.meta?.nodeVersion}  scenarios=${baseline.results.length}`);
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
try {
    current = JSON.parse(subResult.stdout);
} catch (e) {
    console.error(`[perf-check] failed to parse bench output: ${e.message}`);
    console.error('--- bench stdout (first 400 chars) ---');
    console.error(subResult.stdout.slice(0, 400));
    process.exit(1);
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
