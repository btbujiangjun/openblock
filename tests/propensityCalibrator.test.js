/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P0-1 — propensity calibrator 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    CALIBRATION_SCHEMA_VERSION,
    _resetCalibrationForTests,
    calibratePropensityVector,
    calibrateScore,
    getCalibrationMeta,
    getActiveCalibrationBundle,
    setCalibrationBundle,
} from '../web/src/monetization/calibration/propensityCalibrator.js';

beforeEach(() => _resetCalibrationForTests());
afterEach(() => _resetCalibrationForTests());

describe('default identity bundle', () => {
    it('未注入校准表时输出原值（identity）', () => {
        expect(calibrateScore(0.42, 'iap')).toBe(0.42);
        expect(calibrateScore(0.7, 'rewarded')).toBe(0.7);
    });

    it('getCalibrationMeta 返回 isIdentity=true', () => {
        expect(getCalibrationMeta().isIdentity).toBe(true);
    });

    it('NaN/Infinity 输入 → clamp 到 0', () => {
        expect(calibrateScore(NaN, 'iap')).toBe(0);
        expect(calibrateScore(Infinity, 'iap')).toBe(1);
    });
});

describe('isotonic 校准', () => {
    it('落在 bin 内：返回 bin.p', () => {
        const ok = setCalibrationBundle({
            schemaVersion: CALIBRATION_SCHEMA_VERSION,
            fittedAt: Date.now(),
            tables: {
                iap: {
                    method: 'isotonic',
                    bins: [
                        { lo: 0,    hi: 0.3, p: 0.02 },
                        { lo: 0.3,  hi: 0.6, p: 0.10 },
                        { lo: 0.6,  hi: 1.0, p: 0.40 },
                    ],
                },
            },
        });
        expect(ok).toBe(true);
        expect(calibrateScore(0.5, 'iap')).toBe(0.10);
        expect(calibrateScore(0.7, 'iap')).toBe(0.40);
        expect(calibrateScore(0.1, 'iap')).toBe(0.02);
    });

    it('未在 tables 里的 task 走 identity', () => {
        setCalibrationBundle({
            schemaVersion: CALIBRATION_SCHEMA_VERSION,
            fittedAt: Date.now(),
            tables: { iap: { method: 'identity' } },
        });
        expect(calibrateScore(0.55, 'churn')).toBe(0.55);
    });
});

describe('Platt scaling', () => {
    it('σ(a·s + b) 推理', () => {
        setCalibrationBundle({
            schemaVersion: CALIBRATION_SCHEMA_VERSION,
            fittedAt: Date.now(),
            tables: { iap: { method: 'platt', a: 4, b: -2 } },
        });
        const v = calibrateScore(0.5, 'iap');
        // σ(4·0.5 - 2) = σ(0) = 0.5
        expect(v).toBeCloseTo(0.5, 5);
    });
});

describe('schema 版本拒绝', () => {
    it('schemaVersion 不一致 → setCalibrationBundle 返回 false', () => {
        const ok = setCalibrationBundle({
            schemaVersion: 999,
            tables: { iap: { method: 'identity' } },
        });
        expect(ok).toBe(false);
    });
});

describe('calibratePropensityVector 批量校准', () => {
    it('一次性输出 5 个 head', () => {
        const out = calibratePropensityVector({
            iapPropensity: 0.6,
            rewardedAdPropensity: 0.4,
            interstitialPropensity: 0.3,
            churnRisk: 0.5,
            payerScore: 0.7,
        });
        expect(out).toHaveProperty('iap', 0.6);
        expect(out).toHaveProperty('rewarded', 0.4);
        expect(out).toHaveProperty('interstitial', 0.3);
        expect(out).toHaveProperty('churn', 0.5);
        expect(out).toHaveProperty('payer', 0.7);
    });
});

describe('getActiveCalibrationBundle', () => {
    it('返回深拷贝', () => {
        const bundle = getActiveCalibrationBundle();
        expect(bundle).toHaveProperty('iap');
        bundle.iap = 'tampered';
        expect(getActiveCalibrationBundle().iap).not.toBe('tampered');
    });
});
