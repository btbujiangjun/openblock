/**
 * 出块算法优化 (Spawn Algorithm Tuning) v2 看板逻辑。
 *
 * 5 tab 业务流程:
 *   ① 概览       — 当前 deployed 模型 + 一键回滚 + 系统状态
 *   ② 样本集     — chips 多选采集 + Run 库管理
 *   ③ 模型训练   — 提交 job + 队列 + 模型库 (deploy/rollback)
 *   ④ 部署与监控 — 烘焙 bundle + 真实玩家 d_curve 聚合
 *   ⑤ 分析       — 目标 vs 预测 vs 实测三线对照
 */

import { collectSamplesV2 } from './samplerV2.js';
import { renderDCurveChart, computeChartMetrics } from './dCurveChart.js';
import { getApiBaseUrl } from '../../config.js';

const $ = (id) => document.getElementById(id);
const API_BASE = getApiBaseUrl().replace(/\/+$/, '');

const ALL_DIM_VALUES = {
    difficulty: ['easy', 'normal', 'hard'],
    generator: ['triplet-p1', 'budget-p2'],
    bot_policy: ['random', 'clear-greedy', 'survival'],
    pb_bin: ['500', '1500', '4000', '10000', '25000'],
    lifecycle_stage: ['onboarding', 'growth', 'mature', 'plateau'],
};

const PRESETS = {
    smoke:  { thetas: 3,  seeds: 1, maxSteps: 30, label: '🔥 烟雾测试 (~30 秒)' },
    debug:  { thetas: 5,  seeds: 2, maxSteps: 120, label: '🐞 日常调试 (~5 分)' },
    prod:   { thetas: 15, seeds: 2, maxSteps: 240, label: '🏭 生产训练 (~1 时)' },
};


// ─────────── 工具 ───────────

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDate(ts) {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtNumber(n, digits = 4) {
    if (n == null || !Number.isFinite(Number(n))) return '-';
    return Number(n).toFixed(digits);
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
            if (id === 'overview') refreshOverview();
            else if (id === 'samples') { refreshSampleSets(); updateEstimate(); }
            else if (id === 'training') { refreshJobs(); refreshModels(); }
            else if (id === 'deploy') refreshBundleStatus();
            else if (id === 'analysis') refreshCurveSetSelector();
        });
    });
}


// ─────────── ① 概览 ───────────

async function refreshOverview() {
    // 当前 deployed 模型
    const modelHost = $('active-model-cards');
    try {
        const data = await apiGet('/api/spawn-tuning-v2/policies/active');
        if (!data.deployed) {
            modelHost.innerHTML = '<div class="stat-card warn"><div class="stat-value">无</div><div class="stat-label">当前未部署模型</div></div>';
            $('btn-rollback').disabled = true;
        } else {
            const m = data.deployed;
            const mae = m.metrics?.val_curve_mae;
            modelHost.innerHTML = `
                <div class="stat-card good"><div class="stat-value">#${m.model_id}</div><div class="stat-label">${escapeHtml(m.name)}</div></div>
                <div class="stat-card"><div class="stat-value">${escapeHtml(m.model_type)}</div><div class="stat-label">${escapeHtml(m.version || 'v0.0.1')}</div></div>
                <div class="stat-card ${mae && mae < 0.05 ? 'good' : 'warn'}"><div class="stat-value">${fmtNumber(mae)}</div><div class="stat-label">val_curve_mae</div></div>
                <div class="stat-card purple"><div class="stat-value">${fmtDate(m.deployed_at)}</div><div class="stat-label">部署时间</div></div>
            `;
            $('btn-rollback').disabled = false;
            $('btn-rollback').dataset.modelId = m.model_id;
        }
    } catch (e) {
        modelHost.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }

    // 系统状态
    const sysHost = $('system-stats');
    try {
        const [sets, models, jobs] = await Promise.all([
            apiGet('/api/spawn-tuning-v2/sample-sets?limit=500'),
            apiGet('/api/spawn-tuning-v2/models?limit=500'),
            apiGet('/api/spawn-tuning-v2/jobs?limit=500'),
        ]);
        const runningJob = (jobs.jobs || []).filter((j) => j.status === 'running').length;
        const queuedJob = (jobs.jobs || []).filter((j) => j.status === 'queued').length;
        sysHost.innerHTML = `
            <div class="stat-card"><div class="stat-value">${sets.total || sets.count || 0}</div><div class="stat-label">样本集</div></div>
            <div class="stat-card"><div class="stat-value">${models.count || 0}</div><div class="stat-label">模型</div></div>
            <div class="stat-card ${runningJob > 0 ? 'good' : ''}"><div class="stat-value">${runningJob}</div><div class="stat-label">运行中任务</div></div>
            <div class="stat-card ${queuedJob > 0 ? 'warn' : ''}"><div class="stat-value">${queuedJob}</div><div class="stat-label">排队任务</div></div>
        `;
    } catch (e) {
        sysHost.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }
}

async function rollbackCurrent() {
    const modelId = $('btn-rollback').dataset.modelId;
    if (!modelId) return;
    if (!confirm(`确认回滚当前 deployed 模型 #${modelId}? 自动激活上一版.`)) return;
    try {
        const r = await apiSend('POST', `/api/spawn-tuning-v2/models/${modelId}/rollback`);
        $('rollback-hint').innerHTML = `<span style="color:var(--good)">✓ 已回滚到模型 #${r.now_deployed || 'none'}</span>`;
        refreshOverview();
    } catch (e) {
        $('rollback-hint').innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`;
    }
}


// ─────────── ② 样本集 ───────────

let _chipsWeights = {};
let _activePreset = null;
let _samplerCancel = { cancelled: false };

function setupChips() {
    document.querySelectorAll('.chip-group .chip').forEach((c) => {
        c.dataset.weight = '1';
        c.addEventListener('click', (e) => {
            if (e.altKey || e.shiftKey) { editChipWeight(c); return; }
            c.classList.toggle('chip-on');
            updateEstimate();
        });
        c.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            editChipWeight(c);
        });
    });
    $('btn-dim-reset').addEventListener('click', () => {
        document.querySelectorAll('.chip-group .chip').forEach((c) => {
            c.classList.add('chip-on');
            c.dataset.weight = '1';
            c.querySelector('.chip-weight-badge')?.remove();
        });
        updateEstimate();
    });
    document.querySelectorAll('.preset-btn').forEach((b) => {
        b.addEventListener('click', () => applyPreset(b.dataset.preset, b));
    });
    ['cfg-thetas', 'cfg-seeds', 'cfg-max-steps'].forEach((id) => {
        $(id).addEventListener('input', updateEstimate);
    });
}

function editChipWeight(chip) {
    const cur = Number(chip.dataset.weight || 1);
    const val = prompt(`「${chip.dataset.val}」采样权重 (1-9, 默认 1, 越大该值越频繁出现):`, String(cur));
    if (val === null) return;
    const w = Math.max(1, Math.min(9, Math.round(Number(val) || 1)));
    chip.dataset.weight = String(w);
    chip.querySelector('.chip-weight-badge')?.remove();
    if (w > 1) {
        const b = document.createElement('span');
        b.className = 'chip-weight-badge';
        b.textContent = `×${w}`;
        chip.appendChild(b);
    }
    if (w > 1) chip.classList.add('chip-on');
    updateEstimate();
}

function readChipsSelection() {
    const out = {};
    document.querySelectorAll('.chip-group').forEach((g) => {
        const dim = g.dataset.dim;
        out[dim] = [...g.querySelectorAll('.chip.chip-on')].map((c) => ({
            val: c.dataset.val,
            weight: Number(c.dataset.weight || 1),
        }));
    });
    return out;
}

function applyPreset(key, btn) {
    const p = PRESETS[key];
    if (!p) return;
    $('cfg-thetas').value = String(p.thetas);
    $('cfg-seeds').value = String(p.seeds);
    $('cfg-max-steps').value = String(p.maxSteps);
    document.querySelectorAll('.preset-btn').forEach((b) => b.classList.toggle('preset-active', b === btn));
    $('active-preset').textContent = `(已应用: ${p.label})`;
    _activePreset = key;
    updateEstimate();
}

function _cartesianWeighted(sel) {
    /** 5 维 chips 按权重展开 → contexts 数组 (高权重 ctx 重复出现) */
    const dims = ['difficulty', 'generator', 'bot_policy', 'pb_bin', 'lifecycle_stage'];
    if (dims.some((d) => !sel[d] || sel[d].length === 0)) return [];
    let ctxs = [{}];
    for (const dim of dims) {
        const next = [];
        for (const c of ctxs) {
            for (const v of sel[dim]) {
                // 权重 = product of chip weights
                for (let i = 0; i < v.weight; i++) {
                    next.push({ ...c, [dim]: dim === 'pb_bin' ? Number(v.val) : v.val });
                }
            }
        }
        ctxs = next;
    }
    return ctxs;
}

function updateEstimate() {
    const sel = readChipsSelection();
    const contexts = _cartesianWeighted(sel);
    const nThetas = Math.max(1, Number($('cfg-thetas').value) || 1);
    const nSeeds = Math.max(1, Number($('cfg-seeds').value) || 1);
    const maxSteps = Math.max(20, Number($('cfg-max-steps').value) || 120);

    // 每维度选中数
    for (const dim of Object.keys(ALL_DIM_VALUES)) {
        const c = document.querySelector(`[data-count="${dim}"]`);
        if (c) c.textContent = `${(sel[dim] || []).length}/${ALL_DIM_VALUES[dim].length}`;
    }

    const ctxCount = contexts.length;
    $('dim-count').textContent = String(ctxCount);
    $('dim-count').style.color = ctxCount === 0 ? 'var(--bad)' : 'var(--accent)';

    const total = ctxCount * nThetas * nSeeds;
    // 估算: 每样本 ≈ maxSteps × 0.012s (浏览器 worker 单线程)
    const etaSec = total * maxSteps * 0.012;
    $('est-ctx').textContent = `${ctxCount} 场景`;
    $('est-theta').textContent = `${nThetas} θ`;
    $('est-seed').textContent = `${nSeeds} seed`;
    $('est-total').textContent = `${total.toLocaleString()} 样本`;
    if (etaSec < 60) $('est-eta').textContent = `~${Math.round(etaSec)}s`;
    else if (etaSec < 3600) $('est-eta').textContent = `~${(etaSec / 60).toFixed(1)}m`;
    else $('est-eta').textContent = `~${(etaSec / 3600).toFixed(1)}h`;

    $('btn-start-collect').disabled = ctxCount === 0;
}

function _lhsThetas(n) {
    const THETA_RANGES = {
        pbTension_strength: [0.1, 1.0], pbBrake_slope: [2, 8], pbBrake_center: [0.85, 0.98],
        pbOvershoot_decay: [0.1, 0.4], pbSurprise_rate: [0.02, 0.15],
        personalizationStrength: [0.05, 0.18], temperature: [0.03, 0.08],
        surpriseBudgetGain: [0.05, 0.10], surpriseCooldown: [4, 10],
        maxEvaluatedTriplets: [32, 128], tripletBaseTemp: [0.5, 2.0],
        floorBoost: [0.0, 0.3], cornerPenalty: [0.0, 0.4], lineBonusWeight: [0.5, 2.0],
    };
    const keys = Object.keys(THETA_RANGES);
    const out = Array.from({ length: n }, () => ({}));
    for (const k of keys) {
        const [lo, hi] = THETA_RANGES[k];
        const segs = Array.from({ length: n }, (_, i) => (i + Math.random()) / n);
        for (let i = segs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [segs[i], segs[j]] = [segs[j], segs[i]];
        }
        segs.forEach((v, i) => { out[i][k] = lo + v * (hi - lo); });
    }
    return out;
}

async function startCollect() {
    const sel = readChipsSelection();
    const contexts = _cartesianWeighted(sel);
    if (contexts.length === 0) {
        $('collect-hint').innerHTML = '<span style="color:var(--bad)">每维度至少选 1 个</span>';
        return;
    }
    const nThetas = Math.max(2, Number($('cfg-thetas').value) || 5);
    const nSeeds = Math.max(1, Number($('cfg-seeds').value) || 2);
    const maxSteps = Math.max(30, Number($('cfg-max-steps').value) || 120);
    const setName = $('cfg-set-name').value.trim() || `v2-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '')}`;
    const total = contexts.length * nThetas * nSeeds;
    if (total > 5000 && !confirm(`大任务: ${total} 样本, 确认启动?`)) return;

    $('btn-start-collect').disabled = true;
    $('btn-cancel-collect').disabled = false;
    _samplerCancel = { cancelled: false };

    // 1. 创建样本集
    let setId;
    try {
        const r = await apiSend('POST', '/api/spawn-tuning-v2/sample-sets', {
            name: setName,
            description: `Auto-collected via chips (${contexts.length} ctx × ${nThetas} θ × ${nSeeds} seed)`,
            config: { contexts: contexts.length, thetas: nThetas, seeds: nSeeds, max_steps: maxSteps, preset: _activePreset },
            tags: ['v2', _activePreset || 'manual'].join(','),
        });
        setId = r.set_id;
        $('collect-hint').innerHTML = `<span style="color:var(--accent)">✓ 创建 set #${setId}, 开始采集…</span>`;
    } catch (e) {
        $('collect-hint').innerHTML = `<span style="color:var(--bad)">创建失败: ${escapeHtml(e.message)}</span>`;
        $('btn-start-collect').disabled = false;
        $('btn-cancel-collect').disabled = true;
        return;
    }

    // 2. 采集
    const thetas = _lhsThetas(nThetas);
    try {
        const result = await collectSamplesV2({
            setId, contexts, thetas, seedsPerTheta: nSeeds, maxSteps,
            apiBaseUrl: API_BASE, batchSize: 10,
            onProgress: (p) => {
                if (_samplerCancel.cancelled) return;
                $('collect-hint').innerHTML = `set #${setId} · ${p.completed}/${p.total} (${Math.round(p.percent * 100)}%)${p.failed ? ` · ${p.failed} 失败` : ''}`;
            },
        });
        $('collect-hint').innerHTML = `<span style="color:var(--good)">✓ set #${setId} 完成: ${result.completed}/${result.total}${result.failed ? ` (${result.failed} 失败)` : ''}</span>`;
        // 标记完成
        await apiSend('PATCH', `/api/spawn-tuning-v2/sample-sets/${setId}`, { status: 'completed' });
        refreshSampleSets();
    } catch (e) {
        $('collect-hint').innerHTML = `<span style="color:var(--bad)">采集失败: ${escapeHtml(e.message)}</span>`;
    } finally {
        $('btn-start-collect').disabled = false;
        $('btn-cancel-collect').disabled = true;
    }
}

async function refreshSampleSets() {
    const tbody = $('sets-table').querySelector('tbody');
    const status = $('filter-status').value;
    try {
        const url = `/api/spawn-tuning-v2/sample-sets?limit=100${status ? `&status=${status}` : ''}`;
        const data = await apiGet(url);
        if (!data.sample_sets?.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="muted-hint">无样本集 — 在上方配置 chips + 启动采集</td></tr>';
            return;
        }
        tbody.innerHTML = data.sample_sets.map((s) => `
            <tr>
              <td><code>#${s.set_id}</code></td>
              <td>${escapeHtml(s.name)}</td>
              <td>${s.sample_count || 0}</td>
              <td><span class="status ${s.status}">${s.status}</span></td>
              <td style="font-size:10.5px; color:var(--muted)">${escapeHtml(s.tags || '-')}</td>
              <td>${fmtDate(s.created_at)}</td>
              <td>
                <button class="ghost btn-train-from" data-id="${s.set_id}">→ 训练</button>
                <button class="ghost btn-analyze-from" data-id="${s.set_id}">📊 分析</button>
                <button class="danger btn-delete-set" data-id="${s.set_id}">删</button>
              </td>
            </tr>
        `).join('');
        tbody.querySelectorAll('.btn-train-from').forEach((b) => {
            b.addEventListener('click', () => {
                $('job-sets').value = b.dataset.id;
                document.querySelector('.tab[data-tab="training"]').click();
            });
        });
        tbody.querySelectorAll('.btn-analyze-from').forEach((b) => {
            b.addEventListener('click', () => {
                document.querySelector('.tab[data-tab="analysis"]').click();
                setTimeout(() => {
                    refreshCurveSetSelector().then(() => {
                        $('curve-set').value = b.dataset.id;
                        renderCurve();
                    });
                }, 100);
            });
        });
        tbody.querySelectorAll('.btn-delete-set').forEach((b) => {
            b.addEventListener('click', async () => {
                if (!confirm(`删除样本集 #${b.dataset.id}? 包含的样本也会一并删除.`)) return;
                await apiSend('DELETE', `/api/spawn-tuning-v2/sample-sets/${b.dataset.id}`);
                refreshSampleSets();
            });
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="muted-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}


// ─────────── ③ 模型训练 ───────────

async function submitJob() {
    const setIds = $('job-sets').value.split(',').map((s) => parseInt(s.trim())).filter((x) => Number.isInteger(x) && x > 0);
    if (setIds.length === 0) {
        $('job-hint').innerHTML = '<span style="color:var(--bad)">需要至少 1 个样本集 ID</span>';
        return;
    }
    const body = {
        name: $('job-name').value || `job-${Date.now()}`,
        sample_set_ids: setIds,
        model_type: 'resnet',
        arch: {
            epochs: Number($('job-epochs').value) || 50,
            batch_size: Number($('job-batch').value) || 256,
            lr: Number($('job-lr').value) || 1e-3,
            device: $('job-device').value || 'cpu',
        },
    };
    const baseId = Number($('job-base').value);
    if (baseId > 0) body.base_model_id = baseId;
    try {
        const r = await apiSend('POST', '/api/spawn-tuning-v2/jobs', body);
        $('job-hint').innerHTML = `<span style="color:var(--good)">✓ 已提交 #${r.job_id} (queued, 后台执行器自动运行)</span>`;
        refreshJobs();
    } catch (e) {
        $('job-hint').innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`;
    }
}

async function refreshJobs() {
    const tbody = $('jobs-table').querySelector('tbody');
    try {
        const data = await apiGet('/api/spawn-tuning-v2/jobs?limit=30');
        if (!data.jobs?.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="muted-hint">无任务</td></tr>';
            return;
        }
        tbody.innerHTML = data.jobs.map((j) => `
            <tr>
              <td><code>#${j.job_id}</code></td>
              <td>${escapeHtml(j.name || '-')}</td>
              <td><span class="status ${j.status}">${j.status}</span></td>
              <td><code>${escapeHtml(j.sample_set_ids || '-')}</code></td>
              <td>${fmtNumber(j.val_curve_mae)}</td>
              <td>${fmtNumber(j.val_balance)}</td>
              <td>${j.epochs_done || 0}</td>
              <td>${fmtDate(j.created_at)}</td>
              <td>${j.output_model_id ? `<button class="ghost btn-view-model" data-id="${j.output_model_id}">查看模型</button>` : ''}</td>
            </tr>
        `).join('');
        tbody.querySelectorAll('.btn-view-model').forEach((b) => {
            b.addEventListener('click', () => refreshModels());
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted-hint">${escapeHtml(e.message)}</td></tr>`;
    }
}

async function refreshModels() {
    const tbody = $('models-table').querySelector('tbody');
    try {
        const data = await apiGet('/api/spawn-tuning-v2/models?limit=30');
        if (!data.models?.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="muted-hint">无模型</td></tr>';
            return;
        }
        tbody.innerHTML = data.models.map((m) => `
            <tr>
              <td><code>#${m.model_id}</code></td>
              <td>${escapeHtml(m.name)}</td>
              <td>${escapeHtml(m.version || '-')}</td>
              <td>${escapeHtml(m.model_type)}</td>
              <td>${m.parent_model_id ? `<code>#${m.parent_model_id}</code>` : '-'}</td>
              <td>${fmtNumber(m.metrics?.val_curve_mae)}</td>
              <td><span class="status ${m.status}">${m.status}</span></td>
              <td>${fmtDate(m.created_at)}</td>
              <td>
                ${m.status === 'staging' || m.status === 'archived' || m.status === 'rollbacked'
                    ? `<button class="ghost btn-deploy" data-id="${m.model_id}">部署</button>` : ''}
                ${m.status === 'deployed' ? `<button class="danger btn-rb" data-id="${m.model_id}">回滚</button>` : ''}
              </td>
            </tr>
        `).join('');
        tbody.querySelectorAll('.btn-deploy').forEach((b) => {
            b.addEventListener('click', async () => {
                if (!confirm(`部署模型 #${b.dataset.id}? 当前 deployed 会被 archived.`)) return;
                await apiSend('POST', `/api/spawn-tuning-v2/models/${b.dataset.id}/deploy`);
                refreshModels(); refreshOverview();
            });
        });
        tbody.querySelectorAll('.btn-rb').forEach((b) => {
            b.addEventListener('click', async () => {
                if (!confirm(`回滚模型 #${b.dataset.id}?`)) return;
                await apiSend('POST', `/api/spawn-tuning-v2/models/${b.dataset.id}/rollback`);
                refreshModels(); refreshOverview();
            });
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted-hint">${escapeHtml(e.message)}</td></tr>`;
    }
}


// ─────────── ④ 部署与监控 ───────────

async function exportBundle() {
    const src = $('bundle-src').value.trim();
    if (!src) { $('bundle-hint').innerHTML = '<span style="color:var(--bad)">需要 policies.json 路径</span>'; return; }
    const rolloutPct = Number($('bundle-rollout').value);
    try {
        const r = await apiSend('POST', '/api/spawn-tuning-v2/policies/bundle/export', {
            source: src, rollout_pct: rolloutPct, include_miniprogram: true,
        });
        if (r.ok) {
            $('bundle-hint').innerHTML = `<span style="color:var(--good)">✓ ${r.policies_count} policies · ${(r.bundle_size_bytes/1024).toFixed(1)} KB · sha256=${r.sha256.slice(0,12)}…</span>`;
            refreshBundleStatus();
        } else {
            $('bundle-hint').innerHTML = `<span style="color:var(--bad)">${escapeHtml(r.error)}</span>`;
        }
    } catch (e) {
        $('bundle-hint').innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`;
    }
}

async function refreshBundleStatus() {
    const host = $('bundle-status-cards');
    try {
        const r = await apiGet('/api/spawn-tuning-v2/policies/bundle/status');
        if (!r.exists) {
            host.innerHTML = '<div class="stat-card warn"><div class="stat-value">未烘焙</div><div class="stat-label">点击上方按钮生成</div></div>';
            return;
        }
        const m = r.meta || {};
        host.innerHTML = `
            <div class="stat-card good"><div class="stat-value">${m.n_contexts || 0}</div><div class="stat-label">contexts</div></div>
            <div class="stat-card"><div class="stat-value">${(r.bundle_size_bytes/1024).toFixed(1)} KB</div><div class="stat-label">大小</div></div>
            <div class="stat-card ${m.rollout_pct === 100 ? 'good' : 'warn'}"><div class="stat-value">${m.rollout_pct || 0}%</div><div class="stat-label">灰度比例</div></div>
            <div class="stat-card purple"><div class="stat-value">${fmtDate(r.modified_at)}</div><div class="stat-label">烘焙时间</div></div>
        `;
    } catch (e) {
        host.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }
}

async function loadFieldMetrics() {
    const hours = Number($('field-hours').value) || 24;
    const ctx = $('field-ctx').value.trim();
    const host = $('field-stats');
    try {
        const url = `/api/spawn-tuning-v2/field-metrics/aggregate?hours=${hours}${ctx ? `&context_key=${encodeURIComponent(ctx)}` : ''}`;
        const r = await apiGet(url);
        if (r.n_episodes === 0) {
            host.innerHTML = '<div class="stat-card muted"><div class="stat-value">0</div><div class="stat-label">无玩家数据 (等 v2 模型上线后回流)</div></div>';
            return;
        }
        host.innerHTML = `
            <div class="stat-card good"><div class="stat-value">${r.n_episodes}</div><div class="stat-label">episodes (${hours}h)</div></div>
            <div class="stat-card"><div class="stat-value">${(r.pb_broke_rate * 100).toFixed(1)}%</div><div class="stat-label">破 PB 率</div></div>
            <div class="stat-card ${r.noMove_rate > 0.3 ? 'bad' : ''}"><div class="stat-value">${(r.noMove_rate * 100).toFixed(1)}%</div><div class="stat-label">死局率</div></div>
            <div class="stat-card purple"><div class="stat-value">${Math.round(r.mean_score)}</div><div class="stat-label">均分</div></div>
        `;
    } catch (e) {
        host.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }
}


// ─────────── ⑤ d_curve 分析 ───────────

async function refreshCurveSetSelector() {
    const sel = $('curve-set');
    if (!sel) return;
    const prev = sel.value;
    try {
        const data = await apiGet('/api/spawn-tuning-v2/sample-sets?limit=100');
        sel.innerHTML = '<option value="">— 不加载实测 —</option>' +
            (data.sample_sets || []).map((s) => `<option value="${s.set_id}">#${s.set_id} ${escapeHtml(s.name)} (${s.sample_count || 0})</option>`).join('');
        if (prev) sel.value = prev;
    } catch (e) {
        sel.innerHTML = `<option value="">${escapeHtml(e.message)}</option>`;
    }
}

async function renderCurve() {
    const setId = $('curve-set').value;
    const groupBy = $('curve-group-by').value.trim();
    const predictSrc = $('curve-predict-src').value;
    const meta = $('curve-meta');
    meta.textContent = '加载中…';

    try {
        const targetResp = await apiGet('/api/spawn-tuning-v2/target-curve');
        const target = targetResp.curve;

        let observed = null;
        let nSamples = 0;
        if (setId) {
            const url = `/api/spawn-tuning-v2/sample-sets/${setId}/aggregate${groupBy ? `?group_by=${encodeURIComponent(groupBy)}` : ''}`;
            const data = await apiGet(url);
            if (data.buckets?.length > 0) {
                observed = data.buckets[0].d_curve_avg;
                nSamples = data.buckets[0].n_samples;
            }
        }

        // 预测: 目前没真模型推断,用 target 作占位 (将来扩展)
        const predicted = predictSrc === 'target' ? target : (observed || target);

        const canvas = $('d-curve-canvas');
        renderDCurveChart(canvas, {
            targetCurve: target,
            predictedCurve: predicted,
            observedCurve: observed,
        });

        const lines = [];
        if (observed) {
            const m = computeChartMetrics(observed, target);
            lines.push(`实测 vs 目标 MAE = ${fmtNumber(m.mae, 4)}`);
            lines.push(`实测单调 = ${m.monotonic ? '✓' : '✗'}`);
            lines.push(`n_samples = ${nSamples}`);
        }
        if (predictSrc === 'target') lines.push('预测 = 目标 (占位, 未来接模型推断)');
        meta.innerHTML = lines.join(' · ');
    } catch (e) {
        meta.innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`;
    }
}


// ─────────── 启动 ───────────

function bindEvents() {
    setupTabs();
    setupChips();
    $('btn-rollback').addEventListener('click', rollbackCurrent);
    $('btn-start-collect').addEventListener('click', startCollect);
    $('btn-cancel-collect').addEventListener('click', () => { _samplerCancel.cancelled = true; });
    $('btn-refresh-sets').addEventListener('click', refreshSampleSets);
    $('filter-status').addEventListener('change', refreshSampleSets);
    $('btn-submit-job').addEventListener('click', submitJob);
    $('btn-refresh-jobs').addEventListener('click', refreshJobs);
    $('btn-refresh-models').addEventListener('click', refreshModels);
    $('btn-export-bundle').addEventListener('click', exportBundle);
    $('btn-bundle-status').addEventListener('click', refreshBundleStatus);
    $('btn-load-field').addEventListener('click', loadFieldMetrics);
    $('btn-render-curve').addEventListener('click', renderCurve);
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    refreshOverview();
});
