/**
 * Z5: Grid.checkLines 内部 helper 分拆契约。
 *
 * 主目标：保证 checkLines 公开 API 返回值 1:1 不变（行为契约）。
 * 同时验证 4 个内部 helper 各自的职责边界。
 *
 * 关键时序契约：bonusLines / clearedCells 必须在 _clearCellsAndMeta **之前**
 * 才能读到原 colorIdx —— 若顺序颠倒，会读到 null。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

function makeGrid(n = 4) { return new Grid(n); }

function fill(g, x, y, c = 1) { g.cells[y][x] = c; }

describe('Z5 Grid.checkLines —— 公开 API 行为契约不变', () => {
    it('空盘：返回 count=0 / 空数组', () => {
        const g = makeGrid(4);
        const r = g.checkLines();
        expect(r.count).toBe(0);
        expect(r.cells).toEqual([]);
        expect(r.bonusLines).toEqual([]);
        expect(r.rows).toEqual([]);
        expect(r.cols).toEqual([]);
    });

    it('一整行：count=1 / cells 4 个 / 该行 cells 被清', () => {
        const g = makeGrid(4);
        for (let x = 0; x < 4; x++) fill(g, x, 1, 2);
        const r = g.checkLines();
        expect(r.count).toBe(1);
        expect(r.cells).toHaveLength(4);
        expect(r.rows).toEqual([1]);
        expect(r.cols).toEqual([]);
        for (let x = 0; x < 4; x++) expect(g.cells[1][x]).toBeNull();
    });

    it('一整列：count=1 / 该列 cells 被清', () => {
        const g = makeGrid(4);
        for (let y = 0; y < 4; y++) fill(g, 2, y, 3);
        const r = g.checkLines();
        expect(r.count).toBe(1);
        expect(r.cols).toEqual([2]);
        for (let y = 0; y < 4; y++) expect(g.cells[y][2]).toBeNull();
    });

    it('十字（一行+一列）：count=2 / cleared cells 去重 (4+4-1=7)', () => {
        const g = makeGrid(4);
        for (let x = 0; x < 4; x++) fill(g, x, 1, 1);
        for (let y = 0; y < 4; y++) fill(g, 2, y, 1);
        const r = g.checkLines();
        expect(r.count).toBe(2);
        expect(r.cells).toHaveLength(7); /* 交叉点去重 */
    });

    it('同色行 → bonusLines 含 type=row', () => {
        const g = makeGrid(4);
        for (let x = 0; x < 4; x++) fill(g, x, 0, 5);
        const r = g.checkLines();
        expect(r.bonusLines).toEqual([{ type: 'row', idx: 0, colorIdx: 5 }]);
    });

    it('异色满行 → bonusLines 不含', () => {
        const g = makeGrid(4);
        fill(g, 0, 0, 1); fill(g, 1, 0, 2); fill(g, 2, 0, 1); fill(g, 3, 0, 1);
        const r = g.checkLines();
        expect(r.bonusLines).toEqual([]);
    });

    it('同色列 → bonusLines 含 type=col', () => {
        const g = makeGrid(4);
        for (let y = 0; y < 4; y++) fill(g, 3, y, 7);
        const r = g.checkLines();
        expect(r.bonusLines).toEqual([{ type: 'col', idx: 3, colorIdx: 7 }]);
    });

    it('clearedCells 保留原 color（清除前读到，验证关键时序契约）', () => {
        const g = makeGrid(4);
        fill(g, 0, 2, 1); fill(g, 1, 2, 9); fill(g, 2, 2, 1); fill(g, 3, 2, 1);
        const r = g.checkLines();
        const colors = r.cells.map(c => c.color).sort();
        expect(colors).toEqual([1, 1, 1, 9]); /* 1 个 9 + 3 个 1，含原色非 null */
    });
});

describe('Z5 内部 helper —— 职责边界', () => {
    it('_detectFullRowsCols 仅返回索引，不改 cells', () => {
        const g = makeGrid(4);
        for (let x = 0; x < 4; x++) fill(g, x, 0, 1);
        const { fullRows, fullCols } = g._detectFullRowsCols();
        expect(fullRows).toEqual([0]);
        expect(fullCols).toEqual([]);
        /* 不改变 cells */
        for (let x = 0; x < 4; x++) expect(g.cells[0][x]).toBe(1);
    });

    it('_detectBonusLines 在 cells 未清除时读原 colorIdx', () => {
        const g = makeGrid(4);
        for (let x = 0; x < 4; x++) fill(g, x, 0, 5);
        const bonus = g._detectBonusLines([0], []);
        expect(bonus).toEqual([{ type: 'row', idx: 0, colorIdx: 5 }]);
    });

    it('_collectClearedCells 在 cells 未清除时读原 color', () => {
        const g = makeGrid(4);
        for (let x = 0; x < 4; x++) fill(g, x, 0, 5);
        const cleared = g._collectClearedCells([0], []);
        expect(cleared).toHaveLength(4);
        for (const c of cleared) expect(c.color).toBe(5);
    });

    it('_clearCellsAndMeta 实际清除 cells + 同步清 meta', () => {
        const g = makeGrid(4);
        for (let x = 0; x < 4; x++) fill(g, x, 0, 5);
        g._cellMeta = new Map();
        g._cellMeta.set('0,0', { placedBy: 's1' });
        g._clearCellsAndMeta([0], []);
        for (let x = 0; x < 4; x++) expect(g.cells[0][x]).toBeNull();
        expect(g._cellMeta.has('0,0')).toBe(false);
    });

    it('时序契约证明：先清后读 → color 全 null（反例验证为何顺序重要）', () => {
        const g = makeGrid(4);
        for (let x = 0; x < 4; x++) fill(g, x, 0, 5);
        /* 故意颠倒顺序：先清后收集 */
        g._clearCellsAndMeta([0], []);
        const cleared = g._collectClearedCells([0], []);
        /* 若 checkLines 顺序错了，cleared 的 color 将全是 null */
        for (const c of cleared) expect(c.color).toBeNull();
    });
});
