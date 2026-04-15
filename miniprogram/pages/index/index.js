/**
 * Open Block 微信小程序 — 主菜单页面
 */
Page({
  onStartNormal() {
    wx.navigateTo({ url: '/pages/game/game?strategy=normal' });
  },
  onStartEasy() {
    wx.navigateTo({ url: '/pages/game/game?strategy=easy' });
  },
  onStartHard() {
    wx.navigateTo({ url: '/pages/game/game?strategy=hard' });
  },
});
