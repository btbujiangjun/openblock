/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 — commercialPolicy.decideAndRecord 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideAndRecord } from '../web/src/monetization/commercialPolicy.js';
import { _resetActionOutcomeForTests, getMatrix } from '../web/src/monetization/quality/actionOutcomeMatrix.js';
import { resetFlags, setFlag } from '../web/src/monetization/featureFlags.js';

beforeEach(() => {
    _resetActionOutcomeForTests();
    resetFlags();
    setFlag('actionOutcomeMatrix', true);
    setFlag('explorerEpsilonGreedy', false);
});

afterEach(() => {
    _resetActionOutcomeForTests();
    resetFlags();
});

describe('decideAndRecord', () => {
    it('默认（exploit）：返回 vector + action + 写入矩阵', () => {
        const out = decideAndRecord({
            persona: { whaleScore: 0.6, segment: 'dolphin' },
            realtime: { frustration: 1, flowState: 'flow' },
            adFreq: { experienceScore: 90 },
        });
        expect(out.vector).toBeDefined();
        expect(out.action).toBeDefined();
        expect(out.mode).toBe('exploit');
        expect(out.snapshotDigest).toBeTruthy();

        const m = getMatrix();
        expect(m.cells[out.action]?.recommended).toBeGreaterThanOrEqual(1);
    });

    it('explorer flag on：mode 可能为 explore', () => {
        setFlag('explorerEpsilonGreedy', true);
        let exploredAtLeastOnce = false;
        for (let i = 0; i < 100; i++) {
            const out = decideAndRecord({
                persona: { whaleScore: 0.5 },
                realtime: { frustration: 0 },
                adFreq: { experienceScore: 100 },
            });
            if (out.mode === 'explore') exploredAtLeastOnce = true;
        }
        // ε=0.05 + 100 次循环 → P(无 explore) ≈ 0.95^100 ≈ 0.6%；几乎肯定有 explore
        expect(exploredAtLeastOnce).toBe(true);
    });

    it('actionOutcomeMatrix flag off：不写入矩阵', () => {
        setFlag('actionOutcomeMatrix', false);
        decideAndRecord({
            persona: { whaleScore: 0.6 },
            realtime: { frustration: 0 },
        });
        const m = getMatrix();
        expect(Object.keys(m.cells).length).toBe(0);
    });
});
