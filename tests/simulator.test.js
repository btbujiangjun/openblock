/**
 * @vitest-environment jsdom
 *
 * OpenBlockSimulator：reset / step / getLegalActions / isTerminal / scoring
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenBlockSimulator, boardPotential } from '../web/src/bot/simulator.js';

describe('OpenBlockSimulator', () => {
    let sim;
    beforeEach(() => { sim = new OpenBlockSimulator('normal'); });

    describe('reset', () => {
        it('initializes with score 0', () => {
            expect(sim.score).toBe(0);
        });

        it('grid is initialized', () => {
            expect(sim.grid).toBeDefined();
            expect(sim.grid.size).toBeGreaterThanOrEqual(8);
        });

        it('dock has 3 blocks, all unplaced', () => {
            expect(sim.dock.length).toBe(3);
            for (const b of sim.dock) {
                expect(b.placed).toBe(false);
                expect(Array.isArray(b.shape)).toBe(true);
            }
        });

        it('steps starts at 0', () => {
            expect(sim.steps).toBe(0);
        });
    });

    describe('getLegalActions', () => {
        it('returns non-empty on fresh board', () => {
            const actions = sim.getLegalActions();
            expect(actions.length).toBeGreaterThan(0);
        });

        it('each action has blockIdx, gx, gy', () => {
            for (const a of sim.getLegalActions()) {
                expect(typeof a.blockIdx).toBe('number');
                expect(typeof a.gx).toBe('number');
                expect(typeof a.gy).toBe('number');
            }
        });

        it('every action is a valid placement', () => {
            for (const a of sim.getLegalActions()) {
                const b = sim.dock[a.blockIdx];
                expect(sim.grid.canPlace(b.shape, a.gx, a.gy)).toBe(true);
            }
        });
    });

    describe('step', () => {
        it('increments steps counter', () => {
            const action = sim.getLegalActions()[0];
            sim.step(action.blockIdx, action.gx, action.gy);
            expect(sim.steps).toBe(1);
        });

        it('marks block as placed', () => {
            const action = sim.getLegalActions()[0];
            sim.step(action.blockIdx, action.gx, action.gy);
            expect(sim.dock[action.blockIdx].placed).toBe(true);
        });

        it('returns a number (reward)', () => {
            const action = sim.getLegalActions()[0];
            const r = sim.step(action.blockIdx, action.gx, action.gy);
            expect(typeof r).toBe('number');
        });

        it('returns 0 for already-placed block', () => {
            const action = sim.getLegalActions()[0];
            sim.step(action.blockIdx, action.gx, action.gy);
            const r = sim.step(action.blockIdx, action.gx, action.gy);
            expect(r).toBe(0);
        });

        it('respawns dock when all 3 placed', () => {
            const actions = sim.getLegalActions();
            const placed = new Set();
            for (const a of actions) {
                if (placed.has(a.blockIdx)) continue;
                if (sim.dock[a.blockIdx].placed) continue;
                sim.step(a.blockIdx, a.gx, a.gy);
                placed.add(a.blockIdx);
                if (placed.size === 3) break;
            }
            if (placed.size === 3) {
                expect(sim.dock.some(b => !b.placed)).toBe(true);
            }
        });
    });

    describe('isTerminal', () => {
        it('fresh board is not terminal', () => {
            expect(sim.isTerminal()).toBe(false);
        });
    });

    describe('scoring integrity', () => {
        it('score never decreases during a game', () => {
            let prevScore = 0;
            for (let i = 0; i < 30; i++) {
                const actions = sim.getLegalActions();
                if (actions.length === 0 || sim.isTerminal()) break;
                const a = actions[Math.floor(Math.random() * actions.length)];
                sim.step(a.blockIdx, a.gx, a.gy);
                expect(sim.score).toBeGreaterThanOrEqual(prevScore);
                prevScore = sim.score;
            }
        });

        it('totalClears is non-negative', () => {
            for (let i = 0; i < 20; i++) {
                const actions = sim.getLegalActions();
                if (actions.length === 0) break;
                const a = actions[0];
                sim.step(a.blockIdx, a.gx, a.gy);
            }
            expect(sim.totalClears).toBeGreaterThanOrEqual(0);
        });
    });

    describe('countClearsIfPlaced', () => {
        it('returns >= 0 for any legal action', () => {
            for (const a of sim.getLegalActions().slice(0, 5)) {
                expect(sim.countClearsIfPlaced(a.blockIdx, a.gx, a.gy)).toBeGreaterThanOrEqual(0);
            }
        });

        it('does not mutate grid', () => {
            const before = JSON.stringify(sim.grid.toJSON());
            const a = sim.getLegalActions()[0];
            sim.countClearsIfPlaced(a.blockIdx, a.gx, a.gy);
            expect(JSON.stringify(sim.grid.toJSON())).toBe(before);
        });
    });

    describe('boardPotential', () => {
        it('returns a finite number', () => {
            const pot = boardPotential(sim.grid, sim.dock);
            expect(Number.isFinite(pot)).toBe(true);
        });
    });

    describe('full game simulation', () => {
        it('can run a complete game until terminal', () => {
            let steps = 0;
            const maxSteps = 500;
            while (!sim.isTerminal() && steps < maxSteps) {
                const actions = sim.getLegalActions();
                if (actions.length === 0) break;
                const a = actions[Math.floor(Math.random() * actions.length)];
                sim.step(a.blockIdx, a.gx, a.gy);
                steps++;
            }
            expect(steps).toBeGreaterThan(0);
            expect(sim.score).toBeGreaterThanOrEqual(0);
        });
    });
});
