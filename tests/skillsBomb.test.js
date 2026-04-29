/**
 * @vitest-environment jsdom
 *
 * bomb 单元测试 — 覆盖 3×3 范围爆炸、边界裁剪、空区返还代币、扣费、
 * 闪光选择（combo 而非 bonus）、防御 isAnimating / isGameOver / replayPlaybackLocked。
 */
import { describe, it, expect, vi } from 'vitest';

function makeLocalStorageMock() {
    const store = Object.create(null);
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        get length() { return Object.keys(store).length; },
        key: (i) => Object.keys(store)[i] ?? null,
    };
}
const _mockLS = makeLocalStorageMock();
vi.stubGlobal('localStorage', _mockLS);

import { Grid } from '../web/src/grid.js';
import { getWallet } from '../web/src/skills/wallet.js';
import * as bomb from '../web/src/skills/bomb.js';

async function freshBomb() {
    _mockLS.clear();
    const wallet = getWallet();
    wallet._reset();
    bomb.__resetForTest();
    document.body.innerHTML = '';
    return { bomb, wallet };
}

function makeGame(overrides = {}) {
    const grid = new Grid(8);
    grid.cellSize = 32;
    return {
        grid,
        score: 0,
        gameStats: { score: 0, bombClears: 0, bombCellsCleared: 0 },
        isAnimating: false,
        isGameOver: false,
        replayPlaybackLocked: false,
        rlPreviewLocked: false,
        renderer: {
            cellSize: 32,
            setClearCells: vi.fn(),
            triggerComboFlash: vi.fn(),
            triggerBonusMatchFlash: vi.fn(),
            setShake: vi.fn(),
        },
        markDirty: vi.fn(),
        updateUI: vi.fn(),
        ...overrides,
    };
}

function fillRect(grid, x0, y0, x1, y1, colorIdx = 1) {
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            grid.cells[y][x] = colorIdx;
        }
    }
}

describe('bomb — _explodeAt 范围 + 加分', () => {
    it('清除 3×3 范围内所有非空格，保留空格不动', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        wallet.addBalance('bombToken', 1, 'test');
        bomb.__initForTest(game);

        // (3,3) 周围 3×3 内有 3 个方块
        game.grid.cells[2][2] = 1;
        game.grid.cells[3][3] = 2;
        game.grid.cells[4][4] = 3;
        // (3,3) 中心，3×3 范围 = (2..4, 2..4)：只有上面 3 格非空
        const ok = bomb._explodeAt(3, 3);
        expect(ok).toBe(true);
        expect(game.grid.cells[2][2]).toBeNull();
        expect(game.grid.cells[3][3]).toBeNull();
        expect(game.grid.cells[4][4]).toBeNull();
        // 范围外不动
        expect(game.grid.cells[1][1]).toBeNull();   // 本来就空
    });

    it('加分 = 清除格数 × 5', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        wallet.addBalance('bombToken', 1, 'test');
        bomb.__initForTest(game);

        fillRect(game.grid, 2, 2, 4, 4);   // 9 格
        bomb._explodeAt(3, 3);
        expect(game.score).toBe(45);   // 9 × 5
        expect(game.gameStats.bombClears).toBe(1);
        expect(game.gameStats.bombCellsCleared).toBe(9);
    });
});

describe('bomb — 边界处理', () => {
    it('左上角爆炸只清除有效范围（不越界）', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        wallet.addBalance('bombToken', 1, 'test');
        bomb.__initForTest(game);

        fillRect(game.grid, 0, 0, 2, 2);   // 3×3
        bomb._explodeAt(0, 0);   // 范围 = (-1..1, -1..1)，有效部分 (0..1, 0..1)
        expect(game.grid.cells[0][0]).toBeNull();
        expect(game.grid.cells[1][1]).toBeNull();
        expect(game.grid.cells[2][2]).toBe(1);   // 范围外保留
    });

    it('右下角爆炸只清除有效范围', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        wallet.addBalance('bombToken', 1, 'test');
        bomb.__initForTest(game);

        fillRect(game.grid, 5, 5, 7, 7);
        bomb._explodeAt(7, 7);   // 有效范围 (6..7, 6..7) = 4 格
        expect(game.grid.cells[7][7]).toBeNull();
        expect(game.grid.cells[6][6]).toBeNull();
        expect(game.grid.cells[5][5]).toBe(1);   // 范围外保留
    });

    it('坐标越界拒绝执行', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        wallet.addBalance('bombToken', 1, 'test');
        bomb.__initForTest(game);

        expect(bomb._explodeAt(-1, 0)).toBe(false);
        expect(bomb._explodeAt(0, -1)).toBe(false);
        expect(bomb._explodeAt(8, 0)).toBe(false);
        expect(bomb._explodeAt(0, 8)).toBe(false);
        expect(wallet.getBalance('bombToken')).toBe(1);   // 无扣费
    });
});

describe('bomb — 扣费 / 返还', () => {
    it('成功爆炸扣 1', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        wallet.addBalance('bombToken', 3, 'test');
        bomb.__initForTest(game);

        game.grid.cells[3][3] = 1;
        bomb._explodeAt(3, 3);
        expect(wallet.getBalance('bombToken')).toBe(2);
    });

    it('全空区域不扣费', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        wallet.addBalance('bombToken', 1, 'test');
        bomb.__initForTest(game);

        // (3,3) 周围 3×3 全空
        const ok = bomb._explodeAt(3, 3);
        expect(ok).toBe(false);
        expect(wallet.getBalance('bombToken')).toBe(1);   // 没扣
    });

    it('余额不足拒绝', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        bomb.__initForTest(game);

        game.grid.cells[3][3] = 1;
        const ok = bomb._explodeAt(3, 3);
        expect(ok).toBe(false);
        expect(wallet.getBalance('bombToken')).toBe(0);
    });
});

describe('bomb — 闪光选择 + 防御', () => {
    it('使用 triggerComboFlash 而非 triggerBonusMatchFlash（区分 bonus 消行）', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        wallet.addBalance('bombToken', 1, 'test');
        bomb.__initForTest(game);

        game.grid.cells[3][3] = 1;
        bomb._explodeAt(3, 3);
        expect(game.renderer.triggerComboFlash).toHaveBeenCalled();
        expect(game.renderer.triggerBonusMatchFlash).not.toHaveBeenCalled();
        expect(game.renderer.setShake).toHaveBeenCalled();
    });

    it('isAnimating 时拒绝执行', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame({ isAnimating: true });
        wallet.addBalance('bombToken', 1, 'test');
        bomb.__initForTest(game);

        game.grid.cells[3][3] = 1;
        const ok = bomb._explodeAt(3, 3);
        expect(ok).toBe(false);
        expect(wallet.getBalance('bombToken')).toBe(1);
    });

    it('isGameOver / replayPlaybackLocked 时拒绝执行', async () => {
        const { bomb, wallet } = await freshBomb();
        wallet.addBalance('bombToken', 5, 'test');

        let game = makeGame({ isGameOver: true });
        bomb.__initForTest(game);
        game.grid.cells[3][3] = 1;
        expect(bomb._explodeAt(3, 3)).toBe(false);

        bomb.__resetForTest();
        game = makeGame({ replayPlaybackLocked: true });
        bomb.__initForTest(game);
        game.grid.cells[3][3] = 1;
        expect(bomb._explodeAt(3, 3)).toBe(false);
    });
});

describe('bomb — setClearCells 带颜色', () => {
    it('setClearCells 接收 cells 含 color 字段（与游戏内消行特效一致）', async () => {
        const { bomb, wallet } = await freshBomb();
        const game = makeGame();
        wallet.addBalance('bombToken', 1, 'test');
        bomb.__initForTest(game);

        game.grid.cells[3][3] = 5;
        game.grid.cells[3][4] = 7;
        bomb._explodeAt(3, 3);

        const arg = game.renderer.setClearCells.mock.calls[0][0];
        expect(arg.length).toBeGreaterThan(0);
        const c33 = arg.find(c => c.x === 3 && c.y === 3);
        const c34 = arg.find(c => c.x === 4 && c.y === 3);
        expect(c33.color).toBe(5);
        expect(c34.color).toBe(7);
    });
});
