/**
 * CC3: Grid.countClearLines bitmap 路径等价 + 行为契约。
 *
 * countClearLines 是 bestMultiClearPotential / adaptiveSpawn 的核心热点
 * （40 形状 × 64 落点反复调用）。Bitmap 路径需 1:1 行为等价才能上线。
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
const V3 = [[1], [1], [1]];

describe('CC3 countClearLines 行为契约', () => {
    it('空盘 → 0 lines', () => {
        const g = new Grid(8);
        expect(g.countClearLines(I3, 0, 0)).toBe(0);
        expect(g.countClearLines(O2, 3, 3)).toBe(0);
    });

    it('不可放置 → 返回 0', () => {
        const g = new Grid(8);
        g.cells[0][0] = 1;
        expect(g.countClearLines(I1, 0, 0)).toBe(0);
    });

    it('1×1 补 row 5 最后空 → lines=1', () => {
        const g = new Grid(8);
        fillRow(g, 5, 3);
        expect(g.countClearLines(I1, 3, 5)).toBe(1);
    });

    it('1×1 补 col 4 最后空 → lines=1', () => {
        const g = new Grid(8);
        fillCol(g, 4, 2);
        expect(g.countClearLines(I1, 4, 2)).toBe(1);
    });

    it('十字消：放置同时触发整行 + 整列 → lines=2', () => {
        const g = new Grid(8);
        fillRow(g, 4, 3);
        fillCol(g, 3, 4);
        expect(g.countClearLines(I1, 3, 4)).toBe(2);
    });

    it('1×3 补 row 5 末尾 3 格 → lines=1', () => {
        const g = new Grid(8);
        for (let x = 0; x < 5; x++) g.cells[5][x] = 1;
        expect(g.countClearLines(I3, 5, 5)).toBe(1);
    });

    it('1×3 同时消 row 5 + row 6（两行各差 3，新块横放在跨界 — 不可能；改: V3 补 col 4 末 3 格）', () => {
        const g = new Grid(8);
        for (let y = 0; y < 5; y++) g.cells[y][4] = 1;
        expect(g.countClearLines(V3, 4, 5)).toBe(1); /* 仅消 col 4 */
    });
});

describe('CC3 countClearLines 快慢路径等价（100 随机盘 + 5 shape × 全位）', () => {
    function randGrid(seed, n) {
        const g = new Grid(n);
        let s = seed;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            if ((s & 0xff) < 110) g.cells[y][x] = 1;
        }
        return g;
    }

    it('100 随机盘 × 5 shape × 全 (gx,gy) bitmap === slow', () => {
        const shapes = [I1, I3, O2, V3, [[1, 1, 1, 1]]];
        let totalAssertions = 0;
        for (let seed = 1; seed <= 100; seed++) {
            const g = randGrid(seed, 8);
            for (const shape of shapes) {
                const sh = shape.length;
                const sw = Math.max(...shape.map(r => r.length));
                for (let gy = 0; gy + sh <= 8; gy++) {
                    for (let gx = 0; gx + sw <= 8; gx++) {
                        const fast = g.countClearLines(shape, gx, gy);
                        if (!g.canPlace(shape, gx, gy)) {
                            expect(fast).toBe(0);
                        } else {
                            const slow = g._countClearLinesSlow(shape, gx, gy);
                            if (fast !== slow) {
                                throw new Error(`mismatch seed=${seed} shape=${JSON.stringify(shape)} (${gx},${gy}) fast=${fast} slow=${slow}`);
                            }
                        }
                        totalAssertions++;
                    }
                }
            }
        }
        expect(totalAssertions).toBeGreaterThan(10_000);
    });
});

describe('CC3 countClearLines 与 previewClearOutcome 一致性', () => {
    it('countClearLines === preview.rows.length + preview.cols.length', () => {
        const g = new Grid(8);
        fillRow(g, 3, 2);
        fillCol(g, 5, 1);
        for (let gy = 0; gy + 1 <= 8; gy++) {
            for (let gx = 0; gx + 1 <= 8; gx++) {
                const c = g.countClearLines(I1, gx, gy);
                const p = g.previewClearOutcome(I1, gx, gy, 0);
                const expected = p ? (p.rows.length + p.cols.length) : 0;
                expect(c).toBe(expected);
            }
        }
    });
});

describe('CC3 边界', () => {
    it('n=31 走慢路径 fallback，行为一致', () => {
        const g = new Grid(31);
        for (let x = 0; x < 30; x++) g.cells[10][x] = 1;
        expect(g.countClearLines(I1, 30, 10)).toBe(1);
    });
});
