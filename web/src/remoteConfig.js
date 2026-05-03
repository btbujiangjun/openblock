/**
 * 远程配置（GET /api/enterprise/remote-config）
 * 与 shared/remote_config.default.json + 环境变量 OPENBLOCK_REMOTE_CONFIG_JSON 合并结果对齐。
 */
import { getApiBaseUrl } from './config.js';
import { isSqliteClientDatabase } from './config.js';

let _cache = null;
let _fetchedAt = 0;

/** @returns {Promise<Record<string, unknown>>} */
export async function fetchRemoteConfig({ force = false } = {}) {
    if (_cache && !force && Date.now() - _fetchedAt < 120_000) {
        return _cache;
    }
    if (!isSqliteClientDatabase()) {
        _cache = {};
        return _cache;
    }
    try {
        const base = getApiBaseUrl().replace(/\/+$/, '');
        const res = await fetch(`${base}/api/enterprise/remote-config`);
        if (!res.ok) throw new Error(String(res.status));
        _cache = await res.json();
        _fetchedAt = Date.now();
        try {
            window.__OPENBLOCK_REMOTE_CONFIG__ = _cache;
        } catch {
            /* non-browser */
        }
        return _cache;
    } catch {
        _cache = _cache || {};
        return _cache;
    }
}

/** @returns {Record<string, unknown>} 最近一次拉取结果（未拉取则为 {}） */
export function getRemoteConfigSync() {
    return _cache || {};
}
