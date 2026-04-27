/**
 * 商业化模型训练面板（OPT-09 MonPanel）
 *
 * 职责：
 *   - 展示全局商业化聚合指标（DAU、分群分布、行为热图）
 *   - 提供个性化模型参数调整界面（分群权重、广告/IAP 触发阈值）
 *   - 提供 Feature Flag 实时开关（无需刷新）
 *   - 展示今日商业化策略曝光统计（策略日志摘要）
 *
 * 挂载方式（非侵入）：
 *   initMonPanel() 在页面注入一个浮动面板按钮（右下角）。
 *   点击按钮后展开/收起全屏面板。所有 DOM 动态创建，不修改 index.html。
 *
 * 依赖：
 *   - /api/mon/aggregate
 *   - /api/mon/model/config
 *   - /api/mon/user-profile/<userId>
 *   - featureFlags.js（getAllFlags / setFlag）
 *   - config.js（getApiBaseUrl）
 */

import { getApiBaseUrl } from '../config.js';
import { getAllFlags, setFlag, FLAG_DEFAULTS } from './featureFlags.js';
import { fetchPersonaFromServer, getCommercialInsight } from './personalization.js';
import { getHelpText, helpAttrs } from './strategy/index.js';

/** 把帮助文本转成 HTML 属性可用字符串 */
function _hAttr(key) {
    const t = getHelpText(key);
    return t ? `class="mon-help" title="${t.replace(/"/g, '&quot;')}" data-help-key="${key}"` : '';
}

const PANEL_ID  = 'mon-training-panel';
const BTN_ID    = 'mon-panel-toggle-btn';
const STYLE_ID  = 'mon-panel-styles';

// ─── 样式注入 ──────────────────────────────────────────────────────────────────

function _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    /* 复用玩家画像面板设计语言：系统字体、CSS 变量、亮色毛玻璃、紧凑字号 */
    style.textContent = `
/* ── 商业化策略面板内嵌设置图标按钮 ── */
.insight-mon-panel-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 5px;
    border: 1px solid color-mix(in srgb, var(--accent-color, #5B9BD5) 35%, transparent);
    background: color-mix(in srgb, var(--accent-color, #5B9BD5) 12%, transparent);
    color: var(--accent-color, #5B9BD5);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition: background .15s, transform .2s;
    font-family: inherit;
}
.insight-mon-panel-btn:hover {
    background: color-mix(in srgb, var(--accent-color, #5B9BD5) 22%, transparent);
    transform: rotate(45deg);
}

/* ── 遮罩层 ── */
#${PANEL_ID} {
    position: fixed; inset: 0; z-index: 9999;
    background: color-mix(in srgb, var(--text-primary, #1e293b) 28%, transparent);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none;
    transition: opacity .18s;
}
#${PANEL_ID}.mp-open { opacity: 1; pointer-events: all; }

/* ── 面板主体：复用 side-panel-base 语言 ── */
.mp-box {
    background: color-mix(in srgb, var(--stat-surface, #ffffff) 92%, var(--bg-color, #e8eef1));
    border: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 8%, transparent);
    border-radius: var(--border-radius, 8px);
    box-shadow:
        0 2px 0 color-mix(in srgb, #ffffff 55%, transparent) inset,
        0 10px 36px color-mix(in srgb, var(--shadow, rgba(44,62,80,.15)) 55%, transparent);
    backdrop-filter: saturate(1.06) blur(10px);
    -webkit-backdrop-filter: saturate(1.06) blur(10px);
    width: min(720px, 95vw); max-height: 86vh;
    overflow-y: auto; padding: 12px 14px 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 9.5px;
    line-height: 1.35;
    color: var(--text-primary, #1e293b);
}
/* 复用 player-insight-title */
.mp-box h2 {
    font-size: 11px; font-weight: 700; margin: 0 0 10px;
    color: var(--accent-color, #5B9BD5);
    display: flex; align-items: center; gap: 5px;
}
/* 复用 panel-section-head 的章节分隔 */
.mp-box h3 {
    font-size: 8px; font-weight: 600;
    color: var(--text-secondary, #475569);
    text-transform: uppercase; letter-spacing: .05em;
    margin: 12px 0 5px; padding-bottom: 3px;
    border-bottom: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 8%, transparent);
}
.mp-close {
    margin-left: auto; background: none; border: none;
    color: var(--text-secondary, #6b7c8c); font-size: 14px; cursor: pointer; padding: 0;
}
.mp-close:hover { color: var(--text-primary, #1e293b); }

/* ── KPI 卡片：复用 .insight-metric pill ── */
.mp-kpis { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }
.mp-kpi {
    flex: 1 1 100px;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 6px 8px;
    background: color-mix(in srgb, var(--text-primary, #4a5f73) 7%, transparent);
    border: 1px solid color-mix(in srgb, var(--text-primary, #4a5f73) 12%, transparent);
    border-radius: 4px;
}
.mp-kpi-val {
    font-size: 16px; font-weight: 700;
    color: var(--accent-dark, #4472C4);
    line-height: 1.1;
}
.mp-kpi-label {
    font-size: 8px; margin-top: 3px;
    color: var(--text-secondary, #3d5266);
    opacity: 0.9;
}

/* ── 分群分布条 ── */
.mp-seg-bar {
    display: flex; height: 14px; border-radius: 4px; overflow: hidden;
    margin-bottom: 5px;
    border: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 8%, transparent);
}
.mp-seg-whale   { background: #e67e22; }
.mp-seg-dolphin { background: var(--accent-color, #5B9BD5); }
.mp-seg-minnow  { background: color-mix(in srgb, var(--text-primary, #4a5f73) 30%, transparent); }
.mp-seg-legend { display: flex; gap: 10px; font-size: 8.5px; color: var(--text-secondary, #5d7a96); }
.mp-seg-legend span::before { content: '●'; margin-right: 3px; }
.mp-seg-legend .sl-whale   { color: #e67e22; }
.mp-seg-legend .sl-dolphin { color: var(--accent-color, #5B9BD5); }
.mp-seg-legend .sl-minnow  { color: var(--text-secondary, #8a9bab); }

/* ── 行为热图 ── */
.mp-beh-row {
    display: flex; align-items: center; gap: 6px;
    margin-bottom: 3px; font-size: 8.5px;
}
.mp-beh-bar-wrap {
    flex: 1;
    background: color-mix(in srgb, var(--text-primary, #4a5f73) 7%, transparent);
    border-radius: 3px; height: 8px; overflow: hidden;
}
.mp-beh-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-color, #5B9BD5), var(--accent-dark, #4472C4));
    border-radius: 3px; transition: width .4s;
}
.mp-beh-cnt { width: 44px; text-align: right; color: var(--text-secondary, #8a9bab); }
.mp-beh-name { width: 96px; color: var(--text-primary, #1e293b); }

/* ── Feature Flag 开关网格 ── */
.mp-flags { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.mp-flag-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 5px 8px;
    background: color-mix(in srgb, var(--text-primary, #4a5f73) 5%, transparent);
    border: 1px solid color-mix(in srgb, var(--text-primary, #4a5f73) 10%, transparent);
    border-radius: 4px;
}
.mp-flag-key {
    font-size: 8.5px;
    color: var(--text-primary, #1e293b);
}
/* 开关 */
.mp-flag-toggle { position: relative; display: inline-block; width: 28px; height: 16px; }
.mp-flag-toggle input { opacity: 0; width: 0; height: 0; }
.mp-flag-slider {
    position: absolute; inset: 0;
    background: color-mix(in srgb, var(--text-primary, #1e293b) 18%, transparent);
    border-radius: 16px; cursor: pointer; transition: background .18s;
}
.mp-flag-slider::before {
    content: ''; position: absolute;
    width: 10px; height: 10px; left: 3px; bottom: 3px;
    background: #fff; border-radius: 50%; transition: transform .18s;
    box-shadow: 0 1px 3px rgba(0,0,0,.2);
}
.mp-flag-toggle input:checked + .mp-flag-slider {
    background: var(--accent-color, #5B9BD5);
}
.mp-flag-toggle input:checked + .mp-flag-slider::before { transform: translateX(12px); }

/* ── 模型参数表单 ── */
.mp-cfg-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mp-cfg-field { display: flex; flex-direction: column; gap: 3px; }
.mp-cfg-field label {
    font-size: 8.5px;
    color: var(--text-secondary, #475569);
}
.mp-cfg-field input[type=range] {
    width: 100%;
    accent-color: var(--accent-color, #5B9BD5);
    cursor: pointer;
}
.mp-cfg-field .mp-cfg-val {
    font-size: 9px; font-weight: 700;
    color: var(--accent-dark, #4472C4);
}
.mp-cfg-save {
    margin-top: 8px; padding: 4px 14px;
    background: var(--accent-color, #5B9BD5);
    color: #fff; border: none;
    border-radius: var(--border-radius, 6px);
    cursor: pointer; font-size: 9px; font-weight: 600;
    transition: filter .15s;
}
.mp-cfg-save:hover { filter: brightness(1.08); }

/* ── 用户画像 ── */
.mp-persona {
    padding: 8px;
    background: color-mix(in srgb, var(--text-primary, #4a5f73) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--text-primary, #4a5f73) 10%, transparent);
    border-radius: 4px;
}
.mp-persona-seg {
    font-size: 13px; font-weight: 700;
    color: var(--accent-dark, #4472C4);
    margin-bottom: 6px;
}
.mp-actions { display: flex; flex-direction: column; }
/* 复用 strategy-tip 布局 */
.mp-action-row {
    display: flex; align-items: flex-start; gap: 6px;
    padding: 4px 0;
    border-top: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 6%, transparent);
    font-size: 9px;
}
.mp-action-row:first-child { border-top: none; }
.mp-action-row.mp-active .mp-action-icon { color: #e67e22; }
.mp-action-icon { font-size: 11px; line-height: 1; margin-top: 1px; flex-shrink: 0; }
.mp-action-desc {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 2px;
    color: var(--text-primary, #1e293b);
}
.mp-action-desc > div { font-size: 9px; }
.mp-action-desc strong { font-weight: 700; color: var(--text-primary, #1e293b); margin-right: 3px; }
.mp-action-priority {
    font-size: 8px; color: var(--text-secondary, #8a9bab);
    flex-shrink: 0;
}

/* ── 加载提示 ── */
.mp-loading {
    font-size: 9px;
    color: var(--text-secondary, #8a9bab);
    font-style: italic;
    text-align: center;
    padding: 12px 0;
    opacity: 0.7;
}

/* ── 标签页：复用 panel-section 分隔风格 ── */
.mp-tabs {
    display: flex; gap: 1px;
    margin-bottom: 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 10%, transparent);
    padding-bottom: 4px;
}
.mp-tab {
    padding: 3px 10px; border-radius: 4px 4px 0 0; cursor: pointer;
    font-size: 9px; font-weight: 600; font-family: inherit;
    color: var(--text-secondary, #5d7a96);
    background: none; border: none;
    transition: background .12s, color .12s;
}
.mp-tab:hover {
    background: color-mix(in srgb, var(--text-primary, #1e293b) 5%, transparent);
    color: var(--text-primary, #1e293b);
}
.mp-tab.mp-tab-active {
    background: color-mix(in srgb, var(--accent-color, #5B9BD5) 12%, transparent);
    color: var(--accent-dark, #4472C4);
}
.mp-tab-content { display: none; }
.mp-tab-content.mp-tab-visible {
    display: block;
    animation: panelSlideDown 0.15s ease;
}
`;
    document.head.appendChild(style);
}

// ─── API 工具 ──────────────────────────────────────────────────────────────────

function _apiBase() {
    return getApiBaseUrl().replace(/\/+$/, '');
}

async function _getJson(path) {
    try {
        const res = await fetch(`${_apiBase()}${path}`);
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

async function _putJson(path, body) {
    try {
        const res = await fetch(`${_apiBase()}${path}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

// ─── 面板渲染 ──────────────────────────────────────────────────────────────────

let _activeTab = 'overview';

function _createPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
<div class="mp-box">
  <h2 ${_hAttr('panel.entry')}>
    <span>📊 商业化模型训练面板</span>
    <button class="mp-close" id="mp-close-btn" title="关闭">×</button>
  </h2>
  <div class="mp-tabs">
    <button class="mp-tab mp-tab-active" data-tab="overview"
            title="全局聚合指标：DAU、分群分布、行为热图">总览</button>
    <button class="mp-tab" data-tab="persona"
            title="当前用户的分群画像、信号格、推荐策略卡">用户画像</button>
    <button class="mp-tab" data-tab="config"
            title="分群权重、广告/IAP 阈值的实时调整">模型配置</button>
    <button class="mp-tab" data-tab="flags"
            title="所有 Feature Flag 的开关，实时生效">功能开关</button>
  </div>
  <div id="mp-tab-overview" class="mp-tab-content mp-tab-visible">
    <p class="mp-loading">加载中…</p>
  </div>
  <div id="mp-tab-persona" class="mp-tab-content">
    <p class="mp-loading">加载中…</p>
  </div>
  <div id="mp-tab-config" class="mp-tab-content">
    <p class="mp-loading">加载中…</p>
  </div>
  <div id="mp-tab-flags" class="mp-tab-content">
    <p class="mp-loading">加载中…</p>
  </div>
</div>`;

    panel.addEventListener('click', e => {
        if (e.target === panel || e.target.id === 'mp-close-btn') _closePanel();
    });

    panel.querySelectorAll('.mp-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeTab = btn.dataset.tab;
            panel.querySelectorAll('.mp-tab').forEach(b => b.classList.remove('mp-tab-active'));
            panel.querySelectorAll('.mp-tab-content').forEach(c => c.classList.remove('mp-tab-visible'));
            btn.classList.add('mp-tab-active');
            panel.querySelector(`#mp-tab-${_activeTab}`)?.classList.add('mp-tab-visible');
        });
    });

    document.body.appendChild(panel);
    return panel;
}

async function _renderOverview(panel) {
    const el = panel.querySelector('#mp-tab-overview');
    if (!el) return;
    el.innerHTML = '<p class="mp-loading">正在拉取聚合数据…</p>';
    const data = await _getJson('/api/mon/aggregate');
    if (!data) {
        el.innerHTML = '<p class="mp-loading">后端聚合接口暂不可用</p>';
        return;
    }

    const seg = data.segment_dist ?? {};
    const total_seg = (seg.whale ?? 0) + (seg.dolphin ?? 0) + (seg.minnow ?? 0) || 1;
    const pct = v => ((v ?? 0) / total_seg * 100).toFixed(1);

    const behRows = (data.behavior_dist ?? []).slice(0, 8).map(b => {
        const maxCnt = (data.behavior_dist[0]?.count ?? 1);
        const w = Math.round(b.count / maxCnt * 100);
        return `<div class="mp-beh-row">
  <span class="mp-beh-name">${b.event}</span>
  <div class="mp-beh-bar-wrap"><div class="mp-beh-bar" style="width:${w}%"></div></div>
  <span class="mp-beh-cnt">${b.count.toLocaleString()}</span>
</div>`;
    }).join('');

    el.innerHTML = `
<div class="mp-kpis">
  <div class="mp-kpi" ${_hAttr('kpi.total_users')}><div class="mp-kpi-val">${data.total_users ?? 0}</div><div class="mp-kpi-label">注册用户</div></div>
  <div class="mp-kpi" ${_hAttr('kpi.dau_7d')}><div class="mp-kpi-val">${data.dau_7d ?? 0}</div><div class="mp-kpi-label">7 日活跃</div></div>
  <div class="mp-kpi" ${_hAttr('kpi.games_7d')}><div class="mp-kpi-val">${data.games_7d ?? 0}</div><div class="mp-kpi-label">7 日局数</div></div>
  <div class="mp-kpi" ${_hAttr('kpi.avg_score_30d')}><div class="mp-kpi-val">${Math.round(data.avg_score_30d ?? 0)}</div><div class="mp-kpi-label">30 日均分</div></div>
  <div class="mp-kpi" ${_hAttr('kpi.avg_session_30d')}><div class="mp-kpi-val">${Math.round((data.avg_session_sec_30d ?? 0) / 60)}min</div><div class="mp-kpi-label">30 日均时长</div></div>
  <div class="mp-kpi" ${_hAttr('kpi.lb_participants')}><div class="mp-kpi-val">${data.lb_participants_today ?? 0}</div><div class="mp-kpi-label">今日榜参与</div></div>
</div>

<h3>用户分群分布</h3>
<div class="mp-seg-bar">
  <div class="mp-seg-whale mon-help"   style="width:${pct(seg.whale)}%"   title="Whale ${pct(seg.whale)}% — ${_attrEsc(getHelpText('segment.whale'))}"></div>
  <div class="mp-seg-dolphin mon-help" style="width:${pct(seg.dolphin)}%" title="Dolphin ${pct(seg.dolphin)}% — ${_attrEsc(getHelpText('segment.dolphin'))}"></div>
  <div class="mp-seg-minnow mon-help"  style="width:${pct(seg.minnow)}%"  title="Minnow ${pct(seg.minnow)}% — ${_attrEsc(getHelpText('segment.minnow'))}"></div>
</div>
<div class="mp-seg-legend">
  <span class="sl-whale mon-help" title="${_attrEsc(getHelpText('segment.whale'))}">🐋 Whale ${seg.whale ?? 0} 人 (${pct(seg.whale)}%)</span>
  <span class="sl-dolphin mon-help" title="${_attrEsc(getHelpText('segment.dolphin'))}">🐬 Dolphin ${seg.dolphin ?? 0} 人 (${pct(seg.dolphin)}%)</span>
  <span class="sl-minnow mon-help" title="${_attrEsc(getHelpText('segment.minnow'))}">🐟 Minnow ${seg.minnow ?? 0} 人 (${pct(seg.minnow)}%)</span>
</div>

<h3>行为事件分布（近 7 日）</h3>
${behRows || '<p class="mp-loading">暂无行为数据</p>'}`;
}

function _attrEsc(s) {
    return String(s ?? '').replace(/"/g, '&quot;');
}

async function _renderPersona(panel, game) {
    const el = panel.querySelector('#mp-tab-persona');
    if (!el) return;
    el.innerHTML = '<p class="mp-loading">正在分析个人画像…</p>';

    // 用 game.db 拿 userId
    const userId = game?.db?.userId ?? game?.userId ?? null;
    if (userId) {
        await fetchPersonaFromServer(userId, true);
    }

    const insight = getCommercialInsight();
    const { segment, segmentLabel, segmentColor, segmentIcon, signals, actions, explain } = insight;

    const sigHtml = signals.map(s => {
        const tip = (s.tooltip ?? s.sub ?? '').replace(/"/g, '&quot;');
        return `<div class="ci-signal-row" title="${tip}">` +
            `<span class="ci-signal-label">${s.label}</span>` +
            `<span class="ci-signal-value" style="color:${s.color}">${s.value}</span>` +
            `</div>`;
    }).join('');

    const actHtml = actions.length
        ? actions.map(a => `
<div class="mp-action-row ${a.active ? 'mp-active' : ''}">
  <span class="mp-action-icon">${a.icon}</span>
  <div class="mp-action-desc">
    <div><strong>${a.label}</strong>${a.product ? ' — ' + a.product : ''}${a.active ? '<span class="ci-action-live"> ⚡ 触发中</span>' : ''}</div>
    ${a.why    ? `<span class="ci-action-why">${a.why}</span>`    : ''}
    ${a.effect ? `<span class="ci-action-effect">${a.effect}</span>` : ''}
  </div>
  <span class="mp-action-priority">${a.priority ?? ''}</span>
</div>`).join('')
        : '<p class="mp-loading">暂无推荐策略</p>';

    const whyHtml = (insight.whyLines ?? []).length > 0
        ? `<ul class="ci-why-list">${insight.whyLines.map(l => `<li>${l}</li>`).join('')}</ul>`
        : '';

    el.innerHTML = `
<div class="mp-persona">
  <div class="mp-persona-seg">${segmentIcon} ${segmentLabel}</div>
  <div class="ci-signals" style="margin-bottom:0">${sigHtml}</div>
</div>
<h3>当前推荐策略</h3>
<div class="mp-actions">${actHtml}</div>
${whyHtml}`;
}

async function _renderConfig(panel) {
    const el = panel.querySelector('#mp-tab-config');
    if (!el) return;
    el.innerHTML = '<p class="mp-loading">加载模型配置…</p>';

    const cfg = await _getJson('/api/mon/model/config');
    if (!cfg) {
        el.innerHTML = '<p class="mp-loading">配置接口不可用</p>';
        return;
    }

    const sw = cfg.segmentWeights ?? {};
    const ad = cfg.adTrigger ?? {};
    const iapCfg = cfg.iapTrigger ?? {};

    /**
     * 渲染一个滑块字段；helpKey 自动注入 cursor:help + 详细 tooltip。
     */
    function rangeField(id, label, val, min, max, step, helpKey) {
        const v = Number(val ?? 0);
        const helpAttr = helpKey ? _hAttr(helpKey) : '';
        return `
<div class="mp-cfg-field" ${helpAttr}>
  <label>${label}</label>
  <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"
         oninput="this.nextElementSibling.textContent=this.value">
  <span class="mp-cfg-val">${v}</span>
</div>`;
    }

    el.innerHTML = `
<h3>分群权重（总和应 ≤ 1）</h3>
<div class="mp-cfg-form">
  ${rangeField('cfg-w0','最高分权重 w0', sw.best_score_norm,   0, 1, 0.05, 'weight.best_score_norm')}
  ${rangeField('cfg-w1','总局数权重 w1', sw.total_games_norm,  0, 1, 0.05, 'weight.total_games_norm')}
  ${rangeField('cfg-w2','时长权重 w2',   sw.session_time_norm, 0, 1, 0.05, 'weight.session_time_norm')}
</div>
<h3>广告触发配置</h3>
<div class="mp-cfg-form">
  ${rangeField('cfg-frust','挫败感阈值（次）', ad.frustrationThreshold, 1, 15, 1, 'threshold.frustrationRescue')}
  ${rangeField('cfg-maxrw', '每局激励上限',    ad.maxRewardedPerGame,    1, 10, 1, 'threshold.maxRewardedPerGame')}
</div>
<h3>IAP 触发配置</h3>
<div class="mp-cfg-form">
  ${rangeField('cfg-iap-hours','新手包展示时效（小时）', iapCfg.showStarterPackHours, 1, 72, 1, 'threshold.showStarterPackHours')}
  ${rangeField('cfg-iap-games','周卡触发局数',           iapCfg.showWeeklyPassAfterGames, 1, 30, 1, 'threshold.showWeeklyPassAfterGames')}
</div>
<button class="mp-cfg-save" id="mp-cfg-save-btn">保存配置</button>
<span id="mp-cfg-save-status" style="margin-left:8px;font-size:8.5px;color:var(--accent-dark,#4472C4)"></span>`;

    el.querySelector('#mp-cfg-save-btn').addEventListener('click', async () => {
        const get = id => Number(el.querySelector(`#${id}`).value);
        const newCfg = {
            segmentWeights: {
                best_score_norm:  get('cfg-w0'),
                total_games_norm: get('cfg-w1'),
                session_time_norm: get('cfg-w2'),
            },
            adTrigger: {
                ...ad,
                frustrationThreshold: get('cfg-frust'),
                maxRewardedPerGame:   get('cfg-maxrw'),
            },
            iapTrigger: {
                ...iapCfg,
                showStarterPackHours:   get('cfg-iap-hours'),
                showWeeklyPassAfterGames: get('cfg-iap-games'),
            },
        };
        const ok = await _putJson('/api/mon/model/config', newCfg);
        const status = el.querySelector('#mp-cfg-save-status');
        if (ok?.ok) {
            status.textContent = '✅ 已保存';
            status.style.color = '';
        } else {
            status.textContent = '❌ 保存失败';
            status.style.color = 'var(--warning, #e67e22)';
        }
        setTimeout(() => { status.textContent = ''; }, 3000);
    });
}

function _renderFlags(panel) {
    const el = panel.querySelector('#mp-tab-flags');
    if (!el) return;

    const flags = getAllFlags();
    const flagLabels = {
        adsRewarded:      '激励视频广告',
        adsInterstitial:  '插屏广告',
        iap:              'IAP 内购',
        dailyTasks:       '每日任务',
        leaderboard:      '在线排行榜',
        skinUnlock:       '皮肤等级解锁',
        seasonPass:       '赛季通行证',
        pushNotifications:'Web 推送通知',
        replayShare:      '回放分享',
        stubMode:         '存根模式（测试用）',
    };

    const rows = Object.entries(flags).map(([key, val]) => {
        const label = flagLabels[key] ?? key;
        const helpAttr = _hAttr(`flag.${key}`);
        // helpAttr 已包含 class/title/data-help-key，需补充宿主行布局类
        const rowAttr = helpAttr
            ? helpAttr.replace('class="mon-help"', 'class="mp-flag-row mon-help"')
            : 'class="mp-flag-row"';
        return `
<div ${rowAttr}>
  <span class="mp-flag-key">${label}</span>
  <label class="mp-flag-toggle" title="${key}">
    <input type="checkbox" data-flag="${key}" ${val ? 'checked' : ''}>
    <span class="mp-flag-slider"></span>
  </label>
</div>`;
    }).join('');

    el.innerHTML = `
<p class="mp-loading" style="text-align:left;padding:0 0 8px;font-style:normal">
  切换后立即生效，刷新页面后持久保存。
</p>
<div class="mp-flags">${rows}</div>`;

    el.querySelectorAll('input[data-flag]').forEach(input => {
        input.addEventListener('change', () => {
            setFlag(input.dataset.flag, input.checked);
        });
    });
}

// ─── 面板开关控制 ─────────────────────────────────────────────────────────────

let _panel = null;
let _game  = null;

function _openPanel() {
    if (!_panel) {
        _panel = _createPanel();
    }
    _panel.classList.add('mp-open');
    // 根据当前 tab 渲染
    _renderAllTabs();
}

function _closePanel() {
    _panel?.classList.remove('mp-open');
}

async function _renderAllTabs() {
    if (!_panel) return;
    await Promise.all([
        _renderOverview(_panel),
        _renderPersona(_panel, _game),
        _renderConfig(_panel),
    ]);
    _renderFlags(_panel);
}

// ─── 公共 API ─────────────────────────────────────────────────────────────────

/**
 * 初始化商业化模型训练面板。
 * @param {object} game  Game 实例（用于拉取 userId 和玩家信号）
 */
export function initMonPanel(game) {
    if (typeof document === 'undefined') return;
    _game = game;
    _injectStyles();

}

/** 供外部调用直接打开面板（替代悬浮按钮） */
export function openMonPanel() {
    if (_panel?.classList.contains('mp-open')) {
        _closePanel();
    } else {
        _openPanel();
    }
}

/** 强制刷新面板内容（如需从外部调用） */
export async function refreshMonPanel() {
    if (_panel?.classList.contains('mp-open')) {
        await _renderAllTabs();
    }
}
