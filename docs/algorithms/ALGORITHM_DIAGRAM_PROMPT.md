# OpenBlock 算法架构图生成 Prompt

> **定位**：可复用的"喂给大模型即生成完整 OpenBlock 算法与策略架构图集合"
> 的 prompt 模板。其输出物登记在
> [`ALGORITHM_ARCHITECTURE_DIAGRAMS.md`](./ALGORITHM_ARCHITECTURE_DIAGRAMS.md)。
>
> **使用方式**：复制 §"Prompt 全文"整段粘贴给具备长上下文 + Mermaid 输出
> 能力的大模型（GPT-5 / Claude Opus 4 / Gemini 2.5 Pro 等），即可获得 1 张
> 总览图 + 8 张算法子图与解读。
>
> **维护要求**：当出块双轨 / RL 网络 / 商业化 ML scaffolding / lifecycle
> 编排器的实现发生增减时，同步更新 §"Prompt 全文"中的事实包；行号变化
> 不要求严格同步，但模块名、阈值、默认值、特性开关默认值必须与代码一致。

## 适用场景

- 重新生成 [`ALGORITHM_ARCHITECTURE_DIAGRAMS.md`](./ALGORITHM_ARCHITECTURE_DIAGRAMS.md)
  以反映算法栈变化
- 给 AI / 算法 / 数据协作者一份"算法地图"，即使不读源码也能定位每个模型
  的位置、依赖、上线路径
- 派生用法：只画一个子系统（如只画"商业化 ML 栈"或"出块双轨"）
- 算法评审材料：每个新模型 onboarding 时附此图谱

## 设计原则

1. **算法是策略不是工程**：图必须以"模型 / 输入 / 输出 / 阈值 / 反馈"为
   主线，而不是文件依赖；文件名只在节点尾部用作锚点。
2. **诚实标注成熟度**：scaffolding / opt-in 的 ML 模块必须用虚线或 `flag:`
   标注；规则版决策与 ML 决策不能并列画为已稳定。
3. **反馈环显式画出**：玩家信号 → 算法 → 决策 → 用户反应 → 信号更新，是
   OpenBlock 算法栈的核心闭环，每个子图都要回答"它如何回流到下一轮"。
4. **三处复述红线**：在角色定义、约束清单、自检清单三处重复声明"诚实标注、
   不发明模型、不写中间态"，提高一次成功率。

---

## Prompt 全文

````markdown
# 角色

你是一位资深机器学习与游戏算法架构师，擅长把多模型、多策略系统拆解为
信号→算法→决策→反馈的闭环图。你的产出物用于公开技术文档与算法评审，
必须严格基于"事实包"中给出的模块和默认值，**不得发明不存在的模型、
不得编造网络结构、不得猜测训练超参，不得把 scaffolding 画成已稳定上线**。

# 任务

为开源项目 **OpenBlock**（休闲方块益智 + 自适应出块 + 强化学习 +
可插拔商业化平台）生成一套**算法与策略架构图**，用 Mermaid 语法输出，
并配以简短解读。要求覆盖 §4 列出的 1 张总览图 + 8 张算法子图，每张图
独立、可编译、可读。

# §1 项目算法定位

> OpenBlock 算法栈由四类协同算法构成：① 出块双轨（启发式 / 生成式
> Transformer，含统一护栏与回退）；② Gameplay RL 训练栈（PPO + 残差
> CNN + DockBoardAttention，含多任务辅助头与 Eval Gate）；③ 商业化模型
> （线性加权规则版 + 一组 opt-in 的 ML scaffolding：calibration / explorer
> / MTL / ZILN LTV / LinUCB / survival / drift）；④ 玩家画像与生命周期
> 编排（PlayerProfile + AbilityVector + lifecycleSignals + Orchestrator）。
> 所有算法以**信号回流**串成闭环：玩家行为 → 画像 → 出块/商业化决策
> → 用户反应 → 画像更新。

# §2 事实包（必须严格采用，禁止增删模型名与默认值）

> 行号仅供溯源，不要在图标签里引用行号；阈值与默认值必须与代码一致。

## 2.1 信号采集层（Player & Context Signals）

**`PlayerProfile`**（`web/src/playerProfile.js`）
- 角色：实时玩家画像 = 步级技能平滑 + 心流三态 + 挫败/近失 + 节奏 + 长周期
  `historicalSkill / trend / confidence` + 会话环 + segment5 + playstyle
- 关键机制：
  - **贝叶斯式快收敛**：前 5 步用 `fastConvergenceAlpha=0.35`，后续用
    `smoothingFactor=0.15`
  - **历史技能**：会话均值 EWMA decay `0.85` + EWLS 回归 trend + 24h 衰减
  - **segment5 规则分箱**：E/D/C/B/A，阈值如 `skill > 0.82 → E`
  - **存储**：`localStorage:openblock_player_profile`
- 未实现：IRT 模型不存在

**`AbilityVector`**（`web/src/playerAbilityModel.js`）
- 角色：5 维能力向量统一层（skillScore / controlScore / clearEfficiency /
  boardPlanning / riskTolerance），附 confidence / playstyle / flowState
- 配置版本：`ABILITY_VECTOR_VERSION = 2`
- 分档阈值：`riskHigh=0.72`、`skillExpert=0.78`
- 消费方：spawnModel(behaviorContext) / commercialModel(`_abilityBias`) /
  commercialFeatureSnapshot(ability 字段)

**`lifecycleSignals`**（`web/src/lifecycle/lifecycleSignals.js`）
- 角色：阶段（S0~S4）+ 统一 churn 风险（三源 blend）+ unifiedRisk
- churn blend 默认权重：predictor `0.45` / maturity `0.35` / commercial `0.20`
- churn 档位阈值：critical `0.70` / high `0.50` / medium `0.30` / low `0.15`

**`CommercialFeatureSnapshot`**（`web/src/monetization/commercialFeatureSnapshot.js`）
- `SCHEMA_VERSION = 1`，29 项字段（persona / realtime / lifecycle / adFreq /
  ltv / ability / commercial）
- 摘要：FNV-1a 哈希；存储位置：内存 + 各模块 `localStorage` key
- 主要消费方：drift monitor / actionOutcomeMatrix / bandit

## 2.2 出块双轨（Spawn Engine）

**启发式轨道（rule）**
- `web/src/adaptiveSpawn.js`：12 信号融合 → `adaptiveStress` → 10 档 profile
  之间 `interpolateProfileWeights`，产出 `spawnHints`（combo / multiClear /
  rhythm / sessionArc / delight 等）
- `web/src/bot/blockSpawn.js`：`generateDockShapes` 两阶段加权抽样 + 机动性
  + `fill ≥ 0.52` 时序贯可解 DFS
- 关键阈值：`MAX_SPAWN_ATTEMPTS=22`、`FILL_SURVIVABILITY_ON=0.52`、
  `SURVIVE_SEARCH_BUDGET=14000`、`CRITICAL_FILL=0.68`、`PC_SETUP_MIN_FILL=0.45`
- 输出：3 个 shape + `_spawnDiagnostics`

**生成式轨道（model-v3 / SpawnTransformerV3）**
- 路由：`POST /api/spawn-model/v3/predict`（`server.py`）
- 模型：`rl_pytorch/spawn_model/model_v3.py`，`nn.TransformerEncoder` 主干 +
  自回归 joint + feasibility head + playstyle embedding + LoRA-ready
- 输入：`board` + `context(24)` + `behaviorContext(56)` + `history(3×3 shape
  index)` + `temperature` + `topK` + `targetDifficulty` + `playstyle` +
  `userId(LoRA)` + `enforceFeasibility`
- 默认采样：`temperature=0.8` / `topK=8`
- 词表：`SHAPE_VOCAB` 28 个

**双轨融合 / 切换**
- 切换方式：硬切换（`localStorage:ob_spawn_mode` ∈ {`'rule'`, `'model-v3'`}）
  ——**没有运行时加权融合，没有独立置信度门**
- 统一护栏：`validateSpawnTriplet`（≥3 块、无重复、`canPlaceAnywhere`、
  最低机动性、`fill≥FILL_SURVIVABILITY_ON` 时序贯可解）
- 失败回退：V3 失败或异常 → `rule-fallback`，记录 `fallbackReason`
- 颜色对齐：`rl_pytorch/dock_color_bias.py` 与 web 同色偏置

## 2.3 Gameplay RL 训练栈（与出块 Transformer 解耦）

**算法家族（实际代码）**
- 主路径：**PPO + GAE**（`rl_pytorch/train.py` + `rl_backend.py`）
- MLX 路径：**REINFORCE + 价值基线**（`rl_mlx/train.py`）
- DQN / SAC：**未作为主编排实现**（手册写明不采用 DQN）
- Self-play：Python 自博弈 + 可选浏览器 replay buffer
- AlphaZero / MCTS：**可选**（`rl_pytorch/mcts.py`、`spawn_predictor.py`）

**网络结构**
- 主干：`ConvSharedPolicyValueNet`（`rl_pytorch/model.py`），CNN 棋盘编码 +
  **DockBoardAttention** + **DockPointEncoder**（**Gameplay RL 不使用
  TransformerEncoder**，TransformerEncoder 仅 SpawnV3 用）
- 多任务辅助头：`board_quality_head` / `feasibility_head` / `survival_head`
  / `topology_aux_head` / `clear_pred_head`

**状态 / 动作 / 奖励**
- 状态维度：181
- 动作：15 维 ψ(a)，合法动作数可变
- 奖励：simulator + `shared/game_rules.json` shaping

**训练管线关键词**
- PPO 多 epoch + clipping
- GAE + outcome 混合价值
- 探索：softmax 温度 + Dirichlet 噪声（**非** ε-greedy）
- 在线评估：Ranked Reward + EvalGate
- 浏览器 replay buffer → PPO flush

**导出与上线**
- Checkpoint：`rl_pytorch/openblock_rl.pt`
- 推理：HTTP `POST /api/rl/*`
- ONNX：**仓库内未实现 / 未入库**

## 2.4 商业化核心模型 `commercialModel`

- 路径：`web/src/monetization/commercialModel.js`
- 结构：**线性加权 + clamp**，**非深度学习**
- 输出：`payerScore` / `iapPropensity` / `rewardedAdPropensity` /
  `interstitialPropensity` / `churnRisk` / `adFatigueRisk` / `guardrail` /
  `recommendedAction` / `explain`
- 决策阈值（`recommendedAction`）：iap≥`0.68` / rewarded≥`0.55` /
  interstitial≥`0.5` / churn≥`0.62` 或 payer<`0.35` → `task_or_push`
- guardrail 默认：
  - `protectPayerScore=0.68`
  - `suppressInterstitialChurnRisk=0.62`
  - `suppressInterstitialFatigue=0.55`
  - `suppressRewardedFatigue=0.72`
  - `suppressAllFatigue=0.82`
- LTV 归一：`ltvNormMax=20`
- ability 偏置：`_abilityBias` 幅度约 ±`0.12~0.18`，flag `abilityCommercial`
  默认 ON
- `shouldAllowMonetizationAction`：`allowAction` 默认阈值 `0.45`

## 2.5 商业化 ML Scaffolding（opt-in，多数 flag 默认 OFF）

> 这一组在仓库以"骨架 + 推理路径 + 默认参数 = identity/baseline"形式入库；
> 真训练在仓库外离线完成后注入参数。绝对**不要画成已稳定上线**。

**LTV 模型**
- `ltvPredictor.js`：规则 + 线性乘子（segment ARPU / channel coeff /
  base LTV），置信度 `CONF_HIGH=30 / CONF_MEDIUM=8`
- `ml/zilnLtvModel.js`：ZILN 推理 scaffolding，`predictZilnLtv` /
  `setZilnParams`；未注入参数时返回默认推断；**前端不训练**

**校准 `ml/calibration/propensityCalibrator.js`**
- 方法：isotonic / Platt / identity；默认 identity
- 注入：`setCalibrationBundle`

**ε-Greedy 探索器 `monetization/explorer/epsilonGreedyExplorer.js`**
- 默认 `DEFAULT_EPSILON=0.05`，每用户每小时探索 cap `6`

**LinUCB Contextual Bandit `ml/contextualBandit.js`**
- 常量：`DEFAULT_DIM=8` / `DEFAULT_ALPHA=0.5` / `FLUSH_EVERY_N=100`
- 状态存储：`localStorage:openblock_linucb_state_v1`
- API：`selectAction` / `updateBandit` / `buildBanditPolicyForAdInsertion`

**多任务编码器 `ml/multiTaskEncoder.js`**
- 结构：线性 encoder → latent 16 → ReLU → 每任务 sigmoid head
- 默认权重：identity-style；flag `multiTaskEncoder` 默认 **OFF**

**价格弹性 `ml/priceElasticityModel.js`**
- 折扣候选：`DISCOUNT_CANDIDATES=[0, 0.05, 0.1, 0.15, 0.2]`
- `recommendDiscount`：在候选上最大化期望收入
- DML / EconML：仓库**无**离线训练脚本，仅文档讨论

**Survival Push 时机 `ml/survivalPushTiming.js`**
- 默认基线生存曲线 + `recommendPushTime(threshold=0.7, horizon=21)`
- 未注入 β 时 `hazardScore=1`

**漂移监控 `quality/distributionDriftMonitor.js`**
- 阈值：KL `>0.10` 建议重训、`>0.25` 强烈建议下线
- bins：`HIST_BINS=10`
- 触发：`commercialModel` 在 flag `distributionDriftMonitoring` 时
  `recordSnapshotForDrift`，flag 默认 ON

**模型质量 `quality/modelQualityMonitor.js` + `quality/actionOutcomeMatrix.js`**
- PR-AUC / Brier 评估；action × outcome 矩阵采集

**注意（缺陷向事实，但仍要画）**
- `paymentPredictionModel.js` 的 `extractFeatures` 中 `avg_session_duration`
  使用 `Math.random()*300+60` ——**占位**，非真实数据，需在图上以注释体现

## 2.6 商业化决策与执行

**规则引擎 `strategy/strategyEngine.js`**
- 流程：`filter` 规则 → `_renderAction` → 排序（active 优先 → priority 高=3）
  → `buildWhyLines`

**频控 `adTrigger.js`**
- rewarded：`maxPerGame=3` / `maxPerDay=12` / `cooldownMs=90000`
- interstitial：`maxPerDay=6` / `cooldownMs=180000` /
  `minSessionsBeforeFirst=3`
- 体验分：`_calcExperienceScore`，休养期 `score < 60`
- 心流护栏：`FLOW_GUARD_FRUSTRATION_MAX=2`
- 认知疲劳：`COGNITIVE_FATIGUE_REACTION_X=1.5` /
  `COGNITIVE_FATIGUE_BASELINE_MS=1500`
- LTV shield：`lifetimeSpend≥50` 或 VIP `T2~T5`，插屏跳过概率 `0.7`

**决策包装 `commercialPolicy.js`**
- 流程：`buildCommercialModelVector` → 可选 `wrapWithExplorer`
  （ε=`0.05`）→ flag `actionOutcomeMatrix` 时 `recordRecommendation`
- 候选动作数：`ACTION_CANDIDATES=22`

**广告插入 `ad/adInsertionRL.js`**
- 实质为**规则版 scaffolding**，flag `adDecisionEngine` 默认 OFF
- 流水线：注入 policy → `adInsertionBandit` → `_ruleBasedPolicy`
- 规则跳过：`fatigueRisk≥0.8 || churnRisk≥0.7` → skip
- 奖励：filled `+1` / rewarded `+0.5` / abandon `-1.5` / fatigue `-0.3`

**实验框架**
- `experimentPlatform.js` / `abTestManager.js` / `abTest.js`

## 2.7 玩家生命周期编排

**`lifecycleOrchestrator.js`**
- 钩子：`onSessionStart` / `onSessionEnd`，发射 `lifecycle:*` 事件
- engagement 计算：`0.6 * min(1, duration/300s) + 0.4 * (1 - miss/placement)`
- 成熟度：`updateMaturity` 每局结束写入

**商业化生命周期 `lifecycleAwareOffers.js`**
- winback：`daysSinceLastActive ≥ 7` → `triggerOffer('winback_user', ...)`
- 复购：`getRecommendedOffer(daysSinceInstall, totalSessions)`，复购窗口 7 天
- 高流失触发：`unifiedRisk ≥ 0.5` 或 churnLevel ∈ {high, critical} →
  `lifecycle:churn_high`

## 2.8 后端辅助算法

- `monetization_backend.py`：`_compute_user_profile` 计算 whale_score（
  whale≥`0.60`、dolphin≥`0.30`）
- `services/monitoring/anomaly.py`：滑动窗口 z-score，默认 `threshold=3.0`

## 2.9 跨模块协同（必须在总览图体现）

| 链路 | 说明 |
|---|---|
| PlayerProfile → adaptiveSpawn → blockSpawn | 画像驱动 stress 与 spawnHints |
| AbilityVector → spawnModel(behaviorContext) | 5 维能力进入 V3 输入 |
| AbilityVector → commercialModel(`_abilityBias`) | 调 payer/churn/插屏/激励/IAP |
| AbilityVector → CommercialFeatureSnapshot | 进入 drift / bandit / outcome |
| lifecycleSignals → adaptiveSpawn | 出块感知 winback / maturity |
| commercial churn → unified churn(blend 0.20) | 商业化贡献 churn 信号 |
| Gameplay RL ⫛ 真人主局 | 解耦：真人主局**不**走 RL 选块 |
| SpawnV3 ⫛ Gameplay RL | 不同模型与路由（`/api/spawn-model/v3/*`
  vs `/api/rl/*`） |

## 2.10 上线路径速查

| 能力 | 路由 |
|---|---|
| Spawn V2 predict | `POST /api/spawn-model/predict` |
| Spawn V3 predict / train / personalize | `POST /api/spawn-model/v3/*` |
| Gameplay RL | `POST /api/rl/*` |
| 商业化 user profile | `GET /api/mon/user-profile/{userId}` |
| 商业化 strategy log | `POST /api/mon/strategy/log` |

# §3 设计原则（必须在图中体现的不变量）

1. **诚实标注成熟度**：稳定 = 实线、scaffolding / opt-in = 虚线 + `flag:`
   边标签；`paymentPredictionModel` 的会话时长 random 占位必须在图上以
   注释（`note`）显式标出。
2. **闭环显式**：每个算法子图必须画出"用户反馈 → 信号回流"那条边。
3. **解耦边界**：Gameplay RL 与真人主局分离；SpawnV3 与 Gameplay RL 是
   两个独立的模型与路由，禁止共享主干。
4. **决策路径默认安全**：观测能力（drift / outcome / quality）默认 ON、
   决策能力（calibration / explorer / MTL / bandit / 广告 / IAP）默认 OFF
   或 ε 极小，需在边标签上反映。
5. **共享数据源**：`shared/game_rules.json` + `shared/shapes.json` 同时被
   Web、PyTorch、MLX 加载（出块 + RL 共享）。
6. **无反向依赖**：商业化 / lifecycle 不得反向调用 game.js / grid.js。

# §4 输出规格

按以下顺序输出 **1 张总览图 + 8 张算法子图**。每张图前用一句话说明它
回答了什么问题，图后用 3–6 行解读关键节点 / 边 / 阈值 / 反馈环。

## 总览图：算法栈分层 + 反馈环

- 用 `flowchart TB` + 横向 subgraph
- 4 层：① 信号采集（PlayerProfile / AbilityVector / lifecycleSignals /
  CommercialFeatureSnapshot）→ ② 算法核心（出块双轨 / Gameplay RL /
  商业化模型 / Lifecycle 编排）→ ③ 决策与策略（strategyEngine /
  adTrigger / commercialPolicy / lifecycleAwareOffers）→ ④ 模型训练与监控
  （PyTorch trainer / SpawnV3 trainer / drift / quality）
- 底部一条带列出"反馈环 / 解耦边界 / 默认安全 / 共享数据源"4 条算法侧
  设计原则
- 节点不要写文件名，统一用算法 / 模型语言

## 图 1：出块双轨决策架构

- 上半启发式轨：12 信号 → `adaptiveStress` → 10 档 profile + spawnHints →
  `generateDockShapes`（两阶段抽样 + 机动性 + 序贯可解 DFS）
- 下半生成式轨：`buildSpawnModelContext`（24 维 + 56 维 + history）→
  `/api/spawn-model/v3/predict`（SpawnTransformerV3 + LoRA） →
  `validateSpawnTriplet` → V3 失败 → `rule-fallback`
- 中央：`localStorage:ob_spawn_mode` 硬切换；统一护栏

## 图 2：SpawnTransformerV3 网络与推理流

- 输入层：board / context24 / behavior56 / history × 3 / playstyle / userId
- 主干：`nn.TransformerEncoder` + 自回归 joint head + feasibility head +
  playstyle embedding + LoRA adapter（按 userId 切换）
- 解码：温度 `0.8` + topK `8` + 可行性 mask
- 输出：3 形状 ID（autoregressive）+ feasibility score
- 反馈：用户落子 → behaviorContext / playerProfile 回流 → 下一轮再推

## 图 3：Gameplay RL 训练栈（PPO + GAE + Eval Gate）

- 数据来源：simulator(self-play) + 浏览器 replay buffer（HTTP `/api/rl/*`）
- 主干：`ConvSharedPolicyValueNet`（CNN 棋盘 + DockBoardAttention +
  DockPointEncoder）
- 多任务辅助头：board_quality / feasibility / survival / topology_aux /
  clear_pred
- 训练：PPO 多 epoch + clipping + GAE + outcome 混合 value
- 探索：softmax 温度 + Dirichlet 噪声
- 评估：Ranked Reward + EvalGate（不通过不上线）
- 上线：`openblock_rl.pt` → `/api/rl/select_action`

## 图 4：玩家画像与能力评估

- `PlayerProfile`：raw skill（think/clear/combo/miss/load 加权）→ Bayes 平滑
  → historical EWMA(decay 0.85) → trend EWLS → confidence(局数/20 + 24h 衰减)
  → segment5 规则分箱
- `AbilityVector`：5 维能力（skill / control / clearEfficiency / boardPlanning
  / riskTolerance）+ playstyle + flowState
- 反馈：`recordSpawn` / `place` / `_feedbackBias` 闭环
- 消费方：spawnModel / commercialModel / featureSnapshot

## 图 5：商业化核心决策（线性规则 + guardrail + abilityBias）

- 输入：persona / realtime / LTV / 频控历史 / AbilityVector
- 处理：线性加权 + clamp → 4 倾向（payer / iap / rewarded / interstitial）
  + churnRisk + adFatigueRisk
- guardrail 链：protectPayerScore / suppressInterstitialChurnRisk /
  suppressInterstitialFatigue / suppressRewardedFatigue / suppressAllFatigue
- abilityBias：±0.12~0.18 调整 4 倾向
- 输出：`recommendedAction` ∈ {iap / rewarded / interstitial / task_or_push}

## 图 6：商业化 ML Scaffolding 栈（opt-in）

- 校准链：commercialModel.propensity → propensityCalibrator(isotonic/Platt) →
  最终倾向（默认 identity，flag `propensityCalibration`）
- 探索链：commercialPolicy → epsilonGreedyExplorer(ε=0.05) → 输出 action +
  IPS 权重
- bandit：LinUCB(α=0.5, dim=8) → `selectAction` / `updateBandit`，用于广告插入
- ZILN LTV：predictZilnLtv → 默认 baseline → setZilnParams 注入离线参数
- Survival：recommendPushTime(threshold=0.7, horizon=21)
- 多任务编码器：linear → latent16 → 4 任务 sigmoid head（flag 默认 OFF）
- 漂移：distributionDriftMonitor.recordSnapshot → KL > 0.10 警告
- 质量：modelQualityMonitor(PR-AUC/Brier) + actionOutcomeMatrix

## 图 7：决策与执行管线（rule + freq + policy + adInsertion）

- `strategyEngine.evaluate`：filter → render → sort(active 优先 → priority)
- `adTrigger`：rewarded(3/局, 12/日, 90s) / interstitial(6/日, 180s, 首 3 局
  禁) / 体验分 < 60 休养 / LTV shield(>50 或 VIP T2-T5)
- `commercialPolicy`：vector → wrapWithExplorer(ε=0.05) → recordRecommendation
- `adInsertionRL`：注入 policy → adInsertionBandit → ruleBased（fatigue ≥ 0.8
  或 churn ≥ 0.7 → skip）
- 反馈：ad/iap outcome → adTrigger 频控更新 + actionOutcomeMatrix

## 图 8：生命周期信号 → 编排 → 策略

- 信号：lifecycleSignals.snapshot{stage, churn(blend 0.45/0.35/0.20),
  unifiedRisk, churnLevel}
- 编排：lifecycleOrchestrator(onSessionStart / onSessionEnd) →
  engagement = 0.6×min(1,duration/300)+0.4×(1-miss/placement) → updateMaturity
- 策略：lifecycleAwareOffers (winback ≥7d / 复购 7d / churn_high(≥0.5))
- 事件：`lifecycle:session_start/_end/_offer_available/_churn_high/_first_purchase`
- 反馈：用户接受/拒绝 offer → analyticsTracker → 下一轮 churn blend 重算

# §5 Mermaid 编码约定

- 全部用 `flowchart TB` 或 `flowchart LR`（图 2 / 图 3 推荐 `flowchart TB`）
- 节点 ID 用 `camelCase` 短名（如 `playerProfile`、`spawnV3`），label
  用中文 + 算法语言（**不**写完整文件路径，避免噪声）
- 子系统用 `subgraph "<层名>"` 包裹，end 闭合
- 总览图 / 复杂层级图建议加 YAML 前置 `config: layout: elk`，避免嵌套
  `direction LR` 在默认 dagre 渲染器下被忽略
- 边类型语义：
  - 实线 `-->`：稳定数据流 / 主链路
  - 虚线 `-.->`：scaffolding / opt-in / 反馈回流
  - 粗线 `==>`：跨子系统主流程
  - 边标签可写 `flag:xxx` 表示 feature flag 控制
- 阈值用 `<br/>` 写在节点 label 第二行（如
  `adTrigger["adTrigger<br/>rewarded 3/局 · 12/日"]`）
- 同一 subgraph 内禁止出现完整文件路径，避免噪声
- 每张图节点数控制在 12–25 之间（总览图可放宽到 30），超量需要拆图

# §6 禁止与红线

1. **不要发明** §2 列表之外的模型、算法、特征、阈值、路由名。
2. **不要把 scaffolding 画成已稳定**：calibration / explorer / MTL / ZILN /
   LinUCB / survival / drift / adInsertionRL 必须用虚线或 `flag:` 显式
   标注 opt-in。
3. **不要画反向依赖**：商业化 / lifecycle 不得反向调用 game.js / grid.js。
4. **不要把已归档的算法**（`docs/archive/` 下任何 RL 历史版本、
   PaymentPredictionModel 的 random 占位作为"实际特征"）画成主链路。
5. **不要混淆 SpawnV3 与 Gameplay RL**：两者是不同模型 + 不同路由 + 不同
   主干（V3 用 TransformerEncoder，RL 用 CNN+DockAttention）。
6. **不要写中间态**："Phase 1-4 实施中 / v1.49.x 待发布"等 sprint 语言禁止
   出现在图标签里。
7. **不要把 Feature Flag 当作模块**画，应作为门控属性体现在边的标签上
   （如 `-. flag:adInsertionRL .->`）。

# §7 自检清单（输出前对照）

- [ ] 1 张总览图 + 8 张算法子图全部产出，且每张图前有问题陈述、后有解读
- [ ] 所有模型 / 算法 / 阈值 / 路由都能在 §2 找到原文
- [ ] scaffolding 模块全部用虚线 / `flag:` 标注，未画成已稳定
- [ ] 每张子图都画出"反馈回流"那条边
- [ ] 出块双轨标注硬切换（不是加权融合）+ 统一护栏 + rule-fallback
- [ ] Gameplay RL 与 SpawnV3 在图中是两个独立模型，没有共享主干
- [ ] 商业化决策图体现 guardrail 链 + abilityBias
- [ ] 生命周期图体现三段式（信号 → 编排 → 策略）+ churn blend 默认权重
- [ ] 全部 Mermaid 图可在 mermaid.live 直接渲染（无语法错误）
- [ ] `paymentPredictionModel` 的 random 占位以注释形式标出

# §8 输出格式

```
## 总览图：<问题陈述>
```mermaid
---
config:
  layout: elk
---
flowchart TB
  ...
```
**解读**：3–6 行说明算法分层、反馈环、解耦边界、默认安全。

## 图 1：<问题陈述>
```mermaid
flowchart TB
  ...
```
**解读**：3–6 行说明关键节点 / 边 / 阈值 / 反馈环。

## 图 2：...
（同上）

...

## 图 8：...

## 自检结果
- [x] ...
- [x] ...
```

现在请基于以上事实包，输出 1 张总览图 + 全部 8 张算法子图与解读。
````

---

## 派生用法

| 场景 | 改动建议 |
|---|---|
| 只要总览图 | 删除 §4 的图 1–8，把总览节点上限放宽到 40 |
| 只画一个子系统 | 把 §2 中对应小节剥离作为独立 prompt（如只喂 §2.2/§4图1，仅出双轨图） |
| 改用 PlantUML / draw.io | 把 §5 的 Mermaid 约定换成对应语法 |
| 算法评审材料 | 在 §4 末尾追加："为每张图生成 SLI/SLO 卡片：输入分布、阈值、回退策略、漂移预警" |
| 自动审查输出 | 在 §7 后追加："输出 JSON 形式的 audit：每张图节点数 / 边数 / 是否含 scaffolding / 反馈环条数" |

## 关联文档

- [`ALGORITHM_ARCHITECTURE_DIAGRAMS.md`](./ALGORITHM_ARCHITECTURE_DIAGRAMS.md)
  —— 本 prompt 的当前输出物
- [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md) —— 算法手册主入口
- [`ALGORITHMS_SPAWN.md`](./ALGORITHMS_SPAWN.md) —— 出块双轨权威源
- [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) —— RL 训练栈权威源
- [`ALGORITHMS_MONETIZATION.md`](./ALGORITHMS_MONETIZATION.md) —— 商业化算法手册
- [`COMMERCIAL_MODEL_DESIGN_REVIEW.md`](./COMMERCIAL_MODEL_DESIGN_REVIEW.md)
  —— 商业化模型架构设计
- [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md) —— 出块算法三层模型
- [`../architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md`](../architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md)
  —— 系统架构图（系统侧的姊妹篇）
- [`../architecture/ARCHITECTURE_DIAGRAM_PROMPT.md`](../architecture/ARCHITECTURE_DIAGRAM_PROMPT.md)
  —— 系统架构图 prompt（本 prompt 的姊妹篇）
