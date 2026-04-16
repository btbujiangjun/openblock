/**
 * @vitest-environment jsdom
 *
 * 玩家实时能力画像：技能估计、心流状态、动量、挫败、持久化
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PlayerProfile } from '../web/src/playerProfile.js';

function simulatePlays(profile, n, opts = {}) {
    const { clearRate = 0.3, linesPerClear = 1, fillBase = 0.3 } = opts;
    for (let i = 0; i < n; i++) {
        const cleared = Math.random() < clearRate;
        profile.recordPlace(cleared, cleared ? linesPerClear : 0, fillBase + Math.random() * 0.1);
    }
}

describe('PlayerProfile', () => {
    let p;
    beforeEach(() => { p = new PlayerProfile(15); });

    describe('initial state', () => {
        it('starts with default skill 0.5', () => {
            expect(p.skillLevel).toBeCloseTo(0.5, 1);
        });

        it('isNewPlayer true when fresh', () => {
            expect(p.isNewPlayer).toBe(true);
        });

        it('frustrationLevel starts at 0', () => {
            expect(p.frustrationLevel).toBe(0);
        });

        it('momentum starts at 0', () => {
            expect(p.momentum).toBe(0);
        });
    });

    describe('recordPlace skill convergence', () => {
        it('skill rises with many clears', () => {
            const initial = p.skillLevel;
            simulatePlays(p, 30, { clearRate: 0.9, linesPerClear: 2 });
            expect(p.skillLevel).toBeGreaterThan(initial);
        });

        it('skill drops with many misses and no clears', () => {
            simulatePlays(p, 10, { clearRate: 0.5 });
            const mid = p.skillLevel;
            for (let i = 0; i < 20; i++) {
                p.recordPlace(false, 0, 0.7);
            }
            expect(p.skillLevel).toBeLessThan(mid + 0.05);
        });
    });

    describe('frustration tracking', () => {
        it('increases with consecutive non-clears', () => {
            for (let i = 0; i < 5; i++) {
                p.recordPlace(false, 0, 0.3);
            }
            expect(p.frustrationLevel).toBe(5);
        });

        it('resets on clear', () => {
            for (let i = 0; i < 5; i++) p.recordPlace(false, 0, 0.3);
            p.recordPlace(true, 1, 0.3);
            expect(p.frustrationLevel).toBe(0);
        });
    });

    describe('combo streak', () => {
        it('increments on multi-line clears', () => {
            p.recordPlace(true, 2, 0.3);
            p.recordPlace(true, 3, 0.3);
            expect(p.recentComboStreak).toBe(2);
        });

        it('resets on single-line or no clear', () => {
            p.recordPlace(true, 2, 0.3);
            p.recordPlace(true, 1, 0.3);
            expect(p.recentComboStreak).toBe(0);
        });
    });

    describe('flowState', () => {
        it('returns one of the three valid states', () => {
            simulatePlays(p, 20, { clearRate: 0.4 });
            expect(['bored', 'flow', 'anxious']).toContain(p.flowState);
        });

        it('starts in flow with few moves', () => {
            expect(p.flowState).toBe('flow');
        });
    });

    describe('needsRecovery', () => {
        it('triggers at high board fill', () => {
            p.recordPlace(false, 0, 0.9);
            expect(p.needsRecovery).toBe(true);
        });

        it('decays over subsequent placements', () => {
            p.recordPlace(false, 0, 0.9);
            for (let i = 0; i < 10; i++) {
                p.recordPlace(false, 0, 0.2);
            }
            expect(p.needsRecovery).toBe(false);
        });
    });

    describe('hadRecentNearMiss', () => {
        it('true after non-clear on high-fill board', () => {
            p.recordPlace(false, 0, 0.7);
            expect(p.hadRecentNearMiss).toBe(true);
        });

        it('false after a clear', () => {
            p.recordPlace(true, 1, 0.7);
            expect(p.hadRecentNearMiss).toBe(false);
        });
    });

    describe('pacingPhase', () => {
        it('returns tension or release', () => {
            expect(['tension', 'release']).toContain(p.pacingPhase);
        });
    });

    describe('sessionPhase', () => {
        it('starts as early', () => {
            expect(p.sessionPhase).toBe('early');
        });
    });

    describe('metrics', () => {
        it('returns defaults with no moves', () => {
            const m = p.metrics;
            expect(m.thinkMs).toBe(3000);
            expect(m.clearRate).toBeCloseTo(0.3);
        });

        it('clearRate updates after plays', () => {
            for (let i = 0; i < 10; i++) p.recordPlace(true, 1, 0.3);
            expect(p.metrics.clearRate).toBeGreaterThan(0.5);
        });
    });

    describe('recordNewGame / recordSessionEnd', () => {
        it('recordNewGame increments lifetime games', () => {
            p.recordNewGame();
            p.recordNewGame();
            expect(p.lifetimeGames).toBe(2);
        });

        it('recordSessionEnd appends to session history', () => {
            p.recordNewGame();
            simulatePlays(p, 10);
            p.recordSessionEnd({ score: 100, placements: 10, clears: 3, misses: 1, maxCombo: 2 });
            expect(p._sessionHistory.length).toBe(1);
            expect(p._sessionHistory[0].score).toBe(100);
        });
    });

    describe('ingestHistoricalStats', () => {
        it('sets baseline skill from aggregated stats', () => {
            p.ingestHistoricalStats({
                totalGames: 50, totalScore: 50000, totalClears: 300,
                totalPlacements: 600, totalMisses: 30, maxCombo: 4
            });
            expect(p.historicalSkill).toBeGreaterThan(0);
            expect(p.historicalSkill).toBeLessThanOrEqual(1);
        });
    });

    describe('toJSON / fromJSON round-trip', () => {
        it('preserves skill and lifetime stats', () => {
            p._smoothSkill = 0.75;
            p._totalLifetimeGames = 10;
            p._totalLifetimePlacements = 200;
            const json = p.toJSON();
            const p2 = PlayerProfile.fromJSON(json);
            expect(p2._smoothSkill).toBeCloseTo(0.75, 2);
            expect(p2._totalLifetimeGames).toBe(10);
            expect(p2._totalLifetimePlacements).toBe(200);
        });
    });

    describe('cognitiveLoad', () => {
        it('returns a number between 0 and 1', () => {
            simulatePlays(p, 15);
            expect(p.cognitiveLoad).toBeGreaterThanOrEqual(0);
            expect(p.cognitiveLoad).toBeLessThanOrEqual(1);
        });
    });

    describe('confidence / trend / historicalSkill', () => {
        it('confidence = 0 with no history', () => {
            expect(p.confidence).toBe(0);
        });

        it('trend = 0 with no history', () => {
            expect(p.trend).toBe(0);
        });

        it('confidence rises with more sessions', () => {
            for (let i = 0; i < 10; i++) {
                p.recordNewGame();
                simulatePlays(p, 5);
                p.recordSessionEnd({ score: 100 + i * 10, placements: 5, clears: 2, misses: 0, maxCombo: 1 });
            }
            expect(p.confidence).toBeGreaterThan(0.1);
        });
    });
});
