/**
 * @vitest-environment jsdom
 *
 * ClearRuleEngine 单元测试
 * 覆盖：RowColRule、ZoneClearRule、DiagonalRule、ClearRuleEngine 组合、apply 去重
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    RowColRule, DiagonalRule, makeZoneClearRule,
    ClearRuleEngine, defaultClearEngine,
} from '../web/src/clearRules.js';

// ------------------------------------------------------------------ helpers
function filledGrid(size = 8) {
    const g = new Grid(size);
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
            g.cells[y][x] = 1;
    return g;
}

function fillRow(grid, row) {
    for (let x = 0; x < grid.size; x++) grid.cells[row][x] = 1;
}
function fillCol(grid, col) {
    for (let y = 0; y < grid.size; y++) grid.cells[y][col] = 1;
}
function fillDiag(grid, anti = false) {
    const n = grid.size;
    for (let i = 0; i < n; i++) {
        const x = anti ? n - 1 - i : i;
        grid.cells[i][x] = 1;
    }
}

// ------------------------------------------------------------------ RowColRule

describe('RowColRule', () => {
    it('空棋盘：无消除', () => {
        const g = new Grid(8);
        const { cells, lines } = RowColRule.detect(g);
        expect(cells).toHaveLength(0);
        expect(lines).toBe(0);
    });

    it('一整行满：消除 8 格，lines=1', () => {
        const g = new Grid(8);
        fillRow(g, 3);
        const { cells, lines } = RowColRule.detect(g);
        expect(lines).toBe(1);
        expect(cells).toHaveLength(8);
        expect(cells.every(c => c.y === 3)).toBe(true);
    });

    it('一整列满：消除 8 格，lines=1', () => {
        const g = new Grid(8);
        fillCol(g, 5);
        const { cells, lines } = RowColRule.detect(g);
        expect(lines).toBe(1);
        expect(cells).toHaveLength(8);
        expect(cells.every(c => c.x === 5)).toBe(true);
    });

    it('行列交叉：交叉格不重复', () => {
        const g = new Grid(8);
        fillRow(g, 0);
        fillCol(g, 0);
        const { cells, lines } = RowColRule.detect(g);
        expect(lines).toBe(2);
        // 行 8 格 + 列 8 格 − 1 交叉格 = 15
        expect(cells).toHaveLength(15);
    });

    it('detect 不修改 grid（幂等）', () => {
        const g = new Grid(8);
        fillRow(g, 2);
        RowColRule.detect(g);
        expect(g.cells[2][0]).not.toBeNull();
    });
});

// ------------------------------------------------------------------ DiagonalRule

describe('DiagonalRule', () => {
    it('主对角线填满：lines=1', () => {
        const g = new Grid(8);
        fillDiag(g, false);
        const { lines, cells } = DiagonalRule.detect(g);
        expect(lines).toBe(1);
        expect(cells).toHaveLength(8);
    });

    it('反对角线填满：lines=1', () => {
        const g = new Grid(8);
        fillDiag(g, true);
        const { lines } = DiagonalRule.detect(g);
        expect(lines).toBe(1);
    });

    it('双对角线同时填满：lines=2，交叉格去重', () => {
        const g = new Grid(8);
        fillDiag(g, false);
        fillDiag(g, true);
        const { lines, cells } = DiagonalRule.detect(g);
        expect(lines).toBe(2);
        // 8×8 棋盘两条对角线不存在交叉格（奇数 N 才有中心格）→ 8+8=16
        expect(cells).toHaveLength(16);
    });

    it('未满：无消除', () => {
        const g = new Grid(8);
        g.cells[0][0] = 1;  // 只填一格
        const { lines } = DiagonalRule.detect(g);
        expect(lines).toBe(0);
    });
});

// ------------------------------------------------------------------ ZoneClearRule

describe('makeZoneClearRule', () => {
    it('单区域填满：触发消除', () => {
        const g = new Grid(8);
        const zone = { x: 0, y: 0, w: 3, h: 2 };
        for (let y = 0; y < 2; y++)
            for (let x = 0; x < 3; x++)
                g.cells[y][x] = 1;

        const rule = makeZoneClearRule([zone]);
        const { cells, lines } = rule.detect(g);
        expect(lines).toBe(1);
        expect(cells).toHaveLength(6);
    });

    it('区域部分填满：不触发', () => {
        const g = new Grid(8);
        g.cells[0][0] = 1;  // 只填一格
        const rule = makeZoneClearRule([{ x: 0, y: 0, w: 2, h: 2 }]);
        const { lines } = rule.detect(g);
        expect(lines).toBe(0);
    });

    it('两个独立区域：都满时各消一次', () => {
        const g = new Grid(8);
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.cells[y][x] = 1;
        for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) g.cells[y][x] = 1;

        const rule = makeZoneClearRule([
            { x: 0, y: 0, w: 2, h: 2 },
            { x: 4, y: 4, w: 2, h: 2 },
        ]);
        const { lines } = rule.detect(g);
        expect(lines).toBe(2);
    });
});

// ------------------------------------------------------------------ ClearRuleEngine

describe('ClearRuleEngine', () => {
    it('默认（RowColRule）行为与 grid.checkLines() 一致', () => {
        const g1 = new Grid(8);
        const g2 = new Grid(8);
        fillRow(g1, 2);
        fillRow(g2, 2);

        const native = g1.checkLines();
        const engine = new ClearRuleEngine([RowColRule]).apply(g2);

        expect(engine.count).toBe(native.count);
        expect(engine.cells.length).toBe(native.cells.length);
    });

    it('apply 实际清除格子', () => {
        const g = new Grid(8);
        fillRow(g, 0);
        new ClearRuleEngine([RowColRule]).apply(g);
        expect(g.cells[0].every(c => c === null)).toBe(true);
    });

    it('多规则组合：行列 + 对角线', () => {
        const g = new Grid(8);
        fillRow(g, 0);   // 行消除
        fillDiag(g, false);  // 主对角线（行 0 第 0 格重叠）

        const engine = new ClearRuleEngine([RowColRule, DiagonalRule]);
        const { count, cells } = engine.apply(g);

        // RowColRule: 1 行（8 格）；DiagonalRule: 1 对角（8 格，其中 0,0 已在行中去重 → 7 新格）
        expect(count).toBe(2);
        expect(cells.length).toBe(15);  // 8 + 8 - 1 交叉
    });

    it('addRule / removeRule 链式调用', () => {
        const engine = new ClearRuleEngine([RowColRule]);
        engine.addRule(DiagonalRule);
        expect(engine.rules).toHaveLength(2);
        engine.removeRule('diagonal');
        expect(engine.rules).toHaveLength(1);
        expect(engine.rules[0].id).toBe('row_col');
    });

    it('defaultClearEngine 可直接使用', () => {
        const g = new Grid(8);
        fillRow(g, 1);
        const { count } = defaultClearEngine.apply(g);
        expect(count).toBe(1);
    });
});
