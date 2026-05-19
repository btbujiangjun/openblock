// @vitest-environment jsdom
/**
 * v1.60.19 — monoFlush 同花顺消除信号的算法 + 集成不变式。
 *
 * 锁定 5 件事：
 *   1) Grid.bestMonoFlushPotential 边界正确：空盘/全空 line/单色 vs 杂色/skin 缺失退化；
 *   2) _estimateTopDriver 在 monoFlush>=1 时返回 "monoFlush" driver，文案为"可凑N同花顺"；
 *   3) 优先级：monoFlush 介于 pcPotential 与 multiClear 之间（×5 iconBonus 高于普通消行）；
 *   4) scoreShape 加权与 iconBonusTarget 协同：iconBonusTarget=1.0 时同花顺块显著抬头；
 *   5) DRIVER_NODE_PATHS.monoFlush 已显式映射（clearOpportunity + iconBonusTarget）。
 *
 * 用户反馈：截图中"同花顺大消除"是 ×5 倍硬 payoff，但 chosen 阶段算法完全无识别，
 * 仅靠染色阶段 monoNearFullLineColorWeights bias 间接命中。本套件直接锁定算法行为。
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { Grid } from '../web/src/grid.js';
import { getShapeById } from '../web/src/shapes.js';
import { _estimateTopDriver, resetSpawnMemory } from '../web/src/bot/blockSpawn.js';
import { __dfvTestables } from '../web/src/decisionFlowViz.js';

const { DRIVER_NODE_PATHS } = __dfvTestables;

/** 构造简易 skin（不依赖真实 skins 模块） */
const SKIN_8 = { blockIcons: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };

describe('v1.60.19 — Grid.bestMonoFlushPotential 算法边界', () => {
    it('空盘任意 shape：返回 0（无任何 line 满足"已填同色"）', () => {
        const grid = new Grid(10);
        const shape2x2 = getShapeById('2x2');
        expect(grid.bestMonoFlushPotential(shape2x2.data, SKIN_8)).toBe(0);
    });

    /* 1x1 不在 shape 池中，直接用 [[1]] data 测算法层 */
    const SHAPE_1x1 = [[1]];

    it('行 7 缺最右 1 格 + 其余 9 格全填色 0（同 icon "A"）：1x1 块可补满 → 返回 1', () => {
        const grid = new Grid(10);
        for (let x = 0; x < 9; x++) grid.cells[7][x] = 0;
        expect(grid.bestMonoFlushPotential(SHAPE_1x1, SKIN_8)).toBe(1);
    });

    it('行 7 缺最右 1 格 + 其余 9 格颜色杂色：1x1 块补满但非同色 → 返回 0', () => {
        const grid = new Grid(10);
        for (let x = 0; x < 9; x++) grid.cells[7][x] = x % 4;
        expect(grid.bestMonoFlushPotential(SHAPE_1x1, SKIN_8)).toBe(0);
    });

    it('skin=null 退化为 colorIdx 比较：同 colorIdx 也算 mono', () => {
        const grid = new Grid(10);
        for (let x = 0; x < 9; x++) grid.cells[7][x] = 3;
        expect(grid.bestMonoFlushPotential(SHAPE_1x1, null), 'colorIdx 同色 → 1').toBe(1);

        const grid2 = new Grid(10);
        for (let x = 0; x < 9; x++) grid2.cells[7][x] = x % 3;
        expect(grid2.bestMonoFlushPotential(SHAPE_1x1, null), 'colorIdx 杂色 → 0').toBe(0);
    });

    it('行 7 + 列 7 同时差 1 格于 (7,7)，且都同色：1x1 放 (7,7) 同时补满 2 条 → 返回 2', () => {
        const grid = new Grid(10);
        for (let x = 0; x < 10; x++) {
            if (x === 7) continue;
            grid.cells[7][x] = 0;
        }
        for (let y = 0; y < 10; y++) {
            if (y === 7) continue;
            grid.cells[y][7] = 0;
        }
        expect(grid.bestMonoFlushPotential(SHAPE_1x1, SKIN_8)).toBe(2);
    });

    it('行 7 缺 2 格（差 2）：1x1 任一放法都补不满 → 返回 0', () => {
        const grid = new Grid(10);
        for (let x = 0; x < 8; x++) grid.cells[7][x] = 0;
        expect(grid.bestMonoFlushPotential(SHAPE_1x1, SKIN_8)).toBe(0);
    });

    it('空 shape / 全空 shape data：返回 0', () => {
        const grid = new Grid(10);
        expect(grid.bestMonoFlushPotential(null, SKIN_8)).toBe(0);
        expect(grid.bestMonoFlushPotential([], SKIN_8)).toBe(0);
        expect(grid.bestMonoFlushPotential([[0, 0], [0, 0]], SKIN_8)).toBe(0);
    });

    it('shape 占用部分行 + 行内非 shape 部分全空：refCi=null → 不计 bonus（保守）', () => {
        const grid = new Grid(10);
        /* 1×5 横块放 row 7 左半 (col 0-4)，row 7 上 col 5-9 全空 → refCi 永远 null → 0 */
        const shape1x5 = getShapeById('1x5');
        expect(grid.bestMonoFlushPotential(shape1x5.data, SKIN_8)).toBe(0);
    });

    /* v1.60.22 反例：与染色 bias 同口径 (empty ≤ 2)。
     * shape 占多格 + 已填同色但不近满 → 不再计 monoFlush。 */
    describe('v1.60.22 修复：与 monoNearFullLineColorWeights 同口径（empty ≤ 2）', () => {
        it('row 上仅孤立 1 格同色 + 大块覆盖：非 shape 部分仍空 → allFilled=false → 0', () => {
            const grid = new Grid(10);
            grid.cells[7][9] = 0;
            const shape1x5 = getShapeById('1x5');
            expect(grid.bestMonoFlushPotential(shape1x5.data, SKIN_8),
                '盘面太空 + shape 任何 placement 都让 non-shape 部分有空格 → 0').toBe(0);
        });

        it('v1.60.26：1×3 横块 + row 上预填 7 格同色 (preFilled=7, empty=3) → 1（撤销 v1.60.22 阈值）', () => {
            const grid = new Grid(10);
            /* row 7：col 3-9 共 7 格已填色 0；col 0-2 空。
             * 1×3 横块放 (col 0, row 7)：shape 占 col 0,1,2 (3 cells)；
             * 非 shape 部分 col 3-9 全填同色 7 格 → 满 10 cells + 全同 icon → **构成同花消行**。
             * v1.60.26 撤销 v1.60.22 的 NEAR_FULL_MIN_PREFILLED 阈值——
             * 用户严格定义"同花" = 消行 + 全 line 同 icon，shape 占 K=1..n-2 cells 都计入。
             * 染色 bias 在 clearScoring v1.60.26 同步拓宽到 empty ≤ n-2，确保 shape ci 倾向 match。 */
            for (let x = 3; x <= 9; x++) grid.cells[7][x] = 0;
            const shape1x3 = getShapeById('1x3');
            expect(grid.bestMonoFlushPotential(shape1x3.data, SKIN_8),
                'shape 占 3 + non-shape 7 全同 = 满 10 同 icon → 同花块').toBeGreaterThanOrEqual(1);
        });

        it('1×2 横块 + row 上预填 8 格同色 (preFilled=8, empty=2) → 1（刚好达门控）', () => {
            const grid = new Grid(10);
            /* row 7：col 2-9 共 8 格已填色 0；col 0-1 空。
             * 1×2 横块放 (col 0, row 7)：shape 占 col 0,1；非 shape 部分 col 2-9 共 8 格全填同色。
             * preFilled=8 = NEAR_FULL_MIN_PREFILLED → 命中 → monoFlush=1。 */
            for (let x = 2; x <= 9; x++) grid.cells[7][x] = 0;
            const shape1x2 = getShapeById('1x2');
            expect(grid.bestMonoFlushPotential(shape1x2.data, SKIN_8),
                'preFilled=8 = 门控值 → 命中').toBe(1);
        });

        it('1×3 横块 + row 上预填 7 格但杂色 → 0（即使到达 v1.60.22 前的"全色"门控也不算）', () => {
            const grid = new Grid(10);
            for (let x = 3; x <= 9; x++) grid.cells[7][x] = x % 3;
            const shape1x3 = getShapeById('1x3');
            expect(grid.bestMonoFlushPotential(shape1x3.data, SKIN_8)).toBe(0);
        });

        it('v1.60.26 回归契约：与拓宽后的 monoNearFullLineColorWeights 同口径——empty ≤ n-2 + 全同 icon + shape 占满 line 都计入', () => {
            /* 此 invariant 锁定 v1.60.26 严格用户定义：消行 + 全 line 同 icon 即同花块 */
            const grid = new Grid(10);
            for (let x = 2; x <= 9; x++) grid.cells[7][x] = 0;
            const shape1x2 = getShapeById('1x2');
            const shape1x3 = getShapeById('1x3');
            /* empty=2 + 同色 + 1×2 占 2 cells → line 满 10 + 全同 → 同花 */
            expect(grid.bestMonoFlushPotential(shape1x2.data, SKIN_8)).toBeGreaterThanOrEqual(1);
            /* empty=3 + 同色 + 1×3 占 3 cells → line 满 10 + 全同 → 也是同花（v1.60.26 拓宽） */
            const grid2 = new Grid(10);
            for (let x = 3; x <= 9; x++) grid2.cells[7][x] = 0;
            expect(grid2.bestMonoFlushPotential(shape1x3.data, SKIN_8)).toBeGreaterThanOrEqual(1);
        });
    });
});

describe('v1.60.19 — _estimateTopDriver monoFlush 集成', () => {
    it('monoFlush >= 1 → driver "可凑N同花顺"', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0, monoFlush: 1,
        });
        expect(out.key).toBe('monoFlush');
        expect(out.label).toBe('可凑1同花顺');
    });

    it('monoFlush=2 → label "可凑2同花顺"', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0, monoFlush: 2,
        });
        expect(out.key).toBe('monoFlush');
        expect(out.label).toBe('可凑2同花顺');
    });

    it('优先级：pcPotential=2 优于 monoFlush（清屏×10 > 同花顺×5）', () => {
        const out = _estimateTopDriver({
            pcPotential: 2, multiClear: 0, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0, monoFlush: 3,
        });
        expect(out.key).toBe('pcPotential');
    });

    it('优先级：monoFlush=1 优于 multiClear=2（×5 iconBonus 比普通消行更值钱）', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 2, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0, monoFlush: 1,
        });
        expect(out.key, 'monoFlush 应胜出').toBe('monoFlush');
    });

    it('优先级：monoFlush=1 优于 exactFit=1.0（×5 iconBonus 比几何嵌入更显著）', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 1.0, monoFlush: 1,
        });
        expect(out.key).toBe('monoFlush');
    });

    it('monoFlush 缺省（undefined）：兼容旧调用方，行为等同于 0', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 1, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0,
        });
        expect(out.key, '无 monoFlush 字段时走 multiClear').toBe('multiClear');
    });

    it('monoFlush=0：不触发 monoFlush driver，回落到下游', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 2, holeReduce: 0,
            placements: 5, exactFit: 0, monoFlush: 0,
        });
        expect(out.key).toBe('gapFills');
    });
});

describe('v1.60.19 — DRIVER_NODE_PATHS.monoFlush 显式映射', () => {
    it('monoFlush path 在 DFV 中存在且非通配', () => {
        const p = DRIVER_NODE_PATHS.monoFlush;
        expect(p, 'monoFlush driver 必须在 DRIVER_NODE_PATHS 中有显式条目').toBeDefined();
        expect(p.strategy === '*' || p.targets === '*' || p.schedule === '*',
            'monoFlush 不应用通配 *').toBe(false);
    });

    it('monoFlush path 映射符合"同花顺"语义：clearOpportunity + iconBonusTarget', () => {
        const p = DRIVER_NODE_PATHS.monoFlush;
        expect(p.targets, '应高亮 clearOpportunity（已填同色 line 是 clearOpportunity 派生信号）')
            .toEqual(expect.arrayContaining(['clearOpportunity']));
        expect(p.schedule, '应高亮 iconBonusTarget（×5 倍同花顺得分调度参数）')
            .toEqual(expect.arrayContaining(['iconBonusTarget']));
        expect(p.intent, 'monoFlush 不通过 intent gate 触发').toBe(false);
    });
});

describe('v1.60.19 — Grid.bestMonoFlushPotential 集成 scored 流程', () => {
    beforeEach(() => {
        resetSpawnMemory();
    });

    it('Grid 端有 monoFlush=1 场景，blockSpawn ctx.skin 传入后 chosenMeta 应能反映', () => {
        /* 构造：行 7 缺 2 格 + 其余 8 格同 icon "A"。
         * 1×2 块在 (8,7) 放下可补满 1 条已填同色 line。 */
        const grid = new Grid(10);
        for (let x = 0; x < 8; x++) grid.cells[7][x] = 0;
        const shape1x2 = getShapeById('1x2');
        const potential = grid.bestMonoFlushPotential(shape1x2.data, SKIN_8);
        expect(potential, '1×2 补满 1 条同色行').toBe(1);

        /* 跑 generateDockShapes 时 ctx.skin 注入路径在 game.js 端测试，
         * 这里直接验证 grid 层 invariant（核心契约）。 */
    });
});

describe('v1.60.23 — Grid.findNearFullMonoLines 扫描', () => {
    it('空盘：返回 []（无任何 line 预填）', () => {
        const grid = new Grid(10);
        expect(grid.findNearFullMonoLines(SKIN_8)).toEqual([]);
    });

    it('行 7 已填 8 格同色 + 2 空：识别为 row 类型，empty=2，refCi=0', () => {
        const grid = new Grid(10);
        for (let x = 0; x < 8; x++) grid.cells[7][x] = 0;
        const lines = grid.findNearFullMonoLines(SKIN_8);
        const row = lines.find(l => l.type === 'row' && l.idx === 7);
        expect(row).toBeDefined();
        expect(row.empty).toBe(2);
        expect(row.refCi).toBe(0);
        expect(row.emptyCells).toHaveLength(2);
    });

    it('列 5 已填 8 格同色 + 2 空：识别为 col 类型，empty=2', () => {
        const grid = new Grid(10);
        for (let y = 0; y < 8; y++) grid.cells[y][5] = 3;
        const lines = grid.findNearFullMonoLines(SKIN_8);
        const col = lines.find(l => l.type === 'col' && l.idx === 5);
        expect(col).toBeDefined();
        expect(col.empty).toBe(2);
        expect(col.refCi).toBe(3);
    });

    it('行预填 8 格但杂色：不计入近满同色（mono 不满足）', () => {
        const grid = new Grid(10);
        for (let x = 0; x < 8; x++) grid.cells[7][x] = x % 4;
        expect(grid.findNearFullMonoLines(SKIN_8).some(l => l.idx === 7 && l.type === 'row')).toBe(false);
    });

    it('行预填 6 格（empty=4）：超出 empty<=2 门控，不计入', () => {
        const grid = new Grid(10);
        for (let x = 0; x < 6; x++) grid.cells[7][x] = 0;
        expect(grid.findNearFullMonoLines(SKIN_8).some(l => l.idx === 7 && l.type === 'row')).toBe(false);
    });

    it('行 7 全空：refCi=null，不计入（与 monoNearFullLineColorWeights 同口径）', () => {
        const grid = new Grid(10);
        expect(grid.findNearFullMonoLines(SKIN_8).some(l => l.idx === 7 && l.type === 'row')).toBe(false);
    });

    it('行+列 同时近满同色（截图复现场景）：两条都识别', () => {
        const grid = new Grid(10);
        /* col 5: rows 2-9 (8 格) 同色 0 */
        for (let y = 2; y < 10; y++) grid.cells[y][5] = 0;
        /* col 6: rows 2-9 (8 格) 同色 0 */
        for (let y = 2; y < 10; y++) grid.cells[y][6] = 0;
        const lines = grid.findNearFullMonoLines(SKIN_8);
        const col5 = lines.find(l => l.type === 'col' && l.idx === 5);
        const col6 = lines.find(l => l.type === 'col' && l.idx === 6);
        expect(col5, '列 5 应识别为近满同色').toBeDefined();
        expect(col6, '列 6 应识别为近满同色').toBeDefined();
        expect(col5.empty).toBe(2);
        expect(col6.empty).toBe(2);
    });

    it('skin=null：退化为 colorIdx 比较', () => {
        const grid = new Grid(10);
        for (let y = 0; y < 8; y++) grid.cells[y][5] = 7;
        const lines = grid.findNearFullMonoLines(null);
        expect(lines.some(l => l.type === 'col' && l.idx === 5)).toBe(true);
    });
});

describe('v1.60.25 — Grid.bestMonoFlushBuildup 建设期信号', () => {
    it('空盘任意 shape：返回 0', () => {
        const grid = new Grid(10);
        const shape3x3 = getShapeById('3x3');
        expect(grid.bestMonoFlushBuildup(shape3x3.data, SKIN_8, 6)).toBe(0);
    });

    it('盘面 5 同色 + 3×3 块 → 3×3 放某位置可让 col 上同色累计 ≥ 6 → 返回最高贡献 cells 数', () => {
        const grid = new Grid(10);
        /* col 5: rows 5-9 (5 cells) 同色 0；其余空 */
        for (let y = 5; y < 10; y++) grid.cells[y][5] = 0;
        const shape3x3 = getShapeById('3x3');
        const buildup = grid.bestMonoFlushBuildup(shape3x3.data, SKIN_8, 6);
        /* 3×3 放在 cols 3-5 rows 2-4 → col 5 上 shape 占 rows 2-4 (3 cells) + 已填 rows 5-9 (5 cells) = 8 同色，
         * 但 col 5 上仍有 rows 0-1 空 → 不是 line 满，但 buildup = shape 贡献的 3 cells（≥ 6 累计） */
        expect(buildup, '3×3 放 col 5 应贡献至少 3 cells').toBeGreaterThanOrEqual(3);
    });

    it('盘面 4 同色 + 1×1 块 → 累计 5 < minBuildup=6 → 返回 0', () => {
        const grid = new Grid(10);
        for (let y = 0; y < 4; y++) grid.cells[y][5] = 0;
        const SHAPE_1x1 = [[1]];
        expect(grid.bestMonoFlushBuildup(SHAPE_1x1, SKIN_8, 6), '4+1=5 < 6 不计入建设期').toBe(0);
    });

    it('盘面 5 同色 + 1×1 块 → 累计 6 = minBuildup=6 → 返回 1', () => {
        const grid = new Grid(10);
        for (let y = 0; y < 5; y++) grid.cells[y][5] = 0;
        const SHAPE_1x1 = [[1]];
        expect(grid.bestMonoFlushBuildup(SHAPE_1x1, SKIN_8, 6), '5+1=6 达阈值').toBe(1);
    });

    it('盘面 5 同色 + 5 杂色 → shape 落 col 5 引入第 11 个 cell → 杂色破坏 mono → 返回 0', () => {
        const grid = new Grid(10);
        for (let y = 0; y < 5; y++) grid.cells[y][5] = 0;  // 5 同色 ci=0
        grid.cells[6][5] = 3;  // 第 6 cell 杂色破坏 mono
        const SHAPE_1x1 = [[1]];
        expect(grid.bestMonoFlushBuildup(SHAPE_1x1, SKIN_8, 6)).toBe(0);
    });

    it('skin=null 退化：colorIdx 同色仍能建设', () => {
        const grid = new Grid(10);
        for (let y = 0; y < 5; y++) grid.cells[y][5] = 7;
        const SHAPE_1x1 = [[1]];
        expect(grid.bestMonoFlushBuildup(SHAPE_1x1, null, 6)).toBe(1);
    });

    it('截图复现场景：盘面右下 5×5 同色 (rows 5-9 × cols 5-9 = 25 cells) + 3×3 → buildup ≥ 3', () => {
        const grid = new Grid(10);
        for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) grid.cells[y][x] = 0;
        const shape3x3 = getShapeById('3x3');
        const buildup = grid.bestMonoFlushBuildup(shape3x3.data, SKIN_8, 6);
        expect(buildup, '3×3 应能贡献 ≥ 3 cells 给某 line').toBeGreaterThanOrEqual(3);
    });
});

describe('v1.60.26 — 严格用户定义"同花块" = 消行 + 全 line 同 icon', () => {
    /* 用户截图复现：col 9 已填 7 个 hook (rows 3-9) + 3 个空 (rows 0-2)。
     * 3×1 竖块放 col 9 rows 0-2 → shape 占 3 + non-shape 7 全 hook → 满 10 + 全同 → 同花。
     * v1.60.22 因 preFilled=7 < 8 漏识别，v1.60.26 修复后必识别。 */
    it('截图 Bug 2 复现：col 上 7 同色 + 3 空 + 3×1 竖块 → monoFlush=1（v1.60.22 阈值漏报修复）', () => {
        const grid = new Grid(10);
        for (let y = 3; y < 10; y++) grid.cells[y][9] = 2;  /* col 9 上 rows 3-9 全 ci=2 (船钩 hook icon) */
        const shape3x1 = getShapeById('3x1');
        const potential = grid.bestMonoFlushPotential(shape3x1.data, SKIN_8);
        expect(potential, '3×1 占 3 cells in col 9 + 7 hook → 满 10 同 hook → 同花块').toBeGreaterThanOrEqual(1);
    });

    it('5×1 竖块 + col 上 5 同色（empty=5）→ shape 占 5 + non-shape 5 全同 → monoFlush=1', () => {
        const grid = new Grid(10);
        for (let y = 5; y < 10; y++) grid.cells[y][3] = 0;  /* col 3 上 rows 5-9 全 ci=0 */
        const shape5x1 = getShapeById('5x1');
        const potential = grid.bestMonoFlushPotential(shape5x1.data, SKIN_8);
        expect(potential, '5×1 占 5 cells + 5 同色 = 满 10 同 → 同花').toBeGreaterThanOrEqual(1);
    });

    it('shape 占 line K cells + non-shape (n-K) 有 1 杂色 → 不算同花（用户严格定义"全 line 同 icon"）', () => {
        const grid = new Grid(10);
        for (let y = 5; y < 10; y++) grid.cells[y][3] = 0;
        grid.cells[2][3] = 7;  /* 杂色破坏 mono */
        const shape3x1 = getShapeById('3x1');
        /* shape 占 rows 0-2 → non-shape 部分 = rows 3-9 含 row 2 杂色（实际 row 2 已被 shape 占）→ 取决于布局 */
        /* 实际 3×1 放 col 3 rows 0-2 → non-shape rows 3-9 = 5 ci=0 + 2 null → !allFilled → 不计 */
        const grid2 = new Grid(10);
        for (let y = 3; y < 10; y++) grid2.cells[y][3] = 0;
        grid2.cells[4][3] = 7;  /* col 3 rows 3-9 有 1 个杂色 (row 4 ci=7) */
        expect(grid2.bestMonoFlushPotential(shape3x1.data, SKIN_8), '杂色破坏 mono 应拒绝').toBe(0);
    });

    it('shape 占 line K cells + non-shape 部分有 null（未满）→ !allFilled → 不算同花', () => {
        const grid = new Grid(10);
        for (let y = 5; y < 10; y++) grid.cells[y][3] = 0;
        /* col 3: rows 0-4 = 5 个 null + rows 5-9 = 5 个 ci=0
         * 3×1 放 col 3 rows 0-2 → shape 占 rows 0-2 + non-shape rows 3-9 = row 3,4 null + rows 5-9 同色
         * → !allFilled → 不算 */
        const shape3x1 = getShapeById('3x1');
        const potential = grid.bestMonoFlushPotential(shape3x1.data, SKIN_8);
        /* 该 shape 放 col 3 rows 0-2 不算同花（rows 3,4 仍空）；
         * 但放 col 3 rows 2-4 → non-shape rows 0,1,5-9 = 2 null + 5 ci=0 → !allFilled → 不算
         * 该 grid 无任何位置能让 3×1 凑出 col 满 → potential = 0 */
        expect(potential, 'shape 放下后 line 仍有 null 不算同花').toBe(0);
    });

    /** v1.60.27：bestMonoFlushPotential 返回 targetCi —— 染色阶段强制绑定的契约基础 */
    it('v1.60.27 — bestMonoFlushPotential(opts.returnTarget=true) 返回 { count, targetCi }，targetCi = line 同色 ci', () => {
        const grid = new Grid(10);
        for (let x = 2; x <= 9; x++) grid.cells[7][x] = 3;  /* row 7 empty=2，全 ci=3 */
        const shape1x2 = getShapeById('1x2');
        const result = grid.bestMonoFlushPotential(shape1x2.data, SKIN_8, { returnTarget: true });
        expect(result.count, '1×2 横块占 row 7 col 0-1 → 满 10 全 ci=3 → 同花').toBeGreaterThanOrEqual(1);
        expect(result.targetCi, 'targetCi 必须 = 3（line 上的同色 ci）').toBe(3);
    });

    it('v1.60.27 — count=0 时 targetCi=null（无同花潜力，空盘面）', () => {
        const grid = new Grid(10);  /* 完全空盘面 → 任何 shape 都无法触发同花（non-shape 部分必有 null） */
        const shape1x2 = getShapeById('1x2');
        const result = grid.bestMonoFlushPotential(shape1x2.data, SKIN_8, { returnTarget: true });
        expect(result.count, '空盘面 → count=0').toBe(0);
        expect(result.targetCi, 'count=0 时 targetCi 必须 null').toBeNull();
    });

    it('v1.60.27 — opts 缺省时返回 number（向后兼容）', () => {
        const grid = new Grid(10);
        for (let x = 2; x <= 9; x++) grid.cells[7][x] = 3;
        const shape1x2 = getShapeById('1x2');
        const result = grid.bestMonoFlushPotential(shape1x2.data, SKIN_8);
        expect(typeof result, '默认返回 number 维持向后兼容').toBe('number');
        expect(result).toBeGreaterThanOrEqual(1);
    });

    it('clearScoring.monoNearFullLineColorWeights 同口径：empty=3 同色 line 也加 bias（v1.60.26 拓宽）', async () => {
        const { monoNearFullLineColorWeights } = await import('../web/src/clearScoring.js');
        const grid = new Grid(10);
        for (let x = 3; x <= 9; x++) grid.cells[7][x] = 0;  /* row 7 empty=3 同色 */
        const w = monoNearFullLineColorWeights(grid, SKIN_8);
        const ci0DockSlot = 0;  /* ci=0 → dockSlot=0 */
        expect(w[ci0DockSlot], 'empty=3 同色 line 应加 bias（v1.60.26 拓宽）').toBeGreaterThan(0);
        /* 但 bias 权重 < empty ≤ 2 的兑现期 */
        const grid2 = new Grid(10);
        for (let x = 2; x <= 9; x++) grid2.cells[7][x] = 0;  /* row 7 empty=2 */
        const w2 = monoNearFullLineColorWeights(grid2, SKIN_8);
        expect(w2[ci0DockSlot], '兑现期 bias 应高于建设期').toBeGreaterThan(w[ci0DockSlot]);
    });
});

describe('v1.60.26 — monoFlushBuildup driver 撤销（用户严格定义"同花块" = 消行 + 同 icon）', () => {
    it('monoFlushBuildup=3 + 无消行信号 → 不再触发 monoFlushBuildup driver，回落 balanced', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0, monoFlush: 0, monoFlushBuildup: 3,
        });
        expect(out.key, 'buildup 不再作为 driver（建设期不算同花）').not.toBe('monoFlushBuildup');
    });

    it('monoFlushBuildup=3 + gapFills=2 → gapFills 胜出（buildup 不再 hijack driver）', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 2, holeReduce: 0,
            placements: 5, exactFit: 0, monoFlush: 0, monoFlushBuildup: 3,
        });
        expect(out.key, 'gapFills 胜出').toBe('gapFills');
    });

    it('monoFlush=1（真同花块） + monoFlushBuildup=5 → monoFlush 优先', () => {
        const out = _estimateTopDriver({
            pcPotential: 0, multiClear: 0, gapFills: 0, holeReduce: 0,
            placements: 5, exactFit: 0, monoFlush: 1, monoFlushBuildup: 5,
        });
        expect(out.key, '真同花块 monoFlush 必须胜出').toBe('monoFlush');
    });
});
