/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P3-2 — survival push timing 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    SURVIVAL_SCHEMA_VERSION,
    _resetSurvivalForTests,
    getSurvivalMeta,
    hazardScore,
    recommendPushTime,
    setSurvivalParams,
    survivalAtT,
} from '../web/src/monetization/ml/survivalPushTiming.js';

beforeEach(() => _resetSurvivalForTests());
afterEach(() => _resetSurvivalForTests());

describe('hazardScore', () => {
    it('未注入 β：返回 1', () => {
        expect(hazardScore([1, 2, 3])).toBe(1);
    });

    it('注入 β 后 hazard 变化', () => {
        setSurvivalParams({
            schemaVersion: SURVIVAL_SCHEMA_VERSION,
            beta: [1, 0, 0],
        });
        expect(hazardScore([1, 0, 0])).toBeCloseTo(Math.E, 5);
    });
});

describe('survivalAtT', () => {
    it('default baseline: S(7d)≈0.6', () => {
        expect(survivalAtT([], 7)).toBeCloseTo(0.6, 5);
    });

    it('hazardScore > 1 加速衰减', () => {
        setSurvivalParams({
            schemaVersion: SURVIVAL_SCHEMA_VERSION,
            beta: [1, 0, 0],
        });
        // hr = e ≈ 2.718
        // S(7d|x) = 0.6^2.718 ≈ 0.243
        const s = survivalAtT([1, 0, 0], 7);
        expect(s).toBeLessThan(0.3);
    });
});

describe('recommendPushTime', () => {
    it('低风险：S 一直 > threshold → pushAtDay = null', () => {
        // baseline: S(1)=0.95, S(3)=0.85, S(7)=0.60；threshold=0.5 → 永不触发
        const r = recommendPushTime([], { threshold: 0.5, horizon: 5 });
        expect(r.pushAtDay).toBeNull();
        expect(r.urgency).toBe('low');
    });

    it('高 hazard：迅速跌破 threshold', () => {
        setSurvivalParams({
            schemaVersion: SURVIVAL_SCHEMA_VERSION,
            beta: [2, 0, 0],
        });
        const r = recommendPushTime([1, 0, 0], { threshold: 0.7 });
        expect(r.pushAtDay).not.toBeNull();
        expect(r.urgency).toBe('high');
    });
});

describe('setSurvivalParams', () => {
    it('schema 错误 → false', () => {
        expect(setSurvivalParams({ schemaVersion: 999 })).toBe(false);
    });

    it('成功后 meta.isDefault=false', () => {
        setSurvivalParams({
            schemaVersion: SURVIVAL_SCHEMA_VERSION,
            beta: [0.1, 0.2],
        });
        expect(getSurvivalMeta().isDefault).toBe(false);
    });
});
