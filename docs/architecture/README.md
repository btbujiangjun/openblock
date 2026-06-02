# Architecture Docs

系统架构、产品架构、事件总线与生命周期策略架构文档。

## 总——系统全貌

- [系统架构图](./SYSTEM_ARCHITECTURE_DIAGRAMS.md) —— 三视图（业务架构→全栈分层→6张Mermaid子图），覆盖四支柱、容器视图、领域服务、事件总线、双轨（出块/RL）、后端路由持久化、四端同步拓扑
- [架构图生成 Prompt](./ARCHITECTURE_DIAGRAM_PROMPT.md) —— 喂给大模型即可完整重构上述6张Mermaid图的prompt模板（含严格事实包，禁止虚构）

## 分——产品视角

- [产品架构图](./PRODUCT_ARCHITECTURE_DIAGRAMS.md) —— 玩家视角单线：追逐最佳分 → 五层游戏化结构 → 生命周期×成熟度差异化 → 北星指标闭环，含商业边界与数据驱动迭代

## 分——领域策略

- [生命周期/成熟度策略架构](./LIFECYCLE_DATA_STRATEGY_LAYERING.md) —— 三层架构（数据层+编排层+策略层）解决四套独立生命周期信号碎片化问题，含废弃模块移除计划

## 分——事件契约

- [MonetizationBus 事件契约](./MONETIZATION_EVENT_BUS_CONTRACT.md) —— `web/src/monetization/MonetizationBus.js` 的权威事件定义：5个API方法、生命周期/IAP/Offer/广告/分析事件表、设计约束（单向载荷/故障软降/只增不改）

适合全体角色理解系统全貌，架构/后端/商业化角色深入使用。
