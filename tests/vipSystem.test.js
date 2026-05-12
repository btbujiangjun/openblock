/**
 * @vitest-environment jsdom
 * vipSystem.test.js - VIP系统测试
 */

import { describe, it, expect, beforeEach } from 'vitest';

const mockStorage = {};

Object.defineProperty(globalThis, 'localStorage', {
    value: {
        getItem: (_key) => mockStorage[_key] ?? null,
        setItem: (_key, _value) => { mockStorage[_key] = _value; },
        removeItem: (_key) => { delete mockStorage[_key]; },
        clear: () => { Object.keys(mockStorage).forEach((_) => delete mockStorage[_]); }
    },
    writable: true
});

import {
    updateVipScore,
    getVipStatus,
    getVipBenefits,
    canAccessVipFeature,
    invalidateVipCache
} from '../web/src/retention/vipSystem.js';

describe('VIP System', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach((_) => delete mockStorage[_]);
        invalidateVipCache();
    });

    describe('updateVipScore', () => {
        it('should start at vip0', () => {
            const result = updateVipScore(100);
            expect(result.currentLevel).toBe('vip0');
        });

        it('should upgrade to vip1 at 1000 score', () => {
            const result = updateVipScore(1500);
            expect(result.currentLevel).toBe('vip1');
        });

        it('should track cumulative score', () => {
            updateVipScore(500);
            updateVipScore(800);
            const status = getVipStatus();
            expect(status.lifetimeScore).toBeGreaterThanOrEqual(1300);
        });
    });

    describe('getVipStatus', () => {
        it('should return complete status', () => {
            const status = getVipStatus();
            expect(status.currentLevel).toBeDefined();
            expect(status.levelName).toBeDefined();
            expect(status.badge).toBeDefined();
            expect(status.nextLevel).toBeDefined();
            expect(status.progress).toBeDefined();
            expect(status.benefits).toBeDefined();
        });

        it('should show next level progress', () => {
            updateVipScore(500);
            const status = getVipStatus();
            expect(status.nextLevel).not.toBeNull();
            expect(status.progress).toBeLessThan(100);
        });
    });

    describe('getVipBenefits', () => {
        it('should return benefits for current level', () => {
            updateVipScore(5000);
            const benefits = getVipBenefits();
            expect(benefits.length).toBeGreaterThan(0);
            expect(benefits[0].type).toBeDefined();
            expect(benefits[0].description).toBeDefined();
        });
    });

    describe('canAccessVipFeature', () => {
        it('should allow access to feature at correct level', () => {
            updateVipScore(2000);
            const result = canAccessVipFeature('ad_removal');
            expect(result.allowed).toBe(true);
        });

        it('should deny access to higher level features', () => {
            updateVipScore(1000);
            const result = canAccessVipFeature('exclusive_shop');
            expect(result.allowed).toBe(false);
            expect(result.required).toBe('vip2');
        });

        it('should check feature access correctly', () => {
            updateVipScore(10000);
            const result = canAccessVipFeature('beta_access');
            expect(result.allowed).toBeDefined();
        });
    });
});