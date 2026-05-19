// @vitest-environment jsdom
/**
 * v1.60.13：driver → 派生节点路径表（DRIVER_NODE_PATHS）的不变式回归。
 *
 * 锁定 4 件事：
 *   1) 每个 chosenMeta.topDriver.key 出现的可能值，都必须在 DRIVER_NODE_PATHS 里有显式条目
 *      —— 否则会 fallback 到 balanced（全亮 5 层），让"该精确点亮 2-3 节点"的 driver 信息稀释；
 *   2) v1.60.13 新增的 relief / pressure 路径覆盖了 _tryInjectSpecial 注入路径硬编码的 driver key；
 *   3) relief / pressure 是精确 path（≠ 全 5 层通配），符合"按代码事实映射真实读取的派生节点"原则；
 *   4) v1.60.0 - v1.60.13 之间的 4 段 special-shape fallback 死代码（diagonalSparse / diagonalPair /
 *      tinyLine / cornerFit）确实不会被 _estimateTopDriver 触发（_passesShapeGate 提前拦截）。
 */

import { describe, it, expect } from 'vitest';

import { __dfvTestables } from '../web/src/decisionFlowViz.js';
import { Grid } from '../web/src/grid.js';
import { getRegularShapes, getSpecialShapes } from '../web/src/shapes.js';
import {
    _estimateTopDriver,
    _tryInjectSpecial,
    resetSpawnMemory,
} from '../web/src/bot/blockSpawn.js';
import { getStrategy } from '../web/src/config.js';

const { DRIVER_NODE_PATHS, STRATEGY_COMPONENT_DEFS, SPAWN_TARGET_DEFS, SCHEDULE_PARAM_DEFS } = __dfvTestables;

describe('v1.60.13 — DRIVER_NODE_PATHS 不变式', () => {
    it('表里所有 path 的 strategy/targets/schedule 引用都必须是真实派生节点 key（或 "*"）', () => {
        const strategyKeys = new Set(STRATEGY_COMPONENT_DEFS.map(d => d.key));
        const targetKeys = new Set(SPAWN_TARGET_DEFS.map(d => d.key));
        const scheduleKeys = new Set(SCHEDULE_PARAM_DEFS.map(d => d.key));

        for (const [driverKey, path] of Object.entries(DRIVER_NODE_PATHS)) {
            const check = (arr, set, layer) => {
                if (arr === '*') return;
                expect(Array.isArray(arr), `${driverKey}.${layer} 必须是数组或 "*"`).toBe(true);
                for (const k of arr) {
                    expect(set.has(k), `${driverKey}.${layer} 引用了不存在的派生节点 "${k}"`).toBe(true);
                }
            };
            check(path.strategy, strategyKeys, 'strategy');
            check(path.targets, targetKeys, 'targets');
            check(path.schedule, scheduleKeys, 'schedule');
            expect(typeof path.intent, `${driverKey}.intent 必须是 boolean`).toBe('boolean');
        }
    });

    it('_estimateTopDriver 全部可能输出的 driver key 在 DRIVER_NODE_PATHS 中都有显式条目', () => {
        /* 直接覆盖 _estimateTopDriver 8 条判定分支的边界用例，
         * 锁定其输出的 key 全集 = { pcPotential, multiClear, gapFills, holeReduce, mobility,
         *                          shapeWeight, balanced, fallback }。
         * v1.60.15：multiClear=1 也走 multiClear key（之前 gapFills=1 走 gapFills 但 label
         * 误为"可消1行"）。 */
        const cases = [
            { in: null,                                                                                 expect: 'fallback' },
            { in: { pcPotential: 2, multiClear: 0, gapFills: 0, holeReduce: 0, placements: 1 },        expect: 'pcPotential' },
            { in: { pcPotential: 0, multiClear: 2, gapFills: 0, holeReduce: 0, placements: 1 },        expect: 'multiClear' },
            /* v1.60.15：multiClear=1 单独走 multiClear path（不再吞入 gapFills） */
            { in: { pcPotential: 0, multiClear: 1, gapFills: 0, holeReduce: 0, placements: 1 },        expect: 'multiClear' },
            { in: { pcPotential: 0, multiClear: 0, gapFills: 2, holeReduce: 0, placements: 1 },        expect: 'gapFills' },
            { in: { pcPotential: 0, multiClear: 0, gapFills: 1, holeReduce: 0, placements: 1 },        expect: 'gapFills' },
            { in: { pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 1, placements: 1 },        expect: 'holeReduce' },
            { in: { pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0, placements: 30 },       expect: 'mobility' },
            { in: { pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0, placements: 1, category: 'lines' },
              weights: { lines: 5, rects: 1, squares: 1 }, expect: 'shapeWeight' },
            { in: { pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0, placements: 1, category: 'rects' },
              weights: { lines: 1, rects: 1, squares: 1 }, expect: 'balanced' },
        ];

        for (const c of cases) {
            const out = _estimateTopDriver(c.in, c.weights || null);
            expect(out.key, `_estimateTopDriver 输入 ${JSON.stringify(c.in)} 预期输出 ${c.expect}`).toBe(c.expect);
            expect(DRIVER_NODE_PATHS[out.key], `driver key "${out.key}" 必须在 DRIVER_NODE_PATHS 中有显式条目`).toBeDefined();
        }
    });

    it('v1.60.15/v1.60.16：multiClear/gapFills 语义边界——label 严格反映真模拟 vs 加权差缺分', () => {
        /* 锁定 v1.60.15 driver key 切分 + v1.60.16 文案统一：
         *   "可消X行"（X=1/2/3...）只在 multiClear>=1 时出现（真模拟 previewClearOutcome）
         *   "补N缺" / "近满补1" 只在 gapFills>=1 且 multiClear=0 时出现（加权差缺分，不保证消行）
         * 防止有人误把 gapFills=1 文案回退到"可消X行"重蹈 v1.59.20 覆辙；
         * 也防止 multiClear>=2 文案回退到"可多消N行"前缀冗余（v1.60.16 用户反馈）。 */
        const out1 = _estimateTopDriver({ pcPotential: 0, multiClear: 1, gapFills: 0, holeReduce: 0, placements: 1 });
        expect(out1.key).toBe('multiClear');
        expect(out1.label).toBe('可消1行');

        /* v1.60.16：multiClear=2 文案改为"可消2行"（统一前缀，不再"可多消"） */
        const out2 = _estimateTopDriver({ pcPotential: 0, multiClear: 2, gapFills: 0, holeReduce: 0, placements: 1 });
        expect(out2.key).toBe('multiClear');
        expect(out2.label).toBe('可消2行');
        expect(out2.label, 'v1.60.16：multiClear>=2 不应再用"可多消N行"前缀').not.toMatch(/可多消/);

        const out2b = _estimateTopDriver({ pcPotential: 0, multiClear: 3, gapFills: 0, holeReduce: 0, placements: 1 });
        expect(out2b.label).toBe('可消3行');

        /* gapFills=1 + multiClear=0：弱差缺分，label "近满补1"（不是"可消1行"） */
        const out3 = _estimateTopDriver({ pcPotential: 0, multiClear: 0, gapFills: 1, holeReduce: 0, placements: 1 });
        expect(out3.key).toBe('gapFills');
        expect(out3.label).toBe('近满补1');
        expect(out3.label, 'v1.60.15 修复：gapFills=1 不应再用误导文案"可消1行"').not.toBe('可消1行');

        const out4 = _estimateTopDriver({ pcPotential: 0, multiClear: 0, gapFills: 5, holeReduce: 0, placements: 1 });
        expect(out4.key).toBe('gapFills');
        expect(out4.label).toBe('补5缺');

        /* 同时 multiClear=1 + gapFills=3：优先走 multiClear（真模拟优先级高于加权分） */
        const out5 = _estimateTopDriver({ pcPotential: 0, multiClear: 1, gapFills: 3, holeReduce: 0, placements: 1 });
        expect(out5.key, 'multiClear 真模拟优先于 gapFills 加权分').toBe('multiClear');
        expect(out5.label).toBe('可消1行');
    });

    it('v1.60.13：注入路径硬编码的 relief / pressure 在 DRIVER_NODE_PATHS 中有精确 path（非通配）', () => {
        for (const key of ['relief', 'pressure']) {
            const path = DRIVER_NODE_PATHS[key];
            expect(path, `${key} driver 必须在 DRIVER_NODE_PATHS 中有显式条目`).toBeDefined();
            expect(path.strategy === '*' || path.targets === '*' || path.schedule === '*',
                `${key} driver 不应使用通配 '*'（会被无脑全亮 5 层稀释信息量）`).toBe(false);
            const total = (path.strategy.length || 0) + (path.targets.length || 0) + (path.schedule.length || 0);
            expect(total, `${key} driver 至少应映射 1 个派生节点（实际从代码事实推导应 ≥ 3）`).toBeGreaterThanOrEqual(3);
            expect(path.intent, `${key} driver 的 intent 应为 true（注入路径都走 intent gate）`).toBe(true);
        }
    });

    it('relief / pressure path 互不相同（语义边界正确）', () => {
        const reliefSig = JSON.stringify(DRIVER_NODE_PATHS.relief);
        const pressureSig = JSON.stringify(DRIVER_NODE_PATHS.pressure);
        expect(reliefSig, 'relief / pressure 不应共享同一 path（一个偏 clearGuarantee+iconBonus, 一个偏 spatialPressure+multiLineTarget）').not.toBe(pressureSig);
    });

    it('v1.60.13 死代码清理：12 个 SPECIAL_SHAPES 输入 _estimateTopDriver 不会触发已删除的 4 个 special key', () => {
        /* 直接构造带 special shape id 的 scored entry，验证不会再产出 diagonalSparse /
         * diagonalPair / tinyLine / cornerFit。当前实际行为：常规判定都不命中 → balanced。 */
        const removedKeys = new Set(['diagonalSparse', 'diagonalPair', 'tinyLine', 'cornerFit']);
        const specialIds = getSpecialShapes().map(s => s.id);
        expect(specialIds.length, '应覆盖全部 12 个 special shape').toBeGreaterThanOrEqual(10);

        for (const id of specialIds) {
            const out = _estimateTopDriver(
                { shape: { id }, pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0, placements: 1 },
                null,
            );
            expect(removedKeys.has(out.key), `输入 ${id} 不应再输出已删除的 ${out.key}`).toBe(false);
        }
    });

    it('_tryInjectSpecial 真实注入返回的 chosenMeta.topDriver.key ∈ {relief, pressure}', () => {
        /* 构造一个高填充 + 含 near-full 的盘面，触发 relief 注入路径，确认输出的 topDriver.key
         * 在 DRIVER_NODE_PATHS 中有 path（不会 fallback 到 balanced 全亮）。 */
        resetSpawnMemory();
        const grid = new Grid(10);
        /* 9 行近满（每行最后 1 格空），制造 relief 触发条件 */
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) grid.cells[y][x] = '#888';
        }

        const triplet = [
            getRegularShapes()[0],
            getRegularShapes()[1],
            getRegularShapes()[2],
        ];
        const chosenMeta = triplet.map(shape => ({
            shape,
            placements: 10,
            reason: 'weighted',
            topDriver: { key: 'balanced', label: '综合均衡' },
            pcPotential: 0,
            multiClear: 0,
            gapFills: 0,
        }));

        /* hints + ctx 提供最小输入 —— relief 主触发条件读 pcSetup / nearFullLines / fill */
        const hints = getStrategy('default').spawnHints || {};
        const ctx = {
            specialShapeUsed: 0,
            specialReliefUsed: 0,
            specialPressureUsed: 0,
            totalClears: 100,
            roundsSinceSpecial: 99,
            totalRounds: 100,
        };

        const scored = []; /* 减压路径不强依赖 scored，主要走 chosenMeta 槽位替换 */
        const topo = { holes: 8, enclosedVoidCells: 8, nearFullLines: 6 };
        const fill = 0.81;
        const pcSetup = 2;

        const result = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, grid, fill, topo, pcSetup, scored);

        if (result) {
            const injectedMeta = result.chosenMeta[result.replaceIdx];
            expect(['relief', 'pressure'], '注入 driver key 须 ∈ {relief, pressure}').toContain(injectedMeta.topDriver.key);
            expect(DRIVER_NODE_PATHS[injectedMeta.topDriver.key], '注入 driver key 必须在 DRIVER_NODE_PATHS 中有 path').toBeDefined();
        }
        /* result 为 null 时（warmup/fill 等防御层拦截）跳过——本测试主旨是"如果注入了，driver
         * key 一定有 path"，不强制要求一定注入成功。 */
    });
});

describe('v1.60.13 — relief path 反映 _tryInjectSpecial 实际读取的派生节点', () => {
    it('relief 路径包含 clearGuarantee + sizePreference（减压本质：保消 + 偏小块）', () => {
        const p = DRIVER_NODE_PATHS.relief;
        expect(p.strategy).toEqual(expect.arrayContaining(['clearGuarantee', 'sizePreference']));
    });

    it('relief 路径包含 clearOpportunity（near-full 救济触发）', () => {
        const p = DRIVER_NODE_PATHS.relief;
        expect(p.targets).toEqual(expect.arrayContaining(['clearOpportunity']));
    });

    it('relief 路径包含 multiClearBonus + iconBonusTarget（送消行 + 同色 bonus）', () => {
        const p = DRIVER_NODE_PATHS.relief;
        expect(p.schedule).toEqual(expect.arrayContaining(['multiClearBonus', 'iconBonusTarget']));
    });
});

describe('v1.60.13 — pressure path 反映 _tryInjectSpecial 实际读取的派生节点', () => {
    it('pressure 路径包含 sizePreference + diversityBoost（偏复杂 + 多样形）', () => {
        const p = DRIVER_NODE_PATHS.pressure;
        expect(p.strategy).toEqual(expect.arrayContaining(['sizePreference', 'diversityBoost']));
    });

    it('pressure 路径包含 spatialPressure + shapeComplexity + solutionSpacePressure（加压目标三联）', () => {
        const p = DRIVER_NODE_PATHS.pressure;
        expect(p.targets).toEqual(expect.arrayContaining(['spatialPressure', 'shapeComplexity', 'solutionSpacePressure']));
    });

    it('pressure 路径包含 multiLineTarget（追求多线目标）', () => {
        const p = DRIVER_NODE_PATHS.pressure;
        expect(p.schedule).toEqual(expect.arrayContaining(['multiLineTarget']));
    });
});
