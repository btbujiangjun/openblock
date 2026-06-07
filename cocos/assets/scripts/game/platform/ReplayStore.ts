import { ReplayData, upgradeReplay } from '../../core';
import { Storage, STORAGE_KEYS } from './Storage';

/** 本地保存的最大回放条数（最新优先，超出丢弃最旧）。 */
const MAX_REPLAYS = 12;

/**
 * 回放本地存档（Storage 支撑，按时间倒序、容量上限）。
 *
 * 写入失败时（Storage 抛 QuotaExceededError 等）：
 *  1. 先把最旧的一条删掉再试，给"超容量"提供一次自动清理机会。
 *  2. 若仍失败，由 Storage 层的 writeErrorHandler 飘字提示玩家，本次回放放弃但不影响游戏。
 *
 * 读取时统一走 `upgradeReplay`：旧版本（无 version、无 snapshot kind 的 v1）会被升到当前结构；
 * 完全损坏/非回放对象会被丢弃而非崩溃，避免一条坏存档拖垮整个列表。
 */
export const ReplayStore = {
    list(): ReplayData[] {
        const raw = Storage.getJSON<unknown[]>(STORAGE_KEYS.replays, []);
        if (!Array.isArray(raw)) return [];
        const out: ReplayData[] = [];
        for (const r of raw) {
            const up = upgradeReplay(r);
            if (up) out.push(up);
        }
        return out;
    },
    save(data: ReplayData | null): boolean {
        if (!data) return false;
        const arr = this.list();
        arr.unshift(data);
        if (arr.length > MAX_REPLAYS) arr.length = MAX_REPLAYS;
        if (Storage.setJSON(STORAGE_KEYS.replays, arr)) return true;
        // 第一次失败：剪半再试，给"配额接近上限"留一次自救机会。
        const trimmed = arr.slice(0, Math.max(1, Math.floor(arr.length / 2)));
        return Storage.setJSON(STORAGE_KEYS.replays, trimmed);
    },
    clear(): void {
        Storage.setJSON(STORAGE_KEYS.replays, []);
    },
};
