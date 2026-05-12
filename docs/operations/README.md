# Operations Docs

商业化、运营策略、训练面板、合规、部署与可观测性文档。

> **本目录在文档中心拆为两个左侧分类**：「商业化与运营」（含 `MONETIZATION*`、`COMMERCIAL_*`、`COMPLIANCE_AND_SOPS`、`platform/MONETIZATION_GUIDE`）+「运维与部署」（含 `DEPLOYMENT`、`K8S_DEPLOYMENT`、`OBSERVABILITY`、`SECURITY_HARDENING`）。

## 商业化与运营

### 当前事实入口

- [商业化策略](./MONETIZATION.md)：商业化架构、数据流、策略配置、CommercialModelVector、API 与运维边界的权威入口。
- [玩家生命周期与成熟度运营蓝图](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)：双轴模型（S0–S4 生命周期 × M0–M4 成熟度）、KPI 字典、双分制成熟度（SkillScore / ValueScore）、90 天可落地任务清单与 8 个实验。
- [运营看板指标审计](./OPS_DASHBOARD_METRICS_AUDIT.md)：`/ops` 是否接数据库、指标 SQL 口径、截图数值复核、风险和修正建议。

### 专题补充

- [商业化定制](./MONETIZATION_CUSTOMIZATION.md)：只说明运营如何改配置、规则和动作类型。
- [商业化训练面板](./MONETIZATION_TRAINING_PANEL.md)：只说明 MonPanel 的 Tab、字段和调试方式。
- [Block Blast 商业化运营指南](../platform/MONETIZATION_GUIDE.md)：跨平台 PWA / 广告 / IAP / 签到 / 分享配置（在 `docs/platform/` 下，但内容是商业化）。
- [合规与 SOP](./COMPLIANCE_AND_SOPS.md)：隐私、数据导出删除、合规手册。

### 参考清单

- [商业运营参考分析](./COMMERCIAL_OPERATIONS.md)：运营机会池与策略参考，不作为当前实现事实来源。
- [商业化改进清单](./COMMERCIAL_IMPROVEMENTS_CHECKLIST.md)：运营机会池，不作为当前实现事实来源。

## 运维与部署

- [Deployment Guide](./DEPLOYMENT.md)（v1.14）：Docker Compose、env 凭据、健康检查、备份恢复 Runbook。
- [Kubernetes Deployment](./K8S_DEPLOYMENT.md)（v1.15）：`k8s/base/` 8 个 manifest、Helm chart 骨架、HPA。
- [Observability](./OBSERVABILITY.md)（v1.15）：Prometheus `/metrics` + OpenTelemetry 自动埋点接入。
- [Security Hardening](./SECURITY_HARDENING.md)（v1.14）：Argon2id、Fernet、JWT 旋转、RateLimit Redis 后端。

适合运营、产品、商业化算法、平台工程、SRE 角色使用。
