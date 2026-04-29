/**
 * rankSystem.js — v10.17 段位系统（青铜→传奇 7 段位）
 *
 * 设计要点
 * --------
 * - 7 个段位 × 3 小段（青铜 III/II/I → 白银 III/II/I → ... → 传奇 III/II/I → 王者）
 * - 经验来源：每局得分 / 5 = exp（500 分 = 100 exp）
 * - 升段动画 + 限定皮肤边框
 * - 周一 00:00 周晋升 / 降级（占位：当前仅追踪经验，不强制每周下调）
 * - localStorage：openblock_rank_v1
 *
 * 段位 → 升段经验门槛：
 *   青铜 III → II → I  各 100 / 200 / 300 exp
 *   白银 III → II → I  各 400 / 600 / 800
 *   黄金 III → II → I  各 1000 / 1300 / 1700
 *   铂金 III → II → I  各 2200 / 2800 / 3500
 *   钻石 III → II → I  各 4500 / 5500 / 7000
 *   大师 III → II → I  各 9000 / 11500 / 14500
 *   传奇 III → II → I  各 18000 / 22500 / 28000
 *   王者                34000+
 *
 * 接入路径
 * --------
 *   import { initRankSystem } from './progression/rankSystem.js';
 *   initRankSystem({ game });
 */

const STORAGE_KEY = 'openblock_rank_v1';

const RANKS = [
    { name: '青铜 III', icon: '🥉', maxExp: 100,  color: '#a07050' },
    { name: '青铜 II',  icon: '🥉', maxExp: 200,  color: '#a07050' },
    { name: '青铜 I',   icon: '🥉', maxExp: 300,  color: '#a07050' },
    { name: '白银 III', icon: '🥈', maxExp: 400,  color: '#9aa5b0' },
    { name: '白银 II',  icon: '🥈', maxExp: 600,  color: '#9aa5b0' },
    { name: '白银 I',   icon: '🥈', maxExp: 800,  color: '#9aa5b0' },
    { name: '黄金 III', icon: '🥇', maxExp: 1000, color: '#e0c068' },
    { name: '黄金 II',  icon: '🥇', maxExp: 1300, color: '#e0c068' },
    { name: '黄金 I',   icon: '🥇', maxExp: 1700, color: '#e0c068' },
    { name: '铂金 III', icon: '💠', maxExp: 2200, color: '#9ec6e0' },
    { name: '铂金 II',  icon: '💠', maxExp: 2800, color: '#9ec6e0' },
    { name: '铂金 I',   icon: '💠', maxExp: 3500, color: '#9ec6e0' },
    { name: '钻石 III', icon: '💎', maxExp: 4500, color: '#73d3ff' },
    { name: '钻石 II',  icon: '💎', maxExp: 5500, color: '#73d3ff' },
    { name: '钻石 I',   icon: '💎', maxExp: 7000, color: '#73d3ff' },
    { name: '大师 III', icon: '🏆', maxExp: 9000, color: '#c084fc' },
    { name: '大师 II',  icon: '🏆', maxExp: 11500, color: '#c084fc' },
    { name: '大师 I',   icon: '🏆', maxExp: 14500, color: '#c084fc' },
    { name: '传奇 III', icon: '👑', maxExp: 18000, color: '#fcd34d' },
    { name: '传奇 II',  icon: '👑', maxExp: 22500, color: '#fcd34d' },
    { name: '传奇 I',   icon: '👑', maxExp: 28000, color: '#fcd34d' },
    { name: '王者',     icon: '🌟', maxExp: 34000, color: '#fb923c' },
];

let _game = null;

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : { exp: 0, peakExp: 0, lastSeenIdx: 0 };
    } catch { return { exp: 0, peakExp: 0, lastSeenIdx: 0 }; }
}
function _save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** 根据 exp 计算当前段位 */
function _rankFor(exp) {
    let idx = 0;
    for (let i = 0; i < RANKS.length; i++) {
        if (exp < RANKS[i].maxExp) { idx = i; break; }
        idx = i;
    }
    const r = RANKS[idx];
    const prevMax = idx === 0 ? 0 : RANKS[idx - 1].maxExp;
    return {
        idx,
        name: r.name,
        icon: r.icon,
        color: r.color,
        exp: exp - prevMax,
        maxExp: r.maxExp - prevMax,
        totalExp: exp,
    };
}

export function getCurrentRank() {
    const s = _load();
    return _rankFor(s.exp);
}

export function initRankSystem({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    const orig = game.endGame.bind(game);
    game.endGame = async (...args) => {
        const finalScore = game.score | 0;
        const r = await orig(...args);
        _onGameEnd(finalScore);
        return r;
    };

    if (typeof window !== 'undefined') {
        window.__rankSystem = {
            getCurrent: getCurrentRank,
            list: () => RANKS.slice(),
            reset: () => _save({ exp: 0, peakExp: 0, lastSeenIdx: 0 }),
        };
    }
}

function _onGameEnd(score) {
    if (score < 50) return;
    /* lightning / zen 模式不计入段位（独立模式） */
    if (_game?._lightningMode || _game?._zenMode) return;
    const expGain = Math.max(1, Math.floor(score / 5));
    const s = _load();
    const before = _rankFor(s.exp);
    s.exp += expGain;
    s.peakExp = Math.max(s.peakExp, s.exp);
    const after = _rankFor(s.exp);
    if (after.idx > before.idx) {
        _showRankUpToast(after);
        s.lastSeenIdx = after.idx;
    }
    _save(s);
}

function _showRankUpToast(rank) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); }
    el.dataset.tier = 'celebrate';
    el.innerHTML = `
        <div style="font-size:36px;line-height:1">${rank.icon}</div>
        <div style="font-weight:800;font-size:20px;margin-top:6px;color:${rank.color}">晋升 · ${rank.name}</div>
        <div style="font-size:13px;opacity:.85;margin-top:4px">本局得分让你跨越段位 — 持续游玩攀升更高</div>
    `;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 4000);
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
export const __test_only__ = { RANKS, _rankFor };
