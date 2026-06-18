/**
 * reportingOutbox.js — 上报发件箱（Web/Cocos：无网络本地缓存 + 联网批量上报）
 *
 * 统一承载两类「先落本地、再联网上报」的数据：
 *   - behavior：玩家行为事件 → POST /api/behavior/batch
 *   - ad：广告按次计费回流   → POST /api/ad/impression
 *
 * 特性：
 *   - 统一配置格式（netConfig.resolveNetConfig，全端同字段）；
 *   - 持久化队列（localStorage，按 channel 分桶），断电/刷新不丢；
 *   - 每条带 event_id（服务端去重）+ envelope（platform/app_version，供后端分端统计）；
 *   - 批次级 meta 同样带 platform/app_version；上报成功才出队（at-least-once）；
 *   - 周期 flush + `online` 事件触发 + 初始化即尝试一次；
 *   - 失败指数退避（仅作用于周期触发，显式 flush() 不退避）；
 *   - 队列上限（FIFO 丢弃最旧），防止离线无限增长。
 *
 * Cocos 复用本模块（运行时具备 localStorage + fetch）；小程序见
 * miniprogram/utils/reportingOutbox.js（wx API 版，同配置/同协议）。
 */

import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';
import { resolveNetConfig } from './netConfig.js';

const KEY_PREFIX = 'openblock_outbox_';

let _cfg = resolveNetConfig();
let _timer = null;
let _flushing = false;
let _failStreak = 0;
let _backoffUntil = 0;

function _key(channel) { return KEY_PREFIX + channel; }

/* v1.71 W5：channel hot cache —— 避免 enqueue 时每次都 JSON.parse 整个队列。
 *
 * 契约：`断电/刷新不丢`（模块顶注释）→ 必须同步写 LS，**不可节流**。
 * 但同步**读** LS（JSON.parse 整 list）可以省掉：只要 enqueue/pop 路径
 * 都通过本 cache 做单一真理源，cache 与 LS 永远同步。
 *
 * cache miss 时（首次访问 / __resetForTest 后）回退到 _loadFromLS。
 * cache 与 LS 强一致：所有写操作（enqueue / _flushChannel 移除）都走
 * _writeChannel(list) 同步更新两端。 */
const _channelCache = new Map();

function _loadFromLS(channel) {
    try {
        const raw = localStorage.getItem(_key(channel));
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function _load(channel) {
    let list = _channelCache.get(channel);
    if (list === undefined) {
        list = _loadFromLS(channel);
        _channelCache.set(channel, list);
    }
    return list;
}

/* GG3：quota 应对统计。LS 5MB 触顶时，旧版本仅 catch ignore，导致
 * cache 与 LS 静默不一致（cache 仍含最新记录，LS 还是旧的），重启
 * 后丢数。新策略：写失败时主动丢弃队列尾部 30%（FIFO 保留最旧—
 * 防止"上报失败的"和"刚入队的"混杂导致永远写不进），重试一次。
 * 三次失败仍走 catch ignore（避免无限循环）；统计上报让运维侧
 * 看到 quota 健康度。 */
const _outboxStats = {
    quotaTrips: 0,         // 累计 LS 写失败次数
    quotaShedRecords: 0,   // 累计因 quota 主动丢弃的记录数
    lastQuotaReason: '',   // 最近一次失败原因（仅 message 短截）
};

function _writeChannel(channel, list) {
    _channelCache.set(channel, list);
    let toWrite = list;
    let attempt = 0;
    while (attempt < 3) {
        try {
            localStorage.setItem(_key(channel), JSON.stringify(toWrite));
            return;
        } catch (e) {
            _outboxStats.quotaTrips++;
            _outboxStats.lastQuotaReason = String(e?.message || e?.name || 'unknown').slice(0, 60);
            /* 丢弃尾部 30% 后再试。保留最旧记录的契约：服务端去重靠 event_id，
             * 让 FIFO 头部"老但稳定"的记录优先入库。 */
            const dropCount = Math.max(1, Math.floor(toWrite.length * 0.3));
            if (toWrite.length <= 1) break; /* 单条记录已无法再瘦身 */
            toWrite = toWrite.slice(0, toWrite.length - dropCount);
            _outboxStats.quotaShedRecords += dropCount;
            attempt++;
        }
    }
    /* 三次仍失败 — cache 与 LS 失同步，但仍保留 cache 让在线 flush 能拿到。
     * 下次成功 _writeChannel 会重新同步。 */
}

/** GG3 PUBLIC API：上报队列 quota 健康度快照。 */
export function getOutboxStats() {
    let totalQueued = 0;
    for (const list of _channelCache.values()) totalQueued += list.length;
    return {
        quotaTrips: _outboxStats.quotaTrips,
        quotaShedRecords: _outboxStats.quotaShedRecords,
        lastQuotaReason: _outboxStats.lastQuotaReason,
        totalQueued,
        channelCount: _channelCache.size,
    };
}

/** GG3 PUBLIC API：重置统计（搭配窗口上报用）。 */
export function resetOutboxStats() {
    _outboxStats.quotaTrips = 0;
    _outboxStats.quotaShedRecords = 0;
    _outboxStats.lastQuotaReason = '';
}

/* 旧 _save 保留为薄包装供已有调用方使用（语义不变） */
function _save(channel, list) { _writeChannel(channel, list); }

function _genId(channel) {
    return `${channel}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 入队一条记录（始终本地持久化；不阻塞调用方）。自动补 event_id + envelope。 */
export function enqueue(channel, record) {
    if (!_cfg.channels[channel]) return;
    const list = _load(channel);
    const rec = { ...record };
    if (!rec.event_id) rec.event_id = _genId(channel);
    if (rec.platform == null) rec.platform = _cfg.platform;        // 分端统计
    if (rec.app_version == null) rec.app_version = _cfg.appVersion;
    if (rec.ts == null && rec.timestamp == null) rec.ts = Date.now();
    list.push(rec);
    if (list.length > _cfg.maxQueue) list.splice(0, list.length - _cfg.maxQueue);
    _save(channel, list);
    return rec.event_id;
}

/** 当前各 channel 待发数量（调试 / 测试用）。 */
export function pendingCount(channel) {
    if (channel) return _load(channel).length;
    return Object.keys(_cfg.channels).reduce((n, c) => n + _load(c).length, 0);
}

function _online() {
    try { return typeof navigator === 'undefined' || navigator.onLine !== false; } catch { return true; }
}

async function _flushChannel(channel) {
    const list = _load(channel);
    if (!list.length) return { sent: 0 };
    const batch = list.slice(0, _cfg.batchSize);
    const base = (_cfg.apiBase || '').replace(/\/+$/, '');
    const reporter = (typeof globalThis !== 'undefined') ? globalThis.__telemetryReporter : null;
    const sentTs = Date.now();
    try {
        const res = await fetch(`${base}${_cfg.channels[channel]}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // 批次级 meta：platform/app_version 供后端在事件缺字段时兜底分端归属
            body: JSON.stringify({ platform: _cfg.platform, app_version: _cfg.appVersion, events: batch }),
        });
        reporter?.record?.({ event: `outbox_${channel}`, sentTs, ackTs: Date.now(), lost: !res?.ok });
        if (!res || !res.ok) return { sent: 0, error: true };
        const sentIds = new Set(batch.map((r) => r.event_id));
        _save(channel, _load(channel).filter((r) => !sentIds.has(r.event_id)));
        return { sent: batch.length };
    } catch {
        reporter?.record?.({ event: `outbox_${channel}`, sentTs, ackTs: null, lost: true });
        return { sent: 0, error: true };
    }
}

/** 上报所有 channel 的待发数据（联网且启用时）。显式调用不受退避限制。 */
export async function flush() {
    if (!_cfg.enabled || _flushing || !_online()) return;
    _flushing = true;
    let anyError = false;
    let anySent = false;
    try {
        for (const channel of Object.keys(_cfg.channels)) {
            const r = await _flushChannel(channel);
            if (r.error) anyError = true;
            if (r.sent) anySent = true;
        }
    } finally {
        _flushing = false;
    }
    // 退避状态：有发送成功→清零；纯失败→指数退避（封顶）
    if (anySent || !anyError) {
        _failStreak = 0;
        _backoffUntil = 0;
    } else if (anyError) {
        _failStreak += 1;
        const wait = Math.min(_cfg.maxRetryBackoffMs, _cfg.flushIntervalMs * (2 ** Math.min(_failStreak, 6)));
        _backoffUntil = Date.now() + wait;
    }
}

/** 周期触发：受退避限制，避免持续断网/错误时空打请求。 */
function _tick() {
    if (Date.now() < _backoffUntil) return;
    void flush();
}

/** 初始化：注册周期 flush + online 监听 + 立即尝试一次。接受统一配置格式。 */
export function initReportingOutbox(overrides = {}) {
    _cfg = resolveNetConfig({
        ...overrides,
        apiBase: overrides.apiBase != null ? overrides.apiBase : getApiBaseUrl(),
        enabled: overrides.enabled != null ? overrides.enabled : isSqliteClientDatabase(),
    });
    _failStreak = 0;
    _backoffUntil = 0;
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (typeof setInterval !== 'undefined') {
        _timer = setInterval(_tick, _cfg.flushIntervalMs);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('online', () => { _backoffUntil = 0; void flush(); });
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') void flush();
        });
    }
    void flush();
    return _cfg;
}

/** 当前生效配置（调试 / 测试）。 */
export function getNetConfig() { return { ..._cfg }; }

/** 测试用：重置内部状态。 */
export function __resetForTest() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    const channels = _cfg.channels;
    _cfg = resolveNetConfig();
    _flushing = false;
    _failStreak = 0;
    _backoffUntil = 0;
    try {
        Object.keys(channels).forEach((c) => localStorage.removeItem(_key(c)));
    } catch { /* ignore */ }
    /* v1.71 W5：清 hot cache，下次 _load 会重读 LS（已清） */
    _channelCache.clear();
    /* GG3：清 quota stats */
    resetOutboxStats();
}
