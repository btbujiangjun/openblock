/**
 * 广告触发器（OPT-01 v2）
 *
 * 新增（v2）：
 *   - 日上限计数（rewarded ≤12次/天，interstitial ≤6次/天）
 *   - 冷却时间（rewarded 间隔 ≥90s，interstitial ≥180s）
 *   - 新用户豁免（前 3 局不展示插屏）
 *   - 付费用户静默跳过插屏
 *   - 广告体验分（Ad Experience Score）自动评估
 *   - A/B 测试：插屏延迟时间 / 激励触发阈值
 *
 * 监听 MonetizationBus 事件，不修改 game.js
 */

import { getFlag } from './featureFlags.js';
import { on } from './MonetizationBus.js';
import { showRewardedAd, showInterstitialAd, isAdsRemoved } from './adAdapter.js';
import { emit } from './MonetizationBus.js';
import { isPurchased } from './iapAdapter.js';
import { getBuiltinVariant } from '../abTest.js';
import { isGameOverScreenActive, runAfterPopupQuiet } from '../popupCoordinator.js';
import { getLTVEstimate } from './ltvPredictor.js';
import { getCommercialModelContext, updateRealtimeSignals } from './personalization.js';
import { buildCommercialModelVector, shouldAllowMonetizationAction } from './commercialModel.js';

// ── 频控配置 ──────────────────────────────────────────────────────────────────
const AD_CONFIG = {
    rewarded: {
        maxPerGame: 3,     // 单局上限
        maxPerDay: 12,     // 日上限
        cooldownMs: 90_000, // 两次之间最短间隔（90s）
    },
    interstitial: {
        maxPerDay: 6,      // 日上限
        cooldownMs: 180_000, // 最短间隔（180s）
        minSessionsBeforeFirst: 3, // 新用户前3局豁免
    },
};

// ── 状态（内存 + localStorage） ───────────────────────────────────────────────
const LS_KEY = 'openblock_ad_freq_v1';

function _todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function _loadFreq() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        const data = raw ? JSON.parse(raw) : {};
        // 日期切换时清零计数
        if (data.day !== _todayKey()) {
            return { day: _todayKey(), rewardedCount: 0, interstitialCount: 0, lastRewardedTs: 0, lastInterstitialTs: 0, totalSessions: 0, experienceScore: 100 };
        }
        return data;
    } catch {
        return { day: _todayKey(), rewardedCount: 0, interstitialCount: 0, lastRewardedTs: 0, lastInterstitialTs: 0, totalSessions: 0, experienceScore: 100 };
    }
}

function _saveFreq(data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// ── 广告体验分 ────────────────────────────────────────────────────────────────

/**
 * 计算广告体验分（0~100）
 * 分数低于60时触发"休养期"，降低广告频率
 */
function _calcExperienceScore(freq) {
    let score = 100;
    const excess = Math.max(0, freq.rewardedCount - 8);
    score -= excess * 5;
    const iExcess = Math.max(0, freq.interstitialCount - 3);
    score -= iExcess * 12;
    // 完播率奖励
    const watchRate = freq.rewardedCount > 0
        ? (freq.rewardedCompleted ?? 0) / freq.rewardedCount
        : 1;
    score += watchRate * 8;
    return Math.max(0, Math.min(100, Math.round(score)));
}

function _isInRecoveryPeriod(freq) {
    const score = _calcExperienceScore(freq);
    return score < 60;
}

// ── 频控检查 ──────────────────────────────────────────────────────────────────

/* v1.49.x P1-2：体验护栏阈值。
 *
 * 之前 adTrigger 只看"日上限/冷却/付费用户/recoveryPeriod"四项，但没有任何
 * 看玩家"当下是否处于心流 / 是否反应已经显著变慢（认知疲劳）"。结果：
 *   - flow 中的玩家被强行打断，体验最差却最易点 game_over → interstitial
 *   - 反应已经退化到基线 1.5× 的玩家继续被激励广告"邀请"，进一步加剧疲劳
 *
 * 这两条新护栏只硬阻拦"插屏"，对"激励视频"采用降频（实际上 _isCognitivelyFatigued
 * 时把 rewarded 也跳过）。阈值取自 docs/player/REALTIME_STRATEGY.md 的 baseline。 */
const FLOW_GUARD_FRUSTRATION_MAX = 2;
const COGNITIVE_FATIGUE_REACTION_X = 1.5; // 反应时长 ≥ baseline*1.5 → 疲劳
const COGNITIVE_FATIGUE_BASELINE_MS = 1500;

function _isInFlow(profile) {
    if (!profile) return false;
    try {
        const fs = profile.flowState;
        const fr = Number(profile.frustrationLevel ?? 0) || 0;
        return fs === 'flow' && fr < FLOW_GUARD_FRUSTRATION_MAX;
    } catch { return false; }
}

function _isCognitivelyFatigued(profile) {
    if (!profile) return false;
    try {
        const m = profile.metrics ?? {};
        const r = Number(m.pickToPlaceMs);
        const samples = Number(m.reactionSamples ?? 0);
        if (!Number.isFinite(r) || samples < 4) return false;
        return r >= COGNITIVE_FATIGUE_BASELINE_MS * COGNITIVE_FATIGUE_REACTION_X;
    } catch { return false; }
}

/* v1.49.x P3-4：高 LTV / 高 VIP 玩家的插屏拦截深度。
 *
 * 核心付费用户最怕被插屏打断 → 直接降低展示概率（默认乘 0.3）；rewarded 不受影响。
 * 触发条件（任意命中即按 LTV-shielded 处理）：
 *   - vipSystem.tier >= T2（即累计折算分 ≥ T2 阈值），或
 *   - profile 累计 IAP 金额 ≥ 50（lifetimeSpend，存在时优先；否则用 vip score 推断）
 *
 * Feature flag `ltvAdShield` 默认 on；可在 monPanel 关闭做对照实验。 */
function _isLtvShielded(game) {
    if (!getFlag('ltvAdShield')) return false;
    try {
        const profile = game?.playerProfile;
        const lifetimeSpend = Number(profile?._lifetimeSpend ?? profile?.lifetimeSpend ?? 0);
        if (lifetimeSpend >= 50) return true;
        /* vip 模块按需通过 window 钩子读取（lazy 注入），避免引入循环依赖。 */
        const vipMod = (typeof window !== 'undefined' && window.__vipSystem) || null;
        const tier = vipMod?.getCurrentTier?.()?.id;
        if (tier && /^T[2-5]$/.test(tier)) return true;
        return false;
    } catch { return false; }
}

/* 概率拦截：对 ltvShielded 玩家以 70% 几率主动跳过插屏。 */
const LTV_SHIELD_INTERSTITIAL_SKIP_PROB = 0.7;

let _rewardedThisGame = 0;

function _commercialVector(game) {
    try {
        const profile = game?.playerProfile;
        if (profile) updateRealtimeSignals(profile);
        return buildCommercialModelVector({
            ...getCommercialModelContext(),
            profile,
            ltv: getLTVEstimate(profile),
            adFreq: getAdFreqSnapshot(),
        });
    } catch {
        return null;
    }
}

function _canShowRewarded(userId, game) {
    const freq = _loadFreq();
    if (_rewardedThisGame >= AD_CONFIG.rewarded.maxPerGame) return false;
    if (freq.rewardedCount >= AD_CONFIG.rewarded.maxPerDay) return false;
    const now = Date.now();
    if (now - (freq.lastRewardedTs ?? 0) < AD_CONFIG.rewarded.cooldownMs) return false;
    if (_isInRecoveryPeriod(freq)) return false;
    /* P1-2：认知疲劳护栏 —— 反应显著拉长时即便符合频控也跳过激励，避免火上浇油。
     * 注意：flow 中 *不* 跳过激励视频，因为激励视频是玩家主动选择的"救济"，
     * 在 flow 中触发 near-miss 反而是承接体验的好节点。 */
    const profile = game?.playerProfile;
    if (_isCognitivelyFatigued(profile)) return false;
    const model = _commercialVector(game);
    if (model && !shouldAllowMonetizationAction(model, 'rewarded')) return false;
    return true;
}

function _canShowInterstitial(game) {
    if (isAdsRemoved()) return false;
    if (isPurchased('monthly_pass') || isPurchased('annual_pass')) return false;
    const freq = _loadFreq();
    if (freq.totalSessions < AD_CONFIG.interstitial.minSessionsBeforeFirst) return false;
    if (freq.interstitialCount >= AD_CONFIG.interstitial.maxPerDay) return false;
    const now = Date.now();
    if (now - (freq.lastInterstitialTs ?? 0) < AD_CONFIG.interstitial.cooldownMs) return false;
    if (_isInRecoveryPeriod(freq)) return false;
    /* P1-2：插屏的两条新护栏 —— flow 与 cognitiveFatigue。
     * 插屏被动打断、影响最大；这两个状态下硬阻拦。 */
    const profile = game?.playerProfile;
    if (_isInFlow(profile)) return false;
    if (_isCognitivelyFatigued(profile)) return false;
    /* P3-4：高 LTV / VIP 玩家概率性跳过插屏（rewarded 不受影响）。 */
    if (_isLtvShielded(game) && Math.random() < LTV_SHIELD_INTERSTITIAL_SKIP_PROB) return false;
    const model = _commercialVector(game);
    if (model && !shouldAllowMonetizationAction(model, 'interstitial')) return false;
    return true;
}

/** P1-2 / P3-4：导出供单测 / 看板 / commercialInsight 检查"当前广告决策"的护栏状态。 */
export function getAdGuardrailState(game) {
    const profile = game?.playerProfile;
    return {
        inFlow: _isInFlow(profile),
        cognitivelyFatigued: _isCognitivelyFatigued(profile),
        ltvShielded: _isLtvShielded(game),
        flowState: profile?.flowState ?? null,
        frustration: profile?.frustrationLevel ?? null,
        reactionMs: profile?.metrics?.pickToPlaceMs ?? null,
    };
}

function _recordRewarded(completed = true) {
    const freq = _loadFreq();
    freq.rewardedCount = (freq.rewardedCount ?? 0) + 1;
    freq.lastRewardedTs = Date.now();
    if (completed) freq.rewardedCompleted = (freq.rewardedCompleted ?? 0) + 1;
    freq.experienceScore = _calcExperienceScore(freq);
    _saveFreq(freq);
}

function _recordInterstitial() {
    const freq = _loadFreq();
    freq.interstitialCount = (freq.interstitialCount ?? 0) + 1;
    freq.lastInterstitialTs = Date.now();
    freq.experienceScore = _calcExperienceScore(freq);
    _saveFreq(freq);
}

function _recordSession() {
    const freq = _loadFreq();
    freq.totalSessions = (freq.totalSessions ?? 0) + 1;
    _saveFreq(freq);
}

// ── 内部触发函数 ──────────────────────────────────────────────────────────────

async function _triggerRewarded(reason, rewardEvent, userId, game) {
    if (!getFlag('adsRewarded')) return;
    if (!_canShowRewarded(userId, game)) return;

    const shown = await runAfterPopupQuiet(async () => {
        _rewardedThisGame++;
        const result = await showRewardedAd(reason);
        _recordRewarded(result.rewarded);
        if (result.rewarded && rewardEvent) {
            emit(rewardEvent, { reason });
        }
    }, {
        minDelayMs: 700,
        timeoutMs: 2500,
        skipIf: isGameOverScreenActive,
    });

    if (!shown) {
        console.debug('[AdTrigger] rewarded skipped: popup window busy');
    }
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

export function initAdTrigger(game) {
    if (!getFlag('adsRewarded') && !getFlag('adsInterstitial')) return;

    const userId = game?.db?.userId ?? 'anon';

    // 新局开始时重置单局计数，记录累计局数
    on('spawn_blocks', () => {
        _rewardedThisGame = 0;
        _recordSession();
    });

    // 游戏结束：插屏广告（含延迟 A/B 测试）
    on('game_over', async ({ game: g }) => {
        if (!getFlag('adsInterstitial')) return;
        if (!_canShowInterstitial(g ?? game)) return;

        // A/B 测试：插屏延迟时间
        const delay = getBuiltinVariant(userId, 'interstitial_delay') ?? 3000;
        if (delay > 0) await new Promise(r => setTimeout(r, delay));

        const shown = await runAfterPopupQuiet(async () => {
            /* v1.49.x P2-3：feature flag `adDecisionEngine` 开启时，把决策权委托给
             * 集中决策器；它内部已包含频控/护栏/AbilityVector 权重，结果更一致。
             * 失败时退回旧路径，避免影响线上。 */
            if (getFlag('adDecisionEngine')) {
                try {
                    const engine = await import('./ad/adDecisionEngine.js');
                    const inst = engine.getAdDecisionEngine();
                    const r = await inst.requestAd('game_over', { reason: 'game_over' });
                    if (r?.allowed) {
                        _recordInterstitial();
                        return;
                    }
                } catch (e) {
                    console.warn('[AdTrigger] adDecisionEngine fallback:', e?.message);
                }
            }
            _recordInterstitial();
            await showInterstitialAd();
        }, {
            minDelayMs: 1200,
            timeoutMs: 2500,
            // 结算页已经是一次强打断；若仍停留在结算页，不再补一个插屏压上去。
            skipIf: isGameOverScreenActive,
        });

        if (!shown) {
            console.debug('[AdTrigger] interstitial skipped: popup window busy');
        }
    });

    // Near-miss → 激励视频钩子
    on('no_clear', ({ game: g }) => {
        const profile = g?.playerProfile;
        if (!profile?.hadRecentNearMiss) return;
        void _triggerRewarded('差一点！看广告获得一次消行救助', 'ad_reward_near_miss', userId, g ?? game);
    });

    // 挫败感累积 → 激励视频（A/B 测试：触发阈值）
    on('no_clear', ({ game: g }) => {
        const profile = g?.playerProfile;
        if (!profile) return;
        const threshold = getBuiltinVariant(userId, 'rewarded_threshold') ?? 5;
        if (profile.frustrationLevel >= threshold) {
            void _triggerRewarded('连续未消行！看广告获得一次救济块', 'ad_reward_frustration', userId, g ?? game);
        }
    });
}

/** 获取当前广告频控状态快照（调试 / 运营看板用） */
export function getAdFreqSnapshot() {
    const freq = _loadFreq();
    return {
        ...freq,
        experienceScore: _calcExperienceScore(freq),
        inRecoveryPeriod: _isInRecoveryPeriod(freq),
        rewardedThisGame: _rewardedThisGame,
    };
}
