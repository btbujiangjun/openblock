/**
 * 云存档 + 离线队列（Phase P2）。
 *
 * 写：本地立即落盘 + 入离线队列；在线时 flush 到云（微信 wx.setUserCloudStorage /
 * 你的 HTTP API）。读：取云端与本地中 best 较大者（简单冲突合并：以 best/score 为准）。
 * 任何端不可用时纯本地，保证健壮。
 */
import { Storage, STORAGE_KEYS } from './Storage';

export interface CloudPayload {
    best: number;
    coins: number;
    save: unknown;
    ts: number;
}

interface WxCloudApi {
    setUserCloudStorage?: (opts: { KVDataList: Array<{ key: string; value: string }>; success?: () => void; fail?: () => void }) => void;
    getUserCloudStorage?: (opts: { keyList: string[]; success?: (r: { KVDataList: Array<{ key: string; value: string }> }) => void; fail?: () => void }) => void;
}

function wx(): WxCloudApi | null {
    return (globalThis as unknown as { wx?: WxCloudApi }).wx ?? null;
}

function online(): boolean {
    const nav = (globalThis as unknown as { navigator?: { onLine?: boolean } }).navigator;
    return nav?.onLine !== false; // 未知时默认在线
}

export const CloudSync = {
    /** 入队 + 落本地 + 尝试 flush。 */
    push(payload: CloudPayload): void {
        Storage.setJSON(STORAGE_KEYS.cloudQueue, payload); // 最新一份即可（幂等覆盖）
        if (online()) this.flush();
    },

    flush(): void {
        const payload = Storage.getJSON<CloudPayload | null>(STORAGE_KEYS.cloudQueue, null);
        if (!payload) return;
        const api = wx();
        if (api?.setUserCloudStorage) {
            try {
                api.setUserCloudStorage({
                    KVDataList: [
                        { key: 'best', value: String(payload.best) },
                        { key: 'blob', value: JSON.stringify(payload) },
                    ],
                    success: () => Storage.set(STORAGE_KEYS.cloudQueue, ''),
                    fail: () => { /* 保留队列下次重试 */ },
                });
            } catch { /* ignore */ }
            return;
        }
        // 非微信：此处可接入 HTTP API；当前视为已同步（清队列）
        Storage.set(STORAGE_KEYS.cloudQueue, '');
    },

    /** 拉取云端，回调返回需要合并的 payload（取较大 best）。 */
    pull(cb: (cloud: CloudPayload | null) => void): void {
        const api = wx();
        if (api?.getUserCloudStorage) {
            try {
                api.getUserCloudStorage({
                    keyList: ['blob'],
                    success: (r) => {
                        const kv = r.KVDataList?.find((k) => k.key === 'blob');
                        if (!kv) return cb(null);
                        try { cb(JSON.parse(kv.value) as CloudPayload); } catch { cb(null); }
                    },
                    fail: () => cb(null),
                });
            } catch { cb(null); }
            return;
        }
        cb(null);
    },
};
