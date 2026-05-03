# 企业扩展 API（`enterprise_extensions.py`）

> 与 Flask `server.py` 一并加载；数据库迁移在 `init_db()` 中执行。  
> 环境变量：`OPENBLOCK_OPS_TOKEN`（敏感接口鉴权）、`OPENBLOCK_RATE_LIMIT_PER_MIN`（每分钟每 IP 上限，0=关闭）、`OPENBLOCK_REMOTE_CONFIG_JSON`（远程配置 JSON 合并）、`OPENBLOCK_ACTIVE_STRATEGY_VERSION`（策略版本标注）。

## 远程配置与策略

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/enterprise/remote-config` | 合并 `shared/remote_config.default.json` 与环境变量 |
| GET | `/api/enterprise/strategy-registry` | `shared/strategy_registry.json` + 当前 active |

## 支付与广告占位

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/payment/verify` | IAP 收据占位入库，`idempotency_key` 幂等 |
| POST | `/api/enterprise/ad-impression` | 广告展示/收益占位（前端 `adAdapter` 已上报） |

## 实验与 Live Ops

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/enterprise/experiments` | 读取 `experiment_configs` 表 |
| POST | `/api/enterprise/experiments` | 需 `X-Ops-Token`：写入实验配置 |
| GET | `/api/enterprise/live-ops` | 当前时间在窗内的活动条目 |
| POST | `/api/enterprise/live-ops` | 需 Ops Token：upsert `live_ops_entries` |

## 分析与合规

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/enterprise/funnel` | Ops Token：behaviors 事件计数 |
| GET | `/api/enterprise/analytics-export.ndjson` | Ops Token：NDJSON 导出 |
| POST | `/api/enterprise/analytics-mirror` | 第三方分析失败时的 DLQ |
| POST | `/api/compliance/consent` | 用户同意记录 `user_consents` |
| GET | `/api/compliance/export-user` | Ops Token：导出单用户相关行 |
| POST | `/api/compliance/delete-user` | Ops Token：删除单用户核心行 |

## 新增 SQLite 表（摘要）

- `iap_orders` — 订单与幂等键  
- `experiment_configs` — 服务端实验定义  
- `user_consents` — 合规同意快照  
- `live_ops_entries` — Live Ops 时间窗  
- `ad_impressions` — 广告曝光占位  
- `analytics_mirror_dlq` — 分析镜像死信  

`sessions.attribution` — JSON，会话级归因（UTM / gclid / fbclid）。

详见 `docs/engineering/SQLITE_SCHEMA.md`（若尚未同步段落，以 `enterprise_extensions.migrate_enterprise_schema` 为准）。
