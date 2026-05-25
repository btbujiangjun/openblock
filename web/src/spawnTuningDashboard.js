/**
 * 寻参看板 (Dashboard) 主逻辑。
 *
 * 4 个 tab:
 *   ① 总览       - 当前激活策略 + 历史 run 列表
 *   ② 任务进度   - 选 run 看实时样本数 + 子分数分布
 *   ③ 指标趋势   - 选 run 看每 context 最优 θ + 调权重重排
 *   ④ 部署效果   - 当前部署 vs Default 对比 + 本地解析诊断
 *
 * 所有数据从 /api/spawn-tuning/v2/* 拉取。
 */

import { getApiBaseUrl } from './config.js';
import { runSpawnEvaluation } from './bot/spawnEvaluation.js';
import {
    DEFAULT_THETA,
    installPolicies,
    uninstallPolicies,
    loadPoliciesFromServer,
} from './tuning/clientPolicy.js';
import { flushNow as flushFieldMetrics, getMetricsStats as getFieldMetricsStats } from './tuning/policyMetrics.js';
import { renderPbCurveMini } from './tuning/pbCurveMini.js';
import { computeObjective } from './tuning/objective.js';
import { contextToEvalParams, enumerateAllContexts, makeContextKey } from './tuning/contextSpace.js';
import * as paramSpace from './tuning/paramSpace.js';
import { buildPhaseATasks } from './tuning/lhsSampler.js';
import { InMemorySampleStore, buildSampleRecord } from './tuning/sampleStore.js';

const $ = (id) => document.getElementById(id);
const API_BASE = getApiBaseUrl().replace(/\/+$/, '');

// ── 工具函数 ─────────────────────────────────────────────────────

function fmt(n, digits = 2) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
    return n.toFixed(digits);
}
function fmtPct(n, digits = 1) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
    return (n * 100).toFixed(digits) + '%';
}
function fmtMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '-';
    if (ms < 1000) return Math.round(ms) + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    if (ms < 3600000) return (ms / 60000).toFixed(1) + 'm';
    return (ms / 3600000).toFixed(2) + 'h';
}
function fmtDate(unix) {
    if (!unix) return '-';
    const d = new Date(unix * 1000);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
async function apiGet(path) {
    const r = await fetch(`${API_BASE}${path}`);
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
    return r.json();
}
async function apiPost(path, body, method = 'POST') {
    const r = await fetch(`${API_BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
    return r.json();
}

// ── Tab 切换 ────────────────────────────────────────────────────

function switchToTab(tabId) {
    // ① pipeline tab 与底层 dom id 不同名 — 显式映射
    const ALIAS = { pipeline: 'launch' };
    const targetId = ALIAS[tabId] || tabId;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${targetId}`));

    // 各 tab 的延迟初始化
    if (targetId === 'launch') initLaunchTab();
    else if (tabId === 'overview') refreshOverview();
    else if (tabId === 'deploy') {
        refreshDeployTab();
        refreshFieldTab();  // 原 field tab 内容已合并到 deploy
    } else if (tabId === 'history') {
        // 样本构建: Run 库 + 详情下拉
        initDataCenterTab();
        refreshDataLibrary();
        refreshRunSelect('run-select');
        refreshRunSelect('metrics-run-select');
    }
}

function setupTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => switchToTab(tab.dataset.tab));
    });
    // 场景导航卡片
    document.querySelectorAll('.scenario-card[data-goto]').forEach((card) => {
        card.addEventListener('click', () => switchToTab(card.dataset.goto));
    });
}

// ── Tab 0: 启动新任务 ─────────────────────────────────────────

let _launchState = { cancelled: false, store: null, running: false };

function isWorkerSupported() {
    return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

function logLaunch(msg, cls = '') {
    const panel = $('launch-log-panel');
    if (!panel) return;
    const line = document.createElement('div');
    line.style.cssText = cls === 'error' ? 'color:var(--bad)' : cls === 'ok' ? 'color:var(--good)' : cls === 'info' ? 'color:var(--accent)' : '';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    panel.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
}

function readLaunchConfig() {
    // bot policy 多选;空 (全没选) = fallback 到 3 个全跑 (= 原硬编码行为)
    const policiesSel = $('launch-policies');
    const policies = policiesSel
        ? Array.from(policiesSel.selectedOptions, (o) => o.value)
        : [];
    return {
        ctxFilter: $('launch-ctx-filter').value.trim(),
        thetasPerCtx: Math.max(2, Math.min(200, Number($('launch-thetas').value) || 10)),
        seedsPerTheta: Math.max(1, Math.min(10, Number($('launch-seeds').value) || 3)),
        numWorkers: Math.max(1, Math.min(16, Number($('launch-workers').value) || 4)),
        sessions: Math.max(5, Math.min(100, Number($('launch-sessions').value) || 30)),
        maxSteps: Math.max(30, Math.min(500, Number($('launch-maxsteps').value) || 120)),
        policies: policies.length > 0 ? policies : ['random', 'clear-greedy', 'survival'],
        weights: {
            fairness: Number($('launch-w-f').value) || 70,
            excitement: Number($('launch-w-e').value) || 45,
            antiInflation: Number($('launch-w-a').value) || 60,
        },
    };
}

function matchLaunchContext(filter, ctx) {
    if (!filter || filter === '*') return true;
    const parts = filter.split(':');
    while (parts.length < 4) parts.push('*');
    const [df, gf, bf, lf] = parts;
    // v0.3.11: 支持每段用逗号传多值, e.g. "easy,normal:*:1500,4000:*"
    const tokenMatch = (token, value, isNumber = false) => {
        if (!token || token === '*') return true;
        if (token === '__EMPTY__') return false;  // 该维度无任何勾选 → 0 个匹配
        const wanted = token.split(',').map((s) => s.trim()).filter(Boolean);
        if (wanted.length === 0) return true;
        const v = isNumber ? Number(value) : String(value);
        return wanted.some((w) => (isNumber ? Number(w) === v : w === v));
    };
    if (!tokenMatch(df, ctx.difficulty)) return false;
    if (!tokenMatch(gf, ctx.generator)) return false;
    if (!tokenMatch(bf, ctx.bestScore_bin, true)) return false;
    if (!tokenMatch(lf, ctx.lifecycle_stage)) return false;
    return true;
}

function estimateLaunchBudget() {
    const cfg = readLaunchConfig();
    const ctxs = enumerateAllContexts().filter((c) => matchLaunchContext(cfg.ctxFilter, c));
    if (ctxs.length === 0) {
        $('launch-estimate').textContent = `⚠ 过滤器 "${cfg.ctxFilter}" 没匹配任何 context`;
        return;
    }
    const total = ctxs.length * cfg.thetasPerCtx * cfg.seedsPerTheta;
    const browserSps = isWorkerSupported() ? 0.5 * cfg.numWorkers : 0.4;
    const eta = total / browserSps;
    $('launch-estimate').innerHTML = `预计 <b>${ctxs.length}</b> contexts × <b>${cfg.thetasPerCtx}</b> θ × <b>${cfg.seedsPerTheta}</b> seed = <b>${total}</b> samples, ~${fmtMs(eta * 1000)}${total > 500 ? '<br>⚠ 浏览器 >500 样本较慢, 建议 <code>npm run spawn:tune</code> CLI' : ''}`;
}

function aggregateRowsLaunch(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const fields = ['noMoveRate', 'clearsMean', 'multiClearRate', 'fallbackRate',
        'firstMoveFreedomMean', 'clearIntervalP90', 'nearPbRate', 'breakPbRate',
        'overshootRate', 'scoreMean', 'scoreP90', 'evaluatedTripletsMean'];
    const out = {};
    for (const f of fields) {
        let s = 0, c = 0;
        for (const r of rows) {
            const v = Number(r[f]);
            if (Number.isFinite(v)) { s += v; c++; }
        }
        out[f] = c > 0 ? s / c : null;
    }
    return out;
}

async function runOneSampleLaunch(runId, task, cfg) {
    const { context, theta, seed } = task;
    const evalParams = contextToEvalParams(context);
    const t0 = performance.now();
    const report = runSpawnEvaluation({
        seed,
        sessions: cfg.sessions, maxSteps: cfg.maxSteps,
        maxEvaluatedTriplets: theta.maxEvaluatedTriplets,
        bestScore: evalParams.bestScore,
        strategies: [evalParams.strategy],
        policies: cfg.policies || ['random', 'clear-greedy', 'survival'],
        spawnGenerators: [evalParams.spawnGenerator],
        modelConfig: {
            personalizationStrength: theta.personalizationStrength,
            temperature: theta.temperature,
            surpriseBudgetGain: theta.surpriseBudgetGain,
            surpriseCooldown: theta.surpriseCooldown,
        },
    });
    const evalMs = performance.now() - t0;
    const agg = aggregateRowsLaunch(report.rows);
    if (!agg) throw new Error('no rows');
    const subs = computeObjective(agg, {
        difficulty: context.difficulty, generator: context.generator,
        bestScore: context.bestScore_bin, lifecycle: context.lifecycle_stage,
    }, { fairness: 1, excitement: 1, antiInflation: 1 });
    return buildSampleRecord({
        runId, context, theta, seed, row: agg,
        subscores: { fairness: subs.fairness, excitement: subs.excitement, antiInflation: subs.antiInflation },
        evalMs, phase: 'lhs',
    });
}

async function runLaunchWithWorkerPool(tasks, cfg, onProgress, onCancel) {
    if (!isWorkerSupported()) return runLaunchMainThread(tasks, cfg, onProgress, onCancel);
    const numWorkers = cfg.numWorkers;
    const workers = [];
    const store = new InMemorySampleStore();
    const t0 = performance.now();
    let completed = 0, failed = 0, queueIdx = 0, lastProgressEmit = 0;

    for (let i = 0; i < numWorkers; i++) {
        try {
            const w = new Worker(new URL('./tuning/browserWorker.js', import.meta.url), { type: 'module' });
            await new Promise((res, rej) => {
                const onReady = (e) => { if (e.data?.type === 'ready') { w.removeEventListener('message', onReady); res(); } };
                w.addEventListener('message', onReady);
                w.addEventListener('error', rej, { once: true });
                setTimeout(() => rej(new Error('worker timeout')), 8000);
            });
            workers.push({ w, busy: false });
        } catch (e) { console.warn('worker fail', e); }
    }
    if (workers.length === 0) return runLaunchMainThread(tasks, cfg, onProgress, onCancel);

    return new Promise((resolve) => {
        const tryDispatch = (slot) => {
            if (onCancel.cancelled || queueIdx >= tasks.length) return false;
            const task = tasks[queueIdx++];
            slot.busy = true;
            slot.w.postMessage({
                type: 'eval', taskId: queueIdx,
                task, runId: cfg.runId,
                samplesConfig: { sessions: cfg.sessions, maxSteps: cfg.maxSteps },
            });
            return true;
        };
        const onComplete = () => {
            if (completed + failed >= tasks.length || onCancel.cancelled) {
                workers.forEach((s) => { try { s.w.terminate(); } catch {} });
                resolve({ store, completed, failed, durationMs: performance.now() - t0 });
                return true;
            }
            return false;
        };
        workers.forEach((slot) => {
            slot.w.addEventListener('message', (e) => {
                if (e.data?.type !== 'result') return;
                slot.busy = false;
                if (e.data.ok) { store.append(e.data.sample); completed++; } else { failed++; }
                const now = performance.now();
                if (now - lastProgressEmit > 200 || completed + failed >= tasks.length) {
                    lastProgressEmit = now;
                    const elapsed = now - t0;
                    const sps = (completed / elapsed) * 1000;
                    onProgress({ completed, failed, total: tasks.length, elapsedMs: elapsed,
                        samplesPerSec: sps, etaMs: sps > 0 ? (tasks.length - completed) / sps * 1000 : null,
                        store });
                }
                if (onComplete()) return;
                tryDispatch(slot);
            });
            slot.w.addEventListener('error', () => {
                slot.busy = false; failed++;
                if (onComplete()) return;
                tryDispatch(slot);
            });
        });
        workers.forEach((slot) => tryDispatch(slot));
    });
}

async function runLaunchMainThread(tasks, cfg, onProgress, onCancel) {
    const store = new InMemorySampleStore();
    const t0 = performance.now();
    let completed = 0, failed = 0;
    for (const task of tasks) {
        if (onCancel.cancelled) break;
        try {
            const sample = await runOneSampleLaunch(cfg.runId, task, cfg);
            store.append(sample); completed++;
        } catch { failed++; }
        const elapsed = performance.now() - t0;
        const sps = (completed / elapsed) * 1000;
        onProgress({ completed, failed, total: tasks.length, elapsedMs: elapsed,
            samplesPerSec: sps, etaMs: sps > 0 ? (tasks.length - completed) / sps * 1000 : null, store });
        await new Promise((r) => setTimeout(r, 0));
    }
    return { store, completed, failed, durationMs: performance.now() - t0 };
}

function drawLaunchSubscoresCanvas(samples) {
    const canvas = $('launch-subscore-canvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = 200;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const padL = 30, padR = 10, padT = 14, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(55, 65, 81, 0.6)';
    ctx.lineWidth = 0.5;
    for (const y of [0, 0.5, 1]) {
        const py = padT + (1 - y) * plotH;
        ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(W - padR, py); ctx.stroke();
        ctx.fillStyle = '#9ca3af'; ctx.font = '10px ui-monospace';
        ctx.fillText(y.toFixed(1), 6, py + 3);
    }
    if (samples.length === 0) {
        ctx.fillStyle = '#9ca3af'; ctx.font = '12px sans-serif';
        ctx.fillText('等待样本…', W / 2 - 30, H / 2);
        return;
    }
    const n = samples.length;
    const xStep = plotW / Math.max(1, n - 1);
    const drawSeries = (key, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
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
}

function renderLaunchResults(store, weights) {
    const tbody = $('launch-results-tbody');
    if (!tbody) return;
    const top = [];
    for (const [ctxKey, recs] of store.byContextKey) {
        let best = null, bestScore = -Infinity;
        for (const r of recs) {
            const obj = computeObjective(
                { noMoveRate: r.noMoveRate, clearsMean: r.clearsMean, multiClearRate: r.multiClearRate,
                  fallbackRate: r.fallbackRate, firstMoveFreedomMean: r.firstMoveFreedomMean,
                  clearIntervalP90: r.clearIntervalP90, overshootRate: r.overshootRate, breakPbRate: r.breakPbRate },
                { difficulty: r.difficulty, generator: r.generator,
                  bestScore: r.bestScore_bin, lifecycle: r.lifecycle_stage },
                weights
            );
            if (obj.composite > bestScore) { bestScore = obj.composite; best = { r, ...obj }; }
        }
        if (best) top.push({ ctxKey, ...best, samples: recs.length });
    }
    top.sort((a, b) => b.composite - a.composite);
    tbody.innerHTML = top.slice(0, 20).map((t, i) => `
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
    $('launch-results-section').hidden = top.length === 0;
}

// v0.3.12: 可传入 prebuiltCtxs (例如 chips 加权展开后的 ctx 数组),
//   否则按 cfg.ctxFilter 过滤 (与之前行为一致)
async function startLaunchTuning(prebuiltCtxs = null) {
    const cfg = readLaunchConfig();
    const ctxs = prebuiltCtxs
        ? prebuiltCtxs
        : enumerateAllContexts().filter((c) => matchLaunchContext(cfg.ctxFilter, c));
    if (ctxs.length === 0) {
        logLaunch(`过滤器 "${cfg.ctxFilter}" 没匹配任何 context`, 'error');
        return;
    }
    const runId = Date.now();
    cfg.runId = runId;
    const tasks = buildPhaseATasks(ctxs, cfg.thetasPerCtx, cfg.seedsPerTheta, paramSpace, runId);
    const mode = isWorkerSupported() ? `Web Worker × ${cfg.numWorkers}` : '主线程 (fallback)';
    logLaunch(`启动 runId=${runId} (${mode}): ${ctxs.length} ctx × ${cfg.thetasPerCtx} θ × ${cfg.seedsPerTheta} seed = ${tasks.length} samples`, 'info');

    _launchState = { cancelled: false, store: null, running: true };
    const onCancel = {};
    Object.defineProperty(onCancel, 'cancelled', { get: () => _launchState.cancelled });

    $('btn-launch-start').disabled = true;
    $('btn-launch-cancel').disabled = false;
    $('launch-progress-section').hidden = false;
    $('launch-ps-total').textContent = String(tasks.length);

    const updateProgress = (p) => {
        const pct = (p.completed + p.failed) / p.total;
        $('launch-progress-bar').style.width = `${(pct * 100).toFixed(1)}%`;
        $('launch-ps-completed').textContent = String(p.completed);
        $('launch-ps-failed').textContent = String(p.failed);
        $('launch-ps-sps').textContent = p.samplesPerSec.toFixed(2);
        $('launch-ps-eta').textContent = p.etaMs ? fmtMs(p.etaMs) : '-';
        if (p.store && (p.completed % 5 === 0 || p.completed === p.total)) {
            drawLaunchSubscoresCanvas(p.store.all());
            renderLaunchResults(p.store, cfg.weights);
        }
    };

    const result = await runLaunchWithWorkerPool(tasks, cfg, updateProgress, onCancel);
    _launchState.store = result.store;
    _launchState.running = false;

    logLaunch(`完成 ${result.completed}/${tasks.length} (${result.failed} 失败) · ${fmtMs(result.durationMs)}`, 'ok');
    drawLaunchSubscoresCanvas(result.store.all());
    renderLaunchResults(result.store, cfg.weights);

    $('btn-launch-start').disabled = false;
    $('btn-launch-cancel').disabled = true;
    _runListCache = null;  // 失效 run cache,让其他 tab 重新拉
    // 新 run 写入 SQLite 后, Phase B 下拉应该立刻能选到
    refreshTrainEligibleRuns().catch(() => {});
}

function cancelLaunchTuning() {
    if (_launchState.running) {
        _launchState.cancelled = true;
        logLaunch('正在停止…', 'info');
    }
}

// 注: v0.3.10 删除了"数据采样"模式 (与 LHS 寻参高度重叠)、固定 θ 采集、
//   JSON 导入/导出 (数据团队场景)、灰度切量诊断 (本机调试)。
//   只保留"训 NN"主干: LHS 采样 → Run 库管理 → 训 NN → 部署。

// ─────────────────────────────────────────────────────────────
// 样本构建 (Tab ②): 公共样本采集 + Run 库管理 + 详情分析
// ─────────────────────────────────────────────────────────────

let _dataCenterInited = false;

function initDataCenterTab() {
    if (_dataCenterInited) return;
    _dataCenterInited = true;

    // 跳转到 ③ 流水线
    $('dc-jump-pipeline')?.addEventListener('click', (e) => {
        e.preventDefault();
        switchToTab('pipeline');
    });

    // 库刷新
    $('dc-btn-refresh-library')?.addEventListener('click', refreshDataLibrary);
    $('dc-filter-status')?.addEventListener('change', refreshDataLibrary);
    $('dc-filter-min-samples')?.addEventListener('change', refreshDataLibrary);

    // LHS 采集: 预设 / 实时预估 / 实测耗时 / 启动
    $('dc-btn-lhs-start')?.addEventListener('click', startLhsFromDataCenter);
    $('dc-btn-lhs-estimate')?.addEventListener('click', measureLhsThroughput);
    document.querySelectorAll('.lhs-preset').forEach((b) => {
        b.addEventListener('click', () => applyLhsPreset(b.dataset.preset, b));
    });
    ['dc-lhs-thetas', 'dc-lhs-seeds', 'dc-lhs-workers', 'dc-lhs-sessions'].forEach((id) => {
        $(id)?.addEventListener('input', updateLhsEstimate);
    });

    // 5 维 chips — 单击切换 / Alt+单击 / 右键 设权重
    document.querySelectorAll('.chip-group .chip').forEach((c) => {
        c.addEventListener('click', (e) => {
            if (e.altKey || e.shiftKey) { editChipWeight(c); return; }
            c.classList.toggle('chip-on');
            syncChipsToCtxFilter();
        });
        c.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            editChipWeight(c);
        });
    });
    $('btn-dim-reset-all')?.addEventListener('click', () => {
        document.querySelectorAll('.chip-group .chip').forEach((c) => {
            c.classList.add('chip-on');
            c.dataset.weight = '1';
            c.querySelector('.chip-weight-badge')?.remove();
        });
        syncChipsToCtxFilter();
    });
    $('btn-dim-reset-weights')?.addEventListener('click', () => {
        document.querySelectorAll('.chip-group .chip').forEach((c) => {
            c.dataset.weight = '1';
            c.querySelector('.chip-weight-badge')?.remove();
        });
        syncChipsToCtxFilter();
    });
    syncChipsToCtxFilter();
}

// 编辑 chip 的采样权重 (1-9, 默认 1)
function editChipWeight(chip) {
    const cur = Number(chip.dataset.weight || 1);
    const dimLabel = chip.parentElement?.dataset.dim || '';
    const ans = prompt(
        `为「${chip.dataset.val}」(${dimLabel}) 设置采样权重\n\n` +
        `1 = 标准 (默认)\n` +
        `2-3 = 多采样 (×2 ~ ×3 倍频率)\n` +
        `4-9 = 重点强化\n\n` +
        `输入 1-9 的整数:`,
        String(cur),
    );
    if (ans === null) return;
    const w = Math.max(1, Math.min(9, Math.round(Number(ans) || 1)));
    chip.dataset.weight = String(w);
    chip.querySelector('.chip-weight-badge')?.remove();
    if (w > 1) {
        const b = document.createElement('span');
        b.className = 'chip-weight-badge';
        b.textContent = `×${w}`;
        chip.appendChild(b);
    }
    // 设权重时如果还没选中, 自动选上 (否则权重无效)
    if (w > 1) chip.classList.add('chip-on');
    syncChipsToCtxFilter();
}

// chips 选中态 → 写到 hidden dc-lhs-ctx (逗号多值语法) → 同步 chip 数量 + 触发预估
function readChipsSelection() {
    const out = {};
    document.querySelectorAll('.chip-group').forEach((g) => {
        out[g.dataset.dim] = [...g.querySelectorAll('.chip.chip-on')].map((b) => b.dataset.val);
    });
    return out;
}

// 读 chips 的权重 {dim: {val: weight}} — 未勾选的 chip weight = 0
function readChipWeights() {
    const out = {};
    document.querySelectorAll('.chip-group').forEach((g) => {
        const dim = g.dataset.dim;
        out[dim] = {};
        g.querySelectorAll('.chip').forEach((c) => {
            const w = c.classList.contains('chip-on') ? Number(c.dataset.weight || 1) : 0;
            out[dim][c.dataset.val] = w;
        });
    });
    return out;
}

// 把 ctxs 列表按 chip 权重展开 (高权重 ctx 出现多次, 实现加权采样)
function expandWeightedCtxs(ctxs, weights) {
    const out = [];
    for (const c of ctxs) {
        const w = (weights.difficulty?.[c.difficulty] || 0)
                * (weights.generator?.[c.generator] || 0)
                * (weights.bestScore?.[String(c.bestScore_bin)] || 0)
                * (weights.lifecycle?.[c.lifecycle_stage] || 0);
        for (let i = 0; i < w; i++) out.push(c);
    }
    return out;
}

const ALL_DIM_VALUES = {
    difficulty: ['easy', 'normal', 'hard'],
    generator: ['triplet-p1', 'budget-p2'],
    bestScore: ['500', '1500', '4000', '10000', '25000'],
    lifecycle: ['onboarding', 'growth', 'mature', 'plateau'],
    policy: ['random', 'clear-greedy', 'survival'],
};

function syncChipsToCtxFilter() {
    const sel = readChipsSelection();
    // 每维度 -> 字符串段:
    //   全选 / 默认 → '*'
    //   1+ 选 (非全) → 逗号拼接
    //   0 选 → '__EMPTY__' (会让 matchLaunchContext 0 命中, 启动按钮禁用)
    const segOf = (dim) => {
        const got = sel[dim] || [];
        const all = ALL_DIM_VALUES[dim];
        if (got.length === all.length) return '*';
        if (got.length === 0) return '__EMPTY__';
        return got.join(',');
    };
    const ctxFilter = `${segOf('difficulty')}:${segOf('generator')}:${segOf('bestScore')}:${segOf('lifecycle')}`;
    const ctxEl = $('dc-lhs-ctx');
    if (ctxEl) ctxEl.value = ctxFilter;

    // 更新每维度选中数
    for (const dim of Object.keys(ALL_DIM_VALUES)) {
        const c = document.querySelector(`[data-count-for="${dim}"]`);
        if (c) {
            c.textContent = `${(sel[dim] || []).length}/${ALL_DIM_VALUES[dim].length}`;
        }
    }
    // 更新 "场景数 = a × b × c × d = N"
    const counts = ['difficulty', 'generator', 'bestScore', 'lifecycle'].map((d) => (sel[d] || []).length);
    const total = counts.reduce((a, b) => a * b, 1);
    const elMul = $('dim-multiply');
    if (elMul) {
        elMul.textContent = `${counts.join(' × ')} = ${total}`;
        elMul.style.color = total === 0 ? 'var(--bad)' : 'var(--accent)';
    }

    // 更新 "加权后场景数" (chips 权重 ×1 时与原 total 相同;否则更大)
    const weights = readChipWeights();
    try {
        const baseCtxs = enumerateAllContexts().filter((c) => matchLaunchContext(ctxFilter, c));
        const weighted = expandWeightedCtxs(baseCtxs, weights);
        const elW = $('dim-weighted');
        if (elW) {
            elW.textContent = `${weighted.length}`;
            elW.style.color = weighted.length > total ? 'var(--warn)' : 'var(--muted)';
        }
    } catch {}
    updateLhsEstimate();
}

async function refreshDataLibrary() {
    const tbody = $('dc-library-tbody');
    const countEl = $('dc-library-count');
    if (!tbody) return;
    const filter = $('dc-filter-status')?.value || 'all';
    const minSamples = Number($('dc-filter-min-samples')?.value || 0);

    try {
        // 同时拉: torch/eligible-runs (有 has_been_trained 标记) + runs (有 name/note 元数据)
        const [eligible, meta] = await Promise.all([
            apiGet(`/api/spawn-tuning/v2/torch/eligible-runs?min_samples=${Math.max(0, minSamples)}`),
            apiGet('/api/spawn-tuning/v2/runs?limit=200'),
        ]);
        const metaByRun = new Map();
        for (const m of (meta.runs || [])) metaByRun.set(m.run_id, m);

        let rows = eligible.runs || [];
        if (filter === 'trained') rows = rows.filter((r) => r.has_been_trained);
        else if (filter === 'untrained') rows = rows.filter((r) => !r.has_been_trained);
        else if (filter === 'full') rows = rows.filter((r) => r.context_count >= 120);

        if (countEl) countEl.textContent = String(rows.length);
        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="muted-hint">无匹配的 run · 调整过滤或先去 E.1 采集</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((r) => {
            const m = metaByRun.get(r.run_id) || {};
            const name = m.name || '';
            const note = m.note || '';
            const tag = (name || note) ? `${escapeHtml(name)}${name && note ? ' · ' : ''}${escapeHtml(note)}` : '';
            const date = r.last_sample_at ? new Date(r.last_sample_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
            const trainedFlag = r.has_been_trained
                ? '<span class="status completed">✓ 训过</span>'
                : '<span class="status" style="background:rgba(156,163,175,0.18); color:var(--muted);">○ 未训</span>';
            return `
              <tr data-run="${r.run_id}">
                <td><code>${r.run_id}</code></td>
                <td>
                  <input class="dc-tag-edit" data-run="${r.run_id}" data-field="combined"
                         value="${tag.replace(/"/g, '&quot;')}" placeholder="(双击编辑标签)" readonly>
                </td>
                <td><code>${r.sample_count}</code></td>
                <td>${r.context_count >= 120 ? '全集 (120)' : r.context_count}</td>
                <td>${r.unique_thetas}</td>
                <td>${trainedFlag}</td>
                <td style="white-space:nowrap;">${date}</td>
                <td class="dc-row-actions" style="white-space:nowrap;">
                  <button class="ghost" data-act="detail" data-run="${r.run_id}">详情</button>
                  <button class="ghost" data-act="train" data-run="${r.run_id}">训 NN</button>
                  <button class="danger" data-act="delete" data-run="${r.run_id}">删</button>
                </td>
              </tr>
            `;
        }).join('');

        // 行内事件
        tbody.querySelectorAll('.dc-tag-edit').forEach((inp) => {
            inp.addEventListener('dblclick', () => { inp.readOnly = false; inp.focus(); inp.select(); });
            inp.addEventListener('blur', () => { if (!inp.readOnly) { inp.readOnly = true; saveRunTag(Number(inp.dataset.run), inp.value); } });
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.readOnly = true; inp.blur(); } });
        });
        tbody.querySelectorAll('button[data-act]').forEach((b) => {
            b.addEventListener('click', () => handleLibraryAction(b.dataset.act, Number(b.dataset.run)));
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="muted-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}

async function saveRunTag(runId, combined) {
    // 用户输的标签 "name · note" 拆开
    const parts = combined.split('·').map((s) => s.trim());
    const name = parts[0] || '';
    const note = parts.slice(1).join(' · ') || '';
    try {
        await apiPost(`/api/spawn-tuning/v2/runs/${runId}/note`, { name, note }, 'PATCH');
    } catch (e) {
        alert('保存标签失败: ' + e.message);
    }
}

async function handleLibraryAction(act, runId) {
    if (act === 'detail') {
        // 把 E.3 的 run-select 设到这个 run + 滚到详情区
        const sel1 = $('run-select');
        const sel2 = $('metrics-run-select');
        for (const s of [sel1, sel2]) {
            if (!s) continue;
            if (![...s.options].some((o) => Number(o.value) === runId)) {
                const o = document.createElement('option');
                o.value = String(runId);
                o.textContent = String(runId);
                s.appendChild(o);
            }
            s.value = String(runId);
        }
        await refreshRunDetail();
        await loadMetricsForRun();
        $('dc-detail-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (act === 'train') {
        // 跳到 ③ 流水线 Step B,把 run_id 选上
        switchToTab('pipeline');
        setTimeout(() => {
            const sel = $('torch-train-run-id');
            if (sel) {
                if (![...sel.options].some((o) => Number(o.value) === runId)) {
                    const o = document.createElement('option');
                    o.value = String(runId);
                    o.textContent = String(runId);
                    sel.appendChild(o);
                }
                sel.value = String(runId);
                $('torch-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 200);
    } else if (act === 'delete') {
        if (!confirm(`确认删除 run_id=${runId} ?\n这会删除所有样本 + 关联 policies (不可恢复)`)) return;
        try {
            let r = await fetch(`${API_BASE}/api/spawn-tuning/v2/runs/${runId}`, { method: 'DELETE' });
            if (r.status === 409) {
                if (!confirm('该 run 有 active policy 在线上,强制删会回滚到默认。继续?')) return;
                r = await fetch(`${API_BASE}/api/spawn-tuning/v2/runs/${runId}?force=1`, { method: 'DELETE' });
            }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            await refreshDataLibrary();
            refreshTrainEligibleRuns().catch(() => {});
        } catch (e) {
            alert('删除失败: ' + e.message);
        }
    }
}

// LHS 单样本耗时基线 (ms/sample · 1 worker · 30 sessions) — 用户点"实测耗时"会刷新
let _lhsMsPerSample = 1500;

const LHS_PRESETS = {
    smoke: { ctx: 'normal:budget-p2:1500:growth', thetas: 5,  seeds: 1, workers: 4, sessions: 10, label: '🔥 烟雾测试' },
    debug: { ctx: 'normal:*:*:*',                  thetas: 10, seeds: 2, workers: 4, sessions: 30, label: '🐞 日常调试' },
    prod:  { ctx: '*',                             thetas: 30, seeds: 2, workers: 4, sessions: 30, label: '🏭 生产训练' },
    hi:    { ctx: '*',                             thetas: 50, seeds: 3, workers: 6, sessions: 60, label: '💎 高精度' },
};

function applyLhsPreset(presetKey, clickedBtn) {
    const p = LHS_PRESETS[presetKey];
    if (!p) return;
    $('dc-lhs-thetas').value = String(p.thetas);
    $('dc-lhs-seeds').value = String(p.seeds);
    $('dc-lhs-workers').value = String(p.workers);
    $('dc-lhs-sessions').value = String(p.sessions);
    // 把预设 ctx 字符串还原成 chips 勾选状态 (默认全选→全 chip-on)
    const parts = (p.ctx || '*').split(':');
    while (parts.length < 4) parts.push('*');
    const dimByIdx = ['difficulty', 'generator', 'bestScore', 'lifecycle'];
    dimByIdx.forEach((dim, i) => {
        const seg = parts[i];
        const wanted = (seg === '*' || !seg) ? ALL_DIM_VALUES[dim] : seg.split(',').map((s) => s.trim());
        document.querySelectorAll(`.chip-group[data-dim="${dim}"] .chip`).forEach((c) => {
            c.classList.toggle('chip-on', wanted.includes(c.dataset.val));
        });
    });
    // bot policies 预设默认全选
    document.querySelectorAll(`.chip-group[data-dim="policy"] .chip`).forEach((c) => c.classList.add('chip-on'));
    syncChipsToCtxFilter();
    document.querySelectorAll('.lhs-preset').forEach((b) => b.classList.toggle('dc-build-active', b === clickedBtn));
    $('dc-lhs-active-preset').textContent = `(已应用: ${p.label})`;
}

function updateLhsEstimate() {
    const ctxFilter = $('dc-lhs-ctx')?.value?.trim() || '*';
    const thetas = Math.max(1, Number($('dc-lhs-thetas')?.value || 0));
    const seeds = Math.max(1, Number($('dc-lhs-seeds')?.value || 0));
    const workers = Math.max(1, Number($('dc-lhs-workers')?.value || 1));
    const sessions = Math.max(1, Number($('dc-lhs-sessions')?.value || 0));

    // 加权场景数 (含每 chip 的 weight 倍乘)
    let weightedCtxCount = 0;
    try {
        const base = enumerateAllContexts().filter((c) => matchLaunchContext(ctxFilter, c));
        const w = readChipWeights();
        weightedCtxCount = expandWeightedCtxs(base, w).length;
    } catch { weightedCtxCount = 0; }

    const total = weightedCtxCount * thetas * seeds;
    const perSampleMs = (sessions / 30) * _lhsMsPerSample;
    const totalMs = (total * perSampleMs) / Math.max(1, workers);

    const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    setText('dc-lhs-est-ctx',   `${weightedCtxCount} 场景(加权)`);
    setText('dc-lhs-est-theta', `${thetas} 参数组`);
    setText('dc-lhs-est-seed',  `${seeds} 重复`);
    setText('dc-lhs-est-total', total > 0 ? `${total.toLocaleString()} 样本` : '— (场景 0)');
    setText('dc-lhs-est-per',   `${(perSampleMs / 1000).toFixed(1)}s`);
    setText('dc-lhs-est-eta',   weightedCtxCount > 0 ? fmtMs(totalMs) : '—');

    // 启动按钮的禁用状态
    const startBtn = $('dc-btn-lhs-start');
    const botSelected = document.querySelectorAll('.chip-group[data-dim="policy"] .chip.chip-on').length;
    if (startBtn) {
        startBtn.disabled = weightedCtxCount === 0 || botSelected === 0;
        startBtn.title = weightedCtxCount === 0
            ? '至少每个场景维度选 1 个'
            : (botSelected === 0 ? '至少勾选 1 个 Bot 模拟' : '');
    }
}

// 实测耗时: 用 1 worker 跑 5 个样本,得到真实的 ms/sample 校准 _lhsMsPerSample
async function measureLhsThroughput() {
    const btn = $('dc-btn-lhs-estimate');
    const hint = $('dc-lhs-hint');
    if (btn) btn.disabled = true;
    if (hint) hint.textContent = '测速中 (跑 5 样本)…';
    try {
        const { runSpawnEvaluation } = await import('./bot/spawnEvaluation.js');
        const sessions = Math.max(5, Number($('dc-lhs-sessions')?.value || 30));
        const t0 = performance.now();
        const N = 5;
        for (let i = 0; i < N; i++) {
            runSpawnEvaluation({
                seed: Date.now() + i,
                sessions, maxSteps: 120,
                bestScore: 1000,
                strategies: ['normal'],
                policies: ['random', 'clear-greedy', 'survival'],
                spawnGenerators: ['budget-p2'],
            });
        }
        const ms = (performance.now() - t0) / N;
        // 校准到 30 sessions 基线
        _lhsMsPerSample = Math.round((30 / sessions) * ms);
        if (hint) hint.innerHTML = `<span style="color:var(--good)">✓ 测得 ${(ms / 1000).toFixed(2)}s/样本 (sessions=${sessions}, 单线程) · 已校准预估</span>`;
        updateLhsEstimate();
    } catch (e) {
        if (hint) hint.innerHTML = `<span style="color:var(--bad)">测速失败: ${escapeHtml(e.message)}</span>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}

// 构建方式 1: 从数据中心快捷启动 LHS — 复用 ③ Step A 的执行函数
async function startLhsFromDataCenter() {
    const ctxFilter = $('dc-lhs-ctx')?.value || '*';
    const thetas = Number($('dc-lhs-thetas')?.value || 10);
    const seeds  = Number($('dc-lhs-seeds')?.value  || 2);
    const chips = readChipsSelection();
    const policies = chips.policy || [];

    if (policies.length === 0) {
        alert('请至少勾选 1 个 Bot 模拟方法');
        return;
    }
    // 计算加权 ctxs
    const baseCtxs = enumerateAllContexts().filter((c) => matchLaunchContext(ctxFilter, c));
    if (baseCtxs.length === 0) {
        alert('当前场景维度选中数为 0, 至少要每个维度选 1 个');
        return;
    }
    const weightedCtxs = expandWeightedCtxs(baseCtxs, readChipWeights());
    if (weightedCtxs.length === 0) {
        alert('加权后场景数为 0 (chip 权重全是 0?), 请检查');
        return;
    }
    const total = weightedCtxs.length * thetas * seeds;
    if (total > 5000) {
        const eta = $('dc-lhs-est-eta')?.textContent || '未知';
        const dups = weightedCtxs.length - baseCtxs.length;
        const weightedInfo = dups > 0 ? ` (含 ${dups} 个加权重复)` : '';
        if (!confirm(`大任务: ${total.toLocaleString()} 样本${weightedInfo} · 预计耗时 ${eta}\n确认启动?`)) return;
    }

    // 同步基础字段到 launch tab (供日志显示等)
    const ctxEl = $('launch-ctx-filter');
    if (ctxEl) ctxEl.value = ctxFilter;
    if ($('launch-thetas')) $('launch-thetas').value = String(thetas);
    if ($('launch-seeds'))  $('launch-seeds').value  = String(seeds);
    if ($('launch-workers')) $('launch-workers').value = $('dc-lhs-workers')?.value || '4';
    if ($('launch-sessions')) $('launch-sessions').value = $('dc-lhs-sessions')?.value || '30';
    const polSel = $('launch-policies');
    if (polSel) {
        [...polSel.options].forEach((o) => { o.selected = policies.includes(o.value); });
    }
    $('dc-lhs-hint').textContent = `已同步 (${weightedCtxs.length} 加权场景) → 启动中, 切到 ③ 流水线看实时进度…`;
    switchToTab('pipeline');
    setTimeout(() => {
        // 传 prebuiltCtxs = 加权后的 ctxs (不再依赖 ctxFilter)
        startLaunchTuning(weightedCtxs).then(() => {
            refreshDataLibrary().catch(() => {});
        }).catch((e) => alert('LHS 启动失败: ' + e.message));
    }, 200);
}


// ── PyTorch Phase B/C 训练 (后端: spawn_tuning_backend.py) ────────

let _torchPollTimer = null;
let _torchCurrentJobId = null;

async function refreshTrainEligibleRuns() {
    const sel = $('torch-train-run-id');
    if (!sel) return;
    const prevValue = sel.value;
    sel.innerHTML = '<option value="">— 加载中… —</option>';
    try {
        const data = await apiGet('/api/spawn-tuning/v2/torch/eligible-runs?min_samples=100');
        const runs = data.runs || [];
        if (runs.length === 0) {
            sel.innerHTML = '<option value="">— 无可训 run (先去 Tab ② LHS 寻参采样) —</option>';
            sel.disabled = true;
            return;
        }
        sel.disabled = false;
        sel.innerHTML = runs.map((r) => {
            const flag = r.has_been_trained ? '✓' : '○';
            const date = r.last_sample_at
                ? new Date(r.last_sample_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '';
            const ctxFlag = r.context_count >= 120 ? '全集' : `${r.context_count} ctx`;
            return `<option value="${r.run_id}" title="样本 ${r.sample_count} · ${r.context_count} contexts · ${r.unique_thetas} unique θ · 每 ctx 平均 ${r.samples_per_context} 样本${r.has_been_trained ? ' · 已训过' : ''}">${flag} ${r.run_id} · ${r.sample_count}样本 · ${ctxFlag} · ${date}</option>`;
        }).join('');
        // 优先选回原值,否则选第一个 (= 样本数最多 = 列表首位)
        if (prevValue && [...sel.options].some((o) => o.value === prevValue)) {
            sel.value = prevValue;
        } else {
            sel.value = String(runs[0].run_id);
        }
    } catch (e) {
        sel.innerHTML = `<option value="">— 加载失败: ${escapeHtml(e.message)} —</option>`;
        sel.disabled = true;
    }
}

async function refreshTorchStatus() {
    try {
        const data = await apiGet('/api/spawn-tuning/v2/torch/status');
        const card = $('torch-status-card');
        if (!card) return;
        if (!data.available) {
            card.innerHTML = `<div class="stat-card bad">
                <div class="stat-value">✗</div>
                <div class="stat-label">PyTorch 不可用: ${escapeHtml(data.reason || '')}</div>
            </div>`;
            return;
        }
        const device = data.cuda ? 'CUDA' : data.mps ? 'MPS' : 'CPU';
        card.innerHTML = `
            <div class="stat-card good"><div class="stat-value">${escapeHtml(data.torch_version || '')}</div><div class="stat-label">PyTorch 版本</div></div>
            <div class="stat-card"><div class="stat-value">${device}</div><div class="stat-label">加速设备</div></div>
            <div class="stat-card"><div class="stat-value">${data.checkpoints?.length || 0}</div><div class="stat-label">Checkpoints</div></div>
            <div class="stat-card ${data.active_jobs?.length > 0 ? 'good' : ''}"><div class="stat-value">${data.active_jobs?.length || 0}</div><div class="stat-label">运行中 Job</div></div>
        `;
        // 更新 checkpoint select
        const sel = $('torch-optimize-checkpoint');
        if (sel) {
            const curr = sel.value;
            const ptCkpts = (data.checkpoints || []).filter((c) => c.name.endsWith('.pt'));
            sel.innerHTML = '<option value="">— 选择 checkpoint —</option>' +
                ptCkpts.map((c) => `<option value="${escapeHtml(c.path)}">${escapeHtml(c.name)} (${(c.size_bytes / 1024).toFixed(0)} KB)</option>`).join('');
            if (curr && [...sel.options].some((o) => o.value === curr)) sel.value = curr;
        }
        // 渲染活跃 jobs
        renderTorchJobs(data.active_jobs || []);
    } catch (e) {
        const card = $('torch-status-card');
        if (card) card.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }
    refreshCheckpointsList();
}

function renderTorchJobs(jobs) {
    const host = $('torch-jobs-list');
    if (!host) return;
    if (jobs.length === 0) {
        host.innerHTML = '<p class="muted-hint">无运行中任务</p>';
        return;
    }
    host.innerHTML = jobs.map((j) => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:rgba(96,165,250,0.08); border-radius:6px; margin:4px 0;">
            <span class="status running">${escapeHtml(j.kind)}</span>
            <code style="flex:1;">${escapeHtml(j.job_id)}</code>
            <span class="muted-hint" style="padding:0;">${j.elapsed_s}s</span>
            <button data-job="${escapeHtml(j.job_id)}" class="ghost btn-torch-watch">查看日志</button>
        </div>
    `).join('');
    host.querySelectorAll('.btn-torch-watch').forEach((b) => {
        b.addEventListener('click', () => startWatchingJob(b.dataset.job));
    });
}

async function refreshCheckpointsList() {
    try {
        const data = await apiGet('/api/spawn-tuning/v2/torch/checkpoints');
        const host = $('torch-checkpoints-list');
        if (!host) return;
        const files = data.checkpoints || [];
        if (files.length === 0) {
            host.innerHTML = '<p class="muted-hint">暂无 checkpoint / policies 文件</p>';
            return;
        }
        host.innerHTML = `
            <table class="table">
                <thead><tr><th>文件名</th><th>类型</th><th>大小</th><th>修改时间</th><th>操作</th></tr></thead>
                <tbody>${files.map((f) => `
                    <tr>
                        <td><code>${escapeHtml(f.name)}</code></td>
                        <td><span class="status ${f.kind === 'checkpoint' ? 'running' : f.kind === 'policies' ? 'completed' : ''}">${escapeHtml(f.kind)}</span></td>
                        <td>${(f.size_bytes / 1024).toFixed(1)} KB</td>
                        <td>${new Date(f.modified_at * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                        <td>${f.kind === 'policies' ? `<button data-path="${escapeHtml(f.path)}" class="ghost btn-load-policies">📦 加载部署</button>` : ''}</td>
                    </tr>
                `).join('')}</tbody>
            </table>
        `;
        host.querySelectorAll('.btn-load-policies').forEach((b) => {
            b.addEventListener('click', () => loadAndDeployPolicies(b.dataset.path));
        });
    } catch (e) {
        const host = $('torch-checkpoints-list');
        if (host) host.innerHTML = `<p class="muted-hint">加载失败: ${escapeHtml(e.message)}</p>`;
    }
}

async function startTrainingJob() {
    const runId = Number($('torch-train-run-id').value);
    const epochs = Number($('torch-train-epochs').value) || 50;
    const batchSize = Number($('torch-train-batch').value) || 256;
    const lr = Number($('torch-train-lr').value) || 1e-3;
    const device = $('torch-train-device').value || 'cpu';
    if (!runId) { alert('请先选择 Run ID (Phase A 采的样本)'); return; }

    $('btn-torch-train').disabled = true;
    $('torch-train-hint').textContent = '提交训练…';
    try {
        const r = await apiPost('/api/spawn-tuning/v2/torch/train', {
            run_id: runId, epochs, batch_size: batchSize, lr, device,
        });
        $('torch-train-hint').innerHTML = `✓ 已启动 <code>${r.job_id}</code> (PID ${r.pid})`;
        startWatchingJob(r.job_id);
    } catch (e) {
        $('torch-train-hint').innerHTML = `<span style="color:var(--bad)">失败: ${escapeHtml(e.message)}</span>`;
    } finally {
        $('btn-torch-train').disabled = false;
    }
}

async function startOptimizeJob() {
    const ckpt = $('torch-optimize-checkpoint').value;
    if (!ckpt) { alert('先选 checkpoint'); return; }
    const weights = {
        fairness: Number($('torch-w-f').value) || 70,
        excitement: Number($('torch-w-e').value) || 45,
        antiInflation: Number($('torch-w-a').value) || 60,
    };
    const nStarts = Number($('torch-n-starts').value) || 8;
    const steps = Number($('torch-steps').value) || 250;

    $('btn-torch-optimize').disabled = true;
    try {
        const r = await apiPost('/api/spawn-tuning/v2/torch/optimize', {
            checkpoint: ckpt, weights, n_starts: nStarts, steps,
        });
        startWatchingJob(r.job_id);
    } catch (e) {
        alert('启动失败: ' + e.message);
    } finally {
        $('btn-torch-optimize').disabled = false;
    }
}

function startWatchingJob(jobId) {
    _torchCurrentJobId = jobId;
    $('torch-job-log-section').hidden = false;
    $('torch-job-log-title').textContent = `Job 日志: ${jobId}`;
    if (_torchPollTimer) clearInterval(_torchPollTimer);
    _torchPollTimer = setInterval(() => pollTorchJob(jobId), 2000);
    pollTorchJob(jobId);
}

async function pollTorchJob(jobId) {
    try {
        const data = await apiGet(`/api/spawn-tuning/v2/torch/jobs/${jobId}`);
        $('torch-job-log').textContent = data.log_tail || '(等待输出...)';
        $('torch-job-log').scrollTop = $('torch-job-log').scrollHeight;
        const title = $('torch-job-log-title');
        if (title) title.textContent = `Job ${jobId} · ${data.status} · ${data.elapsed_s}s`;
        if (data.status !== 'running') {
            clearInterval(_torchPollTimer);
            _torchPollTimer = null;
            // 任务完成后刷新 checkpoint 列表
            await refreshTorchStatus();
            // 如果是 optimize job 完成,启用部署按钮
            if (data.kind === 'optimize' && data.status === 'completed' && data.output) {
                $('btn-torch-deploy').disabled = false;
                $('btn-torch-deploy').dataset.path = data.output;
            }
        }
    } catch (e) {
        $('torch-job-log').textContent = `轮询失败: ${e.message}`;
    }
}

async function cancelCurrentJob() {
    if (!_torchCurrentJobId) return;
    if (!confirm(`确认取消任务 ${_torchCurrentJobId}?`)) return;
    try {
        const r = await apiPost(`/api/spawn-tuning/v2/torch/jobs/${_torchCurrentJobId}/cancel`, {});
        alert(r.cancelled ? '已取消' : (r.reason || '取消失败'));
        await refreshTorchStatus();
    } catch (e) { alert('取消失败: ' + e.message); }
}

async function refreshBundleStatus() {
    const host = $('bundle-status');
    if (!host) return;
    try {
        const data = await apiGet('/api/spawn-tuning/v2/policies/bundle/status');
        if (!data.exists) {
            host.innerHTML = `
                <div class="stat-card bad"><div class="stat-value">未烘焙</div><div class="stat-label">Web bundle</div></div>
                <div class="stat-card ${data.mp_exists ? 'good' : 'bad'}"><div class="stat-value">${data.mp_exists ? '已生成' : '未烘焙'}</div><div class="stat-label">小程序模块</div></div>
                <div class="stat-card"><div class="stat-value">—</div><div class="stat-label">点「烘焙到离线包」开始</div></div>
            `;
            return;
        }
        const m = data.meta || {};
        const ageMin = Math.round((Date.now() / 1000 - (data.bundle_modified_at || 0)) / 60);
        host.innerHTML = `
            <div class="stat-card good"><div class="stat-value">${m.policies_count || 0}</div><div class="stat-label">已烘焙 policies</div></div>
            <div class="stat-card"><div class="stat-value">${(data.bundle_size_bytes / 1024).toFixed(0)} KB</div><div class="stat-label">Bundle 大小</div></div>
            <div class="stat-card ${data.mp_exists ? 'good' : 'warn'}"><div class="stat-value">${data.mp_exists ? '✓' : '✗'}</div><div class="stat-label">小程序模块</div></div>
            <div class="stat-card ${ageMin < 60 ? 'good' : 'warn'}"><div class="stat-value">${ageMin}m</div><div class="stat-label">距上次烘焙</div></div>
        `;
        if (m.sha256) {
            host.innerHTML += `<div class="stat-card" style="grid-column:1/-1; border-left-color:var(--muted);"><div class="stat-label">SHA-256 · run_id=<code>${escapeHtml(m.run_id || '?')}</code></div><div style="font-family:ui-monospace,monospace; font-size:10px; color:var(--muted); word-break:break-all; margin-top:4px;">${escapeHtml(m.sha256)}</div></div>`;
        }
    } catch (e) {
        host.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }
}

async function exportBundle(source = 'active') {
    const btn = $('btn-bundle-export');
    const btnFile = $('btn-bundle-export-file');
    const hint = $('bundle-hint');
    if (btn) btn.disabled = true;
    if (btnFile) btnFile.disabled = true;
    if (hint) hint.textContent = '烘焙中…';
    try {
        const r = await apiPost('/api/spawn-tuning/v2/policies/bundle/export', {
            source, include_miniprogram: true,
        });
        if (!r.ok) {
            if (hint) hint.innerHTML = `<span style="color:var(--bad)">失败: ${escapeHtml(r.error || '')}</span>`;
            return;
        }
        const writtenList = (r.written || []).map((p) => `<code>${escapeHtml(p)}</code>`).join(' · ');
        if (hint) {
            hint.innerHTML = `<span style="color:var(--good)">✓ ${r.policies_count} policies 已烘焙 · 写入 ${writtenList} · 下次构建/同步打包后生效</span>`;
        }
        await refreshBundleStatus();
    } catch (e) {
        if (hint) hint.innerHTML = `<span style="color:var(--bad)">失败: ${escapeHtml(e.message)}</span>`;
    } finally {
        if (btn) btn.disabled = false;
        if (btnFile) btnFile.disabled = false;
    }
}

async function exportBundleFromFile() {
    // 让用户从 checkpoint 列表里选最新 policies-*.json
    const opts = await apiGet('/api/spawn-tuning/v2/torch/checkpoints').catch(() => null);
    const files = (opts?.checkpoints || []).filter((c) => c.kind === 'policies');
    if (files.length === 0) {
        alert('没有 policies-*.json 文件 — 先跑 Phase C 生成或先部署再用 active');
        return;
    }
    const choice = prompt(
        '选择源文件 (输入序号):\n' +
        files.map((f, i) => `  [${i}] ${f.name} (${(f.size_bytes / 1024).toFixed(0)} KB)`).join('\n'),
        '0',
    );
    const idx = Number(choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= files.length) return;
    await exportBundle(files[idx].path);
}

async function loadAndDeployPolicies(path) {
    if (!confirm(`从 ${path} 加载并部署 (Shadow)?`)) return;
    try {
        const loaded = await apiPost('/api/spawn-tuning/v2/torch/load-policies', { path });
        if (!loaded.ok) { alert('加载失败'); return; }
        const policies = loaded.content?.policies || [];
        const r = await apiPost('/api/spawn-tuning/v2/policies/deploy', {
            run_id: Number($('torch-train-run-id').value) || 0,
            rollout_pct: 0,  // Shadow 模式
            policies,
        });
        alert(`✓ 已部署 ${r.deployed} 个 policy (Shadow,签名: ${r.signed_with_secret ? '强 HMAC' : '降级'})`);
        await refreshOverview();
    } catch (e) {
        alert('部署失败: ' + e.message);
    }
}

let _launchInited = false;
function initLaunchTab() {
    if (_launchInited) return;
    _launchInited = true;
    // 权重滑块联动
    for (const [id, pctId] of [['launch-w-f', 'launch-w-f-pct'], ['launch-w-e', 'launch-w-e-pct'], ['launch-w-a', 'launch-w-a-pct']]) {
        const el = $(id), pct = $(pctId);
        if (el && pct) {
            el.addEventListener('input', () => { pct.textContent = el.value; });
        }
    }
    $('btn-launch-estimate')?.addEventListener('click', () => estimateLaunchBudget());
    $('btn-launch-start')?.addEventListener('click', () => {
        startLaunchTuning().catch((e) => logLaunch(`致命错误: ${e.message || e}`, 'error'));
    });
    $('btn-launch-cancel')?.addEventListener('click', cancelLaunchTuning);
    drawLaunchSubscoresCanvas([]);
    logLaunch('就绪 — 配置后启动', 'info');

    // PyTorch Phase B/C 训练
    $('btn-torch-train')?.addEventListener('click', () => startTrainingJob().catch((e) => alert(e.message)));
    $('btn-torch-optimize')?.addEventListener('click', () => startOptimizeJob().catch((e) => alert(e.message)));
    $('btn-torch-status')?.addEventListener('click', () => refreshTorchStatus());
    $('btn-torch-job-cancel')?.addEventListener('click', () => cancelCurrentJob());
    $('btn-torch-deploy')?.addEventListener('click', (e) => {
        const path = e.currentTarget.dataset.path;
        if (path) loadAndDeployPolicies(path);
    });
    $('btn-bundle-export')?.addEventListener('click', () => exportBundle('active'));
    $('btn-bundle-export-file')?.addEventListener('click', () => exportBundleFromFile());
    $('btn-bundle-refresh')?.addEventListener('click', () => refreshBundleStatus());
    $('btn-torch-runs-refresh')?.addEventListener('click', () => refreshTrainEligibleRuns());
    refreshTorchStatus();
    refreshTrainEligibleRuns();
    refreshBundleStatus();

    // Step A.0 快速复用: 同步可用 run 到下拉, 点按钮把选中的 run 同步给 Step B
    refreshStepAReuseRuns();
    $('btn-step-a-reuse')?.addEventListener('click', () => {
        const sel = $('step-a-reuse-run');
        const rid = sel?.value;
        if (!rid) { alert('请先选一个 run'); return; }
        const torchSel = $('torch-train-run-id');
        if (torchSel) {
            if (![...torchSel.options].some((o) => o.value === rid)) {
                const o = document.createElement('option');
                o.value = rid;
                o.textContent = rid;
                torchSel.appendChild(o);
            }
            torchSel.value = rid;
            $('torch-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
    $('btn-step-a-data-center')?.addEventListener('click', (e) => { e.preventDefault(); switchToTab('history'); });
}

async function refreshStepAReuseRuns() {
    const sel = $('step-a-reuse-run');
    if (!sel) return;
    try {
        const data = await apiGet('/api/spawn-tuning/v2/torch/eligible-runs?min_samples=100');
        const runs = data.runs || [];
        if (runs.length === 0) {
            sel.innerHTML = '<option value="">— 还没有可用 run · 先在下方采集 —</option>';
            sel.disabled = true;
            return;
        }
        sel.disabled = false;
        sel.innerHTML = runs.map((r) => {
            const flag = r.has_been_trained ? '✓' : '○';
            return `<option value="${r.run_id}">${flag} ${r.run_id} · ${r.sample_count} 样本 · ${r.context_count >= 120 ? '全集' : r.context_count + ' ctx'}</option>`;
        }).join('');
    } catch (e) {
        sel.innerHTML = `<option value="">加载失败: ${escapeHtml(e.message)}</option>`;
    }
}

async function refreshFieldTab() {
    await loadFieldMetrics();
}

async function loadFieldMetrics() {
    const hours = $('field-hours')?.value || 24;
    const ctxFilter = $('field-ctx-filter')?.value?.trim();
    const query = ctxFilter ? `&context_key=${encodeURIComponent(ctxFilter)}` : '';
    try {
        const data = await apiGet(`/api/spawn-tuning/v2/metrics/aggregate?hours=${hours}${query}`);
        const aggs = data.aggregates || [];
        if (aggs.length === 0) {
            $('field-stats').innerHTML = '<div class="stat-card"><div class="stat-value">0</div><div class="stat-label">尚无上报数据</div></div>';
            $('field-tbody').innerHTML = '<tr><td colspan="8" class="muted-hint">本时间窗口无上报。让玩家先玩几局,或在 dashboard 本机点「↑ 触发本机 flush」。</td></tr>';
            return;
        }
        const totalGames = aggs.reduce((s, r) => s + r.games, 0);
        const sources = new Set(aggs.map((r) => r.source));
        const avgScore = aggs.reduce((s, r) => s + r.avg_score * r.games, 0) / totalGames;
        const avgNoMove = aggs.reduce((s, r) => s + r.noMove_rate * r.games, 0) / totalGames;

        $('field-stats').innerHTML = `
            <div class="stat-card good"><div class="stat-value">${totalGames.toLocaleString()}</div><div class="stat-label">总局数 (${hours}h)</div></div>
            <div class="stat-card"><div class="stat-value">${sources.size}</div><div class="stat-label">活跃 source 数</div></div>
            <div class="stat-card"><div class="stat-value">${fmt(avgScore, 0)}</div><div class="stat-label">加权均分</div></div>
            <div class="stat-card ${avgNoMove < 0.1 ? 'good' : avgNoMove < 0.2 ? 'warn' : 'bad'}"><div class="stat-value">${fmtPct(avgNoMove)}</div><div class="stat-label">加权死局率</div></div>
        `;
        $('field-tbody').innerHTML = aggs.map((r) => `
            <tr>
                <td><code>${escapeHtml(r.context_key)}</code></td>
                <td><span class="status ${r.source === 'exact' ? 'completed' : 'running'}">${escapeHtml(r.source)}</span></td>
                <td><code>${escapeHtml(r.theta_hash || '-')}</code></td>
                <td>${r.games.toLocaleString()}</td>
                <td>${fmt(r.avg_score, 0)}</td>
                <td>${fmt(r.avg_rounds, 0)}</td>
                <td>${fmt(r.avg_clears, 1)}</td>
                <td>${fmtPct(r.noMove_rate)}</td>
            </tr>
        `).join('');
    } catch (e) {
        $('field-tbody').innerHTML = `<tr><td colspan="8" class="muted-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}

// ── Tab 1: 总览 ────────────────────────────────────────────────

async function refreshOverview() {
    // 1. 拉激活 policies
    try {
        const data = await apiGet('/api/spawn-tuning/v2/policies/active');
        const policies = data.policies || [];
        $('active-stats').innerHTML = `
            <div class="stat-card ${policies.length > 0 ? 'good' : 'bad'}">
                <div class="stat-value">${policies.length}</div>
                <div class="stat-label">激活 Context 数 (满 = 120)</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data.run_id ?? '-'}</div>
                <div class="stat-label">Run ID</div>
            </div>
            <div class="stat-card ${data.rollout_pct >= 100 ? 'good' : (data.rollout_pct >= 10 ? 'warn' : 'bad')}">
                <div class="stat-value">${data.rollout_pct ?? 0}%</div>
                <div class="stat-label">灰度比例</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${policies.length > 0 ? fmt(avgComposite(policies), 3) : '-'}</div>
                <div class="stat-label">平均预期 composite</div>
            </div>
        `;
        $('rollout-fill').style.width = `${data.rollout_pct ?? 0}%`;
        $('rollout-pct').textContent = String(data.rollout_pct ?? 0);
        $('active-run-info').textContent = policies.length > 0
            ? `${policies.length} 个 context 已部署 (run #${data.run_id})`
            : '未部署任何策略,客户端走 DEFAULT_THETA';

        // 安装到本地 clientPolicy 便于 Tab 4 诊断
        if (policies.length > 0) {
            installPolicies(policies, { rolloutPct: data.rollout_pct, runId: data.run_id });
        } else {
            uninstallPolicies();
        }
    } catch (e) {
        $('active-stats').innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }

    // 2. 拉历史 run 列表
    try {
        const data = await apiGet('/api/spawn-tuning/v2/runs?limit=10');
        const rows = (data.runs || []).map((r) => {
            const duration = r.completed_at ? (r.completed_at - r.started_at) * 1000 : Date.now() - r.started_at * 1000;
            return `
                <tr>
                    <td><code>#${r.run_id}</code></td>
                    <td>${escapeHtml(r.name)}</td>
                    <td><span class="status ${r.status}">${r.status}</span></td>
                    <td>${r.sample_count.toLocaleString()}</td>
                    <td>${fmtDate(r.started_at)}</td>
                    <td>${fmtMs(duration)}</td>
                    <td><a href="#" data-tab="progress" data-run="${r.run_id}" class="goto-progress">查看进度</a></td>
                </tr>
            `;
        }).join('');
        $('runs-tbody').innerHTML = rows || '<tr><td colspan="7" class="muted-hint">无历史任务</td></tr>';
        document.querySelectorAll('.goto-progress').forEach((a) => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelector('.tab[data-tab="progress"]').click();
                setTimeout(() => {
                    $('run-select').value = a.dataset.run;
                    refreshRunDetail();
                }, 100);
            });
        });
    } catch (e) {
        $('runs-tbody').innerHTML = `<tr><td colspan="7" class="muted-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function avgComposite(policies) {
    const vals = policies.map((p) => p.expected_composite).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}

async function rollbackPolicies() {
    if (!confirm('确认回滚所有 active 策略? 客户端会立即 fallback 到 DEFAULT_THETA')) return;
    try {
        const r = await apiPost('/api/spawn-tuning/v2/policies/rollback', {});
        alert(`已回滚 ${r.rolled_back_count} 个策略`);
        await refreshOverview();
    } catch (e) {
        alert('回滚失败: ' + e.message);
    }
}

// ── Tab 2: 任务进度 ────────────────────────────────────────────

let _runListCache = null;

async function refreshRunSelect(selectId) {
    try {
        if (!_runListCache) {
            const data = await apiGet('/api/spawn-tuning/v2/runs?limit=50');
            _runListCache = data.runs || [];
        }
        const sel = $(selectId);
        const curr = sel.value;
        sel.innerHTML = '<option value="">请选择…</option>' +
            _runListCache.map((r) => `<option value="${r.run_id}">#${r.run_id} · ${escapeHtml(r.name)} (${r.sample_count} samples, ${r.status})</option>`).join('');
        if (curr) sel.value = curr;
    } catch (e) {
        console.error(e);
    }
}

async function refreshRunDetail() {
    const runId = Number($('run-select').value);
    if (!runId) {
        $('run-detail').innerHTML = '';
        $('progress-chart-section').hidden = true;
        return;
    }
    try {
        const data = await apiGet(`/api/spawn-tuning/v2/runs/${runId}`);
        const samples = await apiGet(`/api/spawn-tuning/v2/runs/${runId}/top-policies?limit=200`);
        const progress = data.sample_count / Math.max(1, data.budget);
        $('run-detail').innerHTML = `
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${data.sample_count}</div><div class="stat-label">已采样</div></div>
                <div class="stat-card"><div class="stat-value">${data.budget.toLocaleString()}</div><div class="stat-label">预算</div></div>
                <div class="stat-card ${data.status === 'completed' ? 'good' : ''}"><div class="stat-value">${(progress * 100).toFixed(1)}%</div><div class="stat-label">进度</div></div>
                <div class="stat-card"><div class="stat-value">${samples.context_count}</div><div class="stat-label">覆盖 Context 数</div></div>
            </div>
        `;
        $('progress-chart-section').hidden = false;
        drawSubscoreChart(samples.top_policies);
    } catch (e) {
        $('run-detail').innerHTML = `<p class="muted-hint">加载失败: ${escapeHtml(e.message)}</p>`;
    }
}

function drawSubscoreChart(policies) {
    const canvas = $('subscore-chart');
    if (!canvas || policies.length === 0) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width = canvas.clientWidth * dpr;
    const h = canvas.height = 220 * dpr;
    ctx.scale(dpr, dpr);
    const W = canvas.clientWidth;
    const H = 220;
    const padL = 30, padR = 10, padT = 14, padB = 24;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.6)';
    ctx.fillRect(0, 0, W, H);

    // Y 参考线
    ctx.strokeStyle = 'rgba(55, 65, 81, 0.6)';
    ctx.lineWidth = 0.5;
    for (const y of [0, 0.5, 1]) {
        const py = padT + (1 - y) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, py);
        ctx.lineTo(W - padR, py);
        ctx.stroke();
        ctx.fillStyle = '#9ca3af';
        ctx.font = '10px ui-monospace';
        ctx.fillText(y.toFixed(1), 6, py + 3);
    }

    const n = policies.length;
    const xStep = plotW / Math.max(1, n - 1);

    const drawSeries = (key, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        policies.forEach((p, i) => {
            const x = padL + i * xStep;
            const v = Math.max(0, Math.min(1, p[key] ?? 0));
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
    ctx.fillStyle = '#60a5fa'; ctx.fillText('⚖️ fairness', padL + 6, padT - 2);
    ctx.fillStyle = '#34d399'; ctx.fillText('🎉 excitement', padL + 100, padT - 2);
    ctx.fillStyle = '#fb923c'; ctx.fillText('🛑 antiInflation', padL + 220, padT - 2);
}

// ── Tab 3: 指标趋势 ────────────────────────────────────────────

let _currentMetricsPolicies = [];

async function loadMetricsForRun() {
    const runId = Number($('metrics-run-select').value);
    if (!runId) return;
    const wf = Number($('w-fairness').value) || 70;
    const we = Number($('w-excitement').value) || 45;
    const wa = Number($('w-antiInflation').value) || 60;
    try {
        const data = await apiGet(
            `/api/spawn-tuning/v2/runs/${runId}/top-policies?limit=120&w_fairness=${wf}&w_excitement=${we}&w_anti_inflation=${wa}`
        );
        _currentMetricsPolicies = data.top_policies || [];
        renderMetricsTable(_currentMetricsPolicies, runId);

        // 顶部 stats
        const avgComp = _currentMetricsPolicies.length > 0
            ? _currentMetricsPolicies.reduce((s, p) => s + p.composite, 0) / _currentMetricsPolicies.length
            : 0;
        const goodCount = _currentMetricsPolicies.filter((p) => p.composite > 0.7).length;
        $('metrics-stats').innerHTML = `
            <div class="stat-card"><div class="stat-value">${_currentMetricsPolicies.length}</div><div class="stat-label">已覆盖 Context</div></div>
            <div class="stat-card ${avgComp > 0.7 ? 'good' : 'warn'}"><div class="stat-value">${fmt(avgComp, 3)}</div><div class="stat-label">平均 composite</div></div>
            <div class="stat-card good"><div class="stat-value">${goodCount}</div><div class="stat-label">≥0.70 的 context</div></div>
            <div class="stat-card"><div class="stat-value">${_currentMetricsPolicies[0]?.composite ? fmt(_currentMetricsPolicies[0].composite, 3) : '-'}</div><div class="stat-label">最高 composite</div></div>
        `;
    } catch (e) {
        $('metrics-tbody').innerHTML = `<tr><td colspan="10" class="muted-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function renderMetricsTable(policies, runId) {
    if (policies.length === 0) {
        $('metrics-tbody').innerHTML = '<tr><td colspan="10" class="muted-hint">无数据</td></tr>';
        return;
    }
    $('metrics-tbody').innerHTML = policies.map((p, i) => {
        const compCls = p.composite > 0.7 ? '' : p.composite > 0.5 ? 'low' : 'bad';
        return `
            <tr>
                <td>#${i + 1}</td>
                <td><code>${escapeHtml(p.context_key)}</code></td>
                <td class="composite ${compCls}">${fmt(p.composite, 3)}</td>
                <td>${fmt(p.fairness, 2)}</td>
                <td>${fmt(p.excitement, 2)}</td>
                <td>${fmt(p.antiInflation, 2)}</td>
                <td>${fmt(p.scoreMean, 0)}</td>
                <td>${fmtPct(p.noMoveRate)}</td>
                <td>${fmtPct(p.overshootRate)}</td>
                <td><a href="#" data-ctx="${escapeHtml(p.context_key)}" class="view-theta">查看 θ</a></td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.view-theta').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const ctxKey = a.dataset.ctx;
            const p = policies.find((x) => x.context_key === ctxKey);
            if (p) {
                $('theta-detail-section').hidden = false;
                // 渲染 PB 曲线 mini panel (v0.3.5: 把 spawn-eval 的 PB 曲线搬过来)
                renderPbCurveMini('#theta-pb-curve-host', {
                    scoreMean: p.scoreMean,
                    bestScore: p.bestScore_bin || 1000,
                    label: p.context_key,
                    theta: p.theta,
                });
                $('theta-detail').textContent = JSON.stringify({
                    context_key: p.context_key,
                    composite: p.composite,
                    theta: p.theta,
                    metrics: {
                        scoreMean: p.scoreMean,
                        noMoveRate: p.noMoveRate,
                        overshootRate: p.overshootRate,
                    },
                }, null, 2);
                $('btn-deploy-this').onclick = () => deploySinglePolicy(p, 0, runId);
                $('btn-deploy-100').onclick = () => deploySinglePolicy(p, 100, runId);
                // 滚动到详情区
                $('theta-detail-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    });
}

async function deploySinglePolicy(policy, rolloutPct, runId) {
    if (!confirm(`确认部署 ${policy.context_key} 灰度 ${rolloutPct}%?`)) return;
    try {
        const r = await apiPost('/api/spawn-tuning/v2/policies/deploy', {
            run_id: runId,
            rollout_pct: rolloutPct,
            policies: [{
                context_key: policy.context_key,
                difficulty: policy.difficulty,
                generator: policy.generator,
                bestScore_bin: policy.bestScore_bin,
                lifecycle_stage: policy.lifecycle_stage,
                theta: policy.theta,
                expected_fairness: policy.fairness,
                expected_excitement: policy.excitement,
                expected_antiInflation: policy.antiInflation,
                expected_composite: policy.composite,
            }],
        });
        alert(`部署成功: ${r.deployed} 个 (签名: ${r.signed_with_secret ? '强' : '降级'})`);
        await refreshOverview();
    } catch (e) {
        alert('部署失败: ' + e.message);
    }
}

// ── Tab 4: 部署效果 ────────────────────────────────────────────

async function refreshDeployTab() {
    // 填充 ctx select
    try {
        const data = await apiGet('/api/spawn-tuning/v2/policies/active');
        const sel = $('compare-ctx-select');
        sel.innerHTML = '<option value="">选 context…</option>' +
            (data.policies || []).map((p) => `<option value="${p.context_key}">${escapeHtml(p.context_key)}</option>`).join('');
    } catch {}
}

async function runComparison() {
    const ctxKey = $('compare-ctx-select').value;
    if (!ctxKey) { alert('请选择 context'); return; }
    const sessions = Number($('compare-sessions').value) || 10;

    // 拿当前 active policy 的 theta
    let activePolicies = [];
    try {
        const data = await apiGet('/api/spawn-tuning/v2/policies/active');
        activePolicies = data.policies || [];
    } catch (e) { alert('加载 active 失败: ' + e.message); return; }
    const tuned = activePolicies.find((p) => p.context_key === ctxKey);
    if (!tuned) { alert('该 context 无 active policy'); return; }

    const [difficulty, generator, binStr] = ctxKey.split(':');
    const evalParams = contextToEvalParams({ difficulty, generator, bestScore_bin: Number(binStr) });

    $('compare-result').hidden = false;
    $('baseline-metrics').innerHTML = '<p class="muted-hint">跑 baseline 中…</p>';
    $('tuned-metrics').innerHTML = '<p class="muted-hint">跑 tuned 中…</p>';

    const runOne = (theta, label) => {
        const t0 = performance.now();
        const report = runSpawnEvaluation({
            seed: 12345,
            sessions, maxSteps: 120,
            maxEvaluatedTriplets: theta.maxEvaluatedTriplets,
            bestScore: evalParams.bestScore,
            strategies: [evalParams.strategy],
            policies: ['random', 'clear-greedy', 'survival'],
            spawnGenerators: [evalParams.spawnGenerator],
            modelConfig: {
                personalizationStrength: theta.personalizationStrength,
                temperature: theta.temperature,
                surpriseBudgetGain: theta.surpriseBudgetGain,
                surpriseCooldown: theta.surpriseCooldown,
            },
        });
        const t1 = performance.now();
        // 聚合
        const rows = report.rows || [];
        const agg = {};
        for (const f of ['noMoveRate', 'clearsMean', 'multiClearRate', 'fallbackRate', 'firstMoveFreedomMean',
                          'clearIntervalP90', 'overshootRate', 'breakPbRate', 'scoreMean']) {
            const vals = rows.map((r) => r[f]).filter(Number.isFinite);
            agg[f] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        }
        return { theta, agg, elapsed: t1 - t0 };
    };

    try {
        const baseline = runOne(DEFAULT_THETA, 'baseline');
        const tunedRes = runOne(tuned.theta, 'tuned');

        const fields = [
            ['scoreMean', '均分', 'higher'],
            ['noMoveRate', '死局率', 'lower'],
            ['clearsMean', '消行数', 'higher'],
            ['multiClearRate', '多消率', 'higher'],
            ['fallbackRate', '兜底率', 'lower'],
            ['overshootRate', '超 PB 率', 'lower'],
            ['firstMoveFreedomMean', '首步自由', 'higher'],
        ];
        const renderCard = (res) => fields.map(([f, label]) => `
            <div class="compare-metric">
                <span>${label}</span>
                <span class="delta">${typeof res.agg[f] === 'number' ? (f.includes('Rate') ? fmtPct(res.agg[f]) : fmt(res.agg[f], 2)) : '-'}</span>
            </div>
        `).join('');
        $('baseline-metrics').innerHTML = renderCard(baseline) + `<p class="muted-hint">耗时 ${fmtMs(baseline.elapsed)}</p>`;

        // tuned 显示带 delta
        $('tuned-metrics').innerHTML = fields.map(([f, label, dir]) => {
            const tv = tunedRes.agg[f];
            const bv = baseline.agg[f];
            if (typeof tv !== 'number' || typeof bv !== 'number') return '';
            const delta = tv - bv;
            const goodChange = (dir === 'higher' ? delta > 0 : delta < 0);
            const deltaCls = Math.abs(delta) < 1e-9 ? '' : (goodChange ? 'up' : 'down');
            const deltaStr = (delta >= 0 ? '+' : '') + (f.includes('Rate') ? fmtPct(delta, 1) : fmt(delta, 2));
            const tvStr = f.includes('Rate') ? fmtPct(tv) : fmt(tv, 2);
            return `
                <div class="compare-metric">
                    <span>${label}</span>
                    <span class="delta ${deltaCls}">${tvStr} (${deltaStr})</span>
                </div>
            `;
        }).join('') + `<p class="muted-hint">耗时 ${fmtMs(tunedRes.elapsed)}</p>`;
    } catch (e) {
        $('baseline-metrics').innerHTML = `<p class="muted-hint">失败: ${escapeHtml(e.message)}</p>`;
        $('tuned-metrics').innerHTML = '';
    }
}

// ── 启动 ───────────────────────────────────────────────────────

function bindEvents() {
    setupTabs();
    $('btn-rollback')?.addEventListener('click', rollbackPolicies);
    $('btn-refresh-run')?.addEventListener('click', refreshRunDetail);
    $('run-select')?.addEventListener('change', refreshRunDetail);
    $('btn-load-metrics')?.addEventListener('click', loadMetricsForRun);
    $('metrics-run-select')?.addEventListener('change', loadMetricsForRun);
    $('btn-run-compare')?.addEventListener('click', runComparison);
    $('btn-load-field')?.addEventListener('click', loadFieldMetrics);
    $('field-hours')?.addEventListener('change', loadFieldMetrics);
    $('btn-flush-now')?.addEventListener('click', async () => {
        const r = await flushFieldMetrics();
        const s = getFieldMetricsStats();
        alert(`Flush: 上报 ${r.sent || 0} 条, 剩余 ${s.bufferSize} 条 (累计 outcomes ${s.outcomes})`);
        await loadFieldMetrics();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    // 默认 tab 是「① 概览」(HTML 的 active 类已设),立即拉数据
    refreshOverview().catch(() => {});
});
