/**
 * firstDayPack.js — v10.17 首日大礼包
 *
 * 设计要点
 * --------
 * - 用户**首次进入**（账号创建当天）→ 弹礼包：3 提示券 + 2 撤销 + 1 炸弹 + 1 彩虹 + 1 试穿券
 * - 通过 wallet.addBalance(..., 'first-day-pack')，绕过每日上限（特殊 source）
 * - 与 FTUE 共享 P0 槽位（互斥），优先展示首日礼包
 * - localStorage：openblock_first_day_pack_v1 = { claimed, ts }
 *
 * 接入路径
 * --------
 *   import { initFirstDayPack } from './onboarding/firstDayPack.js';
 *   initFirstDayPack();
 */

import { getWallet } from '../skills/wallet.js';
import { requestPrimaryPopup, releasePrimaryPopup } from '../popupCoordinator.js';

const STORAGE_KEY = 'openblock_first_day_pack_v1';

const PACK = {
    hintToken: 3,
    undoToken: 2,
    bombToken: 1,
    rainbowToken: 1,
    trialPass: 1,   // 任选限定皮肤试穿券
};

const TRIAL_SKIN_POOL = ['forbidden', 'demon', 'fairy', 'aurora', 'industrial'];

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : { claimed: false, ts: null };
    } catch { return { claimed: false, ts: null }; }
}
function _save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function initFirstDayPack() {
    const state = _load();
    if (state.claimed) return;

    setTimeout(() => {
        if (!requestPrimaryPopup('firstDayPack')) return;
        _showPackModal();
    }, 1500);
}

function _showPackModal() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('first-day-pack')) return;

    const el = document.createElement('div');
    el.id = 'first-day-pack';
    el.className = 'first-day-pack';
    el.innerHTML = `
        <div class="fdp-card">
            <div class="fdp-card__head">
                <h2>欢迎来到 OpenBlock</h2>
                <p>首日礼包已为你备好</p>
            </div>
            <ul class="fdp-card__items">
                <li><span class="fdp-icon">🎯</span><span>提示券 ×3</span><span class="fdp-desc">查看最佳落点</span></li>
                <li><span class="fdp-icon">↩</span><span>撤销券 ×2</span><span class="fdp-desc">还原最近一步</span></li>
                <li><span class="fdp-icon">💣</span><span>炸弹 ×1</span><span class="fdp-desc">清除 3×3 区域</span></li>
                <li><span class="fdp-icon">🌈</span><span>彩虹 ×1</span><span class="fdp-desc">染色清行触发 bonus</span></li>
                <li><span class="fdp-icon">✨</span><span>试穿券 ×1</span><span class="fdp-desc">24h 限定皮肤</span></li>
            </ul>
            <button class="fdp-claim" type="button">收下礼包</button>
        </div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));

    el.querySelector('.fdp-claim').addEventListener('click', () => {
        _grantPack();
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 320);
        releasePrimaryPopup();
    });
}

function _grantPack() {
    const wallet = getWallet();
    let granted = [];
    for (const [kind, amount] of Object.entries(PACK)) {
        if (kind === 'trialPass') continue;
        const ok = wallet.addBalance(kind, amount, 'first-day-pack');
        if (ok) granted.push(`${kind} +${amount}`);
    }
    // 试穿券：随机一个池中皮肤
    const skinId = TRIAL_SKIN_POOL[Math.floor(Math.random() * TRIAL_SKIN_POOL.length)];
    wallet.addTrial(skinId, 24);
    granted.push(`trial:${skinId}`);

    _save({ claimed: true, ts: Date.now() });
    console.info('[firstDayPack] granted:', granted.join(', '));
}

/** 测试用 */
export function __resetForTest() {
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
