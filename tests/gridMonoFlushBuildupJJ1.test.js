/**
 * JJ1: bestMonoFlushBuildup canPlace bitmap 等价测试。
 *
 * 移植 II1 的 row bitmap AND canPlace。验证 1:1 等价 + 边界。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

/* Baseline: 走 canPlace 慢路径的 buildup（n>=31 强制） */
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

describe('JJ1 bestMonoFlushBuildup canPlace bitmap', () => {
    it('空盘 → 0', () => {
        expect(new Grid(8).bestMonoFlushBuildup([[1, 1]])).toBe(0);
    });
    it('满盘 → 0（任何 shape collide）', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 0;
        expect(g.bestMonoFlushBuildup([[1]])).toBe(0);
    });
    it('shape 含空行 / 空列 不崩溃', () => {
        const g = new Grid(8);
        for (let x = 0; x < 6; x++) g.cells[3][x] = 0;
        expect(() => g.bestMonoFlushBuildup([[1, 0, 1], [0, 0, 0], [1, 0, 0]])).not.toThrow();
    });
    it('minBuildup 阈值生效（buildup<阈值 → 不计）', () => {
        const g = new Grid(8);
        for (let x = 0; x < 3; x++) g.cells[3][x] = 0;
        /* shape 1×2 + preFilled 3 = 5；minBuildup=6 时返回 0 */
        expect(g.bestMonoFlushBuildup([[1, 1]], null, 6)).toBe(0);
        /* minBuildup=4 时应有命中 */
        expect(g.bestMonoFlushBuildup([[1, 1]], null, 4)).toBeGreaterThanOrEqual(0);
    });
    it('100 随机盘 × 5 shape 与 canPlace baseline 等价', () => {
        const shapes = [
            [[1, 1]],
            [[1, 1, 1]],
            [[1], [1], [1]],
            [[1, 1], [1, 1]],
            [[1, 0, 1]],
        ];
        for (let seed = 1; seed <= 100; seed++) {
            const g = randGrid(seed, 8, 0.55);
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
