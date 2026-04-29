/**
 * @vitest-environment jsdom
 *
 * undo 单元测试 — 覆盖 snapshot 保存、还原 grid / dock / score / stats、
 * 关卡模式禁用、isAnimating 禁用、扣费失败回退、新一轮 endGame / start 失效。
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
import * as undo from '../web/src/skills/undo.js';

async function freshUndo() {
    _mockLS.clear();
    const wallet = getWallet();
    wallet._reset();
    undo.__resetForTest();
    document.body.innerHTML = '<div id="skill-bar"></div>';
    return { undo, wallet };
}

function makeGame(overrides = {}) {
    const grid = new Grid(8);
    const game = {
        grid,
        dockBlocks: [
            { id: 'b1', shape: [[1, 1], [1, 1]], colorIdx: 1, width: 2, height: 2, placed: false },
            { id: 'b2', shape: [[1]], colorIdx: 2, width: 1, height: 1, placed: false },
            { id: 'b3', shape: [[1, 1]], colorIdx: 3, width: 2, height: 1, placed: false },
        ],
        score: 0,
        gameStats: { score: 0, placements: 0, clears: 0, maxCombo: 0, misses: 0, startTime: 0 },
        isAnimating: false,
        isGameOver: false,
        replayPlaybackLocked: false,
        rlPreviewLocked: false,
        _levelMode: 'endless',
        _levelManager: null,
        ghostCanvas: null,
        renderer: {
            clearParticles: vi.fn(),
            setClearCells: vi.fn(),
        },
        onEnd: vi.fn(),
        start: vi.fn(async () => {}),
        endGame: vi.fn(async () => {}),
        spawnBlocks: vi.fn(),
        populateDockUI: vi.fn((descriptors) => {
            // 模拟 game.js 的真实行为：替换 dockBlocks
            game.dockBlocks = descriptors.map(d => ({
                id: d.id,
                shape: d.shape,
                colorIdx: d.colorIdx,
                width: d.shape[0].length,
                height: d.shape.length,
                placed: !!d.placed,
            }));
        }),
        updateUI: vi.fn(),
        markDirty: vi.fn(),
        _resetGhostDomStyles: vi.fn(),
        ...overrides,
    };
    return game;
}

describe('undo — initUndo & 装饰', () => {
    it('initUndo 装饰 onEnd / start / endGame / spawnBlocks', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        const origOnEnd = game.onEnd;
        const origStart = game.start;
        const origEndGame = game.endGame;
        const origSpawn = game.spawnBlocks;

        undo.initUndo({ game });

        expect(game.onEnd).not.toBe(origOnEnd);
        expect(game.start).not.toBe(origStart);
        expect(game.endGame).not.toBe(origEndGame);
        expect(game.spawnBlocks).not.toBe(origSpawn);
    });
});

describe('undo — snapshot 保存', () => {
    it('落子后保存完整 snapshot（grid / dock / score / stats）', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        // _origOnEnd 模拟"落子成功"：placements++、grid 增加 1 格
        game.onEnd = vi.fn(() => {
            game.gameStats.placements = 1;
            game.grid.cells[0][0] = 1;
        });
        undo.initUndo({ game });

        game.onEnd();   // 触发 _wrappedOnEnd → 保存 snapshot

        const snap = window.__undoSkill?.getSnapshot();
        expect(snap).not.toBeNull();
        expect(snap.gridJSON.size).toBe(8);
        expect(snap.gridJSON.cells[0][0]).toBeNull();   // snapshot 是落子前
        expect(snap.dockDescriptors).toHaveLength(3);
        expect(snap.dockDescriptors[0]).toMatchObject({ id: 'b1', placed: false });
        expect(snap.score).toBe(0);
        expect(snap.stats.placements).toBe(0);
    });

    it('未落子（fillRatio / placements 不变）不保存 snapshot', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => {});   // 没有任何变化
        undo.initUndo({ game });

        game.onEnd();
        expect(window.__undoSkill?.getSnapshot()).toBeNull();
    });

    it('关卡模式不保存 snapshot', async () => {
        const { undo } = await freshUndo();
        const game = makeGame({ _levelMode: 'level', _levelManager: { id: 'L1' } });
        game.onEnd = vi.fn(() => {
            game.gameStats.placements = 1;
        });
        undo.initUndo({ game });
        game.onEnd();
        expect(window.__undoSkill?.getSnapshot()).toBeNull();
    });

    it('isAnimating 时不保存 snapshot', async () => {
        const { undo } = await freshUndo();
        const game = makeGame({ isAnimating: true });
        game.onEnd = vi.fn(() => {
            game.gameStats.placements = 1;
        });
        undo.initUndo({ game });
        game.onEnd();
        expect(window.__undoSkill?.getSnapshot()).toBeNull();
    });

    it('保存的 dock descriptors 是深拷贝（mutating game.dockBlocks 不影响 snapshot）', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => {
            game.gameStats.placements = 1;
            // 模拟 game.js 落子后把 dragBlock 标记 placed
            game.dockBlocks[0].placed = true;
        });
        undo.initUndo({ game });
        game.onEnd();
        const snap = window.__undoSkill.getSnapshot();
        expect(snap.dockDescriptors[0].placed).toBe(false);   // snapshot 保存的是落子前
    });
});

describe('undo — canUndo', () => {
    it('无 snapshot 时返回 false', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        undo.initUndo({ game });
        expect(undo.canUndo()).toBe(false);
    });

    it('snapshot + 余额 > 0 → true', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();
        expect(undo.canUndo()).toBe(true);   // 默认每日免费 3 次
    });

    it('isAnimating 时 false', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();
        game.isAnimating = true;
        expect(undo.canUndo()).toBe(false);
    });

    it('关卡模式 false（即使有 snapshot）', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();
        game._levelMode = 'level';
        expect(undo.canUndo()).toBe(false);
    });

    it('isGameOver / replayPlaybackLocked 时 false', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();

        game.isGameOver = true;
        expect(undo.canUndo()).toBe(false);
        game.isGameOver = false;
        game.replayPlaybackLocked = true;
        expect(undo.canUndo()).toBe(false);
    });

    it('钱包余额为 0 → false', async () => {
        const { undo, wallet } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();

        // 把每日免费配额耗光
        wallet.spend('undoToken', 3, 'drain');
        expect(undo.canUndo()).toBe(false);
    });
});

describe('undo — undoOnce 还原', () => {
    it('还原 grid / dock / score / stats', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.score = 0;
        game.onEnd = vi.fn(() => {
            game.gameStats.placements = 1;
            game.grid.cells[3][3] = 1;
            game.score = 50;
            game.dockBlocks[0].placed = true;
        });
        undo.initUndo({ game });
        game.onEnd();

        // 验证 snapshot 已存
        expect(window.__undoSkill.getSnapshot()).not.toBeNull();

        const ok = undo.undoOnce();
        expect(ok).toBe(true);

        // grid 还原（[3][3] 应回到 null）
        expect(game.grid.cells[3][3]).toBeNull();
        // score 还原
        expect(game.score).toBe(0);
        // stats 还原（placements 回到 0）
        expect(game.gameStats.placements).toBe(0);
    });

    it('调用 populateDockUI 强制重建 dock DOM（修复"候选块消失"）', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => {
            game.gameStats.placements = 1;
            game.dockBlocks[0].placed = true;
        });
        undo.initUndo({ game });
        game.onEnd();

        undo.undoOnce();

        // 关键断言：populateDockUI 必须被调用，且参数包含 3 个 descriptor，第一个未 placed
        expect(game.populateDockUI).toHaveBeenCalledTimes(1);
        const callArgs = game.populateDockUI.mock.calls[0];
        const descriptors = callArgs[0];
        expect(descriptors).toHaveLength(3);
        expect(descriptors[0]).toMatchObject({ id: 'b1', placed: false });
        expect(descriptors[0].shape).toEqual([[1, 1], [1, 1]]);
        expect(callArgs[1]).toMatchObject({ logSpawn: false });
    });

    it('扣费成功后 snapshot 失效（连续 undo 第二次拒绝）', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();

        expect(undo.undoOnce()).toBe(true);
        expect(undo.undoOnce()).toBe(false);   // snapshot 已用完
    });

    it('canUndo false 时 undoOnce 不扣费', async () => {
        const { undo, wallet } = await freshUndo();
        const game = makeGame();
        undo.initUndo({ game });

        const before = wallet.getBalance('undoToken');
        const ok = undo.undoOnce();
        expect(ok).toBe(false);
        expect(wallet.getBalance('undoToken')).toBe(before);
    });

    it('undoOnce 后清掉 dragBlock / previewBlock / 拖拽 body class', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.dragBlock = game.dockBlocks[0];
        game.drag = { index: 0 };
        game.previewBlock = game.dockBlocks[0];
        game.previewPos = { x: 1, y: 1 };
        document.body.classList.add('block-drag-active');

        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();
        undo.undoOnce();

        expect(game.dragBlock).toBeNull();
        expect(game.drag).toBeNull();
        expect(game.previewBlock).toBeNull();
        expect(game.previewPos).toBeNull();
        expect(document.body.classList.contains('block-drag-active')).toBe(false);
    });

    it('undoOnce 触发 updateUI / markDirty', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();
        undo.undoOnce();

        expect(game.updateUI).toHaveBeenCalled();
        expect(game.markDirty).toHaveBeenCalled();
        expect(game.renderer.setClearCells).toHaveBeenCalledWith([]);
    });
});

describe('undo — snapshot 失效', () => {
    it('start 后 snapshot 清空', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();
        expect(window.__undoSkill.getSnapshot()).not.toBeNull();

        await game.start();
        expect(window.__undoSkill.getSnapshot()).toBeNull();
    });

    it('endGame 后 snapshot 清空', async () => {
        const { undo } = await freshUndo();
        const game = makeGame();
        game.onEnd = vi.fn(() => { game.gameStats.placements = 1; });
        undo.initUndo({ game });
        game.onEnd();
        expect(window.__undoSkill.getSnapshot()).not.toBeNull();

        await game.endGame();
        expect(window.__undoSkill.getSnapshot()).toBeNull();
    });
});
