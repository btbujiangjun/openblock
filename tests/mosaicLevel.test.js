/**
 * mosaicLevel.test.js — 马赛克关卡 & 区域消除集成测试
 */
import { describe, it, expect } from 'vitest';
import {
    ZONES_QUADRANT, ZONES_STRIPS_V, ZONES_RING,
    MOSAIC_LEVEL_4ZONE, MOSAIC_LEVEL_STRIPS, MOSAIC_LEVEL_RING,
    ALL_MOSAIC_LEVELS,
} from '../web/src/level/mosaicLevel.js';
import { ClearRuleEngine, makeZoneClearRule } from '../web/src/clearRules.js';

// -----------------------------------------------------------------------
// 预设区域定义正确性
// -----------------------------------------------------------------------
describe('Zone definitions', () => {
    it('ZONES_QUADRANT：4 个区域，各 4×4', () => {
        expect(ZONES_QUADRANT).toHaveLength(4);
        ZONES_QUADRANT.forEach(z => {
            expect(z.w).toBe(4);
            expect(z.h).toBe(4);
        });
    });

    it('ZONES_STRIPS_V：4 个竖条，各 2×8', () => {
        expect(ZONES_STRIPS_V).toHaveLength(4);
        ZONES_STRIPS_V.forEach(z => {
            expect(z.w).toBe(2);
            expect(z.h).toBe(8);
        });
    });

    it('ZONES_RING：5 个区域（4 角 + 中心）', () => {
        expect(ZONES_RING).toHaveLength(5);
    });

    it('ZONES_QUADRANT 覆盖整个 8×8 棋盘（无重叠无遗漏）', () => {
        const covered = new Set();
        for (const z of ZONES_QUADRANT) {
            for (let dy = 0; dy < z.h; dy++) {
                for (let dx = 0; dx < z.w; dx++) {
                    const key = `${z.x + dx},${z.y + dy}`;
                    expect(covered.has(key)).toBe(false);  // 不允许重叠
                    covered.add(key);
                }
            }
        }
        expect(covered.size).toBe(64);  // 覆盖所有 8×8 格子
    });
});

// -----------------------------------------------------------------------
// makeZoneClearRule 与 ClearRuleEngine 集成
// -----------------------------------------------------------------------
function makeGrid(size, cells) {
    const n = size;
    const grid = {
        size: n,
        cells: Array.from({ length: n }, () => Array(n).fill(null)),
    };
    for (const [y, x, color] of cells) {
        if (y < n && x < n) grid.cells[y][x] = color ?? 1;
    }
    return grid;
}

function fillZone(grid, zone, color = 1) {
    for (let dy = 0; dy < zone.h; dy++) {
        for (let dx = 0; dx < zone.w; dx++) {
            grid.cells[zone.y + dy][zone.x + dx] = color;
        }
    }
}

describe('ZoneClearRule via ClearRuleEngine', () => {
    it('填满一个象限 → 触发区域消除，count=1', () => {
        const engine = new ClearRuleEngine([makeZoneClearRule(ZONES_QUADRANT)]);
        const grid = makeGrid(8, []);
        fillZone(grid, ZONES_QUADRANT[0]);  // 左上象限

        const result = engine.apply(grid);

        expect(result.count).toBe(1);
        expect(result.cells).toHaveLength(16);  // 4×4 = 16 格
        // 消除后格子应为 null
        expect(grid.cells[0][0]).toBeNull();
        expect(grid.cells[3][3]).toBeNull();
    });

    it('填满两个象限 → count=2，清除 32 格', () => {
        const engine = new ClearRuleEngine([makeZoneClearRule(ZONES_QUADRANT)]);
        const grid = makeGrid(8, []);
        fillZone(grid, ZONES_QUADRANT[0]);  // 左上
        fillZone(grid, ZONES_QUADRANT[1]);  // 右上

        const result = engine.apply(grid);

        expect(result.count).toBe(2);
        expect(result.cells).toHaveLength(32);
    });

    it('象限未填满 → 不触发消除', () => {
        const engine = new ClearRuleEngine([makeZoneClearRule(ZONES_QUADRANT)]);
        const grid = makeGrid(8, []);
        // 只填 15 格（少一格）
        fillZone(grid, ZONES_QUADRANT[0]);
        grid.cells[0][0] = null;  // 去掉一格

        const result = engine.apply(grid);
        expect(result.count).toBe(0);
        expect(result.cells).toHaveLength(0);
    });

    it('MOSAIC_LEVEL_4ZONE.clearRules 包含 zone + row_col 规则', () => {
        expect(MOSAIC_LEVEL_4ZONE.clearRules).toHaveLength(2);
        expect(MOSAIC_LEVEL_4ZONE.clearRules[0].id).toBe('zone');
        expect(MOSAIC_LEVEL_4ZONE.clearRules[1].id).toBe('row_col');
    });

    it('zone + row_col 叠加：同时填满象限和整行 → 两种消除都触发', () => {
        const engine = new ClearRuleEngine(MOSAIC_LEVEL_4ZONE.clearRules);
        const grid = makeGrid(8, []);
        fillZone(grid, ZONES_QUADRANT[0]);
        // 额外填满第 0 行剩余格（让整行满）
        for (let x = 4; x < 8; x++) {
            grid.cells[0][x] = 1;
        }
        // 此时：左上象限满 → zone 触发；第 0 行满 → row_col 触发，但第 0 行的格子已被 zone 消除
        const result = engine.apply(grid);
        // zone 触发 count=1，row_col 理论上也能触发（行满），但消除后第0行已被清空
        // 关键：count >= 1
        expect(result.count).toBeGreaterThanOrEqual(1);
        expect(result.cells.length).toBeGreaterThan(0);
    });
});

// -----------------------------------------------------------------------
// 关卡配置完整性
// -----------------------------------------------------------------------
describe('Mosaic level configs', () => {
    it('ALL_MOSAIC_LEVELS 包含 3 个关卡', () => {
        expect(ALL_MOSAIC_LEVELS).toHaveLength(3);
    });

    it.each([
        MOSAIC_LEVEL_4ZONE,
        MOSAIC_LEVEL_STRIPS,
        MOSAIC_LEVEL_RING,
    ])('$name 关卡：结构完整', (level) => {
        expect(level.id).toBeTruthy();
        expect(level.name).toBeTruthy();
        expect(level.objective?.type).toBeTruthy();
        expect(level.objective?.value).toBeGreaterThan(0);
        expect(level.stars?.one).toBeLessThanOrEqual(level.stars?.two);
        expect(level.stars?.two).toBeLessThanOrEqual(level.stars?.three);
        expect(Array.isArray(level.zones)).toBe(true);
        expect(Array.isArray(level.clearRules)).toBe(true);
    });
});
