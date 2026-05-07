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
 * 把当前分数转化为「分数档驱动的基础压力」。
 *
 * v1.13 起：当外部传入历史最佳分（`opts.bestScore`）时，使用「个人百分位」映射，
 * 避免一次冲过 milestones 末档后 scoreStress 永远锁死在最高值——这是过去
 * stress 与玩家直觉脱节（例如分数仅 ≈ 28% 个人最佳却显示「🥵 高压」）的根因。
 *
 * 处理流程：
 *   pct = score / max(personalBest, scoreFloor)
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

    const scoreFloor = Math.max(1, dd.scoreFloor ?? lastMilestone);
    const denom = Math.max(personalBest, scoreFloor);
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
