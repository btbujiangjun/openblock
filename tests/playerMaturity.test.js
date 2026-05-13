/**
 * @vitest-environment jsdom
 * playerMaturity.test.js - 玩家成熟度模型测试
 */

import { describe, it, expect, beforeEach } from 'vitest';

const mockStorage = {};
const mockSessionStorage = {};

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
    calculateMaturityScore,
    calculateSkillScore,
    calculateValueScore,
    calculateCombinedMatureIndex,
    getMaturityLevel,
    getMaturityBand,
    getPlayerMaturity,
    updateMaturity,
    getMaturityInsights,
    getRecommendedActions,
    invalidateMaturityCache,
    SKILL_WEIGHTS,
    VALUE_WEIGHTS
} from '../web/src/retention/playerMaturity.js';

describe('Player Maturity Model', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    describe('calculateMaturityScore', () => {
        it('should return 0 for null data', () => {
            expect(calculateMaturityScore(null)).toBe(0);
            expect(calculateMaturityScore(undefined)).toBe(0);
        });

        it('should calculate low score for beginner player (L1)', () => {
            const playerData = {
                avgSessionCount: 1,
                sessionDuration: 60,
                returnFrequency: 1,
                featureAdoption: 0.1,
                maxLevel: 1,
                totalScore: 100,
                achievementCount: 0,
                totalSpend: 0,
                adExposureCount: 0
            };
            const score = calculateMaturityScore(playerData);
            expect(score).toBeLessThan(40);
            expect(score).toBeGreaterThanOrEqual(0);
        });

        it('should calculate medium score for enthusiast (L2)', () => {
            const playerData = {
                avgSessionCount: 6,
                sessionDuration: 200,
                returnFrequency: 6,
                featureAdoption: 0.5,
                maxLevel: 15,
                totalScore: 15000,
                achievementCount: 8,
                totalSpend: 5,
                adExposureCount: 15
            };
            const score = calculateMaturityScore(playerData);
            expect(score).toBeGreaterThanOrEqual(40);
            expect(score).toBeLessThan(60);
        });

        it('should calculate high score for veteran (L3)', () => {
            const playerData = {
                avgSessionCount: 8,
                sessionDuration: 240,
                returnFrequency: 7,
                featureAdoption: 0.7,
                maxLevel: 30,
                totalScore: 50000,
                achievementCount: 15,
                totalSpend: 50,
                adExposureCount: 30
            };
            const score = calculateMaturityScore(playerData);
            expect(score).toBeGreaterThanOrEqual(60);
            expect(score).toBeLessThan(80);
        });

        it('should calculate very high score for core player (L4)', () => {
            const playerData = {
                avgSessionCount: 15,
                sessionDuration: 300,
                returnFrequency: 7,
                featureAdoption: 0.9,
                maxLevel: 50,
                totalScore: 200000,
                achievementCount: 30,
                totalSpend: 500,
                adExposureCount: 100
            };
            const score = calculateMaturityScore(playerData);
            expect(score).toBeGreaterThanOrEqual(80);
            expect(score).toBeLessThanOrEqual(100);
        });

        it('should cap individual values at max', () => {
            const playerData = {
                avgSessionCount: 100,
                sessionDuration: 10000,
                returnFrequency: 100,
                featureAdoption: 1,
                maxLevel: 1000,
                totalScore: 10000000,
                achievementCount: 1000,
                totalSpend: 10000,
                adExposureCount: 10000
            };
            const score = calculateMaturityScore(playerData);
            expect(score).toBeLessThanOrEqual(100);
        });
    });

    describe('getMaturityLevel', () => {
        it('should return L1 for scores below 40', () => {
            expect(getMaturityLevel(0)).toBe('L1');
            expect(getMaturityLevel(20)).toBe('L1');
            expect(getMaturityLevel(39)).toBe('L1');
        });

        it('should return L2 for scores 40-59', () => {
            expect(getMaturityLevel(40)).toBe('L2');
            expect(getMaturityLevel(50)).toBe('L2');
            expect(getMaturityLevel(59)).toBe('L2');
        });

        it('should return L3 for scores 60-79', () => {
            expect(getMaturityLevel(60)).toBe('L3');
            expect(getMaturityLevel(70)).toBe('L3');
            expect(getMaturityLevel(79)).toBe('L3');
        });

        it('should return L4 for scores 80-100', () => {
            expect(getMaturityLevel(80)).toBe('L4');
            expect(getMaturityLevel(90)).toBe('L4');
            expect(getMaturityLevel(100)).toBe('L4');
        });
    });

    describe('updateMaturity', () => {
        it('should initialize with L1 for new player', () => {
            invalidateMaturityCache();
            const result = updateMaturity({
                sessionCount: 1,
                avgDuration: 60,
                returnFrequency: 1,
                featureAdoption: 0.1,
                maxLevel: 1,
                totalScore: 100,
                achievementCount: 0,
                totalSpend: 0,
                adExposureCount: 0
            });

            expect(result.level).toBe('L1');
            expect(result.score).toBeLessThan(40);
        });

        it('should track total sessions across updates', () => {
            invalidateMaturityCache();
            updateMaturity({ sessionCount: 3, sessionsAdded: 3, totalScore: 500 });
            updateMaturity({ sessionCount: 5, sessionsAdded: 2, totalScore: 1000 });

            const maturity = getPlayerMaturity();
            expect(maturity.totalSessions).toBeGreaterThanOrEqual(3);
        });

        it('should update max level', () => {
            invalidateMaturityCache();
            updateMaturity({ maxLevel: 5 });
            updateMaturity({ maxLevel: 10 });

            const maturity = getPlayerMaturity();
            expect(maturity.maxLevel).toBe(10);
        });

        it('should not decrease max level', () => {
            invalidateMaturityCache();
            updateMaturity({ maxLevel: 20 });
            updateMaturity({ maxLevel: 5 });

            const maturity = getPlayerMaturity();
            expect(maturity.maxLevel).toBe(20);
        });
    });

    describe('getMaturityInsights', () => {
        it('should return default values for new player', () => {
            invalidateMaturityCache();
            const insights = getMaturityInsights();
            expect(insights.level).toBe('L1');
            expect(insights.churnRisk).toBe('unknown');
        });

        it('should calculate churn risk based on score decline', () => {
            invalidateMaturityCache();
            for (let i = 0; i < 5; i++) {
                updateMaturity({
                    sessionCount: 5,
                    totalScore: 1000 - (i * 50),
                    daysSinceInstall: i
                });
            }

            const insights = getMaturityInsights();
            expect(['high', 'medium', 'low', 'stable']).toContain(insights.churnRisk);
        });
    });

    describe('getRecommendedActions', () => {
        it('should return 4 actions for each level', () => {
            expect(getRecommendedActions('L1').length).toBe(4);
            expect(getRecommendedActions('L2').length).toBe(4);
            expect(getRecommendedActions('L3').length).toBe(4);
            expect(getRecommendedActions('L4').length).toBe(4);
        });

        it('should have high priority actions for L1', () => {
            const l1Actions = getRecommendedActions('L1');
            const highPriority = l1Actions.filter(a => a.priority === 'high');
            expect(highPriority.length).toBeGreaterThanOrEqual(2);
        });

        it('should include vip actions for L4', () => {
            const l4Actions = getRecommendedActions('L4');
            const hasVip = l4Actions.some(a => a.id === 'vip_badge');
            expect(hasVip).toBe(true);
        });
    });

    /* PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P0-1 回归测试：双分制成熟度。 */
    describe('dual-score (SkillScore / ValueScore) — P0-1', () => {
        it('SKILL_WEIGHTS / VALUE_WEIGHTS 各自和 = 1，且不互相包含付费/广告字段', () => {
            const skillSum = Object.values(SKILL_WEIGHTS).reduce((a, b) => a + b, 0);
            const valueSum = Object.values(VALUE_WEIGHTS).reduce((a, b) => a + b, 0);
            expect(skillSum).toBeCloseTo(1, 5);
            expect(valueSum).toBeCloseTo(1, 5);
            expect('totalSpend' in SKILL_WEIGHTS).toBe(false);
            expect('adExposureCount' in SKILL_WEIGHTS).toBe(false);
            expect('avgSessionCount' in VALUE_WEIGHTS).toBe(false);
        });

        it('纯付费玩家不应被 SkillScore 推到 L4：避免商业化偏向污染分群', () => {
            const skill = calculateSkillScore({
                avgSessionCount: 1, sessionDuration: 30, returnFrequency: 1,
                featureAdoption: 0.05, maxLevel: 1, totalScore: 50, achievementCount: 0,
                totalSpend: 9999, adExposureCount: 9999
            });
            expect(skill).toBeLessThan(40);
            expect(getMaturityLevel(skill)).toBe('L1');
            expect(getMaturityBand(skill)).toBe('M0');
        });

        it('纯活跃免费玩家应能被 SkillScore 推到 L3+', () => {
            const skill = calculateSkillScore({
                avgSessionCount: 10, sessionDuration: 300, returnFrequency: 7,
                featureAdoption: 0.8, maxLevel: 40, totalScore: 80000, achievementCount: 25,
                totalSpend: 0, adExposureCount: 0
            });
            expect(skill).toBeGreaterThanOrEqual(60);
            expect(['L3', 'L4']).toContain(getMaturityLevel(skill));
        });

        it('ValueScore 由 totalSpend / adExposureCount / retainedDays 派生', () => {
            const v0 = calculateValueScore({ totalSpend: 0, adExposureCount: 0, retainedDays: 0 });
            const vMix = calculateValueScore({ totalSpend: 50, adExposureCount: 25, retainedDays: 15 });
            expect(v0).toBe(0);
            expect(vMix).toBeGreaterThan(0);
            expect(vMix).toBeLessThanOrEqual(100);
        });

        it('calculateMaturityScore (旧 API) 等价于 calculateSkillScore 以保留旧测试边界', () => {
            const data = { avgSessionCount: 6, sessionDuration: 200, returnFrequency: 6,
                featureAdoption: 0.5, maxLevel: 15, totalScore: 15000, achievementCount: 8,
                totalSpend: 5, adExposureCount: 15 };
            expect(calculateMaturityScore(data)).toBe(calculateSkillScore(data));
        });

        it('calculateCombinedMatureIndex 在 alpha 边界处行为正确', () => {
            expect(calculateCombinedMatureIndex(80, 20, 1)).toBe(80);
            expect(calculateCombinedMatureIndex(80, 20, 0)).toBe(20);
            expect(calculateCombinedMatureIndex(80, 20, 0.5)).toBe(50);
        });

        it('getMaturityBand 应映射到 M0–M4（v1.48：SkillScore≥90 进 M4）', () => {
            expect(getMaturityBand(10)).toBe('M0');
            expect(getMaturityBand(45)).toBe('M1');
            expect(getMaturityBand(70)).toBe('M2');
            expect(getMaturityBand(85)).toBe('M3');   // L4 但 < 90 仍 M3
            expect(getMaturityBand(95)).toBe('M4');   // v1.48：顶端核心进 M4，让 lifecycleStressCapMap 的 S*·M4 能命中
            expect(getMaturityBand(100)).toBe('M4');
        });

        it('updateMaturity 写入并返回 skillScore / valueScore / matureIndex / band', () => {
            invalidateMaturityCache();
            const result = updateMaturity({
                sessionCount: 8, avgDuration: 200, returnFrequency: 6, featureAdoption: 0.5,
                maxLevel: 20, totalScore: 30000, achievementCount: 10,
                totalSpend: 5, adExposureCount: 20, retainedDays: 10
            });
            expect(result).toHaveProperty('skillScore');
            expect(result).toHaveProperty('valueScore');
            expect(result).toHaveProperty('matureIndex');
            expect(result).toHaveProperty('band');
            expect(['M0', 'M1', 'M2', 'M3']).toContain(result.band);
            const insights = getMaturityInsights();
            expect(insights.skillScore).toBe(result.skillScore);
            expect(insights.valueScore).toBe(result.valueScore);
            expect(insights.band).toBe(result.band);
        });
    });

    describe('storage persistence', () => {
        it('should persist maturity data', () => {
            invalidateMaturityCache();
            updateMaturity({
                sessionCount: 10,
                totalScore: 5000,
                maxLevel: 15
            });

            const maturity = getPlayerMaturity();
            expect(maturity.totalScore).toBe(5000);
            expect(maturity.maxLevel).toBeGreaterThanOrEqual(10);
        });

        it('should invalidate cache on demand', () => {
            invalidateMaturityCache();
            updateMaturity({ sessionCount: 5, totalScore: 1000 });
            invalidateMaturityCache();

            const cached = getPlayerMaturity();
            expect(cached.history).toEqual([]);
        });
    });
});