/**
 * 排行榜 Screen（SO-1）
 *
 * 以游戏内 Screen 形式注入（与运营看板 / 关卡编辑器并列），通过
 * `openLeaderboardScreen()` 打开。提供三个榜单 tab：
 *   - 全服总榜（scope=all，历史最高分）
 *   - 周榜（scope=weekly，近 7 日最高分）
 *   - 好友榜（scope=friends，基于邀请关系图 invites）
 *
 * 数据源：GET /api/leaderboard/board?scope=&user_id=&limit=
 */

import { getApiBaseUrl } from '../config.js';

const TABS = [
    { id: 'all', label: '🌐 全服', needUser: false },
    { id: 'weekly', label: '📅 周榜', needUser: false },
    { id: 'friends', label: '👥 好友', needUser: true },
];

let _game = null;
let _initialized = false;
let _scope = 'all';

function _userId() {
    try { return localStorage.getItem('bb_user_id') || ''; } catch { return ''; }
}

function _anon(uid) {
    if (!uid) return '—';
    return uid.length > 6 ? uid.slice(0, 4) + '***' : uid;
}

function _injectStyles() {
    if (document.getElementById('lb-screen-styles')) return;
    const s = document.createElement('style');
    s.id = 'lb-screen-styles';
    s.textContent = `
#leaderboard-screen { background:#0f1117; overflow-y:auto; justify-content:flex-start; align-items:stretch; padding:0; }
.lb-head { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; background:#1a1d27; border-bottom:1px solid rgba(91,155,213,.18); }
.lb-head-title { font-size:14px; font-weight:700; color:#f59e0b; }
.lb-btn { background:#22263a; color:#e2e8f0; border:1px solid rgba(91,155,213,.18); border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer; }
.lb-btn:hover { background:rgba(91,155,213,.18); }
.lb-tabs { display:flex; gap:6px; padding:10px 16px 0; }
.lb-tab { flex:1; background:#1a1d27; color:#94a3b8; border:1px solid rgba(91,155,213,.15); border-radius:8px 8px 0 0; padding:8px; font-size:12px; font-weight:600; cursor:pointer; text-align:center; }
.lb-tab.active { background:#22263a; color:#f59e0b; border-bottom-color:transparent; }
.lb-body { padding:12px 16px; }
.lb-myrank { background:#22263a; border:1px solid rgba(245,158,11,.3); border-radius:8px; padding:10px 12px; margin-bottom:10px; font-size:12px; color:#e2e8f0; display:flex; justify-content:space-between; }
.lb-list { list-style:none; padding:0; margin:0; }
.lb-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border-bottom:1px solid rgba(91,155,213,.08); font-size:12px; }
.lb-row.lb-me { background:rgba(245,158,11,.10); border-radius:6px; }
.lb-rank { min-width:28px; font-weight:700; color:#64748b; text-align:center; }
.lb-rank--1 { color:#f59e0b; } .lb-rank--2 { color:#cbd5e1; } .lb-rank--3 { color:#d97706; }
.lb-uid { flex:1; color:#cbd5e1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lb-score { font-weight:700; color:#5B9BD5; }
.lb-games { font-size:10px; color:#475569; min-width:48px; text-align:right; }
.lb-empty, .lb-loading, .lb-error { text-align:center; padding:28px; font-size:12px; color:#64748b; }
.lb-error { color:#ef4444; }
`;
    document.head.appendChild(s);
}

function _buildScreen() {
    if (document.getElementById('leaderboard-screen')) return;
    const div = document.createElement('div');
    div.id = 'leaderboard-screen';
    div.className = 'screen';
    div.innerHTML = `
<div class="lb-head">
  <span class="lb-head-title">🏆 排行榜</span>
  <div>
    <button class="lb-btn" id="lb-refresh">🔄 刷新</button>
    <button class="lb-btn" id="lb-back">← 返回</button>
  </div>
</div>
<div class="lb-tabs" id="lb-tabs">
  ${TABS.map((t) => `<button class="lb-tab${t.id === _scope ? ' active' : ''}" data-scope="${t.id}">${t.label}</button>`).join('')}
</div>
<div class="lb-body" id="lb-body"><div class="lb-loading">加载中…</div></div>`;
    document.body.appendChild(div);

    div.querySelector('#lb-back')?.addEventListener('click', () => {
        _game?.showScreen('menu');
        _game?.updateShellVisibility?.();
    });
    div.querySelector('#lb-refresh')?.addEventListener('click', () => _load(_scope));
    div.querySelectorAll('.lb-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            _scope = btn.getAttribute('data-scope');
            div.querySelectorAll('.lb-tab').forEach((b) => b.classList.toggle('active', b === btn));
            _load(_scope);
        });
    });
}

async function _load(scope) {
    const body = document.getElementById('lb-body');
    if (!body) return;
    body.innerHTML = '<div class="lb-loading">加载中…</div>';
    const uid = _userId();
    const tab = TABS.find((t) => t.id === scope);
    if (tab?.needUser && !uid) {
        body.innerHTML = '<div class="lb-empty">需要登录用户后查看好友榜</div>';
        return;
    }
    try {
        const base = getApiBaseUrl().replace(/\/+$/, '');
        const q = new URLSearchParams({ scope, limit: '50' });
        if (uid) q.set('user_id', uid);
        const res = await fetch(`${base}/api/leaderboard/board?${q}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        _render(body, data);
    } catch (e) {
        body.innerHTML = `<div class="lb-error">⚠️ 加载失败：${e.message}</div>`;
    }
}

function _render(body, data) {
    const entries = data?.entries || [];
    body.innerHTML = '';
    if (data?.myRank) {
        const mine = entries.find((e) => e.isMe);
        const card = document.createElement('div');
        card.className = 'lb-myrank';
        card.innerHTML = `<span>我的排名：<b style="color:#f59e0b">#${data.myRank}</b></span><span>最高分 ${(mine?.best_score || 0).toLocaleString()}</span>`;
        body.appendChild(card);
    }
    if (!entries.length) {
        const d = document.createElement('div');
        d.className = 'lb-empty';
        d.textContent = data?.scope === 'friends' ? '还没有好友上榜，邀请好友一起玩吧！' : '暂无榜单数据';
        body.appendChild(d);
        return;
    }
    const ul = document.createElement('ul');
    ul.className = 'lb-list';
    for (const e of entries) {
        const li = document.createElement('li');
        li.className = `lb-row${e.isMe ? ' lb-me' : ''}`;
        const rankCls = e.rank <= 3 ? ` lb-rank--${e.rank}` : '';
        li.innerHTML = `
          <span class="lb-rank${rankCls}">${e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</span>
          <span class="lb-uid">${e.isMe ? '（你）' : _anon(e.user_id)}</span>
          <span class="lb-score">${Number(e.best_score).toLocaleString()}</span>
          <span class="lb-games">${e.games} 局</span>`;
        ul.appendChild(li);
    }
    body.appendChild(ul);
}

export function initLeaderboardScreen(game) {
    if (_initialized) return;
    _initialized = true;
    _game = game;
    _injectStyles();
    _buildScreen();
    if (typeof globalThis !== 'undefined') {
        globalThis.__leaderboardScreen = { open: openLeaderboardScreen };
    }
    document.getElementById('menu-leaderboard-btn')?.addEventListener('click', openLeaderboardScreen);
}

export function openLeaderboardScreen() {
    _game?.showScreen('leaderboard-screen');
    _load(_scope);
}
