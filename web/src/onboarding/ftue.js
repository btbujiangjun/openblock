/**
 * ftue.js — v10.17 First-Time User Experience 教学引导
 *
 * 设计要点
 * --------
 * - **3 局 3 提示阶梯**：第 1 局开局 → 拖拽 / 第 1 局首次消行 → combo 提示 / 第 3 局开局 → 4 件道具引导
 * - **可跳过且永久关闭**：用户点 ✕ 关闭 → 后续不再弹出（不强迫）
 * - **不打断主玩法**：玻璃质感卡片浮在右上角 / 点击卡片消失 / 30s 自动隐藏
 * - **localStorage 持久**：openblock_ftue_v1 = { steps: { stepId: shownYmd|true }, skipped: false }
 *
 * 接入路径
 * --------
 *   import { initFtue } from './onboarding/ftue.js';
 *   initFtue({ game });
 */

import { requestPrimaryPopup, releasePrimaryPopup } from '../popupCoordinator.js';

const STORAGE_KEY = 'openblock_ftue_v1';

const STEPS = [
    {
        id: 'drag',
        gate: 'gameStart',
        gameNo: 1,
        title: '拖拽方块',
        body: '从底部候选区按住任意方块，拖到棋盘空格，松手即落子。每局会有 3 个候选块。',
        icon: '🖱️',
    },
    {
        id: 'combo',
        gate: 'firstClear',
        gameNo: 1,
        title: '连消加成',
        body: '同时消除多行 / 多列触发 combo，分数加倍 — 全清盘面将获得 perfect 大奖。',
        icon: '✨',
    },
    {
        id: 'tools',
        gate: 'gameStart',
        gameNo: 3,
        title: '4 件道具助攻',
        body: '盘面上方道具栏：🎯 提示落点 / ↩ 撤销一步 / 💣 清除 3×3 / 🌈 染色清行。每天免费 3 次提示与撤销。',
        icon: '🛠️',
    },
];

const AUTO_HIDE_MS = 30_000;

let _game = null;
let _gameNo = 0;
let _everCleared = false;

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { steps: {}, skipped: false };
        const s = JSON.parse(raw);
        return { steps: s.steps || {}, skipped: !!s.skipped };
    } catch { return { steps: {}, skipped: false }; }
}
function _save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { /* ignore */ }
}

function _markShown(stepId) {
    const s = _load();
    s.steps[stepId] = new Date().toISOString().slice(0, 10);
    _save(s);
}
function _isShown(stepId) {
    return !!_load().steps[stepId];
}
function _setSkipped() {
    const s = _load();
    s.skipped = true;
    _save(s);
}

export function initFtue({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    // 装饰 game.start 计数局数 + gameStart 触发
    const origStart = game.start.bind(game);
    game.start = async (...args) => {
        const r = await origStart(...args);
        _gameNo += 1;
        _everCleared = false;
        setTimeout(() => _maybeShowGate('gameStart'), 800);
        return r;
    };

    // 装饰 trigger* 监听首次消行
    const r = game.renderer;
    if (r) {
        const origTriggerComboFlash = r.triggerComboFlash?.bind(r);
        if (origTriggerComboFlash) {
            r.triggerComboFlash = (...args) => {
                origTriggerComboFlash(...args);
                if (!_everCleared) {
                    _everCleared = true;
                    setTimeout(() => _maybeShowGate('firstClear'), 1200);
                }
            };
        }
    }

    if (typeof window !== 'undefined') {
        window.__ftue = {
            reset: () => { _save({ steps: {}, skipped: false }); _gameNo = 0; },
            skip: () => _setSkipped(),
            forceShow: (id) => {
                const step = STEPS.find(s => s.id === id);
                if (step) _showCard(step);
            },
        };
    }
}

function _maybeShowGate(gate) {
    const state = _load();
    if (state.skipped) return;
    const step = STEPS.find(s => s.gate === gate && s.gameNo === _gameNo && !state.steps[s.id]);
    if (!step) return;
    if (!requestPrimaryPopup('firstDayPack')) return;   // 与首日礼包共享 P0 槽位（互斥）
    _showCard(step);
}

function _showCard(step) {
    if (typeof document === 'undefined') return;
    if (document.getElementById('ftue-card')) return;

    const el = document.createElement('div');
    el.id = 'ftue-card';
    el.className = 'ftue-card';
    el.innerHTML = `
        <div class="ftue-card__icon">${step.icon}</div>
        <div class="ftue-card__body">
            <div class="ftue-card__title">${step.title}</div>
            <div class="ftue-card__text">${step.body}</div>
        </div>
        <button class="ftue-card__close" type="button" aria-label="跳过引导">×</button>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));

    const close = (skipForever = false) => {
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 320);
        _markShown(step.id);
        if (skipForever) _setSkipped();
        releasePrimaryPopup();
    };

    el.querySelector('.ftue-card__close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        close(true);
    });
    el.addEventListener('click', () => close(false));

    setTimeout(() => { if (document.body.contains(el)) close(false); }, AUTO_HIDE_MS);
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
    _gameNo = 0;
    _everCleared = false;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
