/**
 * 赛季通行证（Season Pass）（OPT-06）
 *
 * 设计：
 *   - 30 天为一赛季；startTs 记录赛季起始时间戳
 *   - XP 来源：每局游戏结束 → 赛季 XP += 游戏 XP × 系数
 *   - 免费 / 付费双轨道奖励（付费需购买 monthly_pass）
 *   - 通过 MonetizationBus 监听 'game_over' 事件
 */

import { getFlag } from './featureFlags.js';
import { on, emit } from './MonetizationBus.js';
import { isPurchased } from './iapAdapter.js';

const STORAGE_KEY = 'openblock_mon_season_v1';
const SEASON_DURATION_MS = 30 * 86400_000;

/** 免费轨道奖励 tiers（seasonXp 达到 tier.xp 时触发） */
export const FREE_TIERS = [
    { xp: 50,  tier: 1, reward: { desc: '每日奖励 ×1.2',      icon: '⭐' } },
    { xp: 150, tier: 2, reward: { desc: '专属赛季 Banner',     icon: '🎖️' } },
    { xp: 300, tier: 3, reward: { desc: '限定皮肤碎片 ×1',     icon: '💎' } },
    { xp: 500, tier: 4, reward: { desc: '连签加速 +10%',       icon: '⚡' } },
    { xp: 800, tier: 5, reward: { desc: '限定皮肤碎片 ×3',     icon: '🌟' } },
];

/** 付费轨道额外奖励 */
export const PAID_TIERS = [
    { xp: 50,  tier: 1, reward: { desc: '所有免费奖励 ×1.5', icon: '🔱' } },
    { xp: 150, tier: 2, reward: { desc: '赛季专属皮肤（完整）', icon: '🏆' } },
    { xp: 300, tier: 3, reward: { desc: '每日 +20% XP',       icon: '🚀' } },
];

function _loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return _freshState();
}

function _freshState() {
    const now = Date.now();
    return {
        season: 1,
        startTs: now,
        endTs: now + SEASON_DURATION_MS,
        seasonXp: 0,
        claimedFreeTiers: [],
        claimedPaidTiers: [],
    };
}

function _saveState(s) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        // 同步任务积分供 skinUnlock 使用
        localStorage.setItem('openblock_mon_task_points', String(s.seasonXp ?? 0));
    } catch { /* ignore */ }
}

function _ensureSeasonValid(state) {
    if (Date.now() >= state.endTs) {
        const newSeason = (state.season ?? 1) + 1;
        const s = _freshState();
        s.season = newSeason;
        _saveState(s);
        return s;
    }
    return state;
}

/** 获取当前赛季信息 */
export function getSeasonStatus() {
    const state = _ensureSeasonValid(_loadState());
    const hasPaid = isPurchased('monthly_pass');
    const daysLeft = Math.max(0, Math.ceil((state.endTs - Date.now()) / 86400_000));

    const freeTiers = FREE_TIERS.map((t) => ({
        ...t,
        claimed: state.claimedFreeTiers.includes(t.tier),
        reached: state.seasonXp >= t.xp,
    }));
    const paidTiers = PAID_TIERS.map((t) => ({
        ...t,
        claimed: state.claimedPaidTiers.includes(t.tier),
        reached: state.seasonXp >= t.xp,
        locked: !hasPaid,
    }));

    return {
        season: state.season,
        seasonXp: state.seasonXp,
        daysLeft,
        hasPaid,
        freeTiers,
        paidTiers,
    };
}

/** 添加赛季 XP（由 game_over 事件驱动） */
export function addSeasonXp(xpAmount) {
    let state = _ensureSeasonValid(_loadState());
    const hasPaid = isPurchased('monthly_pass');
    const mul = hasPaid ? 1.2 : 1.0;
    state.seasonXp = (state.seasonXp ?? 0) + Math.round(xpAmount * mul);

    // 检查新达成的 tiers
    const newFreeTiers = FREE_TIERS.filter(
        (t) => state.seasonXp >= t.xp && !state.claimedFreeTiers.includes(t.tier)
    );
    if (newFreeTiers.length) {
        state.claimedFreeTiers = [...state.claimedFreeTiers, ...newFreeTiers.map((t) => t.tier)];
        for (const tier of newFreeTiers) {
            emit('season_tier_unlocked', { tier, track: 'free' });
            _showTierToast(tier, false);
        }
    }

    if (hasPaid) {
        const newPaidTiers = PAID_TIERS.filter(
            (t) => state.seasonXp >= t.xp && !state.claimedPaidTiers.includes(t.tier)
        );
        if (newPaidTiers.length) {
            state.claimedPaidTiers = [...state.claimedPaidTiers, ...newPaidTiers.map((t) => t.tier)];
            for (const tier of newPaidTiers) {
                emit('season_tier_unlocked', { tier, track: 'paid' });
                _showTierToast(tier, true);
            }
        }
    }

    _saveState(state);
}

function _showTierToast(tier, isPaid) {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'mon-toast mon-season-toast';
    el.innerHTML = `
        <span class="mon-toast-icon">${tier.reward.icon}</span>
        <span>${isPaid ? '付费' : '免费'}通行证 Tier ${tier.tier} 达成！</span>
        <span class="mon-toast-desc">${tier.reward.desc}</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('mon-toast-visible'), 10);
    setTimeout(() => { el.classList.remove('mon-toast-visible'); setTimeout(() => el.remove(), 400); }, 4000);
}

/** 初始化：监听 game_over 事件，将游戏 XP 同步到赛季 XP
 *
 * 注意：game.js 的 logBehavior(GAME_OVER) 在 applyGameEndProgression 之前触发，
 * 因此 data 中没有 xpGained。改为从得分/消行估算 XP（与 computeXpGain 公式对齐）。
 */
export function initSeasonPass() {
    if (!getFlag('seasonPass')) return;

    on('game_over', ({ data }) => {
        const score = Number(data?.finalScore ?? 0);
        const clears = Number(data?.totalClears ?? 0);
        // 与 progression.js computeXpGain 基础公式对齐（不含当日首局奖励等）
        const estimatedXp = Math.max(10, Math.floor(score * 0.12) + Math.floor(clears * 1.5));
        addSeasonXp(estimatedXp);
    });
}
