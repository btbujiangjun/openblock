/**
 * Spawn Auto-Tuning Web UI - Phase 1 MVP
 *
 * 浏览器端跑寻参 (用 Web Workers 替代 Node worker_threads)。
 *
 * 与 CLI 版的区别:
 *   - 用 Web Worker 而非 node:worker_threads (浏览器没有后者)
 *   - 样本只存 InMemorySampleStore (没有 SQLite,关闭浏览器即丢)
 *   - 用 spawnEval.worker.js 替代独立 evalWorker (已有的 Web Worker 实现)
 *
 * 推荐用法: 浏览器跑 MVP (~500 samples 看可行性),正式产 SQLite 数据用 CLI。
 */

import { enumerateAllContexts, makeContextKey, parseContextKey } from './tuning/contextSpace.js';
import * as paramSpace from './tuning/paramSpace.js';
import { buildPhaseATasks } from './tuning/lhsSampler.js';
import { InMemorySampleStore, buildSampleRecord } from './tuning/sampleStore.js';
import { computeObjective } from './tuning/objective.js';
import { runSpawnEvaluation } from './bot/spawnEvaluation.js';
import { contextToEvalParams } from './tuning/contextSpace.js';

/**
 * 浏览器 Worker 池 — 用 numWorkers 个 Web Worker 并行跑评估。
 *
 * 不支持 Worker (老浏览器 / file://) 时回退到主线程串行。
 */
function isWorkerSupported() {
    return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

async function runWithWorkerPool(tasks, config, onProgress, onCancel) {
    if (!isWorkerSupported()) {
        // Fallback: 主线程串行
        return runOnMainThread(tasks, config, onProgress, onCancel);
    }

    const numWorkers = Math.max(1, Math.min(8, config.numWorkers || 4));
    const workers = [];
    const sampleStore = new InMemorySampleStore();
    const t0 = performance.now();
    let completed = 0;
    let failed = 0;
    let queueIdx = 0;
    let lastProgressEmit = 0;

    // 启动 worker 池
    for (let i = 0; i < numWorkers; i++) {
        try {
            const w = new Worker(new URL('./tuning/browserWorker.js', import.meta.url), { type: 'module' });
            await new Promise((resolve, reject) => {
                const onReady = (e) => {
                    if (e.data?.type === 'ready') {
                        w.removeEventListener('message', onReady);
                        resolve();
                    }
                };
                w.addEventListener('message', onReady);
                w.addEventListener('error', reject, { once: true });
                setTimeout(() => reject(new Error('worker timeout')), 8000);
            });
            workers.push({ w, busy: false });
        } catch (e) {
            console.warn(`[tuning] failed to start worker ${i}:`, e);
        }
    }

    if (workers.length === 0) {
        return runOnMainThread(tasks, config, onProgress, onCancel);
    }

    return new Promise((resolve) => {
        function tryDispatch(slot) {
            if (onCancel.cancelled) return false;
            if (queueIdx >= tasks.length) return false;
            const task = tasks[queueIdx];
            const taskId = queueIdx;
            queueIdx++;
            slot.busy = true;
            slot._taskId = taskId;
            slot.w.postMessage({
                type: 'eval',
                taskId,
                task,
                runId: config.runId || Date.now(),
                samplesConfig: { sessions: config.sessions, maxSteps: config.maxSteps },
            });
            return true;
        }

        function onComplete() {
            if (completed + failed >= tasks.length || onCancel.cancelled) {
                const durationMs = performance.now() - t0;
                workers.forEach((s) => { try { s.w.terminate(); } catch {} });
                resolve({ store: sampleStore, completed, failed, durationMs });
                return true;
            }
            return false;
        }

        workers.forEach((slot) => {
            slot.w.addEventListener('message', (e) => {
                const msg = e.data;
                if (msg?.type !== 'result') return;
                slot.busy = false;
                if (msg.ok) {
                    sampleStore.append(msg.sample);
                    completed++;
                } else {
                    failed++;
                }
                const now = performance.now();
                if (now - lastProgressEmit > 200 || completed + failed >= tasks.length) {
                    lastProgressEmit = now;
                    const elapsed = now - t0;
                    const sps = (completed / elapsed) * 1000;
                    onProgress({
                        completed, failed, total: tasks.length,
                        elapsedMs: elapsed,
                        samplesPerSec: sps,
                        etaMs: sps > 0 ? (tasks.length - completed) / sps * 1000 : null,
                        store: sampleStore,
                    });
                }
                if (onComplete()) return;
                tryDispatch(slot);
            });
            slot.w.addEventListener('error', (e) => {
                console.error('[tuning] worker error:', e);
                slot.busy = false;
                failed++;
                if (onComplete()) return;
                tryDispatch(slot);
            });
        });

        // 启动第一轮分派
        workers.forEach((slot) => tryDispatch(slot));
    });
}

async function runOnMainThread(tasks, config, onProgress, onCancel) {
    const store = new InMemorySampleStore();
    const t0 = performance.now();
    let completed = 0, failed = 0;
    for (let i = 0; i < tasks.length; i++) {
        if (onCancel.cancelled) break;
        try {
            const sample = await runOneSample(config.runId || Date.now(), tasks[i], config);
            store.append(sample);
            completed++;
        } catch (e) {
            failed++;
        }
        const elapsed = performance.now() - t0;
        const sps = (completed / elapsed) * 1000;
        onProgress({
            completed, failed, total: tasks.length,
            elapsedMs: elapsed,
            samplesPerSec: sps,
            etaMs: sps > 0 ? (tasks.length - completed) / sps * 1000 : null,
            store,
        });
        await new Promise((r) => setTimeout(r, 0));  // 让 UI 响应
    }
    return { store, completed, failed, durationMs: performance.now() - t0 };
}

const $ = (id) => document.getElementById(id);

let _currentRun = null;
let _store = null;
let _cancelled = false;

// ── 工具 ───────────────────────────────────────────────────────────────

function log(msg, cls = '') {
    const panel = $('log-panel');
    if (!panel) return;
    const line = document.createElement('div');
    line.className = `log-line ${cls}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${msg}`;
    panel.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
}

function fmtMs(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

function matchContext(filter, ctx) {
    if (!filter || filter === '*' || filter === '') return true;
    const parts = filter.split(':');
    while (parts.length < 4) parts.push('*');
    const [df, gf, bf, lf] = parts;
    if (df !== '*' && df !== ctx.difficulty) return false;
    if (gf !== '*' && gf !== ctx.generator) return false;
    if (bf !== '*' && Number(bf) !== ctx.bestScore_bin) return false;
    if (lf !== '*' && lf !== ctx.lifecycle_stage) return false;
    return true;
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 配置读取 ────────────────────────────────────────────────────────────

function readConfig() {
    return {
        ctxFilter: $('ctx-filter').value.trim(),
        thetasPerCtx: Math.max(2, Math.min(200, Number($('thetas-per-ctx').value) || 10)),
        seedsPerTheta: Math.max(1, Math.min(10, Number($('seeds-per-theta').value) || 3)),
        numWorkers: Math.max(1, Math.min(16, Number($('num-workers').value) || 4)),
        sessions: Math.max(5, Math.min(100, Number($('sessions').value) || 30)),
        maxSteps: Math.max(30, Math.min(500, Number($('max-steps').value) || 120)),
        weights: {
            fairness: Number($('w-f').value) || 70,
            excitement: Number($('w-e').value) || 45,
            antiInflation: Number($('w-a').value) || 60,
        },
    };
}

// ── 评估单个样本 (浏览器主线程同步跑,不阻塞太久就行) ─────────────────

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

async function runOneSample(runId, task, config) {
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
        sessions: config.sessions,
        maxSteps: config.maxSteps,
        maxEvaluatedTriplets: theta.maxEvaluatedTriplets,
        bestScore: evalParams.bestScore,
        strategies: [evalParams.strategy],
        policies: ['random', 'clear-greedy', 'survival'],
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

    return buildSampleRecord({
        runId,
        context, theta, seed,
        row: aggregated,
        subscores: { fairness: subs.fairness, excitement: subs.excitement, antiInflation: subs.antiInflation },
        evalMs,
        phase: 'lhs',
    });
}

// ── Canvas 实时子分数分布 ───────────────────────────────────────────────

function drawSubscoresCanvas(samples) {
    const canvas = $('subscore-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const padL = 30, padR = 10, padT = 14, padB = 24;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    ctx.clearRect(0, 0, w, h);
    // 背景
    ctx.fillStyle = 'rgba(2, 6, 23, 0.6)';
    ctx.fillRect(0, 0, w, h);

    // Y 轴 0/0.5/1 参考线
    ctx.strokeStyle = 'rgba(55, 65, 81, 0.6)';
    ctx.lineWidth = 0.5;
    for (const y of [0, 0.5, 1]) {
        const py = padT + (1 - y) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, py); ctx.lineTo(w - padR, py); ctx.stroke();
        ctx.fillStyle = '#9ca3af';
        ctx.font = '10px ui-monospace';
        ctx.fillText(y.toFixed(1), 6, py + 3);
    }

    if (samples.length === 0) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '12px sans-serif';
        ctx.fillText('等待样本…', w / 2 - 30, h / 2);
        return;
    }

    const n = samples.length;
    const xStep = plotW / Math.max(1, n - 1);

    const drawSeries = (key, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        samples.forEach((s, i) => {
            const x = padL + i * xStep;
            const v = Math.max(0, Math.min(1, s[`${key}_score`] ?? 0));
            const y = padT + (1 - v) * plotH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    };

    drawSeries('fairness', '#60a5fa');
    drawSeries('excitement', '#34d399');
    drawSeries('antiInflation', '#fb923c');

    // 图例
    ctx.font = '11px sans-serif';
    const legend = [
        ['⚖️ fairness', '#60a5fa', padL + 6],
        ['🎉 excitement', '#34d399', padL + 110],
        ['🛑 antiInflation', '#fb923c', padL + 230],
    ];
    for (const [label, color, x] of legend) {
        ctx.fillStyle = color;
        ctx.fillText(label, x, padT - 2);
    }
}

// ── 结果排行渲染 ───────────────────────────────────────────────────────

function renderResults(store, weights) {
    const tbody = $('results-tbody');
    if (!tbody) return;

    const topByCtx = [];
    for (const [ctxKey, records] of store.byContextKey) {
        let best = null, bestScore = -Infinity;
        for (const rec of records) {
            const obj = computeObjective(
                {
                    noMoveRate: rec.noMoveRate, clearsMean: rec.clearsMean,
                    multiClearRate: rec.multiClearRate, fallbackRate: rec.fallbackRate,
                    firstMoveFreedomMean: rec.firstMoveFreedomMean,
                    clearIntervalP90: rec.clearIntervalP90,
                    overshootRate: rec.overshootRate, breakPbRate: rec.breakPbRate,
                },
                {
                    difficulty: rec.difficulty, generator: rec.generator,
                    bestScore: rec.bestScore_bin, lifecycle: rec.lifecycle_stage,
                },
                weights
            );
            if (obj.composite > bestScore) {
                bestScore = obj.composite;
                best = { rec, ...obj };
            }
        }
        if (best) topByCtx.push({ ctxKey, ...best, samples: records.length });
    }
    topByCtx.sort((a, b) => b.composite - a.composite);

    tbody.innerHTML = topByCtx.slice(0, 20).map((t, i) => `
        <tr>
            <td>#${i + 1}</td>
            <td><code>${escapeHtml(t.ctxKey)}</code></td>
            <td class="composite">${t.composite.toFixed(3)}</td>
            <td>${t.fairness.toFixed(2)}</td>
            <td>${t.excitement.toFixed(2)}</td>
            <td>${t.antiInflation.toFixed(2)}</td>
            <td>${t.samples}</td>
        </tr>
    `).join('');

    $('results-section').hidden = topByCtx.length === 0;
}

// ── 主流程 ─────────────────────────────────────────────────────────────

function estimateBudget() {
    const cfg = readConfig();
    const allCtxs = enumerateAllContexts();
    const ctxs = allCtxs.filter((c) => matchContext(cfg.ctxFilter, c));

    if (ctxs.length === 0) {
        $('estimate').textContent = `⚠ 过滤器 "${cfg.ctxFilter}" 没匹配任何 context`;
        $('estimate').className = '';
        return;
    }

    const totalTasks = ctxs.length * cfg.thetasPerCtx * cfg.seedsPerTheta;
    // 浏览器 Web Worker 池估算: ~0.5 sps/worker × numWorkers (经验值,sessions=30, maxSteps=120)
    const browserSps = isWorkerSupported() ? 0.5 * cfg.numWorkers : 0.4;
    const etaSeconds = totalTasks / browserSps;

    $('estimate').innerHTML = `
        预计 <b>${ctxs.length}</b> contexts × <b>${cfg.thetasPerCtx}</b> θ × <b>${cfg.seedsPerTheta}</b> seed
        = <b>${totalTasks}</b> samples,
        约 <b>${fmtMs(etaSeconds * 1000)}</b> (浏览器单线程估算)
        ${totalTasks > 500 ? '<br>⚠ 浏览器跑大于 500 样本会很慢,建议用 CLI <code>node scripts/spawn-tune-v2.mjs</code>' : ''}
    `;
    $('estimate').className = '';
}

async function startTuning() {
    const cfg = readConfig();
    const allCtxs = enumerateAllContexts();
    const ctxs = allCtxs.filter((c) => matchContext(cfg.ctxFilter, c));

    if (ctxs.length === 0) {
        log(`过滤器 "${cfg.ctxFilter}" 没匹配任何 context`, 'error');
        return;
    }

    const runId = Date.now();
    const tasks = buildPhaseATasks(ctxs, cfg.thetasPerCtx, cfg.seedsPerTheta, paramSpace, runId);
    const workerMode = isWorkerSupported() ? `Web Worker × ${cfg.numWorkers || 4}` : '主线程 (fallback)';
    log(`启动 runId=${runId} (${workerMode}): ${ctxs.length} ctx × ${cfg.thetasPerCtx} θ × ${cfg.seedsPerTheta} seed = ${tasks.length} samples`, 'info');

    _cancelled = false;
    _currentRun = { runId, total: tasks.length, t0: performance.now() };
    const onCancel = { cancelled: false };
    Object.defineProperty(onCancel, 'cancelled', {
        get: () => _cancelled,
    });

    $('start-btn').disabled = true;
    $('cancel-btn').disabled = false;
    $('progress-section').hidden = false;
    $('ps-total').textContent = String(tasks.length);

    const updateProgress = (p) => {
        const pct = (p.completed + p.failed) / p.total;
        $('progress-bar').style.width = `${(pct * 100).toFixed(1)}%`;
        $('ps-completed').textContent = String(p.completed);
        $('ps-failed').textContent = String(p.failed);
        $('ps-sps').textContent = p.samplesPerSec.toFixed(2);
        $('ps-eta').textContent = p.etaMs ? fmtMs(p.etaMs) : '-';
        // 每 ~5 个样本刷新 canvas
        if (p.store && (p.completed % 5 === 0 || p.completed === p.total)) {
            drawSubscoresCanvas(p.store.all());
            renderResults(p.store, cfg.weights);
        }
    };

    const result = await runWithWorkerPool(tasks, { ...cfg, runId }, updateProgress, onCancel);
    _store = result.store;

    log(`完成 ${result.completed}/${tasks.length} (${result.failed} 失败) · ${fmtMs(result.durationMs)}`, 'ok');

    drawSubscoresCanvas(_store.all());
    renderResults(_store, cfg.weights);

    $('start-btn').disabled = false;
    $('cancel-btn').disabled = true;
    _currentRun = null;
}

function cancelTuning() {
    if (_currentRun) {
        _cancelled = true;
        log('正在停止…', 'info');
    }
}

// ── 初始化 ─────────────────────────────────────────────────────────────

function bindEvents() {
    $('estimate-btn')?.addEventListener('click', estimateBudget);
    $('start-btn')?.addEventListener('click', () => {
        startTuning().catch((e) => log(`致命错误: ${e.message || e}`, 'error'));
    });
    $('cancel-btn')?.addEventListener('click', cancelTuning);
    // 权重滑块
    for (const id of ['w-f', 'w-e', 'w-a']) {
        const el = $(id);
        const pct = $(`${id}-pct`);
        if (el && pct) {
            const update = () => { pct.textContent = el.value; };
            el.addEventListener('input', update);
            update();
        }
    }
    // 配置变化时重新估算
    for (const id of ['ctx-filter', 'thetas-per-ctx', 'seeds-per-theta', 'sessions', 'max-steps']) {
        $(id)?.addEventListener('change', () => {
            if ($('estimate').textContent && !$('estimate').className.includes('empty')) {
                estimateBudget();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    drawSubscoresCanvas([]);
    log('页面就绪,等待配置后点「开始寻参」', 'info');
});
