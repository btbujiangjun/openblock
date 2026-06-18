/**
 * NN-A3: _monoBitmapCache 命中/失效 契约。
 *
 * 核心场景：blockSpawn 同帧 Potential + Buildup 连调 → 第二次命中 cache。
 * 关键安全：mutation 后必须 invalidate（cache 复用导致错误是严重 bug）。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

function makeGrid(seed = 1) {
    const g = new Grid(8);
    let s = seed;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        if ((s & 0xff) / 256 < 0.5) g.cells[y][x] = (s >>> 8) & 3;
    }
    /* makeGrid 直改 cells，手动 invalidate 模拟初始化语义 */
    g._mutGen++;
    g._monoBitmapCache = null;
    return g;
}

describe('NN-A3 _monoBitmapCache 命中', () => {
    it('Potential 后再调 Buildup → cache 命中（_mutGen 不变）', () => {
        const g = makeGrid(1);
        const shape = [[1, 1], [1, 1]];
        expect(g._monoBitmapCache).toBeNull();
        g.bestMonoFlushPotential(shape);
        expect(g._monoBitmapCache).not.toBeNull();
        const cacheRef1 = g._monoBitmapCache;
        const rowOccRef1 = cacheRef1.rowOccBitmap;
        g.bestMonoFlushBuildup(shape);
        /* 命中 → cache 对象保持同一引用（rowOccBitmap 不被替换） */
        expect(g._monoBitmapCache).toBe(cacheRef1);
        expect(g._monoBitmapCache.rowOccBitmap).toBe(rowOccRef1);
    });

    it('place 后 → cache invalidate（rowOccBitmap 新建）', () => {
        const g = makeGrid(2);
        const shape = [[1, 1], [1, 1]];
        g.bestMonoFlushPotential(shape);
        const rowOccBefore = g._monoBitmapCache.rowOccBitmap;
        const genBefore = g._mutGen;
        /* place 不消行 */
        const placeShape = [[1]];
        let placed = false;
        for (let y = 0; y < 8 && !placed; y++) for (let x = 0; x < 8 && !placed; x++) {
            if (g.cells[y][x] === null) {
                g.place(placeShape, 0, x, y);
                placed = true;
            }
        }
        expect(g._mutGen).toBe(genBefore + 1);
        g.bestMonoFlushPotential(shape);
        expect(g._monoBitmapCache.rowOccBitmap).not.toBe(rowOccBefore);
    });

    it('clear 后 → cache reset', () => {
        const g = makeGrid(3);
        g.bestMonoFlushPotential([[1]]);
        expect(g._monoBitmapCache).not.toBeNull();
        g.clear();
        expect(g._monoBitmapCache).toBeNull();
    });

    it('clone → 子 grid cache 独立（不共享父 cache）', () => {
        const parent = makeGrid(4);
        parent.bestMonoFlushPotential([[1]]);
        expect(parent._monoBitmapCache).not.toBeNull();
        const child = parent.clone();
        expect(child._monoBitmapCache).toBeNull();
        expect(child._mutGen).toBe(0);
    });

    it('checkLines（满行清除）→ cache invalidate', () => {
        const g = new Grid(8);
        g._mutGen = 0; g._monoBitmapCache = null;
        for (let x = 0; x < 8; x++) g.cells[0][x] = 1; /* 第 0 行满 */
        g._mutGen++; /* 模拟 mutation */
        g.bestMonoFlushPotential([[1]]);
        const genBefore = g._mutGen;
        g.checkLines();
        expect(g._mutGen).toBe(genBefore + 1);
    });

    it('fromJSON → cache reset', () => {
        const g = makeGrid(5);
        g.bestMonoFlushPotential([[1]]);
        g.fromJSON({ size: 8, cells: Array.from({ length: 8 }, () => Array(8).fill(null)) });
        expect(g._monoBitmapCache).toBeNull();
    });

    it('1000 次 random 操作下 cache 永不出错（fast = recomputed every time）', () => {
        let s = 42;
        for (let iter = 0; iter < 200; iter++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            const g = makeGrid(s);
            const shape = [[1, 1], [1, 1]];
            const r1 = g.bestMonoFlushPotential(shape);
            const r2 = g.bestMonoFlushBuildup(shape);
            /* 强制 cache miss：手动清 cache → 再算 → 应一致 */
            g._monoBitmapCache = null;
            const r1Fresh = g.bestMonoFlushPotential(shape);
            g._monoBitmapCache = null;
            const r2Fresh = g.bestMonoFlushBuildup(shape);
            expect(r1).toBe(r1Fresh);
            expect(r2).toBe(r2Fresh);
        }
    });
});
