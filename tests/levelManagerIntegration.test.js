/**
 * levelManagerIntegration.test.js — LevelManager + ClearRuleEngine 完整集成测试
 * 验证 game.js 集成流程（无 DOM 依赖，纯逻辑层）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LevelManager, SAMPLE_LEVEL_SCORE, SAMPLE_LEVEL_CLEAR, SAMPLE_LEVEL_SURVIVAL } from '../web/src/level/levelManager.js';
import { ClearRuleEngine, RowColRule } from '../web/src/clearRules.js';
import { MOSAIC_LEVEL_4ZONE, ZONES_QUADRANT } from '../web/src/level/mosaicLevel.js';

// -----------------------------------------------------------------------
// 模拟 game 对象
// -----------------------------------------------------------------------
function makeGame(score = 0, clears = 0) {
    return {
        score,
        gameStats: { clears },
        grid: {
            size: 8,
            cells: Array.from({ length: 8 }, () => Array(8).fill(null)),
        },
    };
}

// -----------------------------------------------------------------------
// getAllowedClearRules()
// -----------------------------------------------------------------------
describe('LevelManager.getAllowedClearRules()', () => {
    it('无 clearRules 字段 → 返回 null', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        expect(lm.getAllowedClearRules()).toBeNull();
    });

    it('马赛克关卡有 clearRules → 返回数组', () => {
        const lm = new LevelManager(MOSAIC_LEVEL_4ZONE);
        const rules = lm.getAllowedClearRules();
        expect(Array.isArray(rules)).toBe(true);
        expect(rules.length).toBeGreaterThan(0);
    });
});

// -----------------------------------------------------------------------
// applyInitialBoard()
// -----------------------------------------------------------------------
describe('LevelManager.applyInitialBoard()', () => {
    it('initialBoard=null → grid 保持空白', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const grid = { size: 8, cells: Array.from({ length: 8 }, () => Array(8).fill(null)) };
        lm.applyInitialBoard(grid);
        expect(grid.cells[0][0]).toBeNull();
    });

    it('initialBoard 有值 → 写入 grid', () => {
        const board = Array.from({ length: 8 }, () => Array(8).fill(null));
        board[2][3] = 2;
        const lm = new LevelManager({ ...SAMPLE_LEVEL_SCORE, initialBoard: board });
        const grid = { size: 8, cells: Array.from({ length: 8 }, () => Array(8).fill(null)) };
        lm.applyInitialBoard(grid);
        expect(grid.cells[2][3]).toBe(2);
        expect(grid.cells[0][0]).toBeNull();
    });
});

// -----------------------------------------------------------------------
// checkObjective() — score 类型
// -----------------------------------------------------------------------
describe('checkObjective(): score', () => {
    let lm;
    beforeEach(() => {
        lm = new LevelManager({ ...SAMPLE_LEVEL_SCORE, objective: { type: 'score', value: 100 }, constraints: { maxPlacements: 10 } });
    });

    it('未达到目标 → done=false', () => {
        const result = lm.checkObjective(makeGame(50, 0));
        expect(result.done).toBe(false);
    });

    it('达到目标 → done=true, achieved=true', () => {
        const result = lm.checkObjective(makeGame(100, 0));
        expect(result.done).toBe(true);
        expect(result.achieved).toBe(true);
    });

    it('超过步数限制 → done=true, failed=true', () => {
        for (let i = 0; i < 10; i++) lm.recordPlacement();
        const result = lm.checkObjective(makeGame(0, 0));
        expect(result.done).toBe(true);
        expect(result.failed).toBe(true);
    });
});

// -----------------------------------------------------------------------
// checkObjective() — clear 类型
// -----------------------------------------------------------------------
describe('checkObjective(): clear', () => {
    let lm;
    beforeEach(() => {
        lm = new LevelManager(SAMPLE_LEVEL_CLEAR);
    });

    it('recordClear 累计达到目标 → achieved', () => {
        for (let i = 0; i < 5; i++) lm.recordClear(1);
        // gameStats.clears = 0，但 _totalClears = 5
        // checkObjective 使用 game.gameStats.clears || _totalClears
        const game = makeGame(0, 5);
        const result = lm.checkObjective(game);
        expect(result.done).toBe(true);
        expect(result.achieved).toBe(true);
    });
});

// -----------------------------------------------------------------------
// checkObjective() — survival 类型
// -----------------------------------------------------------------------
describe('checkObjective(): survival', () => {
    it('recordRound 累计达到轮数 → achieved', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SURVIVAL);  // value=15
        for (let i = 0; i < 15; i++) lm.recordRound();
        const result = lm.checkObjective(makeGame(0, 0));
        expect(result.done).toBe(true);
        expect(result.achieved).toBe(true);
    });

    it('轮数不足 → done=false', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SURVIVAL);
        for (let i = 0; i < 5; i++) lm.recordRound();
        const result = lm.checkObjective(makeGame(0, 0));
        expect(result.done).toBe(false);
    });
});

// -----------------------------------------------------------------------
// getResult()
// -----------------------------------------------------------------------
describe('getResult()', () => {
    it('结果包含 stars / objective / config', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const game = makeGame(200, 0);
        const result = lm.getResult(game);
        expect(result).toHaveProperty('stars');
        expect(result).toHaveProperty('objective');
        expect(result).toHaveProperty('config');
        expect(result.config.id).toBe('demo_score');
    });

    it('通关 200 分 → 1 星（门槛 200/400/600）', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const game = makeGame(200, 0);
        const result = lm.getResult(game);
        expect(result.stars).toBe(1);
    });

    it('600 分 → 3 星', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const game = makeGame(600, 0);
        const result = lm.getResult(game);
        expect(result.stars).toBe(3);
    });
});

// -----------------------------------------------------------------------
// ClearRuleEngine 与 LevelManager 配合（模拟 game.js 流程）
// -----------------------------------------------------------------------
describe('game.js 模拟流程', () => {
    it('默认规则 (RowColRule)：checkLines 等价', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const rules = lm.getAllowedClearRules() ?? [RowColRule];
        const engine = new ClearRuleEngine(rules);
        expect(engine.rules).toHaveLength(1);
        expect(engine.rules[0].id).toBe('row_col');
    });

    it('马赛克规则：engine 包含 zone + row_col', () => {
        const lm = new LevelManager(MOSAIC_LEVEL_4ZONE);
        const rules = lm.getAllowedClearRules() ?? [RowColRule];
        const engine = new ClearRuleEngine(rules);
        const ids = engine.rules.map(r => r.id);
        expect(ids).toContain('zone');
        expect(ids).toContain('row_col');
    });

    it('填满象限 → engine.apply() 返回 count=1，cells=16', () => {
        const lm = new LevelManager(MOSAIC_LEVEL_4ZONE);
        const rules = lm.getAllowedClearRules();
        const engine = new ClearRuleEngine(rules);
        const grid = {
            size: 8,
            cells: Array.from({ length: 8 }, () => Array(8).fill(null)),
        };
        // 填满左上象限
        const zone = ZONES_QUADRANT[0];
        for (let dy = 0; dy < zone.h; dy++) {
            for (let dx = 0; dx < zone.w; dx++) {
                grid.cells[zone.y + dy][zone.x + dx] = 1;
            }
        }
        const result = engine.apply(grid);
        expect(result.count).toBe(1);
        expect(result.cells).toHaveLength(16);
        // 格子已被清除
        expect(grid.cells[0][0]).toBeNull();
    });
});
