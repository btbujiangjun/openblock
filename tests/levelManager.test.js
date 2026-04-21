/**
 * @vitest-environment jsdom
 *
 * LevelManager 单元测试
 * 覆盖：applyInitialBoard、checkObjective（四类型）、星级、getAllowedShapes
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    LevelManager,
    SAMPLE_LEVEL_SCORE,
    SAMPLE_LEVEL_CLEAR,
    SAMPLE_LEVEL_SURVIVAL,
} from '../web/src/level/levelManager.js';

// ------------------------------------------------------------------ helpers
function makeGame(score = 0, clears = 0) {
    const grid = new Grid(8);
    return {
        score,
        grid,
        gameStats: { clears },
    };
}

// ------------------------------------------------------------------ applyInitialBoard

describe('LevelManager.applyInitialBoard', () => {
    it('null initialBoard: 棋盘保持空白', () => {
        const lm = new LevelManager({ ...SAMPLE_LEVEL_SCORE, initialBoard: null });
        const grid = new Grid(8);
        lm.applyInitialBoard(grid);
        expect(grid.cells[0][0]).toBeNull();
    });

    it('预设盘面：格子被写入', () => {
        const board = Array.from({ length: 8 }, (_, y) =>
            Array.from({ length: 8 }, (_, x) => (y === 0 ? 1 : null))
        );
        const lm = new LevelManager({
            ...SAMPLE_LEVEL_SCORE,
            initialBoard: board,
        });
        const grid = new Grid(8);
        lm.applyInitialBoard(grid);
        expect(grid.cells[0][0]).toBe(1);
        expect(grid.cells[1][0]).toBeNull();
    });
});

// ------------------------------------------------------------------ checkObjective (score)

describe('LevelManager.checkObjective — score', () => {
    it('未达到分数：done=false', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const result = lm.checkObjective(makeGame(100, 0));
        expect(result.done).toBe(false);
    });

    it('达到分数：done=true, achieved=true', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const result = lm.checkObjective(makeGame(200, 0));
        expect(result.done).toBe(true);
        expect(result.achieved).toBe(true);
    });

    it('超过分数：仍然成功', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const result = lm.checkObjective(makeGame(9999, 0));
        expect(result.done).toBe(true);
    });

    it('失败（超过 maxPlacements）：done=true, failed=true', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        lm._totalPlacements = 30;  // 达到 maxPlacements
        const result = lm.checkObjective(makeGame(0, 0));
        expect(result.done).toBe(true);
        expect(result.failed).toBe(true);
    });
});

// ------------------------------------------------------------------ checkObjective (clear)

describe('LevelManager.checkObjective — clear', () => {
    it('消行未达到：done=false', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_CLEAR);
        expect(lm.checkObjective(makeGame(0, 3)).done).toBe(false);
    });

    it('消行达到：done=true', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_CLEAR);
        expect(lm.checkObjective(makeGame(0, 5)).done).toBe(true);
    });
});

// ------------------------------------------------------------------ checkObjective (survival)

describe('LevelManager.checkObjective — survival', () => {
    it('存活轮数不足：done=false', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SURVIVAL);
        lm._totalRounds = 10;
        expect(lm.checkObjective(makeGame(0, 0)).done).toBe(false);
    });

    it('存活轮数达到：done=true', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SURVIVAL);
        lm._totalRounds = 15;
        expect(lm.checkObjective(makeGame(0, 0)).done).toBe(true);
    });
});

// ------------------------------------------------------------------ 星级

describe('LevelManager 星级计算', () => {
    it('刚好通关（1 星）', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const result = lm.checkObjective(makeGame(200, 0));
        expect(result.stars).toBe(1);
    });

    it('达到 2 星门槛', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const result = lm.checkObjective(makeGame(400, 0));
        expect(result.stars).toBe(2);
    });

    it('达到 3 星门槛', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        const result = lm.checkObjective(makeGame(600, 0));
        expect(result.stars).toBe(3);
    });

    it('失败时星级为 0', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        lm._totalPlacements = 30;
        const result = lm.checkObjective(makeGame(0, 0));
        expect(result.stars).toBe(0);
    });
});

// ------------------------------------------------------------------ getAllowedShapes / spawnHints

describe('LevelManager.getAllowedShapes', () => {
    it('无限制时返回 null', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        expect(lm.getAllowedShapes()).toBeNull();
    });

    it('有限制时返回 Set', () => {
        const lm = new LevelManager({
            ...SAMPLE_LEVEL_SCORE,
            constraints: { allowedShapes: ['line_4', 'sq_2x2'] },
        });
        const allowed = lm.getAllowedShapes();
        expect(allowed).toBeInstanceOf(Set);
        expect(allowed.has('line_4')).toBe(true);
        expect(allowed.has('other')).toBe(false);
    });
});

describe('LevelManager.getSpawnHints', () => {
    it('无 spawnHints 时返回空对象', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        expect(lm.getSpawnHints()).toEqual({});
    });

    it('有 spawnHints 时透传', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_CLEAR);
        expect(lm.getSpawnHints().clearGuarantee).toBe(1);
    });
});

// ------------------------------------------------------------------ recordXxx

describe('LevelManager 计数方法', () => {
    it('recordClear 累加', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SURVIVAL);
        lm.recordClear(2);
        lm.recordClear(3);
        expect(lm._totalClears).toBe(5);
    });

    it('recordRound 累加', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SURVIVAL);
        lm.recordRound();
        lm.recordRound();
        expect(lm._totalRounds).toBe(2);
    });

    it('recordPlacement 累加', () => {
        const lm = new LevelManager(SAMPLE_LEVEL_SCORE);
        for (let i = 0; i < 5; i++) lm.recordPlacement();
        expect(lm._totalPlacements).toBe(5);
    });
});
