# 四模型系统设计：启发式出块、生成式出块、PyTorch RL 与浏览器 RL

> **定位**：面向算法工程师、玩法工程师和测试角色的系统设计文档。  
> **范围**：梳理 OpenBlock 当前四类核心模型：启发式出块算法、生成式出块模型、PyTorch RL 落子模型、浏览器 RL 模型。  
> **写作口径**：参考程序化内容生成（PCG）、Transformer、PPO/GAE、REINFORCE、LoRA 等学术路线，但以本仓库代码事实为准。  
> **维护要求**：改 `shared/game_rules.json`、`web/src/bot/features.js`、`rl_pytorch/features.py`、`rl_pytorch/model.py`、`rl_pytorch/spawn_model/*`、`web/src/adaptiveSpawn.js`、`web/src/bot/blockSpawn.js` 时同步核对本文。

---

## 1. 总览

OpenBlock 的“模型”不是单一神经网络，而是四条职责边界明确的决策链路：

| 模型 | 解决的问题 | 算法类型 | 线上职责 | 是否学习参数 |
|------|------------|----------|----------|--------------|
| 启发式出块算法 | 下一轮给玩家哪 3 个候选块 | 多信号规则模型 + 加权抽样 + 硬约束拒绝采样 | 真人默认出块路径 | 否 |
| 生成式出块模型 | 从历史样本学习三连块条件分布 | Transformer 自回归生成 + 多任务监督 + LoRA 个性化 | 可选 `model-v3` 出块路径，失败回退规则轨 | 是 |
| PyTorch RL 算法模型 | 给定棋盘和候选块，选择怎么落子 | PPO / GAE / 策略价值网络 / 辅助监督 / 搜索蒸馏 | Bot 推理、服务端训练、评估 | 是 |
| 浏览器 RL 模型 | 浏览器内轻量自博弈与演示训练 | 线性 softmax policy + value baseline + REINFORCE | 训练面板、本地演示、远端 RL 客户端 | 是 |

关键边界：

- 出块模型回答 **“给什么块”**；RL 模型回答 **“已有这些块时怎么放”**。
- 真人主链路默认走 `game.js → adaptiveSpawn.js → blockSpawn.js`；RL 不直接改真人出块。
- 生成式出块只替代“候选块来源”，不替代 `validateSpawnTriplet`、序贯可解、机动性和规则回退。
- RL 特征只读当前可见棋盘和 dock，不读 `spawnHints`、adaptive 内部权重或未来块。

---

## 2. 学术与工程参考

| 方向 | 参考 | 本项目采用方式 |
|------|------|----------------|
| 程序化内容生成（PCG） | Togelius et al. 的搜索式 PCG、Smith & Mateas 的约束式内容生成思想 | 启发式出块用“软目标 + 硬约束”，不是纯随机表 |
| 心流与自适应难度 | Csikszentmihalyi 心流理论、Yerkes-Dodson 唤醒曲线 | `stress`、`flowState`、`orderRigor` 与救济/加压分离 |
| REINFORCE | Williams, 1992, policy gradient | 浏览器 `LinearAgent` 本地训练 |
| PPO | Schulman et al., 2017, [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347) | PyTorch RL 批量更新与在线攒批路径 |
| GAE | Schulman et al., 2015, Generalized Advantage Estimation | PyTorch 离线训练降低价值估计方差 |
| Transformer | Vaswani et al., 2017, [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | SpawnTransformerV3.1 的条件序列编码与自回归头 |
| LoRA | Hu et al., 2021, [Low-Rank Adaptation](https://arxiv.org/abs/2106.09685) | 个性化出块只训练小规模 LoRA 模块 |
| AlphaZero / 搜索蒸馏 | Silver et al., 2017, self-play + policy/value | RL 可用 beam/MCTS/1-step lookahead teacher 做蒸馏 |

工程取舍：

- 真人人机体验需要低延迟、可解释、可兜底，因此启发式出块仍是默认路径。
- 神经模型承担“分布拟合”和“策略学习”，但不能绕过玩法不变量。
- 所有模型的特征维度、奖励与规则优先从 `shared/game_rules.json` 或共享 shape/rule 文件读取。

---

## 3. 统一符号与共享数据

| 符号 / 字段 | 含义 | 当前维度 / 范围 | 权威来源 |
|-------------|------|-----------------|----------|
| `board` | 8×8 棋盘占用 | 64 | `grid.js` / `simulator.py` |
| `dock` | 当前 3 个候选块 | 3 slots | `game.js` / `OpenBlockSimulator` |
| `s` | RL 状态特征 | 181 | `shared/game_rules.json.featureEncoding` |
| `ψ(a)` | RL 动作特征 | 15 | `features.js` / `features.py` |
| `φ(s,a)` | RL 状态-动作拼接 | 196 | `features.js` / `features.py` |
| `behaviorContext` | Spawn V3.1 行为上下文 | 56 | `spawnModel.js` / `spawn_model/dataset.py` |
| `shape id` | 出块形状词表 | 28 | `shared/shapes.json` / `SHAPE_VOCAB` |
| `spawnHints` | 规则出块软目标 | object | `adaptiveSpawn.js` |
| `spawnTargets` | stress 投影后的多轴目标 | 6 轴 | `adaptiveSpawn.js` |

当前 RL 特征维度说明：

```text
state = 42 维标量（含颜色摘要） + 64 棋盘占用 + 75 dock 形状 = 181
action = 15 维（block、位置、尺寸、清行、风险、多消、同 icon、清屏等）
phi = state + action = 196
```

---

## 4. 模型一：启发式出块算法

### 4.1 问题定义

启发式出块算法需要在每轮生成三块：

```text
T = (shape_0, shape_1, shape_2)
```

目标不是最大化单一分数，而是在以下目标间折中：

- 当前盘面必须至少有可放置路径。
- 高填充、高风险、被困时不能制造不可解三连块。
- 玩家无聊、高手、收获期时提供多消、清屏、同 icon 等高价值反馈。
- Easy/Normal/Hard、会话弧线、玩家风格和盘面几何需要一致。
- UI 叙事、面板指标和真实 dock 行为不能互相矛盾。

### 4.2 设计思路

启发式出块采用 **“可解释状态估计 → 多轴 soft target → 形状级加权 → 硬约束过滤”**：

```text
PlayerProfile + AbilityVector + boardTopology + score
  ↓
adaptiveSpawn.resolveAdaptiveStrategy()
  ↓
stress + shapeWeights + spawnHints + spawnTargets + spawnIntent
  ↓
blockSpawn.generateDockShapes()
  ↓
Layer1 形状特征评分
Layer2 消行 / 多消 / 清屏 / 奖励概率加权
Layer3 session / recent category / warmup 调节
  ↓
validateSpawnTriplet + sequential solvability + solution range
  ↓
三连块
```

这对应 PCG 中常见的 **constructive generation + generate-and-test** 路线：先用规则生成候选，再用约束过滤。

### 4.3 特性

| 特性 | 说明 |
|------|------|
| 冷启动稳定 | 无历史样本时仍能根据分数、fill、holes、nearFull 等运行 |
| 可解释 | `_stressBreakdown`、`spawnHints`、`spawnDiagnostics` 可直接展示 |
| 低延迟 | 全部在浏览器本地计算 |
| 可回退 | `adaptiveSpawn.enabled=false` 时回退基础 `difficulty.js` |
| 与 UI 一致 | `spawnIntent` 是压力表、策略卡和回放标签的单一口径 |
| 奖励概率目标 | `perfectClearBoost`、`multiClearBonus`、`iconBonusTarget` 分别提高清屏、多消、同 icon 概率 |

### 4.4 输入特征

| 类别 | 字段 | 来源 | 用途 |
|------|------|------|------|
| 分数与难度 | `score`、`bestScore`、difficulty mode | `game.js` / `config.js` | 基础 stress 与挑战曲线 |
| 玩家行为 | `thinkMs`、`clearRate`、`comboRate`、`missRate`、`afkCount` | `PlayerProfile.metrics` | 判断能力、心流、疲劳 |
| 玩家状态 | `flowState`、`frustrationLevel`、`needsRecovery`、`playstyle` | `playerProfile.js` | 救济、加压、风格化 |
| 能力向量 | `skillScore`、`clearEfficiency`、`boardPlanning`、`riskLevel` | `playerAbilityModel.js` | 高价值反馈与风险护栏 |
| 盘面拓扑 | `fill`、`holes`、`nearFullLines`、`pcSetup`、`multiClearCandidates` | `boardTopology.js` / `blockSpawn.js` | 几何兑现与可解性 |
| 会话弧线 | `totalRounds`、`roundsSinceClear`、`warmupRemaining` | `_spawnContext` | 热身、收获、恢复 |

### 4.5 策略生成与目标函数

规则轨没有可微损失函数，可形式化为：

```math
score(shape) =
w_0 \cdot baseCategory
+ w_1 \cdot mobility
+ w_2 \cdot clearOpportunity
+ w_3 \cdot multiClear
+ w_4 \cdot perfectClear
+ w_5 \cdot holeRelief
+ w_6 \cdot novelty
+ w_7 \cdot sessionFit
```

实际实现不是线性加法，而是多层乘性权重：

```text
finalWeight =
categoryWeight
× mobilityFactor
× pcPotentialFactor
× multiClearFactor
× gapFillFactor
× holeReduceFactor
× rhythmPhaseFactor
× sizePreferenceFactor
× diversityPenalty
× milestone/sessionFactor
```

其中：

- `shapeWeights` 来自 stress 在 10 档 profile 中插值。
- `clearGuarantee` 决定三槽中优先放入多少“能立即参与消行”的候选。
- `multiClearBonus / multiLineTarget` 增强 `bestMultiClearPotential >= 2` 的块。
- `perfectClearBoost` 增强 `pcPotential === 2` 与清屏准备期 gap 块。
- `iconBonusTarget` 不改变形状，而是在 `game.js` 中放大 `monoNearFullLineColorWeights()` 的 dock 颜色抽样权重。

### 4.6 硬约束与护栏

| 护栏 | 作用 |
|------|------|
| `canPlaceAnywhere` | 每块至少能放 |
| id 去重 | 一轮三块不重复 |
| `minMobilityTarget` | 高填充时要求更多合法落点 |
| `tripletSequentiallySolvable` | 三块存在某种顺序可全部放下 |
| `evaluateTripletSolutions` | 高填充时估算解法叶子数与首手自由度 |
| `targetSolutionRange` | stress 越高可允许解空间更窄，低 stress 要求更宽松 |
| `orderRigor` | 高难模式限制 6 种排列中可解排列数，制造顺序规划压力 |
| 几何兜底 | 无真实 nearFull / multiClear / pcSetup 时下调 payoff 与多消承诺 |
| fallback | 采样多次失败时退到简化合法出块 |

### 4.7 样本、诊断与测试

启发式出块不是从样本训练，但会产出可审计数据：

- `_stressBreakdown`：每个压力分量的贡献。
- `spawnHints`：出块软目标快照。
- `_spawnDiagnostics`：候选统计、chosen reason、solutionMetrics、reject reason。
- `moveSequence`：把 spawn 与 place 快照写入回放。

关键测试：

- `tests/adaptiveSpawn.test.js`
- `tests/blockSpawn.test.js`
- `tests/bonusLineFeature.test.js`

### 4.8 代码入口

| 文件 | 作用 |
|------|------|
| `web/src/adaptiveSpawn.js` | stress、spawnHints、spawnIntent、spawnTargets |
| `web/src/bot/blockSpawn.js` | 三连块生成、特征评分、可解性验证 |
| `web/src/game.js` | 调度出块、模型轨回退、dock 颜色偏置 |
| `shared/game_rules.json` | 配置 profile、阈值、难度、特征维度 |
| `docs/algorithms/ADAPTIVE_SPAWN.md` | 信号矩阵与策略解释 |
| `docs/algorithms/ALGORITHMS_SPAWN.md` | 出块算法总手册 |

---

## 5. 模型二：生成式出块模型 SpawnTransformerV3.1

### 5.1 问题定义

生成式出块模型学习：

```math
P(s_0, s_1, s_2 \mid board, behaviorContext, history, targetDifficulty, playstyle)
```

它用于替代规则轨的“形状采样分布”，但不替代规则护栏。输出非法、重复、不可放、服务不可用或低机动性时，必须回退启发式出块。

### 5.2 设计思路

V3.1 的核心升级是从旧 24 维 context 扩展到 56 维 `behaviorContext`，让模型显式看到：

- 玩家行为窗口。
- AbilityVector。
- boardDifficulty / holes / nearFull / solutionCount。
- 规则轨已经推导出的 `spawnTargets`、`spawnHints`、`spawnIntent`。
- playstyle 和 session arc。

设计原则：

- 三块联合建模，避免三个槽独立采样造成组合失真。
- 多任务学习，把可解性、风格、意图、难度都作为辅助监督。
- LoRA 个性化只调小模块，避免为每个用户复制完整模型。
- 线上永远保留启发式校验与回退。

### 5.3 网络结构

实现类：`rl_pytorch/spawn_model/model_v3.py::SpawnTransformerV3`

```text
board[8×8] + behaviorContext[56]
  ↓ board_proj
state token

targetDifficulty[1]
  ↓ difficulty_proj
difficulty token

playstyle id
  ↓ embedding + style_pos
style token

history[3×3 shape ids]
  ↓ shape_embed + history_pos
history tokens

[CLS, state, diff, style, hist×9]
  ↓ TransformerEncoder(d_model=128, nhead=4, layers=2, FF=256)
CLS output
  ├─ AR shape heads: head_0, head_1, head_2
  ├─ diversity_head
  ├─ difficulty_head
  ├─ feasibility_head
  ├─ style_head
  └─ intent_head
```

自回归分解：

```math
P(s_0,s_1,s_2|c)
= P(s_0|c)P(s_1|c,s_0)P(s_2|c,s_0,s_1)
```

推理时：

- 每个槽 top-k / temperature 采样。
- 已选 shape 做重复 mask。
- 可选 `feasibility_mask` 把不可放 shape mask 掉。
- 返回 `shapes`、`indices`、`feasibleCount`、`modelVersion`。

### 5.4 输入 schema

| 字段 | 形状 | 来源 |
|------|------|------|
| `board` | `(8,8)` | 当前棋盘 |
| `context` | 24 | 旧上下文，兼容字段 |
| `behaviorContext` | 56 | V3.1 权威上下文 |
| `history` | `(3,3)` | 近期三轮出块历史 |
| `targetDifficulty` | scalar `[0,1]` | 前端目标难度公式 |
| `playstyle` | 5 类 | `PlayerProfile.playstyle` |
| `userId` | string | LoRA 个性化 |
| `enforceFeasibility` | bool | 服务端是否构造可放 mask |

`behaviorContext` 分段：

| 区间 | 内容 |
|------|------|
| 0–23 | 旧基础 context：分数、填充、技能、心流、metrics、stress 等 |
| 24–31 | 数据可信度与拓扑：coldStart、samples、boardDifficulty、holes、solutionCount 等 |
| 32–37 | AbilityVector 六维 |
| 38–47 | spawnTargets + hints |
| 48–53 | spawnIntent one-hot |
| 54–55 | multiLineTarget、sessionArc |

### 5.5 损失函数

训练入口：`rl_pytorch/spawn_model/train_v3.py`

总损失：

```math
\mathcal{L}_{V3.1} =
w_{ce}\mathcal{L}_{ce}^{AR}
+ w_{div}\mathcal{L}_{div}
+ w_{anti}\mathcal{L}_{anti}
+ w_{diff}\mathcal{L}_{diff}
+ w_{feas}\mathcal{L}_{feas}
+ w_{si}\mathcal{L}_{soft-infeasible}
+ w_{style}\mathcal{L}_{style}
+ w_{intent}\mathcal{L}_{intent}
```

| 项 | 作用 |
|----|------|
| `L_ce_AR` | 三槽自回归交叉熵，训练目标为真实/规则轨生成的三块 |
| `L_div` | 预测形状品类，鼓励类别结构可学习 |
| `L_anti` | 反分数膨胀，抑制只追高分的捷径 |
| `L_diff` | 回归 `targetDifficulty` |
| `L_feas` | `feasibility_head` 对 28 个 shape 做 BCE |
| `L_soft-infeasible` | 主分布概率质量尽量落在可行集合 |
| `L_style` | 预测 playstyle 弱标签 |
| `L_intent` | 预测 `spawnIntent` 弱标签 |

默认权重见 `train_v3.py` CLI，HTTP `/api/spawn-model/v3/train` 目前只暴露部分权重覆盖。

### 5.6 样本构建

样本来源：SQLite `sessions` + `move_sequences.frames`。

构建流程：

1. 遍历回放 frame。
2. 找到 `spawn` 帧，取当轮 dock 三块为 `targets`。
3. 取上一帧或当前 frame 的棋盘为 `board`。
4. 从 `frame.ps` 解析 `context` 与 `behavior_context`。
5. 从历史 spawn 构造 `history(3×3)`。
6. 按 score / replay 质量 / session 条件给样本 `weight`。

权威实现：

- `rl_pytorch/spawn_model/dataset.py`
- `rl_pytorch/spawn_model/train_v3.py`
- `web/src/spawnModel.js`

### 5.7 训练、推理与个性化

| 流程 | 入口 | 说明 |
|------|------|------|
| 训练 | `python -m rl_pytorch.spawn_model.train_v3` | 输出 `models/spawn_transformer_v3.pt` |
| 状态 | `GET /api/spawn-model/v3/status` | 查看 base 模型与个性化用户 |
| 推理 | `POST /api/spawn-model/v3/predict` | 返回三块 shape id |
| 个性化 | `POST /api/spawn-model/v3/personalize` | 为用户训练 `lora_<userId>.pt` |
| 重载 | `POST /api/spawn-model/v3/reload` | 清空 base 与 LoRA 缓存 |

个性化 LoRA：

- 冻结 base 模型。
- 只训练注入到 head 等线性层的小秩矩阵。
- 损失以三槽 CE 为主。
- 线上按 `userId` 和 LoRA 文件 mtime 缓存个性化模型。

### 5.8 作用机制与策略

生成式模型擅长：

- 学习规则轨难以手写的长期形状组合偏好。
- 按 playstyle 生成更个性化的三连块。
- 从历史回放中复现玩家可接受的节奏与难度。

必须保留的护栏：

- 输出不足 3 块、重复块、不可放或低机动性时回退规则轨。
- 高 fill 下仍需规则轨序贯可解检查。
- 模型只学习偏好分布，不是公平性证明器。

---

## 6. 模型三：PyTorch RL 算法模型

### 6.1 问题定义

RL 落子模型把游戏建成有约束的 MDP：

```math
\mathcal{M}=(\mathcal{S},\mathcal{A}(s),P,r,\gamma)
```

| 项 | 定义 |
|----|------|
| `S` | 当前棋盘、dock、拓扑、分数等可见状态 |
| `A(s)` | 所有合法 `(blockIdx, gx, gy)` |
| `P` | 放置、消行、刷新 dock 的转移 |
| `r` | 分数、清行、存活、拓扑塑形、终局奖励 |
| `γ` | 折扣因子 |

目标是最大化期望折扣回报：

```math
J(\theta)=\mathbb{E}_{\pi_\theta}\left[\sum_t \gamma^t r_t\right]
```

### 6.2 设计思路

PyTorch RL 是服务端重型策略价值模型：

- 使用 CNN 识别 8×8 棋盘空间结构。
- 使用 DockBoardAttention 让 dock 形状读取棋盘特征。
- 对每个合法动作用 `h(s) + ψ(a)` 计算 logit。
- 价值头学习 `V(s)`，降低策略梯度方差。
- 多个辅助头给稀疏奖励提供密集监督。
- 可接 beam/MCTS/1-step lookahead teacher 做蒸馏。

### 6.3 网络结构

实现：`rl_pytorch/model.py::ConvSharedPolicyValueNet`

```text
state s[181]
  ├─ scalars[42]
  ├─ grid[64] → reshape 1×8×8 → Conv2d + ResConv×2
  └─ dock[75] → 3×5×5 masks

grid spatial feature + dock masks
  ↓ DockBoardAttention 或 DockPointEncoder

concat(scalars, grid pooled, dock context)
  ↓ LayerNorm + MLP trunk(width=128)
h(s)
  ├─ value_head → V(s)
  ├─ policy_fuse([h(s), action_embed(ψ(a))]) → logit(s,a)
  └─ auxiliary heads
```

辅助头：

| Head | 监督目标 |
|------|----------|
| `board_quality_head` | 落子后棋盘质量 |
| `feasibility_head` | 剩余块是否全可放 |
| `survival_head` | 还能存活多少步 |
| `hole_aux_head` | 空洞风险 |
| `clear_pred_head` | 清行类别 |
| `topology_aux_head` | 落子后拓扑向量 |

### 6.4 特征与样本构建

权威维度：

```text
state = 181
action = 15
phi = 196
```

每步样本包含：

```js
{
  stateFeat,
  phiList,       // 每个合法动作一条 φ
  chosenIdx,
  reward,
  holes_after,
  clears,
  board_quality,
  feasibility,
  topology_after,
  qTeacher?,     // 可选搜索/估值 teacher
  steps_to_end
}
```

样本来源：

- 离线：`rl_pytorch/train.py` 调 `OpenBlockSimulator` 自博弈。
- 在线：浏览器 `trainer.js` 上传 episode 到 `/api/rl/train_episode`。
- 评估：固定 seed / greedy eval / eval gate。

### 6.5 优化目标与损失

PPO clipped surrogate：

```math
L^{CLIP}(\theta)=
\mathbb{E}_t
\left[
\min(r_t(\theta)A_t,
clip(r_t(\theta),1-\epsilon,1+\epsilon)A_t)
\right]
```

总损失可写为：

```math
\mathcal{L}_{RL} =
\mathcal{L}_{policy}^{PPO}
+ c_v \mathcal{L}_{value}
- c_e \mathcal{H}(\pi)
+ \sum_k c_k \mathcal{L}_{aux,k}
+ c_q \mathcal{L}_{q-distill}
+ c_{\pi} \mathcal{L}_{visit\_pi}
```

| 项 | 实现含义 |
|----|----------|
| `policy_loss` | PPO clipped objective；单局路径近似 REINFORCE-with-baseline |
| `value_loss` | Huber / smooth L1，目标为 return / GAE / outcome 混合 |
| `entropy` | 维持探索，随训练退火 |
| `aux losses` | board quality、feasibility、survival、holes、clear、topology |
| `q_distill` | 从 `q_teacher` 学习动作偏好 |
| `visit_pi` | 从搜索访问分布学习 |

优势估计：

- 离线路径使用 GAE。
- 在线单局路径使用折扣蒙特卡洛回报。
- 支持优势归一化、梯度裁剪、return clip。

### 6.6 训练与服务

| 场景 | 入口 | 机制 |
|------|------|------|
| 离线训练 | `python -m rl_pytorch.train` | 自博弈采样 + PPO 多 epoch 更新 |
| 在线训练 | `POST /api/rl/train_episode` | 单局或 replay buffer 攒批更新 |
| 推理 | `POST /api/rl/select_action` | 对所有合法动作算 logits 并采样 |
| 估值 | `POST /api/rl/eval_values` | 浏览器 lookahead 批量估计 `V(s')` |
| 贪心评估 | `POST /api/rl/eval_greedy` | 对当前 checkpoint 做评估 |
| 保存 | `RL_CHECKPOINT_SAVE` / `saveRemoteCheckpoint` | checkpoint 与 meta |

### 6.7 作用机制与策略

RL 模型主要用于：

- 自动玩家 / Bot 训练。
- 验证规则、难度、出块策略是否可被学习。
- 给策略设计提供反事实：同样 dock 下最优落子倾向。
- 用搜索 teacher 改善稀疏奖励下的样本效率。

它不直接用于真人出块，但其训练结果能帮助评估“当前规则是否导致不可学、不可玩或策略单一”。

---

## 7. 模型四：RL 浏览器模型

### 7.1 问题定义

浏览器 RL 模型是轻量级本地训练和远端 RL 调用的桥：

- 在不启动 Python 训练时，浏览器可以用线性策略做 REINFORCE 自博弈。
- 启动 PyTorch 服务时，浏览器作为采样器、可视化面板和在线训练客户端。
- 它必须在主线程、有限 CPU 和 localStorage 约束下稳定运行。

### 7.2 设计思路

浏览器本地模型选择线性架构而非 MLP：

- 参数少：`W[196] + Vw[181]`。
- 更新稳定：单局 REINFORCE 下比深层网络更不容易发散。
- 可序列化：直接存 localStorage / SQLite。
- 可解释：每个特征对策略 logit 的影响线性可读。

代码入口：

- `web/src/bot/linearAgent.js`
- `web/src/bot/trainer.js`
- `web/src/bot/features.js`
- `web/src/bot/gameEnvironment.js`
- `web/src/bot/simulator.js`
- `web/src/bot/pytorchBackend.js`
- `web/src/bot/rlPanel.js`

### 7.3 网络结构

```math
logit(a|s)=W^\top \phi(s,a)
```

```math
V(s)=V_w^\top s
```

推理流程：

```text
simulator 当前状态
  ↓
buildDecisionBatch()
  ↓
legal actions + stateFeat + phiList
  ↓
LinearAgent.actionDistribution(phiList)
  ↓
softmax(logits / temperature)
  ↓
sample action
```

### 7.4 优化目标与损失

折扣回报：

```math
G_t=\sum_{k=0}^{T-t}\gamma^k r_{t+k}
```

优势：

```math
A_t = \hat{G}_t - V(s_t)
```

策略更新：

```math
\nabla_W J
= A_t \nabla_W \log \pi_W(a_t|s_t)
+ \beta \nabla_W H(\pi_W)
```

价值更新：

```math
V_w \leftarrow V_w + \alpha_v (G_t - V(s_t))s_t
```

工程增强：

- Welford 在线回报标准化，样本数足够后启用。
- 优势按局中心化 / 标准化。
- `maxGradNorm` 裁剪优势，避免单局极端回报炸权重。
- 熵正则维持探索。
- 温度随 episode 衰减。

### 7.5 样本构建

`runSelfPlayEpisode()` 每步产出：

```js
{
  stateFeat,
  phiList,
  probs,
  chosenIdx,
  reward,
  holes_after,
  clears,
  board_quality,
  feasibility,
  topology_after,
  qTeacher?,
  steps_to_end
}
```

与 PyTorch 路径的关系：

- 本地训练使用 `probs` 和 `chosenIdx` 做 REINFORCE。
- 远端训练把同一 trajectory 上传到 `/api/rl/train_episode`。
- 若启用 lookahead，浏览器对每个合法动作模拟一步并调用 `/api/rl/eval_values`，形成 `qTeacher`。

### 7.6 浏览器约束

| 约束 | 设计应对 |
|------|----------|
| 主线程不能长时间阻塞 | 训练循环定期 `await setTimeout(0)` 让出事件循环 |
| 后台标签页耗电 | `skipWhenDocumentHidden` 等配置 |
| localStorage 容量 | 只存线性权重 JSON |
| 合法动作过多 | lookahead 只在动作数 ≤ 120 时启用 |
| 弱设备稳定性 | 线性模型 + 梯度裁剪 + 温度保护 |

### 7.7 作用机制

浏览器 RL 的价值不在于成为最强 Bot，而在于：

- 让训练面板可即时演示策略学习。
- 作为 PyTorch RL 的在线采样客户端。
- 在没有 Python 服务时仍能提供轻量基线。
- 用同一套 `features.js` 检查前后端特征契约。

---

## 8. 四模型对比与协作策略

| 维度 | 启发式出块 | 生成式出块 | PyTorch RL | 浏览器 RL |
|------|------------|------------|------------|-----------|
| 决策对象 | 三连块形状 | 三连块形状 | 落子动作 | 落子动作 |
| 输入 | profile + topology + rules | board + behaviorContext + history | state + legal action features | state + legal action features |
| 输出 | shapes | shapes | action index | action index |
| 学习方式 | 无 | 监督学习 + 多任务 | PPO/GAE + aux + distill | REINFORCE + baseline |
| 失败策略 | fallback_simple | 回退启发式 | 不影响真人 | 回退本地/远端默认 |
| 可解释性 | 强 | 中 | 中 | 强 |
| 延迟 | 低 | 取决于服务端 | 取决于服务端 | 低 |
| 主要测试 | adaptive/blockSpawn | spawnModel/test_v3 | RL eval / service tests | features/simulator tests |

协作原则：

1. 真人体验优先由启发式出块保证公平和稳定。
2. 生成式出块只能在护栏内提高个性化与多样性。
3. RL 模型不能读出块内部信号，避免训练环境与真人路径互相污染。
4. 浏览器 RL 是 lightweight agent 和 PyTorch 客户端，不是 Spawn 模型。
5. 改特征维度必须同步 JS/Python、checkpoint、文档和测试。

---

## 9. 验证与上线清单

| 改动类型 | 必跑验证 |
|----------|----------|
| 启发式出块 | `npm test -- tests/adaptiveSpawn.test.js tests/blockSpawn.test.js` |
| 生成式出块 | `npm test -- tests/spawnModel.test.js`、`python -m rl_pytorch.spawn_model.test_v3` |
| RL 特征维度 | `npm test -- tests/features.test.js tests/simulator.test.js`，并检查 `rl_pytorch/features.py` |
| PyTorch RL 服务 | `python -m rl_pytorch.eval_cli` 或 `/api/rl/eval_greedy` |
| 浏览器 RL | `tests/features.test.js`、`tests/simulator.test.js`、手动训练面板 smoke |
| 文档变更 | `npm run lint` 不应受影响；检查 docs 索引链接 |

上线前必须确认：

- `shared/game_rules.json.featureEncoding` 与 `features.js / features.py` 一致。
- Spawn V3.1 checkpoint 的 `behavior_context_dim` 为 56。
- 模型轨失败会回退规则轨。
- RL checkpoint 的 meta 与当前特征维度一致。
- 文档中的公式和维度没有沿用旧 `181/12/193` 口径。

---

## 10. 代码入口速查

### 启发式出块

- `web/src/adaptiveSpawn.js`
- `web/src/bot/blockSpawn.js`
- `web/src/boardTopology.js`
- `web/src/game.js`
- `shared/game_rules.json`
- `tests/adaptiveSpawn.test.js`
- `tests/blockSpawn.test.js`

### 生成式出块

- `web/src/spawnModel.js`
- `server.py`
- `rl_pytorch/spawn_model/dataset.py`
- `rl_pytorch/spawn_model/model_v3.py`
- `rl_pytorch/spawn_model/train_v3.py`
- `rl_pytorch/spawn_model/personalize.py`
- `rl_pytorch/spawn_model/test_v3.py`
- `tests/spawnModel.test.js`

### PyTorch RL

- `rl_backend.py`
- `rl_pytorch/model.py`
- `rl_pytorch/train.py`
- `rl_pytorch/features.py`
- `rl_pytorch/simulator.py`
- `rl_pytorch/eval_cli.py`
- `web/src/bot/pytorchBackend.js`

### 浏览器 RL

- `web/src/bot/linearAgent.js`
- `web/src/bot/trainer.js`
- `web/src/bot/features.js`
- `web/src/bot/gameEnvironment.js`
- `web/src/bot/simulator.js`
- `web/src/bot/rlPanel.js`
- `tests/features.test.js`
- `tests/simulator.test.js`

---

## 11. 相关文档

- [模型工程总览](./MODEL_ENGINEERING_GUIDE.md)
- [出块算法手册](./ALGORITHMS_SPAWN.md)
- [出块建模](./SPAWN_BLOCK_MODELING.md)
- [自适应出块](./ADAPTIVE_SPAWN.md)
- [RL 算法手册](./ALGORITHMS_RL.md)
- [PyTorch RL 服务与评估](./RL_PYTORCH_SERVICE.md)
- [RL 与玩法契约](./RL_AND_GAMEPLAY.md)
- [浏览器 RL 优化](./RL_BROWSER_OPTIMIZATION.md)
- [实时策略系统](../player/REALTIME_STRATEGY.md)

---

## 12. 参考文献

1. Williams, R. J. (1992). Simple statistical gradient-following algorithms for connectionist reinforcement learning. *Machine Learning*.
2. Sutton, R. S., & Barto, A. G. (2018). *Reinforcement Learning: An Introduction*.
3. Schulman, J. et al. (2015). High-Dimensional Continuous Control Using Generalized Advantage Estimation.
4. Schulman, J. et al. (2017). [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347).
5. Vaswani, A. et al. (2017). [Attention Is All You Need](https://arxiv.org/abs/1706.03762).
6. Hu, E. J. et al. (2021). [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/abs/2106.09685).
7. Silver, D. et al. (2017). Mastering Chess and Shogi by Self-Play with a General Reinforcement Learning Algorithm.
8. Togelius, J. et al. (2011). Search-Based Procedural Content Generation.
9. Smith, A. M., & Mateas, M. (2011). Answer Set Programming for Procedural Content Generation.
