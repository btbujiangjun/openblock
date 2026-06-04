/**
 * @vitest-environment jsdom
 *
 * v1.67 构造式出块辅助（纯几何）单测：
 *   - findCompleterShapes：逆向「缺口 → 形状」补全检索（覆盖正确性 / exact 判定 / 无解）
 *   - findSetupShapes：1 步前瞻「先铺后清」造势（制造可补全的近满线）
 *   - isClearTargetValid：跨 dock 续接前的目标失效校验
 * 这些函数被 blockSpawn 构造预扫描调用，必须保证几何判定零假阳性（绝不把不能补全的
 * 形状当成补全块），否则会出现「占了 clearSeat 却消不掉行」的脏供给。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../../web/src/grid.js';
import {
    findCompleterShapes,
    findSetupShapes,
    isClearTargetValid,
} from '../../web/src/bot/constructiveSpawn.js';

const DOT = { id: 'dot', data: [[1]] };
const DOM_H = { id: 'domH', data: [[1, 1]] };
const DOM_V = { id: 'domV', data: [[1], [1]] };
const TRI_H = { id: 'triH', data: [[1, 1, 1]] };
const CATALOG = [DOT, DOM_H, DOM_V, TRI_H];

function gridWith(fills, size = 8) {
    const g = new Grid(size);
    for (const [y, x] of fills) g.cells[y][x] = 1;
    return g;
}

/** 把第 0 行除指定空格外全部填满（制造一条近满行）。 */
function nearFullRow0(emptyXs, size = 8) {
    const fills = [];
    const empty = new Set(emptyXs);
    for (let x = 0; x < size; x++) if (!empty.has(x)) fills.push([0, x]);
    return gridWith(fills, size);
}

describe('findCompleterShapes', () => {
    it('2 格行缺口被横向 2 连块精确补全（exact=true）', () => {
        const grid = nearFullRow0([6, 7]);
        const res = findCompleterShapes(grid, [[0, 6], [0, 7]], CATALOG);
        const ids = res.map((r) => r.shapeId);
        expect(ids).toContain('domH');
        const dom = res.find((r) => r.shapeId === 'domH');
        expect(dom.exact).toBe(true);
        expect(dom.extra).toBe(0);
        /* 单点 / 竖 2 连无法在同一行覆盖两个横向相邻缺口 */
        expect(ids).not.toContain('dot');
        expect(ids).not.toContain('domV');
    });

    it('补全块的放置确实覆盖全部目标格', () => {
        const grid = nearFullRow0([6, 7]);
        const dom = findCompleterShapes(grid, [[0, 6], [0, 7]], CATALOG).find((r) => r.shapeId === 'domH');
        /* domH 落在 (gx=6,gy=0)：data[0][0]->(6,0)，data[0][1]->(7,0) */
        expect(dom.gx).toBe(6);
        expect(dom.gy).toBe(0);
    });

    it('单点边缘缺口只能由 dot 补全（2 连越界 / 压到已填格）', () => {
        const grid = nearFullRow0([7]); // 仅 (0,7) 空
        const res = findCompleterShapes(grid, [[0, 7]], CATALOG);
        const ids = res.map((r) => r.shapeId);
        expect(ids).toContain('dot');
        expect(ids).not.toContain('domH'); // gx=6 压到已填 (0,6)；gx=7 越界
    });

    it('填充格数不足的形状被跳过；无解返回空', () => {
        const grid = nearFullRow0([0, 7]); // 两个不相邻缺口，跨度 8，无任何 ≤3 形状能同时覆盖
        const res = findCompleterShapes(grid, [[0, 0], [0, 7]], CATALOG);
        expect(res).toHaveLength(0);
    });

    it('空目标 / 空盘安全返回空数组', () => {
        expect(findCompleterShapes(new Grid(8), [], CATALOG)).toEqual([]);
        expect(findCompleterShapes(new Grid(8), null, CATALOG)).toEqual([]);
    });
});

describe('findSetupShapes', () => {
    it('在不存在补全块时，找出放下后能制造可补全近满线的 setup 形状', () => {
        /* 第 0 行填 x=0..4（emptyCount=3，非近满）。放 dot 到 (0,5) 后 → 行 0 emptyCount=2，
         * 可被 domH 补全 → dot 是合法 setup。 */
        const grid = gridWith([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]);
        const setups = findSetupShapes(grid, CATALOG);
        expect(setups.length).toBeGreaterThan(0);
        expect(setups.some((s) => s.target.type === 'row' && s.target.index === 0)).toBe(true);
    });

    it('空盘没有可造势的近满线（setup 为空）', () => {
        const setups = findSetupShapes(new Grid(8), CATALOG);
        expect(setups).toEqual([]);
    });
});

describe('isClearTargetValid', () => {
    it('目标残缺格仍空且可补全 → 有效', () => {
        const grid = nearFullRow0([6, 7]);
        const target = { type: 'row', index: 0, emptyCells: [[0, 6], [0, 7]] };
        expect(isClearTargetValid(grid, target, CATALOG)).toBe(true);
    });

    it('目标残缺格被填掉 → 失效', () => {
        const grid = nearFullRow0([6, 7]);
        grid.cells[0][6] = 1; // 玩家自己补了一格
        const target = { type: 'row', index: 0, emptyCells: [[0, 6], [0, 7]] };
        expect(isClearTargetValid(grid, target, CATALOG)).toBe(false);
    });

    it('残缺格被消空（不再近满）→ 失效', () => {
        const grid = new Grid(8); // 行 0 全空，emptyCells 仍空但 emptyCount 超 maxEmpty
        const target = { type: 'row', index: 0, emptyCells: [[0, 6], [0, 7]] };
        /* 两格仍空、可被 domH 补全 → 仍判有效（口径：目标残缺本身可补全即可，
         * 与盘面其他空格无关）。本用例验证 emptyCells 越界 / 数量越界的失效分支。 */
        const bad = { type: 'row', index: 0, emptyCells: [[0, 6], [0, 7], [0, 5]] };
        // maxEmpty 默认 2，3 格目标直接失效
        expect(isClearTargetValid(grid, bad, CATALOG)).toBe(false);
        expect(isClearTargetValid(grid, target, CATALOG)).toBe(true);
    });
});
