/**
 * Z3: spawnGeometry.computeColumnHeightSummary —— 列扫描合并优化契约。
 *
 * 关键不变量：
 *   - 与抽出前的独立 columnHeightVariance / countDangerColumns 1:1 等价
 *   - heights 数组每列 = n - 顶部最低被占用 y 索引（无占用列 = 0）
 *   - 空 grid / null grid 安全回退
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    computeColumnHeightSummary,
    columnHeightVariance,
    countDangerColumns,
} from '../web/src/bot/spawnGeometry.js';

function fillCell(g, x, y, c = 1) { g.cells[y][x] = c; }

describe('Z3 computeColumnHeightSummary —— 列扫描合并优化', () => {
    it('空 grid → 全 0', () => {
        const g = new Grid(8);
        const s = computeColumnHeightSummary(g);
        expect(s.heights).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(s.variance).toBe(0);
        expect(s.dangerCount).toBe(0);
        expect(s.sum).toBe(0);
    });

    it('null grid / 缺 cells → 空结构（不抛错）', () => {
        expect(computeColumnHeightSummary(null)).toEqual({ heights: [], variance: 0, dangerCount: 0, sum: 0 });
        expect(computeColumnHeightSummary({ cells: null })).toEqual({ heights: [], variance: 0, dangerCount: 0, sum: 0 });
    });

    it('单格占用 → 该列 height = n - y', () => {
        const g = new Grid(8);
        fillCell(g, 3, 5, 1); /* x=3, y=5, n=8 → h = 3 */
        const s = computeColumnHeightSummary(g);
        expect(s.heights[3]).toBe(3);
        expect(s.sum).toBe(3);
    });

    it('整列占用 → height = n', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) fillCell(g, 2, y, 1);
        const s = computeColumnHeightSummary(g);
        expect(s.heights[2]).toBe(8);
    });

    it('dangerCount: 默认 dangerHeight=6，高 ≥6 的列计入', () => {
        const g = new Grid(8);
        for (let y = 2; y < 8; y++) fillCell(g, 0, y, 1); /* h=6 → ≥6 */
        for (let y = 3; y < 8; y++) fillCell(g, 1, y, 1); /* h=5 → <6 */
        const s = computeColumnHeightSummary(g);
        expect(s.dangerCount).toBe(1); /* 只有 x=0 危险 */
    });

    it('自定义 dangerHeight 阈值', () => {
        const g = new Grid(8);
        fillCell(g, 0, 4, 1); /* h=4 */
        fillCell(g, 1, 3, 1); /* h=5 */
        expect(computeColumnHeightSummary(g, 4).dangerCount).toBe(2);
        expect(computeColumnHeightSummary(g, 5).dangerCount).toBe(1);
        expect(computeColumnHeightSummary(g, 6).dangerCount).toBe(0);
    });

    it('与旧 API 等价：columnHeightVariance / countDangerColumns 走合并底层', () => {
        const g = new Grid(8);
        fillCell(g, 0, 1, 1); fillCell(g, 3, 5, 1); fillCell(g, 7, 0, 1);
        const summary = computeColumnHeightSummary(g, 6);
        expect(columnHeightVariance(g)).toBe(summary.variance);
        expect(countDangerColumns(g, 6)).toBe(summary.dangerCount);
    });

    it('variance 公式正确性：手工算 mean / variance 校对', () => {
        const g = new Grid(8);
        /* 让 heights = [8, 0, 0, 0, 0, 0, 0, 0] → mean=1, variance = ((8-1)²+7*1²)/8 = (49+7)/8 = 7 */
        for (let y = 0; y < 8; y++) fillCell(g, 0, y, 1);
        const s = computeColumnHeightSummary(g);
        expect(s.heights[0]).toBe(8);
        expect(s.sum).toBe(8);
        expect(s.variance).toBeCloseTo(7, 6);
    });
});
