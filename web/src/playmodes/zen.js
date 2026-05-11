/**
 * zen.js — v10.17 Zen 无尽模式
 *
 * 设计要点
 * --------
 * - 无 game over：盘面"将满"时自动清掉最底一行（保留 7 行可玩）
 * - 减压 / 情绪调节出口；不计分数也不上传 RL
 * - 启动方式：window.__zen.start()
 *
 * 接入路径
 * --------
 *   import { initZenMode } from './playmodes/zen.js';
 *   initZenMode({ game });
 */

let _game = null;
let _running = false;
let _origNoMovesWarning = null;

export function initZenMode({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    if (typeof window !== 'undefined') {
        window.__zen = {
            start: startZen,
            stop: stopZen,
            isRunning: () => _running,
        };
    }
}

async function startZen() {
    if (_running || !_game) return;
    _running = true;
    _game._zenMode = true;

    /* 装饰：无可放位置时不弹"无路可走"警告，自动清最底行 */
    if (!_origNoMovesWarning && typeof _game.showNoMovesWarning === 'function') {
        _origNoMovesWarning = _game.showNoMovesWarning.bind(_game);
        _game.showNoMovesWarning = () => {
            if (!_game._zenMode) return _origNoMovesWarning();
            _zenAutoClear();
        };
    }

    await _game.start({ fromChain: false });
    _renderHud();
}

function stopZen() {
    _running = false;
    if (_game) _game._zenMode = false;
    if (_origNoMovesWarning && _game) {
        _game.showNoMovesWarning = _origNoMovesWarning;
        _origNoMovesWarning = null;
    }
    document.querySelector('.zen-hud')?.remove();
}

function _zenAutoClear() {
    if (!_game?.grid) return;
    const grid = _game.grid;
    const last = grid.cells.length - 1;
    /* 清最底行 + 上推一行 */
    for (let y = last; y > 0; y--) {
        grid.cells[y] = grid.cells[y - 1].slice();
    }
    grid.cells[0] = new Array(grid.cells[0].length).fill(0);
    _game.renderer?.markDirty?.();
    _game.markDirty?.();
    /* 重新生成 dock 候选 */
    _game.spawnBlocks?.();
}

function _renderHud() {
    if (typeof document === 'undefined') return;
    document.querySelector('.zen-hud')?.remove();
    const hud = document.createElement('div');
    hud.className = 'zen-hud';
    hud.innerHTML = `
        <span class="zen-hud__icon">☯︎</span>
        <span class="zen-hud__label">Zen 无尽</span>
        <button class="zen-hud__quit" type="button" title="退出">✕</button>
    `;
    document.body.appendChild(hud);
    hud.querySelector('.zen-hud__quit').addEventListener('click', () => {
        _game?.endGame?.({ reason: 'zen-quit' });
        stopZen();
    });
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
    _running = false;
    _origNoMovesWarning = null;
}
