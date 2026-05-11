/**
 * luckyWheel.js — v10.16 周末幸运转盘（P1）
 *
 * 每周一 / 周五各一次免费转盘，命中随机奖品。
 *
 * 设计要点
 * --------
 * - **触发**：周一 / 周五 12:00 后首次进入游戏自动弹（toast 提示），用户点击触发
 * - **奖池**：8 段：4× 提示券 / 3× 撤销 / 2× 炸弹 / 1× 彩虹 / 10 金币 / 50 金币 / 200 金币 / 12h 试穿券
 *   （10 金币为小额安慰奖，承接"必有奖"设计；不再使用"谢谢参与"以免与赠品产生语义冲突）
 * - **localStorage `openblock_lucky_wheel_v1`**：{ lastSpinDate, recentResults }
 */

import { getWallet } from '../skills/wallet.js';
import { SKINS } from '../skins.js';
import { t } from '../i18n/i18n.js';

const KEY = 'openblock_lucky_wheel_v1';

/* v1.x：每个奖品拆成 name + count 双行（转盘视觉惯例 + 艺术感分层）。
 *   name  → 主名称（中文/类别），首行偏大字号 + 描边
 *   count → 数量/时长（×N、Nh），次行金色高亮
 *   label → 用于 toast / 结果展示的完整一句话，保持向后兼容。 */
const PRIZES = [
    { id: 'hint4',    name: '提示券', count: '×4',    label: '提示券 ×4',          items: { hintToken: 4 }, weight: 22 },
    { id: 'undo3',    name: '撤销',   count: '×3',    label: '撤销 ×3',            items: { undoToken: 3 }, weight: 18 },
    { id: 'bomb2',    name: '炸弹',   count: '×2',    label: '炸弹 ×2',            items: { bombToken: 2 }, weight: 12 },
    { id: 'rainbow1', name: '彩虹',   count: '×1',    label: '彩虹 ×1',            items: { rainbowToken: 1 }, weight: 8 },
    { id: 'coin50',   name: '金币',   count: '×50',   label: '金币 ×50',           items: { coin: 50 }, weight: 16 },
    { id: 'coin200',  name: '金币',   count: '×200',  label: '金币 ×200',          items: { coin: 200 }, weight: 6 },
    { id: 'trial12h', name: '皮肤试穿', count: '12h', label: '12h 限定皮肤试穿',   items: { _trial: 12 }, weight: 4 },
    /* 第 8 段：小额金币安慰奖（承接"必有奖"设计；不再使用"谢谢参与"以免与赠品语义冲突） */
    { id: 'coin10',   name: '金币',   count: '×10',   label: '金币 ×10',           items: { coin: 10 }, weight: 14 },
];

const TRIAL_POOL = ['forbidden', 'demon', 'fairy', 'mahjong', 'aurora'];

let _audio = null;

function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
}
function _save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

function _ymd() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }

function _isWheelDay(d = new Date()) {
    const dow = d.getDay();   // 0=Sun, 1=Mon, ..., 5=Fri
    return dow === 1 || dow === 5;
}

export function initLuckyWheel({ audio = null } = {}) {
    _audio = audio;
    if (typeof window !== 'undefined') {
        window.__luckyWheel = { open: openWheel, canSpin };
    }
    setTimeout(_maybePromptToday, 2200);
}

export function canSpin() {
    if (!_isWheelDay()) return false;
    const s = _load();
    return s.lastSpinDate !== _ymd();
}

function _maybePromptToday() {
    if (!canSpin()) return;
    _showToast('🎰 今日免费转盘可领取', { actionLabel: '去抽', onAction: openWheel });
}

export function openWheel() {
    if (!canSpin()) {
        _showToast('今日无免费转盘');
        return;
    }
    _renderWheel();
}

function _renderWheel() {
    let panel = document.getElementById('lucky-wheel-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'lucky-wheel-panel';
        panel.className = 'lucky-wheel-panel';
        document.body.appendChild(panel);
    }
    const wedges = PRIZES.map((p, i) => `
        <div class="wheel-wedge" style="--wedge-index: ${i}" aria-hidden="true">
            <span class="wheel-wedge-label">
                <span class="wheel-wedge-label__name">${p.name ?? p.label}</span>
                ${p.count ? `<span class="wheel-wedge-label__count">${p.count}</span>` : ''}
            </span>
        </div>
    `).join('');
    panel.innerHTML = `
        <div class="wheel-card">
            <h3>周末幸运转盘</h3>
            <div class="wheel-disc">
                <div class="wheel-disc-inner">
                    ${wedges}
                </div>
                <div class="wheel-pointer" aria-hidden="true">▼</div>
            </div>
            <button type="button" class="wheel-spin-btn">免费抽</button>
            <div class="wheel-result" hidden></div>
            <button type="button" class="wheel-close" aria-label="关闭">×</button>
        </div>
    `;
    panel.classList.add('is-visible');

    panel.querySelector('.wheel-spin-btn').addEventListener('click', () => _doSpin(panel));
    panel.querySelector('.wheel-close').addEventListener('click', () => panel.classList.remove('is-visible'));
    panel.addEventListener('click', (e) => {
        if (e.target === panel) panel.classList.remove('is-visible');
    });
}

function _doSpin(panel) {
    const btn = panel.querySelector('.wheel-spin-btn');
    if (btn?.disabled) return;

    const prize = _pickPrize();
    const idx = PRIZES.indexOf(prize);

    const inner = panel.querySelector('.wheel-disc-inner');
    const wedgeAngle = 360 / PRIZES.length;
    const targetAngle = 360 * 4 + (idx * wedgeAngle) + wedgeAngle / 2;
    if (inner) {
        inner.style.transition = 'transform 2.4s cubic-bezier(.16, 1, .3, 1)';
        inner.style.transform = `rotate(-${targetAngle}deg)`;
    }
    if (btn) {
        btn.disabled = true;
        btn.textContent = t('reward.luckyWheel.spinning');
    }
    _audio?.play?.('combo');

    setTimeout(() => {
        _grant(prize);
        const state = _load();
        state.lastSpinDate = _ymd();
        state.recentResults = [...(state.recentResults || []), { prize: prize.id, ymd: _ymd() }].slice(-30);
        _save(state);
        const result = panel.querySelector('.wheel-result');
        if (result) {
            result.hidden = false;
            result.textContent = `🎉 ${prize.label}`;
        }
        if (btn) btn.textContent = t('reward.luckyWheel.usedToday');
        _audio?.play?.('unlock');
        _audio?.vibrate?.([20, 60, 20, 60, 80]);
    }, 2500);
}

function _pickPrize() {
    const total = PRIZES.reduce((s, p) => s + p.weight, 0);
    let rnd = Math.random() * total;
    for (const p of PRIZES) {
        rnd -= p.weight;
        if (rnd < 0) return p;
    }
    return PRIZES[PRIZES.length - 1];
}

function _grant(prize) {
    const wallet = getWallet();
    for (const [k, v] of Object.entries(prize.items)) {
        if (k === '_trial') {
            const pool = TRIAL_POOL.filter(id => SKINS[id]);
            if (pool.length) {
                const chosen = pool[Math.floor(Math.random() * pool.length)];
                wallet.addTrial(chosen, v | 0);
            }
            continue;
        }
        wallet.addBalance(k, v, `lucky-wheel-${prize.id}`);
    }
}

function _showToast(msg, opts = {}) {
    if (typeof document === 'undefined') return;
    const id = 'seasonal-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.innerHTML = '';
    const text = document.createElement('span');
    text.className = 'seasonal-toast__text';
    text.textContent = msg;
    el.appendChild(text);
    if (opts.actionLabel && typeof opts.onAction === 'function') {
        const btn = document.createElement('button');
        btn.className = 'seasonal-toast__btn';
        btn.textContent = opts.actionLabel;
        btn.addEventListener('click', () => {
            try { opts.onAction(); } catch { /* ignore */ }
            el.classList.remove('is-visible');
        });
        el.appendChild(btn);
    }
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 7000);
}
