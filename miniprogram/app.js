/**
 * Open Block 微信小程序 — 应用入口。
 *
 * 全局共享：游戏配置、主题色板、语言。
 */
const { installLocalStorageShim } = require('./adapters/storageShim');

/* 让从 web/src 同步过来的纯逻辑模块（如 playerProfile.js）能直接使用 localStorage
 * 持久化，避免在每个模块里手写 wx.*StorageSync 适配。 */
installLocalStorageShim();

App({
  globalData: {
    strategyId: 'normal',
    skinId: 'classic',
    lang: 'zh-CN',
  },

  onLaunch() {
    try {
      const sid = wx.getStorageSync('strategyId');
      if (sid) this.globalData.strategyId = sid;
      const skin = wx.getStorageSync('skinId');
      if (skin) this.globalData.skinId = skin;
      const lang = wx.getStorageSync('openblock_lang');
      if (lang) this.globalData.lang = lang;
    } catch (e) {
      console.warn('读取本地存储失败', e);
    }
  },
});
