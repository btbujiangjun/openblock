/**
 * v2 看板逻辑 — 与 spawn-tuning-v2-dashboard.html 配合。
 *
 * 简版骨架, 包含:
 *   ① 概览 — 显示当前 deployed 模型
 *   ② 样本集 — CRUD + 启动采样 (调 samplerV2.js)
 *   ③ 模型 — 列表 / deploy / rollback
 *   ④ d_curve 可视化 — 拉聚合 + 用 dCurveChart 渲染
 *
 * v1 看板还在, 此页面独立 — URL 为 /spawn-tuning-v2-dashboard.html
 */

import { renderDCurveChart, computeChartMetrics } from './dCurveChart.js';
import { collectSamplesV2 } from './samplerV2.js';
import { getApiBaseUrl } from '../../config.js';

const $ = (id) => document.getElementById(id);
const API_BASE = getApiBaseUrl().replace(/\/+$/, '');

// 默认 14 维 θ (取范围中点, 用于 sampler 的简版 LHS)
const THETA_RANGES = {
    pbTension_strength: [0.1, 1.0],
    pbBrake_slope: [2.0, 8.0],
    pbBrake_center: [0.85, 0.98],
    pbOvershoot_decay: [0.1, 0.4],
    pbSurprise_rate: [0.02, 0.15],
    personalizationStrength: [0.05, 0.18],
    temperature: [0.03, 0.08],
    surpriseBudgetGain: [0.05, 0.10],
    surpriseCooldown: [4.0, 10.0],
    maxEvaluatedTriplets: [32.0, 128.0],
    tripletBaseTemp: [0.5, 2.0],
    floorBoost: [0.0, 0.3],
    cornerPenalty: [0.0, 0.4],
    lineBonusWeight: [0.5, 2.0],
};


function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDate(ts) {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
async function apiGet(path) {
    const r = await fetch(`${API_BASE}${path}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}
async function apiSend(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(`${API_BASE}${path}`, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}


// ─────────── Tab 切换 ───────────

function setupTabs() {
    document.querySelectorAll('.tab').forEach((t) => {
        t.addEventListener('click', () => {
            const id = t.dataset.tab;
            document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
            document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${id}`));
            if (id === 'overview') loadOverview();
            else if (id === 'samples') { refreshSampleSets(); refreshCurveSetSelector(); }
            else if (id === 'models') { refreshModels(); refreshJobs(); }
            else if (id === 'curve') refreshCurveSetSelector();
        });
    });
}


// ─────────── ① 概览 ───────────

async function loadOverview() {
    const host = $('active-model');
    try {
        const data = await apiGet('/api/spawn-tuning-v2/policies/active');
        if (!data.deployed) {
            host.innerHTML = `<div class="stat-card bad"><div class="stat-value">无</div><div class="stat-label">当前无 deployed 模型</div></div>`;
            return;
        }
        const m = data.deployed;
        const mae = m.metrics?.val_curve_mae;
        host.innerHTML = `
            <div class="stat-card good"><div class="stat-value">#${m.model_id}</div><div class="stat-label">${escapeHtml(m.name)}</div></div>
            <div class="stat-card"><div class="stat-value">${escapeHtml(m.model_type)}</div><div class="stat-label">类型</div></div>
            <div class="stat-card"><div class="stat-value">${escapeHtml(m.version || '-')}</div><div class="stat-label">版本</div></div>
            <div class="stat-card ${mae && mae < 0.05 ? 'good' : 'warn'}"><div class="stat-value">${mae != null ? Number(mae).toFixed(4) : '-'}</div><div class="stat-label">val_curve_mae</div></div>
            <div class="stat-card"><div class="stat-value">${fmtDate(m.deployed_at)}</div><div class="stat-label">部署时间</div></div>
        `;
    } catch (e) {
        host.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">加载失败: ${escapeHtml(e.message)}</div></div>`;
    }
}


// ─────────── ② 样本集 ───────────

async function refreshSampleSets() {
    const tbody = $('sets-table').querySelector('tbody');
    try {
        const data = await apiGet('/api/spawn-tuning-v2/sample-sets?limit=50');
        if (!data.sample_sets || data.sample_sets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="muted-hint">无样本集 — 上方新建</td></tr>';
            return;
        }
        tbody.innerHTML = data.sample_sets.map((s) => `
            <tr>
              <td><code>#${s.set_id}</code></td>
              <td>${escapeHtml(s.name)}</td>
              <td>${s.sample_count || 0}</td>
              <td><span class="status ${s.status || 'collecting'}">${s.status || '-'}</span></td>
              <td>${escapeHtml(s.tags || '-')}</td>
              <td>${fmtDate(s.created_at)}</td>
              <td>
                <button class="ghost btn-sample-set" data-id="${s.set_id}" data-name="${escapeHtml(s.name)}">采样</button>
                <button class="danger btn-delete-set" data-id="${s.set_id}">删</button>
              </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-sample-set').forEach((b) => {
            b.addEventListener('click', () => openSampler(Number(b.dataset.id), b.dataset.name));
        });
        tbody.querySelectorAll('.btn-delete-set').forEach((b) => {
            b.addEventListener('click', async () => {
                if (!confirm(`删除样本集 #${b.dataset.id}?`)) return;
                await apiSend('DELETE', `/api/spawn-tuning-v2/sample-sets/${b.dataset.id}`);
                refreshSampleSets();
            });
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="muted-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}

async function createSampleSet() {
    const name = $('new-set-name').value.trim();
    if (!name) {
        $('create-hint').innerHTML = '<span style="color:var(--bad)">需要名称</span>';
        return;
    }
    try {
        const r = await apiSend('POST', '/api/spawn-tuning-v2/sample-sets', {
            name,
            description: $('new-set-desc').value,
            tags: $('new-set-tags').value,
        });
        $('create-hint').innerHTML = `<span style="color:var(--good)">✓ 已创建 #${r.set_id}</span>`;
        $('new-set-name').value = '';
        refreshSampleSets();
    } catch (e) {
        $('create-hint').innerHTML = `<span style="color:var(--bad)">失败: ${escapeHtml(e.message)}</span>`;
    }
}


// ─────────── 启动采样 ───────────

let _samplerCancel = { cancelled: false };
let _currentSampleSetId = null;

function openSampler(setId, setName) {
    _currentSampleSetId = setId;
    $('sampler-set-name').textContent = `#${setId} ${setName}`;
    $('sampler-section').hidden = false;
    $('sampler-section').scrollIntoView({ behavior: 'smooth' });
}

function _lhsThetas(n) {
    // 简版 LHS: 每维 [0,1] 等分 n 段, 在每段随机取一点, 然后随机置换
    const keys = Object.keys(THETA_RANGES);
    const out = Array.from({ length: n }, () => ({}));
    for (const k of keys) {
        const [lo, hi] = THETA_RANGES[k];
        const segs = Array.from({ length: n }, (_, i) => (i + Math.random()) / n);
        // 随机置换
        for (let i = segs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [segs[i], segs[j]] = [segs[j], segs[i]];
        }
        segs.forEach((v, i) => { out[i][k] = lo + v * (hi - lo); });
    }
    return out;
}

async function startSampler() {
    if (!_currentSampleSetId) return;
    const btn = $('btn-start-sampler');
    const cancelBtn = $('btn-cancel-sampler');
    btn.disabled = true;
    cancelBtn.disabled = false;
    _samplerCancel = { cancelled: false };

    const contexts = [{
        difficulty: $('samp-difficulty').value.trim().split(',')[0] || 'normal',
        generator: $('samp-generator').value.trim() || 'budget-p2',
        bot_policy: $('samp-bot').value.trim() || 'clear-greedy',
        pb_bin: Number($('samp-pb').value) || 1500,
        lifecycle_stage: $('samp-lifecycle').value.trim() || 'growth',
    }];
    const nThetas = Math.max(2, Number($('samp-thetas').value) || 5);
    const seedsPerTheta = Math.max(1, Number($('samp-seeds').value) || 2);
    const maxSteps = Math.max(20, Number($('samp-max-steps').value) || 120);
    const thetas = _lhsThetas(nThetas);

    try {
        const result = await collectSamplesV2({
            setId: _currentSampleSetId,
            contexts, thetas, seedsPerTheta, maxSteps,
            apiBaseUrl: API_BASE,
            batchSize: 10,
            onProgress: (p) => {
                if (_samplerCancel.cancelled) return;
                $('samp-progress').innerHTML = `${p.completed}/${p.total} (${Math.round(p.percent * 100)}%)${p.failed ? ` · ${p.failed} 失败` : ''}`;
            },
        });
        $('samp-progress').innerHTML = `<span style="color:var(--good)">✓ 完成 ${result.completed}/${result.total}${result.failed ? ` (${result.failed} 失败)` : ''}</span>`;
        refreshSampleSets();
    } catch (e) {
        $('samp-progress').innerHTML = `<span style="color:var(--bad)">失败: ${escapeHtml(e.message)}</span>`;
    } finally {
        btn.disabled = false;
        cancelBtn.disabled = true;
    }
}


// ─────────── ③ 模型 + Jobs ───────────

async function refreshModels() {
    const tbody = $('models-table').querySelector('tbody');
    try {
        const data = await apiGet('/api/spawn-tuning-v2/models?limit=30');
        if (!data.models?.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="muted-hint">无模型 — 用 CLI 训练后写入</td></tr>';
            return;
        }
        tbody.innerHTML = data.models.map((m) => {
            const mae = m.metrics?.val_curve_mae;
            return `
              <tr>
                <td><code>#${m.model_id}</code></td>
                <td>${escapeHtml(m.name)}</td>
                <td>${escapeHtml(m.version || '-')}</td>
                <td>${escapeHtml(m.model_type)}</td>
                <td>${mae != null ? Number(mae).toFixed(4) : '-'}</td>
                <td><span class="status ${m.status}">${m.status}</span></td>
                <td>${fmtDate(m.created_at)}</td>
                <td>
                  ${m.status !== 'deployed' ? `<button class="ghost btn-deploy" data-id="${m.model_id}">部署</button>` : ''}
                  ${m.status === 'deployed' ? `<button class="danger btn-rollback" data-id="${m.model_id}">回滚</button>` : ''}
                </td>
              </tr>
            `;
        }).join('');
        tbody.querySelectorAll('.btn-deploy').forEach((b) => {
            b.addEventListener('click', async () => {
                if (!confirm(`部署模型 #${b.dataset.id}? 当前 deployed 会被 archived`)) return;
                await apiSend('POST', `/api/spawn-tuning-v2/models/${b.dataset.id}/deploy`);
                refreshModels(); loadOverview();
            });
        });
        tbody.querySelectorAll('.btn-rollback').forEach((b) => {
            b.addEventListener('click', async () => {
                if (!confirm(`回滚模型 #${b.dataset.id}? 自动激活上一个 deployed`)) return;
                await apiSend('POST', `/api/spawn-tuning-v2/models/${b.dataset.id}/rollback`);
                refreshModels(); loadOverview();
            });
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="muted-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}

async function refreshJobs() {
    const tbody = $('jobs-table').querySelector('tbody');
    try {
        const data = await apiGet('/api/spawn-tuning-v2/jobs?limit=30');
        if (!data.jobs?.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="muted-hint">无训练任务</td></tr>';
            return;
        }
        tbody.innerHTML = data.jobs.map((j) => `
            <tr>
              <td><code>#${j.job_id}</code></td>
              <td>${escapeHtml(j.name || '-')}</td>
              <td><span class="status ${j.status}">${j.status}</span></td>
              <td><code>${escapeHtml(j.sample_set_ids || '-')}</code></td>
              <td>${j.val_curve_mae != null ? Number(j.val_curve_mae).toFixed(4) : '-'}</td>
              <td>${fmtDate(j.created_at)}</td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="muted-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}


// ─────────── ④ d_curve 可视化 ───────────

async function refreshCurveSetSelector() {
    const sel = $('curve-set-select');
    if (!sel) return;
    const prev = sel.value;
    try {
        const data = await apiGet('/api/spawn-tuning-v2/sample-sets?limit=50');
        sel.innerHTML = '<option value="">— 选择 —</option>' +
            (data.sample_sets || []).map((s) => `<option value="${s.set_id}">#${s.set_id} ${escapeHtml(s.name)} (${s.sample_count || 0})</option>`).join('');
        if (prev) sel.value = prev;
    } catch (e) {
        sel.innerHTML = '<option value="">加载失败</option>';
    }
}

async function loadAndRenderCurve() {
    const setId = $('curve-set-select').value;
    if (!setId) { alert('请先选样本集'); return; }
    const groupBy = $('curve-group-by').value.trim();
    const meta = $('curve-meta');
    meta.textContent = '加载中…';
    try {
        const url = `/api/spawn-tuning-v2/sample-sets/${setId}/aggregate${groupBy ? `?group_by=${encodeURIComponent(groupBy)}` : ''}`;
        const data = await apiGet(url);
        if (!data.buckets || data.buckets.length === 0) {
            meta.textContent = '无数据';
            return;
        }
        // 取第一个 bucket (无分组时只有一个;有分组时取第一组,后续可扩展)
        const bucket = data.buckets[0];
        const observed = bucket.d_curve_avg;

        // 同时取目标 S 曲线
        const targetResp = await apiGet('/api/spawn-tuning-v2/target-curve');
        const target = targetResp.curve;

        // 此处 predicted 暂用 target 占位 (无 deployed 模型时); 真实场景里要拉模型推断
        const canvas = $('d-curve-canvas');
        renderDCurveChart(canvas, {
            targetCurve: target,
            predictedCurve: target,    // 占位 (没有模型推断结果)
            observedCurve: observed,
        });
        const metrics = computeChartMetrics(observed, target);
        meta.innerHTML = `n_samples = ${bucket.n_samples} · 实测 vs 目标 MAE = ${metrics.mae?.toFixed(4) ?? '-'} · 实测单调 = ${metrics.monotonic ? '✓' : '✗'}`;
    } catch (e) {
        meta.textContent = `失败: ${e.message}`;
    }
}


// ─────────── 启动 ───────────

function bindEvents() {
    setupTabs();
    $('btn-create-set').addEventListener('click', createSampleSet);
    $('btn-refresh-sets').addEventListener('click', refreshSampleSets);
    $('btn-start-sampler').addEventListener('click', startSampler);
    $('btn-cancel-sampler').addEventListener('click', () => { _samplerCancel.cancelled = true; });
    $('btn-refresh-models').addEventListener('click', () => { refreshModels(); refreshJobs(); });
    $('btn-load-curve').addEventListener('click', loadAndRenderCurve);
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadOverview();
});
