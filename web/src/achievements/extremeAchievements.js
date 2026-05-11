/**
 * extremeAchievements.js — v10.16 极限成就（P1）
 *
 * 在原有 progression.js 成就之外，新增"极限挑战"类成就：
 *   - 单局 7 次 perfect（盘面清空）
 *   - 单局触发 8 种 bonus
 *   - 单局 combo ≥ 12
 *   - 单局得分 ≥ 5000
 *   - 累计游戏 100 局 / 1000 局
 *   - 累计连续打卡（接 loginStreak）
 *
 * 解锁后弹勋章 toast + 永久勋章墙。
 *
 * 实施
 * ----
 * - 接入 MonetizationBus 的 'clear' 和 'game_over' 事件
 * - localStorage `openblock_extreme_achievements_v1` 记录解锁状态
 * - 单局变量在 game_over 时统计；累计变量持久化
 */

import { getWallet } from '../skills/wallet.js';
import { t } from '../i18n/i18n.js';

const KEY = 'openblock_extreme_achievements_v1';

const ACHIEVEMENTS = [
    { id: 'perfect_x7',     icon: '💎', label: '神之手 — 单局 7 次盘面清空', reward: { hintToken: 10, rainbowToken: 1 } },
    { id: 'bonus_8types',   icon: '🌈', label: '万象 — 单局触发 8 种 bonus', reward: { rainbowToken: 1 } },
    { id: 'combo_12',       icon: '⚡', label: '雷光 — 单局 combo ≥ 12', reward: { hintToken: 5, undoToken: 2 } },
    { id: 'score_5000',     icon: '🏆', label: '荣誉 — 单局得分 ≥ 5000', reward: { hintToken: 8 } },
    { id: 'games_100',      icon: '🎯', label: '百战 — 累计游戏 100 局', reward: { hintToken: 20, bombToken: 1 } },
    { id: 'games_1000',     icon: '👑', label: '千锤 — 累计游戏 1000 局', reward: { hintToken: 100, bombToken: 5, rainbowToken: 5 } },
];

function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
}
function _save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

let _audio = null;
let _origEndGame = null;

/* 单局累计变量（每局开始重置） */
let _perGame = _emptyPerGame();
let _cumulative = null;

function _emptyPerGame() {
    return { perfectCount: 0, bonusTypes: new Set(), maxCombo: 0, score: 0 };
}

export function initExtremeAchievements({ game, audio = null } = {}) {
    if (!game || _origEndGame) return;
    _audio = audio;
    _cumulative = _load();
    _cumulative.gamesPlayed = _cumulative.gamesPlayed | 0;

    /* 装饰 game.start 重置单局统计 */
    const origStart = game.start.bind(game);
    game.start = async (...args) => {
        _perGame = _emptyPerGame();
        return origStart(...args);
    };

    /* 装饰 game.endGame 触发结算 */
    _origEndGame = game.endGame.bind(game);
    game.endGame = async (...args) => {
        const ret = await _origEndGame(...args);
        try { _onGameEnd(game); } catch (e) { console.warn('[extremeAch]', e); }
        return ret;
    };

    /* 通过监听 renderer 装饰捕获 perfect / bonus 计数 */
    _hookRenderer(game.renderer);
}

function _hookRenderer(r) {
    if (!r || r.__extremeAchHooked) return;
    r.__extremeAchHooked = true;
    const origPerfect = r.triggerPerfectFlash?.bind(r);
    if (typeof origPerfect === 'function') {
        r.triggerPerfectFlash = (...args) => {
            _perGame.perfectCount++;
            return origPerfect(...args);
        };
    }
    const origBonus = r.triggerBonusMatchFlash?.bind(r);
    if (typeof origBonus === 'function') {
        r.triggerBonusMatchFlash = (count, ...rest) => {
            _perGame.bonusTypes.add('any');
            return origBonus(count, ...rest);
        };
    }
}

function _onGameEnd(game) {
    const score = game.score | 0;
    _perGame.score = score;
    _perGame.maxCombo = game.gameStats?.maxCombo | 0;

    _cumulative.gamesPlayed = (_cumulative.gamesPlayed | 0) + 1;
    _save(_cumulative);

    const triggered = [];
    if (_perGame.perfectCount >= 7) triggered.push('perfect_x7');
    if (_perGame.bonusTypes.size >= 8) triggered.push('bonus_8types');
    if (_perGame.maxCombo >= 12) triggered.push('combo_12');
    if (_perGame.score >= 5000) triggered.push('score_5000');
    if (_cumulative.gamesPlayed >= 100) triggered.push('games_100');
    if (_cumulative.gamesPlayed >= 1000) triggered.push('games_1000');

    for (const id of triggered) {
        if (!_cumulative[id]) {
            const ach = ACHIEVEMENTS.find(a => a.id === id);
            if (ach) {
                _cumulative[id] = { unlockedAt: Date.now() };
                _save(_cumulative);
                _grant(ach);
                _showToast(ach);
            }
        }
    }
}

function _grant(ach) {
    const wallet = getWallet();
    for (const [k, v] of Object.entries(ach.reward || {})) {
        wallet.addBalance(k, v, `ach-${ach.id}`);
    }
}

function _showToast(ach) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    el.textContent = t('reward.extremeAchievement', { icon: ach.icon, label: ach.label });
    el.dataset.tier = 'celebrate';   // 极限成就解锁为罕见庆贺事件
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 5500);

    _audio?.play?.('unlock');
    _audio?.vibrate?.([40, 80, 40, 80, 80]);
}

export function getUnlockedAchievements() {
    return _load();
}

export const __test_only__ = { ACHIEVEMENTS };
