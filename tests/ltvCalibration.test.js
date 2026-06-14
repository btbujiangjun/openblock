import { describe, it, expect } from 'vitest';
import {
    computeCalibrationFactor,
    calibrateLtv,
    getCalibratedLTVEstimate,
} from '../web/src/monetization/ltvPredictor.js';

describe('UA-4 LTV 真实回流校准', () => {
    it('预测=真实 → 因子=1', () => {
        expect(computeCalibrationFactor({ predictedAvg: 2, realizedAvg: 2, samples: 500 })).toBeCloseTo(1, 5);
    });

    it('样本充分时贴近后验比值', () => {
        const f = computeCalibrationFactor({ predictedAvg: 2, realizedAvg: 3, samples: 1000 });
        // raw=1.5 但被 maxAdj=0.6 限到 1.6 上限内 → 1.5；fullSamples 后 w≈1
        expect(f).toBeGreaterThan(1.45);
        expect(f).toBeLessThanOrEqual(1.6);
    });

    it('冷启动样本少 → 收缩到先验附近', () => {
        const f = computeCalibrationFactor({ predictedAvg: 2, realizedAvg: 4, samples: 20 });
        expect(f).toBeCloseTo(1, 3);
    });

    it('±maxAdj 夹逼，防止单次校准过激', () => {
        const fHigh = computeCalibrationFactor({ predictedAvg: 1, realizedAvg: 100, samples: 1000 });
        expect(fHigh).toBeLessThanOrEqual(1.6);
        const fLow = computeCalibrationFactor({ predictedAvg: 100, realizedAvg: 1, samples: 1000 });
        expect(fLow).toBeGreaterThanOrEqual(0.4);
    });

    it('非法输入回退因子=1', () => {
        expect(computeCalibrationFactor({ predictedAvg: 0, realizedAvg: 5, samples: 100 })).toBe(1);
        expect(computeCalibrationFactor(null)).toBe(1);
    });

    it('calibrateLtv 同步缩放 ltv 与出价建议', () => {
        const base = { ltv30: 2, ltv60: 4, ltv90: 5, bidRecommendation: 0.8 };
        const out = calibrateLtv(base, 1.5);
        expect(out.ltv30).toBeCloseTo(3, 5);
        expect(out.bidRecommendation).toBeCloseTo(1.2, 5);
        expect(out.calibrated).toBe(true);
    });

    it('getCalibratedLTVEstimate 无真实样本时不改先验', () => {
        const profile = { segment5: 'A', _totalLifetimeGames: 10, skillLevel: 0.3 };
        const est = getCalibratedLTVEstimate(profile, { first: { source: 'organic' } });
        expect(est.calibrated).toBe(false);
        expect(est.calibrationFactor).toBe(1);
    });
});
