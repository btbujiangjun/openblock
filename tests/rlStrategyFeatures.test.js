import { describe, it, expect } from 'vitest';
import { FEATURE_ENCODING } from '../web/src/gameRules.js';
import {
    encodeStrategyOnehot,
    sampleRlTrainingStrategyId,
    rlTrainingStrategyIds,
} from '../web/src/bot/strategyFeatures.js';
import { extractStateFeatures, STATE_FEATURE_DIM } from '../web/src/bot/features.js';
import { Grid } from '../web/src/grid.js';

describe('RL strategy features', () => {
    it('strategyIds 与 featureEncoding 一致', () => {
        expect(rlTrainingStrategyIds()).toEqual(FEATURE_ENCODING.strategyIds);
        expect(FEATURE_ENCODING.stateDim).toBe(190);
        expect(FEATURE_ENCODING.stateScalarDim).toBe(51);
    });

    it('encodeStrategyOnehot 为合法 one-hot', () => {
        for (const id of rlTrainingStrategyIds()) {
            const v = encodeStrategyOnehot(id);
            expect(v.reduce((a, b) => a + b, 0)).toBe(1);
        }
    });

    it('extractStateFeatures 含策略维且总长 190', () => {
        const grid = new Grid(8);
        const dock = [
            { shape: [[1]], colorIdx: 0, placed: false },
            { shape: [[1, 1]], colorIdx: 1, placed: false },
            { shape: [[1], [1]], colorIdx: 2, placed: false },
        ];
        const feat = extractStateFeatures(grid, dock, 'hard');
        expect(feat.length).toBe(STATE_FEATURE_DIM);
        const strat = encodeStrategyOnehot('hard');
        for (let i = 0; i < strat.length; i++) {
            expect(feat[48 + i]).toBe(strat[i]);
        }
    });

    it('sampleRlTrainingStrategyId 落在列表内', () => {
        const ids = rlTrainingStrategyIds();
        for (let i = 0; i < 20; i++) {
            expect(ids).toContain(sampleRlTrainingStrategyId(() => i / 20));
        }
    });
});
