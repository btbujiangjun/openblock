/**
 * 存储适配层 — 将 web 端 localStorage API 映射到 wx.setStorageSync / getStorageSync。
 *
 * 用法：在 core/ 模块中 `const storage = require('../adapters/storage')`
 * 替代直接调用 localStorage。
 */

const storage = {
  getItem(key) {
    try {
      return wx.getStorageSync(key) ?? null;
    } catch {
      return null;
    }
  },

  setItem(key, value) {
    try {
      wx.setStorageSync(key, value);
    } catch (e) {
      console.warn('[storage] setItem failed:', key, e);
    }
  },

  removeItem(key) {
    try {
      wx.removeStorageSync(key);
    } catch {
      // ignore
    }
  },

  clear() {
    try {
      wx.clearStorageSync();
    } catch {
      // ignore
    }
  },
};

module.exports = storage;
