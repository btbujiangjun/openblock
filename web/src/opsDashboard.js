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

.ops-section-title {
    grid-column: 1 / -1;
    font-size: 12px;
    font-weight: 700;
    color: #94a3b8;
    letter-spacing: .04em;
    margin: 2px 0 -2px;
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

/* ── 指标组 ── */
.ops-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
}
.ops-metric-cell {
    background: #22263a;
    border: 1px solid rgba(91,155,213,.12);
    border-radius: 6px;
    padding: 7px 8px;
}
.ops-metric-label {
    font-size: 9px;
    color: #94a3b8;
    margin-bottom: 4px;
}
.ops-metric-value {
    font-size: 13px;
    font-weight: 700;
    color: #e2e8f0;
}
.ops-metric-value--good { color: #22c55e; }
.ops-metric-value--warn { color: #f59e0b; }
.ops-metric-value--bad  { color: #ef4444; }

/* ── 状态 ── */
.ops-loading { color: #64748b; text-align: center; padding: 32px; font-size: 12px; }
.ops-error   { color: #ef4444; text-align: center; padding: 20px; font-size: 11px; line-height: 1.5; }

/* 主菜单「运营看板」卡片样式见 main.css（.menu-card--menu-secondary） */
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
    <input class="ops-select" id="ops-visit-user" placeholder="用户ID筛选" style="min-width:120px" />
    <input class="ops-select" id="ops-visit-ip" placeholder="IP筛选" style="min-width:120px" />
    <select class="ops-select" id="ops-visit-status">
      <option value="all" selected>访问状态: 全部</option>
      <option value="online">访问状态: 在线</option>
      <option value="offline">访问状态: 离线</option>
    </select>
    <input type="number" class="ops-select" id="ops-visit-limit" value="60" min="10" max="500" style="width:84px" />
    <button class="ops-btn" id="ops-refresh">🔄 刷新</button>
    <button class="ops-btn" id="ops-export-visits-csv">⬇️ 导出访问CSV</button>
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

function _getVisitFilters() {
    const visitUser = (document.getElementById('ops-visit-user')?.value || '').trim();
    const visitIp = (document.getElementById('ops-visit-ip')?.value || '').trim();
    const visitStatus = (document.getElementById('ops-visit-status')?.value || 'all').trim();
    const rawLimit = Number(document.getElementById('ops-visit-limit')?.value || 60);
    const visitLimit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(500, rawLimit | 0)) : 60;
    return { visitUser, visitIp, visitStatus, visitLimit };
}

function _exportVisitCsv() {
    const days = Number(document.getElementById('ops-days')?.value ?? 7);
    const vf = _getVisitFilters();
    const q = new URLSearchParams({
        days: String(days),
        visit_user: vf.visitUser,
        visit_ip: vf.visitIp,
        visit_status: vf.visitStatus,
        visit_limit: String(vf.visitLimit),
    });
    window.open(`/api/ops/visits/export?${q.toString()}`, '_blank');
}

async function _loadData(days = 7) {
    const bodyEl = document.getElementById('ops-body');
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div class="ops-loading">正在加载…</div>';

    try {
        const vf = _getVisitFilters();
        const q = new URLSearchParams({
            days: String(days),
            visit_user: vf.visitUser,
            visit_ip: vf.visitIp,
            visit_status: vf.visitStatus,
            visit_limit: String(vf.visitLimit),
        });
        const [dashRes, abRes] = await Promise.all([
            fetch(`/api/ops/dashboard?${q}`),
            fetch('/api/ab/results'),
        ]);
        if (!dashRes.ok) throw new Error(`HTTP ${dashRes.status}`);
        const dash = await dashRes.json();
        const abData = abRes.ok ? await abRes.json() : [];
        if (dash.error) throw new Error(dash.error);

        bodyEl.innerHTML = '';

        // 新版：核心指标 + 业务指标（运营体系）
        bodyEl.appendChild(_sectionTitle('核心指标'));
        bodyEl.appendChild(_coreMetricsCard(dash.coreMetrics || {}));
        bodyEl.appendChild(_sectionTitle('业务指标'));
        bodyEl.appendChild(_businessMetricsCard(dash.businessMetrics || {}));

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

        // 玩家访问（在线、时长、IP、最近活跃）
        bodyEl.appendChild(_visitSummaryCard(dash.visitStats || {}));
        bodyEl.appendChild(_visitTableCard(dash.recentVisits || []));

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

function _sectionTitle(text) {
    const d = document.createElement('div');
    d.className = 'ops-section-title';
    d.textContent = text;
    return d;
}

function _fmtPct(v) {
    const n = Number(v) || 0;
    return (n * 100).toFixed(1) + '%';
}

function _fmtMoney(v) {
    const n = Number(v) || 0;
    return `¥${n.toFixed(2)}`;
}

function _fmtNum(v, digits = 2) {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 1000) return n.toLocaleString('zh-CN');
    return n.toFixed(digits);
}

function _metricCell(label, value, cls = '') {
    return `<div class="ops-metric-cell">
      <div class="ops-metric-label">${label}</div>
      <div class="ops-metric-value ${cls}">${value}</div>
    </div>`;
}

function _coreMetricsCard(core) {
    const c = _card('核心指标总览', 'ops-card--full');
    const acq = core.acquisition || {};
    const ret = core.retention || {};
    const act = core.activity || {};
    const rev = core.revenue || {};
    const q = core.quality || {};
    c.innerHTML += `<div class="ops-metric-grid">
      ${_metricCell('获客·新增用户', _fmtNum(acq.newUsers, 0))}
      ${_metricCell('获客·成本', _fmtMoney(acq.cost))}
      ${_metricCell('获客·渠道转化', _fmtPct(acq.channelConversionRate))}
      ${_metricCell('留存·D1', _fmtPct(ret.d1))}
      ${_metricCell('留存·D7', _fmtPct(ret.d7))}
      ${_metricCell('留存·D30', _fmtPct(ret.d30))}
      ${_metricCell('留存·流失预警', _fmtPct(ret.churnRiskRate), (ret.churnRiskRate || 0) > 0.4 ? 'ops-metric-value--warn' : '')}
      ${_metricCell('活跃·DAU', _fmtNum(act.dau, 0))}
      ${_metricCell('活跃·DAU/MAU', _fmtPct(act.dauMau))}
      ${_metricCell('活跃·游玩时长', _fmtNum(act.avgDurationSec, 1) + 's')}
      ${_metricCell('活跃·人均局数', _fmtNum(act.avgSessionsPerUser, 2))}
      ${_metricCell('收入·ARPDAU', _fmtMoney(rev.arpdau))}
      ${_metricCell('收入·LTV', _fmtMoney(rev.ltv))}
      ${_metricCell('收入·付费率', _fmtPct(rev.paidRate))}
      ${_metricCell('收入·ARPU', _fmtMoney(rev.arpu))}
      ${_metricCell('质量·崩溃率', _fmtPct(q.crashRate), (q.crashRate || 0) > 0.01 ? 'ops-metric-value--bad' : '')}
      ${_metricCell('质量·卡顿率', _fmtPct(q.jankRate), (q.jankRate || 0) > 0.1 ? 'ops-metric-value--warn' : '')}
      ${_metricCell('质量·加载时长', _fmtNum(q.avgLoadMs, 1) + 'ms')}
    </div>`;
    return c;
}

function _businessMetricsCard(biz) {
    const c = _card('业务指标总览', 'ops-card--full');
    const ads = biz.ads || {};
    const iap = biz.iap || {};
    const social = biz.social || {};
    const content = biz.content || {};
    c.innerHTML += `<div class="ops-metric-grid">
      ${_metricCell('广告·展示率', _fmtPct(ads.impressionRate))}
      ${_metricCell('广告·点击率', _fmtPct(ads.clickRate))}
      ${_metricCell('广告·eCPM', _fmtMoney(ads.ecpm))}
      ${_metricCell('广告·完播率', _fmtPct(ads.completionRate))}
      ${_metricCell('IAP·转化率', _fmtPct(iap.conversionRate))}
      ${_metricCell('IAP·客单价', _fmtMoney(iap.avgOrderValue))}
      ${_metricCell('IAP·复购率', _fmtPct(iap.repurchaseRate))}
      ${_metricCell('社交·分享率', _fmtPct(social.shareRate))}
      ${_metricCell('社交·邀请转化', _fmtPct(social.inviteConversion))}
      ${_metricCell('社交·好友数', _fmtNum(social.avgFriends, 2))}
      ${_metricCell('内容·皮肤使用率', _fmtPct(content.skinUsageRate))}
      ${_metricCell('内容·道具消耗', _fmtNum(content.itemConsumptionPerUser, 2))}
      ${_metricCell('内容·成就完成率', _fmtPct(content.achievementCompletionRate))}
    </div>`;
    return c;
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
      ${_retRow('D1 次日', ret.d1 ?? 0, 0.40)}
      ${_retRow('D7 七日', ret.d7 ?? 0, 0.20)}
      ${_retRow('D30 三十日', ret.d30 ?? 0, 0.08)}`;
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

function _visitSummaryCard(vs) {
    const c = _card('访问概览');
    const online = Number(vs.onlineUsers || 0);
    const avgDur = Number(vs.avgVisitDurationSec || 0);
    const recent = Number(vs.recentVisitCount || 0);
    c.innerHTML += `<div class="ops-kpi-val ${_rc(online, 5, 20)}">${online}<span class="ops-kpi-unit">在线</span></div>`;
    c.innerHTML += `<div class="ops-text" style="font-size:10px;margin-top:8px">近窗口访问：${recent}</div>`;
    c.innerHTML += `<div class="ops-text" style="font-size:10px;margin-top:4px">平均访问时长：${avgDur.toFixed(1)}s</div>`;
    return c;
}

function _visitTableCard(rows) {
    const c = _card('玩家访问记录（最近 60 条）', 'ops-card--full');
    const t = document.createElement('table');
    t.className = 'ops-table';
    t.innerHTML = '<tr><th>用户</th><th>IP</th><th>开始</th><th>最后活跃</th><th>时长</th><th>状态</th><th>玩家信息</th></tr>';
    const list = Array.isArray(rows) ? rows.slice(0, 60) : [];
    if (!list.length) {
        const p = document.createElement('div');
        p.className = 'ops-text';
        p.style.fontSize = '11px';
        p.textContent = '暂无访问记录';
        c.appendChild(p);
        return c;
    }
    for (const r of list) {
        const uid = String(r.userId || '');
        const shortUid = uid.length > 10 ? `${uid.slice(0, 10)}...` : uid;
        const ip = String(r.clientIp || '—');
        const st = Number(r.startedAt || 0);
        const lt = Number(r.lastSeenAt || 0);
        const dur = Number(r.durationSec || 0);
        const online = !!r.isOnline;
        const info = r.playerInfo && typeof r.playerInfo === 'object' ? r.playerInfo : {};
        const infoText = [
            info.level ? `Lv${info.level}` : '',
            info.segment ? `seg:${info.segment}` : '',
            info.rank ? `rank:${info.rank}` : '',
            info.strategy ? `strategy:${info.strategy}` : '',
        ].filter(Boolean).join(' · ') || '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${shortUid}</td>
          <td>${ip}</td>
          <td>${st ? new Date(st * 1000).toLocaleString('zh-CN') : '—'}</td>
          <td>${lt ? new Date(lt * 1000).toLocaleString('zh-CN') : '—'}</td>
          <td>${dur}s</td>
          <td class="${online ? 'ops-good' : 'ops-text'}">${online ? '在线' : '离线'}</td>
          <td>${infoText}</td>
        `;
        t.appendChild(tr);
    }
    c.appendChild(t);
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
    document.getElementById('ops-visit-user')?.addEventListener('change', () => {
        const days = Number(document.getElementById('ops-days')?.value ?? 7);
        _loadData(days);
    });
    document.getElementById('ops-visit-ip')?.addEventListener('change', () => {
        const days = Number(document.getElementById('ops-days')?.value ?? 7);
        _loadData(days);
    });
    document.getElementById('ops-visit-status')?.addEventListener('change', () => {
        const days = Number(document.getElementById('ops-days')?.value ?? 7);
        _loadData(days);
    });
    document.getElementById('ops-visit-limit')?.addEventListener('change', () => {
        const days = Number(document.getElementById('ops-days')?.value ?? 7);
        _loadData(days);
    });
    document.getElementById('ops-export-visits-csv')?.addEventListener('click', () => {
        _exportVisitCsv();
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
