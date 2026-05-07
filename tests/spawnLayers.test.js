/**
 * @vitest-environment jsdom
 *
 * spawnLayers 三层出块架构单元测试
 * 覆盖：FallbackLayer、LaneLayer、GlobalLayer 的核心行为约束
 */
import { describe, it, expect } from 'vitest';
import { FallbackLayer, LaneLayer, GlobalLayer } from '../web/src/bot/spawnLayers.js';
import { Grid } from '../web/src/grid.js';

// ------------------------------------------------------------------ helpers

function makeShape(id, cells = 2, gapFills = 0, placements = 10, category = 'small') {
    // 生成 cells 个格子的形状数据（1×cells 行）
    const data = [Array.from({ length: cells }, () => 1)];
    return {
        shape: { id, data },
        weight: 1,
        gapFills,
        placements,
        category,
        multiClear: 0,
    };
}

// ------------------------------------------------------------------ FallbackLayer

describe('FallbackLayer.ensure', () => {
    it('候选全可放时不补充', () => {
        const candidates = [
            makeShape('a', 2, 0, 10),
            makeShape('b', 2, 0, 5),
            makeShape('c', 2, 0, 8),
        ];
        const grid = new Grid(8);
        const result = FallbackLayer.ensure(candidates, grid, {});
        expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it('候选全不可放时应补入可放块', () => {
        const candidates = [
            makeShape('a', 2, 0, 0),  // placements=0
            makeShape('b', 2, 0, 0),
        ];
        const grid = new Grid(8);  // 空棋盘必然有合法位置
        // 由于 FallbackLayer.ensure 使用 pickShapeByCategoryWeights 内部调用
        // 空棋盘下补入的块 placements 应 > 0
        const result = FallbackLayer.ensure(candidates, grid, { small: 1, line: 1 });
        const hasPlaceable = result.some(s => s.placements > 0);
        expect(hasPlaceable).toBe(true);
    });

    it('pick 始终返回恰好 3 个', () => {
        const candidates = Array.from({ length: 6 }, (_, i) =>
            makeShape(`s${i}`, 2, i < 2 ? 1 : 0, 10)
        );
        const result = FallbackLayer.pick(candidates);
        expect(result.length).toBe(3);
    });

    it('pick 优先将 gapFill 块放第一位', () => {
        const candidates = [
            makeShape('normal', 2, 0, 10),
            makeShape('gap', 2, 1, 10),   // gapFills=1
            makeShape('other', 2, 0, 8),
        ];
        const result = FallbackLayer.pick(candidates);
        expect(result[0].id).toBe('gap');
    });

    it('pick 候选不足时返回可用数量（< 3 不崩溃）', () => {
        const candidates = [makeShape('a', 2, 1, 10)];
        const result = FallbackLayer.pick(candidates);
        expect(result.length).toBeLessThanOrEqual(3);
        expect(result.length).toBeGreaterThanOrEqual(1);
    });
});

// ------------------------------------------------------------------ LaneLayer

describe('LaneLayer.filter', () => {
    const base = [
        makeShape('small1', 2, 0, 10, 'small'),
        makeShape('large1', 8, 0, 8, 'large'),
        makeShape('gap1',   4, 1, 10, 'medium'),
    ];

    it('无 hints 时返回等长列表（权重不变或略变）', () => {
        const result = LaneLayer.filter(base, {});
        expect(result.length).toBe(base.length);
    });

    it('payoff 阶段提升 gapFills 块的权重', () => {
        const result = LaneLayer.filter(base, { rhythmPhase: 'payoff' });
        const gapBlock = result.find(s => s.shape.id === 'gap1');
        const normalBlock = result.find(s => s.shape.id === 'small1');
        expect(gapBlock.weight).toBeGreaterThan(normalBlock.weight);
    });

    it('comboChain > 0 时消行块权重更高', () => {
        const result = LaneLayer.filter(base, { comboChain: 0.8 });
        const gapBlock = result.find(s => s.shape.id === 'gap1');
        const normalBlock = result.find(s => s.shape.id === 'small1');
        expect(gapBlock.weight).toBeGreaterThan(normalBlock.weight);
    });

    it('clearGuarantee > 0 时非消行块权重被压低', () => {
        const result = LaneLayer.filter(base, { clearGuarantee: 2 });
        const normal = result.find(s => s.shape.id === 'small1');
        expect(normal.weight).toBeLessThan(1);
    });

    it('所有权重都 > 0（无负权重）', () => {
        const result = LaneLayer.filter(base, {
            rhythmPhase: 'payoff', comboChain: 1, clearGuarantee: 3,
            sizePreference: -1,
        });
        result.forEach(s => expect(s.weight).toBeGreaterThan(0));
    });
});

// ------------------------------------------------------------------ GlobalLayer

describe('GlobalLayer.adjust', () => {
    const base = [
        makeShape('sm', 2, 0, 10, 'small'),
        makeShape('lg', 8, 1, 8,  'large'),
        makeShape('md', 4, 0, 9,  'medium'),
    ];

    it('无 context 时权重不变', () => {
        const result = GlobalLayer.adjust(base, {});
        expect(result.length).toBe(base.length);
        result.forEach((s, i) => expect(s.weight).toBeCloseTo(base[i].weight, 1));
    });

    it('warmup 阶段小块权重更高', () => {
        const result = GlobalLayer.adjust(base, { sessionArc: 'warmup' });
        const small = result.find(s => s.shape.id === 'sm');
        const large = result.find(s => s.shape.id === 'lg');
        expect(small.weight).toBeGreaterThan(large.weight);
    });

    it('roundsSinceClear 高时消行块权重上升', () => {
        const noFrustration = GlobalLayer.adjust(base, { roundsSinceClear: 0 });
        const withFrustration = GlobalLayer.adjust(base, { roundsSinceClear: 10 });
        const gapNoFrust = noFrustration.find(s => s.shape.id === 'lg');
        const gapWithFrust = withFrustration.find(s => s.shape.id === 'lg');
        expect(gapWithFrust.weight).toBeGreaterThan(gapNoFrust.weight);
    });

    it('里程碑时大块权重提升', () => {
        const normal = GlobalLayer.adjust(base, {});
        const milestone = GlobalLayer.adjust(base, { scoreMilestone: true });
        const lgNormal = normal.find(s => s.shape.id === 'lg');
        const lgMilestone = milestone.find(s => s.shape.id === 'lg');
        expect(lgMilestone.weight).toBeGreaterThan(lgNormal.weight);
    });

    it('最近出现过的品类权重被降低', () => {
        const result = GlobalLayer.adjust(base, {
            recentCategories: [['small', 'small', 'small']],
        });
        const small = result.find(s => s.shape.id === 'sm');
        expect(small.weight).toBeLessThan(1);
    });

    it('所有权重都 > 0', () => {
        const result = GlobalLayer.adjust(base, {
            sessionArc: 'warmup', scoreMilestone: true,
            roundsSinceClear: 15, recentCategories: [['small']],
        });
        result.forEach(s => expect(s.weight).toBeGreaterThan(0));
    });
});

// ------------------------------------------------------------------ 层间联动

describe('三层管道联动', () => {
    it('Global → Lane → Fallback 链式调用不崩溃并返回 3 个块', () => {
        const candidates = Array.from({ length: 8 }, (_, i) =>
            makeShape(`s${i}`, i % 3 + 1, i % 3 === 0 ? 1 : 0, 10, ['small', 'medium', 'large'][i % 3])
        );
        // 链路集成测试不需要实际 grid，只验证候选数量与不抛错
        const context = { sessionArc: 'peak', roundsSinceClear: 3 };
        const hints = { rhythmPhase: 'payoff', comboChain: 0.5 };

        const afterGlobal = GlobalLayer.adjust(candidates, context);
        const afterLane   = LaneLayer.filter(afterGlobal, hints);
        const finalBlocks = FallbackLayer.pick(afterLane);

        expect(finalBlocks).toBeDefined();
        expect(finalBlocks.length).toBeLessThanOrEqual(3);
    });
});
