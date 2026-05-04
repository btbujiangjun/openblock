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
import { OpenBlockSimulator } from '../web/src/bot/simulator.js';
import { analyzeBoardTopology } from '../web/src/boardTopology.js';

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

    it('covered gaps are not holes when some shape can still fill them', () => {
        const g = new Grid(8);
        g.cells[0][0] = 1;
        // 传统列高口径会把下方空格都算作洞；OpenBlock 口径下，只要存在合法形状能覆盖就不算。
        expect(countHoles(g)).toBe(0);
        g.cells[2][0] = 1;
        expect(countHoles(g)).toBe(0);
    });

    it('isolated empty cell is a hole when no available shape can cover it', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                g.cells[y][x] = 1;
            }
        }
        g.cells[3][3] = null;
        expect(countHoles(g)).toBe(1);
    });

    it('2x2 empty pocket is not a hole because a square can cover it', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                g.cells[y][x] = 1;
            }
        }
        g.cells[3][3] = null;
        g.cells[3][4] = null;
        g.cells[4][3] = null;
        g.cells[4][4] = null;
        expect(countHoles(g)).toBe(0);
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
        const phi = extractActionFeatures(state, 0, 0, 0, [[1]], 0, 8, grid, dock, 0);
        expect(phi).toBeInstanceOf(Float32Array);
        expect(phi.length).toBe(PHI_DIM);
    });

    it('all values are finite', () => {
        const grid = new Grid(8);
        grid.initBoard(0.2, {});
        const dock = makeDock();
        const state = extractStateFeatures(grid, dock);
        const phi = extractActionFeatures(state, 0, 3, 3, [[1]], 0, 8, grid, dock, 0);
        for (let i = 0; i < phi.length; i++) {
            expect(Number.isFinite(phi[i])).toBe(true);
        }
    });

    it('encodes multi-clear, bonus-line, and perfect-clear payoff', () => {
        const grid = new Grid(8);
        for (let x = 1; x < 8; x++) grid.cells[0][x] = 2;
        for (let y = 1; y < 8; y++) grid.cells[y][0] = 2;
        const dock = [{ shape: [[1]], colorIdx: 2, placed: false }];
        const state = extractStateFeatures(grid, dock);
        const phi = extractActionFeatures(state, 0, 0, 0, [[1]], 2, 8, grid, dock, 2);
        const action = Array.from(phi.slice(STATE_FEATURE_DIM));
        expect(action).toHaveLength(ACTION_FEATURE_DIM);
        expect(action[12]).toBeGreaterThan(0); // multi-clear hint
        expect(action[13]).toBeGreaterThan(0); // same icon/color bonus hint
        expect(action[14]).toBe(1);            // perfect clear hint
    });
});

describe('buildDecisionBatch', () => {
    it('produces matching legal actions and phi vectors', () => {
        const sim = new OpenBlockSimulator('normal');
        const { legal, stateFeat, phiList } = buildDecisionBatch(sim);
        expect(legal.length).toBe(phiList.length);
        expect(stateFeat).toBeInstanceOf(Float32Array);
        expect(stateFeat.length).toBe(STATE_FEATURE_DIM);
        for (const phi of phiList) {
            expect(phi.length).toBe(PHI_DIM);
        }
    });

    it('legal actions are valid placements', () => {
        const sim = new OpenBlockSimulator('normal');
        const { legal } = buildDecisionBatch(sim);
        for (const a of legal) {
            expect(sim.grid.canPlace(sim.dock[a.blockIdx].shape, a.gx, a.gy)).toBe(true);
        }
    });
});

describe('topology supervision', () => {
    it('simulator exposes normalized topology targets', () => {
        const sim = new OpenBlockSimulator('normal');
        const sup = sim.getSupervisionSignals();
        expect(Array.isArray(sup.topology_after)).toBe(true);
        expect(sup.topology_after).toHaveLength(8);
        for (const v of sup.topology_after) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });

    it('near-full lines ignore unfillable empty cells', () => {
        const blocked = new Grid(8);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                blocked.cells[y][x] = 1;
            }
        }
        blocked.cells[3][3] = null;
        const blockedTopo = analyzeBoardTopology(blocked);
        expect(blockedTopo.holes).toBe(1);
        expect(blockedTopo.close1).toBe(0);
        expect(blockedTopo.nearFullLines).toBe(0);

        const fillable = new Grid(8);
        for (let x = 0; x < 7; x++) {
            fillable.cells[0][x] = 1;
        }
        const fillableTopo = analyzeBoardTopology(fillable);
        expect(fillableTopo.holes).toBe(0);
        expect(fillableTopo.close1).toBeGreaterThanOrEqual(1);
        expect(fillableTopo.nearFullLines).toBeGreaterThanOrEqual(1);
    });
});
