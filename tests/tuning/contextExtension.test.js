/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
    registerContextDimension,
    unregisterContextDimension,
    listRegisteredDimensions,
    _clearRegistry,
    extendContextKey,
    stripExtendedDimensions,
    generateLookupChain,
    getExtendedSpaceSize,
} from '../../web/src/tuning/contextExtension.js';

beforeEach(() => _clearRegistry());

describe('contextExtension — 注册与卸载', () => {
    it('注册后可枚举', () => {
        registerContextDimension({
            key: 'deviceTier',
            values: ['low', 'mid', 'high'],
            extractor: () => 'mid',
            fallback: 'mid',
        });
        const dims = listRegisteredDimensions();
        expect(dims).toHaveLength(1);
        expect(dims[0].key).toBe('deviceTier');
        expect(dims[0].values).toEqual(['low', 'mid', 'high']);
    });

    it('卸载后清空', () => {
        registerContextDimension({
            key: 'segment', values: ['casual', 'core'], extractor: () => 'core',
        });
        unregisterContextDimension('segment');
        expect(listRegisteredDimensions()).toHaveLength(0);
    });

    it('重复注册替换 (warn 但不报错)', () => {
        registerContextDimension({
            key: 'deviceTier', values: ['low', 'mid'], extractor: () => 'mid',
        });
        registerContextDimension({
            key: 'deviceTier', values: ['a', 'b', 'c'], extractor: () => 'a',
        });
        expect(listRegisteredDimensions()[0].values).toEqual(['a', 'b', 'c']);
    });

    it('非法定义抛错', () => {
        expect(() => registerContextDimension({ key: 'x', values: [] })).toThrow();
        expect(() => registerContextDimension({ values: ['a'], extractor: () => 'a' })).toThrow();
        expect(() => registerContextDimension({ key: 'x', values: ['a'] })).toThrow();
    });
});

describe('contextExtension — extendContextKey', () => {
    it('无注册维度 → 返回原 key', () => {
        expect(extendContextKey('normal:budget-p2:1500:growth')).toBe('normal:budget-p2:1500:growth');
    });

    it('1 个维度 → 追加 1 段', () => {
        registerContextDimension({
            key: 'deviceTier',
            values: ['low', 'mid', 'high'],
            extractor: (ctx) => ctx.cores >= 8 ? 'high' : (ctx.cores >= 4 ? 'mid' : 'low'),
            fallback: 'mid',
        });
        const key = extendContextKey('normal:budget-p2:1500:growth', { cores: 8 });
        expect(key).toBe('normal:budget-p2:1500:growth:high');
    });

    it('2 个维度 → 追加 2 段 (注册顺序)', () => {
        registerContextDimension({
            key: 'deviceTier', values: ['low', 'mid', 'high'],
            extractor: () => 'mid',
        });
        registerContextDimension({
            key: 'segment', values: ['casual', 'core'],
            extractor: () => 'core',
        });
        const key = extendContextKey('normal:budget-p2:1500:growth', {});
        expect(key).toBe('normal:budget-p2:1500:growth:mid:core');
    });

    it('extractor 抛错 → fallback', () => {
        registerContextDimension({
            key: 'deviceTier', values: ['low', 'mid', 'high'],
            extractor: () => { throw new Error('boom'); },
            fallback: 'mid',
        });
        expect(extendContextKey('normal:budget-p2:1500:growth')).toBe('normal:budget-p2:1500:growth:mid');
    });

    it('extractor 返回非法值 → fallback', () => {
        registerContextDimension({
            key: 'deviceTier', values: ['low', 'mid', 'high'],
            extractor: () => 'extreme',  // 不在 values
            fallback: 'mid',
        });
        expect(extendContextKey('normal:budget-p2:1500:growth')).toBe('normal:budget-p2:1500:growth:mid');
    });
});

describe('contextExtension — stripExtendedDimensions', () => {
    it('剥掉扩展维度', () => {
        expect(stripExtendedDimensions('normal:budget-p2:1500:growth:high:core'))
            .toBe('normal:budget-p2:1500:growth');
    });

    it('已经是 4 维 → 不变', () => {
        expect(stripExtendedDimensions('normal:budget-p2:1500:growth'))
            .toBe('normal:budget-p2:1500:growth');
    });
});

describe('contextExtension — generateLookupChain', () => {
    it('无注册 → 单项 chain', () => {
        const chain = generateLookupChain('normal:budget-p2:1500:growth');
        expect(chain).toEqual(['normal:budget-p2:1500:growth']);
    });

    it('1 个维度 → 2 层 chain (含主 key)', () => {
        registerContextDimension({
            key: 'deviceTier', values: ['low', 'mid', 'high'],
            extractor: () => 'high',
        });
        const chain = generateLookupChain('normal:budget-p2:1500:growth', {});
        expect(chain).toEqual([
            'normal:budget-p2:1500:growth:high',
            'normal:budget-p2:1500:growth',
        ]);
    });

    it('2 个维度 → 3 层 chain (剥离顺序: 最后一个先)', () => {
        registerContextDimension({
            key: 'deviceTier', values: ['low', 'mid'], extractor: () => 'mid',
        });
        registerContextDimension({
            key: 'segment', values: ['casual', 'core'], extractor: () => 'core',
        });
        const chain = generateLookupChain('normal:budget-p2:1500:growth', {});
        expect(chain).toEqual([
            'normal:budget-p2:1500:growth:mid:core',
            'normal:budget-p2:1500:growth:mid',
            'normal:budget-p2:1500:growth',
        ]);
    });
});

describe('contextExtension — getExtendedSpaceSize', () => {
    it('无注册 → 返回基础', () => {
        expect(getExtendedSpaceSize(120)).toBe(120);
    });

    it('1 维 (3 值) → ×3', () => {
        registerContextDimension({
            key: 'deviceTier', values: ['low', 'mid', 'high'], extractor: () => 'mid',
        });
        expect(getExtendedSpaceSize(120)).toBe(360);
    });

    it('2 维 (3 × 2 值) → ×6', () => {
        registerContextDimension({
            key: 'deviceTier', values: ['low', 'mid', 'high'], extractor: () => 'mid',
        });
        registerContextDimension({
            key: 'segment', values: ['casual', 'core'], extractor: () => 'core',
        });
        expect(getExtendedSpaceSize(120)).toBe(720);
    });
});
