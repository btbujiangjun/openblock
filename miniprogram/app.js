/**
 * Open Block 微信小程序 — 应用入口。
 *
 * 全局共享：游戏配置、主题色板、语言。
 */
const { installLocalStorageShim } = require('./adapters/storageShim');

/* 让从 web/src 同步过来的纯逻辑模块（如 playerProfile.js）能直接使用 localStorage
 * 持久化，避免在每个模块里手写 wx.*StorageSync 适配。 */
installLocalStorageShim();

/* v1.60.45：显式声明平台为微信小程序。
 * 让 core/config/platformProfile.js getPlatform() 优先识别为 'wechat'，
 * 而非 navigator.userAgent 兜底（小程序环境 UA 可能未定义或不可靠）。
 * 留存策略按平台分发（monoFlush 概率 / 复活上限 / multiClearBonus 底值）依赖此识别。 */
try { globalThis.__OPENBLOCK_PLATFORM__ = 'wechat'; } catch { /* ignore */ }

/* v2：出块寻参离线 bundle — 与 Web clientPolicyV2 同源，供 adaptiveSpawn resolveThetaV2 */
try {
  const clientPolicyV2 = require('./core/tuning/v2/clientPolicyV2');
  const bundleData = require('./core/tuning/v2/spawnPoliciesV2');
  globalThis.__openblockClientPolicyV2 = clientPolicyV2;
  clientPolicyV2.initClientPolicyV2({ bundleData, pollMetaUrl: false });
} catch (e) {
  console.warn('[spawn-tuning-v2] init failed (fallback DEFAULT theta)', e);
}

/* 上报发件箱：无网络本地缓存 + 联网批量上报（玩家行为 + 广告按次计费）。
 * API base 默认空（仅本地缓存、不上报，不影响纯本地玩法）；配置后自动启用。 */
const reportingOutbox = require('./utils/reportingOutbox');

App({
  globalData: {
    strategyId: 'normal',
    skinId: 'classic',
    lang: 'zh-CN',
    userId: '',
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

    // 持久化匿名用户 id（行为 / 广告归因用）
    try {
      let uid = wx.getStorageSync('openblock_uid');
      if (!uid) {
        uid = `wx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        wx.setStorageSync('openblock_uid', uid);
      }
      this.globalData.userId = uid;
    } catch { /* ignore */ }

    try {
      reportingOutbox.initReportingOutbox({ platform: 'miniprogram', flushIntervalMs: 15000 });
      reportingOutbox.enqueue('behavior', {
        event_type: 'app_open',
        user_id: this.globalData.userId,
        timestamp: Date.now(),
      });
    } catch { /* ignore */ }
  },
});
