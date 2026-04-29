/**
 * @vitest-environment jsdom
 *
 * rainbow 单元测试 — 覆盖染色 + 填空 → 必触发清除、行内非空过少拒绝、
 * bonus 同色行加分、扣费、防御 isAnimating，行还原（边界条件）
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
import * as rainbow from '../web/src/skills/rainbow.js';

async function freshRainbow() {
    _mockLS.clear();
    const wallet = getWallet();
    wallet._reset();
    rainbow.__resetForTest();
    document.body.innerHTML = '';
    return { rainbow, wallet };
}

function makeGame(overrides = {}) {
    const grid = new Grid(8);
    return {
        grid,
        score: 0,
        gameStats: { score: 0, clears: 0, rainbowClears: 0 },
        isAnimating: false,
        isGameOver: false,
        replayPlaybackLocked: false,
        rlPreviewLocked: false,
        renderer: {
            cellSize: 32,
            setClearCells: vi.fn(),
            triggerBonusMatchFlash: vi.fn(),
            setShake: vi.fn(),
        },
        markDirty: vi.fn(),
        updateUI: vi.fn(),
        ...overrides,
    };
}

describe('rainbow — _paintRow 染色 + 填空 + 清除', () => {
    it('行已有 ≥ 3 块 + 染色填空 → checkLines 必清除该行', async () => {
        const { rainbow, wallet } = await freshRainbow();
        const game = makeGame();
        wallet.addBalance('rainbowToken', 1, 'test');
        rainbow.__initForTest(game);

        // 第 0 行有 4 块（不满）
        for (let x = 0; x < 4; x++) game.grid.cells[0][x] = 1;
        const ok = rainbow._paintRow(0);
        expect(ok).toBe(true);
        // 第 0 行被清空
        for (let x = 0; x < 8; x++) {
            expect(game.grid.cells[0][x]).toBeNull();
        }
    });

    it('行已满（不同颜色）→ 染色后 checkLines 触发 bonus 同色行', async () => {
        const { rainbow, wallet } = await freshRainbow();
        const game = makeGame();
        wallet.addBalance('rainbowToken', 1, 'test');
        rainbow.__initForTest(game);

        for (let x = 0; x < 8; x++) game.grid.cells[1][x] = (x % 4) + 1;   // 4 种颜色
        rainbow._paintRow(1);
        // bonus 同色行触发：分数应包含 base + bonus 部分
        // base = 8 cells × 10 = 80; bonus = 1 × 80 = 80, total 160
        expect(game.score).toBe(160);
        expect(game.gameStats.rainbowClears).toBe(1);
    });

    it('行非空 < 3 拒绝染色（节省道具）', async () => {
        const { rainbow, wallet } = await freshRainbow();
        const game = makeGame();
        wallet.addBalance('rainbowToken', 1, 'test');
        rainbow.__initForTest(game);

        game.grid.cells[2][3] = 1;
        game.grid.cells[2][5] = 1;   // 仅 2 块
        const ok = rainbow._paintRow(2);
        expect(ok).toBe(false);
        // 行未变化
        expect(game.grid.cells[2][3]).toBe(1);
        expect(game.grid.cells[2][5]).toBe(1);
        expect(wallet.getBalance('rainbowToken')).toBe(1);   // 未扣费
    });

    it('扣 1 rainbowToken', async () => {
        const { rainbow, wallet } = await freshRainbow();
        const game = makeGame();
        wallet.addBalance('rainbowToken', 3, 'test');
        rainbow.__initForTest(game);

        for (let x = 0; x < 4; x++) game.grid.cells[0][x] = 1;
        rainbow._paintRow(0);
        expect(wallet.getBalance('rainbowToken')).toBe(2);
    });

    it('余额 0 时拒绝染色 + 不修改 grid', async () => {
        const { rainbow } = await freshRainbow();
        const game = makeGame();
        rainbow.__initForTest(game);

        for (let x = 0; x < 4; x++) game.grid.cells[0][x] = 1;
        const ok = rainbow._paintRow(0);
        expect(ok).toBe(false);
        // 行未变
        for (let x = 0; x < 4; x++) expect(game.grid.cells[0][x]).toBe(1);
    });
});

describe('rainbow — 防御 + 边界', () => {
    it('isAnimating / isGameOver / replayPlaybackLocked 时拒绝', async () => {
        const { rainbow, wallet } = await freshRainbow();
        wallet.addBalance('rainbowToken', 5, 'test');

        let game = makeGame({ isAnimating: true });
        rainbow.__initForTest(game);
        for (let x = 0; x < 4; x++) game.grid.cells[0][x] = 1;
        expect(rainbow._paintRow(0)).toBe(false);

        rainbow.__resetForTest();
        game = makeGame({ isGameOver: true });
        rainbow.__initForTest(game);
        for (let x = 0; x < 4; x++) game.grid.cells[0][x] = 1;
        expect(rainbow._paintRow(0)).toBe(false);

        rainbow.__resetForTest();
        game = makeGame({ replayPlaybackLocked: true });
        rainbow.__initForTest(game);
        for (let x = 0; x < 4; x++) game.grid.cells[0][x] = 1;
        expect(rainbow._paintRow(0)).toBe(false);
    });

    it('rowY 越界拒绝', async () => {
        const { rainbow, wallet } = await freshRainbow();
        const game = makeGame();
        wallet.addBalance('rainbowToken', 1, 'test');
        rainbow.__initForTest(game);

        expect(rainbow._paintRow(-1)).toBe(false);
        expect(rainbow._paintRow(8)).toBe(false);
        expect(rainbow._paintRow(100)).toBe(false);
        expect(wallet.getBalance('rainbowToken')).toBe(1);
    });

    it('成功后调用 setClearCells / triggerBonusMatchFlash / updateUI', async () => {
        const { rainbow, wallet } = await freshRainbow();
        const game = makeGame();
        wallet.addBalance('rainbowToken', 1, 'test');
        rainbow.__initForTest(game);

        for (let x = 0; x < 4; x++) game.grid.cells[0][x] = 1;
        rainbow._paintRow(0);
        expect(game.renderer.setClearCells).toHaveBeenCalled();
        // 至少调用一次 triggerBonusMatchFlash（染色完成）
        expect(game.renderer.triggerBonusMatchFlash).toHaveBeenCalled();
        expect(game.updateUI).toHaveBeenCalled();
        expect(game.markDirty).toHaveBeenCalled();
    });
});

describe('rainbow — 加分公式', () => {
    it('清除 8 格 + 1 个 bonus 同色行 = 8×10 + 1×80 = 160', async () => {
        const { rainbow, wallet } = await freshRainbow();
        const game = makeGame();
        wallet.addBalance('rainbowToken', 1, 'test');
        rainbow.__initForTest(game);

        // 第 5 行原本 5 格非空（不同色），染色后会触发 bonus 同色行
        for (let x = 0; x < 5; x++) game.grid.cells[5][x] = (x % 3) + 1;
        rainbow._paintRow(5);
        expect(game.score).toBe(160);
    });

    it('清除该行同时触发的 col bonus（如第 5 行被清后某列也满了 → 不影响）', async () => {
        const { rainbow, wallet } = await freshRainbow();
        const game = makeGame();
        wallet.addBalance('rainbowToken', 1, 'test');
        rainbow.__initForTest(game);

        // 第 5 行 5 格 + 第 0 列 7 格非空（含 [5][0]）
        for (let x = 0; x < 5; x++) game.grid.cells[5][x] = 1;
        for (let y = 0; y < 8; y++) {
            if (y !== 5) game.grid.cells[y][0] = 2;
        }
        // 染色第 5 行 → 第 5 行染主色填满 → 清除（bonus 同色）
        // 同时第 0 列因 [5][0]=0 后凑够 8 格也满了（但颜色不一致）
        rainbow._paintRow(5);
        // 至少有 row bonus，分数 ≥ 160
        expect(game.score).toBeGreaterThanOrEqual(160);
        expect(game.gameStats.rainbowClears).toBe(1);
    });
});
