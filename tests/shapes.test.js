/**
 * @vitest-environment jsdom
 *
 * 形状定义与查询：getShapeById / getShapesByCategory / getShapeCategory /
 * pickShapeByCategoryWeights 概率分布
 */
import { describe, it, expect } from 'vitest';
import {
    SHAPES,
    getAllShapes,
    getShapeById,
    getShapesByCategory,
    getShapeCategory,
    pickShapeByCategoryWeights
} from '../web/src/shapes.js';

describe('shapes', () => {
    const allShapes = getAllShapes();

    it('getAllShapes returns non-empty list with unique ids', () => {
        expect(allShapes.length).toBeGreaterThan(0);
        const ids = allShapes.map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every shape has valid data (2D array with at least one 1)', () => {
        for (const s of allShapes) {
            expect(Array.isArray(s.data)).toBe(true);
            expect(s.data.length).toBeGreaterThan(0);
            const hasCell = s.data.some(row => row.some(v => v === 1));
            expect(hasCell).toBe(true);
        }
    });

    describe('getShapeById', () => {
        it('finds every shape from the full list', () => {
            for (const s of allShapes) {
                expect(getShapeById(s.id)).toBe(s);
            }
        });

        it('returns null for unknown id', () => {
            expect(getShapeById('nonexistent_shape_xyz')).toBeNull();
        });
    });

    describe('getShapesByCategory', () => {
        it('returns non-empty array for each category in SHAPES', () => {
            for (const cat of Object.keys(SHAPES)) {
                expect(getShapesByCategory(cat).length).toBeGreaterThan(0);
            }
        });

        it('returns empty for unknown category', () => {
            expect(getShapesByCategory('nonexistent_cat')).toEqual([]);
        });
    });

    describe('getShapeCategory', () => {
        it('returns correct category for known shapes', () => {
            for (const cat of Object.keys(SHAPES)) {
                for (const s of SHAPES[cat]) {
                    expect(getShapeCategory(s.id)).toBe(cat);
                }
            }
        });

        it('defaults to squares for unknown id', () => {
            expect(getShapeCategory('xxx')).toBe('squares');
        });
    });

    describe('pickShapeByCategoryWeights', () => {
        it('always returns a shape from the full list', () => {
            for (let i = 0; i < 20; i++) {
                const s = pickShapeByCategoryWeights({});
                expect(s).not.toBeNull();
                expect(allShapes.some(a => a.id === s.id)).toBe(true);
            }
        });

        it('with extreme weight favors that category', () => {
            const cats = Object.keys(SHAPES);
            if (cats.length < 2) return;
            const target = cats[0];
            const weights = {};
            for (const c of cats) weights[c] = c === target ? 1000 : 0.001;

            let hitTarget = 0;
            const N = 50;
            for (let i = 0; i < N; i++) {
                const s = pickShapeByCategoryWeights(weights);
                if (getShapeCategory(s.id) === target) hitTarget++;
            }
            expect(hitTarget / N).toBeGreaterThan(0.85);
        });
    });
});
