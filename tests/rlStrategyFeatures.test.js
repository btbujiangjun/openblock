import { describe, it, expect } from 'vitest';
import { FEATURE_ENCODING } from '../web/src/gameRules.js';
import {
    encodeStrategyOnehot,
    sampleRlTrainingStrategyId,
    rlTrainingStrategyIds,
} from '../web/src/bot/strategyFeatures.js';
import {
    ARC_DIM,
    CONDITION_ARCS,
    CONDITION_DIM,
    CONDITION_INTENTS,
    INTENT_DIM,
    encodeConditionOnehot,
    sampleCondition,
} from '../web/src/bot/conditionToken.js';
import { extractStateFeatures, STATE_FEATURE_DIM } from '../web/src/bot/features.js';
import { Grid } from '../web/src/grid.js';

describe('RL strategy + condition features', () => {
    it('维度常量与 featureEncoding 一致', () => {
        expect(rlTrainingStrategyIds()).toEqual(FEATURE_ENCODING.strategyIds);
        expect(FEATURE_ENCODING.stateDim).toBe(201);
        expect(FEATURE_ENCODING.stateScalarDim).toBe(62);
        expect(CONDITION_DIM).toBe(ARC_DIM + INTENT_DIM);
        expect(CONDITION_DIM).toBe(11);
    });

    it('encodeStrategyOnehot 为合法 one-hot', () => {
        for (const id of rlTrainingStrategyIds()) {
            const v = encodeStrategyOnehot(id);
            expect(v.reduce((a, b) => a + b, 0)).toBe(1);
        }
    });

    it('encodeConditionOnehot 命中正确槽位且空输入全零', () => {
        const v = encodeConditionOnehot('peak', 'pressure');
        expect(v[CONDITION_ARCS.indexOf('peak')]).toBe(1);
        expect(v[ARC_DIM + CONDITION_INTENTS.indexOf('pressure')]).toBe(1);
        const z = encodeConditionOnehot(null, null);
        expect(z.reduce((a, b) => a + b, 0)).toBe(0);
    });

    it('extractStateFeatures 含策略 + 条件维且总长一致', () => {
        const grid = new Grid(8);
        const dock = [
            { shape: [[1]], colorIdx: 0, placed: false },
            { shape: [[1, 1]], colorIdx: 1, placed: false },
            { shape: [[1], [1]], colorIdx: 2, placed: false },
        ];
        const feat = extractStateFeatures(grid, dock, 'hard', 'peak', 'pressure');
        expect(feat.length).toBe(STATE_FEATURE_DIM);
        const scalarDim = FEATURE_ENCODING.stateScalarDim;
        const stratOff = scalarDim - CONDITION_DIM - FEATURE_ENCODING.strategyDim;
        const condOff = scalarDim - CONDITION_DIM;
        const strat = encodeStrategyOnehot('hard');
        for (let i = 0; i < strat.length; i++) expect(feat[stratOff + i]).toBe(strat[i]);
        const cond = encodeConditionOnehot('peak', 'pressure');
        for (let i = 0; i < cond.length; i++) expect(feat[condOff + i]).toBe(cond[i]);
    });

    it('sampleRlTrainingStrategyId 落在列表内', () => {
        const ids = rlTrainingStrategyIds();
        for (let i = 0; i < 20; i++) {
            expect(ids).toContain(sampleRlTrainingStrategyId(() => i / 20));
        }
    });

    it('sampleCondition 返回 vocab 内或 (null,null)', () => {
        for (let i = 0; i < 30; i++) {
            const { arc, intent } = sampleCondition();
            if (arc === null) {
                expect(intent).toBeNull();
            } else {
                expect(CONDITION_ARCS).toContain(arc);
                expect(CONDITION_INTENTS).toContain(intent);
            }
        }
    });
});
