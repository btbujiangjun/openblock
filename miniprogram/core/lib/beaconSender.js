/**
 * beaconSender — sendBeacon 优先 + fetch keepalive 兜底的远端 sender 工厂（v1.71 BB5）
 *
 * 设计目标：与 loggerBatchSink（U3）+ logger.setRemoteSink（T4）形成完整链路：
 *
 *   logger.error → batchSink.queue → beaconSender(batch) → 远端
 *
 * 为什么 sendBeacon：
 *   - 浏览器在 unload/visibilitychange 阶段会丢弃 in-flight fetch
 *   - sendBeacon 由浏览器接管，保证"页面关闭也能送达"（最重要的崩溃场景）
 *   - 不阻塞主线程（非同步）
 *
 * Fallback 链：
 *   1. navigator.sendBeacon(url, body)             —— 首选
 *   2. fetch(url, { keepalive: true, body })       —— SSR / 老浏览器 / Beacon API 缺失
 *   3. 重试：失败入 retry buffer，下次 flush 一起带；超 maxRetries 丢弃 + log（防内存泄漏）
 *
 * 失败重试不阻塞调用方（异步重试 with backoff）。
 *
 * 用法：
 *   const { createBeaconSender } = require('./lib/beaconSender');
 *   const { createBatchSink } = require('./lib/loggerBatchSink');
 *   const { setRemoteSink } = require('./lib/logger');
 *
 *   const sender = createBeaconSender('https://api.example.com/v1/client-logs');
 *   const batch = createBatchSink(sender.send, { maxBatch: 20, maxDelayMs: 5000 });
 *   setRemoteSink(batch.sink);
 *
 * 不做的事：
 *   - 不持久化失败 batch（重启即丢；与 logger 自身一致）
 *   - 不做端到端加密（业务侧应在 HTTPS 之上自行约束 PII）
 *   - 不限流（限流是 batchSink 的事）
 */

const DEFAULT_OPTS = Object.freeze({
    maxRetries: 3,                    // 单 batch 最多重试次数
    retryBackoffMs: [1000, 3000, 8000], // 指数退避
    maxRetryBufferBytes: 256 * 1024,  // retry buffer 上限（256KB；防内存泄漏）
    contentType: 'application/json',
});

/**
 * 检测当前 runtime 是否有 sendBeacon
 */
function _hasBeacon() {
    return typeof navigator !== 'undefined'
        && typeof navigator.sendBeacon === 'function';
}

function _hasFetchKeepalive() {
    return typeof fetch === 'function';
}

/**
 * @param {string} url        远端 endpoint
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=3]
 * @param {number[]} [opts.retryBackoffMs=[1000,3000,8000]]
 * @param {number} [opts.maxRetryBufferBytes=262144]
 * @param {string} [opts.contentType='application/json']
 * @param {(batch: Array) => object} [opts.serialize] 自定义序列化（默认 JSON.stringify({items:batch})）
 * @returns {{ send: Function, getStats: Function, _resetForTests: Function }}
 */
function createBeaconSender(url, opts = {}) {
    if (typeof url !== 'string' || url.length === 0) {
        throw new TypeError('createBeaconSender: url must be non-empty string');
    }
    const cfg = { ...DEFAULT_OPTS, ...opts };
    const serialize = typeof cfg.serialize === 'function'
        ? cfg.serialize
        : (batch) => ({ items: batch, ts: Date.now() });

    /* retry buffer：未送达的 batch + 已尝试次数 */
    const _retryBuffer = []; // [{ payload: string, attempts: number, scheduledAt: number }]
    let _bufferBytes = 0;

    const _stats = {
        sent: 0,
        failed: 0,
        retried: 0,
        dropped: 0,
        beaconUsed: 0,
        fetchUsed: 0,
    };

    function _payloadOf(batch) {
        try {
            return JSON.stringify(serialize(batch));
        } catch {
            /* 序列化失败：fallback 到最小 entry shape */
            return JSON.stringify({ items: batch.map(e => ({
                ts: e?.ts, level: e?.level, tag: e?.tag,
            })), ts: Date.now(), serializeError: true });
        }
    }

    /**
     * 真正的发送：返回是否成功
     */
    function _trySendPayload(payload) {
        /* 优先 sendBeacon */
        if (_hasBeacon()) {
            try {
                /* sendBeacon 用 Blob 而非 string，避免某些浏览器 CORS preflight */
                const blob = (typeof Blob !== 'undefined')
                    ? new Blob([payload], { type: cfg.contentType })
                    : payload;
                const ok = navigator.sendBeacon(url, blob);
                if (ok) {
                    _stats.beaconUsed++;
                    return true;
                }
            } catch { /* 退回 fetch */ }
        }
        /* fallback: fetch keepalive */
        if (_hasFetchKeepalive()) {
            try {
                fetch(url, {
                    method: 'POST',
                    body: payload,
                    keepalive: true,
                    headers: { 'Content-Type': cfg.contentType },
                }).catch(() => { /* 失败由调用方 retry 路径处理 */ });
                _stats.fetchUsed++;
                return true; // 同步入队成功视为"已尝试"；真实失败靠下次 retry buffer
            } catch { /* fall through */ }
        }
        return false;
    }

    function _enqueueRetry(payload, attempts) {
        const bytes = payload.length;
        /* 超出上限 → 丢弃最旧条目腾位 */
        while (_bufferBytes + bytes > cfg.maxRetryBufferBytes && _retryBuffer.length > 0) {
            const dropped = _retryBuffer.shift();
            _bufferBytes -= dropped.payload.length;
            _stats.dropped++;
        }
        if (_bufferBytes + bytes > cfg.maxRetryBufferBytes) {
            /* 单条就超 cap → 丢 */
            _stats.dropped++;
            return;
        }
        const backoff = cfg.retryBackoffMs[Math.min(attempts, cfg.retryBackoffMs.length - 1)] || 8000;
        _retryBuffer.push({ payload, attempts, scheduledAt: Date.now() + backoff });
        _bufferBytes += bytes;
        _stats.retried++;
    }

    /**
     * 主 send 函数：传入 batch（来自 loggerBatchSink）。
     */
    function send(batch) {
        if (!Array.isArray(batch) || batch.length === 0) return;
        /* 先把过期的 retry buffer 项尝试重发 */
        const now = Date.now();
        const due = [];
        const remain = [];
        for (const item of _retryBuffer) {
            if (item.scheduledAt <= now) due.push(item);
            else remain.push(item);
        }
        _retryBuffer.length = 0;
        for (const item of remain) _retryBuffer.push(item);
        _bufferBytes = remain.reduce((s, it) => s + it.payload.length, 0);
        for (const item of due) {
            const ok = _trySendPayload(item.payload);
            if (ok) {
                _stats.sent++;
            } else if (item.attempts + 1 < cfg.maxRetries) {
                _enqueueRetry(item.payload, item.attempts + 1);
            } else {
                _stats.dropped++;
            }
        }
        /* 当前 batch */
        const payload = _payloadOf(batch);
        const ok = _trySendPayload(payload);
        if (ok) {
            _stats.sent++;
        } else {
            _stats.failed++;
            if (cfg.maxRetries > 0) _enqueueRetry(payload, 0);
            else _stats.dropped++;
        }
    }

    function getStats() {
        return {
            ...(_stats),
            retryBufferSize: _retryBuffer.length,
            retryBufferBytes: _bufferBytes,
        };
    }

    /** 测试 / hot-reload 专用：清空 retry buffer + 重置 stats */
    function _resetForTests() {
        _retryBuffer.length = 0;
        _bufferBytes = 0;
        for (const k of Object.keys(_stats)) _stats[k] = 0;
    }

    return { send, getStats, _resetForTests };
}

module.exports = { createBeaconSender };
