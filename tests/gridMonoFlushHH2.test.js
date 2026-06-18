/**
 * HH2: bestMonoFlushPotential bitmap 阶段 1 等价性验证。
 * 随机盘对照旧 baseline（由测试自身实现）确保剪枝不丢解。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

/* baseline 实现（旧 N² × sameAs 无剪枝版本，作为 oracle）。 */
function baselineFlushPotential(grid, shapeData, skin = null, opts = {}) {
    const returnTarget = opts && opts.returnTarget === true;
    if (!shapeData || !Array.isArray(shapeData) || shapeData.length === 0) {
        return returnTarget ? { count: 0, targetCi: null } : 0;
    }
    const sh = shapeData.length;
    const sw = shapeData[0].length;
    const n = grid.size;
    const blockIcons = skin?.blockIcons;
    const getIcon = (ci) => (blockIcons?.length ? blockIcons[ci % blockIcons.length] : null);
    const sameAs = (refCi, ci) => {
        if (refCi == null || ci == null) return false;
        const refIcon = getIcon(refCi);
        if (refIcon !== null) return getIcon(ci) === refIcon;
        return ci === refCi;
    };
    const shapeCells = [];
    for (let dy = 0; dy < sh; dy++) for (let dx = 0; dx < sw; dx++) if (shapeData[dy][dx]) shapeCells.push([dx, dy]);
    if (shapeCells.length === 0) return returnTarget ? { count: 0, targetCi: null } : 0;
    let best = 0; let bestTargetCi = null;
    const rowMask = new Uint8Array(n); const colMask = new Uint8Array(n);
    for (let oy = 0; oy <= n - sh; oy++) {
        for (let ox = 0; ox <= n - sw; ox++) {
            if (!grid.canPlace(shapeData, ox, oy)) continue;
            rowMask.fill(0); colMask.fill(0);
            for (let k = 0; k < shapeCells.length; k++) {
                rowMask[oy + shapeCells[k][1]] = 1;
                colMask[ox + shapeCells[k][0]] = 1;
            }
            let bonusCount = 0; let placementTargetCi = null;
            for (let y = 0; y < n; y++) {
                if (!rowMask[y]) continue;
                const sy = y - oy; const shapeRow = shapeData[sy];
                let allFilled = true; let refCi = null; let allSame = true;
                const cellRow = grid.cells[y];
                for (let x = 0; x < n; x++) {
                    const sx = x - ox;
                    if (sx >= 0 && sx < sw && shapeRow[sx]) continue;
                    const c = cellRow[x];
                    if (c === null) { allFilled = false; break; }
                    if (refCi === null) refCi = c;
                    else if (!sameAs(refCi, c)) { allSame = false; break; }
                }
                if (!allFilled) continue;
                if (!allSame || refCi === null) continue;
                bonusCount++;
                if (placementTargetCi === null) placementTargetCi = refCi;
            }
            for (let x = 0; x < n; x++) {
                if (!colMask[x]) continue;
                const sx = x - ox;
                let allFilled = true; let refCi = null; let allSame = true;
                for (let y = 0; y < n; y++) {
                    const sy = y - oy;
                    if (sy >= 0 && sy < sh && shapeData[sy][sx]) continue;
                    const c = grid.cells[y][x];
                    if (c === null) { allFilled = false; break; }
                    if (refCi === null) refCi = c;
                    else if (!sameAs(refCi, c)) { allSame = false; break; }
                }
                if (!allFilled) continue;
                if (!allSame || refCi === null) continue;
                bonusCount++;
                if (placementTargetCi === null) placementTargetCi = refCi;
            }
            if (bonusCount > best) { best = bonusCount; bestTargetCi = placementTargetCi; }
        }
    }
    if (returnTarget) return { count: best, targetCi: bestTargetCi };
    return best;
}

function randGrid(seed, n = 8, fillProb = 0.55) {
    const g = new Grid(n);
    let s = seed;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        if ((s & 0xff) / 256 < fillProb) g.cells[y][x] = (s >>> 8) & 3;
    }
    return g;
}

describe('HH2 bestMonoFlushPotential 与 baseline 等价', () => {
    const shapes = [
        [[1]],
        [[1, 1], [1, 1]],
        [[1, 1, 1]],
        [[1], [1], [1]],
        [[1, 1], [1, 0], [1, 0]], /* L4 */
    ];

    it('200 随机盘 × 5 shapes 等价（fillProb 0.55）', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const g = randGrid(seed, 8, 0.55);
            for (const shape of shapes) {
                const a = g.bestMonoFlushPotential(shape, null, { returnTarget: true });
                const b = baselineFlushPotential(g, shape, null, { returnTarget: true });
                if (a.count !== b.count || a.targetCi !== b.targetCi) {
                    throw new Error(`mismatch seed=${seed} shape=${JSON.stringify(shape)} fast=${JSON.stringify(a)} base=${JSON.stringify(b)}`);
                }
            }
        }
    });

    it('100 随机盘 × shapes × 高占用 0.80 等价', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const g = randGrid(seed, 8, 0.80);
            for (const shape of shapes) {
                const a = g.bestMonoFlushPotential(shape);
                const b = baselineFlushPotential(g, shape);
                expect(a).toBe(b);
            }
        }
    });

    it('带 skin（icon 模糊匹配）随机盘等价', () => {
        const skin = { blockIcons: ['A', 'B', 'A', 'B'] }; /* ci 0/2 同 icon A，1/3 同 icon B */
        for (let seed = 1; seed <= 50; seed++) {
            const g = randGrid(seed, 8, 0.55);
            for (const shape of shapes) {
                const a = g.bestMonoFlushPotential(shape, skin, { returnTarget: true });
                const b = baselineFlushPotential(g, shape, skin, { returnTarget: true });
                expect(a).toEqual(b);
            }
        }
    });

    it('空盘 → 0', () => {
        expect(new Grid(8).bestMonoFlushPotential([[1]])).toBe(0);
    });

    it('空 shape 兜底', () => {
        const g = new Grid(8);
        const r = g.bestMonoFlushPotential([[0]], null, { returnTarget: true });
        expect(r).toEqual({ count: 0, targetCi: null });
    });
});
