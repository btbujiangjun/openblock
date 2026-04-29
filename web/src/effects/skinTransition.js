/**
 * skinTransition.js — v10.15 皮肤切换转场（Top 5 高 ROI #2 配套）
 *
 * 让皮肤切换从「瞬间替换 cssVars」变成「0.6s 主题色一闪 + 淡出 / 淡入」，
 * 给用户"我换了一个世界"的仪式感（参考休闲游戏：Candy Crush 关卡过渡 / Threes 数字动画）。
 *
 * 设计要点
 * --------
 * - **零侵入**：通过 skins.js 暴露的 `setSkinTransitionHook` 注册拦截器，
 *   不修改 setActiveSkinId 调用方的任何逻辑（main.js / game.js / seasonalSkin / easterEggs 都透明）
 * - **降级安全**：缺少 #skin-transition-overlay 元素时静默直接 apply（旧 HTML / 测试环境兼容）
 * - **prefers-reduced-motion**：无障碍偏好时直接切换，跳过过渡动画
 * - **可重入**：连续触发会以最新主题色重启动画（CSS transition 自身合并保证不抖动）
 *
 * 接入路径（main.js）
 * -------------------
 *   import { installSkinTransition } from './effects/skinTransition.js';
 *   installSkinTransition({ audio: window.__audioFx });
 */

import { SKINS, setSkinTransitionHook } from '../skins.js';

let _installed = false;

const TRANSITION_MS = 600;

/** 取主题色（优先用 cssBg，缺省 gridOuter） */
function _themeColorOf(skin) {
    return skin?.cssBg || skin?.gridOuter || '#000000';
}

function _ensureOverlay() {
    let el = document.getElementById('skin-transition-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'skin-transition-overlay';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
}

function _reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
}

/**
 * 注册转场钩子。被 setActiveSkinId 在切换时调用：
 *   hook(id, applyImmediate) — 钩子内部决定何时调 applyImmediate() 才让 cssVars 真正生效。
 *
 * @param {{ audio?: { play: Function } }} [opts]
 */
export function installSkinTransition(opts = {}) {
    if (_installed) return;
    _installed = true;

    if (typeof setSkinTransitionHook !== 'function') return;

    const audio = opts.audio || null;

    setSkinTransitionHook((id, applyImmediate) => {
        if (typeof document === 'undefined' || _reducedMotion()) {
            applyImmediate();
            return;
        }
        const next = SKINS && SKINS[id];
        if (!next) {
            applyImmediate();
            return;
        }

        const overlay = _ensureOverlay();
        const themeColor = _themeColorOf(next);

        overlay.style.background = themeColor;
        overlay.style.opacity = '0';
        overlay.classList.add('is-running');

        // 强制 reflow 确保起始 0 → peak 渐变可见
        // eslint-disable-next-line no-unused-expressions
        overlay.offsetHeight;

        requestAnimationFrame(() => {
            overlay.style.transition = `opacity ${TRANSITION_MS / 2}ms ease`;
            overlay.style.opacity = '0.85';
        });

        const halfDelay = Math.round(TRANSITION_MS / 2);
        setTimeout(() => {
            try { applyImmediate(); }
            catch (e) { console.warn('[skinTransition] applyImmediate failed:', e); }
            try { audio?.play?.('unlock'); } catch { /* ignore */ }
            requestAnimationFrame(() => {
                overlay.style.transition = `opacity ${TRANSITION_MS / 2}ms ease`;
                overlay.style.opacity = '0';
            });
            setTimeout(() => {
                overlay.style.transition = '';
                overlay.style.background = '';
                overlay.classList.remove('is-running');
            }, halfDelay + 30);
        }, halfDelay);
    });
}
