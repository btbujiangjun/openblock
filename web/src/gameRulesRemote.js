/**
 * OO4 / NN-F2.1: Remote Game Rules Fetcher (PoC 骨架)
 *
 * 提供"客户端拉远端 game_rules.json"的核心运行时，不绑定具体 CDN / 签名算法。
 *
 * 设计目标（参见 ADR-007）：
 *   - bundle 内置 GAME_RULES 始终是 fallback；任何远端失败均回退；
 *   - 远端版本必须通过 _migrateRules（NN-C3）的 schema 校验；
 *     未来 schema → 拒绝（throw），保持 fallback；
 *   - 单次启动只发一次 fetch；缓存 24h；
 *   - 签名校验通过可注入 verifier；默认 verifier 始终返回 true（PoC 阶段不强制）。
 *
 * 用法（启动期）：
 *   import { initRemoteRules } from './gameRulesRemote.js';
 *   initRemoteRules({ url: 'https://cdn.example.com/rules/v1.json' })
 *     .then(({ source, rules }) => console.log('rules from', source));
 *
 * 读：仍走 `import { GAME_RULES } from './gameRules.js'` —— 远端命中时，
 * gameRules 模块的内部 mutable 缓存会被覆盖（见 _applyRules）。
 *
 * 当前阶段 = PoC：
 *   - 不接 CDN；
 *   - 不实现 Ed25519；
 *   - 不接 A/B bucket（按 ADR F2.3 后续）。
 */

import { GAME_RULES, _replaceRulesForRemoteSync } from './gameRules.js';

const STORAGE_KEY = 'openblock_remote_rules_v1';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; /* 24h */
const FETCH_TIMEOUT_MS = 5_000;
/* 重试预算：同一启动失败 ≥ MAX_FAILURES 后本次启动不再重试，避免 CDN 故障刷流量。 */
const MAX_FAILURES_PER_SESSION = 3;

let _sessionFailures = 0;
let _inflight = null;

/* 抽象 storage 读写，避免直接耦合 localStorage（cocos / 小程序 shim） */
function _readCache(storage) {
    try {
        const raw = storage?.getItem?.(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch { return null; }
}

function _writeCache(storage, entry) {
    try { storage?.setItem?.(STORAGE_KEY, JSON.stringify(entry)); } catch { /* ignore */ }
}

function _now() { return Date.now(); }

function _isCacheFresh(entry) {
    if (!entry || typeof entry.ts !== 'number') return false;
    return _now() - entry.ts < REFRESH_INTERVAL_MS;
}

/**
 * 默认 verifier：PoC 阶段无签名 → 直返 true。
 * 生产应注入 verifier({ payload, signature, publicKey }) → boolean。
 */
function _defaultVerifier() { return true; }

/**
 * 默认 fetch 实现：浏览器/node18+ 有全局 fetch；其余平台需由调用方传入。
 */
async function _defaultFetch(url, timeoutMs) {
    if (typeof fetch !== 'function') throw new Error('no global fetch');
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
        const r = await fetch(url, { signal: ctrl?.signal });
        if (!r.ok) throw new Error(`http ${r.status}`);
        return await r.json();
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * 把远端 rules 注入 gameRules.js 内部缓存（_replaceRulesForRemoteSync 由 gameRules 提供）。
 * 若 gameRules 未导出 replace 接口 → 静默放弃，仅返回 rules 给调用方观察。
 */
function _applyRules(rules) {
    try {
        if (typeof _replaceRulesForRemoteSync === 'function') {
            _replaceRulesForRemoteSync(rules);
            return true;
        }
    } catch { /* ignore */ }
    return false;
}

/**
 * 主入口：初始化远程 rules 拉取。
 *
 * @param {object} opts
 * @param {string} opts.url               必填，远端 JSON URL
 * @param {object} [opts.storage]         读/写缓存的对象（typeof getItem/setItem）
 * @param {Function} [opts.fetchImpl]     注入 fetch（小程序 / cocos 用）
 * @param {Function} [opts.verifier]      签名验证 ({payload,signature}) → boolean
 * @param {number}   [opts.timeoutMs]     单次拉取超时
 * @param {Function} [opts.now]           注入时间源（测试）
 * @returns {Promise<{source:'cache'|'remote'|'fallback', rules:object}>}
 */
export async function initRemoteRules(opts) {
    if (!opts || typeof opts.url !== 'string' || !opts.url) {
        return { source: 'fallback', rules: GAME_RULES, reason: 'no-url' };
    }
    if (_inflight) return _inflight;

    const storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    const fetchImpl = opts.fetchImpl ?? _defaultFetch;
    const verifier = opts.verifier ?? _defaultVerifier;
    const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

    _inflight = (async () => {
        /* 1. cache 命中且新鲜 → 直接用 */
        const cached = _readCache(storage);
        if (_isCacheFresh(cached) && cached.rules) {
            try {
                /* 同样要走 schema 校验，cache 可能跨版本 */
                _applyRules(cached.rules);
                return { source: 'cache', rules: cached.rules };
            } catch {
                /* schema 漂移 → 丢弃 cache，继续走 remote/fallback */
            }
        }

        /* 2. 远端拉 */
        if (_sessionFailures >= MAX_FAILURES_PER_SESSION) {
            return { source: 'fallback', rules: GAME_RULES, reason: 'budget-exhausted' };
        }
        try {
            const payload = await fetchImpl(opts.url, timeoutMs);
            /* payload 约定：{ schemaVersion, rules, signature? } */
            if (!payload || typeof payload !== 'object' || !payload.rules) {
                throw new Error('invalid payload shape');
            }
            if (payload.signature && !verifier({ payload: payload.rules, signature: payload.signature })) {
                throw new Error('signature verification failed');
            }
            /* schema 校验由 gameRules 内 _migrateRules 在 apply 时间接完成；
             * 远端 rules 必须含 schemaVersion 字段，否则 _migrateRules 会按"未声明 → 1"处理。 */
            const applied = _applyRules(payload.rules);
            if (!applied) throw new Error('apply skipped (no replace interface)');
            _writeCache(storage, { ts: _now(), rules: payload.rules });
            return { source: 'remote', rules: payload.rules };
        } catch (e) {
            _sessionFailures++;
            /* 失败 → 若 cache 还在（哪怕过期）也用，避免 CDN 故障让用户拿不到任何远端配置 */
            if (cached?.rules) {
                try {
                    _applyRules(cached.rules);
                    return { source: 'cache', rules: cached.rules, reason: 'remote-failed-stale-cache' };
                } catch { /* schema 不兼容 → fallback */ }
            }
            return { source: 'fallback', rules: GAME_RULES, reason: e.message };
        }
    })();

    try { return await _inflight; }
    finally { _inflight = null; }
}

/* 测试辅助 —— 不导出给生产路径使用。 */
export function _resetRemoteRulesForTest() {
    _sessionFailures = 0;
    _inflight = null;
}

export const _internal = {
    STORAGE_KEY,
    REFRESH_INTERVAL_MS,
    MAX_FAILURES_PER_SESSION,
    _isCacheFresh,
};
