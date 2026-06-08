/**
 * 季节推荐（移植 web `seasonalSkin.js` 的节日 / 周末 / 生日逻辑，引擎无关取数）。
 *
 * 仅负责「判定 + 反打扰持久化」，返回描述符；副作用（发放试穿券 / 切换皮肤 / 弹 toast）由 GameController 执行
 * （那里才有 wallet / applySkin / Toast 的访问）。与 web 对齐：
 *  - 节日：今日命中且当日未弹过 → 提示切换对应皮肤（每日一次）。
 *  - 周末：周六/日且本 ISO 周未发 → 随机皮肤 48h 试穿券。
 *  - 生日：'MM-DD' 命中且本年未领 → candy 24h 试穿 + 提示券礼包。
 *
 * 反打扰状态：seasonal（{lastShown, birthdayClaimedYear}）/ weekendTrial（{ '2026-W23': skinId }）。
 */
import { listSkinIds } from '../../core';
import { Storage, STORAGE_KEYS } from '../platform/Storage';

interface SeasonalState { lastShown?: string; birthdayClaimedYear?: number; }

function ymd(d = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** 节日表（公历 + 农历近似，覆盖 2026-2028；皮肤 id 必须存在于 cocos SKINS，缺失项在匹配时跳过）。 */
const FESTIVAL_RULES: Array<{ name: string; month?: number; day?: number; dates?: string[]; skin: string; msg: string }> = [
    { name: '元旦', month: 1, day: 1, skin: 'sakura', msg: '新年好——粉色樱花皮肤已就位' },
    { name: '春节', dates: ['2026-02-17', '2027-02-06', '2028-01-26'], skin: 'forbidden', msg: '春节大吉——故宫禁城皮肤已就位' },
    { name: '元宵节', dates: ['2026-03-03', '2027-02-21', '2028-02-09'], skin: 'mahjong', msg: '元宵团圆——麻将牌局皮肤已就位' },
    { name: '情人节', month: 2, day: 14, skin: 'candy', msg: '情人节快乐——糖果皮肤已就位' },
    { name: '清明', dates: ['2026-04-05', '2027-04-05', '2028-04-04'], skin: 'forest', msg: '清明时节——森林皮肤已就位' },
    { name: '端午节', dates: ['2026-06-19', '2027-06-09', '2028-05-28'], skin: 'koi', msg: '端午安康——锦鲤皮肤已就位' },
    { name: '中秋节', dates: ['2026-09-25', '2027-09-15', '2028-10-03'], skin: 'koi', msg: '中秋月满——锦鲤池塘皮肤已就位' },
    { name: '国庆节', month: 10, day: 1, skin: 'forbidden', msg: '国庆快乐——故宫禁城皮肤已就位' },
    { name: '万圣节', month: 10, day: 31, skin: 'demon', msg: '万圣节特别版——魔幻血赤皮肤已就位' },
    { name: '感恩节', dates: ['2026-11-26', '2027-11-25', '2028-11-23'], skin: 'farm', msg: '感恩节——田园农庄皮肤已就位' },
    { name: '圣诞节', month: 12, day: 25, skin: 'fairy', msg: '圣诞快乐——奇幻仙境皮肤已就位' },
    { name: '跨年夜', month: 12, day: 31, skin: 'aurora', msg: '跨年夜——极光皮肤已就位' },
];

const WEEKEND_SKIN_POOL = ['forbidden', 'mahjong', 'fairy', 'demon', 'aurora', 'industrial'];

function readSeasonal(): SeasonalState {
    return Storage.getJSON<SeasonalState>(STORAGE_KEYS.seasonal, {}) || {};
}
function writeSeasonal(s: SeasonalState): void {
    Storage.setJSON(STORAGE_KEYS.seasonal, s);
}

function isoWeek(d: Date): string {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${week}`;
}

export interface FestivalRec { skin: string; msg: string; }

/**
 * 若今日命中节日、当日未弹过、且对应皮肤存在 → 标记当日已弹并返回 {skin, msg}；否则 null。
 * 调用方：若当前已是该皮肤可不显「切换」按钮（自行判断）。
 */
export function consumeFestivalRecommendation(now = new Date()): FestivalRec | null {
    const m = now.getMonth() + 1;
    const dd = now.getDate();
    const today = ymd(now);
    let hit: { skin: string; msg: string } | null = null;
    for (const r of FESTIVAL_RULES) {
        if (r.dates && r.dates.includes(today)) { hit = { skin: r.skin, msg: r.msg }; break; }
        if (r.month === m && r.day === dd) { hit = { skin: r.skin, msg: r.msg }; break; }
    }
    if (!hit) return null;
    if (!listSkinIds().includes(hit.skin)) return null;
    const state = readSeasonal();
    if (state.lastShown === today) return null;
    state.lastShown = today;
    writeSeasonal(state);
    return hit;
}

export interface WeekendRec { skinId: string; hours: number; }

/** 周六/日且本 ISO 周未发 → 标记并返回随机周末皮肤 48h 试穿；否则 null。 */
export function consumeWeekendTrial(now = new Date()): WeekendRec | null {
    const dow = now.getDay();
    if (dow !== 6 && dow !== 0) return null;
    const wk = isoWeek(now);
    const state = Storage.getJSON<Record<string, string>>(STORAGE_KEYS.weekendTrial, {}) || {};
    if (state[wk]) return null;
    const pool = WEEKEND_SKIN_POOL.filter((id) => listSkinIds().includes(id));
    if (!pool.length) return null;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    state[wk] = chosen;
    Storage.setJSON(STORAGE_KEYS.weekendTrial, state);
    return { skinId: chosen, hours: 48 };
}

export interface BirthdayRec { skinId: string; hours: number; hintTokens: number; rainbowTokens: number; }

/** 生日 'MM-DD' 命中且本年未领 → 标记并返回生日礼包（candy 24h + 5 提示 + 1 彩虹）；否则 null。 */
export function consumeBirthdayGift(now = new Date()): BirthdayRec | null {
    const md = Storage.get(STORAGE_KEYS.birthday, null);
    if (!md) return null;
    const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (today !== md) return null;
    const state = readSeasonal();
    if (state.birthdayClaimedYear === now.getFullYear()) return null;
    if (!listSkinIds().includes('candy')) return null;
    state.birthdayClaimedYear = now.getFullYear();
    writeSeasonal(state);
    return { skinId: 'candy', hours: 24, hintTokens: 5, rainbowTokens: 1 };
}
