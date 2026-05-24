/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    initSpawnTuningHook,
    augmentSpawnContext,
    getHookStatus,
    disableSpawnTuningHook,
    reloadPolicies,
} from '../../web/src/tuning/gameIntegration.js';
import { installPolicies, uninstallPolicies, DEFAULT_THETA } from '../../web/src/tuning/clientPolicy.js';

function mkPolicy(ctxKey, thetaOverride = {}) {
    const [difficulty, generator, binStr, lifecycle_stage] = ctxKey.split(':');
    return {
        context_key: ctxKey,
        difficulty,
        generator,
        bestScore_bin: Number(binStr),
        lifecycle_stage,
        theta: {
            personalizationStrength: 0.15,
            temperature: 0.06,
            surpriseBudgetGain: 0.09,
            surpriseCooldown: 5,
            ...thetaOverride,
        },
        signature: 'mock-sig-1234567890abcdef',
        expected_composite: 0.8,
    };
}

beforeEach(() => {
    disableSpawnTuningHook();
    global.fetch = vi.fn();
});

describe('gameIntegration — initSpawnTuningHook', () => {
    it('成功加载后 enabled=true', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [mkPolicy('normal:budget-p2:1500:growth')],
                count: 1, rollout_pct: 100,
            }),
        }));
        const r = await initSpawnTuningHook();
        expect(r.installed).toBe(1);
        expect(getHookStatus().enabled).toBe(true);
    });

    it('网络失败 → installed=0 但 enabled 仍为 true (后续 reload 还能再试)', async () => {
        global.fetch = vi.fn(() => Promise.reject(new Error('net error')));
        const r = await initSpawnTuningHook();
        expect(r.installed).toBe(0);
        expect(r.error).toBeTruthy();
        // hook 已注册,只是没策略
        expect(getHookStatus().enabled).toBe(true);
    });
});

describe('gameIntegration — augmentSpawnContext', () => {
    it('未 init 时 → 原 ctx 不变', () => {
        const ctx = { foo: 'bar', bottleneckTrough: 3 };
        const augmented = augmentSpawnContext(ctx, { difficulty: 'normal' });
        expect(augmented).toBe(ctx);
    });

    it('精确命中 → 注入 modelConfig 4 字段 + tuningTheta + tuningSource', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [mkPolicy('normal:budget-p2:1500:growth', { personalizationStrength: 0.13 })],
                rollout_pct: 100,
            }),
        }));
        await initSpawnTuningHook();

        const ctx = { otherField: 'keep-this' };
        const player = {
            difficulty: 'normal', bestScore: 1500,
            totalRounds: 100, daysSincePb: 1,  // → growth
            userId: 'tester',
        };
        const augmented = augmentSpawnContext(ctx, player);
        expect(augmented).not.toBe(ctx);  // 新对象
        expect(augmented.otherField).toBe('keep-this');
        expect(augmented.modelConfig.personalizationStrength).toBe(0.13);
        expect(augmented.modelConfig.temperature).toBe(0.06);
        expect(augmented.tuningTheta).toBeDefined();
        expect(augmented.tuningSource).toBe('exact');
    });

    it('gate-out 用户 → 原 ctx 不变', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [mkPolicy('normal:budget-p2:1500:growth')],
                rollout_pct: 0,  // 全 gate-out
            }),
        }));
        await initSpawnTuningHook();

        const ctx = { foo: 'bar' };
        const augmented = augmentSpawnContext(ctx, {
            difficulty: 'normal', bestScore: 1500,
            totalRounds: 100, daysSincePb: 1, userId: 'gated',
        });
        expect(augmented).toBe(ctx);  // 同一对象
        expect(augmented.modelConfig).toBeUndefined();
    });

    it('未匹配 context → 原 ctx 不变', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [mkPolicy('hard:triplet-p1:25000:plateau')],
                rollout_pct: 100,
            }),
        }));
        await initSpawnTuningHook();
        const ctx = { foo: 'bar' };
        const augmented = augmentSpawnContext(ctx, {
            difficulty: 'easy', bestScore: 500, totalRounds: 5,
        });
        expect(augmented).toBe(ctx);
    });

    it('不修改原 ctx (immutability)', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [mkPolicy('normal:budget-p2:1500:growth')],
                rollout_pct: 100,
            }),
        }));
        await initSpawnTuningHook();
        const ctx = { foo: 'bar' };
        const before = JSON.stringify(ctx);
        augmentSpawnContext(ctx, {
            difficulty: 'normal', bestScore: 1500,
            totalRounds: 100, daysSincePb: 1, userId: 'u',
        });
        expect(JSON.stringify(ctx)).toBe(before);
    });
});

describe('gameIntegration — disableSpawnTuningHook', () => {
    it('禁用后 enabled=false', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [mkPolicy('normal:budget-p2:1500:growth')], rollout_pct: 100,
            }),
        }));
        await initSpawnTuningHook();
        expect(getHookStatus().enabled).toBe(true);
        disableSpawnTuningHook();
        expect(getHookStatus().enabled).toBe(false);
        expect(getHookStatus().count).toBe(0);
    });
});

describe('gameIntegration — reloadPolicies', () => {
    it('reload 后 stats.count 更新', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [mkPolicy('normal:budget-p2:1500:growth')], rollout_pct: 100,
            }),
        }));
        await initSpawnTuningHook();
        expect(getHookStatus().count).toBe(1);

        // 模拟 server 端追加 1 个 policy
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [
                    mkPolicy('normal:budget-p2:1500:growth'),
                    mkPolicy('hard:triplet-p1:10000:mature'),
                ],
                rollout_pct: 100,
            }),
        }));
        await reloadPolicies();
        expect(getHookStatus().count).toBe(2);
    });

    it('reload 失败 → 旧 policies 被清空 (符合 loadPoliciesFromServer 现状)', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                policies: [mkPolicy('normal:budget-p2:1500:growth')], rollout_pct: 100,
            }),
        }));
        await initSpawnTuningHook();
        expect(getHookStatus().count).toBe(1);

        global.fetch = vi.fn(() => Promise.reject(new Error('net err')));
        const r = await reloadPolicies();
        expect(r.error).toBeTruthy();
        // 现实现: fetch 失败会 uninstall (clientPolicy.loadPoliciesFromServer 的行为)
        expect(getHookStatus().count).toBe(0);
    });
});
