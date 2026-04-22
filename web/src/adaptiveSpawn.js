/**
 * 自适应出块策略引擎（三层架构）
 *
 * 综合多维信号计算 adaptiveStress + spawnHints，在 10 档出块权重 profile
 * 间线性插值，并向 blockSpawn.js 传递精细控制提示。
 *
 * === 信号维度 ===
 *   1. scoreStress       分数驱动的基础压力
 *   2. runStreakStress    连战加成
 *   3. skillAdjust       高手加压 / 新手减压（置信度门控）
 *   4. flowAdjust        无聊 +δ / 焦虑 -δ / 心流 0
 *   5. pacingAdjust      节奏张弛（tension +δ / release -δ）
 *   6. recoveryAdjust    板面快满时短期降压
 *   7. frustrationRelief 连续无消行 → 降压
 *   8. comboReward       连续 combo → 轻微加压（正反馈）
 *   9. trendAdjust       长周期趋势
 *  10. confidenceGate    置信度低时收窄调节
 *
 * === Layer 2 新增 spawnHints ===
 *   comboChain      (0~1)  combo 链强度 → blockSpawn 偏好续链块
 *   multiClearBonus (0~1)  多消鼓励 → blockSpawn 偏好多行同消块
 *   rhythmPhase     'setup'|'payoff'|'neutral'  出块节奏相位
 *
 * === Layer 3 新增 spawnHints ===
 *   sessionArc      'warmup'|'peak'|'cooldown'  单局弧线
 *   scoreMilestone   boolean  是否刚达到分数里程碑
 *
 * 当 adaptiveSpawn.enabled=false 时透传 resolveLayeredStrategy。
 */

import { getStrategy } from './config.js';
import { GAME_RULES } from './gameRules.js';
import {
    getSpawnStressFromScore,
    getRunDifficultyModifiers,
    resolveLayeredStrategy
} from './difficulty.js';

/* ------------------------------------------------------------------ */
/*  profile 插值                                                       */
/* ------------------------------------------------------------------ */

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
/*  Layer 2: combo 链 + 节奏推演                                       */
/* ------------------------------------------------------------------ */

/**
 * 从 spawnContext 推导 combo 链强度
 * @param {object} ctx spawnContext from game.js
 * @param {object} profile PlayerProfile
 * @returns {number} 0~1
 */
function deriveComboChain(ctx, profile) {
    const lastClear = ctx.lastClearCount ?? 0;
    const streak = profile.recentComboStreak ?? 0;
    if (lastClear === 0 && streak === 0) return 0;
    const base = Math.min(1, streak * 0.25 + (lastClear > 0 ? 0.3 : 0));
    return base;
}

/**
 * 从 spawnContext 推导多消鼓励强度
 * @param {object} ctx
 * @param {number} fill
 * @returns {number} 0~1
 */
function deriveMultiClearBonus(ctx, fill) {
    const roundsSinceClear = ctx.roundsSinceClear ?? 0;
    if (roundsSinceClear > 3) return 0.6;
    if (fill > 0.55) return 0.3;
    return 0.1;
}

/**
 * 从 pacing + spawnContext 推导节奏相位
 * @param {object} profile
 * @param {object} ctx
 * @returns {'setup'|'payoff'|'neutral'}
 */
function deriveRhythmPhase(profile, ctx) {
    const pacingPhase = profile.pacingPhase;
    const roundsSinceClear = ctx.roundsSinceClear ?? 0;
    if (pacingPhase === 'release' || roundsSinceClear >= 3) return 'payoff';
    if (pacingPhase === 'tension' && roundsSinceClear === 0) return 'setup';
    return 'neutral';
}

/* ------------------------------------------------------------------ */
/*  Layer 3: session 弧线 + 里程碑                                     */
/* ------------------------------------------------------------------ */

const MILESTONE_SCORES = [50, 100, 150, 200, 300, 500];

/**
 * 推导 session 弧线阶段
 * @param {number} totalRounds 本局已出块轮数
 * @param {string} sessionPhase profile.sessionPhase
 * @returns {'warmup'|'peak'|'cooldown'}
 */
function deriveSessionArc(totalRounds, sessionPhase) {
    if (totalRounds <= 3) return 'warmup';
    if (sessionPhase === 'late') return 'cooldown';
    return 'peak';
}

/**
 * 检查分数是否刚跨越里程碑
 * @param {number} score
 * @param {number} prevMilestone 上次触发的里程碑分数
 * @returns {{ hit: boolean, milestone: number }}
 */
function checkMilestone(score, prevMilestone) {
    for (const m of MILESTONE_SCORES) {
        if (score >= m && (prevMilestone ?? 0) < m) {
            return { hit: true, milestone: m };
        }
    }
    return { hit: false, milestone: prevMilestone ?? 0 };
}

/** 记录上次触发的里程碑分数 */
let _prevMilestone = 0;

export function resetAdaptiveMilestone() {
    _prevMilestone = 0;
}

/* ------------------------------------------------------------------ */
/*  自适应策略解析（三层整合）                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {string} baseStrategyId 玩家选择的基础难度
 * @param {import('./playerProfile.js').PlayerProfile} profile 玩家实时画像
 * @param {number} score 当前分数
 * @param {number} runStreak 连战局数
 * @param {number} _boardFill 当前板面填充率
 * @param {object} [spawnContext] 来自 game.js 的跨轮上下文
 * @returns {object} 策略对象 + spawnHints
 */
export function resolveAdaptiveStrategy(baseStrategyId, profile, score, runStreak, _boardFill, spawnContext) {
    const cfg = GAME_RULES.adaptiveSpawn;
    if (!cfg?.enabled || !cfg.profiles?.length || !profile) {
        return resolveLayeredStrategy(baseStrategyId, score, runStreak);
    }

    const fz = cfg.flowZone ?? {};
    const eng = cfg.engagement ?? {};
    const pacing = cfg.pacing ?? {};
    const base = getStrategy(baseStrategyId);
    const ctx = spawnContext || {};

    /* ---------- 基础信号 ---------- */
    const scoreStress = getSpawnStressFromScore(score);
    const runMods = getRunDifficultyModifiers(runStreak);

    /* ---------- 技能调节（置信度门控） ---------- */
    const skill = profile.skillLevel;
    const conf = profile.confidence ?? 0;
    const confGate = 0.4 + 0.6 * conf;
    const skillAdjust = (skill - 0.5) * (fz.skillAdjustScale ?? 0.3) * confGate;

    /* ---------- 心流调节 ---------- */
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

    /* ---------- 长周期趋势 ---------- */
    const trend = profile.trend ?? 0;
    const trendScale = fz.trendAdjustScale ?? 0.08;
    const trendAdjust = trend * trendScale * conf;

    /* ---------- Layer 3: session 弧线调节 ---------- */
    const totalRounds = ctx.totalRounds ?? 0;
    const sessionArc = deriveSessionArc(totalRounds, profile.sessionPhase);
    let sessionArcAdjust = 0;
    if (sessionArc === 'warmup') sessionArcAdjust = -0.08;
    else if (sessionArc === 'cooldown' && profile.momentum < -0.2) sessionArcAdjust = -0.05;

    /* ---------- Layer 3: 里程碑 ---------- */
    const milestoneCheck = checkMilestone(score, _prevMilestone);
    if (milestoneCheck.hit) _prevMilestone = milestoneCheck.milestone;

    /* ---------- 难度偏移：让 easy/normal/hard 影响自适应 stress 基线 ---------- */
    const difficultyBias = baseStrategyId === 'easy' ? -0.12
        : baseStrategyId === 'hard' ? 0.12 : 0;

    /* ---------- 综合 stress ---------- */
    let stress = scoreStress
        + runMods.stressBonus
        + difficultyBias
        + skillAdjust
        + flowAdjust
        + pacingAdjust
        + recoveryAdjust
        + frustRelief
        + comboAdjust
        + nearMissAdjust
        + feedbackBias
        + trendAdjust
        + sessionArcAdjust;

    /* ---------- 特殊覆写：新手保护 ---------- */
    if (profile.isInOnboarding) {
        stress = Math.min(stress, eng.firstSessionStressOverride ?? -0.15);
    }

    /* ---------- B 类进阶挑战档：高分段自动加压 ----------
     * 触发条件：
     *   1. 玩家分群为 B（中度无尽）或 sessionTrend=stable/rising
     *   2. 当前分数 ≥ 历史最高分 × 0.8（接近最高分时增加挑战感）
     *   3. stress 尚未满档（避免叠加溢出）
     * 效果：stress 额外 +0.08~+0.15，使出块更复杂、填充更密
     * ---------------------------------------------------------- */
    const segment5 = profile.segment5 ?? 'A';
    const sessionTrend = profile.sessionTrend ?? 'stable';
    const isBClassChallenge = (segment5 === 'B' || sessionTrend !== 'declining')
        && ctx.bestScore > 0
        && score >= ctx.bestScore * 0.8
        && stress < 0.7;
    if (isBClassChallenge) {
        const challengeBoost = Math.min(0.15, (score / ctx.bestScore - 0.8) * 0.75);
        stress = Math.min(0.85, stress + challengeBoost);
    }

    stress = Math.max(-0.2, Math.min(1, stress));

    /* ---------- 插值 shapeWeights ---------- */
    const shapeWeights = interpolateProfileWeights(cfg.profiles, stress);

    /* ---------- fillRatio ---------- */
    // fillRatio=0（如简单模式空盘）不叠加连战加成，保持纯净空盘开局
    const _baseFill = base.fillRatio ?? 0.2;
    const fillRatio = _baseFill === 0
        ? 0
        : Math.min(0.36, Math.max(0, _baseFill + runMods.fillDelta));

    /* ================================================================ */
    /*  spawnHints 三层构建                                              */
    /* ================================================================ */
    let clearGuarantee = 1;
    let sizePreference = 0;
    let diversityBoost = 0;

    /* --- Layer 2: combo 链 --- */
    const comboChain = deriveComboChain(ctx, profile);

    /* --- Layer 2: 多消鼓励 --- */
    const multiClearBonus = deriveMultiClearBonus(ctx, _boardFill ?? 0);

    /* --- Layer 2: 节奏相位 --- */
    const rhythmPhase = deriveRhythmPhase(profile, ctx);

    /* --- 原有条件逻辑 --- */
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

    /* --- Layer 2: combo 活跃时提高消行保证 --- */
    if (comboChain > 0.5) {
        clearGuarantee = Math.max(clearGuarantee, 2);
    }

    /* --- Layer 2: payoff 节奏期提高多样性 --- */
    if (rhythmPhase === 'payoff') {
        diversityBoost = Math.max(diversityBoost, 0.1);
    }

    /* --- Layer 3: 里程碑庆祝 — 出块友好化 --- */
    if (milestoneCheck.hit) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.2);
    }

    /* --- Layer 3: warmup 阶段友好化 --- */
    if (sessionArc === 'warmup') {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.2);
    }

    return {
        ...base,
        shapeWeights,
        fillRatio,
        spawnHints: {
            clearGuarantee: Math.min(3, clearGuarantee),
            sizePreference: Math.max(-1, Math.min(1, sizePreference)),
            diversityBoost: Math.max(0, Math.min(1, diversityBoost)),
            comboChain: Math.max(0, Math.min(1, comboChain)),
            multiClearBonus: Math.max(0, Math.min(1, multiClearBonus)),
            rhythmPhase,
            sessionArc,
            scoreMilestone: milestoneCheck.hit
        },
        _adaptiveStress: stress,
        _difficultyBias: difficultyBias,
        _flowState: flow,
        _flowDeviation: flowDev,
        _feedbackBias: feedbackBias,
        _skillLevel: skill,
        _pacingPhase: profile.pacingPhase,
        _momentum: profile.momentum,
        _frustration: profile.frustrationLevel,
        _sessionPhase: profile.sessionPhase,
        _trend: trend,
        _confidence: conf,
        _historicalSkill: profile.historicalSkill,
        _sessionArc: sessionArc,
        _comboChain: comboChain,
        _rhythmPhase: rhythmPhase,
        _milestoneHit: milestoneCheck.hit
    };
}
