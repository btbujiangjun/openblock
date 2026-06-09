# 单步与单轮放块质量评估 · v1.69

> 与本文件成对的局/局间评估见 `SESSION_EVALUATION.md`；与本文件支撑同一份 ledger
> 落库的后端 schema 见 `engineering/SQLITE_SCHEMA.md` 的 `evaluation_session` 表。

## 0. 为什么需要"步/轮"级评估？

在 v1.68 之前，OpenBlock 的评估口径只到"局后回放分析"（`buildReplayAnalysis`），
对**每一步是否最优、玩家失误来自哪一类**没有客观刻度。这造成两类问题：

1. **算法侧**：spawn 模型只能用 outcome（线数 / 得分）做奖励，无法区分"算法
   给的不友好" vs "玩家自己打废"——一旦灰度上线，新模型在弱玩家上的得分
   下降被全部归因到模型，模型迭代被回滚的误判率非常高；
2. **玩家侧**：strategyAdvisor 想做"这一步本可以这样更好"提示，缺少**每步
   regret + 错误归因标签**，只能用模糊的措辞，触发体验差。

本评估系统给出一份**纯函数链 `move → round → session → run-to-run`**，每一层
都输出可解释的 5 维分量 + regret + 单标签分类，让 spawn 模型训练能拿到
"forced_bad / salvage" 的高质量负样本筛除，让灰度回滚有定量的健康曲线。

## 1. 模块清单

| 模块 | 路径 | 触发时机 | 输出契约 |
|------|------|----------|----------|
| `evaluatePlacement` | `web/src/evaluation/placementQuality.js` | 每次玩家落子完成 | `moveQuality` |
| `evaluateRound`     | `web/src/evaluation/roundQuality.js`     | dock 三块全部消费完毕 | `roundQuality` |
| `buildSessionEvalRecord` | `web/src/evaluation/sessionEvaluator.js` | `endGame()` 末尾 | `sessionEvalRecord` |
| `buildIntraDayReport` / `buildMultiDayReport` / `compareModelVersions` | `web/src/evaluation/runToRunEvaluator.js` | 离线 / dashboard | 局间聚合 |
| `evaluationLedger.js` | `web/src/evaluation/evaluationLedger.js` | Game 实例字段 | 累计器 |
| `gridAdapter.js` | `web/src/evaluation/gridAdapter.js` | 内部 | cells → grid-like |

所有模块为**纯函数**：不读全局状态，不发起网络请求，可在 Web / 小程序 /
Cocos 任意端运行。当前接入只在 Web 端（`web/src/game.js`）开启钩子；小程序与
Cocos 端通过 `sync-core.sh` 同步代码但运行时**默认关闭钩子**（避免移动端额外
评估开销影响 60fps）。

## 2. moveQuality：单步放块评分

### 2.1 5 维分量

| 维度 | 含义 | 权重默认 |
|------|------|---------|
| `contact`     | 与已有块/墙的 4-邻接边数（归一） | 0.20 |
| `tidiness`    | 放完后 heightVariance 变化（越小越好） | 0.20 |
| `holeSafety`  | `1 − sigmoid(0.9·holesΔ + 0.5·enclosedΔ)` | 0.30 |
| `payoff`      | 实际消行数（阶梯映射 0/1/2/3+ → 0/0.4/0.7/1.0） | 0.20 |
| `unlocking`   | dock 剩余块的最小合法落点数变化（归一） | 0.10 |

权重在 `game_rules.json → placementEvaluation.weights` 可调；5 维和恒等于 1，
所以 `absScore ∈ [0, 1]`。

### 2.2 regret 与 badnessTag

枚举该形状在当前盘面所有合法落点，计算每个候选的 `absScore`，取最大值
`bestAbs`。

```
regret      = bestAbs − absScore            ∈ [0,1]
optimality  = absScore / bestAbs            ∈ [0,1]
badnessTag  ∈ {optimal, created_hole, top_stacking, wasted_payoff, fine}
```

`badnessTag` 判定优先级：`regret ≤ 0.05 → optimal`；否则按 holesΔ / heightΔ /
nearFullLines × payoff=0 三类阈值依次分类，最后兜底 `fine`。阈值在
`game_rules.json → placementEvaluation.badness` 可调。

### 2.3 节流

开局极松（`fillRatio < 0.25`）且候选位极多（`>= 500`）时，跳过 enumerate，
给乐观默认 `{ evaluated: false, absScore: 0.8, regret: 0 }`。这层节流避免
开局阶段每步触发 1-2ms 的全枚举（8×8 棋盘上极端可能 500+ 候选）。

## 3. roundQuality：单轮三块评分

### 3.1 5 维分量（与 move 不同口径）

| 维度 | 含义 | 权重默认 |
|------|------|---------|
| `solutionUsage`  | 玩家所用 dock 排列在 6 个排列中的 rank | 0.25 |
| `pathQuality`    | 玩家三步 absScore 均值 / 该排列最佳均值 | 0.25 |
| `payoffRealized` | 玩家三步累计消行 / 跨排列最大消行 | 0.20 |
| `endFlatness`    | 轮末盘面 flatness | 0.15 |
| `continuity`     | `1 − maxColHeight / N`（防顶 buffer） | 0.15 |

### 3.2 三类 regret 拆解

| regret | 含义 |
|--------|------|
| `orderRegret`  | 最优排列均分 − 玩家排列均分（玩家排列下的"最佳玩法"均分） |
| `pathRegret`   | 玩家排列最佳均分 − 玩家实际均分 |
| `payoffRegret` | （跨排列最大消行 − 玩家消行）/ 跨排列最大消行 |

总 regret 按 `regretBlend` 默认 `0.4/0.4/0.2` 加权融合。

### 3.3 分类

```
classification ∈ {optimal, payoff_missed, order_wrong, placement_wrong,
                  forced_bad, salvage, incomplete}
```

判定规则：

1. `bestRoundAbs < forcedBadThreshold(0.4)` → **forced_bad**（algo 责任，不计玩家头上）；
2. `regrets.total ≤ optimalRegret(0.05)` → **optimal**；
3. `optimality ≥ 0.85 ∧ bestRoundAbs < salvageThreshold(0.5)` → **salvage**（玩家在
   不利场景下打出近最优）；
4. 三类 regret 中最大者 < `classifyDominantDelta(0.15)` → **optimal**；
5. 否则按主导 regret → **payoff_missed / order_wrong / placement_wrong**。

## 4. 接入点

```
Game.start()                              → createEvaluationLedger
                                            patchLedgerMeta(RoR 上下文)
Game._commitSpawn(shapes, layered)        → _evalOnSpawn
                                            recordSpawnEvent + 关闭上一轮
                                            recordStress/Flow/BoardSample
Game.onEnd() / playClearEffect()          → _evalOnPlace
                                            evaluatePlacement → recordMoveQuality
                                            记入 _evalRoundMoves
                                            recordStress/Flow 采样
当 dock 三块用尽 → 触发下次 _commitSpawn   → _evalCloseRound
                                            evaluateRound → recordRoundQuality
                                            finalizeSpawnEvent（intent/guarantee/payoff 兑现）
Game.endGame()                            → _evalOnGameOver
                                            buildSessionEvalRecord
                                            POST /api/evaluation/session
```

所有 hook 全部用 try/catch 兜底，evaluation 失败**不会**影响主玩法。离线时
record 暂存 localStorage（`openblock_pending_eval_v1`），server 上线后由后续
sync 流补传（v1.70 计划）。

## 5. 配置

`shared/game_rules.json`：

```jsonc
"placementEvaluation": { "enabled": true, "weights": {...}, "throttle": {...}, "badness": {...} },
"roundEvaluation":     { "enabled": true, "weights": {...}, "regretBlend": {...}, "thresholds": {...} },
"sessionEvaluation":   { "enabled": true, "guard": {...} }
```

跨端：`scripts/sync-core.sh` 已把 `web/src/evaluation/*.js` 与 game_rules.json
同步到 `miniprogram/core/evaluation/` 与 `cocos/assets/scripts/engine/`。

## 6. 计算开销

| 模块 | 单次调用 | 触发频率 | 单局额外开销估算 |
|------|---------|----------|------------------|
| evaluatePlacement | 0.3-1.5ms（依候选数） | 每步 1 次 | 0.5-3ms × ~30 步 ≈ 15-90ms |
| evaluateRound     | 5-30ms（6 排列 × 3 步 × 枚举） | 每轮 1 次 | 5-30ms × ~10 轮 ≈ 50-300ms |
| buildSessionEvalRecord | < 1ms | 每局 1 次 | 1ms |

全部发生在玩家**已落子之后**或**轮间隙**，不阻塞主交互。Web 桌面端实测 P99
每步 < 2ms，对 60fps 渲染无可见影响。移动端默认不启用以保留 frame budget。

## 7. 验收测试

`tests/evaluation/` 共 21 个 vitest 用例：

- `placementQuality.test.js` 6 项：节流分支、贴边 contact、造洞 holeSafety、消行 payoff、权重和归一、非法落点；
- `roundQuality.test.js` 4 项：incomplete、classification 枚举、bestPermutation 存在、forced_bad 边界；
- `sessionEvaluator.test.js` 6 项：空 ledger schema、intentRealizationRate 分桶、rageQuit 判定、forcedBadRatio、arcContext 透传、stressAUC 梯形积分；
- `runToRunEvaluator.test.js` 5 项：daily 报告字段、cooldown 恢复率、60s vs 5s 窗口对比、PB 推进、回滚自动触发。

运行：`npx vitest run tests/evaluation/`。

## 8. 下游消费

| 消费方 | 用法 |
|--------|------|
| spawn 模型训练（rl_pytorch） | 用 `forced_bad / salvage` 标签筛除噪声样本，让 reward shaping 不被 algo 自身责任污染 |
| 灰度回滚（`compareModelVersions`） | `cross.regretPerStep` / `cross.forcedBadRatio` / `spawnAudit.guaranteeBreachRate` 任一显著恶化即触发告警 |
| strategyAdvisor | 用 `moveQuality.badnessTag` + `optimalPos` 给"本可以这样更好"的具体建议 |
| dashboard（`/api/evaluation/ror_audit`） | 按 RoR arc 分桶展示健康面板，验证 v1.68 局间难度弧线的真实效果 |

## 9. 决策真值快照（spawn audit 字段路径）

evaluation 写入 ledger 的 `spawnAudit` 字段必须读"真值通道"，避免基于 stress
变化推断造成的口径漂移。权威来源：

| 字段 | 来源 | 路径 |
|------|------|------|
| `spawnIntent`、`clearGuarantee`、`targetSolutionRange` | `adaptiveSpawn.resolveAdaptiveStrategy` 返回 | `layered.spawnHints.*` 或 `game._lastAdaptiveInsight.spawnHints.*` |
| `payoffIntensity` | 同上（嵌套在 spawnHints） | `layered.spawnHints.spawnTargets.payoffIntensity` |
| `solutionCount`、`firstMoveFreedom` | `blockSpawn.getLastSpawnDiagnostics()` 选块后回填 | `diag.layer1.solutionMetrics.{solutionCount, firstMoveFreedom}` |
| `softFilterRejects` | 同上，分项计数之和 | `Object.values(diag.solutionRejects).sum()` |
| `softFilterResamples` | 同上 | `diag.attempt`（重试次数） |
| `stressAtSpawn` / `stressAfter` | adaptiveSpawn 归一化 stress | `layered._adaptiveStress` ∈ [0,1] |

错误路径（早期版本曾误读，v1.69 修正）：
- ❌ `layered.spawnTargets.payoffIntensity`（顶层不存在）
- ❌ `layered._solutionMetrics`（不存在，需从 diagnostics 取）
- ❌ `layered._spawnDiagnostics`（命名错误，应为 `getLastSpawnDiagnostics()`）

## 10. RL 训练样本注入

端侧 `_pushPlaceToSequence` 把 placementQuality 结果挂到 `ps.evalMetrics`，
`_pushSpawnToSequence` 把上一轮 roundQuality 挂到下一个 spawn 帧的 `ps.evalRound`。
Python 训练管线（`rl_pytorch/spawn_model/dataset.py#_compute_spawn_outcome`）
直接读取，**不重算**——确保步/轮评估的所有规则升级（权重、阈值、新 component）
自动传导到 RL 训练样本，无需双端同步逻辑。

完整 OUTCOME_DIM 15 维契约见 `SESSION_EVALUATION.md §9 RL outcome 契约`。

## 11. strategyAdvisor 文案接入

`web/src/strategyAdvisor.js#generateStrategyTips(profile, insight, gridInfo, lastMoveEval)`
接受最新一步 `moveQuality` 快照，按 `badnessTag` 输出具体复盘卡：

| badnessTag | 文案 | 触发抑制 |
|-----------|------|---------|
| `created_hole` | 🕳️ 注意空洞：下一步尝试封顶或从底层补齐 | `regret < 0.10`（微小失误不打扰） |
| `top_stacking` | 🏔️ 堆叠偏高：优先选择能拉低最高列的落点 | `flowState === 'anxious'`（不打扰焦虑玩家） |
| `wasted_payoff` | 🎯 错过清行：下一手优先补齐缺口 | 同上 |
| `optimal` / `fine` | （不输出）| — |

设计约束：
- 优先级 0.78（夹在生命周期卡 0.55–0.92 之间），保证刚发生的失误能被看到；
- 与 `applyTipCategoryDiversity` 兼容：'evaluation' 类别仅占 1 个 slot，不挤压
  `survival` / `combo` / `pace` 等高优先级类别；
- `lastMoveEval` 传 `null` 时该层完全静默，保留旧调用方兼容。

## 12. adaptiveSpawn 反馈闭环（v1.69.2）

v1.69.1 完成端侧 evaluation 写入与 RL outcome 离线消费后，本节描述 v1.69.2
建立的"实时反馈闭环"——让 evaluation 信号在**下一帧 spawn** 就影响出块。

### 12.1 数据通路

```
端侧 evaluation                playerProfile 滑窗            adaptiveSpawn 消费
─────────────                 ─────────────────            ──────────────────
_evalOnPlace   ─ mq ─►   recordMoveQuality(mq)       ─►  evalMetrics
                          → _evalWindow[]                  .recentMeanRegret
                                                           .recentMeanOptimality
_evalCloseRound ─ rq ─►  recordRoundQuality(rq)      ─►   .recentForcedBadRate
                          → _roundEvalWindow[]            .recentSalvageRate
                          → _consecutiveForcedBad         .consecutiveForcedBad
                                                           .lastRoundClassification
                                                                    │
                                                                    ▼
                              resolveAdaptiveStrategy(profile, …)
                                ├─ forceReliefIntent |= (consecutiveForcedBad ≥ 2
                                │                       || recentForcedBadRate > 0.3)
                                ├─ clearGuarantee +=
                                │     2  if consecutiveForcedBad ≥ 2
                                │     1  if lastRoundClassification = 'forced_bad'
                                │     1  if recentForcedBadRate > 0.4
                                ├─ targetSolutionRange.max += 2
                                │     if forced_bad 历史（同上条件之一）
                                └─ sizePreference += 0.05
                                      if recentSalvageRate > 0.3 且无 forced_bad
```

### 12.2 设计原则

1. **算法责任 vs 玩家责任分离**：`forced_bad`（最优放法也打不出好局）一律视为算法
   失衡 → relief；`mean_regret` 高但 forced_bad 低视为玩家自身失误 → advisor 文案
   提示但 spawn 不强行降低难度（避免"宠玩家"导致段位通胀）。
2. **闭环冷启动保护**：滑窗 `samples < 3` 时所有派生量退化到中性，
   adaptiveSpawn 不会基于不足证据做激进反馈。
3. **不破坏模型契约**：evaluation 信号**不进**模型 `behavior_context`（保持
   63 维 + 旧 checkpoint 兼容），而是通过 `clearGuarantee` / `targetSolutionRange.max`
   / `spawnIntent` 这 3 个**已经**是 behavior_context 输入的维度间接生效。这是
   "高阶反馈优于低阶 state 扩维"的工程选择，避免重训模型。
4. **多端一致**：滑窗逻辑通过 `sync-core.sh` / `sync-cocos-engine.mjs` 同步到
   miniprogram CJS 与 Cocos ESM。Cocos 端 per-place 评估默认关闭
   （`evaluationRuntime.platforms.cocos.perPlace: false`），但 `recordMoveQuality`
   API 仍可用——后续接入只需启用配置，无需改 adaptiveSpawn。

### 12.3 玩家解释（playerInsightPanel）

`_buildEvalWhyLines(profile)` 把 `evalMetrics` 翻译成玩家可读 bullet，注入
"🧠 放块评估" 解释组：

| 触发 | 文案模板 |
|------|----------|
| `consecutiveForcedBad ≥ 2` | "检测到连续 N 轮算法死局，下一轮已自动补救：保消档位 +2，区间放宽。" |
| `lastRoundClassification = 'forced_bad'` | "上一轮被判定为算法死局，本轮自动提高保消档位。" |
| `recentForcedBadRate > 0.3` | "最近 N 轮中 X% 被判算法死局，已持续抬高保消档位。" |
| `recentSalvageRate > 0.3` | "你最近 X% 的轮次在不利局面打出近最优（救场），算法维持当前难度。" |
| `recentMeanRegret ≥ 0.25` | "最近 N 步平均后悔度 0.XX，距离最优放法有较大差距。" |
| `recentMeanRegret ≤ 0.05 ∧ optimality ≥ 0.95` | "放块质量接近最优，保持当前节奏。" |

### 12.4 DFV 信号节点

`decisionFlowViz.js` 的 `SIGNAL_NODES` 新增 2 个 evaluation 节点（v1.69.2）：

| key | label | 数据源 | range | 语义 |
|-----|-------|-------|-------|------|
| `regret` | 后悔 | `profile.evalMetrics.recentMeanRegret` | [0, 0.6] | 玩家平均后悔度；高 = 玩家高频失误 |
| `forcedBad` | 算法死局 | `profile.evalMetrics.recentForcedBadRate` | [0, 0.5] | 最近 12 轮 forced_bad 占比；> 0.3 触发反馈闭环 |

两个节点都自动接入 `idle 呼吸动画`、`baseColor + opacity` 状态可视化、悬浮 `<title>` 提示。

### 12.5 v1.69.2 正确性修复

| 修复 | 影响 |
|------|------|
| **P0：`forced_bad` 门控用 `bestRoundAbs` 而非 `roundAbs`** | 修复前：玩家放得差也算"算法死局"，错把玩家失误归责给算法；修复后 RL 训练侧 `_outcome_weight_factor` ×0.6 / `_pb_reward` -0.10 信号正确 |
| **P1：`badnessTag` 用 `max(holesΔ, enclosedΔ)`** | 玩家视觉敏感的 enclosedVoidCells 也能触发"created_hole"提示，与 spawnGeo 口径一致 |
| **P2：节流步不写入 `ps.evalMetrics`** | session 端与 RL 离线端 mean_regret 口径统一（均按 evaluated 步聚合） |
| **P2：`enumerateBest` 直接读 `q.lines`** | 避免从 PAYOFF_LADDER 反推行数，在自定义权重时不再失真 |
