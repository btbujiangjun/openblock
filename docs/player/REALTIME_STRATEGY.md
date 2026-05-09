# 实时策略系统：信号流与出块链路

> **版本**：2.1 · **更新**：2026-05-10  
> **读者**：产品、算法、策划复盘、策略合理性评审；与 **[策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md)**（通用模型与风险缓解）互为补充——本文是**可操作的指标与管线手册**，策略体验栈是**架构与一致性原则**。

---

## 文档目的与阅读路径

| 目标 | 建议阅读章节 |
|------|----------------|
| 搞清「这个数是什么意思」 | §2 指标字典（L1）、§3.2 压力指标体系、§3.3 `spawnTargets`、§3.4 `spawnHints` |
| 搞清「系统何时加压/减压、为何出这块」 | §3.1 stress 管线、§3.6 信号→下游作用机制、§4 L3 与几何、§5 策略卡 |
| 搞清「压力表头像/标签/叙事是怎么生成的」 | §5.5 压力表状态体系（6 档 + 救济变体 + 趋势 + 故事线决策树 + 截图复现） |
| 评审策略合理性 / 排查叙事冲突 | §3.7 互斥与互抑、§3.8 反向工程、§5.5.4 故事线决策树、§6 合理性评估清单 |
| 做版本对比或回放分析 | §3.2.4 派生痕迹、§5.5.6 旧回放兜底、§7 数据流与时序、§8 配置与扩展 |
| 查默认参数 | §8 配置速查（以 `shared/game_rules.json` 为准） |

**核心文件**：`web/src/playerProfile.js`、`web/src/adaptiveSpawn.js`、`web/src/bot/blockSpawn.js`、`web/src/strategyAdvisor.js`、`web/src/stressMeter.js`、`web/src/playerInsightPanel.js`、`web/src/game.js`、`shared/game_rules.json`。

---

## 1. 系统总览：从感知到呈现

实时策略不是单条公式，而是**五条链路**在同一局内并行、在关键帧对齐：

```
行为/盘面  →  L1 画像指标
                ↓
分数/会话/拓扑  →  L2 resolveAdaptiveStrategy → stress + spawnHints + spawnIntent + shapeWeights
                ↓
L2 + grid      →  L3 generateDockShapes → dock 三连块 + spawnDiagnostics
                ↓
L2 快照 + L1 + 当前盘面  →  L4a StrategyAdvisor → 1~3 条策略卡
L2 快照 + 历史 stress   →  L4b stressMeter → 档位 + 趋势 + 一句话叙事
                ↓
回放 / 曲线     →  moveSequence / 面板 sparkline（可选对照）
```

与早期「三层」叙述的对应关系：**PlayerProfile**（L1）、**AdaptiveSpawn**（L2）、**StrategyAdvisor**（L4a）；**出块**（L3）与**压力表**（L4b）在旧图中常被合并进「决策/呈现」，此处单独标出以便做**可兑现性**评审（L2 承诺 vs L3 结果 vs L4 文案）。

---

## 2. 指标字典（L1：PlayerProfile）

下列指标均在**滑动窗口**内统计（窗口大小默认见 `game_rules.json → adaptiveSpawn.profileWindow`，常与 `PlayerProfile` 内 `_window` 一致）。**物理含义**指：在休闲方块语境下，该量增大/减小通常对应何种玩家状态。

### 2.1 数据采集事件

| 事件 | 写入内容 | 入口方法 | 评审注意 |
|------|----------|----------|----------|
| 出块刷新 | 时间戳；开启闭环反馈窗口 | `recordSpawn()` | 与 `spawnCounter`、节奏相位同步 |
| 放置成功 | thinkMs、是否消行、lines、放置后 fill | `recordPlace()` | fill 为**消行后**占用率，诊断与顾问依赖此口径 |
| 放置失败 | thinkMs | `recordMiss()` | 推高 miss 与挫败相关信号 |
| 新局 | 局内计数重置 | `recordNewGame()` | 冷启动占位见 `metrics.samples` |

**AFK**：单次 `thinkMs` 超过 `adaptiveSpawn.afk.thresholdMs`（默认 15000ms）的放置不计入「活跃」子集，避免挂机污染 `clearRate`/思考时间均值。

### 2.2 `metrics`（窗口聚合）

| 字段 | 定义要点 | 取值与占位 | 物理含义（策略上） |
|------|----------|------------|---------------------|
| **thinkMs** | 活跃放置步的平均思考间隔 | 无样本时占位 3000 | 偏低可能偏「随手」或熟练；偏高可能犹豫或困难局面 |
| **clearRate** | 活跃放置中「本步产生消行」的比例 | 无样本时占位 0.3 | 越高越能持续解压；低则易触发挫败链 |
| **comboRate** | 在「有消行」的步中，lines≥2 的比例 | 无清除时可退化为 0 | 多消/连击倾向，影响 playstyle 与顾问 |
| **missRate** | 窗口内 miss / 总事件 | 无样本时占位 0.1 | 操作失误压力，进心流判定 |
| **afkCount** | 被判定 AFK 的放置次数 | — | 参与 engage 路径等 |
| **samples / activeSamples** | 原始条数 / 非 AFK 放置条数 | `samples===0` 为冷启动 | **UI 应隐藏占位数字**，避免「未下棋已有 30% 消行率」的违和 |

### 2.3 能力合成：`skillLevel` 与 `_computeRawSkill`

**rawSkill**（内部 `_computeRawSkill`）为五维加权和（系数固定于代码）：

- **thinkScore**：由 `thinkMs` 映射到 0~1（越快越高，有上下限饱和）。
- **clearScore**：`clearRate` 相对约 0.55 饱和。
- **comboScore**：`comboRate` 相对约 0.45 饱和。
- **missScore**：miss 越高分越低。
- **loadScore**：`1 - cognitiveLoad`。

再对 `_smoothSkill` 做 EMA：前 `fastConvergenceWindow` 步用更大 `fastConvergenceAlpha`，之后用 `smoothingFactor`。

**skillLevel（对外）**：在 `_smoothSkill` 与 **historicalSkill** 之间按「本局步数 / 半窗口」与 **confidence** 混合；无历史时退化为 smooth。**物理含义**：系统估计的「当前操作质量与稳定性」，用于技能加压/减压门控与部分顾问（如「规划堆叠」需高 skill）。

### 2.4 动量、负荷、参与度

| 指标 | 定义要点 | 物理含义 |
|------|----------|----------|
| **momentum** | 窗口**前后两半**活跃放置的 **clearRate 差 / 0.3**，再乘样本置信度与伯努利噪声衰减；样本不足为 0 | **纯消行动力变化**，不用分数，避免「分数涨=动量高」伪相关 |
| **cognitiveLoad** | 活跃步 `thinkMs` 的方差 / `thinkTimeVarianceHigh`；&lt;3 步返回占位 0.3 | 决策犹豫度；高则易与焦虑、简化决策卡联动 |
| **engagementAPM** | 窗口内操作次数 / 时间（分钟） | 参与度冷热 |

### 2.5 心流与节奏

| 信号 | 定义要点 | 物理含义 |
|------|----------|----------|
| **flowDeviation** | \(F(t)=\lvert \mathrm{boardPressure}/\max(\mathrm{skillLevel},0.05)-1\rvert\)，boardPressure 由均 fill、clear 不足、认知负荷加权 | 挑战与技能「错位」程度；小则更接近心流带 |
| **flowState** | `bored` / `flow` / `anxious`：先复合挣扎早退，再 F(t) 与阈值链 | **bored** → 系统倾向加压/新鲜感；**anxious** → 减压与稳节奏 |
| **pacingPhase** | `spawnCounter mod cycleLength` 落在紧张段或释放段 | 与 `pacingAdjust`、rhythm 叙事联动 |

### 2.6 挫败、恢复、差一点

| 信号 | 定义 | 物理含义 |
|------|------|----------|
| **frustrationLevel** | 连续「未消行」的放置步数 | 超阈值触发强救济（见配置 `engagement.frustrationThreshold`） |
| **needsRecovery** | 若某步放置后 `boardFill > recoveryFillThreshold`（默认 0.82），置计数器为 `recoveryDuration`（默认 4），每步递减 | **刚经历过极满盘**后的短期「急救态」 |
| **hadRecentNearMiss** | 上一步：非 miss、未消行、且上一步前 fill&gt;0.6 | 典型「差一点」；配合 nearMiss 减压与清行保证 |

### 2.7 闭环反馈 `feedbackBias`

每次 `recordSpawn()`：`bias *= decay`，并设 `feedbackStepsLeft = horizon`。随后每步 `recordPlace` 递减；归零时用「窗口内累计消除条数 − expected」× `alpha` 更新 `bias`，再 clamp 到 `±biasClamp`。

**物理含义**：**上一轮出块后几步内，玩家是否兑现了系统隐含的预期消行**；正 → 可略加压，负 → 略减压。**注意**：默认以 `game_rules.json` 为准（当前常见为 `horizon: 3`, `alpha: 0.055`, `decay: 0.93`, `biasClamp: 0.22`），与早期文档中的 4 步/0.02 可能不同。

### 2.8 会话与长期

| 信号 | 含义 |
|------|------|
| **sessionPhase** | `early` / `peak` / `late`：时间 + 出块轮次启发式 |
| **trend**、**confidence**、**historicalSkill** | 来自会话历史环与后端统计注入，影响 skillLevel 混合与 `trendAdjust` |
| **playstyle** | `perfect_hunter` / `multi_clear` / `combo` / `survival` / `balanced`，影响 `spawnHints` 末端微调 |

---

## 3. L2：自适应出块（AdaptiveSpawn）

### 3.1 从输入到 `stress` 的管道（物理顺序）

1. **合并实时几何**：`nearFullLines`、`multiClearCandidates` 可用当前 `grid` + dock 形状池重算（`_mergeLiveGeometrySignals`），减轻 ctx 滞后。  
2. **静态拓扑救济**：`holeReliefAdjust`、`boardRiskReliefAdjust`、`abilityRiskAdjust`、`friendlyBoardRelief` 由 `holes`/`boardRisk`/能力向量/几何机会推导。  
3. **动态被困救济（v1.30）**：`bottleneckRelief` 由 `bottleneckTrough`（上一周期 firstMoveFreedom 最低点） + 阈值得到；与 `friendlyBoardRelief`、`recoveryAdjust`/`frustrationRelief`、`isInOnboarding` 互抑。  
4. **分项求和**：除 **boardRisk / bottleneckTrough / bottleneckSamples** 外所有 `stressBreakdown` 分量相加（各分量可乘 `signals.*.scale`）。  
5. **新手 stress 上限**（`isInOnboarding`）。  
6. **challengeBoost**（逼近历史最佳分等）；若 **friendlyBoardRelief** 显著为负，则对 boost **额外削弱**（v1.29 互抑）。  
7. **clamp** 到约 `[-0.2, 1]`。  
8. **occupancyDamping**：对正向 stress 按占用**锚点**缩放（低占用减弱「假高压」）；锚点跨 spawn 缓降（v1.29）。  
9. **smoothStress**：升压有步幅上限；救济/近失/挫败等可 **immediateRelief** 短路。  
10. **minStress**（难度档 tuning，如 Hard）。  
11. **flowPayoffCap**（心流+兑现且无洞等条件下软封顶）。  
12. **finalStress** → 写入 `spawnTargets` 与 profile 插值。

评审时建议：对照 **`stressBreakdown` 与 `spawnIntent`** 是否同向；异常时优先查 **几何合并**、**bottleneckTrough/Samples**（v1.30）与 **occupancy 锚点** 是否造成与直觉相反的 stress。

### 3.2 压力指标体系（Stress Indicators）

> **总览**：综合压力 \(\text{stress}\in[-0.2, 1]\) 由 **19 条**设计型独立信号经求和、覆写、平滑与封顶得到（v1.30 起新增 `bottleneckRelief`）。`stressBreakdown` 在 `web/src/adaptiveSpawn.js` 写入；面板叙事标签见 `web/src/stressMeter.js → SIGNAL_LABELS`。  
> **符号约定**：**正值 → 加压（更挑战）**，**负值 → 减压（更友好）**；个别字段（`occupancyDamping`/`flowPayoffCap`/`bottleneckTrough`/`bottleneckSamples`/`*Trace`）是**派生痕迹**，不是独立设计分量。  
> **关闭/缩放**：每一个信号都可在 `game_rules.json → adaptiveSpawn.signals.<key>` 关闭或乘 `scale`，便于 A/B、回放校准。

#### 3.2.1 加压类信号（推 stress ↑）

| 键 | 来源 | 触发条件 | 量级（默认）| 物理含义 |
|----|------|----------|--------------|----------|
| `scoreStress` | `getSpawnStressFromScore(score, {bestScore})` | `dynamicDifficulty.enabled` | 约 `[0, 0.78]`（按 `milestones/spawnStress` 分段或个人百分位插值） | **绝对/相对分数**带来的基线紧张：超过历史最佳时进入末档 |
| `runStreakStress` | `runDifficulty.spawnStressBonusPerGame × min(streak, maxStreak)` | 连战 ≥1 | 约 `[0, 0.27]`（默认 0.045/局，封 6 局） | **连战疲劳**：跨局保留少量上扬 |
| `difficultyBias` | `difficultyTuning[strategy].stressBias` | 始终 | `easy=-0.22 / normal=0 / hard=+0.22` | 玩家显式选择的**全局基线偏移** |
| `skillAdjust` | `(skill - 0.5) × skillAdjustScale × (0.4 + 0.6·conf)` | 始终 | 约 `[-0.15, +0.15]`（默认 scale=0.3） | **高手加压、新手减压**；置信度门控防误判 |
| `flowAdjust(bored)` | `flowBoredAdjust × min(2, 1+flowDev)` | `flowState='bored'` | 约 `[+0.08, +0.16]` | 进入「无聊」时主动制造挑战 |
| `pacingAdjust(tension)` | `pacing.tensionBonus` | `pacingPhase='tension'` | `+0.04` | 节奏副歌期**轻**加压 |
| `comboAdjust` | `flowZone.comboRewardAdjust` | `recentComboStreak ≥ 2` | `+0.05` | 连击中**正反馈**少量加压 |
| `challengeBoost`（覆写式） | `min(0.15, (score/bestScore − 0.8) × 0.75)` | `score ≥ 0.8·bestScore ∧ stress<0.7 ∧ (segment5='B' ∨ trend≠declining)` | `[0, +0.15]`；`friendlyBoardRelief < -0.09` 时 ×0.42（v1.29 互抑） | **冲新高仪式感**：B 类挑战档自动加压 |

#### 3.2.2 减压/救济类信号（推 stress ↓）

| 键 | 来源 | 触发条件 | 量级（默认）| 物理含义 |
|----|------|----------|--------------|----------|
| `flowAdjust(anxious)` | `flowAnxiousAdjust × min(2, 1+flowDev)` | `flowState='anxious'` | 约 `[-0.24, -0.12]` | 焦虑时主动减压并稳节奏 |
| `pacingAdjust(release)` | `pacing.releaseBonus` | `pacingPhase='release'` | `-0.12` | 节奏间奏期，**呼吸窗口** |
| `recoveryAdjust` | `flowZone.recoveryAdjust` | `needsRecovery=true` | `-0.20` | 极满盘 → 短窗口大幅减压 |
| `frustrationRelief` | `engagement.frustrationRelief` | `frustrationLevel ≥ engagement.frustrationThreshold` | `-0.18` | 连续未消 → 强减压 + 友好出块 |
| `nearMissAdjust` | `engagement.nearMissStressBonus` | `hadRecentNearMiss=true` | `-0.10` | 「差一点」效应：续玩动力最强 |
| `holeReliefAdjust` | `topologyDifficulty.holeReliefStress × holePressure` | 始终（按比例） | `[-0.16, 0]` | 不可修复空洞越多越救济 |
| `boardRiskReliefAdjust` | `topologyDifficulty.boardRiskReliefStress × boardRisk` | 始终（按比例） | `[-0.10, 0]`（boardRisk = 0.45·fill+0.35·holes+0.20·abilityRisk） | **综合盘面风险**护栏 |
| `abilityRiskAdjust` | `playerAbilityModel.adaptiveSpawnRiskAdjust` | `conf ≥ 0.25 ∧ riskLevel ≥ 0.62` | 约 `[-0.08, 0]` | **能力向量**评估的失败风险护栏 |
| `sessionArcAdjust(warmup)` | 硬编码 | 局内出块 ≤3 轮 | `-0.08` | 局初少量减压、找感觉 |
| `sessionArcAdjust(cooldown)` | 硬编码 | `sessionPhase='late' ∧ momentum<-0.2` | `-0.05` | 收官段动量下滑时少量减压 |
| `friendlyBoardRelief` | `friendlyBoard.{base,maxRelief}` 按机会强度插值 | `holes=0 ∧ nearFull≥2 ∧ (mcc≥2 ∨ pcSetup≥1) ∧ rhythmPhase='payoff'` | `[-0.18, -0.12]` | **盘面通透 + 兑现窗口**：让叙事与玩家直觉同向（避免「🥵 + 享受多消」） |
| `bottleneckRelief` （v1.30） | `topologyDifficulty.bottleneckReliefMax × min(1, 0.4 + 0.6·sev)`，`sev = (阈值 − trough) / 阈值` | `bottleneckTrough ≤ topologyDifficulty.bottleneckTroughThreshold ∧ bottleneckSamples > 0 ∧ ¬isInOnboarding`（默认阈值 2，幅度 -0.12） | `[-0.12, -0.048]`（`friendlyBoardRelief` 同时显著或挫败/恢复触发时 ×0.5） | **跨 dock 周期的 firstMoveFreedom 低谷救济**：上一波三块在玩家手中曾跌到候选块「最少落子数 ≤ 2」；该信号是 holes/friendly 等静态拓扑信号无法捕捉的**动态被困**信号 |

#### 3.2.3 中性 / 慢变量 / 上下文信号

| 键 | 来源 | 量级 | 物理含义 |
|----|------|------|----------|
| `feedbackBias` | `profile.feedbackBias` | `±feedback.biasClamp`（默认 ±0.22） | **闭环反馈**：上一拍出块后 N 步实际消行 vs 预期 |
| `trendAdjust` | `profile.trend × trendAdjustScale × conf` | 约 `[-0.08, +0.08]` | 长周期趋势（多局 EWMA 回归） |
| `delightStressAdjust` | `delight.boredSkillStressBoost`（+）/ `delight.anxiousReliefStress`（−） | 约 `[-0.08, +0.07]` | **爽感兑现层**：高手无聊微加压、焦虑微减压 |
| `boardRisk`（不参与求和） | `0.45·fillRisk + 0.35·holePressure + 0.20·abilityRisk` | `[0, 1]` | 综合盘面风险，**仅作分支条件**与衍生救济 |

#### 3.2.4 派生痕迹与覆写（Pipeline Trace）

下列键由 `stressBreakdown` 写出，便于回放/排障，**不是设计型贡献分量**：

| 键 | 含义 |
|----|------|
| `rawStress` | 19 项（含 boardRisk 不计）求和后的原始值 |
| `beforeClamp` | 经新手覆写、challengeBoost 后的值 |
| `afterClamp` | clamp 到 `[-0.2, 1]` 后的值 |
| `occupancyDamping` | `stress × occupancyScale − stress`，仅在 `stress > 0` 且 `anchor < 0.5` 时为负；锚点跨 spawn 缓降，避免「消行后裸 fill 骤降→damping 撤除→stress 跳升」锯齿 |
| `afterOccupancy` | 占用衰减后的 stress |
| `afterSmoothing` | `smoothStress(prev, current)`：升压有 `maxStepUp/maxStepDown` 步幅；救济/近失/挫败/高 boardRisk 触发 `immediateRelief` 短路 |
| `flowPayoffCap` | 满足心流+payoff+无洞+低风险时硬封顶 `0.79` |
| `bottleneckTrough` (v1.30) | 上一周期 `firstMoveFreedom` 的最低值；触发时为该值，否则 `null`；与 `bottleneckSamples > 0` 一起作为 `bottleneckRelief` 的触发证据 |
| `bottleneckSamples` (v1.30) | 上一周期跨 placement 的 trough 采样次数（`game._updateBottleneckTrough` 计数）；为 0 表示"无观测"，`bottleneckRelief=0` |
| `finalStress` | 最终 stress，对外即此值 |

#### 3.2.5 信号分组（评审视角）

| 分组 | 含义 | 包含键 |
|------|------|--------|
| **基线分量** | 跨局慢变量与玩家选择 | scoreStress / runStreakStress / difficultyBias / trendAdjust |
| **能力分量** | 玩家**当前**水平推断 | skillAdjust / abilityRiskAdjust / delightStressAdjust |
| **心流分量** | 体验对齐 | flowAdjust / pacingAdjust / sessionArcAdjust |
| **救济分量** | 失败 / 卡死风险护栏 | recoveryAdjust / frustrationRelief / nearMissAdjust / holeReliefAdjust / boardRiskReliefAdjust / friendlyBoardRelief / **bottleneckRelief**（v1.30） |
| **反馈分量** | 上次出块的**回路** | feedbackBias / comboAdjust / challengeBoost |
| **派生痕迹** | 仅排障/回放 | occupancyDamping / flowPayoffCap / *Trace |

> **PlayerDistress**（用于 `spawnIntent='relief'` 派生，**不进 stressBreakdown**）= `recoveryAdjust + frustrationRelief + nearMissAdjust + holeReliefAdjust + boardRiskReliefAdjust + bottleneckRelief`（v1.30 新增末项）；阈值约 `< -0.10`。

---

### 3.3 `spawnTargets`（多轴消费）

由 `deriveSpawnTargets` 将标量 stress 与 profile/ctx 组合投影为 0~1 的六轴，供 **L3** 加权消费（避免难度只等于「形状更怪」）：

| 轴 | 策略含义（评审用语） |
|----|----------------------|
| shapeComplexity | 形状「难摆」程度诉求 |
| solutionSpacePressure | 解空间松紧 |
| clearOpportunity | 消行/兑现机会诉求 |
| spatialPressure | 堆叠与占位压力；使用 `boardDifficulty = fill + holes 等效压力`，同填充率下 holes 越多越难 |
| payoffIntensity | 爽点/多消强度 |
| novelty | 新鲜感与变化 |

### 3.4 `spawnHints` 主要字段（与出块/顾问的接口）

| 字段 | 含义（物理） |
|------|----------------|
| clearGuarantee | 期望「能立即参与消行」的 dock 槽位数上限意图（受几何回钳） |
| sizePreference | 偏小或偏大块的抽样倾向 |
| diversityBoost | 形状品类分散度 |
| comboChain / multiClearBonus / multiLineTarget | 连击与多消导向强度 |
| perfectClearBoost / iconBonusTarget | 清屏兑现与同 icon/同色 bonus 兑现概率目标 |
| rhythmPhase | setup / payoff / neutral，与顾问「收获期」等绑定 |
| sessionArc / scoreMilestone | 局弧线与里程碑友好化 |
| targetSolutionRange | 解法数量软过滤档位（高 fill 激活） |
| **orderRigor**（v1.32） | **顺序刚性强度** ∈ [0,1]，0=不约束，1=必须按特定顺序；五重 bypass（onboarding/needsRecovery/hasBottleneckSignal/`holes>3`/`fill<0.5`） |
| **orderMaxValidPerms**（v1.32） | **6 种排列里允许的最大可解数**（1~6），由 `orderRigor` 映射；blockSpawn 在前 ~55% attempt 拒绝 `validPerms > N` 的 triplet |
| spawnIntent | **对外单一意图**：relief / engage / harvest / pressure / flow / maintain |
| spawnTargets | 上表六轴 |

### 3.5 `spawnIntent` 派生顺序（评审检查点）

在 `adaptiveSpawn.js` 末尾按优先级：**relief**（玩家困难/救济模式）→ **engage**（AFK 召回）→ **harvest**（可兑现几何：如近满线或高 fill 下的 pc 窗口）→ **pressure**（挑战加压）→ **flow**（心流/兑现节奏）→ **maintain**。  
**合理性**：叙事与商业化文案应与此字段一致；与 **紧张档位** 的合并叙事见 `stressMeter.js`（harvest/flow 高压守卫）。

---

### 3.6 信号 → 下游：作用机制（Mechanism of Action）

> 一个加压/减压信号产生影响有 **5 条独立路径**，并不只是「让形状更难/更易」。评审时若发现「stress 看起来不对」，按下表逐路径反查。

#### A. `finalStress → 10 档 profile → shapeWeights`

`finalStress` 在 `profiles[].stress` 锚点（`-0.2 ~ 0.85`）间**线性插值** `shapeWeights`，最终影响形状抽样概率。**非线性区段**：

- `< 0`：`onboarding/recovery/comfort` 段，linesWeight 显著抬高（≈3.18→2.65），不规则块降到 0.45 ~ 0.83。
- `0 ~ 0.4`：`comfort → balanced`，逐步加入不规则块，仍以消行友好为主。
- `0.4 ~ 0.65`：`balanced → challenge`，不规则块上行到约 1.3。
- `> 0.65`：`challenge → intense`，T/Z/L/J 反超 lines（≈1.42 vs 1.58~1.85）。

#### B. 信号**直接**进 `spawnHints`（不经 stress）

| 信号触发 | 直接调整的 `spawnHints` | 说明 |
|----------|-------------------------|------|
| `hadRecentNearMiss` | `clearGuarantee ≥ engagement.nearMissClearGuarantee`（默认 ≥2） | 「差一点」后强制至少 2 块能立即兑现 |
| `frustrationLevel ≥ threshold` | `clearGuarantee ≥ 2`、`sizePreference = -0.3` | 强减压 + 偏小块 |
| `needsRecovery` | `clearGuarantee ≥ 2`、`sizePreference = -0.5` | 救援态最大友好化 |
| `flow='bored'` | `diversityBoost ≥ 0.15` | 注入新鲜感 |
| `isInOnboarding` | `clearGuarantee ≥ 2`、`sizePreference = -0.4` | 新手保护 |
| `late + momentum<-0.3` | `sizePreference ≤ -0.2`，`clearGuarantee ≥ 1` | 收官疲劳护栏 |
| `roundsSinceClear ≥ 2 / ≥ 4` | `clearGuarantee 抬到 2 / 3` | 久未消 → 强保消 |
| `holes ≥ holeClearGuaranteeAt` | `clearGuarantee ≥ 2`、`sizePreference ≤ -0.22` | 拓扑救济 |
| **`bottleneckTrough ≤ 阈值`**（v1.30） | `clearGuarantee ≥ topologyDifficulty.bottleneckClearGuaranteeAt`（默认 2）、`sizePreference ≤ topologyDifficulty.bottleneckSizePreferenceDelta`（默认 -0.18） | 上一周期"被困"过 → 下一波偏小块 + 强保消，重建机动性 |
| `comboChain > 0.5` | `clearGuarantee ≥ 2` | 连击保护续链空位 |
| `pcSetup ≥ 1` / `nearFullLines ≥ 3` | `clearGuarantee ≥ 2`，`multiLineTarget ≥ 1~2`，`multiClearBonus ≥ 0.6~0.75`，`rhythmPhase='payoff'` | **几何兑现窗**直接驱动多线/payoff |
| `delight.mode='relief' / 'flow_payoff' / 'challenge_payoff'` | 各自加 `clearGuarantee` / `multiLineTarget` / `diversityBoost` | 爽感层独立路径 |
| `playstyle='perfect_hunter' / 'multi_clear' / …` | 末端 `perfectClearBoost / iconBonusTarget / multiClearBonus / multiLineTarget / clearGuarantee / sizePreference` 微调 | 玩法风格对齐 |
| `AbilityVector` 高消行效率 + 高规划 + 低风险，且存在兑现几何 | `perfectClearBoost`、`multiClearBonus`、`iconBonusTarget` 上抬 | 将最新用户行为特征转为清屏、同 icon、多消概率倾向 |
| `warmupRemaining > 0` | `clearGuarantee 上抬到 2~3`、`sizePreference ≤ -0.28`、`multiClearBonus ≥ 0.42` | 跨局热身（v10.33） |
| `afkCount ≥ 1 ∧ stress<0.55` | `clearGuarantee ≥ 2`、`multiClearBonus ≥ 0.6`、`multiLineTarget ≥ 1`、可拉到 `payoff` | **AFK 召回**显式正反馈 |
| **`stress > 0.55 ∧ skill > 0.5 ∧ ¬bypass`**（v1.32） | `orderRigor` ∈ (0,1]，`orderMaxValidPerms` 在 [4,2] 间映射；hard 模式额外 +0.30 boost | **顺序刚性高难度**：要求三连块 6 种排列里仅 ≤N 种可解，强制玩家做"先 X 再 Y 最后 Z"的前瞻规划 |

> **物理可行性回钳**（v1.17 / v1.19）：上述抬高完成后，若盘面**实际**没有 ≥2 临消/多消候选，会把 `clearGuarantee=3` 回钳为 2，`multiClearBonus` 软封顶为 0.4，`multiLineTarget` 归 0；避免承诺无法兑现。

> **奖励概率目标**（v1.33）：`perfectClearBoost` 与 `multiClearBonus` 进入 `blockSpawn.js` 的形状权重；`iconBonusTarget` 进入 `game.js` 的 dock 染色采样，只在近满且同 icon/同色的行列存在时放大对应颜色权重。它们都是概率倾向，不绕过可解性、机动性和几何回钳。

#### C. 信号 → `spawnIntent`（单一对外口径）

`spawnIntent` 派生顺序（高到低优先级）：

```
relief    ← playerDistress < -0.10 ∨ delight.mode='relief'   // v1.30: playerDistress 含 bottleneckRelief
engage    ← AFK 召回触发
harvest   ← nearFullLines ≥ 2 ∨ (pcSetup ≥ 1 ∧ fill ≥ 0.45)
pressure  ← challengeBoost > 0 ∨ (delight.mode='challenge_payoff' ∧ stress ≥ 0.55)
flow      ← delight.mode='flow_payoff' ∨ rhythmPhase='payoff'
maintain  ← 默认
```

**含义**：`spawnIntent` 是**给所有下游（叙事/商业化/回放标签）的统一意图**。一个减压信号通过 `playerDistress` 影响 `intent='relief'` → `stressMeter.story` 切到「主动减压享受多消」；通过 stress 影响 profile → 形状权重；两条路径**同步**才能避免「文案与 dock 矛盾」。  
**v1.30 升级**：`bottleneckRelief`（≤-0.10 单条即可压低 playerDistress 过阈）让"上一波被困但 holes/挫败/恢复都没触发"的隐性死路也能正确派生 `relief`，闭合"实时几何观测 → 显式意图 → 友好出块"的链路。

#### D. 信号 → `spawnTargets` 多轴投影

`deriveSpawnTargets` 把 stress01 = `(stress + 0.2) / 1.2 ∈ [0,1]` 与 profile/ctx 组合，投影到 6 轴：

```
shapeComplexity     = clamp01(stress01·0.75 + boredHighSkill·0.25 − riskRelief·0.45)
solutionSpacePressure = clamp01(stress01·0.70 + complexity·0.25 − boardRisk·0.55 − recoveryNeed·0.35)
clearOpportunity    = clamp01(recoveryNeed·0.55 + payoffOpportunity·0.45 + (release?0.12:0) − stress01·0.18)
boardDifficulty     = clamp01(fill + holePressure·0.80)
spatialPressure     = clamp01(stress01·0.65 + boardDifficulty·0.25 − boardRisk·0.50 − recoveryNeed·0.30)
payoffIntensity     = clamp01(delight·0.45 + payoffOpportunity·0.40 + max(0, momentum)·0.15)
novelty             = clamp01((bored?0.45:0) + stress01·0.25 + rounds/80 − recoveryNeed·0.20)
```

`blockSpawn` 在阶段 2 用这些轴做**乘法权重**，让「难度」可以在「形状难、解空间窄、空间紧、新鲜度高」等多轴间分散，而不是单纯偏 T/Z/L。这里的 `boardDifficulty` 是**难度评估口径**，与 `boardRisk` 的**保活口径**并行：holes 越多会提高空间难度判断，但高 `boardRisk` 仍会通过减压/保消护栏避免继续刁难玩家。

#### E. 信号 → `strategyAdvisor` 与 `stressMeter`

| 通道 | 触发样例 | 表现 |
|------|----------|------|
| 顾问读 `_lastAdaptiveInsight.spawnHints` | `rhythmPhase='payoff' ∧ live 几何不足` | 出「**收获期·待兑现**」诚实文案 |
| 顾问读 `live*` 几何 | `liveMultiClearCands < 2` | 出「**逐条清理**」而非「多消机会」 |
| 顾问读 `liveSolutionMetrics` | `firstMoveFreedom ≤ 2 ∧ fill ≥ 0.4` | 出「**瓶颈块**」 |
| 顾问读 `harvestNow` | `intent='harvest' ∨ rhythm='payoff'` | 抑制「**提升挑战**/**规划堆叠**」与兑现冲突的卡 |
| stressMeter 档位 | `finalStress ∈ [0.65, 0.80)` | 「**紧张** 😰」档 + 进度条 + 趋势箭头 |
| stressMeter 叙事 | `intent='harvest'` 且档位为 tense/intense | 走 **harvest 高压守卫**：「盘面吃紧，但已识别…促清组合帮你逐步降压」 |
| stressMeter 副标 | `intent='relief' ∧ stress ≤ -0.05` | label 切「放松（救济中）」🤗 |

---

### 3.7 互斥与互抑（避免拉锯）

`stressBreakdown` 的项是**线性求和**，相互独立信号在边界场景容易**互相抵消或锯齿**。下列为已实施的稳态机制：

| 机制 | 来源 | 作用 |
|------|------|------|
| `challengeBoost × friendlyBoardRelief` 互抑 | v1.29 | 友好盘面减压显著时把挑战加压乘 0.42，避免「+0.15 vs −0.18」锯齿 |
| `flowPayoffCap = 0.79` | flow + payoff + 无洞 + 低风险 | 软封顶到 tense 档，避免「🥵 + 享受多消」叙事矛盾 |
| `occupancyFillAnchor` 缓降 | v1.29 | 消行后裸 fill 骤降时仍沿用前一锚点，**抗 damping 跳变** |
| `immediateRelief` 短路 smoothing | needsRecovery / frustration / nearMiss / 高 boardRisk | 让减压**即时生效**，加压有步幅上限 |
| `hard.minStress=0.18` | difficultyTuning | Hard 模式即使 stress 低也保持基线挑战，但**不**对救济/onboarding 生效 |
| `clearGuarantee` 物理回钳 | v1.17 | 几何不支持时 cg≥3 → 2，避免空头支票 |
| `multiClearBonus / multiLineTarget` 软封顶 | v1.19 | 几何与 warmup/AFK 不支持时降档 |
| 顾问 `applyTipCategoryDiversity` | v1.29 | top3 全 survival 时按阈值替换最弱一条 |
| harvest/flow 高压档守卫文案 | v1.27 / v1.29 | 档位 ≥ engaged 时改用「专注/降压」语义 |
| `bottleneckRelief × friendlyBoardRelief` 互抑 | v1.30 | `friendlyBoardRelief ≤ -0.10` 时 bottleneckRelief × 0.5，避免双重减压把 stress 越档拉到救济区 |
| `bottleneckRelief × {needsRecovery, frustration}` 互抑 | v1.30 | 已有 recoveryAdjust(-0.20) 或 frustrationRelief(-0.18) 时 bottleneckRelief × 0.5，避免与挫败救济栈叠 |
| `bottleneckRelief` onboarding 关闭 | v1.30 | 新手保护期内 bottleneckRelief = 0；onboarding 自身已强减压，叠加会让 breakdown「双重救济」误读 |
| `score-push 守卫` 抢占 FLOW/HARVEST 高压守卫 | v1.31 | 高 stress + 友好盘面（fill<0.30 ∧ holes=0）时切到「冲分仪式感」叙事，避免对空旷盘面说「保活/确保可落位」 |
| `harvest 密度分级` 替代单一「密集」文案 | v1.31 | `nfl=2`（最低触发档）只是"清晰可见"非"密集"；按 `nfl/mcc` 分 dense/visible/edge 三档使叙事强度匹配几何强度 |
| **`orderRigor × bottleneckRelief` 互斥**（v1.32） | bottleneckRelief 已减压时 `orderRigor=0`、`maxValidPerms=6` | 玩家正在被减压救场，再加"必须按特定顺序"= 双重打击；bypass 优先级最高 |
| **`orderRigor` × `holes>3 / fill<0.5 / onboarding / needsRecovery`**（v1.32） | 任一成立即 `orderRigor=0` | 盘面糟糕、空盘、新手、救场期均不刁难；只在玩家"高压且具承受力"时启用 |
| **`orderRigor` 软过滤窗口期**（v1.32） | 仅 `attempt < ~55%` 时硬过滤；之后接受任意 `validPerms` | 防止 dock 候选稀缺时死循环；fallback 退化为 v9 行为 |

---

### 3.8 反向工程：从 `finalStress` 找主导分量

评审用法：

1. 取 `_lastAdaptiveInsight.stressBreakdown`（面板可见 / 回放可读）。  
2. 排除 `boardRisk` 与派生痕迹。  
3. **`summarizeContributors(breakdown, 5)`**（`stressMeter.js`）：按 |value| 排序前 5 项 + 中文标签 + 正负号；UI 已不再展示，但函数仍可在调试 / 分析脚本中使用。  
4. 比对 `rawStress → afterClamp → afterOccupancy → afterSmoothing → finalStress` 痕迹，定位变化发生在哪一步。  
5. 比对 `spawnIntent`、`rhythmPhase` 是否与主导分量同向（不同向是常见 bug 模式）。

> **反例（截图复现）**：`finalStress=0.77 + intent='harvest' + 头像「紧张」` 看似冲突。  
> 反查：`scoreStress + challengeBoost + skillAdjust` 主导加压；`harvestable=true`（≥2 临消行）使 intent 走 harvest；高压档守卫文案合并叙事 → **三条独立路径方向一致**，是合理设计。

---

## 4. L3：出块与诊断（与策略可兑现性）

本节不重复 `blockSpawn` 全算法，只列**与「策略是否合理」直接相关的约束**。

| 机制 | 作用 |
|------|------|
| 拓扑与多消候选 | Layer1 打分；与 advisor **live** 几何应对齐 |
| clearGuarantee 回钳 | 当几何不足以支持过高保证时降档，避免 UI 空头支票 |
| multiClearBonus / multiLineTarget 几何兜底 | 无几何时软封顶，避免「权重很激进但盘面做不到」 |
| 序贯可解 / 解法区间 | 高 fill 下 DFS/解空间过滤，避免无解三连 |
| spawn 诊断 `spawnDiagnostics` | 出块瞬间快照；顾问优先 **当前 grid** 重算（`liveTopology` 等） |

详细算法见 [出块三层架构](../algorithms/SPAWN_ALGORITHM.md)、[解法数量难度](../algorithms/SPAWN_SOLUTION_DIFFICULTY.md)。

### 4.5 生成式模型行为上下文（V3.1）

当出块模式切到 `model-v3` 时，`web/src/spawnModel.js` 会把实时策略链路整理为 V3.1 的 `behaviorContext(56)`，用于 `POST /api/spawn-model/v3/predict`。该向量不是替代规则轨，而是让生成式模型显式看到规则轨已经计算好的用户行为与策略语义：

| 区段 | 来源 | 作用 |
|------|------|------|
| `0–23` | `PlayerProfile` + 基础 `adaptiveInsight` | 分数、填充、技能、心流、窗口统计、长期能力、stress |
| `24–31` | 样本量 + `analyzeBoardTopology` | 冷启动、`boardDifficulty`、holes、临消/解空间 |
| `32–37` | `AbilityVector` | 控制力、清行效率、盘面规划、风险容忍、风险水平 |
| `38–47` | `spawnTargets` + `spawnHints` | 复杂度、解空间、保消、尺寸、多消、顺序刚性 |
| `48–53` | `spawnIntent` one-hot | relief / engage / harvest / pressure / flow / maintain |
| `54–55` | 额外策略上下文 | `multiLineTarget`、`sessionArc` |

设计要求：规则轨仍负责硬约束和失败回退；生成式模型只学习偏好分布。任何新增行为特征必须同步 `spawnModel.js`、`dataset.py`、`model_v3.py`、`train_v3.py`、`server.py` 与建模文档。

---

## 5. 策略生成（L4a：StrategyAdvisor）

### 5.1 输入契约

- **profile**：`PlayerProfile`（§2 各 getter）。  
- **insight**：上一拍出块时的 `_lastAdaptiveInsight`（含 `spawnHints`、`spawnDiagnostics`、`boardFill` 等快照）。  
- **gridInfo**（由 `playerInsightPanel` 注入）：**当前** `fillRatio`、`holesCount`、`liveTopology`、`liveMultiClearCandidates`、`liveSolutionMetrics` 等。

**关键原则**：描述「盘面上是否还能多消/近满」时，**以 gridInfo 实时值优先**，`insight.spawnDiagnostics` 仅在 live 不可用时回退——否则会出现「策略卡仍写 4 个多消位，面板 pill 已是 0」的评审事故。

### 5.2 生成管线（逻辑顺序）

1. 按代码块**顺序**向数组 `tips` 追加满足条件的卡片（部分规则带 `tips.length < 3` 门控）。  
2. **Onboarding** 时清空并只保留两条新手卡。  
3. 按 **priority** 降序排序。  
4. **applyTipCategoryDiversity**（v1.29）：若 top3 全是 `survival`，在满足阈值时用最弱一条置换为后续中较优的**非 survival**，且不动 **priority ≥ 0.94** 的救急档。  
5. 截取前 **3** 条。

### 5.3 类别与玩家沟通语义

| category | 沟通目标 |
|----------|----------|
| survival | 保命、恢复、卡手 |
| clear | 消行、多消、差一点 |
| build | 堆叠、空洞、长期构型 |
| pace | 节奏、焦虑、疲劳、收获期文案 |
| explore | 新手 |
| combo | 连击、里程碑 |

### 5.4 与 `spawnHints` 的显式耦合

- **harvestNow** = `rhythmPhase === 'payoff' || spawnIntent === 'harvest'`：抑制「提升挑战」「规划堆叠」等与**当下兑现**冲突的卡。  
- **收获期·待兑现**：`rhythmPhase` 快照为 payoff，但 **live** 几何已不支持——诚实降级文案。  
- **瓶颈块**：使用 `liveSolutionMetrics.firstMoveFreedom`（及合计可落位）优先，反映**当前 dock** 可下性。

完整规则表见 [策略体验栈 §8](./STRATEGY_EXPERIENCE_MODEL.md#8-策略顾问规则索引l4)。

### 5.5 L4b：压力表状态体系（State Enumeration）

> 压力表把 `stress`、`spawnIntent`、`stressBreakdown`、`spawnHints` 翻译为玩家可感知的「头像 + 标签 + 进度 + 趋势 + 一句话」。**所有可观测状态都是确定性函数**——按下表枚举可完整复现。

#### 5.5.0 渲染契约（截图区域）

`stressMeter.renderStressMeter(root, insight, history)` 的输出区域必须按以下契约解释，避免把「状态档位」「系统意图」「趋势」混成同一个指标：

| UI 元素 | 数据源 | 计算/判别 | 向玩家传递的信息 |
|---------|--------|-----------|------------------|
| 头像 emoji | `getStressDisplay(stress, spawnIntent).face` | 先按 §5.5.1 映射 6 档；若命中 §5.5.2 救济变体则覆盖 | 当前体验的情绪表情：放松、舒缓、心流、投入、紧张、高压，或被系统照顾 |
| 标题标签 | `getStressDisplay(...).label` | 同头像 | 当前综合压力档位，不等同于具体出块意图 |
| 数值 | `insight.stress` | `Number.isFinite` 时保留两位小数；缺失按 0 | L2 自适应综合压力的最终值 |
| 趋势箭头 | `computeTrend(history, stress, 6)` | 当前值与最近 6 帧均值比较，阈值 `0.04` | 压力相对近期是在上升、下降还是持平 |
| 进度条 | `_stressToBar(stress)` | `clamp(stress, -0.2, 1)` 后线性映射到 `0%~100%` | 压力强弱的连续量，不是独立指标 |
| 一句话叙事 | `buildStoryLine(level, breakdown, targets, hints, geometry)` | 按 §5.5.4 决策树第一个命中分支返回 | 系统当前动作意图：救济、召回、加压、心流维持、促清兑现等 |
| 呼吸速度 | `breathMs = 2400 - barPct × 14` | 与进度条同源 | 视觉节奏随压力增强而加快 |

**规范要求**：

1. **标题/头像只表达综合压力档位**，不得直接当作出块意图解释。  
2. **一句话叙事优先表达 `spawnIntent`**，并用高压守卫/几何守卫保证与头像、盘面不冲突。  
3. **趋势箭头只表达相对近期变化**，不代表绝对高低；`-0.08 →` 表示压力低且相对近期持平。  
4. 若新增状态、文案或守卫，必须同步更新本节、`tests/stressMeter.test.js` 与截图复现说明。

#### 5.5.1 6 档压力等级（`STRESS_LEVELS`）

`stressMeter.js → STRESS_LEVELS`。区间为**左闭右开**，超出范围按首/末档兜底（`getStressLevel(stress)`）。

| `id` | 标签 | 区间 | 头像 | 默认 vibe（兜底叙事） | 体感设计 |
|------|------|------|------|----------------------|----------|
| `calm`    | 放松 | `(-∞, -0.05)` | 😌 | 盘面整洁，心情舒缓。 | 玩家**或系统主动**减压；常伴 friendlyBoardRelief / frustrationRelief / recoveryAdjust |
| `easy`    | 舒缓 | `[-0.05, 0.20)` | 🙂 | 操作轻松，节奏从容。 | 心流前奏；`finalStress ≈ 0` 的常态档 |
| `flow`    | 心流 | `[0.20, 0.45)` | 😀 | 挑战与能力匹配，正爽快。 | 主体心流带；`flowDeviation` 小、`pacingPhase` 自然交替 |
| `engaged` | 投入 | `[0.45, 0.65)` | 🤔 | 需要思考，节奏开始拉紧。 | 解空间收紧、`solutionSpacePressure` 上行 |
| `tense`   | 紧张 | `[0.65, 0.80)` | 😰 | 盘面吃紧，留意可消行机会。 | 触发 `flowPayoffCap`(0.79) 软封顶的上沿 |
| `intense` | 高压 | `[0.80, +∞)` | 🥵 | 高强度对局，系统会优先保活。 | 已超 cap；通常仅 Hard 模式 + B 类挑战可达 |

**进度条映射**：`barPct = round((clamp(stress, -0.2, 1) + 0.2) / 1.2 × 100)`，故 `stress=-0.2 → 0%`，`stress=1 → 100%`，`stress=0` 落在约 17%。  
**呼吸频率**：`breathMs = 2400 - barPct × 14` ms（barPct=0→2.4 s 缓呼吸，barPct=100→1.0 s 急促）。

#### 5.5.2 救济变体：低压档的「被照顾」覆盖

`getStressDisplay(stress, spawnIntent)` 在以下条件**全部满足**时覆盖 `face/label/vibe`：

```
spawnIntent === 'relief'  ∧  Number.isFinite(stress)  ∧  stress ≤ -0.05  ∧  base.id === 'calm'
```

| 字段 | 默认 calm | 救济变体 |
|------|-----------|----------|
| `face` | 😌 | **🤗** |
| `label` | 放松 | **放松（救济中）** |
| `vibe` | 盘面整洁，心情舒缓。 | **系统正在为你减压：候选块更小、更友好，找一条最容易消的行先恢复节奏。** |

> **设计取舍**：`easy`（−0.05 ~ 0.20）是温和挑战区，「舒缓 + 主动减压」并不冲突；只对真正被压低的 `calm` 档启用，避免过度自指（v1.18）。

#### 5.5.3 趋势状态（`computeTrend`）

```
slice = history[-7 .. -2]   // 取当前帧之前的最多 6 帧
avg   = mean(slice)
delta = current - avg
```

| 条件 | `direction` | `icon` | tooltip |
|------|-------------|--------|---------|
| `|delta| < 0.04` 或 `slice` 不足 | `flat` | → | 与近期均值持平 |
| `delta ≥ 0.04` | `up` | ↗ | 比近 6 帧平均高 X.XX |
| `delta ≤ -0.04` | `down` | ↘ | 比近 6 帧平均低 X.XX |

#### 5.5.4 一句话叙事的决策树（`buildStoryLine`）

按**从上到下**第一个命中的分支返回（`level` 来自 §5.5.1，`breakdown/hints/targets` 来自 `_lastAdaptiveInsight`，**`geometry` v1.31 新增**：来自 `spawnDiagnostics.layer1` 的 `fill / holes / nearFullLines / multiClearCandidates`）：

```
1. boardRisk ≥ 0.60                                     → 「盘面很紧张，系统正在为你保活，候选块更易消行。」
2. v1.31 score-push 高压守卫（抢占 §3 / §4 的高压守卫）
   shouldUseScorePushHighStress(level, intent, geometry):
     intent ∈ {flow, harvest}
     ∧ level.id ∈ {tense, intense}
     ∧ geometry.boardFill < 0.30
     ∧ geometry.holes === 0                              → SCORE_PUSH_HIGH_STRESS_NARRATIVE_BY_LEVEL[level.id]
3. spawnIntent === 'flow'
   3a. level.id ∈ {engaged, tense, intense}              → FLOW_HIGH_STRESS_NARRATIVE_BY_LEVEL[level.id]
   3b. spawnHints.rhythmPhase 命中                        → FLOW_NARRATIVE_BY_PHASE[phase]
   3c. 否则                                               → SPAWN_INTENT_NARRATIVE.flow（兜底）
4. spawnIntent === 'harvest'
   4a. level.id ∈ {engaged, tense, intense}              → HARVEST_HIGH_STRESS_NARRATIVE_BY_LEVEL[level.id]
   4b. v1.31 geometry 已传入：classifyHarvestDensity()    → HARVEST_NARRATIVE_BY_DENSITY[dense | visible | edge]
   4c. geometry 缺失（旧回放）                            → SPAWN_INTENT_NARRATIVE.harvest（向后兼容）
5. spawnIntent ∈ {relief, engage, pressure, maintain}    → SPAWN_INTENT_NARRATIVE[intent]
6. 旧回放兜底链（无 spawnIntent，pv≤2）                  → §5.5.6
7. 全部未命中                                            → level.vibe（默认）
```

**关键点**：

- 第 1 条**先于** spawnIntent —— `boardRisk` 极高时**保活叙事**始终抢占。
- 第 2 条（v1.31 新）**先于** §3 / §4 高压守卫 —— "高压但盘面友好"（冲分诱发）和"高压且盘面紧张"（求生）需要不同语义；旧版守卫一律说"保活/确保可落位"，与 fill=20%、holes=0 的实际盘面错位。
- 第 4b 条（v1.31 新）仅在显式传入 `geometry` 时启用密度分级；老回放保持原文案不变，避免改写历史叙事。

#### 5.5.5 `spawnIntent` → 文案映射枚举

##### A. 单一映射 `SPAWN_INTENT_NARRATIVE`

| `intent` | 中文标签 (面板 pill) | 默认叙事 |
|----------|------|---------|
| `relief`   | 救济 | 盘面通透又是兑现窗口，悄悄给你减压享受多消。 |
| `engage`   | 召回 | 注意到你停顿了一下，给你一个明显得分目标 + 友好开局。 |
| `pressure` | 加压 | 正在挑战自我！系统略加压让收尾更有仪式感。 |
| `flow`     | 心流 | 心流稳定，系统继续维持流畅的出块节奏。（仅作兜底，正常会被 §B/§C 覆盖） |
| `harvest`  | 兑现 | 识别到密集消行机会，正在投放促清的形状。（高压档会被 §D 覆盖） |
| `maintain` | 维持 | 看起来比较轻松，悄悄加点料维持新鲜感。 |

##### B. `flow` 意图按 `rhythmPhase` 的 3 个变体（`FLOW_NARRATIVE_BY_PHASE`）

| `rhythmPhase` | 叙事 |
|---------------|------|
| `payoff`  | 心流稳定，节奏进入收获期，准备享受多消快感。 |
| `setup`   | **心流稳定，节奏稳步搭建，先留好通道等下一波兑现。** ← 截图所示 |
| `neutral` | 心流稳定，节奏自然流畅，系统继续维持当前出块。 |

> **设计动因（v1.24）**：`spawnIntent='flow'` 既可由 `delight.mode='flow_payoff'` 触发，也可由 `rhythmPhase='payoff'` 触发；R1 空盘 + 无 nearGeom 时 `delight.mode='flow_payoff'` 也成立但 `rhythmPhase` 会 fall-through 到 `setup`，旧版硬编码「收获期」会与右侧 pill「节奏 搭建」+ 顾问「搭建期」三方对立。

##### C. `flow` 高压档守卫（`FLOW_HIGH_STRESS_NARRATIVE_BY_LEVEL`，v1.27）

| `level.id` | 叙事 |
|-----------|------|
| `engaged` | 需要更多专注，先稳住关键落点，再逐步扩大消行窗口。 |
| `tense`   | 压力正在抬升，优先保留可消行通道，避免高列继续堆积。 |
| `intense` | 进入高压区，系统会优先保活，先确保可落位与基础消行。 |

##### D. `harvest` 高压档守卫（`HARVEST_HIGH_STRESS_NARRATIVE_BY_LEVEL`，v1.29）

| `level.id` | 叙事 |
|-----------|------|
| `engaged` | 局面需要专注，已识别可消行窗口，正投放更易兑现的组合。 |
| `tense`   | 盘面吃紧，但已识别可消行窗口，正投放促清组合帮你逐步降压。 |
| `intense` | 高压下仍有消行机会，系统优先促清形状，先稳住落点再逐步解压。 |

> 守卫的统一原则：**头像 + 标签**反映身体感受，**叙事**承担系统动作解释——两者**不互斥**，通过守卫文案在「紧张档」与「兑现意图」并存时合并表达。

##### E. v1.31「冲分高压」守卫（`SCORE_PUSH_HIGH_STRESS_NARRATIVE_BY_LEVEL`）

抢占 §C / §D 高压守卫的窄条件变体。仅当 `intent ∈ {flow, harvest}`、`level.id ∈ {tense, intense}`、`geometry.boardFill < 0.30`、`geometry.holes === 0` 全部成立时启用：

| `level.id` | 叙事 |
|-----------|------|
| `tense`   | 冲分节奏拉紧，但盘面尚有余地——专注每一块的落位继续累积。 |
| `intense` | 正在冲击新高，节奏紧绷；盘面仍开阔，稳住关键落点把分数稳稳推上去。 |

**触发判定函数**：`shouldUseScorePushHighStress(level, intent, geometry, fillThreshold = 0.30)`，纯函数、可独立测试。

> **设计动因（v1.31）**：截图复现 —— 玩家在 fill=20%、holes=0、解法 44 的空旷盘面上，因正在冲击个人最佳，`scoreStress + feedbackBias + challengeBoost` 把 `stress` 推到 `intense (0.86)`，旧 `FLOW_HIGH_STRESS_NARRATIVE_BY_LEVEL.intense` 文案「**进入高压区，系统会优先保活，先确保可落位与基础消行**」与"空盘"严重错位。本守卫识别"高压来自冲分而非盘面危机"，把语义切到"**冲分仪式感**"——不再说"保活"，而是承认压力 + 鼓励继续累积。
>
> **窄条件原因**：
> - `intent ∈ {flow, harvest}`：意图本身就是"继续推进/兑现"，与冲分场景同向；`pressure / engage` 已有自己的明确语义。
> - `boardFill < 0.30`：把"友好"卡得保守；超过此线时盘面接近半满，"冲分"叙事就不再合适。
> - `holes === 0`：只要有空洞就说明盘面已有结构性问题，不再是纯冲分场景。

##### F. v1.31 `harvest` 按密度分级（`HARVEST_NARRATIVE_BY_DENSITY`）

仅在 `intent === 'harvest'`、`level.id` **未到** `tense/intense`（高压档由 §D 接管）、且**显式传入 `geometry`** 时启用。

由 `classifyHarvestDensity({ nearFullLines, multiClearCandidates })` 三选一：

| 密度档 | 触发条件 | 叙事 |
|--------|----------|------|
| `dense`   | `nfl ≥ 3` ∨ `mcc ≥ 3` | 识别到密集消行机会，正在投放促清的形状。 |
| `visible` | `nfl ≥ 2`（默认触发档，最常见） | **已识别清晰的消行通道，正在投放更易兑现的组合。** |
| `edge`    | 其它（`nfl < 2`，pcSetup-only 路径触发） | 出现首个消行窗口，先把握这一手试试看。 |

> **设计动因（v1.31）**：旧版 `SPAWN_INTENT_NARRATIVE.harvest` 一律说「识别到**密集**消行机会」，但 `harvest` 在 adaptiveSpawn 中的触发门槛只是 `nearFullLines >= 2`（最低档）。截图复现：`nfl=2`、`mcc=2-3` 时盘面只是底部两行较紧贴，并非"密集"，措辞略夸张。三档分级让叙事强度匹配几何强度。
>
> **向后兼容**：`geometry === undefined` 时（旧回放、缺 `spawnDiagnostics`）自动回退到 `SPAWN_INTENT_NARRATIVE.harvest` 旧文案，避免改写历史叙事。

#### 5.5.6 旧回放兜底链（`spawnIntent` 缺失时）

仅在历史回放或部分 `pv ≤ 2` 数据缺失 `spawnIntent` 时启用，按顺序匹配第一个命中：

| # | 触发 | 叙事 |
|---|------|------|
| 1 | `frustrationRelief < -0.05` | 检测到挫败感偏高，正在主动减压并送出可消块。 |
| 2 | `recoveryAdjust < -0.05`    | 处在恢复窗口，候选块会更小、更友好。 |
| 3 | `friendlyBoardRelief < -0.05` | 盘面通透又有兑现窗口，悄悄给你减压享受多消。 |
| 4 | `challengeBoost ≥ 0.05`     | 正在挑战历史最佳！系统略加压让收尾更有仪式感。 |
| 5 | `comboAdjust ≥ 0.04`        | combo 还在燃烧，给你预留了续链空位。 |
| 6 | `flowAdjust ≥ 0.04`         | 看起来比较轻松，悄悄加点料维持新鲜感。 |
| 7 | `flowAdjust ≤ -0.04`        | 稍有焦虑，正在切到更稳的节奏。 |
| 8 | `rhythmPhase === 'payoff'`  | 节奏进入收获期，准备享受多消快感。 |
| 9 | `clearOpportunity ≥ 0.55`   | 识别到消行良机，正在投放促清的形状。 |
| - | 都未命中                     | 回 `level.vibe` |

#### 5.5.7 面板 pill 状态枚举（与压力表同源）

`playerInsightPanel` 顶部 pill 与压力表读同一份 `_lastAdaptiveInsight`，状态枚举如下（**snapshot/live 标记**详见 §7）：

| pill | 来源 | 取值与中文标签 |
|------|------|----------------|
| **意图** | `spawnHints.spawnIntent` | `relief→救济 / engage→召回 / pressure→加压 / flow→心流 / harvest→兑现 / maintain→维持` |
| **节奏**（`rhythmPhase`） | `spawnHints.rhythmPhase` | `payoff→收获 / setup→搭建` (`neutral` 隐藏不显示) |
| **弧线**（`sessionArc`） | `spawnHints.sessionArc` | `warmup→热身 / peak→巅峰 / cooldown→收官` |
| **Session 张弛**（解释段） | `profile.pacingPhase` | `release→松弛期 / tension→紧张期`（命名与 `rhythmPhase` 拆开，避免「节奏 收获 + 张弛 紧张」表面冲突） |
| **偏好**（`playstyle`） | `playerProfile.playstyle` | `perfect_hunter→清屏猎人 / multi_clear→多消流 / combo→连消流 / survival→生存流 / balanced→均衡` |
| **目标保消** | `spawnHints.clearGuarantee` | `0~3`，已经过几何回钳 |
| **尺寸 / 多样** | `spawnHints.sizePreference / diversityBoost` | 数值，`-0.5~+0.5` 量级 |
| **连击 / 多消 / 多线** | `spawnHints.comboChain / multiClearBonus / multiLineTarget` | 仅在大于阈值时显示 |
| **救济通路**（v1.19 自动） | `summarizeContributors` 派生 | 当 `frust/recovery/holes/boardRisk*` 任一显著为负时自动出 pill |

#### 5.5.8 截图复现案例（图示）

##### A. `engage` 召回/停顿提示

观察到的状态：标签「**放松**」😌 + `stress = -0.08` + 趋势 `→` + 叙事「**注意到你停顿了一下，给你一个明显得分目标 + 友好开局。**」

逐字段反推：

| 信号 | 取值 | 命中规则 |
|------|------|----------|
| `stress` | `≈ -0.08` | 落入 §5.5.1 `calm` 档 `(-∞, -0.05)` → label「放松」😌 |
| `spawnIntent` | `engage` | §5.5.4 第 5 条命中 `SPAWN_INTENT_NARRATIVE.engage` |
| `trend.delta` | `|delta| < 0.04` | §5.5.3 → `flat → →` |
| 救济变体 | 不命中 | `spawnIntent !== 'relief'`，所以不显示「放松（救济中）」🤗 |

**为什么是「放松」但文案说停顿？** —— 标题/头像只表达综合压力档位；一句话叙事表达系统动作意图。`engage` 是「玩家停顿/冷启动后重新聚焦」路径，允许与低 stress 同时存在：系统不是在救急，而是在给一个更明确的得分目标与友好开局。

##### B. `flow + setup` 心流搭建

观察到的状态：标签「**舒缓**」🙂 + `stress = -0.01` + 趋势 `→` + 叙事「**心流稳定，节奏稳步搭建，先留好通道等下一波兑现。**」

逐字段反推：

| 信号 | 取值 | 命中规则 |
|------|------|----------|
| `stress` | `≈ -0.01` | 落入 §5.5.1 `easy` 档 `[-0.05, 0.20)` → label「舒缓」🙂 |
| `spawnIntent` | `flow` | §5.5.4 第 2 条命中 |
| `level.id` | `easy`（不在高压档）| §5.5.4 第 2a 条不命中，进 2b |
| `spawnHints.rhythmPhase` | `setup` | §5.5.5-B → 「心流稳定，节奏稳步搭建，先留好通道等下一波兑现。」 |
| `trend.delta` | `|delta| < 0.04` | §5.5.3 → `flat → →` |

**为什么 stress 这么低还是 flow 意图？** —— `delight.mode='flow_payoff'` 在低占用时也可触发 `intent='flow'`，与 `rhythmPhase='setup'` 共存（v1.24 反例修复点）；属于「心流体验稳定 + 仍在搭建」的合理叠态，不是 bug。

> 完整体验栈映射、单一意图与互抑见 [策略体验栈 §4-§9](./STRATEGY_EXPERIENCE_MODEL.md)。

---

## 6. 策略合理性评估清单（建议用于评审/改版）

在改 `game_rules.json`、`adaptiveSpawn.js`、`strategyAdvisor.js` 或文案前，可按表自查：

| # | 检查项 | 通过标准（示例） |
|---|--------|------------------|
| 1 | **意图—叙事—dock 一致** | `spawnIntent`、压力表 story、`clearGuarantee`/形状权重不出现互斥描述 |
| 2 | **几何可兑现** | 多消/收获/保消承诺与 `liveMultiClearCandidates` / `nearFullLines` 或 L3 回钳一致 |
| 3 | **快照 vs 实时** | 顾问卡在多步后仍引用 spawn 快照的几何时，须有「待兑现」或 live 优先 |
| 4 | **冷启动诚实** | `metrics.samples===0` 时 UI 不展示假具体数值；skill/stress 不极端抖动 |
| 5 | **心流边界** | bored/anxious/flow 切换频率与 `flowDeviation` 缓冲是否合理 |
| 6 | **挫败链** | 连续未消行 → frustration → relief → 实际 dock 是否更易消行（可配合回放） |
| 7 | **类别多样性** | 极端生存局是否仍出现至少一条非 survival（v1.29 多样性规则是否过弱/过强） |
| 8 | **回归测试** | `npm test` 中 `adaptiveSpawn` / `strategyAdvisor` / `stressMeter` 相关用例 |

---

## 7. 数据流时序

### 7.1 单次放置后（面板刷新）

```
玩家落子 → grid.place / checkLines
       → playerProfile.recordPlace(...)
       → _refreshPlayerInsightPanel()
       → playerInsightPanel._render(game)
            ├─ generateStrategyTips(profile, _lastAdaptiveInsight, gridInfo)
            ├─ renderStressMeter(..., _lastAdaptiveInsight, stressHistory)
            └─ 能力/拓扑/回放曲线等
```

### 7.2 下次出块

```
spawnBlocks()
  → resolveAdaptiveStrategy(..., spawnContext 含 _gridRef、_occupancyFillAnchor 等)
  → _captureAdaptiveInsight(layered)  // 含写回 occupancy 锚点
  → generateDockShapes(grid, layered, spawnContext)
```

---

## 8. 配置参数速查

所有可调项以 **`shared/game_rules.json → adaptiveSpawn`** 为准；下列仅列常用键，**默认值若与 JSON 不一致，以 JSON 为权威**。

### 8.1 画像与窗口

| 参数路径 | 说明 |
|----------|------|
| `profileWindow` | 滑动窗口长度 |
| `smoothingFactor` / `fastConvergenceWindow` / `fastConvergenceAlpha` | 技能 EMA |

### 8.2 闭环反馈（当前 JSON 常见值）

| 参数路径 | 说明 |
|----------|------|
| `feedback.horizon` | 观察步数 |
| `feedback.expected` | 预期累计消行条数 |
| `feedback.alpha` | 更新步长 |
| `feedback.decay` | 每轮 spawn 对 bias 的衰减 |
| `feedback.biasClamp` | bias 绝对值上限 |

### 8.3 心流、参与度、节奏

见 JSON 中 `flowZone`、`engagement`、`pacing`；与 §2、§3 描述对应。

### 8.4 十档 profile

`adaptiveSpawn.profiles`：`stress` 锚点 + `shapeWeights`；线性插值见 `interpolateProfileWeights`。

---

## 9. 扩展指南

### 9.1 新策略卡

在 `strategyAdvisor.js` 的 `generateStrategyTips()` 中增加分支：`title`≤6 字、`priority`∈[0,1]、`category` 合法；注意与 **harvestNow**、**live** 几何、**tips.length** 门控的交互。

### 9.2 新画像信号

在 `PlayerProfile` 增加 getter → 若需出块则进 `adaptiveSpawn` 的 `stressBreakdown` 或 hints → 若需展示则 `playerInsightPanel` / `profileAtSpawn`。

### 9.3 调参不改代码

优先改 `game_rules.json` 的 `signals.scale`、`flowZone`、`engagement`、`profiles`；大规模改权重建议配合 §6 清单与回放样本。

---

## 10. 面板 UI 布局（参考）

```
┌──────────────────────────────────┐
│  玩家画像          [求助][新局][重开]│
│──────────────────────────────────│
│  技能 / 消行 / 失误 / 思考 / 负荷   │  ← 能力指标（注意冷启动「—」）
│──────────────────────────────────│
│  心流 / 节奏 / 会话阶段 …          │  ← L1 状态
│──────────────────────────────────│
│  压力表：档位 + stress + 趋势 + story │  ← L4b（intent 驱动叙事）
│──────────────────────────────────│
│  实时策略（最多 3 条）              │  ← L4a
│──────────────────────────────────│
│  投放/拓扑 pills、sparkline        │  ← L2 快照 + 实时几何
└──────────────────────────────────┘
```

---

## 关联文档

| 文档 | 内容 |
|------|------|
| [STRATEGY_EXPERIENCE_MODEL.md](./STRATEGY_EXPERIENCE_MODEL.md) | 四层通用模型、spawnIntent、几何门控、风险缓解 v1.29 |
| [ADAPTIVE_SPAWN.md](../algorithms/ADAPTIVE_SPAWN.md) | 自适应设计理念与配置详解 |
| [SPAWN_ALGORITHM.md](../algorithms/SPAWN_ALGORITHM.md) | 出块三层与 blockSpawn |
| [PANEL_PARAMETERS.md](./PANEL_PARAMETERS.md) | 面板字段级说明 |
