# Platform Docs

平台适配与发布流程说明。

## 总——跨端架构与商业运营

- [四端同步契约](./SYNC_CONTRACT.md) —— Web/微信小程序/Android/iOS 单一事实来源：共享内容（核心玩法/出块/皮肤/i18n/分析字段）与各自独有内容（RL 排除小程序等）
- [Android/iOS 客户端外壳](./MOBILE_CLIENTS.md) —— Capacitor 外壳架构、`npm run mobile:build` 与 API 配置边界
- [商业化运营指南](./MONETIZATION_GUIDE.md) —— PWA 离线策略、广告决策引擎、IAP 验证、签到与分享配置

## 分——微信小程序

- [微信小程序适配](./WECHAT_MINIPROGRAM.md) —— 目录结构、功能边界（排除 RL/监控/运营看板）、本地开发与调试
- [微信小程序发布流程](./WECHAT_MINIPROGRAM.md#七微信小程序发布流程) —— 完整 Runbook：账号注册 → AppID 配置 → 隐私声明 → `scripts/sync-core.sh` → 开发者工具自检 → 上传审核 → 版本回退

面向跨端工程、发布运营与 QA 团队。
