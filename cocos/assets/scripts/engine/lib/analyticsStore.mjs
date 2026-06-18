/* 自动生成 —— 请勿手改。源：web/src/lib/analyticsStore.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * analyticsStore — analyticsTracker 持久化层（v1.71 V2）
 *
 * 目标：把 analyticsTracker._saveEvents 从「每条 event 同步 localStorage 写」
 *      迁移到「节流的异步 IndexedDB 写 + localStorage 兜底」。
 *
 * 行为契约：
 *   - load() 返回 { events, funnels } 形态与原 localStorage 完全一致
 *   - save({events, funnels}) 异步、节流（默认 800ms debounce + 5s 强 flush）
 *   - flushNow() 同步触发待写数据落地（pagehide 时调用）
 *   - 任何 storage 异常都被吞掉（埋点持久化不能影响业务主路径）
 *
 * 存储策略：
 *   1. 首选 IndexedDB（容量 50MB+、异步、不阻塞主线程）
 *   2. IndexedDB 不可用（SSR / 旧浏览器 / 隐私模式）→ localStorage 兜底
 *   3. localStorage 写失败（quota）→ 静默丢（与旧行为一致）
 *
 * IndexedDB schema：
 *   db: 'openblock_analytics_v1', objectStore: 'snapshot', keyPath: 'id'
 *   单 key='current' 整块存储（与 localStorage 单 key 语义一致）
 */

const DB_NAME = 'openblock_analytics_v1';
const STORE_NAME = 'snapshot';
const SNAPSHOT_ID = 'current';
const LS_KEY = 'openblock_analytics_v1';

const DEBOUNCE_MS = 800;
const HARD_FLUSH_MS = 5000;

/* 探测一次即缓存。SSR 时 indexedDB 为 undefined，安全降级。 */
let _idbAvailable = null;
function _hasIDB() {
    if (_idbAvailable !== null) return _idbAvailable;
    try {
        _idbAvailable = typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch { _idbAvailable = false; }
    return _idbAvailable;
}

/* Y3：IDB 性能/失败观测——纯计数，零侵入业务路径。
 *
 * 字段说明：
 *   idbPutOk / idbPutFail：异步写 IndexedDB 成功 / 失败次数
 *   idbGetOk / idbGetMiss：异步读 IDB 成功 / 无快照（首次或被清）
 *   idbPutLatencyMs：累计写延时（ms），调用方除以 idbPutOk 得均值
 *   idbPutLatencyMax：单次写延时最大值（异常长尾观测）
 *   lsPutFallback：IDB 写失败后 LS 兜底成功次数
 *   lsPutFailCount：LS 也写失败次数（quota 等极端情况）
 *
 * 上报路径：main.js 把 getAnalyticsStoreStats() 接入 60s tracker 窗口
 * （与 X1 dfs_budget_window 同模式），observed → DFS_BUDGET_BASELINE 同款决策表。
 */
const _storeStats = {
    idbPutOk: 0, idbPutFail: 0,
    idbGetOk: 0, idbGetMiss: 0,
    idbPutLatencyMs: 0, idbPutLatencyMax: 0,
    lsPutFallback: 0, lsPutFailCount: 0,
};

let _dbPromise = null;
function _openDb() {
    if (!_hasIDB()) return Promise.resolve(null);
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve) => {
        let req;
        try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
        req.onupgradeneeded = () => {
            try {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            } catch { /* ignore */ }
        };
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
    });
    return _dbPromise;
}

async function _idbGet() {
    const db = await _openDb();
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_ID);
            req.onsuccess = () => {
                const payload = req.result ? req.result.payload : null;
                if (payload) _storeStats.idbGetOk++; else _storeStats.idbGetMiss++;
                resolve(payload);
            };
            req.onerror = () => { _storeStats.idbGetMiss++; resolve(null); };
        } catch { _storeStats.idbGetMiss++; resolve(null); }
    });
}

async function _idbPut(payload) {
    const db = await _openDb();
    if (!db) { _storeStats.idbPutFail++; return false; }
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({ id: SNAPSHOT_ID, payload, ts: Date.now() });
            tx.oncomplete = () => {
                const dt = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
                _storeStats.idbPutOk++;
                _storeStats.idbPutLatencyMs += dt;
                if (dt > _storeStats.idbPutLatencyMax) _storeStats.idbPutLatencyMax = dt;
                resolve(true);
            };
            tx.onerror = () => { _storeStats.idbPutFail++; resolve(false); };
            tx.onabort = () => { _storeStats.idbPutFail++; resolve(false); };
        } catch { _storeStats.idbPutFail++; resolve(false); }
    });
}

function _lsGet() {
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function _lsPut(payload) {
    try {
        if (typeof localStorage === 'undefined') { _storeStats.lsPutFailCount++; return false; }
        localStorage.setItem(LS_KEY, JSON.stringify(payload));
        return true;
    } catch { _storeStats.lsPutFailCount++; return false; }
}

/**
 * 异步加载快照。
 * 优先 IndexedDB；不存在或不可用时退到 localStorage。
 * @returns {Promise<{events?: Array, funnels?: object} | null>}
 */
export async function loadAnalyticsSnapshot() {
    const fromIdb = await _idbGet();
    if (fromIdb) return fromIdb;
    return _lsGet();
}

/**
 * 同步加载（兼容旧 analyticsTracker.init 的同步语义）。
 * 仅走 localStorage；IndexedDB 异步加载请用 loadAnalyticsSnapshot。
 */
export function loadAnalyticsSnapshotSync() {
    return _lsGet();
}

/* save 节流状态 */
let _pendingPayload = null;
let _debounceTimer = null;
let _hardFlushTimer = null;

function _doFlush() {
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    if (_hardFlushTimer) { clearTimeout(_hardFlushTimer); _hardFlushTimer = null; }
    const payload = _pendingPayload;
    if (!payload) return;
    _pendingPayload = null;
    /* IndexedDB 异步写；失败时回退 localStorage（双写避免数据丢失） */
    _idbPut(payload).then((ok) => {
        if (!ok && _lsPut(payload)) _storeStats.lsPutFallback++;
    }).catch(() => { if (_lsPut(payload)) _storeStats.lsPutFallback++; });
}

/**
 * 排队保存快照。节流：DEBOUNCE_MS 内多次调用合并为最后一次；
 * 距首次入队超过 HARD_FLUSH_MS 强制 flush（防止持续 burst 永远不落地）。
 *
 * @param {{events: Array, funnels: object}} payload
 */
export function queueAnalyticsSave(payload) {
    _pendingPayload = payload;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(_doFlush, DEBOUNCE_MS);
    if (!_hardFlushTimer) {
        _hardFlushTimer = setTimeout(_doFlush, HARD_FLUSH_MS);
    }
}

/**
 * 同步把当前 pending payload 立即 flush（pagehide / beforeunload 时调用）。
 * 同步路径只能写 localStorage（IndexedDB 是异步的，unload 期间事务可能失败）；
 * 异步 IndexedDB 写也会触发，但不阻塞返回——pagehide 不等异步。
 */
export function flushAnalyticsNow() {
    if (!_pendingPayload) return;
    const payload = _pendingPayload;
    _pendingPayload = null;
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    if (_hardFlushTimer) { clearTimeout(_hardFlushTimer); _hardFlushTimer = null; }
    /* 优先 localStorage 同步落地保证不丢；同时 fire-and-forget IndexedDB */
    _lsPut(payload);
    _idbPut(payload).catch(() => { /* already in LS */ });
}

/**
 * PUBLIC API (Y3): 暴露 IDB 持久化观测快照。
 *
 * 返回快照副本（非 live 引用）；含字段含义见 `_storeStats` 注释。
 * 调用方建议：
 *   - 计算 idbWriteSuccessRate = idbPutOk / (idbPutOk + idbPutFail)
 *     < 95% 应警惕（隐私模式/quota/storage 健康问题）
 *   - 计算 idbAvgLatencyMs = idbPutLatencyMs / max(1, idbPutOk)
 *     > 50ms 持续 → IDB 出现性能问题（磁盘 / 浏览器优化失效）
 *   - lsPutFallback > 0 → 数据正在落 LS（容量 5MB，需关注 lsPutFailCount）
 */
export function getAnalyticsStoreStats() {
    const okOps = _storeStats.idbPutOk;
    return {
        idbPutOk: _storeStats.idbPutOk,
        idbPutFail: _storeStats.idbPutFail,
        idbWriteSuccessRate: (okOps + _storeStats.idbPutFail) > 0
            ? okOps / (okOps + _storeStats.idbPutFail) : 1,
        idbGetOk: _storeStats.idbGetOk,
        idbGetMiss: _storeStats.idbGetMiss,
        idbAvgLatencyMs: okOps > 0 ? _storeStats.idbPutLatencyMs / okOps : 0,
        idbMaxLatencyMs: _storeStats.idbPutLatencyMax,
        lsPutFallback: _storeStats.lsPutFallback,
        lsPutFailCount: _storeStats.lsPutFailCount,
    };
}

/** PUBLIC API (Y3): 重置统计窗口（搭配 60s 上报循环用）。 */
export function resetAnalyticsStoreStats() {
    _storeStats.idbPutOk = 0;
    _storeStats.idbPutFail = 0;
    _storeStats.idbGetOk = 0;
    _storeStats.idbGetMiss = 0;
    _storeStats.idbPutLatencyMs = 0;
    _storeStats.idbPutLatencyMax = 0;
    _storeStats.lsPutFallback = 0;
    _storeStats.lsPutFailCount = 0;
}

/**
 * 测试 hook：重置内部 state（IDB 探测缓存、节流定时器、stats）。
 */
export function _resetAnalyticsStoreForTests() {
    _idbAvailable = null;
    _dbPromise = null;
    _pendingPayload = null;
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    if (_hardFlushTimer) { clearTimeout(_hardFlushTimer); _hardFlushTimer = null; }
    resetAnalyticsStoreStats();
}

/* 自动绑定 pagehide / visibilitychange（与 loggerBatchSink 同样的最后一搏机制）。 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onUnload = () => { try { flushAnalyticsNow(); } catch { /* ignore */ } };
    const onVis = () => {
        try {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushAnalyticsNow();
        } catch { /* ignore */ }
    };
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVis);
    }
}
