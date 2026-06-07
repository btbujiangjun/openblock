import { sys } from 'cc';

/**
 * 跨平台持久化适配（Phase 4）。sys.localStorage 在 Web / iOS / Android / 微信小游戏
 * 均可用，屏蔽各端差异。后续可在此接 SQLite / 云存档。
 *
 * 写失败时（配额满 / 存档被禁 / 微信沙箱异常）会通过 onWriteError hook 上抛一次，
 * 让 UI 层（GameController）通过 fx.floatText 提示玩家"存档失败"，避免静默丢档。
 */
type WriteErrorHandler = (key: string, err: unknown) => void;
let _onWriteError: WriteErrorHandler | null = null;
/** 简单去抖：30 秒内同一 key 的多次失败只通知一次，避免事件 spam。 */
const _lastErrTs: Record<string, number> = {};
const ERR_NOTIFY_THROTTLE_MS = 30000;

function notifyWriteError(key: string, err: unknown): void {
    if (!_onWriteError) return;
    const now = Date.now();
    if (now - (_lastErrTs[key] || 0) < ERR_NOTIFY_THROTTLE_MS) return;
    _lastErrTs[key] = now;
    try { _onWriteError(key, err); } catch { /* ignore */ }
}

export function setStorageWriteErrorHandler(fn: WriteErrorHandler | null): void {
    _onWriteError = fn;
}

export const Storage = {
    get(key: string, fallback: string | null = null): string | null {
        try {
            const v = sys.localStorage.getItem(key);
            return v === null || v === undefined ? fallback : v;
        } catch {
            return fallback;
        }
    },
    set(key: string, value: string): boolean {
        try {
            sys.localStorage.setItem(key, value);
            return true;
        } catch (err) {
            notifyWriteError(key, err);
            return false;
        }
    },
    getNumber(key: string, fallback = 0): number {
        const v = this.get(key);
        const n = v == null ? NaN : Number(v);
        return Number.isFinite(n) ? n : fallback;
    },
    setNumber(key: string, value: number): boolean {
        return this.set(key, String(value));
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
    setJSON(key: string, value: unknown): boolean {
        try {
            return this.set(key, JSON.stringify(value));
        } catch (err) {
            notifyWriteError(key, err);
            return false;
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
    seasonChest: 'openblock_cocos_season_chest_v1',
    aprilFoolsOptout: 'openblock_cocos_aprilfools_optout_v1',
    companion: 'openblock_cocos_companion_v1',
    replays: 'openblock_cocos_replays_v1',
    wheelFreeUsedDate: 'openblock_cocos_wheel_free_date_v1',
    haptics: 'openblock_cocos_haptics_v1',
    visualFx: 'openblock_visualfx_v1',
    reduceMotion: 'openblock_cocos_reduce_motion_v1',
};
