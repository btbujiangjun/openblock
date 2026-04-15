/**
 * 环境配置 — 替代 Vite 的 import.meta.env。
 * 与网页端一致：仓库根 `.env` 里 `OPENBLOCK_API_ORIGIN` 为统一后端根 URL；此处需手动填成同一地址。
 */
module.exports = {
  apiBaseUrl: '',       // 留空 = 不连后端；与 OPENBLOCK_API_ORIGIN 对齐，如 'http://192.168.1.5:5000'
  syncBackend: false,   // 是否向后端同步会话
  usePytorchRl: false,  // 是否使用 PyTorch RL 后端
};
