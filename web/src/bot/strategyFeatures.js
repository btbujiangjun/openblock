/**
 * 策略 ID one-hot（与 shared/game_rules.json → featureEncoding.strategyIds 一致）。
 */
import { FEATURE_ENCODING, GAME_RULES } from '../gameRules.js';

const STRATEGY_IDS = FEATURE_ENCODING.strategyIds
    || GAME_RULES.rlTraining?.strategyIds
    || ['easy', 'normal', 'hard'];

export function rlTrainingStrategyIds() {
    return [...STRATEGY_IDS];
}

/**
 * @param {() => number} [rng] 返回 [0,1)，默认 Math.random
 */
export function sampleRlTrainingStrategyId(rng = Math.random) {
    const i = Math.floor(rng() * STRATEGY_IDS.length);
    return STRATEGY_IDS[Math.min(i, STRATEGY_IDS.length - 1)];
}

/**
 * @param {string} [strategyId]
 * @returns {Float32Array}
 */
export function encodeStrategyOnehot(strategyId) {
    const out = new Float32Array(STRATEGY_IDS.length);
    const sid = strategyId || 'normal';
    const idx = STRATEGY_IDS.indexOf(sid);
    out[idx >= 0 ? idx : STRATEGY_IDS.indexOf('normal')] = 1;
    return out;
}
