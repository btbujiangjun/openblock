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

const REGISTRY = new Map();
let _bootstrapped = false;

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

function _renderSkill(container, skill) {
    let btn = container.querySelector(`[data-skill-id="${skill.id}"]`);
    const wallet = getWallet();
    const count = skill.kind ? wallet.getBalance(skill.kind) : null;
    const hasBalance = !skill.kind || count > 0;
    const enabled = (skill.enabled ? !!skill.enabled() : true) && hasBalance;

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

        // 监听钱包变化自动刷新
        if (skill.kind) {
            wallet.onChange(skill.kind, () => _renderSkill(container, skill));
        }
    }

    const countEl = btn.querySelector('.skill-btn__count');
    if (skill.kind && countEl) {
        if (count > 0) {
            countEl.textContent = count > 99 ? '99+' : String(count);
            countEl.hidden = false;
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
export const __test_only__ = { REGISTRY };
