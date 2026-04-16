/**
 * @vitest-environment jsdom
 *
 * RL 特征编码：维度校验、extractStateFeatures、extractActionFeatures、buildDecisionBatch
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    STATE_FEATURE_DIM,
    ACTION_FEATURE_DIM,
    PHI_DIM,
    countHoles,
    extractStateFeatures,
    extractActionFeatures,
    buildDecisionBatch
} from '../web/src/bot/features.js';
import { BlockBlastSimulator } from '../web/src/bot/simulator.js';

function makeDock() {
    return [
        { shape: [[1]], colorIdx: 0, placed: false },
        { shape: [[1, 1]], colorIdx: 1, placed: false },
        { shape: [[1], [1]], colorIdx: 2, placed: false }
    ];
}

describe('feature dimensions', () => {
    it('STATE_FEATURE_DIM is a positive integer', () => {
        expect(Number.isInteger(STATE_FEATURE_DIM)).toBe(true);
        expect(STATE_FEATURE_DIM).toBeGreaterThan(0);
    });

    it('ACTION_FEATURE_DIM is a positive integer', () => {
        expect(Number.isInteger(ACTION_FEATURE_DIM)).toBe(true);
        expect(ACTION_FEATURE_DIM).toBeGreaterThan(0);
    });

    it('PHI_DIM = STATE + ACTION', () => {
        expect(PHI_DIM).toBe(STATE_FEATURE_DIM + ACTION_FEATURE_DIM);
    });
});

describe('countHoles', () => {
    it('empty board has 0 holes', () => {
        expect(countHoles(new Grid(8))).toBe(0);
    });

    it('block with gap below counts as holes', () => {
        const g = new Grid(8);
        g.cells[0][0] = 1;
        // column 0: occupied at y=0, then empty y=1..7 → 7 holes
        expect(countHoles(g)).toBe(7);
        g.cells[2][0] = 1;
        // column 0: occupied at y=0, empty y=1 (1 hole), occupied y=2, empty y=3..7 (5 holes) → 6
        expect(countHoles(g)).toBe(6);
    });
});

describe('extractStateFeatures', () => {
    it('returns Float32Array of correct length', () => {
        const grid = new Grid(8);
        const dock = makeDock();
        const feat = extractStateFeatures(grid, dock);
        expect(feat).toBeInstanceOf(Float32Array);
        expect(feat.length).toBe(STATE_FEATURE_DIM);
    });

    it('all values are finite', () => {
        const grid = new Grid(8);
        grid.initBoard(0.3, {});
        const dock = makeDock();
        const feat = extractStateFeatures(grid, dock);
        for (let i = 0; i < feat.length; i++) {
            expect(Number.isFinite(feat[i])).toBe(true);
        }
    });

    it('fill ratio feature is 0 for empty board', () => {
        const grid = new Grid(8);
        const feat = extractStateFeatures(grid, makeDock());
        expect(feat[0]).toBe(0);
    });

    it('fill ratio feature is 1 for full board', () => {
        const grid = new Grid(8);
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid.cells[y][x] = 1;
        const feat = extractStateFeatures(grid, makeDock());
        expect(feat[0]).toBe(1);
    });
});

describe('extractActionFeatures', () => {
    it('returns Float32Array of PHI_DIM length', () => {
        const grid = new Grid(8);
        const dock = makeDock();
        const state = extractStateFeatures(grid, dock);
        const phi = extractActionFeatures(state, 0, 0, 0, [[1]], 0, 8, grid, dock);
        expect(phi).toBeInstanceOf(Float32Array);
        expect(phi.length).toBe(PHI_DIM);
    });

    it('all values are finite', () => {
        const grid = new Grid(8);
        grid.initBoard(0.2, {});
        const dock = makeDock();
        const state = extractStateFeatures(grid, dock);
        const phi = extractActionFeatures(state, 0, 3, 3, [[1]], 0, 8, grid, dock);
        for (let i = 0; i < phi.length; i++) {
            expect(Number.isFinite(phi[i])).toBe(true);
        }
    });
});

describe('buildDecisionBatch', () => {
    it('produces matching legal actions and phi vectors', () => {
        const sim = new BlockBlastSimulator('normal');
        const { legal, stateFeat, phiList } = buildDecisionBatch(sim);
        expect(legal.length).toBe(phiList.length);
        expect(stateFeat).toBeInstanceOf(Float32Array);
        expect(stateFeat.length).toBe(STATE_FEATURE_DIM);
        for (const phi of phiList) {
            expect(phi.length).toBe(PHI_DIM);
        }
    });

    it('legal actions are valid placements', () => {
        const sim = new BlockBlastSimulator('normal');
        const { legal } = buildDecisionBatch(sim);
        for (const a of legal) {
            expect(sim.grid.canPlace(sim.dock[a.blockIdx].shape, a.gx, a.gy)).toBe(true);
        }
    });
});
