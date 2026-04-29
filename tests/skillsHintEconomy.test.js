/**
 * @vitest-environment jsdom
 *
 * hintEconomy 单元测试 — 覆盖单块 hint 触发 / 扣费时机 / 越界 / placed 块跳过 /
 * computeHints 失败 / 余额 0 / v10.16.6 瞄准模式 toggle / dock 选块流程
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
import * as hint from '../web/src/skills/hintEconomy.js';
import * as aim from '../web/src/skills/aimManager.js';

async function freshHint() {
    _mockLS.clear();
    const wallet = getWallet();
    wallet._reset();
    hint.__resetForTest();
    aim.__resetForTest();
    document.body.innerHTML = '<div id="dock"></div><div id="skill-bar"></div>';
    return { hint, wallet };
}

function makeGame(overrides = {}) {
    const grid = new Grid(8);
    return {
        grid,
        dockBlocks: [
            { id: 'b1', shape: [[1, 1], [1, 1]], colorIdx: 1, width: 2, height: 2, placed: false },
            { id: 'b2', shape: [[1]], colorIdx: 2, width: 1, height: 1, placed: false },
            { id: 'b3', shape: [[1, 1, 1]], colorIdx: 3, width: 3, height: 1, placed: false },
        ],
        renderer: {
            cellSize: 32,
            fxCtx: null,
            renderAmbient: () => {},
        },
        markDirty: vi.fn(),
        ...overrides,
    };
}

describe('hintEconomy — 扣费时机', () => {
    it('计算成功才扣 1（无可用位置不扣费）', async () => {
        const { hint, wallet } = await freshHint();
        const game = makeGame();
        hint.__initForTest(game);

        // 空 grid → 所有块都能放 → computeHints 必返回结果
        const before = wallet.getBalance('hintToken');
        hint.__triggerHintForTest(0);
        expect(wallet.getBalance('hintToken')).toBe(before - 1);
    });

    it('grid 已满 → 无可放位置 → 不扣费', async () => {
        const { hint, wallet } = await freshHint();
        const game = makeGame();
        hint.__initForTest(game);

        // 填满 grid
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                game.grid.cells[y][x] = 1;
            }
        }
        const before = wallet.getBalance('hintToken');
        hint.__triggerHintForTest(0);
        expect(wallet.getBalance('hintToken')).toBe(before);   // 未扣
        expect(hint.__getHintForTest()).toBeNull();
    });

    it('钱包余额 0 时不扣费 + 不触发 hint', async () => {
        const { hint, wallet } = await freshHint();
        const game = makeGame();
        hint.__initForTest(game);

        wallet.spend('hintToken', 3, 'drain');   // 耗光每日免费
        const before = wallet.getBalance('hintToken');
        expect(before).toBe(0);

        hint.__triggerHintForTest(0);
        expect(wallet.getBalance('hintToken')).toBe(0);
        expect(hint.__getHintForTest()).toBeNull();
    });
});

describe('hintEconomy — block 状态防御', () => {
    it('placed=true 的块跳过（不扣费）', async () => {
        const { hint, wallet } = await freshHint();
        const game = makeGame();
        game.dockBlocks[0].placed = true;
        hint.__initForTest(game);

        const before = wallet.getBalance('hintToken');
        hint.__triggerHintForTest(0);
        expect(wallet.getBalance('hintToken')).toBe(before);
        expect(hint.__getHintForTest()).toBeNull();
    });

    it('blockIdx 越界（无对应 dockBlock）跳过', async () => {
        const { hint, wallet } = await freshHint();
        const game = makeGame();
        hint.__initForTest(game);

        const before = wallet.getBalance('hintToken');
        hint.__triggerHintForTest(99);
        expect(wallet.getBalance('hintToken')).toBe(before);
        expect(hint.__getHintForTest()).toBeNull();
    });

    it('block.shape 未定义 → 跳过', async () => {
        const { hint, wallet } = await freshHint();
        const game = makeGame();
        game.dockBlocks[0] = { id: 'broken', shape: null, colorIdx: 0, placed: false };
        hint.__initForTest(game);

        const before = wallet.getBalance('hintToken');
        hint.__triggerHintForTest(0);
        expect(wallet.getBalance('hintToken')).toBe(before);
    });
});

describe('hintEconomy — _hintActive 状态', () => {
    it('成功触发后设置 _hintActive 含 gx / gy / shape / color / ttl', async () => {
        const { hint } = await freshHint();
        const game = makeGame();
        hint.__initForTest(game);

        hint.__triggerHintForTest(0);
        const active = hint.__getHintForTest();
        expect(active).not.toBeNull();
        expect(typeof active.gx).toBe('number');
        expect(typeof active.gy).toBe('number');
        expect(active.shape).toEqual([[1, 1], [1, 1]]);
        expect(active.color).toBe(1);
        expect(active.ttl).toBeGreaterThan(performance.now());
    });

    it('hint 触发后 game.markDirty 被调（让 fx 重绘）', async () => {
        const { hint } = await freshHint();
        const game = makeGame();
        hint.__initForTest(game);
        hint.__triggerHintForTest(0);
        expect(game.markDirty).toHaveBeenCalled();
    });
});

/* -----------------------------------------------------------
 * v10.16.6：从「长按自动扣费」改为「按按钮 → 选块」交互模式
 * --------------------------------------------------------- */
describe('hintEconomy — v10.16.6 按钮触发瞄准模式', () => {
    it('initHintEconomy 在 #dock 上注册了 capture 阶段的 mousedown 监听', async () => {
        const { hint } = await freshHint();
        const game = makeGame();

        const dock = document.getElementById('dock');
        // 初始状态下点击 dock 不应该触发任何 hint（因为没进入瞄准）
        hint.__initForTest(game);
        // 模拟一个完整 initHintEconomy 流程，但走 __initForTest 后再调一次以挂监听
        hint.initHintEconomy({ game });

        const blockEl = document.createElement('div');
        blockEl.className = 'dock-block';
        blockEl.dataset.index = '0';
        dock.appendChild(blockEl);

        // 不在瞄准状态 → 派发 mousedown 不应触发 hint
        blockEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        expect(hint.__getHintForTest()).toBeNull();
    });

    it('进入瞄准 → 点击 dock 块 → 触发 hint 扣费 + 自动退出瞄准', async () => {
        const { hint, wallet } = await freshHint();
        const game = makeGame();

        // 准备 dock DOM
        const dock = document.getElementById('dock');
        const b0 = document.createElement('div');
        b0.className = 'dock-block';
        b0.dataset.index = '0';
        dock.appendChild(b0);

        hint.initHintEconomy({ game });

        // 手动进入瞄准（模拟点击 🎯 按钮）
        aim.enterAim('hint-quick');
        expect(aim.isAiming('hint-quick')).toBe(true);

        const before = wallet.getBalance('hintToken');
        // 触发 dock 块 mousedown — 在 capture 阶段被 hintEconomy 截获
        b0.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

        expect(wallet.getBalance('hintToken')).toBe(before - 1);
        expect(hint.__getHintForTest()).not.toBeNull();
        // 自动退出瞄准
        expect(aim.isAiming('hint-quick')).toBe(false);
    });

    it('瞄准状态下点击 dock 中的非 .dock-block 元素（如间隔区）不触发 hint', async () => {
        const { hint, wallet } = await freshHint();
        const game = makeGame();
        const dock = document.getElementById('dock');

        hint.initHintEconomy({ game });
        aim.enterAim('hint-quick');

        const before = wallet.getBalance('hintToken');
        // dock 自身（非 dock-block）的 mousedown 不应消费 token
        dock.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        expect(wallet.getBalance('hintToken')).toBe(before);
        expect(hint.__getHintForTest()).toBeNull();
        // 仍处于瞄准（让用户再选）
        expect(aim.isAiming('hint-quick')).toBe(true);
    });

    it('未进入瞄准时点击 dock 块 → 不被 hintEconomy 截获 → 走原拖拽流程（不扣费）', async () => {
        const { hint, wallet } = await freshHint();
        const game = makeGame();
        const dock = document.getElementById('dock');
        const b0 = document.createElement('div');
        b0.className = 'dock-block';
        b0.dataset.index = '0';
        dock.appendChild(b0);

        hint.initHintEconomy({ game });
        // 不进入瞄准
        const before = wallet.getBalance('hintToken');
        b0.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        expect(wallet.getBalance('hintToken')).toBe(before);
        expect(hint.__getHintForTest()).toBeNull();
    });
});
