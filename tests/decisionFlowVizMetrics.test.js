// @vitest-environment jsdom
/**
 * v1.67：DFV 指标口径回归 — pressurePhase spark、intent trace reason、clearGuarantee 归一化、constructed driver path。
 */
import { describe, it, expect } from 'vitest';
import { __dfvTestables } from '../web/src/decisionFlowViz.js';
import { resolveIntent } from '../web/src/derivation/intentResolver.js';

const {
    pressurePhaseToSpark,
    intentReasonFromResolved,
    DRIVER_NODE_PATHS,
    clearGuaranteeNorm,
} = __dfvTestables;

describe('decisionFlowViz v1.67 metrics', () => {
    it('pressurePhaseToSpark encodes low/mid/high', () => {
        expect(pressurePhaseToSpark('low')).toBe(0);
        expect(pressurePhaseToSpark('mid')).toBe(0.5);
        expect(pressurePhaseToSpark('high')).toBe(1);
        expect(Number.isNaN(pressurePhaseToSpark('unknown'))).toBe(true);
    });

    it('clearGuarantee norm uses max 2 (not 3)', () => {
        expect(clearGuaranteeNorm(2)).toBe(1);
        expect(clearGuaranteeNorm(1)).toBe(0.5);
    });

    it('intentReasonFromResolved returns winner reason from trace', () => {
        const resolved = resolveIntent({
            pbChasePressureActive: true,
            challengeBoost: 0.12,
            playerDistress: 0,
            geometry: { nearFullLines: 0, pcSetup: 0, boardFill: 0.6 },
        });
        expect(resolved.spawnIntent).toBe('pressure');
        expect(resolved.intent).toBe('pb_chase_pressure');
        const reason = intentReasonFromResolved(resolved);
        expect(reason).toContain('pbChasePressureActive');
        expect(reason).not.toBe('动量良好，可加压');
    });

    it('constructed driver key has explicit DRIVER_NODE_PATHS entry', () => {
        expect(DRIVER_NODE_PATHS.constructed).toBeDefined();
        expect(DRIVER_NODE_PATHS.constructed.strategy).toContain('clearGuarantee');
    });
});
