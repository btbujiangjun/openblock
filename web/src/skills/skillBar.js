/**
 * skillBar.js — v10.16 道具栏 UI 注入器
 *
 * 在 #skill-bar 旁注册新技能按钮（不抢占现有 hint / restart），
 * 自动渲染按钮 + 计数徽章 + 点击响应 + 钱包余额绑定。
 *
 * 接入路径
 * --------
 *   import { registerSkill } from './skills/skillBar.js';
 *   registerSkill({
 *     id: 'undo',
 *     icon: '↩',
 *     title: '撤销 — 还原最近一次落子',
 *     kind: 'undoToken',          // 关联钱包通货
 *     onClick: () => undoOnce(),
 *     enabled: () => game.canUndo(),
 *   });
 */

import { getWallet } from './wallet.js';
import { animateBadgeChange, setBadgeImmediate } from '../effects/badgeAnimator.js';

const REGISTRY = new Map();
let _bootstrapped = false;

/**
 * 决定本次刷新是否要展示数字动效。
 * - 入账（addBalance / 任务奖励 / 宝箱 / 广告 / IAP）→ gain（+N 飘字 + pop）
 * - 消耗（spend）→ drain（缩 pulse，无飘字）
 * - hydrate（首次水合服务端钱包）/ 缺省 detail → none，不弹动效避免开局齐喷
 *
 * `cappedFrom` 表示 amount 被每日上限完全截断（实际 0 入账），不应做 +N 反馈
 * 但仍需更新文本（amount=0 时 newCount 与 oldCount 相同，下方 animate 会 no-op）。
 */
function _toneFromDetail(detail) {
    if (!detail || typeof detail !== 'object') return 'none';
    if (detail.action === 'add') {
        if ((detail.amount | 0) > 0) return 'gain';
        return 'none';
    }
    if (detail.action === 'spend') return 'drain';
    return 'none';
}

function _bootstrap() {
    if (_bootstrapped) return;
    _bootstrapped = true;
    if (typeof document === 'undefined') return;
    document.addEventListener('DOMContentLoaded', _renderAll);
    if (document.readyState !== 'loading') _renderAll();
}

function _ensureContainer() {
    const bar = document.getElementById('skill-bar');
    if (!bar) return null;
    let ext = document.getElementById('skill-bar-ext');
    if (!ext) {
        ext = document.createElement('div');
        ext.id = 'skill-bar-ext';
        ext.className = 'skill-bar-ext';
        // 插在 #insight-hint 之后，让附加道具靠近 hint
        const hint = document.getElementById('insight-hint');
        if (hint && hint.parentNode === bar) {
            hint.insertAdjacentElement('afterend', ext);
        } else {
            bar.appendChild(ext);
        }
    }
    return ext;
}

function _renderAll() {
    const ext = _ensureContainer();
    if (!ext) return;
    for (const [, skill] of REGISTRY) {
        _renderSkill(ext, skill);
    }
}

function _renderSkill(container, skill, changeDetail = null) {
    let btn = container.querySelector(`[data-skill-id="${skill.id}"]`);
    const wallet = getWallet();
    const count = skill.kind ? wallet.getBalance(skill.kind) : null;
    const hasBalance = !skill.kind || count > 0;
    const enabled = (skill.enabled ? !!skill.enabled() : true) && hasBalance;
    let isFirstRender = false;

    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'skill-btn skill-btn--ext';
        btn.setAttribute('data-skill-id', skill.id);
        btn.title = skill.title || skill.id;
        btn.innerHTML = `
            <span class="skill-btn__icon">${skill.icon || '★'}</span>
            <span class="skill-btn__count" hidden></span>
        `;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (btn.classList.contains('is-disabled')) return;
            try { skill.onClick?.({ wallet }); } catch (err) { console.warn('[skillBar]', skill.id, err); }
        });
        container.appendChild(btn);
        isFirstRender = true;

        // 监听钱包变化自动刷新；把 emit detail 透传给下次渲染，
        // 让"宝箱入账 / 道具消耗"等场景能驱动数字动效与 +N 飘字。
        if (skill.kind) {
            wallet.onChange(skill.kind, (detail) => _renderSkill(container, skill, detail));
        }
    }

    const countEl = btn.querySelector('.skill-btn__count');
    if (skill.kind && countEl) {
        // 解析展示前后的数值，用于决策动效与 +N 浮字
        const wasHidden = !!countEl.hidden;
        const oldNum = wasHidden ? 0 : (() => {
            const t = String(countEl.textContent || '').trim();
            if (/^99\+$/.test(t)) return 99;
            const n = Number(t);
            return Number.isFinite(n) ? n : 0;
        })();

        if (count > 0) {
            countEl.hidden = false;
            const tone = _toneFromDetail(changeDetail);
            // 首次渲染（页面打开 / 注册按钮）即便 oldNum=0，也不应弹 +N，
            // 否则玩家进游戏会被存量道具的"+95"齐喷淹没体验。
            const skipAnim = isFirstRender || changeDetail?.action === 'hydrate' || tone === 'none';
            if (skipAnim) {
                setBadgeImmediate(countEl, count);
            } else {
                animateBadgeChange(countEl, count, {
                    oldVal: oldNum,
                    tone,
                    floatPlus: tone === 'gain',
                });
            }
        } else if (oldNum > 0) {
            // 余额刚好被打到 0：先动效到 0，结束后再隐藏，避免"啪"地一下消失
            animateBadgeChange(countEl, 0, {
                oldVal: oldNum,
                tone: 'drain',
                floatPlus: false,
            });
            setTimeout(() => {
                if ((skill.kind ? wallet.getBalance(skill.kind) : 0) === 0) {
                    countEl.hidden = true;
                }
            }, 700);
        } else {
            countEl.hidden = true;
        }
    }
    btn.classList.toggle('is-disabled', !enabled);
    btn.disabled = !enabled;
    btn.setAttribute('aria-disabled', String(!enabled));
}

/**
 * 注册一个技能按钮
 * @param {object} skill
 * @param {string} skill.id        唯一 id
 * @param {string} [skill.icon]    显示图标（emoji / 字符）
 * @param {string} [skill.title]   tooltip
 * @param {string} [skill.kind]    关联的钱包通货 kind（自动显示余额徽章）
 * @param {Function} skill.onClick 点击回调 ({ wallet }) => void
 * @param {Function} [skill.enabled] () => boolean，false 时按钮置灰
 */
export function registerSkill(skill) {
    if (!skill || !skill.id) return;
    REGISTRY.set(skill.id, skill);
    _bootstrap();
    if (_bootstrapped && typeof document !== 'undefined') {
        const ext = _ensureContainer();
        if (ext) _renderSkill(ext, skill);
    }
}

/** 重新刷新所有按钮的启用状态（外部状态变化时调） */
export function refreshSkillBar() {
    if (typeof document === 'undefined') return;
    const ext = document.getElementById('skill-bar-ext');
    if (!ext) return;
    for (const [, skill] of REGISTRY) {
        _renderSkill(ext, skill);
    }
}

/** 测试导出 */
export const __test_only__ = { REGISTRY, _toneFromDetail };
