import {
    runSpawnEvaluation,
    buildEvaluationInsights,
    SPAWN_EVAL_GENERATORS,
    SPAWN_EVAL_POLICIES,
    SPAWN_EVAL_STRATEGIES,
} from './bot/spawnEvaluation.js';
import { derivePbCurve } from './adaptiveSpawn.js';
import { getApiBaseUrl } from './config.js';
import { getUserId } from './lib/userId.js';

const $ = (id) => document.getElementById(id);
const LOCAL_CONFIG_KEY = 'openblock_spawn_optimizer_configs_v1';
let _worker = null;
let _workerSeq = 0;
const _workerPending = new Map();

function getEvalWorker() {
    if (typeof Worker === 'undefined') return null;
    if (!_worker) {
        _worker = new Worker(new URL('./spawnEval.worker.js', import.meta.url), { type: 'module' });
        _worker.addEventListener('message', (event) => {
            const { id, ok, report, error } = event.data || {};
            const pending = _workerPending.get(id);
            if (!pending) return;
            _workerPending.delete(id);
            if (ok) pending.resolve(report);
            else pending.reject(new Error(error || 'spawn evaluation failed'));
        });
        _worker.addEventListener('error', (event) => {
            for (const pending of _workerPending.values()) {
                pending.reject(new Error(event.message || 'spawn eval worker error'));
            }
            _workerPending.clear();
            _worker?.terminate();
            _worker = null;
        });
    }
    return _worker;
}

function runEvaluationAsync(options) {
    const worker = getEvalWorker();
    if (!worker) {
        return new Promise((resolve) => {
            setTimeout(() => resolve(runSpawnEvaluation(options)), 20);
        });
    }
    const id = ++_workerSeq;
    return new Promise((resolve, reject) => {
        _workerPending.set(id, { resolve, reject });
        worker.postMessage({ id, options });
    });
}

function fmt(value, digits = 2) {
    if (value == null || Number.isNaN(Number(value))) return '-';
    if (typeof value === 'number') return value.toFixed(digits);
    return String(value);
}

function fillOptions(select, values, defaults) {
    select.innerHTML = '';
    for (const value of values) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        opt.selected = defaults.includes(value);
        select.appendChild(opt);
    }
}

function selectedValues(select) {
    return [...select.selectedOptions].map((opt) => opt.value);
}

function renderSummary(report) {
    const rows = report.rows || [];
    const totalGames = rows.reduce((sum, row) => sum + row.games, 0);
    const maxNoMove = Math.max(0, ...rows.map((row) => row.noMoveRate));
    const bestScore = Math.max(0, ...rows.map((row) => row.scoreMean));
    const maxOvershoot = Math.max(0, ...rows.map((row) => row.overshootRate || 0));

    $('summary').innerHTML = [
        stat('总局数', totalGames),
        stat('最高均分', fmt(bestScore, 1)),
        stat('最大死局率', fmt(maxNoMove * 100, 1) + '%'),
        stat('最大超PB', fmt(maxOvershoot * 100, 1) + '%'),
    ].join('');
}

function objectiveWeightsFromUi() {
    return {
        noMove: Number($('w-no-move')?.value) || 0.35,
        rewardAgency: Number($('w-reward')?.value) || 0.25,
        skillLift: Number($('w-skill')?.value) || 0.2,
        fallback: Number($('w-fallback')?.value) || 0.12,
        pacing: Number($('w-pacing')?.value) || 0.08,
    };
}

function modelConfigFromUi() {
    return {
        personalizationStrength: Number($('personalization-strength')?.value) || 0,
        temperature: Number($('random-temperature')?.value) || 0,
        surpriseBudgetGain: Number($('surprise-gain')?.value) || 0,
        surpriseCooldown: Number($('surprise-cooldown')?.value) || 6,
    };
}

function updatePbPreview(score = 0) {
    const bestScore = Number($('best-score')?.value) || 1000;
    const curve = derivePbCurve(score, bestScore, false);
    $('pb-tension-preview').textContent = fmt(curve.pbTension, 2);
    $('pb-brake-preview').textContent = fmt(curve.pbBrake, 2);
    $('pb-release-preview').textContent = fmt(curve.pbRelease, 2);
    const ratioText = curve.pbRatio == null ? '未知' : fmt(curve.pbRatio, 2);
    $('pb-formula-preview').textContent =
        `pbRatio = ${score} / ${bestScore} = ${ratioText} · 当前阶段 ${curve.pbPhase}`;
}

function stat(label, value) {
    return `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderTable(report) {
    const tbody = $('result-body');
    tbody.innerHTML = '';
    for (const row of report.rows || []) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.strategy}</td>
            <td>${row.spawnGenerator}</td>
            <td>${row.policy}</td>
            <td>${fmt(row.scoreMean, 1)}</td>
            <td>${fmt(row.stepsMean, 1)}</td>
            <td>${fmt(row.clearsMean, 2)}</td>
            <td>${fmt(row.noMoveRate * 100, 1)}%</td>
            <td>${fmt(row.clearIntervalMean, 2)}</td>
            <td>${fmt(row.fallbackRate * 100, 2)}%</td>
            <td>${fmt(row.attemptMean, 2)}</td>
            <td>${fmt(row.firstMoveFreedomMean, 2)}</td>
            <td>${fmt((row.nearPbRate ?? 0) * 100, 1)}%</td>
            <td>${fmt((row.overshootRate ?? 0) * 100, 1)}%</td>
        `;
        tbody.appendChild(tr);
    }
}

function renderComparisons(report) {
    const wrap = $('comparison-list');
    wrap.innerHTML = '';
    for (const item of report.comparisons || []) {
        const div = document.createElement('div');
        div.className = 'comparison';
        div.innerHTML = `
            <strong>${item.strategy}</strong>
            <span>生成器: ${item.spawnGenerator}</span>
            <span>自然公平差: ${item.naturalFairnessGap == null ? '-' : (item.naturalFairnessGap * 100).toFixed(1) + '%'}</span>
            <span>技能收益: ${item.skillScoreLift == null ? '-' : item.skillScoreLift.toFixed(1) + ' 分'}</span>
            <span>奖励自主性: ${item.rewardAgencyGap == null ? '-' : item.rewardAgencyGap.toFixed(2) + ' 消行/局'}</span>
        `;
        wrap.appendChild(div);
    }
}

function renderBars(report) {
    const chart = $('bars');
    chart.innerHTML = '';
    const rows = report.rows || [];
    const maxScore = Math.max(1, ...rows.map((row) => row.scoreMean));
    for (const row of rows) {
        const item = document.createElement('div');
        item.className = 'bar-row';
        item.innerHTML = `
            <span>${row.strategy}/${row.spawnGenerator}/${row.policy}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width:${Math.max(2, row.scoreMean / maxScore * 100)}%"></div>
            </div>
            <b>${fmt(row.scoreMean, 1)}</b>
        `;
        chart.appendChild(item);
    }
}

function renderRaw(report) {
    $('raw-json').textContent = JSON.stringify(report, null, 2);
}

function renderInsights(report) {
    const insights = report.insights || buildEvaluationInsights(report, objectiveWeightsFromUi());
    const el = $('insights');
    if (!el) return;
    const best = insights.best
        ? `<p><strong>推荐方案：</strong>${insights.best.strategy} / ${insights.best.spawnGenerator} / ${insights.best.policy}，综合分 ${insights.best.optimizerScore ?? '-'}</p>`
        : '';
    el.innerHTML = `
        ${best}
        <h3>关键发现</h3>
        <ul>${(insights.findings || []).map((x) => `<li>${x}</li>`).join('')}</ul>
        <h3>改进建议</h3>
        <ul>${(insights.recommendations || []).map((x) => `<li>${x}</li>`).join('')}</ul>
    `;
}

function renderReport(report) {
    renderSummary(report);
    renderTable(report);
    renderComparisons(report);
    renderBars(report);
    renderInsights(report);
    renderRaw(report);
    $('timestamp').textContent = `生成时间：${report.generatedAt}`;
    const bestRow = report.insights?.best;
    updatePbPreview(bestRow?.scoreMean || 0);
}

function renderInitialState() {
    $('summary').innerHTML = [
        stat('状态', '等待'),
        stat('总局数', 0),
        stat('最大死局率', '-'),
        stat('平均兜底率', '-'),
    ].join('');
    $('result-body').innerHTML = '';
    $('comparison-list').innerHTML = '<p class="muted">点击“运行评估”后展示公平与自主性对比。</p>';
    $('bars').innerHTML = '<p class="muted">等待评估数据。</p>';
    $('insights').innerHTML = '<p class="muted">点击“运行评估”或“自动寻优”后生成报告解读。</p>';
    $('raw-json').textContent = '';
    $('timestamp').textContent = '等待评估';
    updatePbPreview(0);
}

function runFromUi() {
    const btn = $('run-btn');
    btn.disabled = true;
    btn.textContent = '评估中...';
    setTimeout(() => {
        void (async () => {
            try {
                const report = await runEvaluationAsync({
                seed: Number($('seed').value) || 20260523,
                sessions: Number($('sessions').value) || 30,
                maxSteps: Number($('max-steps').value) || 240,
                maxEvaluatedTriplets: Number($('max-triplets').value) || 80,
                bestScore: Number($('best-score').value) || 1000,
                strategies: selectedValues($('strategies')),
                policies: selectedValues($('policies')),
                spawnGenerators: selectedValues($('spawn-generators')),
                objectiveWeights: objectiveWeightsFromUi(),
                modelConfig: modelConfigFromUi(),
            });
                renderReport(report);
            } catch (error) {
                $('timestamp').textContent = `评估失败：${error.message || error}`;
            } finally {
                btn.disabled = false;
                btn.textContent = '运行评估';
            }
        })();
    }, 20);
}

function currentConfigPayload() {
    return {
        seed: Number($('seed').value) || 20260523,
        sessions: Number($('sessions').value) || 30,
        maxSteps: Number($('max-steps').value) || 240,
        maxEvaluatedTriplets: Number($('max-triplets').value) || 80,
        bestScore: Number($('best-score').value) || 1000,
        strategies: selectedValues($('strategies')),
        policies: selectedValues($('policies')),
        spawnGenerators: selectedValues($('spawn-generators')),
        objectiveWeights: objectiveWeightsFromUi(),
        modelConfig: modelConfigFromUi(),
    };
}

function applyConfigPayload(payload = {}) {
    if (payload.seed) $('seed').value = payload.seed;
    if (payload.sessions) $('sessions').value = payload.sessions;
    if (payload.maxSteps) $('max-steps').value = payload.maxSteps;
    if (payload.maxEvaluatedTriplets) $('max-triplets').value = payload.maxEvaluatedTriplets;
    if (payload.bestScore) $('best-score').value = payload.bestScore;
    updatePbPreview(0);
    for (const [id, values] of [
        ['strategies', payload.strategies],
        ['policies', payload.policies],
        ['spawn-generators', payload.spawnGenerators],
    ]) {
        if (Array.isArray(values)) {
            for (const opt of $(id).options) opt.selected = values.includes(opt.value);
        }
    }
    const w = payload.objectiveWeights || {};
    if (w.noMove != null) $('w-no-move').value = w.noMove;
    if (w.rewardAgency != null) $('w-reward').value = w.rewardAgency;
    if (w.skillLift != null) $('w-skill').value = w.skillLift;
    if (w.fallback != null) $('w-fallback').value = w.fallback;
    if (w.pacing != null) $('w-pacing').value = w.pacing;
    const m = payload.modelConfig || {};
    if (m.personalizationStrength != null) $('personalization-strength').value = m.personalizationStrength;
    if (m.temperature != null) $('random-temperature').value = m.temperature;
    if (m.surpriseBudgetGain != null) $('surprise-gain').value = m.surpriseBudgetGain;
    if (m.surpriseCooldown != null) $('surprise-cooldown').value = m.surpriseCooldown;
}

async function apiJson(path, options = {}) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function refreshSavedConfigs() {
    const select = $('saved-configs');
    if (!select) return;
    const userId = getUserId();
    let items = readLocalConfigs(userId);
    let source = '本地';
    try {
        const data = await apiJson(`/api/spawn-optimizer/configs?user_id=${encodeURIComponent(userId)}`);
        items = [...(data.items || []), ...items.filter((local) => !(data.items || []).some((x) => x.id === local.id))];
        source = 'SQLite + 本地';
    } catch {
        source = '本地（SQLite 不可用）';
    }
    select.innerHTML = '<option value="">选择已保存方案</option>';
    for (const item of items) {
        const opt = document.createElement('option');
        opt.value = String(item.id);
        opt.textContent = `${item.is_active ? '已生效 · ' : ''}${item.name}`;
        opt._payload = item.payload;
        select.appendChild(opt);
    }
    $('save-status').textContent = `${source}：已加载 ${items.length} 个方案`;
}

function readLocalConfigs(userId) {
    try {
        const all = JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY) || '{}');
        return Array.isArray(all[userId]) ? all[userId] : [];
    } catch {
        return [];
    }
}

function writeLocalConfig(userId, config) {
    const all = JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY) || '{}');
    const list = Array.isArray(all[userId]) ? all[userId] : [];
    if (config.is_active) {
        for (const item of list) item.is_active = false;
    }
    const item = {
        id: config.id || `local-${Date.now()}`,
        user_id: userId,
        name: config.name,
        payload: config.payload,
        is_active: !!config.is_active,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
    };
    list.unshift(item);
    all[userId] = list.slice(0, 50);
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(all));
    return item;
}

async function saveCurrentConfig() {
    const name = $('config-name').value.trim() || '出块优化方案';
    const userId = getUserId();
    const payload = currentConfigPayload();
    try {
        await apiJson('/api/spawn-optimizer/configs', {
            method: 'PUT',
            body: JSON.stringify({
                user_id: userId,
                name,
                payload,
                is_active: $('activate-on-save').checked,
            }),
        });
        $('save-status').textContent = '已保存到 SQLite';
    } catch (e) {
        writeLocalConfig(userId, {
            name,
            payload,
            is_active: $('activate-on-save').checked,
        });
        $('save-status').textContent = `SQLite 不可用，已保存到本地：${e.message || e}`;
    }
    await refreshSavedConfigs();
}

function loadSelectedConfig() {
    const opt = $('saved-configs').selectedOptions[0];
    if (opt?._payload) {
        applyConfigPayload(opt._payload);
        $('save-status').textContent = '方案已加载并对下一次评估生效';
    }
}

function runAutoOptimize() {
    const btn = $('auto-btn');
    btn.disabled = true;
    btn.textContent = '自动寻优中...';
    setTimeout(() => {
        void (async () => {
        try {
            const base = currentConfigPayload();
            const candidates = [
                { spawnGenerators: ['baseline'], maxEvaluatedTriplets: base.maxEvaluatedTriplets },
                { spawnGenerators: ['triplet-p1'], maxEvaluatedTriplets: 32, modelConfig: { ...base.modelConfig, personalizationStrength: 0.06, temperature: 0.03 } },
                { spawnGenerators: ['budget-p2'], maxEvaluatedTriplets: 32, modelConfig: { ...base.modelConfig, personalizationStrength: 0.10, temperature: 0.04 } },
                { spawnGenerators: ['budget-p2'], maxEvaluatedTriplets: 64, modelConfig: { ...base.modelConfig, personalizationStrength: 0.14, temperature: 0.06, surpriseBudgetGain: 0.08 } },
            ];
            const results = [];
            for (const patch of candidates) {
                const report = await runEvaluationAsync({
                    ...base,
                    sessions: Math.min(3, base.sessions),
                    maxSteps: Math.min(120, base.maxSteps),
                    ...patch,
                });
                results.push({
                    patch,
                    report,
                    score: report.insights?.best?.optimizerScore ?? 0,
                });
                $('optimizer-output').textContent = `已评估 ${results.length}/${candidates.length} 个候选...`;
            }
            results.sort((a, b) => b.score - a.score);
            const best = results[0];
            applyConfigPayload({ ...base, ...best.patch });
            renderReport(best.report);
            $('optimizer-output').textContent = JSON.stringify({
                selected: best.patch,
                score: best.score,
                candidates: results.map((x) => ({ patch: x.patch, score: x.score })),
            }, null, 2);
        } finally {
            btn.disabled = false;
            btn.textContent = '自动寻优';
        }
        })();
    }, 20);
}

export function initSpawnEvalApp() {
    fillOptions($('strategies'), SPAWN_EVAL_STRATEGIES, ['normal']);
    fillOptions($('policies'), SPAWN_EVAL_POLICIES, SPAWN_EVAL_POLICIES);
    fillOptions($('spawn-generators'), SPAWN_EVAL_GENERATORS, ['baseline']);
    $('best-score')?.addEventListener('input', () => updatePbPreview(0));
    $('run-btn').addEventListener('click', runFromUi);
    $('auto-btn')?.addEventListener('click', runAutoOptimize);
    $('save-config-btn')?.addEventListener('click', saveCurrentConfig);
    $('load-config-btn')?.addEventListener('click', loadSelectedConfig);
    void refreshSavedConfigs();
    renderInitialState();
}

document.addEventListener('DOMContentLoaded', initSpawnEvalApp);

