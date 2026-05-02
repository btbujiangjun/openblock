/**
 * dailyMaster.js — v10.16 每日大师题（P1）
 *
 * 每日全网同种子（基于 ymd hash），让玩家在相同盘面 / 同序出块下比拼。
 * 简化实现：注入 spawnFn 让 game.start 时使用日固定 seed，并在结算时上报到 leaderboard（如已启用）。
 *
 * 设计要点
 * --------
 * - **可选模式**：菜单 / 顶栏新增「每日大师题」按钮，点击后启动专题局
 * - **种子**：FNV-1a hash(ymd) → uint32，注入到 spawnFn 的伪随机源
 * - **比拼**：分数提交到 monetization/leaderboard.js 的 daily 榜（同种子才公平）
 * - **限制**：每日仅可挑战一次（防刷分）
 */

import { applyDom, t } from '../i18n/i18n.js';

const KEY = 'openblock_daily_master_v1';

function _ymd() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }

/* FNV-1a 32 位 hash，用作日种子 */
function _fnv1a(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
}

function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
}
function _save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

let _game = null;
let _audio = null;

export function initDailyMaster({ game, audio = null } = {}) {
    _game = game;
    _audio = audio;
    if (typeof window !== 'undefined') {
        window.__dailyMaster = {
            getSeed: () => _fnv1a(_ymd()),
            startChallenge,
            getState: () => _load(),
            isPlayedToday: () => _load()[_ymd()]?.played === true,
        };
    }

    _bindMenuButton();
}

/** 主菜单 #menu 内已静态挂载按钮；否则回退注入到 .menu-grid（兼容旧 HTML / 测试） */
function _bindMenuButton() {
    let btn = document.getElementById('menu-daily-master-btn');
    if (btn?.dataset.dmBound === '1') return;
    const menu = document.getElementById('menu');
    if (!btn && menu) {
        const grid = menu.querySelector('.menu-grid');
        if (!grid) return;
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'menu-daily-master-btn';
        btn.className = 'menu-card menu-card--daily-master menu-card--menu-secondary';
        btn.innerHTML = `
        <span class="menu-card-icon">🏅</span>
        <span class="menu-card-label" data-i18n="menu.dailyMaster">每日大师题</span>
    `;
        grid.appendChild(btn);
        applyDom(menu);
    }
    if (!btn) return;
    btn.dataset.dmBound = '1';
    btn.addEventListener('click', startChallenge);
}

export function startChallenge() {
    if (!_game) return;
    const ymd = _ymd();
    const state = _load();
    if (state[ymd]?.played) {
        _showToast(t('dailyMaster.alreadyPlayed'));
        return;
    }

    const seed = _fnv1a(ymd);
    /* 用全局 spawnFn（v10.x 已注入）外面包一层伪随机生成器 */
    const origSpawnFn = window.__spawnFn;
    let prng = _mulberry32(seed);
    const seedSpawnFn = (ctx, count = 3) => {
        const oldRandom = Math.random;
        Math.random = prng;
        try { return origSpawnFn(ctx, count); }
        finally { Math.random = oldRandom; }
    };
    window.__spawnFn = seedSpawnFn;

    /* 装饰 endGame，挑战完成后恢复 spawnFn 并写入战绩 */
    const origEndGame = _game.endGame.bind(_game);
    _game.endGame = async (...args) => {
        const ret = await origEndGame(...args);
        window.__spawnFn = origSpawnFn;
        _game.endGame = origEndGame;
        _onChallengeEnd(_game);
        return ret;
    };

    _audio?.play?.('unlock');
    _showToast(t('dailyMaster.toastSeed', { seed: seed.toString(36).toUpperCase() }));
    try {
        _game.start({ fromChain: false, dailyMaster: true });
    } catch (e) { console.warn('[dailyMaster]', e); }
}

function _mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _onChallengeEnd(game) {
    const ymd = _ymd();
    const state = _load();
    state[ymd] = { played: true, score: game.score | 0, ts: Date.now() };
    _save(state);

    /* 上报到日榜（如已启用 monetization） */
    try {
        const submit = window.__leaderboard?.submitScore || null;
        if (typeof submit === 'function') {
            submit('local', game.score | 0, 'daily-master');
        }
    } catch { /* ignore */ }

    _audio?.play?.('combo');
    _showToast(t('dailyMaster.toastComplete', { score: game.score | 0 }));
}

function _showToast(msg) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 4500);
}
