/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { Grid } from '../web/src/grid.js';
import {
    buildAbilityTrainingDataset,
    buildPlayerAbilityVector
} from '../web/src/playerAbilityModel.js';

function play(profile, n, opts = {}) {
    const { clearEvery = 2, lines = 1, fill = 0.35 } = opts;
    for (let i = 0; i < n; i++) {
        const cleared = clearEvery > 0 && i % clearEvery === 0;
        profile.recordPlace(cleared, cleared ? lines : 0, fill);
    }
}

describe('playerAbilityModel', () => {
    it('builds a bounded ability vector from PlayerProfile and board topology', () => {
        const p = new PlayerProfile(15);
        play(p, 18, { clearEvery: 2, lines: 2, fill: 0.42 });
        const grid = new Grid(8);
        grid.cells[7][0] = { colorIdx: 0 };
        grid.cells[7][1] = { colorIdx: 0 };

        const v = buildPlayerAbilityVector(p, {
            grid,
            boardFill: grid.getFillRatio(),
            gameStats: { placements: 18 },
            spawnContext: { roundsSinceClear: 0 },
        });

        expect(v.version).toBe(1);
        expect(v.skillScore).toBeGreaterThanOrEqual(0);
        expect(v.skillScore).toBeLessThanOrEqual(1);
        expect(v.clearEfficiency).toBeGreaterThan(0.3);
        expect(v.playstyle).toBe(p.playstyle);
        expect(v.explain.length).toBeGreaterThan(0);
    });

    it('raises risk on high fill and consecutive non-clears', () => {
        const p = new PlayerProfile(15);
        play(p, 8, { clearEvery: 0, fill: 0.86 });

        const low = buildPlayerAbilityVector(new PlayerProfile(15), { boardFill: 0.2 });
        const high = buildPlayerAbilityVector(p, {
            boardFill: 0.86,
            topology: { holes: 6, fillRatio: 0.86 },
            spawnContext: { roundsSinceClear: 4 },
        });

        expect(high.riskLevel).toBeGreaterThan(low.riskLevel);
        expect(high.riskBand).toBe('high');
    });

    it('builds offline training samples from replay sessions', () => {
        const rows = [{
            id: 7,
            user_id: 'u1',
            score: 1280,
            strategy: 'normal',
            game_stats: { placements: 24, clears: 9, misses: 1 },
            frames: [
                { t: 'init', ps: { skill: 0.5, boardFill: 0.1, flowDeviation: 0.1, cognitiveLoad: 0.2, metrics: { clearRate: 0.2, missRate: 0, comboRate: 0 } } },
                { t: 'place', ps: { skill: 0.7, boardFill: 0.4, flowDeviation: 0.2, cognitiveLoad: 0.3, flowState: 'flow', playstyle: 'multi_clear', metrics: { clearRate: 0.45, missRate: 0.05, comboRate: 0.3 } } },
            ],
            analysis: { rating: 4, tags: ['steady'] },
        }];

        const data = buildAbilityTrainingDataset(rows);
        expect(data).toHaveLength(1);
        expect(data[0].features.skillLast).toBeCloseTo(0.7);
        expect(data[0].labels.finalScore).toBe(1280);
        expect(data[0].labels.tags).toContain('steady');
    });
});
