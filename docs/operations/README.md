# 运营文档

商业化、运营策略、训练面板、合规、部署与可观测性文档。

> 本目录在文档中心拆为两个分类：「商业化与运营」和「运维与部署」。

## 商业化与运营

### 权威入口

- [商业化策略](./MONETIZATION.md) —— 架构、数据流、策略配置、`CommercialModelVector`、API 与运维边界
- [商业化系统综合报告](./COMMERCIAL_STRATEGY_REVIEW.md) —— 模块拓扑、关键能力、KPI、演进方向
- [玩家生命周期与成熟度运营蓝图](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) —— S0–S4 × M0–M4 双轴模型、KPI 字典、能力与运营接入点、推荐实验
- [运营看板指标审计](./OPS_DASHBOARD_METRICS_AUDIT.md) —— `/ops` 是否接数据库、指标 SQL 口径、复核与建议

### 配置与面板

- [商业化定制](./MONETIZATION_CUSTOMIZATION.md) —— 运营如何改配置、规则、动作类型
- [商业化训练面板](./MONETIZATION_TRAINING_PANEL.md) —— MonPanel 的 Tab、字段与调试方式
- [Block Blast 商业化运营指南](../platform/MONETIZATION_GUIDE.md) —— 跨平台 PWA / 广告 / IAP / 签到 / 分享配置（位于 `docs/platform/`）
- [合规与 SOP](./COMPLIANCE_AND_SOPS.md) —— 隐私、数据导出删除、合规手册

### 能力对照

- [商业运营参考分析](./COMMERCIAL_OPERATIONS.md) —— 运营机会池与策略参考
- [商业化与企业能力对照表](./COMMERCIAL_IMPROVEMENTS_CHECKLIST.md) —— 仓库内置 / 部分内置 / 外部依赖 / 规划中

## 运维与部署

- [部署指南](./DEPLOYMENT.md) —— Docker Compose、env 凭据、健康检查、备份恢复 Runbook
- [Kubernetes 部署](./K8S_DEPLOYMENT.md) —— `k8s/base/` manifest、Helm chart 骨架、HPA
- [可观测性](./OBSERVABILITY.md) —— Prometheus `/metrics` + OpenTelemetry 自动埋点接入
- [安全加固](./SECURITY_HARDENING.md) —— Argon2id、Fernet、JWT 旋转、RateLimit Redis 后端

适合运营、产品、商业化算法、平台工程、SRE 角色使用。
