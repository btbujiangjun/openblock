/**
 * II1: bestMonoFlushPotential bitmap canPlace 阶段 2 边界 + 等价。
 *
 * HH2 已加 1750+ 等价断言（gridMonoFlushHH2.test.js）。II1 专注：
 *   - 新加的 row bitmap & shape-bits<<ox 不越界
 *   - shape 横跨整行（sw=n）时 ox=0 edge case
 *   - 空行（shapeRowBits[dy]=0 跳过）正确处理
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

describe('II1 bestMonoFlushPotential canPlace bitmap 边界', () => {
    it('shape 横跨整行 (sw=n)：ox 只能是 0，不应越界', () => {
        const g = new Grid(8);
        for (let x = 0; x < 7; x++) g.cells[3][x] = 0; /* 行 3 留最后一格空 */
        /* shape 是 1×8 但只有最后一个 cell 占用——空时 collide=false */
        const shape = [[0, 0, 0, 0, 0, 0, 0, 1]];
        /* 8×8 盘上唯一可能 placement 是 ox=0 oy=任意 */
        const count = g.bestMonoFlushPotential(shape);
        expect(count).toBeGreaterThanOrEqual(0); /* 不抛错即通过 */
    });

    it('shape 是稀疏（含空行）→ 空行 shapeRowBits[dy]=0 直接跳过', () => {
        const g = new Grid(8);
        const shape = [
            [1, 0, 0],
            [0, 0, 0], /* 空行 */
            [0, 0, 1],
        ];
        /* 不该抛错；count 取决于盘面 */
        expect(() => g.bestMonoFlushPotential(shape)).not.toThrow();
    });

    it('shape 中含空 column → shapeColFill[sx]=0 也不冲突', () => {
        const g = new Grid(8);
        const shape = [
            [1, 0, 1],
            [1, 0, 1],
        ];
        expect(() => g.bestMonoFlushPotential(shape)).not.toThrow();
    });

    it('空盘 + 全 1 shape 不应崩溃', () => {
        const g = new Grid(8);
        const shape = [[1, 1, 1], [1, 1, 1]];
        expect(g.bestMonoFlushPotential(shape)).toBe(0);
    });

    it('盘面满 → 任何 shape 都 collide → count=0', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 0;
        expect(g.bestMonoFlushPotential([[1]])).toBe(0);
    });

    it('ox=n-sw（最右）的 placement 不越 bit shift 边界', () => {
        const g = new Grid(8);
        /* 让 ox=7（sw=1 时），shape 占行 y=0 cell x=7 → shapeRowBits[0]=1
         * 平移 ox=7 → mask = 1<<7 = 128，rowOcc[0] 32-bit 内安全 */
        expect(() => g.bestMonoFlushPotential([[1]])).not.toThrow();
    });
});

describe('II1 与 HH2 baseline 高强度等价（覆盖 II1 新路径）', () => {
    /* 再跑 100 随机盘 × 各种 shape 形态（含稀疏）增强信心 */
    function randGrid(seed, n = 8, fillProb = 0.55) {
        const g = new Grid(n);
        let s = seed;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            if ((s & 0xff) / 256 < fillProb) g.cells[y][x] = (s >>> 8) & 3;
        }
        return g;
    }

    /* 模拟 HH2 baseline（无 II1 优化） */
    function baselineFlushPotential(grid, shapeData, _skin = null, opts = {}) {
        const returnTarget = opts && opts.returnTarget === true;
        if (!shapeData?.length) return returnTarget ? { count: 0, targetCi: null } : 0;
        const sh = shapeData.length; const sw = shapeData[0].length; const n = grid.size;
        const sameAs = (a, b) => a === b;
        const cells = [];
        for (let dy = 0; dy < sh; dy++) for (let dx = 0; dx < sw; dx++) if (shapeData[dy][dx]) cells.push([dx, dy]);
        if (cells.length === 0) return returnTarget ? { count: 0, targetCi: null } : 0;
        const rowMask = new Uint8Array(n); const colMask = new Uint8Array(n);
        let best = 0; let bestT = null;
        for (let oy = 0; oy <= n - sh; oy++) for (let ox = 0; ox <= n - sw; ox++) {
            if (!grid.canPlace(shapeData, ox, oy)) continue;
            rowMask.fill(0); colMask.fill(0);
            for (const [dx, dy] of cells) { rowMask[oy + dy] = 1; colMask[ox + dx] = 1; }
            let bc = 0; let pT = null;
            for (let y = 0; y < n; y++) {
                if (!rowMask[y]) continue;
                const sy = y - oy; const shRow = shapeData[sy];
                let af = true; let rc = null; let as = true;
                const cR = grid.cells[y];
                for (let x = 0; x < n; x++) {
                    const sx = x - ox; if (sx >= 0 && sx < sw && shRow[sx]) continue;
                    const c = cR[x]; if (c === null) { af = false; break; }
                    if (rc === null) rc = c; else if (!sameAs(rc, c)) { as = false; break; }
                }
                if (!af || !as || rc === null) continue;
                bc++; if (pT === null) pT = rc;
            }
            for (let x = 0; x < n; x++) {
                if (!colMask[x]) continue; const sx = x - ox;
                let af = true; let rc = null; let as = true;
                for (let y = 0; y < n; y++) {
                    const sy = y - oy; if (sy >= 0 && sy < sh && shapeData[sy][sx]) continue;
                    const c = grid.cells[y][x]; if (c === null) { af = false; break; }
                    if (rc === null) rc = c; else if (!sameAs(rc, c)) { as = false; break; }
                }
                if (!af || !as || rc === null) continue;
                bc++; if (pT === null) pT = rc;
            }
            if (bc > best) { best = bc; bestT = pT; }
        }
        return returnTarget ? { count: best, targetCi: bestT } : best;
    }

    it('100 随机盘 × 含空行/空列的奇怪 shape 等价', () => {
        const shapes = [
            [[1, 0, 1]],            /* 空 column 中间 */
            [[1, 0], [0, 1]],       /* 对角线 */
            [[1, 1, 1], [0, 0, 0], [1, 1, 1]], /* 空行 */
            [[0, 1, 0], [1, 1, 1], [0, 1, 0]], /* + 形 */
            [[1, 0, 0, 0, 1]],      /* 长稀疏 */
        ];
        for (let seed = 1; seed <= 100; seed++) {
            const g = randGrid(seed, 8, 0.50);
            for (const shape of shapes) {
                const a = g.bestMonoFlushPotential(shape);
                const b = baselineFlushPotential(g, shape);
                expect(a).toBe(b);
            }
        }
    });
});
