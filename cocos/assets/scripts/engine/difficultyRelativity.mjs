/* 自动生成 —— 请勿手改。源：web/src/difficultyRelativity.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * 难度相对论（Difficulty Relativity）—— §4.17 / §2.10 的"体感↔客观"标定核心。
 *
 * 不可动摇前提：**S 形 stress 曲线仍是调控主线**，给出目标体感难度 d* = stress（本模块不改 stress）。
 * 本模块只做两件事：
 *   1) 反解客观目标 b* = blend(stress, θ⃗) + Δ⃗(课程) + 噪声     —— solveObjectiveTarget()
 *   2) 给出候选块「等体感对齐」乘子 exp(−w·dist(b⃗, b*))         —— alignmentMultiplier()
 *
 * 关键性质：
 *   - personalizationStrength λ=0 → b* 各维 = stress（= 现状"客观≈stress"均匀行为），恒等退化。
 *   - λ=1 → 完整相对论：b*_d = clamp(θ_d + (stress−0.5))，高能力玩家同 stress 拿客观更难的题。
 *   - 12 路 bypass（disabled/rollout/low_conf/recovery/near_miss/bottleneck/post_pb_release/warmup）
 *     任一触发 → 返回 bypass，b* 不产出，上游退回恒等（行为=现状）。
 *   - 纯函数、确定性（噪声仅在显式传入 rng 时启用），跨端可镜像。
 */

import { DIFFICULTY_VECTOR_DIMS } from './spawnStepDifficulty.mjs';

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** 对齐乘子的锐度基准（personalizationStrength 的放大系数）。
 *  可被 cfg.alignSharpness 覆盖：锐度越低，对齐越"软"（保留次优候选/难度方差），
 *  锐度越高，越接近"硬钉在 b*"。降默认锐度是恢复体感波动性的一档主控旋钮。 */
const ALIGN_SHARPNESS = 3;

function num(x, d) { return Number.isFinite(x) ? x : d; }

/** 简单确定性 hash（rollout 分桶用）。 */
function hashStr(s) {
    let h = 2166136261;
    const str = String(s == null ? '' : s);
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 100;
}

/**
 * 相位化对齐预算 相位化对齐预算 RelativityIntent —— 把"是否/如何应用难度相对论"按 spawnIntent /
 * sessionArc / pbPhase / inOnboarding / 救济信号四类一阶变量集中决策。
 *
 * 与 resolveRelativityBypass 的关系：
 *   - bypass 给出"为什么不该参与"（disabled/rollout/low_conf/recovery/...），是**否决型**判定；
 *   - intent 给出"该以什么力度参与"（off/prior_only/kbest_only/full），是**分级型**判定。
 * 当 bypass != null 时，intent 强制为 'off'。
 *
 * 用途：
 *   - shapePrior 入口：intent ∈ {'off','kbest_only'} → skip 偏置；
 *   - best-of-K 入口：intent ∈ {'off','prior_only'} → 退回单 attempt 定稿；
 *   - 'full' = 两者都开（默认 mid 段 / maintain）。
 *
 * 顺玩家相位（harvest/engage/warm/onboarding/pb_chase）只允许 prior_only：
 *   - 保留"个性化感"（池微偏，与玩家能力相关的形状权重轻量调整）；
 *   - 禁用 best-of-K（不在硬约束通过的候选里"挑掉爽消组喂对齐组"）；
 *   - 这是恢复 §4.17 提交前"构造式爽消"体感的核心改造。
 */
export const RELATIVITY_INTENT = Object.freeze({
    OFF: 'off',
    PRIOR_ONLY: 'prior_only',
    KBEST_ONLY: 'kbest_only',
    FULL: 'full'
});

/**
 * 解析"应该用什么力度的难度相对论"。
 *
 * @param {object} ctx
 * @param {string|null} [ctx.bypass]              resolveRelativityBypass 结果（短路：非空→off）
 * @param {string|null} [ctx.spawnIntent]         maintain/harvest/engage/warm/sprint/pressure/relief/flow/...
 * @param {string|null} [ctx.sessionArc]          warmup/peak/cooldown
 * @param {string|null} [ctx.pbPhase]             warmup/chase/tension/gate/release/brake/overshoot
 * @param {boolean} [ctx.inOnboarding]
 * @param {boolean} [ctx.needsRecovery]
 * @param {boolean} [ctx.hadRecentNearMiss]
 * @param {boolean} [ctx.hasBottleneckSignal]
 * @returns {'off'|'prior_only'|'kbest_only'|'full'}
 */
export function resolveRelativityIntent(ctx = {}) {
    /* bypass 一票否决：解释器返回任何原因 → 整体 off。 */
    if (ctx.bypass) return RELATIVITY_INTENT.OFF;

    /* 救济类紧急信号（与 PEOG/warmRun 同级优先级）：完全 off，不参与任何对齐。 */
    if (ctx.needsRecovery === true) return RELATIVITY_INTENT.OFF;
    if (ctx.hasBottleneckSignal === true) return RELATIVITY_INTENT.OFF;
    if (ctx.hadRecentNearMiss === true) return RELATIVITY_INTENT.OFF;
    if (ctx.inOnboarding === true) return RELATIVITY_INTENT.OFF;

    /* 顺玩家相位：只允许 prior_only 微偏，禁 best-of-K 改选构造式 completer。
     *   - harvest：玩家追求构造式爽消，best-of-K 会把消除型候选挑掉换对齐组；
     *   - engage：AFK 召回，应给确定性爆点，对齐应让位；
     *   - warm：意图层 warm 信号（与 intentResolver 同口径，warmup 段或显式 warm hint）；
     *   - sessionArc==='warmup'：温暖局节奏；
     *   - pbPhase ∈ {'chase','release'}：高 PB 前期 / 破纪录后温柔窗口。 */
    const intent = ctx.spawnIntent;
    if (intent === 'harvest' || intent === 'engage' || intent === 'warm') {
        return RELATIVITY_INTENT.PRIOR_ONLY;
    }
    if (ctx.sessionArc === 'warmup') return RELATIVITY_INTENT.PRIOR_ONLY;
    if (ctx.pbPhase === 'chase' || ctx.pbPhase === 'release') return RELATIVITY_INTENT.PRIOR_ONLY;

    /* maintain/flow/sprint/pressure：默认 full（两道偏置都开），mid 段相对论收益最大。 */
    return RELATIVITY_INTENT.FULL;
}

/**
 * 判定是否 bypass（不应用难度相对论）。返回 bypass 原因字符串或 null（=应用）。
 * @param {object} cfg game_rules.adaptiveSpawn.difficultyRelativity
 * @param {object} ctx { calibration, needsRecovery, hadRecentNearMiss, hasBottleneckSignal, postPbReleaseActive, sessionArc, userId }
 */
export function resolveRelativityBypass(cfg, ctx = {}) {
    if (!cfg || cfg.enabled !== true) return 'disabled';
    const rollout = num(cfg.rolloutPercent, 0);
    if (rollout < 100 && hashStr(ctx.userId) >= rollout) return 'rollout_out';
    if (ctx.needsRecovery === true) return 'recovery';
    if (ctx.hadRecentNearMiss === true) return 'near_miss';
    if (ctx.hasBottleneckSignal === true) return 'bottleneck';
    if (ctx.postPbReleaseActive === true) return 'post_pb_release';
    if (ctx.sessionArc === 'warmup') return 'warmup';
    if (!ctx.calibration || typeof ctx.calibration !== 'object') return 'low_conf';
    return null;
}

/**
 * 反解客观目标 b*（6 维）。
 * @param {number} stress 目标体感难度 d*（S 曲线主线产出）
 * @param {object} cfg difficultyRelativity
 * @param {object} ctx { calibration:{dim:μ}|null, ...bypass 信号, rng?:()=>number }
 * @returns {{ bStar: Record<string,number>|null, bypass: string|null, lambda: number }}
 */
export function solveObjectiveTarget(stress, cfg, ctx = {}) {
    const bypass = resolveRelativityBypass(cfg, ctx);
    const lambda = clamp01(num(cfg && cfg.personalizationStrength, 0));
    if (bypass) return { bStar: null, bypass, lambda };

    const d = clamp01(stress);
    const cal = ctx.calibration;
    const k = num(cfg.deltaCurriculumK, 0);
    const noiseAmp = num(cfg.noiseAmp, 0);
    const rng = typeof ctx.rng === 'function' ? ctx.rng : null;

    /* b* 前期上界：低 d* 阶段（前期 / 温和段），即便 θ 高也不让 b* 偏离 d* 太多。
     * 解决"高 PB 玩家前期被喂偏难三连"：θ_combo/θ_clearEff 长期偏高时，b 会被推到
     * (1-λ)·d + λ·(θ+(d-0.5))，d=0.3, θ=0.7, λ=0.3 → b≈0.42（相对 d 抬 +0.12）。
     * 上界 = d + earlyPhaseCap（默认 0.10），只在 d < earlyPhaseDStar 时启用。
     * earlyPhaseDStar=0 时禁用（保留旧行为）。 */
    const earlyPhaseDStar = num(cfg.earlyPhaseDStar, 0.40);
    const earlyPhaseCap = num(cfg.earlyPhaseBStarCap, 0.10);
    const earlyPhaseActive = earlyPhaseDStar > 0 && d < earlyPhaseDStar && earlyPhaseCap > 0;

    const bStar = {};
    for (let i = 0; i < DIFFICULTY_VECTOR_DIMS.length; i++) {
        const dim = DIFFICULTY_VECTOR_DIMS[i];
        const theta = clamp01(num(cal[dim], 0.5));
        /* 相对论核心：λ 在"均匀 stress"与"θ 相对偏移"之间插值 */
        const relative = clamp01(theta + (d - 0.5));
        let b = (1 - lambda) * d + lambda * relative;
        /* ZPD 课程：弱项（θ<0.5）略加压、强项略减压，幅度受 k 限 */
        b += k * (0.5 - theta);
        /* 受控噪声（仅在显式 rng 时启用，保证测试确定性） */
        if (rng && noiseAmp > 0) b += (rng() * 2 - 1) * noiseAmp;
        /* b* 前期上界 —— 仅对低 d* 钳制（不对称：只压上限，不抬下限）。 */
        if (earlyPhaseActive) {
            const cap = d + earlyPhaseCap;
            if (b > cap) b = cap;
        }
        bStar[dim] = clamp01(b);
    }
    return { bStar, bypass: null, lambda };
}

/**
 * 候选块「等体感对齐」乘子。距离越小（候选客观难度越贴近 b*）乘子越大。
 * 弱项维（θ<0.5，即 b* 较低或玩家薄弱）用 weaknessBoost 加大权重，定向施压/训练。
 * @param {Record<string,number>} candidateVec 候选 difficultyVec(b⃗)
 * @param {Record<string,number>} bStar 客观目标
 * @param {object} cfg difficultyRelativity
 * @param {Record<string,number>|null} [calibration] θ⃗（用于弱项加权）
 * @returns {number} 乘子 ∈ (0, 1]
 */
export function alignmentMultiplier(candidateVec, bStar, cfg, calibration) {
    if (!bStar || !candidateVec) return 1;
    const lambda = clamp01(num(cfg && cfg.personalizationStrength, 0));
    if (lambda <= 0) return 1;
    const dimWeights = (cfg && cfg.dimWeights) || {};
    const weaknessBoost = num(cfg && cfg.weaknessBoost, 1);
    let wsum = 0;
    let acc = 0;
    for (let i = 0; i < DIFFICULTY_VECTOR_DIMS.length; i++) {
        const dim = DIFFICULTY_VECTOR_DIMS[i];
        let w = num(dimWeights[dim], 1);
        if (calibration && Number.isFinite(calibration[dim]) && calibration[dim] < 0.5) {
            w *= weaknessBoost;
        }
        const diff = clamp01(num(candidateVec[dim], 0.5)) - clamp01(num(bStar[dim], 0.5));
        acc += w * diff * diff;
        wsum += w;
    }
    const dist = wsum > 0 ? Math.sqrt(acc / wsum) : 0;
    const sharpness = num(cfg && cfg.alignSharpness, ALIGN_SHARPNESS);
    return Math.exp(-lambda * sharpness * dist);
}
