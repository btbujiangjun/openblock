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

function _resolveLevel() {
    if (typeof globalThis === 'undefined') return LEVELS.info;
    const raw = String(globalThis.__OPENBLOCK_LOG_LEVEL__ || 'info').toLowerCase();
    return LEVELS[raw] ?? LEVELS.info;
}

function _emit(method, tag, args) {
    /* console 在 Cocos 原生 / 老 Capacitor 上偶有缺失方法，做兜底。 */
    const fn = (typeof console !== 'undefined' && typeof console[method] === 'function')
        ? console[method]
        : (typeof console !== 'undefined' && typeof console.log === 'function' ? console.log : null);
    if (!fn) return;
    fn(`[${tag}]`, ...args);
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
        warn(...args)  { if (_resolveLevel() <= LEVELS.warn)  _emit('warn',  _tag, args); },
        error(...args) { if (_resolveLevel() <= LEVELS.error) _emit('error', _tag, args); },
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
