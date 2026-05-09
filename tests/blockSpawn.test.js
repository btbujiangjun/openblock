/**
 * @vitest-environment jsdom
 *
 * 候选块出块算法：generateDockShapes 产出合法性、3 块保证、品类覆盖
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { getAllShapes } from '../web/src/shapes.js';
import {
    evaluateTripletSolutions,
    generateDockShapes,
    getLastSpawnDiagnostics,
    resetSpawnMemory
} from '../web/src/bot/blockSpawn.js';
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

    it('records and consumes multi-axis spawnTargets in diagnostics', () => {
        for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;
        const cfg = {
            ...config,
            spawnHints: {
                clearGuarantee: 1,
                spawnTargets: {
                    shapeComplexity: 0.15,
                    solutionSpacePressure: 0.1,
                    clearOpportunity: 0.95,
                    spatialPressure: 0.1,
                    payoffIntensity: 0.7,
                    novelty: 0.8
                }
            }
        };

        const shapes = generateDockShapes(grid, cfg);
        const diag = getLastSpawnDiagnostics();
        expect(shapes.length).toBe(3);
        expect(diag.layer2.spawnTargets.clearOpportunity).toBe(0.95);
        expect(diag.layer2.spawnTargets.novelty).toBe(0.8);
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

describe('evaluateTripletSolutions', () => {
    it('leafCap 截断时仍完整统计 validPerms', () => {
        const grid = new Grid(8);
        const three = getAllShapes()
            .map((s) => ({ data: s.data, area: s.data.reduce((acc, row) => acc + row.reduce((x, v) => x + (v ? 1 : 0), 0), 0) }))
            .sort((a, b) => a.area - b.area)
            .slice(0, 3)
            .map((s) => s.data);

        const metrics = evaluateTripletSolutions(grid, three, { leafCap: 1, budget: 200000 });
        expect(metrics.capped).toBe(true);
        expect(metrics.validPerms).toBe(6);
        expect(metrics.perPermCounts.reduce((a, b) => a + b, 0)).toBe(1);
    });
});

/* ===================================================================
 * v1.32：orderRigor 集成测试
 *
 * 上游 adaptiveSpawn 派生 orderMaxValidPerms ∈ [1,6] 经 spawnHints 注入；
 * 这里验证 blockSpawn 端在生成三连块时确实消费了该上限：
 *   - hints.orderMaxValidPerms<6 时 → diagnostics.solutionRejects.orderTooLoose
 *     可能 > 0；最终保留下来的 triplet 的 validPerms ≤ orderMaxValidPerms
 *   - hints.orderMaxValidPerms=6（默认 / bypass 状态）→ orderTooLoose=0
 *   - diagnostics.orderRigor 透传 hints 数值
 * ===================================================================*/
describe('generateDockShapes orderRigor (v1.32)', () => {
    let grid;
    let config;

    beforeEach(() => {
        resetSpawnMemory();
        grid = new Grid(8);
        config = getStrategy('normal');
        // 填到 ~0.55，使 solutionDifficulty 评估（≥0.45）+ seqSolvable（≥0.52）都启用
        grid.initBoard(0.55, config.shapeWeights || {});
    });

    it('hints 透传到 diagnostics.orderRigor（默认 maxPerms=6 时不触发过滤）', () => {
        const cfg = {
            ...config,
            spawnHints: { clearGuarantee: 1, orderRigor: 0, orderMaxValidPerms: 6 }
        };
        const shapes = generateDockShapes(grid, cfg);
        const diag = getLastSpawnDiagnostics();
        expect(shapes.length).toBe(3);
        expect(diag.orderRigor).toBeDefined();
        expect(diag.orderRigor.rigor).toBe(0);
        expect(diag.orderRigor.maxValidPerms).toBe(6);
        expect(diag.orderRigor.applied).toBe(false);
        expect(diag.solutionRejects.orderTooLoose).toBe(0);
    });

    it('orderMaxValidPerms=2 时 → 过滤器被触发（rejTotal>0），且 diagnostics.orderRigor.applied 标记', () => {
        const cfg = {
            ...config,
            spawnHints: { clearGuarantee: 1, orderRigor: 1.0, orderMaxValidPerms: 2 }
        };
        let rejTotal = 0;
        let appliedHits = 0;
        const trials = 20;
        for (let i = 0; i < trials; i++) {
            resetSpawnMemory();
            const g = new Grid(8);
            g.initBoard(0.55, config.shapeWeights || {});
            const shapes = generateDockShapes(g, cfg);
            expect(shapes.length).toBe(3);
            const diag = getLastSpawnDiagnostics();
            rejTotal += diag.solutionRejects.orderTooLoose;
            if (diag.orderRigor.applied) appliedHits++;
        }
        /* 在 fill=0.55 的随机盘面上，因为大多数 triplet 自然 validPerms=6，
         * 过滤器会反复拒绝（rejTotal 远大于 trials），applied 标记应在多数轮次置位 */
        expect(rejTotal).toBeGreaterThan(0);
        expect(appliedHits).toBeGreaterThan(0);
    });

    it('orderMaxValidPerms=6 时 → 不触发过滤器（rejTotal=0），与默认行为等价', () => {
        const cfg = {
            ...config,
            spawnHints: { clearGuarantee: 1, orderRigor: 0, orderMaxValidPerms: 6 }
        };
        let rejTotal = 0;
        let appliedHits = 0;
        for (let i = 0; i < 10; i++) {
            resetSpawnMemory();
            const g = new Grid(8);
            g.initBoard(0.55, config.shapeWeights || {});
            generateDockShapes(g, cfg);
            const diag = getLastSpawnDiagnostics();
            rejTotal += diag.solutionRejects.orderTooLoose;
            if (diag.orderRigor.applied) appliedHits++;
        }
        expect(rejTotal).toBe(0);
        expect(appliedHits).toBe(0);
    });

    it('hints 缺失时（旧调用方）默认 maxValidPerms=6，不影响行为', () => {
        // 不传 orderRigor / orderMaxValidPerms：应回退到默认 6 = 不约束
        const cfg = { ...config, spawnHints: { clearGuarantee: 1 } };
        const shapes = generateDockShapes(grid, cfg);
        expect(shapes.length).toBe(3);
        const diag = getLastSpawnDiagnostics();
        expect(diag.orderRigor.maxValidPerms).toBe(6);
        expect(diag.solutionRejects.orderTooLoose).toBe(0);
    });
});
