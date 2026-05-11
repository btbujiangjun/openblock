/**
 * lightning.js — v10.17 闪电 60 秒局
 *
 * 设计要点
 * --------
 * - 60 秒倒计时；时间到自动 endGame
 * - 不计入主线分数 / RL 训练 / replay（独立模式）
 * - HUD 顶部显示倒计时；剩 10s 闪红警告
 * - 启动方式：window.__lightning.start() 或主菜单按钮
 *
 * 接入路径
 * --------
 *   import { initLightningMode } from './playmodes/lightning.js';
 *   initLightningMode({ game });
 */

const DURATION_MS = 60_000;
const WARN_MS = 10_000;

let _game = null;
let _running = false;
let _endTs = 0;
let _rafId = 0;
let _hud = null;

export function initLightningMode({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    if (typeof window !== 'undefined') {
        window.__lightning = {
            start: startLightning,
            stop: stopLightning,
            isRunning: () => _running,
        };
    }
}

async function startLightning() {
    if (_running || !_game) return;
    _running = true;
    _endTs = performance.now() + DURATION_MS;

    /* 标记游戏处于 lightning 模式（其他模块可读 game._lightningMode 跳过统计） */
    _game._lightningMode = true;
    await _game.start({ fromChain: false });

    _renderHud();
    _tick();
}

function stopLightning() {
    _running = false;
    cancelAnimationFrame(_rafId);
    _hud?.remove();
    _hud = null;
    if (_game) _game._lightningMode = false;
}

function _tick() {
    if (!_running) return;
    const remain = _endTs - performance.now();
    if (remain <= 0) {
        _running = false;
        _hud?.classList.add('lm-hud--end');
        if (_hud) _hud.querySelector('.lm-hud__time').textContent = '0.0';
        setTimeout(() => {
            _game?.endGame?.({ reason: 'lightning-timeout' });
            stopLightning();
        }, 600);
        return;
    }
    if (_hud) {
        const sec = (remain / 1000).toFixed(1);
        _hud.querySelector('.lm-hud__time').textContent = sec;
        _hud.classList.toggle('lm-hud--warn', remain < WARN_MS);
    }
    _rafId = requestAnimationFrame(_tick);
}

function _renderHud() {
    if (typeof document === 'undefined') return;
    _hud?.remove();
    _hud = document.createElement('div');
    _hud.className = 'lm-hud';
    _hud.innerHTML = `
        <div class="lm-hud__label">闪电 60s</div>
        <div class="lm-hud__time">60.0</div>
        <button class="lm-hud__quit" type="button" title="退出">✕</button>
    `;
    document.body.appendChild(_hud);

    _hud.querySelector('.lm-hud__quit').addEventListener('click', () => {
        _game?.endGame?.({ reason: 'lightning-quit' });
        stopLightning();
    });
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
    _running = false;
    _endTs = 0;
    if (_hud) { _hud.remove(); _hud = null; }
}
