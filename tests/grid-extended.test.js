/**
 * @vitest-environment jsdom
 *
 * Grid 补充测试：覆盖 clone / toJSON / fromJSON / canPlaceAnywhere /
 * countValidPlacements / wouldClear / getFillRatio / initBoard / findGapPositions
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../web/src/grid.js';

describe('Grid extended', () => {
    let grid;
    beforeEach(() => { grid = new Grid(8); });

    describe('clone', () => {
        it('deep copies cells so mutations are independent', () => {
            grid.place([[1, 1]], 3, 0, 0);
            const copy = grid.clone();
            expect(copy.cells[0][0]).toBe(3);
            copy.cells[0][0] = null;
            expect(grid.cells[0][0]).toBe(3);
        });
    });

    describe('toJSON / fromJSON', () => {
        it('round-trips preserving size and cell values', () => {
            grid.place([[1]], 5, 2, 3);
            const json = grid.toJSON();
            expect(json.size).toBe(8);
            expect(json.cells[3][2]).toBe(5);

            const g2 = new Grid(1);
            g2.fromJSON(json);
            expect(g2.size).toBe(8);
            expect(g2.cells[3][2]).toBe(5);
            expect(g2.cells[0][0]).toBeNull();
        });

        it('toJSON cells are shallow copies (no shared references)', () => {
            const json = grid.toJSON();
            json.cells[0][0] = 99;
            expect(grid.cells[0][0]).toBeNull();
        });
    });

    describe('canPlaceAnywhere', () => {
        it('returns true on empty board for any small shape', () => {
            expect(grid.canPlaceAnywhere([[1]])).toBe(true);
            expect(grid.canPlaceAnywhere([[1, 1, 1, 1]])).toBe(true);
        });

        it('returns false when no space left', () => {
            for (let y = 0; y < 8; y++)
                for (let x = 0; x < 8; x++)
                    grid.cells[y][x] = 0;
            expect(grid.canPlaceAnywhere([[1]])).toBe(false);
        });
    });

    describe('countValidPlacements', () => {
        it('1x1 on empty 8x8 = 64', () => {
            expect(grid.countValidPlacements([[1]])).toBe(64);
        });

        it('1x4 on empty 8x8 = 8*5 = 40', () => {
            expect(grid.countValidPlacements([[1, 1, 1, 1]])).toBe(8 * 5);
        });

        it('placement count decreases after placing blocks', () => {
            const before = grid.countValidPlacements([[1, 1]]);
            grid.place([[1, 1]], 0, 0, 0);
            const after = grid.countValidPlacements([[1, 1]]);
            expect(after).toBeLessThan(before);
        });
    });

    describe('wouldClear', () => {
        it('returns true when placing completes a row', () => {
            for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;
            expect(grid.wouldClear([[1]], 7, 0)).toBe(true);
        });

        it('returns false when placing does not complete any line', () => {
            expect(grid.wouldClear([[1]], 0, 0)).toBe(false);
        });

        it('does not mutate original grid', () => {
            for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;
            grid.wouldClear([[1]], 7, 0);
            expect(grid.cells[0][7]).toBeNull();
        });
    });

    describe('getFillRatio', () => {
        it('empty board = 0', () => {
            expect(grid.getFillRatio()).toBe(0);
        });

        it('full board = 1', () => {
            for (let y = 0; y < 8; y++)
                for (let x = 0; x < 8; x++)
                    grid.cells[y][x] = 1;
            expect(grid.getFillRatio()).toBe(1);
        });

        it('partial fill returns correct ratio', () => {
            grid.place([[1, 1, 1, 1]], 0, 0, 0);
            expect(grid.getFillRatio()).toBeCloseTo(4 / 64, 6);
        });
    });

    describe('initBoard', () => {
        it('fills approximately to requested ratio', () => {
            grid.initBoard(0.3, {});
            const fill = grid.getFillRatio();
            expect(fill).toBeGreaterThan(0);
            expect(fill).toBeLessThanOrEqual(0.55);
        });

        it('does not produce any full rows or columns (no would-clear)', () => {
            for (let trial = 0; trial < 5; trial++) {
                grid.clear();
                grid.initBoard(0.25, {});
                const result = grid.checkLines();
                expect(result.count).toBe(0);
            }
        });
    });

    describe('findGapPositions', () => {
        it('detects row with 1 empty cell as gap', () => {
            for (let x = 0; x < 7; x++) grid.cells[2][x] = 0;
            const gaps = grid.findGapPositions();
            const rowGap = gaps.find(g => g.type === 'row' && g.y === 2);
            expect(rowGap).toBeDefined();
            expect(rowGap.empty).toBe(1);
        });

        it('returns empty array on empty board', () => {
            expect(grid.findGapPositions().length).toBe(0);
        });
    });

    describe('previewClearOutcome', () => {
        it('returns null for invalid placement', () => {
            for (let y = 0; y < 8; y++)
                for (let x = 0; x < 8; x++)
                    grid.cells[y][x] = 0;
            expect(grid.previewClearOutcome([[1]], 0, 0, 0)).toBeNull();
        });

        it('correctly previews row + column clear', () => {
            for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;
            for (let y = 1; y < 8; y++) grid.cells[y][7] = 0;
            const result = grid.previewClearOutcome([[1]], 7, 0, 1);
            expect(result).not.toBeNull();
            expect(result.rows).toContain(0);
            expect(result.cols).toContain(7);
        });

        it('does not mutate the grid', () => {
            for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;
            grid.previewClearOutcome([[1]], 7, 0, 1);
            expect(grid.cells[0][7]).toBeNull();
        });
    });

    describe('shapeCenterOnBoard', () => {
        it('single cell at (0,0) center = (0.5, 0.5)', () => {
            const c = Grid.shapeCenterOnBoard([[1]], 0, 0);
            expect(c.x).toBeCloseTo(0.5);
            expect(c.y).toBeCloseTo(0.5);
        });

        it('2x2 at (3,3) center = (4, 4)', () => {
            const c = Grid.shapeCenterOnBoard([[1, 1], [1, 1]], 3, 3);
            expect(c.x).toBeCloseTo(4);
            expect(c.y).toBeCloseTo(4);
        });
    });

    describe('pickSmartHoverPlacement', () => {
        it('prefers a nearby clearing placement over the nearest non-clearing hover point', () => {
            for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;

            const best = grid.pickSmartHoverPlacement([[1]], 7.5, 1.5, 7, 1, 2, {
                colorIdx: 1,
                clearLineBonus: 0.9,
                clearCellBonus: 0.015,
                clearAssistWindow: 1.35,
            });

            expect(best).toEqual({ x: 7, y: 0 });
        });

        it('does not jump to a clearing placement that is too far from the hover point', () => {
            for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;

            const best = grid.pickSmartHoverPlacement([[1]], 7.5, 3.5, 7, 3, 3, {
                colorIdx: 1,
                clearLineBonus: 0.9,
                clearCellBonus: 0.015,
                clearAssistWindow: 1.35,
            });

            expect(best).toEqual({ x: 7, y: 3 });
        });

        it('keeps the previous preview point when hovering near a cell boundary', () => {
            const best = grid.pickSmartHoverPlacement([[1]], 3.01, 2.5, 3, 2, 2, {
                previous: { x: 2, y: 2 },
                stickyBonus: 0.32,
                stickyWindow: 0.75,
            });

            expect(best).toEqual({ x: 2, y: 2 });
        });
    });
});
