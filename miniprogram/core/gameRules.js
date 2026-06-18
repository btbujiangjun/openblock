/**
 * 玩法与 RL 特征元数据的单一入口（数据来自仓库根 shared/game_rules.json）。
 * 修改难度、得分、棋盘尺寸、胜局阈值等：只改 JSON；无需改 rl_backend。
 * 浏览器 LinearAgent 训练超参见 `browserRlTraining`（由 `web/src/bot/trainer.js` 读取）。
 * 主局与 RL 消行计分倍率见 `clearScoring`；RL icon 判定见 `rlBonusScoring.blockIcons`。
 * 若改变 stateDim/actionDim 或特征语义：须同步改 observationEncoder（features）并重训权重。
 */
const rawRules = require('./gameRulesData');

/* NN-C3: game_rules.json schema 演进 + 自动迁移（与 LL5 trend-history /
 * NN-C1 perf-baseline 同模式）。
 *
 * 当前 schemaVersion=1（初版）。未来 bump 时在 _migrateRules 加分支。
 *
 * 设计：
 *   - 启动时立即检查 schemaVersion
 *   - 旧版自动 _migrateRules 升级（运行时内存中，不写回 JSON）
 *   - 未来未知版本 → throw（拒绝静默错读，让 mini-program / cocos 端
 *     在 release-train 滞后时立刻可见，而非数据错乱后才发现）
 *   - 无 schemaVersion 字段 → 视作 v1（向后兼容首版无字段的 baseline） */
const RULES_SCHEMA_VERSION = 1;

function _migrateRules(rules) {
    const fromVersion = rules?.schemaVersion ?? 1;
    if (fromVersion === RULES_SCHEMA_VERSION) {
        return { migrated: rules, fromVersion, didMigrate: false };
    }
    if (fromVersion > RULES_SCHEMA_VERSION) {
        /* mini-program / cocos 客户端版本滞后场景：服务端推了 v2 rules
         * 但客户端二进制还是 v1。throw 让 caller 走 fallback 路径
         * （例如：用打包内置 rules，等 binary 升级再用 remote rules）。 */
        throw new Error(
            `game_rules.json schemaVersion=${fromVersion} > 客户端支持的 ${RULES_SCHEMA_VERSION}。`
            + ` 升级客户端后再用此 rules（防字段误解读）。`,
        );
    }
    /* fromVersion < current：v1→v2 时在此添加迁移分支
     * if (fromVersion < 2) {
     *   rules = { ...rules, schemaVersion: 2, newField: defaultValue };
     * }
     */
    return {
        migrated: { ...rules, schemaVersion: RULES_SCHEMA_VERSION },
        fromVersion,
        didMigrate: true,
    };
}

const { migrated: _migratedRules, didMigrate: _did, fromVersion: _from } = _migrateRules(rawRules);
if (_did && typeof console !== 'undefined') {
    /* eslint-disable no-console */
    console.warn(`[gameRules] schema v${_from} → v${RULES_SCHEMA_VERSION} 自动迁移（内存）`);
    /* eslint-enable no-console */
}

const GAME_RULES = _migratedRules;
const _RULES_SCHEMA_VERSION = RULES_SCHEMA_VERSION; /* 供 test 检查 */

const WIN_SCORE_THRESHOLD = rawRules.winScoreThreshold;
const FEATURE_ENCODING = rawRules.featureEncoding;
const RL_TRAINING_STRATEGY_ID =
    rawRules.rlTrainingStrategyId || rawRules.defaultStrategyId || 'normal';

const _RL_STRATEGY_IDS =
    rawRules.featureEncoding?.strategyIds
    || rawRules.rlTraining?.strategyIds
    || ['easy', 'normal', 'hard'];

const RL_TRAINING_STRATEGY_IDS = _RL_STRATEGY_IDS;

/** 训练自博弈：从 rlTraining.strategyIds 均匀随机采样。 */
function sampleRlTrainingStrategyId(rng = Math.random) {
    const ids = RL_TRAINING_STRATEGY_IDS;
    const i = Math.floor(rng() * ids.length);
    return ids[Math.min(Math.max(0, i), ids.length - 1)];
}

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

module.exports = { _migrateRules, _RULES_SCHEMA_VERSION, buildDefaultStrategiesMap, FEATURE_ENCODING, GAME_RULES, RL_REWARD_SHAPING, RL_TRAINING_STRATEGY_ID, RL_TRAINING_STRATEGY_IDS, sampleRlTrainingStrategyId, WIN_SCORE_THRESHOLD };
