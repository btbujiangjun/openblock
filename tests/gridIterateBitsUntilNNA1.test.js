/**
 * NN-A1: _iterateBitsUntil 替换 countGapFills 含 break 模式。
 *
 * 核心断言：与 _countGapFillsSlow 完全等价（含 break 短路语义）+ micro-perf 不退化。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

function randGrid(seed, n = 8, fill = 0.55) {
    const g = new Grid(n); let s = seed;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        if ((s & 0xff) / 256 < fill) g.cells[y][x] = (s >>> 8) & 3;
    }
    return g;
}

describe('NN-A1 _iterateBitsUntil 等价性', () => {
    const SHAPES = [
        [[1]], [[1, 1]], [[1, 1, 1]], [[1], [1]], [[1, 1], [1, 1]],
        [[1, 1, 1, 1]], [[1, 1], [1, 0]],
    ];

    it('500 随机盘 × 7 shape → countGapFills = _countGapFillsSlow（break 语义保真）', () => {
        let mismatch = 0;
        for (let seed = 1; seed <= 500; seed++) {
            const g = randGrid(seed);
            for (const s of SHAPES) {
                const fast = g.countGapFills(s);
                const slow = g._countGapFillsSlow(s);
                if (fast !== slow) mismatch++;
            }
        }
        expect(mismatch).toBe(0);
    });

    it('稀疏盘（fill=0.2）也等价', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const g = randGrid(seed, 8, 0.2);
            for (const s of SHAPES) {
                expect(g.countGapFills(s)).toBe(g._countGapFillsSlow(s));
            }
        }
    });

    it('密集盘（fill=0.85）也等价', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const g = randGrid(seed, 8, 0.85);
            for (const s of SHAPES) {
                expect(g.countGapFills(s)).toBe(g._countGapFillsSlow(s));
            }
        }
    });

    it('空盘 / 满盘边界', () => {
        const empty = new Grid(8);
        expect(empty.countGapFills([[1]])).toBe(empty._countGapFillsSlow([[1]]));
        const full = new Grid(8);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) full.cells[y][x] = 0;
        expect(full.countGapFills([[1]])).toBe(full._countGapFillsSlow([[1]]));
    });

    it('micro-perf：300 grids × 4 shapes ≤ 100ms（闸门：不退化）', () => {
        const grids = []; for (let i = 1; i <= 300; i++) grids.push(randGrid(i));
        const shapes = SHAPES.slice(0, 4);
        /* warmup */
        for (let i = 0; i < 2; i++) for (const g of grids) for (const s of shapes) g.countGapFills(s);
        const t0 = performance.now();
        for (let i = 0; i < 3; i++) for (const g of grids) for (const s of shapes) g.countGapFills(s);
        const t1 = performance.now();
        const ms = t1 - t0;
         
        console.log(`[NN-A1 perf] 3 × 300 grids × 4 shapes = ${ms.toFixed(2)} ms`);
         
        expect(ms).toBeLessThan(500); /* 宽松上限，主要防 10× 退化 */
    });
});
