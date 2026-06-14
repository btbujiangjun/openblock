/**
 * winbackTiers.js — 召回分层（LO-4）
 *
 * 按「距上次游玩天数」把流失用户分层（3/7/14/30 天），匹配对应回归礼包梯度。
 * 越久未回，礼包越厚（但有上限，避免羊毛党）。纯函数，跨端复用。
 */

export const WINBACK_TIERS = [
    { id: 'none', minDays: 0, maxDays: 2, gift: null, label: '活跃' },
    { id: 'd3', minDays: 3, maxDays: 6, gift: 'winback_light', label: '3 日未回', rewards: ['hint_pack_5'] },
    { id: 'd7', minDays: 7, maxDays: 13, gift: 'winback_mid', label: '7 日未回', rewards: ['hint_pack_5', 'coin_boost_2x'] },
    { id: 'd14', minDays: 14, maxDays: 29, gift: 'winback_heavy', label: '14 日未回', rewards: ['hint_pack_5', 'skin_winback', 'weekly_pass_trial'] },
    { id: 'd30', minDays: 30, maxDays: Infinity, gift: 'winback_premium', label: '30 日+ 沉睡', rewards: ['hint_pack_5', 'skin_winback', 'remove_ads_trial'] },
];

/** 按未游玩天数返回召回层级。 */
export function classifyWinbackTier(daysSinceLastPlay) {
    const d = Math.max(0, Math.floor(Number(daysSinceLastPlay) || 0));
    return WINBACK_TIERS.find((t) => d >= t.minDays && d <= t.maxDays) || WINBACK_TIERS[0];
}

/** 是否应触发召回礼包（none 层不触发）。 */
export function shouldOfferWinback(daysSinceLastPlay) {
    return classifyWinbackTier(daysSinceLastPlay).gift !== null;
}

/** 计算未游玩天数（毫秒时间戳）。 */
export function daysSince(lastPlayTs, nowTs = Date.now()) {
    if (!lastPlayTs) return 0;
    return Math.max(0, Math.floor((nowTs - lastPlayTs) / 86400000));
}

/** 一步到位：从 lastPlayTs 得到召回礼包决策。 */
export function resolveWinback(lastPlayTs, nowTs = Date.now()) {
    const days = daysSince(lastPlayTs, nowTs);
    const tier = classifyWinbackTier(days);
    return { days, tier: tier.id, gift: tier.gift, rewards: tier.rewards || [], label: tier.label };
}
