/**
 * welcomeBack.js — v10.17 回归玩家关怀礼包
 *
 * 设计要点
 * --------
 * 玩家上次活跃 N 天前，再次登录时根据"沉默时长"分级发放礼包：
 *   - 1 天前（D2 以内）：不弹（避免轰炸）
 *   - 3 天前（D3-D6 沉默）：温和回归 — 1 提示 + 1 撤销
 *   - 7 天前（D7+ 沉默）：完整回归 — 2 提示 + 2 撤销 + 1 炸弹 + 1 试穿券
 *   - 30 天前（深度流失）：超级回归 — 3 提示 + 3 撤销 + 1 炸弹 + 1 彩虹 + 2 试穿券
 *
 * 与 firstDayPack 互斥（共享 P0 优先级槽位），首日礼包优先。
 * 与 pushNotifications 协同（pushNotifications 已记录 lastActiveTs，本模块复用）
 *
 * localStorage 复用 openblock_push_v1 中的 lastActiveTs 字段，避免重复维护
 */

import { getWallet } from '../skills/wallet.js';
import { requestPrimaryPopup, releasePrimaryPopup } from '../popupCoordinator.js';

const PUSH_STORAGE_KEY = 'openblock_push_v1';
const SELF_STORAGE_KEY = 'openblock_welcome_back_v1';

const TIERS = [
    {
        id: 'tier-7d',
        minDaysSilent: 7,
        maxDaysSilent: 29,
        title: '欢迎回来',
        sub: '我们想你了',
        items: { hintToken: 2, undoToken: 2, bombToken: 1, trialPass: 1 },
        labels: ['+2 提示券', '+2 撤销券', '+1 炸弹', '+1 试穿券'],
    },
    {
        id: 'tier-30d',
        minDaysSilent: 30,
        maxDaysSilent: 9999,
        title: '王的归来',
        sub: '攒了一份大礼等你',
        items: { hintToken: 3, undoToken: 3, bombToken: 1, rainbowToken: 1, trialPass: 2 },
        labels: ['+3 提示券', '+3 撤销券', '+1 炸弹', '+1 彩虹', '+2 试穿券'],
    },
    {
        id: 'tier-3d',
        minDaysSilent: 3,
        maxDaysSilent: 6,
        title: '欢迎回来',
        sub: '路上的伙伴回来了，先来杯水',
        items: { hintToken: 1, undoToken: 1 },
        labels: ['+1 提示券', '+1 撤销券'],
    },
];

const TRIAL_SKIN_POOL = ['forbidden', 'demon', 'fairy', 'aurora', 'industrial', 'mahjong'];

function _readPushLastActive() {
    try {
        const raw = localStorage.getItem(PUSH_STORAGE_KEY);
        if (!raw) return 0;
        const s = JSON.parse(raw);
        return s.lastActiveTs || s.lastSeenTs || 0;
    } catch { return 0; }
}
function _readSelf() {
    try {
        const raw = localStorage.getItem(SELF_STORAGE_KEY);
        return raw ? JSON.parse(raw) : { lastClaimYmd: null, claimedTiers: [] };
    } catch { return { lastClaimYmd: null, claimedTiers: [] }; }
}
function _writeSelf(s) {
    try { localStorage.setItem(SELF_STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function _ymd(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function initWelcomeBack() {
    setTimeout(() => _maybeShow(), 1800);
}

function _maybeShow() {
    const lastActive = _readPushLastActive();
    if (!lastActive) return;   // 新用户：交给 firstDayPack
    const daysSilent = Math.floor((Date.now() - lastActive) / 86_400_000);
    if (daysSilent < 3) return;

    const self = _readSelf();
    const today = _ymd();
    if (self.lastClaimYmd === today) return;   // 同一天最多领一次

    const tier = TIERS.find(t => daysSilent >= t.minDaysSilent && daysSilent <= t.maxDaysSilent);
    if (!tier) return;

    if (!requestPrimaryPopup('welcomeBack')) return;
    _showCard(tier, daysSilent);
}

function _showCard(tier, daysSilent) {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'welcome-back-pack';
    el.innerHTML = `
        <div class="wbp-card">
            <div class="wbp-head">
                <h2>${tier.title}</h2>
                <p>${tier.sub} · 已离开 ${daysSilent} 天</p>
            </div>
            <ul class="wbp-items">
                ${tier.labels.map((l, i) => {
                    const icons = ['🎯', '↩', '💣', '🌈', '✨'];
                    return `<li><span>${icons[i] || '★'}</span><span>${l}</span></li>`;
                }).join('')}
            </ul>
            <button class="wbp-claim" type="button">收下</button>
        </div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));

    el.querySelector('.wbp-claim').addEventListener('click', () => {
        _grant(tier);
        const self = _readSelf();
        self.lastClaimYmd = _ymd();
        if (!self.claimedTiers.includes(tier.id)) self.claimedTiers.push(tier.id);
        _writeSelf(self);
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 320);
        releasePrimaryPopup();
    });
}

function _grant(tier) {
    const wallet = getWallet();
    for (const [k, v] of Object.entries(tier.items)) {
        if (k === 'trialPass') {
            for (let i = 0; i < v; i++) {
                const skin = TRIAL_SKIN_POOL[Math.floor(Math.random() * TRIAL_SKIN_POOL.length)];
                wallet.addTrial(skin, 24);
            }
        } else {
            wallet.addBalance(k, v, 'welcome-back');
        }
    }
}

/** 测试用 */
export function __resetForTest() {
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(SELF_STORAGE_KEY); } catch { /* ignore */ }
    }
}
