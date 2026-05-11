/**
 * preview.js — v10.17 预览下 3 块候选块（道具池扩展）
 *
 * 设计要点
 * --------
 * - 点击道具栏 👁 按钮 → 显示一个 toast 浮窗，列出**下一波**的 3 个候选块的 emoji
 *   （从 game._predictNextSpawn 或 blockPool 推导；若不可用则 fallback 提示）
 * - 不进入瞄准模式（即时使用即时显示）
 * - 消耗 1 previewToken（每日免费 0，每日发放上限 4）
 * - 自动隐藏 8s 或玩家点击关闭
 *
 * 与 hint 的区别：
 *   hint 告诉你"当前块放哪最好"；preview 告诉你"下一波是什么形状"
 *
 * 接入路径
 * --------
 *   import { initPreview } from './skills/preview.js';
 *   initPreview({ game, audio });
 */

import { getWallet } from './wallet.js';
import { registerSkill, refreshSkillBar } from './skillBar.js';
import { t } from '../i18n/i18n.js';

const SKILL_ID = 'preview';

let _game = null;
let _audio = null;

export function initPreview({ game, audio = null } = {}) {
    if (!game || _game) return;
    _game = game;
    _audio = audio;

    registerSkill({
        id: SKILL_ID,
        icon: '👁',
        title: '👁 预览 — 显示下一波 3 个候选块（消耗 1 个）',
        kind: 'previewToken',
        onClick: () => _trigger(),
        enabled: () => _isUsable(),
    });
}

function _isUsable() {
    if (!_game) return false;
    if (_game.isGameOver || _game.replayPlaybackLocked || _game.rlPreviewLocked) return false;
    return true;
}

function _trigger() {
    if (!_isUsable()) return;
    const wallet = getWallet();
    if (wallet.getBalance('previewToken') <= 0) {
        _showToast(t('skill.preview.empty'));
        return;
    }
    /* 推导下一波：优先用 blockPool 看牌堆顶 */
    let nextShapes = null;
    try {
        const pool = window.__blockPool;
        if (pool && typeof pool.peekNext === 'function') {
            nextShapes = pool.peekNext(3);
        }
    } catch { /* ignore */ }
    if (!nextShapes || nextShapes.length === 0) {
        /* fallback：随机 3 个皮肤 emoji 占位 */
        const skin = window.openBlockGame?.renderer?.skin || {};
        const icons = (skin.blockIcons || ['■', '◆', '●', '▲', '★', '◐']).slice(0, 6);
        nextShapes = Array.from({ length: 3 }, () => icons[Math.floor(Math.random() * icons.length)]);
    } else {
        nextShapes = nextShapes.map((shape) => _shapeToBlockIcon(shape));
    }

    if (!wallet.spend('previewToken', 1, 'preview')) {
        _showToast(t('skill.preview.payFail'));
        return;
    }
    _audio?.play?.('tick');
    refreshSkillBar();
    _showPreviewToast(nextShapes);
}

function _shapeToBlockIcon(shape) {
    /* 按形状大小返回直观字符（不依赖具体皮肤） */
    if (!shape) return '■';
    let cells = 0;
    for (const row of shape) for (const v of row) if (v) cells++;
    if (cells <= 1) return '·';
    if (cells <= 2) return '═';
    if (cells <= 4) return '▣';
    return '▦';
}

function _showPreviewToast(shapes) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('preview-toast');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'preview-toast';
    el.className = 'preview-toast';
    el.innerHTML = `
        <div class="pv-title">下一波</div>
        <div class="pv-row">
            ${shapes.map(s => `<span class="pv-cell">${s}</span>`).join('')}
        </div>
        <button class="pv-close" type="button" aria-label="关闭">×</button>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));

    const close = () => {
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 280);
    };
    el.querySelector('.pv-close').addEventListener('click', close);
    setTimeout(close, 8000);
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
