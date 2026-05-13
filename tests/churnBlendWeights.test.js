/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P1-3 — unifiedRisk 权重注入单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    getChurnBlendWeights,
    getUnifiedChurnRisk,
    resetChurnBlendWeights,
    setChurnBlendWeights,
} from '../web/src/lifecycle/lifecycleSignals.js';

beforeEach(() => resetChurnBlendWeights());
afterEach(() => resetChurnBlendWeights());

describe('setChurnBlendWeights', () => {
    it('默认权重 = (0.45, 0.35, 0.20)', () => {
        const w = getChurnBlendWeights();
        expect(w.predictor).toBeCloseTo(0.45, 5);
        expect(w.maturity).toBeCloseTo(0.35, 5);
        expect(w.commercial).toBeCloseTo(0.20, 5);
    });

    it('注入新权重后归一到 1', () => {
        setChurnBlendWeights({ predictor: 2, maturity: 1, commercial: 1 });
        const w = getChurnBlendWeights();
        expect(w.predictor + w.maturity + w.commercial).toBeCloseTo(1, 5);
        expect(w.predictor).toBeCloseTo(0.5, 5);
    });

    it('全 0 / 非数字 → 拒绝', () => {
        expect(setChurnBlendWeights({ predictor: 'x' })).toBe(false);
        expect(setChurnBlendWeights(null)).toBe(false);
    });

    it('权重影响 unifiedRisk', () => {
        setChurnBlendWeights({ predictor: 1, maturity: 0, commercial: 0 });
        const r = getUnifiedChurnRisk({
            predictorRisk01: 0.8,
            maturityChurnLabel: 'low',  // 等价 0.25
            commercialChurnRisk01: 0.1,
        });
        // 权重全在 predictor 上 → unifiedRisk ≈ 0.8
        expect(r.unifiedRisk).toBeCloseTo(0.8, 2);
    });

    it('reset 恢复默认', () => {
        setChurnBlendWeights({ predictor: 1, maturity: 0, commercial: 0 });
        resetChurnBlendWeights();
        const w = getChurnBlendWeights();
        expect(w.maturity).toBeCloseTo(0.35, 5);
    });
});
