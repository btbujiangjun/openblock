# Engineering Docs

工程协作、扩展开发、测试验证、性能优化与 AI 协作约定文档。

## 总——项目概览与上手

- [项目技术总览](./PROJECT.md) —— 前端分层（`web/src`）、PyTorch RL（`rl_pytorch/`）、后端（`server.py`）、商业化子系统、测试拓扑
- [二次开发指南](./DEV_GUIDE.md) —— 环境搭建、项目约定、各模块扩展路径（商业化/RL/玩家画像/小程序适配）
- [策略定制指南](./STRATEGY_GUIDE.md) —— 三层出块引擎全部自定义点：`game_rules.json` 配置 + 插件接口（MonetizationBus），覆盖出块/stress/广告/IAP/RL/玩家成长
- [测试指南](./TESTING.md) —— 测试金字塔、本地验证命令、回归检查清单（玩法/出块/网格/RL稳定性/UI）

## 分——技术参考

- [SQLite数据库模式](./SQLITE_SCHEMA.md) —— 全部表的用途、结构、HTTP入口、业务JSON格式
- [前端性能优化](./PERFORMANCE.md) —— Dirty Rect追踪（`performanceOptimizer.js`）、对象池（`optimizedParticles.js`）、rAF分块、可见性定时器、progress缓存（v10.18）
- [性能基线与回归检测](./PERFORMANCE.md#十三性能基线与回归检测) —— CPU自动（`npm run perf:check`）、GPU手动，性能敏感模块列表
- [工程参考](./REFERENCE.md) —— 黄金事件字典（事件常量、`stressBreakdown`/`spawnGeo`字段）+ Web前端国际化i18n（19语言、API、DOM绑定、新增语言Checklist）

## 分——AI协作

- [AI协作](./AI_COLLAB.md) —— 休闲游戏全栈构建Skill（8原则+10阶段+对照速查）+ Cursor Skills索引 + Canvas转换文档索引

## 分——跨端适配（参见 `docs/platform/`）

- [四端同步契约](../platform/SYNC_CONTRACT.md) —— Web/微信小程序/Android/iOS同步规则
- [Android/iOS客户端外壳](../platform/MOBILE_CLIENTS.md) —— Capacitor包装方案
- [微信小程序适配](../platform/WECHAT_MINIPROGRAM.md) —— 结构/功能边界/本地开发
- [微信小程序发布流程](../platform/WECHAT_MINIPROGRAM.md#七微信小程序发布流程) —— 发布Runbook

适合架构、前端、后端、小程序适配、AI协作和开源贡献者首读。
