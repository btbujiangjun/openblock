# 百万 DAU 架构设计

本文给出把 OpenBlock 从「单机 Flask + SQLite」演进到**承载 100 万 DAU**的落地路径。
所有改造项都基于仓库**已有**资产（`services/` 微服务、`k8s/`、`k8s/helm/`、`services/nginx.conf`、
Postgres/Redis 开关、Prometheus/OTel），不是推倒重来。

> 配套阅读：[部署指南](./DEPLOYMENT.md)、[K8s 部署](./DEPLOYMENT.md#kubernetes-部署)、
> [可观测性](./OBSERVABILITY.md)、[安全加固](./SECURITY_HARDENING.md)。

---

## 0. 先记住一个前提：游戏算力在客户端

OpenBlock 的对局逻辑（棋盘、出块、消行、计分、自适应难度）全部在浏览器/小程序/原生壳里本地执行，
**服务端不参与实时对局**。因此「100 万 DAU」对后端的压力不是「100 万个实时游戏循环」，而是：

- 写入：会话生命周期、行为埋点、局末统计、钱包/签到/进度同步
- 读取：身份解析、配置下发、排行榜、回放列表、画像聚合
- 静态分发：Web bundle / 资源（走 CDN，几乎零后端成本）

这决定了架构重心是**「高并发小写入 + 缓存读 + 异步分析」**，而不是有状态长连接。

---

## 1. 容量测算（自顶向下）

以 100 万 DAU、人均 3 局/天、人均在线 12 分钟估算。

| 指标 | 估算 | 说明 |
|---|---|---|
| DAU | 1,000,000 | |
| 日总对局 | ~3,000,000 | 3 局/人 |
| 峰值并发在线 | ~80,000–120,000 | 按 DAU×(在线分钟/1440)×峰谷比(8~10) |
| 写 QPS（均值） | ~1,500–2,500 | 会话+行为+统计+同步 |
| 写 QPS（峰值） | ~8,000–12,000 | 晚高峰 + 行为批量 flush |
| 读 QPS（峰值） | ~20,000–30,000 | 身份/配置/排行榜（高缓存命中） |
| 行为事件/天 | ~3 亿 | 人均 ~100 事件，**必须批量 + 异步落仓** |

**关键结论**

1. **SQLite 出局**：单写者模型扛不住 ~1 万写 QPS，必须迁 **PostgreSQL**（仓库已支持 `USE_POSTGRES=true`）。
2. **行为流必须异步**：3 亿/天事件不能同步写主库，要走**消息队列 → 批量入 OLAP**。
3. **读路径必须缓存**：身份/配置/排行榜用 **Redis** 挡住 90%+ 读，主库只兜底。
4. **无状态服务 + HPA**：每个微服务可水平扩，靠 K8s HPA 自动伸缩。

---

## 2. 目标拓扑

```
                      ┌─────────────────────────────────────┐
   客户端(Web/小程序/原生) │  静态资源: Vite build → 对象存储 + CDN │
                      └──────────────────┬──────────────────┘
                                         │ HTTPS (API only)
                              ┌──────────▼───────────┐
                              │  边缘: CDN + WAF +     │  TLS 终止 / 边缘限流 / 防刷
                              │  GeoDNS / Anycast      │
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼───────────┐
                              │  API 网关 (nginx-ingress) │ limit_req / 安全头 / 路由
                              └──┬─────────┬─────────┬──┘
                ┌────────────────┘         │         └───────────────┐
        ┌───────▼────────┐      ┌──────────▼─────────┐      ┌─────────▼─────────┐
        │ user-service   │      │  game-service       │      │ analytics-service │
        │ (身份/鉴权)    │      │ (会话/分数/排行)    │      │ (行为聚合/画像)   │
        │  HPA 2→N       │      │  HPA 2→N            │      │  消费者 HPA       │
        └──┬──────────┬──┘      └──────┬───────┬──────┘      └─────────┬─────────┘
           │          │                 │       │                       │
     ┌─────▼───┐  ┌───▼────┐      ┌─────▼──┐ ┌──▼─────┐          ┌──────▼───────┐
     │ Redis    │  │Postgres │      │ Redis  │ │Postgres│          │  消息队列     │
     │(缓存/会话)│  │(主, 读写 │      │(排行/  │ │(分片/  │          │ Kafka/Pulsar  │
     └─────────┘  │ 分离副本)│      │ 计数)  │ │ 只读副本)│         │  → ClickHouse │
                  └─────────┘      └────────┘ └────────┘          │   (OLAP 数仓) │
                                                                   └──────────────┘
```

要点：

- **读写分离**：主库写，多个只读副本扛读；应用层按操作路由。
- **行为埋点**经网关 → 轻量 ingest → **消息队列** → 批消费 → **ClickHouse**（分析与画像）。
  主交易库（Postgres）不承载海量行为明细。
- **Redis** 同时做：热点读缓存、排行榜（ZSET）、限流、分布式计数、身份指纹映射缓存。

---

## 3. 落地改造项（按优先级）

### P0 — 不做就撑不住

| # | 改造 | 现状 / 抓手 | 目标 |
|---|---|---|---|
| 1 | **SQLite → PostgreSQL** | `services/common/orm.py`、`SqlUserRepository`、`USE_POSTGRES=true`、`services/migrations/`(Alembic) | 主交易库迁 PG，开启连接池(PgBouncer) |
| 2 | **单体 `server.py` 退居 dev/小流量** | `create_app()` 已是 WSGI 工厂 | 生产走 `services/` 微服务；单体仅本地/灰度 |
| 3 | **行为流异步化** | `POST /api/behavior/batch` 已是批量 | ingest 只写队列，消费者批量入 ClickHouse |
| 4 | **Redis 缓存 + 限流** | `rateLimitBackend: redis`(helm)、`RedisBackend` | 身份/配置/排行榜走 Redis；限流走 Redis |
| 5 | **静态资源上 CDN** | `vite build → dist/`，已 code-split | dist 传对象存储 + CDN，API 与静态彻底分离 |
| 6 | **HPA + 资源配额** | `values.yaml` 已配 HPA(user 2→10, game 2→20) | 按压测调 min/max、目标 CPU、配 PDB |

### P1 — 稳定性与正确性

| # | 改造 | 抓手 |
|---|---|---|
| 7 | **读写分离 + 只读副本** | 应用层 DB router；读副本扩 2~4 个 |
| 8 | **gunicorn 多 worker + 超时** | `Dockerfile.*` 已用 gunicorn；按核数调 `--workers`(2×CPU+1)、`--threads`、`--timeout` |
| 9 | **PgBouncer 连接池** | 限制每实例连接，避免 PG 连接风暴 |
| 10 | **幂等写**（会话/支付/钱包） | 客户端幂等键 + 服务端 `ON CONFLICT`（`identity_map`/`payments` 已用） |
| 11 | **PDB / NetworkPolicy / ServiceMonitor** | DEPLOYMENT.md「Pending(v1.16+)」已列 |
| 12 | **数据分区/归档** | `sessions`/`behaviors` 按时间分区；冷数据归档对象存储 |

### P2 — 成本与体验优化

| # | 改造 | 抓手 |
|---|---|---|
| 13 | **多区域 / 就近接入** | GeoDNS + 区域集群；JWT 用 RS256 多区分发(已在 roadmap) |
| 14 | **排行榜 Redis ZSET** | 实时榜走 Redis，定期落库 |
| 15 | **OLAP 数仓管线** | ClickHouse + 物化视图，替代在线库聚合(`/api/analytics/*`) |
| 16 | **Grafana 告警面板** | Prometheus 已接入；补 rules + dashboard |

---

## 4. 数据层设计

### 4.1 分库（按访问模式拆）

| 库 | 内容 | 引擎 | 扩展方式 |
|---|---|---|---|
| **交易库** | users / sessions / user_stats / payments / wallet / checkin | PostgreSQL | 主写 + 只读副本；超大表按 `user_id` hash 分片 |
| **缓存层** | 身份解析、远程配置、排行榜、限流、会话票据 | Redis(Cluster) | 分片 + 副本 |
| **分析库** | behaviors 明细、move_sequences、画像聚合 | ClickHouse | 天然列存，水平扩 |
| **对象存储** | Web 静态、回放大对象、冷归档 | S3/OSS | 无限扩 + CDN |

### 4.2 身份解析的扩展（与本次客户端改造对齐）

本次新增的 `/api/identity/resolve`（`server.py`）在百万级要这样扩：

- `identity_map(fingerprint → user_id)` 迁 PG，`fingerprint` 建索引；**热点查缓存进 Redis**（指纹→id，TTL 数小时）。
- 解析是**读多写少**：命中缓存直接返回，未命中查 PG 副本，新登记才写主库。
- 指纹是**软恢复**信号（熵有限、可能合并同机多真人）；强隔离需上账号体系（user-service 已有 JWT/Argon2id）。

### 4.3 分片键

统一用 `user_id` 作分片/路由键：同一玩家的会话、统计、钱包落同一分片，避免跨分片事务。

---

## 5. 与现有仓库的对接清单

| 能力 | 已有 | 需要做 |
|---|---|---|
| 微服务骨架 | `services/{user,game,analytics,monitoring}` | 把核心 `server.py` 路由逐步迁入对应服务 |
| ORM / 迁移 | `services/common/orm.py` + Alembic baseline | 补 sessions/behaviors/identity 迁移脚本 |
| 容器 | `services/Dockerfile.*`(gunicorn) | 按压测调 worker/threads/timeout |
| 编排 | `k8s/base/*`、`k8s/helm/openblock` | 加 PG/Redis/Kafka/ClickHouse(StatefulSet 或托管)、PDB、ServiceMonitor |
| 网关 | `services/nginx.conf`(limit_req/安全头/upstream) | 接 nginx-ingress + 边缘 WAF/CDN |
| 限流 | `services/security/rate_limit.py`(RedisBackend) | 全量切 Redis 后端 |
| 可观测 | Prometheus 自动埋点 + OTel | 补 Grafana 面板 + 告警规则 |
| 鉴权 | JWT(HS256) | 多区域上 RS256(roadmap) |

---

## 6. 灰度演进路线（避免一步到位风险）

1. **阶段一（~5 万 DAU）**：单体 `server.py` + gunicorn 多 worker + SQLite→PG + Redis 缓存 + CDN。最小改动即可顶住。
2. **阶段二（~20 万 DAU）**：核心读写迁入 `services/` 微服务，读写分离，限流全量切 Redis，HPA 调优。
3. **阶段三（~100 万 DAU）**：行为流 Kafka→ClickHouse，交易库分片 + PgBouncer，多只读副本，PDB/NetworkPolicy 齐备。
4. **阶段四（>100 万 / 多区域）**：GeoDNS 就近接入，RS256 多区密钥，OLAP 数仓 + 物化视图，全链路 SLO 告警。

---

## 7. 压测与验收门槛

上线前必须用 k6 / Locust 压出以下门槛（在目标副本数下）：

- 写路径 p99 < 100ms @ 峰值写 QPS；错误率 < 0.1%
- 读路径（缓存命中）p99 < 30ms；Redis 命中率 > 90%
- 行为 ingest 在队列积压下不丢、不阻塞主交易
- 单 Pod OOM/重启不影响整体（PDB + 多副本）
- 主库故障切换（副本提升）RTO < 1min，数据 RPO ≈ 0（同步复制关键表）

---

## 8. 一句话总结

OpenBlock 已具备走向百万 DAU 的**骨架**（无状态微服务 + PG/Redis 开关 + k8s/helm + HPA + 可观测）。
到 100 万 DAU 的核心动作是四件事：**主库换 Postgres 并读写分离、行为流异步进 OLAP、读路径全面 Redis 化、静态走 CDN + 服务无状态弹性伸缩**。
按第 6 节分阶段灰度，每阶段用第 7 节门槛验收即可平滑扩容。
