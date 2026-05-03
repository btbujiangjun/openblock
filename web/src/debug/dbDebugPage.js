/**
 * SQLite 调试页（服务端默认启用；可用 OPENBLOCK_DB_DEBUG=0 关闭）。
 * 列出表、执行查询或写入类 SQL；未输入 SQL 时对选中表默认 SELECT * LIMIT。
 */
import { getApiBaseUrl } from '../config.js';
import { applyDom, t } from '../i18n/i18n.js';

/** @type {import('../game.js').Game | null} */
let _game = null;

async function _apiJson(path, options = {}) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { _raw: text };
        }
    }
    if (!res.ok) {
        const err = new Error(data?.error || `HTTP ${res.status}`);
        err.body = data;
        throw err;
    }
    return data;
}

function _injectStyles() {
    if (document.getElementById('db-debug-styles')) return;
    const s = document.createElement('style');
    s.id = 'db-debug-styles';
    s.textContent = `
#db-debug-screen {
    background: #0c0e14;
    overflow: hidden;
    justify-content: flex-start;
    align-items: stretch;
    padding: 0;
    flex-direction: column;
}
.dbdbg-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 14px;
    background: #151923;
    border-bottom: 1px solid rgba(148,163,184,.15);
    flex-shrink: 0;
}
.dbdbg-title {
    font-size: 14px;
    font-weight: 700;
    color: #94f396;
}
.dbdbg-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.dbdbg-select, .dbdbg-input {
    background: #1e2433;
    color: #e2e8f0;
    border: 1px solid rgba(148,163,184,.22);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
}
.dbdbg-tables-status {
    flex: 1 1 160px;
    min-width: 0;
    font-size: 11px;
    line-height: 1.35;
    color: #f87171;
}
.dbdbg-tables-status:empty,
.dbdbg-tables-status[hidden] {
    display: none;
}
.dbdbg-input { width: 64px; }
.dbdbg-btn {
    background: #243045;
    color: #e2e8f0;
    border: 1px solid rgba(148,163,184,.25);
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
}
.dbdbg-btn:hover { background: rgba(148,163,184,.15); }
.dbdbg-btn--primary {
    background: rgba(34, 197, 94, .22);
    border-color: rgba(34, 197, 94, .45);
    color: #bbf7d0;
}
.dbdbg-btn--danger {
    background: rgba(239, 68, 68, .15);
    border-color: rgba(239, 68, 68, .35);
    color: #fecaca;
}
.dbdbg-btn--back { color: #94a3b8; }
.dbdbg-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 10px 14px 14px;
    gap: 10px;
}
.dbdbg-warn {
    font-size: 11px;
    color: #fbbf24;
    line-height: 1.45;
    background: rgba(251, 191, 36, .08);
    border: 1px solid rgba(251, 191, 36, .22);
    border-radius: 8px;
    padding: 8px 10px;
}
.dbdbg-sql {
    width: 100%;
    min-height: 100px;
    max-height: 28vh;
    box-sizing: border-box;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.4;
    background: #0f1419;
    color: #e2e8f0;
    border: 1px solid rgba(148,163,184,.2);
    border-radius: 8px;
    padding: 10px;
    resize: vertical;
}
.dbdbg-meta {
    font-size: 11px;
    color: #64748b;
}
.dbdbg-result-wrap {
    flex: 1;
    min-height: 120px;
    overflow: auto;
    border: 1px solid rgba(148,163,184,.15);
    border-radius: 8px;
    background: #0f1419;
}
.dbdbg-table {
    border-collapse: collapse;
    font-size: 11px;
    color: #cbd5e1;
}
.dbdbg-table th, .dbdbg-table td {
    border: 1px solid rgba(148,163,184,.12);
    padding: 4px 8px;
    text-align: left;
    vertical-align: top;
    max-width: 240px;
    overflow-wrap: anywhere;
}
.dbdbg-table th {
    background: #1a2230;
    position: sticky;
    top: 0;
    z-index: 1;
    color: #94a3b8;
}
.dbdbg-mutate {
    padding: 12px;
    font-size: 12px;
    color: #86efac;
}
.dbdbg-error {
    padding: 12px;
    font-size: 12px;
    color: #fca5a5;
    white-space: pre-wrap;
}
`;
    document.head.appendChild(s);
}

function _buildScreen() {
    if (document.getElementById('db-debug-screen')) return;
    const div = document.createElement('div');
    div.id = 'db-debug-screen';
    div.className = 'screen';
    div.innerHTML = `
<div class="dbdbg-head">
  <span class="dbdbg-title" data-i18n="dbDebug.title">🗄 SQLite 调试</span>
  <div class="dbdbg-row">
    <label class="dbdbg-meta" data-i18n="dbDebug.tableLabel">表</label>
    <select class="dbdbg-select" id="dbdbg-tables" aria-label="table"></select>
    <span class="dbdbg-tables-status" id="dbdbg-tables-status" role="status" hidden></span>
    <label class="dbdbg-meta" data-i18n="dbDebug.limitLabel">行上限</label>
    <input type="number" class="dbdbg-input" id="dbdbg-limit" value="500" min="1" max="5000" />
    <button type="button" class="dbdbg-btn dbdbg-btn--back" id="dbdbg-back" data-i18n="dbDebug.back">← 返回菜单</button>
  </div>
</div>
<div class="dbdbg-body">
  <div class="dbdbg-warn" data-i18n="dbDebug.warn">仅在可信环境开启 OPENBLOCK_DB_DEBUG。此处可修改或删除数据，请谨慎操作。</div>
  <div class="dbdbg-meta" data-i18n="dbDebug.sqlHint">先在上方下拉框选中表，点「查询选中表」即可默认执行 SELECT * … LIMIT，无需写 SQL。若要改删数据，再在下方填写单条 SQL，点「执行 SQL」。</div>
  <textarea class="dbdbg-sql" id="dbdbg-sql" spellcheck="false" data-i18n-placeholder="dbDebug.sqlPlaceholder" placeholder="（可选）自定义 SQL…"></textarea>
  <div class="dbdbg-row">
    <button type="button" class="dbdbg-btn dbdbg-btn--primary" id="dbdbg-query-table" data-i18n="dbDebug.querySelectedTable">查询选中表</button>
    <button type="button" class="dbdbg-btn" id="dbdbg-run" data-i18n="dbDebug.run">执行 SQL</button>
    <button type="button" class="dbdbg-btn" id="dbdbg-refresh-tables" data-i18n="dbDebug.refreshTables">刷新表列表</button>
    <button type="button" class="dbdbg-btn" id="dbdbg-schema" data-i18n="dbDebug.schema">填入 PRAGMA 表结构</button>
    <button type="button" class="dbdbg-btn dbdbg-btn--danger" id="dbdbg-clear-result" data-i18n="dbDebug.clearResult">清空结果</button>
  </div>
  <div class="dbdbg-result-wrap" id="dbdbg-result"><div class="dbdbg-meta" style="padding:10px" data-i18n="dbDebug.resultPlaceholder">查询结果将显示在此处。</div></div>
</div>`;
    document.body.appendChild(div);
    applyDom(div);
}

/** @param {{ loading?: boolean }} [opts] */
async function _loadTables(opts = {}) {
    const sel = document.getElementById('dbdbg-tables');
    if (!sel) return;
    _setTablesStatus('');
    const loading = opts.loading !== false;
    if (loading) {
        sel.innerHTML = `<option value="">${escapeHtml(t('dbDebug.tablesLoading'))}</option>`;
        sel.disabled = true;
    } else {
        sel.innerHTML = `<option value="">—</option>`;
    }
    try {
        const data = await _apiJson('/api/db-debug/tables');
        const items = _normalizeTableItems(data);
        sel.innerHTML = '';
        sel.disabled = false;
        if (items.length === 0) {
            const o = document.createElement('option');
            o.value = '';
            o.disabled = true;
            o.textContent = t('dbDebug.tablesEmpty');
            sel.appendChild(o);
            return;
        }
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '—';
        sel.appendChild(blank);
        for (const it of items) {
            const name = it?.name;
            if (!name || typeof name !== 'string') continue;
            const o = document.createElement('option');
            o.value = name;
            const typ = it.type === 'view' ? 'view' : 'table';
            o.textContent =
                typ === 'view' ? t('dbDebug.optionView', { name }) : t('dbDebug.optionTable', { name });
            o.title = typ === 'view' ? `view · ${name}` : `table · ${name}`;
            sel.appendChild(o);
        }
    } catch (e) {
        console.warn('[db-debug] tables', e);
        const detail = e?.body?.error || e?.message || String(e);
        _setTablesStatus(`${t('dbDebug.tablesErrorHint')} ${detail}`);
        sel.innerHTML = `<option value="">${escapeHtml(t('dbDebug.tablesError'))}</option>`;
        sel.disabled = false;
        sel.title = detail;
    }
}

function _renderResult(data) {
    const el = document.getElementById('dbdbg-result');
    if (!el) return;
    if (data.error) {
        el.innerHTML = `<div class="dbdbg-error">${escapeHtml(String(data.error))}</div>`;
        return;
    }
    if (data.kind === 'mutate') {
        const rid = data.lastrowid;
        const idStr = rid != null && rid > 0 ? String(rid) : '—';
        el.innerHTML = `<div class="dbdbg-mutate">✓ ${t('dbDebug.mutateOk', { n: data.rowcount ?? 0, id: idStr })}</div>`;
        return;
    }
    if (data.kind === 'rows' && Array.isArray(data.columns)) {
        const cols = data.columns;
        const rows = data.rows || [];
        let html = '<table class="dbdbg-table"><thead><tr>';
        for (const c of cols) {
            html += `<th>${escapeHtml(String(c))}</th>`;
        }
        html += '</tr></thead><tbody>';
        for (const r of rows) {
            html += '<tr>';
            for (let i = 0; i < cols.length; i++) {
                const v = r[i];
                const s = v === null || v === undefined ? '' : String(v);
                html += `<td>${escapeHtml(s)}</td>`;
            }
            html += '</tr>';
        }
        html += `</tbody></table><div class="dbdbg-meta" style="padding:6px 8px">${t('dbDebug.rowCount', { n: rows.length })}</div>`;
        el.innerHTML = html;
        return;
    }
    el.innerHTML = `<pre class="dbdbg-error">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
}

function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _setTablesStatus(message) {
    const st = document.getElementById('dbdbg-tables-status');
    if (!st) return;
    if (message) {
        st.textContent = message;
        st.hidden = false;
    } else {
        st.textContent = '';
        st.hidden = true;
    }
}

/** @param {unknown} data */
function _normalizeTableItems(data) {
    if (Array.isArray(data?.items)) {
        return data.items;
    }
    /* 兼容旧版接口：纯字符串数组 */
    if (Array.isArray(data)) {
        return data.map((name) =>
            typeof name === 'string' ? { name, type: 'table' } : null
        ).filter(Boolean);
    }
    return [];
}

async function _execPayload(payload) {
    const out = document.getElementById('dbdbg-result');
    if (!out) return;
    out.innerHTML = `<div class="dbdbg-meta" style="padding:12px">${escapeHtml(t('dbDebug.running'))}</div>`;
    try {
        const data = await _apiJson('/api/db-debug/exec', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        _renderResult(data);
    } catch (e) {
        _renderResult({ error: e.message || String(e) });
    }
}

/** 默认 SELECT：仅依据下拉框选中表，忽略文本框内容（不必写 SQL） */
async function _runDefaultSelect() {
    const sel = document.getElementById('dbdbg-tables');
    const limEl = document.getElementById('dbdbg-limit');
    const out = document.getElementById('dbdbg-result');
    if (!out) return;
    const table = sel?.value?.trim() || '';
    let limit = Number(limEl?.value);
    if (!Number.isFinite(limit)) limit = 500;
    if (!table) {
        out.innerHTML = `<div class="dbdbg-error">${escapeHtml(t('dbDebug.needSelectTable'))}</div>`;
        return;
    }
    await _execPayload({ sql: '', table, limit });
}

async function _run() {
    const sqlEl = document.getElementById('dbdbg-sql');
    const sel = document.getElementById('dbdbg-tables');
    const limEl = document.getElementById('dbdbg-limit');
    const out = document.getElementById('dbdbg-result');
    if (!sqlEl || !out) return;
    const sql = sqlEl.value.trim();
    const table = sel?.value?.trim() || '';
    let limit = Number(limEl?.value);
    if (!Number.isFinite(limit)) limit = 500;

    if (!sql && !table) {
        out.innerHTML = `<div class="dbdbg-error">${escapeHtml(t('dbDebug.needTableOrSql'))}</div>`;
        return;
    }

    await _execPayload({ sql, table, limit });
}

function _fillSchema() {
    const sel = document.getElementById('dbdbg-tables');
    const sqlEl = document.getElementById('dbdbg-sql');
    const tname = sel?.value?.trim();
    if (!tname || !sqlEl) return;
    sqlEl.value = `PRAGMA table_info(${tname});`;
}

export function initDbDebugPage(game) {
    _game = game;
    _injectStyles();
    _buildScreen();

    document.getElementById('dbdbg-back')?.addEventListener('click', () => {
        _game?.showScreen('menu');
        _game?.updateShellVisibility?.();
    });
    document.getElementById('dbdbg-query-table')?.addEventListener('click', () => void _runDefaultSelect());
    document.getElementById('dbdbg-run')?.addEventListener('click', () => void _run());
    document.getElementById('dbdbg-refresh-tables')?.addEventListener('click', () =>
        void _loadTables({ loading: true })
    );
    document.getElementById('dbdbg-schema')?.addEventListener('click', _fillSchema);
    document.getElementById('dbdbg-clear-result')?.addEventListener('click', () => {
        const el = document.getElementById('dbdbg-result');
        if (el) {
            el.innerHTML = `<div class="dbdbg-meta" style="padding:10px">${escapeHtml(t('dbDebug.resultPlaceholder'))}</div>`;
        }
    });

    const menuBtn = document.getElementById('menu-db-debug-btn');
    menuBtn?.addEventListener('click', () => {
        openDbDebugPage();
    });

    void _probeAndToggleMenu(menuBtn);
}

async function _probeAndToggleMenu(menuBtn) {
    if (!menuBtn) return;
    try {
        const j = await _apiJson('/api/db-debug/enabled');
        if (j?.enabled) {
            menuBtn.removeAttribute('hidden');
            applyDom(document.getElementById('menu') || document.body);
            /* 依据 sqlite_master 预载下拉框，进入页面前即可选好表 */
            void _loadTables({ loading: true });
        }
    } catch {
        /* 后端未启动或未启用 */
    }
}

export function openDbDebugPage() {
    _game?.showScreen('db-debug-screen');
    /* 打开时再拉一次元数据，避免他处改过库结构 */
    void _loadTables({ loading: true });
}
