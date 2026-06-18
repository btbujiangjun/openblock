# OpenBlock Grafana 仪表盘脚手架（v1.71 BB2）

## 目录结构

```
ops/grafana/
├── README.md                                    # 本文件
├── dfs_budget_window.dashboard.json             # X1 DFS budget（5 panel）
├── dfs_budget_window.alerts.yml                 # 告警规则
├── analytics_store_window.dashboard.json        # CC5：Y3 IDB 健康（4 panel）
├── analytics_store_window.alerts.yml            # 告警规则
├── monetization_bus_window.dashboard.json       # CC5：Y4 熔断器（4 panel）
└── monetization_bus_window.alerts.yml           # 告警规则
```

## 接入步骤

### 1. 客户端事件 → 服务端 metric

客户端通过 `analyticsTracker.trackEvent('dfs_budget_window', stats)`（X1）每 60s + pagehide 上报。
服务端聚合管道需把事件转为 Prometheus metric，命名约定：

| 客户端字段 | Prometheus metric | 类型 |
|---|---|---|
| `truncatedRatio` | `openblock_dfs_budget_window_truncated_ratio` | histogram |
| `cappedRatio` | `openblock_dfs_budget_window_capped_ratio` | histogram |
| `totalCalls` | `openblock_dfs_budget_window_total_calls` | counter |
| `budgetUsageHist[0..3]` | `openblock_dfs_budget_window_usage_{lt25,lt50,lt75,lte100}` | counter |
| `leafUsageHist[0..3]` | `openblock_dfs_budget_window_leaf_{lt25,lt50,lt75,lte100}` | counter |
| `rolloutBucket` | metric label `rollout_bucket` (0..99 / -1) | label |
| `rolloutEnabled` | metric label `rollout_enabled` (true/false) | label |
| `rolloutSalt` | metric label `rollout_salt` | label |

> **DD2 灰度对照**：所有 metric 应附加 `rollout_bucket` / `rollout_enabled` 标签，
> 服务端 `sum(...) by (rollout_enabled)` 即得对照组 vs 实验组的 cappedRatio 对比。

所有 metric 必须带标签：`env`（prod/staging/dev）、`region`、`app_version`。

### 2. 导入仪表盘

```bash
# Grafana CLI
grafana-cli admin reset-admin-password admin
curl -X POST -H "Content-Type: application/json" \
  -d @ops/grafana/dfs_budget_window.dashboard.json \
  http://admin:admin@grafana.internal/api/dashboards/db

# 或 UI 导入：Dashboards → Import → Upload JSON
```

导入后变量 `${DS_PROMETHEUS}` 会提示选择数据源（首次导入选已配置的 Prometheus 实例）。

### 3. 加载告警规则

```bash
# Prometheus rule_files 配置：
cp ops/grafana/dfs_budget_window.alerts.yml /etc/prometheus/rules/
# 然后 reload Prometheus
curl -X POST http://prometheus.internal/-/reload
```

### 4. 验证

- 仪表盘所有 panel 出数据（30s 后）
- 触发测试告警：临时把 truncatedRatio 阈值改 0，确认 Alertmanager 收到

## SLO 约定

详见 `docs/engineering/OBSERVABILITY_WINDOW_SCHEMA.md`：

| 指标 | SLO | 告警等级 |
|---|---|---|
| `truncatedRatio` | ≤ 5% | P0 > 15% |
| `cappedRatio` | ≤ 5% | P1 > 10% |
| `totalCalls` 突降 | 不 > 50% | P2 |

## AA5 灰度联动

`annotations.AA5 灰度变更` 在仪表盘上叠加 release event marker，让 owner 一眼对照
"配置变更前后" 的 cappedRatio 曲线，确认 AA5 dynamic leafCap 是否真的让命中率下降。

需要服务端在 AA5 配置变更时主动发 `openblock_release_event{type="ab_change",feature="dynamic_leaf_cap"}`
（Pushgateway / counter += 1 均可）。

## CC5 新增：analytics_store_window 字段映射

| 客户端字段 | Prometheus metric | 类型 |
|---|---|---|
| `idbPutOk` | `openblock_analytics_store_idb_put_ok` | counter |
| `idbPutFail` | `openblock_analytics_store_idb_put_fail` | counter |
| `idbGetOk` | `openblock_analytics_store_idb_get_ok` | counter |
| `idbGetMiss` | `openblock_analytics_store_idb_get_miss` | counter |
| `idbPutLatencyAvg` | `openblock_analytics_store_idb_put_latency_avg` | gauge |
| `idbPutLatencyMax` | `openblock_analytics_store_idb_put_latency_max` | gauge |
| `lsPutFallback` | `openblock_analytics_store_ls_fallback` | counter |
| `lsPutFailCount` | `openblock_analytics_store_ls_fail` | counter |

## CC5 新增：monetization_bus_window 字段映射

| 客户端字段 | Prometheus metric | label | 类型 |
|---|---|---|---|
| `totalEmits` | `openblock_monetization_bus_emits` | env | counter |
| `totalHandlerFails` | `openblock_monetization_bus_handler_fails` | env | counter |
| `totalCircuitTrips` | `openblock_monetization_bus_circuit_trips` | env | counter |
| `eventsFailed[t]` | `openblock_monetization_bus_events_failed` | env, event_type | counter |

## 后续待补

- 业务漏斗联动（session_duration / pb_growth / revive_rate）
- AA5 灰度对照面板（按 bucket label 拆 cappedRatio 对照组 vs 实验组）
