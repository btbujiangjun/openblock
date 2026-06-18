# Observability `*_window` 事件 Schema

> X1 / Y3 / Y4 统一观测埋点格式与服务端 dashboard 契约。

## 设计约定

三个观测窗口事件共享相同的 **shape pattern**：

```jsonc
{
  "category": "performance",
  "name":     "<DOMAIN>_window",
  "data": {
    /* 业务指标字段 */
    ...
    /* 共享尾部字段（所有 *_window 事件都有） */
    "windowMs": 60000
  }
}
```

- **触发节奏**：`setInterval(60_000ms)` + `pagehide` 强 flush
- **上报后行为**：调用方 `resetXxxStats()` 清零窗口累计
- **空窗口**：当窗口内零活动时**跳过上报**（不发空事件）
- **失败处理**：任何上报异常被吞，不阻塞主流程（埋点 SLA 优先）

## 三个事件 schema 详表

### `dfs_budget_window` (X1)

源：`web/src/bot/blockSpawn.js`. `getBlockSpawnDfsStats()` 快照。

| 字段 | 类型 | 含义 | dashboard 用途 |
|---|---|---|---|
| `totalCalls` | int | DFS 总入栈次数（含 evalTripletSolutions + tripletSequentiallySolvable） | 总量基线 |
| `truncatedCount` | int | 因 budget 用尽截断的调用数 | 分子 |
| `truncatedRatio` | float [0,1] | truncatedCount / totalCalls | **P0 指标**；按 W3 决策表分级 |
| `budgetUsageHist` | int[4] | [<25%, <50%, <75%, ≤100%] 桶分布 | 直方图判断是否过剩 |
| `cappedCount` | int | solutionCount ≥ cap 的 triplet 数（leafCap 触顶） | X4 加 |
| `cappedRatio` | float [0,1] | cappedCount / evalTripletCalls | leafCap 决策 |
| `leafUsageHist` | int[4] | solutionCount/cap 桶分布 | 双峰发现 |
| `evalTripletCalls` | int | evaluateTripletSolutions 调用数 | leafCap 分母 |
| `windowMs` | int | 60000（窗口长度） | 归一化 rate |

**P0 告警**：`truncatedRatio > 0.30` 持续 ≥ 3 窗口 → 预算不足。
**P1 告警**：`cappedRatio > 0.30` 持续 → leafCap 过小。

### `analytics_store_window` (Y3)

源：`web/src/lib/analyticsStore.js`. `getAnalyticsStoreStats()` 快照。

| 字段 | 类型 | 含义 | dashboard 用途 |
|---|---|---|---|
| `idbPutOk` | int | IDB 写成功次数 | 分母 |
| `idbPutFail` | int | IDB 写失败次数 | 分子 |
| `idbWriteSuccessRate` | float [0,1] | idbPutOk / (idbPutOk + idbPutFail) | **P0**；< 0.95 报警 |
| `idbGetOk` / `idbGetMiss` | int | 读命中 / miss | 启动期数据完整性 |
| `idbAvgLatencyMs` | float | idbPutLatencyMs / idbPutOk | **P1**；> 50ms 浏览器降速 |
| `idbMaxLatencyMs` | float | 单次写延时峰值 | 长尾 P99 监控 |
| `lsPutFallback` | int | IDB 失败但 LS 兜底成功 | 数据未丢 |
| `lsPutFailCount` | int | LS 也失败次数（quota） | **P0**；> 0 立即告警 |
| `windowMs` | int | 60000 | – |

**P0 告警**：`idbWriteSuccessRate < 0.95` 或 `lsPutFailCount > 0`。

### `monetization_bus_window` (Y4)

源：`web/src/monetization/MonetizationBus.js`. `getStats()` 快照。

| 字段 | 类型 | 含义 | dashboard 用途 |
|---|---|---|---|
| `totalEmits` | int | 所有事件 emit 累计 | 分母 |
| `totalHandlerFails` | int | handler 抛错累计 | 分子 |
| `handlerFailRate` | float [0,1] | fails / emits | **P1**；> 0.01 排查 |
| `totalCircuitTrips` | int | 累计熔断触发次数 | **P0**；> 0 告警 |
| `circuitOpenCount` | int | 当前正熔断 handler 数（live） | 健康度 |
| `eventsFailed` | object | eventType → 失败次数 | 定位坏模块 |
| `eventTypes` | int | 当前订阅事件类型数 | 拓扑健康 |
| `totalHandlers` | int | 当前订阅 handler 总数 | 拓扑健康 |
| `windowMs` | int | 60000 | – |

**P0 告警**：`totalCircuitTrips > 0` —— 商业化模块挂了。

## 服务端聚合建议

### 全局 P50/P95/P99

对所有 *_window 事件按 user_id × hour 聚合，计算关键 ratio 的分位数：

```sql
SELECT
  date_trunc('hour', ts) AS hour,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY truncatedRatio) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY truncatedRatio) AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY truncatedRatio) AS p99
FROM events WHERE name = 'dfs_budget_window'
GROUP BY 1;
```

### 直方图重建

`budgetUsageHist` / `leafUsageHist` / `eventsFailed` 在服务端按 sum 聚合
后做 stacked bar 图，方便看分布漂移。

### Anomaly Detection

`totalCircuitTrips` / `lsPutFailCount` 是计数器，**任何非零都触发告警**。
其他 ratio 字段建议用滑动窗口 baseline（过去 7 天 P95 ± 2σ）。

## 版本演进

| 版本 | 变更 | 影响 |
|---|---|---|
| v1 (X1) | dfs_budget_window 首发 | – |
| v2 (X4) | dfs_budget_window 加 cappedCount / leafUsageHist 等字段 | 向后兼容 |
| v3 (Y3) | 新 analytics_store_window 事件 | – |
| v4 (Y4) | 新 monetization_bus_window 事件 | – |

**契约**：字段只能加不能删；删除字段须新版本号 + 服务端兼容期。
Z4 加 contract tests 锁定字段名（防止重命名误删）。
