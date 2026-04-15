/**
 * 玩法与 RL 特征元数据的单一入口（数据来自仓库根 shared/game_rules.json）。
 * 修改难度、得分、棋盘尺寸、胜局阈值等：只改 JSON；无需改 trainer / rl_backend。
 * 若改变 stateDim/actionDim 或特征语义：须同步改 observationEncoder（features）并重训权重。
 */
const rawRules = require('./game_rules.json');

const GAME_RULES = rawRules;
const WIN_SCORE_THRESHOLD = rawRules.winScoreThreshold;
const FEATURE_ENCODING = rawRules.featureEncoding;
const RL_TRAINING_STRATEGY_ID =
    rawRules.rlTrainingStrategyId || rawRules.defaultStrategyId || 'normal';

/** RL 塑形系数（与 Python 模拟器一致）；缺省字段在 simulator 内按 0 处理 */
const RL_REWARD_SHAPING = rawRules.rlRewardShaping || {};

/** @returns {Record<string, object>} 与历史 DEFAULT_STRATEGIES 结构一致（camelCase） */
function buildDefaultStrategiesMap() {
    const out = {};
    for (const [key, s] of Object.entries(rawRules.strategies)) {
        out[key] = { ...s };
    }
    return out;
}

module.exports = { buildDefaultStrategiesMap, FEATURE_ENCODING, GAME_RULES, RL_REWARD_SHAPING, RL_TRAINING_STRATEGY_ID, WIN_SCORE_THRESHOLD };
