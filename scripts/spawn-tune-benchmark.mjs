#!/usr/bin/env node
/* global process, console */
/**
 * Phase C 基础设施基线测量 - 在动手实施 Phase A MVP 前测真实数字。
 *
 * 测 3 件事:
 *   1. 单 evaluation 吞吐 (games/s) - 不同 sessions/maxSteps 组合
 *   2. SQLite 写入吞吐 (rows/s) - 批量 insert 模拟样本回写
 *   3. 并行扩展性 (Node worker_threads) - 1/2/4/8 workers 加速比
 *
 * 不依赖任何 Phase A 代码,可独立运行。
 * 用法: node scripts/spawn-tune-benchmark.mjs [--quick]
 *   --quick  仅测最小规模 (CI 验证)
 *   默认: 完整测量,约 3-5 分钟
 */

import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createServer } from 'vite';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');

function fmt(n, digits = 1) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
    return n.toFixed(digits);
}

function fmtMs(ms) {
    if (ms < 1000) return `${fmt(ms, 0)} ms`;
    return `${fmt(ms / 1000, 2)} s`;
}

// === 1. 单 evaluation 吞吐 =====================================================

async function benchSingleEval() {
    console.log('\n=== Bench 1: 单 evaluation 吞吐 ===');
    const server = await createServer({
        configFile: false,
        root: process.cwd(),
        appType: 'custom',
        server: { middlewareMode: true },
    });

    try {
        const mod = await server.ssrLoadModule('/web/src/bot/spawnEvaluation.js');
        const { runSpawnEvaluation } = mod;

        const configs = QUICK
            ? [
                { sessions: 5, maxSteps: 60, generators: ['budget-p2'], policies: ['random', 'survival'] },
            ]
            : [
                // 最小: 5 局 × 60 步 × 2 bot
                { sessions: 5, maxSteps: 60, generators: ['budget-p2'], policies: ['random', 'survival'] },
                // 标准 spawn-eval 默认: 30 局 × 240 步 × 3 bot
                { sessions: 30, maxSteps: 240, generators: ['budget-p2'], policies: ['random', 'clear-greedy', 'survival'] },
                // 短局长 bot: 寻参 Phase A 期望规模
                { sessions: 30, maxSteps: 120, generators: ['budget-p2'], policies: ['random', 'clear-greedy', 'survival'] },
                // 含 P1 + P2 多生成器
                { sessions: 30, maxSteps: 120, generators: ['triplet-p1', 'budget-p2'], policies: ['random', 'clear-greedy', 'survival'] },
            ];

        const results = [];
        for (const cfg of configs) {
            const t0 = performance.now();
            const report = runSpawnEvaluation({
                seed: 7,
                sessions: cfg.sessions,
                maxSteps: cfg.maxSteps,
                maxEvaluatedTriplets: 64,
                bestScore: 1500,
                strategies: ['normal'],
                policies: cfg.policies,
                spawnGenerators: cfg.generators,
            });
            const elapsed = performance.now() - t0;
            const totalGames = cfg.sessions * cfg.policies.length * cfg.generators.length;
            const gamesPerSec = (totalGames / elapsed) * 1000;
            const rowsProduced = report.rows.length;

            results.push({
                cfg,
                elapsed_ms: elapsed,
                totalGames,
                gamesPerSec,
                rowsProduced,
            });

            console.log(
                `  [${cfg.sessions}×${cfg.maxSteps}×${cfg.policies.length}bot×${cfg.generators.length}gen] `
                + `${totalGames} games in ${fmtMs(elapsed)} = ${fmt(gamesPerSec)} games/s`
                + ` (产出 ${rowsProduced} 行)`
            );
        }
        return results;
    } finally {
        await server.close();
    }
}

// === 2. SQLite 批量写入吞吐 ====================================================

function benchSqliteWrite() {
    console.log('\n=== Bench 2: SQLite 批量写入吞吐 ===');
    const dbPath = join(tmpdir(), `spawn_tune_bench_${Date.now()}.sqlite`);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    db.exec(`
        CREATE TABLE samples_v2 (
            sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            context_key TEXT NOT NULL,
            theta_json TEXT NOT NULL,
            seed INTEGER NOT NULL,
            noMoveRate REAL, clearsMean REAL, multiClearRate REAL,
            fallbackRate REAL, firstMoveFreedomMean REAL,
            clearIntervalP90 REAL, nearPbRate REAL, breakPbRate REAL,
            overshootRate REAL, scoreMean REAL, scoreP90 REAL,
            evaluatedTripletsMean REAL,
            fairness_score REAL, excitement_score REAL, antiInflation_score REAL,
            eval_ms INTEGER, evaluated_at INTEGER, sample_phase TEXT
        );
        CREATE INDEX idx_run_ctx ON samples_v2(run_id, context_key);
    `);

    const insertStmt = db.prepare(`
        INSERT INTO samples_v2 (
            run_id, context_key, theta_json, seed,
            noMoveRate, clearsMean, multiClearRate, fallbackRate,
            firstMoveFreedomMean, clearIntervalP90, nearPbRate, breakPbRate,
            overshootRate, scoreMean, scoreP90, evaluatedTripletsMean,
            fairness_score, excitement_score, antiInflation_score,
            eval_ms, evaluated_at, sample_phase
        ) VALUES (
            @run_id, @context_key, @theta_json, @seed,
            @noMoveRate, @clearsMean, @multiClearRate, @fallbackRate,
            @firstMoveFreedomMean, @clearIntervalP90, @nearPbRate, @breakPbRate,
            @overshootRate, @scoreMean, @scoreP90, @evaluatedTripletsMean,
            @fairness_score, @excitement_score, @antiInflation_score,
            @eval_ms, @evaluated_at, @sample_phase
        )
    `);

    const mkSample = (i) => ({
        run_id: 1,
        context_key: `normal:budget-p2:${[500, 1500, 4000, 10000, 25000][i % 5]}:growth`,
        theta_json: JSON.stringify({ personalization: 0.1, temperature: 0.04, surpriseGain: 0.08 }),
        seed: i,
        noMoveRate: Math.random() * 0.2,
        clearsMean: 15 + Math.random() * 20,
        multiClearRate: Math.random() * 0.4,
        fallbackRate: Math.random() * 0.05,
        firstMoveFreedomMean: 4 + Math.random() * 8,
        clearIntervalP90: 3 + Math.random() * 10,
        nearPbRate: Math.random() * 0.5,
        breakPbRate: Math.random() * 0.2,
        overshootRate: Math.random() * 0.2,
        scoreMean: 500 + Math.random() * 2000,
        scoreP90: 800 + Math.random() * 3000,
        evaluatedTripletsMean: 32 + Math.random() * 64,
        fairness_score: 0.5 + Math.random() * 0.4,
        excitement_score: 0.4 + Math.random() * 0.4,
        antiInflation_score: 0.3 + Math.random() * 0.5,
        eval_ms: 80 + Math.floor(Math.random() * 50),
        evaluated_at: Date.now(),
        sample_phase: 'lhs',
    });

    const insertMany = db.transaction((samples) => {
        for (const s of samples) insertStmt.run(s);
    });

    const sizes = QUICK ? [1000] : [1000, 10000, 50000];
    const results = [];

    for (const n of sizes) {
        const batchSamples = Array.from({ length: n }, (_, i) => mkSample(i));
        const t0 = performance.now();
        insertMany(batchSamples);
        const elapsed = performance.now() - t0;
        const rowsPerSec = (n / elapsed) * 1000;
        results.push({ rows: n, elapsed_ms: elapsed, rowsPerSec });
        console.log(`  ${n.toLocaleString()} rows in ${fmtMs(elapsed)} = ${fmt(rowsPerSec, 0)} rows/s`);
    }

    // 读基准: select with where 索引命中
    const t0 = performance.now();
    const rows = db.prepare('SELECT COUNT(*) as cnt FROM samples_v2 WHERE run_id = 1').get();
    const readMs = performance.now() - t0;
    console.log(`  索引读取 ${rows.cnt.toLocaleString()} 行: ${fmtMs(readMs)}`);

    db.close();
    rmSync(dbPath, { force: true });
    return results;
}

// === 3. 并行扩展性 ============================================================

async function benchParallelScaling() {
    console.log('\n=== Bench 3: 并行扩展 (Node worker_threads) ===');
    const workerCounts = QUICK ? [1, 2] : [1, 2, 4, 8];
    const samplesPerRun = QUICK ? 10 : 30;

    // 单 worker 基线
    const baseline = await runWithWorkers(1, samplesPerRun);
    console.log(`  baseline 1 worker:  ${samplesPerRun} samples in ${fmtMs(baseline.elapsed_ms)} `
        + `= ${fmt(baseline.samplesPerSec, 2)} samples/s`);

    const results = [{ workers: 1, ...baseline, speedup: 1 }];
    for (const n of workerCounts.slice(1)) {
        const r = await runWithWorkers(n, samplesPerRun);
        const speedup = baseline.elapsed_ms / r.elapsed_ms;
        results.push({ workers: n, ...r, speedup });
        console.log(`  ${n} workers parallel: ${samplesPerRun} samples in ${fmtMs(r.elapsed_ms)} `
            + `= ${fmt(r.samplesPerSec, 2)} samples/s (speedup ${fmt(speedup, 2)}×)`);
    }
    return results;
}

async function runWithWorkers(numWorkers, totalSamples) {
    const tasksPerWorker = Math.ceil(totalSamples / numWorkers);
    const workerScript = `
        import { parentPort, workerData } from 'node:worker_threads';
        import { createServer } from 'vite';
        const server = await createServer({
            configFile: false,
            root: workerData.cwd,
            appType: 'custom',
            server: { middlewareMode: true },
        });
        try {
            const mod = await server.ssrLoadModule('/web/src/bot/spawnEvaluation.js');
            const { runSpawnEvaluation } = mod;
            for (let i = 0; i < workerData.tasks; i++) {
                runSpawnEvaluation({
                    seed: workerData.seedBase + i,
                    sessions: 5, maxSteps: 60,
                    maxEvaluatedTriplets: 64,
                    bestScore: 1500,
                    strategies: ['normal'],
                    policies: ['random', 'survival'],
                    spawnGenerators: ['budget-p2'],
                });
                parentPort.postMessage({ done: i + 1 });
            }
        } finally { await server.close(); }
    `;

    const t0 = performance.now();
    const workers = [];
    for (let w = 0; w < numWorkers; w++) {
        const worker = new Worker(workerScript, {
            eval: true,
            execArgv: ['--no-warnings'],
            workerData: {
                cwd: process.cwd(),
                tasks: tasksPerWorker,
                seedBase: w * 1000,
            },
        });
        workers.push(new Promise((resolve, reject) => {
            worker.on('message', () => {});
            worker.on('error', reject);
            worker.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker exit ${code}`)));
        }));
    }
    await Promise.all(workers);
    const elapsed = performance.now() - t0;
    const totalDone = tasksPerWorker * numWorkers;
    return {
        elapsed_ms: elapsed,
        completedSamples: totalDone,
        samplesPerSec: (totalDone / elapsed) * 1000,
    };
}

// === 4. 报告 =================================================================

function printSummary({ singleEval, sqlite, parallel }) {
    console.log('\n=== 基线汇总 (用于 Phase A 设计预算) ===\n');

    // 选标准配置的吞吐
    const stdConfig = singleEval.find((r) => r.cfg.sessions === 30 && r.cfg.maxSteps === 120 && r.cfg.generators.length === 1)
                   || singleEval[singleEval.length - 1];
    console.log(`单 evaluation (30 局 × 120 步): ${fmt(stdConfig.gamesPerSec, 1)} games/s`);
    console.log(`  单样本耗时: ${fmtMs(stdConfig.elapsed_ms)} (${stdConfig.totalGames} games / sample)`);

    // SQLite
    const largeWrite = sqlite[sqlite.length - 1];
    console.log(`SQLite 批量写入: ${fmt(largeWrite.rowsPerSec, 0)} rows/s (${largeWrite.rows.toLocaleString()} rows)`);

    // 并行加速比
    if (parallel.length > 1) {
        const best = parallel[parallel.length - 1];
        console.log(`${best.workers} workers 并行加速比: ${fmt(best.speedup, 2)}× (理想 ${best.workers}×)`);
    }

    // 推算 100K 样本耗时
    const samplesPerSec = parallel.length > 1
        ? parallel[parallel.length - 1].samplesPerSec
        : (1 / (stdConfig.elapsed_ms / 1000));
    const projected100K = 100000 / samplesPerSec;
    console.log(`\n[推算] 100K 样本预算 (按 5 局 × 60 步 / sample):`);
    console.log(`  最快 ${parallel.length > 1 ? parallel[parallel.length - 1].workers : 1} workers: ~${fmtMs(projected100K * 1000)}`);
}

// === main ====================================================================

(async () => {
    console.log(`\nSpawn Tune Benchmark ${QUICK ? '(QUICK MODE)' : '(FULL MODE)'}`);
    console.log(`平台: ${process.platform} ${process.arch}, Node ${process.version}, CPUs: ${(await import('node:os')).cpus().length}`);

    const singleEval = await benchSingleEval();
    const sqlite = benchSqliteWrite();
    const parallel = await benchParallelScaling();

    printSummary({ singleEval, sqlite, parallel });

    console.log('\n✓ benchmark 完成。把结果同步到 docs/algorithms/SPAWN_AUTO_TUNING.md §5.6');
})().catch((e) => {
    console.error('benchmark 失败:', e);
    process.exit(1);
});
