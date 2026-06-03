/**
 * @vitest-environment jsdom
 *
 * v1.16：boardTopology.detectNearClears 是「近完整行/列」检测的单一来源。
 * 既被 analyzeBoardTopology（topology pill / stress 信号）复用，也被
 * bot/blockSpawn.analyzePerfectClearSetup（清屏机会评估）复用，必须保证两侧
 * 在相同盘面上得到一致的近满判定。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    detectNearClears,
    analyzeBoardTopology,
    computeCoverableCells,
    countUnfillableCells,
    countEmptyRegions,
    countConcaveCorners,
} from '../web/src/boardTopology.js';
import { getAllShapes, getRegularShapes, isSpecialShapeId } from '../web/src/shapes.js';

function makeGrid(size = 8) {
    return new Grid(size);
}

describe('detectNearClears', () => {
    it('空盘没有任何近满行列', () => {
        const grid = makeGrid();
        const r = detectNearClears(grid);
        expect(r.rows).toEqual([]);
        expect(r.cols).toEqual([]);
        expect(r.nearFullLines).toBe(0);
        expect(r.close1).toBe(0);
        expect(r.close2).toBe(0);
    });

    it('差 1 格的行被识别为 close1', () => {
        const grid = makeGrid();
        for (let x = 0; x < 7; x++) grid.cells[0][x] = 1;
        const r = detectNearClears(grid);
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].emptyCount).toBe(1);
        expect(r.close1).toBe(1);
        expect(r.close2).toBe(0);
        expect(r.nearFullLines).toBe(1);
    });

    it('差 2 格的列被识别为 close2', () => {
        const grid = makeGrid();
        for (let y = 0; y < 6; y++) grid.cells[y][3] = 1;
        const r = detectNearClears(grid);
        expect(r.cols).toHaveLength(1);
        expect(r.cols[0].emptyCount).toBe(2);
        expect(r.close2).toBe(1);
        expect(r.close1).toBe(0);
        expect(r.nearFullLines).toBe(1);
    });

    it('requireFillable=true 时跳过永远填不上的近满线（与 analyzeBoardTopology 一致）', () => {
        const grid = makeGrid();
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) grid.cells[y][x] = 1;
        }
        grid.cells[3][3] = null;
        const fillable = detectNearClears(grid, { requireFillable: true });
        expect(fillable.nearFullLines).toBe(0);
        const raw = detectNearClears(grid, { requireFillable: false });
        expect(raw.nearFullLines).toBeGreaterThanOrEqual(2);
    });

    it('analyzeBoardTopology 与 detectNearClears 在同一盘面给出相同 close1/close2', () => {
        const grid = makeGrid();
        for (let x = 0; x < 7; x++) grid.cells[0][x] = 1;
        for (let y = 0; y < 6; y++) grid.cells[y][7] = 1;
        const topo = analyzeBoardTopology(grid);
        const direct = detectNearClears(grid, { maxEmpty: 2 });
        expect(topo.close1).toBe(direct.close1);
        expect(topo.close2).toBe(direct.close2);
        expect(topo.nearFullLines).toBe(direct.nearFullLines);
    });

    it('maxEmpty 参数控制收口宽度', () => {
        const grid = makeGrid();
        for (let x = 0; x < 5; x++) grid.cells[0][x] = 1;
        const wide = detectNearClears(grid, { maxEmpty: 3, requireFillable: false });
        expect(wide.rows).toHaveLength(1);
        expect(wide.rows[0].emptyCount).toBe(3);
        const tight = detectNearClears(grid, { maxEmpty: 2, requireFillable: false });
        expect(tight.rows).toHaveLength(0);
    });
});

/**
 * v1.60.2 空洞口径修复：独立库 12 个小块（1x2 / l3-* / diag-* …）只走事件注入，
 * 玩家自然 dock 永远抽不到，不应作为"理论可覆盖"工具。`computeCoverableCells`
 * 必须支持 `excludeSpecial:true` 把它们剔除；`analyzeBoardTopology({skipSpecialCells})`
 * 必须把开关联动透传——这是修玩家面板"空洞 2"偏低问题的核心契约。
 */
describe('v1.60.2 special shapes excluded from coverable analysis', () => {
    /** 构造一个 9x9 盘：除 (4,4) 外整盘填满 — 这是个 1×1 孤洞，
     *  常规 28 个 shape（最小 2 格）都无法覆盖；
     *  但全 40 中如有 1×1 类小块，能覆盖 → 旧口径把这洞错判为 coverable。 */
    function singleHoleGrid() {
        const g = new Grid(9);
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) {
                if (x === 4 && y === 4) continue;
                g.cells[y][x] = 1;
            }
        }
        return g;
    }

    it('regular pool 应严格少于 all pool（28 < 40），且不含任何 special id', () => {
        const all = getAllShapes();
        const reg = getRegularShapes();
        expect(all.length).toBeGreaterThan(reg.length);
        expect(reg.some((s) => isSpecialShapeId(s.id))).toBe(false);
    });

    it('显式传 shapes 时优先，覆盖 excludeSpecial 选项（向后兼容）', () => {
        const g = singleHoleGrid();
        const customPool = getAllShapes().slice(0, 3);
        const a = computeCoverableCells(g, customPool, { excludeSpecial: true });
        const b = computeCoverableCells(g, customPool, { excludeSpecial: false });
        for (let y = 0; y < g.size; y++) {
            for (let x = 0; x < g.size; x++) {
                expect(a[y][x]).toBe(b[y][x]);
            }
        }
    });

    it('excludeSpecial=true 时 coverable 单调收缩（special 提供过的覆盖被剔除）', () => {
        const g = singleHoleGrid();
        const withSpec = computeCoverableCells(g, undefined, { excludeSpecial: false });
        const noSpec  = computeCoverableCells(g, undefined, { excludeSpecial: true });
        let withCount = 0;
        let noCount   = 0;
        for (let y = 0; y < g.size; y++) {
            for (let x = 0; x < g.size; x++) {
                if (withSpec[y][x]) withCount++;
                if (noSpec[y][x])   noCount++;
                if (noSpec[y][x])   expect(withSpec[y][x]).toBe(true);
            }
        }
        expect(noCount).toBeLessThanOrEqual(withCount);
    });

    it('countUnfillableCells({excludeSpecial:true}) >= countUnfillableCells() — 剔除工具只会让空洞数上升或不变', () => {
        const g = singleHoleGrid();
        const lo = countUnfillableCells(g);
        const hi = countUnfillableCells(g, undefined, { excludeSpecial: true });
        expect(hi).toBeGreaterThanOrEqual(lo);
    });

    it('analyzeBoardTopology({skipSpecialCells:true}) 联动 excludeSpecial — 玩家口径 holes 不被特殊小块"假覆盖"', () => {
        const g = singleHoleGrid();
        /* 默认（含 special 作为覆盖工具）：可能把 1×1 孤洞错判为 coverable */
        const baseline = analyzeBoardTopology(g);
        /* 玩家口径：special 不参与 coverable，孤洞应被正确识别 */
        const player = analyzeBoardTopology(g, { skipSpecialCells: true });
        expect(player.holes).toBeGreaterThanOrEqual(baseline.holes);
        /* 此盘没有任何 isSpecial 格子（grid.place 没传过 opts），所以
         * holesNearSpecial 必为 0；玩家口径净增的 holes 全部源自"剔除特殊小块覆盖工具" */
        expect(player.holesNearSpecial).toBe(0);
    });

    it('isolatedHoles 与 bot.countIsolatedHoles 同口径（4-邻全填的空格数）', async () => {
        const { __test_internals__ } = await import('../web/src/bot/blockSpawn.js').catch(() => ({}));
        /* bot/blockSpawn.js 内部的 countIsolatedHoles 没导出，这里手算同公式做交叉验证：
         *   4-邻（含越界算填充边墙）全是非 null → 计 1。 */
        function botCountIsolatedHoles(g) {
            const n = g.size;
            let h = 0;
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    if (g.cells[y][x] !== null) continue;
                    const u = y === 0 || g.cells[y - 1][x] !== null;
                    const d = y === n - 1 || g.cells[y + 1][x] !== null;
                    const l = x === 0 || g.cells[y][x - 1] !== null;
                    const r = x === n - 1 || g.cells[y][x + 1] !== null;
                    if (u && d && l && r) h++;
                }
            }
            return h;
        }
        /* 构造一个真实的"孤洞 + 大空区"盘面，截图复现：
         * 9x9，下半部分密集填充，中间留 2 个 4-邻全围的孤洞，上半部全空。 */
        const g = new Grid(9);
        for (let y = 4; y < 9; y++) for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        /* 挖洞 1：(4,7) 4-邻 (3,7)=null 上方空 → 不是孤洞（u=false） */
        /* 挖洞 2：(7,3) 周围 (6,3)(8,3)(7,2)(7,4) 都填 → 真正孤洞 */
        g.cells[7][3] = null;
        /* 挖洞 3：(7,7) 同上 → 真正孤洞 */
        g.cells[7][7] = null;
        const t = analyzeBoardTopology(g);
        const expected = botCountIsolatedHoles(g);
        expect(t.isolatedHoles).toBe(expected);
        expect(t.isolatedHoles).toBe(2);
        /* coverable 口径在此盘面下也能很高地反映孤洞——但关键不变量是两口径**不同**且
         * isolatedHoles 不依赖于 coverable 池的大小 */
        expect(Number.isFinite(t.isolatedHoles)).toBe(true);
    });

    it('大空区里散布几个填块时 holes(coverable)≈0 但 isolatedHoles 仍正确反映"被围孤洞"——v1.60.3 截图反馈核心', () => {
        /* 复现截图：9x9 盘，下半部分密集填充（如海盗皮肤的灯塔群），
         * 但其中夹有 3 个 4-邻被填块包围的"孤洞"；上半部分仍是大空区。 */
        const g = new Grid(9);
        /* 把右下角 5x5 全填，再挖 3 个孤洞 */
        for (let y = 4; y < 9; y++) for (let x = 4; x < 9; x++) g.cells[y][x] = 1;
        g.cells[5][5] = null;  // 4-邻 (4,5)(6,5)(5,4)(5,6) 都填 → 孤洞
        g.cells[6][7] = null;  // 4-邻 (5,7)(7,7)(6,6)(6,8) 都填 → 孤洞
        g.cells[7][5] = null;  // 4-邻 (6,5)(8,5)(7,4)(7,6) 都填 → 孤洞
        const topo = analyzeBoardTopology(g);
        /* 关键断言：coverable 口径在大空区盘面常 = 0（reg 28 的 4-cell 形状几乎能
         * 覆盖任何空格），但 isolatedHoles 必须如实报出 3 个孤洞——这正是用户看到
         * "空洞 0"但视觉上明显有洞的根因。 */
        expect(topo.isolatedHoles).toBe(3);
        /* 0 或更大都可接受（依 reg 池形状）；用户看到的"空洞"展示用 isolatedHoles，不用此值 */
        expect(topo.holes).toBeGreaterThanOrEqual(0);
    });

    it('isolatedHoles 联动 skipSpecialCells——邻接独立库块的孤洞进 isolatedHolesNearSpecial 不计 isolatedHoles', () => {
        const g = new Grid(8);
        /* 围绕 (3,3) 放 4 个 1×1 独立库块，其中至少 1 个标为 isSpecial=true */
        g.place([[1]], 1, 3, 2, { shapeId: '1x2', isSpecial: true });
        g.place([[1]], 1, 3, 4, { shapeId: '1x2', isSpecial: false });
        g.place([[1]], 1, 2, 3, { shapeId: '2x2', isSpecial: false });
        g.place([[1]], 1, 4, 3, { shapeId: '2x2', isSpecial: false });
        /* (3,3) 是 4-邻全填的孤洞，且邻里有 isSpecial=true → 应进豁免 */
        const def  = analyzeBoardTopology(g);
        const skip = analyzeBoardTopology(g, { skipSpecialCells: true });
        expect(def.isolatedHoles).toBe(1);
        expect(def.isolatedHolesNearSpecial).toBe(0);
        expect(skip.isolatedHoles).toBe(0);
        expect(skip.isolatedHolesNearSpecial).toBe(1);
        /* 两口径下 isolatedHoles + isolatedHolesNearSpecial 守恒 */
        expect(skip.isolatedHoles + skip.isolatedHolesNearSpecial).toBe(def.isolatedHoles);
    });

    it('真实场景：独立库块占据格子，邻接的散点孤岛仍然豁免（holes 不计入），但远处的真实孤洞被正确识别', () => {
        const g = new Grid(9);
        /* 整盘填满 */
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        }
        /* (4,4) 是独立库 1x2 块的一半 → 周围那块空洞应豁免 */
        g.cells[4][4] = null;
        g.cells[4][5] = null;
        g._cellMeta.set('4,4', { placedBy: '1x2', isSpecial: false });
        g.cells[4][4] = 2;
        /* 此刻 (4,5) 是空，4-邻里 (4,4) 是 isSpecial=true 的独立库块？
         * 重置正确流程：用 grid.place 才能写 _cellMeta。重做： */
        const g2 = new Grid(9);
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) g2.cells[y][x] = 1;
        }
        /* (4,4)+(4,5) 先清空，再用 grid.place 重新放一个 1x2 (isSpecial=true) 在 (3,4)（占 (3,4)(3,5)）
         * 这样 (4,4) 和 (4,5) 仍空，但 (3,4)(3,5) 是 isSpecial 块。 */
        g2.cells[3][4] = null;
        g2.cells[3][5] = null;
        g2.cells[4][4] = null;
        g2.cells[4][5] = null;
        g2.place([[1, 1]], 3, 3, 4, { shapeId: '1x2', isSpecial: true });
        /* 此时 (4,4) 与 (4,5) 是空格，且 4-邻里包含 isSpecial 的 (3,4)/(3,5) → 应豁免 */
        const t = analyzeBoardTopology(g2, { skipSpecialCells: true });
        expect(t.holesNearSpecial).toBeGreaterThanOrEqual(1);
        /* 远处再挖一个真实孤洞：(7,7) 单格空，4-邻里都是常规填充，不豁免 */
        const g3 = new Grid(9);
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) g3.cells[y][x] = 1;
        }
        g3.cells[7][7] = null;
        const t3 = analyzeBoardTopology(g3, { skipSpecialCells: true });
        /* (7,7) 邻里没有 special，且常规 28 个 shape 最小 2 格无法填 → 必然计入 holes */
        expect(t3.holes).toBeGreaterThanOrEqual(1);
        expect(t3.holesNearSpecial).toBe(0);
    });
});

describe('v1.60.5 enclosedVoidCells（小型局部空腔，4-连通分量 size ≤ 5）', () => {
    it('1 格孤洞 → enclosedVoidCells = 1（与 isolatedHoles 一致）', () => {
        const g = new Grid(9);
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        g.cells[4][4] = null;
        const t = analyzeBoardTopology(g);
        expect(t.enclosedVoidCells).toBe(1);
        expect(t.isolatedHoles).toBe(1);
    });

    it('2 格水平 L 凹陷 → enclosedVoidCells = 2（isolatedHoles = 0，因每格各有 1 个空邻居）', () => {
        const g = new Grid(9);
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        g.cells[4][4] = null;
        g.cells[4][5] = null;
        const t = analyzeBoardTopology(g);
        expect(t.enclosedVoidCells).toBe(2);
        expect(t.isolatedHoles).toBe(0); // 每个空格都至少有 1 个空邻居 → 不满足 4-邻全填
    });

    it('3 格 L 形空腔 → enclosedVoidCells = 3', () => {
        const g = new Grid(9);
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        g.cells[4][4] = null;
        g.cells[4][5] = null;
        g.cells[5][5] = null;
        const t = analyzeBoardTopology(g);
        expect(t.enclosedVoidCells).toBe(3);
    });

    it('5 格小空腔 → enclosedVoidCells = 5（恰在阈值上）', () => {
        const g = new Grid(9);
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        g.cells[3][4] = null;
        g.cells[4][4] = null;
        g.cells[4][5] = null;
        g.cells[5][5] = null;
        g.cells[5][4] = null;
        const t = analyzeBoardTopology(g);
        expect(t.enclosedVoidCells).toBe(5);
    });

    it('6 格分量 → enclosedVoidCells = 0（视为大空区，超过 K=5 阈值）', () => {
        const g = new Grid(9);
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        g.cells[3][4] = null;
        g.cells[4][4] = null;
        g.cells[4][5] = null;
        g.cells[5][5] = null;
        g.cells[5][4] = null;
        g.cells[6][4] = null;
        const t = analyzeBoardTopology(g);
        expect(t.enclosedVoidCells).toBe(0); // 6 格 > 5 阈值
        expect(t.isolatedHoles).toBe(0);
    });

    it('多个独立小空腔并存 → enclosedVoidCells 累计每片分量大小', () => {
        const g = new Grid(9);
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        g.cells[1][1] = null;                  // 1 格孤洞 → +1
        g.cells[3][3] = null; g.cells[3][4] = null;  // 2 格 → +2
        g.cells[6][6] = null; g.cells[6][7] = null; g.cells[7][7] = null; // 3 格 L → +3
        const t = analyzeBoardTopology(g);
        expect(t.enclosedVoidCells).toBe(1 + 2 + 3);
    });

    it('截图场景：密集块群里夹 4 个小空腔（1 + 2 + 1 + 2 格），UI 展示应反映 6 格——而非 isolatedHoles 的 2 格', () => {
        /* 复现用户 v1.60.5 反馈：4 个红色箭头指向密集块群里嵌入的小空腔，
         * isolatedHoles 只识别其中 2 个 4-邻全围的单格，漏掉 L 型小空腔。 */
        const g = new Grid(9);
        /* 整盘填满 */
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        /* 4 个被填块圈住的小空腔（远离边界 + 分量 size ≤ 5）： */
        g.cells[2][3] = null;                          // 1 格孤洞
        g.cells[3][5] = null; g.cells[3][6] = null;    // 2 格水平
        g.cells[5][2] = null;                          // 1 格孤洞
        g.cells[6][5] = null; g.cells[6][6] = null;    // 2 格水平
        const t = analyzeBoardTopology(g);
        /* enclosedVoidCells 应识别全部 6 格 */
        expect(t.enclosedVoidCells).toBe(6);
        /* isolatedHoles 只能识别 2 个 1-格孤洞（4 邻全填） */
        expect(t.isolatedHoles).toBe(2);
        /* 这正是 UI 切换的核心动机：让 UI 显示数与玩家视觉直觉对齐 */
    });

    it('enclosedVoidCells 联动 skipSpecialCells——邻接独立库的小空腔进 enclosedVoidCellsNearSpecial', () => {
        const g = new Grid(8);
        /* 围绕 (3,3)(3,4) 这 2 格空腔放填块，其中 (2,3) 是 isSpecial */
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 1;
        g.cells[3][3] = null; g.cells[3][4] = null;
        /* 重置 (2,3) 让 grid.place 写 _cellMeta */
        g.cells[2][3] = null;
        g.place([[1]], 1, 3, 2, { shapeId: '1x2', isSpecial: true });
        const def  = analyzeBoardTopology(g);
        const skip = analyzeBoardTopology(g, { skipSpecialCells: true });
        expect(def.enclosedVoidCells).toBe(2);
        expect(def.enclosedVoidCellsNearSpecial).toBe(0);
        expect(skip.enclosedVoidCells).toBe(0);
        expect(skip.enclosedVoidCellsNearSpecial).toBe(2);
        /* 守恒：两种口径下 enclosedVoidCells + enclosedVoidCellsNearSpecial 相等 */
        expect(skip.enclosedVoidCells + skip.enclosedVoidCellsNearSpecial)
            .toBe(def.enclosedVoidCells + def.enclosedVoidCellsNearSpecial);
    });

    it('enclosedVoidCells 在空盘上为 0；满盘上也为 0（无空格）', () => {
        const empty = new Grid(9);
        expect(analyzeBoardTopology(empty).enclosedVoidCells).toBe(0); // 整盘 81 格连通 > 5
        const full = new Grid(9);
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) full.cells[y][x] = 1;
        expect(analyzeBoardTopology(full).enclosedVoidCells).toBe(0); // 无空格
    });

    it('enclosedVoidCells ≥ isolatedHoles（4-邻全填的孤洞必然在 size=1 分量里，必被计入）', () => {
        const g = new Grid(9);
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) g.cells[y][x] = 1;
        g.cells[2][2] = null;                          // 1 格 → isolatedHoles + enclosedVoidCells
        g.cells[4][4] = null; g.cells[4][5] = null;    // 2 格 → 不计 isolatedHoles，但计 enclosedVoidCells
        const t = analyzeBoardTopology(g);
        expect(t.enclosedVoidCells).toBeGreaterThanOrEqual(t.isolatedHoles);
        expect(t.isolatedHoles).toBe(1);
        expect(t.enclosedVoidCells).toBe(3);
    });
});

describe('countEmptyRegions / countConcaveCorners（客观几何难度）', () => {
    it('空盘 = 1 个连通块、0 凹角', () => {
        const g = new Grid(8);
        expect(countEmptyRegions(g)).toBe(1);
        expect(countConcaveCorners(g)).toBe(0);
    });

    it('满盘 = 0 连通块、0 凹角', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 1;
        expect(countEmptyRegions(g)).toBe(0);
        expect(countConcaveCorners(g)).toBe(0);
    });

    it('一条墙把空盘切成两个连通块', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) g.cells[y][4] = 1; // 整列墙
        expect(countEmptyRegions(g)).toBe(2);
    });

    it('内凹缺口：占用 L 形（(0,1)+(1,0)）在 (1,1) 与对角 (0,0) 各形成 1 个凹角', () => {
        const g = new Grid(8);
        g.cells[0][1] = 1;
        g.cells[1][0] = 1;
        // (1,1) 的左上角 + (0,0) 的右下角，两正交邻居都被占 → 共 2 凹角
        expect(countConcaveCorners(g)).toBe(2);
    });

    it('「+」形围住 (3,3)：中心 4 + 四个对角空格各 1 = 8 凹角', () => {
        const g = new Grid(8);
        g.cells[2][3] = 1; g.cells[4][3] = 1; g.cells[3][2] = 1; g.cells[3][4] = 1;
        expect(countConcaveCorners(g)).toBe(8);
    });

    it('analyzeBoardTopology 暴露 contiguousRegions / concaveCorners', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) g.cells[y][4] = 1;
        const t = analyzeBoardTopology(g);
        expect(t.contiguousRegions).toBe(2);
        expect(t).toHaveProperty('concaveCorners');
    });
});
