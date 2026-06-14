/**
 * reportingOutbox.js — 小程序上报发件箱（无网络本地缓存 + 联网批量上报）
 *
 * 与 web/src/net/reportingOutbox.js、cocos ReportingOutbox.ts **同配置 · 同协议**：
 *   - behavior：玩家行为 → POST /api/behavior/batch
 *   - ad：广告按次计费   → POST /api/ad/impression
 *
 * 统一配置格式（见 shared/client_net_config.json）：
 *   { apiBase, platform, appVersion, enabled, flushIntervalMs, batchSize, maxQueue,
 *     maxRetryBackoffMs, channels }
 * 每条记录自动盖 envelope（platform/app_version），批次级 meta 同样带 platform/app_version，
 * 供后端按端做分端统计。
 *
 * 小程序特性：
 *   - 持久化：wx.getStorageSync / wx.setStorageSync（同步、断电不丢）；
 *   - 传输：wx.request；网络感知：wx.getNetworkType + wx.onNetworkStatusChange；
 *   - 每条带 event_id，服务端去重；上报成功才出队（at-least-once）；
 *   - 纯失败指数退避（仅作用于周期触发）。
 *
 * apiBase 未配置（且未传 enabled）→ 仅本地缓存不上报，不影响纯本地玩法。
 */

// 默认配置（与 shared/client_net_config.json 同字段；小程序无构建期 JSON import，内联镜像）。
var NET_DEFAULTS = {
  schemaVersion: 1,
  apiBase: '',
  platform: 'miniprogram',
  appVersion: '0.0.0',
  enabled: false,
  flushIntervalMs: 15000,
  batchSize: 200,
  maxQueue: 1000,
  maxRetryBackoffMs: 120000,
  channels: { behavior: '/api/behavior/batch', ad: '/api/ad/impression' },
};

const KEY_PREFIX = 'openblock_outbox_';

let _cfg = Object.assign({}, NET_DEFAULTS);
let _timer = null;
let _flushing = false;
let _online = true;
let _failStreak = 0;
let _backoffUntil = 0;

function _resolveCfg(opts) {
  const o = opts || {};
  let apiBase = o.apiBase;
  if (apiBase == null) {
    try { apiBase = globalThis.__OPENBLOCK_API_BASE__ || ''; } catch { apiBase = ''; }
  }
  return {
    schemaVersion: NET_DEFAULTS.schemaVersion,
    apiBase: apiBase || '',
    platform: o.platform || NET_DEFAULTS.platform,
    appVersion: o.appVersion || NET_DEFAULTS.appVersion,
    enabled: o.enabled != null ? o.enabled : Boolean(apiBase),
    flushIntervalMs: o.flushIntervalMs || NET_DEFAULTS.flushIntervalMs,
    batchSize: o.batchSize || NET_DEFAULTS.batchSize,
    maxQueue: o.maxQueue || NET_DEFAULTS.maxQueue,
    maxRetryBackoffMs: o.maxRetryBackoffMs || NET_DEFAULTS.maxRetryBackoffMs,
    channels: Object.assign({}, NET_DEFAULTS.channels, o.channels || {}),
  };
}

function _key(channel) { return KEY_PREFIX + channel; }

function _load(channel) {
  try {
    const raw = wx.getStorageSync(_key(channel));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function _save(channel, list) {
  try { wx.setStorageSync(_key(channel), JSON.stringify(list)); } catch { /* ignore */ }
}

function _genId(channel) {
  return `${channel}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function enqueue(channel, record) {
  if (!_cfg.channels[channel]) return;
  const list = _load(channel);
  const rec = Object.assign({}, record);
  if (!rec.event_id) rec.event_id = _genId(channel);
  if (rec.platform == null) rec.platform = _cfg.platform;        // 分端统计
  if (rec.app_version == null) rec.app_version = _cfg.appVersion;
  if (rec.ts == null && rec.timestamp == null) rec.ts = Date.now();
  list.push(rec);
  if (list.length > _cfg.maxQueue) list.splice(0, list.length - _cfg.maxQueue);
  _save(channel, list);
  return rec.event_id;
}

function pendingCount(channel) {
  if (channel) return _load(channel).length;
  return Object.keys(_cfg.channels).reduce((n, c) => n + _load(c).length, 0);
}

function _flushChannel(channel) {
  return new Promise((resolve) => {
    const list = _load(channel);
    if (!list.length) { resolve({ sent: 0 }); return; }
    const batch = list.slice(0, _cfg.batchSize);
    const base = (_cfg.apiBase || '').replace(/\/+$/, '');
    wx.request({
      url: `${base}${_cfg.channels[channel]}`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { platform: _cfg.platform, app_version: _cfg.appVersion, events: batch },
      success: (res) => {
        const ok = res && res.statusCode >= 200 && res.statusCode < 300;
        if (!ok) { resolve({ sent: 0, error: true }); return; }
        const sentIds = {};
        batch.forEach((r) => { sentIds[r.event_id] = true; });
        _save(channel, _load(channel).filter((r) => !sentIds[r.event_id]));
        resolve({ sent: batch.length });
      },
      fail: () => resolve({ sent: 0, error: true }),
    });
  });
}

async function flush() {
  if (!_cfg.enabled || _flushing || !_online) return;
  _flushing = true;
  let anyError = false;
  let anySent = false;
  try {
    for (const channel of Object.keys(_cfg.channels)) {
      const r = await _flushChannel(channel);
      if (r.error) anyError = true;
      if (r.sent) anySent = true;
    }
  } finally {
    _flushing = false;
  }
  if (anySent || !anyError) {
    _failStreak = 0;
    _backoffUntil = 0;
  } else if (anyError) {
    _failStreak += 1;
    const wait = Math.min(_cfg.maxRetryBackoffMs, _cfg.flushIntervalMs * Math.pow(2, Math.min(_failStreak, 6)));
    _backoffUntil = Date.now() + wait;
  }
}

function _tick() {
  if (Date.now() < _backoffUntil) return;
  void flush();
}

function initReportingOutbox(opts) {
  _cfg = _resolveCfg(opts);
  _failStreak = 0;
  _backoffUntil = 0;
  if (_timer) { clearInterval(_timer); _timer = null; }
  _timer = setInterval(_tick, _cfg.flushIntervalMs);
  try {
    wx.getNetworkType({ success: (res) => { _online = res.networkType !== 'none'; } });
    wx.onNetworkStatusChange((res) => {
      _online = res.isConnected;
      if (_online) { _backoffUntil = 0; void flush(); }
    });
  } catch { /* ignore */ }
  void flush();
  return _cfg;
}

function getNetConfig() { return Object.assign({}, _cfg); }

module.exports = { enqueue, pendingCount, flush, initReportingOutbox, getNetConfig };
