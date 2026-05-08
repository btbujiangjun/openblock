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
/*  v1.17：harvest / payoff 触发的最低占用率门槛
 *
 * pcSetup（perfect-clear setup 候选数）在低占用盘面上经常 ≥1（12 格散布
 * 也能凑出"某 3 块组合可清屏"的解），但这并不是"密集消行机会"，把
 * spawnIntent 拉到 'harvest' 或 rhythmPhase 拉到 'payoff' 都会让 UI 撒谎。
 * 要求 fill ≥ PC_SETUP_MIN_FILL 才允许把 pcSetup 单独当成兑现窗口。
 */
const PC_SETUP_MIN_FILL = 0.45;

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

function _signalScale(signalCfg, name) {
    const spec = signalCfg?.[name];
    if (spec?.enabled === false) return 0;
    return Number.isFinite(spec?.scale) ? spec.scale : 1;
}

function applySignal(signalCfg, name, value) {
    return value * _signalScale(signalCfg, name);
}

function deriveBoardRisk(fill, holePressure, abilityRisk) {
    const fillRisk = Math.max(0, Math.min(1, ((fill ?? 0) - 0.45) / 0.4));
    return Math.max(0, Math.min(1, fillRisk * 0.45 + holePressure * 0.35 + (abilityRisk ?? 0) * 0.2));
}

/**
 * v1.13：友好盘面救济
 *
 * 当盘面 holes=0、临消行/多消候选/清屏机会都很充沛、且节奏处于「兑现期」时，
 * 直接对 stress 注入一笔减压，让玩家面板上看到的「心情」与盘面实际状态一致
 * （避免出现「🥵 高压」与「享受多消快感」并列的认知冲突）。
 *
 * 减压幅度按机会强度在 [baseRelief, maxRelief] 之间插值：
 *   intensity = clamp(0.4 + 0.6 * (opportunity * 0.7 + cleanBoard * 0.3), 0, 1)
 *   relief    = baseRelief + (maxRelief − baseRelief) * intensity
 *
 * @param {object} ctx              spawnContext
 * @param {number} fill             当前盘面填充率
 * @param {number} holes            盘面空洞数
 * @param {string} rhythmPhase      'setup' | 'payoff' | 'neutral'
 * @param {object} [cfg]            adaptiveSpawn.friendlyBoard 配置
 * @returns {number}                ≤ 0；不满足条件时返回 0
 */
function deriveFriendlyBoardRelief(ctx, fill, holes, rhythmPhase, cfg = {}) {
    if (holes > 0) return 0;
    const nearFullLines = Math.max(0, Math.floor(ctx.nearFullLines ?? 0));
    const multiClearCands = Math.max(0, Math.floor(ctx.multiClearCandidates ?? 0));
    const pcSetup = Math.max(0, Math.floor(ctx.pcSetup ?? 0));

    const minNearFullLines = cfg.minNearFullLines ?? 2;
    const minMultiClearCandidates = cfg.minMultiClearCandidates ?? 2;
    const requirePayoff = cfg.requirePayoff !== false;

    const hasGeometry = nearFullLines >= minNearFullLines
        && (multiClearCands >= minMultiClearCandidates || pcSetup >= 1);
    const hasPayoffWindow = !requirePayoff || rhythmPhase === 'payoff';
    if (!hasGeometry || !hasPayoffWindow) return 0;

    const opportunity = Math.min(1, nearFullLines / 4 + multiClearCands / 4 + pcSetup * 0.3);
    const cleanBoard = 1 - Math.min(1, Math.max(0, fill ?? 0));
    const intensity = Math.max(0, Math.min(1, 0.4 + 0.6 * (opportunity * 0.7 + cleanBoard * 0.3)));

    const baseRelief = cfg.baseRelief ?? -0.12;
    const maxRelief = cfg.maxRelief ?? -0.18;
    return baseRelief + (maxRelief - baseRelief) * intensity;
}

function smoothStress(current, ctx, cfg, immediateRelief) {
    if (!cfg?.enabled) return current;
    const prev = Number(ctx?.prevAdaptiveStress);
    if (!Number.isFinite(prev)) return current;
    if (immediateRelief && current < prev) return current;

    const alpha = Math.max(0.01, Math.min(1, cfg.alpha ?? 0.35));
    const maxStepUp = Math.max(0.01, cfg.maxStepUp ?? 0.18);
    const maxStepDown = Math.max(0.01, cfg.maxStepDown ?? 0.28);
    const smoothed = prev + (current - prev) * alpha;
    if (current > prev) return Math.min(current, Math.min(smoothed, prev + maxStepUp));
    return Math.max(current, Math.max(smoothed, prev - maxStepDown));
}

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function deriveSpawnTargets(stress, profile, ctx, fill, boardRisk, delight, cfg = {}) {
    const stress01 = clamp01((stress + 0.2) / 1.2);
    const recoveryNeed = profile.needsRecovery || profile.hadRecentNearMiss
        ? 1
        : clamp01((profile.frustrationLevel ?? 0) / Math.max(1, cfg.frustrationReliefThreshold ?? 5));
    const payoffOpportunity = clamp01(
        ((ctx.nearFullLines ?? 0) / 4)
        + (ctx.pcSetup ?? 0) * 0.35
        + Math.max(0, (fill ?? 0) - 0.42)
    );
    const skill = clamp01(profile.skillLevel ?? 0.5);
    const boredHighSkill = profile.flowState === 'bored' ? Math.max(0, skill - 0.5) * 1.4 : 0;
    const riskRelief = Math.max(boardRisk, recoveryNeed);

    const shapeComplexity = clamp01(stress01 * 0.75 + boredHighSkill * 0.25 - riskRelief * 0.45);
    const solutionSpacePressure = clamp01(stress01 * 0.7 + shapeComplexity * 0.25 - boardRisk * 0.55 - recoveryNeed * 0.35);
    const clearOpportunity = clamp01(recoveryNeed * 0.55 + payoffOpportunity * 0.45 + (profile.pacingPhase === 'release' ? 0.12 : 0) - stress01 * 0.18);
    const spatialPressure = clamp01(stress01 * 0.65 + (fill ?? 0) * 0.25 - boardRisk * 0.5 - recoveryNeed * 0.3);
    const payoffIntensity = clamp01((delight.multiClearBoost ?? 0) * 0.45 + payoffOpportunity * 0.4 + Math.max(0, profile.momentum ?? 0) * 0.15);
    const novelty = clamp01((profile.flowState === 'bored' ? 0.45 : 0) + stress01 * 0.25 + (ctx.totalRounds ?? 0) / 80 - recoveryNeed * 0.2);

    return {
        shapeComplexity,
        solutionSpacePressure,
        clearOpportunity,
        spatialPressure,
        payoffIntensity,
        novelty
    };
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
    /* v1.17：pcSetup 单独不足以判定 payoff —— 低占用盘面经常误触发。
     * pcSetup 必须配合 fill ≥ PC_SETUP_MIN_FILL 才视为「已经有可兑现的几何」，
     * 否则只是"理论清屏"，与 UI「收获期」叙事不符。
     */
    const pcSetupMeaningful = pcSetup >= 1 && fill >= PC_SETUP_MIN_FILL;
    // 几何兑现条件：无「临消 / 清屏准备」时不要把 payoff 拉满，避免盘面配不上仍强行「收获期」
    const nearGeom = pcSetupMeaningful
        || nearFullLines >= 2
        || (fill > 0.52 && nearFullLines >= 1);

    if (pcSetupMeaningful) return 'payoff';
    if (nearFullLines >= 3) return 'payoff';
    if (pacingPhase === 'release' && nearGeom) return 'payoff';
    if (roundsSinceClear >= 2 && nearGeom) return 'payoff';
    /* v1.21：'setup' 与 'harvest' 互斥兜底 ——
     * 旧版只判 (pacingPhase==='tension' && roundsSinceClear===0) 就返回 'setup'，
     * 但 spawnIntent='harvest' 的判定（line 975）只看 nearFullLines>=2 / pcSetupMeaningful，
     * 两者口径不同 → 同帧出现 pill「节奏 搭建」+「意图 兑现」、stress story
     * 「投放促清形状」+ strategyAdvisor「搭建期 稳定堆叠 留通道」对立叙事。
     * 加 `&& !nearGeom`：紧张期开头若几何已经支持兑现就不再"蓄力"，
     * fall through 到 'neutral'，再由后续 `canPromoteToPayoff` 升 'payoff'，
     * 与 spawnIntent='harvest' 同口径。 */
    if (pacingPhase === 'tension' && roundsSinceClear === 0 && !nearGeom) return 'setup';
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
    const signalCfg = cfg.signals ?? {};
    const base = getStrategy(baseStrategyId);
    const ctx = spawnContext || {};

    /* ---------- 基础信号 ----------
     * v1.13：scoreStress 改为按「个人百分位」映射（基于 ctx.bestScore），
     * 避免一次冲过 milestones 末档后 scoreStress 永远锁死最高值。
     */
    const scoreStress = getSpawnStressFromScore(score, { bestScore: ctx.bestScore });
    const runMods = getRunDifficultyModifiers(runStreak);
    const holes = Math.max(0, Number(ctx.holes ?? 0) || 0);
    const holePressure = Math.max(0, Math.min(1, holes / Math.max(1, topoCfg.holePressureMax ?? 8)));
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
    const boardRisk = deriveBoardRisk(_boardFill ?? 0, holePressure, ability.riskLevel ?? 0);
    const boardRiskReliefAdjust = boardRisk * (topoCfg.boardRiskReliefStress ?? -0.1);
    const holeReliefAdjust = holePressure * (topoCfg.holeReliefStress ?? -0.16);

    /* ---------- 难度偏移：让 easy/normal/hard 显著影响自适应 stress 基线 ---------- */
    const fallbackDifficultyBias = baseStrategyId === 'easy' ? -0.22
        : baseStrategyId === 'hard' ? 0.22 : 0;
    const difficultyBias = Number.isFinite(difficultyTuning.stressBias)
        ? difficultyTuning.stressBias
        : fallbackDifficultyBias;

    /* ---------- v1.13：友好盘面救济（提前推算节奏相位）----------
     * deriveRhythmPhase 是纯函数，提前调用一次用于 friendlyBoardRelief 判定，
     * 真正写入 spawnHints 的 rhythmPhase 仍由后续主路径决定。
     */
    const earlyRhythmPhase = deriveRhythmPhase(profile, ctx, _boardFill ?? 0);
    const friendlyBoardRelief = deriveFriendlyBoardRelief(
        ctx, _boardFill ?? 0, holes, earlyRhythmPhase, cfg.friendlyBoard ?? {}
    );

    /* ---------- 综合 stress ---------- */
    const stressBreakdown = {
        scoreStress: applySignal(signalCfg, 'scoreStress', scoreStress),
        runStreakStress: applySignal(signalCfg, 'runStreakStress', runMods.stressBonus),
        difficultyBias: applySignal(signalCfg, 'difficultyBias', difficultyBias),
        skillAdjust: applySignal(signalCfg, 'skillAdjust', skillAdjust),
        flowAdjust: applySignal(signalCfg, 'flowAdjust', flowAdjust),
        pacingAdjust: applySignal(signalCfg, 'pacingAdjust', pacingAdjust),
        recoveryAdjust: applySignal(signalCfg, 'recoveryAdjust', recoveryAdjust),
        frustrationRelief: applySignal(signalCfg, 'frustrationRelief', frustRelief),
        comboAdjust: applySignal(signalCfg, 'comboAdjust', comboAdjust),
        nearMissAdjust: applySignal(signalCfg, 'nearMissAdjust', nearMissAdjust),
        feedbackBias: applySignal(signalCfg, 'feedbackBias', feedbackBias),
        trendAdjust: applySignal(signalCfg, 'trendAdjust', trendAdjust),
        sessionArcAdjust: applySignal(signalCfg, 'sessionArcAdjust', sessionArcAdjust),
        holeReliefAdjust: applySignal(signalCfg, 'holeReliefAdjust', holeReliefAdjust),
        boardRiskReliefAdjust: applySignal(signalCfg, 'boardRiskReliefAdjust', boardRiskReliefAdjust),
        abilityRiskAdjust: applySignal(signalCfg, 'abilityRiskAdjust', abilityRiskAdjust),
        delightStressAdjust: applySignal(signalCfg, 'delightStressAdjust', delight.stressAdjust),
        friendlyBoardRelief: applySignal(signalCfg, 'friendlyBoardRelief', friendlyBoardRelief),
        boardRisk
    };

    let stress = Object.entries(stressBreakdown)
        .filter(([key]) => key !== 'boardRisk')
        .reduce((sum, [, value]) => sum + value, 0);
    stressBreakdown.rawStress = stress;

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
        stressBreakdown.challengeBoost = challengeBoost;
    } else {
        stressBreakdown.challengeBoost = 0;
    }

    stressBreakdown.beforeClamp = stress;
    stress = Math.max(-0.2, Math.min(1, stress));
    stressBreakdown.afterClamp = stress;

    /* v1.16：占用率衰减（occupancyDamping）
     * 当盘面填充很低时，scoreStress / runStreakStress 等"分数驱动"信号会把综合 stress
     * 推到 0.8+，但拟人化压力表此时显示「🥵 高压」与玩家在空盘上的实际体感严重不符。
     * 这里在 clamp 之后、smoothing 之前对正向 stress 乘一个 [0.4, 1.0] 的缩放因子：
     *   - fill=0    → ×0.4（最大衰减；空盘只剩底色压力）
     *   - fill=0.25 → ×0.5
     *   - fill=0.39 → ×0.78（产线观察到的 stress=0.89 → 0.69，进入 tense 而非 intense）
     *   - fill≥0.5  → ×1.0（完全不衰减；中高占用以上保留原有信号）
     * 负向 stress（救济/挫败）不衰减，避免空盘减压被无意撤销。 */
    let occupancyDamping = 0;
    if (stress > 0) {
        const occupancyScale = Math.max(0.4, Math.min(1, (_boardFill ?? 0) / 0.5));
        if (occupancyScale < 1) {
            const damped = stress * occupancyScale;
            occupancyDamping = damped - stress;
            stress = damped;
        }
    }
    stressBreakdown.occupancyDamping = occupancyDamping;
    stressBreakdown.afterOccupancy = stress;
    const immediateRelief = profile.needsRecovery
        || profile.hadRecentNearMiss
        || profile.frustrationLevel >= frustThreshold
        || boardRisk >= (cfg.stressSmoothing?.immediateReliefBoardRisk ?? 0.72);
    stress = smoothStress(stress, ctx, cfg.stressSmoothing, immediateRelief);
    stressBreakdown.afterSmoothing = stress;
    if (!inOnboarding && !profile.needsRecovery && Number.isFinite(difficultyTuning.minStress)) {
        stress = Math.max(stress, difficultyTuning.minStress);
    }
    /* v1.13：flow + payoff 时把 stress 封顶到 tense（默认 0.79），避免拟人化压力表
     * 出现「🥵 高压」与叙事「享受多消快感」并列的认知冲突。仅在盘面无空洞、风险不高时生效。 */
    const flowPayoffCap = cfg.flowPayoffStressCap;
    if (Number.isFinite(flowPayoffCap)
        && profile.flowState === 'flow'
        && earlyRhythmPhase === 'payoff'
        && holes === 0
        && boardRisk < (cfg.flowPayoffMaxBoardRisk ?? 0.5)) {
        stress = Math.min(stress, flowPayoffCap);
        stressBreakdown.flowPayoffCap = flowPayoffCap;
    }
    stressBreakdown.finalStress = stress;
    const spawnTargets = deriveSpawnTargets(stress, profile, ctx, _boardFill ?? 0, boardRisk, delight, cfg.spawnTargets ?? {});

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
    const multiClearCands = Math.max(0, Math.floor(ctx.multiClearCandidates ?? 0));

    /* v1.17：rhythmPhase 升 'payoff' 需要"盘面真的能 harvest"才允许。
     * pcSetup 在低占用盘面上是噪声，flow_payoff / challenge_payoff / multi_clear
     * 等基于玩家状态的路径过去会无条件拉 payoff，造成 17% 散布盘面也推长条 +
     * stressMeter 报"收获期"。统一通过此 helper 兜底，UI 与出块偏向对齐。 */
    const canPromoteToPayoff = nearFullLines >= 1
        || multiClearCands >= 1
        || (pcSetup >= 1 && (_boardFill ?? 0) >= PC_SETUP_MIN_FILL);

    if (pcSetup >= 1) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiLineTarget = Math.max(multiLineTarget, 2);
        multiClearBonus = Math.max(multiClearBonus, 0.75);
        if ((_boardFill ?? 0) >= PC_SETUP_MIN_FILL) {
            rhythmPhase = 'payoff';
        }
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
        /* v1.17：仅当盘面真的有 harvest 几何时才升 payoff —— 否则
         * "心流挑战"叙事会在空盘面上仍说"收获期"，与 UI 现实不符。 */
        if (rhythmPhase === 'neutral' && canPromoteToPayoff) rhythmPhase = 'payoff';
        multiLineTarget = Math.max(multiLineTarget, 1);
    } else if (delight.mode === 'flow_payoff') {
        if (rhythmPhase === 'neutral' && canPromoteToPayoff) rhythmPhase = 'payoff';
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
        /* v1.17：与上同——多消玩家偏好不能凭空把节奏拉到 payoff，需要几何兜底 */
        if (rhythmPhase === 'neutral' && canPromoteToPayoff) rhythmPhase = 'payoff';
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

    /* --- v1.16：AFK 召回（engage 路径） ---
     * 玩家在窗口内出现 ≥1 次 AFK（>15s 思考），传统做法是「降难度+小块」让 TA 喘息，
     * 但实际效果常常是连续给出 4 个单格 + 1×3 横条——盘面瞬间清爽，玩家依然提不起兴趣。
     * 这里改走「显著正反馈 + 可见目标」：
     *   - 多消鼓励 ≥0.6（提供 1 个能多消的长条）
     *   - 多线目标 ≥1（让 dock 至少 1 块为 multiClear≥2 的候选）
     *   - clearGuarantee ≥2（确保至少 2 块能立即兑现）
     *   - 多样性 ≥0.15（避免重复块进一步劝退）
     *   - rhythmPhase: neutral → payoff，让 stressMeter / 商业化文案统一切到「收获期」
     * 仅在 stress 不极高时启用，避免把已经救场状态再"加戏"压垮。 */
    const afkCount = Math.max(0, Number(profile?.metrics?.afkCount ?? 0) || 0);
    const afkEngageActive = afkCount >= 1
        && stress < 0.55
        && !inOnboarding
        && !profile.needsRecovery
        && profile.frustrationLevel < frustThreshold;
    if (afkEngageActive) {
        clearGuarantee = Math.max(clearGuarantee, 2);
        multiClearBonus = Math.max(multiClearBonus, 0.6);
        multiLineTarget = Math.max(multiLineTarget, 1);
        diversityBoost = Math.max(diversityBoost, 0.15);
        /* v1.17：AFK 召回也走几何兜底——空盘面上即便要召回，也通过 spawnIntent='engage'
         * 表达，rhythmPhase 不再骗用户"现在是收获期"。 */
        if (rhythmPhase === 'neutral' && canPromoteToPayoff) rhythmPhase = 'payoff';
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

    /* ---------- v1.17：clearGuarantee 物理可行性兜底 ----------
     * 上方多条规则（warmup wb=1 / roundsSinceClear≥4）会把 clearGuarantee 顶到 3，
     * 含义是"本轮强制至少推出 3 块能立刻消行的形状"。但如果当前盘面既没有
     * ≥2 条临消行也没有 ≥2 个真实多消候选，"立刻能消"在物理上无法兑现——
     * panel 上 pill 显示「目标保消 3」会变成空头支票。
     * 这里在所有 cg 调整完毕后回钳一次：当 cg≥3 但盘面不支持时降回 2，
     * 仍保持友好出块的语义，但不再做无法兑现的承诺。
     */
    if (clearGuarantee >= 3) {
        const mcCands = Math.max(0, Math.floor(ctx.multiClearCandidates ?? 0));
        const nfLines = Math.max(0, Math.floor(ctx.nearFullLines ?? 0));
        if (mcCands < 2 && nfLines < 2) {
            clearGuarantee = 2;
        }
    }

    /* ---------- v1.19：multiClearBonus / multiLineTarget 几何兜底 ----------
     * 与 v1.17 cg 兜底同源 —— 多消鼓励/多线目标也应与盘面几何匹配。
     * 当：
     *   - 当前没有任何多消候选（multiClearCandidates < 1）
     *   - 没有近满兜底（nearFullLines < 2，连"清了一条剩两条"都做不到）
     *   - 没有真 perfect-clear 窗口（pcSetup ≥1 但 fill < PC_SETUP_MIN_FILL 是噪声）
     *   - 不在 warmup 阶段（warmup 是显式的"结构性偏好"，跨局给玩家友好印象，
     *     即便当前盘面没几何也允许保留 multi-line 倾向；与 v1.17 cg 兜底相反，
     *     cg 是承诺、必须可兑现，multiLineTarget 是偏好、可以前瞻）
     * 三条同时成立时，把 multiClearBonus 软封顶到 0.4、multiLineTarget 归 0。
     * 否则会出现"长条 3.0 + 多消 0.65"重押多消形状，但落地后只能触发单行消除，
     * 与玩家在 dock 里看到的"明显多消导向"形成预期落差。
     * 软封顶：仍保留温和偏好（≤0.4 表示"略偏好但不重押"），不归 0 是因为
     * 单行消除的形状与多消候选形状大量重合，bonus 仍能起到正向作用。
     */
    {
        const _mcCands = Math.max(0, Math.floor(ctx.multiClearCandidates ?? 0));
        const _nfLines = Math.max(0, Math.floor(ctx.nearFullLines ?? 0));
        const _realPcSetup = pcSetup >= 1 && (_boardFill ?? 0) >= PC_SETUP_MIN_FILL;
        const _isWarmup = (Number(ctx.warmupRemaining) || 0) > 0;
        // AFK engage 与 warmup 同源：是显式的"召回"信号，需要保留鼓励兑现的偏好，
        // 即便此刻盘面几何不支持兑现；给玩家留出"放下手机回来→落几块就有消行"的体感。
        if (_mcCands < 1 && _nfLines < 2 && !_realPcSetup && !_isWarmup && !afkEngageActive) {
            multiClearBonus = Math.min(multiClearBonus, 0.4);
            multiLineTarget = 0;
        }
    }

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

    /* ---------- v1.16：spawnIntent — 出块意图的单一对外口径 ----------
     * 让「压力表叙事 / 商业化策略文案 / 回放标签」读同一个意图字段，避免出现：
     *   spawn 实际给了 4 个单格（极致泄压），但 stressMeter 仍说「悄悄加点料维持新鲜感」。
     *
     * 派生顺序（优先级从高到低）：
     *   relief    → 玩家有难：frustration/recovery/holeRelief/boardRiskRelief 主导
     *   engage    → 召回：AFK engage 触发（玩家停顿但状态尚可）
     *   harvest   → 几何兑现：pcSetup ≥1 或 nearFullLines ≥3（含 friendlyBoardRelief 场景）
     *   pressure  → 压力期：B 类挑战 / 接近最佳 / 高 stress
     *   flow      → 心流期：flow_payoff 或节奏 payoff
     *   maintain  → 默认中性维持
     *
     * ⚠ 注意：`friendlyBoardRelief` 是「盘面通透 + 兑现机会」的副产品，不是玩家有难的信号；
     *   归入 `harvest` 更贴合玩家体感。`relief` 仅由 frustration/recovery/holes/boardRisk 触发。
     */
    const playerDistress = (stressBreakdown.recoveryAdjust ?? 0)
        + (stressBreakdown.frustrationRelief ?? 0)
        + (stressBreakdown.nearMissAdjust ?? 0)
        + (stressBreakdown.holeReliefAdjust ?? 0)
        + (stressBreakdown.boardRiskReliefAdjust ?? 0);
    /* v1.17：harvest 收紧 —— 必须存在真实的"近一手就能兑现"的几何
     *   - nearFullLines ≥ 2：已有≥2 条临消行/列（与 deriveRhythmPhase 中 nearGeom 同口径）
     *   - 或 pcSetup ≥1 且占用 ≥ PC_SETUP_MIN_FILL：清屏候选+足够"满"才算窗口
     * 修正前：pcSetup ≥1 单独触发，会在 17% 散布盘面上仍宣布"密集消行机会"。
     */
    const nearFullForIntent = ctx.nearFullLines ?? 0;
    const pcSetupForIntent = ctx.pcSetup ?? 0;
    const harvestable = nearFullForIntent >= 2
        || (pcSetupForIntent >= 1 && (_boardFill ?? 0) >= PC_SETUP_MIN_FILL);
    let spawnIntent;
    if (playerDistress < -0.10 || delight.mode === 'relief') {
        spawnIntent = 'relief';
    } else if (afkEngageActive) {
        spawnIntent = 'engage';
    } else if (harvestable) {
        spawnIntent = 'harvest';
    } else if (stressBreakdown.challengeBoost > 0
        || (delight.mode === 'challenge_payoff' && stress >= 0.55)) {
        spawnIntent = 'pressure';
    } else if (delight.mode === 'flow_payoff' || rhythmPhase === 'payoff') {
        spawnIntent = 'flow';
    } else {
        spawnIntent = 'maintain';
    }

    return {
        ...base,
        shapeWeights,
        fillRatio,
        spawnHints: {
            clearGuarantee: Math.max(0, Math.min(3, clearGuarantee)),
            sizePreference: Math.max(-1, Math.min(1, sizePreference)),
            diversityBoost: Math.max(0, Math.min(1, diversityBoost)),
            spawnTargets,
            comboChain: Math.max(0, Math.min(1, comboChain)),
            multiClearBonus: Math.max(0, Math.min(1, multiClearBonus)),
            multiLineTarget: Math.max(0, Math.min(2, multiLineTarget)),
            delightBoost: Math.max(0, Math.min(1, delight.multiClearBoost)),
            perfectClearBoost: Math.max(0, Math.min(1, delight.perfectClearBoost)),
            delightMode: delight.mode,
            rhythmPhase,
            sessionArc,
            scoreMilestone: milestoneCheck.hit,
            targetSolutionRange,
            spawnIntent
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
        _abilityRiskAdjust: abilityRiskAdjust,
        _boardRisk: boardRisk,
        _stressBreakdown: stressBreakdown,
        _spawnTargets: spawnTargets,
        _spawnIntent: spawnIntent,
        _afkEngageActive: afkEngageActive
    };
}
