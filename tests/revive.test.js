/**
 * @vitest-environment jsdom
 *
 * ReviveManager 单元测试
 * 覆盖：初始化、canRevive 边界、doRevive 格子清除、次数限制、resetForNewGame
 */
import { describe, it, expect, vi } from 'vitest';
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

/**
 * v1.60.45 — REVIVE_LIMIT_DEFAULT 按平台分发（Android/微信 2，iOS/web 1）。
 *
 * 数据依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §2.1 / §4.3 —
 *   Android 触发复活 r=+0.173 单调正相关；iOS r≈0 非线性需保守。
 */
describe('v1.60.45 — REVIVE_LIMIT_DEFAULT 平台化', () => {
    async function defaultLimitForPlatform(platform) {
        const { vi } = await import('vitest');
        vi.resetModules();
        const { _setPlatformForTest } = await import('../web/src/config/platformProfile.js');
        _setPlatformForTest(platform);
        const { ReviveManager: RM } = await import('../web/src/revive.js');
        /* limit 不传 → 用 module 顶层的 REVIVE_LIMIT_DEFAULT */
        const rm = new RM({ enabled: true });
        return rm.limit;
    }

    it('Android 默认 limit = 2', async () => {
        expect(await defaultLimitForPlatform('android')).toBe(2);
    });

    it('微信小程序默认 limit = 2', async () => {
        expect(await defaultLimitForPlatform('wechat')).toBe(2);
    });

    it('iOS 默认 limit = 1（保守，避免 U 型反向区）', async () => {
        expect(await defaultLimitForPlatform('ios')).toBe(1);
    });

    it('web 默认 limit = 1（与 iOS 同档）', async () => {
        expect(await defaultLimitForPlatform('web')).toBe(1);
    });

    it('显式 opts.limit 覆盖平台默认（用户配置优先）', async () => {
        const { vi } = await import('vitest');
        vi.resetModules();
        const { _setPlatformForTest } = await import('../web/src/config/platformProfile.js');
        _setPlatformForTest('ios');
        const { ReviveManager: RM } = await import('../web/src/revive.js');
        const rm = new RM({ enabled: true, limit: 5 });
        expect(rm.limit).toBe(5);
    });
});

/**
 * v1.60.45 — 复活成功后写入 game._postReviveBoost，提供 forceReliefIntent + clearGuarantee=3。
 *
 * 数据依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §2.1 复活成功 r ≈ 0
 *   → 复活后局面仍差，需要 spawn 引擎给"喘息"。
 */
describe('v1.60.45 — _postReviveBoost 复活后强 relief 信号', () => {
    it('_doRevive 后 game._postReviveBoost 包含 forceReliefIntent + ttlRounds=2', () => {
        const rm = new ReviveManager({ enabled: true, limit: 1 });
        const game = makeGame();
        rm._game = game;
        rm._originalShowNoMovesWarning = vi.fn();
        rm._doRevive();
        expect(game._postReviveBoost).toBeTruthy();
        expect(game._postReviveBoost.forceReliefIntent).toBe(true);
        expect(game._postReviveBoost.clearGuarantee).toBe(3);
        expect(game._postReviveBoost.ttlRounds).toBe(2);
        expect(typeof game._postReviveBoost.triggeredAt).toBe('number');
    });

    it('未复活时 game._postReviveBoost 应为 undefined（无副作用）', () => {
        const game = makeGame();
        expect(game._postReviveBoost).toBeUndefined();
    });
});
