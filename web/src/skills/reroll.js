/**
 * reroll.js — v10.17 重摇候选块（道具池扩展）
 *
 * 设计要点
 * --------
 * - 点击道具栏 🎲 按钮 → 替换当前 dock 中所有未放置的候选块为新形状
 * - 等价于"调用一次 spawnBlocks 但保留已放置的块"
 * - 消耗 1 rerollToken（每日发放上限 3）
 * - 防呆：所有块都已放置时不可使用（提示"等待下一波再用"）
 *
 * 与 spawnBlocks 区别：
 *   spawnBlocks 是 dock 全部清空才生成；reroll 是中途强制刷新未用块
 *
 * 接入路径
 * --------
 *   import { initReroll } from './skills/reroll.js';
 *   initReroll({ game, audio });
 */

import { getWallet } from './wallet.js';
import { registerSkill, refreshSkillBar } from './skillBar.js';
import { t } from '../i18n/i18n.js';

const SKILL_ID = 'reroll';

let _game = null;
let _audio = null;

export function initReroll({ game, audio = null } = {}) {
    if (!game || _game) return;
    _game = game;
    _audio = audio;

    registerSkill({
        id: SKILL_ID,
        icon: '🎲',
        title: '🎲 重摇 — 替换当前所有未放置候选块（消耗 1 个）',
        kind: 'rerollToken',
        onClick: () => _trigger(),
        enabled: () => _isUsable(),
    });
}

function _isUsable() {
    if (!_game) return false;
    if (_game.isAnimating || _game.isGameOver || _game.replayPlaybackLocked || _game.rlPreviewLocked) return false;
    /* 至少有一个未放置块才能用 */
    const blocks = _game.dockBlocks || [];
    return blocks.some(b => b && !b.placed);
}

function _trigger() {
    if (!_isUsable()) {
        _showToast(t('skill.reroll.unavailable'));
        return;
    }
    const wallet = getWallet();
    if (wallet.getBalance('rerollToken') <= 0) {
        _showToast(t('skill.reroll.empty'));
        return;
    }

    /* 调用 game.spawnBlocks 重新生成（默认实现是只在全部 placed 后才生成；
     * 我们先把所有未放置的块标记为 placed 避免冲突，再调用 spawnBlocks
     * 让其重新生成全部 3 个槽位） */
    const blocks = _game.dockBlocks || [];
    const placedCount = blocks.filter(b => b && b.placed).length;
    if (placedCount === 0) {
        /* 全部未放置：直接重新 spawn 所有 3 个 */
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i]) blocks[i].placed = true;
        }
    } else {
        /* 已放置一部分：把剩下的也强标 placed，让 spawnBlocks 检测到全空 */
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i]) blocks[i].placed = true;
        }
    }

    /* 直接强制 spawnBlocks（即使 placedCount 不满 3 也能触发） */
    try {
        if (typeof _game.spawnBlocks === 'function') {
            _game.spawnBlocks();
        }
    } catch (e) {
        console.warn('[reroll] spawnBlocks failed', e);
        _showToast(t('skill.reroll.fail'));
        return;
    }

    if (!wallet.spend('rerollToken', 1, 'reroll')) {
        _showToast(t('skill.reroll.payFail'));
        return;
    }
    _audio?.play?.('tick');
    refreshSkillBar();
    _showToast(t('skill.reroll.ok'));
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
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 2400);
}

/** 测试用 */
export function __resetForTest() { _game = null; _audio = null; }
export function __initForTest(game, audio = null) { _game = game; _audio = audio; }
export function __triggerForTest() { _trigger(); }
