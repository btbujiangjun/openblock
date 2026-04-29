/**
 * firstUnlockCelebration.js — v10.16 首次解锁庆祝（P1）
 *
 * 当用户首次切换到某款皮肤时，触发 3s bonus 爆炸 + 飘字「皮肤名 已激活」+ unlock 音效。
 *
 * 实施
 * ----
 * - 通过 v10.16 新增的 onSkinAfterApply 订阅器，在皮肤实际生效后检查 firstSeen
 * - localStorage `openblock_skin_first_seen_v1` = { skinId: ymd }
 * - 默认皮肤 classic 不弹（玩家首次进入游戏时不应弹）
 * - 使用静默批量预填：玩家从未切过的皮肤，第一次切换才算"首次"
 */

import { onSkinAfterApply, SKINS } from '../skins.js';

const KEY = 'openblock_skin_first_seen_v1';
const SUPPRESS_INITIAL = ['classic', 'titanium'];

function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
}
function _save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

let _audio = null;
let _bootstrapped = false;

export function initFirstUnlockCelebration({ audio = null, currentSkinId = null } = {}) {
    if (_bootstrapped) return;
    _bootstrapped = true;
    _audio = audio;

    // 启动时若已有持久化皮肤是默认的 classic / titanium，预填 seen 标记防止首次启动误弹
    const seen = _load();
    if (currentSkinId && SUPPRESS_INITIAL.includes(currentSkinId) && !seen[currentSkinId]) {
        seen[currentSkinId] = new Date().toISOString().slice(0, 10);
        _save(seen);
    }

    onSkinAfterApply((id) => {
        const allSeen = _load();
        if (allSeen[id]) return;
        allSeen[id] = new Date().toISOString().slice(0, 10);
        _save(allSeen);
        _celebrate(id);
    });
}

function _celebrate(skinId) {
    const skin = SKINS[skinId];
    if (!skin) return;
    setTimeout(() => {
        const r = window.openBlockGame?.renderer;
        try {
            r?.triggerPerfectFlash?.();
            r?.triggerBonusMatchFlash?.(3);
            r?.setShake?.(14, 720);
        } catch { /* ignore */ }
        _audio?.play?.('perfect');
        _audio?.vibrate?.([40, 80, 40, 80, 40]);
        _showToast(`✨ ${skin.name || skinId} 皮肤已激活`);
    }, 240);
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
    el.dataset.tier = 'celebrate';   // 首次解锁皮肤为罕见庆贺事件
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 4000);
}
