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

    it('fetch 使用 cache:no-cache (避免 dashboard 重新部署后客户端吃浏览器旧缓存)', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                format: 'openblock-spawn-tuning-v2-bundle',
                policies: [makePolicy('easy:budget-p2:random:500:growth')],
                rollout_pct: 100,
            }),
        });
        globalThis.fetch = fetchMock;
        await loadPoliciesFromBundleV2();
        expect(fetchMock).toHaveBeenCalledOnce();
        const [, init] = fetchMock.mock.calls[0];
        expect(init?.cache).toBe('no-cache');
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


// ─────────── 兼容老 bundle: theta 是 normalized 数组而非 dict ───────────

describe('theta shape 兼容性（老 bundle 是 9 元素 normalized 数组）', () => {
    it('数组 [0.5×9] 应按 THETA_KEYS 顺序反归一化为 dict 并覆盖 DEFAULT', () => {
        // 0.5 normalized = 各 ranges 的中点
        installPoliciesV2({
            policies: [{
                context_key: 'easy:budget-p2:random:500:growth',
                theta: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                predicted_curve: Array(20).fill(0.5),
            }],
            rollout_pct: 100,
        });
        const r = resolveThetaV2({
            difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
            pb_bin: 500, lifecycle_stage: 'growth',
        });
        expect(r.source).toBe('exact');
        // 验证关键 θ 字段被覆盖（不再是 DEFAULT_THETA_V2 的值）
        expect(r.theta.pbTensionCenter).toBeCloseTo(0.81, 2);  // (0.70+0.92)/2 = 0.81
        expect(r.theta.pbBrakeCenter).toBeCloseTo(1.065, 2);   // (0.98+1.15)/2 = 1.065
        expect(r.theta.temperature).toBeCloseTo(0.055, 3);     // (0.03+0.08)/2 = 0.055
        // 验证返回的 theta 不含 0/1/2... 等数字下标键（数组 spread 残留）
        expect(r.theta[0]).toBeUndefined();
        expect(r.theta[8]).toBeUndefined();
    });

    it('数组 [1×9] 边界 normalized=1 应映射到 ranges 上界', () => {
        installPoliciesV2({
            policies: [{
                context_key: 'easy:budget-p2:random:500:growth',
                theta: [1, 1, 1, 1, 1, 1, 1, 1, 1],
                predicted_curve: Array(20).fill(0.5),
            }],
            rollout_pct: 100,
        });
        const r = resolveThetaV2({
            difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
            pb_bin: 500, lifecycle_stage: 'growth',
        });
        expect(r.theta.pbTensionCenter).toBeCloseTo(0.92, 3);
        expect(r.theta.pbBrakeWidth).toBeCloseTo(0.12, 3);
    });

    it('dict 形式 theta 应原样保留，不被误反归一化', () => {
        installPoliciesV2({
            policies: [{
                context_key: 'easy:budget-p2:random:500:growth',
                theta: { pbTensionCenter: 0.85, temperature: 0.04 },
                predicted_curve: Array(20).fill(0.5),
            }],
            rollout_pct: 100,
        });
        const r = resolveThetaV2({
            difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
            pb_bin: 500, lifecycle_stage: 'growth',
        });
        expect(r.theta.pbTensionCenter).toBeCloseTo(0.85);
        expect(r.theta.temperature).toBeCloseTo(0.04);
        // 未提供的字段 fallback 到 DEFAULT_THETA_V2
        expect(r.theta.pbBrakeCenter).toBeCloseTo(DEFAULT_THETA_V2.pbBrakeCenter);
    });
});


// ─────────── install 完成事件（spawnModelPanel badge 同步用）───────────

describe('installPoliciesV2 异步通知', () => {
    it('install 成功后 dispatch openblock:spawn-param-tuner-installed 事件', () => {
        const listener = vi.fn();
        globalThis.window = globalThis.window || {};
        const handler = (e) => listener(e.detail);
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('openblock:spawn-param-tuner-installed', handler);
        }
        try {
            installPoliciesV2({
                policies: [makePolicy('easy:budget-p2:random:500:growth')],
                rollout_pct: 100,
                model_sha256: 'sha-test',
            });
            if (typeof window.addEventListener === 'function') {
                expect(listener).toHaveBeenCalledOnce();
                const detail = listener.mock.calls[0][0];
                expect(detail.installed).toBe(1);
                expect(detail.rollout_pct).toBe(100);
                expect(detail.model_sha).toBe('sha-test');
            }
        } finally {
            if (typeof window.removeEventListener === 'function') {
                window.removeEventListener('openblock:spawn-param-tuner-installed', handler);
            }
        }
    });
});
