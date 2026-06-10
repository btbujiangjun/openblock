/**
 * RL 风格条件 token（v12）—— RoR arc + spawnIntent 的 one-hot 编码，与
 * rl_pytorch/condition_token.py 逐位对齐。
 *
 * 顺序唯一数据源：shared/game_rules.json → rlRewardShaping.conditionToken。
 *
 * 不泄漏论证见 Python 端模块 docstring。
 */
import { FEATURE_ENCODING, GAME_RULES } from '../gameRules.js';

const CT_CFG = (GAME_RULES.rlRewardShaping || {}).conditionToken || {};
export const CONDITION_ARCS = CT_CFG.arcs || ['opener', 'momentum', 'peak', 'fatigue', 'cooldown'];
export const CONDITION_INTENTS = CT_CFG.intents || ['relief', 'engage', 'pressure', 'flow', 'harvest', 'maintain'];
export const CONDITION_ENABLED = CT_CFG.enabled !== false;
export const CONDITION_SAMPLING_PROB = Number.isFinite(CT_CFG.samplingProb) ? CT_CFG.samplingProb : 0.6;

export const ARC_DIM = FEATURE_ENCODING.conditionArcDim ?? CONDITION_ARCS.length;
export const INTENT_DIM = FEATURE_ENCODING.conditionIntentDim ?? CONDITION_INTENTS.length;
export const CONDITION_DIM = ARC_DIM + INTENT_DIM;

if (ARC_DIM !== CONDITION_ARCS.length) {
    throw new Error(`conditionArcDim=${ARC_DIM} 与 arcs 数量 ${CONDITION_ARCS.length} 不一致`);
}
if (INTENT_DIM !== CONDITION_INTENTS.length) {
    throw new Error(`conditionIntentDim=${INTENT_DIM} 与 intents 数量 ${CONDITION_INTENTS.length} 不一致`);
}

/**
 * @param {string|null} arc
 * @param {string|null} intent
 * @returns {Float32Array}
 */
export function encodeConditionOnehot(arc, intent) {
    const out = new Float32Array(CONDITION_DIM);
    if (!CONDITION_ENABLED) return out;
    const ai = CONDITION_ARCS.indexOf(arc);
    if (ai >= 0) out[ai] = 1;
    const ii = CONDITION_INTENTS.indexOf(intent);
    if (ii >= 0) out[ARC_DIM + ii] = 1;
    return out;
}

/**
 * @param {() => number} [rng] 返回 [0,1)，默认 Math.random
 * @returns {{ arc: string|null, intent: string|null }}
 */
export function sampleCondition(rng = Math.random) {
    if (!CONDITION_ENABLED || rng() >= CONDITION_SAMPLING_PROB) {
        return { arc: null, intent: null };
    }
    const ai = Math.floor(rng() * CONDITION_ARCS.length);
    const ii = Math.floor(rng() * CONDITION_INTENTS.length);
    return {
        arc: CONDITION_ARCS[Math.min(ai, CONDITION_ARCS.length - 1)],
        intent: CONDITION_INTENTS[Math.min(ii, CONDITION_INTENTS.length - 1)],
    };
}
