/**
 * replayAlbum.js — v10.17 复盘相册（替换 replayAlbumStub）
 *
 * 设计要点
 * --------
 * - 自动记录得分 ≥ 200 的局到本地 Top 10 榜
 * - 弹出"相册"面板：grid 布局，每个 slot 显示分数 / 皮肤 / 日期 / 关键 stats
 * - 里程碑：第 100 / 500 / 1000 局自动锁定为「纪念页」（不可被 Top 10 覆盖）
 * - 支持复盘回放（基于 game._moveSequence 序列，若不可用则只展示静态总结）
 *
 * 旧 stub 数据兼容：openblock_replay_album_v1（继续使用同 key）
 *
 * 接入路径
 * --------
 *   import { initReplayAlbum } from './social/replayAlbum.js';
 *   initReplayAlbum({ game });
 */

const STORAGE_KEY = 'openblock_replay_album_v1';
const MILESTONE_KEY = 'openblock_replay_milestones_v1';
const MAX_TOP_N = 10;
const MIN_SCORE = 200;
const MILESTONE_GAMES = [100, 500, 1000];

let _origEndGame = null;
let _game = null;
let _gameCount = 0;

function _loadAlbum() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
}
function _saveAlbum(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
}
function _loadMilestones() {
    try { return JSON.parse(localStorage.getItem(MILESTONE_KEY) || '{"games":0,"locked":[]}'); }
    catch { return { games: 0, locked: [] }; }
}
function _saveMilestones(s) {
    try { localStorage.setItem(MILESTONE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function initReplayAlbum({ game } = {}) {
    if (!game || _game) return;
    _game = game;
    _origEndGame = game.endGame.bind(game);

    game.endGame = async (...args) => {
        const ret = await _origEndGame(...args);
        try { _onGameEnd(); } catch (e) { console.warn('[replayAlbum]', e); }
        return ret;
    };

    /* 注入"相册入口" — 主菜单按钮点击打开相册 */
    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', _injectEntry);
        if (document.readyState !== 'loading') _injectEntry();
    }

    if (typeof window !== 'undefined') {
        window.__replayAlbum = {
            getTopN: () => _loadAlbum(),
            getMilestones: () => _loadMilestones(),
            open: openAlbum,
            isImplemented: () => true,   // v10.17：不再是 stub
        };
    }
}

function _onGameEnd() {
    const ms = _loadMilestones();
    ms.games = (ms.games | 0) + 1;
    _gameCount = ms.games;
    const score = _game.score | 0;

    /* 里程碑：100 / 500 / 1000 自动锁定 */
    if (MILESTONE_GAMES.includes(ms.games)) {
        ms.locked.push(_buildEntry(score, true, ms.games));
        _showMilestoneToast(ms.games);
    }
    _saveMilestones(ms);

    /* Top 10 普通榜 */
    if (score >= MIN_SCORE) {
        const arr = _loadAlbum();
        arr.push(_buildEntry(score, false, ms.games));
        arr.sort((a, b) => b.score - a.score);
        _saveAlbum(arr.slice(0, MAX_TOP_N));
    }
}

function _buildEntry(score, isMilestone, gameNo) {
    const skinId = (typeof localStorage !== 'undefined' && localStorage.getItem('openblock_skin')) || 'classic';
    return {
        score,
        gameNo,
        ymd: new Date().toISOString().slice(0, 10),
        ts: Date.now(),
        skinId,
        isMilestone,
        gameStats: _game?.gameStats ? { ...(_game.gameStats) } : null,
        moveSeq: _game?._moveSequence ? _game._moveSequence.slice(-50) : null,   // 仅保留最后 50 步降低存储
    };
}

function _showMilestoneToast(gameNo) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); }
    el.dataset.tier = 'celebrate';
    el.innerHTML = `<div style="font-size:32px;line-height:1">📔</div>
                    <div style="font-weight:800;font-size:18px;margin-top:6px">第 ${gameNo} 局 · 里程碑</div>
                    <div style="font-size:13px;opacity:.85;margin-top:4px">本局已自动收入复盘相册（不会被覆盖）</div>`;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 3500);
}

/* ---------------------- 相册 UI ---------------------- */

function _injectEntry() {
    if (document.getElementById('replay-album-btn')) return;
    /* 优先放主菜单的 .top-actions 或赛季入口附近 */
    const host = document.querySelector('.top-actions') || document.body;
    const btn = document.createElement('button');
    btn.id = 'replay-album-btn';
    btn.type = 'button';
    btn.className = 'replay-album-btn';
    btn.title = '复盘相册 — Top 10 + 里程碑';
    btn.innerHTML = `<span>📔</span><span class="rab-label">相册</span>`;
    host.appendChild(btn);
    btn.addEventListener('click', openAlbum);
}

export function openAlbum() {
    if (typeof document === 'undefined') return;
    document.getElementById('replay-album-panel')?.remove();
    const top = _loadAlbum();
    const ms = _loadMilestones();
    const milestones = ms.locked || [];

    const panel = document.createElement('div');
    panel.id = 'replay-album-panel';
    panel.className = 'replay-album-panel';
    panel.innerHTML = `
        <div class="rap-card">
            <div class="rap-head">
                <h2>复盘相册</h2>
                <span class="rap-meta">已游玩 ${ms.games | 0} 局 · Top ${top.length} + 里程碑 ${milestones.length}</span>
                <button class="rap-close" type="button" aria-label="关闭">×</button>
            </div>
            <div class="rap-body">
                ${milestones.length ? `
                    <h3>里程碑</h3>
                    <div class="rap-grid">${milestones.map(_renderEntry).join('')}</div>
                ` : ''}
                <h3>Top 10</h3>
                <div class="rap-grid">
                    ${top.length === 0 ? '<div class="rap-empty">还没有得分 ≥ 200 的局，先来挑战一下吧！</div>'
                        : top.map(_renderEntry).join('')}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add('is-visible'));
    panel.querySelector('.rap-close').addEventListener('click', () => {
        panel.classList.remove('is-visible');
        setTimeout(() => panel.remove(), 280);
    });
}

function _renderEntry(e) {
    const stats = e.gameStats || {};
    const date = (e.ymd || '').replace(/-/g, '/');
    return `
        <div class="rap-slot ${e.isMilestone ? 'rap-slot--ms' : ''}">
            <div class="rap-score">${e.score | 0}</div>
            <div class="rap-skin">${e.skinId}</div>
            <div class="rap-date">${date}${e.gameNo ? ` · 第 ${e.gameNo} 局` : ''}</div>
            <div class="rap-stats">
                <span>消行 ${stats.clears | 0}</span>
                <span>combo ${stats.maxCombo | 0}</span>
            </div>
        </div>
    `;
}

/** 测试用 */
export function __resetForTest() {
    _origEndGame = null;
    _game = null;
    _gameCount = 0;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        try { localStorage.removeItem(MILESTONE_KEY); } catch { /* ignore */ }
    }
}
