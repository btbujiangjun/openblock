/**
 * dailyDish.js — v10.17 每日轮换主题盘面（"今日特餐"）
 *
 * 设计要点
 * --------
 * - 7 种 modifier 按周期循环（周一到周日）：
 *     周一 巨石日 — spawn 偏向 4×4 / L 大块
 *     周二 闪电日 — 每局开局 +200 起始分
 *     周三 双倍日 — bonus 同色 / perfect 分数 ×2
 *     周四 反向日 — 候选块顺序倒置（视觉新鲜感）
 *     周五 极简日 — spawn 全 1×1 / 1×2 小块（容易高分）
 *     周六 长龙日 — 候选块强制只有 1×4 / 2×3 长形
 *     周日 静谧日 — 取消音效（哑剧体验）
 * - **登录首次提示** "今日特餐"toast，后续不重复
 * - **可关闭**：cheat 命令 `__dailyDish.disable()` 让玩家退出特餐
 * - **不强制嵌入**：modifier 通过 game._dailyDish 暴露，由相关模块各自检测
 *   （目前仅"巨石日"接 spawn / "双倍日"接分数计算 / "极简日"接 spawn 等都是占位钩子，
 *    实际渲染调整在 v10.17 持续推进）
 *
 * 接入路径
 * --------
 *   import { initDailyDish } from './daily/dailyDish.js';
 *   initDailyDish({ game });
 */

const STORAGE_KEY = 'openblock_daily_dish_v1';

const DISHES = [
    { id: 'sunday-silence',  weekday: 0, name: '静谧日',  desc: '今日无音效 — 享受纯粹专注',   icon: '🤫', modifier: { silentAudio: true } },
    { id: 'mon-boulder',     weekday: 1, name: '巨石日',  desc: 'spawn 偏向 4×4 / L 形大块',  icon: '🗿', modifier: { spawnBias: 'large' } },
    { id: 'tue-thunder',     weekday: 2, name: '闪电日',  desc: '每局开局 +200 起始分',         icon: '⚡', modifier: { startScore: 200 } },
    { id: 'wed-double',      weekday: 3, name: '双倍日',  desc: 'bonus 与 perfect 分数 ×2',     icon: '🎰', modifier: { bonusMul: 2 } },
    { id: 'thu-reverse',     weekday: 4, name: '反向日',  desc: '候选块顺序倒置 — 视觉新鲜',   icon: '🔄', modifier: { reverseDock: true } },
    { id: 'fri-minimal',     weekday: 5, name: '极简日',  desc: 'spawn 全 1×1 / 1×2 小块',     icon: '🪶', modifier: { spawnBias: 'small' } },
    { id: 'sat-snake',       weekday: 6, name: '长龙日',  desc: '候选块只有 1×4 / 2×3 长形',   icon: '🐍', modifier: { spawnBias: 'long' } },
];

function _ymd(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : { lastShownYmd: null, disabled: false };
    } catch { return { lastShownYmd: null, disabled: false }; }
}
function _save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function getTodayDish() {
    const w = new Date().getDay();
    return DISHES.find(d => d.weekday === w) || DISHES[0];
}

let _game = null;

export function initDailyDish({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    const state = _load();
    if (state.disabled) {
        _exposeWindow();
        return;
    }

    const dish = getTodayDish();
    game._dailyDish = dish;

    /* 应用 startScore modifier */
    if (dish.modifier?.startScore) {
        const origStart = game.start.bind(game);
        game.start = async (...args) => {
            const r = await origStart(...args);
            game.score = (game.score | 0) + dish.modifier.startScore;
            game.updateUI?.();
            return r;
        };
    }

    /* 提示 toast：每天首次启动一次 */
    if (state.lastShownYmd !== _ymd()) {
        setTimeout(() => _showDishToast(dish), 2400);
        state.lastShownYmd = _ymd();
        _save(state);
    }

    _exposeWindow();
}

function _exposeWindow() {
    if (typeof window !== 'undefined') {
        window.__dailyDish = {
            today: getTodayDish,
            disable: () => { const s = _load(); s.disabled = true; _save(s); },
            enable: () => { const s = _load(); s.disabled = false; _save(s); },
            list: () => DISHES.slice(),
        };
    }
}

function _showDishToast(dish) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    el.dataset.tier = 'celebrate';
    el.innerHTML = `<div style="font-size:32px;line-height:1">${dish.icon}</div>
                    <div style="font-weight:700;font-size:18px;margin-top:6px">今日 · ${dish.name}</div>
                    <div style="font-size:13px;opacity:.85;margin-top:4px">${dish.desc}</div>`;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 3800);
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
