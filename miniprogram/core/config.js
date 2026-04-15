/**
 * config.js — 小程序适配版。
 *
 * 原始 web/src/config.js 强依赖 import.meta.env 和 localStorage，
 * 此文件用 wx.getStorageSync 和 envConfig.js 替代。
 */
const { GAME_RULES, buildDefaultStrategiesMap } = require('./gameRules');
const storage = require('../adapters/storage');

const CLASSIC_PALETTE = [
  '#70AD47', '#5B9BD5', '#ED7D31', '#FFC000',
  '#4472C4', '#9E480E', '#E74856', '#8764B8',
];

const _defaultSid = GAME_RULES.defaultStrategyId || 'normal';
const _defaultGrid = (GAME_RULES.strategies[_defaultSid] || {}).gridWidth || 8;

const CONFIG = {
  GRID_SIZE: _defaultGrid,
  CELL_SIZE: 38,
  PLACE_SNAP_RADIUS: 2,
  DOCK_PREVIEW_MAX_CELLS: 5,
};

function getApiBaseUrl() {
  try {
    const env = require('../envConfig');
    if (env.apiBaseUrl) return env.apiBaseUrl.replace(/\/+$/, '');
  } catch { /* */ }
  const legacy = storage.getItem('api_url');
  if (legacy) return legacy.replace(/\/+$/, '');
  return '';
}

function isBackendSyncEnabled() {
  try {
    return require('../envConfig').syncBackend === true;
  } catch {
    return false;
  }
}

function isRlPytorchBackendPreferred() {
  try {
    return require('../envConfig').usePytorchRl === true;
  } catch {
    return false;
  }
}

const COLORS = CLASSIC_PALETTE;

const DEFAULT_STRATEGIES = buildDefaultStrategiesMap();

function getStrategy(id) {
  const s = DEFAULT_STRATEGIES[id || _defaultSid];
  if (!s) return DEFAULT_STRATEGIES[_defaultSid] || DEFAULT_STRATEGIES.normal;
  return {
    ...s,
    gridWidth: s.gridWidth || _defaultGrid,
    gridHeight: s.gridHeight || _defaultGrid,
  };
}

module.exports = {
  CONFIG,
  COLORS,
  CLASSIC_PALETTE,
  DEFAULT_STRATEGIES,
  getApiBaseUrl,
  isBackendSyncEnabled,
  isRlPytorchBackendPreferred,
  getStrategy,
};
