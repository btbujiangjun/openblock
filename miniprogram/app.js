/**
 * Open Block 微信小程序 — 应用入口。
 *
 * 全局共享：游戏配置、主题色板、后端 API 地址。
 */
App({
  globalData: {
    apiBaseUrl: '',   // 由 onLaunch 从 env 或 storage 初始化
    strategyId: 'normal',
    skinId: 'classic',
  },

  onLaunch() {
    const env = this.getEnvConfig();
    this.globalData.apiBaseUrl = env.apiBaseUrl || '';

    try {
      const sid = wx.getStorageSync('strategyId');
      if (sid) this.globalData.strategyId = sid;
      const skin = wx.getStorageSync('skinId');
      if (skin) this.globalData.skinId = skin;
    } catch (e) {
      console.warn('读取本地存储失败', e);
    }
  },

  getEnvConfig() {
    // 小程序不支持 import.meta.env，改为从 envConfig.js 或编译时注入
    try {
      return require('./envConfig.js');
    } catch {
      return { apiBaseUrl: '' };
    }
  },
});
