import { describe, it, expect } from 'vitest';
import {
    SPATIAL_PLANNING_FEATURE_DIM,
    shannonEntropy,
    scanEmptyRegions,
    spatialPlanningFeatures,
    computeVocabularyMobility,
    computeTopologyDelta,
    computeSpatialPlanning,
    computeSpatialPlanningScore
} from '../web/src/spatialPlanning.js';
import { Grid } from '../web/src/grid.js';
import parityCases from './fixtures/spatialPlanning.cases.json';

/** 由 0/1 矩阵构造 Grid（1=占用 → 非 null；0=空 → null）。 */
function gridFrom(rows) {
    const n = rows.length;
    const g = new Grid(n);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            g.cells[y][x] = rows[y][x] ? 1 : null;
        }
    }
    return g;
}

function emptyBoard(n = 8) {
    return gridFrom(Array.from({ length: n }, () => new Array(n).fill(0)));
}

describe('shannonEntropy', () => {
    it('均匀分布达到 ln(k)，单点为 0', () => {
        expect(shannonEntropy([0])).toBe(0);
        expect(shannonEntropy([5])).toBe(0);
        expect(shannonEntropy([1, 1, 1, 1])).toBeCloseTo(Math.log(4), 6);
        expect(shannonEntropy([1, 1, 1, 1], Math.log(4))).toBeCloseTo(1, 6);
    });
});

describe('scanEmptyRegions', () => {
    it('空盘为单一大区域', () => {
        const s = scanEmptyRegions(emptyBoard(8));
        expect(s.regionCount).toBe(1);
        expect(s.emptyCells).toBe(64);
        expect(s.maxSize).toBe(64);
        expect(s.smallCells).toBe(0);
    });

    it('满盘无空格', () => {
        const full = gridFrom(Array.from({ length: 4 }, () => new Array(4).fill(1)));
        const s = scanEmptyRegions(full);
        expect(s.regionCount).toBe(0);
        expect(s.emptyCells).toBe(0);
    });

    it('被切碎的小腔计入 smallCells', () => {
        // 4x4：用占用块把空格切成多个 ≤4 的小腔
        const rows = [
            [0, 1, 0, 1],
            [1, 1, 1, 1],
            [0, 1, 0, 1],
            [1, 1, 1, 1],
        ];
        const s = scanEmptyRegions(gridFrom(rows));
        expect(s.regionCount).toBe(4); // 四个孤立单格
        expect(s.emptyCells).toBe(4);
        expect(s.maxSize).toBe(1);
        expect(s.smallCells).toBe(4);
    });
});

describe('spatialPlanningFeatures', () => {
    it('固定 3 维且均在 [0,1]', () => {
        const f = spatialPlanningFeatures(emptyBoard(8));
        expect(f).toHaveLength(SPATIAL_PLANNING_FEATURE_DIM);
        for (const v of f) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
    });

    it('空盘：熵=0、largestRegionRatio=1、smallRatio=0', () => {
        const [regionEntropy, largestRegionRatio, smallRegionCellRatio] = spatialPlanningFeatures(emptyBoard(8));
        expect(regionEntropy).toBeCloseTo(0, 6);
        expect(largestRegionRatio).toBeCloseTo(1, 6);
        expect(smallRegionCellRatio).toBeCloseTo(0, 6);
    });

    it('碎片化盘面：熵升高、largestRegionRatio 下降、smallRatio=1', () => {
        const rows = [
            [0, 1, 0, 1],
            [1, 1, 1, 1],
            [0, 1, 0, 1],
            [1, 1, 1, 1],
        ];
        const [regionEntropy, largestRegionRatio, smallRegionCellRatio] = spatialPlanningFeatures(gridFrom(rows));
        expect(regionEntropy).toBeGreaterThan(0.9); // 4 个等大孤格 → 接近满熵
        expect(largestRegionRatio).toBeCloseTo(0.25, 6);
        expect(smallRegionCellRatio).toBeCloseTo(1, 6);
    });

    it('满盘返回全 0', () => {
        const full = gridFrom(Array.from({ length: 8 }, () => new Array(8).fill(1)));
        expect(spatialPlanningFeatures(full)).toEqual([0, 0, 0]);
    });
});

describe('computeVocabularyMobility', () => {
    it('空盘所有家族都可放，机动性接近 1', () => {
        const v = computeVocabularyMobility(emptyBoard(8));
        expect(v.vocabMobility).toBeGreaterThan(0.95);
        expect(v.familyCoverage).toBeCloseTo(1, 6);
        expect(v.largeShapeCompat).toBeCloseTo(1, 6);
        expect(v.optionEntropy).toBeGreaterThan(0);
        expect(v.totalShapes).toBeGreaterThan(0);
    });

    it('近满盘机动性显著下降', () => {
        // 仅留左上 2x2 空，其余占满 → 大块/长条无处可放
        const n = 8;
        const rows = Array.from({ length: n }, () => new Array(n).fill(1));
        rows[0][0] = 0; rows[0][1] = 0; rows[1][0] = 0; rows[1][1] = 0;
        const v = computeVocabularyMobility(gridFrom(rows));
        expect(v.vocabMobility).toBeLessThan(0.5);
        expect(v.largeShapeCompat).toBeLessThan(0.2);
    });
});

describe('computeTopologyDelta', () => {
    it('结构变糟 → 正损伤、保全下降', () => {
        const before = { holes: 0, enclosedVoidCells: 0, concaveCorners: 2, contiguousRegions: 1, rowTransitions: 4, colTransitions: 4, wells: 0 };
        const after = { holes: 2, enclosedVoidCells: 3, concaveCorners: 6, contiguousRegions: 4, rowTransitions: 10, colTransitions: 10, wells: 2 };
        const d = computeTopologyDelta(before, after);
        expect(d.rawDamage).toBeGreaterThan(0);
        expect(d.damage).toBeGreaterThan(0);
        expect(d.preservation).toBeLessThan(1);
    });

    it('结构改善（如消行回收）→ 负损伤、保全=1', () => {
        const before = { holes: 3, enclosedVoidCells: 4, concaveCorners: 8, contiguousRegions: 5, rowTransitions: 12, colTransitions: 12, wells: 3 };
        const after = { holes: 0, enclosedVoidCells: 0, concaveCorners: 2, contiguousRegions: 1, rowTransitions: 4, colTransitions: 4, wells: 0 };
        const d = computeTopologyDelta(before, after);
        expect(d.rawDamage).toBeLessThan(0);
        expect(d.preservation).toBeCloseTo(1, 6);
    });
});

describe('computeSpatialPlanning + score', () => {
    it('空盘画像各项健康', () => {
        const sp = computeSpatialPlanning(emptyBoard(8));
        expect(sp.regionCount).toBe(1);
        expect(sp.largestRegionRatio).toBeCloseTo(1, 6);
        expect(sp.vocabMobility).toBeGreaterThan(0.95);
        const score = computeSpatialPlanningScore({
            preservation: 1,
            vocabMobility: sp.vocabMobility,
            largestRegionRatio: sp.largestRegionRatio,
            smallRegionCellRatio: sp.smallRegionCellRatio,
            familyCoverage: sp.familyCoverage,
            optionEntropy: sp.optionEntropy
        });
        expect(score).toBeGreaterThan(0.7);
    });

    it('includeVocabulary=false 时跳过词表扫描', () => {
        const sp = computeSpatialPlanning(emptyBoard(8), { includeVocabulary: false });
        expect(sp.vocabMobility).toBeNull();
        expect(sp.regionEntropy).toBeCloseTo(0, 6);
    });
});

describe('spatialPlanning — 跨语言契约 fixture (cheap 3 维)', () => {
    for (const { name, rows, features } of parityCases) {
        it(`fixture: ${name}`, () => {
            const got = spatialPlanningFeatures(gridFrom(rows));
            expect(got).toHaveLength(SPATIAL_PLANNING_FEATURE_DIM);
            for (let i = 0; i < features.length; i++) {
                expect(got[i]).toBeCloseTo(features[i], 6);
            }
        });
    }
});
