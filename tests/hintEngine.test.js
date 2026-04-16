/**
 * @vitest-environment jsdom
 *
 * 求助提示引擎：computeHints 返回合法落子建议
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { computeHints } from '../web/src/hintEngine.js';

function makeDock(grid) {
    return [
        { id: '1x1', shape: [[1]], colorIdx: 0, placed: false },
        { id: '1x2', shape: [[1, 1]], colorIdx: 1, placed: false },
        { id: '2x1', shape: [[1], [1]], colorIdx: 2, placed: false }
    ];
}

describe('computeHints', () => {
    it('returns up to topN hints on empty board', () => {
        const grid = new Grid(8);
        const dock = makeDock(grid);
        const hints = computeHints(grid, dock, 3);
        expect(hints.length).toBe(3);
    });

    it('each hint references a valid dock block and position', () => {
        const grid = new Grid(8);
        const dock = makeDock(grid);
        const hints = computeHints(grid, dock);
        for (const h of hints) {
            expect(h.blockIdx).toBeGreaterThanOrEqual(0);
            expect(h.blockIdx).toBeLessThan(dock.length);
            expect(grid.canPlace(dock[h.blockIdx].shape, h.gx, h.gy)).toBe(true);
        }
    });

    it('hints are sorted by totalScore descending', () => {
        const grid = new Grid(8);
        const dock = makeDock(grid);
        const hints = computeHints(grid, dock, 5);
        for (let i = 1; i < hints.length; i++) {
            expect(hints[i].totalScore).toBeLessThanOrEqual(hints[i - 1].totalScore);
        }
    });

    it('skips placed blocks', () => {
        const grid = new Grid(8);
        const dock = makeDock(grid);
        dock[0].placed = true;
        const hints = computeHints(grid, dock);
        for (const h of hints) {
            expect(h.blockIdx).not.toBe(0);
        }
    });

    it('returns empty when no moves available', () => {
        const grid = new Grid(8);
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid.cells[y][x] = 0;
        const dock = makeDock(grid);
        const hints = computeHints(grid, dock);
        expect(hints.length).toBe(0);
    });

    it('prefers clearing moves over non-clearing', () => {
        const grid = new Grid(8);
        for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;
        const dock = [
            { id: '1x1', shape: [[1]], colorIdx: 0, placed: false },
            { id: '1x2', shape: [[1, 1]], colorIdx: 1, placed: false },
            { id: '2x1', shape: [[1], [1]], colorIdx: 2, placed: false }
        ];
        const hints = computeHints(grid, dock, 3);
        expect(hints.length).toBeGreaterThan(0);
        const topHint = hints[0];
        expect(topHint.scores.clearScore).toBeGreaterThan(0);
    });

    it('each hint has an explain array', () => {
        const grid = new Grid(8);
        const dock = makeDock(grid);
        const hints = computeHints(grid, dock);
        for (const h of hints) {
            expect(Array.isArray(h.explain)).toBe(true);
            expect(h.explain.length).toBeGreaterThan(0);
        }
    });
});
