/**
 * 自适应出块策略引擎（增强版）
 *
 * 综合 8 个信号维度计算 adaptiveStress + spawnHints，在 10 档出块权重 profile
 * 间线性插值，并向 blockSpawn.js 传递精细控制提示。
 *
 * 信号维度：
 *   1. scoreStress      分数驱动的基础压力（与原 dynamicDifficulty 一致）
 *   2. runStreakStress   连战加成
 *   3. skillAdjust      高手加压 / 新手减压（± skillAdjustScale / 2）
 *   4. flowAdjust       无聊 +δ / 焦虑 -δ / 心流 0
 *   5. pacingAdjust     节奏张弛（tension +δ / release -δ）
 *   6. recoveryAdjust   板面快满时短期降压
 *   7. frustrationRelief 连续无消行 → 降压 + 提高消行保证
 *   8. comboReward      连续 combo → 轻微加压（正反馈）
 *
 * 特殊覆写：
 *   - 新手保护：isInOnboarding → stress 直接钳制到 onboarding 档
 *   - 差一点放大：hadRecentNearMiss → 降压 + 提高消行保证，转挫败为动力
 *   - 新鲜感注入：diversityBoost 传给 blockSpawn 增加三连块品类多样性
 *
 * 输出：
 *   { ...策略字段, shapeWeights, fillRatio,
 *     spawnHints: { clearGuarantee, sizePreference, diversityBoost },
 *     _adaptiveStress, _flowState, _skillLevel, _pacingPhase }
 *
 * 当 adaptiveSpawn.enabled=false 时透传 resolveLayeredStrategy，零行为变化。
 */

const { getStrategy } = require('./config');
const { GAME_RULES } = require('./gameRules');
import {
    getSpawnStressFromScore,
    getRunDifficultyModifiers,
    resolveLayeredStrategy
} from './difficulty.js';

/* ------------------------------------------------------------------ */
/*  profile 插值                                                       */
/* ------------------------------------------------------------------ */

/**
 * 在 profiles 列表中按 stress 值线性插值出 shapeWeights
 * @param {Array<{stress:number, shapeWeights:Record<string,number>}>} profiles
 * @param {number} stress
 * @returns {Record<string,number>}
 */
function interpolateProfileWeights(profiles, stress) {
    const sorted = [...profiles].sort((a, b) => a.stress - b.stress);
    if (sorted.length === 0) return {};
    if (stress <= sorted[0].stress) return { ...sorted[0].shapeWeights };
    if (stress >= sorted[sorted.length - 1].stress) return { ...sorted[sorted.length - 1].shapeWeights };

    let lower = sorted[0];
    let upper = sorted[1];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].stress >= stress) {
            lower = sorted[i - 1];
            upper = sorted[i];
            break;
        }
    }

    const span = upper.stress - lower.stress;
    const t = span > 0 ? (stress - lower.stress) / span : 0;
    const keys = new Set([...Object.keys(lower.shapeWeights), ...Object.keys(upper.shapeWeights)]);
    const result = {};
    for (const k of keys) {
        const a = lower.shapeWeights[k] ?? 1;
        const b = upper.shapeWeights[k] ?? 1;
        result[k] = a + (b - a) * t;
    }
    return result;
}

/* ------------------------------------------------------------------ */
/*  自适应策略解析                                                      */
/* ------------------------------------------------------------------ */

/**
 * @param {string} baseStrategyId 玩家选择的基础难度 easy/normal/hard
 * @param {import('./playerProfile.js').PlayerProfile} profile 玩家实时画像
 * @param {number} score 当前分数
 * @param {number} runStreak 连战局数
 * @param {number} _boardFill 当前板面填充率 0~1（开局传 0），预留给后续扩展
 * @returns {object} 与 resolveLayeredStrategy 返回格式兼容的策略对象 + spawnHints
 */
function resolveAdaptiveStrategy(baseStrategyId, profile, score, runStreak, _boardFill) {
    const cfg = GAME_RULES.adaptiveSpawn;
    if (!cfg?.enabled || !cfg.profiles?.length || !profile) {
        return resolveLayeredStrategy(baseStrategyId, score, runStreak);
    }

    const fz = cfg.flowZone ?? {};
    const eng = cfg.engagement ?? {};
    const pacing = cfg.pacing ?? {};
    const base = getStrategy(baseStrategyId);

    /* ---------- 基础信号 ---------- */
    const scoreStress = getSpawnStressFromScore(score);
    const runMods = getRunDifficultyModifiers(runStreak);

    /* ---------- 技能调节 ---------- */
    const skill = profile.skillLevel;
    const skillAdjust = (skill - 0.5) * (fz.skillAdjustScale ?? 0.3);

    /* ---------- 心流调节（连续 F(t) + 方向修正） ---------- */
    const flow = profile.flowState;
    const flowDev = profile.flowDeviation;
    let flowAdjust = 0;
    if (flow === 'bored') flowAdjust = (fz.flowBoredAdjust ?? 0.08) * Math.min(2, 1 + flowDev);
    else if (flow === 'anxious') flowAdjust = (fz.flowAnxiousAdjust ?? -0.12) * Math.min(2, 1 + flowDev);

    /* ---------- 节奏张弛 ---------- */
    let pacingAdjust = 0;
    if (pacing.enabled) {
        const phase = profile.pacingPhase;
        pacingAdjust = phase === 'release'
            ? (pacing.releaseBonus ?? -0.12)
            : (pacing.tensionBonus ?? 0.04);
    }

    /* ---------- 恢复 / 挫败 / combo ---------- */
    const recoveryAdjust = profile.needsRecovery ? (fz.recoveryAdjust ?? -0.2) : 0;
    const comboAdjust = profile.recentComboStreak >= 2 ? (fz.comboRewardAdjust ?? 0.05) : 0;

    const frustThreshold = eng.frustrationThreshold ?? 4;
    const frustRelief = profile.frustrationLevel >= frustThreshold
        ? (eng.frustrationRelief ?? -0.18)
        : 0;

    /* ---------- 差一点效应 ---------- */
    const nearMissAdjust = profile.hadRecentNearMiss
        ? (eng.nearMissStressBonus ?? -0.1)
        : 0;

    /* ---------- 闭环反馈偏移 ---------- */
    const feedbackBias = profile.feedbackBias ?? 0;

    /* ---------- 综合 stress ---------- */
    let stress = scoreStress
        + runMods.stressBonus
        + skillAdjust
        + flowAdjust
        + pacingAdjust
        + recoveryAdjust
        + frustRelief
        + comboAdjust
        + nearMissAdjust
        + feedbackBias;

    /* ---------- 特殊覆写：新手保护 ---------- */
    if (profile.isInOnboarding) {
        stress = Math.min(stress, eng.firstSessionStressOverride ?? -0.15);
    }

    stress = Math.max(-0.2, Math.min(1, stress));

    /* ---------- 插值 shapeWeights ---------- */
    const shapeWeights = interpolateProfileWeights(cfg.profiles, stress);

    /* ---------- fillRatio ---------- */
    let fillRatio = (base.fillRatio ?? 0.2) + runMods.fillDelta;
    fillRatio = Math.min(0.36, Math.max(0.06, fillRatio));

    /* ---------- spawnHints → 传给 blockSpawn.js ---------- */
    let clearGuarantee = 1;
    let sizePreference = 0;
    let diversityBoost = 0;

    if (profile.hadRecentNearMiss) {
        clearGuarantee = Math.max(clearGuarantee, eng.nearMissClearGuarantee ?? 2);
    }
    if (profile.frustrationLevel >= frustThreshold) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = -0.3;
    }
    if (profile.needsRecovery) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = -0.5;
    }
    if (flow === 'bored') {
        diversityBoost = eng.noveltyDiversityBoost ?? 0.15;
    }
    if (profile.isInOnboarding) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = -0.4;
    }
    if (profile.sessionPhase === 'late' && profile.momentum < -0.3) {
        sizePreference = Math.min(sizePreference, -0.2);
        clearGuarantee = Math.max(clearGuarantee, 1);
    }

    return {
        ...base,
        shapeWeights,
        fillRatio,
        spawnHints: {
            clearGuarantee: Math.min(3, clearGuarantee),
            sizePreference: Math.max(-1, Math.min(1, sizePreference)),
            diversityBoost: Math.max(0, Math.min(1, diversityBoost))
        },
        _adaptiveStress: stress,
        _flowState: flow,
        _flowDeviation: flowDev,
        _feedbackBias: feedbackBias,
        _skillLevel: skill,
        _pacingPhase: profile.pacingPhase,
        _momentum: profile.momentum,
        _frustration: profile.frustrationLevel,
        _sessionPhase: profile.sessionPhase
    };
}

module.exports = { resolveAdaptiveStrategy };
