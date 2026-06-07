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

    /** 可选：注入 HTTP 上传适配器（壳工程在 Bootstrap 注册）；返回 Promise<boolean> 表示是否成功。 */
    httpUpload: null as ((payload: CloudPayload) => Promise<boolean>) | null,
    httpDownload: null as (() => Promise<CloudPayload | null>) | null,

    /**
     * 用一对 GET/POST endpoint 配置默认 HTTP 适配器。一行接入：
     *
     *   CloudSync.configureHttp({ base: 'https://api.example.com/cloud', userId: 'u123' });
     *
     * 协议假设（与最简后端约定）：
     *   GET  {base}/{userId}     → 200 application/json: CloudPayload | {} → 解析失败按 null
     *   POST {base}/{userId}     → 2xx 视为成功；非 2xx 保留离线队列
     *
     * 可传 `headers` 注入鉴权（如 `{ Authorization: 'Bearer xxx' }`）。
     * 任意一端 `globalThis.fetch` 不可用（旧引擎 / 微信小游戏）→ 不安装适配器，自动退回纯本地。
     */
    configureHttp(opts: { base: string; userId: string; headers?: Record<string, string>; timeoutMs?: number }): void {
        const f = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
        if (typeof f !== 'function') return;
        const base = opts.base.replace(/\/$/, '');
        const url = `${base}/${encodeURIComponent(opts.userId)}`;
        const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
        const timeoutMs = Math.max(500, opts.timeoutMs ?? 8000);

        // AbortController 在所有引擎/浏览器都可用；不可用时降级为无超时。
        const ctrl = (): AbortController | null => {
            try { return new AbortController(); } catch { return null; }
        };

        this.httpUpload = async (payload) => {
            const ac = ctrl();
            const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
            try {
                const res = await f(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                    signal: ac?.signal,
                });
                return res.ok;
            } catch {
                return false;
            } finally {
                if (timer) clearTimeout(timer);
            }
        };

        this.httpDownload = async () => {
            const ac = ctrl();
            const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
            try {
                const res = await f(url, { method: 'GET', headers, signal: ac?.signal });
                if (!res.ok) return null;
                const txt = await res.text();
                if (!txt) return null;
                try {
                    const j = JSON.parse(txt) as Partial<CloudPayload> | null;
                    if (!j || typeof j !== 'object') return null;
                    return {
                        best: typeof j.best === 'number' ? j.best : 0,
                        coins: typeof j.coins === 'number' ? j.coins : 0,
                        save: j.save ?? null,
                        ts: typeof j.ts === 'number' ? j.ts : 0,
                    };
                } catch { return null; }
            } catch {
                return null;
            } finally {
                if (timer) clearTimeout(timer);
            }
        };
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
        // 非微信：优先走外部注入的 HTTP 适配器；
        // 若未注入，则保留队列（之前实现「视为成功」会静默丢档），等接入后下次 flush 再上传。
        if (this.httpUpload) {
            this.httpUpload(payload).then((ok) => {
                if (ok) Storage.set(STORAGE_KEYS.cloudQueue, '');
            }).catch(() => { /* keep queue */ });
        }
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
        // 非微信 + 已注入 HTTP 拉取：走外部适配器；否则返回 null（纯本地）。
        if (this.httpDownload) {
            this.httpDownload().then((p) => cb(p)).catch(() => cb(null));
            return;
        }
        cb(null);
    },
};
