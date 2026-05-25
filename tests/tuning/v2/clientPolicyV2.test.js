/**
 * clientPolicyV2 测试 — 灰度切量 + 4 层 fallback。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    DEFAULT_THETA_V2, installPoliciesV2, uninstallPoliciesV2,
    resolveThetaV2, loadPoliciesFromBundleV2, initClientPolicyV2,
    hashUserToBucket, buildContextKeyV2, getStatsV2,
} from '../../../web/src/tuning/v2/clientPolicyV2.js';


// ─────────── Helpers ───────────

function makePolicy(ctxKey, thetaOverride = {}) {
    return {
        context_key: ctxKey,
        theta: { ...DEFAULT_THETA_V2, ...thetaOverride },
        predicted_curve: Array(20).fill(0.5),
    };
}

beforeEach(() => {
    uninstallPoliciesV2();
});


// ─────────── hashUserToBucket ───────────

describe('hashUserToBucket', () => {
    it('empty returns 50 (anonymous)', () => {
        expect(hashUserToBucket('')).toBe(50);
        expect(hashUserToBucket(null)).toBe(50);
    });

    it('same user → same bucket', () => {
        const u = 'user-12345';
        expect(hashUserToBucket(u)).toBe(hashUserToBucket(u));
    });

    it('different users → likely different buckets', () => {
        const buckets = new Set();
        for (let i = 0; i < 100; i++) buckets.add(hashUserToBucket(`user-${i}`));
        // 100 个用户至少分布到 30 个 bucket
        expect(buckets.size).toBeGreaterThan(30);
    });

    it('values in [0, 100)', () => {
        for (let i = 0; i < 50; i++) {
            const v = hashUserToBucket(`u-${i}`);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(100);
        }
    });
});


// ─────────── buildContextKeyV2 ───────────

describe('buildContextKeyV2', () => {
    it('5 部分 colon-joined', () => {
        expect(buildContextKeyV2({
            difficulty: 'hard', generator: 'budget-p2', bot_policy: 'survival',
            pb_bin: 4000, lifecycle_stage: 'mature',
        })).toBe('hard:budget-p2:survival:4000:mature');
    });

    it('缺失字段用默认值', () => {
        expect(buildContextKeyV2({})).toBe('normal:budget-p2:clear-greedy:1500:growth');
    });
});


// ─────────── installPoliciesV2 + resolveThetaV2 ───────────

describe('install + resolve (4-layer fallback)', () => {
    it('no policies → default + source=no-policies', () => {
        const r = resolveThetaV2({ difficulty: 'easy', pb_bin: 500 });
        expect(r.source).toBe('no-policies');
        expect(r.theta).toEqual(DEFAULT_THETA_V2);
    });

    it('exact match', () => {
        installPoliciesV2({
            policies: [
                makePolicy('easy:budget-p2:random:500:growth', { temperature: 0.99 }),
            ],
            rollout_pct: 100,
        });
        const r = resolveThetaV2({
            difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
            pb_bin: 500, lifecycle_stage: 'growth',
        });
        expect(r.source).toBe('exact');
        expect(r.theta.temperature).toBeCloseTo(0.99);
    });

    it('fuzzy lifecycle fallback', () => {
        installPoliciesV2({
            policies: [
                makePolicy('easy:budget-p2:random:500:growth'),
            ],
            rollout_pct: 100,
        });
        const r = resolveThetaV2({
            difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
            pb_bin: 500, lifecycle_stage: 'plateau',  // 不同 lifecycle
        });
        expect(r.source).toBe('fuzzy-lifecycle');
    });

    it('coarse fallback (仅 difficulty+generator)', () => {
        installPoliciesV2({
            policies: [
                makePolicy('hard:budget-p2:random:500:growth'),
            ],
            rollout_pct: 100,
        });
        const r = resolveThetaV2({
            difficulty: 'hard', generator: 'budget-p2',
            bot_policy: 'survival',  // 不同 bot
            pb_bin: 25000,           // 不同 pb_bin
            lifecycle_stage: 'plateau',
        });
        expect(r.source).toBe('coarse-gen');
    });

    it('fully fallback when no match', () => {
        installPoliciesV2({
            policies: [makePolicy('easy:budget-p2:random:500:growth')],
            rollout_pct: 100,
        });
        const r = resolveThetaV2({
            difficulty: 'hard', generator: 'triplet-p1',
            bot_policy: 'survival', pb_bin: 25000, lifecycle_stage: 'plateau',
        });
        expect(r.source).toBe('fallback');
        expect(r.theta).toEqual(DEFAULT_THETA_V2);
    });
});


// ─────────── 灰度切量 (rollout_pct) ───────────

describe('灰度切量', () => {
    it('rollout_pct=100 → 全部走 v2', () => {
        installPoliciesV2({
            policies: [makePolicy('easy:budget-p2:random:500:growth')],
            rollout_pct: 100,
        });
        let hits = 0;
        for (let i = 0; i < 100; i++) {
            const r = resolveThetaV2({
                difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
                pb_bin: 500, lifecycle_stage: 'growth', userId: `u-${i}`,
            });
            if (r.source === 'exact') hits++;
        }
        expect(hits).toBe(100);
    });

    it('rollout_pct=0 → 全部 gate-out', () => {
        installPoliciesV2({
            policies: [makePolicy('easy:budget-p2:random:500:growth')],
            rollout_pct: 0,
        });
        let gateOut = 0;
        for (let i = 0; i < 100; i++) {
            const r = resolveThetaV2({
                difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
                pb_bin: 500, lifecycle_stage: 'growth', userId: `u-${i}`,
            });
            if (r.source === 'gate-out') gateOut++;
        }
        expect(gateOut).toBe(100);
    });

    it('rollout_pct=50 → 大致一半吃 v2', () => {
        installPoliciesV2({
            policies: [makePolicy('easy:budget-p2:random:500:growth')],
            rollout_pct: 50,
        });
        let hits = 0;
        for (let i = 0; i < 200; i++) {
            const r = resolveThetaV2({
                difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
                pb_bin: 500, lifecycle_stage: 'growth', userId: `u-${i}`,
            });
            if (r.source === 'exact') hits++;
        }
        // 期望 ~100, 容忍 ±40 (hash 分布不完全均匀)
        expect(hits).toBeGreaterThan(60);
        expect(hits).toBeLessThan(140);
    });

    it('same user → 灰度结果稳定', () => {
        installPoliciesV2({
            policies: [makePolicy('easy:budget-p2:random:500:growth')],
            rollout_pct: 30,
        });
        const r1 = resolveThetaV2({
            difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
            pb_bin: 500, lifecycle_stage: 'growth', userId: 'stable-user',
        });
        const r2 = resolveThetaV2({
            difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
            pb_bin: 500, lifecycle_stage: 'growth', userId: 'stable-user',
        });
        expect(r1.source).toBe(r2.source);
    });
});


// ─────────── Bundle 加载 ───────────

describe('loadPoliciesFromBundleV2', () => {
    it('successful bundle load', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                format: 'openblock-spawn-tuning-v2-bundle',
                policies: [makePolicy('easy:budget-p2:random:500:growth')],
                rollout_pct: 80,
                model_sha256: 'abc123',
                generated_at: 1234567890,
            }),
        });
        const r = await loadPoliciesFromBundleV2();
        expect(r.installed).toBe(1);
        expect(r.source).toBe('bundle');
        expect(getStatsV2().rollout_pct).toBe(80);
    });

    it('fetch fails → installed=0 + error', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
        const r = await loadPoliciesFromBundleV2();
        expect(r.installed).toBe(0);
        expect(r.error).toBeTruthy();
    });

    it('wrong format rejected', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ format: 'something-else' }),
        });
        const r = await loadPoliciesFromBundleV2();
        expect(r.installed).toBe(0);
        expect(r.error).toContain('unsupported bundle format');
    });
});


// ─────────── initClientPolicyV2 (小程序场景) ───────────

describe('initClientPolicyV2', () => {
    it('inline bundleData (小程序 require)', async () => {
        const r = await initClientPolicyV2({
            bundleData: {
                format: 'openblock-spawn-tuning-v2-bundle',
                policies: [makePolicy('hard:triplet-p1:survival:25000:mature')],
                rollout_pct: 100,
            },
        });
        expect(r.installed).toBe(1);
        expect(r.source).toBe('inline');
    });
});
