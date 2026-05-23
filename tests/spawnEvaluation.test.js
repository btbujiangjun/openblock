/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { runSpawnEvaluation } from '../web/src/bot/spawnEvaluation.js';

describe('spawn evaluation', () => {
    it('produces deterministic summary rows', () => {
        const a = runSpawnEvaluation({
            seed: 7,
            sessions: 1,
            maxSteps: 8,
            strategies: ['normal'],
            policies: ['random', 'survival'],
            spawnGenerators: ['baseline', 'triplet-p1', 'budget-p2'],
        });
        const b = runSpawnEvaluation({
            seed: 7,
            sessions: 1,
            maxSteps: 8,
            strategies: ['normal'],
            policies: ['random', 'survival'],
            spawnGenerators: ['baseline', 'triplet-p1', 'budget-p2'],
        });

        expect(a.rows.length).toBe(6);
        expect(a.comparisons.length).toBe(3);
        expect(a.rows.map((row) => row.scoreMean)).toEqual(b.rows.map((row) => row.scoreMean));
        expect(new Set(a.rows.map((row) => row.spawnGenerator))).toEqual(
            new Set(['baseline', 'triplet-p1', 'budget-p2'])
        );
        for (const row of a.rows) {
            expect(row.games).toBe(1);
            expect(row.spawnCount).toBeGreaterThan(0);
            expect(Number.isFinite(row.noMoveRate)).toBe(true);
        }
        const budgetRows = a.rows.filter((row) => row.spawnGenerator === 'budget-p2');
        expect(budgetRows.some((row) => row.budgetMean)).toBe(true);
    });
});

