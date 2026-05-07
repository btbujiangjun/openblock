/**
 * @vitest-environment jsdom
 * 
 * 需要在 vite.config.js 中配置 jsdom 环境的 localStorage 模拟
 * 或在测试文件顶部设置 global.localStorage
 */
import { describe, it, expect, beforeEach } from 'vitest';

const mockStorage = {};
const mockGlobal = {
    localStorage: {
        getItem: (key) => mockStorage[key] ?? null,
        setItem: (key, value) => { mockStorage[key] = value; },
        removeItem: (key) => { delete mockStorage[key]; },
        clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
    },
    sessionStorage: {
        getItem: (key) => mockSessionStorage[key] ?? null,
        setItem: (key, value) => { mockSessionStorage[key] = value; },
        removeItem: (key) => { delete mockSessionStorage[key]; },
        clear: () => { Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]); }
    }
};
const mockSessionStorage = {};

Object.defineProperty(globalThis, 'localStorage', {
    value: mockGlobal.localStorage,
    writable: true
});
Object.defineProperty(globalThis, 'sessionStorage', {
    value: mockGlobal.sessionStorage,
    writable: true
});
import {
    initDifficultyPredictor,
    predictDifficulty,
    recordGameResult,
    getDifficultyPredictor
} from '../web/src/retention/difficultyPredictor.js';
import { getGoalSystem } from '../web/src/retention/goalSystem.js';
import {
    initLevelProgression,
    getLevelProgression
} from '../web/src/retention/levelProgression.js';
import {
    initRetentionManager,
    getRetentionManager
} from '../web/src/retention/retentionManager.js';

describe('difficultyPredictor', () => {
    beforeEach(() => {
        initDifficultyPredictor();
    });

    it('should initialize with default values', () => {
        const predictor = getDifficultyPredictor();
        expect(predictor).toBeDefined();
    });

    it('should predict difficulty based on profile', () => {
        const prediction = predictDifficulty({});
        expect(prediction).toHaveProperty('recommended');
        expect(['easy', 'normal', 'hard', 'expert']).toContain(prediction.recommended);
        expect(prediction).toHaveProperty('score');
        expect(prediction).toHaveProperty('confidence');
    });

    it('should record game results and build feature buffer', () => {
        recordGameResult({ score: 1000, clears: 20, achieved: true });
        recordGameResult({ score: 800, clears: 15, achieved: false });
        
        const prediction = predictDifficulty({});
        expect(prediction.features.avgScore).toBe(900);
        expect(prediction.features.avgClears).toBe(17.5);
    });

    it('should adjust difficulty for onboarding players', () => {
        const prediction = predictDifficulty({ isInOnboarding: true });
        expect(prediction.score).toBeLessThan(0.4);
    });

    it('should adjust difficulty for players needing recovery', () => {
        const prediction = predictDifficulty({ needsRecovery: true });
        expect(prediction.score).toBeLessThan(0.5);
    });

    it('should handle consecutive failures', () => {
        const prediction = predictDifficulty({
            consecutiveFails: 5,
            flowState: 'anxious'
        });
        expect(prediction.score).toBeLessThan(0.5);
    });

    it('should provide alternatives sorted by score', () => {
        const prediction = predictDifficulty({});
        expect(prediction.alternatives).toHaveLength(4);
        expect(prediction.alternatives[0].score).toBeGreaterThanOrEqual(prediction.alternatives[1].score);
    });
});

describe('goalSystem', () => {
    beforeEach(() => {
        const system = getGoalSystem();
        system.init();
        system.getProgress().winStreak = 0;
        system.getProgress().levelsCompleted = 0;
        system.getProgress().totalStars = 0;
    });

    it('should initialize with long-term goals', () => {
        const summary = getGoalSystem().getSummary();
        expect(summary.longTerm.active).toBeGreaterThan(0);
    });

    it('should update progress from game results', () => {
        const system = getGoalSystem();
        system.updateProgress({ score: 1500, clears: 20, achieved: true });
        
        const progress = system.getProgress();
        expect(progress.totalScore).toBe(1500);
        expect(progress.totalClears).toBe(20);
        expect(progress.totalGames).toBe(1);
    });

    it('should track win streak', () => {
        const system = getGoalSystem();
        system.getProgress().winStreak = 0;
        system.updateProgress({ score: 100, clears: 1, achieved: true });
        system.updateProgress({ score: 100, clears: 1, achieved: true });
        
        const progress = system.getProgress();
        expect(progress.winStreak).toBe(2);
    });

    it('should reset win streak on failure', () => {
        const system = getGoalSystem();
        system.updateProgress({ score: 100, clears: 1, achieved: true });
        system.updateProgress({ score: 100, clears: 1, achieved: false });
        
        const progress = system.getProgress();
        expect(progress.winStreak).toBe(0);
    });

    it('should generate short-term goals', () => {
        const system = getGoalSystem();
        const goals = system.generateShortTerm({ score: 150, clears: 3 });
        expect(goals.length).toBeGreaterThan(0);
    });

    it('should mark goals as completed when target reached', () => {
        const system = getGoalSystem();
        
        for (let i = 0; i < 5; i++) {
            system.updateLevelProgress('L01', 1, true);
        }
        
        const completed = system.checkGoals();
        expect(completed.some(g => g.id === 'complete_5_levels')).toBe(true);
    });

    it('should claim rewards for completed goals', () => {
        const system = getGoalSystem();
        
        for (let i = 0; i < 5; i++) {
            system.updateLevelProgress('L01', 1, true);
        }
        
        system.checkGoals();
        const reward = system.claimReward('complete_5_levels');
        
        expect(reward).toHaveProperty('coin');
        expect(reward).toHaveProperty('gem');
    });

    it('should track level progress', () => {
        const system = getGoalSystem();
        system.updateLevelProgress('L01', 3, true);
        
        const progress = system.getProgress();
        expect(progress.levelsCompleted).toBe(1);
        expect(progress.totalStars).toBe(3);
    });
});

describe('levelProgression', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
        initLevelProgression();
    });

    it('should initialize with default level', () => {
        const progression = getLevelProgression();
        expect(progression.getCurrentLevel()).toBe('L01');
    });

    it('should track level completion', () => {
        const progression = getLevelProgression();
        
        progression.startLevel('L01');
        const result = progression.completeLevel('L01', {
            stars: 2,
            achieved: true,
            score: 350,
            clears: 5
        });
        
        expect(result.completed).toBe(true);
        expect(result.stars).toBe(2);
        
        const status = progression.getLevelStatus('L01');
        expect(status.isCompleted).toBe(true);
        expect(status.stars).toBe(2);
    });

    it('should track best scores', () => {
        const progression = getLevelProgression();
        
        progression.startLevel('L01');
        progression.completeLevel('L01', { stars: 1, achieved: true, score: 300, clears: 3 });
        
        progression.startLevel('L01');
        progression.completeLevel('L01', { stars: 2, achieved: true, score: 400, clears: 5 });
        
        const status = progression.getLevelStatus('L01');
        expect(status.bestScore).toBe(400);
    });

    it('should update stars when new best', () => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
        const progression = getLevelProgression();
        
        progression.startLevel('L02');
        progression.completeLevel('L02', { stars: 1, achieved: true, score: 200, clears: 2 });
        
        progression.startLevel('L02');
        progression.completeLevel('L02', { stars: 3, achieved: true, score: 400, clears: 6 });
        
        const summary = progression.getSummary();
        expect(summary.totalStars).toBe(3);
    });

    it('should provide chapter progress', () => {
        const progression = getLevelProgression();
        const chapters = progression.getChapters();
        
        expect(chapters.length).toBe(3);
        expect(chapters[0].isUnlocked).toBe(true);
    });

    it('should unlock next chapter after requirement met', () => {
        const progression = getLevelProgression();
        
        for (let i = 1; i <= 6; i++) {
            progression.startLevel(`L0${i}`);
            progression.completeLevel(`L0${i}`, { stars: 1, achieved: true, score: 100, clears: 1 });
        }
        
        const chapters = progression.getChapters();
        expect(chapters[1].isUnlocked).toBe(true);
    });

    it('should provide summary statistics', () => {
        const progression = getLevelProgression();
        const summary = progression.getSummary();
        
        expect(summary).toHaveProperty('completedLevels');
        expect(summary).toHaveProperty('totalLevels');
        expect(summary).toHaveProperty('totalStars');
    });
});

describe('retentionManager', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
        initRetentionManager('test-user');
    });

    it('should integrate all subsystems', () => {
        const retention = getRetentionManager();
        expect(retention).toBeDefined();
    });

    it('should handle game end and update all systems', () => {
        const retention = getRetentionManager();
        
        const result = retention.afterGameEnd({
            score: 1500,
            clears: 20,
            achieved: true,
            perfectClears: false
        });
        
        expect(result).toHaveProperty('completedGoals');
        expect(result).toHaveProperty('canClaim');
    });

    it('should provide difficulty recommendations', () => {
        const retention = getRetentionManager();
        const recommendation = retention.getDifficultyRecommendation({});
        
        expect(recommendation).toHaveProperty('recommended');
    });

    it('should provide active goals', () => {
        const retention = getRetentionManager();
        const goals = retention.getActiveGoals();
        
        expect(goals).toHaveProperty('shortTerm');
        expect(goals).toHaveProperty('longTerm');
    });

    it('should provide retention insights', () => {
        const retention = getRetentionManager();
        
        retention.afterGameEnd({ score: 1000, clears: 10, achieved: true });
        
        const insights = retention.getRetentionInsights();
        
        expect(insights).toHaveProperty('retention');
        expect(insights).toHaveProperty('levelProgress');
        expect(insights).toHaveProperty('recommendations');
    });

    it('should track level progress', () => {
        const retention = getRetentionManager();
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
        
        retention.startLevel('L01');
        const result = retention.completeLevel('L01', {
            stars: 2,
            achieved: true,
            score: 300,
            clears: 5
        });
        
        expect(result.completed).toBe(true);
        
        const summary = retention.getLevelSummary();
        expect(summary.completedLevels).toBe(1);
    });

    it('should provide chapter progress', () => {
        const retention = getRetentionManager();
        const chapters = retention.getChapterProgress();
        
        expect(chapters.length).toBe(3);
    });
});