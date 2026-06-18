# AA5 dynamic leafCap 灰度阶段 1 监控周报模板（v1.71 EE2）

> 阶段 1 上线日：填入实际日期。配置：`enabled=true, percent=5, salt=dyn-cap-v1`。
> 监控周期：**T+7 天**。本模板每周一由 owner 填写并归档到 `docs/engineering/changelog/aa5-week-N.md`。

---

## 1. 核心 KPI 对比（实验组 vs 对照组）

数据源：`dfs_budget_window` 事件（DD2 加 `rollout_enabled` label）

Prometheus 查询（按 rollout_enabled 拆分）：

```promql
# cappedRatio P95 对比
histogram_quantile(0.95,
  sum by (le, rollout_enabled)(rate(openblock_dfs_budget_window_capped_ratio_bucket{env="prod"}[1d]))
)
```

| KPI | 对照组 (rollout_enabled=false) | 实验组 (rollout_enabled=true) | Δ | 期望 | 判定 |
|---|---|---|---|---|---|
| `cappedRatio` P50 | __% | __% | __pp | 实验组应 ↓ ≥ 20pp | ⬜ |
| `cappedRatio` P95 | __% | __% | __pp | 实验组应 ↓ ≥ 30pp | ⬜ |
| `truncatedRatio` P95 | __% | __% | __pp | 不应 ↑ > 5pp | ⬜ |
| `budgetUsageHist[3]` 占比 | __% | __% | __pp | 实验组轻微 ↑（≤ 10pp）正常 | ⬜ |
| `evalTripletCalls` rate | __/min | __/min | __% | 持平（±5%） | ⬜ |

**预期信号**：实验组 `cappedRatio` 显著下降是 dynamic leafCap 真正起作用的核心证据；
`truncatedRatio` 微升是允许的（high fill cap=96 多算了一些）。

## 2. 业务 KPI 对比（漏斗）

数据源：业务漏斗（按 user bucket label 拆分）

| 业务 KPI | 对照组 | 实验组 | Δ | 阈值 | 判定 |
|---|---|---|---|---|---|
| `session_duration` 中位数 | __min | __min | __% | 实验组 ≥ 对照组 -1% | ⬜ |
| `pb_growth` 速率 | __/session | __/session | __% | 实验组 ≥ 对照组 -2% | ⬜ |
| `revive_rate` | __% | __% | __pp | 实验组 ≥ 对照组 -1pp | ⬜ |
| `monetization_arpu` | $__ | $__ | __% | 实验组 ≥ 对照组 -2% | ⬜ |

**回滚阈值**：任何业务 KPI 跌 > 2% → 立即关闭（改 `percent=0`），复盘后再放。

## 3. 异常监控

数据源：`dfs_budget_window` + `monetization_bus_window` + `analytics_store_window`

| 指标 | 当前值 | SLO | 告警等级 | 判定 |
|---|---|---|---|---|
| `truncatedRatio` P95 (全局) | __ | ≤ 5% | P0 > 15% | ⬜ |
| `monetization_bus.totalCircuitTrips` | __ | 0 | P0 > 0 | ⬜ |
| `analytics_store.idbPutFail` rate | __ | < 1% | P1 > 5% | ⬜ |
| `client_error_batch` rate | __ | 与上周持平 | P1 ↑ > 50% | ⬜ |
| Beacon `getStats().dropped` (若启用) | __ | 0 | P2 > 0 | ⬜ |

## 4. 桶分布验证

```promql
# 实验组占比应稳定在 5% ± 1%
sum(rate(openblock_dfs_budget_window_total_calls{env="prod",rollout_enabled="true"}[1h]))
/
sum(rate(openblock_dfs_budget_window_total_calls{env="prod"}[1h]))
```

| 指标 | 实际 | 期望 | 判定 |
|---|---|---|---|
| 实验组流量占比 | __% | 5% ± 1% | ⬜ |
| bucket 0..4 总 calls | __ | 各桶 ≈ 平均 ± 30% | ⬜ |

**异常排查**：若实验组占比明显偏离 5%，检查：
1. `peekUserId()` 返回率（新用户无 userId 时被算作对照组 = 偏低）
2. `xfnv1a` hash 分布健康
3. `salt` 配置是否被某次发版意外修改

## 5. 决策表（T+7 天）

| 维度 | 全绿 | 黄灯 | 红灯 |
|---|---|---|---|
| 核心 KPI 对比 | 进阶段 2 | 监控 +3 天后决定 | 回滚 |
| 业务 KPI 对比 | 进阶段 2 | 监控 +3 天 | 回滚 |
| 异常监控 | 进阶段 2 | 修异常后再决定 | 回滚 |

**进阶段 2 操作**：改 `game_rules.json` `rollout.dynamicLeafCap.percent=25`，sync 三端，发版。

**回滚操作**：改 `percent=0`，发版（无需改 salt——用户桶号稳定，下次再开仍是同桶）。

## 6. 沉淀产物

- 周报归档：`docs/engineering/changelog/aa5-week-1.md` ... `aa5-week-N.md`
  - **FF2** 模板：`docs/engineering/changelog/aa5-week-template.md`
- benchmark 报告：weekly-dead-code CI artifact (DD5)
- **FF5** 自动滚动 baseline：`.github/workflows/benchmark-trend-rolling.yml`
  每周一 03:00 UTC 自动 commit 新基线，让周报里的 Δ% 始终反映"本周 vs 上周"
- 服务端 dashboard 快照（建议）：保留 BB2 / CC5 dashboard 的截图

## 7. 相关文档

- `docs/engineering/DYNAMIC_LEAFCAP_AB_PLAN.md` — 4 阶段完整方案
- `docs/engineering/OBSERVABILITY_WINDOW_SCHEMA.md` — *_window 字段表
- `ops/grafana/dfs_budget_window.dashboard.json` — BB2 仪表盘
- `ops/grafana/README.md` — DD2 灰度对照查询示例
- `web/src/main.js` CC2 rollout 解析（运行时入口）
