/**
 * undo.js — v10.16.1 撤销一步（Top P0 #2）
 *
 * 装饰 game.onEnd 在落子成功后保存 snapshot（grid + dock + score + stats），
 * 调 undoOnce() 时还原。每日免费 3 次（钱包内置），看广告 / IAP 充值。
 *
 * 设计要点
 * --------
 * - **单步撤销**：仅保留最近 1 步 snapshot（多步撤销会破坏关卡公平性）
 * - **关卡模式禁用**：`game._levelMode === 'level'` 时不允许撤销（防作弊）
 * - **回放/动画期间禁用**：`isAnimating` / `replayPlaybackLocked` 时锁住按钮
 * - **dispatch 后失效**：snapshot 在新一轮 spawn / endGame / start 后失效
 * - **DOM 强制重建**：用 `populateDockUI(descriptors)` 完整重建 dock canvas
 *   （仅替换 `this.dockBlocks` 不会重画 dock canvas，会出现"候选块消失"）
 *
 * v10.16.1 修复
 * -----------
 * 1. _cloneDock 现在保存完整 descriptor（id / shape / colorIdx / placed）；
 * 2. 还原使用 `populateDockUI(descriptors, { logSpawn: false })` 强制重建 DOM；
 * 3. 关卡模式判定改为 `_levelMode === 'level'` 与 `!!_levelManager`；
 * 4. updateScoreUI → updateUI；
 * 5. snapshot 失效时机：endGame / start / spawnBlocks（被动失效）。
 */

import { getWallet } from './wallet.js';
import { registerSkill, refreshSkillBar } from './skillBar.js';

let _game = null;
let _audio = null;
let _snapshot = null;
let _origOnEnd = null;
let _origStart = null;
let _origEndGame = null;
let _origSpawnBlocks = null;

export function initUndo({ game, audio = null } = {}) {
    if (!game || _origOnEnd) return;
    _game = game;
    _audio = audio;

    _origOnEnd = game.onEnd.bind(game);
    game.onEnd = _wrappedOnEnd;

    _origStart = game.start.bind(game);
    game.start = async (...args) => {
        _snapshot = null;
        const r = await _origStart(...args);
        refreshSkillBar();
        return r;
    };

    _origEndGame = game.endGame.bind(game);
    game.endGame = async (...args) => {
        _snapshot = null;
        const r = await _origEndGame(...args);
        refreshSkillBar();
        return r;
    };

    // 新一轮 spawn（dock 全部用完→新 3 块）后，旧 snapshot 已经无意义
    _origSpawnBlocks = game.spawnBlocks.bind(game);
    game.spawnBlocks = (...args) => {
        // 注意：onEnd 内部会调 spawnBlocks（如果 dock 全 placed）
        // 所以"先存 snapshot 再触发 spawn"是必经路径，这里失效是 spawn **之后**
        // 即 snapshot 存在 ts 字段，新 spawn 后立刻失效（保留最近 1 步语义）
        const r = _origSpawnBlocks(...args);
        // 标记：当前 dock 已是新一轮，旧 snapshot 不能用于还原（dock 会回到旧块也错了）
        // 但 onEnd 中我们已经保存了 dock 旧值；如果 onEnd 触发了 spawn，
        // snapshot.dock 仍是 onEnd 之前的旧 dock —— 这正是我们想要还原的！
        // 因此这里 NOT clearing snapshot.
        return r;
    };

    registerSkill({
        id: 'undo',
        icon: '↩',
        title: '↩ 撤销 — 还原最近一次落子（每日免费 3 次）',
        kind: 'undoToken',
        onClick: () => undoOnce(),
        enabled: () => canUndo(),
    });

    if (typeof window !== 'undefined') {
        window.__undoSkill = { undoOnce, canUndo, getSnapshot: () => _snapshot };
    }
}

function _wrappedOnEnd() {
    if (!_game) return _origOnEnd();
    // 关卡模式禁用 undo（防作弊）
    if (_isLevelMode() || _game.isAnimating || _game.isGameOver || _game.replayPlaybackLocked) {
        return _origOnEnd();
    }
    // 仅在确实落子时保存 snapshot
    const fillBefore = _game.grid.getFillRatio?.() ?? 0;
    const placementsBefore = _game.gameStats?.placements | 0;
    const scoreBefore = _game.score | 0;
    const dockSnap = _cloneDock(_game.dockBlocks || []);
    const gridSnap = _game.grid?.toJSON ? _game.grid.toJSON() : null;
    const statsSnap = _game.gameStats ? { ..._game.gameStats } : null;

    const ret = _origOnEnd();

    const fillAfter = _game.grid?.getFillRatio?.() ?? 0;
    const placementsAfter = _game.gameStats?.placements | 0;
    // 任何一种"确实落子了"的信号都算成功
    const placedNow = placementsAfter > placementsBefore || fillAfter !== fillBefore;
    if (placedNow && gridSnap) {
        _snapshot = {
            gridJSON: gridSnap,
            dockDescriptors: dockSnap,
            score: scoreBefore,
            stats: statsSnap,
            ts: Date.now(),
        };
        refreshSkillBar();
    }
    return ret;
}

/**
 * 把 dockBlocks 转成 populateDockUI 接受的 descriptor 数组
 * descriptor 字段: { id, shape, colorIdx, placed }
 */
function _cloneDock(dock) {
    if (!Array.isArray(dock)) return [];
    return dock.map(b => {
        if (!b) return null;
        return {
            id: b.id,
            shape: Array.isArray(b.shape) ? b.shape.map(row => Array.isArray(row) ? row.slice() : row) : null,
            colorIdx: b.colorIdx,
            placed: !!b.placed,
        };
    });
}

function _isLevelMode() {
    if (!_game) return false;
    return _game._levelMode === 'level' || !!_game._levelManager;
}

export function canUndo() {
    if (!_game || !_snapshot) return false;
    if (_isLevelMode()) return false;
    if (_game.isAnimating || _game.isGameOver || _game.replayPlaybackLocked) return false;
    return getWallet().getBalance('undoToken') > 0;
}

export function undoOnce() {
    if (!canUndo()) {
        _showToast('↩ 暂无可撤销的步骤');
        return false;
    }
    const wallet = getWallet();
    if (!wallet.spend('undoToken', 1, 'undo-skill')) {
        _showToast('⚠ 扣费失败，请重试');
        return false;
    }

    const s = _snapshot;
    _snapshot = null;

    try {
        // 1. 还原 grid
        if (s.gridJSON && _game.grid?.fromJSON) {
            _game.grid.fromJSON(s.gridJSON);
        }
        // 2. 还原分数 + 关键 stats
        _game.score = s.score | 0;
        if (s.stats && _game.gameStats) {
            Object.assign(_game.gameStats, s.stats);
        }
        // 3. 还原 dock：必须用 populateDockUI 完整重建 DOM 与 canvas
        //    （直接替换 dockBlocks 不会重画 dock canvas，会出现"候选块消失/错乱"）
        if (Array.isArray(s.dockDescriptors) && s.dockDescriptors.length > 0 && _game.populateDockUI) {
            _game.populateDockUI(s.dockDescriptors, { logSpawn: false });
        }
        // 4. 清掉拖拽 / 预览中残留状态
        _game.drag = null;
        _game.dragBlock = null;
        _game.previewPos = null;
        _game.previewBlock = null;
        if (typeof document !== 'undefined') {
            document.body.classList.remove('block-drag-active');
        }
        if (_game.ghostCanvas) {
            _game.ghostCanvas.style.display = 'none';
        }
        _game._resetGhostDomStyles?.();
        // 5. 清掉特效层与待消除高亮
        _game.renderer?.clearParticles?.();
        _game.renderer?.setClearCells?.([]);
        // 6. 重绘 + UI
        _game.updateUI?.();
        _game.markDirty?.();
    } catch (e) {
        console.warn('[undo] restore failed', e);
        _showToast('⚠ 撤销失败，请重试');
        // 失败时尝试退还代币
        wallet.addBalance('undoToken', 1, 'undo-refund');
        refreshSkillBar();
        return false;
    }

    _audio?.play?.('tick');
    _audio?.vibrate?.(20);
    refreshSkillBar();
    _showToast('↩ 已撤销最近一步');
    return true;
}

/** 测试用：清掉 snapshot */
export function __clearSnapshotForTest() { _snapshot = null; }

/** 测试用：直接注入 snapshot（绕过 onEnd 装饰） */
export function __setSnapshotForTest(snap) { _snapshot = snap; }

/** 测试用：取出当前 snapshot（深引用） */
export function __getSnapshotForTest() { return _snapshot; }

/** 测试用：重置模块级状态（让多次 initUndo 在不同 game 上生效） */
export function __resetForTest() {
    _game = null;
    _audio = null;
    _snapshot = null;
    _origOnEnd = null;
    _origStart = null;
    _origEndGame = null;
    _origSpawnBlocks = null;
    if (typeof window !== 'undefined') {
        delete window.__undoSkill;
    }
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
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 2400);
}
