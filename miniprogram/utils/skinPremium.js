/**
 * skinPremium.js — 小程序精致界面 / S 级渲染开关
 *
 * 逻辑与存储契约来自 core/effects/skinPremiumCore.js（与 Web 同源）。
 * 本层负责 pageStyle CSS 变量映射、renderer premium 同步与 HUD 开关。
 */

const storage = require('../adapters/storage');
const { getActiveSkin } = require('../core/skins');
const {
  SKIN_PREMIUM_STORAGE_KEY,
  PREMIUM_VAR_KEYS,
  PREMIUM_ACTIVE_CLASS,
  loadPremiumPrefs,
  savePremiumPrefs,
  computePremiumSkinVars,
  isPremiumRenderEnabled,
} = require('../core/effects/skinPremiumCore');

let _page = null;
let _renderer = null;
let _getQualityMode = () => 'high';
let _getBasePageStyle = () => '';
let _enabled = false;

function _skinForPremium() {
  try {
    const skin = getActiveSkin();
    if (!skin) return null;
    if (skin.cssVars) return skin;
    const accent = (skin.blockColors && skin.blockColors[0]) || '#38bdf8';
    const gridCell = skin.gridCell || '#182030';
    const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(gridCell);
    let uiDark = skin.uiDark;
    if (uiDark == null && rgb) {
      const luma = (parseInt(rgb[1], 16) * 0.2126
        + parseInt(rgb[2], 16) * 0.7152
        + parseInt(rgb[3], 16) * 0.0722) / 255;
      uiDark = luma < 0.78;
    }
    return { ...skin, uiDark: uiDark !== false, cssVars: { '--accent-color': accent } };
  } catch {
    return null;
  }
}

/** renderer / 背景层是否绘制 premium 细节 */
function isSkinPremiumEnabled() {
  return isPremiumRenderEnabled({
    enabled: _enabled,
    qualityMode: _getQualityMode(),
    qualityOff: false,
  });
}

/** 从皮肤推导 premium CSS 变量，返回可拼进 pageStyle 的字符串 */
function applyPremiumSkinVars(skin) {
  if (!skin) return '';
  const vars = computePremiumSkinVars(skin);
  return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
}

function _premiumStyleFragment(enabled) {
  if (!enabled) return '';
  try {
    return applyPremiumSkinVars(_skinForPremium());
  } catch {
    return '';
  }
}

function _syncPageStyle(enabled) {
  if (!_page || typeof _page.setData !== 'function') return;
  const base = _getBasePageStyle() || '';
  const premium = enabled ? _premiumStyleFragment(true) : '';
  const merged = [base, premium].filter(Boolean).join(';');
  _page.setData({
    pageStyle: merged,
    premiumOn: !!enabled,
    premiumClass: enabled ? PREMIUM_ACTIVE_CLASS : '',
  });
}

function _refreshBoard() {
  try {
    _renderer?.setPremiumEnabled?.(isSkinPremiumEnabled());
  } catch { /* ignore */ }
  try {
    if (_page && typeof _page._redraw === 'function') _page._redraw();
  } catch { /* ignore */ }
}

/**
 * 开启 / 关闭精致界面（持久化 + 刷新盘面）。
 * @param {boolean} enabled
 * @param {{ persist?: boolean }} [opts]
 */
function setSkinPremiumEnabled(enabled, { persist = true } = {}) {
  const on = !!enabled;
  _enabled = on;
  _renderer?.setPremiumEnabled?.(isPremiumRenderEnabled({
    enabled: on,
    qualityMode: _getQualityMode(),
    qualityOff: false,
  }));
  if (persist) {
    savePremiumPrefs(storage, { enabled: on });
  }
  _syncPageStyle(on);
  _refreshBoard();
  return on;
}

/**
 * 初始化精致界面。在 game 页 renderer 创建后调用。
 * @param {{
 *   page?: object,
 *   renderer?: object,
 *   getQualityMode?: () => string,
 *   getBasePageStyle?: () => string,
 * }} [opts]
 */
function initSkinPremium({ page, renderer, getQualityMode, getBasePageStyle } = {}) {
  _page = page || null;
  _renderer = renderer || null;
  _getQualityMode = typeof getQualityMode === 'function' ? getQualityMode : () => 'high';
  _getBasePageStyle = typeof getBasePageStyle === 'function' ? getBasePageStyle : () => '';

  const prefs = loadPremiumPrefs(storage);
  setSkinPremiumEnabled(prefs.enabled, { persist: false });
}

/** HUD 开关点击 */
function onToggleSkinPremium({ audio } = {}) {
  const next = !isSkinPremiumEnabled();
  setSkinPremiumEnabled(next);
  try { audio?.play?.('tick', { force: true }); } catch { /* ignore */ }
  return next;
}

/** 画质切换后重算 premium 渲染守卫 */
function syncPremiumAfterQualityChange() {
  _renderer?.setPremiumEnabled?.(isSkinPremiumEnabled());
  _refreshBoard();
}

/** 皮肤切换后刷新 accent 变量 */
function refreshPremiumSkinVars() {
  if (!isSkinPremiumEnabled()) return;
  _syncPageStyle(true);
}

module.exports = {
  SKIN_PREMIUM_STORAGE_KEY,
  PREMIUM_ACTIVE_CLASS,
  PREMIUM_VAR_KEYS,
  isSkinPremiumEnabled,
  setSkinPremiumEnabled,
  initSkinPremium,
  applyPremiumSkinVars,
  onToggleSkinPremium,
  syncPremiumAfterQualityChange,
  refreshPremiumSkinVars,
};
