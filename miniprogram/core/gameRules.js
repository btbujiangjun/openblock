/**
 * 小程序玩家端玩法配置入口。
 * 只暴露核心游戏策略，不包含模型训练、模型输入或状态监控元数据。
 */
const rawRules = require('./gameRulesData');

const GAME_RULES = rawRules;
const WIN_SCORE_THRESHOLD = rawRules.winScoreThreshold;

/** @returns {Record<string, object>} 与历史 DEFAULT_STRATEGIES 结构一致（camelCase） */
function buildDefaultStrategiesMap() {
    const out = {};
    for (const [key, s] of Object.entries(rawRules.strategies)) {
        out[key] = { ...s };
    }
    return out;
}

module.exports = { buildDefaultStrategiesMap, GAME_RULES, WIN_SCORE_THRESHOLD };
