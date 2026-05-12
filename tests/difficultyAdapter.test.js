/**
 * @vitest-environment jsdom
 * difficultyAdapter.test.js - 智能难度适配器测试
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
    getDifficultyAdapterConfig,
    adjustStressForPlayer,
    shouldTriggerFrustrationRelief,
    shouldProvideBeginnerBonus,
    getDifficultyRecommendation
} from '../web/src/retention/difficultyAdapter.js';

describe('Difficulty Adapter', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    describe('getDifficultyAdapterConfig', () => {
        it('should return config with all required fields', () => {
            const config = getDifficultyAdapterConfig();
            expect(config.stressOffset).toBeDefined();
            expect(config.maxStress).toBeDefined();
            expect(config.enableFrustrationRelief).toBeDefined();
            expect(config.enableBeginnerBonus).toBeDefined();
            expect(config.recommendedProfile).toBeDefined();
            expect(config.churnRisk).toBeDefined();
            expect(config.maturityLevel).toBeDefined();
            expect(config.stage).toBeDefined();
        });

        it('should include L1 config for new players', () => {
            const config = getDifficultyAdapterConfig();
            expect(['L1', 'L2', 'L3', 'L4']).toContain(config.maturityLevel);
        });
    });

    describe('adjustStressForPlayer', () => {
        it('should adjust stress based on player config', () => {
            const result = adjustStressForPlayer(50);
            expect(result.stress).toBeDefined();
            expect(result.config).toBeDefined();
            expect(result.reason).toBeDefined();
        });

        it('should cap stress within maxStress', () => {
            const result = adjustStressForPlayer(100);
            expect(result.stress).toBeLessThanOrEqual(result.config.maxStress);
        });
    });

    describe('shouldTriggerFrustrationRelief', () => {
        it('should trigger for consecutive no clears above threshold', () => {
            const result = shouldTriggerFrustrationRelief(5, 100);
            expect(result.shouldTrigger).toBe(true);
            expect(result.action).toBeDefined();
        });

        it('should not trigger for low consecutive no clears', () => {
            const result = shouldTriggerFrustrationRelief(1, 100);
            expect(result.shouldTrigger).toBe(false);
        });
    });

    describe('shouldProvideBeginnerBonus', () => {
        it('should provide bonus for new players with low scores', () => {
            const result = shouldProvideBeginnerBonus(10, [50, 80, 100, 60, 70]);
            expect(result.shouldProvide).toBeDefined();
        });

        it('should not provide bonus for experienced players', () => {
            const result = shouldProvideBeginnerBonus(50, [500, 600, 700]);
            expect(result.shouldProvide).toBe(false);
        });
    });

    describe('getDifficultyRecommendation', () => {
        it('should return complete recommendation', () => {
            const rec = getDifficultyRecommendation();
            expect(rec.recommendedProfile).toBeDefined();
            expect(rec.stressAdjustment).toBeDefined();
            expect(rec.maxStress).toBeDefined();
            expect(rec.reason).toBeDefined();
            expect(rec.warnings).toBeDefined();
            expect(rec.metadata).toBeDefined();
        });

        it('should include metadata about player', () => {
            const rec = getDifficultyRecommendation();
            expect(rec.metadata.maturityLevel).toBeDefined();
            expect(rec.metadata.stage).toBeDefined();
            expect(rec.metadata.churnRisk).toBeDefined();
        });
    });
});