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

        /* v2.2 回归: options 覆盖默认曲线参数 */
        const defaultTension = derivePbCurve(800, 1000, false).pbTension;
        const customTension = derivePbCurve(800, 1000, false, {
            pbTensionCenter: 0.70, pbTensionWidth: 0.10,
        }).pbTension;
        // 拐点左移 → 800/1000=0.8 应当显著高于默认
        expect(customTension).toBeGreaterThan(defaultTension);

        /* v2.2: 非法 / 缺省 options 走 DEFAULT_SPAWN_PARAMS_PB_CURVE (跟无 options 等价) */
        const opt1 = derivePbCurve(900, 1000, false, { pbTensionCenter: NaN });
        const opt2 = derivePbCurve(900, 1000, false);
        expect(opt1.pbTension).toBe(opt2.pbTension);
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

