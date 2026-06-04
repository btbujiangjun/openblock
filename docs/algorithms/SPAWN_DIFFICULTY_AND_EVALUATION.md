# 出块难度与评估

> 本文档合并以下三份源文档：**SPAWN_SOLUTION_DIFFICULTY.md**（解法数量难度调控：DFS 解计数、stress 区间映射、顺序刚性算法）、**REALTIME_STATE_HISTORY_ANALYSIS.md**（单步难度细化：基于真实玩家状态序列的难度调优）与 **SPAWN_EVALUATION.md**（出块评估与可视化工具：CLI/Web 评估入口、Bot 分层、核心指标、P1/P2 实验轨）。

---

## 一、解法数量难度调控

> 更新：2026-05-09
> 关联：`SPAWN_ALGORITHM.md` §4、`ADAPTIVE_SPAWN.md` §3、`EXPERIENCE_DESIGN_FOUNDATIONS.md` §A.7
> 代码位置：`web/src/bot/blockSpawn.js`、`web/src/adaptiveSpawn.js`、`shared/game_rules.json`、`web/src/playerInsightPanel.js`

### 1.1 背景：为什么需要解法数量？

现有算法在中高填充时仅靠两个布尔/整数指标过滤候选三连块：

| 信号 | 类型 | 局限 |
|---|---|---|
| `tripletSequentiallySolvable` | bool | 1 解 vs 100 解都「通过」，无法区分难度 |
| `countLegalPlacements`（单块自由度） | int | 仅看局部，不考虑块间耦合 |

**引入「解法数量 (Solution Count)」**：在当前盘面下，三连块的 6 种放置顺序（3! 排列）中，能完整完成「逐块放下并应用消行」的「位置组合」叶子总数。这是一个密度指标，比"是否可解"细粒度高 1-3 个数量级。

### 1.2 设计目标

| 目标 | 描述 |
|---|---|
| **G1 难度连续可调** | 用 `targetSolutionRange = [min, max]` 平滑切换模式 |
| **G2 不破坏可玩性** | 软过滤：只在前 60% attempt 内拒绝越界 |
| **G3 性能可控** | DFS 双重剪枝（leafCap + budget） |
| **G4 可解释** | 面板曝光 4 个 Pill：解法数 / 合法序 / 首手 / 区间 |
| **G5 配置化** | 阈值全部进 `game_rules.json` |

### 1.3 算法详解

**`dfsCountSolutions`**：带剪枝的解叶子枚举。`accum.cap = leafCap`（默认 64），`budget.n`（默认 8000）。

**`evaluateTripletSolutions`**：返回 `validPerms`（0..6）、`solutionCount`、`capped`、`truncated`、`firstMoveFreedom`、`perPermCounts`。

### 1.4 stress → 解法区间映射

| 档位 | minStress | min | max | 体感 |
|---|---|---|---|---|
| 宽松 | -1.0 | 8 | ∞ | 起手 / 救场 |
| 舒适 | 0.0 | 4 | ∞ | 心流核心区 |
| 标准 | 0.35 | 2 | ∞ | 基本不限上限 |
| 紧张 | 0.6 | 1 | 32 | 解空间收窄 |
| 极限 | 0.8 | 1 | 12 | 唯一解附近 |

### 1.5 配置（`shared/game_rules.json`）

```json
"solutionDifficulty": {
  "enabled": true,
  "activationFill": 0.45,
  "leafCap": 64,
  "budget": 8000,
  "ranges": [
    { "minStress": -1.0, "label": "宽松", "min": 8, "max": null },
    { "minStress": 0.0,  "label": "舒适", "min": 4, "max": null },
    { "minStress": 0.35, "label": "标准", "min": 2, "max": null },
    { "minStress": 0.6,  "label": "紧张", "min": 1, "max": 32 },
    { "minStress": 0.8,  "label": "极限", "min": 1, "max": 12 }
  ]
}
```

### 1.6 顺序刚性 (orderRigor) — 高难度算法

**动机**：从"空间难度"到"时序难度"。`validPerms` 天然反映"顺序自由度"：

| `validPerms` | 含义 | 玩家体感 |
|---|---|---|
| 6 | 任何顺序都行 | 完全无顺序压力 |
| 4-5 | 大多数顺序行 | 偶尔需注意 |
| 3 | 大致一半 | 需要简单规划 |
| **2** | **必须挑特定顺序** | **强制前瞻规划** |
| 1 | 唯一序列 | 烧脑模式 |

**派生公式**：`orderRigor = clamp01(stressTerm + skillTerm + modeBoost)`, `orderMaxValidPerms = round(4 - 2 * orderRigor)`。

**五重 bypass**：新手保护、救场期、bottleneckRelief 已触发、空洞过多、空盘。

**互抑矩阵**：与 `bottleneckRelief` 互斥（bypass），与 `solutionCount` 紧张档同向加强，与 `friendlyBoardRelief` 不互抑。

### 1.7 玩家面板可视化

| Pill | 数据来源 |
|---|---|
| `解法 N[+]` | `solutionMetrics.solutionCount` |
| `合法序 V/6` | `solutionMetrics.validPerms` |
| `首手 K` | `solutionMetrics.firstMoveFreedom` |
| `区间 标签 [min, max]` | `targetSolutionRange` |

### 1.8 关键术语速查

- **解 (Solution)** — 一个完整的 `(顺序, 位置, 位置, 位置)` 元组。
- **leafCap** — `accum.count` 上限；命中后立即返回。
- **budget** — DFS 入栈次数上限。
- **validPerms** — 6 个排列里 leaves(π) > 0 的数量。
- **orderRigor** — 0~1 标量，表征顺序严苛程度。

---

## 二、单步难度细化

> 数据来源：本地 `openblock.db` 的 `move_sequences.frames[*].ps`。  
> 分析范围：222 局、13,347 个实时状态帧、4,496 个反应样本帧、2 个用户。  
> 口径说明：历史帧里的 `stressBreakdown` 是当时保存的事实值；涉及新阈值的 `reactionAdjust` 使用当前 `900/2200ms` 配置做模拟判断。

### 2.1 关键指标分布

| 指标 | 物理含义 | p50 | p90 | 解读 |
|---|---|---|---|---|
| `stress` | 压力输出 | 0.00 | 0.45 | 中位数很低，尾部可达高压 |
| `boardFill` | 板面占用 | 0.28 | 0.53 | 高板面帧不多，但进入后易和挫败共振 |
| `cognitiveLoad` | 认知负荷 | 0.30 | 1.00 | 高负荷帧占比高，是焦虑状态的主解释变量 |
| `frustration` | 连续未消行 | 0 | 3 | p95 已到强救济区 |
| `pickToPlaceMs` | 纯反应时间 | 1442ms | 1978ms | `900/2200ms` 阈值接近真实分布 |
| `clearRate` | 近期消行率 | 0.30 | 0.47 | 与 stress 正相关 |

### 2.2 关键互操作链路

| 链路 | 条件概率 | 结论 |
|---|---|---|
| 高板面 → 高挫败 | P(frustration≥4 \| boardFill≥0.58) = 40.0% | 需提前救济 |
| 低消行 → 高挫败 | P(frustration≥4 \| clearRate<0.25) = 33.9% | 适合前置 `clearGuarantee` |
| 焦虑 → 高负荷 | P(cognitiveLoad≥0.6 \| anxious) = 72.3% | 焦虑主要是认知负担共振 |
| 高负荷 → 慢反应 | P(pickToPlaceMs>2200 \| cognitiveLoad≥0.6) = 3.3% | 样本稀疏，不应成主判据 |

### 2.3 `reactionAdjust` 强度曲线饱和

原先只改到 `fastMs=900`、`slowMs=2200`，强度偏弱。已新增饱和区间：

- `fastMs=900`：进入快端尾部。
- `fastFullMs=500`：到达/低于该值时接近 `+0.05`。
- `slowMs=2200`：进入慢端尾部。
- `slowFullMs=3200`：到达/高于该值时接近 `-0.05`。

### 2.4 低消行前置救济

新增 `preFrustrationRelief`：

- 条件：`clearRate < 0.25` 且 `boardFill >= 0.45` 且尚未进入强挫败。
- 效果：小幅降低 stress，`clearGuarantee >= 2`，`sizePreference <= -0.18`，`multiClearBonus >= 0.42`。
- 目标：在 `frustration >= 4` 前介入。

### 2.5 高板面 × 挫败复合救济

新增 `boardFrustrationRelief`：

- 条件：`boardFill >= 0.58` 且 `frustration >= 3`。
- 效果：更强降压，`clearGuarantee >= 2`，`sizePreference <= -0.28`，`multiClearBonus >= 0.55`。
- 目标：处理"盘面快满 + 多步不消"的死局感合流。

### 2.6 焦虑状态的认知减负

新增 `decisionLoadRelief`：

- 条件：`flowState === anxious` 且 `cognitiveLoad >= 0.60`。
- stress：小幅降压。
- spawnTargets：降低 `shapeComplexity`、`solutionSpacePressure`、`spatialPressure`，提高 `clearOpportunity`。
- orderRigor：作为 bypass 条件，避免高负荷时继续加顺序刚性。
- spawnHints：提高 `clearGuarantee`，偏小块，保留适度多样性。

### 2.7 `feedbackBias` 困境去偏

新增 `feedbackBiasDampingAdjust`：

- 条件：`feedbackBias > 0` 且玩家处在低消行、高板面挫败、决策负荷或高挫败等困境。
- 效果：按困境强度抵消一部分正向 `feedbackBias`，上限 `0.08`。
- 目标：避免闭环反馈长期偏正时，在玩家已经困难的帧继续隐性加压。

### 2.8 工具化更新流程

```bash
npm run spawn:realtime-tune -- --sqlite openblock.db --pretty
npm run spawn:realtime-tune -- --sqlite openblock.db --apply --pretty
```

第一条只分析并更新报告；第二条把推荐参数写入 `shared/game_rules.json`，并同步 `miniprogram/core/gameRulesData.js`。

---

## 三、出块评估与可视化工具

> 目标：把"出块是否公平、奖励是否有节奏、玩家选择是否有意义"从主观体感变成可重复跑的指标基线。

### 3.1 工具入口

**CLI**：
```bash
npm run spawn:eval -- --sessions 120 --max-steps 360 --strategies easy,normal,hard --out .cursor-stress-logs/spawn-eval.json
```

**可视化页面**：`http://localhost:3000/spawn-eval.html`

### 3.2 策略参数优化器

可视化页已从只读评估升级为"参数方案 → 寻优 → 保存/加载"的闭环：

- 自定义寻优：调整 `noMove / rewardAgency / skillLift / fallback / pacing` 五类目标权重。
- 模型化参数：`personalizationStrength / temperature / surpriseBudgetGain / surpriseCooldown`。
- 自动寻优：枚举 baseline / P1 / P2，按综合评分选最优方案。
- 参数持久化：保存到 SQLite 或 localStorage。

### 3.3 Bot 分层

| Bot | 策略 | 用途 |
|---|---|---|
| `random` | 随机合法落子 | 低规划或误触模拟 |
| `clear-greedy` | 优先立即消行 | 普通玩家模拟 |
| `survival` | 优先保留机动性 | 高手规划模拟 |

三类 bot 不是为了替代真实玩家，而是用于拆解"出块质量"。

### 3.4 核心指标

| 指标 | 含义 |
|---|---|
| `scoreMean / scoreP50 / scoreP90` | 分数分布 |
| `stepsMean` | 平均局长 |
| `noMoveRate` | 无路可走终局比例 |
| `clearIntervalMean / clearIntervalP90` | 消行间隔 |
| `multiClearRate / perfectClearRate` | 多消 / 清屏频率 |
| `fallbackRate / attemptMean` | 出块器兜底与重抽压力 |
| `firstMoveFreedomMean / solutionCountMean` | 容错与解空间 |
| `naturalFairnessGap` | `random.noMoveRate - survival.noMoveRate` |
| `skillScoreLift` | `survival.scoreMean - random.scoreMean` |
| `rewardAgencyGap` | `clearGreedy.clearsMean - random.clearsMean` |

### 3.5 P1：组合级候选评分

P1 已落地为 `spawnGenerator=triplet-p1`。从当前盘面可放形状中筛出 Top 候选，枚举最多 `--max-triplets` 组三块组合，用组合级特征评分选择三连块。

### 3.6 P2：体验预算模型

P2 已落地为 `spawnGenerator=budget-p2`。把出块意图显式拆成四类预算：

- `survival`：保活、低空洞、首步自由。
- `payoff`：消行、多消、清屏、同花。
- `pressure`：块体积、形状复杂度、顺序刚性。
- `novelty`：品类多样性、重复形状、特殊块节流。

P2 实验轨支持轻量模型化参数：`personalizationStrength`、`temperature`、`surpriseBudgetGain`、`surpriseCooldown`。

### 3.7 切主路径门槛

P1/P2 进入主路径前至少需要满足：

- `noMoveRate` 不高于 baseline，随机 bot 低填充失败不增加。
- `rewardAgencyGap` 高于 baseline。
- `fallbackRate` 不高于 baseline。
- `stepsMean / scoreP90` 不出现明显 PB 膨胀。

### 3.8 报告解读

页面自动生成推荐方案、关键发现和改进建议。这些建议只作为调参辅助，不直接写入线上出块。

### 3.9 决策数据流（DFV）展示口径

DFV（`web/src/decisionFlowViz.js`，面板版本 **v1.67**）与线上出块算法对齐，开发态 **Shift+D** 打开。

**Baseline 主规则轨（已展示）**

| 层级 | 内容 |
|------|------|
| 左列 | 10 路玩家信号 → 压力球 → 5 策略分量 → 6 `spawnTargets` → 4 调度参数 → `spawnIntent` → 3 `chosen`（含 mini 栅格、reason、topDriver） |
| 右栏 | 意图 **rule trace**（`intentResolver` winner `reason`，区分 `pb_chase_pressure` vs `challengeBoost` 等）、压力贡献 Top4、决策 flags（含 **PB追击** / **爽感饥渴** chip）、形状权重、目标、调度 hints |
| v1.66 | **`pressurePhase`**（low/mid/high）、`orderSolutionBudget`、`phaseHighPoolBoost` / `phaseLowPoolClearBoost`；底部 sparkline 第 6 路为压力阶段 |
| v1.67 | 专段 **压力阶段 · 构造式**（`diagnostics.constructive`：kind / delivered / cooldown / fromPending / 候选计数）；`chosen[].constructed` 角标（构/势）；达成打点 `lowClearDelivered` / `highOrderApplied` |
| 几何 | `spawnDiagnostics.layer1`：占盘、近满线、空洞、多消候选、碎片、凹角（与 `snapshotInsightGeometry` 同源） |

**P1/P2 实验轨**：体验预算、PB/个性化卡、组合评/预算选 reason 与 `DRIVER_NODE_PATHS` 追溯仍保留。

**数据源**：`game._lastAdaptiveInsight` + `getLastSpawnDiagnostics()`；意图重判用 `_intentInputs` + 实时 `layer1` 几何（与 `game._refreshIntentSnapshot` 同口径）。

### 3.10 四端一致性

- Web：权威规则轨。
- Android / iOS：Capacitor WebView 加载 `dist`。
- 微信小程序：`sync-core.sh` 同步为 CJS。
