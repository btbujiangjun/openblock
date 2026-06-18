/**
 * AA2: Grid._buildBitmapView —— canPlaceAnywhere / countValidPlacements 共享底层契约。
 *
 * 验证：
 *   - 共享 helper 返回值结构正确
 *   - 边界条件返回 null（触发慢路径回退）
 *   - 慢路径与快路径结果一致
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

function fill(g, x, y, c = 1) { g.cells[y][x] = c; }

const I3 = [[1, 1, 1]]; /* 1×3 横条 */
const O2 = [[1, 1], [1, 1]]; /* 2×2 */

describe('AA2 Grid._buildBitmapView —— 共享 bitmap helper', () => {
    it('正常 shape → 返回完整 view 结构', () => {
        const g = new Grid(8);
        const v = g._buildBitmapView(I3);
        expect(v).not.toBeNull();
        expect(v.sh).toBe(1);
        expect(v.sw).toBe(3);
        expect(v.n).toBe(8);
        expect(v.maxGy).toBe(7); /* n - sh = 8 - 1 */
        expect(v.maxGx).toBe(5); /* n - sw = 8 - 3 */
        expect(v.occRows).toBeInstanceOf(Int32Array);
        expect(v.rowMasks).toBeInstanceOf(Int32Array);
        expect(v.occRows.length).toBe(8);
        expect(v.rowMasks.length).toBe(1);
    });

    it('rowMasks 编码正确（I3 → [0b111 = 7]）', () => {
        const g = new Grid(8);
        const v = g._buildBitmapView(I3);
        expect(v.rowMasks[0]).toBe(0b111);
    });

    it('occRows 编码正确（fill (2,3) → row 3 第 2 位）', () => {
        const g = new Grid(8);
        fill(g, 2, 3);
        const v = g._buildBitmapView(I3);
        expect(v.occRows[3]).toBe(0b100); /* 1 << 2 */
        expect(v.occRows[0]).toBe(0);
    });

    it('非数组 / 空 shape → 返回 null', () => {
        const g = new Grid(8);
        expect(g._buildBitmapView(null)).toBeNull();
        expect(g._buildBitmapView(undefined)).toBeNull();
        expect(g._buildBitmapView([])).toBeNull();
    });

    it('全空 shape → 返回 null（anyCell=false）', () => {
        const g = new Grid(8);
        expect(g._buildBitmapView([[0, 0], [0, 0]])).toBeNull();
    });

    it('sw=0 / 内层全空 → 返回 null', () => {
        const g = new Grid(8);
        expect(g._buildBitmapView([[], []])).toBeNull();
    });

    it('n > 30 → 返回 null（回退慢路径）', () => {
        const g = new Grid(31);
        expect(g._buildBitmapView(I3)).toBeNull();
    });
});

describe('AA2 公开 API 行为契约不变', () => {
    it('canPlaceAnywhere：空盘任何 shape 都能放', () => {
        const g = new Grid(8);
        expect(g.canPlaceAnywhere(I3)).toBe(true);
        expect(g.canPlaceAnywhere(O2)).toBe(true);
    });

    it('canPlaceAnywhere：填满后无法放', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) fill(g, x, y);
        expect(g.canPlaceAnywhere(I3)).toBe(false);
    });

    it('countValidPlacements：空 8x8 + I3 → 6*8=48 个位置', () => {
        const g = new Grid(8);
        /* I3 横条 1×3：maxGx=5, maxGy=7 → 6*8 = 48 */
        expect(g.countValidPlacements(I3)).toBe(48);
    });

    it('countValidPlacements：空 8x8 + O2 → 7*7=49', () => {
        const g = new Grid(8);
        expect(g.countValidPlacements(O2)).toBe(49);
    });

    it('快路径与慢路径结果一致（n=31 强制慢路径）', () => {
        const g = new Grid(31);
        const r = g.countValidPlacements(I3);
        /* 31 - 3 + 1 = 29 横向 / 31 纵向 → 29 * 31 = 899 */
        expect(r).toBe(899);
    });

    it('canPlaceAnywhere/countValidPlacements 对 null/空数组返回安全值', () => {
        const g = new Grid(8);
        expect(g.canPlaceAnywhere(null)).toBe(false);
        expect(g.canPlaceAnywhere([])).toBe(false);
        expect(g.countValidPlacements(null)).toBe(0);
        expect(g.countValidPlacements([])).toBe(0);
        /* 注意：全 0 shape（如 [[0,0]]）走慢路径回退，canPlace 在 cells 全 null
         * 时返回 true（无 cell 冲突），故 canPlaceAnywhere=true / count=n*n。
         * 这与原 U2 实现行为一致（慢路径 canPlace 不区分形状是否"真有内容"）。 */
        expect(g.canPlaceAnywhere([[0, 0]])).toBe(true);
        expect(g.countValidPlacements([[0, 0]])).toBe(64);
    });
});
