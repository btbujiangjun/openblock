/**
 * telemetryReporter.js — 埋点投递回执采集与上报（DA-4 客户端）
 *
 * 客户端是 loss/latency 的权威来源：只有客户端知道一次发送是否成功、耗时多少。
 * 本模块负责：
 *   1. 包装网络发送（instrumentedFetch）→ 记录 { event, sentTs, ackTs, lost }；
 *   2. 缓冲记录并定期 flush 到 `/api/telemetry/report`；
 *   3. 通过 `globalThis.__telemetryReporter` 暴露 record()，供 analyticsTracker 等
 *      在不引入静态依赖（跨端安全）的前提下打点。
 *
 * 服务端用 `server_authority.telemetry_quality` 聚合，`/ops` 埋点健康卡片展示。
 */

const MAX_BUFFER = 500;

let _buffer = [];
let _config = { userId: '', apiBase: '', intervalMs: 30000 };
let _timer = null;

/** 归一化一条投递记录。 */
export function normalizeRecord(rec = {}) {
    const sentTs = Number(rec.sentTs);
    const ackRaw = rec.ackTs;
    const ackTs = ackRaw == null ? null : Number(ackRaw);
    const lost = rec.lost === true || ackTs == null || !(ackTs > sentTs);
    return {
        event: String(rec.event || ''),
        sentTs: Number.isFinite(sentTs) ? sentTs : Date.now(),
        ackTs: Number.isFinite(ackTs) ? ackTs : null,
        lost,
    };
}

/** 记录一条投递回执（被 globalThis.__telemetryReporter.record 调用）。 */
export function recordDelivery(rec) {
    _buffer.push(normalizeRecord(rec));
    if (_buffer.length > MAX_BUFFER) _buffer = _buffer.slice(-MAX_BUFFER);
}

export function getBufferSize() {
    return _buffer.length;
}

/**
 * 包装一次 fetch：测量 sentTs/ackTs，失败/超时标 lost，记录回执后透传结果。
 * @param {string} url
 * @param {object} opts
 * @param {string} eventName 该请求对应的埋点名（用于分桶）
 */
export async function instrumentedFetch(url, opts = {}, eventName = '') {
    const sentTs = Date.now();
    try {
        const res = await fetch(url, opts);
        recordDelivery({ event: eventName, sentTs, ackTs: Date.now(), lost: !res.ok });
        return res;
    } catch (e) {
        recordDelivery({ event: eventName, sentTs, ackTs: null, lost: true });
        throw e;
    }
}

/** 构造上报 payload（纯函数，便于测试）。 */
export function buildReportPayload(userId, records) {
    return { user_id: userId, records };
}

/** 把缓冲区 flush 到服务端；成功后清空。返回是否成功。 */
export async function flush() {
    if (_buffer.length === 0) return true;
    const base = (_config.apiBase || '').replace(/\/+$/, '');
    const batch = _buffer.slice(0, MAX_BUFFER);
    try {
        const res = await fetch(`${base}/api/telemetry/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildReportPayload(_config.userId, batch)),
        });
        if (res && res.ok) {
            _buffer = _buffer.slice(batch.length);
            return true;
        }
    } catch { /* 网络失败：保留缓冲下次再试 */ }
    return false;
}

/** 初始化：注册全局 hook + 启动周期 flush。 */
export function initTelemetryReporter({ userId = '', apiBase = '', intervalMs = 30000 } = {}) {
    _config = { userId, apiBase, intervalMs };
    if (typeof globalThis !== 'undefined') {
        globalThis.__telemetryReporter = {
            record: recordDelivery,
            instrumentedFetch,
            flush,
        };
    }
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (typeof setInterval === 'function' && intervalMs > 0) {
        _timer = setInterval(() => { void flush(); }, intervalMs);
        if (_timer && typeof _timer.unref === 'function') _timer.unref();
    }
    // 页面隐藏/卸载时尽力 flush
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') void flush();
        });
    }
}

/** 测试用：重置内部状态。 */
export function __resetForTest() {
    _buffer = [];
    _config = { userId: '', apiBase: '', intervalMs: 30000 };
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (typeof globalThis !== 'undefined') delete globalThis.__telemetryReporter;
}
