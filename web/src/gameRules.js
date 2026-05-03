/**
 * 玩法与 RL 特征元数据的单一入口（数据来自仓库根 shared/game_rules.json）。
 * 修改难度、得分、棋盘尺寸、胜局阈值等：只改 JSON；无需改 rl_backend。
 * 浏览器 LinearAgent 训练超参见 `browserRlTraining`（由 `web/src/bot/trainer.js` 读取）。
 * RL 与主局消行加分/icon 判定对齐参见 `rlBonusScoring`（`getRlTrainingBonusLineSkin`，非玩家当前皮肤）。
 * 若改变 stateDim/actionDim 或特征语义：须同步改 observationEncoder（features）并重训权重。
 */
import rawRules from '../../shared/game_rules.json';

export const GAME_RULES = rawRules;
export const WIN_SCORE_THRESHOLD = rawRules.winScoreThreshold;
export const FEATURE_ENCODING = rawRules.featureEncoding;
export const RL_TRAINING_STRATEGY_ID =
    rawRules.rlTrainingStrategyId || rawRules.defaultStrategyId || 'normal';

/** RL 塑形系数（与 Python 模拟器一致）；缺省字段在 simulator 内按 0 处理 */
export const RL_REWARD_SHAPING = rawRules.rlRewardShaping || {};

/** @returns {Record<string, object>} 与历史 DEFAULT_STRATEGIES 结构一致（camelCase） */
export function buildDefaultStrategiesMap() {
    const out = {};
    for (const [key, s] of Object.entries(rawRules.strategies)) {
        out[key] = { ...s };
    }
    return out;
}
