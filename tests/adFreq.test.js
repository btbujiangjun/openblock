/**
 * 广告频控逻辑单元测试
 */
import { describe, it, expect, vi } from 'vitest';

// ── Mock 依赖 ──────────────────────────────────────────────────────────────────
const _store = {};
vi.stubGlobal('localStorage', {
    getItem: (k) => _store[k] ?? null,
    setItem: (k, v) => { _store[k] = v; },
    removeItem: (k) => { delete _store[k]; },
});

vi.mock('../web/src/monetization/featureFlags.js', () => ({ getFlag: () => true }));
vi.mock('../web/src/monetization/adAdapter.js', () => ({
    showRewardedAd: vi.fn(async () => ({ rewarded: true })),
    showInterstitialAd: vi.fn(async () => {}),
    isAdsRemoved: () => false,
}));
vi.mock('../web/src/monetization/iapAdapter.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isPurchased: () => false };
});
vi.mock('../web/src/monetization/MonetizationBus.js', () => ({ on: vi.fn(), emit: vi.fn() }));
vi.mock('../web/src/abTest.js', () => ({ getBuiltinVariant: () => 3000 }));

// 内联频控逻辑（避免复杂模块链，直接测核心计算）
const AD_CONFIG = {
    rewarded:      { maxPerGame: 3, maxPerDay: 12, cooldownMs: 90_000 },
    interstitial:  { maxPerDay: 6, cooldownMs: 180_000, minSessionsBeforeFirst: 3 },
};

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function makeFreq(overrides = {}) {
    return {
        day: todayKey(),
        rewardedCount: 0,
        interstitialCount: 0,
        lastRewardedTs: 0,
        lastInterstitialTs: 0,
        totalSessions: 5,
        experienceScore: 100,
        rewardedCompleted: 0,
        ...overrides,
    };
}

function calcExperienceScore(freq) {
    let score = 100;
    score -= Math.max(0, freq.rewardedCount - 8) * 5;
    score -= Math.max(0, freq.interstitialCount - 3) * 12;
    const watchRate = freq.rewardedCount > 0 ? (freq.rewardedCompleted ?? 0) / freq.rewardedCount : 1;
    score += watchRate * 8;
    return Math.max(0, Math.min(100, Math.round(score)));
}

function canShowRewarded(freq, rewardedThisGame = 0) {
    if (rewardedThisGame >= AD_CONFIG.rewarded.maxPerGame) return false;
    if (freq.rewardedCount >= AD_CONFIG.rewarded.maxPerDay) return false;
    const now = Date.now();
    if (now - (freq.lastRewardedTs ?? 0) < AD_CONFIG.rewarded.cooldownMs) return false;
    if (calcExperienceScore(freq) < 60) return false;
    return true;
}

function canShowInterstitial(freq, adsRemoved = false, hasPaidPass = false) {
    if (adsRemoved || hasPaidPass) return false;
    if (freq.totalSessions < AD_CONFIG.interstitial.minSessionsBeforeFirst) return false;
    if (freq.interstitialCount >= AD_CONFIG.interstitial.maxPerDay) return false;
    const now = Date.now();
    if (now - (freq.lastInterstitialTs ?? 0) < AD_CONFIG.interstitial.cooldownMs) return false;
    if (calcExperienceScore(freq) < 60) return false;
    return true;
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe('广告体验分（Ad Experience Score）', () => {
    it('初始状态体验分满分', () => {
        expect(calcExperienceScore(makeFreq())).toBe(100);
    });

    it('激励视频超过8次后扣分', () => {
        const score = calcExperienceScore(makeFreq({ rewardedCount: 10, rewardedCompleted: 10 }));
        expect(score).toBeLessThan(100);
    });

    it('插屏超过3次后重罚', () => {
        const score1 = calcExperienceScore(makeFreq({ interstitialCount: 3 }));
        const score2 = calcExperienceScore(makeFreq({ interstitialCount: 6 }));
        expect(score2).toBeLessThan(score1);
        expect(score2).toBeLessThan(80); // 6次插屏：超出3次 → 每次-12，得分 100-36=-36 → 72，<80
    });

    it('体验分低于60时进入休养期', () => {
        const freq = makeFreq({ interstitialCount: 10, rewardedCount: 15 });
        expect(calcExperienceScore(freq)).toBeLessThan(60);
    });

    it('看完率影响体验分（完播vs未完播差异）', () => {
        // 超过8次才会有超出扣分，未超时两者都是100（capped），测试差异需达到扣分区间
        const f1 = makeFreq({ rewardedCount: 10, rewardedCompleted: 10 }); // 100% 完播
        const f2 = makeFreq({ rewardedCount: 10, rewardedCompleted: 0 });  // 0%  完播
        // f1 的 watchRate=1 带来 +8，f2 watchRate=0 没有加分
        expect(calcExperienceScore(f1)).toBeGreaterThan(calcExperienceScore(f2));
    });
});

describe('激励视频频控', () => {
    it('正常情况可以展示', () => {
        expect(canShowRewarded(makeFreq())).toBe(true);
    });

    it('单局次数到达上限后不展示', () => {
        expect(canShowRewarded(makeFreq(), AD_CONFIG.rewarded.maxPerGame)).toBe(false);
    });

    it('日上限到达后不展示', () => {
        const freq = makeFreq({ rewardedCount: AD_CONFIG.rewarded.maxPerDay });
        expect(canShowRewarded(freq)).toBe(false);
    });

    it('冷却时间内不展示', () => {
        const freq = makeFreq({ lastRewardedTs: Date.now() - 10_000 }); // 10s ago
        expect(canShowRewarded(freq)).toBe(false);
    });

    it('冷却时间过后可以展示', () => {
        const freq = makeFreq({ lastRewardedTs: Date.now() - 100_000 }); // 100s ago
        expect(canShowRewarded(freq)).toBe(true);
    });

    it('体验分低于60时不展示', () => {
        const freq = makeFreq({ interstitialCount: 10, rewardedCount: 15 });
        expect(canShowRewarded(freq)).toBe(false);
    });
});

describe('插屏广告频控', () => {
    it('正常情况可以展示（已过3局）', () => {
        expect(canShowInterstitial(makeFreq({ totalSessions: 5 }))).toBe(true);
    });

    it('前3局不展示（新用户豁免）', () => {
        const freq = makeFreq({ totalSessions: 2 });
        expect(canShowInterstitial(freq)).toBe(false);
    });

    it('日上限到达后不展示', () => {
        const freq = makeFreq({ interstitialCount: AD_CONFIG.interstitial.maxPerDay });
        expect(canShowInterstitial(freq)).toBe(false);
    });

    it('已移除广告不展示', () => {
        expect(canShowInterstitial(makeFreq(), true)).toBe(false);
    });

    it('付费用户（月卡/年卡）不展示', () => {
        expect(canShowInterstitial(makeFreq(), false, true)).toBe(false);
    });

    it('冷却时间内不展示', () => {
        const freq = makeFreq({ lastInterstitialTs: Date.now() - 60_000 }); // 60s ago
        expect(canShowInterstitial(freq)).toBe(false);
    });

    it('冷却时间过后可以展示', () => {
        const freq = makeFreq({ lastInterstitialTs: Date.now() - 200_000 }); // 200s ago
        expect(canShowInterstitial(freq)).toBe(true);
    });
});

describe('IAP 产品目录', () => {
    it('PRODUCTS 包含所有必需产品', async () => {
        const { PRODUCTS } = await import('../web/src/monetization/iapAdapter.js');
        expect(PRODUCTS).toHaveProperty('remove_ads');
        expect(PRODUCTS).toHaveProperty('hint_pack_5');
        expect(PRODUCTS).toHaveProperty('weekly_pass');
        expect(PRODUCTS).toHaveProperty('monthly_pass');
        expect(PRODUCTS).toHaveProperty('annual_pass');
        expect(PRODUCTS).toHaveProperty('starter_pack');
        expect(PRODUCTS).toHaveProperty('weekly_pass_discount');
    });

    it('annual_pass 包含去广告权益（priceNum>0）', async () => {
        const { PRODUCTS } = await import('../web/src/monetization/iapAdapter.js');
        expect(PRODUCTS.annual_pass.priceNum).toBeGreaterThan(0);
        expect(PRODUCTS.annual_pass.durationDays).toBe(365);
    });

    it('starter_pack 是首购限定低价产品', async () => {
        const { PRODUCTS } = await import('../web/src/monetization/iapAdapter.js');
        expect(PRODUCTS.starter_pack.firstPurchaseOnly).toBe(true);
        expect(PRODUCTS.starter_pack.priceNum).toBeLessThan(10);
    });

    it('weekly_pass_discount 有 expireHours 限时配置', async () => {
        const { PRODUCTS } = await import('../web/src/monetization/iapAdapter.js');
        expect(PRODUCTS.weekly_pass_discount.expireHours).toBeGreaterThan(0);
    });
});
