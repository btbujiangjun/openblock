/**
 * 小程序 localStorage 垫片：把 wx.*StorageSync 暴露成 web 一致的 `globalThis.localStorage`。
 *
 * 用途：让从 web/src 同步过来的纯逻辑模块（如 playerProfile.js）不修改源码即可在
 * 小程序运行时持久化状态；同步脚本无需为每个模块特化。
 *
 * 在 app.js 的 onLaunch 阶段调用一次 installLocalStorageShim() 即可。
 */
const storage = require('./storage');

let _installed = false;

function installLocalStorageShim(globalObj = (typeof globalThis !== 'undefined' ? globalThis : null)) {
  if (_installed || !globalObj) return;
  if (globalObj.localStorage && typeof globalObj.localStorage.getItem === 'function') {
    _installed = true;
    return;
  }
  const proxy = {
    getItem(key) {
      const v = storage.getItem(key);
      if (v === null || v === undefined) return null;
      return typeof v === 'string' ? v : JSON.stringify(v);
    },
    setItem(key, value) {
      storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    removeItem(key) { storage.removeItem(key); },
    clear() { storage.clear(); },
    key() { return null },
    get length() { return 0; },
  };
  try {
    Object.defineProperty(globalObj, 'localStorage', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: proxy,
    });
  } catch {
    globalObj.localStorage = proxy;
  }
  _installed = true;
}

module.exports = { installLocalStorageShim };
