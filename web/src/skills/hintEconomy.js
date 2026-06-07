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

/* v10.16.7：暴露给 game.js startDrag 直接探测的"是否处于 hint 瞄准模式 + 触发"接口。
 *
 * 为什么不能只依赖 dock 上的 capture 监听？
 *   - `game.js` 在支持 PointerEvent 的浏览器/触屏上把 startDrag 注册成
 *     **dock-block 子元素 canvas 的 `pointerdown` listener**。
 *   - 现实中事件传播顺序受到 PointerCapture / passive listener / Capacitor
 *     WebView 等因素干扰，dock 上的 capture pointerdown 偶发性"晚于" canvas
 *     上的 pointerdown 直接触发，导致 startDrag 抢先执行，候选区随即进入
 *     拖拽态（canvas 透明度 0.3，body.block-drag-active），随后晚到的 capture
 *     处理器又 exitAim + block-drag-active 立刻隐藏高亮，外观上表现为
 *     「点击候选块没推荐、反而失去激活」。
 *   - 把判定逻辑下沉到 startDrag 入口，是釜底抽薪的写法：startDrag 看到
 *     正在 hint 瞄准就转交给 hintEconomy 处理，不再启动拖拽。
 */
export function isHintAiming() {
    return isAiming(SKILL_ID);
}

export function consumeHintAimAt(blockIdx) {
    if (!isAiming(SKILL_ID)) return false;
    _triggerHint(blockIdx);
    exitAim(SKILL_ID);
    refreshSkillBar();
    return true;
}

let _game = null;
let _audio = null;
let _hintActive = null;     // { gx, gy, shape, color, ttl }
let _lastHintRenderHook = null;
let _aimListenerInstalled = false;
let _hintRaf = null;        // 高亮期间自驱动的 rAF，维持脉动动画 + TTL 检查

export function initHintEconomy({ game, audio = null } = {}) {
    if (!game) return;
    _game = game;
    _audio = audio;

    _installAimListener();
    _installRendererHook(game);

    /* v10.16.7：暴露到 window，供 game.js 的 startDrag 探测瞄准状态并截留点击。
     * 避免 game.js 反向 import hintEconomy 造成循环依赖。 */
    if (typeof window !== 'undefined') {
        window.__hintEconomy = { isHintAiming, consumeHintAimAt };
    }

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
 * 监听 dock 内 pointerdown / mousedown / touchstart：
 * 仅在 hint 瞄准状态下截获事件触发 _triggerHint，并阻止冒泡到原拖拽流程。
 *
 * 重要：game.js 中候选块 canvas 在支持 PointerEvent 时用 pointerdown 启动拖拽，
 * 因此 hint 必须同样在 capture 阶段截获 pointerdown，否则 pointerdown 已经触发
 * startDrag，紧接着的 block-drag-active 又会立刻把 _hintActive 隐藏，体验上
 * 表现为「瞄准模式下点击候选块没反应」。
 *
 * 同时保留 mousedown / touchstart 监听以兼容老浏览器（无 PointerEvent 时
 * game.js 回退到这两类事件）以及测试环境（jsdom 默认不派发 pointerdown）。
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
        if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
        }
        _triggerHint(idx);
        exitAim(SKILL_ID);
        refreshSkillBar();
    };
    dock.addEventListener('pointerdown', handler, { capture: true });
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
    _startHintLoop();
}

/**
 * 高亮期间自驱动一个 rAF 循环：
 *  - 维持 fxCanvas 可见（renderer._externalFxActive 标志）
 *  - 每帧 markDirty 让 render() 重跑，hint 脉动动画才会动、TTL 才会被检查
 *  - 盘面本身静止时也不会卡住高亮（不依赖环境粒子/拖拽等其它重绘驱动）
 */
function _startHintLoop() {
    if (!_game) return;
    if (_game.renderer) _game.renderer._externalFxActive = true;
    _game.markDirty?.();
    if (_hintRaf != null || typeof requestAnimationFrame !== 'function') return;
    const tick = () => {
        _hintRaf = null;
        if (!_hintActive) return;
        if (performance.now() > _hintActive.ttl) {
            _hideHint();
            return;
        }
        _game?.markDirty?.();
        _hintRaf = requestAnimationFrame(tick);
    };
    _hintRaf = requestAnimationFrame(tick);
}

function _hideHint() {
    if (_hintRaf != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(_hintRaf);
    }
    _hintRaf = null;
    const had = !!_hintActive;
    _hintActive = null;
    if (_game?.renderer) _game.renderer._externalFxActive = false;
    if (had) _game?.markDirty?.();
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
    /* TTL 到期的清理交给 _startHintLoop 的 rAF（统一收口标志位 / 循环），
     * 这里仅在过期时跳过绘制，避免在 render() 过程中改状态引发副作用。 */
    if (performance.now() > _hintActive.ttl) return;
    const cs = r.cellSize;
    const ctx = r.fxCtx;
    const sh = _hintActive.shape;
    const gx = _hintActive.gx;
    const gy = _hintActive.gy;
    const pad = Math.max(2, Math.round(cs * 0.08));
    const radius = Math.max(3, Math.round(cs * 0.18));
    const phase = (performance.now() / 600) % 1;
    const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);   // 0..1

    const roundRect = (x, y, w, h, rad) => {
        const rr = Math.min(rad, w / 2, h / 2);
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, rr);
            return;
        }
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    };

    const cells = [];
    for (let y = 0; y < sh.length; y++) {
        for (let x = 0; x < (sh[y] ? sh[y].length : 0); x++) {
            if (sh[y][x]) {
                cells.push({
                    px: (gx + x) * cs + pad,
                    py: (gy + y) * cs + pad,
                    w: cs - pad * 2,
                    h: cs - pad * 2,
                });
            }
        }
    }
    if (!cells.length) return;

    ctx.save();

    /* 1) 外发光底：脉动的金色光晕，强对比兜底——任何皮肤背景下都能跳出来 */
    ctx.save();
    ctx.shadowColor = '#FFC107';
    ctx.shadowBlur = (cs * 0.55) * (0.6 + 0.4 * pulse);
    ctx.fillStyle = `rgba(255, 193, 7, ${0.85})`;
    for (const c of cells) {
        roundRect(c.px, c.py, c.w, c.h, radius);
        ctx.fill();
    }
    ctx.restore();

    /* 2) 实心金色填充（近不透明，确保肉眼可见，不再依赖弱 alpha） */
    ctx.globalAlpha = 0.62 + 0.20 * pulse;   // 0.62..0.82
    ctx.fillStyle = '#FFD54A';
    for (const c of cells) {
        roundRect(c.px, c.py, c.w, c.h, radius);
        ctx.fill();
    }

    /* 3) 双层描边：深色外缘 + 高亮内缘，强化与背景的边界 */
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(120, 72, 0, 0.95)';
    ctx.lineWidth = Math.max(3, cs * 0.10);
    for (const c of cells) {
        roundRect(c.px, c.py, c.w, c.h, radius);
        ctx.stroke();
    }
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.75 + 0.25 * pulse})`;
    ctx.lineWidth = Math.max(1.5, cs * 0.045);
    for (const c of cells) {
        roundRect(c.px, c.py, c.w, c.h, radius);
        ctx.stroke();
    }

    ctx.restore();
}

/** 测试用：直接触发 _triggerHint */
export function __triggerHintForTest(blockIdx) { _triggerHint(blockIdx); }
export function __getHintForTest() { return _hintActive; }
export function __resetForTest() {
    if (_hintRaf != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(_hintRaf);
    }
    _hintRaf = null;
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
