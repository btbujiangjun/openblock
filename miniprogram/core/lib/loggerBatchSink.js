/**
 * loggerBatchSink — logger remote sink 的 batch 包装器（v1.71 U3）
 *
 * T4 在 lib/logger 提供了 setRemoteSink(fn)，每条 error 立即调用 fn。
 * 但在错误风暴（不同 message → 越过 30s 去重）时，逐条同步发请求会：
 *   1. 拖慢主线程（每条 trackEvent 都触发一次 fetch / SQLite write）
 *   2. 占网络（高错误率页面短期内打满浏览器并发请求池）
 *
 * 本模块用「队列 + 双触发（条数 / 时间）」打平 burst：
 *   - 累积到 maxBatch（默认 20）→ flush
 *   - 距上次 flush ≥ maxDelayMs（默认 5000ms）→ flush
 *   - pagehide / beforeunload → 强制 flush（最后一搏，避免 in-flight 丢失）
 *   - 页面 hidden（visibilitychange）→ 强制 flush（移动端切后台前最后机会）
 *
 * 设计权衡：
 *   - flush 内调用 sender(batch)；sender 抛错由本模块兜住，不传染 logger
 *   - 不持久化（page reload 即失，与 logger 自身一致）
 *   - 同步入队，flush 用 setTimeout 异步触发（不阻塞调用方）
 *   - flush 当时若 sender pending，不阻塞下一次入队（队列继续累积）
 *
 * 用法：
 *   const { createBatchSink } = require('./lib/loggerBatchSink');
 *   const { setRemoteSink } = require('./lib/logger');
 *   const batchSink = createBatchSink((batch) => {
 *     tracker.trackEvent('client_error_batch', { count: batch.length, items: batch });
 *   }, { maxBatch: 20, maxDelayMs: 5000 });
 *   setRemoteSink(batchSink.sink);
 */

/**
 * @param {(batch: Array) => void | Promise<void>} sender  接收一批 entry 的发送函数
 * @param {object} [opts]
 * @param {number} [opts.maxBatch=20]    满 N 条立即 flush
 * @param {number} [opts.maxDelayMs=5000] 距上次 flush ≥ T 毫秒触发 flush
 * @returns {{ sink: Function, flush: Function, _queueSize: () => number, dispose: Function }}
 */
function createBatchSink(sender, opts = {}) {
    const maxBatch = Math.max(1, Number(opts.maxBatch) || 20);
    const maxDelayMs = Math.max(100, Number(opts.maxDelayMs) || 5000);
    if (typeof sender !== 'function') {
        throw new TypeError('createBatchSink: sender must be a function');
    }

    let queue = [];
    let timer = null;

    function _safeSend(batch) {
        try {
            const ret = sender(batch);
            /* sender 返回 Promise 时把潜在 reject 兜住，避免 unhandled rejection */
            if (ret && typeof ret.then === 'function') {
                ret.catch(() => { /* swallow */ });
            }
        } catch { /* swallow */ }
    }

    function flush() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (queue.length === 0) return;
        const batch = queue;
        queue = [];
        _safeSend(batch);
    }

    function _scheduleFlush() {
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            flush();
        }, maxDelayMs);
    }

    /* logger.setRemoteSink 调用形如 sink(entry, recentContext)。
     * 我们把 entry + 一个轻量 contextDigest 放进队列：
     * 全量 recentContext 入队太重（200 × N entry → MB 级），
     * 默认只取最近 5 条上下文摘要；批量端在外层 sender 里如需可再扩展。 */
    function sink(entry, recentContext) {
        const item = {
            ts: entry.ts,
            level: entry.level,
            tag: entry.tag,
            msg: typeof entry.args?.[0] === 'string' ? entry.args[0] : '',
            argCount: Array.isArray(entry.args) ? entry.args.length : 0,
            contextTail: Array.isArray(recentContext)
                ? recentContext.slice(-5).map((e) => ({ ts: e.ts, level: e.level, tag: e.tag }))
                : [],
        };
        queue.push(item);
        if (queue.length >= maxBatch) {
            flush();
        } else {
            _scheduleFlush();
        }
    }

    /* 页面卸载 / 隐藏时强制 flush。SSR 安全：用 typeof addEventListener 守卫。 */
    let _disposed = false;
    const _handlers = [];
    function _bind(target, evt, fn) {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(evt, fn);
        _handlers.push(() => target.removeEventListener(evt, fn));
    }
    if (typeof window !== 'undefined') {
        const onUnload = () => { try { flush(); } catch { /* ignore */ } };
        const onVis = () => {
            try {
                if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
            } catch { /* ignore */ }
        };
        _bind(window, 'pagehide', onUnload);
        _bind(window, 'beforeunload', onUnload);
        _bind(typeof document !== 'undefined' ? document : null, 'visibilitychange', onVis);
    }

    function dispose() {
        if (_disposed) return;
        _disposed = true;
        if (timer) { clearTimeout(timer); timer = null; }
        for (const off of _handlers) {
            try { off(); } catch { /* ignore */ }
        }
        _handlers.length = 0;
    }

    return {
        sink,
        flush,
        _queueSize: () => queue.length,
        dispose,
    };
}

module.exports = { createBatchSink };
