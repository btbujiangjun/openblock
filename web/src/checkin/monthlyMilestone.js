/**
 * monthlyMilestone.js — v10.17 月度签到里程碑（防御-③）
 *
 * 设计要点
 * --------
 * 在现有 7 日签到（checkInPanel.js）基础上增加月度里程碑层：
 *   - 第 7 / 14 / 21 / 28 天里程碑奖励（基于 totalDays，不重置）
 *   - 月底（≥ 28 天）触发"皮肤永久解锁"机会：
 *     从 TRIAL_SKIN_POOL 选一款随机解锁（与 skinFragments 共享池）
 *
 * 复用 openblock_checkin_v1 的 totalDays 字段，无需新增存储 key
 * 自身存储 openblock_monthly_milestone_v1 = { lastMilestoneDay }
 *
 * 接入路径
 * --------
 *   import { initMonthlyMilestone } from './checkin/monthlyMilestone.js';
 *   initMonthlyMilestone();
 */

import { getWallet } from '../skills/wallet.js';
import { persistCheckinBundleToServer } from './checkinSync.js';

const SELF_KEY = 'openblock_monthly_milestone_v1';
const CHECKIN_KEY = 'openblock_checkin_v1';
const FRAGMENT_UNLOCK_KEY = 'openblock_skin_fragments_v1';

const MILESTONES = [
    { totalDays: 7,  reward: { hintToken: 3, undoToken: 2 },              label: '第 7 天 · 一周达成' },
    { totalDays: 14, reward: { hintToken: 4, bombToken: 1 },              label: '第 14 天 · 半月达成' },
    { totalDays: 21, reward: { hintToken: 5, undoToken: 3, rainbowToken: 1 }, label: '第 21 天 · 三周达成' },
    { totalDays: 28, reward: { hintToken: 6, bombToken: 2, rainbowToken: 1, fragment: 10 }, label: '第 28 天 · 月度达成' },
    { totalDays: 30, reward: { hintToken: 8, fragment: 15, _unlockSkin: true }, label: '第 30 天 · 月底大奖（解锁限定皮肤）' },
];

const SKIN_POOL = ['forbidden', 'demon', 'fairy', 'aurora', 'industrial', 'mahjong'];

function _loadSelf() {
    try {
        const raw = localStorage.getItem(SELF_KEY);
        return raw ? JSON.parse(raw) : { lastMilestoneDay: 0 };
    } catch { return { lastMilestoneDay: 0 }; }
}
function _saveSelf(s) { try { localStorage.setItem(SELF_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

function _readTotalDays() {
    try {
        const raw = localStorage.getItem(CHECKIN_KEY);
        if (!raw) return 0;
        return (JSON.parse(raw).totalDays | 0);
    } catch { return 0; }
}

export function initMonthlyMilestone() {
    setTimeout(_check, 2200);
    if (typeof window !== 'undefined') {
        window.__monthlyMilestone = {
            check: _check,
            list: () => MILESTONES.slice(),
            reset: () => _saveSelf({ lastMilestoneDay: 0 }),
        };
    }
}

function _check() {
    const totalDays = _readTotalDays();
    const self = _loadSelf();
    const triggered = MILESTONES.filter(m => totalDays >= m.totalDays && self.lastMilestoneDay < m.totalDays);
    if (triggered.length === 0) return;

    /* 一次只发一项，按从小到大依次推进；防止从 0 跳到 30 一次发 5 个礼包 */
    const m = triggered[0];
    self.lastMilestoneDay = m.totalDays;
    _saveSelf(self);
    _grantReward(m);
    persistCheckinBundleToServer();
}

function _grantReward(m) {
    const wallet = getWallet();
    let unlockedSkin = null;
    for (const [k, v] of Object.entries(m.reward)) {
        if (k === '_unlockSkin') {
            unlockedSkin = _unlockRandomSkin();
        } else {
            wallet.addBalance(k, v, 'monthly-milestone');
        }
    }
    _showToast(m, unlockedSkin);
}

function _unlockRandomSkin() {
    try {
        const raw = localStorage.getItem(FRAGMENT_UNLOCK_KEY);
        const s = raw ? JSON.parse(raw) : { unlocked: [] };
        const candidates = SKIN_POOL.filter(skin => !(s.unlocked || []).includes(skin));
        if (candidates.length === 0) return null;
        const skinId = candidates[Math.floor(Math.random() * candidates.length)];
        s.unlocked = [...(s.unlocked || []), skinId];
        localStorage.setItem(FRAGMENT_UNLOCK_KEY, JSON.stringify(s));
        return skinId;
    } catch { return null; }
}

function _showToast(milestone, unlockedSkin) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); }
    el.dataset.tier = 'celebrate';
    el.innerHTML = `<div style="font-size:34px;line-height:1">📅</div>
                    <div style="font-weight:800;font-size:18px;margin-top:6px">${milestone.label}</div>
                    ${unlockedSkin ? `<div style="font-size:14px;opacity:.92;margin-top:4px;color:#fcd34d">永久解锁 · ${unlockedSkin}</div>` : ''}`;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 4000);
}

/** hydrate 服务端签到数据后重算月度里程碑（避免先于 totalDays 计时） */
export function recheckMonthlyAfterHydrate() {
    _check();
}

/** 测试用 */
export function __resetForTest() {
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(SELF_KEY); } catch { /* ignore */ }
    }
}
export const __test_only__ = { MILESTONES, SKIN_POOL, _check };
