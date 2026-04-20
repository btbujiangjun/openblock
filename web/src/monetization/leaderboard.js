/**
 * 在线排行榜（OPT-04）
 *
 * 设计：
 *   - 游戏结束时自动提交当日得分（仅本地最高分更新时）
 *   - 提供 openLeaderboardPanel() 显示今日榜单
 *   - 与后端 /api/mon/leaderboard 通信
 */

import { getFlag } from './featureFlags.js';
import { on } from './MonetizationBus.js';
import { getApiBaseUrl } from '../config.js';

const LB_KEY = 'openblock_mon_lb_lastSubmit';

function _apiBase() {
    return getApiBaseUrl().replace(/\/+$/, '');
}

async function _post(path, body) {
    try {
        const res = await fetch(`${_apiBase()}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

async function _get(path) {
    try {
        const res = await fetch(`${_apiBase()}${path}`);
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

/** 提交本局最终得分到日榜 */
export async function submitScore(userId, score, strategy) {
    if (!getFlag('leaderboard')) return;
    return _post('/api/mon/leaderboard/submit', { userId, score, strategy });
}

/** 获取今日 Top-N 日榜（limit 默认 20） */
export async function fetchDailyLeaderboard(limit = 20) {
    const data = await _get(`/api/mon/leaderboard/daily?limit=${limit}`);
    return data?.entries ?? [];
}

/** 初始化：监听 game_over 事件后自动提交 */
export function initLeaderboard() {
    if (!getFlag('leaderboard')) return;

    on('game_over', ({ data, game }) => {
        const score = data?.finalScore ?? game?.score ?? 0;
        const userId = game?.db?.userId;
        const strategy = game?.strategy ?? 'normal';
        if (!userId || score <= 0) return;

        // 仅当本局超过今日已提交最高分时上报
        const lastKey = `${LB_KEY}_${_todayYmd()}`;
        let lastSubmitted = 0;
        try { lastSubmitted = Number(localStorage.getItem(lastKey) ?? 0); } catch { /* ignore */ }

        if (score > lastSubmitted) {
            try { localStorage.setItem(lastKey, String(score)); } catch { /* ignore */ }
            void submitScore(userId, score, strategy);
        }
    });
}

function _todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 打开排行榜 UI 面板 */
export async function openLeaderboardPanel() {
    if (typeof document === 'undefined') return;

    const existing = document.getElementById('mon-lb-panel');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id = 'mon-lb-panel';
    panel.className = 'mon-panel';
    panel.innerHTML = `
        <div class="mon-panel-header">
            <span>🏆 今日排行榜</span>
            <button class="mon-panel-close" id="mon-lb-close">×</button>
        </div>
        <div class="mon-lb-body" id="mon-lb-body">
            <div class="mon-lb-loading">加载中…</div>
        </div>`;
    document.body.appendChild(panel);
    panel.querySelector('#mon-lb-close').onclick = () => panel.remove();

    const entries = await fetchDailyLeaderboard(20);
    const body = panel.querySelector('#mon-lb-body');
    if (!entries.length) {
        body.innerHTML = '<div class="mon-lb-empty">今日暂无记录，快来上榜！</div>';
        return;
    }

    const userId = (() => {
        try { return localStorage.getItem('bb_user_id') ?? ''; } catch { return ''; }
    })();

    body.innerHTML = entries.map((e, i) => {
        const isMe = e.user_id === userId;
        return `<div class="mon-lb-row${isMe ? ' mon-lb-me' : ''}">
            <span class="mon-lb-rank">#${i + 1}</span>
            <span class="mon-lb-uid">${isMe ? '（你）' : _anonymize(e.user_id)}</span>
            <span class="mon-lb-score">${e.score.toLocaleString()}</span>
        </div>`;
    }).join('');
}

function _anonymize(uid) {
    if (!uid) return '—';
    return uid.slice(0, 3) + '***';
}
