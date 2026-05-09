/**
 * skinFragments.js — v10.17 皮肤碎片合成系统
 *
 * 设计要点
 * --------
 * - 每天首局结束自动 +1 fragment（来源 'daily-play'）
 * - 高分局 ≥ 1000 额外 +1 fragment（'high-score'）
 * - perfect 局额外 +2 fragment（'perfect'）
 * - 每日发放上限 5（在 wallet 中已设定）
 * - 30 个 fragment 解锁一款随机限定皮肤（永久解锁）
 * - localStorage：openblock_skin_fragments_v1 = { unlocked, lastEarnYmd, ... }
 *   在 VITE_USE_SQLITE_DB 下由 checkinSync 与 /api/checkin-bundle 同步（碎片余额仍走钱包）
 *
 * 限定皮肤池：与 checkInPanel 第 7 天试穿券共享池
 *
 * 接入路径
 * --------
 *   import { initSkinFragments } from './progression/skinFragments.js';
 *   initSkinFragments({ game });
 */

import { getWallet } from '../skills/wallet.js';
import { persistCheckinBundleToServer } from '../checkin/checkinSync.js';

const STORAGE_KEY = 'openblock_skin_fragments_v1';
const COST_PER_UNLOCK = 30;
const FRAGMENT_POOL = ['forbidden', 'demon', 'fairy', 'aurora', 'industrial', 'mahjong', 'boardgame'];

let _game = null;
let _todayFirstWin = false;

function _ymd(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : { unlocked: [], lastEarnYmd: null };
    } catch { return { unlocked: [], lastEarnYmd: null }; }
}
function _save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function initSkinFragments({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    const orig = game.endGame.bind(game);
    game.endGame = async (...args) => {
        const score = game.score | 0;
        const stats = game.gameStats || {};
        const r = await orig(...args);
        _onGameEnd(score, stats);
        return r;
    };

    if (typeof window !== 'undefined') {
        window.__skinFragments = {
            getUnlocked: () => _load().unlocked.slice(),
            tryUnlock: tryUnlockRandom,
            costPerUnlock: COST_PER_UNLOCK,
            pool: () => FRAGMENT_POOL.slice(),
        };
    }
}

function _onGameEnd(score, stats) {
    const s = _load();
    const today = _ymd();
    const wallet = getWallet();
    let totalAdd = 0;

    /* 每天首局 +1（独立次数：当 lastEarnYmd ≠ 今天） */
    if (s.lastEarnYmd !== today) {
        totalAdd += 1;
        s.lastEarnYmd = today;
    }
    if (score >= 1000) totalAdd += 1;
    if (stats.perfectCount && stats.perfectCount > 0) totalAdd += 2;

    if (totalAdd > 0) {
        wallet.addBalance('fragment', totalAdd, 'skin-fragment-earn');
    }
    _save(s);
    persistCheckinBundleToServer();

    /* 自动尝试解锁 */
    if (wallet.getBalance('fragment') >= COST_PER_UNLOCK) {
        tryUnlockRandom();
    }
}

export function tryUnlockRandom() {
    const wallet = getWallet();
    if (wallet.getBalance('fragment') < COST_PER_UNLOCK) return null;
    const s = _load();
    const candidates = FRAGMENT_POOL.filter(skin => !s.unlocked.includes(skin));
    if (candidates.length === 0) return null;
    const skinId = candidates[Math.floor(Math.random() * candidates.length)];
    if (!wallet.spend('fragment', COST_PER_UNLOCK, 'skin-fragment-spend')) return null;
    s.unlocked.push(skinId);
    _save(s);
    persistCheckinBundleToServer();
    _showUnlockToast(skinId);
    return skinId;
}

function _showUnlockToast(skinId) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); }
    el.dataset.tier = 'celebrate';
    el.innerHTML = `<div style="font-size:34px;line-height:1">🔧</div>
                    <div style="font-weight:800;font-size:18px;margin-top:6px">皮肤解锁 · ${skinId}</div>
                    <div style="font-size:13px;opacity:.85;margin-top:4px">30 个碎片 → 永久使用</div>`;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 3500);
}

/** 测试用 */
export function __resetForTest() {
    _game = null; _todayFirstWin = false;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
export const __test_only__ = { COST_PER_UNLOCK, FRAGMENT_POOL };
