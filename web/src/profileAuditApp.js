/**
 * profileAuditApp.js — 玩家画像指标自评估可视化页（web/profile-audit.html）的主逻辑。
 *
 * 三种模式（左上 Tab 切换）：
 *   1) 单局 audit：选某个 session → Worker 跑 audit → 渲染契约/hint/链路 → 可上传到 SQLite
 *   2) 对照 audit：选 current + baseline 两个 session → Worker 跑两次 → 渲染 comparison
 *   3) 聚合视图：GET /api/profile-audit/recent → 渲染契约违规率、hint 频次、stress 主导分布
 *
 * 复用：
 *   - profileAudit.worker.js 在 Worker 跑，避免阻塞 UI
 *   - 与 server.py /api/profile-audit/* 端点对齐（POST 上传、GET /recent 聚合）
 *   - 与 spawn-eval.html 同款配色与布局，但纯 audit 视角
 */

import {
    auditProfile,
    aggregateAuditReports,
    summarizeOptimizationActions,
} from './audit/profileAudit.js';
import { getApiBaseUrl } from './config.js';
import { getUserId } from './lib/userId.js';

const $ = (id) => document.getElementById(id);
let _worker = null;
let _seq = 0;
const _pending = new Map();

function getWorker() {
    if (typeof Worker === 'undefined') return null;
    if (_worker) return _worker;
    _worker = new Worker(new URL('./profileAudit.worker.js', import.meta.url), { type: 'module' });
    _worker.addEventListener('message', (ev) => {
        const { id, ok, ...rest } = ev.data || {};
        const p = _pending.get(id);
        if (!p) return;
        _pending.delete(id);
        if (ok) p.resolve(rest);
        else p.reject(new Error(rest.error || 'audit worker error'));
    });
    _worker.addEventListener('error', (ev) => {
        for (const p of _pending.values()) p.reject(new Error(ev.message || 'worker error'));
        _pending.clear();
        _worker?.terminate();
        _worker = null;
    });
    return _worker;
}

/* worker 不可用时退到主线程同步跑（小局够用）。 */
function runInWorker(type, payload) {
    const worker = getWorker();
    if (!worker) {
        return new Promise((resolve) => {
            setTimeout(() => {
                if (type === 'audit') {
                    resolve({ report: auditProfile(payload.frames, payload.opts || {}) });
                } else if (type === 'aggregate') {
                    resolve({ aggregate: aggregateAuditReports(payload.reports) });
                } else if (type === 'summarize-actions') {
                    resolve({ actions: summarizeOptimizationActions(payload.aggregate) });
                }
            }, 0);
        });
    }
    const id = ++_seq;
    return new Promise((resolve, reject) => {
        _pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, ...payload });
    });
}

/* ===== utils ===== */
const escapeHtml = (s) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const sevIcon = (s) => ({ error: '❌', warn: '⚠️', info: 'ℹ️' }[s] || '·');

function setStatus(msg) {
    const el = $('audit-status');
    if (el) el.textContent = msg || '';
}

async function apiFetch(path, init) {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...((init && init.headers) || {}) },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${path} ${res.status} ${text}`);
    }
    return res.json();
}

/* ===== Sessions / Users 列表 ===== */
let _cachedSessions = null;
let _cachedSessionsKey = '';   // user_id 切换时让缓存失效
let _usersPopulated = false;   // user 下拉是否已初始化

/* "全库 admin 模式"用专用 sentinel value，避免与"未选择"（空字符串）撞车——
 * 之前空字符串既被默认 select 状态又被全库模式占用，HTML 渲染 selected 失败时
 * 用户会被无意识带入 admin 路径，触发 403。 */
const ALL_USERS_SENTINEL = '__all_users__';

/**
 * 拿"哪个 user_id 来加载 session"。
 *   - 下拉值是 ALL_USERS_SENTINEL → 返回 '' 触发 admin 全库视图
 *   - 下拉值是具体 user_id → 直接返回
 *   - 下拉值意外为空 / select 不存在 / 兜底场景 → 回退到 localStorage 当前用户，
 *     杜绝"无意识进入 admin 路径"
 */
function _currentTargetUserId() {
    const sel = $('audit-user-id');
    const v = (sel && sel.value !== undefined) ? sel.value.trim() : '';
    if (v === ALL_USERS_SENTINEL) return '';   // 显式 admin 全库
    if (v) return v;
    return getUserId() || '';                  // 兜底
}

/**
 * 拉所有用户列表填充下拉。
 *
 * 两种模式：
 *   - DEBUG 模式（OPENBLOCK_DB_DEBUG=1）：超级用户视角
 *       - 默认置顶并选中"🌐 全库 · 所有用户聚合"，一打开页面就看到所有人
 *       - "👤 自己"次置顶，其他用户按活跃度排
 *   - 普通模式（DEBUG 未开）：私域视角
 *       - 只有"👤 自己"可选 + 跨用户视图占位 disabled
 *       - 默认选中"自己"
 */
async function populateUsersSelect() {
    const sel = $('audit-user-id');
    if (!sel || _usersPopulated) return;

    const myId = getUserId() || '';
    let users = [];
    let isDebug = true;
    try {
        users = await apiFetch('/api/profile-audit/users');
        if (!Array.isArray(users)) users = [];
        if (users.length === 0) isDebug = false;   // 服务端无权返回 → []
    } catch {
        users = [];
        isDebug = false;
    }

    /* 排序：myId 永远第二位（"自己"），其他按 lastActiveAt 降序 */
    const seen = new Set();
    const userOptions = [];
    if (myId) {
        const me = users.find((u) => u.userId === myId);
        userOptions.push(me ?? { userId: myId, sessionCount: 0, auditCount: 0, lastActiveAt: null });
        seen.add(myId);
    }
    for (const u of users) {
        if (!seen.has(u.userId)) {
            userOptions.push(u);
            seen.add(u.userId);
        }
    }

    const fmt = (u) => {
        const tag = u.userId === myId ? '👤 自己 · ' : '';
        const sess = u.sessionCount > 0 ? ` · ${u.sessionCount} 局` : '';
        const audited = u.auditCount > 0 ? ` · ${u.auditCount} 已 audit` : '';
        const shortId = u.userId.length > 26 ? u.userId.slice(0, 24) + '…' : u.userId;
        return `${tag}${shortId}${sess}${audited}`;
    };

    /* DEBUG 模式："🌐 全库"置顶 + selected，超级用户开门见山看全部；
     * 普通模式："🌐 全库"disabled 末尾，"自己" selected。 */
    const parts = [];
    if (isDebug) {
        parts.push(`<option value="${ALL_USERS_SENTINEL}" selected>🌐 全库 · 所有用户聚合（${users.length} 用户）</option>`);
        parts.push(...userOptions.map((u) =>
            `<option value="${escapeHtml(u.userId)}">${escapeHtml(fmt(u))}</option>`
        ));
    } else {
        parts.push(...userOptions.map((u) =>
            `<option value="${escapeHtml(u.userId)}" ${u.userId === myId ? 'selected' : ''}>${escapeHtml(fmt(u))}</option>`
        ));
        parts.push(`<option value="${ALL_USERS_SENTINEL}" disabled>🔒 全库视图需 OPENBLOCK_DB_DEBUG=1</option>`);
    }

    sel.innerHTML = parts.join('');
    /* 兜底：如果 selected 渲染异常导致 select 停在空 value，强制 selectedIndex=0 */
    if (sel.value === '' || sel.selectedIndex < 0) {
        sel.selectedIndex = 0;
    }
    _usersPopulated = true;
}

async function loadSessions() {
    const uid = _currentTargetUserId();
    if (_cachedSessions && _cachedSessionsKey === uid) return _cachedSessions;
    /* 走轻量端点 /api/profile-audit/sessions：只取元数据（不含 frames），
     * 同时附带 hasAudit / auditHealthScore，让 UI 标注"已跑过的 session"。 */
    const qs = new URLSearchParams({ limit: '80' });
    if (uid) qs.set('user_id', uid);
    const list = await apiFetch(`/api/profile-audit/sessions?${qs}`);
    _cachedSessions = Array.isArray(list) ? list : [];
    _cachedSessionsKey = uid;
    return _cachedSessions;
}

function renderSessionOption(s) {
    const date = s.startTime ? new Date(Number(s.startTime)).toLocaleString() : '—';
    /* 已 audit 的 session 在 label 前用 ✓ 标记 + 健康分；未跑的留空。
     * 这样下拉里能一眼看出"哪些是待跑的""哪些已存档"。 */
    const mark = s.hasAudit ? `✓${s.auditHealthScore ?? ''} ` : '·   ';
    const sizeKB = s.framesByteLen != null ? ` · ${Math.round(s.framesByteLen / 1024)}KB` : '';
    /* 与「对局回放」列表同口径：优先末帧真实分数；落子步数（不计 init/spawn） */
    const score = s.score ?? 0;
    const steps = s.placeSteps != null ? ` · ${s.placeSteps} 步` : '';
    const userTag = s.userId ? ` · ${escapeHtml(s.userId).slice(0, 16)}` : '';
    return `<option value="${s.sessionId}">${mark}#${s.sessionId} · ${escapeHtml(s.strategy || '—')} · ${score} 分${steps} · ${date}${sizeKB}${userTag}</option>`;
}

async function populateSessionSelects() {
    // 先确保 user 下拉初始化（仅首次；后续切 user 走 reload）
    await populateUsersSelect();

    let sessions = [];
    let loadError = null;
    try {
        sessions = await loadSessions();
    } catch (e) {
        loadError = e;
    }
    const html = '<option value="">— 选择 session —</option>'
        + sessions.map(renderSessionOption).join('');
    for (const id of ['audit-session', 'audit-baseline-session']) {
        const sel = $(id);
        if (sel) sel.innerHTML = html;
    }
    const auditedCount = sessions.filter((s) => s.hasAudit).length;
    if (loadError) {
        const msg = String(loadError.message || loadError);
        const hint = msg.includes('403')
            ? '（admin 跨用户模式需要 OPENBLOCK_DB_DEBUG=1，或在 user_id 框里填具体的 ID）'
            : '（确认 server.py 已启动，或点"载入演示数据"先体验）';
        setStatus(`⚠️ 拉取 session 失败：${msg}${hint}`);
    } else if (sessions.length === 0) {
        const uid = _currentTargetUserId();
        if (uid) {
            setStatus(`ℹ️ user ${uid} 暂无已完成对局——回主页玩 1 局 ≥5 步，或点"载入演示数据"立即体验`);
        } else {
            setStatus(`ℹ️ 全库无任何 session——还没有玩家完成过对局；可点"载入演示数据"立即体验`);
        }
    } else {
        const uid = _currentTargetUserId();
        const subject = uid ? `user ${uid.slice(0, 16)}` : '全库';
        setStatus(`✓ ${subject} · ${sessions.length} 个 session（${auditedCount} 已有 audit）`);
    }
}

/* ===== 单局 audit 渲染 ===== */
function renderReport(report, mountId) {
    const root = $(mountId);
    if (!root) return;

    const summary = report.summary || {};
    const linkages = report.linkages || {};
    const hints = report.hints || [];
    const contracts = report.contracts || [];
    const comparison = report.comparison;

    const sevCounts = hints.reduce((acc, h) => ({ ...acc, [h.severity]: (acc[h.severity] || 0) + 1 }), {});

    const headerHtml =
        `<div class="audit-header">
            <div class="audit-score" data-score="${report.healthScore}">
                <div class="audit-score-num">${report.healthScore}<span class="audit-score-max">/100</span></div>
                <div class="audit-score-lbl">健康分</div>
                ${comparison ? `<div class="audit-score-delta" data-delta="${comparison.healthScoreDelta}">vs baseline ${comparison.healthScoreDelta >= 0 ? '+' : ''}${comparison.healthScoreDelta}</div>` : ''}
            </div>
            <div class="audit-meta">
                <span><b>${summary.totalFrames ?? 0}</b> 帧 · <b>${summary.sessionsCount ?? 0}</b> 局</span>
                <span>契约 <b style="color:#34d399">${summary.passedContracts ?? 0}✓</b> / <b style="color:#f87171">${summary.failedContracts ?? 0}✗</b></span>
                <span>冷启动 <b>${summary.coldFramesRatio != null ? (summary.coldFramesRatio * 100).toFixed(0) + '%' : '—'}</b></span>
                <span>hint ❌${sevCounts.error ?? 0} ⚠️${sevCounts.warn ?? 0} ℹ️${sevCounts.info ?? 0}</span>
                ${linkages.stressDominator?.key ? `<span>stress 主导 <b>${escapeHtml(linkages.stressDominator.key)}</b> (${(linkages.stressDominator.shareOfAbs * 100).toFixed(0)}%)</span>` : ''}
                ${linkages.intentSwitches != null ? `<span>intent 切换 <b>${linkages.intentSwitches}</b></span>` : ''}
            </div>
        </div>`;

    const contractsHtml =
        `<section class="audit-section">
            <h3>📜 契约 (${contracts.length})</h3>
            <div class="audit-contract-grid">
                ${contracts.map((c) => {
                    const cls = c.passed ? 'audit-contract--pass' : 'audit-contract--fail';
                    const cmp = comparison?.contracts?.find?.((x) => x.id === c.id);
                    const tag = cmp?.regressed ? '<span class="audit-tag audit-tag--regress">回归</span>'
                        : cmp?.improved ? '<span class="audit-tag audit-tag--improve">改善</span>'
                        : '';
                    return `<div class="audit-contract ${cls}">
                        <div class="audit-contract-head">
                            <span class="audit-contract-icon">${c.passed ? '✓' : '✗'}</span>
                            <code>${escapeHtml(c.id)}</code>
                            ${tag}
                        </div>
                        <div class="audit-contract-desc">${escapeHtml(c.desc || '')}</div>
                        <div class="audit-contract-meta">
                            <code>${(c.metrics || []).map(escapeHtml).join(', ')}</code>
                            <span>${escapeHtml(c.reason || '')}</span>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </section>`;

    const hintsHtml = hints.length === 0
        ? '<section class="audit-section"><h3>🎉 优化建议</h3><p>无 hint 触发——指标体系运作健康</p></section>'
        : `<section class="audit-section">
            <h3>🛠 优化建议 (${hints.length})</h3>
            <ul class="audit-hints">
                ${hints.map((h) => `
                    <li class="audit-hint audit-hint--${h.severity}">
                        <span class="audit-hint-icon">${sevIcon(h.severity)}</span>
                        <code class="audit-hint-code">${escapeHtml(h.code)}</code>
                        ${h.contract ? `<code class="audit-hint-target">${escapeHtml(h.contract)}</code>` : ''}
                        ${(h.metrics || []).length > 0 ? `<code class="audit-hint-target">${(h.metrics || []).map(escapeHtml).join(',')}</code>` : ''}
                        <div class="audit-hint-msg">${escapeHtml(h.msg)}</div>
                    </li>`).join('')}
            </ul>
        </section>`;

    root.innerHTML = headerHtml + contractsHtml + hintsHtml;
}

/* ===== 聚合视图渲染 ===== */
function renderAggregate(agg, mountId) {
    const root = $(mountId);
    if (!root) return;
    const hs = agg.healthScore;
    const top = agg.topRegressions || [];
    const hints = agg.hintCounts || [];
    const doms = agg.stressDominatorCounts || [];
    const sessions = agg.sessions || [];
    const verStats = agg.engineVersionStats;
    const redundantPairs = agg.redundantPairTop || [];

    /* v1.62.4：旧版本报告 → 顶部高亮 banner，引导用户点"强制重跑" */
    const staleBanner = (verStats && verStats.mismatchCount > 0)
        ? `<div style="background:rgba(248,113,113,0.12);border:1px solid var(--bad);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--text)">
              ⚠️ <b>${verStats.mismatchCount} / ${agg.sessionsCount} 局</b> 是用旧版本 audit 规则跑的（当前 ${escapeHtml(verStats.current)}）；
              下方部分契约可能是<b>旧规则误报</b>。建议点 <b>↻ 强制重跑</b> 用最新规则刷新。
           </div>`
        : '';

    /* v1.62.9：不可 audit 占比 banner —— 老 schema 或太短的局会被排除在健康分外，
     * 必须显式告诉用户"聚合视图代表了多少 auditable 数据"，避免误解。 */
    const unauditableCount = Number(agg.unauditableCount) || 0;
    const auditableCount = Number(agg.auditableCount) ?? (agg.sessionsCount - unauditableCount);
    const unauditableBanner = unauditableCount > 0
        ? `<div style="background:rgba(251,191,36,0.10);border:1px solid #fbbf24;border-radius:8px;padding:8px 12px;margin-bottom:14px;font-size:12px;color:var(--text)">
              ℹ️ ${unauditableCount} 局因 schema 缺失或帧数过少被识别为<b>不可 audit</b>（已自动排除在健康分外），
              真正参与聚合的有 <b>${auditableCount}</b> 局。
           </div>`
        : '';

    root.innerHTML = `
        ${staleBanner}${unauditableBanner}
        <div class="audit-header">
            <div class="audit-score">
                <div class="audit-score-num">${auditableCount}</div>
                <div class="audit-score-lbl">局可分析${unauditableCount > 0 ? `<small style="opacity:.6">（共 ${agg.sessionsCount}）</small>` : ''}</div>
            </div>
            <div class="audit-meta">
                <span><b>${agg.framesTotal}</b> 帧总数</span>
                ${hs ? `<span>健康分 min=<b>${hs.min}</b> p50=<b>${Math.round(hs.p50)}</b> p90=<b>${Math.round(hs.p90)}</b> mean=<b>${hs.mean.toFixed(1)}</b></span>` : ''}
                <span>高违规契约 <b style="color:#f87171">${top.length}</b></span>
                ${verStats ? `<span>引擎版本 <code>${escapeHtml(verStats.current)}</code></span>` : ''}
            </div>
        </div>

        <section class="audit-section">
            <h3>📉 高违规率契约（≥25%，至少 3 局）</h3>
            ${top.length === 0
                ? '<p>✅ 无高违规率契约</p>'
                : `<div class="audit-contract-grid">${top.map((c) => `
                    <div class="audit-contract audit-contract--fail">
                        <div class="audit-contract-head"><code>${escapeHtml(c.id)}</code><span style="margin-left:auto;color:#f87171">违规率 ${(c.violationRate * 100).toFixed(0)}%</span></div>
                        <div class="audit-contract-desc">${escapeHtml(c.desc || '')}</div>
                        <div class="audit-contract-meta"><span>${c.failed} / ${c.appeared} 局失败</span></div>
                    </div>`).join('')}</div>`}
        </section>

        <section class="audit-section">
            <h3>📊 最频繁 hint Top 15</h3>
            <table class="audit-table">
                <thead><tr><th>严重</th><th>code</th><th>出现次数</th></tr></thead>
                <tbody>${hints.slice(0, 15).map((h) => `
                    <tr><td>${sevIcon(h.severity)}</td><td><code>${escapeHtml(h.code)}</code></td><td>×${h.count}</td></tr>`).join('')}
                </tbody>
            </table>
        </section>

        <section class="audit-section">
            <h3>⚖️ stress 主导分量分布</h3>
            <table class="audit-table">
                <thead><tr><th>分量</th><th>局数</th><th>占比</th></tr></thead>
                <tbody>${doms.map((d) => `
                    <tr><td><code>${escapeHtml(d.key)}</code></td><td>${d.count}</td><td>${(d.share * 100).toFixed(0)}%</td></tr>`).join('')}
                </tbody>
            </table>
        </section>

        ${redundantPairs.length > 0 ? `
        <section class="audit-section">
            <h3>🔗 高频冗余指标对（多局都被判 REDUNDANT/CORRELATED）</h3>
            <table class="audit-table">
                <thead><tr><th>指标对</th><th>出现局数</th><th>平均 |r|</th></tr></thead>
                <tbody>${redundantPairs.map((p) => `
                    <tr><td><code>${escapeHtml(p.a)}</code> ↔ <code>${escapeHtml(p.b)}</code></td>
                        <td>${p.count}</td>
                        <td>${p.avgPearson != null ? Math.abs(p.avgPearson).toFixed(2) : '—'}</td></tr>`).join('')}
                </tbody>
            </table>
        </section>` : ''}

        ${verStats && Object.keys(verStats.perVersion).length > 1 ? `
        <section class="audit-section">
            <h3>🔢 引擎版本一致性</h3>
            <table class="audit-table">
                <thead><tr><th>版本</th><th>局数</th><th>说明</th></tr></thead>
                <tbody>${Object.entries(verStats.perVersion).map(([v, n]) => `
                    <tr><td><code>${escapeHtml(v)}</code></td><td>${n}</td>
                        <td>${v === verStats.current ? '✓ 当前' : '⚠️ 过期，建议重跑'}</td></tr>`).join('')}
                </tbody>
            </table>
        </section>` : ''}

        <section class="audit-section">
            <h3>🗂 局明细 (${sessions.length})</h3>
            <table class="audit-table">
                <thead><tr><th>session</th><th>health</th><th>契约 ✓/✗</th><th>hint ❌/⚠️/ℹ️</th><th>更新</th></tr></thead>
                <tbody>${sessions.slice(0, 30).map((s) => `
                    <tr>
                        <td>#${s.sessionId}</td>
                        <td>${s.healthScore}</td>
                        <td>${s.passedContracts}/${s.failedContracts}</td>
                        <td>${s.hintErrors}/${s.hintWarns}/${s.hintInfos}</td>
                        <td>${s.updatedAt ? new Date(s.updatedAt * 1000).toLocaleString() : '—'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </section>
    `;
}

/* ===== 行动：单局 audit ===== */
async function runSingle() {
    const sessionId = $('audit-session').value;
    if (!sessionId) { setStatus('请先选择一个 session'); return; }
    setStatus(`#${sessionId} 拉取 frames…`);
    try {
        const data = await apiFetch(`/api/move-sequence/${sessionId}`);
        const frames = Array.isArray(data?.frames) ? data.frames : [];
        if (frames.length === 0) { setStatus(`#${sessionId} 无 frames 数据`); return; }
        setStatus(`#${sessionId} 计算 audit（${frames.length} 帧）…`);
        const { report } = await runInWorker('audit', { frames });
        renderReport(report, 'audit-single');
        $('audit-upload-btn').dataset.sessionId = sessionId;
        $('audit-upload-btn').dataset.report = JSON.stringify(report);
        $('audit-upload-btn').disabled = false;
        setStatus(`#${sessionId} audit 完成 · 健康分 ${report.healthScore} · hint ${report.hints.length} 条`);
    } catch (e) {
        setStatus(`错误：${e.message || e}`);
    }
}

/* ===== 行动：对照 audit ===== */
async function runComparison() {
    /* v1.62.5 bugfix：对照 tab 的 current 下拉 id 是 `audit-session-cmp`（不是单局 tab 的
     * `audit-session`），优先读 cmp；fallback 到 audit-session 以防 HTML 结构变更。
     * 同样把渲染目标改成 `audit-compare`（对照 tab 内的独立挂载点），避免覆盖单局 tab 的结果。 */
    const sessionId = $('audit-session-cmp')?.value || $('audit-session')?.value;
    const baselineId = $('audit-baseline-session')?.value;
    if (!sessionId || !baselineId) { setStatus('请同时选择 current 和 baseline session'); return; }
    if (sessionId === baselineId) { setStatus('current 与 baseline 不能是同一 session'); return; }
    setStatus(`拉取 #${sessionId} + #${baselineId} 的 frames…`);
    try {
        const [cur, base] = await Promise.all([
            apiFetch(`/api/move-sequence/${sessionId}`),
            apiFetch(`/api/move-sequence/${baselineId}`),
        ]);
        const curFrames = cur?.frames || [];
        const baseFrames = base?.frames || [];
        if (curFrames.length === 0 || baseFrames.length === 0) {
            setStatus('其中一个 session 没有 frames'); return;
        }
        setStatus(`对照 audit 中… (current ${curFrames.length} 帧 vs baseline ${baseFrames.length} 帧)`);
        const { report } = await runInWorker('audit', { frames: curFrames, opts: { baseline: baseFrames } });
        renderReport(report, 'audit-compare-result');
        setStatus(`对照 audit 完成 · 健康分 ${report.healthScore} (baseline ${report.baselineHealthScore})`);
    } catch (e) {
        setStatus(`错误：${e.message || e}`);
    }
}

/* ===== 行动：上传到 SQLite ===== */
async function uploadCurrentReport() {
    const btn = $('audit-upload-btn');
    const sessionId = btn.dataset.sessionId;
    const reportStr = btn.dataset.report;
    if (!sessionId || !reportStr) { setStatus('请先跑一次单局 audit 再上传'); return; }
    setStatus(`上传 #${sessionId} 到 SQLite…`);
    try {
        const userId = getUserId();
        const report = JSON.parse(reportStr);
        await apiFetch(`/api/profile-audit/${sessionId}`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, report }),
        });
        setStatus(`#${sessionId} audit 已上传 ✓`);
    } catch (e) {
        setStatus(`上传失败：${e.message || e}`);
    }
}

/* ===== 行动：从粘贴 JSON 跑 audit ===== */
async function runFromPaste() {
    const ta = $('audit-paste-input');
    const text = (ta?.value || '').trim();
    if (!text) { setStatus('请先在粘贴区粘贴 frames JSON'); return; }
    let frames;
    try {
        const parsed = JSON.parse(text);
        frames = Array.isArray(parsed) ? parsed
            : (parsed && Array.isArray(parsed.frames)) ? parsed.frames
            : null;
        if (!frames) throw new Error('JSON 必须是 frame 数组或 { frames: [...] }');
    } catch (e) {
        setStatus(`JSON 解析失败：${e.message || e}`); return;
    }
    setStatus(`粘贴的 ${frames.length} 帧 → 计算 audit…`);
    try {
        const { report } = await runInWorker('audit', { frames });
        renderReport(report, 'audit-single');
        // 粘贴跑出的报告默认不能上传（没 session_id 绑定）
        const btn = $('audit-upload-btn');
        if (btn) { btn.disabled = true; delete btn.dataset.sessionId; delete btn.dataset.report; }
        setStatus(`✓ 粘贴 audit 完成 · 健康分 ${report.healthScore} · hint ${report.hints.length} 条`);
    } catch (e) {
        setStatus(`错误：${e.message || e}`);
    }
}

/* ===== 行动：载入演示数据 ===== */
function _buildDemoFrames() {
    /* 合成 60 帧"健康对局"：玩家逐步熟练，clearRate 上升，boardFill 在消行时回落。
     * 用于让用户在没有任何真实 session 时立即看到工具的完整输出。 */
    const _ps = (i, score, fill, cleared) => ({
        pv: 2, phase: 'place', score, boardFill: fill,
        skill: 0.5 + i * 0.005, momentum: 0.05 + (cleared ? 0.05 : -0.02),
        flowDeviation: 0.15 + 0.005 * (i % 8), flowState: 'flow',
        frustration: cleared ? 0 : Math.min(5, (i % 7)),
        cognitiveLoad: 0.25 + 0.003 * i,
        feedbackBias: 0.01 + (i % 5) * 0.002,
        metrics: {
            samples: 5 + i, activeSamples: 5 + i,
            thinkMs: 1400 + (i % 5) * 120,
            pickToPlaceMs: 1100 + (i % 4) * 80,
            reactionSamples: 5 + i,
            clearRate: 0.4 + (cleared ? 0.12 : -0.04) + i * 0.003,
            comboRate: 0.18 + (cleared ? 0.04 : 0),
            missRate: Math.max(0.02, 0.08 - i * 0.001),
        },
        spawnGeo: { holes: cleared ? 0 : (i % 4 > 1 ? 1 : 0), flatness: 0.85, firstMoveFreedom: 14, solutionCount: 70 },
        adaptive: {
            stress: 0.32 + (i % 6) * 0.02,
            flowDeviation: 0.15 + 0.005 * (i % 8),
            spawnHints: { spawnIntent: i % 10 < 6 ? 'flow' : 'pressure' },
            stressBreakdown: {
                difficultyBias: 0.20,
                flowAdjust: 0.05 + (i % 4) * 0.01,
                reactionAdjust: 0.005,
                pacingAdjust: 0.02,
                friendlyBoardRelief: cleared ? -0.04 : -0.01,
                sessionArcAdjust: -0.04 + (i / 60) * 0.10,
                challengeBoost: 0.02 + (i / 60) * 0.04,
            },
        },
    });
    const frames = [{
        v: 2, t: 'init', ts: 0, strategy: 'normal',
        grid: { size: 8, cells: Array.from({ length: 8 }, () => Array(8).fill(null)) },
        scoring: { singleLine: 20, multiLine: 60, combo: 120 },
        ps: _ps(0, 0, 0, false),
    }];
    let score = 0;
    let fill = 0;
    for (let i = 0; i < 60; i++) {
        const cleared = i % 3 === 0;
        score += cleared ? 25 : 6;
        fill = Math.max(0, Math.min(0.95, fill + 0.014 - (cleared ? 0.08 : 0)));
        const ts = (i + 1) * 1500;
        frames.push({ v: 2, t: 'spawn', ts: ts - 50, dock: [], ps: _ps(i + 1, score, fill, cleared) });
        frames.push({ v: 2, t: 'place', ts, i: 0, x: i % 8, y: (i * 3) % 8, ps: _ps(i + 1, score, fill, cleared) });
    }
    return frames;
}

async function runDemo() {
    const frames = _buildDemoFrames();
    setStatus(`🧪 演示数据 ${frames.length} 帧 → 计算 audit…`);
    try {
        const { report } = await runInWorker('audit', { frames });
        renderReport(report, 'audit-single');
        const btn = $('audit-upload-btn');
        if (btn) { btn.disabled = true; delete btn.dataset.sessionId; delete btn.dataset.report; }
        setStatus(`✓ 演示数据 audit 完成 · 健康分 ${report.healthScore} · hint ${report.hints.length} 条（仅演示，不可上传）`);
    } catch (e) {
        setStatus(`演示运行失败：${e.message || e}`);
    }
}

/* ===== 行动：拉聚合视图 ===== */
async function refreshAggregate() {
    const days = Number($('audit-days').value || 7);
    setStatus(`拉取近 ${days} 天 audit 聚合…`);
    try {
        const uid = _currentTargetUserId();
        const qs = new URLSearchParams({ days: String(days) });
        if (uid) qs.set('user_id', uid);
        const agg = await apiFetch(`/api/profile-audit/recent?${qs}`);
        renderAggregate(agg, 'audit-aggregate');
        if (agg.sessionsCount === 0) {
            setStatus(`ℹ️ 近 ${days} 天没有已上传的 audit 报告——点"一键自动巡检"批量跑`);
        } else {
            setStatus(`✓ 聚合完成：${agg.sessionsCount} 局 / ${agg.framesTotal} 帧 · 点"一键自动巡检"获取优化建议`);
        }
        /* 同时拉一次 actions 渲染（基于现有聚合数据） */
        const { actions } = await runInWorker('summarize-actions', { aggregate: agg });
        renderActions(actions, 'audit-actions');
    } catch (e) {
        setStatus(`聚合失败：${e.message || e}`);
    }
}

/**
 * 一键自动巡检：扫候选 → 逐局 audit → 上传 → 聚合 → 翻译为可执行 actions。
 *
 * 与 cron/CLI 路径同款逻辑，但全程在浏览器内完成（Worker 跑 audit、主线程协调网络）。
 * 进度通过 setStatus 持续刷新，让用户感知"还在跑、跑到几分之几、最终几条 action"。
 *
 * 流程：
 *   1. GET /api/profile-audit/sessions          拿候选元数据（hasAudit 标记）
 *   2. 跳过 hasAudit=true（除非 force）
 *   3. 对每个未 audit 的 GET /api/move-sequence/<id> → Worker 跑 audit → POST 上传
 *   4. GET /api/profile-audit/recent             重新拉聚合
 *   5. Worker 跑 summarizeOptimizationActions     翻译为 actions
 *   6. renderAggregate + renderActions           渲染到聚合 tab
 */
async function runAutoAudit({ force = false } = {}) {
    const days = Number($('audit-days').value || 7);
    const uid = _currentTargetUserId();
    /* v1.62.9：limit 跟随用户视图调整 ——
     *   - 选某个具体 user：上限 500（单用户少有人玩超过 500 局/月）
     *   - 选「🌐 全库」：上限 5000（admin 模式 server.py 已解除 500 上限到 10000）
     * 注意 server.py 端权限：DB_DEBUG=1 时 500→10000；普通用户仍 500 兜底。 */
    const limit = uid ? 500 : 5000;
    const scopeLabel = uid ? `user=${uid.slice(0, 8)}…` : '🌐 全库所有用户';
    setStatus(`🤖 一键巡检启动…扫近 ${days} 天 ${scopeLabel}（上限 ${limit} 局）`);
    try {
        const qs = new URLSearchParams({ limit: String(limit), days: String(days) });
        if (uid) qs.set('user_id', uid);
        const candidates = await apiFetch(`/api/profile-audit/sessions?${qs}`);
        if (!Array.isArray(candidates) || candidates.length === 0) {
            setStatus(`ℹ️ 近 ${days} 天 ${scopeLabel} 没有 session 可以巡检`);
            return;
        }
        /* 重跑策略：
         *   - force=true：所有候选都重跑（用户主动点"↻ 强制重跑"）
         *   - 否则：只跑 hasAudit=false 的；hasAudit=true 但版本过期的不自动重跑
         *
         * 选择不自动重跑过期版本的原因：
         *   1. 检测过期需要 GET 每条 report 拿 engineVersion，N 次请求拖慢交互；
         *   2. 现在 aggregate.engineVersionStats 会触发 STALE_AUDIT_REPORTS action（P1），
         *      让用户在结果里清晰看到"X 局是旧规则"，决定是否点"强制重跑"，更可控。 */
        const pending = force ? candidates : candidates.filter((c) => !c.hasAudit);
        if (pending.length === 0) {
            setStatus(`ℹ️ 所有 ${candidates.length} 个 session 都已 audit 过；如果 audit 工具有升级，点 "↻ 强制重跑" 用最新规则刷新`);
        } else {
            setStatus(`🔄 ${pending.length}/${candidates.length} 个 session 待 audit（已跳过 ${candidates.length - pending.length} 个已存档）`);
        }

        let succeeded = 0;
        let failed = 0;
        let unauditable = 0;
        const startTs = Date.now();
        const tick = pending.length > 50 ? 10 : 5;   // 进度刷新粒度
        /* v1.62.9：批量场景（全库）通常 500-5000 局，给个 ETA 让用户知道还要多久。 */
        for (let i = 0; i < pending.length; i++) {
            const c = pending[i];
            if (i === 0 || i === pending.length - 1 || (i + 1) % tick === 0) {
                const done = i + 1;
                const elapsed = (Date.now() - startTs) / 1000;
                const eta = done > 0 && i < pending.length - 1
                    ? Math.round(elapsed * (pending.length - done) / done)
                    : 0;
                setStatus(
                    `🔄 巡检中 [${done}/${pending.length}] #${c.sessionId}`
                    + ` · ✓${succeeded} ✗${failed} ⚠${unauditable}`
                    + (eta > 0 ? ` · 预计还需 ${eta}s` : '')
                );
            }
            try {
                const data = await apiFetch(`/api/move-sequence/${c.sessionId}`);
                const frames = Array.isArray(data?.frames) ? data.frames : [];
                if (frames.length === 0) { failed++; continue; }
                const { report } = await runInWorker('audit', { frames });
                if (report.healthScore === null) unauditable++;
                await apiFetch(`/api/profile-audit/${c.sessionId}`, {
                    method: 'POST',
                    body: JSON.stringify({ user_id: c.userId || uid, report }),
                });
                succeeded++;
            } catch (e) {
                failed++;
                console.warn(`#${c.sessionId} audit 失败:`, e);
            }
            /* 每 20 条让浏览器主线程喘口气，避免长时间冻结 UI */
            if ((i + 1) % 20 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        setStatus(`🔄 拉取聚合数据…（新增 ${succeeded}，失败 ${failed}）`);
        const aggQs = new URLSearchParams({ days: String(days) });
        if (uid) aggQs.set('user_id', uid);
        const agg = await apiFetch(`/api/profile-audit/recent?${aggQs}`);
        renderAggregate(agg, 'audit-aggregate');

        setStatus(`🔄 生成优化建议清单…`);
        const { actions } = await runInWorker('summarize-actions', { aggregate: agg });
        renderActions(actions, 'audit-actions');

        const p1 = actions.filter((a) => a.priority === 1).length;
        const total = actions.length;
        const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
        setStatus(
            `✓ 巡检完成（${elapsed}s）：新增 ${succeeded}（含 ⚠${unauditable} 不可 audit），失败 ${failed}；` +
            `聚合 ${agg.sessionsCount} 局；优化建议 ${total} 项${p1 > 0 ? `（其中 P1 高优先级 ${p1} 项 🔴）` : ''}`
        );
    } catch (e) {
        setStatus(`巡检失败：${e.message || e}`);
    }
}

/**
 * 渲染优化建议 actions 清单（按 P1→P5 分组，可展开 root cause + suggested actions）。
 *
 * 与服务端 cron 输出的 Markdown 报告同款语义，只是改成 DOM 渲染。
 */
function renderActions(actions, mountId) {
    const root = $(mountId);
    if (!root) return;
    if (!Array.isArray(actions) || actions.length === 0) {
        root.innerHTML = '<section class="audit-section"><h3>🛠 优化建议</h3>'
            + '<p>🎉 暂无需要优化的项——当前所有契约通过率良好</p></section>';
        return;
    }
    const PRIO_LABEL = {
        1: { tag: '🔴 P1', desc: '高优先级 · 建议立即处理' },
        2: { tag: '🟠 P2', desc: '中优先级' },
        3: { tag: '🟡 P3', desc: '中低优先级' },
        4: { tag: '🟢 P4', desc: '低优先级' },
        5: { tag: 'ℹ️ P5', desc: '提示' },
    };
    const EFFORT_LABEL = { low: '工作量·低', medium: '工作量·中', high: '工作量·高' };

    // 按优先级分组
    const groups = new Map();
    for (const a of actions) {
        if (!groups.has(a.priority)) groups.set(a.priority, []);
        groups.get(a.priority).push(a);
    }
    const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);

    let html = `<section class="audit-section"><h3>🛠 优化建议（共 ${actions.length} 项）</h3>`;
    for (const [prio, items] of ordered) {
        const meta = PRIO_LABEL[prio] || { tag: `P${prio}`, desc: '' };
        html += `<div class="audit-actions-group audit-actions-group--p${prio}">`;
        html += `<div class="audit-actions-group-head"><span class="audit-actions-prio">${meta.tag}</span><span class="audit-actions-prio-desc">${escapeHtml(meta.desc)} (${items.length})</span></div>`;
        for (const a of items) {
            const affected = (a.affected || []).map((x) => `<code>${escapeHtml(x)}</code>`).join(' ');
            const roots = (a.rootCauseHints || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
            const steps = (a.suggestedActions || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
            html += `<details class="audit-action audit-action--p${prio}">`;
            html += `<summary class="audit-action-head">`;
            html += `<span class="audit-action-title">${escapeHtml(a.title)}</span>`;
            html += `<span class="audit-action-meta"><code>${escapeHtml(a.code)}</code> · <code>${escapeHtml(a.category)}</code> · ${escapeHtml(EFFORT_LABEL[a.effort] || a.effort || '')}</span>`;
            html += `</summary>`;
            html += `<div class="audit-action-body">`;
            html += `<div class="audit-action-row"><b>证据</b> ${escapeHtml(a.evidence || '')}</div>`;
            if (affected) html += `<div class="audit-action-row"><b>涉及</b> ${affected}</div>`;
            html += `<div class="audit-action-row"><b>预期收益</b> ${escapeHtml(a.expectedBenefit || '')}</div>`;
            if (roots) html += `<div class="audit-action-row"><b>可能根因</b><ul>${roots}</ul></div>`;
            if (steps) html += `<div class="audit-action-row"><b>建议动作</b><ul>${steps}</ul></div>`;
            html += `</div></details>`;
        }
        html += `</div>`;
    }
    html += `</section>`;
    root.innerHTML = html;
}

/* ===== Tab 切换 ===== */
function bindTabs() {
    const tabs = document.querySelectorAll('[data-tab]');
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            tabs.forEach((t) => t.classList.toggle('active', t === tab));
            const target = tab.dataset.tab;
            ['single', 'compare', 'aggregate'].forEach((name) => {
                const el = $(`tab-${name}`);
                if (el) el.hidden = name !== target;
            });
        });
    });
}

/* ===== 入口 ===== */
export function initProfileAuditApp() {
    bindTabs();
    populateSessionSelects();
    $('audit-run-btn')?.addEventListener('click', () => runSingle());
    $('audit-compare-btn')?.addEventListener('click', () => runComparison());
    $('audit-upload-btn')?.addEventListener('click', () => uploadCurrentReport());
    $('audit-aggregate-btn')?.addEventListener('click', () => refreshAggregate());
    $('audit-auto-btn')?.addEventListener('click', () => runAutoAudit({ force: false }));
    $('audit-auto-force-btn')?.addEventListener('click', () => runAutoAudit({ force: true }));
    $('audit-reload-sessions')?.addEventListener('click', () => {
        _cachedSessions = null;
        _usersPopulated = false;   // 同时刷新 user 下拉（admin 下可能有新用户加入）
        populateSessionSelects();
    });
    $('audit-paste-run-btn')?.addEventListener('click', () => runFromPaste());
    $('audit-demo-btn')?.addEventListener('click', () => runDemo());

    /* user 下拉切换：change 时让 session 缓存失效 + 重新拉。
     * （populateUsersSelect 已经初始化过，这里只走 session 部分。） */
    const uidSel = $('audit-user-id');
    if (uidSel) {
        uidSel.addEventListener('change', async () => {
            _cachedSessions = null;
            // 只重拉 session，不要重新填 user 下拉（否则会丢失当前选中）
            let sessions = [];
            let err = null;
            try { sessions = await loadSessions(); } catch (e) { err = e; }
            const html = '<option value="">— 选择 session —</option>'
                + sessions.map(renderSessionOption).join('');
            for (const id of ['audit-session', 'audit-baseline-session']) {
                const sel = $(id);
                if (sel) sel.innerHTML = html;
            }
            const audited = sessions.filter((s) => s.hasAudit).length;
            const uid = _currentTargetUserId();
            const subject = uid ? `user ${uid.slice(0, 16)}` : '🌐 全库';
            if (err) {
                setStatus(`⚠️ 切换失败：${err.message || err}`);
            } else if (sessions.length === 0) {
                setStatus(`ℹ️ ${subject} 暂无 session`);
            } else {
                setStatus(`✓ 已切到 ${subject} · ${sessions.length} 个 session（${audited} 已 audit）`);
            }
        });
    }
}
