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
 *   multiLineTarget (0|1|2) v10.33：显式「多线兑现」目标强度 → blockSpawn 加权 multiClear≥2
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
import { buildPlayerAbilityVector } from './playerAbilityModel.js';

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
    // ctx.nearFullLines / ctx.pcSetup 由 game.js 在每轮出块后从诊断中回写
    const nearFullLines = ctx.nearFullLines ?? 0;
    const pcSetup = ctx.pcSetup ?? 0;

    // 清屏机会（blockSpawn 诊断确认）→ 最大鼓励
    if (pcSetup >= 2) return 1.0;
    if (pcSetup >= 1) return 0.9;
    // 棋盘临消行极多 → 强烈鼓励多消（清屏机会）
    if (nearFullLines >= 5) return 1.0;
    if (nearFullLines >= 3) return 0.8;
    // 久未消行 → 高多消鼓励
    if (roundsSinceClear > 3) return 0.7;
    // 高填充 → 中等多消鼓励
    if (fill > 0.60) return 0.6;
    if (fill > 0.45) return 0.4;
    // 基础鼓励（始终保持一定引导）
    return 0.22;
}

/**
 * 从 pacing + spawnContext 推导节奏相位
 * @param {object} profile
 * @param {object} ctx
 * @returns {'setup'|'payoff'|'neutral'}
 */
/**
 * @param {import('./playerProfile.js').PlayerProfile} profile
 * @param {object} ctx
 * @param {number} fill 当前盘面填充率（与 game 传入的 boardFill 一致）
 */
function deriveRhythmPhase(profile, ctx, fill = 0) {
    const pacingPhase = profile.pacingPhase;
    const roundsSinceClear = ctx.roundsSinceClear ?? 0;
    const nearFullLines = ctx.nearFullLines ?? 0;
    const pcSetup = ctx.pcSetup ?? 0;
    // 几何兑现条件：无「临消 / 清屏准备」时不要把 payoff 拉满，避免盘面配不上仍强行「收获期」
    const nearGeom = pcSetup >= 1
        || nearFullLines >= 2
        || (fill > 0.52 && nearFullLines >= 1);

    if (pcSetup >= 1) return 'payoff';
    if (nearFullLines >= 3) return 'payoff';
    if (pacingPhase === 'release' && nearGeom) return 'payoff';
    if (roundsSinceClear >= 2 && nearGeom) return 'payoff';
    if (pacingPhase === 'tension' && roundsSinceClear === 0) return 'setup';
    return 'neutral';
}

/**
 * 多线兑现目标：与 multiClearBonus 互补；偏高时 blockSpawn 阶段 1/2 显式偏好 multiClear≥2
 * @param {object} ctx
 * @param {number} fill
 * @returns {0|1|2}
 */
function deriveMultiLineTarget(ctx, fill) {
    const pcSetup = ctx.pcSetup ?? 0;
    const nearFullLines = ctx.nearFullLines ?? 0;
    const lastClear = ctx.lastClearCount ?? 0;

    if (pcSetup >= 2) return 2;
    if (pcSetup >= 1) return 2;
    if (nearFullLines >= 5) return 2;
    if (nearFullLines >= 3) return 1;
    // 刚完成多线消除后的短窗口：鼓励下一手「可落位的单行兑现」，避免只有巨型块堵死续combo
    if (lastClear >= 2 && fill > 0.35) return 1;
    if (fill > 0.58 && nearFullLines >= 2) return 1;
    return 0;
}

/**
 * 根据玩家能力 + 心流状态生成“爽感兑现”偏置。
 * 目标：高手/无聊时给更高挑战与更强多消机会；焦虑/恢复时降低难度但保留清线爽点。
 * @param {import('./playerProfile.js').PlayerProfile} profile
 * @param {object} ctx
 * @param {number} fill
 * @param {object} cfg adaptiveSpawn.delight
 */
function deriveDelightTuning(profile, ctx, fill, cfg = {}) {
    const skill = Math.max(0, Math.min(1, profile.skillLevel ?? 0.5));
    const momentum = Math.max(-1, Math.min(1, profile.momentum ?? 0));
    const flow = profile.flowState;
    const pacing = profile.pacingPhase;
    const nearFullLines = ctx.nearFullLines ?? 0;
    const pcSetup = ctx.pcSetup ?? 0;
    const frustration = profile.frustrationLevel ?? 0;
    const recovery = profile.needsRecovery === true;

    const highSkill = Math.max(0, (skill - (cfg.highSkillThreshold ?? 0.62)) / 0.38);
    const positiveMomentum = Math.max(0, momentum);
    const pressureOpportunity = Math.min(1, nearFullLines / 4 + pcSetup * 0.35 + Math.max(0, fill - 0.42));
    const recoveryNeed = recovery ? 1 : Math.min(1, frustration / Math.max(1, cfg.frustrationReliefThreshold ?? 5));

    let stressAdjust = 0;
    if (flow === 'bored' && skill > 0.52) {
        stressAdjust += (cfg.boredSkillStressBoost ?? 0.07) * Math.min(1, highSkill + 0.35);
    }
    if (flow === 'anxious' || recovery) {
        stressAdjust -= (cfg.anxiousReliefStress ?? 0.08) * Math.max(0.4, recoveryNeed);
    }

    let multiClearBoost = cfg.baseMultiClearBoost ?? 0.22;
    multiClearBoost += highSkill * (cfg.highSkillMultiBoost ?? 0.22);
    multiClearBoost += positiveMomentum * (cfg.momentumMultiBoost ?? 0.16);
    multiClearBoost += pressureOpportunity * (cfg.opportunityMultiBoost ?? 0.30);
    if (flow === 'flow' || pacing === 'release') {
        multiClearBoost += cfg.flowPayoffBoost ?? 0.14;
    }
    if (flow === 'anxious' || recovery) {
        multiClearBoost += recoveryNeed * (cfg.reliefMultiBoost ?? 0.20);
    }

    let perfectClearBoost = 0;
    if (pcSetup >= 2) perfectClearBoost = 1;
    else if (pcSetup >= 1) perfectClearBoost = 0.75;
    else if (nearFullLines >= 4 && fill > 0.45) perfectClearBoost = 0.45;
    /* 疏板 / 双线临门：提高清屏块抽样权重（原仅在高 pcSetup 才显著） */
    if (nearFullLines >= 2 && fill > 0.30) perfectClearBoost = Math.max(perfectClearBoost, 0.38);
    if (nearFullLines >= 1 && fill <= 0.42) perfectClearBoost = Math.max(perfectClearBoost, 0.28);

    const mode = recovery || flow === 'anxious'
        ? 'relief'
        : flow === 'bored' && skill > 0.55
            ? 'challenge_payoff'
            : (flow === 'flow' || positiveMomentum > 0.35)
                ? 'flow_payoff'
                : 'neutral';

    return {
        stressAdjust,
        multiClearBoost: Math.max(0, Math.min(1, multiClearBoost)),
        perfectClearBoost: Math.max(0, Math.min(1, perfectClearBoost)),
        mode
    };
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
/*  v9: 解法数量难度调控（targetSolutionRange）                         */
/*                                                                    */
/*  根据综合 stress 在 adaptiveSpawn.solutionDifficulty.ranges 中选择档位， */
/*  传给 blockSpawn.js 用于在三连块通过 sequentiallySolvable 校验后再做  */
/*  解空间收缩/扩张。                                                  */
/* ------------------------------------------------------------------ */

/**
 * 根据 stress 选择解法数量档位。
 * @param {number} stress 综合压力（约 -0.2 ~ 1）
 * @param {object} cfg adaptiveSpawn.solutionDifficulty
 * @param {number} fill 当前盘面填充率
 * @returns {{ min: number|null, max: number|null, label?: string } | null}
 */
function deriveTargetSolutionRange(stress, cfg, fill) {
    if (!cfg?.enabled) return null;
    const activationFill = cfg.activationFill ?? 0.45;
    if ((fill ?? 0) < activationFill) return null;
    const ranges = Array.isArray(cfg.ranges) ? cfg.ranges : [];
    if (ranges.length === 0) return null;

    // ranges 按 minStress 升序，挑选 stress >= minStress 的最大档位
    const sorted = [...ranges].sort((a, b) => (a.minStress ?? -1) - (b.minStress ?? -1));
    let chosen = null;
    for (const r of sorted) {
        if (stress >= (r.minStress ?? -1)) chosen = r;
    }
    if (!chosen) chosen = sorted[0];
    return {
        min: chosen.min ?? null,
        max: chosen.max ?? null,
        label: chosen.label
    };
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

    const difficultyTuning = cfg.difficultyTuning?.[baseStrategyId] || {};
    const fz = cfg.flowZone ?? {};
    const eng = cfg.engagement ?? {};
    const pacing = cfg.pacing ?? {};
    const topoCfg = cfg.topologyDifficulty ?? {};
    const base = getStrategy(baseStrategyId);
    const ctx = spawnContext || {};

    /* ---------- 基础信号 ---------- */
    const scoreStress = getSpawnStressFromScore(score);
    const runMods = getRunDifficultyModifiers(runStreak);
    const holes = Math.max(0, Number(ctx.holes ?? 0) || 0);
    const holePressure = Math.max(0, Math.min(1, holes / Math.max(1, topoCfg.holePressureMax ?? 8)));
    const holeReliefAdjust = holePressure * (topoCfg.holeReliefStress ?? -0.16);
    const ability = buildPlayerAbilityVector(profile, {
        boardFill: _boardFill ?? 0,
        spawnContext: ctx,
        topology: {
            holes,
            fillRatio: _boardFill ?? 0,
            close1: ctx.close1 ?? 0,
            close2: ctx.close2 ?? 0,
            mobility: ctx.mobility ?? 0,
        },
    });

    /* ---------- 技能调节（置信度门控） ---------- */
    const skill = ability.skillScore;
    const conf = ability.confidence;
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
    const delight = deriveDelightTuning(profile, ctx, _boardFill ?? 0, cfg.delight ?? {});
    const abilityRiskCfg = GAME_RULES.playerAbilityModel?.adaptiveSpawnRiskAdjust ?? {};
    const abilityRiskMinConf = abilityRiskCfg.minConfidence ?? 0.25;
    const abilityRiskThreshold = abilityRiskCfg.riskThreshold ?? 0.62;
    const abilityRiskRelief = abilityRiskCfg.stressRelief ?? -0.08;
    const abilityRiskAdjust = ability.confidence >= abilityRiskMinConf && ability.riskLevel >= abilityRiskThreshold
        ? abilityRiskRelief * Math.min(1, (ability.riskLevel - abilityRiskThreshold) / Math.max(0.001, 1 - abilityRiskThreshold))
        : 0;

    /* ---------- 难度偏移：让 easy/normal/hard 显著影响自适应 stress 基线 ---------- */
    const fallbackDifficultyBias = baseStrategyId === 'easy' ? -0.22
        : baseStrategyId === 'hard' ? 0.22 : 0;
    const difficultyBias = Number.isFinite(difficultyTuning.stressBias)
        ? difficultyTuning.stressBias
        : fallbackDifficultyBias;

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
        + sessionArcAdjust
        + holeReliefAdjust
        + abilityRiskAdjust
        + delight.stressAdjust;

    /* ---------- 特殊覆写：新手保护 ---------- */
    const inOnboarding = profile.isInOnboarding;
    if (inOnboarding) {
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
    if (!inOnboarding && !profile.needsRecovery && Number.isFinite(difficultyTuning.minStress)) {
        stress = Math.max(stress, difficultyTuning.minStress);
    }

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
    let multiClearBonus = Math.max(
        deriveMultiClearBonus(ctx, _boardFill ?? 0),
        delight.multiClearBoost
    );

    /* --- Layer 2: 节奏相位 + 多线目标 --- */
    let rhythmPhase = deriveRhythmPhase(profile, ctx, _boardFill ?? 0);
    let multiLineTarget = deriveMultiLineTarget(ctx, _boardFill ?? 0);

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
    // 连续多轮无消行时进入救援态，强制提高可解压出块比例
    if ((ctx.roundsSinceClear ?? 0) >= 2) {
        clearGuarantee = Math.max(clearGuarantee, 2);
    }
    if ((ctx.roundsSinceClear ?? 0) >= 4) {
        clearGuarantee = Math.max(clearGuarantee, 3);
        sizePreference = Math.min(sizePreference, -0.35);
    }
    if (holes >= (topoCfg.holeClearGuaranteeAt ?? 2)) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, topoCfg.holeSizePreference ?? -0.22);
    }

    /* --- Layer 2: combo 活跃时提高消行保证 --- */
    if (comboChain > 0.5) {
        clearGuarantee = Math.max(clearGuarantee, 2);
    }

    /* --- Ability 风险护栏：高风险时优先保活，低风险高手允许更强挑战/多消兑现 --- */
    const riskLevel = ability.riskLevel ?? 0;
    if (ability.confidence >= 0.25 && riskLevel >= 0.62) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.22);
        multiClearBonus = Math.max(multiClearBonus, 0.45);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    } else if (ability.confidence >= 0.45 && ability.skillScore >= 0.72 && riskLevel <= 0.38) {
        diversityBoost = Math.max(diversityBoost, 0.12);
        multiClearBonus = Math.max(multiClearBonus, 0.5);
        if (rhythmPhase === 'neutral' && (ctx.nearFullLines ?? 0) >= 1) rhythmPhase = 'payoff';
    }

    /* --- 拓扑机会：临消线/清屏准备对规则轨和生成式上下文保持同一口径 --- */
    const nearFullLines = ctx.nearFullLines ?? 0;
    const pcSetup = ctx.pcSetup ?? 0;
    if (pcSetup >= 1) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiLineTarget = Math.max(multiLineTarget, 2);
        multiClearBonus = Math.max(multiClearBonus, 0.75);
        rhythmPhase = 'payoff';
    } else if (nearFullLines >= 3) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiLineTarget = Math.max(multiLineTarget, 1);
        multiClearBonus = Math.max(multiClearBonus, 0.6);
        if (rhythmPhase === 'neutral') rhythmPhase = 'payoff';
    }

    /* --- Layer 2: payoff 节奏期提高多样性 --- */
    if (rhythmPhase === 'payoff') {
        diversityBoost = Math.max(diversityBoost, 0.1);
    }
    if (delight.mode === 'challenge_payoff') {
        diversityBoost = Math.max(diversityBoost, 0.12);
        if (rhythmPhase === 'neutral') rhythmPhase = 'payoff';
        multiLineTarget = Math.max(multiLineTarget, 1);
    } else if (delight.mode === 'flow_payoff') {
        if (rhythmPhase === 'neutral') rhythmPhase = 'payoff';
        multiLineTarget = Math.max(multiLineTarget, 1);
    } else if (delight.mode === 'relief') {
        clearGuarantee = Math.max(clearGuarantee, 2);
        sizePreference = Math.min(sizePreference, -0.25);
    }
    if (delight.perfectClearBoost >= 0.75) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiLineTarget = Math.max(multiLineTarget, 2);
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

    /* ================================================================ */
    /*  玩法偏好联动（playstyle → spawnHints 精细调控）                  */
    /*  在所有条件规则之后执行，作为最终风格对齐层                        */
    /* ================================================================ */
    const playstyle = profile.playstyle ?? 'balanced';
    if (playstyle === 'perfect_hunter') {
        // 清屏猎人：大幅提升多消潜力块权重 + 保障消行供给
        // 该玩家主动追求清空棋盘，需要提供更多能触发多行消除的方块组合
        multiClearBonus = Math.max(multiClearBonus, 0.85);
        clearGuarantee  = Math.max(clearGuarantee, 2);
        multiLineTarget = Math.max(multiLineTarget, 2);
    } else if (playstyle === 'multi_clear') {
        // 多消玩家：提升多消鼓励，顺势切入 payoff 节奏
        multiClearBonus = Math.max(multiClearBonus, 0.65);
        multiLineTarget = Math.max(multiLineTarget, 1);
        if (rhythmPhase === 'neutral') rhythmPhase = 'payoff';
    } else if (playstyle === 'combo') {
        // 连消玩家：comboChain 信号已由 recentComboStreak 自动拉高，
        // 这里额外保障至少有 2 个消行槽位供续链
        clearGuarantee = Math.max(clearGuarantee, 2);
    } else if (playstyle === 'survival') {
        // 生存型：减压 + 偏小块，降低卡死风险，保障最低可放置性
        sizePreference = Math.min(sizePreference, -0.25);
        clearGuarantee = Math.max(clearGuarantee, 1);
    }
    // 'balanced'：不做额外调整，沿用上方所有条件规则的结果

    /* --- v10.33 局间热身：上一局无步可走后，下局前几轮由 game.js 写入 warmupRemaining / warmupClearBoost --- */
    const wr = ctx.warmupRemaining ?? 0;
    const wb = Math.max(0, Math.min(2, ctx.warmupClearBoost ?? 0));
    if (wr > 0) {
        clearGuarantee = Math.max(clearGuarantee, 2 + Math.min(1, wb));
        clearGuarantee = Math.min(3, clearGuarantee);
        sizePreference = Math.min(sizePreference, -0.28);
        multiClearBonus = Math.max(multiClearBonus, 0.42);
        multiLineTarget = Math.max(multiLineTarget, wb >= 2 ? 2 : 1);
        if (rhythmPhase === 'setup') rhythmPhase = 'neutral';
    }

    /* ---------- 玩家所选难度直接影响 spawnHints ----------
     * 降低 clearGuarantee 只作用于普通状态，不削弱救场、挫败恢复、新手保护和跨局热身。
     */
    const clearGuaranteeDelta = difficultyTuning.clearGuaranteeDelta ?? 0;
    if (clearGuaranteeDelta > 0) {
        clearGuarantee += clearGuaranteeDelta;
    } else if (
        clearGuaranteeDelta < 0
        && !inOnboarding
        && !profile.needsRecovery
        && profile.frustrationLevel < frustThreshold
        && (ctx.roundsSinceClear ?? 0) < 2
        && wr <= 0
    ) {
        clearGuarantee += clearGuaranteeDelta;
    }
    sizePreference += difficultyTuning.sizePreferenceDelta ?? 0;
    multiClearBonus += difficultyTuning.multiClearBonusDelta ?? 0;

    /* ---------- v9: 解法数量难度区间 ---------- */
    const solutionStress = Math.max(-0.2, Math.min(
        1,
        stress + (difficultyTuning.solutionStressDelta ?? 0)
    ));
    const targetSolutionRange = deriveTargetSolutionRange(
        solutionStress,
        cfg.solutionDifficulty,
        _boardFill ?? 0
    );

    return {
        ...base,
        shapeWeights,
        fillRatio,
        spawnHints: {
            clearGuarantee: Math.max(0, Math.min(3, clearGuarantee)),
            sizePreference: Math.max(-1, Math.min(1, sizePreference)),
            diversityBoost: Math.max(0, Math.min(1, diversityBoost)),
            comboChain: Math.max(0, Math.min(1, comboChain)),
            multiClearBonus: Math.max(0, Math.min(1, multiClearBonus)),
            multiLineTarget: Math.max(0, Math.min(2, multiLineTarget)),
            delightBoost: Math.max(0, Math.min(1, delight.multiClearBoost)),
            perfectClearBoost: Math.max(0, Math.min(1, delight.perfectClearBoost)),
            delightMode: delight.mode,
            rhythmPhase,
            sessionArc,
            scoreMilestone: milestoneCheck.hit,
            targetSolutionRange
        },
        _adaptiveStress: stress,
        _difficultyBias: difficultyBias,
        _difficultyTuning: difficultyTuning,
        _holePressure: holePressure,
        _holes: holes,
        _solutionStress: solutionStress,
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
        _milestoneHit: milestoneCheck.hit,
        _playstyle: playstyle,
        _delightMode: delight.mode,
        _delightBoost: delight.multiClearBoost,
        _perfectClearBoost: delight.perfectClearBoost,
        _targetSolutionRange: targetSolutionRange,
        _abilityVector: ability,
        _abilityRiskAdjust: abilityRiskAdjust
    };
}
