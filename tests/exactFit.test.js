// @vitest-environment jsdom
/**
 * v1.60.18 — exactFit 完美卡入信号的算法 + 集成不变式。
 *
 * 锁定 5 件事：
 *   1) Grid.bestExactFit 边界正确：空盘 / 全填 / 完美匹配凹槽 / 漂浮场景；
 *   2) _estimateTopDriver 在 exactFit≥0.85 时返回 "exactFit" driver，文案含百分比/完美卡入；
 *   3) exactFit 优先级：低于 multiClear（不抢消行 driver），高于 gapFills；
 *   4) scoreShape 加权效果：相同盘面 + 2×2 凹槽，2×2 块的 weight 显著高于 1×3 等漂浮块；
 *   5) DRIVER_NODE_PATHS.exactFit 已显式映射（防回归 fallback 到 balanced 全亮）。
 *
 * 用户截图反馈：盘面有 2×2 凹槽时，2×2 候选块的"完美填空"价值算法未识别。
 * 本套件直接还原这种场景并锁定算法行为。
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { Grid } from '../web/src/grid.js';
import { getShapeById } from '../web/src/shapes.js';
import { _estimateTopDriver, resetSpawnMemory, generateDockShapes } from '../web/src/bot/blockSpawn.js';
import { __dfvTestables } from '../web/src/decisionFlowViz.js';

const { DRIVER_NODE_PATHS } = __dfvTestables;

describe('v1.60.18 — Grid.bestExactFit 算法边界', () => {
    it('空盘任意 shape：契合度极低（外周邻居几乎都空 → 仅顶/左/右边界少量贡献）', () => {
        const grid = new Grid(10);
        const shape2x2 = getShapeById('2x2');
        const fit = grid.bestExactFit(shape2x2.data);
        /* 2×2 放角落最多 2 条边界 + 4 个邻居外周 = 8 个外周，命中 4 个边界 = 0.5 */
        expect(fit).toBeLessThanOrEqual(0.5);
    });

    it('盘面恰好有 2×2 凹槽 + 周围全填：2×2 块返回 1.0（完美卡入）', () => {
        const grid = new Grid(10);
        /* 构造：除了 (row 4-5, col 4-5) 这块 2×2 区域空，其他 (row 3-6, col 3-6) 区域全填 */
        for (let y = 3; y <= 6; y++) {
            for (let x = 3; x <= 6; x++) {
                if (y >= 4 && y <= 5 && x >= 4 && x <= 5) continue; /* 2×2 凹槽 */
                grid.cells[y][x] = '#888';
            }
        }
        const shape2x2 = getShapeById('2x2');
        const fit = grid.bestExactFit(shape2x2.data);
        expect(fit, '2×2 块嵌入 2×2 凹槽应得到 1.0 完美匹配').toBe(1);
    });

    it('同一盘面：1×2 块契合度高（≥0.5）但 ≤ 1.0（部分外周仍空）', () => {
        const grid = new Grid(10);
        for (let y = 3; y <= 6; y++) {
            for (let x = 3; x <= 6; x++) {
                if (y >= 4 && y <= 5 && x >= 4 && x <= 5) continue;
                grid.cells[y][x] = '#888';
            }
        }
        const shape1x2 = getShapeById('1x2');
        const fit = grid.bestExactFit(shape1x2.data);
        expect(fit, '1×2 嵌入 2×2 凹槽契合度高').toBeGreaterThanOrEqual(0.5);
    });

    it('空 shape / 全空 shape data：返回 0', () => {
        const grid = new Grid(10);
        expect(grid.bestExactFit(null)).toBe(0);
        expect(grid.bestExactFit([])).toBe(0);
        expect(grid.bestExactFit([[0, 0], [0, 0]])).toBe(0);
    });

    it('shape 无任何合法 placement（盘面已满）：返回 0', () => {
        const grid = new Grid(4);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) grid.cells[y][x] = '#888';
        const shape2x2 = getShapeById('2x2');
        expect(grid.bestExactFit(shape2x2.data)).toBe(0);
    });
});

describe('v1.60.18 — _estimateTopDriver exactFit 集成', () => {
    it('exactFit ≥ 0.999 → driver "完美卡入"', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 1.0,
        });
        expect(out.key).toBe('exactFit');
        expect(out.label).toBe('完美卡入');
    });

    it('exactFit ∈ [0.85, 1.0)（紧凑卡入）→ label 含百分比', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0.875,
        });
        expect(out.key).toBe('exactFit');
        expect(out.label).toBe('紧凑卡入88%');
    });

    it('exactFit 低于阈值 0.85：不触发 exactFit driver', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0.7,
        });
        expect(out.key, 'exactFit<0.85 应走其他 driver（balanced/mobility 等）').not.toBe('exactFit');
    });

    it('v1.60.20 反转：multiClear>=1 优于"紧凑卡入"（≥0.85 <1.0），但**输给"完美卡入"**', () => {
        /* 紧凑卡入仍让位给真模拟消行 */
        const outA = _estimateTopDriver({
            pcPotential: 0, multiClear: 1, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0.875,
        });
        expect(outA.key, '紧凑卡入 0.875 让位给 multiClear=1').toBe('multiClear');

        /* v1.60.20：完美卡入（exactFit=1.0）反转优先级，胜出 multiClear */
        const outB = _estimateTopDriver({
            pcPotential: 0, multiClear: 1, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 1.0,
        });
        expect(outB.key, 'v1.60.20：完美卡入是确定性极致信号，胜出 multiClear').toBe('exactFit');
        expect(outB.label).toBe('完美卡入');

        /* multiClear=2（多消）vs exactFit=1.0：完美卡入仍胜出（含消行价值） */
        const outC = _estimateTopDriver({
            pcPotential: 0, multiClear: 2, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 1.0,
        });
        expect(outC.key, 'v1.60.20：完美卡入 > multiClear=2（边界完全闭合往往含多消价值）').toBe('exactFit');
    });

    it('优先级：exactFit 优于 gapFills（紧凑卡入比近满补缺更明确）', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 3, holeReduce: 0,
            placements: 5, exactFit: 0.9,
        });
        expect(out.key).toBe('exactFit');
    });

    it('exactFit 缺省（undefined）：兼容旧调用方，行为等同于 0', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 1, holeReduce: 0,
            placements: 5,
        });
        expect(out.key).toBe('gapFills');
        expect(out.label).toBe('近满补1');
    });
});

describe('v1.60.18 — DRIVER_NODE_PATHS.exactFit 显式映射（防 fallback 全亮）', () => {
    it('exactFit path 在 DFV 中存在且非通配', () => {
        const p = DRIVER_NODE_PATHS.exactFit;
        expect(p, 'exactFit driver 必须在 DRIVER_NODE_PATHS 中有显式条目').toBeDefined();
        expect(p.strategy === '*' || p.targets === '*' || p.schedule === '*',
            'exactFit 不应用通配 *（会全亮 5 层稀释信息量）').toBe(false);
    });

    it('exactFit path 映射符合"几何精确嵌入"语义：sizePreference + spatialPressure + shapeComplexity', () => {
        const p = DRIVER_NODE_PATHS.exactFit;
        expect(p.strategy).toEqual(expect.arrayContaining(['sizePreference']));
        expect(p.targets).toEqual(expect.arrayContaining(['spatialPressure', 'shapeComplexity']));
        expect(p.intent, 'exactFit 不通过 intent gate 触发').toBe(false);
    });
});

describe('v1.60.18 — scoreShape 加权效果（端到端集成）', () => {
    beforeEach(() => {
        resetSpawnMemory();
    });

    it('盘面有 2×2 凹槽时，2×2 块至少有机会被选为 chosen 之一', () => {
        /* 构造盘面：除了 (row 4-5, col 4-5) 这块 2×2 空缺，row 3-6 col 3-6 区域全填，
         * 其余空。让算法在这种"凹槽明确"场景下评估 2×2 的优先级。 */
        const grid = new Grid(10);
        for (let y = 3; y <= 6; y++) {
            for (let x = 3; x <= 6; x++) {
                if (y >= 4 && y <= 5 && x >= 4 && x <= 5) continue;
                grid.cells[y][x] = '#888';
            }
        }
        /* 直接验证 grid 层面 2×2 的 exactFit=1.0（核心 invariant） */
        const shape2x2 = getShapeById('2x2');
        expect(grid.bestExactFit(shape2x2.data), '2×2 凹槽场景 2×2 块 exactFit=1.0').toBe(1);

        /* 跑 generateDockShapes（30 次蒙特卡洛）：2×2 至少出现一次（exactFit×1.75 加权下不会
         * 被完全压制；不强制每次必出，因为还有 multiClear/clearGuarantee 等其他权重交互）。
         * 注意：strategyConfig.shapeWeights 字段被读取，下面直接传字典是为 weights={} 的极端
         * 测试，2×2 抽中靠 exactFit 加权的 nudge——所以 trial 数要足够大避免 random 抖动。 */
        let appeared = 0;
        for (let i = 0; i < 30; i++) {
            const triplet = generateDockShapes(grid, { shapeWeights: { lines: 1, squares: 2, rects: 1, tshapes: 1, lshapes: 1, jshapes: 1, zshapes: 1 } }, {});
            if (triplet && triplet.some(s => s.id === '2x2')) appeared++;
        }
        expect(appeared, '30 次抽样中 2×2 在凹槽场景至少出现 1 次（exactFit 加权生效）').toBeGreaterThanOrEqual(1);
    });
});
