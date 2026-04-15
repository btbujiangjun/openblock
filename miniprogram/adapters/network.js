/**
 * 网络适配层 — 将 web 端 fetch() 映射到 wx.request()。
 *
 * 提供 Promise 接口，与 web 端 pytorchBackend.js 风格一致。
 */

function getBaseUrl() {
  const app = getApp();
  return (app && app.globalData.apiBaseUrl) || '';
}

/**
 * @param {string} path   API 路径，如 '/api/rl/status'
 * @param {object} [opts]
 * @param {string} [opts.method]  'GET' | 'POST'
 * @param {object} [opts.body]    POST 请求体（自动 JSON 序列化）
 * @param {number} [opts.timeout] 超时毫秒，默认 10000
 * @returns {Promise<object>} 解析后的 JSON 响应
 */
function request(path, opts = {}) {
  const base = getBaseUrl();
  if (!base) {
    return Promise.reject(new Error('apiBaseUrl 未配置'));
  }

  const url = base.replace(/\/+$/, '') + path;
  const method = (opts.method || 'GET').toUpperCase();
  const timeout = opts.timeout || 10000;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data: opts.body || {},
      header: { 'content-type': 'application/json' },
      timeout,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || 'wx.request failed'));
      },
    });
  });
}

function postJson(path, body) {
  return request(path, { method: 'POST', body });
}

module.exports = { request, postJson, getBaseUrl };
