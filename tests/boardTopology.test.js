/**
 * @vitest-environment jsdom
 *
 * v1.16：boardTopology.detectNearClears 是「近完整行/列」检测的单一来源。
 * 既被 analyzeBoardTopology（topology pill / stress 信号）复用，也被
 * bot/blockSpawn.analyzePerfectClearSetup（清屏机会评估）复用，必须保证两侧
 * 在相同盘面上得到一致的近满判定。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    detectNearClears,
    analyzeBoardTopology,
} from '../web/src/boardTopology.js';

function makeGrid(size = 8) {
    return new Grid(size);
}

describe('detectNearClears', () => {
    it('空盘没有任何近满行列', () => {
        const grid = makeGrid();
        const r = detectNearClears(grid);
        expect(r.rows).toEqual([]);
        expect(r.cols).toEqual([]);
        expect(r.nearFullLines).toBe(0);
        expect(r.close1).toBe(0);
        expect(r.close2).toBe(0);
    });

    it('差 1 格的行被识别为 close1', () => {
        const grid = makeGrid();
        for (let x = 0; x < 7; x++) grid.cells[0][x] = 1;
        const r = detectNearClears(grid);
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].emptyCount).toBe(1);
        expect(r.close1).toBe(1);
        expect(r.close2).toBe(0);
        expect(r.nearFullLines).toBe(1);
    });

    it('差 2 格的列被识别为 close2', () => {
        const grid = makeGrid();
        for (let y = 0; y < 6; y++) grid.cells[y][3] = 1;
        const r = detectNearClears(grid);
        expect(r.cols).toHaveLength(1);
        expect(r.cols[0].emptyCount).toBe(2);
        expect(r.close2).toBe(1);
        expect(r.close1).toBe(0);
        expect(r.nearFullLines).toBe(1);
    });

    it('requireFillable=true 时跳过永远填不上的近满线（与 analyzeBoardTopology 一致）', () => {
        const grid = makeGrid();
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) grid.cells[y][x] = 1;
        }
        grid.cells[3][3] = null;
        const fillable = detectNearClears(grid, { requireFillable: true });
        expect(fillable.nearFullLines).toBe(0);
        const raw = detectNearClears(grid, { requireFillable: false });
        expect(raw.nearFullLines).toBeGreaterThanOrEqual(2);
    });

    it('analyzeBoardTopology 与 detectNearClears 在同一盘面给出相同 close1/close2', () => {
        const grid = makeGrid();
        for (let x = 0; x < 7; x++) grid.cells[0][x] = 1;
        for (let y = 0; y < 6; y++) grid.cells[y][7] = 1;
        const topo = analyzeBoardTopology(grid);
        const direct = detectNearClears(grid, { maxEmpty: 2 });
        expect(topo.close1).toBe(direct.close1);
        expect(topo.close2).toBe(direct.close2);
        expect(topo.nearFullLines).toBe(direct.nearFullLines);
    });

    it('maxEmpty 参数控制收口宽度', () => {
        const grid = makeGrid();
        for (let x = 0; x < 5; x++) grid.cells[0][x] = 1;
        const wide = detectNearClears(grid, { maxEmpty: 3, requireFillable: false });
        expect(wide.rows).toHaveLength(1);
        expect(wide.rows[0].emptyCount).toBe(3);
        const tight = detectNearClears(grid, { maxEmpty: 2, requireFillable: false });
        expect(tight.rows).toHaveLength(0);
    });
});
