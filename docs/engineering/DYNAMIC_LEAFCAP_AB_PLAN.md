# Dynamic leafCap A/B 灰度方案（v1.71 AA5）

> 把 Y1 引入的 `dynamicLeafCap` 能力**安全地**上线生产环境的渐进式计划。

## 背景

- **X4 双峰发现**：`evaluateTripletSolutions` 的 `solutionCount/cap` 分布强烈双峰：
  - `<25%` 桶 38%：低 fill triplet，cap=64 严重过剩
  - `≥75%` 桶 34%（含 26% 触顶）：高 fill triplet，cap=64 截断
- **Y1 实现**：`resolveDynamicLeafCap(fill, cfg)` 按 fill 三档：32 / 64 / 96
- **AA5 配置接入**：`shared/game_rules.json` `adaptiveSpawn.solutionDifficulty.dynamicLeafCap`（默认 false）

## 风险分析

| 风险 | 等级 | 原因 |
|---|---|---|
| 评估失真改变玩家体验 | **HIGH** | leafCap 影响 `solutionMetrics.solutionCount`，下游 `targetSolutionRange` 软过滤会调整 spawn 策略 |
| 性能回退（high fill cap=96 增 50%） | MEDIUM | high fill 路径 DFS 调用增加 |
| Cache miss 率上升 | LOW | `_solnKey` 包含 leafCap，不同档位独立缓存项，无脏缓存 |
| 跨平台不一致 | LOW | sync-core.sh 已同步 blockSpawn.js，三端配置同一 game_rules |

## 灰度阶段

### 阶段 0（CURRENT）：能力 + 默认关
- Y1 落地 `resolveDynamicLeafCap` helper
- AA5 落地 `game_rules.json` 配置字段（默认 `dynamicLeafCap: false`）
- 上线后线上 100% 走静态 leafCap=64（行为零变化）
- 验证手段：X1 `dfs_budget_window` + X4 `cappedRatio` 持续观测

### 阶段 1（T+7 天）：5% 灰度
**触发条件**：阶段 0 数据稳定 ≥ 7 天，无新增告警

实施方案（用户分桶）：
```js
// web/src/main.js 启动时：
const userBucket = hashUserId(userId) % 100;
if (userBucket < 5) {
    GAME_RULES.adaptiveSpawn.solutionDifficulty.dynamicLeafCap = true;
}
```

**观察 KPI**（vs 对照组）：
- `dfs_budget_window.cappedRatio` 应**显著下降**（38% → < 5% 期望）
- `dfs_budget_window.budgetUsageHist` 总和应**轻微上升**（high fill 多算）
- 业务 KPI：`session_duration` / `revive_rate` / `pb_growth` 应 **持平**（行为变更预期不可感）

**回滚阈值**：
- `cappedRatio` 未显著下降 → 配置错误，立即关闭
- `truncatedRatio > 5%` → 高 fill cap=96 触发 budget 上限，回到 64
- 任何业务 KPI 跌 > 2% → 立即回滚 + 复盘

### 阶段 2（T+14 天）：25% 灰度
**触发条件**：阶段 1 KPI 全绿

调高 `userBucket < 25`。继续监控 7 天。

### 阶段 3（T+21 天）：100% 全量
**触发条件**：阶段 2 完美通过

`game_rules.json` 改 `dynamicLeafCap: true`，全量切换。
保留代码路径 + flag 至少 1 个版本，便于一键回滚。

### 阶段 4（T+45 天）：清理回退
**触发条件**：全量稳定 ≥ 4 周

- 移除 `if (!cfg.dynamicLeafCap) return cfg.leafCap;` 短路（成为唯一路径）
- 保留三档配置字段（仍可调节）
- 文档归档到 `docs/engineering/changelog/`

## 监控告警 SLO

| 指标 | SLO | 来源 | 告警 |
|---|---|---|---|
| `cappedRatio` | ≤ 5% | `dfs_budget_window` | P1（> 10% 立即查） |
| `truncatedRatio` | ≤ 5% | `dfs_budget_window` | P0（> 15% 自动回滚） |
| `monetization_bus.totalCircuitTrips` | 0 | `monetization_bus_window` | P0 |
| `session_duration` 分位 | ≥ -1%（对照） | 业务漏斗 | P2 |
| `pb_growth` 速率 | ≥ -2%（对照） | 业务漏斗 | P2 |

## 灰度过程中可调节字段

游戏运行时通过远端配置（不发版）即可调：

```json
"solutionDifficulty": {
  "dynamicLeafCap": true,
  "leafCapLowFillThreshold": 0.45,
  "leafCapHighFillThreshold": 0.65,
  "leafCapLowFill": 32,
  "leafCapHighFill": 96
}
```

**调参建议**：
- `cappedRatio` 仍偏高 → 上调 `leafCapHighFill` 到 128
- `truncatedRatio` 偏高 → 同时上调 `budget` 到 12000
- 性能回退明显 → 收紧 `leafCapHighFillThreshold` 到 0.70

## 验证清单（每个阶段必走）

- [ ] `npm run verify:cocos-core` 三端 parity 通过
- [ ] `npm test` 全过（含 dynamicLeafCap.test.js 与 spawnGolden）
- [ ] `npm run benchmark` 生成报告，对比上轮基线
- [ ] X1 dfs_budget_window 实时数据看板 7 天观察
- [ ] 业务 KPI 漏斗 7 天对照组分析

## 后续候选

- 阶段 4 完成后：考虑 cap 跟随 `solutionSpace pressure` 而非 `fill`（更精准）
- 加 `leafCapByPlaystyle`：perfect_hunter 玩家可以给更大 cap（追求多消）

## 相关文档

- `docs/engineering/DFS_BUDGET_BASELINE.md` — V4 W3 观测基线
- `docs/engineering/OBSERVABILITY_WINDOW_SCHEMA.md` — Z1 *_window 字段表
- `web/src/bot/blockSpawn.js` — `resolveDynamicLeafCap` 实现
- `tests/dynamicLeafCap.test.js` — Y1 三档单测
