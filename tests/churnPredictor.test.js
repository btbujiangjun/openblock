/**
 * @vitest-environment jsdom
 * churnPredictor.test.js - 流失预警模型测试
 */

import { describe, it, expect, beforeEach } from 'vitest';

const mockStorage = {};

Object.defineProperty(globalThis, 'localStorage', {
    value: {
        getItem: (key) => mockStorage[key] ?? null,
        setItem: (key, value) => { mockStorage[key] = value; },
        removeItem: (key) => { delete mockStorage[key]; },
        clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
    },
    writable: true
});

import {
    getChurnData,
    recordSessionMetrics,
    getChurnRiskLevel,
    getChurnPrediction,
    shouldSendChurnAlert,
    getChurnIntervention,
    invalidateChurnCache
} from '../web/src/retention/churnPredictor.js';

describe('Churn Predictor', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    describe('getChurnData', () => {
        it('should return default data for new player', () => {
            const data = getChurnData();
            expect(data.lastUpdated).toBeDefined();
            expect(data.signals).toEqual([]);
            expect(data.riskHistory).toEqual([]);
        });

        it('should persist data', () => {
            recordSessionMetrics({ sessionCount: 5, avgScore: 100, avgDuration: 180 });
            const data = getChurnData();
            expect(data.signals.length).toBeGreaterThan(0);
        });
    });

    describe('recordSessionMetrics', () => {
        it('should record new session metrics', () => {
            const result = recordSessionMetrics({
                sessionCount: 3,
                avgScore: 200,
                avgDuration: 120,
                engagement: 0.6
            });
            expect(result.risk).toBeDefined();
            expect(result.signals).toBeDefined();
        });

        it('should accumulate signals', () => {
            recordSessionMetrics({ sessionCount: 5, avgScore: 100 });
            recordSessionMetrics({ sessionCount: 3, avgScore: 80 });
            recordSessionMetrics({ sessionCount: 2, avgScore: 60 });

            const data = getChurnData();
            expect(data.signals.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('getChurnRiskLevel', () => {
        it('should return critical for very high risk', () => {
            expect(getChurnRiskLevel(90)).toBe('critical');
            expect(getChurnRiskLevel(75)).toBe('critical');
        });

        it('should return high for high risk', () => {
            expect(getChurnRiskLevel(60)).toBe('high');
            expect(getChurnRiskLevel(50)).toBe('high');
        });

        it('should return medium for moderate risk', () => {
            expect(getChurnRiskLevel(40)).toBe('medium');
            expect(getChurnRiskLevel(30)).toBe('medium');
        });

        it('should return low for low risk', () => {
            expect(getChurnRiskLevel(20)).toBe('low');
            expect(getChurnRiskLevel(15)).toBe('low');
        });

        it('should return stable for minimal risk', () => {
            expect(getChurnRiskLevel(10)).toBe('stable');
            expect(getChurnRiskLevel(0)).toBe('stable');
        });
    });

    describe('getChurnPrediction', () => {
        it('should return prediction with all fields', () => {
            const prediction = getChurnPrediction();
            expect(prediction.risk).toBeDefined();
            expect(prediction.level).toBeDefined();
            expect(prediction.trend).toBeDefined();
            expect(prediction.lastUpdated).toBeDefined();
        });
    });

    describe('shouldSendChurnAlert', () => {
        it('should return false for new player with no risk', () => {
            invalidateChurnCache();
            const result = shouldSendChurnAlert({ stage: 'onboarding' });
            expect(result.shouldAlert).toBe(false);
        });

        it('should return prediction for current state', () => {
            invalidateChurnCache();
            recordSessionMetrics({ sessionCount: 5, avgScore: 100 });
            const result = shouldSendChurnAlert({ stage: 'exploration' });
            expect(result.shouldAlert).toBeDefined();
            expect(result.priority).toBeDefined();
        });
    });

    describe('getChurnIntervention', () => {
        it('should return intervention for critical risk', () => {
            for (let i = 0; i < 10; i++) {
                recordSessionMetrics({ sessionCount: 1, avgScore: 50 });
            }
            const intervention = getChurnIntervention({ stage: 'exploration' });
            expect(intervention.type).toBeDefined();
            expect(intervention.message).toBeDefined();
            expect(intervention.reward).toBeDefined();
        });

        it('should include onboarding reward for onboarding stage', () => {
            const intervention = getChurnIntervention({ stage: 'onboarding' });
            expect(intervention.reward).toContain('首日大礼包');
        });

        it('should return intervention for current risk state', () => {
            invalidateChurnCache();
            const intervention = getChurnIntervention({});
            expect(intervention.type).toBeDefined();
        });
    });

    describe('cache invalidation', () => {
        it('should clear cache on invalidate', () => {
            recordSessionMetrics({ sessionCount: 5, avgScore: 100 });
            invalidateChurnCache();
            localStorage.removeItem('openblock_churn_data_v1');
            const data = getChurnData();
            expect(data.signals).toEqual([]);
        });
    });
});