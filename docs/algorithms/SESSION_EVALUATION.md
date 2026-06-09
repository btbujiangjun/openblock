# 单局与局间评估 · v1.69

> 与本文成对的 `PLACEMENT_QUALITY.md` 描述步/轮级评分；本文聚焦"一局"与
> "多局/多日"层级的聚合，并定义后端落库与 API 契约。
>
> 与 v1.68 局间难度弧线（`RUN_OVER_RUN_DIFFICULTY.md`、`REALTIME_STRATEGY.md`）
> 是**双向耦合**：本文产生的 `sessionEvalRecord.arcContext` 用来验证 RoR 是否真
> 起到了减压/续航效果；RoR 系统的 `_dailyRunState` 透传给 ledger，作为局间聚
> 合的分桶维度。

## 1. 四层指标全景

```
move    →  moveQuality          每步 1 条       PLACEMENT_QUALITY.md
round   →  roundQuality         每轮 1 条       PLACEMENT_QUALITY.md
session →  sessionEvalRecord    每局 1 条       本文 §2
runs    →  runToRunReport       离线 / dashboard  本文 §3
```

## 2. sessionEvalRecord 完整 schema

由 `web/src/evaluation/sessionEvaluator.js#buildSessionEvalRecord(ledger)` 在
`endGame()` 时生成，**纯函数**。

```jsonc
{
  "schemaVersion": 1,
  "meta": {
    "runId": "session_id 或 client uuid",
    "userId": "...",
    "modelVersion": "v3.0.8 / rule",
    "spawnPolicyMode": "model-v3 / rule",
    "configHash": "game_rules.json 的内容哈希（可选）",
    "strategy": "easy/normal/hard",
    "startedAt": 1700000000000,
    "endedAt":   1700000300000
  },

  "outcome": {
    "finalScore": 8421,
    "survivedSteps": 152,
    "placedCount": 152,
    "linesCleared": 38,
    "multiClears": 6,
    "perfectClears": 1,
    "maxCombo": 4,
    "runDurationMs": 300000,
    "endCause": "normal | jam | level_clear | level_fail"
  },

  "trajectory": {
    "boardStressAUC": 0.62,            // stress(t) 梯形积分均值（norm 域 [0,1]）
    "stressVariance": 0.05,
    "peakStress": 0.91,
    "peakStressDwellRatio": 0.18,      // [peak−0.05, peak] 停留占比
    "stressQuartiles": { "q25": 0.41, "q50": 0.58, "q75": 0.75 },
    "meanHoles": 1.8,
    "holesSlope": 0.02,                // 线性回归斜率（每采样点 +0.02 holes）
    "meanFlatness": 0.74,
    "freedomMin": 1,
    "freedomDwell": 0.07               // firstMoveFreedom ≤ 1 的占比
  },

  "spawnAudit": {
    "intentDistribution":   { "relief": 4, "engage": 6, "harvest": 3, "pressure": 2, "flow": 8 },
    "intentRealizationRate":{ "relief": 0.75, "pressure": 0.50, ... },
    "guaranteeBreachRate":   0.04,     // spawnHints 承诺至少 N 行清，玩家实际不达
    "solutionRangeHitRate":  0.78,     // solutionMetrics 是否落在 targetSolutionRange
    "dockUsageEntropy":      2.41,     // 玩家排列多样性的 shannon 熵
    "payoffRealizationRate": 0.62,
    "softFilterRejectRate":  0.15,
    "softFilterResamplesMean": 1.4,
    "spawnCount": 23
  },

  "cross": {
    "regretPerStep": 0.12,
    "optimalityPerStep": 0.83,
    "roundClassificationDist": { "optimal": 12, "payoff_missed": 5, "forced_bad": 2, ... },
    "forcedBadRatio": 0.09,
    "salvageRatio":   0.05,
    "optimalRoundRatio": 0.55,
    "badnessTagDist": { "fine": 80, "wasted_payoff": 12, "created_hole": 3, ... }
  },

  "guard": {
    "rageQuitFlag":       false,       // runDurationMs<30s ∧ finalScore<0.3·PB
    "topOutBeforeFlow":   false,       // jam 结束 ∧ 平均 stress<0.3
    "flowStarvationFlag": false,       // flowState='flow' 占比 < 0.15
    "flowRatio":          0.43
  },

  "arcContext": {
    "dailyRunIndex": 3,
    "runOverRunArc": "fatigue",        // 见 v1.68 RUN_OVER_RUN_DIFFICULTY.md
    "runOverRunArcReason": "loss_streak",
    "runStreak": 2,
    "pbBefore": 9200,
    "pbAfter":  9200,
    "lifecycleStage": "growth",
    "maturityBand": "M2"
  }
}
```

### 2.1 持久化

`POST /api/evaluation/session` 把 record 落到 `evaluation_session` 表。冗余出
14 个 SQL 直查列：`final_score`、`survived_steps`、`run_duration_ms`、`end_cause`、
`board_stress_auc`、`peak_stress`、`regret_per_step`、`forced_bad_ratio`、
`salvage_ratio`、`guarantee_breach_rate`、`payoff_realization_rate`、
`rage_quit_flag`、`flow_starvation_flag`、`daily_run_index`、`run_over_run_arc`。

完整 record 落 `payload TEXT` 列；查询走 `GET /api/evaluation/sessions`。

### 2.2 离线降级

`fetch()` 失败时把最近一条 record 暂存到 `localStorage` key
`openblock_pending_eval_v1`（仅保留最近一条以保护 quota）。后续 sync 流（v1.70
计划）在新一局开始且服务可达时补传。

## 3. runToRunReport：局间聚合

由 `web/src/evaluation/runToRunEvaluator.js` 提供三个函数；输入是一组按
`startedAt` 升序的 `sessionEvalRecord`。

### 3.1 buildIntraDayReport（短窗 · 同日）

| 字段 | 说明 |
|------|------|
| `dailyRunCount` | 当日开局次数 |
| `arcCoverage` | 当日命中的 arc 集合 |
| `arcDistribution` | arc → 局数 |
| `intraDayScoreSlope` | 当日得分线性斜率 |
| `intraDayRegretSlope` | 当日 regretPerStep 斜率（应 < 0 表示玩家在学习） |
| `meanForcedBadRatio` / `meanSalvageRatio` | 算法责任 vs 玩家救场比例 |
| `arcCapAdherence` | 实际 peakStress 是否落在该 arc 期望 cap 内 |
| `breakAfterCooldownRate` | cooldown 后是否成功回到 opener/momentum |
| `rageRestartCatch` | `{ within60s, within5s, widenedRatio }`，验证 v1.68 把 5s → 60s 是否扩大覆盖 |

### 3.2 buildMultiDayReport（中窗 · 多日）

| 字段 | 说明 |
|------|------|
| `dailyMeanRegret/Score/FlowMinutes` | 每日 1 个聚合点 |
| `regretSlope` / `scoreSlope` | 多日斜率，识别"算法回归"或"玩家成长" |
| `pbProgression` | `{ start, end, delta, growthRate }` |
| `frustrationStreakDays` | 连续 N 天 flowMinutes 不足（< 3 min） |

### 3.3 compareModelVersions（A/B 与灰度自动回滚）

```js
const r = compareModelVersions(prodSessions, canarySessions, {
    thresholds: { regretDeltaMax: 0.05, forcedBadDeltaMax: 0.05, guaranteeBreachDeltaMax: 0.05 }
});
if (r.trigger.rollbackRecommended) { alert(r.trigger.reasons); }
```

任一关键 KPI 显著恶化即建议回滚。集成进 dashboard 定时任务可实现"无人值守
灰度门"。

## 4. 后端 API

| 路由 | 方法 | 用途 |
|------|------|------|
| `/api/evaluation/session`     | POST | 单局上报 |
| `/api/evaluation/sessions`    | GET  | 按 user/model/arc/时间窗口查询 |
| `/api/evaluation/ror_audit`   | GET  | RoR arc 健康聚合（dashboard 用） |

## 5. 与 v1.68 RoR 系统的耦合（验证矩阵）

| RoR 设计承诺 | 用什么 KPI 验证 |
|--------------|-----------------|
| cooldown 让赌气重开转为正常节奏 | `breakAfterCooldownRate` 应 ≥ 0.6 |
| 把 rageRestartMs 从 5s 扩到 60s 后捕获率提升 | `rageRestartCatch.widenedRatio` 应 ≥ 2.0 |
| opener arc 降低开局压力 | `evaluation_session.peak_stress WHERE arc='opener'` 均值应 ≤ 同 user 全局均值 |
| fatigue arc 降低难度避免连败 | `evaluation_session.forced_bad_ratio WHERE arc='fatigue'` 应低于 `momentum` 同 user 均值 |
| 新模型整体不退化 | `compareModelVersions(prev, new).trigger.rollbackRecommended === false` |

## 6. 配置入口

```jsonc
// shared/game_rules.json
"sessionEvaluation": {
  "enabled": true,
  "guard": {
    "rageQuitDurationMs":     30000,
    "rageQuitScoreRatio":     0.3,
    "topOutMeanStressMax":    0.3,
    "flowStarvationRatioMin": 0.15
  }
}
```

## 7. 测试

`tests/evaluation/sessionEvaluator.test.js` & `runToRunEvaluator.test.js`
覆盖：空 ledger schema、intent 兑现分桶、rageQuit 判定、forcedBadRatio、
arcContext 透传、stressAUC、daily 报告、cooldown 恢复率、60s vs 5s 窗口对比、
PB 推进、A/B 自动回滚。

运行：`npx vitest run tests/evaluation/`（全部 31 例：placement 6 + round 4 +
session 6 + RoR 5 + advisor 7 + host 3）。

## 8. 部署 / 灰度

### 8.1 端侧覆盖阶段表（v1.69.x 多端落地）

| 端 | 阶段 | per-place | per-round | session | RoR | 上报通道 |
|----|------|----------|-----------|---------|-----|----------|
| **Web** (`web/src/game.js`) | ✅ Phase 1 完成 | ✅ | ✅ | ✅ | ✅ | `fetch /api/evaluation/session` |
| **小程序** (`miniprogram/utils/gameController.js`) | ✅ Phase 1 完成 | ✅ | ✅ | ✅ | ✅ | `wx.request /api/evaluation/session` |
| **Cocos** (`cocos/.../GameController.ts`) | ⚠️ Phase 1 局部 | ❌（需 model.placeAt 重构暴露 boardBefore） | ❌ | ✅ | ✅ | `globalThis.fetch` |
| **RL 训练** (`rl_pytorch/spawn_model/`) | ✅ Phase 1 完成 | OUTCOME_DIM 7→15 | reward/weight 融合 | — | — | 离线从 `ps.evalMetrics` / `ps.evalRound` 聚合 |

> **Cocos per-place 跳过原因**：Cocos `GameModel.placeAt()` 同步触发 `place` 事件，
> evaluation 需要的"放置前盘面"必须在事件发出**之前**抓取；目前 controller 接入
> 链路（`onTouchEnd → _executeDeferredPlace → model.placeAt → event`）跨越 4 层，
> 暴露 boardBefore 需要 model 层 API 改造。规划在 Phase 2 完成。
> Cocos 端仍能产出 `sessionEvalRecord`，但 `moveQualities[]` / `roundQualities[]`
> 为空，`cross.usagePerm*` 等指标会缺失（在 `runToRunReport` 中按存在性过滤）。

### 8.2 跨端共用 host（避免三端重写）

evaluation 钩子的实际实现集中在 `web/src/evaluation/evaluationHost.js`，通过
`sync-core.sh` + `sync-cocos-engine.mjs` 自动产出 `miniprogram/core/evaluation/`
（CJS）与 `cocos/assets/scripts/engine/evaluation/`（ESM）两份副本。各端 controller
仅需实现 host 契约（getter 列表 + `postSessionEvalRecord`），避免三端散落 try/catch
与字段路径漂移。

### 8.3 灰度路线

| 阶段 | 动作 | 守门 |
|------|------|------|
| Phase 1 | Web/小程序/Cocos 全端 hook 上线，落库观察 1 周 | 主玩法无回归 |
| Phase 2 | 接入 dashboard `ror_audit` 卡片 + Cocos per-place 解锁 | arcCapAdherence ≥ 0.85 |
| Phase 3 | RL `--reward-blend 0.3` 灰度训练，对比 v3.0.x baseline | A/B 不退化 |
| Phase 4 | `--reward-blend 1.0` 全量切换，旧 7 维 outcome 通道废弃 | 训练曲线收敛 |

当前阶段：**Phase 1 已完成**（Web + 小程序全套 / Cocos spawn+gameOver / RL outcome 15）。

## 9. RL outcome 契约（v1.69 扩展）

### 9.1 维度定义

`rl_pytorch/spawn_model/dataset.py#OUTCOME_DIM = 15`：

| 下标 | 字段 | 来源 | 说明 |
|------|------|------|------|
| 0..6 | 旧字段（与 v1.63 完全兼容） | `_compute_spawn_outcome` 离线算 | linesSum/scoreDelta/fillDelta/holesDelta/placed/maxSingle/perfect |
| 7 | meanMoveRegret | `ps.evalMetrics.regret` 三步均值 | 本轮玩家的平均 regret（0=最优，1=最坏） |
| 8 | meanMoveOptimality | `ps.evalMetrics.optimality` 三步均值 | 本轮玩家平均最优度 |
| 9 | forcedBadFlag | `ps.evalRound.classification == 'forced_bad'` | 算法责任：本轮无好放法 |
| 10 | salvageFlag | `ps.evalRound.classification == 'salvage'` | 玩家责任：不利场景救场 |
| 11 | roundAbsScore | `ps.evalRound.absScore` | 客观放法质量 |
| 12 | roundOrderRegret | `ps.evalRound.regrets.order` | 顺序选择后悔 |
| 13 | roundPathRegret | `ps.evalRound.regrets.path` | 路径选择后悔 |
| 14 | roundPayoffRegret | `ps.evalRound.regrets.payoff` | 兑现后悔 |

### 9.2 端侧注入

Game 在 `_pushPlaceToSequence` / `_pushSpawnToSequence` 中把端侧已算好的步级 /
轮级评估塞进 `ps.evalMetrics` / `ps.evalRound`，随 `move_sequences` 一并入库。
**Python 离线直接读取，不做重算**——避免规则漂移（端侧 placementQuality 的
contact/tidiness/holeSafety/payoff/unlocking 权重升级后，dataset.py 不需要同步改动）。

### 9.3 reward / weight 改造

`_pb_reward`（reward shaping）：
```
+0.10 · roundAbsScore           （客观放法质量）
−0.20 · totalRoundRegret        （三类 regret 加权后的总后悔）
+0.05 · salvageFlag             （不利场景救场，正向激励）
−0.10 · forcedBadFlag           （算法责任先降 reward，再由 weight 降权）
```

`_outcome_weight_factor`（样本加权 ∈ [0.4, 2.0]）：
- salvage 样本 ×1.25（高质量正样本）
- forced_bad 样本 ×0.60（算法责任降权）
- 高 meanMoveRegret 线性扣 0.35（玩家失误降权）

### 9.4 训练消费

`train_v3.py --reward-blend 0.0..1.0`（默认 0，向后兼容）：
```python
reward_norm = clamp(1 + 0.5·reward, 0.4, 2.0)
weights = (1 - α)·weights + α·reward_norm
```
Phase 3 灰度 α=0.3，Phase 4 切到 α=1.0。

### 9.5 schema 版本

`shared/game_rules.json` → `evaluationRuntime.rlOutcomeSchema.version = "v1.69.0"`。
Bump 规则：OUTCOME_DIM 或字段顺序改动 → patch +1；语义破坏性改动 → minor +1。
