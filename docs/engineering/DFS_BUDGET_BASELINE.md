# DFS Budget Baseline — V4 观测埋点 + W3 数据采集首期发现

> v1.71 W3 立项：基于 V4 加的 `getBlockSpawnDfsStats()` 埋点 + 新工具
> `scripts/perf-dfs-stats.mjs`，**用数据驱动**决定 blockSpawn 的
> `SURVIVE_SEARCH_BUDGET` / `SOLUTION_BUDGET_DEFAULT` 是否调整。

## 采集工具

```bash
npm run perf:dfs-stats                       # 200 round 模拟，文本报告
npm run perf:dfs-stats -- --rounds 1000      # 更多 round
npm run perf:dfs-stats -- --json --out /tmp/dfs.json   # 机器可读
```

## 当前默认预算

`web/src/bot/blockSpawn.js` （来源 game_rules.solutionDifficulty）：

| 常量 | 默认值 | 用途 |
|---|---|---|
| `SURVIVE_SEARCH_BUDGET` | 14000 | `tripletSequentiallySolvable` DFS 总入栈上限 |
| `SOLUTION_BUDGET_DEFAULT` | 8000 | `evaluateTripletSolutions` 解法枚举上限 |
| `SOLUTION_LEAF_CAP_DEFAULT` | 64 | 解法计数 cap |

## X4 增量观测：leafCap 触顶率

V4 仅观测 `budget`（DFS 入栈预算耗尽）。X4 补齐 `leafCap`（评估完成时
solutionCount/cap 触顶率）：

| 字段 | 含义 |
|---|---|
| `cappedCount` | `solutionCount >= cap` 的 triplet 数 |
| `cappedRatio` | cappedCount / evalTripletCalls |
| `leafUsageHist` | solutionCount/cap 落入 [<25%, <50%, <75%, ≤100%] 4 桶 |
| `evalTripletCalls` | evaluateTripletSolutions 调用次数 |

### 模拟数据（200 round，2026-06-18）

```
leafCap（evaluateTripletSolutions 调用 336）：
  触顶 88（26.19%）
  solutionCount/cap 桶分布：
     <25%   38.4%  ███████████████████
     <50%   17.9%  █████████
     <75%    9.5%  █████
    ≤100%   34.2%  █████████████████  ← 含 26% 触顶
```

**双峰分布解读**：
- **< 25% 桶（38%）**：低 fill / 简单 triplet，解空间小，远未到 cap → leafCap 对这些场景"过大"
- **≤ 100% 桶（34%）**：高 fill / 复杂 triplet，解空间被 cap 截断 → leafCap 对这些场景"偏小"

→ **决策推论（仍仅基于模拟）**：单一 `leafCap=64` 难以同时优化两类场景；
若实际生产数据印证双峰，可考虑：
1. 短期：维持 64 不动（OK 区间）
2. 长期：让 leafCap 跟随 `pressureContext.solutionSpace` 动态——简单盘面 cap=32，复杂盘面 cap=96

### X4 leafCap 决策表

| cappedRatio | leafHist[<25%] | 决策 |
|---|---|---|
| > 30% | – | **TIGHT** — cap 过小，建议上调 25–50% |
| < 5% | > 70% | **EXCESS** — cap 过大，可下调 20–30% |
| 其余 | – | **OK** — 维持 |

线上数据回流后（X1 已接入 tracker），1 周观察期再决策。

## 模拟数据首发结果（2026-06-18）

200 round 模拟（fill 0.10–0.75 正弦漂移，平均 profile）：

```
总 DFS 调用：~510
Truncated：0（0.00%）
budgetUsage 桶分布：
  <25%   100.0%   █████████████████████████████████████████████████
  <50%     0.0%
  <75%     0.0%
  ≤100%    0.0%
```

**结论（模拟数据，慎用）**：当前预算严重过剩，每次 DFS 都在 <25% 内 short-circuit。
按 W3 工具的决策表，理论上可以下调 25–40%（14000 → 8000–10000）。

## 但是先不动 — 三条原因

1. **模拟数据 ≠ 真实**。模拟用单一 balanced profile + 单一 fill 路径，覆盖不到
   frustration / nearMiss / postPbRelease / D4 段等真实高压情景。这些场景里
   DFS budget 占用可能截然不同。

2. **U2 节省的预算是确凿的，但「节省下来给谁」是开放问题**。下调 budget 是
   一条路（省主线程），上调 budget 拿更准的解（更精确的 solutionCount /
   diversity 评分）是另一条路。这是产品决策，需要数据 + owner 评审。

3. **预算调整会改变 spawnGolden 快照**。任何变动都需要回放/对比真实玩家
   出块分布是否仍然"好玩"。

## 落地路径（推荐）

- [x] V4：加埋点（已完成，0 行为变更）
- [x] W3：建采集工具 + 文档（本文档）
- [ ] **运营接入**：把 `getBlockSpawnDfsStats()` 通过 `analyticsTracker` 上报
      到 dashboard（如 D7 truncatedRatio 均值 + p95 百分位）
- [ ] **观测 1 周**：收集真实玩家分布
- [ ] **决策**：基于真实分布按 W3 工具的决策表执行
- [ ] **灰度**：分 10% 流量做 A/B（新 budget vs 旧 budget），观察留存/付费 7 天
- [ ] **全量**：A/B 显示无负向影响后全量

## 决策表（W3 工具内置 + 此处冗余）

| truncatedRatio | 级别 | 建议 |
|---|---|---|
| `< 5%` | EXCESS | 下调 25–40%（节省主线程） |
| `5% – 15%` | OK | 维持现状 |
| `15% – 30%` | TIGHT | 上调 15–25%（U2 节省的预算可投入） |
| `≥ 30%` | CRITICAL | 立刻上调 30–50% 并加场景化预算 |

## 历史变更

| 日期 | commit | 变更 |
|---|---|---|
| 2026-06-18 | `7c247df` (V4) | 加 `getBlockSpawnDfsStats` 观测埋点 |
| 2026-06-18 | (W3) | 创建本文档 + `scripts/perf-dfs-stats.mjs` |
