/**
 * @vitest-environment jsdom
 * playerLifecycleDashboard.test.js - 玩家生命周期面板测试
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
    getPlayerLifecycleStage,
    getPlayerLifecycleStageDetail,
    getLifecycleConfig,
    getLifecycleDashboardData,
    shouldTriggerIntervention,
    getInterventionContent,
    renderLifecycleBadge,
    getLifecycleMaturitySnapshot
} from '../web/src/retention/playerLifecycleDashboard.js';

describe('Player Lifecycle Dashboard', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    describe('getPlayerLifecycleStage', () => {
        it('should return onboarding for new players', () => {
            expect(getPlayerLifecycleStage({ daysSinceInstall: 1, totalSessions: 2 })).toBe('onboarding');
            expect(getPlayerLifecycleStage({ daysSinceInstall: 0, totalSessions: 1 })).toBe('onboarding');
        });

        it('should return exploration for mid-stage players', () => {
            expect(getPlayerLifecycleStage({ daysSinceInstall: 7, totalSessions: 20 })).toBe('exploration');
            expect(getPlayerLifecycleStage({ daysSinceInstall: 10, totalSessions: 40 })).toBe('exploration');
        });

        it('should return growth for regular players', () => {
            expect(getPlayerLifecycleStage({ daysSinceInstall: 20, totalSessions: 100 })).toBe('growth');
            expect(getPlayerLifecycleStage({ daysSinceInstall: 25, totalSessions: 150 })).toBe('growth');
        });

        it('should return stability for long-term players', () => {
            expect(getPlayerLifecycleStage({ daysSinceInstall: 60, totalSessions: 300 })).toBe('stability');
            expect(getPlayerLifecycleStage({ daysSinceInstall: 80, totalSessions: 400 })).toBe('stability');
        });

        it('should return veteran for very long-term players', () => {
            expect(getPlayerLifecycleStage({ daysSinceInstall: 100, totalSessions: 600 })).toBe('veteran');
            expect(getPlayerLifecycleStage({ daysSinceInstall: 200, totalSessions: 1000 })).toBe('veteran');
        });
    });

    describe('getLifecycleConfig', () => {
        it('should return correct config for each stage', () => {
            const onboarding = getLifecycleConfig('onboarding');
            expect(onboarding.stageName).toBe('导入期');
            expect(onboarding.stageColor).toBe('#4CAF50');
            expect(onboarding.keyMetrics).toContain('d1Retention');

            const veteran = getLifecycleConfig('veteran');
            expect(veteran.stageName).toBe('核心期');
            expect(veteran.stageColor).toBe('#F44336');
        });
    });

    describe('getLifecycleDashboardData', () => {
        it('should return complete dashboard data', () => {
            const data = getLifecycleDashboardData({
                daysSinceInstall: 10,
                totalSessions: 50
            });

            expect(data.stage).toBeDefined();
            expect(data.stageName).toBeDefined();
            expect(data.maturityLevel).toBeDefined();
            expect(data.maturityScore).toBeDefined();
            expect(data.churnRisk).toBeDefined();
            expect(data.recommendedActions).toHaveLength(3);
            expect(data.stats).toBeDefined();
        });

        it('should include correct stage based on input', () => {
            const newPlayerData = getLifecycleDashboardData({
                daysSinceInstall: 2,
                totalSessions: 3
            });
            expect(newPlayerData.stage).toBe('onboarding');

            const veteranData = getLifecycleDashboardData({
                daysSinceInstall: 150,
                totalSessions: 800
            });
            expect(veteranData.stage).toBe('veteran');
        });
    });

    describe('shouldTriggerIntervention', () => {
        it('should return empty array when no triggers', () => {
            const triggers = shouldTriggerIntervention({
                daysSinceInstall: 10,
                totalSessions: 50
            });
            expect(Array.isArray(triggers)).toBe(true);
        });

        it('should include onboarding help for new players', () => {
            const triggers = shouldTriggerIntervention({
                daysSinceInstall: 1,
                totalSessions: 1
            });
            const hasOnboardingTrigger = triggers.some(t => t.type === 'onboarding_help');
            expect(hasOnboardingTrigger).toBe(true);
        });
    });

    describe('getInterventionContent', () => {
        it('should return content for valid trigger types', () => {
            const content = getInterventionContent('churn_prevention', {});
            expect(content).toBeDefined();
            expect(content.title).toBe('回归有礼');
            expect(content.cta).toBe('立即领取');
        });

        it('should return null for invalid trigger types', () => {
            const content = getInterventionContent('invalid_type', {});
            expect(content).toBeNull();
        });
    });

    describe('renderLifecycleBadge', () => {
        it('should render badge with correct data', () => {
            const badge = renderLifecycleBadge({
                daysSinceInstall: 5,
                totalSessions: 10
            });
            expect(badge.stage).toBeDefined();
            expect(badge.color).toBeDefined();
            expect(badge.maturity).toBeDefined();
            expect(badge.churnRisk).toBeDefined();
            expect(badge.label).toContain(badge.stage);
        });
    });

    /* PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P0-2 回归测试。 */
    describe('P0-2 门槛 + 置信判定（AND 替代 OR）', () => {
        it('高频回访玩家（days=2, sessions=100）不再被锁在 onboarding', () => {
            /* 旧 OR 实现：days(2)<=3 || sessions(100)<=10 → onboarding。
             * 新 AND 实现：days OK 但 sessions 突破 → 跨阶段；
             * 进一步 days(2)<=14 && sessions(100)<=50 → 也不是 exploration（sessions>50）；
             * days(2)<=30 && sessions(100)<=200 → growth */
            expect(getPlayerLifecycleStage({ daysSinceInstall: 2, totalSessions: 100 })).toBe('growth');
        });

        it('getPlayerLifecycleStageDetail 返回 stage / confidence / hits', () => {
            const detail = getPlayerLifecycleStageDetail({ daysSinceInstall: 5, totalSessions: 20 });
            expect(detail).toHaveProperty('stage');
            expect(detail).toHaveProperty('confidence');
            expect(detail).toHaveProperty('hits');
            expect(detail.confidence).toBeGreaterThan(0);
            expect(detail.confidence).toBeLessThanOrEqual(1);
        });

        it('置信度受 daysSinceLastActive 衰减：长期未活跃置信下降', () => {
            const fresh = getPlayerLifecycleStageDetail({
                daysSinceInstall: 5, totalSessions: 20, daysSinceLastActive: 0
            });
            const stale = getPlayerLifecycleStageDetail({
                daysSinceInstall: 5, totalSessions: 20, daysSinceLastActive: 14
            });
            expect(stale.confidence).toBeLessThan(fresh.confidence);
        });

        it('原有 5 段判定边界仍然兼容', () => {
            expect(getPlayerLifecycleStage({ daysSinceInstall: 1, totalSessions: 1 })).toBe('onboarding');
            expect(getPlayerLifecycleStage({ daysSinceInstall: 7, totalSessions: 20 })).toBe('exploration');
            expect(getPlayerLifecycleStage({ daysSinceInstall: 100, totalSessions: 600 })).toBe('veteran');
        });
    });

    /* PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P0-5 回归测试。 */
    describe('P0-5 getLifecycleMaturitySnapshot — 同屏标签数据源', () => {
        it('返回 stageCode + band + shortLabel', () => {
            const snap = getLifecycleMaturitySnapshot({
                daysSinceInstall: 1, totalSessions: 1, daysSinceLastActive: 0
            });
            expect(snap.stageCode).toMatch(/^S[0-4]\+?$/);
            expect(snap.band).toMatch(/^M[0-4]$/);
            expect(snap.shortLabel).toMatch(/^S[0-4]\+?·M[0-4]$/);
            expect(snap.isWinbackCandidate).toBe(false);
        });

        it('daysSinceLastActive ≥ 7 时进入 winback 视角（S4）', () => {
            const snap = getLifecycleMaturitySnapshot({
                daysSinceInstall: 30, totalSessions: 80, daysSinceLastActive: 14
            });
            expect(snap.isWinbackCandidate).toBe(true);
            expect(snap.stageCode).toBe('S4');
            expect(snap.shortLabel.startsWith('S4·M')).toBe(true);
        });
    });
});