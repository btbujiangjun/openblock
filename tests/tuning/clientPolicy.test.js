/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    DEFAULT_THETA,
    hashUserToBucket,
    installPolicies,
    uninstallPolicies,
    buildPlayerContextKey,
    resolveSpawnTheta,
    getPolicyStats,
    loadPoliciesFromServer,
} from '../../web/src/tuning/clientPolicy.js';

function mkPolicy(ctxKey, themeOverride = {}) {
    const [difficulty, generator, binStr, lifecycle_stage] = ctxKey.split(':');
    return {
        context_key: ctxKey,
        difficulty,
        generator,
        bestScore_bin: Number(binStr),
        lifecycle_stage,
        theta: { temperature: 0.05, personalizationStrength: 0.12, ...themeOverride },
        signature: 'mock-sig',
        expected_composite: 0.75,
    };
}

beforeEach(() => uninstallPolicies());

describe('clientPolicy — DEFAULT_THETA', () => {
    it('有 14 个字段', () => {
        expect(Object.keys(DEFAULT_THETA)).toHaveLength(14);
    });
});

describe('clientPolicy — hashUserToBucket', () => {
    it('同一 userId 哈希到同一桶', () => {
        expect(hashUserToBucket('user-abc')).toBe(hashUserToBucket('user-abc'));
    });

    it('不同 userId 大概率不同桶', () => {
        const buckets = new Set();
        for (let i = 0; i < 30; i++) buckets.add(hashUserToBucket(`user-${i}`));
        expect(buckets.size).toBeGreaterThan(10);  // 至少 10 个不同桶
    });

    it('落在 [0, 100)', () => {
        for (let i = 0; i < 100; i++) {
            const b = hashUserToBucket(`u${i}`);
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThan(100);
        }
    });

    it('空 userId 返回 50', () => {
        expect(hashUserToBucket('')).toBe(50);
        expect(hashUserToBucket(null)).toBe(50);
    });
});

describe('clientPolicy — install / uninstall', () => {
    it('install 后 stats 显示 loaded=true', () => {
        installPolicies([mkPolicy('normal:budget-p2:1500:growth')]);
        expect(getPolicyStats().loaded).toBe(true);
        expect(getPolicyStats().count).toBe(1);
    });

    it('uninstall 后 stats 显示 loaded=false', () => {
        installPolicies([mkPolicy('normal:budget-p2:1500:growth')]);
        uninstallPolicies();
        expect(getPolicyStats().loaded).toBe(false);
    });

    it('空 policies 不安装', () => {
        const r = installPolicies([]);
        expect(r.installed).toBe(0);
        expect(getPolicyStats().loaded).toBe(false);
    });
});

describe('clientPolicy — buildPlayerContextKey', () => {
    it('生成 4 维 key', () => {
        const key = buildPlayerContextKey({
            difficulty: 'normal', generator: 'budget-p2',
            bestScore: 1500, totalRounds: 100, daysSincePb: 1,
        });
        expect(key).toBe('normal:budget-p2:1500:growth');
    });

    it('bestScore 自动分档', () => {
        const k1 = buildPlayerContextKey({ difficulty: 'normal', generator: 'budget-p2', bestScore: 500 });
        const k2 = buildPlayerContextKey({ difficulty: 'normal', generator: 'budget-p2', bestScore: 8000 });
        expect(k1).toContain(':500:');
        expect(k2).toContain(':10000:');
    });
});

describe('clientPolicy — 4 层退化', () => {
    it('精确匹配', () => {
        installPolicies([mkPolicy('normal:budget-p2:1500:growth', { temperature: 0.07 })]);
        const r = resolveSpawnTheta({
            difficulty: 'normal', generator: 'budget-p2',
            bestScore: 1500, totalRounds: 100, daysSincePb: 1,
        });
        expect(r.source).toBe('exact');
        expect(r.theta.temperature).toBe(0.07);
    });

    it('lifecycle fuzzy (同 bin, 不同 lifecycle)', () => {
        installPolicies([mkPolicy('normal:budget-p2:1500:mature', { temperature: 0.06 })]);
        const r = resolveSpawnTheta({
            difficulty: 'normal', generator: 'budget-p2',
            bestScore: 1500, totalRounds: 50, daysSincePb: 0,  // → growth
        });
        expect(r.source).toBe('fuzzy-lifecycle');
        expect(r.theta.temperature).toBe(0.06);
    });

    it('coarse gen (跨 bin/lifecycle)', () => {
        installPolicies([mkPolicy('normal:budget-p2:10000:plateau', { temperature: 0.05 })]);
        const r = resolveSpawnTheta({
            difficulty: 'normal', generator: 'budget-p2',
            bestScore: 1500, totalRounds: 50, daysSincePb: 0,
        });
        expect(r.source).toBe('coarse-gen');
        expect(r.theta.temperature).toBe(0.05);
    });

    it('完全无 policies → fallback DEFAULT_THETA', () => {
        const r = resolveSpawnTheta({ difficulty: 'normal', generator: 'budget-p2', bestScore: 1500 });
        expect(r.source).toBe('no-policies');
        expect(r.theta).toEqual(DEFAULT_THETA);
    });

    it('不匹配的 difficulty/generator → fallback', () => {
        installPolicies([mkPolicy('hard:triplet-p1:25000:plateau')]);
        const r = resolveSpawnTheta({ difficulty: 'normal', generator: 'budget-p2', bestScore: 1500 });
        expect(r.source).toBe('fallback');
        expect(r.theta).toEqual(DEFAULT_THETA);
    });
});

describe('clientPolicy — 灰度门', () => {
    it('rolloutPct=100 所有用户都吃 policy', () => {
        installPolicies([mkPolicy('normal:budget-p2:1500:growth')], { rolloutPct: 100 });
        for (let i = 0; i < 30; i++) {
            const r = resolveSpawnTheta({
                difficulty: 'normal', generator: 'budget-p2', bestScore: 1500,
                totalRounds: 100, daysSincePb: 1,  // → growth
                userId: `u${i}`,
            });
            expect(r.source).toBe('exact');
        }
    });

    it('rolloutPct=0 全员 gate-out', () => {
        installPolicies([mkPolicy('normal:budget-p2:1500:growth')], { rolloutPct: 0 });
        for (let i = 0; i < 30; i++) {
            const r = resolveSpawnTheta({
                difficulty: 'normal', generator: 'budget-p2', bestScore: 1500,
                userId: `u${i}`,
            });
            expect(r.source).toBe('gate-out');
            expect(r.theta).toEqual(DEFAULT_THETA);
        }
    });

    it('rolloutPct=50 大约一半用户吃 policy', () => {
        installPolicies([mkPolicy('normal:budget-p2:1500:growth')], { rolloutPct: 50 });
        let hits = 0;
        for (let i = 0; i < 200; i++) {
            const r = resolveSpawnTheta({
                difficulty: 'normal', generator: 'budget-p2', bestScore: 1500,
                totalRounds: 100, daysSincePb: 1,
                userId: `u${i}`,
            });
            // 任何"被路由到 policy"的 source 都算 hit (exact / fuzzy / coarse)
            if (r.source !== 'gate-out' && r.source !== 'fallback' && r.source !== 'no-policies') hits++;
        }
        // 200 个用户,期望 ~100, 容差 30
        expect(hits).toBeGreaterThan(70);
        expect(hits).toBeLessThan(130);
    });

    it('同一 userId 多次调用结果一致 (确定性)', () => {
        installPolicies([mkPolicy('normal:budget-p2:1500:growth')], { rolloutPct: 50 });
        const r1 = resolveSpawnTheta({ difficulty: 'normal', generator: 'budget-p2', bestScore: 1500, userId: 'same-user' });
        const r2 = resolveSpawnTheta({ difficulty: 'normal', generator: 'budget-p2', bestScore: 1500, userId: 'same-user' });
        expect(r1.source).toBe(r2.source);
    });
});

describe('clientPolicy — stats 跟踪', () => {
    it('计数 exact / fuzzy / fallback', () => {
        installPolicies([mkPolicy('normal:budget-p2:1500:growth')], { rolloutPct: 100 });
        resolveSpawnTheta({ difficulty: 'normal', generator: 'budget-p2', bestScore: 1500, totalRounds: 100, daysSincePb: 1 });
        resolveSpawnTheta({ difficulty: 'normal', generator: 'budget-p2', bestScore: 1500, totalRounds: 100, daysSincePb: 1 });
        resolveSpawnTheta({ difficulty: 'hard', generator: 'triplet-p1', bestScore: 1500 });
        const s = getPolicyStats();
        expect(s.hits).toBe(2);
        expect(s.fallback).toBe(1);
    });
});

describe('clientPolicy — loadPoliciesFromServer', () => {
    it('成功加载', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [mkPolicy('normal:budget-p2:1500:growth')],
                count: 1,
                rollout_pct: 100,
            }),
        }));
        const r = await loadPoliciesFromServer('http://localhost:8000');
        expect(r.installed).toBe(1);
        expect(getPolicyStats().loaded).toBe(true);
    });

    it('HTTP 失败 → uninstall + 错误', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
        const r = await loadPoliciesFromServer();
        expect(r.installed).toBe(0);
        expect(r.error).toBeTruthy();
        expect(getPolicyStats().loaded).toBe(false);
    });

    it('网络错误 → uninstall', async () => {
        global.fetch = vi.fn(() => Promise.reject(new Error('network down')));
        const r = await loadPoliciesFromServer();
        expect(r.installed).toBe(0);
        expect(r.error).toMatch(/network/);
    });

    it('verifySignature 过滤无效 policy', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [
                    mkPolicy('normal:budget-p2:1500:growth'),
                    { ...mkPolicy('hard:triplet-p1:10000:mature'), signature: 'bad' },
                ],
                rollout_pct: 100,
            }),
        }));
        const r = await loadPoliciesFromServer('', {
            verifySignature: (p) => p.signature === 'mock-sig',
        });
        expect(r.installed).toBe(1);
        expect(r.totalReceived).toBe(2);
        expect(r.verifiedCount).toBe(1);
    });
});
