/**
 * Node worker_threads 评估 worker。
 *
 * 协议:
 *   master → worker: { type: 'eval', task: { context, theta, seed }, taskId }
 *   worker → master: { type: 'result', taskId, ok, sample } | { type: 'ready' } | { type: 'error', error }
 *
 * 用法 (master 端):
 *   import { Worker } from 'node:worker_threads';
 *   const w = new Worker(new URL('./web/src/tuning/evalWorker.js', import.meta.url));
 *   w.on('message', handle);
 *   w.postMessage({ type: 'eval', task: {...}, taskId: 1 });
 *
 * 设计:
 *   - 每个 worker 启动一次 Vite SSR (创建开销 ~3s),后续评估复用同一 server
 *   - 任务串行处理 (单 worker 内部),保证种子可控
 *   - 失败任务不重试,直接抛 'error' 给 master,由 master 决定是否重派
 */

import { parentPort, workerData } from 'node:worker_threads';
import { createServer } from 'vite';
import { computeObjective } from './objective.js';
import { buildSampleRecord } from './sampleStore.js';
import { contextToEvalParams } from './contextSpace.js';

if (!parentPort) {
    throw new Error('evalWorker must be run as a worker_thread, not as main script');
}

const { runId = 1, samplesConfig = {} } = workerData ?? {};
// 评估配置: 跑多少局/步/bot 才算一次"样本评估"
// 默认 30 局 × 120 步 × 3 bot × 1 generator = 90 games / sample
const EVAL_DEFAULTS = Object.freeze({
    sessions: samplesConfig.sessions ?? 30,
    maxSteps: samplesConfig.maxSteps ?? 120,
    policies: samplesConfig.policies ?? ['random', 'clear-greedy', 'survival'],
});

let _viteServer = null;
let _runSpawnEvaluation = null;

/**
 * 懒加载 Vite SSR + spawnEvaluation 模块 (worker 启动时一次性).
 */
async function ensureModuleLoaded() {
    if (_runSpawnEvaluation) return;
    _viteServer = await createServer({
        configFile: false,
        root: process.cwd(),
        appType: 'custom',
        server: { middlewareMode: true },
    });
    const mod = await _viteServer.ssrLoadModule('/web/src/bot/spawnEvaluation.js');
    _runSpawnEvaluation = mod.runSpawnEvaluation;
    parentPort.postMessage({ type: 'ready' });
}

/**
 * 把 spawnEvaluation 返回的 rows 平均合并为单一 row。
 * 因为我们要寻参的是 "context + theta" 的整体表现,把 3 个 bot 的指标取均值。
 */
function aggregateRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const fields = [
        'noMoveRate', 'clearsMean', 'multiClearRate', 'fallbackRate',
        'firstMoveFreedomMean', 'clearIntervalP90', 'nearPbRate', 'breakPbRate',
        'overshootRate', 'scoreMean', 'scoreP90', 'evaluatedTripletsMean',
    ];
    const out = {};
    for (const f of fields) {
        let sum = 0;
        let count = 0;
        for (const row of rows) {
            const v = Number(row[f]);
            if (Number.isFinite(v)) { sum += v; count++; }
        }
        out[f] = count > 0 ? sum / count : null;
    }
    return out;
}

/**
 * 执行单个评估任务。
 *
 * @param {{context, theta, seed}} task
 * @returns {Promise<{sample: object, evalMs: number}>}
 */
async function runEvalTask(task) {
    if (!_runSpawnEvaluation) await ensureModuleLoaded();
    const { context, theta, seed } = task;

    const evalParams = contextToEvalParams(context);
    const modelConfig = {
        personalizationStrength: theta.personalizationStrength,
        temperature: theta.temperature,
        surpriseBudgetGain: theta.surpriseBudgetGain,
        surpriseCooldown: theta.surpriseCooldown,
    };

    const t0 = performance.now();
    const report = _runSpawnEvaluation({
        seed,
        sessions: EVAL_DEFAULTS.sessions,
        maxSteps: EVAL_DEFAULTS.maxSteps,
        maxEvaluatedTriplets: theta.maxEvaluatedTriplets,
        bestScore: evalParams.bestScore,
        strategies: [evalParams.strategy],
        policies: EVAL_DEFAULTS.policies,
        spawnGenerators: [evalParams.spawnGenerator],
        modelConfig,
    });
    const evalMs = performance.now() - t0;

    const aggregated = aggregateRows(report.rows);
    if (!aggregated) throw new Error('evaluation produced no rows');

    const subscores = computeObjective(aggregated, {
        difficulty: context.difficulty,
        generator: context.generator,
        bestScore: context.bestScore_bin,
        lifecycle: context.lifecycle_stage,
    }, { fairness: 1, excitement: 1, antiInflation: 1 });  // 等权计算原始子分数

    const sample = buildSampleRecord({
        runId,
        context,
        theta,
        seed,
        row: aggregated,
        subscores: {
            fairness: subscores.fairness,
            excitement: subscores.excitement,
            antiInflation: subscores.antiInflation,
        },
        evalMs,
        phase: 'lhs',
    });

    return { sample, evalMs };
}

// 兜底: worker 收到 SIGTERM/SIGINT 时主动关闭 Vite SSR 后退出
// (parentPort.shutdown message 是主路径,SIGTERM 是 master 异常时的保险)
const _gracefulExit = async () => {
    try { if (_viteServer) await _viteServer.close(); } catch {}
    process.exit(0);
};
process.on('SIGTERM', _gracefulExit);
process.on('SIGINT', _gracefulExit);

parentPort.on('message', async (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'eval') {
        try {
            const result = await runEvalTask(msg.task);
            parentPort.postMessage({
                type: 'result',
                taskId: msg.taskId,
                ok: true,
                sample: result.sample,
                evalMs: result.evalMs,
            });
        } catch (error) {
            parentPort.postMessage({
                type: 'result',
                taskId: msg.taskId,
                ok: false,
                error: error?.message || String(error),
            });
        }
    } else if (msg.type === 'shutdown') {
        if (_viteServer) await _viteServer.close().catch(() => {});
        process.exit(0);
    }
});

// 启动时立即加载 Vite SSR (异步,不阻塞 message listener 挂载)
ensureModuleLoaded().catch((error) => {
    parentPort.postMessage({ type: 'error', error: error?.message || String(error) });
    process.exit(1);
});
