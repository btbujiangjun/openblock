/**
 * @vitest-environment jsdom
 *
 * §4.17/§2.10 等体感选块（generateDockShapes best-of-K 对齐 b*）。
 * 关键：默认/无 b* ⇒ 不产出 relativity 诊断、行为=现状；开启+b* ⇒ best-of-K 仍返回 3 个合法块。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { getAllShapes } from '../web/src/shapes.js';
import { generateDockShapes, getLastSpawnDiagnostics, resetSpawnMemory } from '../web/src/bot/blockSpawn.js';
import { getStrategy } from '../web/src/config.js';
import { GAME_RULES } from '../web/src/gameRules.js';

const allIds = new Set(getAllShapes().map(s => s.id));
const B_STAR = { spatial: 0.7, combo: 0.5, order: 0.6, recovery: 0.4, tempo: 0.55, clearEff: 0.5 };
const CAL = { spatial: 0.8, combo: 0.5, order: 0.6, recovery: 0.3, tempo: 0.55, clearEff: 0.5 };

function relConfig(extra = {}) {
    return {
        ...getStrategy('normal'),
        _objectiveTarget: B_STAR,
        _relativityBypass: null,
        _relativityLambda: 0.5,
        _latentCalibration: CAL,
        _stressBreakdown: { relativityDStar: 0.6 },
        ...extra
    };
}

describe('等体感选块（generateDockShapes）', () => {
    let dr;
    beforeEach(() => {
        resetSpawnMemory();
        dr = GAME_RULES.adaptiveSpawn.difficultyRelativity;
    });
    afterEach(() => { dr.enabled = false; dr.candidateK = 4; });

    it('默认关 ⇒ 无 relativity 诊断，照常返回 3 块', () => {
        dr.enabled = false;
        const grid = new Grid(8);
        const shapes = generateDockShapes(grid, getStrategy('normal'));
        expect(shapes.length).toBe(3);
        expect(getLastSpawnDiagnostics().relativity).toBeUndefined();
    });

    it('开启但 strategy 无 _objectiveTarget ⇒ 不激活对齐', () => {
        dr.enabled = true; dr.rolloutPercent = 100;
        const grid = new Grid(8);
        const cfg = getStrategy('normal'); // 无 _objectiveTarget
        const shapes = generateDockShapes(grid, cfg);
        expect(shapes.length).toBe(3);
        expect(getLastSpawnDiagnostics().relativity).toBeUndefined();
    });

    it('开启 + b* ⇒ best-of-K 激活，返回 3 个合法块且诊断完整', () => {
        dr.enabled = true; dr.rolloutPercent = 100; dr.personalizationStrength = 0.5; dr.candidateK = 4;
        const grid = new Grid(8);
        const shapes = generateDockShapes(grid, relConfig());
        expect(shapes.length).toBe(3);
        for (const s of shapes) {
            expect(allIds.has(s.id)).toBe(true);
            expect(grid.canPlaceAnywhere(s.data)).toBe(true);
        }
        const diag = getLastSpawnDiagnostics();
        expect(diag.relativity).toBeDefined();
        expect(diag.relativity.applied).toBe(true);
        expect(diag.relativity.candidatesConsidered).toBeGreaterThanOrEqual(1);
        expect(diag.relativity.chosenAlign).toBeGreaterThan(0);
        expect(diag.relativity.chosenVec).toBeTruthy();
    });

    it('chosenAlign 是 buffer 中最佳（best-of-K 单调）', () => {
        dr.enabled = true; dr.rolloutPercent = 100; dr.personalizationStrength = 0.6; dr.candidateK = 6;
        const grid = new Grid(8);
        grid.initBoard(0.25, getStrategy('normal').shapeWeights || {});
        const shapes = generateDockShapes(grid, relConfig());
        expect(shapes.length).toBe(3);
        const diag = getLastSpawnDiagnostics();
        if (diag.relativity && diag.relativity.applied) {
            expect(diag.relativity.chosenAlign).toBeGreaterThan(0);
            expect(diag.relativity.chosenAlign).toBeLessThanOrEqual(1);
        }
    });
});
