/**
 * @vitest-environment jsdom
 *
 * v1.49.x P1-2 — adTrigger 流体验护栏
 *
 * 验证：
 *   - flowState='flow' + frustration<2 → _isInFlow=true → 拒绝插屏
 *   - pickToPlaceMs ≥ baseline*1.5 + reactionSamples ≥ 4 → _isCognitivelyFatigued=true
 *   - getAdGuardrailState 暴露护栏状态供 UI / 看板使用
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAdGuardrailState } from '../web/src/monetization/adTrigger.js';

beforeEach(() => {
    try { localStorage.clear(); } catch {}
});

afterEach(() => {
    try { localStorage.clear(); } catch {}
});

function makeProfileStub({
    flowState = null,
    frustrationLevel = 0,
    pickToPlaceMs = null,
    reactionSamples = 0,
} = {}) {
    return {
        flowState,
        frustrationLevel,
        metrics: {
            pickToPlaceMs,
            reactionSamples,
            samples: 20,
            thinkMs: 2000,
        },
    };
}

describe('adTrigger — flow guardrail', () => {
    it('flow + 低挫败 → inFlow=true', () => {
        const game = { playerProfile: makeProfileStub({ flowState: 'flow', frustrationLevel: 1 }) };
        const s = getAdGuardrailState(game);
        expect(s.inFlow).toBe(true);
        expect(s.flowState).toBe('flow');
    });

    it('anxious 不算 flow', () => {
        const game = { playerProfile: makeProfileStub({ flowState: 'anxious', frustrationLevel: 0 }) };
        expect(getAdGuardrailState(game).inFlow).toBe(false);
    });

    it('flow 但挫败 ≥2 → 不算 flow（玩家其实有压力）', () => {
        const game = { playerProfile: makeProfileStub({ flowState: 'flow', frustrationLevel: 3 }) };
        expect(getAdGuardrailState(game).inFlow).toBe(false);
    });
});

describe('adTrigger — cognitive fatigue guardrail', () => {
    it('反应 ≥ baseline*1.5 + 样本 ≥4 → 疲劳', () => {
        const game = { playerProfile: makeProfileStub({ pickToPlaceMs: 2400, reactionSamples: 6 }) };
        const s = getAdGuardrailState(game);
        expect(s.cognitivelyFatigued).toBe(true);
    });

    it('反应快但样本不够 → 不算疲劳（保守）', () => {
        const game = { playerProfile: makeProfileStub({ pickToPlaceMs: 2400, reactionSamples: 3 }) };
        expect(getAdGuardrailState(game).cognitivelyFatigued).toBe(false);
    });

    it('反应正常 → 不算疲劳', () => {
        const game = { playerProfile: makeProfileStub({ pickToPlaceMs: 1200, reactionSamples: 10 }) };
        expect(getAdGuardrailState(game).cognitivelyFatigued).toBe(false);
    });

    it('无 profile → 全部 false（不阻拦广告，向后兼容）', () => {
        expect(getAdGuardrailState({}).cognitivelyFatigued).toBe(false);
        expect(getAdGuardrailState({}).inFlow).toBe(false);
    });
});
