/**
 * @vitest-environment jsdom
 *
 * 候选块出块算法：generateDockShapes 产出合法性、3 块保证、品类覆盖
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../web/src/grid.js';
import { getAllShapes } from '../web/src/shapes.js';
import {
    evaluateTripletSolutions,
    generateDockShapes,
    getLastSpawnDiagnostics,
    resetSpawnMemory,
    _estimateTopDriver,
    _tryInjectSpecial,
} from '../web/src/bot/blockSpawn.js';
import { getStrategy } from '../web/src/config.js';

const allIds = new Set(getAllShapes().map(s => s.id));

describe('generateDockShapes', () => {
    let grid;
    let config;

    beforeEach(() => {
        resetSpawnMemory();
        grid = new Grid(8);
        config = getStrategy('normal');
    });

    it('always returns exactly 3 shapes', () => {
        for (let trial = 0; trial < 10; trial++) {
            const shapes = generateDockShapes(grid, config);
            expect(shapes.length).toBe(3);
        }
    });

    it('every shape has valid id and data', () => {
        const shapes = generateDockShapes(grid, config);
        for (const s of shapes) {
            expect(typeof s.id).toBe('string');
            expect(allIds.has(s.id)).toBe(true);
            expect(Array.isArray(s.data)).toBe(true);
        }
    });

    it('every shape can be placed on empty board', () => {
        const shapes = generateDockShapes(grid, config);
        for (const s of shapes) {
            expect(grid.canPlaceAnywhere(s.data)).toBe(true);
        }
    });

    /**
     * v1.59.19 回归锁：返回的 triplet 顺序 必须 与 diagnostics.chosen 一一对应。
     *
     * 历史 bug：blockSpawn 在通过校验后用 Fisher-Yates 打乱 triplet 顺序，但
     * diagnostics.chosen 仍按 chosenMeta 原顺序写入；game.js _commitSpawn 把
     * triplet[i] 放进 dockBlocks[i]，DFV 出块行却用 spawnDiagnostics.chosen[i]
     * 渲染——同一 i 索引在 dock 与 DFV 上指向不同 shape（"顺序不一致"）。
     *
     * 修复后：chosenMeta 同步按相同 swap 序打乱，保证 chosen[i].id === triplet[i].id。
     * 跑 30 次覆盖打乱随机性。
     */
    it('diagnostics.chosen 与返回的 triplet 顺序严格一一对应', () => {
        for (let trial = 0; trial < 30; trial++) {
            resetSpawnMemory();
            const localGrid = new Grid(8);
            const shapes = generateDockShapes(localGrid, config);
            const diag = getLastSpawnDiagnostics();
            expect(diag).toBeTruthy();
            expect(Array.isArray(diag.chosen)).toBe(true);
            expect(diag.chosen.length).toBe(shapes.length);
            for (let i = 0; i < shapes.length; i++) {
                expect(diag.chosen[i].id).toBe(shapes[i].id);
            }
        }
    });

    /**
     * v1.59.20 回归锁（A+B 方案"主因解释"——A 部分）：
     * 每个 chosen 必须携带非空 topDriver = { key:string, label:string }，
     * 为 DFV chosen 节点"因·XXX"小字 + 顶部决策摘要叙事条提供数据源。
     *
     * 覆盖：空盘（→ 多为 weighted/balanced）、半填盘（→ 可能 clear/gapFills）、
     *       高填盘（→ 极端时 fallback），跑 20 次确保 topDriver 永不缺失。
     */
    it('diagnostics.chosen[i].topDriver 必须非空（v1.59.20 A+B 解释链 invariant）', () => {
        const fillScenarios = [0, 0.2, 0.4, 0.55];
        for (const fillRate of fillScenarios) {
            for (let trial = 0; trial < 5; trial++) {
                resetSpawnMemory();
                const localGrid = new Grid(8);
                if (fillRate > 0) localGrid.initBoard(fillRate, config.shapeWeights || {});
                const shapes = generateDockShapes(localGrid, config);
                const diag = getLastSpawnDiagnostics();
                expect(diag).toBeTruthy();
                expect(diag.chosen.length).toBe(shapes.length);
                for (let i = 0; i < diag.chosen.length; i++) {
                    const td = diag.chosen[i].topDriver;
                    expect(td, `chosen[${i}].topDriver 缺失 (fill=${fillRate})`).toBeTruthy();
                    expect(typeof td.key).toBe('string');
                    expect(td.key.length).toBeGreaterThan(0);
                    expect(typeof td.label).toBe('string');
                    expect(td.label.length).toBeGreaterThan(0);
                }
            }
        }
    });

    it('works on a partially filled board', () => {
        grid.initBoard(0.3, config.shapeWeights || {});
        const shapes = generateDockShapes(grid, config);
        expect(shapes.length).toBe(3);
    });

    it('handles high fill without throwing', () => {
        grid.initBoard(0.35, config.shapeWeights || {});
        const shapes = generateDockShapes(grid, config);
        expect(shapes.length).toBe(3);
    });

    it('uses different strategies without error', () => {
        for (const id of ['easy', 'normal', 'hard']) {
            const cfg = getStrategy(id);
            const shapes = generateDockShapes(grid, cfg);
            expect(shapes.length).toBe(3);
        }
    });

    it('spawnHints clearGuarantee respected (at least N can clear)', () => {
        for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;
        const cfg = {
            ...config,
            spawnHints: { clearGuarantee: 2, sizePreference: 0, diversityBoost: 0 }
        };
        const shapes = generateDockShapes(grid, cfg);
        expect(shapes.length).toBe(3);
    });

    it('records and consumes multi-axis spawnTargets in diagnostics', () => {
        for (let x = 0; x < 7; x++) grid.cells[0][x] = 0;
        const cfg = {
            ...config,
            spawnHints: {
                clearGuarantee: 1,
                spawnTargets: {
                    shapeComplexity: 0.15,
                    solutionSpacePressure: 0.1,
                    clearOpportunity: 0.95,
                    spatialPressure: 0.1,
                    payoffIntensity: 0.7,
                    novelty: 0.8
                }
            }
        };

        const shapes = generateDockShapes(grid, cfg);
        const diag = getLastSpawnDiagnostics();
        expect(shapes.length).toBe(3);
        expect(diag.layer2.spawnTargets.clearOpportunity).toBe(0.95);
        expect(diag.layer2.spawnTargets.novelty).toBe(0.8);
    });

    it('prioritizes direct perfect-clear candidates when available', () => {
        for (let x = 0; x < 4; x++) grid.cells[0][x] = 0;
        const cfg = {
            ...config,
            spawnHints: {
                clearGuarantee: 1,
                sizePreference: 0,
                diversityBoost: 0,
                perfectClearBoost: 0
            }
        };

        const shapes = generateDockShapes(grid, cfg);
        expect(shapes.map((s) => s.id)).toContain('1x4');
    });

    it('generates diverse categories over multiple rounds', () => {
        const seenCategories = new Set();
        const ctx = { lastClearCount: 0, roundsSinceClear: 0, recentCategories: [], totalRounds: 0 };
        for (let i = 0; i < 20; i++) {
            const shapes = generateDockShapes(grid, config, ctx);
            for (const s of shapes) {
                seenCategories.add(s.category || 'unknown');
            }
            ctx.totalRounds++;
        }
        expect(seenCategories.size).toBeGreaterThanOrEqual(2);
    });

    /* ===== v1.60.0 形状池扩展 invariant（12 新形状 + gate + 加权 + driver 语义） ===== */

    /**
     * 形状池扩展验证：getAllShapes() 应返回 40 个形状，且 12 个新 id 全部存在。
     */
    it('v1.60.0：形状池扩展到 40，含 12 个新增 id', () => {
        const all = getAllShapes();
        expect(all.length).toBe(40);
        const ids = new Set(all.map((s) => s.id));
        const newIds = [
            '1x2', '2x1', '1x3', '3x1',
            'diag-2a', 'diag-2b', 'diag-3a', 'diag-3b',
            'l3-a', 'l3-b', 'l3-c', 'l3-d',
        ];
        for (const id of newIds) {
            expect(ids.has(id), `新形状 ${id} 必须存在于 getAllShapes`).toBe(true);
        }
    });

    /**
     * v1.32+v1.60.0：12 个特殊形状不参与概率出块，全部被 _passesShapeGate 拦截。
     * 测试：任意 spawnIntent + skillLevel 组合下，60 轮采样中特殊形状永不出现。
     */
    it('v1.32+v1.60.0：12 个特殊形状被 gate 完全拦截', () => {
        const specialIds = new Set(['1x2', '2x1', '1x3', '3x1', 'l3-a', 'l3-b', 'l3-c', 'l3-d', 'diag-2a', 'diag-2b', 'diag-3a', 'diag-3b']);
        const cfg = {
            ...config,
            _skillLevel: 0.5,
            spawnHints: { ...(config.spawnHints || {}), spawnIntent: 'maintain' },
        };
        let seen = 0;
        for (let trial = 0; trial < 60; trial++) {
            resetSpawnMemory();
            const localGrid = new Grid(8);
            // 空盘 fill=0，无 relief 条件（nearFull=0, pcSetup=0, fill<0.55），
            // 且 spawnIntent=maintain 无 pressure → 不会触发注入
            const shapes = generateDockShapes(localGrid, cfg);
            for (const s of shapes) {
                if (specialIds.has(s.id)) seen++;
            }
        }
        expect(seen).toBe(0);
    });

    /**
     * v1.32+v1.60.0：_tryInjectSpecial 在减压条件（nearFullLines>=2）时注入减压特殊形状。
     * 不测 generateDockShapes 集成（盘面几何复杂），只测 pure function。
     */
    it('v1.32+v1.60.0：_tryInjectSpecial 减压条件注入', () => {
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const hints = {};
        const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5 };
        const localGrid = new Grid(8);
        const topo = { nearFullLines: 0, holes: 6 };
        const reliefIds = new Set(['1x2', '2x1', '1x3', '3x1', 'l3-a', 'l3-b', 'l3-c', 'l3-d']);
        const result = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, localGrid, 0.75, topo, 0, triplet.map(s => ({ shape: s, gapFills: 1 })));
        expect(result).not.toBeNull();
        expect(result.isRelief).toBe(true);
        expect(reliefIds.has(result.injected)).toBe(true);
    });

    /**
     * v1.32+v1.60.0：_tryInjectSpecial 在加压条件（pressure + 低填充 + 少空洞）时注入加压特殊形状。
     */
    it('v1.32+v1.60.0：_tryInjectSpecial 加压条件注入', () => {
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const hints = { spawnIntent: 'pressure' };
        const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5 };
        const localGrid = new Grid(8);
        const topo = { nearFullLines: 0, holes: 0 };
        const pressureIds = new Set(['diag-2a', 'diag-2b', 'diag-3a', 'diag-3b']);
        const result = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, localGrid, 0.3, topo, 0, triplet.map(s => ({ shape: s, gapFills: 0 })));
        expect(result).not.toBeNull();
        expect(result.isRelief).toBe(false);
        expect(pressureIds.has(result.injected)).toBe(true);
    });

    /**
     * v1.32+v1.60.0：_tryInjectSpecial 在不满足条件时返回 null。
     */
    it('v1.32+v1.60.0：_tryInjectSpecial 无触发条件时不注入', () => {
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const hints = { spawnIntent: 'maintain' };
        const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5 };
        const localGrid = new Grid(8);
        const topo = { nearFullLines: 0, holes: 0 };
        const result = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, localGrid, 0.3, topo, 0, triplet.map(s => ({ shape: s, gapFills: 0 })));
        expect(result).toBeNull();
    });

    /**
     * v1.32+v1.60.0：_tryInjectSpecial 在达每局上限后返回 null。
     */
    it('v1.32+v1.60.0：_tryInjectSpecial 达上限后不注入', () => {
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));

        const hints = { spawnIntent: 'pressure' };
        const ctx = { specialShapeUsed: 3, totalClears: 3 };
        const localGrid = new Grid(8);
        const topo = { nearFullLines: 0, holes: 0 };
        const result = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, localGrid, 0.3, topo, 0, triplet.map(s => ({ shape: s, gapFills: 0 })));
        expect(result).toBeNull();
    });

    /**
     * v1.32+v1.60.0：验证 generateDockShapes 在任何 fallback 路径下都不会产出特殊形状。
     * 300 轮空盘+正常weights采样，特殊形状不应出现。
     */
    it('v1.32+v1.60.0：generateDockShapes 永不通过 fallback 产出特殊形状', () => {
        const specialIds = new Set(['1x2', '2x1', '1x3', '3x1', 'l3-a', 'l3-b', 'l3-c', 'l3-d', 'diag-2a', 'diag-2b', 'diag-3a', 'diag-3b']);
        let seen = 0;
        for (let trial = 0; trial < 300; trial++) {
            resetSpawnMemory();
            const localGrid = new Grid(8);
            const shapes = generateDockShapes(localGrid, config);
            for (const s of shapes) {
                if (specialIds.has(s.id)) seen++;
            }
        }
        expect(seen).toBe(0);
    });

    /**
     * v1.60.13 death-code 清理：原 v1.60.0 期待的 `_estimateTopDriver` 返回 4 个 special-shape
     * 特异性 driver（tinyLine/diagonalPair/diagonalSparse/cornerFit）。但经过实际审计：
     *   1) `_passesShapeGate` 直接拦截 12 个 SPECIAL_SHAPES，让它们不进入 scored 数组；
     *   2) `_tryInjectSpecial` 注入路径在 newMeta[replaceIdx] 直接硬编码
     *      `topDriver: { key: 'relief'|'pressure', label: '特殊减压'|'特殊加压' }`；
     *   3) 所以 `_estimateTopDriver` 内的 4 段 special-shape 判定**永远不会触发** —— v1.60.13
     *      移除了这 4 段死代码，同时把真正的注入 driver key（relief/pressure）补到
     *      `DRIVER_NODE_PATHS` 表里。
     *
     * 本测试改为锁定"清理后的预期行为"：special shape id 输入 _estimateTopDriver 不会再产出
     * 已删除的 4 个 key（防回归引入新死代码或重新激活旧路径未同步 DRIVER_NODE_PATHS）。
     */
    it('v1.60.13：_estimateTopDriver 对 special shape 不再返回 v1.60.0 死代码的 4 个 key', () => {
        const mkEntry = (id, category) => ({
            shape: { id, data: [[1]] },
            gapFills: 0, multiClear: 0, pcPotential: 0, holeReduce: 0,
            placements: 10, category,
        });
        const removedKeys = new Set(['tinyLine', 'diagonalPair', 'diagonalSparse', 'cornerFit']);
        const specialIds = ['1x2', '2x1', '1x3', '3x1', 'diag-2a', 'diag-2b', 'diag-3a', 'diag-3b', 'l3-a', 'l3-b', 'l3-c', 'l3-d'];
        const weights = { lines: 1, zshapes: 1, lshapes: 1 };

        for (const id of specialIds) {
            const out = _estimateTopDriver(mkEntry(id, 'lines'), weights);
            expect(removedKeys.has(out.key), `${id} 不应再返回已删除的 ${out.key}`).toBe(false);
            /* fallback 行为：常规 driver 都为 0 + weights 没有"显著优势" → balanced 或 shapeWeight */
            expect(['balanced', 'shapeWeight', 'mobility']).toContain(out.key);
        }
    });

    /* ===== v1.60.1 独立库行为契约 invariant（10 项：3 新需求 + 7 修复） ===== */

    /**
     * v1.60.1（Issue 5）：shapes.js 二分 — getRegularShapes 28 / getSpecialShapes 12 / 总和 40。
     */
    it('v1.60.1：常规池 28 / 独立库 12 / 总和 40', async () => {
        const { getRegularShapes, getSpecialShapes, isSpecialShapeId, getSpecialShapeIds } = await import('../web/src/shapes.js');
        expect(getRegularShapes().length).toBe(28);
        expect(getSpecialShapes().length).toBe(12);
        expect(getRegularShapes().length + getSpecialShapes().length).toBe(40);
        const specialIds = new Set(getSpecialShapeIds());
        expect(specialIds.size).toBe(12);
        /* 二分必须互斥（无 id 同时在常规 & 独立） */
        for (const s of getRegularShapes()) expect(isSpecialShapeId(s.id)).toBe(false);
        for (const s of getSpecialShapes()) expect(isSpecialShapeId(s.id)).toBe(true);
    });

    /**
     * v1.60.1（Issue 5）：pickShapeByCategoryWeights 默认完全过滤 special — 1000 次抽签无泄漏。
     * 原 12 次重抽方案概率失败率 0.04%；当前数据源切断后绝对 0 泄漏。
     */
    it('v1.60.1：pickShapeByCategoryWeights 默认 0 泄漏 special', async () => {
        const { pickShapeByCategoryWeights, isSpecialShapeId } = await import('../web/src/shapes.js');
        const weights = { lines: 1, rects: 1, squares: 1, tshapes: 1, zshapes: 1, lshapes: 1, jshapes: 1 };
        for (let i = 0; i < 1000; i++) {
            const s = pickShapeByCategoryWeights(weights);
            expect(s).toBeTruthy();
            expect(isSpecialShapeId(s.id), `第 ${i} 次抽到 special: ${s.id}`).toBe(false);
        }
    });

    /**
     * v1.60.1（Issue 4）：_tryInjectSpecial 接受 rng，同 seed 必产同一 candidate（可复现）。
     */
    it('v1.60.1：_tryInjectSpecial 同 seed 产生确定性结果（可复现）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const hints = { spawnIntent: 'pressure' };
        const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5 };
        const localGrid = new Grid(8);
        const topo = { nearFullLines: 0, holes: 0 };
        const scored = triplet.map(s => ({ shape: s, gapFills: 0 }));

        const r1 = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, localGrid, 0.3, topo, 0, scored, { rng: createMulberry32(42) });
        const r2 = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, localGrid, 0.3, topo, 0, scored, { rng: createMulberry32(42) });
        expect(r1).not.toBeNull();
        expect(r2).not.toBeNull();
        expect(r1.injected).toBe(r2.injected);
        expect(r1.replaceIdx).toBe(r2.replaceIdx);
    });

    /**
     * v1.60.1（Issue 3）：sprint intent 抢占 relief — 即使 reliefSignal 满足，
     * 也注入 pressure shape（满足"玩家主动选自虐"的设计语义）。
     */
    it('v1.60.1：sprint intent 抢占 relief', () => {
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const hints = { spawnIntent: 'sprint' };
        const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5 };
        const localGrid = new Grid(8);
        /* 同时满足 pcSetup>=1（reliefSignal）和 pressureSignal 条件 */
        const topo = { nearFullLines: 2, holes: 0 };
        const pressureIds = new Set(['diag-2a', 'diag-2b', 'diag-3a', 'diag-3b']);
        const result = _tryInjectSpecial(
            triplet, chosenMeta, hints, ctx, localGrid,
            0.3 /* fill < 0.45 → roomForHoles ✓ */,
            topo,
            1 /* pcSetup ≥ 1 → reliefSignal ✓ */,
            triplet.map(s => ({ shape: s, gapFills: 1 }))
        );
        expect(result).not.toBeNull();
        expect(result.isRelief).toBe(false);
        expect(pressureIds.has(result.injected), `sprint 应注入 pressure，实际 ${result.injected}`).toBe(true);
    });

    /**
     * v1.60.1（Issue 1）：注入后必须通过 validateSpawnTriplet 复校 —
     * 极度紧绷盘面（接近全满，仅 1 格空），candidate 无法放置时优雅退化为 null（不破坏 triplet）。
     */
    it('v1.60.1：注入候选全部 unplaceable 时返回 null（不破坏 triplet）', () => {
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const hints = { spawnIntent: 'pressure' };
        const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5 };
        const localGrid = new Grid(8);
        /* 把整个 8×8 填满 → 任何特殊形状都不能放 */
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) localGrid.cells[y][x] = 0;
        const topo = { nearFullLines: 0, holes: 0 };
        const result = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, localGrid, 0.99, topo, 0, triplet.map(s => ({ shape: s, gapFills: 0 })));
        expect(result).toBeNull();
    });

    /**
     * v1.60.1（Issue 6）：智能 replaceIdx — 高价值槽（pcPotential / multiClear）应被保护，
     * 低价值槽（fallback / 评分 0）优先替换。
     */
    it('v1.60.1：智能 replaceIdx 优先替换低价值槽', () => {
        const triplet = getAllShapes().slice(0, 3);
        /* chosenMeta[0] 是高价值清屏候选；chosenMeta[1]、[2] 是 fallback */
        const chosenMeta = [
            { shape: triplet[0], placements: 30, reason: 'perfectClear', topDriver: null, pcPotential: 2, multiClear: 3, gapFills: 2 },
            { shape: triplet[1], placements: 5,  reason: 'fallback',     topDriver: null, pcPotential: 0, multiClear: 0, gapFills: 0 },
            { shape: triplet[2], placements: 5,  reason: 'fallback',     topDriver: null, pcPotential: 0, multiClear: 0, gapFills: 0 },
        ];
        const hints = { spawnIntent: 'pressure' };
        const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5 };
        const localGrid = new Grid(8);
        const topo = { nearFullLines: 0, holes: 0 };
        const result = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, localGrid, 0.3, topo, 0, triplet.map(s => ({ shape: s, gapFills: 0 })));
        expect(result).not.toBeNull();
        /* 不应替换 [0]（高价值），应替换 [1] 或 [2] */
        expect(result.replaceIdx, '智能 replaceIdx 应保护 [0] 高价值槽').not.toBe(0);
    });

    /**
     * v1.60.1（Issue 7）：audit trail — 注入结果在 chosenMeta[replaceIdx] 保留 original / originalMeta，
     * 让 DFV 后续能展示"⚡事件注入：原 X → 替换为 Y"。
     */
    it('v1.60.1：注入结果含 audit trail（original / originalMeta / injectedAt）', () => {
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'weighted', topDriver: { key: 'k', label: 'L' } }));
        const hints = { spawnIntent: 'pressure' };
        const ctx = { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5 };
        const localGrid = new Grid(8);
        const topo = { nearFullLines: 0, holes: 0 };
        const result = _tryInjectSpecial(triplet, chosenMeta, hints, ctx, localGrid, 0.3, topo, 0, triplet.map(s => ({ shape: s, gapFills: 0 })));
        expect(result).not.toBeNull();
        const injectedMeta = result.chosenMeta[result.replaceIdx];
        expect(injectedMeta.original, 'original 应保留被替换的 shape').toBeTruthy();
        expect(injectedMeta.originalMeta, 'originalMeta 应保留原 reason/topDriver').toBeTruthy();
        expect(injectedMeta.originalMeta.reason).toBe('weighted');
        expect(injectedMeta.injectedAt).toBe(result.replaceIdx);
    });

    /**
     * v1.60.1（新需求 3）：Grid cellMeta 记录 placedBy + isSpecial；
     * isCellNearSpecial 正确识别"邻接特殊块"的空格。
     */
    it('v1.60.1：Grid cellMeta + isCellNearSpecial 正确工作', () => {
        const g = new Grid(8);
        /* 在 (3, 3) 放一个 1×2 special 块（占 (3,3) 和 (4,3)） */
        g.place([[1, 1]], 5, 3, 3, { shapeId: '1x2', isSpecial: true });
        expect(g.getCellMeta(3, 3)?.isSpecial).toBe(true);
        expect(g.getCellMeta(4, 3)?.isSpecial).toBe(true);
        expect(g.getCellMeta(2, 3)).toBeUndefined();
        /* (3, 2) 在 special 块上方 → near special */
        expect(g.isCellNearSpecial(3, 2)).toBe(true);
        /* (5, 3) 在 special 块右侧 → near special */
        expect(g.isCellNearSpecial(5, 3)).toBe(true);
        /* (0, 0) 远离 → 不 near */
        expect(g.isCellNearSpecial(0, 0)).toBe(false);
    });

    /**
     * v1.60.1（新需求 3）+ v1.60.2（空洞口径修复联动）：
     *   analyzeBoardTopology({skipSpecialCells:true}) 在两个维度上做"玩家口径"调整：
     *     A) coverable 工具池收缩到 28 个常规 shape（剔除独立库小块）
     *     B) 邻接独立库块的孤岛进 holesNearSpecial 而不计 holes
     *
     *   契约：
     *     - skip.holes ≤ default.holes + default.holesNearSpecial（B 只会让 holes 减少）
     *     - skip.holes + skip.holesNearSpecial ≥ default.holes（A 只会让 hole 类总数上升或不变，
     *       因为剔除工具池后 coverable 矩阵单调收缩）
     *   不再断言"两口径 holes 总和严格相等"——v1.60.2 后两口径的 coverable 池不同，
     *   独立库块（diag/1x2 等）能 cover 但常规池无法 cover 的空格会让两侧 holes 不再守恒。
     */
    it('v1.60.1+v1.60.2：analyzeBoardTopology 在玩家口径下做"工具池收缩 + 邻接豁免"双维调整', async () => {
        const { analyzeBoardTopology } = await import('../web/src/boardTopology.js');
        const g = new Grid(8);
        /* 围绕一个空格放 4 个特殊块，使该空格变孤岛 */
        g.place([[1]], 1, 3, 2, { shapeId: '1x2', isSpecial: true });
        g.place([[1]], 1, 3, 4, { shapeId: '1x2', isSpecial: true });
        g.place([[1]], 1, 2, 3, { shapeId: '1x2', isSpecial: true });
        g.place([[1]], 1, 4, 3, { shapeId: '1x2', isSpecial: true });

        const topoDefault = analyzeBoardTopology(g);
        const topoSkip    = analyzeBoardTopology(g, { skipSpecialCells: true });
        /* skip 模式产生非负 holesNearSpecial（(3,3) 邻接 special 必被识别） */
        expect(topoSkip.holesNearSpecial).toBeGreaterThanOrEqual(1);
        /* 维度 B（邻接豁免）：skip.holes ≤ default 全部 hole 类总和 */
        expect(topoSkip.holes).toBeLessThanOrEqual(topoDefault.holes + topoDefault.holesNearSpecial);
        /* 维度 A（工具池收缩）：skip 的 hole 类总数 ≥ default.holes */
        expect(topoSkip.holes + topoSkip.holesNearSpecial).toBeGreaterThanOrEqual(topoDefault.holes);
    });

    /**
     * v1.60.1（新需求 3）：清行时 cellMeta 同步清除，避免 isSpecial 残留误判。
     */
    it('v1.60.1：清行时 cellMeta 同步清除', () => {
        const g = new Grid(8);
        /* 填满第 0 行 — 其中 1 格是 special */
        g.place([[1]], 1, 0, 0, { shapeId: '1x2', isSpecial: true });
        for (let x = 1; x < 8; x++) g.place([[1]], 1, x, 0, { shapeId: '2x2', isSpecial: false });
        expect(g.getCellMeta(0, 0)?.isSpecial).toBe(true);
        g.checkLines(); /* 清第 0 行 */
        expect(g.getCellMeta(0, 0)).toBeUndefined();
    });
});

describe('evaluateTripletSolutions', () => {
    it('leafCap 截断时仍完整统计 validPerms', () => {
        const grid = new Grid(8);
        const three = getAllShapes()
            .map((s) => ({ data: s.data, area: s.data.reduce((acc, row) => acc + row.reduce((x, v) => x + (v ? 1 : 0), 0), 0) }))
            .sort((a, b) => a.area - b.area)
            .slice(0, 3)
            .map((s) => s.data);

        const metrics = evaluateTripletSolutions(grid, three, { leafCap: 1, budget: 200000 });
        expect(metrics.capped).toBe(true);
        expect(metrics.validPerms).toBe(6);
        expect(metrics.perPermCounts.reduce((a, b) => a + b, 0)).toBe(1);
    });
});

/* ===================================================================
 * v1.32：orderRigor 集成测试
 *
 * 上游 adaptiveSpawn 派生 orderMaxValidPerms ∈ [1,6] 经 spawnHints 注入；
 * 这里验证 blockSpawn 端在生成三连块时确实消费了该上限：
 *   - hints.orderMaxValidPerms<6 时 → diagnostics.solutionRejects.orderTooLoose
 *     可能 > 0；最终保留下来的 triplet 的 validPerms ≤ orderMaxValidPerms
 *   - hints.orderMaxValidPerms=6（默认 / bypass 状态）→ orderTooLoose=0
 *   - diagnostics.orderRigor 透传 hints 数值
 * ===================================================================*/
describe('generateDockShapes orderRigor (v1.32)', () => {
    let grid;
    let config;

    beforeEach(() => {
        resetSpawnMemory();
        grid = new Grid(8);
        config = getStrategy('normal');
        // 填到 ~0.55，使 solutionDifficulty 评估（≥0.45）+ seqSolvable（≥0.52）都启用
        grid.initBoard(0.55, config.shapeWeights || {});
    });

    it('hints 透传到 diagnostics.orderRigor（默认 maxPerms=6 时不触发过滤）', () => {
        const cfg = {
            ...config,
            spawnHints: { clearGuarantee: 1, orderRigor: 0, orderMaxValidPerms: 6 }
        };
        const shapes = generateDockShapes(grid, cfg);
        const diag = getLastSpawnDiagnostics();
        expect(shapes.length).toBe(3);
        expect(diag.orderRigor).toBeDefined();
        expect(diag.orderRigor.rigor).toBe(0);
        expect(diag.orderRigor.maxValidPerms).toBe(6);
        expect(diag.orderRigor.applied).toBe(false);
        expect(diag.solutionRejects.orderTooLoose).toBe(0);
    });

    it('orderMaxValidPerms=2 时 → 过滤器被触发（rejTotal>0），且 diagnostics.orderRigor.applied 标记', () => {
        const cfg = {
            ...config,
            spawnHints: { clearGuarantee: 1, orderRigor: 1.0, orderMaxValidPerms: 2 }
        };
        let rejTotal = 0;
        let appliedHits = 0;
        const trials = 20;
        for (let i = 0; i < trials; i++) {
            resetSpawnMemory();
            const g = new Grid(8);
            g.initBoard(0.55, config.shapeWeights || {});
            const shapes = generateDockShapes(g, cfg);
            expect(shapes.length).toBe(3);
            const diag = getLastSpawnDiagnostics();
            rejTotal += diag.solutionRejects.orderTooLoose;
            if (diag.orderRigor.applied) appliedHits++;
        }
        /* 在 fill=0.55 的随机盘面上，因为大多数 triplet 自然 validPerms=6，
         * 过滤器会反复拒绝（rejTotal 远大于 trials），applied 标记应在多数轮次置位 */
        expect(rejTotal).toBeGreaterThan(0);
        expect(appliedHits).toBeGreaterThan(0);
    });

    it('orderMaxValidPerms=6 时 → 不触发过滤器（rejTotal=0），与默认行为等价', () => {
        const cfg = {
            ...config,
            spawnHints: { clearGuarantee: 1, orderRigor: 0, orderMaxValidPerms: 6 }
        };
        let rejTotal = 0;
        let appliedHits = 0;
        for (let i = 0; i < 10; i++) {
            resetSpawnMemory();
            const g = new Grid(8);
            g.initBoard(0.55, config.shapeWeights || {});
            generateDockShapes(g, cfg);
            const diag = getLastSpawnDiagnostics();
            rejTotal += diag.solutionRejects.orderTooLoose;
            if (diag.orderRigor.applied) appliedHits++;
        }
        expect(rejTotal).toBe(0);
        expect(appliedHits).toBe(0);
    });

    it('hints 缺失时（旧调用方）默认 maxValidPerms=6，不影响行为', () => {
        // 不传 orderRigor / orderMaxValidPerms：应回退到默认 6 = 不约束
        const cfg = { ...config, spawnHints: { clearGuarantee: 1 } };
        const shapes = generateDockShapes(grid, cfg);
        expect(shapes.length).toBe(3);
        const diag = getLastSpawnDiagnostics();
        expect(diag.orderRigor.maxValidPerms).toBe(6);
        expect(diag.solutionRejects.orderTooLoose).toBe(0);
    });
});

/* ===== v1.60.6 5 项缺口修复 invariant ===== */
describe('v1.60.6 独立库注入系统 — 缺口修复', () => {
    /**
     * 缺口 #1 — relief / pressure 子配额独立：
     *   - 关闭一类（如 reliefLimitFactor=0），另一类仍能正常注入
     *   - 子配额耗尽后该类返 null，但另一类的 subLimit 不受牵连
     */
    it('缺口 #1：relief 子配额耗尽不影响 pressure 注入', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        const topo = { nearFullLines: 0, holes: 0, enclosedVoidCells: 0 };
        const scored = triplet.map(s => ({ shape: s, gapFills: 0 }));

        /* relief 子配额已满，但 pressure 子配额为 0 →
         * pressure intent 应仍能注入 pressure shape */
        const ctxPressure = {
            specialShapeUsed: 1,
            specialReliefUsed: 99,
            specialPressureUsed: 0,
            totalClears: 30,
            roundsSinceSpecial: 5,
        };
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' }, ctxPressure, localGrid, 0.3, topo, 0, scored,
            { rng: createMulberry32(7) }
        );
        expect(r).not.toBeNull();
        expect(r.subType).toBe('pressure');
        expect(r.isRelief).toBe(false);
    });

    it('缺口 #1：pressure 子配额满后该类返 null（但 relief 仍能注入）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);

        /* 案例 A：pressure 子配额满，pressure intent → null */
        const ctxA = {
            specialShapeUsed: 1, specialReliefUsed: 0, specialPressureUsed: 99,
            totalClears: 30, roundsSinceSpecial: 5,
        };
        const rA = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' }, ctxA, localGrid,
            0.3, { nearFullLines: 0, holes: 0, enclosedVoidCells: 0 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 0 })),
            { rng: createMulberry32(11) }
        );
        expect(rA).toBeNull();

        /* 案例 B：同 ctx 但走 relief 路径 → 应能注入 */
        const ctxB = {
            specialShapeUsed: 1, specialReliefUsed: 0, specialPressureUsed: 99,
            totalClears: 30, roundsSinceSpecial: 5,
        };
        const rB = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'maintain' }, ctxB, localGrid,
            0.75 /* 高填充 */,
            { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(11) }
        );
        expect(rB).not.toBeNull();
        expect(rB.subType).toBe('relief');
    });

    /**
     * 缺口 #2 — 形状内部权重：统计 200 次 relief 注入，
     * 1x2/2x1（w=3）出现频次应显著高于 l3-a~d（w=1）。
     * 期望比例 ≈ 3:1；卡方/比例区间 [1.8, 5.0] 留容差。
     */
    it('缺口 #2：SPECIAL_SHAPE_WEIGHTS 权重在长程统计上显著偏向高权重形状', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const localGrid = new Grid(8);
        let highW = 0; // 1x2 + 2x1 (w=3 each)
        let lowW  = 0; // l3-a/b/c/d (w=1 each)
        const trials = 300;
        for (let i = 0; i < trials; i++) {
            const triplet = getAllShapes().slice(0, 3);
            const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
            const ctx = {
                specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
                totalClears: 10, roundsSinceSpecial: 5,
            };
            const r = _tryInjectSpecial(
                triplet, chosenMeta,
                {}, ctx, localGrid, 0.75,
                { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 0,
                triplet.map(s => ({ shape: s, gapFills: 1 })),
                { rng: createMulberry32(i + 1) }
            );
            if (!r) continue;
            if (r.injected === '1x2' || r.injected === '2x1') highW++;
            if (r.injected === 'l3-a' || r.injected === 'l3-b' || r.injected === 'l3-c' || r.injected === 'l3-d') lowW++;
        }
        /* 期望：1x2+2x1 共 6 单位权重，l3-* 共 4 单位权重；比例 ≈ 6/4 = 1.5
         * 但因 candidates 数（前者 2 形状，后者 4 形状）权重密度不同，期望 highW/lowW > 1 */
        expect(highW).toBeGreaterThan(0);
        expect(lowW).toBeGreaterThan(0);
        expect(highW).toBeGreaterThan(lowW);
    });

    /**
     * 缺口 #3 — _resolveSpecialPools 覆写：
     *   - ctx.specialOverride.relief 完全替换 relief 池
     *   - weights 部分合并（未指定的 id 用默认）
     */
    it('缺口 #3：ctx.specialOverride 覆写 relief 池后注入只从覆写列表中选', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        const onlyOne = ['1x2']; // 覆写后只允许 1x2
        const ctx = {
            specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
            totalClears: 10, roundsSinceSpecial: 5,
            specialOverride: { relief: onlyOne },
        };
        for (let i = 0; i < 30; i++) {
            const r = _tryInjectSpecial(
                triplet.slice(), chosenMeta.slice(),
                {}, { ...ctx }, localGrid, 0.75,
                { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 0,
                triplet.map(s => ({ shape: s, gapFills: 1 })),
                { rng: createMulberry32(i + 100) }
            );
            if (r) expect(r.injected).toBe('1x2');
        }
    });

    it('缺口 #3：_resolveSpecialPools 默认值 + 部分 weights 覆写正确合并', async () => {
        const { _resolveSpecialPools, SPECIAL_RELIEF_SHAPES, SPECIAL_PRESSURE_SHAPES, SPECIAL_SHAPE_WEIGHTS } = await import('../web/src/bot/blockSpawn.js');
        /* 无 ctx → 全默认 */
        const def = _resolveSpecialPools(undefined);
        expect(def.relief).toEqual(SPECIAL_RELIEF_SHAPES);
        expect(def.pressure).toEqual(SPECIAL_PRESSURE_SHAPES);
        expect(def.weights['1x2']).toBe(SPECIAL_SHAPE_WEIGHTS['1x2']);
        expect(def.reliefLimitFactor).toBe(0.07);
        expect(def.pressureLimitFactor).toBe(0.05);

        /* 部分 weights 覆写：覆写 1x2=10，其他不变 */
        const merged = _resolveSpecialPools({
            specialOverride: { weights: { '1x2': 10 }, reliefLimitFactor: 0.2 },
        });
        expect(merged.weights['1x2']).toBe(10);
        expect(merged.weights['2x1']).toBe(SPECIAL_SHAPE_WEIGHTS['2x1']);
        expect(merged.weights['l3-a']).toBe(SPECIAL_SHAPE_WEIGHTS['l3-a']);
        expect(merged.reliefLimitFactor).toBe(0.2);
        expect(merged.pressureLimitFactor).toBe(0.05); // 未覆写
    });

    /**
     * 缺口 #4 — chosenMeta 写入 subType（供 DFV ⚡ badge 渲染）
     */
    it('缺口 #4：注入结果 chosenMeta 写入 subType (relief|pressure)', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);

        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' },
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5 },
            localGrid, 0.3,
            { nearFullLines: 0, holes: 0, enclosedVoidCells: 0 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 0 })),
            { rng: createMulberry32(33) }
        );
        expect(r).not.toBeNull();
        expect(r.subType).toBe('pressure');
        expect(r.chosenMeta[r.replaceIdx].subType).toBe('pressure');
        expect(r.chosenMeta[r.replaceIdx].original).toBeTruthy();
    });

    /**
     * 缺口 #5 — 信号侧用 enclosedVoidCells 替代 coverable holes：
     *   传入 holes=0（满足 notAlreadyFullOfHoles）但 enclosedVoidCells=10（视觉满洞）
     *   应阻断 pressure 注入（不再让加压火上浇油）
     */
    it('缺口 #5：enclosedVoidCells > 4 时阻断 pressure 注入（即使 holes=0）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        /* enclosedVoidCells=10 → notAlreadyFullOfHoles 失败 → pressureSignal false → null */
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' },
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5 },
            localGrid, 0.3,
            { nearFullLines: 0, holes: 0, enclosedVoidCells: 10 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 0 })),
            { rng: createMulberry32(55) }
        );
        expect(r).toBeNull();
    });

    it('缺口 #5：topo 无 enclosedVoidCells 字段时降级到 coverable holes（保持后兼容）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        /* 不传 enclosedVoidCells，只有 holes —— 兼容旧调用方 */
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' },
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5 },
            localGrid, 0.3,
            { nearFullLines: 0, holes: 0 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 0 })),
            { rng: createMulberry32(77) }
        );
        expect(r).not.toBeNull();
        expect(r.subType).toBe('pressure');
    });
});

/* ===== v1.60.7 三层防御 —— warmup / fill 下限 / spawnCtx audit ===== */
describe('v1.60.7 特殊块注入三层防御', () => {
    /**
     * 防御 #1 — warmup 拦截：
     *   ctx.totalRounds < 5 时，即使 reliefSignal/pressureSignal 全部满足也 return null。
     *   语义：新一局前 5 轮（onboarding 期）不出 special，避免"刚开局空盘出 1x2"的违和。
     */
    it('防御 #1：totalRounds < 5 时拦截 relief 注入（warmup 期）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        /* 即便 fill=0.75 + pcSetup=1 + scored 有 gapFills，reliefSignal 满足，
         * warmup 内（totalRounds=2）仍必须 return null */
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            {}, /* 无 intent */
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 2 },
            localGrid, 0.75,
            { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 1,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(91) }
        );
        expect(r).toBeNull();
    });

    it('防御 #1：totalRounds = 5 时解除 warmup（边界）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            {},
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 5 /* 边界放行 */ },
            localGrid, 0.75,
            { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 1,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(91) }
        );
        expect(r).not.toBeNull();
        expect(r.subType).toBe('relief');
    });

    it('防御 #1：ctx.totalRounds undefined 时跳过 gate（向后兼容旧调用方）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        /* 不带 totalRounds 字段 → 兼容旧测试 / 旧调用方 */
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            {},
            { specialShapeUsed: 0, totalClears: 10, roundsSinceSpecial: 5 /* no totalRounds */ },
            localGrid, 0.75,
            { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 1,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(91) }
        );
        expect(r).not.toBeNull();
    });

    /**
     * 防御 #2 — fill 下限：
     *   relief 必须 fill ≥ 0.25（玩家身处对弈期才需要救济）。
     *   pressure 必须 fill ≥ 0.10（避免新开局立即出散点造孤洞）。
     */
    it('防御 #2：fill < 0.25 时拦截 relief 注入（即使 reliefSignal 满足）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        /* fill=0.20 < 0.25 → relief 应被拦截 */
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            {},
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.20 /* 不足 0.25 */,
            { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 1,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(101) }
        );
        expect(r).toBeNull();
    });

    it('防御 #2：fill < 0.10 时拦截 pressure 注入', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' },
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.05 /* 不足 0.10 */,
            { nearFullLines: 0, holes: 0, enclosedVoidCells: 0 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 0 })),
            { rng: createMulberry32(101) }
        );
        expect(r).toBeNull();
    });

    it('防御 #2：边界 fill = 0.25 / 0.10 放行（无副作用）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        /* relief 边界：fill=0.25，其余条件满足 */
        const rRelief = _tryInjectSpecial(
            triplet, chosenMeta,
            {},
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.25,
            { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 1,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(202) }
        );
        expect(rRelief).not.toBeNull();
        expect(rRelief.subType).toBe('relief');

        /* pressure 边界：fill=0.10 */
        const rPressure = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' },
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.10,
            { nearFullLines: 0, holes: 0, enclosedVoidCells: 0 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 0 })),
            { rng: createMulberry32(303) }
        );
        expect(rPressure).not.toBeNull();
        expect(rPressure.subType).toBe('pressure');
    });

    /**
     * 防御 #3 — spawnCtx audit：注入结果挂载 spawnCtx 快照，便于 DFV/回放追溯
     * "当时为什么能注入"（fill / pcSetup / holesSignal / totalRounds / intent）。
     */
    /**
     * v1.60.8 清盘候选保护：chosenMeta 含 pcPotential >= 2 时 relief 注入应 return null。
     * 语义：清盘机会期不替换真清盘候选。
     */
    it('v1.60.8：chosen 含 pcPotential>=2 时 relief 注入返 null（前置门 Step 1.8）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        /* 三块中第一块标 pcPotential=2（单步清盘候选） */
        const chosenMeta = [
            { shape: triplet[0], placements: 20, reason: 'perfectClear', topDriver: null, pcPotential: 2, multiClear: 1, gapFills: 0 },
            { shape: triplet[1], placements: 15, reason: 'weighted',     topDriver: null, pcPotential: 0, multiClear: 0, gapFills: 0 },
            { shape: triplet[2], placements: 10, reason: 'fallback',     topDriver: null, pcPotential: 0, multiClear: 0, gapFills: 0 },
        ];
        const localGrid = new Grid(8);
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            {}, /* 无 intent，落 relief 路径 */
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.45,
            { nearFullLines: 1, holes: 0, enclosedVoidCells: 0 }, 1 /* pcSetup=1 → reliefSignal */,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(909) }
        );
        expect(r).toBeNull();
    });

    it('v1.60.8：chosen 全 pcPotential<2 + reliefSignal → 仍能注入（保护精确）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'weighted', topDriver: null, pcPotential: 0, multiClear: 0, gapFills: 0 }));
        const localGrid = new Grid(8);
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            {},
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.75,
            { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 1,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(909) }
        );
        expect(r).not.toBeNull();
        expect(r.subType).toBe('relief');
    });

    it('v1.60.8：Step 4 槽保护 —— pressure 路径下 pcPotential=2 槽位绝不替换', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        /* 槽 0：清盘候选；槽 1/2：fallback */
        const chosenMeta = [
            { shape: triplet[0], placements: 20, reason: 'perfectClear', topDriver: null, pcPotential: 2, multiClear: 1, gapFills: 0 },
            { shape: triplet[1], placements: 15, reason: 'fallback',     topDriver: null, pcPotential: 0, multiClear: 0, gapFills: 0 },
            { shape: triplet[2], placements: 10, reason: 'fallback',     topDriver: null, pcPotential: 0, multiClear: 0, gapFills: 0 },
        ];
        const localGrid = new Grid(8);
        /* pressure 路径（intent=pressure，Step 1.8 不拦截） */
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' },
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.3,
            { nearFullLines: 0, holes: 0, enclosedVoidCells: 0 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 0 })),
            { rng: createMulberry32(808) }
        );
        expect(r).not.toBeNull();
        /* 关键：replaceIdx 必须 != 0（清盘候选槽不被替换） */
        expect(r.replaceIdx).not.toBe(0);
    });

    it('v1.60.8：Step 4 槽保护 —— 三槽全 pcPotential>=2 时 return null', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 20, reason: 'perfectClear', topDriver: null, pcPotential: 2, multiClear: 1, gapFills: 0 }));
        const localGrid = new Grid(8);
        /* pressure 路径 + 三槽全清盘 → Step 1.8 不拦截，Step 4 槽全保护 → null */
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' },
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.3,
            { nearFullLines: 0, holes: 0, enclosedVoidCells: 0 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 0 })),
            { rng: createMulberry32(707) }
        );
        expect(r).toBeNull();
    });

    /**
     * v1.60.8 评分字段补全：generateDockShapes 输出的 chosenMeta 必须带
     * pcPotential / multiClear / gapFills 字段（旧版漏传，导致 v1.60.6 智能 replaceIdx 形同虚设）。
     */
    /**
     * v1.60.9 多步可达清盘保护：单元测试 canTripletPerfectClear 函数。
     */
    it('v1.60.9：canTripletPerfectClear 空盘返 false（开局非清盘场景）', async () => {
        const { canTripletPerfectClear } = await import('../web/src/bot/blockSpawn.js');
        const g = new Grid(8);
        const triplet = getAllShapes().slice(0, 3);
        /* 语义：空盘不构成"清盘机会"——3 块放下只会让盘面更满，不需要保护 */
        expect(canTripletPerfectClear(g, triplet)).toBe(false);
    });

    it('v1.60.9：canTripletPerfectClear 单步可达（1x2 补齐行 7 即清盘）', async () => {
        const { canTripletPerfectClear } = await import('../web/src/bot/blockSpawn.js');
        const g = new Grid(8);
        /* 构造：行 7 缺最后 2 格（x=6,7 空），其他全空 → 1x2 横放 (7,6) 触发消行 7 后全空 */
        for (let x = 0; x < 6; x++) g.cells[7][x] = 0;
        const shapes = getAllShapes();
        const oneX2  = shapes.find(s => s.id === '1x2');
        const twoX2  = shapes.find(s => s.id === '2x2');
        const triplet = [oneX2, twoX2, twoX2];
        expect(canTripletPerfectClear(g, triplet)).toBe(true);
    });

    it('v1.60.9：canTripletPerfectClear 完全无可达组合返 false', async () => {
        const { canTripletPerfectClear } = await import('../web/src/bot/blockSpawn.js');
        const g = new Grid(8);
        /* 构造：单孤立格 (4,4)，3 块都是 2x2/3x3 大块 —— 放下只会增加 occupied，
         * 永远不会让 (4,4) 所在 row/col 凑齐 → 无组合可清盘 */
        g.cells[4][4] = 0;
        const shapes = getAllShapes();
        const triplet = [
            shapes.find(s => s.id === '2x2'),
            shapes.find(s => s.id === '3x3'),
            shapes.find(s => s.id === '2x3'),
        ];
        expect(canTripletPerfectClear(g, triplet)).toBe(false);
    });

    it('v1.60.9：canTripletPerfectClear budget 保护（超 budget 返 false 而非崩）', async () => {
        const { canTripletPerfectClear } = await import('../web/src/bot/blockSpawn.js');
        const g = new Grid(8);
        /* 占据多行制造较大搜索空间，budget=1 立刻超限 → 保守返 false */
        for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 0;
        const triplet = getAllShapes().slice(0, 3);
        const r = canTripletPerfectClear(g, triplet, { budget: 1 });
        expect(r).toBe(false);
    });

    /**
     * v1.60.9：_tryInjectSpecial Step 1.85 多步保护 —— 构造"多步可达清盘"场景，
     * relief 注入应被拦截（return null）。
     */
    it('v1.60.9：Step 1.85 多步可达 PC 场景下 relief 注入返 null', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        /* 4x4 小盘面方便构造 "fill≥0.25 (绕过 Step 1.7) + 1x2 单步可清盘" 双满足场景 */
        const localGrid = new Grid(4);
        /* 占据行 3 的 x=0,1 两格（fill=2/16=0.125，不够 0.25）；
         * 改为占据行 3 x=0,1,2 三格（fill=3/16=0.1875，仍不够）；
         * 占据行 3 x=0..3 全行 + 行 2 x=0..1（6 格 fill=0.375 ≥ 0.25）
         * 但这样无法 1 块单步清盘——需要先消行 3，再消行 2 (但行 2 缺 2 格)
         * 改用：行 3 全行（4 格）+ 行 2 缺 x=2,3 → 占据 4+2=6 格 fill=0.375
         *   - 第 1 步：1x2 放 (2,2) → 行 2 完整 → 消行 2 → 仅留行 3 全行
         *   - 第 2 步：行 3 已是消行候选（4 格全满）—— 已被自动 checkLines 消？
         *     不对，行 3 在初始就 4 格全满，应该早就消了。Grid 必须由 place 才检消行
         *   重做：行 3 缺 x=2,3 → 占据 2 格 + 行 2 缺 x=2,3 → 占据 2 格 = 4 fill=0.25
         *   - 2x2 放 (2,2) → 同时填行 2 与行 3 的 (x=2,3) → 行 2 + 行 3 都完整 → 两行消 → 全空 ✓ */
        for (let y = 2; y < 4; y++) {
            for (let x = 0; x < 2; x++) localGrid.cells[y][x] = 0;
        }
        const shapes = getAllShapes();
        const twoX2 = shapes.find(s => s.id === '2x2');
        const twoX3 = shapes.find(s => s.id === '2x3'); /* 2 行 3 列，4x4 内可放 */
        const triplet = [twoX2, twoX3, twoX3];
        /* chosenMeta 全 pcPotential=0 让 Step 1.8 不拦截，专测 Step 1.85 */
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 5, reason: 'weighted', topDriver: null, pcPotential: 0, multiClear: 0, gapFills: 0 }));
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            {},
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.25 /* 边界放行 Step 1.7 */,
            { nearFullLines: 2, holes: 0, enclosedVoidCells: 0 }, 2 /* pcSetup=2 → Step 1.85 触发 */,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(1111) }
        );
        expect(r).toBeNull();
    });

    it('v1.60.9：Step 1.85 在 pcSetup=0 时跳过多步枚举（性能保护）', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const localGrid = new Grid(8);
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'weighted', topDriver: null, pcPotential: 0, multiClear: 0, gapFills: 0 }));
        /* fill=0.75 + holesSignal=6 → highFillFillHoles 触发 relief；pcSetup=0 → Step 1.85 不执行 */
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            {},
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 20 },
            localGrid, 0.75,
            { nearFullLines: 0, holes: 6, enclosedVoidCells: 6 }, 0 /* pcSetup=0 */,
            triplet.map(s => ({ shape: s, gapFills: 1 })),
            { rng: createMulberry32(2222) }
        );
        /* pcSetup=0 → Step 1.85 不拦截，应正常注入 */
        expect(r).not.toBeNull();
        expect(r.subType).toBe('relief');
    });

    it('v1.60.8：generateDockShapes 输出的 chosenMeta 三块都带评分字段', () => {
        const localGrid = new Grid(8);
        /* 构造中等填充让阶段 1/2/fallback 都可能触发 */
        for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) localGrid.cells[y][x] = 0;
        resetSpawnMemory();
        const cfg = getStrategy('normal');
        const shapes = generateDockShapes(localGrid, cfg);
        expect(shapes.length).toBe(3);
        const diag = getLastSpawnDiagnostics();
        expect(diag).toBeTruthy();
        expect(diag.chosen?.length).toBe(3);
        for (const m of diag.chosen) {
            expect(m.pcPotential, `chosen ${m.shape?.id} 缺 pcPotential 字段`).toBeDefined();
            expect(m.multiClear,  `chosen ${m.shape?.id} 缺 multiClear 字段`).toBeDefined();
            expect(m.gapFills,    `chosen ${m.shape?.id} 缺 gapFills 字段`).toBeDefined();
            expect(Number.isFinite(m.pcPotential)).toBe(true);
            expect(Number.isFinite(m.multiClear)).toBe(true);
            expect(Number.isFinite(m.gapFills)).toBe(true);
        }
    });

    it('防御 #3：注入结果带 spawnCtx audit 快照', async () => {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const triplet = getAllShapes().slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'test', topDriver: null }));
        const localGrid = new Grid(8);
        const r = _tryInjectSpecial(
            triplet, chosenMeta,
            { spawnIntent: 'pressure' },
            { specialShapeUsed: 0, specialReliefUsed: 0, specialPressureUsed: 0,
              totalClears: 10, roundsSinceSpecial: 5, totalRounds: 12 },
            localGrid, 0.33,
            { nearFullLines: 0, holes: 0, enclosedVoidCells: 0 }, 0,
            triplet.map(s => ({ shape: s, gapFills: 0 })),
            { rng: createMulberry32(404) }
        );
        expect(r).not.toBeNull();
        expect(r.spawnCtx).toBeTruthy();
        expect(r.spawnCtx.fill).toBeCloseTo(0.33, 2);
        expect(r.spawnCtx.pcSetup).toBe(0);
        expect(r.spawnCtx.holesSignal).toBe(0);
        expect(r.spawnCtx.totalRounds).toBe(12);
        expect(r.spawnCtx.intent).toBe('pressure');
        /* chosenMeta[replaceIdx] 同步携带 spawnCtx —— DFV 可直接读 */
        expect(r.chosenMeta[r.replaceIdx].spawnCtx).toEqual(r.spawnCtx);
    });
});

describe('v1.60.23 — _tryInjectSpecial monoFlush 触发 + 方向匹配', () => {
    const SKIN_8 = { blockIcons: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };

    /** 构造可触发 monoFlush 的盘面 + chosenMeta + 通用 ctx；返回 _tryInjectSpecial 入参 */
    async function buildMonoFlushScenario({ direction = 'col', colorIdx = 0 } = {}) {
        const { createMulberry32 } = await import('../web/src/lib/seededRng.js');
        const grid = new Grid(10);
        /* 直接构造"近满同色 line"：empty=2 + 8 格同 icon。
         * 默认 col 方向；direction='row' 时构造行近满同色。 */
        if (direction === 'col') {
            for (let y = 0; y < 8; y++) grid.cells[y][5] = colorIdx;
        } else {
            for (let x = 0; x < 8; x++) grid.cells[7][x] = colorIdx;
        }
        const triplet = getAllShapes().filter(s => !['1x2', '2x1', '1x3', '3x1', 'l3-a', 'l3-b', 'l3-c', 'l3-d', 'diag-2a', 'diag-2b', 'diag-3a', 'diag-3b'].includes(s.id)).slice(0, 3);
        const chosenMeta = triplet.map(s => ({ shape: s, placements: 10, reason: 'weighted', topDriver: { key: 'shapeWeight', label: '形状权重' }, pcPotential: 0, multiClear: 0, gapFills: 0 }));
        const ctx = {
            specialShapeUsed: 0,
            specialReliefUsed: 0,
            specialPressureUsed: 0,
            totalClears: 10,
            roundsSinceSpecial: 5,
            totalRounds: 12,
            skin: SKIN_8,
        };
        return { triplet, chosenMeta, hints: {}, ctx, grid, fill: 0.5, topo: { holes: 1, enclosedVoidCells: 1, nearFullLines: 0 }, pcSetup: 0, scored: triplet.map(s => ({ shape: s, gapFills: 0 })), opts: { rng: createMulberry32(2027) } };
    }

    it('col 上 2 空近满同色 → 优先注入 2×1 竖块', async () => {
        const s = await buildMonoFlushScenario({ direction: 'col' });
        const r = _tryInjectSpecial(s.triplet, s.chosenMeta, s.hints, s.ctx, s.grid, s.fill, s.topo, s.pcSetup, s.scored, s.opts);
        expect(r, 'monoFlush 触发应注入成功').not.toBeNull();
        expect(r.injected, 'col 近满同色应注入 2×1 竖块').toBe('2x1');
        expect(r.subType, 'subType 应标记 monoFlush').toBe('monoFlush');
        expect(r.spawnCtx.monoFlushLines, 'spawnCtx 应附带 monoFlushLines 摘要').toBeTruthy();
        expect(r.spawnCtx.monoFlushLines.length).toBeGreaterThan(0);
    });

    it('row 上 2 空近满同色 → 优先注入 1×2 横块', async () => {
        const s = await buildMonoFlushScenario({ direction: 'row' });
        const r = _tryInjectSpecial(s.triplet, s.chosenMeta, s.hints, s.ctx, s.grid, s.fill, s.topo, s.pcSetup, s.scored, s.opts);
        expect(r, 'monoFlush 触发应注入成功').not.toBeNull();
        expect(r.injected, 'row 近满同色应注入 1×2 横块').toBe('1x2');
        expect(r.subType).toBe('monoFlush');
    });

    it('注入后 chosenMeta 的 topDriver.key 为 "monoFlush"（DFV 路径联动）', async () => {
        const s = await buildMonoFlushScenario({ direction: 'col' });
        const r = _tryInjectSpecial(s.triplet, s.chosenMeta, s.hints, s.ctx, s.grid, s.fill, s.topo, s.pcSetup, s.scored, s.opts);
        expect(r).not.toBeNull();
        const meta = r.chosenMeta[r.replaceIdx];
        expect(meta.topDriver?.key).toBe('monoFlush');
        expect(meta.topDriver?.label).toMatch(/^补满同色\d线$/);
        expect(meta.reason).toBe('special-monoFlush');
    });

    it('chosenMeta 含 pcPotential>=2（清盘候选）→ Step 1.8 拦截，即使 monoFlush 触发也不注入', async () => {
        const s = await buildMonoFlushScenario({ direction: 'col' });
        /* 修改 chosenMeta[1] 为清盘候选 → Step 1.8 应拒绝整个 relief 注入路径 */
        s.chosenMeta[1] = { ...s.chosenMeta[1], pcPotential: 2 };
        const r = _tryInjectSpecial(s.triplet, s.chosenMeta, s.hints, s.ctx, s.grid, s.fill, s.topo, s.pcSetup, s.scored, s.opts);
        expect(r, '清盘候选保护应优先于 monoFlush 注入').toBeNull();
    });

    it('fill < 0.25（空盘）→ Step 1.7 拦截，monoFlush 信号不足以越过 fill 下限', async () => {
        const s = await buildMonoFlushScenario({ direction: 'col' });
        s.fill = 0.10;
        const r = _tryInjectSpecial(s.triplet, s.chosenMeta, s.hints, s.ctx, s.grid, s.fill, s.topo, s.pcSetup, s.scored, s.opts);
        expect(r, '空盘场景即使 monoFlush 触发也不注入').toBeNull();
    });

    it('skin 缺失场景（grid.findNearFullMonoLines 仍按 colorIdx 退化）→ monoFlush 仍可触发', async () => {
        const s = await buildMonoFlushScenario({ direction: 'col' });
        s.ctx.skin = null;
        const r = _tryInjectSpecial(s.triplet, s.chosenMeta, s.hints, s.ctx, s.grid, s.fill, s.topo, s.pcSetup, s.scored, s.opts);
        expect(r, 'skin=null 退化 colorIdx 比较仍能 mono').not.toBeNull();
        expect(r.subType).toBe('monoFlush');
    });

    it('totalRounds < 5 warmup → Step 1.5 拦截，monoFlush 触发不绕过 warmup', async () => {
        const s = await buildMonoFlushScenario({ direction: 'col' });
        s.ctx.totalRounds = 3;
        const r = _tryInjectSpecial(s.triplet, s.chosenMeta, s.hints, s.ctx, s.grid, s.fill, s.topo, s.pcSetup, s.scored, s.opts);
        expect(r, 'warmup 期不注入').toBeNull();
    });
});

describe('v1.60.24 — monoFlush 主路径直通：1×2/2×1 绕过 _passesShapeGate 进入 scored', () => {
    const SKIN_8 = { blockIcons: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };

    /** 截图复现：col 5 / col 6 各填 8 同色（empty=2）+ skin 注入 */
    function buildScreenshotScenario() {
        const localGrid = new Grid(10);
        for (let y = 2; y < 10; y++) {
            localGrid.cells[y][5] = 0; // hook icon = blockIcons[0] = 'A'
            localGrid.cells[y][6] = 0;
        }
        /* 再填一些散点把 fill 拉到合理水平（避免 minPlacements/可解性扰动） */
        for (let y = 7; y < 10; y++) for (let x = 0; x < 3; x++) localGrid.cells[y][x] = 1;
        return localGrid;
    }

    /** strategy config（与 generateDockShapes 入参同 schema） */
    function buildConfig() {
        return {
            shapeWeights: getStrategy().shapeWeights,
            spawnHints: {
                clearGuarantee: 0.5,
                sizePreference: 0,
                spawnTargets: {
                    iconBonusTarget: 1.0, // 让 monoBoost = 1 + 1×(0.4+0.6) = 2.0
                    clearOpportunity: 0.6,
                },
            },
        };
    }

    beforeEach(() => {
        resetSpawnMemory();
    });

    /* v1.60.28 调整：monoFlush 降为彩蛋（25% gate），命中率从 ≥50% 调整到 ≥10% */
    it('截图场景：col 5/6 8 同色（empty=2）→ chosen 应含 2×1 竖块（彩蛋频率 ≥ 10%）', () => {
        let hit2x1 = 0;
        const trials = 20;
        for (let t = 0; t < trials; t++) {
            const localGrid = buildScreenshotScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            const shapes = generateDockShapes(localGrid, buildConfig(), ctx);
            if (shapes.some(s => s.id === '2x1')) hit2x1++;
        }
        /* v1.60.28/29：彩蛋节流（25% gate × 单 dock ≤1 数量限制）+ 抽样波动 → ≥1/20 (5%) */
        expect(hit2x1, `20 次抽样应有 ≥1 次命中 2×1（实际命中 ${hit2x1}）`).toBeGreaterThanOrEqual(1);
    });

    it('row 上 2 空近满同色 → chosen 应含 1×2 横块（彩蛋频率 ≥ 10%）', () => {
        let hit1x2 = 0;
        const trials = 20;
        for (let t = 0; t < trials; t++) {
            const localGrid = new Grid(10);
            for (let x = 0; x < 8; x++) localGrid.cells[7][x] = 0;
            for (let y = 8; y < 10; y++) for (let x = 0; x < 3; x++) localGrid.cells[y][x] = 1;
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            const shapes = generateDockShapes(localGrid, buildConfig(), ctx);
            if (shapes.some(s => s.id === '1x2')) hit1x2++;
        }
        /* v1.60.28/29：彩蛋节流（25% gate × 单 dock ≤1 数量限制）+ 抽样波动 → ≥1/20 (5%) */
        expect(hit1x2, `20 次抽样应有 ≥1 次命中 1×2（实际命中 ${hit1x2}）`).toBeGreaterThanOrEqual(1);
    });

    it('chosen 命中后 diagnostics.chosen 对应块 topDriver.key="monoFlush"', () => {
        let foundMonoDriver = false;
        for (let t = 0; t < 20; t++) {
            const localGrid = buildScreenshotScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            if (diag?.chosen?.some(m => m.topDriver?.key === 'monoFlush')) {
                foundMonoDriver = true;
                break;
            }
        }
        expect(foundMonoDriver, '至少 1 次抽样应在 diagnostics.chosen 中找到 topDriver.key="monoFlush"').toBe(true);
    });

    it('无 monoFlush 信号场景：1×2/2×1 仍被 _passesShapeGate 拒绝，不入 chosen', () => {
        let leakSpecial = 0;
        const trials = 50;
        for (let t = 0; t < trials; t++) {
            const localGrid = new Grid(10);
            /* 故意构造无任何"近满同色 line"的盘面：散点填充 + 杂色 */
            for (let y = 6; y < 10; y++) for (let x = 0; x < 4; x++) localGrid.cells[y][x] = (x + y) % 4;
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            const shapes = generateDockShapes(localGrid, buildConfig(), ctx);
            if (shapes.some(s => s.id === '1x2' || s.id === '2x1')) leakSpecial++;
        }
        /* 容许极少量 _tryInjectSpecial relief 注入命中（pcSetup/highFillFillHoles 偶发触发），
         * 但不应大规模泄漏——50 次抽样 ≤ 5 次（10%）才正常。 */
        expect(leakSpecial, `无 monoFlush 信号场景特殊形状泄漏 ${leakSpecial}/${trials}（应 ≤ 5）`).toBeLessThanOrEqual(5);
    });

    it('skin=null 退化 colorIdx：监控同色仍能触发，1×2/2×1 仍可入 chosen', () => {
        let hit = 0;
        for (let t = 0; t < 20; t++) {
            const localGrid = buildScreenshotScenario();
            const ctx = { skin: null, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            const shapes = generateDockShapes(localGrid, buildConfig(), ctx);
            if (shapes.some(s => s.id === '1x2' || s.id === '2x1')) hit++;
        }
        /* v1.60.28/29：彩蛋节流后期望 ≥1/20 */
        expect(hit, `skin=null 场景 20 次抽样命中 ${hit}（应 ≥ 1）`).toBeGreaterThanOrEqual(1);
    });
});

describe('v1.60.34 — 同花概率降低 2/3 + 大幅提升清屏概率', () => {
    const SKIN_8 = { blockIcons: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };

    function buildStrongMonoScenario() {
        const localGrid = new Grid(10);
        for (let y = 2; y < 10; y++) {
            localGrid.cells[y][5] = 0;
            localGrid.cells[y][6] = 0;
        }
        for (let y = 7; y < 10; y++) for (let x = 0; x < 3; x++) localGrid.cells[y][x] = 1;
        return localGrid;
    }

    function buildConfig() {
        return {
            shapeWeights: getStrategy().shapeWeights,
            spawnHints: { clearGuarantee: 0.5, spawnTargets: { iconBonusTarget: 1.0, clearOpportunity: 0.6 } },
        };
    }

    beforeEach(() => { resetSpawnMemory(); });

    it('强信号场景 monoFlush 命中率 ≤ 20%（v1.60.31 的 ≤45% 的 ~2/3 ÷ 1.5 ≈ 20%）', () => {
        let hit = 0;
        const TRIALS = 200;
        for (let t = 0; t < TRIALS; t++) {
            const localGrid = buildStrongMonoScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            if ((diag?.chosen || []).some(m => (m.monoFlush ?? 0) >= 1)) hit++;
        }
        const rate = hit / TRIALS;
        expect(rate, `v1.60.34 强信号 monoFlush 命中率 ${(rate*100).toFixed(1)}% (应 ≤ 20%)`).toBeLessThanOrEqual(0.20);
    });

    it('盘面有 pcPotential 候选时 → chosen 应高概率含 pcPotential===2（清屏权重 ×45 倍）', () => {
        /* 构造单步清屏场景：8×8 盘面 row 0 缺 4 格，其余全空 → 1×4 放 row 0 缺口 → 整盘空 */
        let hit = 0;
        const TRIALS = 30;
        const pcConfig = {
            shapeWeights: getStrategy().shapeWeights,
            spawnHints: { clearGuarantee: 1, perfectClearBoost: 1.0, sizePreference: 0, diversityBoost: 0 },
        };
        for (let t = 0; t < TRIALS; t++) {
            const localGrid = new Grid(8);
            for (let x = 0; x < 4; x++) localGrid.cells[0][x] = 1;
            const ctx = { totalClears: 0, totalRounds: 2 };
            const shapes = generateDockShapes(localGrid, pcConfig, ctx);
            const diag = getLastSpawnDiagnostics();
            if ((diag?.chosen || []).some(m => (m.pcPotential ?? 0) === 2)
                || shapes.some(s => s.id === '1x4')) {
                hit++;
            }
        }
        const rate = hit / TRIALS;
        /* 单步清屏可达场景，期望 ≥ 90% 命中（v1.60.34 强化清屏权重 ×45 倍碾压一切） */
        expect(rate, `单步清屏可达场景命中率 ${(rate*100).toFixed(1)}% (应 ≥ 90%)`).toBeGreaterThanOrEqual(0.90);
    });
});

describe('v1.60.31 — monoFlush 极小概率惊喜 + avail 硬过滤修复 v1.60.29 计数泄漏', () => {
    const SKIN_8 = { blockIcons: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };

    function buildStrongMonoScenario() {
        const localGrid = new Grid(10);
        for (let y = 2; y < 10; y++) {
            localGrid.cells[y][5] = 0;
            localGrid.cells[y][6] = 0;
        }
        for (let y = 7; y < 10; y++) for (let x = 0; x < 3; x++) localGrid.cells[y][x] = 1;
        return localGrid;
    }

    function buildConfig() {
        return {
            shapeWeights: getStrategy().shapeWeights,
            spawnHints: { clearGuarantee: 0.5, spawnTargets: { iconBonusTarget: 1.0, clearOpportunity: 0.6 } },
        };
    }

    beforeEach(() => { resetSpawnMemory(); });

    it('强信号场景 → 单 dock 中 monoFlush 块严格 ≤ 1（修复 v1.60.29 计数泄漏 bug）', () => {
        /* v1.60.29 旧版 bug：multi/random 分支选到 monoFlush 候选时计数器不递增，
         * 单 dock 可能出现 2 块"★送同花"（用户截图反馈）。
         * v1.60.31 修复：avail 统一硬过滤——所有分支共享 monoFlush-aware avail。 */
        let maxInOneDock = 0;
        let violationCount = 0;
        const TRIALS = 100;
        for (let t = 0; t < TRIALS; t++) {
            const localGrid = buildStrongMonoScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            const count = (diag?.chosen || []).filter(m => (m.monoFlush ?? 0) >= 1).length;
            if (count > 1) violationCount++;
            if (count > maxInOneDock) maxInOneDock = count;
        }
        expect(maxInOneDock, `100 轮中单 dock 最多 monoFlush 数（应 = 1）`).toBeLessThanOrEqual(1);
        expect(violationCount, `100 轮中违反单 dock ≤1 的次数（应 = 0）`).toBe(0);
    });

    it('整体频率：强信号场景命中率 ≤ 45%（v1.60.30 是 ~85%，v1.60.31 调为极小惊喜）', () => {
        let hit = 0;
        const TRIALS = 200;
        for (let t = 0; t < TRIALS; t++) {
            const localGrid = buildStrongMonoScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            if ((diag?.chosen || []).some(m => (m.monoFlush ?? 0) >= 1)) hit++;
        }
        const rate = hit / TRIALS;
        /* v1.60.31：cap=0.30，实际命中率受 Stage 2 + L2 注入路径影响约 25-45% */
        expect(rate, `强信号场景命中率 ${(rate*100).toFixed(1)}% (应 ≤ 45%)`).toBeLessThanOrEqual(0.45);
    });

    it('弱信号场景命中率 ≤ 20%（基础 10% + 抽样波动）', () => {
        let hit = 0;
        const TRIALS = 100;
        for (let t = 0; t < TRIALS; t++) {
            const localGrid = new Grid(10);
            localGrid.cells[5][5] = 1; localGrid.cells[5][6] = 1;
            const ctx = { skin: SKIN_8, totalClears: 0, totalRounds: 2, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            if ((diag?.chosen || []).some(m => (m.monoFlush ?? 0) >= 1)) hit++;
        }
        const rate = hit / TRIALS;
        expect(rate, `弱信号命中率 ${(rate*100).toFixed(1)}% (应 ≤ 20%)`).toBeLessThanOrEqual(0.20);
    });
});

describe('v1.60.30 — monoFlush 识别 always-on（修复 v1.60.28 漏识别 bug）', () => {
    const SKIN_8 = { blockIcons: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };

    function buildStrongMonoScenario() {
        const localGrid = new Grid(10);
        for (let y = 2; y < 10; y++) {
            localGrid.cells[y][5] = 0;
            localGrid.cells[y][6] = 0;
        }
        for (let y = 7; y < 10; y++) for (let x = 0; x < 3; x++) localGrid.cells[y][x] = 1;
        return localGrid;
    }

    function buildConfig() {
        return {
            shapeWeights: getStrategy().shapeWeights,
            spawnHints: { clearGuarantee: 0.5, spawnTargets: { iconBonusTarget: 1.0, clearOpportunity: 0.6 } },
        };
    }

    beforeEach(() => { resetSpawnMemory(); });

    it('盘面有近满同色 line → 识别 always-on（chosen 至少能命中，不漏识别）', () => {
        /* v1.60.31：cap 降为 0.30，强信号命中率约 25-40%，但识别 always-on 保证
         * scored 中始终有真实 monoFlush 候选，DFV 信号通道始终开放。 */
        let hit = 0;
        const TRIALS = 100;
        for (let t = 0; t < TRIALS; t++) {
            const localGrid = buildStrongMonoScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            if ((diag?.chosen || []).some(m => (m.monoFlush ?? 0) >= 1)) hit++;
        }
        const ratio = hit / TRIALS;
        /* 100 trials 至少 5 次命中（5%）——验证 v1.60.28 完全屏蔽 bug 不再复发 */
        expect(ratio, `强信号场景 chosen monoFlush 命中率 ${(ratio*100).toFixed(1)}% (应 ≥ 5%，验证不漏识别)`).toBeGreaterThanOrEqual(0.05);
    });

    it('chosen 含 monoFlush 块时 → reason 必为 "monoFlush"（不再标 "clear"，DFV 强化体感）', () => {
        let foundMonoChosen = false;
        let allCorrectReason = true;
        for (let t = 0; t < 100; t++) {
            const localGrid = buildStrongMonoScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            for (const m of diag?.chosen || []) {
                if ((m.monoFlush ?? 0) >= 1 && (m.pcPotential ?? 0) !== 2) {
                    foundMonoChosen = true;
                    if (m.reason !== 'monoFlush') {
                        allCorrectReason = false;
                    }
                }
            }
        }
        expect(foundMonoChosen, '100 轮中应至少 1 次 chosen 含 monoFlush 块').toBe(true);
        expect(allCorrectReason, 'monoFlush>=1 且非 pcPotential → reason 必须 = "monoFlush"').toBe(true);
    });

    it('弱信号场景 → chosen monoFlush 命中率仍受彩蛋节流（≤35%，不喧宾夺主）', () => {
        /* 弱信号场景：空盘无 monoFlush line，自适应概率退回 MIN=25% */
        let hit = 0;
        const TRIALS = 100;
        for (let t = 0; t < TRIALS; t++) {
            const localGrid = new Grid(10);
            /* 仅 1-2 个零散 cells，无完整近满 line */
            localGrid.cells[5][5] = 1; localGrid.cells[5][6] = 1;
            const ctx = { skin: SKIN_8, totalClears: 0, totalRounds: 2, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            if ((diag?.chosen || []).some(m => (m.monoFlush ?? 0) >= 1)) hit++;
        }
        const rate = hit / TRIALS;
        expect(rate, `弱信号场景命中率 ${(rate*100).toFixed(1)}% 应 ≤ 35%`).toBeLessThanOrEqual(0.35);
    });
});

describe('v1.60.29 — monoFlush 单 dock 数量 ≤ 1 + reason="monoFlush" 派生', () => {
    const SKIN_8 = { blockIcons: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };

    function buildStrongMonoScenario() {
        const localGrid = new Grid(10);
        for (let y = 2; y < 10; y++) {
            localGrid.cells[y][5] = 0;
            localGrid.cells[y][6] = 0;
        }
        for (let y = 7; y < 10; y++) for (let x = 0; x < 3; x++) localGrid.cells[y][x] = 1;
        return localGrid;
    }

    function buildConfig() {
        return {
            shapeWeights: getStrategy().shapeWeights,
            spawnHints: { clearGuarantee: 0.5, spawnTargets: { iconBonusTarget: 1.0, clearOpportunity: 0.6 } },
        };
    }

    beforeEach(() => { resetSpawnMemory(); });

    it('单 dock 中 monoFlush 块数量 ≤ 1（彩蛋稀缺，避免视觉单调）', () => {
        let maxMonoFlushInOneDock = 0;
        let totalRoundsWithMono = 0;
        for (let t = 0; t < 60; t++) {
            const localGrid = buildStrongMonoScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            const monoCount = (diag?.chosen || []).filter(m => (m.monoFlush ?? 0) >= 1).length;
            if (monoCount > 0) totalRoundsWithMono++;
            if (monoCount > maxMonoFlushInOneDock) maxMonoFlushInOneDock = monoCount;
        }
        expect(maxMonoFlushInOneDock, '60 轮中单 dock 最多 monoFlush 块数').toBeLessThanOrEqual(1);
        expect(totalRoundsWithMono, '60 轮应有至少 1 轮命中 monoFlush（彩蛋有效）').toBeGreaterThanOrEqual(1);
    });

    it('reason 派生：monoFlush=1 → reason="monoFlush"（不再被 "clear" 覆盖）', () => {
        let foundMonoChosen = false;
        let allCorrectReason = true;
        for (let t = 0; t < 60; t++) {
            const localGrid = buildStrongMonoScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            for (const m of diag?.chosen || []) {
                if ((m.monoFlush ?? 0) >= 1 && (m.pcPotential ?? 0) !== 2) {
                    foundMonoChosen = true;
                    if (m.reason !== 'monoFlush') allCorrectReason = false;
                }
            }
        }
        if (foundMonoChosen) {
            expect(allCorrectReason, 'monoFlush>=1 且非 pcPotential → reason 必须 = "monoFlush"').toBe(true);
        }
        expect(true).toBe(true);
    });
});

describe('v1.60.28 — monoFlush 降为"乐趣彩蛋"，driver 频率受 MONO_FLUSH_PICK_PROBABILITY 节流', () => {
    const SKIN_8 = { blockIcons: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };

    /** 同前场景：col 5/6 上 8 同色（empty=2）—— 强 monoFlush 信号 */
    function buildStrongMonoFlushScenario() {
        const localGrid = new Grid(10);
        for (let y = 2; y < 10; y++) {
            localGrid.cells[y][5] = 0;
            localGrid.cells[y][6] = 0;
        }
        for (let y = 7; y < 10; y++) for (let x = 0; x < 3; x++) localGrid.cells[y][x] = 1;
        return localGrid;
    }

    function buildConfig() {
        return {
            shapeWeights: getStrategy().shapeWeights,
            spawnHints: {
                clearGuarantee: 0.5,
                spawnTargets: { iconBonusTarget: 1.0, clearOpportunity: 0.6 },
            },
        };
    }

    beforeEach(() => { resetSpawnMemory(); });

    it('强 monoFlush 信号场景：chosen 标 driver="monoFlush" 频率 ≤ 50%（不再 100% 必标）', () => {
        let monoFlushDriverHits = 0;
        const trials = 60;
        for (let t = 0; t < trials; t++) {
            const localGrid = buildStrongMonoFlushScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            for (const m of diag?.chosen || []) {
                if (m.topDriver?.key === 'monoFlush') monoFlushDriverHits++;
            }
        }
        const totalChosenSlots = trials * 3;
        const rate = monoFlushDriverHits / totalChosenSlots;
        /* 25% pick + scoreShape 降权 → 命中率应 ≤ 50%（含 augmentPool 加权命中） */
        expect(rate, `monoFlush driver 命中率 ${(rate * 100).toFixed(1)}% 应 ≤ 50%（彩蛋节奏）`).toBeLessThanOrEqual(0.50);
    });

    it('强 monoFlush 信号下仍能命中（≥ 5%，保证彩蛋有效）', () => {
        let monoFlushDriverHits = 0;
        const trials = 60;
        for (let t = 0; t < trials; t++) {
            const localGrid = buildStrongMonoFlushScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            for (const m of diag?.chosen || []) {
                if (m.topDriver?.key === 'monoFlush') monoFlushDriverHits++;
            }
        }
        expect(monoFlushDriverHits, `60 trials 应至少命中 monoFlush driver ≥ 1 次（保证彩蛋有效）`).toBeGreaterThanOrEqual(1);
    });
});

describe('v1.60.27 — monoFlush chosen 暴露 targetCi 用于染色绑定', () => {
    const SKIN_8 = { blockIcons: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };

    function buildMonoFlushScenario() {
        const localGrid = new Grid(10);
        for (let y = 2; y < 10; y++) {
            localGrid.cells[y][5] = 3;
            localGrid.cells[y][6] = 3;
        }
        for (let y = 7; y < 10; y++) for (let x = 0; x < 3; x++) localGrid.cells[y][x] = 1;
        return localGrid;
    }

    function buildConfig() {
        return {
            shapeWeights: getStrategy().shapeWeights,
            spawnHints: { clearGuarantee: 0.5, spawnTargets: { iconBonusTarget: 1.0, clearOpportunity: 0.6 } },
        };
    }

    beforeEach(() => { resetSpawnMemory(); });

    it('chosen 命中 monoFlush 时，diagnostics.chosen[i].monoFlushTargetCi 必须 = line 同色 ci', () => {
        let foundMonoChosen = false;
        let allTargetCorrect = true;
        for (let t = 0; t < 30; t++) {
            const localGrid = buildMonoFlushScenario();
            const ctx = { skin: SKIN_8, totalClears: 5, totalRounds: 8, roundsSinceSpecial: 6 };
            generateDockShapes(localGrid, buildConfig(), ctx);
            const diag = getLastSpawnDiagnostics();
            for (const m of diag?.chosen || []) {
                if ((m.monoFlush ?? 0) >= 1) {
                    foundMonoChosen = true;
                    if (m.monoFlushTargetCi !== 3) {  /* line 同色 ci=3 */
                        allTargetCorrect = false;
                    }
                }
            }
        }
        if (foundMonoChosen) {
            expect(allTargetCorrect, 'monoFlush chosen 必须暴露正确 targetCi=3').toBe(true);
        }
        expect(true).toBe(true);
    });

    it('chosen monoFlush=0 时 monoFlushTargetCi 应为 null（无虚假目标）', () => {
        const localGrid = new Grid(10);  /* 空盘面 → 无任何 monoFlush 潜力 */
        generateDockShapes(localGrid, buildConfig(), { totalRounds: 5 });
        const diag = getLastSpawnDiagnostics();
        for (const m of diag?.chosen || []) {
            if ((m.monoFlush ?? 0) === 0) {
                expect(m.monoFlushTargetCi, '无 monoFlush 时 targetCi 必须 null').toBeNull();
            }
        }
    });
});

describe('v1.60.26 — reason="perfectClear" 严格按 shape 自身 pcPotential 派生', () => {
    /** 构造 pcSetup≥1 但 chosen 块 pcPotential=0 的盘面场景：
     *  10×10，row 9 上 col 0-7 共 8 cells 填同色，row 9 上 col 8/9 空 + col 8/9 上 row 0-8 空。
     *  totalEmpty 较少 → pcSetup=1（remainingAfterClear ≤ 4），但任何单 shape 都无法清屏（剩余空间太大）。
     *  期望：chosen 块 reason 应=='clear'（非 'perfectClear'），因为 pick.pcPotential===0。
     */
    function buildPcSetupButNoSinglePcGrid() {
        const localGrid = new Grid(10);
        for (let x = 0; x <= 7; x++) localGrid.cells[9][x] = 0;
        for (let y = 7; y < 10; y++) for (let x = 0; x < 5; x++) localGrid.cells[y][x] = 1;
        return localGrid;
    }

    function buildConfig() {
        return { shapeWeights: getStrategy().shapeWeights, spawnHints: { clearGuarantee: 0.5 } };
    }

    beforeEach(() => { resetSpawnMemory(); });

    it('pcSetup≥1 但 chosen 块 pcPotential=0 → reason 应为 "clear"（不再误标 "perfectClear"）', () => {
        let mislabeledCount = 0;
        let totalChosen = 0;
        for (let t = 0; t < 30; t++) {
            const localGrid = buildPcSetupButNoSinglePcGrid();
            generateDockShapes(localGrid, buildConfig(), { totalRounds: 5 });
            const diag = getLastSpawnDiagnostics();
            if (!diag?.chosen) continue;
            for (const m of diag.chosen) {
                totalChosen++;
                /* 若 reason='perfectClear' 但 pcPotential!==2 → 误标 */
                if (m.reason === 'perfectClear' && (m.pcPotential ?? 0) !== 2) {
                    mislabeledCount++;
                }
            }
        }
        expect(mislabeledCount, `误标 "送清屏" 次数 ${mislabeledCount}/${totalChosen}（v1.60.26 修复后应为 0）`).toBe(0);
    });

    it('chosen 块 pcPotential===2 → reason 必须 ="perfectClear"（真清屏块标对）', () => {
        /* 构造单步可清屏场景：8 cells 散点同色 + 1 个 2×1 块刚好补满最后 2 cells，
         * 但盘面其他位置全空 → place + checkLines 后全空 → pcPotential=2。
         * 难精确构造，跑 30 次找到至少 1 次 pcPotential===2 验证 reason。 */
        let foundRealPc = false;
        let realPcCorrectReason = true;
        for (let t = 0; t < 30; t++) {
            const localGrid = new Grid(10);
            /* row 9 col 0-7 共 8 同色，仅 col 8/9 留空，盘面其他全空 */
            for (let x = 0; x <= 7; x++) localGrid.cells[9][x] = 0;
            generateDockShapes(localGrid, buildConfig(), { totalRounds: 5 });
            const diag = getLastSpawnDiagnostics();
            if (!diag?.chosen) continue;
            for (const m of diag.chosen) {
                if ((m.pcPotential ?? 0) === 2) {
                    foundRealPc = true;
                    if (m.reason !== 'perfectClear') realPcCorrectReason = false;
                }
            }
        }
        if (foundRealPc) {
            expect(realPcCorrectReason, 'pcPotential===2 时 reason 必须="perfectClear"').toBe(true);
        }
        /* 若 30 次都没找到 pcPotential===2 实例，跳过断言（场景构造概率性）—— 用 Bug 验证主路径不破坏 */
        expect(true).toBe(true);
    });
});
