# AA5 dynamic leafCap 灰度周报模板（v1.71 FF2）

> **复制本文件**到 `aa5-week-N.md`（N 从 1 开始递增），填空后归档。
> 数据源：Prometheus / Grafana dashboards（详见 `ops/grafana/README.md`），
> 决策表与字段表详见 `docs/engineering/AA5_PHASE1_MONITORING.md`。

---

## 元信息

| 项 | 值 |
|---|---|
| 周次 | `week-N` |
| 监控窗口起 | `YYYY-MM-DD HH:00 UTC` |
| 监控窗口止 | `YYYY-MM-DD HH:00 UTC`（窗口长 7 天） |
| 灰度配置 | `enabled=__, percent=__, salt=__` |
| 当前阶段 | `阶段 1 / 阶段 2 / 阶段 3 / 全量` |
| 填写人 | `@owner` |
| 上一周次 | `aa5-week-(N-1).md` |

---

## 1. 核心 KPI 对比（按 `rollout_enabled` group_by）

| KPI | 对照组 | 实验组 | Δ | 期望 | 判定 |
|---|---|---|---|---|---|
| `cappedRatio` P50 | __% | __% | __pp | 实验组 ↓ ≥ 20pp | ⬜ |
| `cappedRatio` P95 | __% | __% | __pp | 实验组 ↓ ≥ 30pp | ⬜ |
| `truncatedRatio` P95 | __% | __% | __pp | 不应 ↑ > 5pp | ⬜ |
| `budgetUsageHist[3]` 占比 | __% | __% | __pp | 实验组 ≤ +10pp | ⬜ |
| `evalTripletCalls` rate | __/min | __/min | __% | ±5% | ⬜ |

## 2. 业务 KPI（漏斗）

| 业务 KPI | 对照组 | 实验组 | Δ | 阈值 | 判定 |
|---|---|---|---|---|---|
| `session_duration` 中位数 | __min | __min | __% | ≥ -1% | ⬜ |
| `pb_growth` 速率 | __/session | __/session | __% | ≥ -2% | ⬜ |
| `revive_rate` | __% | __% | __pp | ≥ -1pp | ⬜ |
| `monetization_arpu` | $__ | $__ | __% | ≥ -2% | ⬜ |

## 3. 异常监控（全局）

| 指标 | 当前 | SLO | 告警等级 | 判定 |
|---|---|---|---|---|
| `truncatedRatio` P95 (全局) | __ | ≤ 5% | P0 > 15% | ⬜ |
| `monetization_bus.totalCircuitTrips` | __ | 0 | P0 > 0 | ⬜ |
| `analytics_store.idbPutFail` rate | __ | < 1% | P1 > 5% | ⬜ |
| `analytics_store.idbFailReasons.tx_abort` (FF4 等价：EE4) | __ | < 0.5% | P1 > 2% | ⬜ |
| `client_error_batch` rate | __ | 持平上周 | P1 ↑ > 50% | ⬜ |
| Beacon `getStats().dropped` | __ | 0 | P2 > 0 | ⬜ |

## 4. 桶分布验证

| 指标 | 实际 | 期望 | 判定 |
|---|---|---|---|
| 实验组流量占比 | __% | `percent ± 1%` | ⬜ |
| bucket 0..99 分布健康度（χ²） | p=__ | p > 0.05 | ⬜ |

## 5. 决策（必填）

- [ ] **进下一阶段**（修改 `shared/game_rules.json` `rollout.dynamicLeafCap.percent`）
- [ ] **保持本阶段** 再观察 +3 天
- [ ] **回滚** 改 `percent=0`，发版

理由：____（一句话）

## 6. 备注 / 异常事件

- ____（如发版、节假日影响、Bug 上线等）

## 7. 关联工件

- benchmark CI artifact link：____
- Grafana dashboard 截图：____
- 上一周报：`aa5-week-(N-1).md`
- 决策依据：`docs/engineering/AA5_PHASE1_MONITORING.md`
