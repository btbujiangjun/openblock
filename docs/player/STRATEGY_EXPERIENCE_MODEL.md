# 策略体验栈：通用模型与 OpenBlock 映射

> **定位**：描述「玩家状态 → 系统决策 → 内容生成 → 界面叙事」的**通用分层模型**（系统结构入口），并给出本仓库的实现入口。  
> **上游方法论**：心理学根基与 5 轴体验结构见 [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md)（顶层方法论入口）；本文是其在"系统分层"维度的展开。  
> **读者**：产品、算法、架构、测试；需与 [实时策略系统](./REALTIME_STRATEGY.md)（**指标字典、物理含义、L1–L4 管线、策略生成与合理性评估清单**）、[自适应出块](../algorithms/ADAPTIVE_SPAWN.md)（参数矩阵）配合阅读。  
> **维护**：改 `adaptiveSpawn.js` / `blockSpawn.js` / `stressMeter.js` / `strategyAdvisor.js` 时，同步核对本文「实现映射」与「顾问规则」表。

---

## 1. 为什么需要「策略体验栈」

在**带自适应难度的方块益智**中，常见失败模式是：

- 数值上在「加压」，文案却在说「放松兑现」；
- 面板承诺「多消导向」，实际 dock 与盘面几何对不上；
- 压力表显示「高压」，盘面却很空。

根因是**多条独立管线**（难度曲线、出块采样、UI 提示、拟人化文案）各自推导结论，缺少统一口径。

通用解法是引入一层**对外可见的系统意图**（单一枚举或标签），并让生成与叙事都消费同一意图；同时对「可兑现性」做**几何门控**，避免承诺无法落地的体验。

---

## 2. 通用四层参考模型

下列分层与具体文件名解耦，便于迁移到其他项目。

| 层 | 通用职责 | 典型输入 | 典型输出 |
|----|----------|-----------|----------|
| **L1 状态估计** | 从行为与盘面估计「玩家有多紧张、多挫败、能力区间」 | 操作间隔、消行历史、填充率、拓扑特征 | 技能/动量/心流/挫败等状态向量 |
| **L2 策略解析** | 把状态与规则配置合成为**标量压力**与**结构化提示** | L1、分数、会话阶段、难度档 | `stress`、权重曲线、hints（消行保证、多消偏好、节奏相位等） |
| **L3 内容生成** | 在公平性与可解性约束下**采样**具体关卡内容（此处为三连块） | L2、盘面、形状池 | 候选块、诊断指标（可解性、解空间统计） |
| **L4 体验呈现** | 将系统状态**翻译**为玩家可理解的情绪与建议 | L2 快照、L3 诊断、当前盘面 | 压力表档位、一句话叙事、1～N 条策略卡 |

数据流方向：**L1 → L2 → L3**；**L4** 主要读取 L2 快照 + **实时盘面**（避免「出块时的快照」与「落子后的盘面」打架）。

---

## 3. 单一对外意图（系统意图枚举）

通用模式：在 L2 末尾派生一个**离散意图** `intent ∈ {救济, 召回, 兑现, 加压, 心流维持, 中性维持, …}`，满足：

1. **叙事优先**：一句话说明优先读 `intent`，避免与 dock 实际形态冲突。  
2. **高压守卫**：当综合压力已到「紧张/高压」档时，心流类文案需降级为「专注/保活」语义，避免「头像紧张 + 文案心流稳定」矛盾。  
3. **救济变体**：当意图为救济且压力被压低时，情绪标签可增加「（救济中）」等副标题，区分「我真的很轻松」与「系统正在照顾我」。

OpenBlock 中该枚举为 **`spawnIntent`**：`relief | engage | harvest | pressure | flow | maintain`，定义见 `web/src/adaptiveSpawn.js` 末尾派生逻辑；叙事映射见 `web/src/stressMeter.js` 中 `SPAWN_INTENT_NARRATIVE` 与 `buildStoryLine`。

---

## 4. 压力档位与叙事的职责分离

通用设计：

- **档位（label + emoji + 进度条）**：表达玩家侧**综合压力**的体感，来自 L2 的标量 `stress` 与历史趋势（如近 N 帧均值对比 → ↗↘→）。  
- **副文案（story）**：表达系统**当前动作意图**（正在加压 / 正在促消 / 正在保活），优先绑定 §3 的 `intent`，其次才是分解项兜底链。

这样「紧张 + 正在投放促清形状」可以同时成立：**体感紧张**（分数、挑战、填充等综合结果）与**系统正在帮你兑现几何**（`harvest`）是两条正交信息，合并成一句对话式 UI。

OpenBlock 档位：`web/src/stressMeter.js` → `STRESS_LEVELS`（放松～高压）；趋势：`computeTrend`；故事：`buildStoryLine`。

---

## 5. 几何可行性门控（通用原则）

下列原则适用于任何「根据盘面机会调整生成」的系统：

| 原则 | 含义 |
|------|------|
| **承诺可落地** | 若 UI 写明「至少 K 块可立即消行」，则 K 不得超过当前盘面与候选池物理上能支持的上限。 |
| **低占用清屏噪声** | 「清屏/setup」类信号在极低填充率下易误报；应对其加占用率门槛或与近满线、多消候选联动。 |
| **快照 vs 实时** | 策略卡若描述「多消机会」，应优先用**当前 grid** 重算的几何，出块瞬间的诊断仅作回退。 |
| **多消偏好软封顶** | 当不存在任何多消放置候选且近满线不足时，应对「多消 bonus / 多线目标」降档，避免权重与可玩现实脱节。 |

OpenBlock 中：`adaptiveSpawn.js` 的 `PC_SETUP_MIN_FILL`、`clearGuarantee` 回钳、`multiClearBonus`/`multiLineTarget` 几何兜底；`strategyAdvisor.js` 的 `liveTopology` / `liveMultiClearCandidates` / `liveSolutionMetrics`；`blockSpawn.js` 的序贯可解与解法区间过滤。

---

## 6. L2 输出：多轴目标（spawnTargets 模式）

将一维 `stress` 投影为多条**消费轴**（复杂度、解空间压力、消行机会、空间压力、兑现强度、新鲜度等），可避免「难度只等于形状更怪」的单调调节。

OpenBlock：`deriveSpawnTargets` in `web/src/adaptiveSpawn.js`；分解项标签：`web/src/stressMeter.js` → `SIGNAL_LABELS`（与 `stressBreakdown` 键对齐）。

---

## 7. OpenBlock 实现映射

| 通用层 | 主要文件 | 配置入口 |
|--------|----------|----------|
| L1 画像 | `web/src/playerProfile.js` | `adaptiveSpawn` 与画像相关键（见 [REALTIME_STRATEGY](./REALTIME_STRATEGY.md)） |
| L2 自适应 | `web/src/adaptiveSpawn.js` | `shared/game_rules.json → adaptiveSpawn` |
| L2 关闭时回退 | `web/src/difficulty.js` | `strategies.*` |
| L3 出块 | `web/src/bot/blockSpawn.js` | 同上 + `solutionDifficulty` |
| L4 压力表 | `web/src/stressMeter.js` | `STRESS_LEVELS`（6 档放松～高压）；状态枚举 / 救济变体 / 趋势 / 故事线决策树详见 [REALTIME_STRATEGY §5.5](./REALTIME_STRATEGY.md#55-l4b压力表状态体系state-enumeration) |
| L4 策略卡 | `web/src/strategyAdvisor.js` | 无独立配置，改代码或后续抽表 |
| L4 面板聚合 | `web/src/playerInsightPanel.js` | — |
| 对局快照 | `web/src/game.js` | `_captureAdaptiveInsight`、`spawnGeo`；`layered._occupancyFillAnchor` → `_spawnContext._occupancyFillAnchor`（占用阻尼锚点） |

**未接入主路径**：`web/src/bot/spawnLayers.js`（泳道/全局层）已实现，`generateDockShapesLayered` 默认仍走 `generateDockShapes`。

---

## 8. 策略顾问规则索引（L4）

`generateStrategyTips` 按条件收集建议，`priority` 降序取前 **3** 条。下列与源码 `web/src/strategyAdvisor.js` 对齐；类别含 `survival | clear | build | pace | explore | combo`。

| 标题 | 类别 | 触发摘要 | 优先级 |
|------|------|----------|--------|
| 紧急清行 | survival | `fill > 0.75` | 0.95 |
| 控制高度 | survival | `fill > 0.6` | 0.70 |
| 恢复模式 | survival | `needsRecovery` | 0.88 |
| 填补空洞 | build | `holes > 3` | 0.72 |
| 多消机会 | clear | 近满线 ≥3 且 live 多消候选 ≥2 | 0.78 |
| 逐条清理 | clear | 近满线 ≥3 且多消候选不足 | 0.70 |
| 瓶颈块 | survival | `firstMoveFreedom ≤ 2` 且 `fill ≥ 0.4` | 0.86 |
| 延续连击 | combo | `comboChain > 0.5` 或连击 streak ≥2 | 0.82 |
| 差一步消行 | clear | `hadRecentNearMiss` | 0.75 |
| 收获期 / 收获期·待兑现 | pace | `rhythmPhase === 'payoff'`（几何 mutex） | 0.60 |
| 搭建期 | build | `rhythmPhase === 'setup'` 且 `fill < 0.5` | 0.45 |
| 别急，稳住 | pace | `frustration ≥ 4` | 0.82 |
| 提升挑战 | build | `bored`、非收获窗口、`fill ≥ 0.18` | 0.50 |
| 放慢节奏 | pace | `anxious`、无 survival 卡 | 0.65 |
| 简化决策 | pace | 思考过长且认知负荷高 | 0.55 |
| 调整策略 | build | `momentum < -0.4` | 0.60 |
| 热身阶段 | explore | `sessionArc === 'warmup'` | 0.40 |
| 收官阶段 | pace | `sessionArc === 'cooldown'` | 0.40 |
| 里程碑达成 | combo | `scoreMilestone` | 0.85 |
| 规划堆叠 | build | 低填充、高技能、非收获窗口 | 0.40 |
| 欢迎新手 / 对齐边缘 | explore | `isInOnboarding`（覆盖列表） | 1.0 / 0.9 |
| 新手提示 | explore | `isNewPlayer` | 0.45 |
| 注意休息 | pace | 会话晚期且动量下滑 | 0.35 |
| 状态良好 | pace | 兜底 | 0.30 |

**互斥与合并**：`harvestNow = (rhythmPhase === 'payoff' || spawnIntent === 'harvest')` 用于压制与「当下兑现」冲突的搭建类卡片。

**v1.29 输出后处理**：`generateStrategyTips` 排序后调用 `applyTipCategoryDiversity` —— 若前 3 条**全是** `survival`，且存在后续条目中 `priority` 达阈值的非 survival，则用其替换三者中**最弱**一条（不替换 `priority ≥ 0.94` 的救急档），减轻「面板只剩保命卡」的单调感。

---

## 9. 设计原则、风险缓解与剩余取舍

**原则**

1. **代码与配置可追溯**：调参优先 `shared/game_rules.json`，逻辑优先上述 JS 入口。  
2. **单一意图口径**：叙事、商业化标签、回放若读取意图，应与 `spawnIntent` 一致。  
3. **救济快、加压慢**：压力平滑对减压可短路，避免「该救时救不到」。  
4. **占用率衰减**：低填充时衰减正向压力，减轻「空盘高压」违和感（OpenBlock：`occupancyDamping`）；阻尼所乘的占用比例可绑定**缓降锚点**而非瞬时裸填充率（见下）。

**已落实的缓解（v1.29）**

| 风险 | 处理 | 代码入口 |
|------|------|----------|
| `harvest` 叙事与「紧张/高压」头像冲突 | `spawnIntent=harvest` 且档位为 `engaged`/`tense`/`intense` 时使用**合并文案**（吃紧 + 仍促清），与 `flow` 高压守卫同构 | `web/src/stressMeter.js` → `HARVEST_HIGH_STRESS_NARRATIVE_BY_LEVEL` |
| `challengeBoost` 与 `friendlyBoardRelief` 同帧拉锯 | `friendlyBoardRelief < -0.09` 时将 B 类 `challengeBoost` 乘以 **0.42** | `web/src/adaptiveSpawn.js` |
| 消行后瞬时低占用导致 `occupancyDamping` 与 stress 锯齿 | `_occupancyFillAnchor` 跨 spawn **缓降**写入 `stressBreakdown` 与返回值，由 `game` 写回 `_spawnContext` | `adaptiveSpawn.js` + `game.js` `_captureAdaptiveInsight` |
| 顾问 top3 全为 survival | `applyTipCategoryDiversity` 按阈值**替换最弱一条** | `web/src/strategyAdvisor.js` |

**v1.30 新增：动态被困识别（`bottleneckRelief`）**

| 问题 | v1.30 升级 | 代码入口 |
|------|------------|----------|
| `firstMoveFreedom`/`solutionCount` 由 strategyAdvisor 实时计算用于「瓶颈块」卡片，但**未反馈到自适应出块**——上一波三块在玩家手中跌到只剩 1~2 个落子（"被困高压"），下一波 spawn 完全不知情、不会减压 | 引入 `_updateBottleneckTrough()`：每次 `recordPlace` 后用 `getCandidatePlacementSolutionSnapshot()` 更新 `_spawnContext.bottleneckTrough`（dock 周期最低点）；下一次 `resolveAdaptiveStrategy` 把 trough ≤ `topologyDifficulty.bottleneckTroughThreshold` 转换为 `stressBreakdown.bottleneckRelief`（最高 -0.12）+ 自动抬高 `clearGuarantee/sizePreference` + 进入 `playerDistress` 派生 `spawnIntent='relief'` | `web/src/game.js` (`_updateBottleneckTrough`/`_resetBottleneckTrough`) + `web/src/adaptiveSpawn.js` + `shared/game_rules.json → adaptiveSpawn.topologyDifficulty.bottleneck*` + `signals.bottleneckRelief` |
| 与 `friendlyBoardRelief` / `frustrationRelief` / `recoveryAdjust` 栈叠形成「双重救济」 | 任一同向触发时 bottleneckRelief × 0.5；onboarding 内置零 | `adaptiveSpawn.js` |
| 派生痕迹回溯 | `bottleneckTrough/bottleneckSamples` 写入 `stressBreakdown` 与 `_lastAdaptiveInsight`；`stressMeter.summarizeContributors` skip 列表与新 `SIGNAL_LABELS.bottleneckRelief` 同步 | `adaptiveSpawn.js` + `stressMeter.js` |

**v1.31 新增：叙事-体感对齐两条窄守卫**

> 本次升级**不动数值**，只在 `stressMeter.buildStoryLine` 决策树插入两条窄条件分支，把"算法判断正确但叙事文案与玩家所见盘面错位"的两类截图复现 case 修掉。压力数值、`spawnIntent`、`spawnHints` 计算口径完全保持，UX 影响仅在叙事一行。

| 问题 | v1.31 升级 | 代码入口 |
|------|------------|----------|
| **冲分高压与空盘叙事冲突**：`scoreStress + feedbackBias + challengeBoost` 在玩家逼近个人最佳时把 stress 推到 `intense`，但盘面其实仍很空（fill=20%、holes=0、解法 44）；旧 `FLOW_HIGH_STRESS_NARRATIVE_BY_LEVEL.intense`「**保活/确保可落位**」与玩家所见严重错位（截图 1 复现） | 新增 `SCORE_PUSH_HIGH_STRESS_NARRATIVE_BY_LEVEL` + 触发判定函数 `shouldUseScorePushHighStress(level, intent, geometry, fillThreshold=0.30)`：`intent ∈ {flow, harvest}` ∧ `level.id ∈ {tense, intense}` ∧ `geometry.boardFill < 0.30` ∧ `geometry.holes === 0` 时**抢占** §C / §D 高压守卫，叙事切到「**冲分仪式感**」（"冲击新高，节奏紧绷；盘面仍开阔，稳住关键落点把分数稳稳推上去"）；`boardRisk ≥ 0.6` 仍最高优先 | `web/src/stressMeter.js` (`shouldUseScorePushHighStress` / `SCORE_PUSH_HIGH_STRESS_NARRATIVE_BY_LEVEL` / `buildStoryLine` 优先级 #2) |
| **harvest 一律说"密集"措辞过誉**：`harvest` 触发门槛只是 `nearFullLines >= 2`（最低档），`nfl=2/mcc=2-3` 时盘面只是底部两行较紧贴，旧 `SPAWN_INTENT_NARRATIVE.harvest`「识别到**密集**消行机会」语义偏强（截图 2 复现） | 新增 `HARVEST_NARRATIVE_BY_DENSITY` + `classifyHarvestDensity({nearFullLines, multiClearCandidates})` 三档：`dense (nfl≥3 ∨ mcc≥3) / visible (nfl≥2，最常见，"清晰可见") / edge (nfl<2，pcSetup-only，"首个窗口")`；只在低-中压档（`level.id ∉ {engaged, tense, intense}`）启用，高压档仍由 §D `HARVEST_HIGH_STRESS_NARRATIVE_BY_LEVEL` 接管 | `web/src/stressMeter.js` (`classifyHarvestDensity` / `HARVEST_NARRATIVE_BY_DENSITY` / `buildStoryLine` 优先级 #4b) |
| **几何上下文从哪来**：`buildStoryLine` 历史签名只接 `level/breakdown/spawnTargets/spawnHints` | `renderStressMeter` 从 `insight.spawnDiagnostics.layer1` 读取 `fill / holes / nearFullLines / multiClearCandidates`，组装 `geometry` 透传到 `buildStoryLine`（第 5 个可选参数）；`geometry === undefined` 时**完全回退到 v1.30 决策树**，老回放叙事不变 | `web/src/stressMeter.js` (`renderStressMeter` 内 `_layer1` → `geometry` + `buildStoryLine(..., geometry)`) |
| **优先级稳定性**：score-push 与 harvest 高压守卫在同一帧可同时成立（`harvest + intense + 友好盘面`） | 决策树固定：`boardRisk≥0.6` > **score-push 守卫** > FLOW/HARVEST 高压守卫 > harvest 密度分级 > SPAWN_INTENT_NARRATIVE > 旧回放 fallback > `level.vibe`；以 `tests/stressMeter.test.js` 9 条 v1.31 用例锁住 | `tests/stressMeter.test.js` (v1.31 score-push + harvest density 两个 describe) |

**v1.32 新增：顺序刚性 (orderRigor) — 高难度算法升级**

> 本次升级**消费一个早已存在但未使用的指标**（`evaluateTripletSolutions().validPerms`），把"顺序自由度"作为**第二个**软过滤维度引入，与既有"解空间体量"（v9 `solutionCount`）正交。当玩家**高压且具承受力**时，要求三连块**必须按特定顺序**才能放下（默认 `validPerms ≤ 2`，即 6 种排列里仅 2 种全可解），把单局难度天花板从"操作精度"延伸到"前瞻规划"。

| 问题 | v1.32 升级 | 代码入口 |
|------|------------|----------|
| **空间难度触顶后无第二级**：传统加压（更大块、更碎形状、`spatialPressure` 推高）在 `boardPressure / skillLevel ≈ 1` 时已经满档，再加只会让玩家挫败；但 `validPerms` 维度（"6 种排列里有几种可解"）从未被消费 | 派生 `orderRigor ∈ [0,1]` = `clamp01((stress − 0.55) × 1.6 + max(0, skill − 0.5) × 0.20 + difficultyTuning.orderRigorBoost)`；映射到 `orderMaxValidPerms ∈ [4, 2]`；blockSpawn 在前 ~55% attempt 拒绝 `validPerms > N` 的 triplet | `web/src/adaptiveSpawn.js`（派生）+ `web/src/bot/blockSpawn.js`（消费）+ `shared/game_rules.json → topologyDifficulty.orderRigor*` + `difficultyTuning.hard.orderRigorBoost = 0.30` |
| **新手 / 救场 / 被困 不应被刁难** | **五重 bypass**：(1) `inOnboarding` (2) `profile.needsRecovery` (3) `hasBottleneckSignal`（v1.30） (4) `holes > 3` (5) `boardFill < 0.5`；任一成立 `orderRigor=0`、`maxValidPerms=6` | `adaptiveSpawn.js` 内部 bypass 短路 |
| **过严配置导致 dock 候选稀缺时死循环** | 仅在前 `MAX_SPAWN_ATTEMPTS × 0.55` 次尝试内硬过滤；之后接受任意 `validPerms`；`truncated=true`（DFS 不可信）按通过处理 | `blockSpawn.js` orderEarly 守卫 + diagnostics `solutionRejects.orderTooLoose` 计数 |
| **诊断与叙事曝光** | `_orderRigor` / `_orderMaxValidPerms` 顶层暴露；`SIGNAL_LABELS.orderRigor` 加入 stressMeter（面板可读 tooltip）；`summarizeContributors` skip 列表更新避免被误读为 stress 分量 | `stressMeter.js` (`SIGNAL_LABELS` + `summarizeContributors`) + `tests/adaptiveSpawn.test.js` 7 用例 + `tests/blockSpawn.test.js` 3 用例 |

**与 5 轴体验结构的对应**（详见 [EXPERIENCE_DESIGN_FOUNDATIONS.md](./EXPERIENCE_DESIGN_FOUNDATIONS.md) §C）：

- **挑战-能力轴 (C)**：把高承受力玩家的难度天花板"纵向延伸"一档（操作精度 → 前瞻规划），延长心流停留时长
- **节奏-报偿轴 (R)**：rigor 高时玩家会有"先想清楚再下"的停顿（`thinkMs` 自然上升），打断纯反应式快节奏，**主动制造规划停顿**，让兑现时的多消爽点更强
- **情感-共鸣轴 (E)**：成功按对顺序 = "解谜爽点"（Variable Ratio Reward 的认知版本），与"消行爽点"形成情感对位

**剩余取舍**

- 类别多样性可能用略低优先级的 `combo`/`pace` 换出「瓶颈块」等 survival，依赖阈值（`max(0.58, minPri−0.15)`）与实测再调。  
- `stress` 与 `spawnIntent` 仍可能正交，需靠档位 + 叙事分工（体感 vs 系统动作）。  
- `spawnLayers.js` 仍未接入主出块路径。  
- 高 stress 形状权重仍依赖 L3 校验与几何兜底。
- v1.32 `orderRigor` 仅在数据层面工作；面板 Pill（"顺序刚性 R / 序贯上限 ≤N"）与 stressMeter 一句话叙事的"🧩 强制顺序"标签建议作为下个迭代项。

---

## 10. 验证与关联文档

**建议测试**：`tests/adaptiveSpawn.test.js`、`tests/blockSpawn.test.js`、`tests/strategyAdvisor.test.js`、`tests/stressMeter.test.js`。

**关联阅读**

| 文档 | 内容 |
|------|------|
| [REALTIME_STRATEGY.md](./REALTIME_STRATEGY.md) | 指标字典、压力指标全表（§3.2 加压/减压/慢变量/派生痕迹）与作用机制（§3.6）、互抑（§3.7）、反向工程（§3.8）、L1–L4 管线、合理性评估清单 |
| [ADAPTIVE_SPAWN.md](../algorithms/ADAPTIVE_SPAWN.md) | 自适应信号与 spawnHints 矩阵 |
| [SPAWN_ALGORITHM.md](../algorithms/SPAWN_ALGORITHM.md) | 出块三层与 Layer1/2/3 语义 |
| [SPAWN_SOLUTION_DIFFICULTY.md](../algorithms/SPAWN_SOLUTION_DIFFICULTY.md) | 解法空间与软过滤 |
| [STRATEGY_GUIDE.md](../engineering/STRATEGY_GUIDE.md) | 策略与难度定制（工程扩展） |
| [DOMAIN_KNOWLEDGE.md](../domain/DOMAIN_KNOWLEDGE.md) | 心流、挫败等产品语境 |

---

*文档版本：1.3（v1.30 动态被困识别 + v1.31 叙事-体感对齐两条窄守卫 + v1.32 顺序刚性高难度算法）· 与实现对齐以仓库主分支为准。*
