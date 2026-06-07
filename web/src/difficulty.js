/**
 * 局内动态难度 + 连战局间加成（数据来自 shared/game_rules.json）
 * 计分始终用玩家所选难度的 scoring；仅调整 fillRatio / shapeWeights。
 */
import { getStrategy } from './config.js';
import { GAME_RULES } from './gameRules.js';

/**
 * 在 milestones / spawnStress 分段曲线上做线性插值。
 * @param {number[]} milestones 分数节点
 * @param {number[]} stress     与节点对齐的压力值
 * @param {number}   s          实际投影到的分数
 * @returns {number}
 */
function _interpolateStressCurve(milestones, stress, s) {
    if (s <= milestones[0]) {
        return stress[0] ?? 0;
    }
    for (let i = 1; i < milestones.length; i++) {
        const m0 = milestones[i - 1];
        const m1 = milestones[i];
        if (s <= m1) {
            const t = m1 === m0 ? 1 : (s - m0) / (m1 - m0);
            const a = stress[i - 1] ?? 0;
            const b = stress[i] ?? a;
            return a + (b - a) * t;
        }
    }
    return stress[stress.length - 1] ?? 0;
}

/**
 * 由「真实个人最佳」派生出「难度进度坐标」专用的有效分母 effectivePB。
 *
 * 设计动机（详见 docs/player/BEST_SCORE_CHASE_STRATEGY.md「难度进度坐标 vs 纪录坐标」）：
 * 主线难度沿 r = score / PB 的 S 曲线展开，但直接用真实 PB 当分母会在两端失真——
 *   1) 新手 PB 很低（30~80）：r 增长过快，几十分就被推入挑战区 → 早熟挫败、失去兴趣。
 *   2) 高手 PB 很高（数千）：r 长期贴近 0，前期需要漫长铺垫才进挑战区 → 前期无趣。
 *
 * 这里用「同一条单调连续变换」同时修两端，S 曲线本身完全不动：
 *   - 新手：抬到 noviceFloor 下限（低于此的 PB 不足以代表稳定水平）。
 *   - 高手：超过 expertSoftCap 后对数软压缩（越高压得越狠，但永远单调递增、无跳变），
 *     让其更快进入挑战区，缩短无聊铺垫。
 *
 * 注意：本函数只服务「出块难度坐标」。纪录追逐情绪（derivePbCurve / challengeBoost /
 * 破纪录庆祝 / overshoot）仍使用真实 PB（score / bestScore），两条坐标解耦，
 * 避免高手被压缩后误触发「快破纪录了」之类与真实进度不符的叙事。
 *
 * 任一 corner 配置缺失即自动退化为旧行为（noviceFloor 回退 scoreFloor、不做压缩），
 * 保持完全向后兼容。
 *
 * @param {number} personalBest 真实个人最佳分
 * @param {object} [dd] dynamicDifficulty 配置（含 pbProgress / scoreFloor / milestones）
 * @returns {number} 难度进度分母（≥ noviceFloor）
 */
export function deriveEffectivePb(personalBest, dd = {}) {
    const pb = Math.max(0, Number(personalBest) || 0);
    const milestones = dd.milestones || [1];
    const lastMilestone = milestones[milestones.length - 1] || 1;
    const pp = dd.pbProgress || {};
    const noviceFloor = Math.max(1, Number(pp.noviceFloor ?? dd.scoreFloor ?? lastMilestone) || 1);

    // 新手：抬到可信下限。
    let eff = Math.max(pb, noviceFloor);

    // 高手：超过软上限后对数压缩（连续、单调、边际递减）。
    const softCap = Number(pp.expertSoftCap);
    const scale = Number(pp.expertScale);
    if (Number.isFinite(softCap) && softCap > 0 && Number.isFinite(scale) && scale > 0 && eff > softCap) {
        eff = softCap + scale * Math.log1p((eff - softCap) / scale);
    }
    return eff;
}

/**
 * 把当前分数转化为「分数档驱动的基础压力」。
 *
 * v1.13 起：当外部传入历史最佳分（`opts.bestScore`）时，使用「个人百分位」映射，
 * 避免一次冲过 milestones 末档后 scoreStress 永远锁死在最高值——这是过去
 * stress 与玩家直觉脱节（例如分数仅 ≈ 28% 个人最佳却显示「🥵 高压」）的根因。
 *
 * 处理流程：
 *   pct = score / deriveEffectivePb(personalBest)   （effectivePB 修两端 corner，见上）
 *   projected = clamp(pct * milestonesLast, …)
 *   stress = interpolate(milestones → spawnStress, projected)
 *   if pct < percentileDecayThreshold → stress *= percentileDecayFactor
 *
 * 当 `personalBest <= 0`（首次开局 / 未读到 bestScore）时，回退到旧的「绝对分段」
 * 行为，保持向后兼容。
 *
 * @param {number} score   当前分数
 * @param {object} [opts]
 * @param {number} [opts.bestScore]  玩家个人最佳分（来自 game.bestScore）
 * @returns {number} 0~1 的压力值
 */
export function getSpawnStressFromScore(score, opts = {}) {
    const dd = GAME_RULES.dynamicDifficulty;
    if (!dd?.enabled) {
        return 0;
    }
    const milestones = dd.milestones || [0];
    const stress = dd.spawnStress || [0];
    if (milestones.length === 0) {
        return 0;
    }
    const s = Math.max(0, Number(score) || 0);
    const personalBest = Math.max(0, Number(opts.bestScore) || 0);
    const lastMilestone = milestones[milestones.length - 1] || 1;
    const usePercentile = personalBest > 0;

    if (!usePercentile) {
        return _interpolateStressCurve(milestones, stress, s);
    }

    // 难度进度分母：deriveEffectivePb 在新手端抬分母下限、在高手端做对数软压缩，
    // 统一修两端 corner case；配置缺失时等价于旧的 max(personalBest, scoreFloor)。
    const denom = deriveEffectivePb(personalBest, dd);
    const pct = denom > 0 ? s / denom : 0;
    // 允许 pct > 1（玩家正在突破历史最佳），但折算到 milestones 末档外的部分仍按线性外推（被 _interpolate 钳制到末档）
    const cap = Math.max(0, dd.percentileMaxOver ?? 0.2);
    const projected = Math.min(lastMilestone * (1 + cap), pct * lastMilestone);
    const baseStress = _interpolateStressCurve(milestones, stress, projected);

    const decayThreshold = Math.max(0, dd.percentileDecayThreshold ?? 0.5);
    const decayFactor = Math.max(0, Math.min(1, dd.percentileDecayFactor ?? 0.4));
    if (pct < decayThreshold) {
        return baseStress * decayFactor;
    }
    return baseStress;
}

/**
 * 将 base 策略的 shapeWeights 向 hard 混合，t∈[0,1]
 * @param {string} baseStrategyId
 * @param {number} t
 */
export function blendShapeWeightsTowardHard(baseStrategyId, t) {
    const base = getStrategy(baseStrategyId);
    const hard = getStrategy('hard');
    const bw = base.shapeWeights || {};
    const hw = hard.shapeWeights || {};
    const out = { ...bw };
    const tt = Math.max(0, Math.min(1, t));
    const keys = new Set([...Object.keys(bw), ...Object.keys(hw)]);
    for (const k of keys) {
        const a = bw[k] ?? 1;
        const b = hw[k] ?? 1;
        out[k] = a * (1 - tt) + b * tt;
    }
    return out;
}

/**
 * @param {number} runStreak 连战局数：菜单开局为 0，每局「再来一局」+1
 */
export function getRunDifficultyModifiers(runStreak) {
    const rd = GAME_RULES.runDifficulty;
    if (!rd?.enabled || runStreak <= 0) {
        return { fillDelta: 0, stressBonus: 0 };
    }
    const cap = Math.min(runStreak, Math.max(1, rd.maxStreak ?? 6));
    return {
        fillDelta: cap * (rd.fillBonusPerGame ?? 0),
        stressBonus: cap * (rd.spawnStressBonusPerGame ?? 0)
    };
}

/**
 * 当前盘面层策略：用于 initBoard / generateDockShapes
 * @param {string} baseStrategyId
 * @param {number} score 当前得分
 * @param {number} runStreak
 * @param {object} [opts]
 * @param {number} [opts.bestScore] 个人最佳分（用于 scoreStress 百分位映射）
 */
export function resolveLayeredStrategy(baseStrategyId, score, runStreak, opts = {}) {
    const base = getStrategy(baseStrategyId);
    const scoreStress = getSpawnStressFromScore(score, opts);
    const run = getRunDifficultyModifiers(runStreak);
    const totalStress = Math.min(1, scoreStress + run.stressBonus);
    const shapeWeights = blendShapeWeightsTowardHard(baseStrategyId, totalStress);
    // fillRatio=0（如简单模式空盘）不叠加连战加成，保持纯净空盘开局
    const baseFill = base.fillRatio ?? 0.2;
    const fillRatio = baseFill === 0
        ? 0
        : Math.min(0.36, baseFill + run.fillDelta);
    return {
        ...base,
        shapeWeights,
        fillRatio
    };
}
