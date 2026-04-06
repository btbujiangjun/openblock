/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    getLevelFromTotalXp,
    getLevelProgress,
    applyGameEndProgression,
    loadProgress,
    computeXpGain
} from '../web/src/progression.js';

const PROGRESSION_LS = 'openblock_progression_v1';

beforeEach(() => {
    try {
        localStorage.removeItem(PROGRESSION_LS);
    } catch {
        /* ignore */
    }
});

describe('progression', () => {
    it('getLevelFromTotalXp uses sqrt curve', () => {
        expect(getLevelFromTotalXp(0)).toBe(1);
        expect(getLevelFromTotalXp(99)).toBe(1);
        expect(getLevelFromTotalXp(100)).toBe(2);
        expect(getLevelFromTotalXp(399)).toBe(2);
        expect(getLevelFromTotalXp(400)).toBe(3);
    });

    it('getLevelProgress frac in range', () => {
        const p = getLevelProgress(150);
        expect(p.level).toBe(2);
        expect(p.frac).toBeGreaterThanOrEqual(0);
        expect(p.frac).toBeLessThanOrEqual(1);
    });

    it('applyGameEndProgression persists totalXp', () => {
        const r = applyGameEndProgression({
            score: 400,
            gameStats: { clears: 4, maxLinesCleared: 2 },
            strategy: 'normal',
            runStreak: 0
        });
        expect(r.xpGained).toBeGreaterThanOrEqual(10);
        expect(r.state.totalXp).toBe(r.xpGained);
    });

    it('computeXpGain applies strategy multiplier', () => {
        const state = loadProgress();
        const easy = computeXpGain({
            score: 200,
            gameStats: { clears: 0, maxLinesCleared: 0 },
            strategy: 'easy',
            runStreak: 0,
            state
        });
        const state2 = loadProgress();
        const hard = computeXpGain({
            score: 200,
            gameStats: { clears: 0, maxLinesCleared: 0 },
            strategy: 'hard',
            runStreak: 0,
            state: state2
        });
        expect(hard.total).toBeGreaterThan(easy.total);
    });
});
