/**
 * EE3: Grid.countGapFills bitmap 路径 —— 快慢路径等价 + 行为契约。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

const I1 = [[1]];
const I3 = [[1, 1, 1]];
const O2 = [[1, 1], [1, 1]];

function fillRow(g, y, except = -1) {
    for (let x = 0; x < g.size; x++) if (x !== except) g.cells[y][x] = 1;
}

describe('EE3 countGapFills 行为契约', () => {
    it('空盘 → 0（所有行/列都 8 空，超 4 阈值过滤）', () => {
        const g = new Grid(8);
        expect(g.countGapFills(I1)).toBe(0);
    });

    it('行差 1 + 1×1 可补 → fills += max(1, 4-1) = 3', () => {
        const g = new Grid(8);
        fillRow(g, 5, 3);
        expect(g.countGapFills(I1)).toBe(3);
    });

    it('行差 3 (3 个相邻空) + 1×3 可补 → fills += max(1, 4-3) = 1', () => {
        const g = new Grid(8);
        for (let x = 0; x < 5; x++) g.cells[2][x] = 1; /* 行 2 空 x=5..7 */
        /* 1×3 可放在 (5, 2)（其他位置不行） */
        expect(g.countGapFills(I3)).toBe(1);
    });

    it('2×2 无可放 1×1 gap → 0（行差 2 但 1×1 也能放）→ 实际可放', () => {
        const g = new Grid(8);
        fillRow(g, 5, 3);
        fillRow(g, 5, 3); /* 双重保险 — 行只差 1 */
        expect(g.countGapFills(O2)).toBe(0); /* 2×2 在 8x8 几乎处处可放 — 但 gap 在 1 个空 → 这行不算 */
    });
});

describe('EE3 快慢路径等价 100 随机盘 × 6 shape', () => {
    function randGrid(seed, n) {
        const g = new Grid(n);
        let s = seed;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            if ((s & 0xff) < 180) g.cells[y][x] = 1;
        }
        return g;
    }

    it('fast === slow for 100 boards × 6 shapes', () => {
        const shapes = [I1, I3, O2, [[1], [1], [1]], [[1, 1, 1, 1]], [[1, 1], [1, 0]]];
        for (let seed = 1; seed <= 100; seed++) {
            const g = randGrid(seed, 8);
            for (const shape of shapes) {
                const fast = g.countGapFills(shape);
                const slow = g._countGapFillsSlow(shape);
                if (fast !== slow) {
                    throw new Error(`mismatch seed=${seed} shape=${JSON.stringify(shape)} fast=${fast} slow=${slow}`);
                }
            }
        }
    });
});

describe('EE3 边界', () => {
    it('n=31 走慢路径 fallback', () => {
        const g = new Grid(31);
        for (let x = 0; x < 30; x++) g.cells[10][x] = 1;
        expect(g.countGapFills(I1)).toBe(3); /* 1 空 → max(1, 4-1)=3 */
    });

    it('shape 完全不能放 → 0', () => {
        const g = new Grid(8);
        /* 填满 */
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 1;
        expect(g.countGapFills(I1)).toBe(0);
    });
});
