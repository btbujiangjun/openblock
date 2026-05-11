/**
 * seasonalSkin.js — v10.15 节日 / 时段 / 4.1 自动换皮推荐（Top 5 高 ROI #3）
 *
 * 把全量皮肤资产 × 时间维度联动起来，让游戏在不同日期 / 时段呈现不同氛围。
 *
 * 三层规则（按优先级从高到低）
 * ----------------------------
 *   1. 4 月 1 日特别版 — 所有皮肤的 blockIcons 临时替换为表情 emoji，全局生效
 *      （在 main.js 极早期执行，覆盖 SKINS[*].blockIcons）
 *   2. 节日推荐 — 春节 / 元宵 / 中秋 / 万圣 / 圣诞 / 元旦 等映射到对应皮肤
 *      （以 toast 形式询问玩家是否切换；用户一日内选过则不再打扰）
 *   3. 时段推荐 — 早曙 / 上午海 / 下午彩 / 夕阳 / 夜星空 / 深夜
 *      （仅在玩家从未主动选过皮肤时启用，作为"默认体验"动态化）
 *
 * 反打扰策略
 * ----------
 * - localStorage `openblock_seasonal_v1` 记录今日是否已弹过推荐（按 ymd 存）
 * - 用户在皮肤选择面板中**主动选过任何皮肤**后，时段推荐永久关闭
 *   （通过 `openblock_skin_user_chosen` 标记；setActiveSkinId 的人为调用会写入）
 * - 4.1 emoji 模式可由用户在设置中关闭（`openblock_april_fools_optout`）
 *
 * 接入路径（main.js）
 * -------------------
 *   import { applyAprilFoolsIfActive, applySeasonalRecommendation } from './seasonalSkin.js';
 *   applyAprilFoolsIfActive();             // applySkinToDocument 之前调
 *   applySkinToDocument(getActiveSkin());
 *   await game.init(); ...
 *   applySeasonalRecommendation({ game });  // 节日 toast / 时段切换
 */

import { SKINS, setActiveSkinId, getActiveSkinId } from './skins.js';

const STORAGE_KEY = 'openblock_seasonal_v1';
const USER_CHOSEN_KEY = 'openblock_skin_user_chosen';
const APRIL_FOOLS_OPTOUT_KEY = 'openblock_april_fools_optout';
const BIRTHDAY_KEY = 'openblock_user_birthday_v1';      // v10.16: 用户生日
const WEEKEND_TRIAL_KEY = 'openblock_weekend_trial_v1'; // v10.16: 周末试穿券记录

/* -----------------------------------------------------------
 * 节日表（公历 — 含农历近似日期；范围覆盖 2026-2028）
 * 想要加更多节日，按相同 schema 追加即可。
 * --------------------------------------------------------- */
const FESTIVAL_RULES = [
    { name: '元旦',     match: { month: 1,  day: 1  }, skin: 'sakura',    msg: '新年好——粉色樱花皮肤已就位' },
    { name: '春节',     match: { dates: ['2026-02-17', '2027-02-06', '2028-01-26'] }, skin: 'forbidden', msg: '春节大吉——故宫禁城皮肤已就位' },
    { name: '元宵节',   match: { dates: ['2026-03-03', '2027-02-21', '2028-02-09'] }, skin: 'mahjong',   msg: '元宵团圆——麻将牌局皮肤已就位' },
    { name: '情人节',   match: { month: 2,  day: 14 }, skin: 'candy',     msg: '情人节快乐——糖果皮肤已就位' },
    { name: '清明',     match: { dates: ['2026-04-05', '2027-04-05', '2028-04-04'] }, skin: 'forest',    msg: '清明时节——森林皮肤已就位' },
    { name: '端午节',   match: { dates: ['2026-06-19', '2027-06-09', '2028-05-28'] }, skin: 'koi',       msg: '端午安康——锦鲤皮肤已就位' },
    { name: '中秋节',   match: { dates: ['2026-09-25', '2027-09-15', '2028-10-03'] }, skin: 'koi',       msg: '中秋月满——锦鲤池塘皮肤已就位' },
    { name: '国庆节',   match: { month: 10, day: 1  }, skin: 'forbidden', msg: '国庆快乐——故宫禁城皮肤已就位' },
    { name: '万圣节',   match: { month: 10, day: 31 }, skin: 'demon',     msg: '万圣节特别版——魔幻血赤皮肤已就位' },
    { name: '感恩节',   match: { dates: ['2026-11-26', '2027-11-25', '2028-11-23'] }, skin: 'farm',      msg: '感恩节——田园农庄皮肤已就位' },
    { name: '圣诞节',   match: { month: 12, day: 25 }, skin: 'fairy',     msg: '圣诞快乐——奇幻仙境皮肤已就位' },
    { name: '跨年夜',   match: { month: 12, day: 31 }, skin: 'aurora',    msg: '跨年夜——极光皮肤已就位' },
];

/* -----------------------------------------------------------
 * 时段映射（按系统本地时间）
 * --------------------------------------------------------- */
const TIME_OF_DAY_RULES = [
    { range: [6, 9],   skin: 'dawn',     label: '清晨' },
    { range: [9, 12],  skin: 'ocean',    label: '上午' },
    { range: [12, 17], skin: 'tropical-fallback', label: '午后' }, // tropical 不存在，回退在下面处理
    { range: [17, 19], skin: 'sunset',   label: '日落' },
    { range: [19, 22], skin: 'sakura',   label: '夜晚' },
    { range: [22, 24], skin: 'universe', label: '深夜' },
    { range: [0, 6],   skin: 'universe', label: '凌晨' },
];

/** 4 月 1 日限定 emoji 集（覆盖所有带 blockIcons 皮肤的 blockIcons） */
const APRIL_FOOLS_ICONS = ['😀', '😎', '🤩', '😜', '🥳', '🤖', '👻', '🎭'];

/* -----------------------------------------------------------
 * 工具
 * --------------------------------------------------------- */

function _ymd(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function _readStorage(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
}
function _writeStorage(key, value) {
    try { localStorage.setItem(key, value); }
    catch { /* ignore */ }
}

function _readSeasonal() {
    try {
        const raw = _readStorage(STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch { return {}; }
}
function _writeSeasonal(state) {
    try { _writeStorage(STORAGE_KEY, JSON.stringify(state)); }
    catch { /* ignore */ }
}

/* -----------------------------------------------------------
 * 4 月 1 日：覆盖所有皮肤的 blockIcons 为表情 emoji
 * 在 applySkinToDocument 之前调用即可生效（不影响 localStorage 中的皮肤选择）
 * --------------------------------------------------------- */
function isAprilFools(date = new Date()) {
    if (_readStorage(APRIL_FOOLS_OPTOUT_KEY) === '1') return false;
    return date.getMonth() === 3 && date.getDate() === 1;
}

export function applyAprilFoolsIfActive() {
    if (!isAprilFools()) return false;
    for (const id of Object.keys(SKINS)) {
        const s = SKINS[id];
        if (Array.isArray(s.blockIcons) && s.blockIcons.length) {
            s.blockIcons = APRIL_FOOLS_ICONS.slice(0, s.blockIcons.length);
        } else if (Array.isArray(s.blockColors) && s.blockColors.length) {
            // 给原本无 icon 的皮肤也加上节日表情
            s.blockIcons = APRIL_FOOLS_ICONS.slice(0, s.blockColors.length);
        }
    }
    return true;
}

/* -----------------------------------------------------------
 * 节日识别
 * --------------------------------------------------------- */
function _matchFestival(date = new Date()) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const today = _ymd(date);

    for (const rule of FESTIVAL_RULES) {
        const M = rule.match;
        if (M.dates && M.dates.includes(today)) return rule;
        if (M.month === m && M.day === d) return rule;
    }
    void y;
    return null;
}

/* -----------------------------------------------------------
 * 时段识别
 * --------------------------------------------------------- */
function _matchTimeOfDay(date = new Date()) {
    const h = date.getHours();
    for (const rule of TIME_OF_DAY_RULES) {
        const [a, b] = rule.range;
        if (h >= a && h < b) {
            // tropical 不存在 → 用 candy 替代（下午彩虹氛围）
            const id = (rule.skin === 'tropical-fallback') ? 'candy' : rule.skin;
            return SKINS[id] ? { ...rule, skin: id } : null;
        }
    }
    return null;
}

/* -----------------------------------------------------------
 * 主入口：在 game.init() 完成后调用
 * 1. 节日推荐 — 弹 toast + 询问用户切换（每日仅一次）
 * 2. 时段推荐 — 仅当用户从未主动选过皮肤时生效，悄悄切换
 * --------------------------------------------------------- */
export function applySeasonalRecommendation(opts = {}) {
    const { game = null, toast = null, audio = null } = opts;
    const today = _ymd();
    const state = _readSeasonal();

    // 4.1 已在 applyAprilFoolsIfActive 内处理，这里跳过节日推荐
    if (isAprilFools()) {
        if (state.lastShown !== today) {
            _showToast(toast, '愚人节快乐！今天的方块全是表情');
            state.lastShown = today;
            _writeSeasonal(state);
        }
        return { reason: 'aprilFools', recommended: null };
    }

    const userChosen = _readStorage(USER_CHOSEN_KEY) === '1';
    const fest = _matchFestival();

    if (fest) {
        if (state.lastShown !== today && SKINS[fest.skin]) {
            const currentId = getActiveSkinId();
            // 已在节日皮肤上则不打扰
            if (currentId !== fest.skin) {
                _showToast(toast, fest.msg, {
                    actionLabel: '切换',
                    onAction: () => {
                        setActiveSkinId(fest.skin);
                        if (game?.renderer) game.renderer.markBackgroundDirty?.();
                        try { audio?.play?.('unlock'); } catch { /* ignore */ }
                    },
                });
            }
            state.lastShown = today;
            _writeSeasonal(state);
        }
        return { reason: 'festival', recommended: fest.skin };
    }

    // 仅当用户没主动选过皮肤时，按时段提供动态默认体验
    if (!userChosen) {
        const tod = _matchTimeOfDay();
        if (tod && SKINS[tod.skin]) {
            const currentId = getActiveSkinId();
            if (currentId !== tod.skin) {
                setActiveSkinId(tod.skin);
                if (game?.renderer) game.renderer.markBackgroundDirty?.();
            }
            return { reason: 'timeOfDay', recommended: tod.skin };
        }
    }

    return { reason: 'none', recommended: null };
}

/** 由 setActiveSkinId 在用户主动切换皮肤时调用，关闭时段动态切换 */
export function markSkinUserChosen() {
    _writeStorage(USER_CHOSEN_KEY, '1');
}

/* -----------------------------------------------------------
 * v10.16: 周末活动皮肤（每周末发 48h 试穿券）
 * --------------------------------------------------------- */
const WEEKEND_SKIN_POOL = ['forbidden', 'mahjong', 'fairy', 'demon', 'aurora', 'industrial'];

export function applyWeekendActivityIfEligible(opts = {}) {
    const d = new Date();
    const dow = d.getDay();
    if (dow !== 6 && dow !== 0) return null;       // 仅周六 / 周日

    const ymdW = `${d.getFullYear()}-W${_isoWeek(d)}`;
    const state = _safeJson(_readStorage(WEEKEND_TRIAL_KEY)) || {};
    if (state[ymdW]) return null;                  // 本周已发过

    const pool = WEEKEND_SKIN_POOL.filter(id => SKINS[id]);
    if (!pool.length) return null;
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    state[ymdW] = chosen;
    _writeStorage(WEEKEND_TRIAL_KEY, JSON.stringify(state));

    /* 通过 wallet 发 48h 试穿券 */
    try {
        // 延迟 import 避免循环依赖（seasonalSkin → wallet → skinTransition → skins）
        import('./skills/wallet.js').then(({ getWallet }) => {
            getWallet().addTrial(chosen, 48);
        }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }

    if (typeof opts.toast === 'function') {
        opts.toast(`周末特惠 — ${SKINS[chosen]?.name || chosen} 皮肤可免费试穿 48h`);
    } else {
        _showWeekendToast(chosen);
    }
    return { skinId: chosen };
}

function _isoWeek(d) {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}
function _safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function _showWeekendToast(skinId) {
    if (typeof document === 'undefined') return;
    const id = 'seasonal-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.innerHTML = `<span class="seasonal-toast__text">🎉 周末活动 — ${SKINS[skinId]?.name || skinId} 试穿 48h</span>`;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 7000);
}

/* -----------------------------------------------------------
 * v10.16: 生日皮肤（注册生日当天送 24h 试穿券）
 * 用户首次进入游戏 / 设置面板提示绑定生日（非强制）
 * --------------------------------------------------------- */
function _setUserBirthday(monthDay) {
    /* monthDay 形如 'MM-DD'（不存年份避免隐私） */
    if (!/^\d{2}-\d{2}$/.test(monthDay || '')) return false;
    _writeStorage(BIRTHDAY_KEY, monthDay);
    return true;
}
function _getUserBirthday() {
    return _readStorage(BIRTHDAY_KEY);
}

export function applyBirthdayIfEligible() {
    const md = _readStorage(BIRTHDAY_KEY);
    if (!md) return null;
    const d = new Date();
    const today = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (today !== md) return null;

    const state = _readSeasonal();
    if (state.birthdayClaimedYear === d.getFullYear()) return null;
    state.birthdayClaimedYear = d.getFullYear();
    _writeSeasonal(state);

    /* 生日大礼：candy 皮肤 24h 试穿 + 5 提示券 + 1 彩虹 */
    try {
        import('./skills/wallet.js').then(({ getWallet }) => {
            const wallet = getWallet();
            wallet.addTrial('candy', 24);
            wallet.addBalance('hintToken', 5, 'birthday');
            wallet.addBalance('rainbowToken', 1, 'birthday');
        }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }

    _showBirthdayToast();
    return { skinId: 'candy' };
}

function _showBirthdayToast() {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    el.textContent = '🎂 生日快乐！糖果皮肤试穿 24h + 5 提示券 + 1 彩虹';
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 6000);
}

/* -----------------------------------------------------------
 * 简易 toast（不依赖任何 UI 库，main.css 中已有 #seasonal-toast 样式）
 * --------------------------------------------------------- */
function _showToast(injected, msg, opts = {}) {
    if (typeof injected === 'function') {
        injected(msg, opts);
        return;
    }
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
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 8000);
}

/* 测试可用导出 */
export const __test_only__ = { FESTIVAL_RULES, TIME_OF_DAY_RULES, APRIL_FOOLS_ICONS };
