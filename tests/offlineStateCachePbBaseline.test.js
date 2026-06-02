/**
 * @vitest-environment jsdom
 *
 * v1.61.17：离线 hydrate 抬高 bestScore 时须同步 _bestScoreAtRunStart（准备态）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hydrateFromSpawnSignals } from '../web/src/offlineStateCache.js';

const STORAGE_KEY = 'openblock_spawn_signals_v1';

function installLocalStorageMock() {
    const bag = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => (bag.has(k) ? bag.get(k) : null),
        setItem: (k, v) => { bag.set(k, String(v)); },
        removeItem: (k) => { bag.delete(k); },
    });
}

describe('hydrateFromSpawnSignals — PB 基线同步', () => {
    beforeEach(() => {
        installLocalStorageMock();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ _v: 2, bestScore: 430 }));
    });

    it('准备态 hydrate 抬高 bestScore 时同步 _bestScoreAtRunStart', () => {
        const game = {
            score: 0,
            bestScore: 380,
            _bestScoreAtRunStart: 380,
            _spawnContext: { bestScore: 380 },
            playerProfile: {},
        };

        expect(hydrateFromSpawnSignals(game)).toBe(true);
        expect(game.bestScore).toBe(430);
        expect(game._bestScoreAtRunStart).toBe(430);
        expect(game._spawnContext.bestScore).toBe(430);
    });
});
