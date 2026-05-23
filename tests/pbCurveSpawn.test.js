/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { resolveAdaptiveStrategy, derivePbCurve } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';

describe('PB 双 S 曲线出块接入', () => {
    it('derivePbCurve exposes tension/brake/release phases', () => {
        expect(derivePbCurve(950, 1000, false).pbPhase).toBe('gate');
        expect(derivePbCurve(1200, 1000, false).pbPhase).toBe('overshoot');
        expect(derivePbCurve(1005, 1000, true).pbRelease).toBe(1);
    });

    it('resolveAdaptiveStrategy emits pb curve diagnostics and hints', () => {
        const profile = new PlayerProfile();
        profile.recordNewGame();
        const layered = resolveAdaptiveStrategy('normal', profile, 980, 0, 0.42, {
            bestScore: 1000,
            totalRounds: 8,
            roundsSinceClear: 1,
        });
        expect(layered.spawnHints.pbCurve).toBeTruthy();
        expect(layered.spawnHints.pbPhase).toBe('gate');
        expect(layered._pbTension).toBeGreaterThan(0.5);
        expect(layered._spawnTargets).toBeTruthy();
    });
});

