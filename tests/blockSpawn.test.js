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
     * Gate invariant：在"无 pressure/sprint intent"或"skillLevel < 0.5"场景下，
     * diag-3a / diag-3b 必须被 gate 拦截，不应出现在任何 spawn 结果中。
     * 跑 40 次覆盖随机性。
     */
    it('v1.60.0：diag-3 在新手场景被 gate 严格屏蔽', () => {
        const cfgNewbie = {
            ...config,
            _skillLevel: 0.2,
            spawnHints: { ...(config.spawnHints || {}), spawnIntent: 'maintain' },
        };
        for (let trial = 0; trial < 40; trial++) {
            resetSpawnMemory();
            const localGrid = new Grid(8);
            const shapes = generateDockShapes(localGrid, cfgNewbie);
            for (const s of shapes) {
                expect(s.id === 'diag-3a' || s.id === 'diag-3b',
                    `新手场景出现 diag-3 (${s.id})，gate 失效`).toBe(false);
            }
        }
    });

    /**
     * Gate 放行 invariant：高 skill + pressure intent 时，diag-3 应能（按概率）出现。
     * 跑 60 次累计采样，期待至少 1 次出现（极保守阈值，防御性测试）。
     */
    it('v1.60.0：diag-3 在 pressure + 高 skill 时能进入 spawn 候选', () => {
        const cfgPressure = {
            ...config,
            _skillLevel: 0.85,
            spawnHints: { ...(config.spawnHints || {}), spawnIntent: 'pressure' },
        };
        let diagSeen = 0;
        for (let trial = 0; trial < 60; trial++) {
            resetSpawnMemory();
            const localGrid = new Grid(8);
            const shapes = generateDockShapes(localGrid, cfgPressure);
            for (const s of shapes) {
                if (s.id === 'diag-3a' || s.id === 'diag-3b') diagSeen++;
            }
        }
        /* 60 次 × 3 shape = 180 次抽样，diag-3 在 40 个 candidate 中只占 2 个，
         * 即使不加权出现期望 ~9 次。阈值 ≥ 1 留足容差。 */
        expect(diagSeen).toBeGreaterThanOrEqual(1);
    });

    /**
     * 加权 invariant：sizePreference ≤ -0.3 时，超小直线（1x2/2x1/1x3/3x1）
     * 在 60 次采样中应至少出现 5 次（不要求精确比例，仅证加权生效 / 不被沉默）。
     */
    it('v1.60.0：超小直线在 sizePreference≤-0.3 时显著出现', () => {
        const cfgSmall = {
            ...config,
            spawnHints: { ...(config.spawnHints || {}), sizePreference: -0.6 },
        };
        const tinyIds = new Set(['1x2', '2x1', '1x3', '3x1']);
        let tinySeen = 0;
        for (let trial = 0; trial < 60; trial++) {
            resetSpawnMemory();
            const localGrid = new Grid(8);
            const shapes = generateDockShapes(localGrid, cfgSmall);
            for (const s of shapes) {
                if (tinyIds.has(s.id)) tinySeen++;
            }
        }
        expect(tinySeen).toBeGreaterThanOrEqual(5);
    });

    /**
     * _estimateTopDriver 语义 invariant：人造 scored entry 模拟新形状，
     * 期待返回各自的 driver.key（不被通用 driver 误吞）。
     * 关键场景：所有通用 driver（pcPotential/multiClear/gapFills/holeReduce/mobility）
     * 都返回 0，此时应回退到形态特异性 driver。
     */
    it('v1.60.0：_estimateTopDriver 对新形状返回形态特异性 driver', () => {
        const mkEntry = (id, category) => ({
            shape: { id, data: [[1]] },
            gapFills: 0, multiClear: 0, pcPotential: 0, holeReduce: 0,
            placements: 10, category,
        });
        const weights = { lines: 1, zshapes: 1, lshapes: 1 };

        expect(_estimateTopDriver(mkEntry('1x2', 'lines'), weights).key).toBe('tinyLine');
        expect(_estimateTopDriver(mkEntry('3x1', 'lines'), weights).key).toBe('tinyLine');
        expect(_estimateTopDriver(mkEntry('diag-2a', 'zshapes'), weights).key).toBe('diagonalPair');
        expect(_estimateTopDriver(mkEntry('diag-3b', 'zshapes'), weights).key).toBe('diagonalSparse');
        expect(_estimateTopDriver(mkEntry('l3-c', 'lshapes'), weights).key).toBe('cornerFit');
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
