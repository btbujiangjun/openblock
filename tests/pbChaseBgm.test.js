import { describe, expect, it } from 'vitest';
import { __test_only__ } from '../web/src/effects/pbChaseBgm.js';

describe('pbChaseBgm phase selection', () => {
    const { _targetPhase } = __test_only__;

    it('stays off for low or warmup PB contexts', () => {
        expect(_targetPhase({ score: 300, pbBaseline: 0, placements: 5 })).toBe('off');
        expect(_targetPhase({ score: 180, pbBaseline: 190, placements: 5 })).toBe('off');
        expect(_targetPhase({ score: 900, pbBaseline: 1000, placements: 2 })).toBe('off');
    });

    it('maps PB distance into near, sprint, and release phases', () => {
        expect(_targetPhase({ score: 790, pbBaseline: 1000, placements: 3 })).toBe('off');
        expect(_targetPhase({ score: 800, pbBaseline: 1000, placements: 3 })).toBe('near');
        expect(_targetPhase({ score: 950, pbBaseline: 1000, placements: 3 })).toBe('sprint');
        expect(_targetPhase({ score: 1001, pbBaseline: 1000, placements: 3 })).toBe('release');
    });

    it('stops unfinished chase loops on game over', () => {
        expect(_targetPhase({ score: 950, pbBaseline: 1000, placements: 3, gameOver: true })).toBe('off');
        expect(_targetPhase({ score: 1001, pbBaseline: 1000, placements: 3, gameOver: true })).toBe('release');
    });
});
