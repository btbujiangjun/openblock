/**
 * netConfig.js — 统一客户端网络上报配置（Web 侧 SSOT）
 *
 * 默认值与 schema 来自 shared/client_net_config.json（全端唯一权威源）。
 * 各端 reportingOutbox 接受同一份配置形状（apiBase / platform / appVersion /
 * enabled / flushIntervalMs / batchSize / maxQueue / maxRetryBackoffMs / channels）。
 * `resolveNetConfig(overrides)` 把运行时覆写合并到默认值，保证字段口径一致。
 */

import DEFAULTS from '../../../shared/client_net_config.json';

export const NET_CONFIG_SCHEMA_VERSION = DEFAULTS.schemaVersion;
export const NET_CONFIG_DEFAULTS = DEFAULTS;

/** 合并默认值 + 运行时覆写 → 统一配置对象。 */
export function resolveNetConfig(overrides = {}) {
    const o = overrides || {};
    return {
        schemaVersion: DEFAULTS.schemaVersion,
        apiBase: (o.apiBase != null ? o.apiBase : DEFAULTS.apiBase) || '',
        platform: o.platform || DEFAULTS.platform,
        appVersion: o.appVersion || DEFAULTS.appVersion,
        enabled: o.enabled != null ? o.enabled : DEFAULTS.enabled,
        flushIntervalMs: o.flushIntervalMs || DEFAULTS.flushIntervalMs,
        batchSize: o.batchSize || DEFAULTS.batchSize,
        maxQueue: o.maxQueue || DEFAULTS.maxQueue,
        maxRetryBackoffMs: o.maxRetryBackoffMs || DEFAULTS.maxRetryBackoffMs,
        channels: { ...DEFAULTS.channels, ...(o.channels || {}) },
    };
}
