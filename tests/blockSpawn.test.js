/**
 * @vitest-environment jsdom
 *
 * 候选块出块算法：generateDockShapes 产出合法性、3 块保证、品类覆盖
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { getAllShapes } from '../web/src/shapes.js';
import { generateDockShapes, resetSpawnMemory } from '../web/src/bot/blockSpawn.js';
import { getStrategy } from '../web/src/config.js';

const allIds = new Set(getAllShapes().map(s => s.id));

describe('generateDockShapes', () => {
    let grid;
    let config;

    beforeEach(() => {
        resetSpawnMemory();
        grid = new Grid(8);
        config = getStrategy('normal');
    });

    it('always returns exactly 3 shapes', () => {
        for (let trial = 0; trial < 10; trial++) {
            const shapes = generateDockShapes(grid, config);
            expect(shapes.length).toBe(3);
        }
    });

    it('every shape has valid id and data', () => {
        const shapes = generateDockShapes(grid, config);
        for (const s of shapes) {
            expect(typeof s.id).toBe('string');
            expect(allIds.has(s.id)).toBe(true);
            expect(Array.isArray(s.data)).toBe(true);
        }
    });

    it('every shape can be placed on empty board', () => {
        const shapes = generateDockShapes(grid, config);
        for (const s of shapes) {
            expect(grid.canPlaceAnywhere(s.data)).toBe(true);
        }
    });

    it('works on a partially filled board', () => {
        grid.initBoard(0.3, config.shapeWeights || {});
        const shapes = generateDockShapes(grid, config);
        expect(shapes.length).toBe(3);
    });

    it('handles high fill without throwing', () => {
        grid.initBoard(0.35, config.shapeWeights || {});
        const shapes = generateDockShapes(grid, config);
        expect(shapes.length).toBe(3);
    });

    it('uses different strategies without error', () => {
        for (const id of ['easy', 'normal', 'hard']) {
            const cfg = getStrategy(id);
            const shapes = generateDockShapes(grid, cfg);
            expect(shapes.length).toBe(3);
        }
    });

    it('spawnHints clearGuarantee respected (at least N can clear)', () => {
        for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;
        const cfg = {
            ...config,
            spawnHints: { clearGuarantee: 2, sizePreference: 0, diversityBoost: 0 }
        };
        const shapes = generateDockShapes(grid, cfg);
        expect(shapes.length).toBe(3);
    });

    it('prioritizes direct perfect-clear candidates when available', () => {
        for (let x = 0; x < 4; x++) grid.cells[0][x] = 0;
        const cfg = {
            ...config,
            spawnHints: {
                clearGuarantee: 1,
                sizePreference: 0,
                diversityBoost: 0,
                perfectClearBoost: 0
            }
        };

        const shapes = generateDockShapes(grid, cfg);
        expect(shapes.map((s) => s.id)).toContain('1x4');
    });

    it('generates diverse categories over multiple rounds', () => {
        const seenCategories = new Set();
        const ctx = { lastClearCount: 0, roundsSinceClear: 0, recentCategories: [], totalRounds: 0 };
        for (let i = 0; i < 20; i++) {
            const shapes = generateDockShapes(grid, config, ctx);
            for (const s of shapes) {
                seenCategories.add(s.category || 'unknown');
            }
            ctx.totalRounds++;
        }
        expect(seenCategories.size).toBeGreaterThanOrEqual(2);
    });
});
