/**
 * 运营看板（前端 Screen 模块）
 *
 * 以游戏内 Screen 的形式注入，与关卡编辑器/回放并列。
 * 通过 game.showScreen('ops') 打开，内部管理自身样式注入和数据加载。
 *
 * 使用
 * ----
 *   import { initOpsDashboard } from './opsDashboard.js';
 *   initOpsDashboard(game);
 *   // 之后可通过 game.showScreen('ops') 打开，或直接调用 openOpsDashboard()
 */

const SEG_COLORS = { A: '#5B9BD5', B: '#22c55e', C: '#f59e0b', D: '#a855f7', E: '#94a3b8', unknown: '#475569' };
const SEG_LABELS = { A: 'A·休闲', B: 'B·无尽', C: 'C·重度', D: 'D·关卡', E: 'E·高能', unknown: '未知' };

// ── 样式注入 ──────────────────────────────────────────────────────────────────

function _injectStyles() {
    if (document.getElementById('ops-dashboard-styles')) return;
    const s = document.createElement('style');
    s.id = 'ops-dashboard-styles';
    s.textContent = `
/* ── 运营看板 Screen ── */
#ops-screen {
    background: #0f1117;
    overflow-y: auto;
    justify-content: flex-start;
    align-items: stretch;
    padding: 0;
}
.ops-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: #1a1d27;
    border-bottom: 1px solid rgba(91,155,213,.18);
    flex-shrink: 0;
    gap: 8px;
}
.ops-head-title {
    font-size: 14px;
    font-weight: 700;
    color: #5B9BD5;
    white-space: nowrap;
}
.ops-head-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}
.ops-select {
    background: #22263a;
    color: #e2e8f0;
    border: 1px solid rgba(91,155,213,.18);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
}
.ops-btn {
    background: #22263a;
    color: #e2e8f0;
    border: 1px solid rgba(91,155,213,.18);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    transition: background .15s;
}
.ops-btn:hover { background: rgba(91,155,213,.18); }
.ops-btn--back {
    color: #94a3b8;
    border-color: rgba(148,163,184,.2);
}
.ops-last-refresh {
    font-size: 10px;
    color: #64748b;
    white-space: nowrap;
}
.ops-body {
    padding: 12px 14px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
    align-content: start;
}

/* ── 卡片 ── */
.ops-card {
    background: #1a1d27;
    border: 1px solid rgba(91,155,213,.15);
    border-radius: 8px;
    padding: 12px;
}
.ops-card--wide { grid-column: span 2; }
.ops-card--full { grid-column: 1 / -1; }
.ops-card-title {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 8px;
}

/* ── KPI ── */
.ops-kpi-val {
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
}
.ops-kpi-unit { font-size: 11px; font-weight: 400; margin-left: 2px; }
.ops-good { color: #22c55e; }
.ops-warn { color: #f59e0b; }
.ops-bad  { color: #ef4444; }
.ops-text { color: #e2e8f0; }

/* ── 留存表 ── */
.ops-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
}
.ops-table th {
    color: #64748b;
    font-weight: 600;
    padding: 3px 6px;
    text-align: left;
    border-bottom: 1px solid rgba(91,155,213,.15);
}
.ops-table td { padding: 4px 6px; border-bottom: 1px solid rgba(91,155,213,.08); }
.ops-ret-bar {
    display: inline-block;
    height: 5px;
    background: #5B9BD5;
    border-radius: 2px;
    min-width: 2px;
}

/* ── 分群 ── */
.ops-seg-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
}
.ops-seg-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 6px;
    background: #22263a;
    border-radius: 5px;
    font-size: 10px;
}
.ops-seg-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.ops-seg-label { flex: 1; color: #94a3b8; }
.ops-seg-cnt { font-weight: 700; color: #e2e8f0; }
.ops-seg-pct {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 700;
}
.ops-seg-pct--hi { background: rgba(34,197,94,.15); color: #22c55e; }
.ops-seg-pct--lo { background: rgba(245,158,11,.15); color: #f59e0b; }

/* ── 趋势柱状图 ── */
.ops-trend-bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 50px;
    margin-top: 4px;
}
.ops-trend-bar {
    flex: 1;
    background: rgba(91,155,213,.55);
    border-radius: 2px 2px 0 0;
    min-height: 3px;
    position: relative;
    cursor: default;
}
.ops-trend-bar:hover { background: #5B9BD5; }
.ops-trend-bar[title]:hover::after {
    content: attr(title);
    position: absolute;
    bottom: 110%;
    left: 50%;
    transform: translateX(-50%);
    background: #22263a;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    white-space: nowrap;
    z-index: 9;
    color: #e2e8f0;
    pointer-events: none;
}
.ops-trend-labels {
    display: flex;
    gap: 3px;
    margin-top: 3px;
}
.ops-trend-label {
    flex: 1;
    text-align: center;
    font-size: 8px;
    color: #475569;
    overflow: hidden;
}

/* ── 排行榜 ── */
.ops-score-list { list-style: none; }
.ops-score-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 0;
    border-bottom: 1px solid rgba(91,155,213,.08);
    font-size: 10px;
    gap: 4px;
}
.ops-score-list li:last-child { border: none; }
.ops-score-rank { color: #475569; min-width: 16px; flex-shrink: 0; }
.ops-score-user { flex: 1; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ops-score-val { font-weight: 700; color: #5B9BD5; flex-shrink: 0; }

/* ── A/B 表 ── */
.ops-ab-winner { color: #22c55e; font-weight: 700; }

/* ── 状态 ── */
.ops-loading { color: #64748b; text-align: center; padding: 32px; font-size: 12px; }
.ops-error   { color: #ef4444; text-align: center; padding: 20px; font-size: 11px; line-height: 1.5; }

/* ── menu card（运营看板） ── */
.menu-card--ops {
    background: linear-gradient(145deg, #1a1d27, #22263a);
    border: 1px solid rgba(91,155,213,.35);
    color: #5B9BD5;
}
.menu-card--ops:hover {
    background: linear-gradient(145deg, #22263a, #2a3050);
    border-color: rgba(91,155,213,.6);
}
.menu-card--ops .menu-card-icon { opacity: .85; }
`;
    document.head.appendChild(s);
}

// ── DOM 构建 ──────────────────────────────────────────────────────────────────

function _buildScreen() {
    if (document.getElementById('ops-screen')) return;
    const div = document.createElement('div');
    div.id = 'ops-screen';
    div.className = 'screen';
    div.innerHTML = `
<div class="ops-head">
  <span class="ops-head-title">📊 运营看板</span>
  <div class="ops-head-controls">
    <select class="ops-select" id="ops-days">
      <option value="1">今天</option>
      <option value="7" selected>近7天</option>
      <option value="30">近30天</option>
    </select>
    <button class="ops-btn" id="ops-refresh">🔄 刷新</button>
    <span class="ops-last-refresh" id="ops-last-refresh"></span>
    <button class="ops-btn ops-btn--back" id="ops-back">← 返回</button>
  </div>
</div>
<div class="ops-body" id="ops-body">
  <div class="ops-loading">正在加载数据…</div>
</div>`;
    document.body.appendChild(div);
}

// ── 数据渲染 ──────────────────────────────────────────────────────────────────

async function _loadData(days = 7) {
    const bodyEl = document.getElementById('ops-body');
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div class="ops-loading">正在加载…</div>';

    try {
        const [dashRes, abRes] = await Promise.all([
            fetch(`/api/ops/dashboard?days=${days}`),
            fetch('/api/ab/results'),
        ]);
        if (!dashRes.ok) throw new Error(`HTTP ${dashRes.status}`);
        const dash = await dashRes.json();
        const abData = abRes.ok ? await abRes.json() : [];
        if (dash.error) throw new Error(dash.error);

        bodyEl.innerHTML = '';

        // KPI 卡片
        bodyEl.appendChild(_kpiCard('日活 (DAU)', dash.activity.dau, '', _rc(dash.activity.dau, 10, 50)));
        bodyEl.appendChild(_kpiCard('人均局数', dash.activity.avgSessionsPerUser, '局/人', _rc(dash.activity.avgSessionsPerUser, 3, 6)));
        const dur = dash.activity.avgDurationSec ?? 0;
        bodyEl.appendChild(_kpiCard('平均时长', dur > 60 ? Math.round(dur / 60) + 'm' : (dur ? dur + 's' : '—'), '', _rc(dur, 60, 240)));

        // 留存
        bodyEl.appendChild(_retCard(dash.retention));

        // 分群
        bodyEl.appendChild(_segCard(dash.segments));

        // 趋势
        bodyEl.appendChild(_trendCard(dash.trend));

        // Top 分数
        bodyEl.appendChild(_topScoreCard(dash.topScores));

        // A/B 结果
        bodyEl.appendChild(_abCard(abData));

        const tsEl = document.getElementById('ops-last-refresh');
        if (tsEl) tsEl.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');

    } catch (e) {
        bodyEl.innerHTML = `<div class="ops-error">⚠️ 加载失败：${e.message}<br><small>请确认 Flask 后端正在运行</small></div>`;
    }
}

// ── 卡片工厂 ─────────────────────────────────────────────────────────────────

function _card(title, extraClass = '') {
    const d = document.createElement('div');
    d.className = `ops-card ${extraClass}`.trim();
    if (title) {
        const t = document.createElement('div');
        t.className = 'ops-card-title';
        t.textContent = title;
        d.appendChild(t);
    }
    return d;
}

function _kpiCard(title, val, unit, cls) {
    const c = _card(title);
    c.innerHTML += `<div class="ops-kpi-val ${cls}">${val}<span class="ops-kpi-unit">${unit}</span></div>`;
    return c;
}

function _rc(val, warn, good) {
    if (val >= good) return 'ops-good';
    if (val >= warn) return 'ops-warn';
    return 'ops-bad';
}

function _retCard(ret) {
    const c = _card('留存率', 'ops-card--wide');
    const table = document.createElement('table');
    table.className = 'ops-table';
    table.innerHTML = `<tr><th>指标</th><th>当前</th><th>目标</th><th>进度</th></tr>
      ${_retRow('D1 次日', ret.d1, 0.40)}
      ${_retRow('D7 七日', ret.d7, 0.20)}`;
    c.appendChild(table);
    return c;
}

function _retRow(label, val, target) {
    const pct = (val * 100).toFixed(1);
    const cls = val >= target ? 'ops-good' : val >= target * 0.7 ? 'ops-warn' : 'ops-bad';
    const barW = Math.min(100, Math.round(val / target * 100));
    return `<tr>
      <td>${label}</td>
      <td class="${cls}">${pct}%</td>
      <td style="color:#64748b">${(target * 100).toFixed(0)}%</td>
      <td><span class="ops-ret-bar" style="width:${barW}px"></span></td>
    </tr>`;
}

function _segCard(segments) {
    const c = _card('用户分群', 'ops-card--wide');
    const grid = document.createElement('div');
    grid.className = 'ops-seg-grid';
    const total = Object.values(segments).reduce((a, b) => a + b, 0) || 1;
    for (const [seg, cnt] of Object.entries(segments)) {
        if (!cnt) continue;
        const pct = (cnt / total * 100).toFixed(0);
        const item = document.createElement('div');
        item.className = 'ops-seg-item';
        item.innerHTML = `
          <span class="ops-seg-dot" style="background:${SEG_COLORS[seg]}"></span>
          <span class="ops-seg-label">${SEG_LABELS[seg] ?? seg}</span>
          <span class="ops-seg-cnt">${cnt}</span>
          <span class="ops-seg-pct ops-seg-pct--${pct >= 10 ? 'hi' : 'lo'}">${pct}%</span>`;
        grid.appendChild(item);
    }
    c.appendChild(grid);
    return c;
}

function _trendCard(trend) {
    const c = _card('DAU 趋势', 'ops-card--full');
    const maxDau = Math.max(...trend.map(t => t.dau), 1);
    const bars = document.createElement('div');
    bars.className = 'ops-trend-bars';
    const labs = document.createElement('div');
    labs.className = 'ops-trend-labels';
    for (const t of trend) {
        const bar = document.createElement('div');
        bar.className = 'ops-trend-bar';
        bar.style.height = Math.max(3, Math.round(t.dau / maxDau * 50)) + 'px';
        bar.title = `${t.date}: ${t.dau} 用户`;
        bars.appendChild(bar);
        const lab = document.createElement('div');
        lab.className = 'ops-trend-label';
        lab.textContent = t.date;
        labs.appendChild(lab);
    }
    c.appendChild(bars);
    c.appendChild(labs);
    return c;
}

function _topScoreCard(scores) {
    const c = _card('最高分 Top10');
    const ul = document.createElement('ul');
    ul.className = 'ops-score-list';
    (scores ?? []).slice(0, 10).forEach((row, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="ops-score-rank">${i + 1}</span>
          <span class="ops-score-user">${row.userId}</span>
          <span class="ops-score-val">${Number(row.score).toLocaleString()}</span>`;
        ul.appendChild(li);
    });
    if (!scores?.length) ul.innerHTML = '<li style="color:#475569">暂无数据</li>';
    c.appendChild(ul);
    return c;
}

function _abCard(abData) {
    const c = _card('A/B 实验结果', 'ops-card--wide');
    if (!abData.length) {
        const p = document.createElement('p');
        p.style.cssText = 'color:#64748b;font-size:10px;line-height:1.5';
        p.textContent = '暂无实验数据（需真实用户触发转化事件后显示）';
        c.appendChild(p);
        return c;
    }
    const byExp = {};
    for (const row of abData) {
        if (!byExp[row.experiment]) byExp[row.experiment] = {};
        const k = `${row.bucket}·${row.event}`;
        byExp[row.experiment][k] = (byExp[row.experiment][k] || 0) + row.cnt;
    }
    const table = document.createElement('table');
    table.className = 'ops-table';
    table.innerHTML = '<tr><th>实验</th><th>事件</th><th>对照组(桶0)</th><th>实验组(桶1)</th></tr>';
    for (const [exp, data] of Object.entries(byExp)) {
        const events = [...new Set(Object.keys(data).map(k => k.split('·')[1]))];
        for (const ev of events) {
            const b0 = data[`0·${ev}`] || 0;
            const b1 = data[`1·${ev}`] || 0;
            const winCls = b1 > b0 * 1.05 ? 'ops-ab-winner' : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${exp}</td><td>${ev}</td><td>${b0}</td><td class="${winCls}">${b1}</td>`;
            table.appendChild(tr);
        }
    }
    c.appendChild(table);
    return c;
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

let _game = null;
let _initialized = false;

export function initOpsDashboard(game) {
    if (_initialized) return;
    _initialized = true;
    _game = game;

    _injectStyles();
    _buildScreen();

    // 后退按钮
    document.getElementById('ops-back')?.addEventListener('click', () => {
        _game?.showScreen('menu');
        _game?.updateShellVisibility?.();
    });

    // 刷新按钮
    document.getElementById('ops-refresh')?.addEventListener('click', () => {
        const days = Number(document.getElementById('ops-days')?.value ?? 7);
        _loadData(days);
    });

    // 天数切换
    document.getElementById('ops-days')?.addEventListener('change', (e) => {
        _loadData(Number(e.target.value));
    });

    // 注册菜单按钮
    document.getElementById('ops-menu-btn')?.addEventListener('click', () => {
        openOpsDashboard();
    });
}

export function openOpsDashboard() {
    _game?.showScreen('ops-screen');
    const days = Number(document.getElementById('ops-days')?.value ?? 7);
    _loadData(days);
}
