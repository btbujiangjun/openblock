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
import { getWallet } from '../skills/wallet.js';

const STORAGE_KEY = 'openblock_mon_season_v1';
const SEASON_DURATION_MS = 30 * 86400_000;

/* v1.13：免费轨道奖励 tiers ——
 * 之前 reward 只是 desc/icon 文案，tier 标记 claimed 但**从未真正发任何东西到钱包**。
 * 现在给每个 tier 加 `wallet` 字段（结构化），表示发到钱包里的具体物品；desc 仍保留
 * 用于 toast 文案（如「碎片 ×1 + 50 金币」）；面板里玩家也能在「最近入账」看到记录。
 *
 * 注意：「每日奖励 ×1.2」「连签加速 +10%」等文案性 buff 暂时没有钱包通货承载，
 * 配套 wallet 给一个等价的 hint/coin 兜底，不让玩家完全空手而归。 */
export const FREE_TIERS = [
    { xp: 50,  tier: 1, reward: { desc: '每日奖励 ×1.2',      icon: '⭐', wallet: { hintToken: 1, coin: 30 } } },
    { xp: 150, tier: 2, reward: { desc: '专属赛季 Banner',     icon: '🎖️', wallet: { coin: 80 } } },
    { xp: 300, tier: 3, reward: { desc: '限定皮肤碎片 ×1',     icon: '💎', wallet: { fragment: 1 } } },
    { xp: 500, tier: 4, reward: { desc: '连签加速 +10%',       icon: '⚡', wallet: { hintToken: 2, coin: 60 } } },
    { xp: 800, tier: 5, reward: { desc: '限定皮肤碎片 ×3',     icon: '🌟', wallet: { fragment: 3 } } },
];

/** 付费轨道额外奖励 */
export const PAID_TIERS = [
    { xp: 50,  tier: 1, reward: { desc: '所有免费奖励 ×1.5', icon: '🔱', wallet: { hintToken: 2, coin: 80 } } },
    { xp: 150, tier: 2, reward: { desc: '赛季专属皮肤（完整）', icon: '🏆', wallet: { fragment: 5, coin: 200 } } },
    { xp: 300, tier: 3, reward: { desc: '每日 +20% XP',       icon: '🚀', wallet: { hintToken: 3, coin: 150 } } },
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
            // v1.13：把 tier.reward.wallet 真正发放到钱包，避免「弹了 toast 但空手」
            _grantTierWallet(tier, false);
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
                _grantTierWallet(tier, true);
                emit('season_tier_unlocked', { tier, track: 'paid' });
                _showTierToast(tier, true);
            }
        }
    }

    _saveState(state);
}

/**
 * v1.13：把赛季通行证 tier 的 wallet 奖励写入钱包。
 * source 形如 `season-pass-free-tier-1` / `season-pass-paid-tier-2`，便于流水回查。
 */
function _grantTierWallet(tier, isPaid) {
    const wallet = tier?.reward?.wallet;
    if (!wallet || typeof wallet !== 'object') return;
    try {
        const w = getWallet();
        const source = `season-pass-${isPaid ? 'paid' : 'free'}-tier-${tier.tier}`;
        for (const [kind, amount] of Object.entries(wallet)) {
            if (!amount) continue;
            w.addBalance(kind, amount | 0, source);
        }
    } catch (e) {
        console.warn('[seasonPass] tier wallet grant failed', e);
    }
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
