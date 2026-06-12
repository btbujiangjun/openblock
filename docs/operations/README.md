# 运营文档

商业化策略、运营体系、训练面板、合规与部署可观测性文档。

> 本目录按角色分为「商业化与运营」和「运维与部署」两篇。

---

## 一、商业化与运营

### 总——策略框架

- [商业化策略](./MONETIZATION.md) —— **权威入口**：IAA+IAP 混合架构、用户分层（Whale/Dolphin/Minnow）、信号→决策管线、`CommercialModelVector`、后端 API、SQLite Schema、KPI 基线、扩展边界；附录含商业化系统综合报告（模块拓扑、漏斗 KPI、演进方向）
- [商业运营参考分析](./COMMERCIAL_OPERATIONS.md) —— 商业化现状诊断、7项P0–P7改善优先级、集成路径（AdMob/AppLovin/Stripe IAP/Analytics）
- [玩家生命周期与成熟度运营蓝图](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) —— S0–S4 × M0–M4双轴模型、北星指标（D30留存）、5×5决策矩阵、技能/价值评分公式、运营接入点与推荐实验
- [商业化运营指南](../platform/MONETIZATION_GUIDE.md) —— 跨平台PWA/广告/IAP/签到/分享配置（位于 `docs/platform/`）

### 分——配置与面板

- [商业化定制](./MONETIZATION.md#商业化策略定制指南) —— 三级细化：面板调参→`strategyConfig.js`规则修改→`registerStrategyRule()`新增动作类型，含L1–L4层次架构与热重载
- [商业化训练面板](./MONETIZATION_TRAINING_PANEL.md) —— MonPanel的4个Tab（Overview/User Profile/Model Config/Feature Flags）、字段说明、AB测试流程、缓存机制与扩展指南

### 分——留存与数据分析

- [留存信号跨平台分析](./RETENTION_SIGNALS_CROSS_PLATFORM.md) —— iOS×Android 16个行为信号与D7留存的Pearson-r相关矩阵，6项跨平台关键发现、8项P0/P1/P2落地策略
- [留存优化快赢清单](./RETENTION_SIGNALS_CROSS_PLATFORM.md#留存优化快赢清单) —— 上述策略的工程落地方案：精确到文件/函数/行号/改动前后代码的10项优化（总计9人日）
- [运营看板指标审计](./OPS_DASHBOARD_METRICS_AUDIT.md) —— `/ops` 数据库接入确认、指标SQL口径审计（DAU实际为WAU等）、写路径审计
- [能力偏好分析（离线画像工具）](../algorithms/ALGORITHMS_PLAYER_MODEL.md#十九离线聚合画像与偏好分析playeranalytics) —— 跨局复盘画像：能力6维+时序特质+软概率偏好+出块建议；入口首页菜单卡「📈 能力偏好分析」（`/player-analytics.html?autorun=1`），产品/UI语义见 [`PANEL_PARAMETERS.md §A.6`](../player/PANEL_PARAMETERS.md#a6-离线能力偏好分析页playeranalytics)

### 分——架构参考

- [MonetizationBus 事件契约](./MONETIZATION_EVENT_BUS_CONTRACT.md) —— `MonetizationBus.js` 的权威事件定义：5个API方法、事件表、设计约束
- [生命周期/成熟度策略架构](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md#十一生命周期成熟度策略架构数据层编排层策略层) —— 三层架构（数据层+编排层+策略层）解决生命周期信号碎片化问题

### 分——合规

- [部署指南](./DEPLOYMENT.md) §8 —— 合规与运维SOP（隐私同意、数据导出删除、SQLite备份恢复、事故回滚）

### 分——能力对照

- [商业化与企业能力对照表](./COMMERCIAL_OPERATIONS.md#商业化与企业能力对照表) —— 54项能力的实现状态矩阵（仓库内置/部分内置/外部依赖/规划中），含验证路径与代码引用

---

## 二、运维与部署

### 总——部署总览

- [部署指南](./DEPLOYMENT.md) —— Docker Compose + 微服务网格双拓扑，本地/Staging/Production完整Runbook
- [百万DAU架构设计](./SCALE_1M_DAU.md) —— 容量测算（3M日游戏/8-12K峰值写QPS/20-30K峰值读QPS）、目标拓扑（读写分离/Kafka→ClickHouse/HPA）、P0–P2改造项与灰度路线

### 分——运维细则

- [Kubernetes部署](./DEPLOYMENT.md#kubernetes-部署) —— `k8s/base/` manifest + Helm chart骨架，4个Flask Deployment + ClusterIP + Ingress + HPA，secret策略与数据库迁移
- [可观测性](./OBSERVABILITY.md) —— 结构化日志（`common/` helpers）、Prometheus 4金信号（带自动埋点）、OpenTelemetry自动trace（W3C tracecontext传播），多进程gunicorn配置
- [安全加固](./SECURITY_HARDENING.md) —— Argon2id密码哈希、Fernet AES-128-CBC+HMAC、JWT旋转、RateLimit Redis后端、CORS白名单，v1.14迁移Runbook

适合运营、产品、商业化算法、平台工程、SRE 角色使用。
