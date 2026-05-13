/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P1-1 — ε-greedy explorer 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    _resetExplorerForTests,
    createEpsilonGreedyExplorer,
    wrapWithExplorer,
} from '../web/src/monetization/explorer/epsilonGreedyExplorer.js';

beforeEach(() => _resetExplorerForTests());
afterEach(() => _resetExplorerForTests());

describe('createEpsilonGreedyExplorer', () => {
    it('随机 < ε → explore', () => {
        const explorer = createEpsilonGreedyExplorer({
            epsilon: 0.5,
            random: () => 0.0, // 强制 explore，再次 0 抽到第一个
        });
        const out = explorer.choose({ candidates: ['a', 'b', 'c'], optimal: 'b' });
        expect(out.mode).toBe('explore');
        expect(out.action).toBe('a');
        expect(out.exploredFrom).toBe('b');
    });

    it('随机 ≥ ε → exploit（返回 optimal）', () => {
        const explorer = createEpsilonGreedyExplorer({
            epsilon: 0.05,
            random: () => 0.99,
        });
        const out = explorer.choose({ candidates: ['a', 'b', 'c'], optimal: 'b' });
        expect(out.mode).toBe('exploit');
        expect(out.action).toBe('b');
    });

    it('propensity 反映 IPS 公式（exploit）', () => {
        const explorer = createEpsilonGreedyExplorer({
            epsilon: 0.1,
            random: () => 0.99,
        });
        const out = explorer.choose({ candidates: ['a', 'b', 'c'], optimal: 'a' });
        // (1 - 0.1) + 0.1/3 ≈ 0.933
        expect(out.propensity).toBeCloseTo(0.933, 2);
    });

    it('单用户超过冷却上限 → 不再 explore', () => {
        let n = 0;
        const explorer = createEpsilonGreedyExplorer({
            epsilon: 1.0,
            random: () => 0.0,
            userCapPerHour: 2,
            // userId 将 explore 计数 +1
        });
        const userId = 'u1';
        for (let i = 0; i < 5; i++) {
            const out = explorer.choose({ candidates: ['a', 'b'], optimal: 'a', userId });
            if (n < 2) {
                expect(out.mode).toBe('explore');
            } else {
                expect(out.mode).toBe('exploit');
            }
            n += 1;
        }
    });

    it('candidates 为空时 action=null', () => {
        const explorer = createEpsilonGreedyExplorer({});
        const out = explorer.choose({ candidates: [], optimal: null });
        expect(out.action).toBeNull();
    });
});

describe('wrapWithExplorer', () => {
    it('包装的 deterministic policy 返回值合并 explorer 决策', () => {
        const policy = () => ({ action: 'iap_offer', candidates: ['iap_offer', 'rewarded_ad', 'observe'], extra: 'preserved' });
        const wrapped = wrapWithExplorer(policy, { epsilon: 0.05, random: () => 0.99 });
        const out = wrapped({});
        expect(out.action).toBe('iap_offer');
        expect(out.mode).toBe('exploit');
        expect(out.extra).toBe('preserved');
    });

    it('内部 policy 抛错 → 返回安全默认', () => {
        const policy = () => { throw new Error('boom'); };
        const wrapped = wrapWithExplorer(policy, {});
        const out = wrapped({});
        expect(out.action).toBeNull();
    });
});
