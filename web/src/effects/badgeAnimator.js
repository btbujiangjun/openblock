/**
 * badgeAnimator.js — 通用数字徽章变化动效
 *
 * 适用场景：技能道具 / 钱包余额 / 任务进度 / 任意"小数字"在变化时的强化反馈，
 * 让玩家清楚感知到「我刚获得（或消耗）了 N 个 X」。
 *
 * 反馈层级
 * --------
 *   1) **count-up / count-down**：从旧值缓动到新值（easeOutExpo），不再是瞬间跳变
 *   2) **pulse 脉冲**：增益时 scale 1 → 1.35 → 1（亮+暖）；减益时 1 → 0.78 → 1（轻沉）
 *   3) **飘字 +N**：仅"入账"类增益（宝箱、任务奖励、广告收益等）从徽章上方飘起
 *
 * 设计原则
 * --------
 *   - **零依赖**：仅 DOM + RAF；样式按需注入一份全局 stylesheet（id 去重）
 *   - **幂等可重入**：同一元素再次触发会取消未完成动画，从当前显示值接力
 *   - **可降级**：无 document / requestAnimationFrame 环境（SSR / 旧测试）直接 setText
 *   - **首次显示静默**：通过 `floatPlus: false` 让宿主控制初始化不喷 +N
 *
 * API
 * ---
 *   animateBadgeChange(el, newVal, options?)
 *
 *   options.oldVal     起始值；省略时从 el.textContent 推断（'99+' → 99）
 *   options.duration   动画时长 ms，默认 600
 *   options.formatter  (n) => string，默认 99+ 截断
 *   options.floatPlus  仅在增益时弹 "+N"；默认 true（上层可在 hydrate / 首次显示时关掉）
 *   options.tone       'auto' | 'gain' | 'drain' | 'none'；默认 auto（按 newVal vs oldVal 决定）
 */

const _animations = typeof WeakMap === 'function' ? new WeakMap() : null;

function _easeOutExpo(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function _defaultFormatter(n) {
    const v = Math.max(0, Math.round(n));
    return v > 99 ? '99+' : String(v);
}

function _readDomValue(el) {
    if (!el) return 0;
    const txt = String(el.textContent || '').trim();
    if (!txt) return 0;
    if (/^99\+$/.test(txt)) return 99;
    const n = Number(txt.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
}

function _cancelExisting(el) {
    if (!_animations || !_animations.has(el)) return;
    const id = _animations.get(el);
    if (id != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(id);
    }
    _animations.delete(el);
}

function _resolveTone(oldVal, newVal, requested) {
    if (requested && requested !== 'auto') return requested;
    if (newVal > oldVal) return 'gain';
    if (newVal < oldVal) return 'drain';
    return 'none';
}

function _applyPulse(el, tone) {
    if (!el || !el.classList) return;
    if (tone !== 'gain' && tone !== 'drain') return;
    const cls = tone === 'gain' ? 'badge-pop-up' : 'badge-pop-down';
    el.classList.remove('badge-pop-up', 'badge-pop-down');
    // 强制重排让动画从头播放
    void el.offsetWidth;
    el.classList.add(cls);
    if (typeof setTimeout === 'function') {
        setTimeout(() => { el.classList.remove(cls); }, 700);
    }
}

function _spawnFloatPlus(anchor, delta) {
    if (typeof document === 'undefined' || !anchor) return;
    if (!(delta > 0)) return;
    const rect = (anchor.getBoundingClientRect && anchor.getBoundingClientRect()) || null;
    const float = document.createElement('div');
    float.className = 'badge-float-plus';
    float.textContent = `+${delta > 99 ? '99+' : delta}`;
    // jsdom 中 rect.width/height 总为 0，但仍允许浮字挂入文档（便于测试观察）；
    // 浏览器中正常按真实 rect 中心定位
    const left = rect ? rect.left + rect.width / 2 : 0;
    const top = rect ? rect.top + rect.height / 2 : 0;
    float.style.left = `${left}px`;
    float.style.top = `${top}px`;
    document.body.appendChild(float);
    if (typeof setTimeout === 'function') {
        setTimeout(() => { try { float.remove(); } catch { /* ignore */ } }, 950);
    }
}

/**
 * 触发徽章数字变化动效
 * @param {HTMLElement|null} el          目标 DOM（一般是 .skill-btn__count 之类的小标签）
 * @param {number} newVal                新值
 * @param {object} [options]
 * @param {number} [options.oldVal]      起始值（缺省从 textContent 推断）
 * @param {number} [options.duration]    动画时长 ms（默认 600）
 * @param {(n:number)=>string} [options.formatter]
 * @param {boolean} [options.floatPlus]  增益时是否飘 +N（默认 true）
 * @param {'auto'|'gain'|'drain'|'none'} [options.tone]
 * @returns {{cancel:()=>void}|null}
 */
export function animateBadgeChange(el, newVal, options = {}) {
    if (!el) return null;
    const fmt = typeof options.formatter === 'function' ? options.formatter : _defaultFormatter;
    const target = Number.isFinite(Number(newVal)) ? Math.max(0, Number(newVal)) : 0;
    const oldVal = Number.isFinite(Number(options.oldVal))
        ? Math.max(0, Number(options.oldVal))
        : _readDomValue(el);

    const tone = _resolveTone(oldVal, target, options.tone);

    // 无变化：直接落值（保持显示与状态一致），不做特效
    if (oldVal === target) {
        el.textContent = fmt(target);
        return null;
    }

    _cancelExisting(el);
    _applyPulse(el, tone);
    if (tone === 'gain' && options.floatPlus !== false) {
        _spawnFloatPlus(el, target - oldVal);
    }

    const duration = Math.max(120, Number(options.duration) || 600);
    const hasRaf = typeof requestAnimationFrame === 'function' && typeof performance !== 'undefined';
    if (!hasRaf) {
        el.textContent = fmt(target);
        return null;
    }

    const t0 = performance.now();
    const handle = { cancelled: false };

    function _step(now) {
        if (handle.cancelled) return;
        const t = Math.min(1, (now - t0) / duration);
        const eased = _easeOutExpo(t);
        const v = oldVal + (target - oldVal) * eased;
        el.textContent = fmt(v);
        if (t < 1) {
            const id = requestAnimationFrame(_step);
            if (_animations) _animations.set(el, id);
        } else {
            el.textContent = fmt(target);
            if (_animations) _animations.delete(el);
        }
    }

    const id = requestAnimationFrame(_step);
    if (_animations) _animations.set(el, id);

    return {
        cancel() {
            handle.cancelled = true;
            _cancelExisting(el);
            el.textContent = fmt(target);
        },
    };
}

/**
 * 立即落值（无动画），常用于初次渲染或 hydrate 场景。
 */
export function setBadgeImmediate(el, value, formatter) {
    if (!el) return;
    _cancelExisting(el);
    const fmt = typeof formatter === 'function' ? formatter : _defaultFormatter;
    el.textContent = fmt(value);
}

/**
 * 注入一次全局 keyframes / class。
 * 浏览器侧首次 import 即调用；测试 / SSR 环境无 document 时跳过。
 */
function _injectStyles() {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.getElementById('badge-animator-styles')) return;
    const style = document.createElement('style');
    style.id = 'badge-animator-styles';
    style.textContent = `
        @keyframes badgePopUp {
            0%   { transform: scale(1);    filter: brightness(1) saturate(1); }
            38%  { transform: scale(1.38); filter: brightness(1.45) saturate(1.35); }
            70%  { transform: scale(0.96); filter: brightness(1.1)  saturate(1.1); }
            100% { transform: scale(1);    filter: brightness(1)    saturate(1); }
        }
        @keyframes badgePopDown {
            0%   { transform: scale(1); filter: brightness(1); }
            42%  { transform: scale(0.78); filter: brightness(0.85); }
            100% { transform: scale(1); filter: brightness(1); }
        }
        @keyframes badgeFloatPlus {
            0%   { opacity: 0; transform: translate(-50%, 4px)   scale(0.55); }
            14%  { opacity: 1; transform: translate(-50%, -10px) scale(1.12); }
            70%  { opacity: 1; transform: translate(-50%, -34px) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -56px) scale(0.92); }
        }
        .badge-pop-up   { animation: badgePopUp   0.62s cubic-bezier(.18,.84,.24,1.18); will-change: transform, filter; }
        .badge-pop-down { animation: badgePopDown 0.42s ease-out; will-change: transform, filter; }
        .badge-float-plus {
            position: fixed;
            pointer-events: none;
            z-index: 9999;
            font-weight: 800;
            font-size: 14px;
            letter-spacing: 0.5px;
            color: #ffd56b;
            text-shadow:
                0 1px 2px rgba(0, 0, 0, 0.55),
                0 0 8px rgba(255, 213, 107, 0.55);
            animation: badgeFloatPlus 0.9s ease-out forwards;
            white-space: nowrap;
            transform: translate(-50%, 0);
        }
    `;
    document.head.appendChild(style);
}

_injectStyles();

export const __test_only__ = {
    _readDomValue,
    _defaultFormatter,
    _easeOutExpo,
    _resolveTone,
};
