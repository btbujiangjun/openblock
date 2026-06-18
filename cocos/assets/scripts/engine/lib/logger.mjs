/* 自动生成 —— 请勿手改。源：web/src/lib/logger.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * lib/logger.js — 轻量统一日志（v1.70 引入）
 *
 * 目标：替代散点 `console.warn / console.error`，提供：
 *   - 命名空间（per-module tag，方便过滤）
 *   - 级别（debug/info/warn/error），生产可调高最低级别屏蔽噪声
 *   - 一致前缀格式 `[tag] message`
 *   - 零依赖、纯 ESM、SSR 安全（typeof globalThis 守卫）
 *
 * 用法：
 *   import { createLogger } from './lib/logger.mjs';
 *   const log = createLogger('lifecycle');
 *   log.warn('orchestrator init failed', err);
 *
 * 调级（生产环境从 url / global flag 改）：
 *   globalThis.__OPENBLOCK_LOG_LEVEL__ = 'error';   // 屏蔽 debug/info/warn
 *
 * 显式 trace（仅 debug 级别可见）：
 *   log.debug('detail');
 *
 * 设计权衡：
 *   - 不做远端上报（避免循环：日志上报又触发日志）。结构化埋点请走 analyticsTracker。
 *   - 不引入异步队列。控制台同步输出，故 SSR / 早期 init 都可用。
 *   - 不要在 hot path（每帧/每步）调用 `log.debug`——字符串拼接成本不为零，
 *     推荐 `if (log.isDebug) log.debug(...)` 二次门控。
 */

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 99 });

/* ── v1.71 ring buffer + 远程结构化上报 ────────────────────────────────
 * 设计目标：
 *   - 进程内保留最近 N 条结构化日志（含时间、级别、tag、参数），
 *     在 error 触发时整批 dump 给上报 sink，给运维"事故现场上下文"
 *   - 远程上报 sink 默认 no-op；业务侧（analyticsTracker / Sentry / Datadog）
 *     通过 setRemoteSink(fn) 注入；纯函数 sink，错误自动被 logger 兜住不传染
 *   - 同 tag+message 错误 30s 内只上报 1 次（防风暴）
 *   - 上报零阻塞：所有 sink 调用走 try-catch，且失败不会回流到 logger 自身
 *
 * 不做的事：
 *   - 不引入异步队列（保持 SSR/早期 init 同步可用；上报 sink 自己处理 batch）
 *   - 不持久化（防 GDPR / 跨设备追踪）
 *   - 不暴露内部 buffer 给业务侧迭代（防内存泄漏）；只在 error 时通过 sink 回调暴露 */

const RING_CAPACITY = 200;
const _ringBuffer = new Array(RING_CAPACITY); // 循环数组
let _ringHead = 0;                              // 下一条要写入的位置
let _ringSize = 0;                              // 当前已写条数（≤ RING_CAPACITY）
const _errorDedupe = new Map();                 // `${tag}|${msg}` → lastTsMs
const ERROR_DEDUPE_WINDOW_MS = 30_000;
let _remoteSink = null;                         // (entry, recentContext) => void | null

/* 解析优先级（高 → 低）：
 *   1. URL ?log=<level>      （前端临时调试）
 *   2. globalThis.__OPENBLOCK_LOG_LEVEL__   （setLogLevel / 测试 / 远程注入）
 *   3. 默认 'info'             （安装时编译期默认；运行期可被 configureLoggerFromConfig 覆盖）
 *
 * 缓存 globalThis 解析结果以避免每条日志都 parse URL。URL 变化场景极少；
 * 调试想换级别可以直接 setLogLevel。 */
let _urlChecked = false;
function _checkUrlOverride() {
    if (_urlChecked || typeof globalThis === 'undefined') { _urlChecked = true; return; }
    _urlChecked = true;
    try {
        const loc = globalThis.location;
        if (!loc || typeof loc.search !== 'string') return;
        const m = /[?&]log=([^&]+)/i.exec(loc.search);
        if (m) {
            const lvl = String(m[1]).toLowerCase();
            if (LEVELS[lvl] !== undefined) globalThis.__OPENBLOCK_LOG_LEVEL__ = lvl;
        }
    } catch { /* ignore */ }
}

function _resolveLevel() {
    if (typeof globalThis === 'undefined') return LEVELS.info;
    _checkUrlOverride();
    const raw = String(globalThis.__OPENBLOCK_LOG_LEVEL__ || 'info').toLowerCase();
    return LEVELS[raw] ?? LEVELS.info;
}

function _emit(method, tag, args, extra) {
    /* 1. 写入 ring buffer（每条结构化记录） */
    const entry = {
        ts: Date.now(),
        level: method,
        tag,
        args, // 注意：保留引用；sink 端如需序列化自行 try/catch
        /* DD4：可选结构化字段。
         * 与 args 区分：args=人读字符串/对象；extra=机读 key→value 标签，
         * 服务端可按 extra.<field> group_by 聚合（如 game_mode, screen, build_id）。
         * 不传 extra 时为 undefined（向后兼容；服务端按缺失字段处理）。 */
        extra: extra ?? undefined,
    };
    _ringBuffer[_ringHead] = entry;
    _ringHead = (_ringHead + 1) % RING_CAPACITY;
    if (_ringSize < RING_CAPACITY) _ringSize++;

    /* 2. console 输出（兼容 Cocos 原生 / 老 Capacitor 偶缺方法） */
    const fn = (typeof console !== 'undefined' && typeof console[method] === 'function')
        ? console[method]
        : (typeof console !== 'undefined' && typeof console.log === 'function' ? console.log : null);
    if (fn) fn(`[${tag}]`, ...args);

    /* 3. error 级别触发远程上报（去重 + 兜错） */
    if (method === 'error' && _remoteSink) {
        const firstArg = args[0];
        const msgKey = `${tag}|${typeof firstArg === 'string' ? firstArg : (firstArg?.message || 'err')}`;
        const lastTs = _errorDedupe.get(msgKey) || 0;
        if (entry.ts - lastTs >= ERROR_DEDUPE_WINDOW_MS) {
            _errorDedupe.set(msgKey, entry.ts);
            try {
                _remoteSink(entry, _snapshotRing());
            } catch { /* sink 失败不传染 logger 自身 */ }
        }
    }
}

/**
 * 返回 ring buffer 的有序快照（旧→新）。WeakMap 不可，必须新建数组。
 * 内部使用；sink 端收到该数组后请视为不可变（O(N) 拷贝避免业务侧污染内部状态）。
 */
function _snapshotRing() {
    const out = new Array(_ringSize);
    if (_ringSize < RING_CAPACITY) {
        /* 还没填满：0..head-1 即顺序 */
        for (let i = 0; i < _ringSize; i++) out[i] = _ringBuffer[i];
    } else {
        /* 已绕回：从 head 开始读 */
        for (let i = 0; i < RING_CAPACITY; i++) {
            out[i] = _ringBuffer[(_ringHead + i) % RING_CAPACITY];
        }
    }
    return out;
}

/**
 * @param {string} tag 模块标签，例如 'lifecycle' / 'spawn' / 'profile'
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function, isDebug: boolean }}
 */
export function createLogger(tag = 'app') {
    const _tag = String(tag || 'app');
    return {
        get isDebug() { return _resolveLevel() <= LEVELS.debug; },
        debug(...args) { if (_resolveLevel() <= LEVELS.debug) _emit('debug', _tag, args); },
        info(...args)  { if (_resolveLevel() <= LEVELS.info)  _emit('info',  _tag, args); },
        /** log 是 info 的别名 —— 历史 console.log 散点迁移友好（语义=普通日志，info 级别） */
        log(...args)   { if (_resolveLevel() <= LEVELS.info)  _emit('log',   _tag, args); },
        warn(...args)  { if (_resolveLevel() <= LEVELS.warn)  _emit('warn',  _tag, args); },
        error(...args) { if (_resolveLevel() <= LEVELS.error) _emit('error', _tag, args); },
        /**
         * DD4：带结构化字段的 error 上报。
         * 与 .error(...) 等价 + 附加 extra 字段（写入 entry.extra）。
         *
         *   log.errorWithExtra('decode failed', err, { gameMode: 'classic', buildId: '1.71.2' });
         *
         * 服务端可按 extra.gameMode group_by 聚合错误率。
         *
         * @param {object} extra 结构化字段（推荐 flat key→primitive）
         * @param {...*}   args  普通参数（同 error）
         */
        errorWithExtra(extra, ...args) {
            if (_resolveLevel() <= LEVELS.error) _emit('error', _tag, args, extra);
        },
    };
}

/** 测试 / 远端配置场景下显式覆写级别（与 globalThis flag 等价但更显式）。 */
export function setLogLevel(level) {
    if (typeof globalThis === 'undefined') return;
    if (LEVELS[String(level).toLowerCase()] !== undefined) {
        globalThis.__OPENBLOCK_LOG_LEVEL__ = String(level).toLowerCase();
    }
}

export const LOG_LEVELS = LEVELS;

/**
 * 注入远程上报 sink。当 error 级别被触发时（且通过去重窗口），
 * sink 收到当前 entry + 整个 ring buffer 的快照（旧→新有序）。
 *
 *   setRemoteSink((entry, recentContext) => {
 *     analyticsTracker.trackEvent('client_error', { entry, recentContext });
 *   });
 *
 * 传 null 即可禁用上报。
 *
 * @param {((entry: {ts:number,level:string,tag:string,args:Array}, recentContext: Array) => void) | null} sink
 */
export function setRemoteSink(sink) {
    _remoteSink = typeof sink === 'function' ? sink : null;
}

/**
 * 调试 / 自检：返回 ring buffer 快照。生产代码不应频繁调用（会拷贝整个 buffer）。
 * 主要用于：
 *   - perfOverlay / DevTools 查看最近日志
 *   - 单测断言 error 是否被记录
 */
export function getRecentLogs() {
    return _snapshotRing();
}

/** 测试 / hot-reload 专用：清空 ring buffer + 去重表。 */
export function _resetLoggerState() {
    _ringHead = 0;
    _ringSize = 0;
    _errorDedupe.clear();
    for (let i = 0; i < RING_CAPACITY; i++) _ringBuffer[i] = undefined;
}

/**
 * 根据 game_rules.logging 段 + 运行环境设定级别。
 * 调用顺序：main.js 启动时尽早调用一次；URL ?log= 仍可覆盖。
 *
 * @param {object} rules game_rules 对象（含 logging 段）
 * @param {'dev'|'prod'} [env] 运行环境；默认根据 import.meta.env.MODE / location.hostname 启发判断
 */
export function configureLoggerFromConfig(rules, env) {
    if (typeof globalThis === 'undefined') return;
    /* URL 覆盖最高优先级，已设过就不动 */
    _checkUrlOverride();
    if (globalThis.__OPENBLOCK_LOG_LEVEL__ && globalThis.__OPENBLOCK_LOG_LEVEL__ !== 'info') return;
    let resolvedEnv = env;
    if (!resolvedEnv) {
        try {
            const host = globalThis.location?.hostname || '';
            resolvedEnv = (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) ? 'dev' : 'prod';
        } catch { resolvedEnv = 'prod'; }
    }
    const cfg = rules?.logging || {};
    const level = (resolvedEnv === 'prod' ? cfg.prodLevel : cfg.defaultLevel) || cfg.defaultLevel || 'info';
    setLogLevel(level);
}
