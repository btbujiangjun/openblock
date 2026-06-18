# OpenBlock Grafana 仪表盘脚手架（v1.71 BB2）

## 目录结构

```
ops/grafana/
├── README.md                              # 本文件
├── dfs_budget_window.dashboard.json       # X1 dfs_budget_window 仪表盘（5 panel）
├── dfs_budget_window.alerts.yml           # 告警规则（P0/P1/P2）
└── (后续) analytics_store_window.*.json   # Y3 待补
└── (后续) monetization_bus_window.*.json  # Y4 待补
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

## 后续 dashboard 待补

- `analytics_store_window`（Y3）：IDB 健康（idbPutFail / lsPutFallback / 延迟）
- `monetization_bus_window`（Y4）：handlerFails / circuitTrips 时序
- 业务漏斗联动（session_duration / pb_growth）
