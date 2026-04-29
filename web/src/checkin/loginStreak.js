/**
 * loginStreak.js — v10.16 连登勋章（P1）
 *
 * 当用户在 checkInPanel 累计签到达到 7 / 30 / 100 / 365 天时弹出勋章 toast。
 * localStorage `openblock_login_streak_v1` 记录已解锁的里程碑。
 */

const STORAGE_KEY = 'openblock_login_streak_v1';

const MILESTONES = [
    { days: 7,   id: 'streak_7d',   icon: '🥉', label: '连签 7 天勋章', reward: { hintToken: 5 } },
    { days: 30,  id: 'streak_30d',  icon: '🥈', label: '连签 30 天勋章', reward: { hintToken: 10, undoToken: 5, bombToken: 1 } },
    { days: 100, id: 'streak_100d', icon: '🥇', label: '连签 100 天勋章', reward: { hintToken: 30, undoToken: 15, bombToken: 5, rainbowToken: 5 } },
    { days: 365, id: 'streak_365d', icon: '👑', label: '连签 365 天传奇', reward: { hintToken: 100, undoToken: 50, bombToken: 20, rainbowToken: 20 } },
];

function _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
}
function _save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let _audio = null;

export function initLoginStreak({ audio = null } = {}) {
    _audio = audio;
    if (typeof window !== 'undefined') {
        window.__loginStreak = { checkMilestone, getMedals };
    }
}

export function checkMilestone(checkInState) {
    if (!checkInState) return;
    const unlocked = _load();
    const totalDays = checkInState.totalDays | 0;
    for (const m of MILESTONES) {
        if (totalDays >= m.days && !unlocked[m.id]) {
            unlocked[m.id] = { unlockedAt: Date.now(), totalDays };
            _save(unlocked);
            _grantReward(m);
            _showMilestoneToast(m);
        }
    }
}

export function getMedals() {
    return _load();
}

async function _grantReward(milestone) {
    try {
        const { getWallet } = await import('../skills/wallet.js');
        const wallet = getWallet();
        for (const [k, v] of Object.entries(milestone.reward || {})) {
            wallet.addBalance(k, v, `login-streak-${milestone.id}`);
        }
    } catch { /* ignore */ }
}

function _showMilestoneToast(m) {
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    el.textContent = `${m.icon} ${m.label} 已解锁`;
    el.dataset.tier = 'celebrate';   // 连登勋章为罕见庆贺事件
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 5000);
    _audio?.play?.('unlock');
    _audio?.vibrate?.([40, 60, 40, 60, 80]);
}

export const __test_only__ = { MILESTONES };
