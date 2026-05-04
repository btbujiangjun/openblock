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
    const model = _commercialVector(game);
    if (model && !shouldAllowMonetizationAction(model, 'interstitial')) return false;
    return true;
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
