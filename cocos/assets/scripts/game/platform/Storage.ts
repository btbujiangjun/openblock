import { sys } from 'cc';

/**
 * 跨平台持久化适配（Phase 4）。sys.localStorage 在 Web / iOS / Android / 微信小游戏
 * 均可用，屏蔽各端差异。后续可在此接 SQLite / 云存档。
 */
export const Storage = {
    get(key: string, fallback: string | null = null): string | null {
        try {
            const v = sys.localStorage.getItem(key);
            return v === null || v === undefined ? fallback : v;
        } catch {
            return fallback;
        }
    },
    set(key: string, value: string): void {
        try {
            sys.localStorage.setItem(key, value);
        } catch {
            /* ignore */
        }
    },
    getNumber(key: string, fallback = 0): number {
        const v = this.get(key);
        const n = v == null ? NaN : Number(v);
        return Number.isFinite(n) ? n : fallback;
    },
    setNumber(key: string, value: number): void {
        this.set(key, String(value));
    },
    getJSON<T>(key: string, fallback: T): T {
        const v = this.get(key);
        if (v == null) return fallback;
        try {
            return JSON.parse(v) as T;
        } catch {
            return fallback;
        }
    },
    setJSON(key: string, value: unknown): void {
        try {
            this.set(key, JSON.stringify(value));
        } catch {
            /* ignore */
        }
    },
};

export const STORAGE_KEYS = {
    best: 'openblock_cocos_best_v1',
    skin: 'openblock_cocos_skin_v1',
    save: 'openblock_cocos_save_v1',
    coins: 'openblock_cocos_coins_v1',
    meta: 'openblock_cocos_meta_v1',
    mode: 'openblock_cocos_mode_v1',
    progression: 'openblock_cocos_prog_v1',
    achievements: 'openblock_cocos_ach_v1',
    season: 'openblock_cocos_season_v1',
    daily: 'openblock_cocos_daily_v1',
    leaderboard: 'openblock_cocos_lb_v1',
    cloudQueue: 'openblock_cocos_cloudq_v1',
    lastSeen: 'openblock_cocos_lastseen_v1',
    firstLaunch: 'openblock_cocos_first_v1',
    sound: 'openblock_cocos_sound_v1',
    locale: 'openblock_cocos_locale_v1',
    stats: 'openblock_cocos_stats_v1',
    chest: 'openblock_cocos_chest_v1',
    aprilFoolsOptout: 'openblock_cocos_aprilfools_optout_v1',
    companion: 'openblock_cocos_companion_v1',
    replays: 'openblock_cocos_replays_v1',
};
