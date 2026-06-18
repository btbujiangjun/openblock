/**
 * KK1: bestMonoFlushBuildup 内圈 minBuildup 预剪枝等价性。
 *
 * 与 JJ1 baseline（canPlace 慢路径 + 内圈无剪枝）对比 1:1。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

function baselineBuildup(grid, shapeData, minBuildup = 6) {
    const n = grid.size;
    const sh = shapeData.length; const sw = shapeData[0]?.length || 0;
    if (sh === 0 || sw === 0) return 0;
    const cells = [];
    for (let dy = 0; dy < sh; dy++) for (let dx = 0; dx < sw; dx++) if (shapeData[dy][dx]) cells.push([dx, dy]);
    if (!cells.length) return 0;
    const sameAs = (a, b) => a === b;
    const rowMask = new Uint8Array(n); const colMask = new Uint8Array(n);
    let best = 0;
    for (let oy = 0; oy <= n - sh; oy++) for (let ox = 0; ox <= n - sw; ox++) {
        if (!grid.canPlace(shapeData, ox, oy)) continue;
        rowMask.fill(0); colMask.fill(0);
        for (const [dx, dy] of cells) { rowMask[oy + dy] = 1; colMask[ox + dx] = 1; }
        for (let y = 0; y < n; y++) {
            if (!rowMask[y]) continue;
            const sy = y - oy; const shRow = shapeData[sy]; const cR = grid.cells[y];
            let ref = null; let mono = true; let pf = 0; let sol = 0;
            for (let x = 0; x < n; x++) {
                const sx = x - ox;
                if (sx >= 0 && sx < sw && shRow[sx]) { sol++; continue; }
                const c = cR[x]; if (c === null) continue;
                pf++; if (ref === null) ref = c; else if (!sameAs(ref, c)) { mono = false; break; }
            }
            if (!mono || ref === null) continue;
            if (pf + sol < minBuildup) continue;
            if (sol > best) best = sol;
        }
        for (let x = 0; x < n; x++) {
            if (!colMask[x]) continue; const sx = x - ox;
            let ref = null; let mono = true; let pf = 0; let sol = 0;
            for (let y = 0; y < n; y++) {
                const sy = y - oy;
                if (sy >= 0 && sy < sh && shapeData[sy][sx]) { sol++; continue; }
                const c = grid.cells[y][x]; if (c === null) continue;
                pf++; if (ref === null) ref = c; else if (!sameAs(ref, c)) { mono = false; break; }
            }
            if (!mono || ref === null) continue;
            if (pf + sol < minBuildup) continue;
            if (sol > best) best = sol;
        }
    }
    return best;
}

function randGrid(seed, n = 8, fill = 0.55) {
    const g = new Grid(n); let s = seed;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        if ((s & 0xff) / 256 < fill) g.cells[y][x] = (s >>> 8) & 3;
    }
    return g;
}

describe('KK1 buildup 内圈剪枝', () => {
    it('空盘 → 0（剪枝下所有行的 upper 都=shapeRowCount<minBuildup）', () => {
        expect(new Grid(8).bestMonoFlushBuildup([[1, 1]], null, 6)).toBe(0);
    });

    it('高 minBuildup（如 7）+ 高占用盘 → 仍等价 baseline', () => {
        for (let seed = 1; seed <= 50; seed++) {
            const g = randGrid(seed, 8, 0.7);
            const a = g.bestMonoFlushBuildup([[1, 1]], null, 7);
            const b = baselineBuildup(g, [[1, 1]], 7);
            expect(a).toBe(b);
        }
    });

    it('低 minBuildup（剪枝几乎不命中）→ 仍等价 baseline', () => {
        for (let seed = 1; seed <= 50; seed++) {
            const g = randGrid(seed, 8, 0.55);
            for (const mb of [1, 2, 3]) {
                const a = g.bestMonoFlushBuildup([[1, 1, 1]], null, mb);
                const b = baselineBuildup(g, [[1, 1, 1]], mb);
                expect(a).toBe(b);
            }
        }
    });

    it('200 随机盘 × 复杂 shape × 4 minBuildup 等价 baseline', () => {
        const shapes = [
            [[1, 1, 1, 1]],
            [[1], [1], [1], [1]],
            [[1, 1, 0], [0, 1, 1]],
            [[1, 0, 1, 0, 1]],
        ];
        for (let seed = 1; seed <= 200; seed++) {
            const g = randGrid(seed, 8, 0.50 + (seed % 4) * 0.05);
            for (const shape of shapes) {
                for (const mb of [3, 5, 6, 8]) {
                    const a = g.bestMonoFlushBuildup(shape, null, mb);
                    const b = baselineBuildup(g, shape, mb);
                    expect(a).toBe(b);
                }
            }
        }
    });
});
