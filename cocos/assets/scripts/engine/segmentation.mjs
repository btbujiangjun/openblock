/* 自动生成 —— 请勿手改。源：web/src/segmentation.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * segmentation.js — 统一分群单一真源（SSOT）
 *
 * 背景
 * ----
 * 此前项目里"分群"散落在多处、口径互不一致：
 *   - playerProfile.segment5（A–E，按行为 + 付费混合推断）
 *   - 商业化里的 whale/dolphin/minnow（按付费深度，散在 personalization/commercialModel）
 *   - vipSystem 的 vip0–vip5（按累计折算分）
 *   - adTrigger 期望的 T0–T5「价值 tier」（按累计付费，曾是死键）
 * 多套口径导致：同一玩家在不同子系统里落到互相矛盾的分群，报价/频控/权益错配。
 *
 * 本模块把"分群推导"收敛为唯一一处纯函数：
 *   - deriveSpendTier(spend)   付费深度档：nonpayer / minnow / dolphin / whale
 *   - deriveValueTier(spend)   价值 tier：T0–T5（adTrigger/VIP 权益联动唯一口径）
 *   - deriveSegment5(input)    A–E 五分群（行为 × 付费）
 *   - deriveLifecycleStage()   生命周期阶段
 *   - deriveSegments(input)    聚合输出以上全部，供任意子系统读取
 *
 * 设计约束：纯函数、无副作用、无 import（保证 sync-core/sync-cocos 直接分发各端）。
 * 货币单位统一为「元」(CNY)。
 */

/* ── 付费深度档阈值（元，累计 IAP 净额） ───────────────────────────────── */
export const SPEND_TIERS = Object.freeze([
    { id: 'whale', name: '鲸鱼', min: 500 },
    { id: 'dolphin', name: '海豚', min: 50 },
    { id: 'minnow', name: '小鱼', min: 0.01 },
    { id: 'nonpayer', name: '非付费', min: 0 },
]);

/* ── 价值 tier 阈值（元）：T0–T5。adTrigger 的 LTV-shield 命中 T2+。 ─────── */
export const VALUE_TIERS = Object.freeze([
    { id: 'T5', name: '钻石', min: 1000 },
    { id: 'T4', name: '铂金', min: 200 },
    { id: 'T3', name: '黄金', min: 50 },
    { id: 'T2', name: '白银', min: 10 },
    { id: 'T1', name: '青铜', min: 0.01 },
    { id: 'T0', name: '免费', min: 0 },
]);

/** 价值 tier → VIP 权益钩子（自动联动：达 tier 即解锁对应权益）。 */
export const VALUE_TIER_BENEFITS = Object.freeze({
    T0: [],
    T1: ['ad_reduction'],
    T2: ['ad_removal_interstitial'],
    T3: ['ad_removal_all', 'daily_bonus'],
    T4: ['ad_removal_all', 'daily_bonus', 'exclusive_shop'],
    T5: ['ad_removal_all', 'daily_bonus', 'exclusive_shop', 'priority_support'],
});

function _num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 付费深度档：nonpayer / minnow / dolphin / whale
 * @param {number} spend 累计付费金额（元）
 * @returns {{ id:string, name:string }}
 */
export function deriveSpendTier(spend) {
    const s = Math.max(0, _num(spend));
    for (const t of SPEND_TIERS) {
        if (s >= t.min) return { id: t.id, name: t.name };
    }
    return { id: 'nonpayer', name: '非付费' };
}

/**
 * 价值 tier：T0–T5。adTrigger / vipSystem 权益联动的唯一口径。
 * @param {number} spend 累计付费金额（元）
 * @returns {{ id:string, name:string, benefits:string[] }}
 */
export function deriveValueTier(spend) {
    const s = Math.max(0, _num(spend));
    for (const t of VALUE_TIERS) {
        if (s >= t.min) {
            return { id: t.id, name: t.name, benefits: VALUE_TIER_BENEFITS[t.id] ?? [] };
        }
    }
    return { id: 'T0', name: '免费', benefits: [] };
}

/**
 * 五分群 A–E（行为 × 付费），与 ltvPredictor.SEGMENT_ARPU_RATIO 口径对齐。
 *   A 大众非付费、B 活跃轻付费、C 高活跃高付费（核心）、D 买量高价值、E 高技能低付费
 * @param {{ spend?:number, engagement?:number, skill?:number, isPaidChannel?:boolean }} input
 * @returns {'A'|'B'|'C'|'D'|'E'}
 */
export function deriveSegment5(input = {}) {
    const spend = Math.max(0, _num(input.spend));
    const engagement = Math.max(0, Math.min(1, _num(input.engagement, 0.3)));
    const skill = Math.max(0, Math.min(1, _num(input.skill, 0.3)));
    const paid = !!input.isPaidChannel;

    if (spend >= 200) return paid ? 'D' : 'C';
    if (spend >= 50) return 'C';
    if (spend > 0) return paid ? 'D' : 'B';
    // 非付费：高技能高活跃但不付费 → E；否则大众 A
    if (skill >= 0.65 && engagement >= 0.5) return 'E';
    return 'A';
}

/**
 * 生命周期阶段（按装机天数 + 最近活跃）。
 * @param {{ daysSinceInstall?:number, daysSinceActive?:number, totalSessions?:number }} input
 * @returns {'new'|'exploration'|'growth'|'mature'|'at_risk'|'churned'}
 */
export function deriveLifecycleStage(input = {}) {
    const days = Math.max(0, _num(input.daysSinceInstall));
    const idle = Math.max(0, _num(input.daysSinceActive));
    const sessions = Math.max(0, _num(input.totalSessions));

    if (idle >= 30) return 'churned';
    if (idle >= 7) return 'at_risk';
    if (days <= 1) return 'new';
    if (days <= 7) return 'exploration';
    if (days <= 30 || sessions < 50) return 'growth';
    return 'mature';
}

/**
 * 聚合分群输出（任意子系统读取的唯一入口）。
 * @param {{
 *   spend?:number, engagement?:number, skill?:number, isPaidChannel?:boolean,
 *   daysSinceInstall?:number, daysSinceActive?:number, totalSessions?:number
 * }} input
 */
export function deriveSegments(input = {}) {
    const spend = Math.max(0, _num(input.spend));
    const spendTier = deriveSpendTier(spend);
    const valueTier = deriveValueTier(spend);
    const segment5 = deriveSegment5(input);
    const lifecycleStage = deriveLifecycleStage(input);
    return {
        spend,
        spendTier: spendTier.id,
        spendTierName: spendTier.name,
        valueTier: valueTier.id,
        valueTierName: valueTier.name,
        valueBenefits: valueTier.benefits,
        segment5,
        lifecycleStage,
        isPayer: spend > 0,
    };
}
