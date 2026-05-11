/**
 * bomb.js — v10.16.1 炸弹道具（P1）
 *
 * 点击炸弹按钮进入"瞄准模式"，在盘面任意格子上点击 → 清除 3×3 范围。
 * 消耗 1 bombToken（无每日免费 — 仅 IAP / 抽奖 / 任务获得）。
 *
 * 设计要点
 * --------
 * - **瞄准模式**：通过 aimManager 与 rainbow 互斥，ESC 取消
 * - **清除规则**：3×3 范围内所有非空格立即消除（不计入消行 bonus，但加分）
 * - **得分**：每个被清除的格子 = 5 分
 * - **闪光区分 bonus**：使用震屏 + combo 闪光（而非 bonus 闪光）避免误导玩家
 * - **空区返还**：3×3 范围内全为空格时退还代币
 * - **防御**：isAnimating / isGameOver / replayPlaybackLocked 时禁用
 * - **零侵入**：点击事件用 capture 截获，不破坏原有 mousedown 流程
 */

import { getWallet } from './wallet.js';
import { registerSkill, refreshSkillBar } from './skillBar.js';
import { enterAim, exitAim, isAiming } from './aimManager.js';
import { t } from '../i18n/i18n.js';

const SKILL_ID = 'bomb';

let _game = null;
let _audio = null;
let _clickListenerInstalled = false;

export function initBomb({ game, audio = null } = {}) {
    if (!game || _game) return;
    _game = game;
    _audio = audio;

    registerSkill({
        id: SKILL_ID,
        icon: '💣',
        title: '💣 炸弹 — 清除 3×3 范围（每次消耗 1 个）',
        kind: 'bombToken',
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
        _showToast(t('skill.bomb.unavailable'));
        return;
    }
    const wallet = getWallet();
    if (wallet.getBalance('bombToken') <= 0) {
        _showToast(t('skill.bomb.empty'));
        return;
    }
    if (isAiming(SKILL_ID)) {
        exitAim(SKILL_ID);
        refreshSkillBar();
        return;
    }
    enterAim(SKILL_ID, { onCancel: () => refreshSkillBar() });
    _showToast(t('skill.bomb.aim'));
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
        _explodeAt(cell.x, cell.y);
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
 * 在 (cx, cy) 引爆 3×3：清除所有非空格 + 加分。
 * @returns {boolean} 是否成功爆炸（false = 区域全空已退款 / 扣费失败）
 */
export function _explodeAt(cx, cy) {
    if (!_isUsable()) return false;
    if (!_game?.grid) return false;
    const size = _game.grid.size;
    if (cx < 0 || cx >= size || cy < 0 || cy >= size) return false;

    const wallet = getWallet();
    if (wallet.getBalance('bombToken') <= 0) {
        _showToast(t('skill.bomb.shortage'));
        exitAim(SKILL_ID);
        refreshSkillBar();
        return false;
    }

    // 先收集 3×3 范围内的非空格（不扣费！）
    const cells = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            if (_game.grid.cells[ny][nx] !== null) {
                cells.push({ x: nx, y: ny });
            }
        }
    }

    if (cells.length === 0) {
        // 全空区域不扣费
        _showToast(t('skill.bomb.emptyCell'));
        return false;
    }

    if (!wallet.spend('bombToken', 1, 'bomb-skill')) {
        _showToast(t('skill.bomb.payFail'));
        exitAim(SKILL_ID);
        refreshSkillBar();
        return false;
    }

    // 备份 cells 颜色用于设置 setClearCells（带颜色信息更利于闪光）
    const clearedCells = cells.map(c => ({
        x: c.x, y: c.y, color: _game.grid.cells[c.y][c.x],
    }));

    // 真正清除
    for (const c of cells) {
        _game.grid.cells[c.y][c.x] = null;
    }
    const gain = cells.length * 5;
    _game.score = (_game.score | 0) + gain;
    if (_game.gameStats) {
        _game.gameStats.score = _game.score;
        _game.gameStats.bombClears = (_game.gameStats.bombClears | 0) + 1;
        _game.gameStats.bombCellsCleared = (_game.gameStats.bombCellsCleared | 0) + cells.length;
    }

    _game.renderer?.setClearCells?.(clearedCells);
    // 用 combo 闪光 + 强震屏，区别于 bonus 闪光（避免玩家误以为消行）
    _game.renderer?.triggerComboFlash?.(Math.min(cells.length, 9));
    _game.renderer?.setShake?.(14, 520);
    _audio?.play?.('explosion') || _audio?.play?.('bonus');
    _audio?.vibrate?.([40, 30, 40]);

    _game.updateUI?.();
    _game.markDirty?.();
    exitAim(SKILL_ID);
    refreshSkillBar();

    setTimeout(() => {
        _game.renderer?.setClearCells?.([]);
        _game.markDirty?.();
    }, 380);
    return true;
}

/** 测试用：注入 game / 重置 */
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
