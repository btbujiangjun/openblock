#!/usr/bin/env node
/* global process, console */
/**
 * Spawn Auto-Tuning v0.3 — Phase 1 MVP CLI 入口
 *
 * 完整闭环:
 *   1. 解析参数 → 构造 context 列表 + LHS 任务
 *   2. 启动 N workers,并行评估
 *   3. 写入 SQLite (HybridSampleStore)
 *   4. 输出汇总: 每 context 的最优 θ (按 composite score)
 *
 * 用法:
 *   node scripts/spawn-tune-v2.mjs              # 默认配置: 1K samples MVP
 *   node scripts/spawn-tune-v2.mjs --full       # 全 120 ctx × 97 θ × 3 seed ≈ 35K (Phase A 完整)
 *   node scripts/spawn-tune-v2.mjs --contexts normal:budget-p2  # 仅指定 ctx 筛选
 *   node scripts/spawn-tune-v2.mjs --workers 8 --sessions 30 --max-steps 120
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { enumerateAllContexts, validateContext } from '../web/src/tuning/contextSpace.js';
import * as paramSpace from '../web/src/tuning/paramSpace.js';
import { buildPhaseATasks } from '../web/src/tuning/lhsSampler.js';
import { HybridSampleStore, SqliteSampleStore } from '../web/src/tuning/sampleStore.js';
import { runMasterParallel } from '../web/src/tuning/masterWorker.js';
import { computeObjective } from '../web/src/tuning/objective.js';

// ── CLI 参数解析 ────────────────────────────────────────────────────────

function parseArgs(argv) {
    const opts = {
        workers: 4,
        runId: Date.now(),
        sessions: 30,
        maxSteps: 120,
        thetasPerContext: 10,
        seedsPerTheta: 3,
        contextFilter: null,
        full: false,
        dbPath: '.cursor-stress-logs/spawn-tuning.sqlite',
        out: null,
        weights: { fairness: 70, excitement: 45, antiInflation: 60 },
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === '--workers') { opts.workers = Number(next); i++; }
        else if (arg === '--sessions') { opts.sessions = Number(next); i++; }
        else if (arg === '--max-steps') { opts.maxSteps = Number(next); i++; }
        else if (arg === '--thetas') { opts.thetasPerContext = Number(next); i++; }
        else if (arg === '--seeds') { opts.seedsPerTheta = Number(next); i++; }
        else if (arg === '--run-id') { opts.runId = Number(next); i++; }
        else if (arg === '--contexts') { opts.contextFilter = String(next); i++; }
        else if (arg === '--db') { opts.dbPath = String(next); i++; }
        else if (arg === '--out') { opts.out = String(next); i++; }
        else if (arg === '--full') { opts.full = true; opts.thetasPerContext = 97; }
        else if (arg === '--w-fairness') { opts.weights.fairness = Number(next); i++; }
        else if (arg === '--w-excitement') { opts.weights.excitement = Number(next); i++; }
        else if (arg === '--w-anti-inflation') { opts.weights.antiInflation = Number(next); i++; }
        else if (arg === '--help' || arg === '-h') { opts.help = true; }
    }
    return opts;
}

function usage() {
    return `
spawn-tune-v2 — Auto-Tuning Phase 1 MVP CLI

用法:
  node scripts/spawn-tune-v2.mjs [options]

选项:
  --workers N           并行 worker 数 (默认 4, 推荐 ≤ CPU 核数 / 2)
  --sessions N          每样本评估的 session 数 (默认 30)
  --max-steps N         单 session 最大步数 (默认 120)
  --thetas N            每 context 内的 LHS theta 数 (默认 10)
  --seeds N             每 theta 重复评估的 seed 数 (默认 3)
  --run-id ID           寻参任务 ID (默认 timestamp)
  --contexts FILTER     筛选 context: 'normal:budget-p2' 或 '*:budget-p2:1500:*'
  --db PATH             SQLite 输出路径 (默认 .cursor-stress-logs/spawn-tuning.sqlite)
  --out PATH            汇总 JSON 输出路径 (可选)
  --full                Phase A 完整规模 (120 ctx × 97 theta × 3 seed ≈ 35K)
  --w-fairness N        公平权重 (默认 70)
  --w-excitement N      爽点权重 (默认 45)
  --w-anti-inflation N  抑制膨胀权重 (默认 60)
  -h, --help            显示本帮助

示例:
  # MVP 验证: 1 context × 100 θ × 3 seed = 300 samples (约 8 分钟 @ 4 workers)
  node scripts/spawn-tune-v2.mjs --contexts 'normal:budget-p2:1500:growth' --thetas 100

  # 中等规模: 12 ctx × 10 θ × 3 seed = 360 samples
  node scripts/spawn-tune-v2.mjs --contexts '*:budget-p2:*:*'

  # 全量 Phase A (耗时 ~6 小时 @ 8 workers)
  node scripts/spawn-tune-v2.mjs --workers 8 --full
`.trim();
}

// ── Context 过滤器 (支持 wildcard) ──────────────────────────────────────

function matchContext(filter, ctx) {
    if (!filter) return true;
    const parts = filter.split(':');
    if (parts.length !== 4) {
        // 简短形式 'normal:budget-p2' 等价于 'normal:budget-p2:*:*'
        while (parts.length < 4) parts.push('*');
    }
    const [df, gf, bf, lf] = parts;
    if (df !== '*' && df !== ctx.difficulty) return false;
    if (gf !== '*' && gf !== ctx.generator) return false;
    if (bf !== '*' && Number(bf) !== ctx.bestScore_bin) return false;
    if (lf !== '*' && lf !== ctx.lifecycle_stage) return false;
    return true;
}

// ── 进度展示 (CLI 内嵌简易进度条) ───────────────────────────────────────

function fmtMs(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

function renderProgressBar(completed, total, width = 30) {
    const pct = total > 0 ? completed / total : 0;
    const filled = Math.round(pct * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${(pct * 100).toFixed(1)}%`;
}

// ── 主入口 ────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log(usage()); process.exit(0); }

    // 信号处理: Ctrl-C 时主动退出 (masterWorker 内部还有更精细的清理)
    // 这是 init/采样前阶段的兜底; masterWorker.runMasterParallel 启动后会接管。
    const _earlyExit = () => {
        console.error('\n[spawn-tune-v2] 收到中断,退出...');
        process.exit(130);
    };
    process.once('SIGINT', _earlyExit);
    process.once('SIGTERM', _earlyExit);

    console.log(`\nspawn-tune-v2 启动`);
    console.log(`  Run ID:   ${args.runId}`);
    console.log(`  Workers:  ${args.workers}`);
    console.log(`  Sessions: ${args.sessions} × max-steps ${args.maxSteps} × 3 bot`);
    console.log(`  Thetas/ctx: ${args.thetasPerContext}, Seeds/theta: ${args.seedsPerTheta}`);

    // 构造 context 列表
    const allCtxs = enumerateAllContexts();
    const ctxs = args.contextFilter
        ? allCtxs.filter((c) => matchContext(args.contextFilter, c))
        : allCtxs;
    if (ctxs.length === 0) {
        console.error(`错误: 过滤器 "${args.contextFilter}" 没匹配任何 context`);
        process.exit(1);
    }
    console.log(`  Context: ${ctxs.length} 个 (筛选: ${args.contextFilter || '全部 120'})`);

    // 校验
    for (const c of ctxs) {
        const r = validateContext(c);
        if (!r.ok) {
            console.error(`非法 context: ${JSON.stringify(c)} - ${r.error}`);
            process.exit(1);
        }
    }

    // 构造任务
    const tasks = buildPhaseATasks(ctxs, args.thetasPerContext, args.seedsPerTheta, paramSpace, args.runId);
    console.log(`  Tasks:    ${tasks.length} samples (${ctxs.length} ctx × ${args.thetasPerContext} θ × ${args.seedsPerTheta} seed)`);

    // 估算耗时 (基于 benchmark §5.7 实测)
    const samplesPerSec = args.workers * 1.5;  // 保守估算
    const etaSeconds = tasks.length / samplesPerSec;
    console.log(`  ETA:      ${fmtMs(etaSeconds * 1000)} (基于 ${args.workers} workers × 1.5 samples/s 估算)`);
    console.log('');

    // 准备 SQLite
    const dbAbsPath = resolve(process.cwd(), args.dbPath);
    if (!existsSync(dirname(dbAbsPath))) mkdirSync(dirname(dbAbsPath), { recursive: true });
    const db = new Database(dbAbsPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    const sqliteStore = new SqliteSampleStore(db);
    sqliteStore.ensureSchema();
    const store = new HybridSampleStore({ sqliteStore, flushBatchSize: 100 });
    store.startBackgroundFlush();

    // 调 runMasterParallel 前: 撤销早期 _earlyExit 处理器,
    // 让 masterWorker 内部更精细的 SIGINT 清理逻辑接管 (terminate worker_threads)
    process.off('SIGINT', _earlyExit);
    process.off('SIGTERM', _earlyExit);

    // 跑并行评估
    const result = await runMasterParallel({
        tasks,
        numWorkers: args.workers,
        runId: args.runId,
        sampleStore: store,
        samplesConfig: { sessions: args.sessions, maxSteps: args.maxSteps },
        onProgress: (p) => {
            const bar = renderProgressBar(p.completed, p.total);
            const eta = p.etaMs ? fmtMs(p.etaMs) : '-';
            process.stdout.write(
                `\r${bar} ${p.completed}/${p.total}  ` +
                `${p.samplesPerSec.toFixed(2)} sps  ETA ${eta}      `
            );
        },
        maxRetries: 1,
    });

    console.log('\n');
    await store.close();
    db.close();

    console.log(`✓ 完成: ${result.completedCount} 成功 / ${result.failedCount} 失败`);
    console.log(`  耗时: ${fmtMs(result.durationMs)}`);
    console.log(`  平均: ${(result.completedCount / (result.durationMs / 1000)).toFixed(2)} samples/s`);

    if (result.failedTasks.length > 0) {
        console.warn(`\n⚠ ${result.failedTasks.length} 个任务失败,前 5 个错误:`);
        for (const f of result.failedTasks.slice(0, 5)) {
            console.warn(`  taskId=${f.taskId}: ${f.error}`);
        }
    }

    // 汇总: 找每 context 内的最优 θ
    console.log(`\n=== 每 context 内最优 θ (按 composite, 权重 f=${args.weights.fairness} e=${args.weights.excitement} a=${args.weights.antiInflation}) ===`);
    const samplesByContext = store.sampleCountByContext();
    const topByContext = [];
    for (const [ctxKey, count] of samplesByContext) {
        if (count === 0) continue;
        const records = store.getByContext(ctxKey);
        let best = null;
        let bestScore = -Infinity;
        for (const rec of records) {
            const obj = computeObjective(
                {
                    noMoveRate: rec.noMoveRate,
                    clearsMean: rec.clearsMean,
                    multiClearRate: rec.multiClearRate,
                    fallbackRate: rec.fallbackRate,
                    firstMoveFreedomMean: rec.firstMoveFreedomMean,
                    clearIntervalP90: rec.clearIntervalP90,
                    overshootRate: rec.overshootRate,
                    breakPbRate: rec.breakPbRate,
                },
                {
                    difficulty: rec.difficulty,
                    generator: rec.generator,
                    bestScore: rec.bestScore_bin,
                    lifecycle: rec.lifecycle_stage,
                },
                args.weights
            );
            if (obj.composite > bestScore) {
                bestScore = obj.composite;
                best = { rec, composite: obj.composite, fairness: obj.fairness, excitement: obj.excitement, antiInflation: obj.antiInflation };
            }
        }
        if (best) {
            topByContext.push({
                contextKey: ctxKey,
                composite: best.composite,
                fairness: best.fairness,
                excitement: best.excitement,
                antiInflation: best.antiInflation,
                theta: JSON.parse(best.rec.theta_json),
                samples: count,
            });
        }
    }

    topByContext.sort((a, b) => b.composite - a.composite);
    console.log(`\nTop 5 contexts (composite 最高):`);
    for (const t of topByContext.slice(0, 5)) {
        console.log(`  ${t.contextKey.padEnd(40)} composite=${t.composite.toFixed(3)} `
            + `(f=${t.fairness.toFixed(2)} e=${t.excitement.toFixed(2)} a=${t.antiInflation.toFixed(2)}) `
            + `samples=${t.samples}`);
    }

    // 输出汇总 JSON
    if (args.out) {
        const outPath = resolve(process.cwd(), args.out);
        if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
        const fs = await import('node:fs/promises');
        await fs.writeFile(outPath, JSON.stringify({
            runId: args.runId,
            weights: args.weights,
            contextCount: ctxs.length,
            taskCount: tasks.length,
            completedCount: result.completedCount,
            failedCount: result.failedCount,
            durationMs: result.durationMs,
            topByContext,
        }, null, 2) + '\n', 'utf8');
        console.log(`\n汇总已写入: ${outPath}`);
    }

    console.log(`\nSQLite 数据库: ${dbAbsPath}`);
    console.log(`查询: sqlite3 "${dbAbsPath}" "SELECT * FROM spawn_tuning_samples_v2 WHERE run_id=${args.runId} LIMIT 10"`);
}

main().catch((e) => {
    console.error('\nspawn-tune-v2 失败:', e);
    process.exit(1);
});
