/**
 * A/B 测试框架单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getBucket, getVariant, EXPERIMENTS, forceVariant, clearOverrides, debugReport } from '../web/src/abTest.js';

// Mock localStorage
const _store = {};
vi.stubGlobal('localStorage', {
    getItem: (k) => _store[k] ?? null,
    setItem: (k, v) => { _store[k] = v; },
    removeItem: (k) => { delete _store[k]; },
});

describe('getBucket', () => {
    it('同一 userId+experiment 始终返回同一桶', () => {
        const b1 = getBucket('user-abc', 'interstitial_delay', 2);
        const b2 = getBucket('user-abc', 'interstitial_delay', 2);
        expect(b1).toBe(b2);
    });

    it('返回值在 [0, buckets) 范围内', () => {
        for (let i = 0; i < 20; i++) {
            const b = getBucket(`user-${i}`, 'test_exp', 3);
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThan(3);
        }
    });

    it('不同 userId 分桶结果不同（大概率）', () => {
        const buckets = new Set(
            Array.from({ length: 50 }, (_, i) => getBucket(`u${i}`, 'interstitial_delay', 2))
        );
        expect(buckets.size).toBeGreaterThan(1);
    });

    it('不同实验不影响同一用户的其他实验', () => {
        const b1 = getBucket('user-xyz', 'exp_a', 2);
        const b2 = getBucket('user-xyz', 'exp_b', 2);
        // 不要求相同，只要都在合法范围
        expect(b1).toBeGreaterThanOrEqual(0);
        expect(b2).toBeGreaterThanOrEqual(0);
    });
});

describe('getVariant', () => {
    it('返回 variants 中的某个值', () => {
        const v = getVariant('user-1', 'interstitial_delay', [3000, 0]);
        expect([3000, 0]).toContain(v);
    });

    it('同一用户在同一实验中始终拿到同一变体', () => {
        const v1 = getVariant('stable-user', 'rewarded_threshold', [5, 3]);
        const v2 = getVariant('stable-user', 'rewarded_threshold', [5, 3]);
        expect(v1).toBe(v2);
    });

    it('50个用户中两种变体都有覆盖', () => {
        const results = new Set(
            Array.from({ length: 50 }, (_, i) =>
                getVariant(`u${i}`, 'minigoal_difficulty', [0.8, 1.0])
            )
        );
        expect(results.size).toBeGreaterThan(1);
    });
});

describe('forceVariant / clearOverrides', () => {
    beforeEach(() => {
        clearOverrides();
    });

    it('forceVariant 强制返回指定桶', () => {
        forceVariant('interstitial_delay', 1);
        // 无论用户是谁，都应返回桶1的值
        const v = getVariant('any-user', 'interstitial_delay', [3000, 0]);
        expect(v).toBe(0); // 桶1对应 variants[1]=0
    });

    it('clearOverrides 后恢复哈希分桶', () => {
        forceVariant('interstitial_delay', 1);
        clearOverrides();
        // 现在应该按哈希来，不一定是桶1
        const v1 = getVariant('user-abc', 'interstitial_delay', [3000, 0]);
        const v2 = getVariant('user-abc', 'interstitial_delay', [3000, 0]);
        expect(v1).toBe(v2); // 稳定即可
    });
});

describe('EXPERIMENTS 注册表', () => {
    it('所有内置实验都有 variants 数组', () => {
        for (const [, exp] of Object.entries(EXPERIMENTS)) {
            expect(Array.isArray(exp.variants)).toBe(true);
            expect(exp.variants.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('所有内置实验都有 description', () => {
        for (const [, exp] of Object.entries(EXPERIMENTS)) {
            expect(typeof exp.description).toBe('string');
            expect(exp.description.length).toBeGreaterThan(0);
        }
    });
});

describe('debugReport', () => {
    beforeEach(() => clearOverrides());

    it('返回所有实验的桶信息', () => {
        const report = debugReport('test-user');
        expect(report.length).toBe(Object.keys(EXPERIMENTS).length);
        for (const entry of report) {
            expect(entry).toHaveProperty('experiment');
            expect(entry).toHaveProperty('bucket');
            expect(entry).toHaveProperty('value');
            expect(entry.forced).toBe(false);
        }
    });

    it('forceVariant 后 forced=true', () => {
        forceVariant('interstitial_delay', 0);
        const report = debugReport('any-user');
        const entry = report.find(e => e.experiment === 'interstitial_delay');
        expect(entry.forced).toBe(true);
        expect(entry.bucket).toBe(0);
    });
});
