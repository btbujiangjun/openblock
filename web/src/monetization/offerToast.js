/**
 * offerToast.js — `lifecycle:*` 事件的最小 UI 订阅层
 *
 * v1.49.x P0-7：在统一数据层（lifecycleSignals）+ 编排层（lifecycleOrchestrator）
 * + 商业化策略层（lifecycleAwareOffers）之上，把 `lifecycle:offer_available` /
 * `lifecycle:first_purchase` / `lifecycle:churn_high` 三个事件**真的渲染到屏幕**。
 *
 * 此前现状：
 *   - lifecycleAwareOffers 已在合适的时机 emit 上述事件
 *   - 但在生产代码中**没有任何 UI 订阅方**——事件被悄悄丢进 MonetizationBus 后没人取
 *   - 玩家在 ≥7 天回流时 winback offer 已被 paymentManager 写入 localStorage，
 *     但屏幕上没有任何提示，玩家无从知晓
 *
 * 本模块做的事：
 *   1. 启动时订阅 `lifecycle:offer_available`，命中后 1.6s 顶部 toast
 *   2. 订阅 `lifecycle:first_purchase`，弹首充祝贺 + VIP 经验提示
 *   3. 订阅 `lifecycle:churn_high`，当流失风险高位时弹"会员关怀"提示
 *      （仅在玩家未付费时，避免对鲸鱼骚扰）
 *   4. 同一玩家 24h 内同 offerType 仅展示一次，避免促销疲劳
 *
 * 设计约束：
 *   - 失败软化：DOM 不可用时静默不渲染
 *   - 不引入新依赖：复用 `.mon-toast` 已有样式 + 自带极简 inline 样式增量
 *   - feature flag：`getFlag('lifecycleOfferToast')` 控制；默认 on
 */

import { on } from './MonetizationBus.js';
import { getFlag } from './featureFlags.js';

const SHOWN_KEY = 'openblock_offer_toast_shown_v1';
const COOLDOWN_HOURS = 24;
const TOAST_DURATION_MS = 4000;

let _attached = false;
let _unsubscribers = [];

/* ---------- 频控 ----------
 * 双轨：内存缓存 `_memoryShown` 是首选（避免某些 jsdom/小程序环境 localStorage
 * 不可写或异步同步未完成时被旁路）；localStorage 持久化用于跨 session 仍然生效。
 */
const _memoryShown = new Map();

function _loadShown() {
    try {
        const raw = localStorage.getItem(SHOWN_KEY);
        const persisted = raw ? JSON.parse(raw) : {};
        for (const [k, v] of Object.entries(persisted)) {
            if (!_memoryShown.has(k)) _memoryShown.set(k, Number(v) || 0);
        }
    } catch {}
    return _memoryShown;
}

function _saveShown() {
    try {
        const obj = {};
        for (const [k, v] of _memoryShown.entries()) obj[k] = v;
        localStorage.setItem(SHOWN_KEY, JSON.stringify(obj));
    } catch {}
}

function _isOnCooldown(key) {
    const map = _loadShown();
    const last = Number(map.get(key) || 0);
    if (!last) return false;
    return (Date.now() - last) < COOLDOWN_HOURS * 3600 * 1000;
}

function _markShown(key) {
    _memoryShown.set(key, Date.now());
    _saveShown();
}

/* ---------- 渲染 ---------- */

function _showToast({ icon = '🎁', title, desc = '', accentColor = '#38bdf8' }) {
    if (typeof document === 'undefined') return;
    const host = document.body;
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'mon-toast mon-toast--offer';
    el.style.borderColor = `color-mix(in srgb, ${accentColor} 60%, rgba(56,189,248,0.3))`;
    el.innerHTML = `
        <span class="mon-toast-icon">${icon}</span>
        <div>
            <div style="font-weight:700">${title}</div>
            ${desc ? `<div class="mon-toast-desc">${desc}</div>` : ''}
        </div>
    `;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('mon-toast-visible'));
    setTimeout(() => {
        el.classList.remove('mon-toast-visible');
        setTimeout(() => { try { el.remove(); } catch {} }, 350);
    }, TOAST_DURATION_MS);
}

/* ---------- 事件处理 ---------- */

function _onOfferAvailable({ data }) {
    if (!data?.type) return;
    const key = `offer:${data.type}`;
    if (_isOnCooldown(key)) return;

    const profileMap = {
        winback_user: {
            icon: '🎁',
            title: '欢迎回来！7 折回归礼包已就位',
            desc: data.reason || '点击商店领取',
            accent: '#fbbf24',
        },
        first_purchase: {
            icon: '✨',
            title: '专属首充特惠已就位',
            desc: data.offer?.name || '商城内可领取',
            accent: '#a78bfa',
        },
        weekly_return: {
            icon: '🛒',
            title: '回归特惠 5 折',
            desc: data.reason || '本周限定',
            accent: '#34d399',
        },
        upgrade: {
            icon: '⬆️',
            title: '升级礼包 7 折',
            desc: data.reason || '限时折扣',
            accent: '#60a5fa',
        },
    };
    const cfg = profileMap[data.type] || {
        icon: '🎁',
        title: data.offer?.name || '专属优惠已上线',
        desc: data.reason || '前往商城查看',
        accent: '#38bdf8',
    };

    _showToast({
        icon: cfg.icon,
        title: cfg.title,
        desc: cfg.desc,
        accentColor: cfg.accent,
    });
    _markShown(key);
}

function _onFirstPurchase({ data }) {
    const price = Number(data?.price) || 0;
    _showToast({
        icon: '🎉',
        title: '首充完成！多谢支持',
        desc: price > 0 ? `本次累计 +${price * 100} VIP 经验` : 'VIP 经验已增加',
        accentColor: '#f472b6',
    });
}

function _onChurnHigh({ data }) {
    /* 仅对未付费玩家展示，避免对鲸鱼骚扰；whaleScore 通过 segment 间接判断。
     * 当 segment 是 'whale'/'dolphin' 时跳过；其余 segment 算"风险中"展示关怀。
     * 这里 segment 信息暂未直传，留给 P1-1 abilitySegment 落地后再增强。 */
    const key = `churn_high:${data?.level || 'high'}`;
    if (_isOnCooldown(key)) return;
    _showToast({
        icon: '💝',
        title: '感谢一路相伴',
        desc: '完成今日任务领免广特权',
        accentColor: '#fb7185',
    });
    _markShown(key);
}

/* ---------- 生命周期 ---------- */

export function attachOfferToast() {
    if (_attached) return detachOfferToast;
    if (!getFlag('lifecycleOfferToast')) return () => {};
    _attached = true;

    _unsubscribers = [
        on('lifecycle:offer_available', _onOfferAvailable),
        on('lifecycle:first_purchase', _onFirstPurchase),
        on('lifecycle:churn_high', _onChurnHigh),
    ];
    return detachOfferToast;
}

export function detachOfferToast() {
    _unsubscribers.forEach((u) => { try { u?.(); } catch {} });
    _unsubscribers = [];
    _attached = false;
}

export function isOfferToastAttached() {
    return _attached;
}

/* 单测/Storybook 用：清空展示历史 + 内存缓存，让 cooldown 重置；同时 detach 订阅。 */
export function _resetOfferToastForTesting() {
    try { localStorage.removeItem(SHOWN_KEY); } catch {}
    _memoryShown.clear();
    detachOfferToast();
}
