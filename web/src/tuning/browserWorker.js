/**
 * 浏览器端 Web Worker 包装 spawnEvaluation,与 Node evalWorker.js 协议一致。
 *
 * 主线程通过 new Worker(new URL('./browserWorker.js', import.meta.url), {type:'module'}) 启动
 * 这个 worker 会:
 *   1. 一次性加载 spawnEvaluation 引擎
 *   2. 收到 'eval' 消息后运行评估
 *   3. 返回 sample 给主线程
 *
 * 关键: 浏览器 Worker 没有 require, 必须用 ESM import; Vite 在 dev/build 都支持。
 */

import { runSpawnEvaluation } from '../bot/spawnEvaluation.js';
import { computeObjective } from './objective.js';
import { buildSampleRecord } from './sampleStore.js';
import { contextToEvalParams } from './contextSpace.js';

function aggregateRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const fields = [
        'noMoveRate', 'clearsMean', 'multiClearRate', 'fallbackRate',
        'firstMoveFreedomMean', 'clearIntervalP90', 'nearPbRate', 'breakPbRate',
        'overshootRate', 'scoreMean', 'scoreP90', 'evaluatedTripletsMean',
    ];
    const out = {};
    for (const f of fields) {
        let sum = 0, count = 0;
        for (const row of rows) {
            const v = Number(row[f]);
            if (Number.isFinite(v)) { sum += v; count++; }
        }
        out[f] = count > 0 ? sum / count : null;
    }
    return out;
}

self.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    // === 模式 2: 数据采样 (固定算法跑多 seed) ===
    if (msg.type === 'fullEval') {
        const { taskId, config } = msg;
        try {
            const t0 = performance.now();
            const report = runSpawnEvaluation({
                seed: config.seed,
                sessions: config.sessions ?? 30,
                maxSteps: config.maxSteps ?? 120,
                maxEvaluatedTriplets: config.maxEvaluatedTriplets ?? 80,
                bestScore: config.bestScore ?? 1000,
                strategies: config.strategies ?? ['normal'],
                policies: config.policies ?? ['random', 'clear-greedy', 'survival'],
                spawnGenerators: config.spawnGenerators ?? ['baseline'],
                modelConfig: config.modelConfig ?? {},
            });
            const evalMs = performance.now() - t0;
            self.postMessage({
                type: 'fullEvalResult', taskId, ok: true,
                report: {
                    seed: config.seed,
                    evalMs,
                    generatedAt: report.generatedAt,
                    rows: report.rows,
                    comparisons: report.comparisons,
                    insights: report.insights,
                },
            });
        } catch (e) {
            self.postMessage({ type: 'fullEvalResult', taskId, ok: false, error: e?.message || String(e) });
        }
        return;
    }

    // === 模式 1: LHS 寻参 (原逻辑) ===
    if (msg.type !== 'eval') return;
    const { task, taskId, runId, samplesConfig = {} } = msg;
    try {
        const { context, theta, seed } = task;
        const evalParams = contextToEvalParams(context);
        const modelConfig = {
            personalizationStrength: theta.personalizationStrength,
            temperature: theta.temperature,
            surpriseBudgetGain: theta.surpriseBudgetGain,
            surpriseCooldown: theta.surpriseCooldown,
        };

        const t0 = performance.now();
        const report = runSpawnEvaluation({
            seed,
            sessions: samplesConfig.sessions ?? 30,
            maxSteps: samplesConfig.maxSteps ?? 120,
            maxEvaluatedTriplets: theta.maxEvaluatedTriplets,
            bestScore: evalParams.bestScore,
            strategies: [evalParams.strategy],
            policies: samplesConfig.policies ?? ['random', 'clear-greedy', 'survival'],
            spawnGenerators: [evalParams.spawnGenerator],
            modelConfig,
        });
        const evalMs = performance.now() - t0;

        const aggregated = aggregateRows(report.rows);
        if (!aggregated) throw new Error('no rows from evaluation');

        const subs = computeObjective(aggregated, {
            difficulty: context.difficulty,
            generator: context.generator,
            bestScore: context.bestScore_bin,
            lifecycle: context.lifecycle_stage,
        }, { fairness: 1, excitement: 1, antiInflation: 1 });

        const sample = buildSampleRecord({
            runId: runId || 1,
            context, theta, seed,
            row: aggregated,
            subscores: {
                fairness: subs.fairness,
                excitement: subs.excitement,
                antiInflation: subs.antiInflation,
            },
            evalMs,
            phase: 'lhs',
        });

        self.postMessage({ type: 'result', taskId, ok: true, sample, evalMs });
    } catch (e) {
        self.postMessage({ type: 'result', taskId, ok: false, error: e?.message || String(e) });
    }
});

// 启动 ready 通知
self.postMessage({ type: 'ready' });
