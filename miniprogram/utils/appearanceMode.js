/**
 * appearanceMode.js — 小程序界面风格三档循环（标准 / 精致 / 精致+特效）
 */

const storage = require('../adapters/storage');
const {
  resolveAppearanceMode,
  cycleAppearanceMode,
  getAppearanceState,
  getAppearanceMeta,
  APPEARANCE_MODES,
} = require('../core/effects/appearanceModeCore');
const { loadPremiumPrefs } = require('../core/effects/skinPremiumCore');
const { setSkinPremiumEnabled } = require('./skinPremium');
const { loadVisualPrefs } = require('./feedbackToggles');

let _page = null;
let _toggles = null;
let _mode = 'basic';

function _syncPage(mode) {
  if (!_page || typeof _page.setData !== 'function') return;
  const meta = getAppearanceMeta(mode);
  const active = mode !== 'basic';
  _page.setData({
    appearanceMode: mode,
    appearanceIcon: meta.icon,
    appearanceLabel: meta.ariaLabel,
    appearanceClass: active ? 'fx-toggle--on' : 'fx-toggle--off',
  });
}

function applyAppearanceMode(mode, { persist = true, toggles } = {}) {
  _mode = APPEARANCE_MODES.includes(mode) ? mode : 'basic';
  const { premiumEnabled, visualEnabled } = getAppearanceState(_mode);
  setSkinPremiumEnabled(premiumEnabled, { persist });
  const ctrl = toggles || _toggles;
  ctrl?.setVisualEnabled?.(visualEnabled, { persist });
  _syncPage(_mode);
  return _mode;
}

function initAppearanceMode({ page, toggles } = {}) {
  _page = page || null;
  _toggles = toggles || null;
  _mode = resolveAppearanceMode({
    premiumEnabled: loadPremiumPrefs(storage).enabled,
    visualEnabled: loadVisualPrefs().enabled,
  });
  applyAppearanceMode(_mode, { persist: false, toggles: _toggles });
}

function cycleAppearanceModeOnPage({ toggles, audio } = {}) {
  const next = cycleAppearanceMode(_mode);
  applyAppearanceMode(next, { toggles: toggles || _toggles });
  try { audio?.play?.('tick', { force: true }); } catch { /* ignore */ }
  return next;
}

function getAppearanceMode() {
  return _mode;
}

module.exports = {
  initAppearanceMode,
  applyAppearanceMode,
  cycleAppearanceModeOnPage,
  getAppearanceMode,
};
