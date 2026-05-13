/**
 * @vitest-environment jsdom
 *
 * v1.49.x P3-2 — adInsertionRL scaffolding 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    AD_INSERTION_SCENES,
    _resetAdInsertionPolicyForTests,
    buildAdInsertionState,
    computeAdInsertionReward,
    selectAdInsertionAction,
    setAdInsertionPolicy,
} from '../web/src/monetization/ad/adInsertionRL.js';

beforeEach(() => {
    _resetAdInsertionPolicyForTests();
});

afterEach(() => {
    _resetAdInsertionPolicyForTests();
});

describe('buildAdInsertionState', () => {
    it('feature 长度恒定（15 标量 + scenes one-hot）', () => {
        const state = buildAdInsertionState({});
        expect(state.features.length).toBe(15 + AD_INSERTION_SCENES.length);
        expect(state.meta).toBeDefined();
    });

    it('scene one-hot 正确点亮', () => {
        const state = buildAdInsertionState({ scene: 'no_moves' });
        const onehot = state.features.slice(15);
        const idx = AD_INSERTION_SCENES.indexOf('no_moves');
        expect(onehot[idx]).toBe(1);
        expect(onehot.reduce((s, v) => s + v, 0)).toBe(1);
    });
});

describe('computeAdInsertionReward', () => {
    it('完播激励视频奖励正向 1.5', () => {
        expect(computeAdInsertionReward({ filled: true, rewarded: true })).toBeCloseTo(1.5, 5);
    });
    it('短期流失惩罚生效', () => {
        expect(computeAdInsertionReward({ filled: true, sessionAbandonAfter: true })).toBeCloseTo(-0.5, 5);
    });
});

describe('selectAdInsertionAction — 规则版默认', () => {
    it('高疲劳 → skip', () => {
        const state = buildAdInsertionState({
            commercialVector: { adFatigueRisk: 0.9, churnRisk: 0.1 },
            scene: 'game_over',
        });
        const r = selectAdInsertionAction(state);
        expect(r.action).toBe('skip');
        expect(r.reason).toMatch(/fatigue|churn/);
    });

    it('no_moves 场景 → rewarded 优先', () => {
        const state = buildAdInsertionState({
            commercialVector: { rewardedAdPropensity: 0.7, interstitialPropensity: 0.5 },
            scene: 'no_moves',
        });
        const r = selectAdInsertionAction(state);
        expect(r.action).toBe('rewarded');
    });

    it('注入 policy 时优先采用其结果', () => {
        setAdInsertionPolicy(() => ({ action: 'interstitial', score: 0.9, reason: 'mock' }));
        const state = buildAdInsertionState({ scene: 'game_over' });
        const r = selectAdInsertionAction(state);
        expect(r.action).toBe('interstitial');
        expect(r.reason).toBe('mock');
    });
});
