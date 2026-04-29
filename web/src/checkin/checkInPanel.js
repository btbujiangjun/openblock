/**
 * checkInPanel.js — v10.16 7 日签到日历 + 限定皮肤试穿券（Top P0 #4）
 *
 * 每日首次进入弹日历，第 7 天大奖 = 24h 限定皮肤试穿券。
 * 连续打卡 7 / 30 / 100 / 365 天解锁勋章（loginStreak.js）。
 *
 * 设计要点
 * --------
 * - **localStorage**：openblock_checkin_v1 = { lastClaimYmd, streak, totalDays, history }
 * - **自动弹窗**：每日首次启动游戏时检查，未签到则弹窗
 * - **奖励发放**：通过 wallet 发放 hint/undo/bomb/rainbow token + 试穿券
 * - **断签处理**：断 1 天 = streak 重置为 1（但 totalDays 不归零）
 *
 * 7 日奖励表
 * ----------
 *   第 1 天  +1 hintToken
 *   第 2 天  +1 hintToken + 1 undoToken
 *   第 3 天  +2 hintToken
 *   第 4 天  +1 bombToken
 *   第 5 天  +2 hintToken + 2 undoToken
 *   第 6 天  +1 rainbowToken
 *   第 7 天  +2 hintToken + 1 bombToken + 1 rainbowToken + **24h 试穿券（随机限定皮肤）**
 */

import { getWallet } from '../skills/wallet.js';
import { SKINS } from '../skins.js';

const STORAGE_KEY = 'openblock_checkin_v1';

const REWARDS = [
    { day: 1, items: { hintToken: 1 }, label: '+1 提示券' },
    { day: 2, items: { hintToken: 1, undoToken: 1 }, label: '+1 提示 +1 撤销' },
    { day: 3, items: { hintToken: 2 }, label: '+2 提示券' },
    { day: 4, items: { bombToken: 1 }, label: '+1 炸弹' },
    { day: 5, items: { hintToken: 2, undoToken: 2 }, label: '+2 提示 +2 撤销' },
    { day: 6, items: { rainbowToken: 1 }, label: '+1 彩虹' },
    { day: 7, items: { hintToken: 2, bombToken: 1, rainbowToken: 1 }, label: '+ 24h 限定皮肤试穿券' },
];

/* 限定皮肤池：第 7 天大奖随机选一款（这些皮肤当前默认锁定，签到才能体验） */
const TRIAL_SKIN_POOL = ['forbidden', 'demon', 'fairy', 'aurora', 'industrial', 'mahjong', 'boardgame'];

function _ymd(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _yesterdayYmd() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return _ymd(d);
}

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { lastClaimYmd: null, streak: 0, totalDays: 0, history: [] };
        return JSON.parse(raw);
    } catch { return { lastClaimYmd: null, streak: 0, totalDays: 0, history: [] }; }
}

function _save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { /* ignore */ }
}

let _audio = null;

export function initCheckIn(opts = {}) {
    _audio = opts.audio || null;
    // 等 DOM 就绪后再弹
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _maybeOpen, { once: true });
    } else {
        setTimeout(_maybeOpen, 1500);    // 让 game.init 先完成
    }
    if (typeof window !== 'undefined') {
        window.__checkIn = { open: openCheckInPanel, getState: getCheckInState };
    }
}

function _maybeOpen() {
    const s = _load();
    const today = _ymd();
    if (s.lastClaimYmd === today) return;    // 今日已签
    openCheckInPanel();
}

export function getCheckInState() { return _load(); }

export function openCheckInPanel() {
    const state = _load();
    const today = _ymd();
    const alreadyClaimed = state.lastClaimYmd === today;

    // 计算今天将是 streak 的第几天
    let nextStreakDay;
    if (state.lastClaimYmd === today) {
        nextStreakDay = ((state.streak - 1) % 7) + 1;
    } else if (state.lastClaimYmd === _yesterdayYmd()) {
        nextStreakDay = (state.streak % 7) + 1;
    } else {
        nextStreakDay = 1;
    }

    _renderModal(nextStreakDay, alreadyClaimed, state);
}

function _renderModal(streakDay, alreadyClaimed, state) {
    let panel = document.getElementById('checkin-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'checkin-panel';
        panel.className = 'checkin-panel';
        document.body.appendChild(panel);
    }
    const dayCells = REWARDS.map(r => {
        const claimed = streakDay > r.day || (alreadyClaimed && streakDay === r.day);
        const today = !alreadyClaimed && streakDay === r.day;
        const cls = ['checkin-day'];
        if (claimed) cls.push('is-claimed');
        if (today) cls.push('is-today');
        if (r.day === 7) cls.push('is-grand');
        return `
            <div class="${cls.join(' ')}">
                <div class="checkin-day-num">第 ${r.day} 天</div>
                <div class="checkin-day-label">${r.label}</div>
                ${claimed ? '<div class="checkin-day-mark">✓</div>' : ''}
            </div>
        `;
    }).join('');

    panel.innerHTML = `
        <div class="checkin-card">
            <div class="checkin-card__head">
                <h3>每日签到</h3>
                <div class="checkin-card__sub">连续打卡 ${state.streak} 天 · 累计 ${state.totalDays} 天</div>
                <button type="button" class="checkin-close" aria-label="关闭">×</button>
            </div>
            <div class="checkin-grid">${dayCells}</div>
            <div class="checkin-actions">
                <button type="button" class="checkin-btn-claim" ${alreadyClaimed ? 'disabled' : ''}>
                    ${alreadyClaimed ? '今日已签' : '领取今日奖励'}
                </button>
            </div>
        </div>
    `;
    panel.classList.add('is-visible');

    panel.querySelector('.checkin-close').addEventListener('click', () => panel.classList.remove('is-visible'));
    panel.addEventListener('click', (e) => {
        if (e.target === panel) panel.classList.remove('is-visible');
    });

    if (!alreadyClaimed) {
        panel.querySelector('.checkin-btn-claim').addEventListener('click', () => {
            _claim();
            panel.classList.remove('is-visible');
        });
    }
}

function _claim() {
    const state = _load();
    const today = _ymd();
    if (state.lastClaimYmd === today) return false;

    if (state.lastClaimYmd === _yesterdayYmd()) {
        state.streak = (state.streak | 0) + 1;
    } else {
        state.streak = 1;
    }
    state.totalDays = (state.totalDays | 0) + 1;
    state.lastClaimYmd = today;
    state.history = [...(state.history || []), today].slice(-90);    // 保留最近 90 天

    const dayInCycle = ((state.streak - 1) % 7) + 1;
    const reward = REWARDS.find(r => r.day === dayInCycle) || REWARDS[0];
    const wallet = getWallet();
    for (const [k, v] of Object.entries(reward.items)) {
        wallet.addBalance(k, v, `checkin-day-${dayInCycle}`);
    }

    let trialMsg = '';
    if (dayInCycle === 7) {
        const pool = TRIAL_SKIN_POOL.filter(id => SKINS[id]);
        if (pool.length) {
            const chosen = pool[Math.floor(Math.random() * pool.length)];
            wallet.addTrial(chosen, 24);
            trialMsg = ` · 试穿 24h：${SKINS[chosen]?.name || chosen}`;
        }
    }

    _audio?.play?.('unlock');
    _audio?.vibrate?.([20, 40, 20]);
    _save(state);
    _showToast(`签到成功 · ${reward.label}${trialMsg}`);

    // 通知 loginStreak
    try { window.__loginStreak?.checkMilestone?.(state); } catch { /* ignore */ }
    return true;
}

function _showToast(msg) {
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
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 4000);
}

export const __test_only__ = { REWARDS, TRIAL_SKIN_POOL };
