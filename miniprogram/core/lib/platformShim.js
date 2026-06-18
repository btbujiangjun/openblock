/**
 * PP3 / NN-F2.5: 平台适配 shim（remote config 跨端落地）
 *
 * 抽象「storage / fetch / WebCrypto 可用性」三件套，
 * 把 web / wx-mp / cocos-native 三端差异收敛到一个文件。
 *
 * 设计原则：
 *   - 零依赖、零副作用导入（不在 module-init 时碰平台 API）
 *   - 所有 detect/get 都是函数；运行时按需查询，便于 mock
 *   - 任何检测失败均返回 null（远端配置可整体降级到 fallback）
 *
 * 接入方式（gameRulesRemote）：
 *   const { detectStorage, detectFetch } = require('./lib/platformShim');
 *   initRemoteRules({
 *     url,
 *     storage:   detectStorage(),
 *     fetchImpl: detectFetch(),
 *     verifier,
 *   });
 */

/* ---------------- storage ---------------- */

/**
 * 返回一个 {getItem,setItem,removeItem} 三件套，按平台优先级：
 *   1) globalThis.localStorage（web / RN with polyfill）
 *   2) wx.getStorageSync / wx.setStorageSync（微信小程序）
 *   3) cc.sys.localStorage（cocos creator native，桥到原生 NSUserDefaults / SharedPreferences）
 *   4) 内存 fallback（无持久化，仅本次进程，避免崩溃）
 *
 * 注意：wx 是同步 API；与 localStorage 接口对齐用同步包装；体积小不会卡帧。
 */
function detectStorage() {
    /* 1. web localStorage */
    try {
        if (typeof localStorage !== 'undefined'
            && typeof localStorage.getItem === 'function') {
            return {
                getItem: (k) => localStorage.getItem(k),
                setItem: (k, v) => localStorage.setItem(k, v),
                removeItem: (k) => localStorage.removeItem(k),
                backend: 'localStorage',
            };
        }
    } catch { /* private mode 等 */ }

    /* 2. wx 小程序 */
    try {
        const wx = typeof globalThis !== 'undefined' ? globalThis.wx : undefined;
        if (wx && typeof wx.getStorageSync === 'function') {
            return {
                getItem: (k) => { try { return wx.getStorageSync(k) || null; } catch { return null; } },
                setItem: (k, v) => { try { wx.setStorageSync(k, v); } catch { /* quota */ } },
                removeItem: (k) => { try { wx.removeStorageSync(k); } catch { /* */ } },
                backend: 'wx',
            };
        }
    } catch { /* */ }

    /* 3. cocos creator */
    try {
        const cc = typeof globalThis !== 'undefined' ? globalThis.cc : undefined;
        const ls = cc?.sys?.localStorage;
        if (ls && typeof ls.getItem === 'function') {
            return {
                getItem: (k) => ls.getItem(k),
                setItem: (k, v) => ls.setItem(k, v),
                removeItem: (k) => ls.removeItem(k),
                backend: 'cc.sys',
            };
        }
    } catch { /* */ }

    /* 4. 内存 fallback */
    const mem = new Map();
    return {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k),
        backend: 'memory',
    };
}

/* ---------------- fetch ---------------- */

/**
 * 返回一个 (url, timeoutMs) → Promise<json> 的 fetch 实现。
 *
 * 优先级：
 *   1) 全局 fetch（web / node18+ / wx 高版本 polyfill）
 *   2) wx.request（小程序原生）
 *   3) XMLHttpRequest（cocos web 构建）
 *   4) null（无可用网络层；调用方会走 fallback）
 *
 * 统一约定：
 *   - 仅支持 GET
 *   - 默认期望 JSON，自动 JSON.parse；非 JSON 抛错
 *   - 超时按 timeoutMs 截断（wx.request 自带 timeout 字段，fetch 用 AbortController）
 */
function detectFetch() {
    /* 1. global fetch */
    if (typeof fetch === 'function') {
        return async (url, timeoutMs) => {
            const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
            try {
                const r = await fetch(url, { signal: ctrl?.signal });
                if (!r.ok) throw new Error(`http ${r.status}`);
                return await r.json();
            } finally { if (timer) clearTimeout(timer); }
        };
    }

    /* 2. wx.request */
    try {
        const wx = typeof globalThis !== 'undefined' ? globalThis.wx : undefined;
        if (wx && typeof wx.request === 'function') {
            return (url, timeoutMs) => new Promise((resolve, reject) => {
                wx.request({
                    url, method: 'GET', timeout: timeoutMs, dataType: 'json',
                    success: (res) => {
                        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
                        else reject(new Error(`wx http ${res.statusCode}`));
                    },
                    fail: (err) => reject(new Error(err?.errMsg || 'wx fetch failed')),
                });
            });
        }
    } catch { /* */ }

    /* 3. XHR fallback */
    if (typeof XMLHttpRequest !== 'undefined') {
        return (url, timeoutMs) => new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = timeoutMs;
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(new Error('json parse: ' + e.message)); }
                } else {
                    reject(new Error(`xhr http ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('xhr error'));
            xhr.ontimeout = () => reject(new Error('xhr timeout'));
            xhr.send();
        });
    }

    return null;
}

/**
 * 探测 WebCrypto 是否可用（用于决定能否走 Ed25519）。
 * 小程序部分版本 / cocos native runtime 可能没有 subtle。
 */
function hasWebCrypto() {
    return typeof crypto !== 'undefined' && !!crypto.subtle;
}

/**
 * 一键构造 remote-config 推荐参数（storage + fetchImpl）。
 * 调用方仍可覆盖任意字段。
 */
function buildRemoteConfigDefaults() {
    return {
        storage: detectStorage(),
        fetchImpl: detectFetch(),
        webCrypto: hasWebCrypto(),
    };
}

module.exports = { buildRemoteConfigDefaults, detectFetch, detectStorage, hasWebCrypto };
