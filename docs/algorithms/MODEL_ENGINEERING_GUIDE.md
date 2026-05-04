# OpenBlock 模型工程总览

> 面向算法工程师的统一模型文档。  
> 本文把项目内所有“模型化”系统放到同一张工程地图中：强化学习、出块生成、自适应难度、玩家能力评估、商业化决策、LTV、策略引擎与 PCGRL。  
> 目标不是替代各分册，而是统一说明问题定义与假设、建模方法与优化目标、特征与网络结构、训练/优化算法、线上应用示例和作用机制。

---

## 目录

1. [模型系统边界](#1-模型系统边界)
2. [共同工程假设](#2-共同工程假设)
3. [端到端数据流](#3-端到端数据流)
4. [RL 落子智能体](#4-rl-落子智能体)
5. [Spawn 出块生成模型](#5-spawn-出块生成模型)
6. [AdaptiveSpawn 自适应难度模型](#6-adaptivespawn-自适应难度模型)
7. [PlayerProfile 与 AbilityVector](#7-playerprofile-与-abilityvector)
8. [CommercialModelVector 与商业化决策](#8-commercialmodelvector-与商业化决策)
9. [LTV 与运营策略模型](#9-ltv-与运营策略模型)
10. [PCGRL 与候选生成](#10-pcgrl-与候选生成)
11. [模型契约与特征字典](#11-模型契约与特征字典)
12. [训练、评估与上线检查](#12-训练评估与上线检查)

---

## 1. 模型系统边界

OpenBlock 里“模型”分为三类，不应混用。

| 类别 | 子系统 | 当前实现 | 是否学习参数 | 线上职责 |
|------|--------|----------|--------------|----------|
| 决策智能体 | RL Bot | PyTorch PPO / 浏览器线性 REINFORCE / MLX 训练分支 | 是 | Bot 自动落子、自博弈训练 |
| 生成模型 | SpawnTransformer V2/V3 | PyTorch Transformer + 规则回退 | 是 | 生成下一轮 3 个候选块 |
| 规则评分模型 | PlayerProfile、AbilityVector、CommercialModelVector、LTV、AdaptiveSpawn、策略引擎 | 加权公式、EMA、阈值树、可解释护栏 | 当前不是，保留 `modelBaseline` 接口 | 真人路径的难度、画像、商业化与 UI 解释 |

关键边界：

- 真人对局的主链路是 `game.js → adaptiveSpawn.js → blockSpawn.js`，RL Bot 不直接改真人出块。
- RL 训练只能使用可见棋盘、候选块和公共规则，不允许读 adaptiveSpawn 内部权重或未来出块。
- 商业化模型只能做“动作门控与排序”，不能绕过频控、合规和体验护栏。
- SpawnTransformer 生成失败、输出非法或服务不可用时必须回退规则出块。

---

## 2. 共同工程假设

这些假设决定了当前为什么大量使用规则模型 + 可解释向量，而不是把所有问题都交给深度模型。

| 假设 | 含义 | 影响 |
|------|------|------|
| 棋盘小但组合爆炸 | 8×8 棋盘、3 个候选块、顺序放置导致状态树极大 | RL 需要合法动作枚举、价值基线、搜索 teacher 和辅助监督 |
| 真人路径需低延迟 | 浏览器和小程序需本地可用，弱网时不能阻塞 | PlayerProfile、AbilityVector、AdaptiveSpawn 和 CommercialModelVector 当前端侧规则优先 |
| 冷启动强约束 | 新玩家缺少历史会话与付费标签 | 画像和商业化先用可解释特征，离线模型只作为 baseline 融合 |
| 数据标签稀疏 | 付费、流失、长期能力标签滞后 | LTV、商业化与能力模型需要保留可回标的样本导出 |
| 规则需跨端一致 | Web、小程序、Python RL 要共享形状、计分、特征口径 | `shared/game_rules.json`、`shared/shapes.json` 是核心事实源 |
| 体验优先于单点收益 | 广告/IAP 不能破坏心流，出块不能制造无解 | 所有推荐动作必须通过 guardrail 和可行性检查 |

### 2.1 建模方法选型对比

OpenBlock 不把所有算法统一成一种模型，而是按问题类型选择“最低复杂度且可上线”的方法。

| 问题 | 当前方法 | 可替代方法 | 当前方法优势 | 当前方法局限 | 升级触发条件 |
|------|----------|------------|--------------|--------------|--------------|
| Bot 落子 | PPO + GAE + 辅助监督 + 搜索蒸馏 | 纯 MCTS、AlphaZero 式自博弈、模仿学习 | 能从自博弈中持续改进，兼顾策略和值函数 | 训练成本高，checkpoint 与特征维度强绑定 | 固定 seed 胜率平台期、搜索 teacher 明显优于 policy |
| 出块生成 | 规则加权 + 可解性过滤 + 可选 SpawnTransformer | PCGRL、扩散/Transformer 生成、手工关卡表 | 延迟低、可解释、失败可回退 | 多样性和长期节奏需人工调参 | 规则轨重复率高或目标难度误差不可接受 |
| 自适应难度 | PlayerProfile/AbilityVector → stress/hints | 上下文 bandit、序列模型、POMDP | 冷启动稳定、策划可调、端侧运行 | 个体长期差异建模有限 | 同能力分层下局长/挫败率方差仍过大 |
| 玩家能力 | EMA + 拓扑特征 + AbilityVector | LightGBM、RNN/Transformer 序列模型、贝叶斯技能评级 | 可解释、少样本可用、可写入回放 | 未来表现预测能力有限 | 回放样本足够且未来分数/风险标签稳定 |
| 商业化动作 | CommercialModelVector + 规则护栏 | Uplift model、Contextual Bandit、RL 排序 | 不破坏频控和合规，运营可解释 | 收益最优性受规则限制 | 曝光/转化样本量足够且需要探索-利用平衡 |
| LTV | 启发式 LTV + 渠道/分群系数 | 生存模型、GBDT、深度序列模型 | 冷启动和运营解释友好 | 校准依赖人工回归 | D7/D30 标签积累、渠道 CPI 决策需要更高精度 |

### 2.2 优化目标与护栏原则

各模型的优化目标不同，不能用单一指标替代：

| 模型 | 主目标 | 约束/护栏 | 典型离线指标 | 典型在线指标 |
|------|--------|-----------|--------------|--------------|
| RL Bot | 最大化折扣回报、胜率、平均分 | 不读真人自适应内部权重；特征维度变更需重训 | seed 胜率、均分、熵、aux loss | Bot 体验、训练稳定性 |
| Spawn | 生成合法、可解、目标难度匹配的三连块 | 非法或不可解必须回退规则轨 | 合法率、可解率、重复率、目标 stress 误差 | 局长、挫败率、重开率 |
| AbilityVector | 估计能力、风险与解释 | 不替代原始 PlayerProfile；低置信时弱化影响 | 未来分数相关、风险 AUC、冷启动偏差 | DDA 稳定性、洞察可信度 |
| CommercialModelVector | 在收益、留存、心流之间做门控 | 不绕过频控、付费保护、恢复期和合规 | AUC、校准、护栏命中率、uplift | ARPDAU、留存、广告疲劳、投诉率 |

---

## 3. 端到端数据流

### 3.1 真人路径

```text
玩家落子
  ↓
game.js 记录 move / score / clear / topology
  ↓
PlayerProfile 更新技能、心流、挫败、风格、分群
  ↓
AbilityVector 聚合能力、风险、盘面规划
  ↓
adaptiveSpawn.resolveAdaptiveStrategy()
  ↓
blockSpawn.generateDockShapes()
  ↓
下一轮 dock + UI 洞察
```

作用机制：

- PlayerProfile 提供实时行为信号。
- AbilityVector 把行为、拓扑和局内统计聚合为统一能力向量。
- AdaptiveSpawn 将能力与压力映射为 `stress` 和 `spawnHints`。
- blockSpawn 在硬约束可解的前提下按权重采样形状。

### 3.2 RL 路径

```text
shared rules + simulator
  ↓
features.py / features.js 编码 s、ψ(a)、φ(s,a)
  ↓
PolicyValueNet / LinearAgent 选择动作
  ↓
simulator.step() 产出 reward、supervision signals
  ↓
PPO / REINFORCE 更新
  ↓
checkpoint / HTTP 推理服务
```

作用机制：

- RL 是独立智能体，用来学习落子策略。
- Python 训练路径用于高吞吐自博弈；浏览器路径用于演示、在线回合训练与远端模型调用。
- 搜索 teacher、拓扑辅助头和清行预测头为稀疏奖励提供稠密梯度。

### 3.3 商业化路径

```text
后端画像 + 前端 PlayerProfile + 广告频控 + LTV
  ↓
getCommercialModelContext()
  ↓
CommercialModelVector
  ↓
shouldAllowMonetizationAction()
  ↓
adTrigger / commercialInsight / strategyEngine
```

作用机制：

- LTV 与鲸鱼分估计用户长期价值。
- CommercialModelVector 同时估计 IAP、激励广告、插屏、流失和广告疲劳风险。
- 护栏决定能否展示，策略引擎决定展示什么和如何解释。

---

## 4. RL 落子智能体

### 4.1 问题定义

RL 将 OpenBlock 建模为有约束的离散 MDP：

$$
\mathcal{M} = (\mathcal{S}, \mathcal{A}(s), P, r, \gamma)
$$

- 状态 $s$：当前棋盘、候选 dock、分数/回合/拓扑等可见信息。
- 动作 $a$：选择一个未放置块并给出左上角放置坐标。
- 转移 $P$：放置和消行确定，dock 刷新随机或由模拟器策略决定。
- 奖励 $r$：分数增益、清行、存活、终局胜利与拓扑塑形。
- 目标：最大化期望折扣回报，同时提升胜率、平均分和生存步数。

### 4.2 特征

实现事实以 `shared/game_rules.json` 的 `featureEncoding` 为准：

| 编码 | 维度 | 内容 |
|------|------|------|
| `s` | 181 | 42 维标量 + 64 棋盘占用 + 75 dock 5×5 mask |
| `ψ(a)` | 12 | block index、位置、形状尺寸、清行潜力、风险等动作特征 |
| `φ(s,a)` | 193 | `[s; ψ(a)]` 拼接 |

拓扑扩展特征包括：

- `holes`：结合所有可出块形状后仍无法填充的空格数。
- `nearFullLines / close1 / close2`：只统计空格可被当前形状族填充的临消行/列。
- `rowTransitions / colTransitions`：占空切换次数，衡量破碎度。
- `wells`：列高度凹陷风险。
- `mobility`：当前候选块可落位数量。

### 4.3 网络结构

主干为 `ConvSharedPolicyValueNet`：

```text
s[181]
  ├─ scalars[42] ────────────────┐
  ├─ grid[64] → CNN + ResConv×2 ─┼─ concat → trunk[128]
  └─ dock[75] → DockBoardAttention / DockPointEncoder
                                      ↓
        ┌──────────────┬──────────────┬────────────────────────────┐
        ↓              ↓              ↓
     value_head     policy_head     auxiliary heads
      V(s)          logit(s,a)      board_quality / feasibility /
                                   survival / hole / clear_pred /
                                   topology_aux
```

关键设计：

- CNN 负责识别 8×8 棋盘空间模式。
- DockBoardAttention 让每个候选块读取棋盘空间特征，解决“哪个块补哪片区域”的组合问题。
- DockPointEncoder 是实验性替代编码，对形状点集坐标更敏感，但改变后需重训 checkpoint。
- 辅助头从 trunk 输出预测可解释的即时监督信号，降低纯回报学习方差。

### 4.4 优化目标

总损失可概括为：

$$
\mathcal{L} =
\mathcal{L}_{policy}^{PPO}
+ c_v \mathcal{L}_{value}
- c_e \mathcal{H}(\pi)
+ \sum_k c_k \mathcal{L}_{aux,k}
+ c_q \mathcal{L}_{distill}
$$

其中：

- `policy_loss`：PPO clipped surrogate；单 epoch 时退化为 REINFORCE-with-baseline。
- `value_loss`：GAE return 与 outcome target 的混合监督。
- `entropy`：维持探索，随训练退火。
- `board_quality_loss`：预测落子后盘面质量。
- `feasibility_loss`：预测剩余块是否全可放。
- `survival_loss`：预测后续可存活步数。
- `hole_aux_loss`：预测不可填充空洞风险。
- `clear_pred_loss`：预测本步清行类别。
- `topology_aux_loss`：预测落子后 8 维拓扑向量。
- `q_distill / visit_pi_distill`：从 beam/MCTS teacher 学习搜索偏好。

### 4.5 优化算法

训练流程：

1. 使用 `OpenBlockSimulator` 自博弈采集 episode。
2. 对每步合法动作构造 `φ(s,a)` 并采样动作。
3. 局终计算回报、GAE、ranked reward 和辅助标签。
4. 批量执行 PPO 更新，裁剪梯度和 logit。
5. 通过 EvalGate 与固定 seed 评估候选 checkpoint。

辅助机制：

- Curriculum：从低胜利阈值逐步提高。
- Ranked Reward：用滚动分位数解决绝对分数平台期。
- Beam / MCTS Teacher：为动作分布提供更强监督。
- Search Replay：重放困难轨迹，提高样本效率。

### 4.6 应用示例与作用机制

| 场景 | 调用 | 机制 |
|------|------|------|
| Python 训练 | `python -m rl_pytorch.train` | 高吞吐采样 + PPO 更新 |
| 浏览器远端推理 | `POST /api/rl/select_action` | 服务端返回动作，前端执行 |
| 浏览器在线训练 | `POST /api/rl/train_episode` | 上传轨迹，后端 replay buffer 累积后更新 |
| 搜索增强 | `POST /api/rl/eval_values` | 对候选后继局面估值，用于 lookahead |
| MLX 训练 | `python -m rl_mlx.train` | Apple Silicon 本地训练分支，结构更轻 |

---

## 5. Spawn 出块生成模型

### 5.1 问题定义

出块模型要在每轮生成三个候选形状：

$$
(s_1,s_2,s_3) \sim P(s_1,s_2,s_3 \mid board, profile, history)
$$

并满足硬约束：

- 三块形状不重复。
- 在高填充或压力状态下，三块组合必须存在顺序可行解。
- 不能明显制造无解、死局或不可解释的难度跳变。

软目标：

- 难度与玩家能力匹配。
- 提供可被填充的临消机会和多消机会。
- 控制形状多样性、节奏与 session arc。
- 避免分数膨胀、重复救援和过度放水。

### 5.2 规则轨

规则轨是默认线上路径：

```text
shape pool
  ↓
按 strategy/profile 计算 base weight
  ↓
结合 gapFills、multiClear、holeReduce、mobility 调整权重
  ↓
抽样 triplet
  ↓
顺序可解性与机动性检查
  ↓
失败则重采样，最终 fallback_simple
```

优化目标是多目标启发式：

$$
score(shape) =
w_f fillGap + w_c clearPotential + w_h holeRelief
+ w_m mobility + w_d diversity + w_s sessionFit
$$

其中权重来自 `adaptiveSpawn` 和 `shared/game_rules.json`。

### 5.3 SpawnTransformer V2/V3

SpawnTransformer 是可选 ML 轨。

| 版本 | 输入 | 输出 | 训练目标 | 线上机制 |
|------|------|------|----------|----------|
| V2 | 8×8 board、24 维 context、history、目标难度 | 三个槽位 shape logits、diversity、difficulty | CE + diversity + difficulty regression + anti-inflate | `/api/spawn-model/predict`，失败回退规则轨 |
| V3 | V2 输入 + playstyle、prev_shapes、自回归 teacher forcing | AR logits、feasibility、style 等多头 | CE_AR + diversity + difficulty + BCE feasibility + style loss | `/api/spawn-model/v3/*`，支持个性化和 LoRA |

网络结构：

```text
board encoder + context encoder + history embedding
  ↓
Transformer encoder
  ↓
shape heads / diversity head / difficulty head / feasibility head / style head
```

建模假设：

- 三块不是独立样本，必须保留联合分布或自回归依赖。
- ML 模型只负责偏好分布，硬约束仍由规则校验兜底。
- 线上若没有足够真实数据，规则轨仍是权威路径。

### 5.4 训练与评估

数据来源：

- 历史局面和真实出块结果。
- 规则轨生成的弱监督样本。
- 回放中的玩家结果，用于难度和风格标签。

评估指标：

- triplet 合法率。
- sequential solvability。
- 目标难度误差。
- 多样性与重复率。
- 后续若接真人 AB，观察留存、平均分、挫败率和重新开局率。

---

## 6. AdaptiveSpawn 自适应难度模型

### 6.1 问题定义

AdaptiveSpawn 不是神经网络，而是动态难度调节模型。目标是在不破坏公平性的前提下，把玩家状态映射为出块压力：

$$
stress =
scoreStress + difficultyBias + skillAdjust + flowAdjust
+ recoveryAdjust + frustrationRelief + comboAdjust + topologyAdjust
$$

### 6.2 输入特征

| 输入 | 来源 | 作用 |
|------|------|------|
| `skillLevel` / AbilityVector | PlayerProfile / AbilityVector | 能力越强，可承受更高难度 |
| `flowState` / `flowDeviation` | PlayerProfile | bored 加压，anxious 减压 |
| `frustrationLevel` | 连续未消行 | 触发救援或减压 |
| `boardFill` | 棋盘填充率 | 高填充提升风险 |
| `holes` | boardTopology | 空洞越多越需降低压力或提供修复块 |
| `runStreak` / combo | 对局节奏 | 控制爽感释放 |
| `sessionPhase` | 会话阶段 | 热身、峰值、末期采用不同曲线 |

### 6.3 输出与作用机制

AdaptiveSpawn 输出 `strategy`：

- `shapeWeights`：形状族采样权重。
- `clearGuarantee`：可消行候选数量倾向。
- `multiClearBias`：多消机会偏置。
- `holeRelief`：空洞修复压力。
- `spawnHints`：传给 blockSpawn 的节奏、combo、sessionArc 等提示。

作用机制是 `stress → profileBlend → weight profile`：在 10 档 profile 之间插值，避免难度突变。

---

## 7. PlayerProfile 与 AbilityVector

### 7.1 问题定义

玩家建模要实时估计：

- 当前技能水平。
- 操作稳定性。
- 消行效率。
- 盘面规划能力。
- 风险偏好与短期风险。
- 心流状态、玩法风格和数据置信度。

当前采用规则特征工程 + EMA + 可解释向量，原因是冷启动强、标签稀疏、端侧低延迟。

### 7.2 PlayerProfile

核心输入是每步行为：

```js
{
  thinkMs,
  cleared,
  lines,
  fill,
  miss
}
```

关键公式：

$$
rawSkill =
0.15\cdot thinkScore +
0.30\cdot clearScore +
0.20\cdot comboScore +
0.20\cdot missScore +
0.15\cdot loadScore
$$

$$
smoothSkill_t = smoothSkill_{t-1} + \alpha(rawSkill_t - smoothSkill_{t-1})
$$

历史融合：

$$
skillLevel = (1-histW)\cdot smoothSkill + histW\cdot historicalSkill
$$

### 7.3 AbilityVector

`AbilityVector` 是面向 UI、自适应和离线训练的统一输出层。

| 字段 | 含义 | 主要输入 |
|------|------|----------|
| `skillScore` | 综合能力 | `skillLevel` + 可选 modelBaseline |
| `controlScore` | 操作稳定性 | missRate、认知负荷、AFK、APM |
| `clearEfficiency` | 消行效率 | clearRate、comboRate、avgLines |
| `boardPlanning` | 盘面规划 | holes、fill、mobility、near clear |
| `riskTolerance` | 风险偏好 | fill、nearMiss、combo、recovery |
| `riskLevel` | 短期风险 | fill、holes、frustration、roundsSinceClear |
| `confidence` | 数据置信 | profile confidence、终身步数、局内步数 |

作用机制：

- `playerInsightPanel` 展示能力卡片和解释。
- `adaptiveSpawn` 使用能力向量修正难度。
- `moveSequence` 把能力快照写入回放，供离线训练。
- `buildAbilityTrainingDataset` 从会话构造样本，供未来 LightGBM/序列模型校准。

配置来源：`shared/game_rules.json → playerAbilityModel`。新增或调整 `AbilityVector` 权重、阈值、分档、baseline 融合和自适应减压门控时，只改该 JSON；代码消费配置并保留字段契约。

### 7.4 离线建模升级路径

可用 `AbilityVector.features` 训练：

- `skillScore` 校准模型：目标为未来 N 局平均分、清行率或胜率。
- `riskLevel` 预测模型：目标为未来 K 步死局、连续未消行、救援触发。
- `playstyle` 分类模型：目标为多消流、连消流、生存流等长期风格。

线上仍建议保留规则输出，把离线模型作为 `modelBaseline` 融入，避免冷启动和黑盒跳变。

---

## 8. CommercialModelVector 与商业化决策

### 8.1 问题定义

商业化模型要同时回答：

- 用户长期价值高不高？
- 当前适合 IAP、激励广告、插屏、任务还是观察？
- 是否存在流失、广告疲劳、付费用户保护或心流保护风险？

这是多目标决策，不是单一“收益最大化”。

### 8.2 输入特征

| 特征 | 来源 | 作用 |
|------|------|------|
| `whaleScore` | 后端商业化画像 | 付费潜力代理 |
| `activityScore` | 后端画像 / 会话统计 | 留存与投入度代理 |
| `skillScore` | PlayerProfile / AbilityVector | 能力与长期留存相关 |
| `nearMissRate` | 行为统计 | 激励广告接受度 |
| `frustration` | 实时画像 | 救援、IAP、流失风险 |
| `flowState` | 实时画像 | 心流保护 |
| `ltv30` / confidence | LTVPredictor | 长期价值 |
| `adFreq` | 广告频控 | 疲劳与体验风险 |

### 8.3 输出与目标

`CommercialModelVector` 输出：

- `payerScore`：付费潜力。
- `iapPropensity`：IAP 推荐倾向。
- `rewardedAdPropensity`：激励广告倾向。
- `interstitialPropensity`：插屏倾向。
- `churnRisk`：短期流失风险。
- `adFatigueRisk`：广告疲劳风险。
- `guardrail`：保护规则。
- `recommendedAction`：推荐动作。

当前优化目标是可解释的业务效用：

$$
U(action) =
revenue(action)
- \lambda_1 churnRisk
- \lambda_2 adFatigueRisk
- \lambda_3 flowInterruption
- \lambda_4 payerDamage
$$

规则模型通过阈值与护栏近似该效用函数。

配置来源：`web/src/monetization/strategy/strategyConfig.js → commercialModel`，线上可由后端 `mon_model_config` 深合并覆盖。新增商业化模型字段时必须同步 `strategyHelp.js` 的 `model.*` cursor:help 文案。

### 8.4 作用机制

执行顺序必须是：

1. 读取硬频控与恢复期。
2. 构建 `CommercialModelVector`。
3. 通过 `shouldAllowMonetizationAction` 做模型门控。
4. 再由 `adTrigger` 执行动作或由 `commercialInsight` 展示解释。

护栏示例：

- 高 `payerScore` 或 whale 用户保护，不展示插屏。
- `flowState === 'flow'` 时抑制打断式广告。
- `adFatigueRisk` 高时降频或完全抑制。
- `churnRisk` 高时转向救援、任务或轻提示。

### 8.5 离线建模升级路径

未来可将当前规则替换或校准为：

- IAP propensity：二分类，标签为未来 1/7/30 天付费。
- Rewarded ad propensity：二分类，标签为展示后观看完成。
- Interstitial tolerance：二分类或 uplift，标签为展示后继续游戏/流失。
- Churn risk：二分类，标签为 D1/D3/D7 未回访。
- Action ranking：contextual bandit，目标为长期收益与体验约束下的 uplift。

要求：离线模型只能输出 baseline 分数，下游 guardrail 不可删除。

---

## 9. LTV 与运营策略模型

### 9.1 LTVPredictor

LTVPredictor 当前是静态系数模型：

```text
segment base LTV
  × channel coefficient
  × activity coefficient
  × skill / retention correction
  → ltv30 / ltv60 / ltv90 / suggested CPI
```

问题定义：

- 估计用户未来 30/60/90 天价值。
- 为买量出价、运营分群和商业化策略提供输入。

假设：

- 当前系数来自行业基准和项目经验，需要真实归因数据校准。
- LTV 是长周期稀疏标签，不能用于实时强决策，只能作为慢变量。

### 9.2 策略规则引擎

`strategyEngine` 是纯函数规则排序器：

```text
context
  ↓
filter rules by segment / condition
  ↓
render why/effect
  ↓
sort active + priority
  ↓
rankedActions + whyLines
```

它不直接预测概率，而是把商业化和玩家状态映射为可运营的动作列表。

作用机制：

- L1 配置层定义规则、阈值、文案和商品。
- L2 引擎执行筛选、排序和解释。
- L3 help 文案中心解释每个字段，便于运营调参。

---

## 10. PCGRL 与候选生成

### 10.1 两类 PCGRL

项目中有两个容易混淆的方向：

| 名称 | 路径 | 当前定位 |
|------|------|----------|
| 关卡 PCGRL | `web/src/level/pcgrl.js` | 关卡编辑器的启发式棋盘生成 |
| 形状候选生成 | `rl_pytorch/spawn_model/shape_proposer.py` + `/api/spawn-model/v3/propose-shapes` | Spawn V3 研究入口，用于提出新形状候选 |

当前均不是完整学术 PCGRL 训练管线，而是程序化生成 + 规则验证。

### 10.2 问题定义

- 关卡生成：给定难度和风格，生成合法初始棋盘。
- 形状提议：给定目标约束，生成可加入形状池的候选形状。

优化目标：

- 连通性。
- 至少存在合法放置。
- 难度与目标匹配。
- 不产生视觉和玩法上难以理解的形状。

上线约束：

- 新形状不能直接进入生产池，必须通过人工审核、可解性测试、RL/真人回放评估。
- PCGRL 生成棋盘仅用于编辑器和研究，不应影响常规真人无尽模式。

---

## 11. 模型契约与特征字典

### 11.1 单一事实源

| 契约 | 权威来源 | 消费者 |
|------|----------|--------|
| 形状池 | `shared/shapes.json` | Web、小程序、Python simulator、Spawn/RL |
| 游戏规则 | `shared/game_rules.json` | Web、小程序、RL、adaptiveSpawn |
| RL 特征维度 | `featureEncoding` | `features.js`、`features.py`、checkpoint |
| 消行计分 | `scoring` | `clearScoring.js`、Python simulator、小程序 |
| 拓扑口径 | `boardTopology.js` / `fast_grid.py` | UI、Spawn、AbilityVector、RL aux loss |
| AbilityVector 配置 | `shared/game_rules.json → playerAbilityModel` | playerAbilityModel、adaptiveSpawn、回放训练样本 |
| 商业化配置 | `strategyConfig.js → commercialModel` + `mon_model_config` | strategyEngine、personalization、adTrigger、commercialInsight |

### 11.2 向量契约

| 向量 | 版本字段 | 主要消费者 | 禁忌 |
|------|----------|------------|------|
| `AbilityVector` | `version` | UI、adaptiveSpawn、回放、离线训练 | 不直接替代 PlayerProfile 原始状态 |
| `CommercialModelVector` | `version` | adTrigger、commercialInsight、策略面板 | 不绕过频控和合规护栏 |
| `PlayerStateSnapshot.ps` | 回放帧字段 | 行为分析、训练样本导出 | 不写入不可复现的未来信息 |
| `spawnContext` | 局内上下文 | adaptiveSpawn、blockSpawn、UI | 不作为 RL 作弊观测 |
| `topology_after` | 8 维监督标签 | RL topology auxiliary head | 与 `analyzeBoardTopology` 口径必须一致 |

### 11.3 维度变更规则

只要改变以下内容，就必须视为模型契约变更：

- `stateDim`、`actionDim`、`phiDim`。
- dock mask side、dock slots。
- 拓扑 auxiliary target 维度。
- AbilityVector / CommercialModelVector 字段删除或语义改变。
- SpawnTransformer context 维度。

后果：

- 旧 checkpoint 可能失效。
- 前后端和小程序镜像需要同步。
- 文档、测试、训练脚本和 API 示例必须一起更新。

---

## 12. 训练、评估与上线检查

### 12.1 离线训练检查

| 模型 | 必查项 |
|------|--------|
| RL | 平均分、胜率、熵、policy/value loss、topology aux、hole aux、评估 seed 稳定性 |
| SpawnTransformer | 合法率、可解率、目标难度误差、多样性、重复率、失败回退率 |
| Ability baseline | 未来分数/胜率相关性、风险预测 AUC、冷启动偏差 |
| Commercial baseline | AUC、校准曲线、分群覆盖、uplift、护栏命中率 |
| LTV | MAPE、分渠道校准、分群误差、CPI 建议误差 |

### 12.2 线上灰度检查

上线前必须确认：

- 规则回退路径可用。
- 所有模型输出可解释，UI 不展示空字段。
- 高风险动作有硬护栏。
- 训练数据不包含未来信息或不可见内部权重。
- 小程序、Web、Python 的规则口径一致。
- 关键指标有 before/after 对照。

### 12.3 代码实现入口

| 模型/模块 | 训练或配置入口 | 推理/消费入口 | 测试入口 |
|-----------|----------------|---------------|----------|
| RL Bot | `rl_pytorch/train.py`、`shared/game_rules.json → rlRewardShaping` | `rl_backend.py → /api/rl/*`、`web/src/bot/pytorchBackend.js` | `tests/features.test.js`、`tests/simulator.test.js` |
| Spawn 规则轨 | `shared/game_rules.json → adaptiveSpawn / strategies` | `web/src/bot/blockSpawn.js`、`web/src/adaptiveSpawn.js` | `tests/blockSpawn.test.js`、`tests/adaptiveSpawn.test.js` |
| SpawnTransformer | `rl_pytorch/spawn_model/`、`models/spawn_transformer.pt` | `web/src/spawnModel.js`、`server.py → /api/spawn/*` | `tests/pcgrl.test.js`、spawn model 自检脚本 |
| PlayerProfile | `shared/game_rules.json → adaptiveSpawn` | `web/src/playerProfile.js`、`web/src/playerInsightPanel.js` | `tests/playerProfile.test.js` |
| AbilityVector | `shared/game_rules.json → playerAbilityModel` | `web/src/playerAbilityModel.js`、`web/src/moveSequence.js` | `tests/playerAbilityModel.test.js` |
| CommercialModelVector | `strategyConfig.js → commercialModel`、`mon_model_config` | `web/src/monetization/commercialModel.js`、`adTrigger.js` | `tests/commercialModel.test.js` |
| LTV / 策略引擎 | `strategyConfig.js`、运营配置 API | `ltvPredictor.js`、`strategyEngine.js`、`personalization.js` | `tests/strategyEngine.test.js`、`tests/monetization.test.js` |

### 12.4 推荐阅读顺序

算法工程师新接手时建议按以下顺序读：

1. 本文，建立全局模型地图。
2. `ALGORITHMS_HANDBOOK.md`，查系统入口和变更清单。
3. `ALGORITHMS_RL.md`，理解 RL 训练与网络结构。
4. `ALGORITHMS_SPAWN.md`，理解出块生成与规则/ML 双轨。
5. `ALGORITHMS_PLAYER_MODEL.md`，理解能力和画像。
6. `ALGORITHMS_MONETIZATION.md`，理解商业化模型与护栏。
7. `RL_AND_GAMEPLAY.md`、`SPAWN_ALGORITHM.md`、`ADAPTIVE_SPAWN.md`，核对工程边界。

---

> 最后更新：2026-05-04 · v1.1 · 增加建模方法对比、优化目标护栏和代码实现入口
