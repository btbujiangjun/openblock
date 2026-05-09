/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { getShapeById } from '../web/src/shapes.js';
import { validateSpawnTriplet } from '../web/src/bot/blockSpawn.js';
import {
    buildSpawnModelContext,
    computeSpawnTargetDifficulty,
    getSpawnMode,
    normalizeSpawnMode,
    predictShapesV3,
    setSpawnMode,
    shapeIdsToHistoryRow,
    SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM,
    SPAWN_MODEL_CONTEXT_DIM,
    SPAWN_MODEL_V3_VERSION,
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
        expect(ctx.context).toHaveLength(SPAWN_MODEL_CONTEXT_DIM);
        expect(ctx.behaviorContext).toHaveLength(SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM);
        expect(ctx.behaviorContext[24]).toBe(1);
        expect(ctx.playstyle).toBe('perfect_hunter');
        expect(ctx.hints.clearGuarantee).toBe(2);
        expect(ctx.topology.fillRatio).toBeGreaterThan(0);
        expect(ctx.ability.skillScore).toBeGreaterThanOrEqual(0);
        expect(ctx.targetDifficulty).toBeGreaterThanOrEqual(0);
        expect(ctx.targetDifficulty).toBeLessThanOrEqual(1);
    });

    it('treats higher adaptive stress as higher model target difficulty unless board risk asks for relief', () => {
        const profile = makeProfile({ skillLevel: 0.6, frustrationLevel: 0 });
        const low = computeSpawnTargetDifficulty(profile, { stress: 0.1, fillRatio: 0.35 });
        const high = computeSpawnTargetDifficulty(profile, { stress: 0.8, fillRatio: 0.35 });
        const risky = computeSpawnTargetDifficulty(profile, {
            stress: 0.8,
            fillRatio: 0.65,
            stressBreakdown: { boardRisk: 0.9 }
        });
        expect(high).toBeGreaterThan(low);
        expect(risky).toBeLessThan(high);
    });

    it('treats more holes as higher board difficulty at the same fill', () => {
        const profile = makeProfile({ skillLevel: 0.6, frustrationLevel: 0 });
        const clean = computeSpawnTargetDifficulty(profile, { stress: 0.3 }, {
            fillRatio: 0.35,
            holes: 0,
            close1: 0,
            close2: 0
        });
        const holey = computeSpawnTargetDifficulty(profile, { stress: 0.3 }, {
            fillRatio: 0.35,
            holes: 5,
            close1: 0,
            close2: 0
        });
        expect(holey).toBeGreaterThan(clean);
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
                modelVersion: SPAWN_MODEL_V3_VERSION,
                personalized: true,
                feasibleCount: 12,
                behaviorContextDim: SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM,
            }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const grid = new Grid(8);
        const result = await predictShapesV3(grid, makeProfile(), null, { stress: 0.1 });
        const request = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(request.behaviorContext).toHaveLength(SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM);
        expect(request.context).toHaveLength(SPAWN_MODEL_CONTEXT_DIM);
        expect(result.shapes.map((s) => s.id)).toEqual(['2x2', '1x4', '4x1']);
        expect(result.meta.modelVersion).toBe(SPAWN_MODEL_V3_VERSION);
        expect(result.meta.personalized).toBe(true);
        expect(result.meta.feasibleCount).toBe(12);
        expect(result.meta.behaviorContextDim).toBe(SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM);
    });

    it('rejects invalid V3 triplets so the game can fall back to rule spawn', () => {
        const grid = new Grid(8);
        const duplicateTriplet = [getShapeById('2x2'), getShapeById('2x2'), getShapeById('1x4')];
        expect(validateSpawnTriplet(grid, duplicateTriplet)).toEqual({ ok: false, reason: 'duplicate-shape' });
    });
});
