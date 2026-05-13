/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P3-1 — LinUCB contextual bandit 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    _resetBanditForTests,
    buildBanditPolicyForAdInsertion,
    configureBandit,
    getBanditState,
    selectAction,
    updateBandit,
} from '../web/src/monetization/ml/contextualBandit.js';

beforeEach(() => _resetBanditForTests());
afterEach(() => _resetBanditForTests());

describe('selectAction', () => {
    it('冷启动：所有 action 等价（exploration 主导）', () => {
        const ctx = new Array(8).fill(0.5);
        const r = selectAction({ context: ctx, candidates: ['a', 'b', 'c'] });
        expect(['a', 'b', 'c']).toContain(r.action);
        expect(r.exploration).toBeGreaterThan(0);
    });

    it('updateBandit 后偏向高 reward action', () => {
        const ctx = [1, 1, 1, 1, 0, 0, 0, 0];
        // 让 'a' 在该 context 上获得高 reward
        for (let i = 0; i < 50; i++) {
            updateBandit('a', ctx, 1);
            updateBandit('b', ctx, -1);
        }
        const r = selectAction({ context: ctx, candidates: ['a', 'b'] });
        expect(r.action).toBe('a');
        expect(r.mean).toBeGreaterThan(0);
    });
});

describe('configureBandit', () => {
    it('修改 alpha 不重置 A/b', () => {
        const ctx = [1, 0, 0, 0, 0, 0, 0, 0];
        updateBandit('a', ctx, 1);
        configureBandit({ alpha: 0.1 });
        const state = getBanditState();
        expect(state.alpha).toBeCloseTo(0.1, 5);
        expect(state.A.a).toBeDefined();
    });

    it('修改 dim 重置 A/b（防 dim 不一致）', () => {
        updateBandit('a', [1, 0, 0, 0, 0, 0, 0, 0], 1);
        configureBandit({ dim: 4 });
        const state = getBanditState();
        expect(state.dim).toBe(4);
        expect(Object.keys(state.A).length).toBe(0);
    });
});

describe('buildBanditPolicyForAdInsertion', () => {
    it('返回 { type, exploreSignal }', () => {
        const policy = buildBanditPolicyForAdInsertion();
        const out = policy({ features: new Array(8).fill(0.5) });
        expect(['rewarded', 'interstitial', 'skip']).toContain(out.type);
    });
});
