/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { CONFIG, STRATEGIES, ACHIEVEMENTS, COLORS, ACHIEVEMENTS_BY_ID } from '../web/src/config.js';
import { SHAPES, getAllShapes } from '../web/src/shapes.js';

describe('Config', () => {
    it('should have valid GRID_SIZE', () => {
        expect(CONFIG.GRID_SIZE).toBe(9);
    });

    it('should have valid CELL_SIZE', () => {
        expect(CONFIG.CELL_SIZE).toBeGreaterThan(0);
    });

    it('should have valid COLORS array', () => {
        expect(COLORS.length).toBeGreaterThan(0);
        expect(COLORS[0]).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it('should have valid STRATEGIES', () => {
        expect(STRATEGIES.easy).toBeDefined();
        expect(STRATEGIES.normal).toBeDefined();
        expect(STRATEGIES.hard).toBeDefined();
        expect(STRATEGIES.easy.fillRatio).toBeLessThan(STRATEGIES.hard.fillRatio);
    });

    it('should have valid ACHIEVEMENTS', () => {
        expect(Object.keys(ACHIEVEMENTS).length).toBeGreaterThan(0);
        expect(ACHIEVEMENTS.firstClear).toHaveProperty('id');
        expect(ACHIEVEMENTS.firstClear).toHaveProperty('name');
    });

    it('should map ACHIEVEMENTS_BY_ID by stable id', () => {
        expect(ACHIEVEMENTS_BY_ID.first_clear).toEqual(ACHIEVEMENTS.firstClear);
        expect(ACHIEVEMENTS_BY_ID.score_100).toEqual(ACHIEVEMENTS.score100);
    });
});

describe('SHAPES', () => {
    it('should have lines and squares', () => {
        expect(SHAPES.lines).toBeDefined();
        expect(SHAPES.squares).toBeDefined();
    });

    it('should have valid shape data', () => {
        for (const shape of SHAPES.lines) {
            expect(shape.id).toBeDefined();
            expect(shape.data).toBeDefined();
            expect(Array.isArray(shape.data)).toBe(true);
            expect(shape.data.flat().some((c) => c === 1)).toBe(true);
        }
    });

    it('should combine all shapes', () => {
        const all = getAllShapes();
        const expected =
            SHAPES.lines.length +
            SHAPES.squares.length +
            SHAPES.tshapes.length +
            SHAPES.zshapes.length +
            SHAPES.lshapes.length +
            SHAPES.jshapes.length;
        expect(all.length).toBe(expected);
    });
});
