/**
 * 出块算法优化 (Spawn Algorithm Tuning) v2 看板逻辑。
 *
 * 5 tab 业务流程:
 *   ① 概览       — 当前 deployed 模型 + 一键回滚 + 系统状态
 *   ② 样本集     — chips 多选采集 + Run 库管理
 *   ③ 模型训练   — 提交 job + 队列 + 模型库 (deploy/rollback)
 *   ④ 部署与监控 — 导出 bundle + 真实玩家 d_curve 聚合
 *   ⑤ 分析       — 目标 vs 预测 vs 实测三线对照
 */

import { collectSamplesV2, runOneSampleV2 } from './samplerV2.js';
import { renderDCurveChart, computeChartMetrics } from './dCurveChart.js';
import { getApiBaseUrl } from '../../config.js';

const $ = (id) => document.getElementById(id);
const API_BASE = getApiBaseUrl().replace(/\/+$/, '');

// ─────────── 美化通知系统 ───────────

/** 注入通知样式 */
(function _injectToastStyle() {
    if (document.getElementById('__openblock_toast_style')) return;
    const s = document.createElement('style');
    s.id = '__openblock_toast_style';
    s.textContent = `
    .openblock-toast {
        position: fixed; top: 20px; right: 20px; z-index: 99999;
        display: flex; align-items: center; gap: 10px;
        padding: 12px 20px; border-radius: 10px;
        font-size: 13px; line-height: 1.4; max-width: 420px;
        background: #1e293b; border: 1px solid #334155;
        box-shadow: 0 8px 32px rgba(0,0,0,.45);
        transform: translateX(120%); opacity: 0;
        transition: transform .32s cubic-bezier(.22,1,.36,1), opacity .26s;
        pointer-events: auto;
    }
    .openblock-toast.show { transform: translateX(0); opacity: 1; }
    .openblock-toast.success { border-left: 4px solid #22c55e; }
    .openblock-toast.error  { border-left: 4px solid #ef4444; }
    .openblock-toast.warn   { border-left: 4px solid #eab308; }
    .openblock-toast.info   { border-left: 4px solid #38bdf8; }
    .openblock-toast .icon { font-size: 18px; flex-shrink: 0; }
    .openblock-toast .msg  { flex:1; color: #e2e8f0; word-break: break-word; }
    .openblock-toast .close {
        flex-shrink: 0; cursor: pointer; font-size: 16px; color: #64748b;
        background: none; border: none; padding: 2px 4px; line-height: 1;
    }
    .openblock-toast .close:hover { color: #f1f5f9; }

    .openblock-modal-backdrop {
        position: fixed; inset:0; z-index: 99998;
        background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(3px); animation: fadeIn .2s ease;
    }
    .openblock-modal-box {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid #334155; border-radius: 14px;
        padding: 28px 30px 22px; max-width: 480px; width: 90%;
        box-shadow: 0 24px 64px rgba(0,0,0,.55);
        animation: modalSlide .25s cubic-bezier(.22,1,.36,1);
    }
    .openblock-modal-box .modal-header {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 16px; font-size: 15px; font-weight: 600; color: #f1f5f9;
    }
    .openblock-modal-box .modal-header .icon { font-size: 20px; }
    .openblock-modal-box .msg {
        color: #cbd5e1; font-size: 13.5px; line-height: 1.6;
        margin-bottom: 20px; white-space: pre-wrap;
        padding-left: 2px;
    }
    .openblock-modal-box .msg .highlight { color: #f1f5f9; font-weight: 500; }
    .openblock-modal-box .actions {
        display: flex; gap: 10px; justify-content: flex-end;
        border-top: 1px solid #1e293b; padding-top: 16px;
    }
    .openblock-modal-box .actions button {
        padding: 8px 22px; border-radius: 8px; font-size: 13px; font-weight: 500;
        cursor: pointer; border: 1px solid transparent;
        transition: all .18s; text-align: center; display: inline-flex;
        align-items: center; justify-content: center; min-width: 80px;
        line-height: 1; letter-spacing: .3px;
    }
    .openblock-modal-box .actions .btn-cancel {
        background: transparent; border-color: #334155; color: #94a3b8;
    }
    .openblock-modal-box .actions .btn-cancel:hover {
        background: #1e293b; border-color: #475569; color: #e2e8f0;
    }
    .openblock-modal-box .actions .btn-confirm {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        color: #fff; border-color: #ef4444; box-shadow: 0 2px 8px rgba(239,68,68,.25);
    }
    .openblock-modal-box .actions .btn-confirm:hover {
        background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
        box-shadow: 0 4px 14px rgba(239,68,68,.35); transform: translateY(-1px);
    }
    .openblock-modal-box .actions .btn-primary {
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        color: #fff; border-color: #3b82f6; box-shadow: 0 2px 8px rgba(59,130,246,.25);
    }
    .openblock-modal-box .actions .btn-primary:hover {
        background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
        box-shadow: 0 4px 14px rgba(59,130,246,.35); transform: translateY(-1px);
    }
    @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
    @keyframes modalSlide { from { opacity: 0; transform: scale(.94) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    `;
    document.head.appendChild(s);
})();

/** 显示浮动通知 (auto-dismiss 3.5s) */
function showNotification(msg, type = 'info') {
    const iconMap = { success: '✓', error: '✗', warn: '⚠', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = `openblock-toast ${type}`;
    el.innerHTML = `<span class="icon">${iconMap[type] || 'ℹ'}</span><span class="msg">${escapeHtml(msg)}</span><button class="close">×</button>`;
    el.querySelector('.close').onclick = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); };
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 3500);
}

/** 美化确认弹窗 (返回 Promise<boolean>)
 *  @param {string} msg - 消息正文
 *  @param {object} [opts]
 *  @param {string} [opts.title] - 标题, 默认 "⚠ 确认操作"
 *  @param {string} [opts.confirmLabel] - 确认按钮文字, 默认 "确认"
 *  @param {string} [opts.confirmType] - 'danger'|'primary', 默认 'danger'
 */
function showConfirmDialog(msg, opts = {}) {
    const title = opts.title || '⚠ 确认操作';
    const confirmLabel = opts.confirmLabel || '确认';
    const confirmBtnClass = opts.confirmType === 'primary' ? 'btn-primary' : 'btn-confirm';
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'openblock-modal-backdrop';
        const titleParts = title.match(/^(\S+)\s+(.*)/) || ['', '', title];
        const iconChar = titleParts[1];
        const titleText = titleParts[2];
        backdrop.innerHTML = `<div class="openblock-modal-box">
            <div class="modal-header"><span class="icon">${escapeHtml(iconChar)}</span><span>${escapeHtml(titleText)}</span></div>
            <div class="msg">${escapeHtml(msg)}</div>
            <div class="actions">
                <button class="btn-cancel" data-action="cancel">取消</button>
                <button class="${confirmBtnClass}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
            </div>
        </div>`;
        document.body.appendChild(backdrop);
        backdrop.querySelector('.btn-cancel').onclick = () => { backdrop.remove(); resolve(false); };
        backdrop.querySelector(`.${confirmBtnClass}`).onclick = () => { backdrop.remove(); resolve(true); };
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(false); } });
    });
}

/** 美化输入弹窗 (返回 Promise<string|null>, null = 取消) */
function showPromptDialog(msg, defaultValue = '') {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'openblock-modal-backdrop';
        backdrop.innerHTML = `<div class="openblock-modal-box">
            <div class="modal-header"><span class="icon">✏</span><span>输入</span></div>
            <div class="msg" style="margin-bottom:12px;">${escapeHtml(msg)}</div>
            <input class="modal-input" type="number" value="${escapeHtml(defaultValue)}" min="1" max="9" autofocus
                style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:18px;">
            <div class="actions">
                <button class="btn-cancel" data-action="cancel">取消</button>
                <button class="btn-primary" data-action="confirm">确认</button>
            </div>
        </div>`;
        const input = backdrop.querySelector('.modal-input');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { backdrop.remove(); resolve(input.value); }
            if (e.key === 'Escape') { backdrop.remove(); resolve(null); }
        });
        document.body.appendChild(backdrop);
        setTimeout(() => input.focus(), 50);
        input.select();
        backdrop.querySelector('.btn-cancel').onclick = () => { backdrop.remove(); resolve(null); };
        backdrop.querySelector('.btn-primary').onclick = () => { backdrop.remove(); resolve(input.value); };
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(null); } });
    });
}

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
    prod:   { thetas: 15, seeds: 2, maxSteps: 240, label: '🏭 生产训练 (~1 小时)' },
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
            else if (id === 'samples') {
                refreshSampleSets();
                updateEstimate();
                showChipsOnboardingHintIfNeeded();
            }
            else if (id === 'training') {
                refreshJobs();
                refreshModels();
                refreshBaseModelOptions();
                refreshTrainingSampleSetOptions();
                refreshDeviceOptions();
            }
            else if (id === 'deploy') { refreshBundleStatus(); refreshBundleModelOptions(); }
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

    // 系统状态 (单次聚合 query, 替代之前 3 次 list 请求)
    const sysHost = $('system-stats');
    try {
        const s = await apiGet('/api/spawn-tuning-v2/stats/overview');
        const running = s.jobs_by_status?.running || 0;
        const queued = s.jobs_by_status?.queued || 0;
        const totalModels = Object.values(s.models_by_status || {}).reduce((a, b) => a + b, 0);
        const deployedModels = s.models_by_status?.deployed || 0;
        const trainH = Math.floor((s.total_training_seconds || 0) / 3600);
        const trainM = Math.round(((s.total_training_seconds || 0) % 3600) / 60);
        const trainLabel = trainH > 0 ? `${trainH}h${trainM}m` : `${trainM}m`;
        const maeLabel = s.last_7d_field_d_mae == null ? '—' : s.last_7d_field_d_mae.toFixed(4);
        const maeClass = s.last_7d_field_d_mae == null
            ? 'muted'
            : (s.last_7d_field_d_mae < 0.08 ? 'good' : (s.last_7d_field_d_mae < 0.15 ? 'warn' : 'bad'));
        sysHost.innerHTML = `
            <div class="stat-card"><div class="stat-value">${s.n_sample_sets}</div><div class="stat-label">样本集 (含 ${(s.n_samples || 0).toLocaleString()} 样本)</div></div>
            <div class="stat-card ${deployedModels > 0 ? 'good' : ''}"><div class="stat-value">${totalModels}<span style="font-size:11px; color:var(--muted)"> · ${deployedModels} dep</span></div><div class="stat-label">模型 (deployed)</div></div>
            <div class="stat-card ${running > 0 ? 'good' : ''}"><div class="stat-value">${running}<span style="font-size:11px; color:var(--muted)"> / ${queued} q</span></div><div class="stat-label">运行 / 排队</div></div>
            <div class="stat-card purple"><div class="stat-value">${trainLabel}</div><div class="stat-label">训练总时长</div></div>
            <div class="stat-card ${maeClass}"><div class="stat-value">${maeLabel}</div><div class="stat-label">7d 真人 D-MAE</div></div>
        `;
    } catch (e) {
        sysHost.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }
}

async function rollbackCurrent() {
    const modelId = $('btn-rollback').dataset.modelId;
    if (!modelId) return;
    if (!(await showConfirmDialog(`模型 #${modelId} 将回滚为上一版。`, { title: `↩ 回滚 deployed 模型`, confirmLabel: '确认回滚' }))) return;
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

const CHIPS_ONBOARD_KEY = 'spawn-tuning-v2:chips-weight-onboarded';

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

/** 首次进入 ② 样本集 tab 时展示一次 "右键 = 设权重" 气泡引导, 之后不再出现。 */
function showChipsOnboardingHintIfNeeded() {
    try {
        if (localStorage.getItem(CHIPS_ONBOARD_KEY)) return;
    } catch { /* 隐私浏览/storage 不可用 → 仍然展示一次 */ }

    const firstChip = document.querySelector('.dim-row[data-onboard-target] .chip')
        || document.querySelector('.chip-group .chip');
    if (!firstChip) return;

    firstChip.classList.add('chip-onboard-pulse');

    const bubble = document.createElement('div');
    bubble.className = 'chip-hint-bubble';
    bubble.innerHTML = `💡 试试右键 (或 Alt+单击) 给这块标签设权重 1-9 — 重要场景采样更密<button class="chip-hint-close" aria-label="关闭">×</button>`;
    bubble.style.top = (firstChip.offsetTop + firstChip.offsetHeight + 8) + 'px';
    bubble.style.left = Math.max(0, firstChip.offsetLeft - 4) + 'px';
    firstChip.parentElement.style.position = 'relative';
    firstChip.parentElement.appendChild(bubble);

    const dismiss = () => {
        bubble.remove();
        firstChip.classList.remove('chip-onboard-pulse');
        try { localStorage.setItem(CHIPS_ONBOARD_KEY, '1'); } catch { /* ignore */ }
    };
    bubble.querySelector('.chip-hint-close').addEventListener('click', dismiss);
    // 点击 chip / 5s 自动关
    firstChip.addEventListener('click', dismiss, { once: true });
    firstChip.addEventListener('contextmenu', dismiss, { once: true });
    setTimeout(dismiss, 8000);
}

function editChipWeight(chip) {
    const cur = Number(chip.dataset.weight || 1);
    showPromptDialog(`「${chip.dataset.val}」采样权重 (1-9, 默认 1, 越大该值越频繁出现)`, String(cur)).then((val) => {
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
    });
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

// v2.2: 9 维 θ 与 Python feature_io.THETA_KEYS / THETA_RANGES 严格一致;
// 任何修改都需要双端同步, 否则训练样本与模型预测会错位。
const THETA_RANGES_V2 = {
    personalizationStrength: [0.05, 0.18],
    temperature: [0.03, 0.08],
    surpriseBudgetGain: [0.05, 0.10],
    surpriseCooldown: [4, 10],
    maxEvaluatedTriplets: [32, 128],
    // v2.2: PB 双 S 曲线参数 (与 DEFAULT_PB_CURVE_PARAMS 对齐, 默认值取中点)
    pbTensionCenter: [0.70, 0.92],
    pbTensionWidth:  [0.04, 0.15],
    pbBrakeCenter:   [0.98, 1.15],
    pbBrakeWidth:    [0.03, 0.12],
};

function _lhsThetas(n) {
    const keys = Object.keys(THETA_RANGES_V2);
    const out = Array.from({ length: n }, () => ({}));
    for (const k of keys) {
        const [lo, hi] = THETA_RANGES_V2[k];
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
    if (total > 5000) {
        const ok = await showConfirmDialog(`${total} 样本的大任务, 预计耗时较长。确认启动?`, { title: `⚡ 大任务确认`, confirmLabel: `启动 (${total} 样本)` });
        if (!ok) return;
    }

    $('btn-start-collect').disabled = true;
    $('btn-cancel-collect').disabled = false;
    _samplerCancel = { cancelled: false };

    // 0. Smoke test — 跑 1 个 sample 验证 simulator 能正常工作 (避免创建 set 后 N 个全失败)
    $('collect-hint').innerHTML = '<span style="color:var(--muted)">🔧 smoke test (1 sample)…</span>';
    try {
        const smokeTheta = _lhsThetas(1)[0];
        const smokeMaxSteps = Math.min(40, maxSteps);
        runOneSampleV2({ context: contexts[0], theta: smokeTheta, seed: 1, maxSteps: smokeMaxSteps });
    } catch (e) {
        $('collect-hint').innerHTML = `<span style="color:var(--bad)">✗ smoke test 失败, 已取消任务: ${escapeHtml(e.message)}<br><span style="font-size:10.5px;">→ 打开浏览器 Console 查看完整堆栈; 修复后再试</span></span>`;
        $('btn-start-collect').disabled = false;
        $('btn-cancel-collect').disabled = true;
        return;
    }

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
                const errPart = p.firstError
                    ? ` · <span style="color:var(--bad)" title="${escapeHtml(p.firstError)}">⚠ ${escapeHtml(p.firstError.slice(0, 60))}${p.firstError.length > 60 ? '…' : ''}</span>`
                    : '';
                $('collect-hint').innerHTML = `set #${setId} · 进度 ${p.completed}/${p.total} (${Math.round(p.percent * 100)}%)${p.failed ? ` · ${p.failed} 失败` : ''}${errPart}`;
            },
        });
        if (result.failed > 0 && result.completed === 0) {
            $('collect-hint').innerHTML = `<span style="color:var(--bad)">✗ set #${setId} 全部失败 (${result.failed}/${result.total})${result.firstError ? ` · 首错: ${escapeHtml(result.firstError)}` : ''}<br><span style="font-size:10.5px;">→ 打开浏览器 Console 查看完整堆栈; 常见原因: 后端未启动 / OpenBlockSimulator 初始化失败 / fetch 拦截</span></span>`;
            await apiSend('PATCH', `/api/spawn-tuning-v2/sample-sets/${setId}`, { status: 'failed' });
        } else {
            const failNote = result.failed
                ? ` · <span style="color:var(--warn)">${result.failed} 失败${result.firstError ? ` (${escapeHtml(result.firstError.slice(0, 80))})` : ''}</span>`
                : '';
            $('collect-hint').innerHTML = `<span style="color:var(--good)">✓ set #${setId} 完成: ${result.completed}/${result.total}</span>${failNote}`;
            await apiSend('PATCH', `/api/spawn-tuning-v2/sample-sets/${setId}`, { status: 'completed' });
        }
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
        // v2.10.1: algo_version 徽章 — v2.9 老数据 ⚠, v2.10.x 都是 OK
        tbody.innerHTML = data.sample_sets.map((s) => {
            const av = s.algo_version || 'v2.10';
            const avBadge = av === 'v2.9'
                ? '<span style="background:#7f1d1d; color:#fecaca; padding:1px 5px; border-radius:3px; font-size:10px;" title="老算法采样, d_curve 几乎水平, 不建议训练">⚠ v2.9</span>'
                : av.startsWith('v2.10')
                ? `<span style="background:#064e3b; color:#a7f3d0; padding:1px 5px; border-radius:3px; font-size:10px;" title="PB-aware d_step, d_curve 有 S 形">✓ ${av}</span>`
                : '';
            return `
            <tr>
              <td><code>#${s.set_id}</code></td>
              <td>${escapeHtml(s.name)} ${avBadge}</td>
              <td>${s.sample_count || 0}</td>
              <td><span class="status ${s.status}">${s.status}</span></td>
              <td style="font-size:10.5px; color:var(--muted)">${escapeHtml(s.tags || '-')}</td>
              <td>${fmtDate(s.created_at)}</td>
              <td>
                <button class="ghost btn-preview-set" data-id="${s.set_id}" data-name="${escapeHtml(s.name)}">🔍 预览</button>
                <button class="ghost btn-train-from" data-id="${s.set_id}">→ 训练</button>
                <button class="ghost btn-analyze-from" data-id="${s.set_id}">📊 分析</button>
                <button class="danger btn-delete-set" data-id="${s.set_id}">删除</button>
              </td>
            </tr>
        `; }).join('');
        tbody.querySelectorAll('.btn-preview-set').forEach((b) => {
            b.addEventListener('click', () => showSetPreview(b.dataset.id, b.dataset.name));
        });
        tbody.querySelectorAll('.btn-train-from').forEach((b) => {
            b.addEventListener('click', async () => {
                document.querySelector('.tab[data-tab="training"]').click();
                // 先确保选项列表已加载, 再 select 对应 set_id 的 option
                await refreshTrainingSampleSetOptions();
                const targetId = String(b.dataset.id);
                [...$('job-sets').options].forEach((opt) => {
                    opt.selected = (opt.value === targetId);
                });
                $('job-hint').innerHTML = `<span style="color:var(--accent)">已选样本集 #${targetId} — 调整 epochs/batch/lr 后点 "▶ 提交训练任务"</span>`;
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
                if (!(await showConfirmDialog(`样本集 #${b.dataset.id} 包含的样本也会一并删除。`, { title: `🗑 删除样本集 #${b.dataset.id}`, confirmLabel: '确认删除' }))) return;
                await apiSend('DELETE', `/api/spawn-tuning-v2/sample-sets/${b.dataset.id}`);
                refreshSampleSets();
            });
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="muted-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}


// ─────────── ② 样本集 — 数据预览模态 ───────────

const DIM_COLORS = {
    difficulty: ['#60a5fa', '#34d399', '#fbbf24'],
    generator: ['#a78bfa', '#f472b6'],
    bot_policy: ['#34d399', '#60a5fa', '#fbbf24'],
    pb_bin: ['#60a5fa', '#34d399', '#fbbf24', '#fb923c', '#f87171'],
    lifecycle_stage: ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa'],
};
const DIM_LABEL_ZH = {
    difficulty: '游戏难度',
    generator: '出块算法',
    bot_policy: 'Bot 模拟',
    pb_bin: '个人最佳分',
    lifecycle_stage: '生命周期',
};

/** 模态会话状态 (每次 show 重置), 让筛选切换不丢用户选择。 */
const _previewState = {
    setId: null,
    setName: '',
    filters: {},   // { difficulty: [...], generator: [...], ... }; 空对象 = 全集
};

async function showSetPreview(setId, setName) {
    _previewState.setId = setId;
    _previewState.setName = setName;
    _previewState.filters = {};  // 每次打开重置筛选
    const modal = $('preview-modal');
    $('preview-modal-title').textContent = `🔍 样本集 #${setId} ${setName} — 数据预览`;
    modal.classList.add('show');
    await _refetchPreview();
}

async function _refetchPreview() {
    const body = $('preview-modal-body');
    const { setId, filters } = _previewState;
    if (!setId) return;
    body.classList.add('loading');
    // 仅首次替换整个 body, 后续只 patch 数据区, 保留 filter chip 焦点
    if (!body.querySelector('.pv-filter')) {
        body.innerHTML = '<p class="muted-hint">加载中…</p>';
    }
    const qs = new URLSearchParams({ limit: '20' });
    for (const [dim, vals] of Object.entries(filters)) {
        if (vals?.length) qs.set(dim, vals.join(','));
    }
    try {
        const data = await apiGet(`/api/spawn-tuning-v2/sample-sets/${setId}/preview?${qs.toString()}`);
        body.innerHTML = renderSetPreviewBody(data);
        _bindPreviewFilterEvents();
        const canvas = body.querySelector('#pv-d-canvas');
        if (canvas && data.d_curve_avg) renderMiniDCurve(canvas, data.d_curve_avg);
    } catch (e) {
        body.innerHTML = `<p style="color:var(--bad)">${escapeHtml(e.message)}</p>`;
    } finally {
        body.classList.remove('loading');
    }
}

function _bindPreviewFilterEvents() {
    const body = $('preview-modal-body');
    body.querySelectorAll('.pv-chips .pv-chip').forEach((c) => {
        c.addEventListener('click', () => {
            if (c.classList.contains('disabled')) return;
            const dim = c.parentElement.dataset.dim;
            const val = c.dataset.val;
            const cur = new Set(_previewState.filters[dim] || []);
            if (cur.has(val)) cur.delete(val);
            else cur.add(val);
            // 全选 = 等同于无筛选 (清空该维度)
            const allVals = [...c.parentElement.querySelectorAll('.pv-chip')].map((x) => x.dataset.val);
            if (cur.size === 0 || cur.size === allVals.length) {
                delete _previewState.filters[dim];
            } else {
                _previewState.filters[dim] = [...cur];
            }
            _refetchPreview();
        });
    });
    body.querySelector('.pv-filter-reset')?.addEventListener('click', () => {
        _previewState.filters = {};
        _refetchPreview();
    });
}

function closePreviewModal() {
    $('preview-modal').classList.remove('show');
}

function renderSetPreviewBody(data) {
    const s = data.set || {};
    const lbl = data.label_summary || {};
    const dimsAll = data.dim_coverage_all || data.dim_coverage || {};
    const dimsSub = data.dim_coverage || {};
    const theta = data.theta_summary || {};
    const samples = data.samples || [];
    const fs = lbl.final_score || {};
    const filters = _previewState.filters || {};
    const nFiltered = data.n_filtered ?? lbl.n ?? 0;
    const nTotal = data.n_total ?? nFiltered;
    const hasFilter = Object.keys(filters).length > 0;

    /* === 筛选 chip 区 (5 维 multi-select; 默认全选 = 无筛选) === */
    const DIMS = ['difficulty', 'generator', 'bot_policy', 'pb_bin', 'lifecycle_stage'];
    const filterRows = DIMS.map((dim) => {
        const allVals = Object.keys(dimsAll[dim] || {});
        if (allVals.length === 0) return '';
        const selected = filters[dim] ? new Set(filters[dim]) : null; // null = 全选
        const chips = allVals.map((v) => {
            const on = !selected || selected.has(v);
            const subN = dimsSub[dim]?.[v] || 0;
            return `<button class="pv-chip ${on ? 'on' : ''}" data-val="${escapeHtml(v)}" title="筛选子集中: ${subN} 样本">${escapeHtml(v)} <span style="opacity:0.7">(${subN})</span></button>`;
        }).join('');
        return `
            <div class="pv-filter-row">
              <span class="pv-filter-label">${DIM_LABEL_ZH[dim] || dim}</span>
              <div class="pv-chips" data-dim="${dim}">${chips}</div>
            </div>
        `;
    }).join('');
    const filterPercent = nTotal > 0 ? (nFiltered / nTotal * 100).toFixed(1) : '0.0';
    const filterSection = `
        <div class="pv-filter">
          <div class="pv-filter-summary">
            <span>📌 筛选: <b>${nFiltered.toLocaleString()}</b> / ${nTotal.toLocaleString()} 样本 (${filterPercent}%)</span>
            ${hasFilter ? `<button class="ghost pv-filter-reset" style="font-size:10px; height:20px; padding:0 8px;">↺ 清空筛选</button>` : ''}
            <span style="margin-left:auto; font-size:10px; color:var(--muted);">单击 chip 切换该值 (默认全选 = 无筛选)</span>
          </div>
          ${filterRows}
        </div>
    `;

    /* === 维度覆盖柱状 (按计数排序 + 等比例宽度, 显示筛选子集) === */
    const dimRows = Object.keys(dimsSub).map((dim) => {
        const entries = Object.entries(dimsSub[dim]).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((a, [, n]) => a + n, 0);
        const palette = DIM_COLORS[dim] || ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f472b6'];
        const bars = entries.map(([k, n], i) => {
            const pct = total > 0 ? n / total : 0;
            return `<div class="pv-dim-bar" style="flex:${pct.toFixed(4)}; background:${palette[i % palette.length]};" title="${escapeHtml(k)} = ${n} (${(pct * 100).toFixed(1)}%)">${escapeHtml(k)}: ${n}</div>`;
        }).join('');
        return `
            <div class="pv-dim-row">
              <span class="pv-dim-label">${DIM_LABEL_ZH[dim] || dim}</span>
              <div class="pv-dim-bars">${bars || '<span class="muted-hint" style="padding:2px 6px;">无样本</span>'}</div>
            </div>
        `;
    }).join('');

    /* === 标签摘要卡片 === */
    const tiles = `
        <div class="pv-stat-tile"><div class="v">${(lbl.n || 0).toLocaleString()}</div><div class="l">总样本数</div></div>
        <div class="pv-stat-tile"><div class="v">${fs.mean || '-'}</div><div class="l">final_score 均值</div></div>
        <div class="pv-stat-tile"><div class="v">${fs.p50 ?? '-'}<span style="font-size:9px; color:var(--muted)"> / ${fs.p90 ?? '-'}</span></div><div class="l">分数 p50 / p90</div></div>
        <div class="pv-stat-tile"><div class="v" style="color:${(lbl.pb_broke_rate || 0) > 0.3 ? 'var(--good)' : 'var(--text)'}">${((lbl.pb_broke_rate || 0) * 100).toFixed(1)}%</div><div class="l">破 PB 率</div></div>
        <div class="pv-stat-tile"><div class="v" style="color:${(lbl.noMove_rate || 0) > 0.5 ? 'var(--bad)' : 'var(--text)'}">${((lbl.noMove_rate || 0) * 100).toFixed(1)}%</div><div class="l">死局率</div></div>
        <div class="pv-stat-tile"><div class="v">${lbl.survived_steps_mean ?? '-'}</div><div class="l">平均步数</div></div>
        <div class="pv-stat-tile"><div class="v">${((lbl.clear_rate_mean || 0) * 100).toFixed(1)}%</div><div class="l">消行密度</div></div>
        <div class="pv-stat-tile"><div class="v">${lbl.surprise_mean ?? '-'}</div><div class="l">惊喜事件 (avg)</div></div>
    `;

    /* === θ 表 === */
    const thetaRows = Object.entries(theta).map(([k, v]) => `
        <tr>
          <td>${escapeHtml(k)}</td>
          <td>${fmtNumber(v.min, 4)}</td>
          <td><b>${fmtNumber(v.mean, 4)}</b></td>
          <td>${fmtNumber(v.max, 4)}</td>
          <td style="color:var(--muted)">${v.n}</td>
        </tr>
    `).join('');

    /* === 样本表 === */
    const sampleRows = samples.map((r) => {
        const tShort = Object.entries(r.theta || {}).slice(0, 3)
            .map(([k, v]) => `${k.slice(0, 12)}=${(+v).toFixed(2)}`).join(' ');
        return `
            <tr>
              <td><code>${r.sample_id}</code></td>
              <td>${escapeHtml(r.difficulty)}:${escapeHtml(r.generator)}:${escapeHtml(r.bot_policy)}:${r.pb_bin}:${escapeHtml(r.lifecycle_stage)}</td>
              <td>${r.final_score ?? '-'}</td>
              <td>${r.survived_steps ?? '-'}</td>
              <td>${r.pb_broke ? '✓' : ''}</td>
              <td>${r.noMove_step >= 0 ? `step ${r.noMove_step}` : '存活'}</td>
              <td title="${escapeHtml(JSON.stringify(r.theta || {}))}">${escapeHtml(tShort)}…</td>
            </tr>
        `;
    }).join('');

    const filterTag = hasFilter
        ? `<span style="color:var(--warn); font-size:10.5px;"> · 已应用筛选 ${Object.keys(filters).length} 维</span>`
        : '';

    return `
        <p class="muted-hint" style="margin:0 0 6px;">
          set #${s.set_id} · ${escapeHtml(s.status || '-')} · 创建于 ${fmtDate(s.created_at)}
          ${s.tags ? ` · 标签: <code>${escapeHtml(s.tags)}</code>` : ''}${filterTag}
        </p>

        ${filterSection}

        ${nFiltered === 0 ? '<p style="color:var(--bad); padding:8px;">⚠ 当前筛选结果为空 — 调整 chip 选择或点 "↺ 清空筛选"</p>' : `

        <div class="pv-section">
          <h3>📊 标签摘要${hasFilter ? ' <span style="font-weight:normal; font-size:10.5px; color:var(--warn)">(筛选子集)</span>' : ''}</h3>
          <div class="pv-stat-grid">${tiles}</div>
        </div>

        <div class="pv-section">
          <h3>🎮 5 维 Context 覆盖${hasFilter ? ' <span style="font-weight:normal; font-size:10.5px; color:var(--warn)">(筛选子集)</span>' : ''}</h3>
          ${dimRows}
        </div>

        <div class="pv-section">
          <h3>📈 平均 d_curve${hasFilter ? ' <span style="font-weight:normal; font-size:10.5px; color:var(--warn)">(筛选子集)</span>' : ''} <span style="font-weight:normal; font-size:10.5px; color:var(--muted)">— 横轴 r ∈ [0, 1.5], 纵轴难度 D ∈ [0, 1]</span></h3>
          <div class="pv-mini-curve">
            <canvas id="pv-d-canvas" width="800" height="160"></canvas>
          </div>
        </div>

        <div class="pv-section">
          <h3>🎛 θ 分布 <span style="font-weight:normal; font-size:10.5px; color:var(--muted)">— ${Object.keys(theta).length} 维${hasFilter ? ' (筛选子集)' : ''}</span></h3>
          <table class="pv-theta-tbl">
            <thead><tr><th>name</th><th>min</th><th>mean</th><th>max</th><th>n</th></tr></thead>
            <tbody>${thetaRows || '<tr><td colspan="5" class="muted-hint">无 θ 数据</td></tr>'}</tbody>
          </table>
        </div>

        <div class="pv-section">
          <h3>🧪 样本原型 <span style="font-weight:normal; font-size:10.5px; color:var(--muted)">— 最近 ${samples.length} 条 (按 sample_id DESC${hasFilter ? ', 筛选子集' : ''})</span></h3>
          <div class="pv-sample-wrap">
            <table class="pv-sample-tbl">
              <thead><tr>
                <th>id</th><th>5 维 context</th><th>分数</th><th>步数</th><th>破 PB</th><th>死局</th><th>θ 前 3 维</th>
              </tr></thead>
              <tbody>${sampleRows || '<tr><td colspan="7" class="muted-hint">无样本</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        `}
    `;
}

/** 简化版 d_curve mini chart (复用 dCurveChart.js 的视觉, 但更轻) */
function renderMiniDCurve(canvas, curve) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const PAD = { l: 32, r: 12, t: 8, b: 22 };
    const cw = W - PAD.l - PAD.r;
    const ch = H - PAD.t - PAD.b;

    // 网格 + 临界线 D=0.5
    ctx.strokeStyle = 'rgba(96,165,250,0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = PAD.t + (ch * i) / 4;
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + cw, y); ctx.stroke();
    }
    ctx.strokeStyle = '#fbbf24';
    ctx.setLineDash([3, 3]);
    const y50 = PAD.t + ch / 2;
    ctx.beginPath(); ctx.moveTo(PAD.l, y50); ctx.lineTo(PAD.l + cw, y50); ctx.stroke();
    ctx.setLineDash([]);

    // 曲线
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.beginPath();
    curve.forEach((v, i) => {
        const x = PAD.l + (cw * (i + 0.5)) / curve.length;
        const y = PAD.t + ch * (1 - Math.max(0, Math.min(1, v)));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 轴 — 与 v2.3 target_curve.CURVE_R_MAX = 2.0 对齐
    const R_MAX = 2.0;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9.5px ui-monospace';
    ctx.textAlign = 'right';
    [0, 0.5, 1].forEach((v) => {
        const y = PAD.t + ch * (1 - v);
        ctx.fillText(v.toFixed(1), PAD.l - 3, y + 3);
    });
    ctx.textAlign = 'center';
    [0, 0.5, 1.0, 1.5, 2.0].forEach((r) => {
        const x = PAD.l + (cw * r) / R_MAX;
        ctx.fillText(r.toFixed(1), x, H - 6);
    });
}


// ─────────── ③ 模型训练 ───────────

/** 检测 server 端可用 device 并填充下拉, 优先序 cuda > mps > cpu。
 *  - 不可用的 device 显示为 disabled
 *  - 首次刷新时自动选中 recommended
 *  - 用户手动改过后, 后续刷新保留选择 (除非选了不可用项)
 */
let _deviceUserSelected = false;
async function refreshDeviceOptions() {
    const sel = $('job-device');
    if (!sel) return;
    const prev = sel.value;
    try {
        const data = await apiGet('/api/spawn-tuning-v2/system/devices');
        // option 只显示 id (cuda/mps/cpu) 保持紧凑 — 详细 label 放 title (hover tooltip)
        sel.innerHTML = (data.devices || []).map((d) => {
            const disabled = d.available ? '' : ' disabled';
            const title = escapeHtml(d.label || d.id);
            return `<option value="${d.id}"${disabled} title="${title}">${escapeHtml(d.id)}</option>`;
        }).join('');
        // 选择策略: 用户已手动选过 + 该值仍可用 → 保留; 否则用 recommended
        const availableIds = (data.devices || []).filter((d) => d.available).map((d) => d.id);
        if (_deviceUserSelected && availableIds.includes(prev)) {
            sel.value = prev;
        } else {
            sel.value = data.recommended;
        }
    } catch {
        sel.innerHTML = '<option value="cpu" title="server 未响应, 默认 cpu">cpu</option>';
        sel.value = 'cpu';
    }
}


/** 刷新训练任务的"训练样本集" multi-select 选项 (仅显示 status=completed 的). */
async function refreshTrainingSampleSetOptions() {
    const sel = $('job-sets');
    if (!sel) return;
    // 保留用户已选 (跨 tab 跳转 / 重新刷新时不丢)
    const prevSelected = new Set([...sel.selectedOptions].map((o) => o.value));
    try {
        const data = await apiGet('/api/spawn-tuning-v2/sample-sets?limit=200');
        const sets = (data.sample_sets || [])
            .filter((s) => s.status === 'completed' || s.status === 'collecting');
        if (sets.length === 0) {
            sel.innerHTML = '<option disabled>— 尚无样本集 (先在 ② tab 创建) —</option>';
            return;
        }
        sel.innerHTML = sets.map((s) => {
            const sel_attr = prevSelected.has(String(s.set_id)) ? ' selected' : '';
            const statusBadge = s.status === 'completed' ? '✓' : '⏳';
            // v2.10.1: 算法版本标签 — v2.9 老数据 ⚠, v2.10.x 都是 OK
            const av = s.algo_version || 'v2.10';
            const isV29 = av === 'v2.9';
            const avTag = isV29 ? ' [⚠v2.9 旧] ' : ` [${av}] `;
            return `<option value="${s.set_id}"${sel_attr}>${statusBadge} #${s.set_id}${avTag}${escapeHtml(s.name)} (${s.sample_count || 0} 样本)</option>`;
        }).join('');
        // v2.10.1: 仅 v2.9 才算"老数据", v2.10/v2.10.1 都 OK
        const allV29 = sets.length > 0 && sets.every((s) => (s.algo_version || 'v2.10') === 'v2.9');
        const hint = $('job-hint');
        if (allV29 && hint && !hint.dataset.dismissedV29) {
            hint.innerHTML = '<span style="color:var(--warn)">⚠ 当前所有样本集都是 v2.9 旧算法 (d_curve 平坦, 模型学不出 S 形)。请到 ② 样本构建 重新采集 (新数据自动标 v2.10)。</span>';
        }
    } catch { /* server 挂时保留旧 options */ }
}

async function submitJob() {
    const sel = $('job-sets');
    const setIds = [...sel.selectedOptions]
        .map((o) => parseInt(o.value, 10))
        .filter((x) => Number.isInteger(x) && x > 0);
    if (setIds.length === 0) {
        $('job-hint').innerHTML = '<span style="color:var(--bad)">需要至少选 1 个训练样本集 (按住 Cmd/Ctrl 多选)</span>';
        return;
    }
    const modelType = $('job-model-type')?.value || 'resnet';
    // v2.10: 检测 v2.9 老数据集 (d_curve 平坦, 训出模型必然水平线)
    try {
        const data = await apiGet('/api/spawn-tuning-v2/sample-sets?limit=200');
        const selected = (data.sample_sets || []).filter((s) => setIds.includes(s.set_id));
        const v29Sets = selected.filter((s) => (s.algo_version || 'v2.10') === 'v2.9');
        if (v29Sets.length > 0) {
            const names = v29Sets.map(s => `#${s.set_id} ${s.name}`).join(', ');
            const ok = await showConfirmDialog(
                `你选了 ${v29Sets.length} 个 v2.9 旧算法样本集:\n  ${names}\n\nv2.9 数据的 d_curve 几乎水平 (跨度仅 0.20 vs 业务期望 0.80),\n模型训出来必然是水平预测线, 学不到 S 形。\n\n建议先到 ② 样本构建 重新采集 (新数据自动标 v2.10)。`,
                { title: '⚠ 旧算法数据', confirmLabel: '仍要训练', confirmType: 'warn' }
            );
            if (!ok) {
                $('job-hint').innerHTML = '<span style="color:var(--warn)">已取消 — 请到 ② 样本构建 用相同 chips 重新采集 (新数据自动标 v2.10)</span>';
                return;
            }
        }
    } catch { /* server 挂时跳过此检查 */ }
    // v2.9.4: Transformer 对 LR 敏感, 用户填 > 5e-3 时前端给出警告
    //   实测 job_16: transformer + lr=0.05 → epoch 1 退化解 (输出全平均 0.55) 锁死
    let lrInput = Number($('job-lr').value) || 1e-3;
    if (modelType === 'transformer' && lrInput > 5e-3) {
        const ok = await showConfirmDialog(
            `Transformer 通常用 1e-4 ~ 1e-3, 你填的 ${lrInput} 容易导致训练崩溃 (退化解)。\n\n确认继续? (后端会自动 cap 到 5e-3)`,
            { title: `⚠ 学习率偏高`, confirmLabel: '继续提交', confirmType: 'primary' }
        );
        if (!ok) {
            $('job-hint').innerHTML = '<span style="color:var(--warn)">已取消, 建议把学习率改为 1e-3</span>';
            return;
        }
    }
    const body = {
        name: $('job-name').value || `job-${Date.now()}`,
        sample_set_ids: setIds,
        model_type: modelType,
        arch: {
            epochs: Number($('job-epochs').value) || 50,
            batch_size: Number($('job-batch').value) || 256,
            lr: lrInput,
            device: $('job-device').value || 'cpu',
            model_type: modelType,   // 也写到 arch_json 备份, executor 读 jobs.model_type 或 fallback
        },
    };
    const baseId = Number($('job-base').value);
    if (baseId > 0) body.base_model_id = baseId;
    try {
        const r = await apiSend('POST', '/api/spawn-tuning-v2/jobs', body);
        $('job-hint').innerHTML = `<span style="color:var(--good)">✓ 已提交 #${r.job_id} (queued → running 自动轮询中…)</span>`;
        refreshJobs();
        startJobsAutoRefresh();   // 启动自动轮询
    } catch (e) {
        $('job-hint').innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`;
    }
}

// ─────────── ③ jobs 自动轮询 (queued / running 时持续刷新) ───────────

let _jobsPollTimer = null;
let _jobsPollIdleTicks = 0;

/** 启动 jobs 表自动轮询: 每 2 秒 refresh, 直到没有 queued/running 任务连续 ≥3 次后停止 (省 CPU)。 */
function startJobsAutoRefresh() {
    if (_jobsPollTimer) return;  // 已在跑
    _jobsPollIdleTicks = 0;
    _jobsPollTimer = setInterval(async () => {
        // 只有 training tab 可见时才轮询, 切到其他 tab 暂停 (节流)
        const trainingTab = document.querySelector('.tab[data-tab="training"]');
        if (!trainingTab?.classList.contains('active')) return;
        try {
            const data = await apiGet('/api/spawn-tuning-v2/jobs?limit=30');
            const jobs = data.jobs || [];
            const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
            // 复用 refreshJobs 的渲染逻辑 (不另写一份, 拿 data 直接重渲染)
            _renderJobsRows(jobs);
            if (active === 0) {
                _jobsPollIdleTicks += 1;
                if (_jobsPollIdleTicks >= 3) {
                    stopJobsAutoRefresh();
                    // 自动同步刷新模型库 (新模型可能已写入)
                    refreshModels();
                    refreshOverview();
                    $('job-hint').innerHTML = `<span style="color:var(--good)">✓ 当前无运行中任务, 自动轮询已停止</span>`;
                }
            } else {
                _jobsPollIdleTicks = 0;
                $('job-hint').innerHTML = `<span style="color:var(--accent)">⏳ ${active} 个任务运行中, 每 2s 自动刷新…</span>`;
            }
        } catch { /* 网络抖动忽略, 下次再试 */ }
    }, 2000);
}

function stopJobsAutoRefresh() {
    if (_jobsPollTimer) {
        clearInterval(_jobsPollTimer);
        _jobsPollTimer = null;
    }
}

function _renderJobsRows(jobs) {
    const tbody = $('jobs-table').querySelector('tbody');
    if (!jobs || jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="muted-hint">无任务</td></tr>';
        return;
    }
    tbody.innerHTML = jobs.map((j) => {
        const liveTag = (j.status === 'running')
            ? ' <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--accent); animation:chipHintPulse 1.2s infinite;"></span>'
            : '';
        // v2.8.4: 所有状态都允许删除; running/queued 会 kill 子进程
        const deleteLabel = (j.status === 'running' || j.status === 'queued') ? '终止并删除' : '删除';
        const deleteTitle = j.status === 'running'
            ? '终止训练子进程 (SIGTERM → 3s 超时 SIGKILL) + 删除任务记录与日志'
            : j.status === 'queued'
                ? '取消排队 + 删除任务记录'
                : '删除任务记录 + log 文件';
        return `
            <tr data-job-id="${j.job_id}">
              <td><code>#${j.job_id}</code></td>
              <td>${escapeHtml(j.name || '-')}</td>
              <td><span class="status ${j.status}">${j.status}</span>${liveTag}</td>
              <td><code>${escapeHtml(j.sample_set_ids || '-')}</code></td>
              <td>${fmtNumber(j.val_curve_mae)}</td>
              <td>${fmtNumber(j.val_balance)}</td>
              <td>${j.epochs_done || 0}</td>
              <td>${fmtDate(j.created_at)}</td>
              <td>
                <button class="ghost btn-job-metrics" data-id="${j.job_id}" data-name="${escapeHtml(j.name || '-')}">📊 曲线</button>
                ${j.output_model_id ? `<button class="ghost btn-view-model" data-id="${j.output_model_id}" title="跳转到模型库并高亮 model #${j.output_model_id}">→ 模型 #${j.output_model_id}</button>` : ''}
                <button class="danger btn-delete-job" data-id="${j.job_id}" data-name="${escapeHtml(j.name || '-')}" data-status="${j.status}" title="${deleteTitle}">${deleteLabel}</button>
              </td>
            </tr>
        `;
    }).join('');
    tbody.querySelectorAll('.btn-job-metrics').forEach((b) => {
        b.addEventListener('click', () => showJobMetrics(b.dataset.id, b.dataset.name));
    });
    tbody.querySelectorAll('.btn-view-model').forEach((b) => {
        b.addEventListener('click', () => jumpToModel(b.dataset.id));
    });
    tbody.querySelectorAll('.btn-delete-job').forEach((b) => {
        b.addEventListener('click', () => deleteJob(b.dataset.id, b.dataset.name, b.dataset.status));
    });
}

/** 跳转到 C.3 模型库 + 滚动到 + 高亮目标 model 行 1.5 秒。 */
async function jumpToModel(modelId) {
    await refreshModels();
    // 滚动到 C.3 模型库 section
    const modelsTbl = $('models-table');
    if (!modelsTbl) return;
    modelsTbl.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 找对应行 — 用 model_id 在 model-table 中查
    setTimeout(() => {
        const rows = modelsTbl.querySelectorAll('tbody tr');
        for (const tr of rows) {
            const codeEl = tr.querySelector('td:first-child code');
            if (codeEl && codeEl.textContent.trim() === `#${modelId}`) {
                tr.style.transition = 'background-color 0.6s';
                tr.style.backgroundColor = 'rgba(96, 165, 250, 0.28)';
                tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => { tr.style.backgroundColor = ''; }, 1800);
                return;
            }
        }
    }, 100);
}

/** v2.8.4: 删除任务记录 + log 文件; running 时先 kill 子进程。 */
async function deleteJob(jobId, jobName, status) {
    let title, confirmLabel;
    let promptText;
    if (status === 'running') {
        title = `⏹ 终止运行中训练 #${jobId}`;
        confirmLabel = '终止并删除';
        promptText = `任务 "${jobName}"\n\n执行流程:\n  · SIGTERM 训练子进程 (优雅停止 3 秒)\n  · 超时未停 → SIGKILL 强杀\n  · 删除 jobs 记录 + 日志文件\n  · 已落盘的 checkpoint 不删 (如需在 C.3 模型库另删)\n\n此操作不可撤销, 已训的 epoch 数据将丢失。`;
    } else if (status === 'queued') {
        title = `⏹ 取消排队任务 #${jobId}`;
        confirmLabel = '取消并删除';
        promptText = `任务 "${jobName}"\n\n结果:\n  · 取消任务: executor 不会再 pick 它\n  · 删除 jobs 表记录`;
    } else {
        title = `🗑 删除训练任务 #${jobId}`;
        confirmLabel = '确认删除';
        promptText = `任务 "${jobName}"\n\n将同时删除:\n  · jobs 表记录\n  · job 日志文件 (.log)\n\n注: 任务产出的 model 文件不会被删除 (请在 C.3 模型库另外删除)。此操作不可撤销。`;
    }
    if (!(await showConfirmDialog(promptText, { title, confirmLabel }))) return;

    try {
        const r = await apiSend('DELETE', `/api/spawn-tuning-v2/jobs/${jobId}`);
        const filesPart = (r.deleted_files?.length || 0) > 0
            ? ` · 已删 ${r.deleted_files.length} 个文件`
            : '';
        let killPart = '';
        if (r.kill_info) {
            const k = r.kill_info;
            if (k.action === 'sigterm') killPart = ' · 子进程已 SIGTERM 优雅停止';
            else if (k.action === 'sigkill') killPart = ' · ⚠ SIGTERM 超时, 已 SIGKILL 强杀';
            else if (k.action === 'already_exited') killPart = ' · 子进程已自然结束';
            else if (k.action === 'not_running') killPart = ' · ⚠ 子进程不在注册表 (可能 executor 已重启)';
            else killPart = ` · kill 失败: ${k.msg || k.action}`;
        }
        showNotification(`任务 #${jobId} 已删除${killPart}${filesPart}`, 'success');
        refreshJobs();
        refreshOverview();
    } catch (e) {
        showNotification(`删除失败: ${e.message}`, 'error');
    }
}

async function refreshJobs() {
    try {
        const data = await apiGet('/api/spawn-tuning-v2/jobs?limit=30');
        _renderJobsRows(data.jobs || []);
        // 如果当前有 queued/running, 自动启动轮询 (例如刷新页面后仍能看到进度)
        const active = (data.jobs || []).filter((j) => j.status === 'queued' || j.status === 'running').length;
        if (active > 0) startJobsAutoRefresh();
    } catch (e) {
        $('jobs-table').querySelector('tbody').innerHTML = `<tr><td colspan="9" class="muted-hint">${escapeHtml(e.message)}</td></tr>`;
    }
}

// ─────────── 训练曲线模态框 ───────────

let _metricsPollTimer = null;
let _metricsPollJobId = null;

async function showJobMetrics(jobId, jobName) {
    const modal = $('metrics-modal');
    const meta = $('metrics-meta');
    $('metrics-modal-title').textContent = `训练曲线 — #${jobId} ${jobName}`;
    meta.textContent = '加载 per-epoch metrics…';
    modal.classList.add('show');
    _metricsPollJobId = jobId;
    stopMetricsPoll();

    await _loadAndRenderMetrics(jobId, meta);

    try {
        const jobInfo = await apiGet(`/api/spawn-tuning-v2/jobs/${jobId}`);
        if (jobInfo.status === 'queued' || jobInfo.status === 'running') {
            _metricsPollTimer = setInterval(async () => {
                if (_metricsPollJobId !== jobId || !modal.classList.contains('show')) {
                    stopMetricsPoll(); return;
                }
                const info = await apiGet(`/api/spawn-tuning-v2/jobs/${jobId}`).catch(() => null);
                await _loadAndRenderMetrics(jobId, meta);
                if (info && info.status !== 'queued' && info.status !== 'running') {
                    stopMetricsPoll();
                }
            }, 2000);
        }
    } catch { /* 不致命 */ }
}

function stopMetricsPoll() {
    if (_metricsPollTimer) {
        clearInterval(_metricsPollTimer);
        _metricsPollTimer = null;
    }
}

/** v2.8: 给 metrics-grid 内所有 sub-chart 绑定 hover tooltip。
 *  - 委托事件到 grid 容器
 *  - 根据鼠标位置识别哪个 sub-chart, 找最近 epoch/batch, 显示完整 metrics
 *  - 同时在所有 sub-chart 上画同步竖线 (vertical guideline)
 */
function _setupMetricsChartHover() {
    const grid = $('metrics-grid');
    const tooltip = $('metrics-tooltip');
    if (!grid || !tooltip) return;

    grid.addEventListener('mousemove', (ev) => {
        const ix = _chartHoverIndex;
        if (!ix.subCharts?.length || !ix.epochs?.length) {
            tooltip.style.display = 'none';
            return;
        }
        // 找鼠标在哪个 sub-chart 内
        const card = ev.target?.closest('.metric-card');
        if (!card) {
            tooltip.style.display = 'none';
            _clearGuidelines();
            return;
        }
        const canvas = card.querySelector('canvas');
        const subIdx = ix.subCharts.findIndex((s) => s.canvas === canvas);
        if (subIdx < 0) { tooltip.style.display = 'none'; return; }
        const sc = ix.subCharts[subIdx];
        const rect = canvas.getBoundingClientRect();
        const mx_css = ev.clientX - rect.left;
        if (mx_css < sc.PAD.l || mx_css > sc.PAD.l + sc.cw) {
            tooltip.style.display = 'none';
            _clearGuidelines();
            return;
        }
        // 找最近 epoch (像素距离阈值 14)
        let nearestEpoch = null;
        let nearestDist = Infinity;
        ix.epochs.forEach((e) => {
            if (!Number.isFinite(e.step)) return;
            const d = Math.abs(sc.xAt(e.step) - mx_css);
            if (d < nearestDist) { nearestDist = d; nearestEpoch = e; }
        });
        let nearestBatch = null;
        let nearestBatchDist = Infinity;
        ix.batches.forEach((b) => {
            if (!Number.isFinite(b.step)) return;
            const d = Math.abs(sc.xAt(b.step) - mx_css);
            if (d < nearestBatchDist) { nearestBatchDist = d; nearestBatch = b; }
        });
        const useEpoch = nearestEpoch && nearestDist <= 14;
        const useBatch = !useEpoch && nearestBatch && nearestBatchDist <= 10;
        if (!useEpoch && !useBatch) {
            tooltip.style.display = 'none';
            _clearGuidelines();
            return;
        }

        // 同步竖线 — 所有 sub-chart 在该 step 处画一条
        const hoverStep = useEpoch ? nearestEpoch.step : nearestBatch.step;
        _drawGuidelines(hoverStep);

        // 构造 tooltip 内容
        let html = '';
        if (useEpoch) {
            const e = nearestEpoch;
            const fmt = (v) => Number.isFinite(v) ? v.toFixed(4) : '—';
            html = `
              <div style="color:var(--accent); margin-bottom:3px; font-weight:700;">
                epoch ${e.epoch} <span style="color:var(--muted); font-weight:normal;">· step ${e.step}</span>
              </div>
              <div><span style="color:#f87171;">●</span> train_loss = ${fmt(e.train_loss)}</div>
              <div><span style="color:#60a5fa;">●</span> val_loss = ${fmt(e.val_loss)}</div>
              <div><span style="color:#34d399;">●</span> val_curve_mae = ${fmt(e.val_curve_mae)}</div>
              <div><span style="color:#f472b6;">●</span> val_pb_distribution = ${fmt(e.val_pb_distribution)}</div>
              <div><span style="color:#fbbf24;">●</span> val_anchor = ${fmt(e.val_anchor)}</div>
              <div><span style="color:#a78bfa;">●</span> val_balance = ${fmt(e.val_balance)}</div>
              <div style="color:var(--muted); margin-top:3px; font-size:10px;">
                val_surprise = ${fmt(e.val_surprise)} · val_breaking = ${fmt(e.val_breaking)}
                ${Number.isFinite(e.elapsed_s) ? `· ${e.elapsed_s.toFixed(1)}s` : ''}
              </div>
              ${Number.isFinite(e.reach_100) && e.reach_100 > 0 ? `
              <div style="border-top:1px solid var(--line); margin-top:5px; padding-top:4px; font-size:10.5px;">
                <div style="color:var(--accent); font-weight:700; margin-bottom:2px;">📊 业务级 P_reach:</div>
                <div>r=0.5: <b>${(e.reach_50 * 100).toFixed(0)}%</b> <span style="color:var(--muted)">(目标 85%)</span></div>
                <div>r=0.95: <b>${(e.reach_95 * 100).toFixed(0)}%</b> <span style="color:var(--muted)">(目标 30%)</span></div>
                <div>⭐ r=1.0 (破 PB): <b style="color:${e.reach_100 >= 0.10 && e.reach_100 <= 0.25 ? 'var(--good)' : 'var(--warn)'}">${(e.reach_100 * 100).toFixed(1)}%</b> <span style="color:var(--muted)">(甜区 10-25%)</span></div>
                <div>r=1.5: <b>${(e.reach_150 * 100).toFixed(1)}%</b> <span style="color:var(--muted)">(目标 1%)</span></div>
              </div>` : ''}
            `;
        } else {
            const b = nearestBatch;
            html = `
              <div style="color:var(--accent); margin-bottom:3px; font-weight:700;">
                batch <span style="color:var(--muted); font-weight:normal;">epoch ${b.epoch} · step ${b.step}</span>
              </div>
              <div><span style="color:#f87171;">●</span> train_loss = ${b.train_loss_batch.toFixed(4)}</div>
            `;
        }

        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        // v2.8.2: tooltip 改用 fixed 定位 (viewport 坐标), 不再依赖 chart-container,
        // 避免 tooltip 撑大 modal 触发滚动条变化导致页面跳动
        const ttRect = tooltip.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // 默认在鼠标右上方 14px, 贴右边时切到左侧, 贴顶部时改下方
        let x = ev.clientX + 14;
        let y = ev.clientY - ttRect.height - 8;
        if (x + ttRect.width > vw - 4) x = ev.clientX - ttRect.width - 14;
        if (x < 4) x = 4;
        if (y < 4) y = ev.clientY + 18;
        if (y + ttRect.height > vh - 4) y = vh - ttRect.height - 4;
        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
    });

    grid.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
        _clearGuidelines();
    });
}

/** 在所有 sub-chart 上画一条同步竖线 (用 overlay div, 不重新 draw canvas)。 */
function _drawGuidelines(step) {
    const ix = _chartHoverIndex;
    if (!ix.subCharts?.length) return;
    ix.subCharts.forEach((sc) => {
        // 在 canvas 上叠加一条线 (用 ctx 直接画在 canvas 上, 不持久化, 下次 hover 重画时会清)
        // 简化方案: 用 absolute div 覆盖在 canvas 上方
        const card = sc.canvas.closest('.metric-card');
        if (!card) return;
        let guide = card.querySelector('.hover-guideline');
        if (!guide) {
            guide = document.createElement('div');
            guide.className = 'hover-guideline';
            guide.style.cssText = 'position:absolute; top:0; bottom:0; width:1px; pointer-events:none; background:rgba(167,139,250,0.6); z-index:5;';
            card.style.position = 'relative';
            card.appendChild(guide);
        }
        const x = sc.xAt(step);
        guide.style.left = x + 'px';
        guide.style.display = 'block';
    });
}

function _clearGuidelines() {
    document.querySelectorAll('.hover-guideline').forEach((g) => { g.style.display = 'none'; });
}

async function _loadAndRenderMetrics(jobId, meta) {
    try {
        const data = await apiGet(`/api/spawn-tuning-v2/jobs/${jobId}/metrics-history`);
        const hasAny = (data.epochs && data.epochs.length > 0) || (data.batches && data.batches.length > 0);
        if (!hasAny) {
            meta.innerHTML = '<span style="color:var(--warn)">尚无训练日志 (任务可能未启动 / 仍在初始化 / train.py 输出不规范)</span>';
            renderMetricsChart(null, [], []);
            return;
        }
        renderMetricsChart(null, data.epochs || [], data.batches || []);
        const epochs = data.epochs || [];
        const last = epochs[epochs.length - 1] || (data.batches[data.batches.length - 1] || {});
        const best = epochs.length > 0
            ? epochs.reduce((b, e) => (e.val_curve_mae < (b?.val_curve_mae ?? Infinity) ? e : b), null)
            : null;
        const totalSec = epochs.reduce((s, e) => s + (e.elapsed_s || 0), 0);
        // 表格 — 6 个核心 metric 的最新 / 首 / 改进
        const tablePart = epochs.length > 0 ? `
            <table style="width:100%; font-size:11px; margin-top:6px; border-collapse:collapse;">
              <thead><tr style="color:var(--muted);">
                <th style="text-align:left; padding:3px 6px;">指标</th>
                <th style="text-align:right; padding:3px 6px;">最新 (ep=${last.epoch ?? '-'})</th>
                ${epochs.length > 1 ? `<th style="text-align:right; padding:3px 6px;">首 epoch</th>
                <th style="text-align:right; padding:3px 6px;">改进 △</th>` : ''}
              </tr></thead>
              <tbody style="font-family: ui-monospace, monospace;">
                ${['train_loss', 'val_loss', 'val_curve_mae', 'val_calibrated_mae', 'val_curve_var', 'val_anchor', 'val_monotonic', 'val_target_fit', 'val_endpoint', 'val_pb_distribution', 'val_balance', 'val_surprise', 'val_breaking']
                    .map((k) => {
                        const lastV = last[k];
                        const firstV = epochs[0][k];
                        const delta = (Number.isFinite(lastV) && Number.isFinite(firstV)) ? (lastV - firstV) : null;
                        const deltaStr = delta == null ? '-' :
                            (delta < 0 ? `<span style="color:var(--good)">${delta.toFixed(4)} ↓</span>`
                                       : `<span style="color:var(--warn)">+${delta.toFixed(4)} ↑</span>`);
                        return `<tr>
                            <td style="padding:2px 6px;">${k}</td>
                            <td style="padding:2px 6px; text-align:right;">${fmtNumber(lastV, 4)}</td>
                            ${epochs.length > 1 ? `
                            <td style="padding:2px 6px; text-align:right; color:var(--muted);">${fmtNumber(firstV, 4)}</td>
                            <td style="padding:2px 6px; text-align:right;">${deltaStr}</td>` : ''}
                        </tr>`;
                    }).join('')}
              </tbody>
            </table>
        ` : '';

        const lines = [
            epochs.length > 0 ? `共 <b>${epochs.length}</b> epoch` : null,
            (data.batches && data.batches.length > 0) ? `<b>${data.batches.length}</b> 个 batch 采样点` : null,
            best ? `最佳: ep=${best.epoch} val_curve_mae=<b style="color:var(--good)">${fmtNumber(best.val_curve_mae)}</b>` : null,
            totalSec > 0 ? `总耗时 ≈ ${fmtNumber(totalSec, 1)}s` : null,
        ].filter(Boolean).join(' · ');

        meta.innerHTML = lines + tablePart;
    } catch (e) {
        meta.innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`;
        renderMetricsChart(null, [], []);
    }
}

function closeMetricsModal() {
    $('metrics-modal').classList.remove('show');
    stopMetricsPoll();
    _metricsPollJobId = null;
}

// v2.8: 训练曲线拆成 8 个独立 sub-chart, 每个指标自带纵轴范围
//       grid 布局, 同步 step 横轴, 避免量纲差异导致小指标看不清
const _METRIC_SUB_CHARTS = [
    { key: 'train_loss',          color: '#f87171', label: 'train_loss',          better: 'lower' },
    { key: 'val_loss',            color: '#60a5fa', label: 'val_loss',            better: 'lower' },
    { key: 'val_curve_mae',       color: '#34d399', label: 'val_curve_mae',       better: 'lower' },
    // v2.10.2 — 预测 vs calibrated target MAE (业务真实拟合度, 不受 state_offset 噪声干扰)
    { key: 'val_calibrated_mae',  color: '#a3e635', label: 'val_calibrated_mae',  better: 'lower' },
    // v2.9.4 — 退化解检测: 预测曲线 std, 越接近 0 越说明模型只输出水平线
    { key: 'val_curve_var',       color: '#10b981', label: 'val_curve_var',       better: 'higher' },
    { key: 'val_anchor',          color: '#fbbf24', label: 'val_anchor',          better: 'lower' },
    // v2.9 / v2.9.1 — 形状约束子图
    { key: 'val_monotonic',       color: '#facc15', label: 'val_monotonic',       better: 'lower' },
    { key: 'val_target_fit',      color: '#c084fc', label: 'val_target_fit',      better: 'lower' },
    { key: 'val_endpoint',        color: '#22d3ee', label: 'val_endpoint',        better: 'lower' },
    { key: 'val_pb_distribution', color: '#f472b6', label: 'val_pb_distribution', better: 'lower' },
    { key: 'val_balance',         color: '#a78bfa', label: 'val_balance',         better: 'lower' },
    { key: 'val_surprise',        color: '#06b6d4', label: 'val_surprise',        better: 'lower' },
    { key: 'val_breaking',        color: '#fb923c', label: 'val_breaking',        better: 'lower' },
];

// hover 索引: 每个 sub-chart 的 step→x 映射 + epochs 引用 (供 tooltip 用)
let _chartHoverIndex = { epochs: [], batches: [], subCharts: [] };

/** v2.8: 渲染 8 个独立指标子图到 grid。
 *  - batches[]: 仅用于 train_loss 子图叠加 batch 级细线
 *  - epochs[]: 提供 8 个 metric 各自的 markers + 折线
 *  - 每个 sub-chart 自己的 yMax (自动缩放)
 *  - 同步 step 横轴
 */
function renderMetricsChart(_unusedCanvas, epochs, batches = []) {
    const grid = $('metrics-grid');
    if (!grid) return;

    const totalPoints = (epochs?.length || 0) + (batches?.length || 0);
    if (totalPoints === 0) {
        grid.innerHTML = '<div style="grid-column: span 2; padding: 30px; text-align:center; color:var(--muted);">暂无数据</div>';
        _chartHoverIndex = { epochs: [], batches: [], subCharts: [] };
        return;
    }

    // x 轴范围: 全局 step max (所有 sub-chart 共享)
    const allSteps = [
        ...batches.map((b) => b.step),
        ...epochs.map((e) => e.step),
    ].filter(Number.isFinite);
    const stepMax = allSteps.length > 0 ? Math.max(...allSteps, 1) : Math.max(epochs.length, 1);

    // 生成 / 复用 sub-chart 卡片 DOM (避免每次 innerHTML 重建丢 canvas 上下文)
    const needsRebuild = grid.children.length !== _METRIC_SUB_CHARTS.length;
    if (needsRebuild) {
        grid.innerHTML = _METRIC_SUB_CHARTS.map((m) => `
            <div class="metric-card" data-key="${m.key}">
              <div class="metric-card-header">
                <span class="metric-card-title" style="color:${m.color};">${m.label}</span>
                <span class="metric-card-value">—</span>
              </div>
              <canvas></canvas>
            </div>
        `).join('');
    }

    // 找全局最佳 epoch (按 val_curve_mae) — 主推荐
    const bestIdx = epochs.length > 0
        ? epochs.reduce((bi, e, i) => (e.val_curve_mae < epochs[bi].val_curve_mae ? i : bi), 0)
        : -1;

    const subChartIndexes = [];
    _METRIC_SUB_CHARTS.forEach((m, idx) => {
        const card = grid.children[idx];
        const canvas = card.querySelector('canvas');
        // HiDPI canvas — v2.8.1: 缓存尺寸, 只在变化时重设, 避免每次轮询触发 reflow
        const rect = canvas.getBoundingClientRect();
        const cssW = rect.width || 360;
        const cssH = 70;
        const dpr = window.devicePixelRatio || 1;
        const targetW = Math.round(cssW * dpr);
        const targetH = Math.round(cssH * dpr);
        // 只有真正尺寸变化时才重设 (重设会清空 canvas + 触发布局 reflow)
        if (canvas.width !== targetW) canvas.width = targetW;
        if (canvas.height !== targetH) canvas.height = targetH;
        if (canvas.style.height !== cssH + 'px') canvas.style.height = cssH + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, cssW, cssH);

        // v2.10.3: 智能 Y 轴范围 — 反应细微变化
        //   1. 不强制 yMin=0 (否则 [0.058, 0.066] 被压成 10% 空间)
        //   2. 首 epoch 异常剔除 (initial loss 常巨大, 把后续平台压扁)
        //   3. 业务指标都 ≥0, yBot 不为负 (避免浪费下方空间)
        //   4. 数据全等时画水平线 (避免 yRange=0 NaN)
        const vals = epochs.map((e) => e[m.key]).filter(Number.isFinite);
        const extraBatchVals = (m.key === 'train_loss')
            ? batches.map((b) => b.train_loss_batch).filter(Number.isFinite)
            : [];
        const allVals = [...vals, ...extraBatchVals];
        let yMin, yMax;
        if (allVals.length === 0) {
            yMin = 0; yMax = 1;
        } else {
            yMin = Math.min(...allVals);
            yMax = Math.max(...allVals);
            // 首 epoch 异常剔除: 若首值 > 后续 max 的 2× 且 epoch > 3, 用剩余决定 scale
            if (vals.length > 3 && vals[0] > 0) {
                const restVals = [...vals.slice(1), ...extraBatchVals];
                if (restVals.length > 0) {
                    const restMax = Math.max(...restVals);
                    const restMin = Math.min(...restVals);
                    if (vals[0] > restMax * 2 && vals[0] > 0.001) {
                        // 用剩余决定 scale, 首 epoch 仍画出但会被 clip
                        yMin = restMin;
                        yMax = restMax;
                    }
                }
            }
        }
        // 数据全相等 → 微调 yRange 避免除零
        if (yMax - yMin < 1e-9) {
            const center = yMax;
            yMax = center + Math.max(1e-4, Math.abs(center) * 0.05);
            yMin = Math.max(0, center - Math.max(1e-4, Math.abs(center) * 0.05));
        }
        const yRange = yMax - yMin;
        const yTop = yMax + yRange * 0.12;   // 上方 12% padding
        // 业务指标都 ≥ 0 → yBot 永不为负 (节省下方空间)
        const yBot = Math.max(0, yMin - yRange * 0.10);

        const PAD = { l: 38, r: 6, t: 4, b: 14 };
        const cw = cssW - PAD.l - PAD.r;
        const ch = cssH - PAD.t - PAD.b;
        const xAt = (step) => PAD.l + (stepMax > 0 ? (cw * step) / stepMax : cw / 2);
        const yAt = (v) => PAD.t + ch - (ch * (v - yBot)) / (yTop - yBot);

        // 网格 (3 横线)
        ctx.strokeStyle = 'rgba(96,165,250,0.08)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 2; i++) {
            const y = PAD.t + (ch * i) / 2;
            ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + cw, y); ctx.stroke();
        }
        // y 轴刻度 (3 点)
        ctx.fillStyle = '#9ca3af';
        ctx.font = '9px ui-monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= 2; i++) {
            const v = yTop - (yTop - yBot) * (i / 2);
            ctx.fillText(_fmtYTick(v), PAD.l - 3, PAD.t + (ch * i) / 2);
        }

        // v2.10.3: 用 clip 区域防止首 epoch 大值画出边界
        ctx.save();
        ctx.beginPath();
        ctx.rect(PAD.l, PAD.t, cw, ch);
        ctx.clip();

        // 仅在 train_loss 子图叠加 batch 级细线
        if (m.key === 'train_loss' && batches.length > 0) {
            ctx.strokeStyle = 'rgba(248, 113, 113, 0.4)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            let started = false;
            batches.forEach((b) => {
                const v = b.train_loss_batch;
                if (!Number.isFinite(v) || !Number.isFinite(b.step)) return;
                const x = xAt(b.step), y = yAt(v);
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }

        // epoch 折线
        if (epochs.length > 1) {
            ctx.strokeStyle = m.color;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            let started = false;
            epochs.forEach((e) => {
                const v = e[m.key];
                if (!Number.isFinite(v) || !Number.isFinite(e.step)) return;
                const x = xAt(e.step), y = yAt(v);
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }
        // epoch markers
        const r = epochs.length === 1 ? 4 : 2;
        ctx.fillStyle = m.color;
        epochs.forEach((e) => {
            const v = e[m.key];
            if (!Number.isFinite(v) || !Number.isFinite(e.step)) return;
            ctx.beginPath();
            ctx.arc(xAt(e.step), yAt(v), r, 0, Math.PI * 2);
            ctx.fill();
        });

        // 最佳 epoch 标记 (仅 val_curve_mae 这个子图)
        if (m.key === 'val_curve_mae' && bestIdx >= 0 && epochs.length > 1) {
            const best = epochs[bestIdx];
            if (Number.isFinite(best.val_curve_mae) && Number.isFinite(best.step)) {
                ctx.strokeStyle = '#34d399';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(xAt(best.step), yAt(best.val_curve_mae), 4.5, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.restore();  // 恢复 clip

        // v2.10.3: 若首 epoch 被 clip (out-of-range), 在顶部画一个"↑"指示器
        const firstVal = vals[0];
        if (Number.isFinite(firstVal) && firstVal > yTop * 1.05 && vals.length > 1) {
            const x = xAt(epochs[0].step);
            ctx.fillStyle = m.color;
            ctx.font = 'bold 10px ui-monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('↑', x, PAD.t + 1);
            // tooltip 提示首 epoch 实际值 (右上角)
            ctx.fillStyle = '#9ca3af';
            ctx.font = '8.5px ui-monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`首ep=${firstVal.toFixed(3)}`, PAD.l + cw - 2, PAD.t + 1);
        }

        // 更新顶部当前值显示
        const last = epochs[epochs.length - 1];
        const lastV = last?.[m.key];
        const firstV = epochs[0]?.[m.key];
        const delta = (Number.isFinite(lastV) && Number.isFinite(firstV)) ? (lastV - firstV) : null;
        const valEl = card.querySelector('.metric-card-value');
        if (valEl) {
            const valStr = Number.isFinite(lastV) ? lastV.toFixed(4) : '—';
            let deltaStr = '';
            if (delta != null && Math.abs(delta) >= 1e-5) {
                const cls = (m.better === 'lower' && delta < 0) || (m.better === 'higher' && delta > 0)
                    ? 'var(--good)' : 'var(--warn)';
                const arrow = delta < 0 ? '↓' : '↑';
                deltaStr = ` <span style="color:${cls}; font-size:9px;">${delta >= 0 ? '+' : ''}${delta.toFixed(4)} ${arrow}</span>`;
            }
            valEl.innerHTML = valStr + deltaStr;
        }

        subChartIndexes.push({ key: m.key, color: m.color, label: m.label, canvas, xAt, yAt, PAD, cw, ch, cssW, cssH });
    });

    _chartHoverIndex = { epochs, batches, subCharts: subChartIndexes, stepMax };
}

function _fmtYTick(v) {
    if (!Number.isFinite(v)) return '';
    const abs = Math.abs(v);
    if (abs >= 1 || abs === 0) return v.toFixed(2);
    if (abs >= 0.01) return v.toFixed(3);
    if (abs >= 0.0001) return v.toFixed(4);
    return v.toExponential(1);
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
                ${m.status !== 'deployed'
                    ? `<button class="danger btn-delete-model" data-id="${m.model_id}" data-name="${escapeHtml(m.name)}">删除</button>` : ''}
              </td>
            </tr>
        `).join('');
        tbody.querySelectorAll('.btn-deploy').forEach((b) => {
            b.addEventListener('click', async () => {
                if (!(await showConfirmDialog(`当前 deployed 模型会被 archived。`, { title: `🚀 部署模型 #${b.dataset.id}`, confirmLabel: '确认部署', confirmType: 'primary' }))) return;
                await apiSend('POST', `/api/spawn-tuning-v2/models/${b.dataset.id}/deploy`);
                refreshModels(); refreshOverview();
            });
        });
        tbody.querySelectorAll('.btn-rb').forEach((b) => {
            b.addEventListener('click', async () => {
                if (!(await showConfirmDialog(`模型 #${b.dataset.id} 将回滚为上一版 deployed 版本。`, { title: `↩ 回滚模型 #${b.dataset.id}`, confirmLabel: '确认回滚' }))) return;
                await apiSend('POST', `/api/spawn-tuning-v2/models/${b.dataset.id}/rollback`);
                refreshModels(); refreshOverview();
            });
        });
        tbody.querySelectorAll('.btn-delete-model').forEach((b) => {
            b.addEventListener('click', async () => {
                const id = b.dataset.id, name = b.dataset.name;
                const confirmed = await showConfirmDialog(
                    `模型 "${name}"\n\n将同时删除:\n  · DB 记录\n  · .pt 权重文件\n  · .pt.log 训练日志\n\n此操作不可撤销, 已 deployed 的模型不允许删除。`,
                    { title: `🗑 删除模型 #${id}`, confirmLabel: '确认删除' }
                );
                if (!confirmed) return;
                try {
                    const r = await apiSend('DELETE', `/api/spawn-tuning-v2/models/${id}`);
                    const filesPart = (r.deleted_files?.length || 0) > 0
                        ? ` · 已删 ${r.deleted_files.length} 个文件`
                        : '';
                    const warnPart = (r.failed_files?.length || 0) > 0
                        ? ` · ⚠ ${r.failed_files.length} 个文件删除失败`
                        : '';
                    showNotification(`模型 #${id} 已删除${filesPart}${warnPart}`, 'success');
                    refreshModels();
                    refreshOverview();
                    refreshBaseModelOptions();
                    refreshBundleModelOptions();
                } catch (e) {
                    showNotification(`删除失败: ${e.message}`, 'error');
                }
            });
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted-hint">${escapeHtml(e.message)}</td></tr>`;
    }
}


// ─────────── ③ 训练 — 下拉数据源 ───────────

async function refreshBaseModelOptions() {
    const sel = $('job-base');
    if (!sel) return;
    const prev = sel.value;
    try {
        const data = await apiGet('/api/spawn-tuning-v2/models?limit=100');
        sel.innerHTML = '<option value="">— 从头训练 —</option>' +
            (data.models || [])
                .filter((m) => m.status === 'deployed' || m.status === 'staging' || m.status === 'archived')
                .map((m) => {
                    const mae = m.metrics?.val_curve_mae;
                    return `<option value="${m.model_id}">#${m.model_id} ${escapeHtml(m.name)} · ${escapeHtml(m.status)}${mae ? ` · mae=${fmtNumber(mae)}` : ''}</option>`;
                }).join('');
        if (prev) sel.value = prev;
    } catch { /* 没模型 / 服务挂了, 保留默认占位 */ }
}


// ─────────── ④ 部署与监控 ───────────

async function refreshBundleModelOptions() {
    const sel = $('bundle-model');
    if (!sel) return;
    const prev = sel.value;
    try {
        const data = await apiGet('/api/spawn-tuning-v2/models?limit=100');
        sel.innerHTML = '<option value="">— 选已训完模型 —</option>' +
            (data.models || [])
                .filter((m) => m.status === 'deployed' || m.status === 'staging' || m.status === 'archived')
                .map((m) => `<option value="${m.model_id}" data-weights="${escapeHtml(m.weights_path || '')}">#${m.model_id} ${escapeHtml(m.name)} · ${escapeHtml(m.status)}</option>`)
                .join('');
        if (prev) sel.value = prev;
    } catch { /* tolerate */ }
}

async function exportBundle() {
    // v2.10.4: 默认走"一键构建+导出"路径 (后端直接对 360 ctx 推断, 不需先 CLI 跑 optimize_theta)
    //   - 用户填了 path → 走老的 export_bundle (兼容已存在 policies.json 的场景)
    //   - 用户只选模型 → 走 build-and-export (后端从 ckpt 推断 → 生成 policies.json + bundle)
    const customSrc = $('bundle-src').value.trim();
    const rolloutPct = Number($('bundle-rollout').value);
    const modelSel = $('bundle-model');
    const modelId = modelSel?.value;
    $('bundle-hint').innerHTML = '<span style="color:var(--muted)">⏳ 推断 360 个 context 并写 bundle…</span>';
    try {
        let r;
        if (customSrc) {
            r = await apiSend('POST', '/api/spawn-tuning-v2/policies/bundle/export', {
                source: customSrc, rollout_pct: rolloutPct, include_miniprogram: true,
            });
        } else {
            if (!modelId) {
                $('bundle-hint').innerHTML = '<span style="color:var(--bad)">需要选模型 (或填 policies.json 路径)</span>';
                return;
            }
            r = await apiSend('POST', '/api/spawn-tuning-v2/policies/build-and-export', {
                model_id: Number(modelId), rollout_pct: rolloutPct, include_miniprogram: true,
            });
        }
        if (r.ok) {
            const maeStr = r.average_curve_mae != null ? ` · avg MAE ${r.average_curve_mae.toFixed(4)}` : '';
            $('bundle-hint').innerHTML = `<span style="color:var(--good)">✓ ${r.policies_count} policies · ${(r.bundle_size_bytes/1024).toFixed(1)} KB${maeStr} · sha256=${r.sha256.slice(0,12)}…</span>`;
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
            host.innerHTML = '<div class="stat-card warn"><div class="stat-value">未导出</div><div class="stat-label">点击上方按钮生成</div></div>';
            return;
        }
        const m = r.meta || {};
        host.innerHTML = `
            <div class="stat-card good"><div class="stat-value">${m.n_contexts || 0}</div><div class="stat-label">contexts</div></div>
            <div class="stat-card"><div class="stat-value">${(r.bundle_size_bytes/1024).toFixed(1)} KB</div><div class="stat-label">大小</div></div>
            <div class="stat-card ${m.rollout_pct === 100 ? 'good' : 'warn'}"><div class="stat-value">${m.rollout_pct || 0}%</div><div class="stat-label">灰度比例</div></div>
            <div class="stat-card purple"><div class="stat-value">${fmtDate(r.modified_at)}</div><div class="stat-label">导出时间</div></div>
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
    const setSel = $('curve-set');
    const modelSel = $('curve-predict-model');
    if (!setSel) return;
    const prevSet = setSel.value;
    const prevModel = modelSel?.value;
    try {
        const [sets, models] = await Promise.all([
            apiGet('/api/spawn-tuning-v2/sample-sets?limit=100'),
            modelSel ? apiGet('/api/spawn-tuning-v2/models?limit=100') : Promise.resolve({ models: [] }),
        ]);
        setSel.innerHTML = '<option value="">— 不加载实测 —</option>' +
            (sets.sample_sets || []).map((s) => `<option value="${s.set_id}">#${s.set_id} ${escapeHtml(s.name)} (${s.sample_count || 0})</option>`).join('');
        if (prevSet) setSel.value = prevSet;
        if (modelSel) {
            modelSel.innerHTML = '<option value="">— 不推断 (只画目标 / 实测) —</option>' +
                (models.models || [])
                    .filter((m) => m.status === 'deployed' || m.status === 'staging' || m.status === 'archived')
                    .map((m) => `<option value="${m.model_id}">#${m.model_id} ${escapeHtml(m.name)} · ${escapeHtml(m.status)}</option>`)
                    .join('');
            if (prevModel) modelSel.value = prevModel;
        }
    } catch (e) {
        setSel.innerHTML = `<option value="">${escapeHtml(e.message)}</option>`;
    }
}

async function renderCurve() {
    const setId = $('curve-set').value;
    const groupBy = $('curve-group-by').value.trim();
    const modelId = $('curve-predict-model')?.value || '';
    const meta = $('curve-meta');
    meta.textContent = '加载中…';

    try {
        const targetResp = await apiGet('/api/spawn-tuning-v2/target-curve');
        const target = targetResp.curve;

        let observed = null;
        let nSamples = 0;
        let observedCtx = null;
        if (setId) {
            const url = `/api/spawn-tuning-v2/sample-sets/${setId}/aggregate${groupBy ? `?group_by=${encodeURIComponent(groupBy)}` : ''}`;
            const data = await apiGet(url);
            if (data.buckets?.length > 0) {
                observed = data.buckets[0].d_curve_avg;
                nSamples = data.buckets[0].n_samples;
                observedCtx = data.buckets[0].context || data.buckets[0].sample_ctx;
            }
        }

        // 模型预测: 用所选模型对一个有代表性的 context 推断 (优先实测 set 的 ctx, 否则用默认中位 ctx)
        let predicted = null;
        let predictNote = '';
        if (modelId) {
            const ctx = observedCtx || {
                difficulty: 'normal', generator: 'budget-p2', bot_policy: 'clear-greedy',
                pb_bin: 4000, lifecycle_stage: 'mature',
            };
            try {
                const r = await apiSend('POST', `/api/spawn-tuning-v2/models/${modelId}/predict-curve`, {
                    contexts: [ctx],
                });
                if (r.curves?.length > 0) {
                    predicted = r.curves[0];
                    predictNote = `预测 ctx = ${ctx.difficulty}:${ctx.generator}:${ctx.bot_policy}:${ctx.pb_bin}:${ctx.lifecycle_stage}`;
                }
            } catch (e) {
                predictNote = `<span style="color:var(--bad)">模型推断失败: ${escapeHtml(e.message)}</span>`;
            }
        }

        const canvas = $('d-curve-canvas');
        renderDCurveChart(canvas, {
            targetCurve: target,
            // 未选模型时传 null, chart 不画预测线 + 图例自动收起, 避免与目标线视觉重叠
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
        if (predicted) {
            const pm = computeChartMetrics(predicted, target);
            lines.push(`预测 vs 目标 MAE = ${fmtNumber(pm.mae, 4)}`);
            if (predictNote) lines.push(predictNote);
        } else if (modelId && predictNote) {
            lines.push(predictNote);
        } else if (!modelId) {
            lines.push('<span style="color:var(--muted)">未选模型 — 只显示目标 + 实测 (不画预测线)</span>');
        }
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
    $('job-device')?.addEventListener('change', () => { _deviceUserSelected = true; });
    $('metrics-modal-close').addEventListener('click', closeMetricsModal);
    $('metrics-modal').addEventListener('click', (e) => {
        if (e.target.id === 'metrics-modal') closeMetricsModal();
    });
    _setupMetricsChartHover();
    $('preview-modal-close').addEventListener('click', closePreviewModal);
    $('preview-modal').addEventListener('click', (e) => {
        if (e.target.id === 'preview-modal') closePreviewModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeMetricsModal(); closePreviewModal(); }
    });

    // v2.9.4: 切换 model_type 时自动调整 LR 默认值 (避免用户 transformer 用 lr=0.05 翻车)
    const mtSel = $('job-model-type');
    const lrInput = $('job-lr');
    if (mtSel && lrInput) {
        mtSel.addEventListener('change', () => {
            const isTransformer = mtSel.value === 'transformer';
            const current = Number(lrInput.value);
            // 仅在用户没改过 (仍是 ResNet 默认 1e-3 或 5e-2 或 transformer 默认 1e-3) 时自动调
            if (isTransformer && current > 5e-3) {
                lrInput.value = '1e-3';
                $('job-hint').innerHTML = '<span style="color:var(--muted)">Transformer 默认 lr 已切换到 1e-3 (Transformer 对 LR 敏感)</span>';
            } else if (!isTransformer && current < 5e-3) {
                // 从 transformer 切回 resnet, 把 1e-3 调回 5e-3 (resnet 默认值)
                lrInput.value = '5e-3';
                $('job-hint').innerHTML = '<span style="color:var(--muted)">ResNet 默认 lr 已切换到 5e-3</span>';
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    refreshOverview();
});
