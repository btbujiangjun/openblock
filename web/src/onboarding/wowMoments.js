/**
 * wowMoments.js — v10.17 首次成功 wow moment 强化
 *
 * 设计要点
 * --------
 * 在玩家首次达成下列成就时弹出"成就达成"toast + 振屏，强化"我做到了"的多巴胺：
 *   - 首次双消（同时清 ≥ 2 行/列）
 *   - 首次 perfect（盘面清空）
 *   - 首次 5 连消 streak
 *   - 首次 bonus 同色 / 同 icon 整行
 *
 * - **每个 moment 一辈子只触发一次**：localStorage 记录已触发集合
 * - **不影响游戏节奏**：toast 用 dataset.tier='celebrate'（既有两段 toast 设计）
 * - **优雅降级**：renderer 不存在或 trigger* 缺失时静默
 *
 * 接入路径
 * --------
 *   import { initWowMoments } from './onboarding/wowMoments.js';
 *   initWowMoments({ game, audio });
 */

const STORAGE_KEY = 'openblock_wow_moments_v1';

const MOMENTS = {
    'first-double-clear': { title: '首次双消！', body: '同时清掉两行 / 两列 — combo 已点燃。', icon: '✨' },
    'first-perfect':      { title: '首次 PERFECT！', body: '盘面被你彻底清空 — 玩家 0.5% 才做到。', icon: '🌟' },
    'first-streak-5':     { title: '5 连消！', body: '连续 5 局都消行 — 你已进入心流。', icon: '🔥' },
    'first-bonus':        { title: '首次同色 BONUS！', body: '一整行同 icon — 隐藏 ×2 分数已发放。', icon: '🎨' },
};

let _game = null;
let _audio = null;
let _streakCount = 0;
let _lastClearTs = 0;

function _load() {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
    catch { return new Set(); }
}
function _save(set) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function initWowMoments({ game, audio = null } = {}) {
    if (!game || _game) return;
    _game = game;
    _audio = audio;

    const r = game.renderer;
    if (!r) return;

    // 装饰 triggerComboFlash 监听消行
    const origCombo = r.triggerComboFlash?.bind(r);
    if (origCombo) {
        r.triggerComboFlash = (linesCleared = 1, ...rest) => {
            origCombo(linesCleared, ...rest);
            const now = performance.now();
            if (now - _lastClearTs < 4000) _streakCount += 1; else _streakCount = 1;
            _lastClearTs = now;
            if (linesCleared >= 2) _maybeFire('first-double-clear');
            if (_streakCount >= 5) _maybeFire('first-streak-5');
        };
    }

    // 装饰 triggerPerfectFlash
    const origPerfect = r.triggerPerfectFlash?.bind(r);
    if (origPerfect) {
        r.triggerPerfectFlash = (...args) => {
            origPerfect(...args);
            _maybeFire('first-perfect');
        };
    }

    // 装饰 triggerBonusMatchFlash
    const origBonus = r.triggerBonusMatchFlash?.bind(r);
    if (origBonus) {
        r.triggerBonusMatchFlash = (...args) => {
            origBonus(...args);
            _maybeFire('first-bonus');
        };
    }

    if (typeof window !== 'undefined') {
        window.__wowMoments = {
            reset: () => { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } },
            fire: (id) => _showToast(MOMENTS[id] || { title: id, body: '', icon: '★' }),
        };
    }
}

function _maybeFire(id) {
    const fired = _load();
    if (fired.has(id)) return;
    fired.add(id);
    _save(fired);
    const m = MOMENTS[id];
    if (m) {
        _showToast(m);
        _audio?.play?.('unlock');
        _game?.renderer?.setShake?.(8, 280);
    }
}

function _showToast(m) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    el.dataset.tier = 'celebrate';
    el.innerHTML = `<div style="font-size:30px;line-height:1;margin-bottom:6px">${m.icon}</div>
                    <div style="font-weight:700;font-size:18px">${m.title}</div>
                    <div style="font-size:13px;opacity:.85;margin-top:4px">${m.body}</div>`;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 3500);
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
    _audio = null;
    _streakCount = 0;
    _lastClearTs = 0;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
export function __getFiredForTest() { return [..._load()]; }
