#!/usr/bin/env node
/* global process, console */
/**
 * perf-dfs-stats.mjs — DFS budget 占用基线采集（v1.71 W3）
 *
 * 目的：V4 加了 getBlockSpawnDfsStats() 观测埋点后，需要 offline 工具
 * 采集真实工况下的 truncatedRatio + 桶分布，**用数据驱动**决定是否
 * 把 SURVIVE_SEARCH_BUDGET / SOLUTION_BUDGET_DEFAULT 上调/下调。
 *
 * 用法：
 *   node scripts/perf-dfs-stats.mjs                       # 默认 200 round 模拟
 *   node scripts/perf-dfs-stats.mjs --rounds 500          # 更多 round
 *   node scripts/perf-dfs-stats.mjs --json                # 机器可读输出
 *   node scripts/perf-dfs-stats.mjs --json --out file.json
 *
 * 模拟方案：
 *   建一个 8×8 grid，从 fill=0.1 起每 round 模拟 1 次 generateDockShapes
 *   并随机放一块 + 模拟消行，让 fill 在 0.1–0.75 区间漂移，覆盖
 *   真实游戏的盘面分布。
 *
 * 决策表（输出末尾会打印）：
 *   truncatedRatio < 5%   → 预算可下调（节省主线程）
 *   5% ≤ ratio < 15%      → 预算合理，维持
 *   ratio ≥ 15%           → 预算紧张，建议上调（U2 节省的预算可投入）
 *
 * budgetUsageHist 解读：
 *   主要落在 [<25%] 桶 → 大量 short-circuit，预算严重过剩
 *   主要落在 [75–100%] 桶 → 大多数 call 都耗到接近 truncate，预算紧
 *   双峰 → 业务有两种典型工况，需要按场景动态调
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
const ROUNDS = Number(cliArg('--rounds', 200)) || 200;
const OUT_PATH = cliArg('--out', '');
const JSON_OUT = argv.includes('--json') || Boolean(OUT_PATH);

const _stdoutWrite = process.stdout.write.bind(process.stdout);
if (JSON_OUT) {
    process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);
}

const server = await createServer({
    configFile: false, root: process.cwd(), appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
});
const ssrLoad = (rel) => server.ssrLoadModule(rel);

const { resolveAdaptiveStrategy } = await ssrLoad('/web/src/adaptiveSpawn.js');
const { generateDockShapes, getBlockSpawnDfsStats, resetBlockSpawnDfsStats } = await ssrLoad('/web/src/bot/blockSpawn.js');
const { Grid } = await ssrLoad('/web/src/grid.js');

function makeProfile(overrides = {}) {
    return {
        smoothSkill: 0.55, lifetimeGames: 12, lifetimePlacements: 300, spawnCounter: 30,
        frustrationLevel: 0, needsRecovery: false, sessionPhase: 'mid', momentum: 0,
        comboChain: 0.2, hadRecentNearMiss: false, isInOnboarding: false,
        playstyle: 'balanced', metrics: { comboRate: 0.18 }, ...overrides,
    };
}

function makeGrid(fillRatio) {
    const g = new Grid(8);
    const filled = Math.round(64 * Math.max(0, Math.min(0.95, fillRatio)));
    let placed = 0, seed = (Date.now() & 0x7fffffff) || 12345;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    while (placed < filled) {
        const x = Math.floor(rand() * 8);
        const y = Math.floor(rand() * 8);
        if (g.cells[y][x] == null) { g.cells[y][x] = 1; placed++; }
    }
    return g;
}

resetBlockSpawnDfsStats();
const profile = makeProfile();
const t0 = performance.now();
let _spawnedTotal = 0;

for (let round = 0; round < ROUNDS; round++) {
    /* fill 在 0.10–0.75 区间正弦漂移，覆盖典型游戏盘面分布 */
    const fill = 0.10 + 0.65 * 0.5 * (1 + Math.sin(round / 12));
    const grid = makeGrid(fill);
    const strategy = resolveAdaptiveStrategy('normal', profile, 800, 0, fill, {
        totalRounds: 24 + round, bestScore: 1500, roundsSinceClear: round % 5,
    });
    try {
        generateDockShapes(grid, strategy, { score: 800, bestScore: 1500, roundCounter: round });
        _spawnedTotal++;
    } catch { /* 某些极端配置可能抛错，不影响采集 */ }
}

const totalElapsedMs = performance.now() - t0;
const stats = getBlockSpawnDfsStats();
await server.close();

const histTotal = stats.budgetUsageHist.reduce((a, b) => a + b, 0);
const histPct = stats.budgetUsageHist.map((n) => (histTotal > 0 ? (n / histTotal * 100) : 0));

function recommend(truncatedRatio) {
    if (truncatedRatio < 0.05) return { level: 'EXCESS', advice: '预算严重过剩，建议下调 25–40%（节省主线程）' };
    if (truncatedRatio < 0.15) return { level: 'OK', advice: '预算合理，维持现状' };
    if (truncatedRatio < 0.30) return { level: 'TIGHT', advice: '预算偏紧，建议上调 15–25%（U2 节省的预算可投入）' };
    return { level: 'CRITICAL', advice: '预算严重不足，DFS 大量截断；建议立刻上调 30–50% 并加场景化预算' };
}

const rec = recommend(stats.truncatedRatio);

const payload = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    config: { rounds: ROUNDS, spawnedTotal: _spawnedTotal, totalElapsedMs },
    dfs: {
        totalCalls: stats.totalCalls,
        truncatedCount: stats.truncatedCount,
        truncatedRatio: stats.truncatedRatio,
        budgetUsageHist: stats.budgetUsageHist,
        budgetUsageHistPct: histPct,
        bucketLabels: ['<25%', '<50%', '<75%', '≤100%'],
    },
    recommendation: rec,
};

if (JSON_OUT) {
    const txt = JSON.stringify(payload, null, 2) + '\n';
    if (OUT_PATH) {
        const target = resolve(process.cwd(), OUT_PATH);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, txt, 'utf8');
        console.error(`[perf-dfs-stats] wrote to ${target}`);
    } else {
        _stdoutWrite(txt);
    }
} else {
    console.log('');
    console.log(`DFS budget 占用基线采集（${ROUNDS} round，spawned ${_spawnedTotal}，elapsed ${totalElapsedMs.toFixed(0)}ms）`);
    console.log('─'.repeat(70));
    console.log(`总 DFS 调用：${stats.totalCalls}`);
    console.log(`Truncated：${stats.truncatedCount}（${(stats.truncatedRatio * 100).toFixed(2)}%）`);
    console.log('');
    console.log('budgetUsage 桶分布：');
    for (let i = 0; i < 4; i++) {
        const label = payload.dfs.bucketLabels[i].padStart(7);
        const cnt = stats.budgetUsageHist[i];
        const pct = histPct[i].toFixed(1).padStart(5);
        const bar = '█'.repeat(Math.round(histPct[i] / 2));
        console.log(`  ${label}  ${String(cnt).padStart(6)}  ${pct}%  ${bar}`);
    }
    console.log('');
    console.log(`决策：[${rec.level}] ${rec.advice}`);
}
