/**
 * @vitest-environment jsdom
 *
 * ReviveManager 单元测试
 * 覆盖：初始化、canRevive 边界、doRevive 格子清除、次数限制、resetForNewGame
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReviveManager } from '../web/src/revive.js';

// ------------------------------------------------------------------ helpers
function makeGrid(size = 8, fillRatio = 0.5) {
    const cells = [];
    for (let y = 0; y < size; y++) {
        cells.push([]);
        for (let x = 0; x < size; x++) {
            cells[y].push(Math.random() < fillRatio ? 1 : -1);
        }
    }
    return {
        size,
        cells,
        canPlace: vi.fn(() => true),
    };
}

function makeGame(overrides = {}) {
    const game = {
        grid: makeGrid(8, 0.6),
        dockBlocks: [{ placed: false }, { placed: false }, { placed: false }],
        score: 100,
        isGameOver: false,
        _endGameInFlight: null,
        renderer: { render: vi.fn() },
        logBehavior: vi.fn(),
        checkGameOver: vi.fn(),
        showNoMovesWarning() { this._noMovesCalled = true; },
        _noMovesCalled: false,
        ...overrides,
    };
    return game;
}

// ------------------------------------------------------------------ tests

describe('ReviveManager — init & decoration', () => {
    it('装饰后 game.showNoMovesWarning 被替换为拦截函数', () => {
        const game = makeGame();
        const original = game.showNoMovesWarning;
        const rm = new ReviveManager({ enabled: true });
        rm.init(game);
        expect(game.showNoMovesWarning).not.toBe(original);
    });

    it('disabled 时不装饰', () => {
        const game = makeGame();
        const original = game.showNoMovesWarning;
        const rm = new ReviveManager({ enabled: false });
        rm.init(game);
        expect(game.showNoMovesWarning).toBe(original);
    });
});

describe('ReviveManager — canRevive', () => {
    it('初始状态可复活（limit=1, used=0）', () => {
        const rm = new ReviveManager({ enabled: true, limit: 1 });
        expect(rm.canRevive()).toBe(true);
    });

    it('已用完后不可复活', () => {
        const rm = new ReviveManager({ enabled: true, limit: 1 });
        rm._usedCount = 1;
        expect(rm.canRevive()).toBe(false);
    });

    it('limit=0 时始终不可复活', () => {
        const rm = new ReviveManager({ enabled: true, limit: 0 });
        expect(rm.canRevive()).toBe(false);
    });

    it('enabled=false 时不可复活', () => {
        const rm = new ReviveManager({ enabled: false, limit: 3 });
        expect(rm.canRevive()).toBe(false);
    });
});

describe('ReviveManager — resetForNewGame', () => {
    it('重置后复活次数归零', () => {
        const rm = new ReviveManager({ enabled: true, limit: 2 });
        rm._usedCount = 2;
        rm.resetForNewGame();
        expect(rm._usedCount).toBe(0);
        expect(rm.canRevive()).toBe(true);
    });
});

describe('ReviveManager — _doRevive 格子清除', () => {
    it('清除后格子数减少', () => {
        const rm = new ReviveManager({ enabled: true, limit: 1, clearCells: 8 });
        const game = makeGame();
        rm._game = game;
        rm._originalShowNoMovesWarning = vi.fn();

        const countOccupied = (grid) =>
            grid.cells.flat().filter(v => v >= 0).length;

        const before = countOccupied(game.grid);
        rm._doRevive();
        const after = countOccupied(game.grid);

        expect(after).toBeLessThanOrEqual(before);
        expect(before - after).toBeLessThanOrEqual(8);  // 最多清除 clearCells 个
    });

    it('复活后 isGameOver 重置为 false', () => {
        const rm = new ReviveManager({ enabled: true, limit: 1 });
        const game = makeGame({ isGameOver: true });
        rm._game = game;
        rm._originalShowNoMovesWarning = vi.fn();
        rm._doRevive();
        expect(game.isGameOver).toBe(false);
    });

    it('复活后 _usedCount 递增', () => {
        const rm = new ReviveManager({ enabled: true, limit: 2 });
        const game = makeGame();
        rm._game = game;
        rm._originalShowNoMovesWarning = vi.fn();
        rm._doRevive();
        expect(rm._usedCount).toBe(1);
    });

    it('棋盘全空时复活不崩溃（0 个占用格）', () => {
        const rm = new ReviveManager({ enabled: true, limit: 1, clearCells: 5 });
        const game = makeGame();
        // 将棋盘清空
        game.grid.cells.forEach(row => row.fill(-1));
        rm._game = game;
        rm._originalShowNoMovesWarning = vi.fn();
        expect(() => rm._doRevive()).not.toThrow();
    });

    it('复活后调用 renderer.render', () => {
        const rm = new ReviveManager({ enabled: true, limit: 1 });
        const game = makeGame();
        rm._game = game;
        rm._originalShowNoMovesWarning = vi.fn();
        rm._doRevive();
        expect(game.renderer.render).toHaveBeenCalled();
    });
});

describe('ReviveManager — 次数耗尽时回落原始 warning', () => {
    it('已达上限时调用原始 showNoMovesWarning', () => {
        const rm = new ReviveManager({ enabled: true, limit: 1 });
        const game = makeGame();
        rm.init(game);
        rm._usedCount = 1;  // 已耗尽

        // 触发拦截（此时应回落原始）
        game.showNoMovesWarning();
        expect(game._noMovesCalled).toBe(true);
    });
});
