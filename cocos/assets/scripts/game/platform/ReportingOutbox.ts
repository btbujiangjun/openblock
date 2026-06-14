/**
 * ReportingOutbox.ts — Cocos 上报发件箱（无网络本地缓存 + 联网批量上报）
 *
 * 与 web/src/net/reportingOutbox.js、miniprogram/utils/reportingOutbox.js **同配置 · 同协议**：
 *   - behavior：玩家行为 → POST /api/behavior/batch
 *   - ad：广告按次计费   → POST /api/ad/impression
 *
 * 统一配置格式（见 shared/client_net_config.json）：
 *   { apiBase, platform, appVersion, enabled, flushIntervalMs, batchSize, maxQueue,
 *     maxRetryBackoffMs, channels }
 * 每条记录盖 envelope（platform/app_version），批次级 meta 同样带 platform/app_version，
 * 供后端按端做分端统计。
 *
 * Cocos 特性：
 *   - 持久化：sys.localStorage（Web / iOS / Android / 微信小游戏皆可用）；
 *   - 传输：XMLHttpRequest；每条带 event_id（服务端去重），上报成功才出队（at-least-once）；
 *   - 纯失败指数退避（仅作用于周期触发）。
 *
 * 由 Bootstrap 注入 apiBase/platform/appVersion（未配置→仅本地缓存、不上报）。
 */
import { sys } from 'cc';

type Channel = 'behavior' | 'ad';

const KEY_PREFIX = 'openblock_outbox_';
const PATHS: Record<Channel, string> = {
    behavior: '/api/behavior/batch',
    ad: '/api/ad/impression',
};

const DEFAULTS = {
    flushIntervalMs: 15000,
    batchSize: 200,
    maxQueue: 1000,
    maxRetryBackoffMs: 120000,
    platform: 'cocos',
    appVersion: '0.0.0',
};

let _apiBase = '';
let _enabled = false;
let _userId = '';
let _platform = DEFAULTS.platform;
let _appVersion = DEFAULTS.appVersion;
let _flushIntervalMs = DEFAULTS.flushIntervalMs;
let _batchSize = DEFAULTS.batchSize;
let _maxQueue = DEFAULTS.maxQueue;
let _maxRetryBackoffMs = DEFAULTS.maxRetryBackoffMs;
let _timer: ReturnType<typeof setInterval> | null = null;
let _flushing = false;
let _failStreak = 0;
let _backoffUntil = 0;

function key(channel: Channel): string { return KEY_PREFIX + channel; }

function load(channel: Channel): Array<Record<string, unknown>> {
    try {
        const raw = sys.localStorage.getItem(key(channel));
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function save(channel: Channel, list: Array<Record<string, unknown>>): void {
    try { sys.localStorage.setItem(key(channel), JSON.stringify(list)); } catch { /* ignore */ }
}

function genId(channel: Channel): string {
    return `${channel}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function enqueue(channel: Channel, record: Record<string, unknown>): void {
    const list = load(channel);
    const rec = { ...record };
    if (!rec.event_id) rec.event_id = genId(channel);
    if (rec.platform == null) rec.platform = _platform;           // 分端统计
    if (rec.app_version == null) rec.app_version = _appVersion;
    if (rec.ts == null && rec.timestamp == null) rec.ts = Date.now();
    list.push(rec);
    if (list.length > _maxQueue) list.splice(0, list.length - _maxQueue);
    save(channel, list);
}

function flushChannel(channel: Channel): Promise<{ sent: number; error?: boolean }> {
    return new Promise((resolve) => {
        const list = load(channel);
        if (!list.length) { resolve({ sent: 0 }); return; }
        const batch = list.slice(0, _batchSize);
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${_apiBase}${PATHS[channel]}`, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 8000;
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    const sent: Record<string, boolean> = {};
                    batch.forEach((r) => { sent[r.event_id as string] = true; });
                    save(channel, load(channel).filter((r) => !sent[r.event_id as string]));
                    resolve({ sent: batch.length });
                } else {
                    resolve({ sent: 0, error: true });
                }
            };
            xhr.onerror = () => resolve({ sent: 0, error: true });
            xhr.ontimeout = () => resolve({ sent: 0, error: true });
            xhr.send(JSON.stringify({ platform: _platform, app_version: _appVersion, events: batch }));
        } catch { resolve({ sent: 0, error: true }); }
    });
}

export const ReportingOutbox = {
    configure(opts: {
        apiBase: string; userId?: string; platform?: string; appVersion?: string;
        flushIntervalMs?: number; batchSize?: number; maxQueue?: number; maxRetryBackoffMs?: number;
    }): void {
        _apiBase = (opts.apiBase || '').replace(/\/+$/, '');
        _userId = opts.userId || '';
        _platform = opts.platform || DEFAULTS.platform;
        _appVersion = opts.appVersion || DEFAULTS.appVersion;
        _flushIntervalMs = opts.flushIntervalMs || DEFAULTS.flushIntervalMs;
        _batchSize = opts.batchSize || DEFAULTS.batchSize;
        _maxQueue = opts.maxQueue || DEFAULTS.maxQueue;
        _maxRetryBackoffMs = opts.maxRetryBackoffMs || DEFAULTS.maxRetryBackoffMs;
        _enabled = !!_apiBase;
        _failStreak = 0;
        _backoffUntil = 0;
        if (_timer) { clearInterval(_timer); _timer = null; }
        if (_enabled) {
            _timer = setInterval(() => {
                if (Date.now() < _backoffUntil) return;   // 退避：纯失败时不空打
                void this.flush();
            }, _flushIntervalMs);
            void this.flush();
        }
    },

    get userId(): string { return _userId; },
    get enabled(): boolean { return _enabled; },
    get platform(): string { return _platform; },

    /** 行为事件入队（始终本地缓存）。 */
    behavior(eventType: string, data: Record<string, unknown> = {}, sessionId = ''): void {
        enqueue('behavior', {
            event_type: eventType,
            user_id: _userId,
            session_id: sessionId,
            data,
            platform: _platform,
            app_version: _appVersion,
            timestamp: Date.now(),
        });
    },

    /** 广告按次计费回流入队（始终本地缓存）。 */
    ad(kind: 'rewarded' | 'interstitial', revenueMinor: number, filled: boolean, completed: boolean): void {
        enqueue('ad', {
            user_id: _userId,
            kind,
            filled,
            completed,
            revenue_minor: revenueMinor,
            platform: _platform,
            app_version: _appVersion,
            ts: Date.now(),
        });
    },

    async flush(): Promise<void> {
        if (!_enabled || _flushing) return;
        _flushing = true;
        let anyError = false;
        let anySent = false;
        try {
            const r1 = await flushChannel('behavior');
            const r2 = await flushChannel('ad');
            anyError = !!(r1.error || r2.error);
            anySent = !!(r1.sent || r2.sent);
        } finally {
            _flushing = false;
        }
        if (anySent || !anyError) {
            _failStreak = 0;
            _backoffUntil = 0;
        } else if (anyError) {
            _failStreak += 1;
            const wait = Math.min(_maxRetryBackoffMs, _flushIntervalMs * Math.pow(2, Math.min(_failStreak, 6)));
            _backoffUntil = Date.now() + wait;
        }
    },
};
