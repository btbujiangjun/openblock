/**
 * difficultyAdapter.js - 基于玩家成熟度的智能难度适配器
 *
 * 扩展 adaptiveSpawn.js，提供基于玩家生命周期阶段的精细化难度控制
 * 整合 playerMaturity, churnPredictor 数据，为不同成熟度玩家提供差异化体验
 */

import { t } from '../i18n/i18n.js';
import {
    getPlayerMaturity,
    getMaturityInsights
} from './playerMaturity.js';
import { getChurnPrediction, getChurnRiskLevel } from './churnPredictor.js';
/* v1.48 (2026-05) — 统一阶段定义到 lifecycleDashboard 的 AND 门，消除
 * "同一玩家在不同模块被打成不同 stage"的撕裂。详见
 * docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md「统一数据层」。 */
import { getPlayerLifecycleStage } from './playerLifecycleDashboard.js';

const MATURITY_DIFFICULTY_ADJUST = {
    L1: {
        stressOffset: -15,
        maxStress: 35,
        enableFrustrationRelief: true,
        enableBeginnerBonus: true,
        recommendedProfile: 'relaxed'
    },
    L2: {
        stressOffset: -5,
        maxStress: 50,
        enableFrustrationRelief: true,
        enableBeginnerBonus: false,
        recommendedProfile: 'easy'
    },
    L3: {
        stressOffset: 0,
        maxStress: 70,
        enableFrustrationRelief: false,
        enableBeginnerBonus: false,
        recommendedProfile: 'normal'
    },
    L4: {
        stressOffset: 5,
        maxStress: 90,
        enableFrustrationRelief: false,
        enableBeginnerBonus: false,
        recommendedProfile: 'hard'
    }
};

const STAGE_DIFFICULTY_ADJUST = {
    onboarding: {
        stressOffset: -20,
        specialMode: 'beginner',
        enableQuickWin: true
    },
    exploration: {
        stressOffset: -10,
        specialMode: null,
        enableQuickWin: true
    },
    growth: {
        stressOffset: 0,
        specialMode: null,
        enableQuickWin: false
    },
    stability: {
        stressOffset: 5,
        specialMode: 'challenge',
        enableQuickWin: false
    },
    veteran: {
        stressOffset: 10,
        specialMode: 'challenge',
        enableQuickWin: false
    }
};

export function getDifficultyAdapterConfig() {
    const maturityInsights = getMaturityInsights();
    const churnPrediction = getChurnPrediction();
    const churnRisk = getChurnRiskLevel(churnPrediction.risk);

    const maturityConfig = MATURITY_DIFFICULTY_ADJUST[maturityInsights.level] || MATURITY_DIFFICULTY_ADJUST.L2;

    const stage = _inferStage(maturityInsights);
    const stageConfig = STAGE_DIFFICULTY_ADJUST[stage] || STAGE_DIFFICULTY_ADJUST.exploration;

    let stressOffset = maturityConfig.stressOffset + stageConfig.stressOffset;

    if (churnRisk === 'critical' || churnRisk === 'high') {
        stressOffset -= 15;
    }

    let maxStress = maturityConfig.maxStress;
    if (churnRisk === 'critical') {
        maxStress = 30;
    }

    const enableFrustrationRelief = maturityConfig.enableFrustrationRelief;
    const enableBeginnerBonus = maturityConfig.enableBeginnerBonus && stageConfig.enableQuickWin;
    const recommendedProfile = _getRecommendedProfile(stressOffset);

    return {
        stressOffset,
        maxStress,
        enableFrustrationRelief,
        enableBeginnerBonus,
        recommendedProfile,
        specialMode: stageConfig.specialMode,
        churnRisk,
        maturityLevel: maturityInsights.level,
        stage
    };
}

/**
 * v1.48：统一阶段定义到 `playerLifecycleDashboard.getPlayerLifecycleStage`。
 *
 * 旧实现用 OR(days, sessions)：高频玩家（days=2, sessions=100）会被锁在 onboarding；
 * 长草玩家（days=60, sessions=8）会被推到 stability —— 与 dashboard 的 AND 门
 * 完全相反。两套阶段并存导致同一玩家在 difficultyAdapter 与 adaptiveSpawn 被
 * 打成不同档，stress 调整互相抵消。
 *
 * 此处委托给 dashboard 的统一实现；保留 try/catch 兜底以防 dashboard 异常。
 */
function _inferStage(insights) {
    try {
        return getPlayerLifecycleStage({
            daysSinceInstall: insights.daysAsPlayer || 0,
            totalSessions: insights.totalSessions || 0,
            // dashboard 同时考虑 daysSinceLastActive，但 maturityInsights 不带该字段；
            // 这里传 undefined 让 dashboard 用默认 recencyDecay=1。
        });
    } catch {
        // 兜底：用 AND 门复刻 dashboard 行为，避免任何情况下回到旧 OR 语义
        const days = insights.daysAsPlayer || 0;
        const sessions = insights.totalSessions || 0;
        if (days <= 3 && sessions <= 10) return 'onboarding';
        if (days <= 14 && sessions <= 50) return 'exploration';
        if (days <= 30 && sessions <= 200) return 'growth';
        if (days <= 90 && sessions <= 500) return 'stability';
        return 'veteran';
    }
}

function _getRecommendedProfile(stressOffset) {
    if (stressOffset <= -15) return 'relaxed';
    if (stressOffset <= -5) return 'easy';
    if (stressOffset <= 5) return 'normal';
    if (stressOffset <= 15) return 'hard';
    return 'expert';
}

export function adjustStressForPlayer(baseStress) {
    const config = getDifficultyAdapterConfig();

    let adjustedStress = baseStress + config.stressOffset;

    adjustedStress = Math.max(0, Math.min(config.maxStress, adjustedStress));

    return {
        stress: adjustedStress,
        config,
        reason: _getAdjustmentReason(config)
    };
}

function _getAdjustmentReason(config) {
    const reasons = [];

    if (config.churnRisk === 'critical') {
        reasons.push(t('difficulty.reason.churnPrevention'));
    }
    if (config.churnRisk === 'high') {
        reasons.push(t('difficulty.reason.churnPrevention'));
    }
    if (config.enableBeginnerBonus) {
        reasons.push(t('difficulty.reason.beginnerBonus'));
    }
    if (config.stage === 'onboarding') {
        reasons.push(t('difficulty.reason.onboarding'));
    }
    if (config.maturityLevel === 'L4') {
        reasons.push(t('difficulty.reason.corePlayer'));
    }

    return reasons.length > 0 ? reasons.join('; ') : t('difficulty.normal');
}

export function shouldTriggerFrustrationRelief(consecutiveNoClear, playerScore) {
    const config = getDifficultyAdapterConfig();

    if (!config.enableFrustrationRelief) {
        return { shouldTrigger: false, reason: '当前阶段不启用减压' };
    }

    const threshold = config.maturityLevel === 'L1' ? 3 : config.maturityLevel === 'L2' ? 4 : 5;

    if (consecutiveNoClear >= threshold) {
        return {
            shouldTrigger: true,
            action: _getFrustrationAction(consecutiveNoClear, playerScore),
            reason: `连续${consecutiveNoClear}次无消行-触发减压`
        };
    }

    return { shouldTrigger: false };
}

function _getFrustrationAction(consecutiveNoClear, playerScore) {
    if (consecutiveNoClear >= 6) {
        return { type: 'auto_clear', params: { lines: 1 } };
    }
    if (consecutiveNoClear >= 4) {
        return { type: 'hint', params: { count: 1 } };
    }
    return { type: 'easy_piece', params: { duration: 2 } };
}

export function shouldProvideBeginnerBonus(totalGamesPlayed, recentScores) {
    const config = getDifficultyAdapterConfig();

    if (!config.enableBeginnerBonus) {
        return { shouldProvide: false, reason: '非新手阶段' };
    }

    if (totalGamesPlayed <= 20) {
        const avgScore = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        if (avgScore < 200) {
            return {
                shouldProvide: true,
                bonus: 'score_boost',
                multiplier: 1.5,
                reason: '新手阶段得分偏低-提供得分加成'
            };
        }
    }

    return { shouldProvide: false };
}

export function getDifficultyRecommendation() {
    const config = getDifficultyAdapterConfig();
    const churnPrediction = getChurnPrediction();
    const maturityInsights = getMaturityInsights();

    return {
        recommendedProfile: config.recommendedProfile,
        stressAdjustment: config.stressOffset,
        maxStress: config.maxStress,
        reason: _getAdjustmentReason(config),
        warnings: _getWarnings(config, churnPrediction),
        metadata: {
            maturityLevel: config.maturityLevel,
            stage: config.stage,
            churnRisk: config.churnRisk,
            daysAsPlayer: maturityInsights.daysAsPlayer,
            totalSessions: maturityInsights.totalSessions
        }
    };
}

function _getWarnings(config, churnPrediction) {
    const warnings = [];

    if (config.churnRisk === 'critical') {
        warnings.push('⚠️ 流失风险极高，请立即干预');
    }
    if (config.stage === 'onboarding' && config.maturityLevel === 'L1') {
        warnings.push('📚 新手引导阶段，注意引导完成率');
    }
    if (churnPrediction.isWorsening) {
        warnings.push('📉 流失风险上升趋势');
    }

    return warnings;
}