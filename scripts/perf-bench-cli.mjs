#!/usr/bin/env node
/* global process, console */
/**
 * perf-bench-cli.mjs — 可写 JSON 的 CPU 基准（与 tests/perf.bench.js 同口径）
 *
 * 用法
 * ----
 *   node scripts/perf-bench-cli.mjs                       # 跑全部，打表到 stdout
 *   node scripts/perf-bench-cli.mjs --json                # 同上但 JSON 输出
 *   node scripts/perf-bench-cli.mjs --json --out file     # 写入文件
 *   node scripts/perf-bench-cli.mjs --time 800            # 单场景采样时长 (ms)
 *   node scripts/perf-bench-cli.mjs --filter spawn        # 名称过滤
 *
 * 与 npm run perf:bench 的关系
 * --------------------------
 * - npm run perf:bench → vitest bench，控制台美化输出，用于交互式调优
 * - node perf-bench-cli → 同样的场景但产出**可机器对比的 JSON**，用于：
 *     1. 采集基线（`npm run perf:baseline`）
 *     2. CI/release 回归检测（`npm run perf:check`）
 *
 * 不依赖 Vite，直接用 Node ESM 加载（避免 SSR plugin pipeline 偶发挂死，
 * 与早期 perf-bench.mjs 教训一致）；JSON import attribute 通过 Node 24+ 内置支持。
 */

import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const argv = process.argv.slice(2);
const cliArg = (k, fallback) => {
    const i = argv.indexOf(k);
    if (i === -1) return fallback;
    return argv[i + 1] ?? fallback;
};
const hasFlag = (k) => argv.includes(k);
const TIME_MS = Number(cliArg('--time', 800)) || 800;
const WARMUP_MS = Number(cliArg('--warmup', 150)) || 150;
const FILTER = String(cliArg('--filter', ''));
const OUT_PATH = cliArg('--out', '');
const JSON_OUT = hasFlag('--json') || Boolean(OUT_PATH);

/* JSON 模式下 stdout 必须严格只输出 JSON 串本身，供 `perf:check` / CI 解析。
 * vite 内部偶尔通过 console.log / process.stdout.write 喷信息（例如
 * "Re-optimizing dependencies because vite config has changed"），会污染 JSON。
 * 这里把 stdout 改写重定向到 stderr，确保 JSON 模式下 stdout 是干净的；
 * 真正的 JSON 输出用底层 _stdout.write 绕过拦截。 */
const _stdoutWrite = process.stdout.write.bind(process.stdout);
if (JSON_OUT) {
    process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);
}

/* 必须经过 Vite ssrLoadModule：项目里 `shared/game_rules.json` 等通过隐式 JSON 导入
 * 在 Node 原生 ESM 下报 ERR_IMPORT_ATTRIBUTE_MISSING；Vite SSR 已经处理好。
 * 用 configFile:false + appType:'custom'，避免任何不必要的 plugin pipeline。 */
const server = await createServer({
    configFile: false,
    root: process.cwd(),
    appType: 'custom',
    /* hmr:false + ws:false：纯 SSR 用途，避免和正在运行的 dev server 抢端口（24678）；
     * 否则 console 会喷一行 'WebSocket server error: Port is already in use'。 */
    server: { middlewareMode: true, hmr: false, ws: false },
});
const ssrLoad = (rel) => server.ssrLoadModule(rel);

const { resolveAdaptiveStrategy, derivePbCurve, snapshotInsightGeometry } = await ssrLoad('/web/src/adaptiveSpawn.js');
const { generateDockShapes } = await ssrLoad('/web/src/bot/blockSpawn.js');
const { Grid } = await ssrLoad('/web/src/grid.js');
const { getStressAmbience } = await ssrLoad('/web/src/stressAmbience.js');
const { PlayerProfile } = await ssrLoad('/web/src/playerProfile.js');
const { analyzeBoardTopology, countUnfillableCells, detectNearClears, computeCoverableCells } = await ssrLoad('/web/src/boardTopology.js');
const { getAllShapes } = await ssrLoad('/web/src/shapes.js');

function makeProfile(overrides = {}) {
    return {
        smoothSkill: 0.55, lifetimeGames: 12, lifetimePlacements: 300, spawnCounter: 30,
        frustrationLevel: 0, needsRecovery: false, sessionPhase: 'mid', momentum: 0,
        comboChain: 0.2, hadRecentNearMiss: false, isInOnboarding: false,
        playstyle: 'balanced', metrics: { comboRate: 0.18 }, ...overrides,
    };
}

function makeGrid(fillRatio = 0.35) {
    const g = new Grid(8);
    const filled = Math.round(8 * 8 * fillRatio);
    let placed = 0;
    let seed = 1234567;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    while (placed < filled) {
        const x = Math.floor(rand() * 8);
        const y = Math.floor(rand() * 8);
        if (g.cells[y][x] == null) {
            g.cells[y][x] = 1 + Math.floor(rand() * 5);
            placed++;
        }
    }
    return g;
}

function runBench(name, fn) {
    if (FILTER && !name.toLowerCase().includes(FILTER.toLowerCase())) return null;
    /* warmup：让 V8 充分 JIT */
    let t0 = performance.now();
    let iter = 0;
    while (performance.now() - t0 < WARMUP_MS) { fn(); iter++; }
    /* measure */
    const samples = [];
    t0 = performance.now();
    let count = 0;
    while (performance.now() - t0 < TIME_MS) {
        const s0 = performance.now();
        fn();
        samples.push(performance.now() - s0);
        count++;
    }
    samples.sort((a, b) => a - b);
    const sum = samples.reduce((a, b) => a + b, 0);
    const mean = sum / samples.length;
    const p50 = samples[Math.floor(samples.length * 0.50)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const min = samples[0];
    const max = samples[samples.length - 1];
    /* 相对标准误差 rme（%）：σ/√n / mean × 100 */
    let variance = 0;
    for (const s of samples) variance += (s - mean) ** 2;
    variance /= Math.max(1, samples.length - 1);
    const stddev = Math.sqrt(variance);
    const sem = stddev / Math.sqrt(samples.length);
    const rmePct = mean > 0 ? (sem / mean) * 100 : 0;
    return {
        name,
        samples: samples.length,
        meanMs: mean,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        minMs: min,
        maxMs: max,
        hz: 1000 / mean,
        rmePct,
        warmupCount: iter,
    };
}

const results = [];

/* ── 1. adaptiveSpawn ─────────────────────────────────────────────────── */
{
    const profile = makeProfile();
    const ctx = { totalRounds: 24, bestScore: 1500, roundsSinceClear: 1 };
    results.push(runBench('adaptiveSpawn.resolveAdaptiveStrategy(normal,mid)', () => {
        resolveAdaptiveStrategy('normal', profile, 800, 0, 0.45, ctx);
    }));
    results.push(runBench('adaptiveSpawn.resolveAdaptiveStrategy(hard,frustrated)', () => {
        resolveAdaptiveStrategy('hard', { ...profile, frustrationLevel: 0.6 }, 200, 0, 0.62, { ...ctx, roundsSinceClear: 5 });
    }));
    results.push(runBench('adaptiveSpawn.derivePbCurve(near-PB)', () => {
        derivePbCurve(1400, 1500, false);
    }));
    results.push(runBench('adaptiveSpawn.derivePbCurve(release-window)', () => {
        derivePbCurve(1600, 1500, true);
    }));
    /* v1.71 U4 新增：覆盖 D4 段 / 远 PB / near PB 等更多 resolveAdaptiveStrategy 分支，
     * 让 perf-check 在 spawnHints 三层构建的不同热路径上都能侦测回归。 */
    results.push(runBench('adaptiveSpawn.resolveAdaptiveStrategy(D4-segment)', () => {
        resolveAdaptiveStrategy('hard',
            { ...profile, smoothSkill: 0.88, lifetimeGames: 40 },
            2400, 0, 0.82, { ...ctx, totalRounds: 80, bestScore: 2200, roundsSinceClear: 0 });
    }));
    results.push(runBench('adaptiveSpawn.resolveAdaptiveStrategy(far-from-PB)', () => {
        resolveAdaptiveStrategy('normal', profile, 100, 0, 0.20, { ...ctx, bestScore: 3000, roundsSinceClear: 0 });
    }));
    results.push(runBench('adaptiveSpawn.resolveAdaptiveStrategy(near-PB-pre-release)', () => {
        resolveAdaptiveStrategy('normal',
            { ...profile, smoothSkill: 0.7, comboChain: 0.55 },
            1450, 0, 0.55, { ...ctx, bestScore: 1500, roundsSinceClear: 0 });
    }));
}

/* ── 2. blockSpawn 主路径 ─────────────────────────────────────────────── */
{
    const profile = makeProfile();
    const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, 0.45, {
        totalRounds: 24, bestScore: 1500, roundsSinceClear: 1,
    });
    const grid35 = makeGrid(0.35);
    const grid55 = makeGrid(0.55);
    const grid70 = makeGrid(0.70);
    const spawnCtx = { score: 800, bestScore: 1500, roundCounter: 24 };
    results.push(runBench('blockSpawn.generateDockShapes(fill=0.35)', () => generateDockShapes(grid35, strategy, spawnCtx)));
    results.push(runBench('blockSpawn.generateDockShapes(fill=0.55)', () => generateDockShapes(grid55, strategy, spawnCtx)));
    results.push(runBench('blockSpawn.generateDockShapes(fill=0.70)', () => generateDockShapes(grid70, strategy, spawnCtx)));
}

/* ── 3. Grid 子操作（per-shape helpers，bench 关键热点） ───────────────── */
{
    const grid55 = makeGrid(0.55);
    const shape4 = getAllShapes().find((s) => s.id === 'l4-a')?.data || [[1, 1], [1, 1]];
    results.push(runBench('Grid.clone', () => grid55.clone()));
    results.push(runBench('Grid.canPlaceAnywhere(shape4)', () => grid55.canPlaceAnywhere(shape4)));
    results.push(runBench('Grid.previewClearOutcome(shape4,0,0)', () => grid55.previewClearOutcome(shape4, 0, 0, 0)));
    results.push(runBench('Grid.bestExactFit(shape4)', () => grid55.bestExactFit?.(shape4)));
    results.push(runBench('Grid.bestMonoFlushPotential(shape4)', () => grid55.bestMonoFlushPotential?.(shape4, null, { returnTarget: true })));
    results.push(runBench('Grid.bestMonoFlushBuildup(shape4)', () => grid55.bestMonoFlushBuildup?.(shape4, null, 6)));
}

/* ── 4. boardTopology ─────────────────────────────────────────────────── */
{
    const grid55 = makeGrid(0.55);
    results.push(runBench('boardTopology.analyzeBoardTopology(grid55)', () => analyzeBoardTopology(grid55)));
    results.push(runBench('boardTopology.countUnfillableCells(grid55)', () => countUnfillableCells(grid55)));
    results.push(runBench('boardTopology.computeCoverableCells(grid55)', () => computeCoverableCells(grid55)));
    results.push(runBench('boardTopology.detectNearClears(grid55)', () => detectNearClears(grid55)));
    /* v1.71 U4：snapshotInsightGeometry 是每帧 HUD insight 主路径
     * （analyzeBoardTopology + 多消候选数 + perfectClearSetup 组合），
     * 是 D4 段 / 难度自适应的最重读盘动作，加入 bench 以监控回归。 */
    const dockSample = getAllShapes().slice(0, 3);
    results.push(runBench('adaptiveSpawn.snapshotInsightGeometry(grid55,dock3)', () => {
        snapshotInsightGeometry(grid55, dockSample);
    }));
}

/* ── 5. stress + profile（每帧 HUD 推送 / 每步记录） ───────────────────── */
{
    results.push(runBench('stressAmbience.getStressAmbience(0.55)', () => getStressAmbience(0.55)));
    const profile = new PlayerProfile();
    results.push(runBench('PlayerProfile.recordPlace(true,3)', () => profile.recordPlace(true, 3, 0.45)));
    results.push(runBench('PlayerProfile.recordPlace(false)', () => profile.recordPlace(false, 0, 0.55)));
    results.push(runBench('PlayerProfile.metricsForWindow(50)', () => profile.metricsForWindow(50)));
    /* v1.71 新增 bench：boardFillVelocity / recentSessionStats（T2 重写覆盖） */
    results.push(runBench('PlayerProfile.boardFillVelocity(5)', () => profile.boardFillVelocity(5)));
    /* 给 _sessionHistory 注入足量样本以让 recentSessionStats 真实跑 */
    profile._sessionHistory = Array.from({ length: 60 }, (_, i) => ({
        score: 800 + i * 7, placements: 28 + (i % 12),
    }));
    results.push(runBench('PlayerProfile.recentSessionStats(3)', () => profile.recentSessionStats(3)));
}

const filtered = results.filter(Boolean);

await server.close();

const meta = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: (await import('node:os')).cpus().length,
    timeMs: TIME_MS,
    warmupMs: WARMUP_MS,
};

const payload = { meta, results: filtered };

if (JSON_OUT) {
    const txt = JSON.stringify(payload, null, 2) + '\n';
    if (OUT_PATH) {
        const target = resolve(process.cwd(), OUT_PATH);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, txt, 'utf8');
        console.error(`[perf-bench] wrote ${filtered.length} results to ${target}`);
    } else {
        _stdoutWrite(txt);  /* 绕过 stderr 重定向，确保 JSON 真的进 stdout */
    }
} else {
    const fmt = (n) => (n < 0.001 ? n.toExponential(2) : n.toFixed(4));
    console.log('');
    console.log(`OpenBlock perf-bench-cli  time=${TIME_MS}ms  warmup=${WARMUP_MS}ms  node=${process.version}`);
    console.log('─'.repeat(96));
    console.log('name'.padEnd(54), 'p50 (ms)'.padStart(10), 'p99'.padStart(10), 'hz'.padStart(12), 'rme%'.padStart(7));
    console.log('─'.repeat(96));
    for (const r of filtered) {
        console.log(
            r.name.padEnd(54),
            fmt(r.p50Ms).padStart(10),
            fmt(r.p99Ms).padStart(10),
            r.hz.toLocaleString('en-US', { maximumFractionDigits: 0 }).padStart(12),
            r.rmePct.toFixed(2).padStart(7),
        );
    }
    console.log('─'.repeat(96));
    console.log(`done  ${filtered.length} scenarios`);
}
