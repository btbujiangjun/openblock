/**
 * 每日大师题（移植 web `social/dailyMaster.js`）：全网同种子（基于 ymd 的 FNV-1a hash）的专题局，
 * 让玩家在相同盘面 / 同序出块下比拼，每日仅可挑战一次。
 *
 * 种子注入：挑战进行时持有一个 `mulberry32(fnv1a(ymd))` PRNG；engineSpawn 通过注入的 `getSeedRandom`
 * 在每次出块体内临时把 `Math.random` 替换为它（几何 + 配色都走 Math.random → 盘面全确定），用完还原。
 *
 * 这是一个无状态单例管理器（与 Modal/Toast 风格一致），副作用（开局 / 结算 / 提交榜单）由 GameController 调用。
 */
import { createMulberry32, fnv1a } from '../../core';
import { Storage, STORAGE_KEYS } from '../platform/Storage';

function ymd(d = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface DailyMasterState { [ymd: string]: { played: boolean; score: number; ts: number } }

export const DailyMaster = {
    _active: null as (() => number) | null,

    /** 注入给 engineSpawn 的种子源：挑战进行时返回日固定 PRNG，否则 null。 */
    activeRandom(): (() => number) | null {
        return this._active;
    },

    /** 今日种子（uint32），用于展示（base36）。 */
    seedToday(): number {
        return fnv1a(ymd());
    },

    isPlayedToday(): boolean {
        const s = Storage.getJSON<DailyMasterState>(STORAGE_KEYS.dailyMaster, {}) || {};
        return s[ymd()]?.played === true;
    },

    /** 开始挑战：建立今日固定 PRNG（之后 engineSpawn 出块即确定）。返回今日种子。 */
    begin(): number {
        const seed = fnv1a(ymd());
        this._active = createMulberry32(seed);
        return seed;
    },

    /** 结束挑战：撤销种子源（恢复正常随机）。 */
    end(): void {
        this._active = null;
    },

    isActive(): boolean {
        return this._active != null;
    },

    /** 记录今日战绩（每日一次去重的依据）。 */
    markPlayed(score: number): void {
        const s = Storage.getJSON<DailyMasterState>(STORAGE_KEYS.dailyMaster, {}) || {};
        s[ymd()] = { played: true, score: score | 0, ts: Date.now() };
        Storage.setJSON(STORAGE_KEYS.dailyMaster, s);
    },
};
