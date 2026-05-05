/**
 * @vitest-environment jsdom
 *
 * 自适应出块策略引擎：resolveAdaptiveStrategy 在不同玩家状态下的行为
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';

function makeProfile(overrides = {}) {
    const p = new PlayerProfile(15);
    if (overrides.smoothSkill != null) p._smoothSkill = overrides.smoothSkill;
    if (overrides.comboStreak != null) p._comboStreak = overrides.comboStreak;
    if (overrides.consecutiveNonClears != null) p._consecutiveNonClears = overrides.consecutiveNonClears;
    if (overrides.recoveryCounter != null) p._recoveryCounter = overrides.recoveryCounter;
    if (overrides.spawnCounter != null) p._spawnCounter = overrides.spawnCounter;
    if (overrides.lifetimeGames != null) p._totalLifetimeGames = overrides.lifetimeGames;
    if (overrides.lifetimePlacements != null) p._totalLifetimePlacements = overrides.lifetimePlacements;
    return p;
}

describe('resolveAdaptiveStrategy', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('returns a strategy object with required fields', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 0, 0, 0);
        expect(s.shapeWeights).toBeDefined();
        expect(typeof s.fillRatio).toBe('number');
        expect(s.scoring).toBeDefined();
    });

    it('returns spawnHints when adaptive is enabled', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 50, 0, 0.3);
        if (s.spawnHints) {
            expect(typeof s.spawnHints.clearGuarantee).toBe('number');
            expect(s.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(0);
            expect(s.spawnHints.clearGuarantee).toBeLessThanOrEqual(3);
            expect(typeof s.spawnHints.sizePreference).toBe('number');
            expect(['setup', 'payoff', 'neutral']).toContain(s.spawnHints.rhythmPhase);
            expect(['warmup', 'peak', 'cooldown']).toContain(s.spawnHints.sessionArc);
        }
    });

    it('returns a stress breakdown with named signal contributions', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile({ lifetimeGames: 4, lifetimePlacements: 80 }), 90, 1, 0.35, {
            totalRounds: 6,
            roundsSinceClear: 0,
            holes: 2
        });
        expect(s._stressBreakdown).toBeDefined();
        expect(typeof s._stressBreakdown.scoreStress).toBe('number');
        expect(typeof s._stressBreakdown.difficultyBias).toBe('number');
        expect(typeof s._stressBreakdown.boardRisk).toBe('number');
        expect(s._stressBreakdown.finalStress).toBeCloseTo(s._adaptiveStress, 6);
    });

    it('projects stress into multi-axis spawn targets', () => {
        const relief = resolveAdaptiveStrategy('normal', makeProfile({ consecutiveNonClears: 8 }), 90, 0, 0.65, {
            totalRounds: 8,
            holes: 5,
            nearFullLines: 2
        });
        const challenge = resolveAdaptiveStrategy('hard', makeProfile({ smoothSkill: 0.85, lifetimeGames: 6, lifetimePlacements: 100 }), 180, 2, 0.3, {
            totalRounds: 12,
            roundsSinceClear: 0,
            nearFullLines: 0
        });

        expect(relief.spawnHints.spawnTargets).toBeDefined();
        expect(challenge.spawnHints.spawnTargets).toBeDefined();
        expect(relief.spawnHints.spawnTargets.clearOpportunity).toBeGreaterThan(challenge.spawnHints.spawnTargets.clearOpportunity);
        expect(challenge.spawnHints.spawnTargets.shapeComplexity).toBeGreaterThan(relief.spawnHints.spawnTargets.shapeComplexity);
        expect(challenge._spawnTargets.solutionSpacePressure).toBeGreaterThanOrEqual(0);
        expect(challenge._spawnTargets.solutionSpacePressure).toBeLessThanOrEqual(1);
    });

    it('smooths ordinary stress increases but lets relief drops apply immediately', () => {
        const p = makeProfile({ lifetimeGames: 4, lifetimePlacements: 80 });
        const noPrev = resolveAdaptiveStrategy('normal', p, 180, 0, 0.35, { totalRounds: 8 });
        const smoothed = resolveAdaptiveStrategy('normal', p, 180, 0, 0.35, {
            totalRounds: 8,
            prevAdaptiveStress: 0.1
        });
        expect(smoothed._adaptiveStress).toBeLessThan(noPrev._adaptiveStress);
        expect(smoothed._adaptiveStress).toBeLessThanOrEqual(0.28);

        const relief = resolveAdaptiveStrategy('normal', makeProfile({ consecutiveNonClears: 8 }), 180, 0, 0.35, {
            totalRounds: 8,
            prevAdaptiveStress: 0.9
        });
        expect(relief._adaptiveStress).toBeLessThan(0.9);
        expect(relief._stressBreakdown.frustrationRelief).toBeLessThan(0);
    });

    it('frustrated player gets lower stress / higher clearGuarantee', () => {
        const calm = resolveAdaptiveStrategy('normal', makeProfile(), 100, 0, 0.4);
        const frustrated = resolveAdaptiveStrategy('normal', makeProfile({ consecutiveNonClears: 8 }), 100, 0, 0.4);
        if (calm.spawnHints && frustrated.spawnHints) {
            expect(frustrated._adaptiveStress).toBeLessThanOrEqual(calm._adaptiveStress + 0.01);
            expect(frustrated.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(calm.spawnHints.clearGuarantee);
        }
    });

    it('recovery state lowers stress', () => {
        const normal = resolveAdaptiveStrategy('normal', makeProfile(), 100, 0, 0.5);
        const recovery = resolveAdaptiveStrategy('normal', makeProfile({ recoveryCounter: 3 }), 100, 0, 0.5);
        if (normal._adaptiveStress != null && recovery._adaptiveStress != null) {
            expect(recovery._adaptiveStress).toBeLessThanOrEqual(normal._adaptiveStress + 0.01);
        }
    });

    it('new player in onboarding gets capped stress', () => {
        const newP = makeProfile({ lifetimeGames: 0, lifetimePlacements: 5 });
        newP._spawnCounter = 2;
        const s = resolveAdaptiveStrategy('normal', newP, 0, 0, 0.1);
        if (s._adaptiveStress != null) {
            expect(s._adaptiveStress).toBeLessThanOrEqual(0.1);
        }
    });

    it('difficulty bias: easy < normal < hard', () => {
        const p = makeProfile({ smoothSkill: 0.5 });
        const easy = resolveAdaptiveStrategy('easy', p, 100, 0, 0.3);
        const normal = resolveAdaptiveStrategy('normal', p, 100, 0, 0.3);
        const hard = resolveAdaptiveStrategy('hard', p, 100, 0, 0.3);
        if (easy._adaptiveStress != null) {
            expect(easy._adaptiveStress).toBeLessThan(normal._adaptiveStress + 0.01);
            expect(normal._adaptiveStress).toBeLessThan(hard._adaptiveStress + 0.01);
        }
    });

    it('difficulty tuning changes spawnHints directly', () => {
        const p = makeProfile({ smoothSkill: 0.5, spawnCounter: 8, lifetimeGames: 3, lifetimePlacements: 80 });
        const easy = resolveAdaptiveStrategy('easy', p, 80, 0, 0.35, { totalRounds: 8, roundsSinceClear: 0 });
        const normal = resolveAdaptiveStrategy('normal', p, 80, 0, 0.35, { totalRounds: 8, roundsSinceClear: 0 });
        const hard = resolveAdaptiveStrategy('hard', p, 80, 0, 0.35, { totalRounds: 8, roundsSinceClear: 0 });
        if (easy.spawnHints && normal.spawnHints && hard.spawnHints) {
            expect(easy.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(normal.spawnHints.clearGuarantee);
            expect(hard.spawnHints.clearGuarantee).toBeLessThanOrEqual(normal.spawnHints.clearGuarantee);
            expect(easy.spawnHints.sizePreference).toBeLessThan(normal.spawnHints.sizePreference);
            expect(hard.spawnHints.sizePreference).toBeGreaterThan(normal.spawnHints.sizePreference);
            expect(easy.spawnHints.multiClearBonus).toBeGreaterThan(normal.spawnHints.multiClearBonus);
            expect(hard.spawnHints.multiClearBonus).toBeLessThan(normal.spawnHints.multiClearBonus);
        }
    });

    it('difficulty tuning separates solution difficulty ranges', () => {
        const p = makeProfile({ smoothSkill: 0.5, spawnCounter: 8, lifetimeGames: 3, lifetimePlacements: 80 });
        const easy = resolveAdaptiveStrategy('easy', p, 100, 0, 0.5, { totalRounds: 8, roundsSinceClear: 0 });
        const hard = resolveAdaptiveStrategy('hard', p, 100, 0, 0.5, { totalRounds: 8, roundsSinceClear: 0 });
        if (easy.spawnHints?.targetSolutionRange && hard.spawnHints?.targetSolutionRange) {
            expect(easy._solutionStress).toBeLessThan(hard._solutionStress);
            expect(easy.spawnHints.targetSolutionRange.min).toBeGreaterThanOrEqual(hard.spawnHints.targetSolutionRange.min);
            expect(hard.spawnHints.targetSolutionRange.max).not.toBeNull();
        }
    });

    it('milestone hit produces scoreMilestone spawnHint', () => {
        resetAdaptiveMilestone();
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 50, 0, 0.3);
        if (s.spawnHints) {
            expect(s._milestoneHit).toBe(true);
            expect(s.spawnHints.scoreMilestone).toBe(true);
        }
    });

    it('warmup session arc in early rounds', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile({ spawnCounter: 1 }), 0, 0, 0.1, { totalRounds: 1 });
        if (s.spawnHints) {
            expect(s.spawnHints.sessionArc).toBe('warmup');
        }
    });

    it('rhythmPhase：delight/playstyle 层可将 neutral 提升为 payoff（与当前 spawnHints 一致）', () => {
        const p = makeProfile({ spawnCounter: 3 });
        const s = resolveAdaptiveStrategy('normal', p, 100, 0, 0.35, {
            roundsSinceClear: 5,
            nearFullLines: 0,
            pcSetup: 0,
            lastClearCount: 0,
            totalRounds: 10
        });
        if (s.spawnHints) {
            expect(p.pacingPhase).toBe('release');
            expect(['neutral', 'payoff']).toContain(s.spawnHints.rhythmPhase);
        }
    });

    it('multiLineTarget is 2 when pcSetup>=1', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile({ spawnCounter: 0 }), 100, 0, 0.4, {
            pcSetup: 1,
            nearFullLines: 0,
            totalRounds: 5
        });
        if (s.spawnHints) {
            expect(s.spawnHints.multiLineTarget).toBe(2);
        }
    });

    it('cross-game warmup boosts clearGuarantee and multiLineTarget', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 50, 0, 0.3, {
            warmupRemaining: 2,
            warmupClearBoost: 2,
            totalRounds: 5
        });
        if (s.spawnHints) {
            expect(s.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(3);
            expect(s.spawnHints.multiLineTarget).toBe(2);
        }
    });

    it('cross-game warmup clamps setup rhythm to neutral', () => {
        const p = makeProfile({ spawnCounter: 0 });
        const s = resolveAdaptiveStrategy('normal', p, 80, 0, 0.25, {
            roundsSinceClear: 0,
            nearFullLines: 0,
            pcSetup: 0,
            warmupRemaining: 1,
            warmupClearBoost: 1,
            totalRounds: 8
        });
        if (s.spawnHints) {
            expect(p.pacingPhase).toBe('tension');
            expect(s.spawnHints.rhythmPhase).toBe('neutral');
        }
    });

    it('stress is clamped to [-0.2, 1]', () => {
        for (let skill = 0; skill <= 1; skill += 0.25) {
            for (let score = 0; score <= 1000; score += 200) {
                const s = resolveAdaptiveStrategy('normal', makeProfile({ smoothSkill: skill }), score, 5, 0.8);
                if (s._adaptiveStress != null) {
                    expect(s._adaptiveStress).toBeGreaterThanOrEqual(-0.2);
                    expect(s._adaptiveStress).toBeLessThanOrEqual(1);
                }
            }
        }
    });
});
