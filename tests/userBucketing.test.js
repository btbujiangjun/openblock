/**
 * BB4: lib/userBucketing 单测 —— 分桶稳定性 + 灰度边界。
 */
import { describe, it, expect } from 'vitest';
import {
    xfnv1aHash, getUserBucket, resolveRolloutFeature, getFeatureBucket,
} from '../web/src/lib/userBucketing.js';

describe('BB4 xfnv1aHash', () => {
    it('确定性：同输入永远同输出', () => {
        expect(xfnv1aHash('user-123')).toBe(xfnv1aHash('user-123'));
    });

    it('uint32 范围（≥ 0，< 2^32）', () => {
        for (const s of ['', 'a', 'user-1234567890', '中文 abc 🎮']) {
            const h = xfnv1aHash(s);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(2 ** 32);
            expect(Number.isInteger(h)).toBe(true);
        }
    });

    it('不同输入大概率不同 hash（avalanche sanity）', () => {
        const a = xfnv1aHash('user-100');
        const b = xfnv1aHash('user-101');
        expect(a).not.toBe(b);
    });
});

describe('BB4 getUserBucket', () => {
    it('稳定：同 userId+salt 永远同桶', () => {
        const b1 = getUserBucket('u1', 'feat-a');
        const b2 = getUserBucket('u1', 'feat-a');
        expect(b1).toBe(b2);
    });

    it('范围 0..99', () => {
        for (let i = 0; i < 200; i++) {
            const b = getUserBucket(`u${i}`, 'salt-x');
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThan(100);
        }
    });

    it('同 userId 不同 salt → 不同 feature 桶解耦', () => {
        /* 不要求 100% 不同，但 50 不同 feature 大多数桶应该不同 */
        let differCount = 0;
        for (let i = 0; i < 50; i++) {
            const a = getUserBucket('uX', `feat-${i}`);
            const b = getUserBucket('uX', `feat-${i + 100}`);
            if (a !== b) differCount++;
        }
        expect(differCount).toBeGreaterThan(40);
    });

    it('分布大致均匀：5000 用户 5% 灰度 → 250±100', () => {
        let hit = 0;
        for (let i = 0; i < 5000; i++) {
            if (getUserBucket(`user-${i}`, 'distribution-test') < 5) hit++;
        }
        expect(hit).toBeGreaterThanOrEqual(150);
        expect(hit).toBeLessThanOrEqual(350);
    });

    it('空 userId → -1', () => {
        expect(getUserBucket('', 'salt')).toBe(-1);
        expect(getUserBucket(null, 'salt')).toBe(-1);
        expect(getUserBucket(undefined, 'salt')).toBe(-1);
    });
});

describe('BB4 resolveRolloutFeature', () => {
    it('config=null/undefined/非对象 → false', () => {
        expect(resolveRolloutFeature('u1', null)).toBe(false);
        expect(resolveRolloutFeature('u1', undefined)).toBe(false);
        expect(resolveRolloutFeature('u1', 'string')).toBe(false);
    });

    it('enabled=false 永远 false', () => {
        expect(resolveRolloutFeature('u1', { enabled: false, percent: 100 })).toBe(false);
    });

    it('percent=100 永远 true', () => {
        expect(resolveRolloutFeature('u1', { enabled: true, percent: 100, salt: 's' })).toBe(true);
        expect(resolveRolloutFeature('u-any', { enabled: true, percent: 100 })).toBe(true);
    });

    it('percent=0/负 永远 false', () => {
        expect(resolveRolloutFeature('u1', { enabled: true, percent: 0 })).toBe(false);
        expect(resolveRolloutFeature('u1', { enabled: true, percent: -10 })).toBe(false);
    });

    it('percent NaN/非数 → false', () => {
        expect(resolveRolloutFeature('u1', { enabled: true, percent: 'NaN' })).toBe(false);
        expect(resolveRolloutFeature('u1', { enabled: true })).toBe(false);
    });

    it('percent=5 → 大约 5% 用户启用（5000 样本）', () => {
        let hit = 0;
        for (let i = 0; i < 5000; i++) {
            if (resolveRolloutFeature(`u-${i}`, { enabled: true, percent: 5, salt: 'rollout-test' })) hit++;
        }
        expect(hit).toBeGreaterThanOrEqual(150);
        expect(hit).toBeLessThanOrEqual(400);
    });

    it('同 userId+config 永远同结果（决策稳定）', () => {
        for (let i = 0; i < 100; i++) {
            const cfg = { enabled: true, percent: 25, salt: 'stable' };
            const r1 = resolveRolloutFeature(`u-${i}`, cfg);
            const r2 = resolveRolloutFeature(`u-${i}`, cfg);
            expect(r1).toBe(r2);
        }
    });

    it('空 userId → false（安全默认）', () => {
        expect(resolveRolloutFeature('', { enabled: true, percent: 50 })).toBe(false);
    });

    it('AA5 dynamic leafCap 接入示例：percent=5 + 业务 salt', () => {
        const cfg = { enabled: true, percent: 5, salt: 'dyn-cap-v1' };
        /* 同一用户在该 feature 上结果稳定 */
        const r = resolveRolloutFeature('player-alice', cfg);
        expect(typeof r).toBe('boolean');
        expect(resolveRolloutFeature('player-alice', cfg)).toBe(r);
    });
});

describe('BB4 getFeatureBucket alias', () => {
    it('与 getUserBucket 行为一致', () => {
        expect(getFeatureBucket('u1', 's')).toBe(getUserBucket('u1', 's'));
    });
});
