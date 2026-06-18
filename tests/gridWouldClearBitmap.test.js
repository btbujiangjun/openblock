/**
 * BB3: Grid.wouldClear bitmap 优化 —— 行为契约 + 慢路径等价测试。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

function fillRow(g, y, except = -1) {
    for (let x = 0; x < g.size; x++) if (x !== except) g.cells[y][x] = 1;
}
function fillCol(g, x, except = -1) {
    for (let y = 0; y < g.size; y++) if (y !== except) g.cells[y][x] = 1;
}

const I1 = [[1]];
const I3 = [[1, 1, 1]];
const O2 = [[1, 1], [1, 1]];

describe('BB3 Grid.wouldClear bitmap 行为契约', () => {
    it('空盘任何位置都不消', () => {
        const g = new Grid(8);
        expect(g.wouldClear(I3, 0, 0)).toBe(false);
        expect(g.wouldClear(O2, 3, 3)).toBe(false);
    });

    it('整行差 1 格 + 在该位置放 1×1 → 消', () => {
        const g = new Grid(8);
        fillRow(g, 5, /* except */ 3);
        expect(g.wouldClear(I1, 3, 5)).toBe(true);
    });

    it('整列差 1 格 + 在该位置放 1×1 → 消', () => {
        const g = new Grid(8);
        fillCol(g, 4, /* except */ 2);
        expect(g.wouldClear(I1, 4, 2)).toBe(true);
    });

    it('放在错位置不消', () => {
        const g = new Grid(8);
        fillRow(g, 5, 3);
        expect(g.wouldClear(I1, 0, 0)).toBe(false);
    });

    it('1×3 横条补 row 5 的最后 3 格 → 消', () => {
        const g = new Grid(8);
        for (let x = 0; x < 5; x++) g.cells[5][x] = 1; /* 留 x=5..7 三格 */
        expect(g.wouldClear(I3, 5, 5)).toBe(true);
    });

    it('十字消：放置同时触发整行 + 整列', () => {
        const g = new Grid(8);
        fillRow(g, 4, 3);
        fillCol(g, 3, 4);
        expect(g.wouldClear(I1, 3, 4)).toBe(true);
    });
});

describe('BB3 wouldClear 快慢路径等价', () => {
    function randGrid(seed, n) {
        const g = new Grid(n);
        let s = seed;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            if ((s & 0xff) < 110) g.cells[y][x] = 1;
        }
        return g;
    }

    it('100 个随机盘面 + 随机 shape 位置，bitmap === slow（n=8）', () => {
        const shapes = [I1, I3, O2, [[1, 1, 1, 1]], [[1], [1], [1]]];
        for (let seed = 1; seed <= 100; seed++) {
            const g = randGrid(seed, 8);
            for (const shape of shapes) {
                const sh = shape.length;
                const sw = Math.max(...shape.map(r => r.length));
                for (let gy = 0; gy + sh <= 8; gy++) {
                    for (let gx = 0; gx + sw <= 8; gx++) {
                        const fast = g.wouldClear(shape, gx, gy);
                        const slow = g._wouldClearSlow(shape, gx, gy);
                        if (fast !== slow) {
                            throw new Error(`mismatch seed=${seed} shape=${JSON.stringify(shape)} (${gx},${gy}) fast=${fast} slow=${slow}`);
                        }
                    }
                }
            }
        }
    });
});

describe('BB3 wouldClear 边界 / 越界', () => {
    it('越界位置 → 返回 false（不抛错）', () => {
        const g = new Grid(8);
        expect(g.wouldClear(I3, 6, 0)).toBe(false); /* gx+3=9 越界 */
        expect(g.wouldClear(I3, 0, 8)).toBe(false); /* gy=8 越界 */
        expect(g.wouldClear(I3, -1, 0)).toBe(false);
    });

    it('n>30 走慢路径 fallback，行为一致', () => {
        const g = new Grid(31);
        for (let x = 0; x < 30; x++) g.cells[10][x] = 1;
        expect(g.wouldClear(I1, 30, 10)).toBe(true);
    });
});
