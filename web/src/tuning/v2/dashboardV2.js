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
import { THETA_RANGES as THETA_RANGES_V2 } from './clientPolicyV2.js';

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

// v3.0.8: generator 与 game.js getSpawnPolicyMode() 严格 1:1 对齐 (无 alias)
//   - rule       = 启发式 (game.js _commitSpawn 走规则路径)
//   - generative = 生成式 (game.js _spawnBlocksWithModel 调 SpawnPolicyNet)
const ALL_DIM_VALUES = {
    difficulty: ['easy', 'normal', 'hard'],
    generator: ['rule', 'generative'],
    bot_policy: ['random', 'clear-greedy', 'survival'],
    pb_bin: ['500', '1500', '4000', '10000', '25000'],
    lifecycle_stage: ['onboarding', 'growth', 'mature', 'plateau'],
};

// v3.0.5: hq preset 关闭 MCTS 默认勾选 —
//   MCTS rollout 在浏览器单线程下单 action ≈ 9000 sim.step, maxSteps=800 时
//   单 sample 60-120s, 1700+ samples = 30+ 小时, 实际几乎不可用.
//   改用 lookahead-2 作为 hq 默认 bot (强度约 MCTS 75%, 速度提升 ~10x).
//   MCTS checkbox 仍保留, 高级用户需要时可手动勾选 + 同时降低 ctx/θ/maxSteps.
const PRESETS = {
    smoke:  { thetas: 3,  seeds: 1, maxSteps: 60, label: '🔥 烟雾测试 (~30 秒)' },
    debug:  { thetas: 5,  seeds: 2, maxSteps: 300, label: '🐞 日常调试 (~5 分)' },
    prod:   { thetas: 15, seeds: 2, maxSteps: 500, label: '🏭 生产训练 (~1 小时)' },
    hq:     {
        thetas: 8, seeds: 3, maxSteps: 500,
        label: '🎯 高质量 v3.0.5 (~1.5 小时, lookahead-2)',
        lookahead2: true,
        mcts: false,                         // v3.0.5: 浏览器跑 MCTS 不实用, 改用 lookahead-2
        pbBinDisable: ['10000', '25000'],
        botDisable: ['random'],
    },
    // v1.62.0 覆盖优先：实测显示 bot 仅在 pb_bin=500/1500 能接近 PB（r≥0.8），
    //   4000+ 完全够不着（r_max 0.57）；random bot r≥0.8 仅 2.7%。
    //   该 preset 把采样集中到"够得着的高分段"+强 bot+更多 seed 填满高 r bin，
    //   让 S 曲线爬升段有真实观测——这是通过 fact-eval 门禁的前提。
    coverage: {
        thetas: 12, seeds: 5, maxSteps: 800,
        label: '📊 覆盖优先 v1.62.0 (高分段, ~1 小时)',
        lookahead2: true,
        mcts: false,
        pbBinDisable: ['4000', '10000', '25000'],
        botDisable: ['random'],
    },
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
    const removeBtn = $('btn-remove-deploy');
    try {
        const data = await apiGet('/api/spawn-tuning-v2/policies/active');
        if (!data.deployed) {
            modelHost.innerHTML = '<div class="stat-card warn"><div class="stat-value">无</div><div class="stat-label">当前未部署模型</div></div>';
            $('btn-rollback').disabled = true;
            if (removeBtn) removeBtn.disabled = true;
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
            if (removeBtn) {
                removeBtn.disabled = false;
                removeBtn.dataset.modelId = m.model_id;
            }
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

/** 跨 tab 广播 — 让同 origin 的游戏页即时翻 badge，无需手工硬刷。 */
function _broadcastSpawnParamTuner(payload) {
    try {
        if (typeof BroadcastChannel !== 'function') return;
        const ch = new BroadcastChannel('openblock:spawn-param-tuner');
        ch.postMessage(payload);
        ch.close();
    } catch { /* 跨 tab 通知失败不影响主流程 */ }
}

/**
 * rollback 后同步 bundle 状态 — 修复「DB 已 rollback 但 bundle 文件仍挂在
 * web/public/spawn-tuning-v2/policies.json，游戏页 badge 还显示寻参」的状态分裂。
 *
 * 策略：
 *   - 若 rollback 后无任何 deployed model → 调 bundle/remove 物理删 bundle 并广播
 *     bundle-removed（游戏页 uninstallPoliciesV2 → badge 翻回规则）。
 *   - 若还有 prev deployed → 提示用户重新点 D.1 导出 bundle（bundle 仍指向旧 model，
 *     直接 fetch 会安装错版本；这里不自动删，避免静默丢失部署）。
 */
async function _syncBundleAfterRollback() {
    let activeData;
    try {
        activeData = await apiGet('/api/spawn-tuning-v2/policies/active');
    } catch { return null; }

    if (activeData?.deployed) {
        return {
            kind: 'has-prev-deployed',
            modelId: activeData.deployed.model_id,
            name: activeData.deployed.name,
        };
    }

    // 无 deployed → 清 bundle + 广播 uninstall
    try {
        const r = await apiSend('POST', '/api/spawn-tuning-v2/policies/bundle/remove', {
            include_miniprogram: true,
            include_dist: true,
            rollback_db: false, // 已 rollback 过，不再重复
        });
        _broadcastSpawnParamTuner({ type: 'bundle-removed', reason: 'rollback-no-deployed' });
        return { kind: 'cleared', removed: r?.removed || [] };
    } catch (e) {
        return { kind: 'clear-failed', error: e?.message || String(e) };
    }
}

async function rollbackCurrent() {
    const modelId = $('btn-rollback').dataset.modelId;
    if (!modelId) return;
    if (!(await showConfirmDialog(`模型 #${modelId} 将回滚为上一版。`, { title: `↩ 回滚 deployed 模型`, confirmLabel: '确认回滚' }))) return;
    try {
        const r = await apiSend('POST', `/api/spawn-tuning-v2/models/${modelId}/rollback`);
        const sync = await _syncBundleAfterRollback();
        let suffix = '';
        if (sync?.kind === 'cleared') {
            suffix = ` · 已清 bundle (${sync.removed.length} 文件) · 游戏页已通知卸载`;
        } else if (sync?.kind === 'has-prev-deployed') {
            suffix = ` · ⚠ bundle 仍指向旧版，请到 ④ 部署 D.1 用 #${sync.modelId} 重新导出`;
        } else if (sync?.kind === 'clear-failed') {
            suffix = ` · ⚠ bundle 清理失败: ${sync.error}`;
        }
        $('rollback-hint').innerHTML = `<span style="color:var(--good)">✓ 已回滚到模型 #${r.now_deployed || 'none'}${suffix}</span>`;
        refreshOverview();
        refreshBundleStatus();
    } catch (e) {
        $('rollback-hint').innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`;
    }
}

async function removeDeployment() {
    const btn = $('btn-remove-deploy');
    const modelId = btn?.dataset.modelId;
    if (!modelId) return;
    const ok = await showConfirmDialog(
        [
            `当前部署模型 #${modelId} 将被「卸载」：`,
            '',
            '  · 物理删除 web/public/spawn-tuning-v2/policies.json + meta.json',
            '  · 同步删除 dist/spawn-tuning-v2/* 镜像（如存在）',
            '  · 同步删除 miniprogram/core/tuning/spawnPoliciesV2.js',
            `  · DB 中 model #${modelId} 置为 rollbacked`,
            '',
            '游戏端会通过 BroadcastChannel 即时收到通知，badge 自动翻回「规则」',
            '（同 origin 的游戏页无需刷新；跨 origin 的需手工硬刷一次）。',
            '',
            '⚠ 此操作不会删除 .pt 权重文件，模型仍可在 ③ 训练 → 模型库 重新部署。',
        ].join('\n'),
        { title: `⊘ 移除模型部署 (回到规则版)`, confirmLabel: '确认卸载' },
    );
    if (!ok) return;
    try {
        const r = await apiSend('POST', '/api/spawn-tuning-v2/policies/bundle/remove', {
            include_miniprogram: true,
            include_dist: true,
            rollback_db: true,
        });
        _broadcastSpawnParamTuner({
            type: 'bundle-removed',
            reason: 'manual-remove',
            rolled_back_model_id: r?.rolled_back_model_id ?? null,
        });
        const errPart = (r?.errors?.length || 0) > 0
            ? ` · ⚠ ${r.errors.length} 个文件删除失败`
            : '';
        $('rollback-hint').innerHTML = `<span style="color:var(--good)">✓ 已卸载部署 · 移除 ${r?.removed?.length || 0} 个文件${errPart} · 游戏页已通知</span>`;
        refreshOverview();
        refreshBundleStatus();
        refreshModels?.();
    } catch (e) {
        $('rollback-hint').innerHTML = `<span style="color:var(--bad)">卸载失败: ${escapeHtml(e.message)}</span>`;
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
            // v2.10.34: disabled chip 不响应点击 (UI 占位 generator/bot)
            if (c.classList.contains('chip-disabled') || c.hasAttribute('disabled')) {
                e.preventDefault();
                return;
            }
            if (e.altKey || e.shiftKey) { editChipWeight(c); return; }
            c.classList.toggle('chip-on');
            updateEstimate();
        });
        c.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (c.classList.contains('chip-disabled')) return;
            editChipWeight(c);
        });
    });
    $('btn-dim-reset').addEventListener('click', () => {
        document.querySelectorAll('.chip-group .chip').forEach((c) => {
            // v2.10.34: reset 也跳过 disabled chip (保持禁用态)
            if (c.classList.contains('chip-disabled')) return;
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
    // preset 自动配置开关 + chip
    if (p.lookahead2 !== undefined) {
        const cb = $('cfg-lookahead2');
        if (cb) cb.checked = !!p.lookahead2;
    }
    // v3.0.1: mcts 开关
    if (p.mcts !== undefined) {
        const cb = $('cfg-mcts');
        if (cb) cb.checked = !!p.mcts;
    }
    // v3.0.1: bot chip 禁用 (e.g. 关 random)
    if (Array.isArray(p.botDisable)) {
        document.querySelectorAll('.chip-group[data-dim="bot_policy"] .chip').forEach((c) => {
            if (p.botDisable.includes(c.dataset.val)) {
                c.classList.remove('chip-on');
            }
        });
        const sel = readChipsSelection();
        const cntEl = document.querySelector('[data-count="bot_policy"]');
        if (cntEl) {
            cntEl.textContent = `${(sel.bot_policy || []).length}/${ALL_DIM_VALUES.bot_policy.length}`;
        }
    }
    if (Array.isArray(p.pbBinDisable)) {
        document.querySelectorAll('.chip-group[data-dim="pb_bin"] .chip').forEach((c) => {
            if (p.pbBinDisable.includes(c.dataset.val)) {
                c.classList.remove('chip-on');
            }
        });
        const sel = readChipsSelection();
        const cntEl = document.querySelector('[data-count="pb_bin"]');
        if (cntEl) {
            cntEl.textContent = `${(sel.pb_bin || []).length}/${ALL_DIM_VALUES.pb_bin.length}`;
        }
    }
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
    // v2.10.38: ETA 估算 — 大多数 sample 因死局/noMove 提前 break (~30-50% maxSteps),
    //   step 内开销 = budget-p2 bot 评分 ~5ms (而非 12ms 保守值)
    //   公式: total × maxSteps × 0.40 (实际触达率) × 0.006s/step
    //   实测 budget-p2 + clear-greedy 平均 sample ~30-60ms (maxSteps=240 时)
    const etaSec = total * maxSteps * 0.40 * 0.006;
    $('est-ctx').textContent = `${ctxCount} 场景`;
    $('est-theta').textContent = `${nThetas} θ`;
    $('est-seed').textContent = `${nSeeds} seed`;
    $('est-total').textContent = `${total.toLocaleString()} 样本`;
    if (etaSec < 60) $('est-eta').textContent = `~${Math.round(etaSec)}s`;
    else if (etaSec < 3600) $('est-eta').textContent = `~${(etaSec / 60).toFixed(1)}m`;
    else $('est-eta').textContent = `~${(etaSec / 3600).toFixed(1)}h`;

    $('btn-start-collect').disabled = ctxCount === 0;
}

// θ 范围 (27 维) 从 clientPolicyV2 单源 import — 跟 Python feature_io.THETA_RANGES 严格同步.

function _attachBotFlags(t) {
    // G8 v2.10.9: 1-step lookahead 开关
    // v2.10.32 (P1.2): 2-step lookahead 开关 (强 bot, 适合高 PB 档采样)
    // v2.10.33 (P2.1): MCTS rollout 开关 (最强 bot, 慢)
    const useLookahead = !!$('cfg-lookahead')?.checked;
    const useLookahead2 = !!$('cfg-lookahead2')?.checked;
    const useMCTS = !!$('cfg-mcts')?.checked;
    if (useLookahead || useLookahead2 || useMCTS) {
        t.use_lookahead_bot = true;
        if (useLookahead2) t.use_lookahead2_bot = true;
        if (useMCTS) {
            t.use_mcts_bot = true;
            t.mcts_rollouts = 30;
            t.mcts_rollout_steps = 30;
        }
    }
    return t;
}

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
    out.forEach(_attachBotFlags);
    return out;
}

// v3.0.6 (G2 闭环): θ 来源策略 — 从 deployed bundle 读 best θ* 抖动采样
//   - 'bundle-perturb': 围绕 ctx 对应 θ* ±10% 抖动, 让模型在 best 邻域学得更精细
//   - 'bundle-mix':     70% 抖动 + 30% LHS, 探索/利用混合
//   首次调用时 fetch 一次 deployed bundle, 缓存到 _deployedBundleCache.
let _deployedBundleCache = null;   // { ctxKey: theta_dict, ... }

async function _loadDeployedBundle() {
    if (_deployedBundleCache != null) return _deployedBundleCache;
    try {
        const r = await fetch(`${API_BASE}/spawn-tuning-v2/policies.json`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const map = {};
        for (const p of (j.policies || [])) {
            if (p.context_key && p.theta) map[p.context_key] = p.theta;
        }
        _deployedBundleCache = map;
        return map;
    } catch (e) {
        console.warn('[θ source] 加载 deployed bundle 失败, 回退 LHS:', e?.message);
        _deployedBundleCache = {};
        return _deployedBundleCache;
    }
}

/** 给 ctx 在其 θ* 附近抖动产生 n 个 θ (±jitter * range). */
function _perturbThetas(baseTheta, n, jitter = 0.10) {
    const keys = Object.keys(THETA_RANGES_V2);
    const out = Array.from({ length: n }, () => ({}));
    for (const k of keys) {
        const [lo, hi] = THETA_RANGES_V2[k];
        const range = hi - lo;
        // baseTheta 是 denormalized 真值字典, 直接用; 缺失 key 时取中点
        const base = (baseTheta && Number.isFinite(Number(baseTheta[k])))
            ? Number(baseTheta[k])
            : (lo + hi) / 2;
        for (let i = 0; i < n; i++) {
            // ±jitter*range 均匀抖动, clip 到 [lo, hi]
            const noise = (Math.random() * 2 - 1) * jitter * range;
            out[i][k] = Math.min(hi, Math.max(lo, base + noise));
        }
    }
    out.forEach(_attachBotFlags);
    return out;
}

/** v3.0.9: 生成 N 份 default θ (所有维度取范围中点 0.5 → denormalized). 用于 baseline 样本集. */
function _defaultThetas(n) {
    const keys = Object.keys(THETA_RANGES_V2);
    const out = Array.from({ length: n }, () => ({}));
    for (const k of keys) {
        const [lo, hi] = THETA_RANGES_V2[k];
        const mid = (lo + hi) / 2;
        for (let i = 0; i < n; i++) out[i][k] = mid;
    }
    out.forEach(_attachBotFlags);
    return out;
}

/** 根据 UI 选择的 θ 来源, 返回 ctx -> thetas[] 的工厂函数 (或 thetas 数组). */
async function _buildThetasFactory(nThetas) {
    const source = $('cfg-theta-source')?.value || 'lhs';
    if (source === 'lhs') {
        return _lhsThetas(nThetas);   // 静态数组, 全 ctx 共用 (老行为)
    }
    if (source === 'default') {
        // v3.0.9: 所有 θ 取中点, 生成 baseline 样本集 (用于 G3 撬动对照)
        return _defaultThetas(nThetas);
    }
    const bundle = await _loadDeployedBundle();
    const hasAnyBundle = Object.keys(bundle).length > 0;
    if (!hasAnyBundle) {
        console.warn('[θ source] deployed bundle 为空, 回退 LHS');
        return _lhsThetas(nThetas);
    }
    return (ctx) => {
        const key = ctx.context_key
            || `${ctx.difficulty}:${ctx.generator}:${ctx.bot_policy}:${ctx.pb_bin}:${ctx.lifecycle_stage}`;
        const baseTheta = bundle[key];
        if (!baseTheta) {
            // 该 ctx 不在 bundle 内, 回退 LHS
            return _lhsThetas(nThetas);
        }
        if (source === 'bundle-perturb') {
            return _perturbThetas(baseTheta, nThetas, 0.10);
        }
        // bundle-mix: 70% perturb + 30% LHS
        const nPerturb = Math.max(1, Math.round(nThetas * 0.7));
        const nLhs = Math.max(0, nThetas - nPerturb);
        const out = _perturbThetas(baseTheta, nPerturb, 0.10);
        if (nLhs > 0) out.push(..._lhsThetas(nLhs));
        return out;
    };
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
    // v3.0.5: 强制用 clear-greedy bot + 30 step + 临时 context (bot_policy=clear-greedy),
    //         否则 MCTS / lookahead2 smoke test 单局可耗时 20s+ 让用户以为卡住。
    //         smoke 本意只是验证 simulator/context/θ 不抛异常, 不需要真实 bot.
    $('collect-hint').innerHTML = '<span style="color:var(--muted)">🔧 smoke test (1 sample)…</span>';
    try {
        const smokeTheta = _lhsThetas(1)[0];
        // 剥掉重型 bot flag, 避免 smoke 阶段跑 MCTS / lookahead2
        delete smokeTheta.use_mcts_bot;
        delete smokeTheta.use_lookahead2_bot;
        delete smokeTheta.use_lookahead_bot;
        const smokeCtx = { ...contexts[0], bot_policy: 'clear-greedy' };
        const smokeMaxSteps = Math.min(30, maxSteps);
        // v2.10.35: runOneSampleV2 改 async (generative 需 await V3); smoke test 也要 await
        await runOneSampleV2({ context: smokeCtx, theta: smokeTheta, seed: 1, maxSteps: smokeMaxSteps });
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
    // v3.0.6 (G2): θ 来源支持 LHS / bundle-perturb / bundle-mix (闭环迭代)
    const thetasOrFactory = await _buildThetasFactory(nThetas);
    try {
        const result = await collectSamplesV2({
            setId, contexts, thetas: thetasOrFactory, nThetas, seedsPerTheta: nSeeds, maxSteps,
            apiBaseUrl: API_BASE, batchSize: 10,
            onProgress: (p) => {
                if (_samplerCancel.cancelled) return;
                const errPart = p.firstError
                    ? ` · <span style="color:var(--bad)" title="${escapeHtml(p.firstError)}">⚠ ${escapeHtml(p.firstError.slice(0, 60))}${p.firstError.length > 60 ? '…' : ''}</span>`
                    : '';
                // v3.0.5: 重型 bot 单 sample 60-120s, 显示当前进行中样本的耗时, 避免看着像"卡住"
                let inFlightPart = '';
                if (p.inFlight && p.inFlight.elapsedMs > 1500) {
                    const sec = (p.inFlight.elapsedMs / 1000).toFixed(1);
                    const color = p.inFlight.elapsedMs > 30000 ? 'var(--warn)' : 'var(--muted)';
                    inFlightPart = ` · <span style="color:${color}">⏳ #${p.inFlight.idx} 已耗 ${sec}s</span>`;
                }
                $('collect-hint').innerHTML = `set #${setId} · 进度 ${p.completed}/${p.total} (${Math.round(p.percent * 100)}%)${p.failed ? ` · ${p.failed} 失败` : ''}${inFlightPart}${errPart}`;
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
            const isReal = av === 'real-v1' || (s.tags || '').includes('real');
            const avBadge = isReal
                ? '<span style="background:#1e3a5f; color:#93c5fd; padding:1px 5px; border-radius:3px; font-size:10px;" title="玩家真实对局整理成的 v2 寻参样本(behavior_import), 与构造样本同 schema 一起训练/评估">👤 真实</span>'
                : av === 'v2.9'
                ? '<span style="background:#7f1d1d; color:#fecaca; padding:1px 5px; border-radius:3px; font-size:10px;" title="老算法采样, d_curve 几乎水平, 不建议训练">⚠ v2.9</span>'
                : av.startsWith('v2.10') || av.startsWith('v3')
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
                <button class="ghost btn-quality-set" data-id="${s.set_id}" data-name="${escapeHtml(s.name)}">🧪 质量</button>
                <button class="ghost btn-download-set" data-id="${s.set_id}" data-name="${escapeHtml(s.name)}" title="下载 JSONL.gz (流式, 体积压缩 ~70%)">⬇ 下载</button>
                <button class="ghost btn-train-from" data-id="${s.set_id}">→ 训练</button>
                <button class="ghost btn-analyze-from" data-id="${s.set_id}">📊 分析</button>
                <button class="danger btn-delete-set" data-id="${s.set_id}">删除</button>
              </td>
            </tr>
        `; }).join('');
        tbody.querySelectorAll('.btn-preview-set').forEach((b) => {
            b.addEventListener('click', () => showSetPreview(b.dataset.id, b.dataset.name, b.dataset.kind));
        });
        tbody.querySelectorAll('.btn-quality-set').forEach((b) => {
            b.addEventListener('click', () => showQualityModal(b.dataset.id, b.dataset.name));
        });
        // v2.10.16: 下载样本集 (JSONL.gz 流式)
        tbody.querySelectorAll('.btn-download-set').forEach((b) => {
            b.addEventListener('click', () => {
                const url = `${API_BASE}/api/spawn-tuning-v2/sample-sets/${b.dataset.id}/download?format=jsonl&gzip=1`;
                // 用临时 <a> 触发浏览器下载 (而非 fetch — 流式响应直接走浏览器流)
                const a = document.createElement('a');
                a.href = url;
                a.download = '';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
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


// 把主库玩家真实对局整理成 v2 寻参样本集 (behavior_import, 增量同步), 与构造样本无差别参训
async function syncBehaviorSamples({ silent = false } = {}) {
    const btn = $('btn-import-behavior');
    const hint = $('import-behavior-hint');
    if (btn) btn.disabled = true;
    if (hint && !silent) { hint.style.color = 'var(--muted)'; hint.textContent = '同步中…(回放盘面算 d_curve, 首次局数多时稍候)'; }
    try {
        // 增量: rebuild=false, 只转换新增对局(已导入按 session_id 跳过)
        const r = await apiSend('POST', '/api/spawn-tuning-v2/import-behavior', { rebuild: false });
        if (hint) {
            hint.style.color = 'var(--good)';
            hint.textContent = `✓ 用户行为样本集 #${r.set_id}: 共 ${r.total} 条`
                + (r.inserted ? ` (本次新增 ${r.inserted})` : '(已最新)')
                + (r.invalid ? ` · 滤除无效 ${r.invalid}` : '')
                + (r.cleaned ? ` · 清理旧无效 ${r.cleaned}` : '')
                + (r.errors ? ` · ${r.errors} 错` : '');
        }
        await refreshSampleSets();
        await refreshTrainingSampleSetOptions();
        return r;
    } catch (e) {
        if (hint && !silent) { hint.style.color = 'var(--bad)'; hint.textContent = `同步失败: ${e.message}`; }
        return null;
    } finally {
        if (btn) btn.disabled = false;
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
    kind: null,    // 'behavior' = 用户行为样本集 (走专属预览), 否则 d_curve 寻参集
    filters: {},   // { difficulty: [...], generator: [...], ... }; 空对象 = 全集
};

async function showSetPreview(setId, setName, kind) {
    _previewState.setId = setId;
    _previewState.setName = setName;
    _previewState.kind = kind || null;
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

// ─────────── G1 v2.10.8: 数据质量分析模态 ───────────

async function showQualityModal(setId, setName) {
    const modal = $('quality-modal');
    const body = $('quality-modal-body');
    $('quality-modal-title').textContent = `数据质量分析 — #${setId} ${setName}`;
    body.innerHTML = '<p class="muted-hint">加载中…</p>';
    modal.classList.add('show');
    try {
        const d = await apiGet(`/api/spawn-tuning-v2/sample-sets/${setId}/quality`);
        body.innerHTML = renderQualityBody(d);
    } catch (e) {
        body.innerHTML = `<p style="color:var(--bad)">${escapeHtml(e.message)}</p>`;
    }
}

function closeQualityModal() {
    $('quality-modal').classList.remove('show');
}

// ─────────── G15 v2.10.19: 业务命题评分模态 (复用 compare-modal) ───────────

async function showBizScorecardModal(modelId, modelName) {
    const modal = $('compare-modal');
    const body = $('compare-modal-body');
    modal.classList.add('show');
    body.innerHTML = '<p class="muted-hint">⏳ 推断 360 ctx 计算业务命题达成度…</p>';
    try {
        const r = await apiGet(`/api/spawn-tuning-v2/models/${modelId}/biz-scorecard`);
        const gradeColor = { A: '#34d399', B: '#60a5fa', C: '#fbbf24', D: '#f87171' }[r.grade] || '#9ca3af';
        const dims = r.dimensions || {};
        const dimCard = (key, label, emoji) => {
            const d = dims[key] || {};
            const s = d.score || 0;
            const cls = s >= 70 ? 'good' : s >= 55 ? 'warn' : 'bad';
            return `<div class="stat-card ${cls}" style="position:relative;">
                <div style="font-size:11px; color:var(--muted); margin-bottom:2px;">${emoji} ${label}</div>
                <div style="font-size:24px; font-weight:bold;">${s.toFixed(1)}</div>
                <div style="font-size:10px; color:var(--muted);">${d.metric || ''} = ${d.raw}</div>
            </div>`;
        };
        const hints = (r.hints || []).map((h) =>
            `<li style="padding:3px 0; font-size:11.5px;">${h.startsWith('✓') ? '<span style="color:var(--good)">' + escapeHtml(h) + '</span>' : '<span style="color:var(--warn)">' + escapeHtml(h) + '</span>'}</li>`,
        ).join('');
        body.innerHTML = `
          <div style="padding: 8px 4px;">
            <div style="display:flex; align-items:center; gap:16px; margin-bottom:12px;">
              <div style="font-size:60px; font-weight:bold; color:${gradeColor};">${r.grade}</div>
              <div>
                <div style="font-size:13px; color:var(--muted);">业务命题综合达成度</div>
                <div style="font-size:36px; font-weight:bold; color:${gradeColor};">${r.overall_score} <span style="font-size:14px; opacity:0.6;">/ 100</span></div>
                <div style="font-size:11px; color:var(--muted);">model #${modelId} ${escapeHtml(modelName)} · 评估了 ${r.n_contexts_evaluated} 个 ctx</div>
              </div>
            </div>
            <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0;">
              ${dimCard('balance', '平衡', '⚖')}
              ${dimCard('tension', '爽点', '⚡')}
              ${dimCard('fairness', '公平', '⚓')}
              ${dimCard('surprise', '惊喜', '🎁')}
            </div>
            <div style="margin-top: 12px; padding: 8px; background: rgba(96,165,250,0.06); border-radius: 4px;">
              <div style="font-size:12px; font-weight:600; margin-bottom:4px;">💡 改进建议</div>
              <ul style="margin: 0; padding-left: 20px; line-height: 1.6;">${hints}</ul>
            </div>
            <div style="margin-top: 8px; font-size: 10.5px; color: var(--muted); line-height: 1.5;">
              <b>业务命题来源</b> (用户原诉求 2026-05-25 16:08): "判断是否公平、是否有爽点、是否会让分数膨胀"<br>
              <b>评分权重</b>: 平衡 40% · 爽点 30% · 公平 20% · 惊喜 10%
            </div>
          </div>
        `;
    } catch (e) {
        body.innerHTML = `<p style="color:var(--bad)">${escapeHtml(e.message)}</p>`;
    }
}


// ─────────── G2 v2.10.8: 模型对比模态 ───────────

async function showCompareModal() {
    const modal = $('compare-modal');
    const body = $('compare-modal-body');
    modal.classList.add('show');
    body.innerHTML = '<p class="muted-hint">加载模型列表…</p>';
    try {
        const data = await apiGet('/api/spawn-tuning-v2/models?limit=200');
        const models = (data.models || []).filter((m) => m.weights_path);
        if (models.length < 2) {
            body.innerHTML = '<p class="muted-hint">需要至少 2 个有权重的模型才能对比。</p>';
            return;
        }
        const opts = models.map((m) => {
            const mae = m.metrics_json ? (() => {
                try { return JSON.parse(m.metrics_json).val_curve_mae; } catch { return null; }
            })() : null;
            return { id: m.model_id, label: `#${m.model_id} ${m.name} (${m.model_type}) ${mae != null ? `· mae=${mae.toFixed(4)}` : ''}` };
        });
        const checkboxes = opts.map((o) =>
            `<label style="display:block; padding:3px 6px; font-size:11.5px; cursor:pointer; line-height:1.5;">
              <input type="checkbox" value="${o.id}" class="compare-checkbox"> ${escapeHtml(o.label)}
            </label>`,
        ).join('');
        body.innerHTML = `
          <div style="margin-bottom:8px; font-size:11.5px; color:var(--muted);">
            选择 ≥ 2 个模型对比 (metric + d_curve 形态)
          </div>
          <div style="max-height:200px; overflow-y:auto; border:1px solid rgba(255,255,255,0.08); padding:4px;">
            ${checkboxes}
          </div>
          <!-- G16 v2.10.19: ctx 选择 (5 维) -->
          <div style="margin: 10px 0 4px; padding: 6px 8px; background: rgba(96,165,250,0.06); border-radius: 4px;">
            <div style="font-size:11px; color:var(--muted); margin-bottom:4px;">推断场景 (5 维 ctx)</div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; font-size:11px;">
              <label style="display:flex; flex-direction:column; gap:2px;">难度
                <select id="cmp-difficulty" style="height:24px; font-size:11px;">
                  <option value="easy">easy</option>
                  <option value="normal" selected>normal</option>
                  <option value="hard">hard</option>
                </select>
              </label>
              <label style="display:flex; flex-direction:column; gap:2px;">生成器
                <select id="cmp-generator" style="height:24px; font-size:11px;">
                  <option value="triplet-p1" selected>triplet-p1</option>
                  <option value="budget-p2">budget-p2</option>
                </select>
              </label>
              <label style="display:flex; flex-direction:column; gap:2px;">Bot
                <select id="cmp-bot" style="height:24px; font-size:11px;">
                  <option value="random">random</option>
                  <option value="clear-greedy" selected>clear-greedy</option>
                  <option value="survival">survival</option>
                </select>
              </label>
              <label style="display:flex; flex-direction:column; gap:2px;">PB 档
                <select id="cmp-pb" style="height:24px; font-size:11px;">
                  <option value="500">500</option>
                  <option value="1500">1500</option>
                  <option value="4000" selected>4000</option>
                  <option value="10000">10000</option>
                  <option value="25000">25000</option>
                </select>
              </label>
              <label style="display:flex; flex-direction:column; gap:2px;">生命周期
                <select id="cmp-lifecycle" style="height:24px; font-size:11px;">
                  <option value="onboarding">onboarding</option>
                  <option value="growth">growth</option>
                  <option value="mature" selected>mature</option>
                  <option value="plateau">plateau</option>
                </select>
              </label>
            </div>
          </div>
          <div style="margin:8px 0;">
            <button id="compare-go" class="primary">▶ 对比</button>
            <span style="margin-left:8px; font-size:11px; color:var(--muted);">不同 ctx 下模型表现可能差异显著</span>
          </div>
          <div id="compare-result"></div>
        `;
        $('compare-go').addEventListener('click', runCompare);
    } catch (e) {
        body.innerHTML = `<p style="color:var(--bad)">${escapeHtml(e.message)}</p>`;
    }
}

function closeCompareModal() {
    $('compare-modal').classList.remove('show');
}

async function runCompare() {
    const checked = [...document.querySelectorAll('.compare-checkbox:checked')].map((c) => Number(c.value));
    const result = $('compare-result');
    if (checked.length < 2) {
        result.innerHTML = '<p style="color:var(--warn)">请至少选 2 个</p>';
        return;
    }
    result.innerHTML = '<p class="muted-hint">⏳ 对每个模型推断 d_curve…</p>';

    // v2.10.19 G16: 用户可选 ctx (5 维), 默认 default ctx
    const ctx = {
        difficulty: $('cmp-difficulty')?.value || 'normal',
        generator: $('cmp-generator')?.value || 'triplet-p1',
        bot_policy: $('cmp-bot')?.value || 'clear-greedy',
        pb_bin: Number($('cmp-pb')?.value) || 4000,
        lifecycle_stage: $('cmp-lifecycle')?.value || 'mature',
    };
    const curves = [];
    for (const mid of checked) {
        try {
            const [modelInfo, predRes] = await Promise.all([
                apiGet(`/api/spawn-tuning-v2/models/${mid}`),
                apiSend('POST', `/api/spawn-tuning-v2/models/${mid}/predict-curve`, { contexts: [ctx] }),
            ]);
            const mae = modelInfo.metrics_json ? (() => {
                try { return JSON.parse(modelInfo.metrics_json); } catch { return {}; }
            })() : {};
            curves.push({
                model_id: mid,
                name: modelInfo.name || `#${mid}`,
                model_type: modelInfo.model_type,
                curve: predRes.curves[0],
                metrics: mae,
            });
        } catch (e) {
            curves.push({ model_id: mid, error: e.message });
        }
    }

    // 表格 + 叠加曲线
    const validCurves = curves.filter((c) => c.curve);
    const colors = ['#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee'];
    const legend = validCurves.map((c, i) =>
        `<span style="color:${colors[i % colors.length]}; margin-right:12px;">● ${c.name}</span>`,
    ).join('');
    // 简单 ASCII-art canvas: 用 SVG
    const W = 600, H = 200, PAD = { l: 40, r: 10, t: 10, b: 25 };
    const cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b;
    const n = 20;
    const xAt = (i) => PAD.l + (cw * i) / (n - 1);
    const yAt = (v) => PAD.t + ch - ch * v;  // y ∈ [0, 1]
    const polyLines = validCurves.map((c, i) => {
        const pts = c.curve.map((v, j) => `${xAt(j)},${yAt(v)}`).join(' ');
        return `<polyline points="${pts}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="1.8" />`;
    }).join('');
    const yTicks = [0, 0.25, 0.5, 0.75, 1.0].map((y) =>
        `<line x1="${PAD.l}" y1="${yAt(y)}" x2="${PAD.l + cw}" y2="${yAt(y)}" stroke="rgba(255,255,255,0.08)"/>
         <text x="${PAD.l - 4}" y="${yAt(y) + 3}" fill="#9ca3af" font-size="9" text-anchor="end" font-family="ui-monospace">${y.toFixed(2)}</text>`,
    ).join('');
    const xTicks = [0, 5, 10, 15, 19].map((i) =>
        `<text x="${xAt(i)}" y="${PAD.t + ch + 14}" fill="#9ca3af" font-size="9" text-anchor="middle" font-family="ui-monospace">r=${((i + 0.5) * 0.1).toFixed(1)}</text>`,
    ).join('');
    // metric 对比表
    const metricKeys = ['val_ideal_mae', 'val_curve_mae', 'val_curve_var', 'val_anchor', 'val_target_fit'];
    const rows = validCurves.map((c) => {
        const m = c.metrics;
        const cells = metricKeys.map((k) => `<td style="padding:3px 8px; text-align:right; font-family:ui-monospace;">${m[k] != null ? Number(m[k]).toFixed(4) : '-'}</td>`).join('');
        return `<tr><td style="padding:3px 8px;">#${c.model_id} ${escapeHtml(c.name)} <span style="color:var(--muted)">(${c.model_type})</span></td>${cells}</tr>`;
    }).join('');

    result.innerHTML = `
      <div style="margin:8px 0;">${legend}</div>
      <svg width="${W}" height="${H}" style="background:rgba(0,0,0,0.2); border-radius:4px;">
        ${yTicks}${xTicks}${polyLines}
      </svg>
      <table style="width:100%; font-size:11px; margin-top:10px; border-collapse:collapse;">
        <thead><tr style="color:var(--muted);">
          <th style="text-align:left; padding:3px 8px;">模型</th>
          ${metricKeys.map((k) => `<th style="text-align:right; padding:3px 8px;">${k}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
}

function renderQualityBody(d) {
    if (d.error) return `<p style="color:var(--warn)">${escapeHtml(d.error)}</p>`;
    const q = d.quality_score || 0;
    const qColor = q > 0.7 ? 'var(--good)' : q > 0.4 ? 'var(--warn)' : 'var(--bad)';
    const qLabel = q > 0.7 ? '✓ 优' : q > 0.4 ? '⚠ 中' : '✗ 差';
    const rd = d.r_distribution || {};
    const ds = d.d_curve_stats || {};
    const bp = d.bot_performance || {};
    // r 分布条形图
    const maxCnt = Math.max(...(rd.counts || [1]), 1);
    const totalCnt = (rd.counts || []).reduce((s, c) => s + c, 0) || 1;
    const rBars = (rd.counts || []).map((c, i) => {
        const lo = (i * 0.2).toFixed(1);
        const hi = ((i + 1) * 0.2).toFixed(1);
        const w = Math.round((c / maxCnt) * 100);
        // v2.10.37: 百分比 (相对总样本数, 不是 maxCnt)
        const pct = ((c / totalCnt) * 100).toFixed(1);
        const isBelowPb = i < 5;
        const color = isBelowPb ? '#60a5fa' : '#34d399';
        return `<div style="display:flex; align-items:center; font-size:11px; gap:6px; padding:2px 0;">
          <span style="width:80px; color:var(--muted); font-family:ui-monospace;">[${lo},${hi})</span>
          <div style="flex:1; background:rgba(255,255,255,0.04); height:14px; position:relative;">
            <div style="width:${w}%; height:100%; background:${color};"></div>
          </div>
          <span style="width:48px; text-align:right; font-family:ui-monospace;">${c}</span>
          <span style="width:48px; text-align:right; font-family:ui-monospace; color:var(--muted);">${pct}%</span>
        </div>`;
    }).join('');
    // d_curve 平均/std mini 表
    const dRows = (ds.avg || []).map((v, i) => {
        const r = ((i + 0.5) * 0.1).toFixed(2);
        const std = (ds.std || [])[i] || 0;
        return `<tr>
          <td style="padding:1px 6px; color:var(--muted); font-family:ui-monospace;">r=${r}</td>
          <td style="padding:1px 6px; font-family:ui-monospace;">${v.toFixed(3)}</td>
          <td style="padding:1px 6px; font-family:ui-monospace; color:var(--muted);">±${std.toFixed(3)}</td>
        </tr>`;
    }).join('');
    const warns = (d.warnings || []).map((w) =>
        `<li style="color:var(--warn); margin:3px 0;">⚠ ${escapeHtml(w)}</li>`,
    ).join('');
    return `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; padding:6px 4px;">
        <div>
          <div style="font-size:13px; font-weight:600; margin-bottom:6px;">综合评分</div>
          <div style="font-size:36px; color:${qColor}; font-weight:bold;">${q} <span style="font-size:13px;">${qLabel}</span></div>
          <div style="font-size:11px; color:var(--muted); margin-top:4px;">分析了 ${d.n_samples_analyzed}/${d.n_samples_total} 个样本</div>
        </div>
        <div>
          <div style="font-size:13px; font-weight:600; margin-bottom:6px;">Bot 表现</div>
          <div style="font-size:11.5px; font-family:ui-monospace; line-height:1.6;">
            破 PB 率: <b>${(bp.pb_break_rate * 100).toFixed(1)}%</b> <span style="color:var(--muted);">(健康 10-20%)</span><br>
            中位生存步数: <b>${bp.median_survived_steps}</b><br>
            平均消行率: <b>${bp.avg_clear_rate.toFixed(3)}</b><br>
            no_move 率: <b>${(bp.no_move_rate * 100).toFixed(1)}%</b> <span style="color:var(--muted);">(决定 D=1.0 数据可达性)</span>
          </div>
        </div>
      </div>

      <hr style="border-color: rgba(255,255,255,0.08); margin: 10px 0;">

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
        <div>
          <div style="font-size:13px; font-weight:600; margin-bottom:6px;">r = score/PB 分布</div>
          <div style="font-size:11px; color:var(--muted); margin-bottom:4px;">中位 r=${rd.median_r} · 平均 r=${rd.mean_r} · 最大 r=${rd.max_r}</div>
          <div style="font-size:11px; color:var(--muted); margin-bottom:6px;">r&lt;0.2 占 <b>${rd.ratio_low_pct}%</b> · r≥1.0 (破 PB) 占 <b style="color:var(--good)">${rd.ratio_above_pb_pct}%</b></div>
          ${rBars}
        </div>
        <div>
          <div style="font-size:13px; font-weight:600; margin-bottom:6px;">d_curve 形态</div>
          <div style="font-size:11px; color:var(--muted); margin-bottom:6px;">
            跨度: <b style="color:${ds.spread > 0.4 ? 'var(--good)' : 'var(--warn)'}">${ds.spread}</b>
            ${ds.spread_vs_ideal > 0 ? ` <span style="color:var(--muted);">(距 ideal 跨度 0.80 差 ${ds.spread_vs_ideal})</span>` : ''}
            <br>vs ★ ideal target MAE: <b>${ds.ideal_mae ?? '-'}</b> <span style="color:var(--muted);">(越低越接近业务期望)</span><br>
            倒退 bin 数: <b style="color:${ds.n_decreasing_bins > 3 ? 'var(--warn)' : 'var(--good)'}">${ds.n_decreasing_bins}</b> / 19
          </div>
          <div style="max-height: 280px; overflow-y: auto;">
            <table style="width:100%; font-size:11px;">
              <thead><tr style="color:var(--muted);">
                <th style="text-align:left; padding:1px 6px;">bin</th>
                <th style="text-align:right; padding:1px 6px;">avg d</th>
                <th style="text-align:right; padding:1px 6px;">std</th>
              </tr></thead>
              <tbody>${dRows}</tbody>
            </table>
          </div>
        </div>
      </div>

      ${warns ? `<hr style="border-color: rgba(255,255,255,0.08); margin: 10px 0;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">⚠ 数据质量警告</div>
      <ul style="margin: 4px 0; padding-left: 20px; font-size:11px; line-height:1.5;">${warns}</ul>` : ''}
    `;
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
    // v2.10.32 (P0.1): 加入 bins_filled / r_mean 透明化卡片
    const bfMean = lbl.bins_filled_mean ?? null;
    const bfPct = bfMean != null ? (bfMean / 20 * 100) : null;
    const bfColor = bfPct == null ? 'var(--text)'
        : bfPct < 40 ? 'var(--bad)' : bfPct < 70 ? 'var(--warn)' : 'var(--good)';
    const rMean = lbl.r_mean ?? null;
    const rColor = rMean == null ? 'var(--text)'
        : rMean < 0.3 ? 'var(--bad)' : rMean < 0.7 ? 'var(--warn)' : 'var(--good)';
    const tiles = `
        <div class="pv-stat-tile"><div class="v">${(lbl.n || 0).toLocaleString()}</div><div class="l">总样本数</div></div>
        <div class="pv-stat-tile"><div class="v">${fs.mean || '-'}</div><div class="l">final_score 均值</div></div>
        <div class="pv-stat-tile"><div class="v">${fs.p50 ?? '-'}<span style="font-size:9px; color:var(--muted)"> / ${fs.p90 ?? '-'}</span></div><div class="l">分数 p50 / p90</div></div>
        <div class="pv-stat-tile" title="bot 实际打到的 score/PB 均值. 越接近 1 说明 bot 能力越覆盖 PB 区, d_curve 越真实."><div class="v" style="color:${rColor}">${rMean != null ? rMean.toFixed(3) : '-'}</div><div class="l">avg r (score/PB)</div></div>
        <div class="pv-stat-tile" title="20 bin 中真实观察的 bin 数. 其余靠 _pbAwareDPbBase 先验填充. 高 PB 桶通常很低."><div class="v" style="color:${bfColor}">${bfMean != null ? bfMean.toFixed(1) : '-'}<span style="font-size:9px; color:var(--muted)">/20</span></div><div class="l">真实观察 bin</div></div>
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
            const isReal = av === 'real-v1' || (s.tags || '').includes('real');
            const avTag = isReal ? ' [👤真实] ' : isV29 ? ' [⚠v2.9 旧] ' : ` [${av}] `;
            return `<option value="${s.set_id}"${sel_attr}>${statusBadge} #${s.set_id}${avTag}${escapeHtml(s.name)} (${s.sample_count || 0} 样本)</option>`;
        }).join('');
        // v2.10.1: 仅 v2.9 才算"老数据", v2.10/v2.10.1 都 OK
        const allV29 = sets.length > 0 && sets.every((s) => (s.algo_version || 'v2.10') === 'v2.9');
        const hint = $('job-hint');
        if (allV29 && hint && !hint.dataset.dismissedV29) {
            hint.innerHTML = '<span style="color:var(--warn)">⚠ 当前所有样本集都是 v2.9 旧算法 (d_curve 平坦, 模型学不出 S 形)。请到 ② 样本构建 重新采集 (新数据自动标 v2.10)。</span>';
        }
        // G3 v2.10.8: 选择 sample 或 model_type 变化时自动推荐参数
        sel.addEventListener('change', () => recommendTrainingParams(sets));
        const mtSel = $('job-model-type');
        if (mtSel && !mtSel.dataset.g3Bound) {
            mtSel.addEventListener('change', () => recommendTrainingParams(sets));
            mtSel.dataset.g3Bound = '1';
        }
    } catch { /* server 挂时保留旧 options */ }
}

// G3 v2.10.8: 智能推荐训练参数
function recommendTrainingParams(allSets) {
    const sel = $('job-sets');
    const setIds = [...sel.selectedOptions].map((o) => parseInt(o.value, 10)).filter(Number.isFinite);
    if (setIds.length === 0) return;
    const selectedSets = (allSets || []).filter((s) => setIds.includes(s.set_id));
    const totalSamples = selectedSets.reduce((sum, s) => sum + (s.sample_count || 0), 0);
    const modelType = $('job-model-type')?.value || 'resnet';

    // 根据样本量推荐 (经验法则)
    let epochs, batchSize, lr, patience, hint;
    if (totalSamples === 0) return;
    if (totalSamples < 5000) {
        // 小数据: 小 batch, 多 epoch
        epochs = 50; batchSize = 64; patience = 15;
        hint = '小数据集 (< 5K), 用小 batch + 多 epoch 让模型充分学习';
    } else if (totalSamples < 30000) {
        epochs = 40; batchSize = 128; patience = 12;
        hint = '中等数据集, 平衡 batch 跟 epoch';
    } else if (totalSamples < 100000) {
        epochs = 30; batchSize = 256; patience = 10;
        hint = '中大数据集, 标准参数';
    } else {
        epochs = 25; batchSize = 512; patience = 8;
        hint = '大数据集 (≥ 100K), 用大 batch 加快训练';
    }
    if (modelType === 'transformer') {
        lr = 0.001;  // Transformer 对 LR 敏感
        hint += ' · Transformer 用 lr=0.001 (避免退化解)';
    } else {
        lr = 0.005;
        hint += ' · ResNet 用 lr=0.005';
    }

    // 应用 (仅当用户没手动改过时, 通过 dataset.dirty 标记跟踪)
    const fields = [
        ['job-epochs', epochs], ['job-batch', batchSize], ['job-lr', lr],
    ];
    fields.forEach(([id, val]) => {
        const el = $(id);
        if (el && !el.dataset.userDirty) {
            // v2.10.13: LR 等数值统一显示普通小数 (避免 0.001 被某些浏览器显示为 1e-3)
            el.value = (id === 'job-lr') ? String(val) : val;
            // 第一次设置后, 监听 input 标记 dirty
            if (!el.dataset.g3Bound) {
                el.addEventListener('input', () => { el.dataset.userDirty = '1'; });
                el.dataset.g3Bound = '1';
            }
        }
    });
    const h = $('job-hint');
    if (h) {
        h.innerHTML = `<span style="color:var(--muted); font-size:11px;">💡 已根据 ${totalSamples} 样本 + ${modelType} 推荐参数 — ${hint}</span>`;
    }
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
    // G10 v2.10.9: Transformer 超参写入 arch_json
    if (modelType === 'transformer') {
        const dModel = parseInt($('job-tx-dmodel')?.value || '128', 10);
        const nLayers = parseInt($('job-tx-nlayers')?.value || '3', 10);
        body.arch.d_model = dModel;
        body.arch.n_layers = nLayers;
    }
    // G17 v2.10.19: LossWeights 专家模式 (默认全部跟 v2.10.6 一致, 只在用户改过时才提交)
    const lwIds = {
        shape: 'lw-shape', balance: 'lw-balance', surprise: 'lw-surprise',
        breaking: 'lw-breaking', smooth: 'lw-smooth', aux: 'lw-aux',
        pb_distribution: 'lw-pb-dist', anchor: 'lw-anchor',
        monotonic: 'lw-monotonic', target_fit: 'lw-target-fit', endpoint: 'lw-endpoint',
    };
    const lwDefaults = {
        shape: 2.0, balance: 0.15, surprise: 0.3, breaking: 0.5, smooth: 0.04,
        aux: 0.2, pb_distribution: 0.0, anchor: 3.0,
        monotonic: 2.5, target_fit: 1.8, endpoint: 1.5,
    };
    const lwOverrides = {};
    for (const [k, id] of Object.entries(lwIds)) {
        const v = Number($(id)?.value);
        if (Number.isFinite(v) && Math.abs(v - lwDefaults[k]) > 1e-9) {
            lwOverrides[k] = v;
        }
    }
    if (Object.keys(lwOverrides).length > 0) {
        body.loss_weights = lwOverrides;
    }
    const baseId = Number($('job-base').value);
    if (baseId > 0) body.base_model_id = baseId;
    try {
        const r = await apiSend('POST', '/api/spawn-tuning-v2/jobs', body);
        // v3.0.9 (G4): 训练完后自动 build-and-export bundle (含 optimize_theta)
        const autoExport = !!$('job-auto-export')?.checked;
        if (autoExport && r.job_id) {
            _autoExportPendingJobs.add(r.job_id);
        }
        const exportNote = autoExport ? ' · ⚡ 训完自动部署' : '';
        $('job-hint').innerHTML = `<span style="color:var(--good)">✓ 已提交 #${r.job_id}${exportNote} (queued → running 自动轮询中…)</span>`;
        refreshJobs();
        startJobsAutoRefresh();   // 启动自动轮询
    } catch (e) {
        $('job-hint').innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`;
    }
}

// v3.0.9 (G4 一键闭环): 待 auto-export 的 jobs (轮询发现 completed 时自动调 build-and-export)
const _autoExportPendingJobs = new Set();
const _autoExportInFlight = new Set();   // 防重入

async function _maybeAutoExport(job) {
    if (!job || !job.job_id || _autoExportInFlight.has(job.job_id)) return;
    if (!_autoExportPendingJobs.has(job.job_id)) return;
    // v3.0.21: backend job_executor 实际写 status='done' (历史命名), 兼容 'completed' 防回归
    //   bug 修复: v3.0.9 起这里写 === 'completed' 永远不匹配 → auto-deploy 静默失效
    const isFinished = job.status === 'done' || job.status === 'completed';
    // v3.0.24 修复: schema 字段叫 output_model_id, 之前误用 job.model_id (永远 undefined) → 自动部署一直没生效
    //   兼容 fallback model_id, 防止历史/外部 API 改名 (如未来重命名同步前端)
    const finalModelId = job.output_model_id || job.model_id;
    if (!isFinished || !finalModelId) return;
    _autoExportInFlight.add(job.job_id);
    _autoExportPendingJobs.delete(job.job_id);
    try {
        $('job-hint').innerHTML = `<span style="color:var(--muted)">⏳ #${job.job_id} 完成, 自动导出 bundle (含 θ 寻参, ~1-90s)…</span>`;
        const r = await apiSend('POST', '/api/spawn-tuning-v2/policies/build-and-export', {
            model_id: Number(finalModelId),
            rollout_pct: 100,
            include_miniprogram: true,
            optimize_theta: true,
        });
        if (r.ok) {
            $('job-hint').innerHTML = `<span style="color:var(--good)">✓ #${job.job_id} 训练+部署完成 (avg MAE ${r.average_curve_mae?.toFixed(4) ?? '?'})</span>`;
            refreshOverview();
            // v3.0.25: auto-deploy 路径之前漏发 bundle-updated 广播 → 游戏页 badge 不刷新, 用户得手动 reload
            //   现在跟手动 exportBundle 一样, 走完成功路径就广播 + 刷新各处显示
            try { refreshBundleStatus(); } catch { /* ignore */ }
            try { refreshModels(); } catch { /* ignore */ }
            _broadcastSpawnParamTuner({
                type: 'bundle-updated',
                model_id: r.model_id,
                sha256: r.sha256,
                generated_at: r.generated_at,
                rollout_pct: r.rollout_pct,
                deployed: r.deploy?.deployed === true,
                source: 'auto-deploy',
            });
        } else {
            $('job-hint').innerHTML = `<span style="color:var(--bad)">⚠ #${job.job_id} 训完成功但 export 失败: ${escapeHtml(r.error || 'unknown')}</span>`;
        }
    } catch (e) {
        $('job-hint').innerHTML = `<span style="color:var(--bad)">⚠ #${job.job_id} 自动 export 失败: ${escapeHtml(e.message)}</span>`;
    } finally {
        _autoExportInFlight.delete(job.job_id);
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
        // v3.0.24: 切 tab 后仍需处理 auto-deploy 待办 (否则 user 一切走就丢了部署触发)
        //   仅当无 pending 且 training tab 不可见时, 才暂停 (省 CPU)
        const trainingTab = document.querySelector('.tab[data-tab="training"]');
        const hasPending = _autoExportPendingJobs.size > 0;
        if (!trainingTab?.classList.contains('active') && !hasPending) return;
        try {
            const data = await apiGet('/api/spawn-tuning-v2/jobs?limit=30');
            const jobs = data.jobs || [];
            const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
            _renderJobsRows(jobs);
            // v3.0.9 (G4): 检查 auto-export 待办 — 训练完成且未导出过的 job
            // v3.0.21 修复: backend 实际写 status='done' (历史命名), 之前错写 'completed' → 静默失效
            for (const j of jobs) {
                const finished = j.status === 'done' || j.status === 'completed';
                if (_autoExportPendingJobs.has(j.job_id) && finished) {
                    _maybeAutoExport(j);   // 内部防重入, 不 await
                }
            }
            // v3.0.24: pending Set 非空时不计 idle, 避免 build-and-export 还没触发就停轮询
            if (active === 0 && _autoExportPendingJobs.size === 0 && _autoExportInFlight.size === 0) {
                _jobsPollIdleTicks += 1;
                if (_jobsPollIdleTicks >= 3) {
                    stopJobsAutoRefresh();
                    // 自动同步刷新模型库 (新模型可能已写入)
                    refreshModels();
                    refreshOverview();
                    $('job-hint').innerHTML = `<span style="color:var(--good)">✓ 当前无运行中任务, 自动轮询已停止</span>`;
                }
            } else if (active > 0) {
                _jobsPollIdleTicks = 0;
                $('job-hint').innerHTML = `<span style="color:var(--accent)">⏳ ${active} 个任务运行中, 每 2s 自动刷新…</span>`;
            } else {
                // active=0 但仍有 pending 或 in-flight → 显示明确状态, 别误导 user
                _jobsPollIdleTicks = 0;
                const pendingN = _autoExportPendingJobs.size;
                const flightN = _autoExportInFlight.size;
                $('job-hint').innerHTML = `<span style="color:var(--accent)">⏳ 自动部署中 (pending=${pendingN}, in-flight=${flightN})…</span>`;
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
                <button class="ghost btn-job-log ${j.status === 'failed' ? 'danger' : ''}" data-id="${j.job_id}" title="展开本行查看关键问题日志 (错误/进度根因)">${j.status === 'failed' ? '⚠ 日志' : '📄 日志'}</button>
                <button class="ghost btn-job-metrics" data-id="${j.job_id}" data-name="${escapeHtml(j.name || '-')}">📊 曲线</button>
                ${j.output_model_id ? `<button class="ghost btn-view-model" data-id="${j.output_model_id}" title="跳转到模型库并高亮 model #${j.output_model_id}">→ 模型 #${j.output_model_id}</button>` : ''}
                <button class="danger btn-delete-job" data-id="${j.job_id}" data-name="${escapeHtml(j.name || '-')}" data-status="${j.status}" title="${deleteTitle}">${deleteLabel}</button>
              </td>
            </tr>
        `;
    }).join('');
    tbody.querySelectorAll('.btn-job-log').forEach((b) => {
        b.addEventListener('click', () => toggleJobLog(b.dataset.id, b));
    });
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

/** C.2: 展开/收起当前任务行, 内联展示关键问题日志 (错误根因 + 日志尾部)。 */
async function toggleJobLog(jobId, btnEl) {
    const tr = btnEl.closest('tr');
    if (!tr) return;
    const next = tr.nextElementSibling;
    // 再次点击 → 收起
    if (next && next.classList.contains('job-log-row') && next.dataset.jobId === String(jobId)) {
        next.remove();
        btnEl.classList.remove('active');
        return;
    }
    // 先移除其他已展开的日志行 (一次只展开一个)
    $('jobs-table').querySelectorAll('tr.job-log-row').forEach((r) => r.remove());
    $('jobs-table').querySelectorAll('.btn-job-log.active').forEach((b) => b.classList.remove('active'));

    const detail = document.createElement('tr');
    detail.className = 'job-log-row';
    detail.dataset.jobId = String(jobId);
    detail.innerHTML = '<td colspan="9" style="background:rgba(2,6,23,0.55); padding:10px 14px;">'
        + '<div class="job-log-box muted-hint">加载日志中…</div></td>';
    tr.after(detail);
    btnEl.classList.add('active');

    try {
        const d = await apiGet(`/api/spawn-tuning-v2/jobs/${jobId}/log`);
        detail.querySelector('.job-log-box').innerHTML = renderJobLog(d);
        detail.querySelector('.btn-job-log-close')?.addEventListener('click', () => {
            detail.remove();
            btnEl.classList.remove('active');
        });
    } catch (e) {
        detail.querySelector('.job-log-box').innerHTML =
            `<span style="color:var(--bad)">日志加载失败: ${escapeHtml(e.message)}</span>`;
    }
}

/** 渲染关键问题日志: 错误摘要 + 关键行高亮 + 可折叠完整尾部。 */
function renderJobLog(d) {
    const mono = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; line-height:1.5;';
    const errBanner = d.error_message
        ? `<div style="margin-bottom:8px; padding:6px 10px; border-left:3px solid var(--bad);
              background:rgba(127,29,29,0.25); border-radius:3px; ${mono} color:#fecaca;">
             <b>error_message:</b> ${escapeHtml(d.error_message)}
           </div>`
        : '';

    let keyBlock;
    if (d.key_lines && d.key_lines.length) {
        const rows = d.key_lines.map((k) => {
            if (k.n === -1) {
                return `<div style="color:var(--muted); ${mono}">${escapeHtml(k.text)}</div>`;
            }
            return `<div style="${mono} color:#fca5a5; white-space:pre-wrap;">`
                + `<span style="color:var(--muted)">${String(k.n).padStart(4)} │ </span>${escapeHtml(k.text)}</div>`;
        }).join('');
        keyBlock = `<div style="font-size:12px; font-weight:600; margin:4px 0;">🔑 关键问题行 (${d.key_lines.length})</div>
            <div style="background:#0b0f1a; border:1px solid #1f2937; border-radius:4px; padding:8px 10px; overflow-x:auto;">${rows}</div>`;
    } else if (d.exists) {
        keyBlock = '<div class="muted-hint">未匹配到错误关键词 (任务可能正常运行 / 已完成)。见下方完整日志尾部。</div>';
    } else {
        keyBlock = '<div class="muted-hint">未找到日志文件 (可能任务太早被清理, 或尚未开始写日志)。</div>';
    }

    const tailBlock = d.tail
        ? `<details style="margin-top:8px;">
             <summary style="cursor:pointer; font-size:12px; color:var(--accent);">📜 完整日志尾部 (共 ${d.lines_total} 行)</summary>
             <pre style="${mono} white-space:pre-wrap; background:#0b0f1a; border:1px solid #1f2937;
                  border-radius:4px; padding:8px 10px; margin-top:6px; max-height:320px; overflow:auto;">${escapeHtml(d.tail)}</pre>
           </details>`
        : '';

    const pathLine = d.log_path
        ? `<div style="font-size:10.5px; color:var(--muted); margin-top:6px;">log: <code>${escapeHtml(d.log_path)}</code>
             <button class="ghost btn-job-log-close" style="float:right; padding:1px 8px;">收起 ✕</button></div>`
        : '<div style="margin-top:6px;"><button class="ghost btn-job-log-close" style="float:right; padding:1px 8px;">收起 ✕</button></div>';

    return errBanner + keyBlock + tailBlock + pathLine;
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

// v2.10.12: 分页状态
const _jobsPg = { page: 1, pageSize: 20 };
const _modelsPg = { page: 1, pageSize: 20 };

async function refreshJobs() {
    try {
        const offset = (_jobsPg.page - 1) * _jobsPg.pageSize;
        const data = await apiGet(`/api/spawn-tuning-v2/jobs?limit=${_jobsPg.pageSize}&offset=${offset}`);
        _renderJobsRows(data.jobs || []);
        _renderPagination('jobs-table', _jobsPg, data.total || 0, refreshJobs);
        // 自动轮询: 只看当前页是否有 queued/running (其他页不打扰)
        const active = (data.jobs || []).filter((j) => j.status === 'queued' || j.status === 'running').length;
        if (active > 0) startJobsAutoRefresh();
    } catch (e) {
        $('jobs-table').querySelector('tbody').innerHTML = `<tr><td colspan="9" class="muted-hint">${escapeHtml(e.message)}</td></tr>`;
    }
}

/**
 * v2.10.12: 通用分页器渲染 (插入到 table 容器外面, 复用)
 * @param {string} tableId table 元素 id
 * @param {{page:number, pageSize:number}} state 分页状态
 * @param {number} total 后端返回总数
 * @param {() => Promise<void>} refresh 翻页后触发的刷新函数
 */
function _renderPagination(tableId, state, total, refresh) {
    const table = $(tableId);
    if (!table) return;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    // 复用或创建 footer
    const parent = table.parentElement;
    let footer = parent.querySelector(`.${tableId}-pagination`);
    if (!footer) {
        footer = document.createElement('div');
        footer.className = `${tableId}-pagination`;
        footer.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 4px; font-size:11px; color:var(--muted); justify-content:flex-end;';
        parent.appendChild(footer);
    }
    // 保护: 当前页超过总页数时回到最后一页
    if (state.page > totalPages) {
        state.page = totalPages;
    }
    const fromN = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const toN = Math.min(state.page * state.pageSize, total);
    footer.innerHTML = `
      <span>共 <b style="color:var(--accent)">${total}</b> 条 · 显示 ${fromN}-${toN}</span>
      <span style="flex:1;"></span>
      <label style="display:flex; align-items:center; gap:4px;">每页
        <select class="pg-size" style="height:22px; font-size:11px;">
          ${[10, 20, 50, 100].map((n) => `<option value="${n}"${n === state.pageSize ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <button class="ghost pg-first" ${state.page <= 1 ? 'disabled' : ''} title="第一页">«</button>
      <button class="ghost pg-prev"  ${state.page <= 1 ? 'disabled' : ''} title="上一页">‹</button>
      <span style="min-width:60px; text-align:center;">页 <b>${state.page}</b> / ${totalPages}</span>
      <button class="ghost pg-next" ${state.page >= totalPages ? 'disabled' : ''} title="下一页">›</button>
      <button class="ghost pg-last" ${state.page >= totalPages ? 'disabled' : ''} title="末页">»</button>
    `;
    footer.querySelector('.pg-first').addEventListener('click', () => { state.page = 1; refresh(); });
    footer.querySelector('.pg-prev').addEventListener('click', () => { state.page = Math.max(1, state.page - 1); refresh(); });
    footer.querySelector('.pg-next').addEventListener('click', () => { state.page = Math.min(totalPages, state.page + 1); refresh(); });
    footer.querySelector('.pg-last').addEventListener('click', () => { state.page = totalPages; refresh(); });
    footer.querySelector('.pg-size').addEventListener('change', (e) => {
        state.pageSize = Number(e.target.value) || 20;
        state.page = 1;   // 改 size 后回首页
        refresh();
    });
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
            // v3.0.4: 跟 train.py composite 一致 (ideal_mae + 0.3*endpoint + 0.2*anchor)
            // 否则 dashboard 显示 best=ep4 但实际保存的 ckpt 是 composite best ep=N, 用户困惑
            ? epochs.reduce((b, e) => {
                const ec = _composite(e);
                const bc = b ? _composite(b) : Infinity;
                return ec < bc ? e : b;
            }, null)
            : null;
        const totalSec = epochs.reduce((s, e) => s + (e.elapsed_s || 0), 0);
        // 表格 — 6 个核心 metric 的最新 / 首 / 改进
        // v2.10.5: 摘要表也加状态 badge — 让用户理解每个低值的含义
        const getStatus = (k, lastV, firstV) => {
            if (!Number.isFinite(lastV) || !Number.isFinite(firstV)) return '';
            if (k === 'val_pb_distribution') return '<span title="display only — weight=0, 不进训练 loss" style="color:#9ca3af">🚫 仅展示</span>';
            if (k === 'val_curve_var') {
                return lastV > 0.1
                    ? '<span title="预测曲线有形态, 健康" style="color:#34d399">✓ 健康</span>'
                    : '<span title="预测曲线接近水平, 可能退化" style="color:#f87171">⚠ 退化</span>';
            }
            const delta = lastV - firstV;
            if (firstV < 0.005 && Math.abs(delta) < 0.001) {
                return '<span title="数据本身就满足该约束 — loss 充当 safety net" style="color:#9ca3af">🔒 数据满足</span>';
            }
            if (lastV < firstV * 0.5 && firstV > 0.005) {
                return '<span title="模型已学到该约束 (loss 显著下降)" style="color:#34d399">✓ 学到</span>';
            }
            if (lastV > firstV * 1.5 && firstV > 0.001) {
                if (_METRICS_EXPECTED_RISE_WITH_IDEAL.includes(k) && _idealMaeImproved(epochs)) {
                    return `<span title="${_EXPECTED_RISE_TITLE}" style="color:#60a5fa">↗ 预期</span>`;
                }
                return '<span title="loss 反而上升, 可能退化" style="color:#f87171">⚠ 退化</span>';
            }
            return '<span title="loss 平台期" style="color:var(--muted)">— 平台</span>';
        };
        const tablePart = epochs.length > 0 ? `
            <table style="width:100%; font-size:11px; margin-top:6px; border-collapse:collapse;">
              <thead><tr style="color:var(--muted);">
                <th style="text-align:left; padding:3px 6px;">指标</th>
                <th style="text-align:right; padding:3px 6px;">最新 (ep=${last.epoch ?? '-'})</th>
                ${epochs.length > 1 ? `<th style="text-align:right; padding:3px 6px;">首 epoch</th>
                <th style="text-align:right; padding:3px 6px;">改进 △</th>
                <th style="text-align:left; padding:3px 6px;">状态</th>` : ''}
              </tr></thead>
              <tbody style="font-family: ui-monospace, monospace;">
                ${['train_loss', 'val_loss', 'val_ideal_mae', 'val_curve_mae', 'val_curve_var', 'val_anchor', 'val_monotonic', 'val_target_fit', 'val_endpoint', 'val_pb_distribution', 'val_balance', 'val_surprise', 'val_breaking', 'val_deploy']
                    .map((k) => {
                        const lastV = last[k];
                        const firstV = epochs[0][k];
                        const delta = (Number.isFinite(lastV) && Number.isFinite(firstV)) ? (lastV - firstV) : null;
                        const expectedRise = delta != null && delta > 0
                            && _METRICS_EXPECTED_RISE_WITH_IDEAL.includes(k)
                            && _idealMaeImproved(epochs);
                        const deltaStr = delta == null ? '-' :
                            (delta < 0 ? `<span style="color:var(--good)">${delta.toFixed(4)} ↓</span>`
                                : expectedRise ? `<span style="color:#60a5fa" title="${_EXPECTED_RISE_TITLE}">+${delta.toFixed(4)} ↑</span>`
                                : `<span style="color:var(--warn)">+${delta.toFixed(4)} ↑</span>`);
                        const status = getStatus(k, lastV, firstV);
                        return `<tr>
                            <td style="padding:2px 6px;">${k}</td>
                            <td style="padding:2px 6px; text-align:right;">${fmtNumber(lastV, 4)}</td>
                            ${epochs.length > 1 ? `
                            <td style="padding:2px 6px; text-align:right; color:var(--muted);">${fmtNumber(firstV, 4)}</td>
                            <td style="padding:2px 6px; text-align:right;">${deltaStr}</td>
                            <td style="padding:2px 6px; font-size:10.5px;">${status}</td>` : ''}
                        </tr>`;
                    }).join('')}
              </tbody>
            </table>
        ` : '';

        // G18 v2.10.19: 训练 ETA 估算 (仅 running 时显示)
        // 用最近 3 epoch 平均耗时 (避免 ep=0 warmup 异常) × 剩余 epoch
        let etaLine = null;
        if (data.status === 'running' && epochs.length >= 2 && epochs.length < (data.total_epochs || 50)) {
            const recent = epochs.slice(-3);
            const recentAvg = recent.reduce((s, e) => s + (e.elapsed_s || 0), 0) / recent.length;
            const totalEpochs = data.total_epochs || 50;
            const remainingEpochs = Math.max(0, totalEpochs - epochs.length);
            const etaSec = recentAvg * remainingEpochs;
            if (etaSec > 0) {
                const etaStr = etaSec < 60 ? `${etaSec.toFixed(0)}s`
                    : etaSec < 3600 ? `${(etaSec / 60).toFixed(1)}min`
                    : `${(etaSec / 3600).toFixed(1)}h`;
                etaLine = `ETA ≈ <b style="color:var(--accent)">${etaStr}</b> <span style="color:var(--muted)">(剩 ${remainingEpochs} epoch × ${recentAvg.toFixed(1)}s)</span>`;
            }
        }
        const lines = [
            epochs.length > 0 ? `共 <b>${epochs.length}</b> epoch` : null,
            (data.batches && data.batches.length > 0) ? `<b>${data.batches.length}</b> 个 batch 采样点` : null,
            best ? `最佳: ep=${best.epoch} val_curve_mae=<b style="color:var(--good)">${fmtNumber(best.val_curve_mae)}</b>` : null,
            totalSec > 0 ? `总耗时 ≈ ${fmtNumber(totalSec, 1)}s` : null,
            etaLine,
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
/**
 * v3.0.4: composite 跟 train.py 一致 — ideal_mae 主导 + endpoint + anchor 辅助
 *   composite = ideal_mae + 0.3*endpoint + 0.2*anchor
 * 用于前端 best 选择, 保证跟 backend 保存的 ckpt 一致。
 */
function _composite(e) {
    const im = (e?.val_ideal_mae) ?? Infinity;
    const ep = (e?.val_endpoint) ?? 0;
    const a  = (e?.val_anchor) ?? 0;
    return im + 0.3 * ep + 0.2 * a;
}

/** v3.0.4: ideal_mae 相对首 epoch 是否显著改善 (末值 < 首值 50% 且首值 > 0.01). */
function _idealMaeImproved(epochs) {
    if (!epochs?.length) return false;
    const first = epochs[0]?.val_ideal_mae;
    const last = epochs[epochs.length - 1]?.val_ideal_mae;
    if (!Number.isFinite(first) || !Number.isFinite(last)) return false;
    return first > 0.01 && last < first * 0.5;
}

/** 朝 ideal 训练时上升属预期副作用 (勿标退化). */
const _METRICS_EXPECTED_RISE_WITH_IDEAL = ['val_curve_mae', 'val_surprise'];

const _EXPECTED_RISE_TITLE = 'v3.0: 模型朝 ★ ideal 拉远 sample/次要约束；ideal_mae 已显著下降 → 预期副作用，非退化';

const _METRIC_SUB_CHARTS = [
    // v2.10.21: train_loss 是 batch 级 (每 4 batch 1 点, 一个 epoch 数十点), 其他都是 epoch 级
    { key: 'train_loss',          color: '#f87171', label: 'train_loss · batch',  better: 'lower' },
    { key: 'val_loss',            color: '#60a5fa', label: 'val_loss',            better: 'lower' },
    // v3.0.2 — ★ 业务核心: 预测 vs ideal target_S_curve MAE (model 跟 S 曲线的距离)
    { key: 'val_ideal_mae',       color: '#facc15', label: 'val_ideal_mae ★',     better: 'lower' },
    { key: 'val_curve_mae',       color: '#34d399', label: 'val_curve_mae · sample', better: 'lower',
      title: '预测 vs 样本 d_curve；朝 ideal 训练时上升常见，看 val_ideal_mae ★' },
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
    // v3.0.11 (G6 联合寻参): trainable theta_optim 表 vs ideal 的 MSE — 直接反映"部署后 model 跟 ideal 距离"
    //   收敛后越小越好; 等价于 val_ideal_mae 但用 best θ* 而非 sample θ
    { key: 'val_deploy',          color: '#f0abfc', label: 'val_deploy ⚡',       better: 'lower',
      title: 'v3.0.11 联合寻参: model 用 trainable theta_optim 表对 360 ctx forward 算 vs ideal 的 MSE. 收敛后 = 部署后 model 跟 ideal 的距离, 越小越好.' },
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
                <span class="metric-card-title" style="color:${m.color};"${m.title ? ` title="${m.title}"` : ''}>${m.label}</span>
                <span class="metric-card-value">—</span>
              </div>
              <canvas></canvas>
            </div>
        `).join('');
    }

    // 找全局最佳 epoch (按 val_curve_mae) — 主推荐
    const bestIdx = epochs.length > 0
        // v3.0.4: 跟 train.py composite 一致, 显示真正的 best (ideal_mae 主导)
        ? epochs.reduce((bi, e, i) => (_composite(e) < _composite(epochs[bi]) ? i : bi), 0)
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
                const expectedRise = m.better === 'lower' && delta > 0
                    && _METRICS_EXPECTED_RISE_WITH_IDEAL.includes(m.key)
                    && _idealMaeImproved(epochs);
                const cls = (m.better === 'lower' && delta < 0) || (m.better === 'higher' && delta > 0)
                    ? 'var(--good)'
                    : expectedRise ? '#60a5fa' : 'var(--warn)';
                const arrow = delta < 0 ? '↓' : '↑';
                const deltaTitle = expectedRise ? ` title="${_EXPECTED_RISE_TITLE}"` : '';
                deltaStr = ` <span style="color:${cls}; font-size:9px;"${deltaTitle}>${delta >= 0 ? '+' : ''}${delta.toFixed(4)} ${arrow}</span>`;
            }
            // v2.10.5: loss 健康状态 badge — 让用户一眼看出"为什么这么低"
            //   ✓ 学到了:  首值 ≥ 0.005 且现在 < 首 50% (显著下降)
            //   🔒 数据满足: 首值 < 0.005 (从一开始就很低 → 数据天然满足约束)
            //   🔥 训练中:  最近 3 个 epoch 仍在变化 ≥ 5%
            //   ↗ 预期:    val_curve_mae/surprise 升但 ideal_mae 已显著降 (v3.0.4)
            //   ⚠ 退化:    现在 > 首值 × 1.5 (loss 反而升)
            let badge = '';
            if (m.better === 'lower' && epochs.length >= 3 && Number.isFinite(firstV) && Number.isFinite(lastV)) {
                const recent = epochs.slice(-3).map((e) => e[m.key]).filter(Number.isFinite);
                const recentRange = recent.length > 1 ? Math.max(...recent) - Math.min(...recent) : 0;
                if (firstV < 0.005 && Math.abs(delta) < 0.001) {
                    badge = ` <span style="color:#9ca3af; font-size:9px;" title="该约束数据本身就满足 (例如修复后 d_curve 已单调 → val_monotonic 全程 0); loss 充当 safety net, 退化时才会激活">🔒</span>`;
                } else if (lastV < firstV * 0.5 && firstV > 0.005) {
                    badge = ` <span style="color:#34d399; font-size:9px;" title="模型已学到该约束 (loss 显著下降)">✓</span>`;
                } else if (recentRange / Math.max(1e-6, Math.abs(lastV)) > 0.05) {
                    badge = ` <span style="color:#fbbf24; font-size:9px;" title="loss 仍在变化, 训练中">🔥</span>`;
                } else if (lastV > firstV * 1.5 && firstV > 0.001) {
                    if (_METRICS_EXPECTED_RISE_WITH_IDEAL.includes(m.key) && _idealMaeImproved(epochs)) {
                        badge = ` <span style="color:#60a5fa; font-size:9px;" title="${_EXPECTED_RISE_TITLE}">↗</span>`;
                    } else {
                        badge = ` <span style="color:#f87171; font-size:9px;" title="loss 反而上升, 可能退化">⚠</span>`;
                    }
                }
            } else if (m.key === 'val_curve_var' && Number.isFinite(lastV)) {
                badge = lastV > 0.1
                    ? ` <span style="color:#34d399; font-size:9px;" title="预测曲线有形态, 健康">✓</span>`
                    : ` <span style="color:#f87171; font-size:9px;" title="预测曲线接近水平, 可能退化">⚠</span>`;
            } else if (m.key === 'val_pb_distribution') {
                badge = ` <span style="color:#9ca3af; font-size:9px;" title="display only — weight=0 不进训练 (公式天然饱和)">🚫</span>`;
            }
            valEl.innerHTML = valStr + deltaStr + badge;
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
        const offset = (_modelsPg.page - 1) * _modelsPg.pageSize;
        const data = await apiGet(`/api/spawn-tuning-v2/models?limit=${_modelsPg.pageSize}&offset=${offset}`);
        _renderPagination('models-table', _modelsPg, data.total || 0, refreshModels);
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
                <button class="ghost btn-biz-scorecard" data-id="${m.model_id}" data-name="${escapeHtml(m.name)}" title="G15: 业务命题达成度评分 (公平/爽点/平衡/惊喜)">🎯 评分</button>
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
        // G15 v2.10.19: 业务评分弹窗
        tbody.querySelectorAll('.btn-biz-scorecard').forEach((b) => {
            b.addEventListener('click', () => showBizScorecardModal(b.dataset.id, b.dataset.name));
        });
        tbody.querySelectorAll('.btn-rb').forEach((b) => {
            b.addEventListener('click', async () => {
                if (!(await showConfirmDialog(`模型 #${b.dataset.id} 将回滚为上一版 deployed 版本。`, { title: `↩ 回滚模型 #${b.dataset.id}`, confirmLabel: '确认回滚' }))) return;
                try {
                    await apiSend('POST', `/api/spawn-tuning-v2/models/${b.dataset.id}/rollback`);
                    // v2.10.11: 列表内 rollback 也走同步逻辑（清 bundle + 广播），避免和概览页 rollbackCurrent 行为分裂。
                    const sync = await _syncBundleAfterRollback();
                    if (sync?.kind === 'cleared') {
                        showNotification?.(`模型 #${b.dataset.id} 已回滚 · bundle 已清 · 游戏页已通知卸载`, 'success');
                    } else if (sync?.kind === 'has-prev-deployed') {
                        showNotification?.(`已回滚 · ⚠ bundle 仍指向旧版，请到 ④ 部署 D.1 用 #${sync.modelId} 重新导出`, 'warning');
                    }
                } catch (e) {
                    showNotification?.(`回滚失败: ${e.message}`, 'error');
                }
                refreshModels(); refreshOverview(); refreshBundleStatus();
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

// G4 v2.10.8: 增量训练 wizard
function bindIncrementalWizard() {
    const baseSel = $('job-base');
    if (!baseSel || baseSel.dataset.g4Bound) return;
    baseSel.dataset.g4Bound = '1';
    baseSel.addEventListener('change', () => {
        const hint = $('job-hint');
        if (!hint) return;
        if (baseSel.value) {
            const opt = baseSel.options[baseSel.selectedIndex];
            const lrEl = $('job-lr');
            const currentLr = Number(lrEl?.value) || 1e-3;
            const effectiveLr = (currentLr * 0.1).toExponential(2);
            const epochsEl = $('job-epochs');
            // 增量训练通常 epoch 较少
            if (epochsEl && !epochsEl.dataset.userDirty) {
                epochsEl.value = '20';
            }
            hint.innerHTML = `<span style="color:var(--accent); font-size:11px;">
                🔗 增量训练已启用 — 基础模型 ${escapeHtml(opt.text)}<br>
                • 后端会自动 LR × 0.1 → 实际 lr = ${effectiveLr} (避免灾难性遗忘)<br>
                • 建议 epochs 20-30 即可 (已自动调到 20, 你可继续修改)<br>
                • 训练完毕新模型 parent_model_id = ${baseSel.value} (版本树可追溯)
            </span>`;
        } else {
            hint.innerHTML = '<span style="color:var(--muted); font-size:11px;">从头训练模式</span>';
        }
    });
}

async function refreshBaseModelOptions() {
    const sel = $('job-base');
    if (!sel) return;
    const prev = sel.value;
    // v2.10.10: 增量训练只能加载相同架构的 ckpt (异架构 state_dict 完全不兼容)
    const currentMt = $('job-model-type')?.value || 'resnet';
    try {
        const data = await apiGet('/api/spawn-tuning-v2/models?limit=100');
        const usableStatus = (m) =>
            m.status === 'deployed' || m.status === 'staging' || m.status === 'archived';
        const sameArch = (m) => (m.model_type || 'resnet') === currentMt;
        const filtered = (data.models || []).filter((m) => usableStatus(m) && sameArch(m));
        sel.innerHTML = '<option value="">— 从头训练 —</option>' +
            filtered.map((m) => {
                const mae = m.metrics?.val_curve_mae;
                return `<option value="${m.model_id}">#${m.model_id} ${escapeHtml(m.name)} (${escapeHtml(m.model_type || 'resnet')}) · ${escapeHtml(m.status)}${mae ? ` · mae=${fmtNumber(mae)}` : ''}</option>`;
            }).join('');
        // 老 prev 若架构不同会自动失效, 回到 "从头训练"
        if (prev && filtered.some((m) => String(m.model_id) === prev)) sel.value = prev;
        // 显示同架构可选数量
        const total = (data.models || []).filter(usableStatus).length;
        if (filtered.length < total) {
            sel.title = `仅显示 ${currentMt} 架构 (${filtered.length}/${total}); 切换网络架构可看其他模型`;
        }
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
    // v3.0.10: 部署 = 让模型寻参的 θ 生效 (唯一含义).
    //   60-90s 耗时是天然成本: 客户端 (移动端/小程序) 不能跑 PyTorch, 服务端必须
    //   预先把"每个场景该用什么 θ"算出来, 写成 KB 级 JSON 让客户端查表.
    const optimizeTheta = true;
    // 显示已耗时计数, 避免用户感觉"无反馈"
    const _deployT0 = performance.now();
    // v3.0.11: ckpt 含 theta_optim 时部署 < 1s; 老 ckpt fallback surrogate 90-180s
    const _deployTimer = setInterval(() => {
        const sec = Math.floor((performance.now() - _deployT0) / 1000);
        const color = sec > 120 ? 'var(--warn)' : (sec > 60 ? 'var(--accent)' : 'var(--muted)');
        const note = sec > 60 ? ' · 老 ckpt 走 surrogate fallback' : '';
        $('bundle-hint').innerHTML = `<span style="color:${color}">⏳ 部署中… ${sec}s${note}</span>`;
    }, 1000);
    const _stopTimer = () => { clearInterval(_deployTimer); };
    $('bundle-hint').innerHTML = '<span style="color:var(--muted)">⏳ 部署中…</span>';
    try {
        let r;
        if (customSrc) {
            r = await apiSend('POST', '/api/spawn-tuning-v2/policies/bundle/export', {
                source: customSrc, rollout_pct: rolloutPct, include_miniprogram: true,
            });
        } else {
            if (!modelId) {
                _stopTimer();
                $('bundle-hint').innerHTML = '<span style="color:var(--bad)">需要选模型 (或填 policies.json 路径)</span>';
                return;
            }
            r = await apiSend('POST', '/api/spawn-tuning-v2/policies/build-and-export', {
                model_id: Number(modelId), rollout_pct: rolloutPct, include_miniprogram: true,
                optimize_theta: optimizeTheta,
            });
        }
        _stopTimer();
        if (r.ok) {
            const sec = Math.floor((performance.now() - _deployT0) / 1000);
            const maeStr = r.average_curve_mae != null ? ` · avg MAE ${r.average_curve_mae.toFixed(4)}` : '';
            // v2.10.7: 单调修正信息
            let monoStr = '';
            if (r.monotonic_projection_applied) {
                monoStr = r.monotonic_violations_fixed > 0
                    ? ` · 修正 ${r.monotonic_violations_fixed} 单调违规 (最大 Δ=${r.max_raw_violation.toFixed(3)})`
                    : ' · 单调✓';
            }
            $('bundle-hint').innerHTML = `<span style="color:var(--good)">✓ 已部署 (${sec}s)${maeStr} · ${r.policies_count} 个场景的 θ${monoStr}</span>`;
            refreshBundleStatus();
            /* v2.10.10: 跨 tab 广播 bundle 更新事件 — 让同 origin 的游戏页（index.html）
             * 收到后自动 re-fetch policies.json + install，badge 实时翻为「寻参」，
             * 调参员无需手工刷新游戏页。
             * 兼容 fallback：旧浏览器无 BroadcastChannel 时静默忽略（游戏页下次刷新仍能拉到新 bundle）。 */
            _broadcastSpawnParamTuner({
                type: 'bundle-updated',
                model_id: r.model_id,
                sha256: r.sha256,
                generated_at: r.generated_at,
                rollout_pct: r.rollout_pct,
                deployed: r.deploy?.deployed === true,
            });
        } else {
            $('bundle-hint').innerHTML = `<span style="color:var(--bad)">${escapeHtml(r.error)}</span>`;
        }
    } catch (e) {
        _stopTimer();
        $('bundle-hint').innerHTML = `<span style="color:var(--bad)">部署失败: ${escapeHtml(e.message)}</span>`;
    }
}

async function refreshBundleStatus() {
    const host = $('bundle-status-cards');
    try {
        const r = await apiGet('/api/spawn-tuning-v2/policies/bundle/status');
        const cons = r.consistency || {};

        if (!r.exists) {
            // v2.10.10/17: 区分「真未部署」 vs 「DB 已部署但 bundle 缺失」
            if (cons.state === 'deployed-but-no-bundle') {
                const dm = r.deployed_model || {};
                host.innerHTML = `
                    <div class="stat-card good" title="${escapeHtml(dm.train_job_name || '')}">
                        <div class="stat-value" style="font-size:18px;">#${dm.model_id}</div>
                        <div class="stat-label">${escapeHtml(dm.train_job_name || dm.name || '')}</div>
                    </div>
                    <div class="stat-card purple">
                        <div class="stat-value" style="font-size:14px; font-family:ui-monospace;">${escapeHtml(dm.model_type || '-')}</div>
                        <div class="stat-label">${escapeHtml(dm.version || 'v0.0.1')}</div>
                    </div>
                    <div class="stat-card bad">
                        <div class="stat-value">⚠ 不一致</div>
                        <div class="stat-label">bundle 缺失</div>
                    </div>
                    <div class="stat-card warn" style="grid-column: span 2" title="${escapeHtml(cons.hint)}">
                        <div class="stat-value" style="font-size:12px; line-height:1.4">点击上方 D.1 重新导出</div>
                    </div>
                `;
            } else {
                host.innerHTML = '<div class="stat-card warn"><div class="stat-value">未导出</div><div class="stat-label">点击上方按钮生成</div></div>';
            }
            return;
        }

        const m = r.meta || {};
        // v2.10.17: 把 deployed model 信息单独成卡 (参考图2 模型库样式)
        const dm = r.deployed_model;
        const modelCard = dm
            ? `<div class="stat-card good" title="${escapeHtml(dm.train_job_name || '')}">
                 <div class="stat-value" style="font-size:18px;">#${dm.model_id}</div>
                 <div class="stat-label">${escapeHtml(dm.train_job_name || dm.name || '')}</div>
               </div>
               <div class="stat-card purple">
                 <div class="stat-value" style="font-size:14px; font-family:ui-monospace;">${escapeHtml(dm.model_type || '-')}</div>
                 <div class="stat-label">${escapeHtml(dm.version || 'v0.0.1')}</div>
               </div>`
            : '';
        // v2.10.10: bundle 存在时也检查与 DB 的一致性
        const consBadge = cons.state === 'in-sync'
            ? `<div class="stat-card good"><div class="stat-value">✓ 同步</div><div class="stat-label">bundle ↔ DB</div></div>`
            : cons.state === 'bundle-but-not-deployed'
                ? `<div class="stat-card warn" title="${escapeHtml(cons.hint)}"><div class="stat-value">⚠ 待部署</div><div class="stat-label">bundle 存在但 DB 无 deployed</div></div>`
                : cons.state === 'mismatch'
                    ? `<div class="stat-card bad" title="${escapeHtml(cons.hint)}"><div class="stat-value">⚠ 错位</div><div class="stat-label">bundle #${cons.bundle_model_id} ≠ DB #${cons.deployed_model_id}</div></div>`
                    : '';

        host.innerHTML = `
            ${modelCard}
            <div class="stat-card good"><div class="stat-value">${m.n_contexts || 0}</div><div class="stat-label">contexts</div></div>
            <div class="stat-card"><div class="stat-value">${(r.bundle_size_bytes/1024).toFixed(1)} KB</div><div class="stat-label">大小</div></div>
            <div class="stat-card ${m.rollout_pct === 100 ? 'good' : 'warn'}"><div class="stat-value">${m.rollout_pct || 0}%</div><div class="stat-label">灰度比例</div></div>
            <div class="stat-card purple"><div class="stat-value">${fmtDate(r.modified_at)}</div><div class="stat-label">导出时间</div></div>
            ${consBadge}
        `;
    } catch (e) {
        host.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }
}

async function loadFieldMetrics() {
    const hours = Number($('field-hours').value) || 24;
    const ctx = $('field-ctx').value.trim();
    const groupBy = $('field-groupby')?.value || '';
    const host = $('field-stats');
    const groupsHost = $('field-groups');
    if (groupsHost) groupsHost.innerHTML = '';
    try {
        const params = new URLSearchParams({ hours: String(hours) });
        if (ctx) params.set('context_key', ctx);
        if (groupBy) params.set('group_by', groupBy);
        const r = await apiGet(`/api/spawn-tuning-v2/field-metrics/aggregate?${params}`);
        // G19 v2.10.19: 渲染分组表
        if (groupBy && r.groups && groupsHost) {
            const entries = Object.entries(r.groups).sort();
            if (entries.length === 0) {
                groupsHost.innerHTML = `<p class="muted-hint">按 ${escapeHtml(groupBy)} 无数据</p>`;
            } else {
                const rows = entries.map(([key, g]) => {
                    const cellCls = (val, lo, hi) => (val < lo || val > hi) ? 'style="color:var(--bad);"' : '';
                    return `
                      <tr>
                        <td style="padding:3px 8px;"><code>${escapeHtml(key)}</code></td>
                        <td style="padding:3px 8px; text-align:right;">${g.n_episodes}</td>
                        <td style="padding:3px 8px; text-align:right;" ${cellCls(g.pb_broke_rate, 0.05, 0.35)}>${(g.pb_broke_rate*100).toFixed(1)}%</td>
                        <td style="padding:3px 8px; text-align:right;" ${cellCls(g.noMove_rate, 0, 0.30)}>${(g.noMove_rate*100).toFixed(1)}%</td>
                        <td style="padding:3px 8px; text-align:right;">${Math.round(g.mean_score)}</td>
                        <td style="padding:3px 8px; text-align:right;">${g.mean_curve_mae > 0 ? g.mean_curve_mae.toFixed(3) : '-'}</td>
                      </tr>
                    `;
                }).join('');
                groupsHost.innerHTML = `
                  <div style="font-size:11px; color:var(--muted); margin: 6px 0 2px;">📊 按 <b>${escapeHtml(groupBy)}</b> 拆解 (${entries.length} 组)</div>
                  <table style="width:100%; font-size:11px; border-collapse:collapse;">
                    <thead><tr style="color:var(--muted);">
                      <th style="text-align:left; padding:3px 8px;">${escapeHtml(groupBy)}</th>
                      <th style="text-align:right; padding:3px 8px;">episodes</th>
                      <th style="text-align:right; padding:3px 8px;">破 PB 率</th>
                      <th style="text-align:right; padding:3px 8px;">死局率</th>
                      <th style="text-align:right; padding:3px 8px;">均分</th>
                      <th style="text-align:right; padding:3px 8px;">curve_mae</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                  </table>
                `;
            }
        }
        if (r.n_episodes === 0) {
            host.innerHTML = '<div class="stat-card muted"><div class="stat-value">0</div><div class="stat-label">无玩家数据 (等 v2 模型上线后回流)</div></div>';
            return;
        }
        // v2.10.18 (G14): 健康度告警 — 业务关键指标超阈值自动飘红
        //   破 PB 率: 健康区间 10-25% (太低 → 玩家不知有挑战; 太高 → 模型过弱)
        //   死局率: > 30% 表示出块算法过激, 玩家挫败
        //   curve_mae: > 0.15 表示部署模型跟实际差距大 (模型不准)
        const pbRate = r.pb_broke_rate || 0;
        const noMoveRate = r.noMove_rate || 0;
        const curveMae = r.mean_curve_mae || 0;
        const alerts = [];
        let pbCls = '', noMoveCls = '', maeCls = '';
        if (pbRate < 0.05) { pbCls = 'bad'; alerts.push(`破 PB 率仅 ${(pbRate*100).toFixed(1)}% (健康 10-25%) — 模型可能过弱`); }
        else if (pbRate > 0.35) { pbCls = 'warn'; alerts.push(`破 PB 率高达 ${(pbRate*100).toFixed(1)}% — 模型可能过弱, 玩家觉无挑战`); }
        else { pbCls = 'good'; }
        if (noMoveRate > 0.30) { noMoveCls = 'bad'; alerts.push(`死局率 ${(noMoveRate*100).toFixed(1)}% (> 30%) — 出块算法过激, 玩家挫败`); }
        else if (noMoveRate > 0.15) { noMoveCls = 'warn'; }
        if (curveMae > 0.20) { maeCls = 'bad'; alerts.push(`线上 d_curve MAE ${curveMae.toFixed(3)} (> 0.20) — 部署模型跟实际差距大, 建议增量训练`); }
        else if (curveMae > 0.12) { maeCls = 'warn'; }
        else if (curveMae > 0) { maeCls = 'good'; }
        // 主卡片
        host.innerHTML = `
            <div class="stat-card good"><div class="stat-value">${r.n_episodes}</div><div class="stat-label">episodes (${hours}h)</div></div>
            <div class="stat-card ${pbCls}"><div class="stat-value">${(pbRate * 100).toFixed(1)}%</div><div class="stat-label">破 PB 率 <span style="opacity:0.6">健康 10-25%</span></div></div>
            <div class="stat-card ${noMoveCls}"><div class="stat-value">${(noMoveRate * 100).toFixed(1)}%</div><div class="stat-label">死局率 <span style="opacity:0.6">≤ 15%</span></div></div>
            <div class="stat-card ${maeCls}"><div class="stat-value">${curveMae > 0 ? curveMae.toFixed(3) : '-'}</div><div class="stat-label">线上 curve_mae <span style="opacity:0.6">&lt; 0.12</span></div></div>
            <div class="stat-card purple"><div class="stat-value">${Math.round(r.mean_score || 0)}</div><div class="stat-label">均分</div></div>
        `;
        // 告警 banner
        if (alerts.length > 0) {
            const banner = `<div style="grid-column: span 5; padding: 8px 10px; background: rgba(248,113,113,0.10); border-left: 3px solid var(--bad); font-size: 11.5px; line-height: 1.6; margin-top: 6px;">
                <b style="color: var(--bad);">⚠ ${alerts.length} 项指标异常</b>
                <ul style="margin: 4px 0 0 18px; padding: 0;">${alerts.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
            </div>`;
            host.insertAdjacentHTML('beforeend', banner);
        }
    } catch (e) {
        host.innerHTML = `<div class="stat-card bad"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(e.message)}</div></div>`;
    }
}


// ─────────── ⑤ d_curve 分析 ───────────

async function refreshCurveSetSelector() {
    const setSel = $('curve-set');
    const modelSel = $('curve-predict-model');
    // v3.0.9 (G3): baseline 对照 sample set 选择器
    const baselineSel = $('curve-baseline-set');
    if (!setSel) return;
    const prevSet = setSel.value;
    const prevBaseline = baselineSel?.value;
    const prevModel = modelSel?.value;
    try {
        const [sets, models] = await Promise.all([
            apiGet('/api/spawn-tuning-v2/sample-sets?limit=100'),
            modelSel ? apiGet('/api/spawn-tuning-v2/models?limit=100') : Promise.resolve({ models: [] }),
        ]);
        const setOptions = (sets.sample_sets || [])
            .map((s) => `<option value="${s.set_id}">#${s.set_id} ${escapeHtml(s.name)} (${s.sample_count || 0})</option>`).join('');
        setSel.innerHTML = '<option value="">— 不加载实测 —</option>' + setOptions;
        if (prevSet) setSel.value = prevSet;
        if (baselineSel) {
            baselineSel.innerHTML = '<option value="">— 不对照 —</option>' + setOptions;
            if (prevBaseline) baselineSel.value = prevBaseline;
        }
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

// v3.0.14 (D): 散点缓存 — 避免每次重绘都重新拉. key = setId, value = points 数组
let _scatterPointsCache = null;
const _scatterCacheBySetId = new Map();

// v3.0.21: predictedStd 缓存 — checkbox 直接生效 + 避免反复勾选重发慢 MC Dropout 请求.
//   key = `${modelId}|${setId}|${thetaHash}`, value = predStdBuckets 数组
//   第一次勾选: MC Dropout 慢请求 → 拿到 std → 缓存
//   再次勾选: cache hit, 跳过 API 直接复用
//   反勾选: 不需要 std, 但 cache 保留, 再勾还快
const _predStdCacheByKey = new Map();

async function _loadScatter(setId, modelId) {
    if (!setId) return null;
    // v3.0.16: cache key 含 modelId, 切换模型重新拉
    const cacheKey = `${setId}|${modelId || ''}`;
    if (_scatterCacheBySetId.has(cacheKey)) return _scatterCacheBySetId.get(cacheKey);
    try {
        // v3.0.16: 严格逐 sample 1 点 — 实测 + (可选) 预测
        let url = `/api/spawn-tuning-v2/sample-sets/${setId}/scatter?limit_samples=0`;
        if (modelId) url += `&model_id=${modelId}`;
        const r = await apiGet(url);
        const pts = Array.isArray(r.points) ? r.points : [];
        _scatterCacheBySetId.set(cacheKey, pts);
        return pts;
    } catch (_) {
        return null;
    }
}

// v3.0.9 (G3): 加载一个 sample set 的全 ctx 加权实测均值 (用于 baseline 对照线)
async function _loadObservedAvg(setId) {
    if (!setId) return null;
    try {
        const allDims = 'difficulty,generator,bot_policy,pb_bin,lifecycle_stage';
        const r = await apiGet(`/api/spawn-tuning-v2/sample-sets/${setId}/aggregate?group_by=${allDims}`);
        const buckets = (r.buckets || []).filter((b) => Array.isArray(b.d_curve_avg) && b.d_curve_avg.length === 20);
        const totalN = buckets.reduce((s, b) => s + (b.n_samples || 0), 0);
        if (totalN === 0) return null;
        const avg = new Array(20).fill(0);
        for (const b of buckets) {
            for (let i = 0; i < 20; i++) avg[i] += (b.d_curve_avg[i] || 0) * (b.n_samples || 0);
        }
        return { curve: avg.map((v) => v / totalN), n: totalN, nCtx: buckets.length };
    } catch (_) {
        return null;
    }
}

// ─────────── 事实门禁（以目标 S 曲线为准，判定「预估是否比实测更逼近目标」） ───────────
// v1.62.0: 阈值与后端 rl_pytorch/spawn_tuning_v2/fact_eval.py 的 DEFAULT_THRESHOLDS 对齐。
//   口径：只在「真实观察到的 bin」上，比较预估口径误差 E_pred 与实测口径误差 E_meas
//        （都用到目标 S 的距离）；E_pred < E_meas（提升量 Δ>0）= 提升。
//   注：无数据 bin 外推的担忧由覆盖率门直接兜底；预测-实测偏离 R 仅作诊断，不阻断。
const FACT_EVAL_THRESHOLDS = {
    realBinRatio: 0.3,       // 单 bin 真实占比 ≥ 此值才算"有实测"（与 chart 虚线阈值一致）
    minObservedBins: 4,      // 真实 bin 不足 → indeterminate（无法判定，不误伤冷启动）
    minCoverage: 0.50,       // 实测主导 bin / 20
    minHighCoverage: 0.30,   // 高分段(bin≥10) 实测 bin / 10（S 曲线爬升段必须有实测）
    minImprovement: 0.0,     // 提升量 Δ=E_meas−E_pred 下限（≥0 不更差，>0 严格提升）
};

/**
 * 在「真实观察 bin」上比较预估口径与实测口径到目标的距离，返回三态判定。
 * @returns {{state:'pass'|'fail'|'na', reasons:string[], metrics:object}|null}
 */
function _factEvalVerdict({ observed, predicted, target, observedFillRatio }) {
    if (!observed || !target) return null;
    const N = target.length;
    const ratio = Array.isArray(observedFillRatio) && observedFillRatio.length === N
        ? observedFillRatio : null;
    const obsIdx = [];
    if (ratio) {
        for (let i = 0; i < N; i++) {
            if (ratio[i] >= FACT_EVAL_THRESHOLDS.realBinRatio) obsIdx.push(i);
        }
    }
    const highStart = Math.floor(N / 2);
    const highReal = obsIdx.filter((i) => i >= highStart).length;
    const coverage = obsIdx.length / N;
    const highCoverage = highReal / (N - highStart);
    const maeOn = (a, b, idxs) => (idxs.length
        ? idxs.reduce((s, i) => s + Math.abs(a[i] - b[i]), 0) / idxs.length : NaN);
    // 实测口径误差 / 预估口径误差：同一批观测 bin，可比。
    const measuredMae = maeOn(observed, target, obsIdx);
    const predMaeObs = predicted ? maeOn(predicted, target, obsIdx) : NaN;
    // 预测-实测偏离 R：预估 vs 实测，仅观测 bin；表示模型相对现状的改动幅度。
    const calibResidual = predicted ? maeOn(predicted, observed, obsIdx) : NaN;
    // 提升量 Δ = E_meas − E_pred：>0 预估更逼近目标 = 提升。
    const improvement = (measuredMae === measuredMae && predMaeObs === predMaeObs)
        ? measuredMae - predMaeObs : NaN;
    // 诊断量：预估 vs 目标全 bin（含外推，不可比，不参与判定）。
    const predMaeAll = predicted
        ? predicted.reduce((s, v, i) => s + Math.abs(v - target[i]), 0) / N : NaN;
    const metrics = {
        coverage, highCoverage, measuredMae, predMaeObs, calibResidual,
        improvement, predMaeAll, observedBins: obsIdx.length, hasRatio: !!ratio,
    };

    // 武装下限：无逐 bin 真实占比 / 真实 bin 太少 → 无法判定（不能拿先验冒充实测）
    if (!ratio || obsIdx.length < FACT_EVAL_THRESHOLDS.minObservedBins) {
        return {
            state: 'na',
            reasons: [!ratio
                ? '缺少逐 bin 真实占比，无法区分实测与先验填充'
                : `实测主导 bin 仅 ${obsIdx.length} 个（< ${FACT_EVAL_THRESHOLDS.minObservedBins}），样本不足以判定`],
            metrics,
        };
    }
    // 覆盖率/高分段：仅告警(caveat)，标注提升被验证到的 r 区间，不参与"是否提升"判定。
    const caveats = [];
    if (coverage < FACT_EVAL_THRESHOLDS.minCoverage) {
        caveats.push(`实测覆盖 ${(coverage * 100).toFixed(0)}% < ${FACT_EVAL_THRESHOLDS.minCoverage * 100}%：提升结论仅覆盖已观测的 r 区间`);
    }
    if (highCoverage < FACT_EVAL_THRESHOLDS.minHighCoverage) {
        caveats.push(`高分段覆盖 ${(highCoverage * 100).toFixed(0)}% < ${FACT_EVAL_THRESHOLDS.minHighCoverage * 100}%：接近 PB 的高 r 段尚无实测，未参与验证`);
    }
    // 唯一判定：提升量 Δ = |实测−S| − |预估−S| ≥ 阈值 → 提升。
    const fails = [];
    if (improvement === improvement && improvement < FACT_EVAL_THRESHOLDS.minImprovement) {
        fails.push(`提升量 Δ=${improvement >= 0 ? '+' : ''}${improvement.toFixed(4)} < ${FACT_EVAL_THRESHOLDS.minImprovement} —— 预估未比实测更逼近目标 S，效果未提升/下降`);
    }
    return { state: fails.length ? 'fail' : 'pass', reasons: fails, caveats, metrics };
}

/** 把门禁结论渲染成横幅 HTML，置于对照图指标区顶部。 */
function _renderFactVerdictBanner(v) {
    if (!v) return '';
    const cfg = {
        pass: { bg: 'rgba(52,211,153,0.12)', bd: 'var(--ok, #34d399)', icon: '✅', title: '效果提升：以目标 S 为准，预估口径比实测口径更逼近目标' },
        fail: { bg: 'rgba(248,113,113,0.14)', bd: 'var(--bad, #f87171)', icon: '⛔', title: '未提升：以目标 S 为准，预估未比实测更逼近目标' },
        na: { bg: 'rgba(251,191,36,0.12)', bd: 'var(--warn, #fbbf24)', icon: '⚠️', title: '无法判定：实测支撑不足' },
    }[v.state];
    const m = v.metrics;
    const fp = (x) => (x === x ? `${(x * 100).toFixed(0)}%` : '—');
    const fm = (x) => (x === x ? x.toFixed(4) : '—');
    const fd = (x) => (x === x ? `${x >= 0 ? '+' : ''}${x.toFixed(4)}` : '—');
    const detail = (v.state === 'fail' || v.state === 'pass')
        ? `<div style="font-size:11px; color:var(--muted); margin-top:4px;">`
            + `提升量 Δ = |实测−S| − |预估−S| = ${fm(m.measuredMae)} − ${fm(m.predMaeObs)} = <b>${fd(m.improvement)}</b>（>0=预估更逼近目标） · `
            + `<span style="opacity:.7">覆盖 ${fp(m.coverage)} · 高分段 ${fp(m.highCoverage)}（验证范围，非判定项） · 预测-实测偏离 ${fm(m.calibResidual)}（改动幅度，诊断） · 预估vs目标(全bin) ${fm(m.predMaeAll)}（含外推）</span></div>`
        : '';
    const reasons = v.reasons.length
        ? `<div style="font-size:11.5px; margin-top:3px;">${v.reasons.map((r) => `• ${escapeHtml(r)}`).join('<br>')}</div>`
        : '';
    const caveats = (v.caveats && v.caveats.length)
        ? `<div style="font-size:11px; color:var(--warn, #fbbf24); margin-top:3px;">${v.caveats.map((c) => `⚠ ${escapeHtml(c)}`).join('<br>')}</div>`
        : '';
    return `<div style="margin:0 0 10px; padding:9px 12px; border-radius:10px; background:${cfg.bg}; border:1px solid ${cfg.bd};">`
        + `<div style="font-weight:700; font-size:13px;">${cfg.icon} ${escapeHtml(cfg.title)}</div>`
        + reasons + caveats + detail
        + `</div>`;
}

async function renderCurve() {
    const setId = $('curve-set').value;
    // v3.0.9 (G3): baseline 对照样本集 (可选)
    const baselineSetId = $('curve-baseline-set')?.value || '';
    // v3.0.14 (D): 是否显示散点
    const wantScatter = !!$('curve-scatter')?.checked;
    // v3.0.17 (严格逐 sample 打点): 默认必拉散点, 不再 toggle
    _scatterPointsCache = null;
    if (setId) {
        const _modelId = $('curve-predict-model')?.value || '';
        _scatterPointsCache = await _loadScatter(setId, _modelId);
    }
    // v2.10.22 / v2.10.33: 单选 dropdown (容忍 multi-select 旧版 + text input)
    const groupSel = $('curve-group-by');
    let groupBy = '';
    if (groupSel?.tagName === 'SELECT') {
        if (groupSel.multiple) {
            groupBy = [...groupSel.selectedOptions].map((o) => o.value).join(',');
        } else {
            groupBy = (groupSel.value || '').trim();
        }
    } else if (groupSel) {
        groupBy = groupSel.value.trim();
    }
    const modelId = $('curve-predict-model')?.value || '';
    const meta = $('curve-meta');
    meta.textContent = '加载中…';

    try {
        const targetResp = await apiGet('/api/spawn-tuning-v2/target-curve');
        const target = targetResp.curve;

        // v2.10.30: 简化 — 默认分组线 = 模型预测, 未选模型时 fallback 实测
        let observed = null;
        let nSamples = 0;
        let groupBuckets = null;   // v2.10.24: 多分组数据 (供 multi-line 渲染)
        let groupDims = [];        // 分组维度名 (e.g. ['difficulty', 'bot_policy'])
        let groupSourceUsed = 'predicted';  // 实际使用的数据源 (model 不可用时降级 observed)
        let nCtxUnique = 0;        // v2.10.29: 整 set unique ctx 数量
        let predicted = null;
        let predictNote = '';
        // v2.10.33 (P2.3 UI): per-ctx std buckets (在 if(setId) 内填充, 外部聚合 → predictedStd)
        let predStdBuckets = null;

        // v2.10.29: 重构 — 一次 5 维全分聚合 + 全 ctx 批量预测, 让两条主线在同 ctx 集合上对照
        //
        // observed 主线 = 整 set 实测均值 (跨所有 ctx 加权平均)
        // predicted 主线 = 整 set 模型预测均值 (跨同一 ctx 集合, 每 ctx predict 后按 n_samples 加权)
        // groupBuckets = 前端按 user-selected groupBy 维度再次聚合 unique-ctx buckets (含 obs + pred)
        // v3.0.14: uniqueBuckets 提升到外层作用域, 供 observedFillRatio 计算用
        let uniqueBuckets = [];
        if (setId) {
            const allDims = 'difficulty,generator,bot_policy,pb_bin,lifecycle_stage';
            const uniqueUrl = `/api/spawn-tuning-v2/sample-sets/${setId}/aggregate?group_by=${allDims}`;
            const unique = await apiGet(uniqueUrl);
            uniqueBuckets = (unique.buckets || []).filter((b) => Array.isArray(b.d_curve_avg) && b.d_curve_avg.length === 20);
            const totalN = uniqueBuckets.reduce((s, b) => s + (b.n_samples || 0), 0);
            nCtxUnique = uniqueBuckets.length;

            // 加权平均 helper
            const weightedAvg = (items) => {
                if (!items.length) return null;
                const total = items.reduce((s, it) => s + it.n, 0);
                if (total <= 0) return null;
                const out = new Array(20).fill(0);
                items.forEach((it) => {
                    for (let i = 0; i < 20; i++) out[i] += it.curve[i] * it.n;
                });
                return out.map((v) => v / total);
            };

            // 1) observed 主线 = 整 set 加权均值
            if (totalN > 0) {
                observed = weightedAvg(uniqueBuckets.map((b) => ({ curve: b.d_curve_avg, n: b.n_samples })));
                nSamples = totalN;
            }
            // v2.10.32 (P0.1): 整 set 加权平均的 n_bins_filled (真实观察 bin 数)
            const bfTotal = uniqueBuckets.reduce((s, b) => {
                return (b.bins_filled_mean != null) ? s + b.bins_filled_mean * b.n_samples : s;
            }, 0);
            const bfWeightSum = uniqueBuckets.reduce((s, b) => {
                return (b.bins_filled_mean != null) ? s + b.n_samples : s;
            }, 0);
            window._lastBinsFilledAvg = bfWeightSum > 0 ? (bfTotal / bfWeightSum) : null;
            const rTotal = uniqueBuckets.reduce((s, b) => {
                return (b.r_mean != null) ? s + b.r_mean * b.n_samples : s;
            }, 0);
            window._lastRMean = bfWeightSum > 0 ? (rTotal / bfWeightSum) : null;

            // 2) predicted 主线 = 批量预测所有 unique ctx, 按 n_samples 加权
            // v2.10.33 (P2.3 UI): 可选 MC Dropout 不确定性 (UI checkbox 切换)
            let predBuckets = null;
            // predStdBuckets 已在外层声明 (供 chart 渲染聚合用), 这里只赋值
            const wantUncertainty = !!$('curve-uncertainty')?.checked;
            if (modelId && uniqueBuckets.length > 0) {
                const ctxList = uniqueBuckets.map((b) => ({
                    difficulty: b.difficulty,
                    generator: b.generator,
                    bot_policy: b.bot_policy,
                    pb_bin: b.pb_bin,
                    lifecycle_stage: b.lifecycle_stage,
                }));
            // v3.0.12: 用每 ctx 实际 sample 的平均 θ 来推断 — 跟"实测均值"输入对齐,
            //   两条线就能真正用于评估 "model 跟实测启发式" 的距离 (而非 θ=0.5 常数测试).
            const thetaPerCtx = uniqueBuckets.map((b) => b.theta_norm_avg);
            const hasAllTheta = thetaPerCtx.every((t) => Array.isArray(t) && t.length === 9);

            // v3.0.21: predStd cache key — 同 (model, set, theta, ctxList) 已算过 std 就复用
            //   注: ctxList 顺序固定 (uniqueBuckets order), thetaPerCtx 跟 sample 一致 → 哈希到 key
            const _predCacheKey = `${modelId}|${setId}|${hasAllTheta ? JSON.stringify(thetaPerCtx) : 'default0.5'}`;
            const _cachedStd = _predStdCacheByKey.get(_predCacheKey);
            const _stdCacheHit = !!_cachedStd && wantUncertainty;
            // 反勾选 → 不传 uncertainty 参数; 勾选但 cache hit → 也不传 (省 10x 推断成本)
            const _needFetchStd = wantUncertainty && !_stdCacheHit;

            try {
                const r = await apiSend('POST', `/api/spawn-tuning-v2/models/${modelId}/predict-curve`, {
                    contexts: ctxList,
                    // 当所有 ctx 都有 theta_norm_avg 时, 用 per-ctx θ; 否则 fallback default θ=0.5
                    theta_norm_per_ctx: hasAllTheta ? thetaPerCtx : undefined,
                    uncertainty: _needFetchStd,
                    n_mc_samples: 30,
                });
                if (r.curves?.length === uniqueBuckets.length) {
                    predBuckets = uniqueBuckets.map((b, i) => ({
                        curve: r.curves[i],
                        n: b.n_samples,
                    }));
                    predicted = weightedAvg(predBuckets);
                    const thetaNote = hasAllTheta
                        ? `(per-ctx θ from sample set)`
                        : `(θ = default 0.5)`;
                    predictNote = `模型预测 = ${uniqueBuckets.length} ctx 加权均值, ${thetaNote}, n_total = ${totalN}`;
                    // v2.10.33: 不确定性带 — 把 per-ctx std 用 std-of-mean 公式聚合
                    //   总均值的 std ≠ 平均 std (受 sample size 影响), 但近似 std/sqrt(K)
                    //   为简单起见, 用 RMS (sqrt(weighted_mean(std^2))) 作为整 set std
                    if (_needFetchStd && r.curves_std?.length === uniqueBuckets.length) {
                        predStdBuckets = uniqueBuckets.map((b, i) => ({
                            std: r.curves_std[i],
                            n: b.n_samples,
                        }));
                        // v3.0.21: 写入缓存 — 反勾再勾就不用重发慢请求
                        _predStdCacheByKey.set(_predCacheKey, predStdBuckets);
                        predictNote += ` · MC Dropout ${r.mc_samples || 30} 次`;
                    } else if (_stdCacheHit) {
                        // v3.0.21: cache hit, 复用上次算好的 std
                        predStdBuckets = _cachedStd;
                        predictNote += ` · MC Dropout (cached)`;
                    }
                }
            } catch (e) {
                predictNote = `<span style="color:var(--bad)">模型推断失败: ${escapeHtml(e.message)}</span>`;
            }
            }

            // 3) groupBuckets — 按 user 选的 groupBy 维度二次聚合 uniqueBuckets
            const groups = groupBy.split(',').map((s) => s.trim()).filter(Boolean);
            if (groups.length > 0 && uniqueBuckets.length > 0) {
                groupDims = groups;
                const map = new Map();
                uniqueBuckets.forEach((b, i) => {
                    const key = groups.map((g) => b[g]).join('|');
                    let bucket = map.get(key);
                    if (!bucket) {
                        bucket = {
                            keyObj: Object.fromEntries(groups.map((g) => [g, b[g]])),
                            obsItems: [],
                            predItems: [],
                            // v2.10.32 (P0.1): 加权累加 bins_filled / r
                            bfWeighted: 0,
                            bfWeightSum: 0,
                            rWeighted: 0,
                            rWeightSum: 0,
                            nTotal: 0,
                        };
                        map.set(key, bucket);
                    }
                    bucket.obsItems.push({ curve: b.d_curve_avg, n: b.n_samples });
                    if (predBuckets) bucket.predItems.push(predBuckets[i]);
                    bucket.nTotal += b.n_samples;
                    if (b.bins_filled_mean != null) {
                        bucket.bfWeighted += b.bins_filled_mean * b.n_samples;
                        bucket.bfWeightSum += b.n_samples;
                    }
                    if (b.r_mean != null) {
                        bucket.rWeighted += b.r_mean * b.n_samples;
                        bucket.rWeightSum += b.n_samples;
                    }
                });
                // v3.0.13: 每分组输出"预测 + 实测"两条线, 同色配对 (实线=pred, 虚线=obs)
                //   让用户直观看到 model 对每个分组的拟合质量, 而不是只看 model 自己的分组差异.
                groupBuckets = [...map.values()].flatMap((g) => {
                    const obsAvg = weightedAvg(g.obsItems);
                    const predAvg = g.predItems.length ? weightedAvg(g.predItems) : null;
                    const meta = {
                        ...g.keyObj,
                        n_samples: g.nTotal,
                        bins_filled_mean: g.bfWeightSum > 0 ? g.bfWeighted / g.bfWeightSum : null,
                        r_mean: g.rWeightSum > 0 ? g.rWeighted / g.rWeightSum : null,
                    };
                    const out = [];
                    if (predAvg) {
                        out.push({ ...meta, d_curve_avg: predAvg, __isObserved: false });
                    }
                    if (obsAvg) {
                        out.push({ ...meta, d_curve_avg: obsAvg, __isObserved: true });
                    }
                    return out;
                });

                if (!modelId) groupSourceUsed = 'observed-no-model';
                else if (!predBuckets) groupSourceUsed = 'observed-fallback';
                else groupSourceUsed = 'predicted+observed';
            }
        }

        // v2.10.29-fix: 未选 set 但选了 model — 单 ctx 兜底预测 (不画实测线)
        if (!setId && modelId && !predicted) {
            const ctx = {
                difficulty: 'normal', generator: 'rule', bot_policy: 'clear-greedy',
                pb_bin: 4000, lifecycle_stage: 'mature',
            };
            try {
                const r = await apiSend('POST', `/api/spawn-tuning-v2/models/${modelId}/predict-curve`, {
                    contexts: [ctx],
                });
                if (r.curves?.length > 0) {
                    predicted = r.curves[0];
                    predictNote = `<span style="color:var(--warn)">⚠ 未选样本集 — 预测 ctx = ${ctx.difficulty}:${ctx.generator}:${ctx.bot_policy}:${ctx.pb_bin}:${ctx.lifecycle_stage} (单点, 不代表全 ctx 均值)</span>`;
                }
            } catch (e) {
                predictNote = `<span style="color:var(--bad)">模型推断失败: ${escapeHtml(e.message)}</span>`;
            }
        }

        const canvas = $('d-curve-canvas');
        const container = canvas.parentElement;
        const containerW = container ? container.clientWidth : 600;
        // v2.10.33 (P2.3 UI): 聚合 per-ctx std → 整 set predicted_std (RMS by n_samples)
        //   公式: std_total[i] = sqrt(Σ_k (n_k/N) · std_k[i]^2)
        let predictedStd = null;
        if (predStdBuckets && predStdBuckets.length > 0) {
            const totalN_std = predStdBuckets.reduce((s, b) => s + b.n, 0);
            if (totalN_std > 0) {
                predictedStd = new Array(20).fill(0);
                predStdBuckets.forEach((b) => {
                    for (let i = 0; i < 20; i++) predictedStd[i] += (b.std[i] ** 2) * b.n;
                });
                predictedStd = predictedStd.map((v) => Math.sqrt(v / totalN_std));
            }
        }
        // v3.0.18: baseline 也按逐 sample 处理 — 调 /scatter 拿原始点 (橙色散点)
        //   计算 MAE 用每条 sample 的 (r, d_obs) 跟 ideal_S(r) 比, 更"原始"
        let baselineScatterPoints = null;
        let baselineNote = '';
        if (baselineSetId && baselineSetId !== setId) {
            baselineScatterPoints = await _loadScatter(baselineSetId, '');   // 不传 model_id, 只要实测
            if (baselineScatterPoints && baselineScatterPoints.length > 0) {
                // 逐 sample 算 MAE vs ideal(r) — 而非 mean curve MAE
                const idealAtR = (r) => {
                    // bin index = floor(r / 0.1), 取 target[bin]
                    const bi = Math.min(19, Math.max(0, Math.floor(r / 0.1)));
                    return target[bi];
                };
                let blMaeSum = 0;
                for (const p of baselineScatterPoints) {
                    blMaeSum += Math.abs(p[1] - idealAtR(p[0]));
                }
                const baselineMaeVsIdeal = blMaeSum / baselineScatterPoints.length;
                // 主样本集也逐 sample 算 (用已加载的 _scatterPointsCache)
                let bestMaeVsIdeal = null;
                if (_scatterPointsCache && _scatterPointsCache.length > 0) {
                    let m = 0;
                    for (const p of _scatterPointsCache) {
                        m += Math.abs(p[1] - idealAtR(p[0]));
                    }
                    bestMaeVsIdeal = m / _scatterPointsCache.length;
                }
                const liftMae = (bestMaeVsIdeal != null) ? (baselineMaeVsIdeal - bestMaeVsIdeal) : null;
                const liftPct = (liftMae != null && baselineMaeVsIdeal > 0) ? (liftMae / baselineMaeVsIdeal * 100) : null;
                baselineNote = `<span style="color:var(--muted);"> · baseline(set #${baselineSetId}) ${baselineScatterPoints.length} 点 MAE=<b>${baselineMaeVsIdeal.toFixed(4)}</b></span>`;
                if (liftMae != null) {
                    const sign = liftMae >= 0 ? '+' : '';
                    const color = liftMae > 0.005 ? 'var(--good)' : (liftMae < -0.005 ? 'var(--bad)' : 'var(--muted)');
                    baselineNote += ` <span style="color:${color}; font-weight:600;">⚡ θ 撬动 = ${sign}${liftMae.toFixed(4)} (${sign}${liftPct?.toFixed(1)}%)</span>`;
                }
            }
        }
        // v3.0.22: 分维度散点 — 跟整 set 预测/实测一样 "逐 sample 打点", 不再画 mean 折线 extras
        //   后端 scatter 接口 schema v3.0.22 起返回 [r, d_obs, d_pred_or_null, dim_key], 前端按 group_by 维度切分
        //   每组 obs 点 (轻浅同色) + pred 点 (深色同色) → 用户能看"该组 model 预测 vs 实测"
        const _DIM_ORDER_SCATTER = ['difficulty', 'generator', 'bot_policy', 'pb_bin', 'lifecycle_stage'];
        let _groupScatterPoints = null;
        if (groupDims.length > 0 && _scatterPointsCache && _scatterPointsCache.length > 0) {
            const sample = _scatterPointsCache[0];
            const hasDimKey = Array.isArray(sample) && sample.length >= 4 && typeof sample[3] === 'string';
            if (hasDimKey) {
                const dimIdxs = groupDims.map((d) => _DIM_ORDER_SCATTER.indexOf(d)).filter((i) => i >= 0);
                if (dimIdxs.length > 0) {
                    const groupMap = new Map();
                    for (const p of _scatterPointsCache) {
                        const parts = (p[3] || '').split('|');
                        const key = dimIdxs.map((i) => parts[i] ?? '?').join('·');
                        let bucket = groupMap.get(key);
                        if (!bucket) {
                            bucket = { key, points: [] };
                            groupMap.set(key, bucket);
                        }
                        bucket.points.push(p);
                    }
                    // 按 key 字典序稳定排序, 让相同 group_by 选择每次颜色一致
                    _groupScatterPoints = [...groupMap.values()].sort((a, b) => a.key.localeCompare(b.key));
                }
            }
        }
        // 兼容: 老逻辑的 extras (mean 折线) 在 group 散点存在时禁用; 仅未启用 group 时保留 (无 group 时也无 extras)
        const _extras = [];
        // v3.0.14 (A): 聚合 bin_real_ratio — 整 set 维度的"每 bin 真实占比"
        //   公式: ratio_total[i] = Σ_ctx (n_ctx * ratio_ctx[i]) / Σ_ctx n_ctx
        //   chart 渲染 observed 时, ratio < 0.3 的 bin 走虚线 (告知 user 此处是 lastValue 填充)
        let observedFillRatio = null;
        if (setId && uniqueBuckets.length > 0) {
            const totalN_fill = uniqueBuckets.reduce((s, b) => s + (b.n_samples || 0), 0);
            if (totalN_fill > 0) {
                observedFillRatio = new Array(20).fill(0);
                uniqueBuckets.forEach((b) => {
                    const ratios = Array.isArray(b.bin_real_ratio) ? b.bin_real_ratio : null;
                    const w = b.n_samples || 0;
                    if (ratios && ratios.length === 20) {
                        for (let i = 0; i < 20; i++) {
                            observedFillRatio[i] += ratios[i] * w;
                        }
                    }
                });
                observedFillRatio = observedFillRatio.map((v) => v / totalN_fill);
            }
        }
        renderDCurveChart(canvas, {
            targetCurve: target,
            predictedCurve: predicted,
            predictedStd,
            observedCurve: observed,
            // v3.0.14 (A): chart 用此 mask 区分真实/填充段
            observedFillRatio,
            // v3.0.14 (D): 散点数据 (来自 _scatterPoints 状态)
            scatterPoints: _scatterPointsCache,
            // v3.0.18: baseline 散点 (橙色)
            baselineScatterPoints,
            // v3.0.22: 分维度散点 — 每组 obs (浅同色) + pred (深同色), 替代以前的 mean 折线 extras
            groupScatterPoints: _groupScatterPoints,
            extraCurves: _extras.length > 0 ? _extras : null,
            options: {
                width: Math.max(600, Math.min(1400, containerW)),
                height: 320,
                // v3.0.17: 强制散点模式 — 不再画 mean 折线 (聚合假象), 只画 ideal target + 逐 sample 散点
                scatterMode: true,
            },
        });

        // v3.0.23: 底部汇总与横幅统一口径。主结论只用真实观测 bin 上的
        // Δ = |实测-S| - |预估-S|；全 20 bin 指标仅作含先验诊断。
        const verdict = _factEvalVerdict({ observed, predicted, target, observedFillRatio });
        const vm = verdict?.metrics || {};
        const hasMetric = (v) => v === v && v != null;
        const signed = (v) => `${v >= 0 ? '+' : ''}${fmtNumber(v, 4)}`;
        const lines = [];
        if (observed) {
            const mFull = computeChartMetrics(observed, target);
            if (hasMetric(vm.measuredMae)) {
                lines.push(`<span title="判定口径: 仅在真实观测 bin 上计算 |实测−目标S|, 与预估口径同 bin 可比。">E_meas = |实测−S| <b>${fmtNumber(vm.measuredMae, 4)}</b> <span style="color:var(--muted)">[观测bin]</span></span>`);
            } else {
                lines.push(`<span title="全 20 bin 诊断值, 含先验填充 bin, 不作为提升判定。">E_meas = |实测−S| <b>${fmtNumber(mFull.mae, 4)}</b> <span style="color:var(--muted)">[全bin诊断]</span></span>`);
            }
            lines.push(`实测单调(全bin) = ${mFull.monotonic ? '✓' : '✗'}`);
            lines.push(`n_samples = ${nSamples}`);
            if (nCtxUnique > 0) lines.push(`n_ctx = ${nCtxUnique}`);
            // v2.10.32 (P0.1): 透明化 bin 真实观察比例
            const bfAvg = window._lastBinsFilledAvg;
            if (bfAvg != null) {
                const pct = Math.round((bfAvg / 20) * 100);
                const tone = pct < 40 ? 'var(--bad)' : pct < 70 ? 'var(--warn)' : 'var(--ok)';
                lines.push(`<span style="color:${tone}" title="20 个 bin 中平均有 ${bfAvg.toFixed(1)} 个是真实观察, 其余靠 _pbAwareDPbBase 先验填充">真实观察 = ${bfAvg.toFixed(1)}/20 (${pct}%)</span>`);
            }
            const rMean = window._lastRMean;
            if (rMean != null) {
                const tone = rMean < 0.3 ? 'var(--bad)' : rMean < 0.7 ? 'var(--warn)' : 'var(--ok)';
                lines.push(`<span style="color:${tone}" title="bot 实际达到的 score/PB 均值. < 0.3 说明 bot 远打不到 PB, 大部分 d_curve 区间是先验">avg r = ${rMean.toFixed(3)}</span>`);
            }
        }
        if (predicted) {
            const pmFull = computeChartMetrics(predicted, target);
            // v2.10.29: 两线在同 ctx 集合上对照 → predicted vs observed MAE 直接有意义
            const pomaeFull = observed
                ? observed.reduce((s, v, i) => s + Math.abs(v - predicted[i]), 0) / 20
                : null;
            if (hasMetric(vm.predMaeObs)) {
                lines.push(`<span title="判定口径: 仅在真实观测 bin 上计算 |预估−目标S|, 与 E_meas 同 bin 可比。">E_pred = |预估−S| <b>${fmtNumber(vm.predMaeObs, 4)}</b> <span style="color:var(--muted)">[观测bin]</span></span>`);
            } else {
                lines.push(`<span title="全 20 bin 诊断值, 含无真实观测 bin 上的模型外推, 不作为提升判定。">E_pred = |预估−S| <b>${fmtNumber(pmFull.mae, 4)}</b> <span style="color:var(--muted)">[全bin诊断]</span></span>`);
            }
            if (observed && hasMetric(vm.improvement)) {
                const tone = vm.improvement > 0.05 ? 'var(--ok)' : vm.improvement >= 0 ? 'var(--warn)' : 'var(--bad)';
                lines.push(`<span style="color:${tone}" title="唯一提升判定: Δ = |实测−S| − |预估−S|。Δ>0 表示预估比实测更逼近目标S;覆盖不足只作告警,不翻转该结论。">★ Δ = E_meas − E_pred = <b>${signed(vm.improvement)}</b></span>`);
            }
            if (observed && hasMetric(vm.calibResidual)) {
                lines.push(`<span title="诊断量: R = |预估−实测|, 表示模型相对现状的改动幅度;默认不参与提升判定。">R = |预估−实测| <b>${fmtNumber(vm.calibResidual, 4)}</b> <span style="color:var(--muted)">[改动幅度]</span></span>`);
            } else if (pomaeFull != null) {
                lines.push(`<span title="全 20 bin 诊断值, 含先验/外推 bin, 不参与提升判定。">R = |预估−实测| <b>${fmtNumber(pomaeFull, 4)}</b> <span style="color:var(--muted)">[全bin诊断]</span></span>`);
            }
            if (observed && hasMetric(vm.improvement)) {
                const obsFull = computeChartMetrics(observed, target);
                const fullDelta = obsFull.mae - pmFull.mae;
                lines.push(`<span style="color:var(--muted)" title="全 20 bin 含先验填充/模型外推, 只用于观察, 不参与提升判定。">全bin诊断: E_meas ${fmtNumber(obsFull.mae, 4)} · E_pred ${fmtNumber(pmFull.mae, 4)} · Δ ${signed(fullDelta)}</span>`);
            }
            // v2.10.33 (P2.3 UI): 不确定性指标 — std 均值 + 最大 (找 model 最没把握的 bin)
            if (predictedStd) {
                const avgStd = predictedStd.reduce((a, b) => a + b, 0) / predictedStd.length;
                const maxStd = Math.max(...predictedStd);
                const maxBin = predictedStd.indexOf(maxStd);
                const rAtMax = (maxBin + 0.5) * (2.0 / predictedStd.length);
                const tone = maxStd < 0.05 ? 'var(--ok)' : maxStd < 0.10 ? 'var(--warn)' : 'var(--bad)';
                lines.push(`<span style="color:${tone}" title="MC Dropout 估计的 epistemic uncertainty. max 出现的 bin 是 model 最没把握的区域 (通常对应低 n_bins_filled 的 r)">不确定性 avg σ = ${fmtNumber(avgStd, 4)} · max σ = ${fmtNumber(maxStd, 4)} @ r≈${rAtMax.toFixed(2)}</span>`);
            }
            if (predictNote) lines.push(predictNote);
        } else if (modelId && predictNote) {
            lines.push(predictNote);
        } else if (!modelId) {
            lines.push('<span style="color:var(--muted)">未选模型 — 只显示目标 + 实测 (不画预测线)</span>');
        }
        // v2.10.24: 多分组对比表
        let groupTable = '';
        if (groupBuckets && groupBuckets.length > 1) {
            const rows = groupBuckets.slice(0, 12).map((b) => {
                const m = computeChartMetrics(b.d_curve_avg, target);
                const span = b.d_curve_avg[b.d_curve_avg.length - 1] - b.d_curve_avg[0];
                const keyParts = groupDims.map((d) => `${escapeHtml(d)}=<b>${escapeHtml(String(b[d]))}</b>`).join(' · ');
                // v2.10.32 (P0.1): 该桶真实观察 bin 数 + bot 达到的 r 均值
                //   注: groupBuckets 是前端二次聚合的 (来自 uniqueBuckets), 不带 bins_filled_mean 字段
                //   需要在前端聚合时把 bins_filled_mean 也加权
                const bfMean = b.bins_filled_mean != null ? b.bins_filled_mean.toFixed(1) : '—';
                const rAvg = b.r_mean != null ? b.r_mean.toFixed(2) : '—';
                return `<tr>
                    <td style="padding:2px 8px;">${keyParts}</td>
                    <td style="padding:2px 8px; text-align:right;">${b.n_samples}</td>
                    <td style="padding:2px 8px; text-align:right;">${fmtNumber(m.mae, 4)}</td>
                    <td style="padding:2px 8px; text-align:right;">${fmtNumber(span, 3)}</td>
                    <td style="padding:2px 8px;">${m.monotonic ? '✓' : '✗'}</td>
                    <td style="padding:2px 8px; text-align:right;" title="该子集 bot 实际打到的 score/PB 均值">${rAvg}</td>
                    <td style="padding:2px 8px; text-align:right;" title="20 bin 中真实观察的 bin 数 (其余靠先验填充)">${bfMean}</td>
                </tr>`;
            }).join('');
            const truncatedNote = groupBuckets.length > 12 ? `<p style="color:var(--muted); font-size:10.5px;">… 还有 ${groupBuckets.length - 12} 组未显示</p>` : '';
            // v2.10.30: badge 简化 — 默认 model, 未选/失败时 fallback observed
            const srcBadge = groupSourceUsed === 'predicted'
                ? '<span style="color:var(--accent)">[模型预测]</span>'
                : groupSourceUsed === 'observed-no-model'
                    ? '<span style="color:var(--warn)" title="未选模型, 分组线已 fallback 实测">[实测 · fallback]</span>'
                    : '<span style="color:var(--warn)" title="模型推断失败, 分组线已 fallback 实测">[实测 · 推断失败]</span>';
            groupTable = `
              <div style="margin-top:8px;">
                <div style="font-size:11px; color:var(--muted); margin-bottom:2px;">📊 按 [${groupDims.join(', ')}] 分组对比 (${groupBuckets.length} 组, chart 中画前 8 组浅色线) ${srcBadge}</div>
                <table style="width:100%; font-size:11px; border-collapse:collapse;">
                  <thead><tr style="color:var(--muted);">
                    <th style="text-align:left; padding:2px 8px;">分组</th>
                    <th style="text-align:right; padding:2px 8px;">n_samples</th>
                    <th style="text-align:right; padding:2px 8px;">vs 目标 MAE</th>
                    <th style="text-align:right; padding:2px 8px;">跨度</th>
                    <th style="text-align:left; padding:2px 8px;">单调</th>
                    <th style="text-align:right; padding:2px 8px;" title="bot 实际触达的 score/PB 均值">avg r</th>
                    <th style="text-align:right; padding:2px 8px;" title="20 bin 中真实观察的 bin 数">真实 bin</th>
                  </tr></thead>
                  <tbody>${rows}</tbody>
                </table>
                ${truncatedNote}
              </div>
            `;
        }
        // v1.62.0: 以目标 S 为准 —— 在指标区顶部给出"预估是否比实测更逼近目标"的三态判定
        meta.innerHTML = _renderFactVerdictBanner(verdict) + lines.join(' · ') + baselineNote + groupTable;
    } catch (e) {
        meta.innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`;
    }
}


// ─────────── 启动 ───────────

function bindEvents() {
    setupTabs();
    setupChips();
    $('btn-rollback').addEventListener('click', rollbackCurrent);
    $('btn-remove-deploy')?.addEventListener('click', removeDeployment);
    $('btn-start-collect').addEventListener('click', startCollect);
    $('btn-cancel-collect').addEventListener('click', () => { _samplerCancel.cancelled = true; });
    $('btn-refresh-sets').addEventListener('click', refreshSampleSets);
    $('btn-import-behavior')?.addEventListener('click', () => syncBehaviorSamples());
    $('filter-status').addEventListener('change', refreshSampleSets);
    $('btn-submit-job').addEventListener('click', submitJob);
    $('btn-refresh-jobs').addEventListener('click', refreshJobs);
    $('btn-refresh-models').addEventListener('click', refreshModels);
    $('btn-compare-models')?.addEventListener('click', showCompareModal);
    bindIncrementalWizard();   // G4: 增量训练 wizard
    $('btn-export-bundle').addEventListener('click', exportBundle);
    $('btn-bundle-status').addEventListener('click', refreshBundleStatus);
    $('btn-load-field').addEventListener('click', loadFieldMetrics);
    $('btn-render-curve').addEventListener('click', renderCurve);
    // v3.0.21: ±2σ 勾选/反勾直接生效 (不必再点"绘制对照图"按钮)
    //   勾选: 首次 MC Dropout 慢请求 → 拿 std 入缓存; 再勾 cache 命中 → 秒回
    //   反勾: 跳过 uncertainty 参数, 普通 predict 即时重渲
    //   未首次 render (无 modelId/setId) → renderCurve 内部自动 noop, 不会出错
    $('curve-uncertainty')?.addEventListener('change', () => {
        // 仅当 chart 已渲染过 (canvas 有数据) 才触发重渲, 避免空 chart 误触发请求
        const canvas = $('d-curve-canvas');
        if (canvas && canvas._dcurveLastData) {
            renderCurve();
        }
    });
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
    // G1 v2.10.8: 数据质量模态
    $('quality-modal-close')?.addEventListener('click', closeQualityModal);
    $('quality-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'quality-modal') closeQualityModal();
    });
    // G2 v2.10.8: 模型对比模态
    $('compare-modal-close')?.addEventListener('click', closeCompareModal);
    $('compare-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'compare-modal') closeCompareModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMetricsModal(); closePreviewModal();
            closeQualityModal(); closeCompareModal();
        }
    });

    // v2.9.4: 切换 model_type 时自动调整 LR 默认值 (避免用户 transformer 用 lr=0.05 翻车)
    const mtSel = $('job-model-type');
    const lrInput = $('job-lr');
    if (mtSel && lrInput) {
        mtSel.addEventListener('change', () => {
            const isTransformer = mtSel.value === 'transformer';
            const current = Number(lrInput.value);
            // v2.10.13: 不用科学计数法 (用户不熟悉, 显示 0.001 / 0.005)
            if (isTransformer && current > 5e-3) {
                lrInput.value = '0.001';
                $('job-hint').innerHTML = '<span style="color:var(--muted)">Transformer 默认 lr 已切换到 0.001 (Transformer 对 LR 敏感)</span>';
            } else if (!isTransformer && current < 5e-3) {
                lrInput.value = '0.005';
                $('job-hint').innerHTML = '<span style="color:var(--muted)">ResNet 默认 lr 已切换到 0.005</span>';
            }
            // G10 v2.10.10: 显示/隐藏 .tx-only 标签 (grid auto-fit 自动重排)
            document.querySelectorAll('.tx-only').forEach((el) => {
                el.style.display = isTransformer ? '' : 'none';
            });
            // v2.10.10: 切换架构后重过滤 base_model 列表 (异架构 ckpt 不能加载)
            refreshBaseModelOptions();
        });
        // 页面初次加载时根据当前值同步
        const initIsTransformer = mtSel.value === 'transformer';
        document.querySelectorAll('.tx-only').forEach((el) => {
            el.style.display = initIsTransformer ? '' : 'none';
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    refreshOverview();
    // 自动从用户行为增量同步「用户行为样本集 (寻参可训)」, 让它直接出现在 B.2 与训练选择器。
    // 后台执行(不阻塞 UI); 增量按 session_id 去重, 首次后很快。
    syncBehaviorSamples({ silent: true });
});
