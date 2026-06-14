/**
 * adSim.js — 小程序广告模拟（展示 + 按次计费回流）
 *
 * 计费口径与 web/src/monetization/providerConfig.js 对齐：
 *   - 激励视频 rewarded：¥0.05 / 次（5 分）
 *   - 插屏 interstitial：¥0.02 / 次（2 分）
 *   - 填充率 fillRate：0.92（未填充→无收益）
 *
 * 真实接入：把 _show* 换成 wx.createRewardedVideoAd / wx.createInterstitialAd，
 * 并在 onClose(res.isEnded) / onLoad 回调里调用 _report。收益回流统一经 reportingOutbox。
 */
const outbox = require('./reportingOutbox');

const AD_CFG = {
  fillRate: 0.92,
  revenueMinorPerShow: { rewarded: 5, interstitial: 2 }, // ¥0.05 / ¥0.02
};

function _uid() {
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.userId) return app.globalData.userId;
  } catch { /* ignore */ }
  try { return wx.getStorageSync('openblock_uid') || ''; } catch { return ''; }
}

function _report(kind, filled, completed) {
  const revenueMinor = filled ? (AD_CFG.revenueMinorPerShow[kind] || 0) : 0;
  outbox.enqueue('ad', {
    user_id: _uid(),
    kind,
    filled: Boolean(filled),
    completed: Boolean(completed),
    revenue_minor: revenueMinor,
    platform: 'wechat',
    ts: Date.now(),
  });
  return revenueMinor;
}

function _modal(title, content) {
  return new Promise((resolve) => {
    try {
      wx.showModal({
        title,
        content,
        showCancel: false,
        confirmText: '关闭',
        success: () => resolve(true),
        fail: () => resolve(true),
      });
    } catch { resolve(true); }
  });
}

/** 激励视频：resolve(true) 表示完整观看可发奖。 */
async function showRewarded(placement) {
  const filled = Math.random() < AD_CFG.fillRate;
  if (!filled) { _report('rewarded', false, false); return { completed: false }; }
  await _modal('激励广告', `观看完成可获得奖励（${placement || 'reward'}）`);
  _report('rewarded', true, true);
  return { completed: true };
}

/** 插屏广告：展示即计费。 */
async function showInterstitial(placement) {
  const filled = Math.random() < AD_CFG.fillRate;
  if (!filled) { _report('interstitial', false, true); return; }
  await _modal('插屏广告', `精彩内容推荐（${placement || 'interstitial'}）`);
  _report('interstitial', true, true);
}

module.exports = { showRewarded, showInterstitial, AD_CFG };
