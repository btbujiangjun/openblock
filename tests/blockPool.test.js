/**
 * @vitest-environment jsdom
 *
 * BlockPool 单元测试
 * 覆盖：新鲜度惩罚、wrap、resetForNewGame、getDiagnostics
 */
import { describe, it, expect, vi } from 'vitest';
import { BlockPool, defaultBlockPool } from '../web/src/bot/blockPool.js';

// ------------------------------------------------------------------ helpers
function makeShape(id, category = 'small') {
    return { id, data: [[1, 1]], category };
}

function makeScored(ids) {
    return ids.map(id => ({
        shape: makeShape(id),
        weight: 1,
        gapFills: 0,
        placements: 10,
        category: 'small',
    }));
}

// ------------------------------------------------------------------ tests

describe('BlockPool.penalize', () => {
    it('未在窗口内的形状权重不变', () => {
        const pool = new BlockPool();
        const scored = makeScored(['a', 'b', 'c']);
        const result = pool.penalize(scored);
        result.forEach((s, i) => expect(s.weight).toBeCloseTo(scored[i].weight));
    });

    it('窗口内的形状权重被降低', () => {
        const pool = new BlockPool({ penaltyFactor: 0.4 });
        pool._recentIds = ['a', 'b'];
        const scored = makeScored(['a', 'c']);
        const result = pool.penalize(scored);
        expect(result[0].weight).toBeCloseTo(0.4);   // 'a' 在窗口内，惩罚
        expect(result[1].weight).toBeCloseTo(1.0);   // 'c' 不在窗口内
    });

    it('所有权重 > 0', () => {
        const pool = new BlockPool({ penaltyFactor: 0 });  // 极端情况
        pool._recentIds = ['a'];
        const result = pool.penalize(makeScored(['a']));
        expect(result[0].weight).toBeGreaterThan(0);
    });
});

describe('BlockPool.wrap', () => {
    it('包装后函数返回原始函数的结果', () => {
        const shapes = [makeShape('x'), makeShape('y'), makeShape('z')];
        const fakeFn = vi.fn().mockReturnValue(shapes);
        const pool = new BlockPool();
        const wrapped = pool.wrap(fakeFn);
        const result = wrapped({}, {}, {}, {});
        expect(result).toEqual(shapes);
        expect(fakeFn).toHaveBeenCalledOnce();
    });

    it('调用后 _recentIds 更新', () => {
        const shapes = [makeShape('a'), makeShape('b'), makeShape('c')];
        const fakeFn = vi.fn().mockReturnValue(shapes);
        const pool = new BlockPool();
        const wrapped = pool.wrap(fakeFn);
        wrapped({}, {}, {}, {});
        expect(pool._recentIds).toContain('a');
        expect(pool._recentIds).toContain('b');
        expect(pool._recentIds).toContain('c');
    });

    it('recentWindow 限制窗口大小', () => {
        const pool = new BlockPool({ recentWindow: 3 });
        const shapes = [makeShape('a'), makeShape('b'), makeShape('c')];
        const fakeFn = vi.fn().mockReturnValue(shapes);
        const wrapped = pool.wrap(fakeFn);
        // 调用两次，产生 6 个 id，但窗口只保留 3
        wrapped({}, {}, {}, {});
        wrapped({}, {}, {}, {});
        expect(pool._recentIds.length).toBeLessThanOrEqual(3);
    });

    it('enrichedCtx 包含 recentShapeIds', () => {
        const shapes = [makeShape('a')];
        let capturedCtx;
        const fakeFn = vi.fn((grid, cfg, hints, ctx) => {
            capturedCtx = ctx;
            return shapes;
        });
        const pool = new BlockPool();
        pool._recentIds = ['prev1'];
        const wrapped = pool.wrap(fakeFn);
        wrapped({}, {}, {}, { custom: true });
        expect(capturedCtx.recentShapeIds).toContain('prev1');
        expect(capturedCtx.custom).toBe(true);
    });
});

describe('BlockPool.resetForNewGame', () => {
    it('重置后 _recentIds 清空', () => {
        const pool = new BlockPool();
        pool._recentIds = ['a', 'b', 'c'];
        pool.resetForNewGame();
        expect(pool._recentIds).toHaveLength(0);
    });

    it('重置后品类记忆不清空', () => {
        const pool = new BlockPool();
        pool._recentCategoryRounds = [['small'], ['large']];
        pool.resetForNewGame();
        expect(pool._recentCategoryRounds).toHaveLength(2);
    });
});

describe('BlockPool.getDiagnostics', () => {
    it('返回 recentIds 和 categoryFreq', () => {
        const pool = new BlockPool();
        pool._recentIds = ['a', 'b'];
        pool._recentCategoryRounds = [['small', 'large'], ['small']];
        const diag = pool.getDiagnostics();
        expect(diag.recentIds).toEqual(['a', 'b']);
        expect(diag.categoryFreq['small']).toBe(2);
        expect(diag.categoryFreq['large']).toBe(1);
    });
});

describe('defaultBlockPool', () => {
    it('可直接导入并使用', () => {
        expect(defaultBlockPool).toBeInstanceOf(BlockPool);
    });
});
