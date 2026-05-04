/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { getShapeById } from '../web/src/shapes.js';
import { validateSpawnTriplet } from '../web/src/bot/blockSpawn.js';
import {
    buildSpawnModelContext,
    getSpawnMode,
    normalizeSpawnMode,
    predictShapesV3,
    setSpawnMode,
    shapeIdsToHistoryRow,
    SPAWN_MODE_MODEL_V3,
    SPAWN_MODE_RULE,
} from '../web/src/spawnModel.js';

function makeProfile(overrides = {}) {
    return {
        metrics: {},
        skillLevel: 0.5,
        momentum: 0,
        frustrationLevel: 0,
        cognitiveLoad: 0,
        engagementAPM: 8,
        flowDeviation: 0,
        flowState: 'flow',
        pacingPhase: 'tension',
        playstyle: 'balanced',
        ...overrides,
    };
}

function installLocalStorageStub() {
    const store = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => store.get(key) ?? null,
            setItem: (key, value) => { store.set(key, String(value)); },
            removeItem: (key) => { store.delete(key); },
            clear: () => { store.clear(); },
        },
    });
}

describe('spawnModel mode and V3 context', () => {
    beforeEach(() => {
        installLocalStorageStub();
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('normalizes legacy model mode to model-v3', () => {
        expect(normalizeSpawnMode('model')).toBe(SPAWN_MODE_MODEL_V3);
        expect(normalizeSpawnMode('model-v3')).toBe(SPAWN_MODE_MODEL_V3);
        expect(normalizeSpawnMode('unknown')).toBe(SPAWN_MODE_RULE);
    });

    it('stores model-v3 as the selected generative mode', () => {
        setSpawnMode('model');
        expect(getSpawnMode()).toBe(SPAWN_MODE_MODEL_V3);
        setSpawnMode('rule');
        expect(getSpawnMode()).toBe(SPAWN_MODE_RULE);
    });

    it('builds a shared context with board, ability, topology, playstyle and target difficulty', () => {
        const grid = new Grid(8);
        grid.cells[0][0] = 0;
        const ctx = buildSpawnModelContext(grid, makeProfile({ playstyle: 'perfect_hunter' }), {
            stress: 0.2,
            fillRatio: 0.1,
            spawnHints: { clearGuarantee: 2 },
        });
        expect(ctx.board[0][0]).toBe(1);
        expect(ctx.context).toHaveLength(24);
        expect(ctx.playstyle).toBe('perfect_hunter');
        expect(ctx.hints.clearGuarantee).toBe(2);
        expect(ctx.topology.fillRatio).toBeGreaterThan(0);
        expect(ctx.ability.skillScore).toBeGreaterThanOrEqual(0);
        expect(ctx.targetDifficulty).toBeGreaterThanOrEqual(0);
        expect(ctx.targetDifficulty).toBeLessThanOrEqual(1);
    });

    it('maps unknown history ids to a valid default instead of -1', () => {
        expect(shapeIdsToHistoryRow([{ id: '2x2' }, { id: 'unknown-shape' }])).toEqual([6, 0, 0]);
    });

    it('returns V3 shapes and meta from the predict API', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            text: async () => JSON.stringify({
                success: true,
                shapes: ['2x2', '1x4', '4x1'],
                modelVersion: 'v3',
                personalized: true,
                feasibleCount: 12,
            }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const grid = new Grid(8);
        const result = await predictShapesV3(grid, makeProfile(), null, { stress: 0.1 });
        expect(result.shapes.map((s) => s.id)).toEqual(['2x2', '1x4', '4x1']);
        expect(result.meta.modelVersion).toBe('v3');
        expect(result.meta.personalized).toBe(true);
        expect(result.meta.feasibleCount).toBe(12);
    });

    it('rejects invalid V3 triplets so the game can fall back to rule spawn', () => {
        const grid = new Grid(8);
        const duplicateTriplet = [getShapeById('2x2'), getShapeById('2x2'), getShapeById('1x4')];
        expect(validateSpawnTriplet(grid, duplicateTriplet)).toEqual({ ok: false, reason: 'duplicate-shape' });
    });
});
