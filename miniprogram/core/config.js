/**
 * config.js — 小程序适配版。
 *
 * 小程序玩家端只保留本地玩法配置，不连接训练或状态后端。
 */
const { GAME_RULES, buildDefaultStrategiesMap } = require('./gameRules');

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
  getStrategy,
};
