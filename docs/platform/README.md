# Platform Docs

平台适配与发布流程文档。

## 总——跨端架构与商业运营

- [四端同步契约](./SYNC_CONTRACT.md) —— Web/微信小程序/Android/iOS的单一事实来源规则：共享内容（核心玩法/出块/皮肤/i18n/分析字段）与各自独有内容（RL排除小程序等）
- [Android/iOS 客户端外壳](./MOBILE_CLIENTS.md) —— Capacitor包装架构、`npm run mobile:build`、API配置边界
- [Block Blast 商业化运营指南](./MONETIZATION_GUIDE.md) —— PWA离线策略、广告决策引擎、IAP验证、签到、分享配置，跨平台商业化运营权威指南

## 分——微信小程序

- [微信小程序适配](./WECHAT_MINIPROGRAM.md) —— 结构（`miniprogram/`）、功能边界（排除RL/监控/运营看板）、本地开发与调试
- [微信小程序发布流程](./WECHAT_MINIPROGRAM.md#微信小程序发布流程) —— 完整Runbook：账号注册 → AppID配置 → 隐私声明 → `scripts/sync-core.sh` → 开发者工具自检 → 上传审核 → 版本回退

适合跨端工程、发布运营和 QA 使用。
