/**
 * lib/userId.js — 稳定匿名身份（v1.63）
 *
 * 目标：尽量让同一台设备/同一个真人保持同一个 `user_id`，即使用户清理了
 * localStorage、用隐私模式、或用无头浏览器（Puppeteer / Playwright）反复打开。
 *
 * 历史问题：旧实现只存 localStorage，一旦被清理就立刻新建用户，导致 DAU / 留存
 * 口径被"伪新用户"污染。
 *
 * 现在的多层稳定策略（从快到慢、从弱到强）：
 *   1. **localStorage**（`bb_user_id`）       —— 同步、最快，主存储
 *   2. **Cookie**（`bb_uid`，2 年）           —— 同步，localStorage 被单独清理时兜底
 *   3. **IndexedDB**（`openblock_id/kv`）      —— 异步，某些"清站点数据"会漏掉它
 *   4. **设备指纹 + 服务端软恢复**             —— 异步，前三层全丢时的最后防线：
 *        客户端带稳定指纹回连 `/api/identity/resolve`，服务端把指纹映射回历史 id。
 *
 * 兼容性：`getUserId()` / `peekUserId()` 保持**同步**且签名不变（大量调用方依赖）。
 * 新增 `reconcileUserId()` 在启动早期调用一次，把 4 层对齐到同一个 canonical id。
 */

const KEY = 'bb_user_id';
const COOKIE_KEY = 'bb_uid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 730; // 2 年
const IDB_NAME = 'openblock_id';
const IDB_STORE = 'kv';

/* ------------------------------------------------------------------ *
 *  基础读写（同步层：localStorage + cookie）
 * ------------------------------------------------------------------ */

function _genId() {
    return `u${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function _isValidId(id) {
    return typeof id === 'string' && /^u\d{8,}_[a-z0-9]{6,}$/i.test(id);
}

function _readLocal() {
    try {
        return localStorage.getItem(KEY) || '';
    } catch {
        return '';
    }
}

function _writeLocal(id) {
    try {
        localStorage.setItem(KEY, id);
    } catch {
        /* 隐私模式 / 配额满 → 忽略，其他层兜底 */
    }
}

function _readCookie() {
    try {
        if (typeof document === 'undefined' || !document.cookie) return '';
        const m = document.cookie.match(
            new RegExp('(?:^|; )' + COOKIE_KEY + '=([^;]*)')
        );
        return m ? decodeURIComponent(m[1]) : '';
    } catch {
        return '';
    }
}

function _writeCookie(id) {
    try {
        if (typeof document === 'undefined') return;
        const secure = (typeof location !== 'undefined' && location.protocol === 'https:')
            ? '; Secure'
            : '';
        document.cookie =
            `${COOKIE_KEY}=${encodeURIComponent(id)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
    } catch {
        /* 部分 WebView 禁用 cookie → 忽略 */
    }
}

/** 把 canonical id 同步写回所有同步层（localStorage + cookie）。 */
function _mirrorSync(id) {
    if (_readLocal() !== id) _writeLocal(id);
    if (_readCookie() !== id) _writeCookie(id);
}

/* ------------------------------------------------------------------ *
 *  对外同步 API（保持向后兼容）
 * ------------------------------------------------------------------ */

/**
 * 读取 user id；首次访问时生成并持久化。
 * 读取顺序：localStorage → cookie；任一命中即镜像到另一层并返回。
 */
export function getUserId() {
    const local = _readLocal();
    if (local) {
        if (_readCookie() !== local) _writeCookie(local);
        return local;
    }
    const cookie = _readCookie();
    if (cookie) {
        _writeLocal(cookie);   // 用 cookie 恢复被清掉的 localStorage
        return cookie;
    }
    const id = _genId();
    _mirrorSync(id);
    return id;
}

/** 仅读取，不生成。供测试 / 调试面板使用。 */
export function peekUserId() {
    return _readLocal() || _readCookie() || '';
}

/* ------------------------------------------------------------------ *
 *  设备指纹（稳定、低敏感；不依赖 canvas 以保证跨会话稳定）
 * ------------------------------------------------------------------ */

function _fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
}

/**
 * 计算稳定设备指纹：只取"清理存储不会变、浏览器小版本升级也基本不变"的信号，
 * 牺牲一点唯一性换取跨清理的稳定性（休闲匿名场景的合理取舍）。
 */
export function computeDeviceFingerprint() {
    if (typeof navigator === 'undefined') return '';
    const nav = navigator;
    const scr = (typeof screen !== 'undefined') ? screen : {};
    let tz = '';
    try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        tz = String(new Date().getTimezoneOffset());
    }
    const parts = [
        nav.platform || '',
        (Array.isArray(nav.languages) && nav.languages.length
            ? nav.languages.join(',')
            : nav.language || ''),
        tz,
        `${scr.width || 0}x${scr.height || 0}x${scr.colorDepth || 0}`,
        String(nav.hardwareConcurrency || 0),
        String(nav.deviceMemory || 0),
        String(nav.maxTouchPoints || 0),
    ];
    // 前缀 fp1 标记版本 + 算法；两段 hash 降低碰撞。
    const joined = parts.join('|');
    return `fp1_${_fnv1a(joined)}${_fnv1a(joined.split('').reverse().join(''))}`;
}

/* ------------------------------------------------------------------ *
 *  IndexedDB（异步兜底层）
 * ------------------------------------------------------------------ */

function _idbGet() {
    return new Promise((resolve) => {
        try {
            if (typeof indexedDB === 'undefined') return resolve('');
            const open = indexedDB.open(IDB_NAME, 1);
            open.onupgradeneeded = () => {
                try { open.result.createObjectStore(IDB_STORE); } catch { /* ignore */ }
            };
            open.onerror = () => resolve('');
            open.onsuccess = () => {
                try {
                    const db = open.result;
                    if (!db.objectStoreNames.contains(IDB_STORE)) { db.close(); return resolve(''); }
                    const tx = db.transaction(IDB_STORE, 'readonly');
                    const req = tx.objectStore(IDB_STORE).get(KEY);
                    req.onsuccess = () => { resolve(req.result || ''); db.close(); };
                    req.onerror = () => { resolve(''); db.close(); };
                } catch { resolve(''); }
            };
        } catch { resolve(''); }
    });
}

function _idbSet(id) {
    return new Promise((resolve) => {
        try {
            if (typeof indexedDB === 'undefined') return resolve(false);
            const open = indexedDB.open(IDB_NAME, 1);
            open.onupgradeneeded = () => {
                try { open.result.createObjectStore(IDB_STORE); } catch { /* ignore */ }
            };
            open.onerror = () => resolve(false);
            open.onsuccess = () => {
                try {
                    const db = open.result;
                    if (!db.objectStoreNames.contains(IDB_STORE)) { db.close(); return resolve(false); }
                    const tx = db.transaction(IDB_STORE, 'readwrite');
                    tx.objectStore(IDB_STORE).put(id, KEY);
                    tx.oncomplete = () => { resolve(true); db.close(); };
                    tx.onerror = () => { resolve(false); db.close(); };
                } catch { resolve(false); }
            };
        } catch { resolve(false); }
    });
}

/* ------------------------------------------------------------------ *
 *  启动期对齐：把 4 层 + 服务端 canonical id 统一
 * ------------------------------------------------------------------ */

let _reconciled = false;
let _reconcilePromise = null;

/**
 * 在启动早期调用一次（new Game() / Database 之前），把同步层、IndexedDB、
 * 服务端身份映射对齐到同一个 canonical id，并写回所有层。永不抛错、永不长阻塞。
 *
 * @param {object}   [opts]
 * @param {string}   [opts.apiBaseUrl]  形如 'http://127.0.0.1:6000'（来自 getApiBaseUrl()）
 * @param {boolean}  [opts.serverEnabled=false]  是否允许走服务端软恢复（isSqliteClientDatabase()）
 * @param {number}   [opts.timeoutMs=1500]  服务端解析超时；超时回退本地 id，不阻塞开局
 * @param {Function} [opts.fetchImpl]  注入 fetch（测试用）
 * @returns {Promise<string>} canonical user_id
 */
export async function reconcileUserId(opts = {}) {
    if (_reconciled) return getUserId();
    if (_reconcilePromise) return _reconcilePromise;
    _reconcilePromise = (async () => {
        const {
            apiBaseUrl = '',
            serverEnabled = false,
            timeoutMs = 1500,
            fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
        } = opts;

        // 同步层 → IndexedDB 的本地恢复：localStorage/cookie 都丢了，但 IndexedDB 还在
        let localId = peekUserId();
        if (!localId) {
            const idbId = await _idbGet();
            if (_isValidId(idbId)) localId = idbId;
        }

        // 服务端软恢复（最强的一层）：带 candidate + 指纹去换 canonical id
        let canonical = localId;
        if (serverEnabled && fetchImpl) {
            try {
                const fingerprint = computeDeviceFingerprint();
                const base = String(apiBaseUrl || '').replace(/\/+$/, '');
                const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
                const res = await fetchImpl(`${base}/api/identity/resolve`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ candidate_id: localId || '', fingerprint }),
                    signal: ctrl ? ctrl.signal : undefined,
                });
                if (timer) clearTimeout(timer);
                if (res && res.ok) {
                    const data = await res.json();
                    const resolved = data && (data.user_id || data.userId);
                    if (_isValidId(resolved)) canonical = resolved;
                }
            } catch {
                /* 网络/超时/服务端不可用 → 用本地 id，绝不阻塞开局 */
            }
        }

        // 仍然没有任何 id（全新设备 + 服务端不可达）→ 本地生成
        if (!_isValidId(canonical)) {
            canonical = localId && _isValidId(localId) ? localId : _genId();
        }

        // 写回所有层，确保后续 getUserId() 同步返回 canonical
        _mirrorSync(canonical);
        await _idbSet(canonical);

        _reconciled = true;
        return canonical;
    })();
    return _reconcilePromise;
}

/** 测试用：重置内部对齐状态。 */
export function __resetReconcileForTest() {
    _reconciled = false;
    _reconcilePromise = null;
}
