/**
 * freeze.js — v10.17 冻结一行（道具池扩展）
 *
 * 设计要点
 * --------
 * - 点击道具栏 ❄ 按钮 → 进入瞄准模式（与 bomb / rainbow 互斥）
 * - 棋盘点击任意行 → 该行进入"冻结态"：本局内不被消除规则清除（即使填满）
 *   但仍计算其他行 / 列 的 bonus
 * - 视觉：冻结行高亮蓝色边框
 * - 消耗 1 freezeToken（每日发放上限 2）
 * - 一局只能冻结一行；游戏结束自动失效
 *
 * 实现细节
 * --------
 * 装饰 grid.checkLines() 在返回结果时把"冻结行"过滤掉。
 * 状态保存在 game._frozenRow（本局），endGame 自动清除。
 *
 * 接入路径
 * --------
 *   import { initFreeze } from './skills/freeze.js';
 *   initFreeze({ game, audio });
 */

import { getWallet } from './wallet.js';
import { registerSkill, refreshSkillBar } from './skillBar.js';
import { t } from '../i18n/i18n.js';
import { enterAim, exitAim, isAiming } from './aimManager.js';

const SKILL_ID = 'freeze';

let _game = null;
let _audio = null;
let _gridListenerInstalled = false;

export function initFreeze({ game, audio = null } = {}) {
    if (!game || _game) return;
    _game = game;
    _audio = audio;

    registerSkill({
        id: SKILL_ID,
        icon: '❄',
        title: '❄ 冻结 — 选一行本局不被消除（消耗 1 个）',
        kind: 'freezeToken',
        onClick: () => _toggleAim(),
        enabled: () => _isUsable(),
    });

    _installGridListener();
    _installCheckLinesDecorator();
    _installEndGameReset();
}

function _isUsable() {
    if (!_game) return false;
    if (_game.isAnimating || _game.isGameOver || _game.replayPlaybackLocked || _game.rlPreviewLocked) return false;
    if (_game._frozenRow !== undefined && _game._frozenRow !== null) return false;   // 本局已冻
    return true;
}

function _toggleAim() {
    if (!_isUsable()) {
        if (_game && _game._frozenRow != null) _showToast(t('skill.freeze.usedThisRun'));
        else _showToast(t('skill.freeze.unavailable'));
        return;
    }
    const wallet = getWallet();
    if (wallet.getBalance('freezeToken') <= 0) {
        _showToast(t('skill.freeze.empty'));
        return;
    }
    if (isAiming(SKILL_ID)) {
        exitAim(SKILL_ID);
        refreshSkillBar();
        return;
    }
    enterAim(SKILL_ID, { onCancel: () => refreshSkillBar() });
    _showToast(t('skill.freeze.aim'));
    refreshSkillBar();
}

function _installGridListener() {
    if (_gridListenerInstalled) return;
    if (typeof document === 'undefined') return;
    const gridEl = document.getElementById('game-grid');
    if (!gridEl) return;
    _gridListenerInstalled = true;

    const handler = (e) => {
        if (!isAiming(SKILL_ID)) return;
        const rect = gridEl.getBoundingClientRect();
        const y = (e.clientY || e.touches?.[0]?.clientY || 0) - rect.top;
        const cellSize = _game.renderer?.cellSize || 40;
        const row = Math.floor(y / cellSize);
        if (row < 0 || row >= (_game.grid?.cells?.length || 0)) return;
        e.preventDefault();
        e.stopPropagation();
        _doFreeze(row);
        exitAim(SKILL_ID);
        refreshSkillBar();
    };
    gridEl.addEventListener('mousedown', handler, { capture: true });
    gridEl.addEventListener('touchstart', handler, { capture: true, passive: false });
}

function _doFreeze(row) {
    const wallet = getWallet();
    if (!wallet.spend('freezeToken', 1, 'freeze')) {
        _showToast(t('skill.freeze.payFail'));
        return;
    }
    _game._frozenRow = row;
    _audio?.play?.('tick');
    _game.markDirty?.();
    _showToast(t('skill.freeze.ok', { row: row + 1 }));
}

/* 装饰 grid.checkLines：从返回结果里剔除被冻结的行 */
let _checkLinesDecoratorInstalled = false;
function _installCheckLinesDecorator() {
    if (_checkLinesDecoratorInstalled) return;
    if (!_game?.grid?.checkLines) return;
    _checkLinesDecoratorInstalled = true;
    const grid = _game.grid;
    const orig = grid.checkLines.bind(grid);
    grid.checkLines = (...args) => {
        const result = orig(...args);
        if (_game._frozenRow == null) return result;
        if (Array.isArray(result?.rows)) {
            result.rows = result.rows.filter(r => r !== _game._frozenRow);
        }
        return result;
    };
}

let _endGameDecoratorInstalled = false;
function _installEndGameReset() {
    if (_endGameDecoratorInstalled || !_game) return;
    _endGameDecoratorInstalled = true;
    const orig = _game.endGame.bind(_game);
    _game.endGame = async (...args) => {
        const r = await orig(...args);
        _game._frozenRow = null;
        return r;
    };
    const origStart = _game.start.bind(_game);
    _game.start = async (...args) => {
        const r = await origStart(...args);
        _game._frozenRow = null;
        return r;
    };
}

function _showToast(msg) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    delete el.dataset.tier;
    el.textContent = msg;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 2800);
}

/** 测试用 */
export function __resetForTest() {
    _game = null; _audio = null;
    _gridListenerInstalled = false;
    _checkLinesDecoratorInstalled = false;
    _endGameDecoratorInstalled = false;
}
export function __initForTest(game, audio = null) { _game = game; _audio = audio; }
export function __doFreezeForTest(row) { _doFreeze(row); }
