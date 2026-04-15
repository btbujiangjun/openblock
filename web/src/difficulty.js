/**
 * 局内动态难度 + 连战局间加成（数据来自 shared/game_rules.json）
 * 计分始终用玩家所选难度的 scoring；仅调整 fillRatio / shapeWeights。
 */
import { getStrategy } from './config.js';
import { GAME_RULES } from './gameRules.js';

/**
 * @param {number} score
 * @returns {number} 0~1，与 milestones/spawnStress 分段线性插值
 */
export function getSpawnStressFromScore(score) {
    const dd = GAME_RULES.dynamicDifficulty;
    if (!dd?.enabled) {
        return 0;
    }
    const milestones = dd.milestones || [0];
    const stress = dd.spawnStress || [0];
    if (milestones.length === 0) {
        return 0;
    }
    const s = Math.max(0, score);
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
 */
export function resolveLayeredStrategy(baseStrategyId, score, runStreak) {
    const base = getStrategy(baseStrategyId);
    const scoreStress = getSpawnStressFromScore(score);
    const run = getRunDifficultyModifiers(runStreak);
    const totalStress = Math.min(1, scoreStress + run.stressBonus);
    const shapeWeights = blendShapeWeightsTowardHard(baseStrategyId, totalStress);
    let fillRatio = (base.fillRatio ?? 0.2) + run.fillDelta;
    fillRatio = Math.min(0.36, Math.max(0, fillRatio));
    return {
        ...base,
        shapeWeights,
        fillRatio
    };
}
