/**
 * 平台能力适配层 — 封装微信小程序特有 API。
 *
 * 包括：振动反馈、屏幕尺寸、分享、系统信息等。
 */

let cachedSystemInfo = null;

function getSystemInfo(options = {}) {
  if (cachedSystemInfo && !options.force) return cachedSystemInfo;
  try {
    cachedSystemInfo = wx.getWindowInfo();
  } catch {
    cachedSystemInfo = { windowWidth: 375, windowHeight: 667, pixelRatio: 2 };
  }
  return cachedSystemInfo;
}

function getScreenSize() {
  const info = getSystemInfo({ force: true });
  return {
    width: info.windowWidth,
    height: info.windowHeight,
    dpr: info.pixelRatio || 2,
  };
}

function vibrateShort() {
  try {
    wx.vibrateShort({ type: 'light' });
  } catch {
    // ignore
  }
}

function vibrateLong() {
  try {
    wx.vibrateLong();
  } catch {
    // ignore
  }
}

function showToast(title, icon = 'none') {
  wx.showToast({ title, icon, duration: 1500 });
}

module.exports = { getSystemInfo, getScreenSize, vibrateShort, vibrateLong, showToast };
