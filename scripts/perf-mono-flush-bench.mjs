#!/usr/bin/env node
/* global process, console */
/**
 * perf-mono-flush-bench.mjs — bestMonoFlushPotential / Buildup 微基准（v1.71 GG2）
 *
 * 目标：为 bestMonoFlushPotential / bestMonoFlushBuildup 这两个 N² 嵌套
 * 复杂热点函数建立**专门的 baseline**，区分:
 *   - 不同盘面占用率 (0.30 / 0.55 / 0.80)
 *   - 不同 shape 复杂度 (1×1 / 2×2 / 3×3 / I3 / L4)
 *   - skin 配色路径 vs colorIdx 路径
 *
 * 用途：后续如尝试 bitmap 化时，本脚本提供"分维度退化检测"——
 * 总耗时不变但某个分桶恶化也能定位。
 *
 * 与 perf-bench-cli 的区别：本脚本只跑 mono flush 两个函数，
 * 但每个函数跑 5×2=10 个场景。
 *
 * 用法：
 *   node scripts/perf-mono-flush-bench.mjs            人类可读表格
 *   node scripts/perf-mono-flush-bench.mjs --json     JSON 输出（baseline 用）
 *   node scripts/perf-mono-flush-bench.mjs --time 600
 */

import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const cliArg = (k, fallback) => {
    const i = argv.indexOf(k);
    if (i === -1) return fallback;
    return argv[i + 1] ?? fallback;
};
const hasFlag = (k) => argv.includes(k);
const TIME_MS = Number(cliArg('--time', 600)) || 600;
const WARMUP_MS = Number(cliArg('--warmup', 100)) || 100;
const JSON_OUT = hasFlag('--json');

const _stdoutWrite = process.stdout.write.bind(process.stdout);
if (JSON_OUT) process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);

/* 走 cocos 镜像（.mjs）—— cocos engine 同步脚本已把 shapes JSON
 * 编译为 gameRulesData.mjs（含 SHAPES 内联），无 import attribute 问题。
 * 这让 micro-bench 可以脱离 vite 在 ~100ms 内启动。 */
const gridMod = await import(pathToFileURL(resolve(process.cwd(), 'cocos/assets/scripts/engine/grid.mjs')).href);
const Grid = gridMod.Grid;
/* L4 shape（与 shared/shapes.json l4-a 一致）— bench 用，无需全 24 个 */
const getAllShapes = () => [
    { id: 'l4-a', data: [[1, 1], [1, 0], [1, 0]] },
];

function makeGrid(fillRatio, seed = 42) {
    const g = new Grid(8);
    let s = seed;
    let target = Math.floor(64 * fillRatio);
    while (target > 0) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const x = s & 7;
        s = (s * 1664525 + 1013904223) >>> 0;
        const y = s & 7;
        if (g.cells[y][x] === null) {
            g.cells[y][x] = (s >>> 8) & 3;
            target--;
        }
    }
    return g;
}

function runBench(name, fn) {
    /* warmup */
    const w0 = performance.now();
    let warmIters = 0;
    while (performance.now() - w0 < WARMUP_MS) { fn(); warmIters++; }

    /* measure */
    const t0 = performance.now();
    let iters = 0;
    while (performance.now() - t0 < TIME_MS) { fn(); iters++; }
    const dt = performance.now() - t0;
    const meanUs = (dt * 1000) / iters;
    return { name, iters, meanUs, opsPerSec: (iters / dt) * 1000 };
}

const shapesAll = getAllShapes();
const cases = [
    { name: '1×1', shape: [[1]] },
    { name: '2×2', shape: [[1, 1], [1, 1]] },
    { name: '3×3', shape: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] },
    { name: 'I3', shape: [[1, 1, 1]] },
    { name: 'L4', shape: shapesAll.find((s) => s.id === 'l4-a')?.data || [[1, 1], [1, 1]] },
];

const fillRatios = [0.30, 0.55, 0.80];
const skinFake = { blockIcons: ['🟥', '🟦', '🟩', '🟨'] };

const results = [];
for (const fr of fillRatios) {
    const grid = makeGrid(fr);
    for (const c of cases) {
        results.push(runBench(`flushPotential fr=${fr} ${c.name} no-skin`,
            () => grid.bestMonoFlushPotential(c.shape, null, { returnTarget: true })));
        results.push(runBench(`flushPotential fr=${fr} ${c.name} skin`,
            () => grid.bestMonoFlushPotential(c.shape, skinFake, { returnTarget: true })));
        results.push(runBench(`flushBuildup fr=${fr} ${c.name}`,
            () => grid.bestMonoFlushBuildup(c.shape, null, 6)));
    }
}

if (JSON_OUT) {
    _stdoutWrite(JSON.stringify({
        schemaVersion: 1,
        ts: Date.now(),
        timeMs: TIME_MS,
        scenarios: results,
    }, null, 2) + '\n');
} else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(pad('scenario', 50), pad('iters', 10), pad('mean µs', 12), 'ops/s');
    for (const r of results) {
        console.log(pad(r.name, 50), pad(r.iters, 10), pad(r.meanUs.toFixed(2), 12), r.opsPerSec.toFixed(0));
    }
    /* 输出最慢 3 个场景的标记 */
    const slowest = [...results].sort((a, b) => b.meanUs - a.meanUs).slice(0, 3);
    console.log('\n  最慢 3 场景（候选优化目标）：');
    for (const r of slowest) console.log(`  - ${r.name}: ${r.meanUs.toFixed(2)} µs`);
}
process.exit(0);
