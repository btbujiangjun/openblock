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

function _load(channel) {
    try {
        const raw = localStorage.getItem(_key(channel));
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function _save(channel, list) {
    try { localStorage.setItem(_key(channel), JSON.stringify(list)); } catch { /* ignore */ }
}

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
}
