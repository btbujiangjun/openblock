import { ReplayData } from '../../core';
import { Storage, STORAGE_KEYS } from './Storage';

/** 本地保存的最大回放条数（最新优先，超出丢弃最旧）。 */
const MAX_REPLAYS = 12;

/** 回放本地存档（Storage 支撑，按时间倒序、容量上限）。 */
export const ReplayStore = {
    list(): ReplayData[] {
        const arr = Storage.getJSON<ReplayData[]>(STORAGE_KEYS.replays, []);
        return Array.isArray(arr) ? arr : [];
    },
    save(data: ReplayData | null): void {
        if (!data) return;
        const arr = this.list();
        arr.unshift(data);
        if (arr.length > MAX_REPLAYS) arr.length = MAX_REPLAYS;
        Storage.setJSON(STORAGE_KEYS.replays, arr);
    },
    clear(): void {
        Storage.setJSON(STORAGE_KEYS.replays, []);
    },
};
