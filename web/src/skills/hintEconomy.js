/**
 * hintEconomy.js — v10.16.6 hint 经济闭环（Top P0 #1）
 *
 * 设计变更（v10.16.6）
 * --------------------
 * v10.16.1 把 hint 触发方式实现为「dock 块上长按 ≥ 380ms 自动扣费」，
 * 用户实测反馈"长按自动消耗道具不合理"——容易误触、且与其他三件道具
 * （bomb / rainbow / undo）走「按按钮 → 选目标」的方式不一致。
 *
 * v10.16.6 改为统一的「瞄准模式」：
 *   1. 点击道具栏 🎯 按钮 → 进入 hint 瞄准模式（aimManager 互斥 + ESC 取消）
 *   2. dock 内候选块出现脉动光晕（CSS 动画提示）
 *   3. 点击其中一块 → computeHints + 扣 1 hintToken + 显示 fxCanvas 高亮
 *   4. 自动退出瞄准模式
 *
 * 优点
 * ----
 * - 与 bomb / rainbow 视觉与交互一致（按按钮 → 选目标）
 * - 杜绝长按误触扣费
 * - aimManager 自动管理互斥（按 hint 时若 bomb / rainbow 在瞄准会先退出）
 * - 仍然符合「计算成功才扣费」原则（无可放位置时不扣）
 *
 * 钱包规则
 * --------
 * 每日免费 3 次（钱包内置）+ 任务 / 看广告 / IAP 充值。
 */

import { getWallet } from './wallet.js';
import { computeHints } from '../hintEngine.js';
import { registerSkill, refreshSkillBar } from './skillBar.js';
import { enterAim, exitAim, isAiming } from './aimManager.js';

const SKILL_ID = 'hint-quick';

let _game = null;
let _audio = null;
let _hintActive = null;     // { gx, gy, shape, color, ttl }
let _lastHintRenderHook = null;
let _aimListenerInstalled = false;

export function initHintEconomy({ game, audio = null } = {}) {
    if (!game) return;
    _game = game;
    _audio = audio;

    _installAimListener();
    _installRendererHook(game);

    registerSkill({
        id: SKILL_ID,
        icon: '🎯',
        title: '🎯 单块推荐 — 点击候选区方块查看最佳落点（每次消耗 1 提示券，每日免费 3 次）',
        kind: 'hintToken',
        onClick: () => _toggleAim(),
        enabled: () => _isUsable(),
    });
}

function _isUsable() {
    if (!_game) return false;
    if (_game.isAnimating || _game.isGameOver || _game.replayPlaybackLocked || _game.rlPreviewLocked) return false;
    return true;
}

function _toggleAim() {
    if (!_isUsable()) {
        _showToast('🎯 当前不可使用提示');
        return;
    }
    const wallet = getWallet();
    if (wallet.getBalance('hintToken') <= 0) {
        _showToast('🎯 提示券不足 — 完成每日任务可获得');
        return;
    }
    if (isAiming(SKILL_ID)) {
        exitAim(SKILL_ID);
        refreshSkillBar();
        return;
    }
    enterAim(SKILL_ID, { onCancel: () => refreshSkillBar() });
    _showToast('🎯 点击候选区任意一块查看最佳落点（ESC 取消）');
    refreshSkillBar();
}

/**
 * 监听 dock 内 mousedown / touchstart：
 * 仅在 hint 瞄准状态下截获事件触发 _triggerHint，并阻止冒泡到原拖拽流程
 */
function _installAimListener() {
    if (_aimListenerInstalled) return;
    const dock = document.getElementById('dock');
    if (!dock) return;
    _aimListenerInstalled = true;

    const handler = (e) => {
        if (!isAiming(SKILL_ID)) return;
        const blockEl = e.target.closest('.dock-block');
        if (!blockEl) return;
        const idx = parseInt(blockEl.dataset.index, 10);
        if (Number.isNaN(idx)) return;
        e.preventDefault();
        e.stopPropagation();
        _triggerHint(idx);
        exitAim(SKILL_ID);
        refreshSkillBar();
    };
    dock.addEventListener('mousedown', handler, { capture: true });
    dock.addEventListener('touchstart', handler, { capture: true, passive: false });
}

/**
 * 触发：根据指定块计算最佳落点，扣费，渲染高亮
 *
 * 重要：先 computeHints（无可放位置不扣费），再 spend
 */
function _triggerHint(blockIdx) {
    if (!_game || !_game.grid) return;
    const blocks = _game.dockBlocks || [];
    const block = blocks[blockIdx];
    if (!block || !block.shape || block.placed) return;

    const wallet = getWallet();
    if (wallet.getBalance('hintToken') <= 0) {
        _showToast('🎯 提示券不足 — 完成每日任务可获得');
        return;
    }

    let hints;
    try {
        hints = computeHints(_game.grid, [block], 1);
    } catch (e) {
        console.warn('[hint] computeHints failed', e);
        _showToast('⚠ 计算失败，请稍后再试');
        return;
    }
    if (!hints || hints.length === 0) {
        _showToast('🎯 当前无可放位置');
        return;
    }

    if (!wallet.spend('hintToken', 1, 'hint-quick')) {
        _showToast('⚠ 扣费失败，请重试');
        return;
    }

    const top = hints[0];
    _hintActive = {
        gx: top.gx,
        gy: top.gy,
        shape: block.shape,
        color: block.colorIdx,
        ttl: performance.now() + 4500,
    };
    _audio?.play?.('tick');
    refreshSkillBar();
    _game.markDirty?.();
}

function _hideHint() {
    if (_hintActive) {
        _hintActive = null;
        _game?.markDirty?.();
    }
}

/* -----------------------------------------------------------
 * 渲染：装饰 renderer.renderAmbient 在其后追加 hint 高亮
 * --------------------------------------------------------- */
function _installRendererHook(game) {
    const r = game.renderer;
    if (!r || _lastHintRenderHook) return;
    if (typeof r.renderAmbient !== 'function') return;
    const orig = r.renderAmbient.bind(r);
    _lastHintRenderHook = orig;
    r.renderAmbient = function () {
        orig();
        _drawHintOverlay(r);
    };
    // 拖拽真正启动时隐藏 hint（避免推荐高亮干扰落子动作）
    if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
        const obs = new MutationObserver(() => {
            if (document.body.classList.contains('block-drag-active')) {
                _hideHint();
            }
        });
        obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
}

function _drawHintOverlay(r) {
    if (!_hintActive || !r.fxCtx) return;
    if (performance.now() > _hintActive.ttl) {
        _hintActive = null;
        return;
    }
    const cs = r.cellSize;
    const ctx = r.fxCtx;
    ctx.save();
    const phase = (performance.now() / 350) % 1;
    const alpha = 0.30 + 0.20 * Math.sin(phase * Math.PI * 2);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#FFD160';
    ctx.strokeStyle = '#FFA000';
    ctx.lineWidth = 2.5;
    const sh = _hintActive.shape;
    const gx = _hintActive.gx;
    const gy = _hintActive.gy;
    for (let y = 0; y < sh.length; y++) {
        for (let x = 0; x < sh[y].length; x++) {
            if (sh[y][x]) {
                const px = (gx + x) * cs + 2;
                const py = (gy + y) * cs + 2;
                ctx.fillRect(px, py, cs - 4, cs - 4);
                ctx.strokeRect(px, py, cs - 4, cs - 4);
            }
        }
    }
    ctx.restore();
}

/** 测试用：直接触发 _triggerHint */
export function __triggerHintForTest(blockIdx) { _triggerHint(blockIdx); }
export function __getHintForTest() { return _hintActive; }
export function __resetForTest() {
    _game = null;
    _audio = null;
    _hintActive = null;
    _lastHintRenderHook = null;
    _aimListenerInstalled = false;
}
export function __initForTest(game, audio = null) {
    _game = game;
    _audio = audio;
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
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 3000);
}
