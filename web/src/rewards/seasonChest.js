/**
 * seasonChest.js — v10.16 赛季进阶宝箱（P2）
 *
 * 复用 progression.js 的 totalXp，每累计 1000 / 5000 / 12000 / 25000 XP
 * 解锁阶梯宝箱（普通 / 稀有 / 史诗 / 传说），首次到达时 toast 通知（奖励先入钱包）。
 *
 * 入账顺序：先 `_grantAndNotify` 再写入 claimed，避免「已标记领取但入账失败」。
 * 详见 docs/product/CHEST_AND_WALLET.md。
 *
 * 简化版：本模块自带 XP 监听轮询，每 30s 检查一次 totalXp（避免侵入 progression.js）
 */

import { loadProgress } from '../progression.js';
import { skipWhenDocumentHidden } from '../lib/pageVisibility.js';
import { getWallet } from '../skills/wallet.js';
import { SKINS } from '../skins.js';

const KEY = 'openblock_season_chest_v1';

const TIERS = [
    { id: 'common',   xp: 1000,  label: '普通季终宝箱',  reward: { hintToken: 5, undoToken: 3 } },
    { id: 'rare',     xp: 5000,  label: '稀有季终宝箱',  reward: { hintToken: 12, bombToken: 1, rainbowToken: 1 } },
    { id: 'epic',     xp: 12000, label: '史诗季终宝箱',  reward: { hintToken: 30, bombToken: 3, rainbowToken: 3, _trial: ['fairy', 24] } },
    { id: 'legend',   xp: 25000, label: '传说季终宝箱',  reward: { hintToken: 100, bombToken: 10, rainbowToken: 10, _trial: ['forbidden', 48] } },
];

let _audio = null;
let _pollerHandle = null;

function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
}
function _save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

export function initSeasonChest({ audio = null } = {}) {
    _audio = audio;
    _checkOnce();
    _pollerHandle = setInterval(skipWhenDocumentHidden(_checkOnce), 30_000);
    if (typeof window !== 'undefined') {
        window.__seasonChest = { check: _checkOnce, getProgress };
    }
}

export function getProgress() {
    const xp = (loadProgress?.()?.totalXp) | 0;
    const claimed = _load();
    return TIERS.map(t => ({
        ...t,
        progress: Math.min(1, xp / t.xp),
        isClaimed: !!claimed[t.id],
    }));
}

function _checkOnce() {
    const xp = (loadProgress?.()?.totalXp) | 0;
    const claimed = _load();
    for (const t of TIERS) {
        if (xp >= t.xp && !claimed[t.id]) {
            _grantAndNotify(t);
            claimed[t.id] = { unlockedAt: Date.now(), atXp: xp };
            _save(claimed);
        }
    }
}

function _grantAndNotify(tier) {
    const wallet = getWallet();
    for (const [k, v] of Object.entries(tier.reward || {})) {
        if (k === '_trial' && Array.isArray(v)) {
            const [skinId, hours] = v;
            if (SKINS[skinId]) wallet.addTrial(skinId, hours | 0);
            continue;
        }
        wallet.addBalance(k, v, `season-chest-${tier.id}`);
    }
    _audio?.play?.('unlock');
    _audio?.vibrate?.([40, 80, 40, 80, 100]);
    _showToast(`🏆 ${tier.label} 已解锁`);
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
    el.dataset.tier = 'celebrate';   // 赛季宝箱解锁为罕见庆贺事件
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 5000);
}

export const __test_only__ = { TIERS };
