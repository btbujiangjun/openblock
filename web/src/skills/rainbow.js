/**
 * rainbow.js — v10.16.1 彩虹清行道具（P1）
 *
 * 点击彩虹按钮进入"瞄准模式" → 在盘面任意行上点击 →
 * 该行所有空格被填上主色 + 已有方块染成主色，行立刻满 → checkLines 清除该行
 * 必触发 bonus 同色行（colorIdx=0），获得高分。
 *
 * 设计要点
 * --------
 * - **瞄准模式**：与 bomb 互斥（aimManager 统一管理）
 * - **染色 + 填空**：只染色不填空时行未必满，checkLines 不会清除 → 道具失效
 *   v10.16.1：填补空格让行立即满，必触发 bonus 同色行清除
 * - **得分**：调用 grid.checkLines() 自然走 bonus 同色行 + 加分
 * - **isAnimating / isGameOver / replay 时禁用**
 * - **失败回滚**：如果 checkLines 没清除（理论不可能），回滚 grid 并退还代币
 * - **退出条件**：成功执行 / ESC / 再次点击按钮 / 点击棋盘外
 */

import { getWallet } from './wallet.js';
import { registerSkill, refreshSkillBar } from './skillBar.js';
import { enterAim, exitAim, isAiming } from './aimManager.js';

const SKILL_ID = 'rainbow';

let _game = null;
let _audio = null;
let _clickListenerInstalled = false;

export function initRainbow({ game, audio = null } = {}) {
    if (!game || _game) return;
    _game = game;
    _audio = audio;

    registerSkill({
        id: SKILL_ID,
        icon: '🌈',
        title: '🌈 彩虹 — 把一行染成主色并填空触发清除（每次消耗 1 个）',
        kind: 'rainbowToken',
        onClick: () => _toggleAim(),
        enabled: () => _isUsable(),
    });

    _installAimListener();
}

function _isUsable() {
    if (!_game) return false;
    if (_game.isAnimating || _game.isGameOver || _game.replayPlaybackLocked || _game.rlPreviewLocked) return false;
    return true;
}

function _toggleAim() {
    if (!_isUsable()) {
        _showToast('🌈 当前不可使用彩虹');
        return;
    }
    const wallet = getWallet();
    if (wallet.getBalance('rainbowToken') <= 0) {
        _showToast('🌈 彩虹不足 — 完成任务或宝箱可获得');
        return;
    }
    if (isAiming(SKILL_ID)) {
        exitAim(SKILL_ID);
        refreshSkillBar();
        return;
    }
    enterAim(SKILL_ID, { onCancel: () => refreshSkillBar() });
    _showToast('🌈 点击盘面任意一行使用彩虹（ESC 取消）');
    refreshSkillBar();
}

function _installAimListener() {
    if (_clickListenerInstalled) return;
    const canvas = document.getElementById('game-grid');
    if (!canvas) return;
    _clickListenerInstalled = true;
    canvas.addEventListener('click', (e) => {
        if (!isAiming(SKILL_ID)) return;
        e.preventDefault();
        e.stopPropagation();
        const cell = _eventToCell(e, canvas);
        if (!cell) {
            exitAim(SKILL_ID);
            refreshSkillBar();
            return;
        }
        _paintRow(cell.y);
    }, { capture: true });
}

function _eventToCell(e, canvas) {
    if (!_game || !_game.renderer) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cs = _game.renderer.cellSize;
    if (!cs) return null;
    const gx = Math.floor(x / cs);
    const gy = Math.floor(y / cs);
    if (gx < 0 || gy < 0 || gx >= _game.grid.size || gy >= _game.grid.size) return null;
    return { x: gx, y: gy };
}

/**
 * 给指定行染色 + 填空，触发 checkLines 清除。
 * - 整行已满（不管什么颜色）：染主色后 checkLines 必清除并触发 bonus 同色行
 * - 整行非满但已有 ≥ MIN 块：填补空格 + 染主色，行变满，必触发 bonus 同色行
 * - 整行空：拒绝（道具应避免无意义消耗）
 */
export function _paintRow(rowY) {
    if (!_isUsable()) return false;
    if (!_game?.grid) return false;
    const size = _game.grid.size;
    if (rowY < 0 || rowY >= size) return false;

    const wallet = getWallet();
    if (wallet.getBalance('rainbowToken') <= 0) {
        _showToast('🌈 彩虹不足');
        exitAim(SKILL_ID);
        refreshSkillBar();
        return false;
    }

    const MIN_NON_EMPTY = 3;   // 至少 3 个已有方块才允许使用，避免无意义消耗
    let nonEmpty = 0;
    for (let x = 0; x < size; x++) {
        if (_game.grid.cells[rowY][x] !== null) nonEmpty++;
    }
    if (nonEmpty < MIN_NON_EMPTY) {
        _showToast(`🌈 该行方块过少（< ${MIN_NON_EMPTY}），换一行试试`);
        return false;
    }

    // 备份原 row（失败回滚用）
    const origRow = _game.grid.cells[rowY].slice();
    // 染色 + 填空：整行设为主色 0
    for (let x = 0; x < size; x++) {
        _game.grid.cells[rowY][x] = 0;
    }

    if (!wallet.spend('rainbowToken', 1, 'rainbow-skill')) {
        _game.grid.cells[rowY] = origRow;
        _showToast('⚠ 扣费失败，请重试');
        exitAim(SKILL_ID);
        refreshSkillBar();
        return false;
    }

    _audio?.play?.('bonus');
    _audio?.vibrate?.([20, 40, 20]);
    _game.renderer?.triggerBonusMatchFlash?.(2);
    _game.renderer?.setShake?.(8, 320);

    // 立刻调 checkLines（行已满，必清除 + 必触发 bonus 同色行 colorIdx=0）
    const result = _game.grid.checkLines?.();
    if (result && result.count > 0) {
        // 加分：复用现有 bonus 同色行加分公式（每行 80 分 × bonus 同色 ×2 = 160）
        // 这里给一个保守的固定加分，避免与 game 内部加分重复
        const baseGain = result.cells.length * 10;
        const bonusGain = (result.bonusLines?.length || 0) * 80;
        _game.score = (_game.score | 0) + baseGain + bonusGain;
        if (_game.gameStats) {
            _game.gameStats.score = _game.score;
            _game.gameStats.clears = (_game.gameStats.clears | 0) + result.count;
            _game.gameStats.rainbowClears = (_game.gameStats.rainbowClears | 0) + 1;
        }
        _game.renderer?.setClearCells?.(result.cells);
        if (result.bonusLines?.length) {
            _game.renderer?.triggerBonusMatchFlash?.(3);
        }
        _game.updateUI?.();
        _game.markDirty?.();

        setTimeout(() => {
            _game.renderer?.setClearCells?.([]);
            _game.markDirty?.();
        }, 380);
    } else {
        // 极端情况（不应发生）：grid 状态被外部并发改动
        console.warn('[rainbow] checkLines unexpectedly cleared 0 lines, rolling back');
        _game.grid.cells[rowY] = origRow;
        wallet.addBalance('rainbowToken', 1, 'rainbow-refund');
        _showToast('🌈 彩虹未生效，已退还');
        exitAim(SKILL_ID);
        refreshSkillBar();
        return false;
    }

    exitAim(SKILL_ID);
    refreshSkillBar();
    return true;
}

/** 测试用：注入 game / 重置安装态 */
export function __initForTest(game, audio = null) {
    _game = game;
    _audio = audio;
}
export function __resetForTest() {
    _game = null;
    _audio = null;
    _clickListenerInstalled = false;
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
    el.textContent = msg;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 2200);
}
