# RL 研究与文献对照

> 本文聚合了 RL 瓶颈诊断与优化候选的专题分析，以及自博弈算法文献的横向对照，作为算法方案演进的历史参考。
> 当前算法、维度、奖励和服务路径以 [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) 与代码为准。

## 一、瓶颈诊断与优化候选

> 当前定位：复杂度与瓶颈分析专题，作为 `ALGORITHMS_RL.md` 的背景材料；不作为当前实现事实入口。

### 1.1 游戏玩法机制

#### 1.1.1 核心规则

| 属性 | 值 |
|------|-----|
| 棋盘 | 8×8 正方网格 |
| 颜色 | 8 种（不影响消除判定） |
| 候选区 | 每轮 3 个形状，放完才刷新 |
| 消除 | 行或列**整行满**即消除（类似 1010!） |
| 终局 | 剩余未放置的块都无合法位置 |
| 胜利 | 分数达到阈值（课程 40→220 / 40k ep（`winThresholdStart=40`，见 `shared/game_rules.json`）） |

与俄罗斯方块不同：**无重力**、**无时间压力**、**同时消行列**、**一次放三块**。
核心挑战 = **空间规划** + **顺序决策**；三块的放置顺序与位置影响后续生存。

#### 1.1.2 计分：对局消行与 RL 模拟器

**Web / 微信小程序对局**的消行得分由 `computeClearScore()` 统一计算；实现见 `web/src/clearScoring.js`，`web/src/game.js` 再导出，小程序镜像为 `miniprogram/core/bonusScoring.js`。规则见 **[消行计分规则](../product/CLEAR_SCORING.md)**：

- 基础分：`baseScore = baseUnit × c²`，其中 `baseUnit = scoring.singleLine`，默认 20；`c` 为本次消除行列总数。
- 同 icon / 同色 bonus：`subtotal = baseScore + baseUnit × c × b × 4`；`b` 为 bonus 线条数；若所有消除线均为 bonus，则等价于 `5 × baseScore`。
- 连击倍数（v1.66+）：`clearScore = subtotal × perfectMult × comboMult`；`comboMult` 由 `_clearStreak`（连续触发消行的落子数）推导，默认 ≥ 3 连 ×2 cap。RL/无头模拟器同步累乘，奖励信号无需额外 shaping。详见 [§3bis](../product/CLEAR_SCORING.md#三-bis连击倍数combo-multiplier--v166)。

**Python RL 模拟器** `rl_pytorch/simulator.py`、`rl_mlx/simulator.py` 的**盘面分数增量**与上述公式对齐：`baseUnit` 取 `scoring.singleLine`；bonus 线由 `Grid.check_lines()` 返回的 `bonus_lines` 计数，与 Web `Grid.checkLines()` 的 `bonusLines` 语义一致。`multiLine` / `combo` 仍保留在 `shared/game_rules.json` 中以便兼容旧配置，但**不再用于**消行得分计算。

#### 1.1.3 RL 即时奖励

每步 reward = 盘面分数增益 + 奖励塑形：

| 信号 | 值 | 触发 |
|------|-----|------|
| placeBonus | +0.12 | 每次放置 |
| densePerClear | +2.5×c | 消除 c 行 |
| multiClearBonus | +1.8×(c-1) | c≥2 |
| survivalPerStep | +0.04 | 每步 |
| winBonus | +50 | 首次达标 |
| stuckPenalty | -2.0 | 终局未赢 |

### 1.2 状态/动作空间复杂度分析

#### 1.2.1 状态空间

理论上限（粗略估计）：
- 每个格子 9 种状态（空 + 8 色），8×8 格 → 9^64 ≈ 10^61
- 候选区：约 40 种形状中选 3 个 × 放置状态 → 组合极大
- **有效状态空间**远小于理论值，但仍是天文数字

当前实现状态编码以 `shared/game_rules.json` 的 `featureEncoding` 为准（**v1.68**）：**190 维** = 51 标量（含 **3 维策略 one-hot**）+ 64 棋盘 + 75 dock；动作 **15 维**，`φ` 为 **205 维**。训练机制三条路径（离线 MCTS / 浏览器 RL / 线上）见 [`RL_CONTRACT_AND_SERVICE.md` §2.6](./RL_CONTRACT_AND_SERVICE.md#26-rl-训练机制三条路径对照权威)。旧文档中的 187/202、154/162 等维数为历史版本，仅作演进参考。

#### 1.2.2 动作空间

每步动作 = (block_idx, gx, gy)，其中：
- block_idx ∈ {0,1,2}（未放置的块）
- gx, gy ∈ [0, 7]

**单步最大合法动作数** = 3 × 8 × 8 = 192（理论上限，实际受形状尺寸约束，典型 30~80）

**一轮（三块）的决策序列**：放完 3 块需 3 步，每步的合法动作取决于前步。
三步组合决策空间 ≈ 80 × 50 × 30 ≈ **120,000**（量级估计）。

#### 1.2.3 博弈树复杂度

| 指标 | 估计 |
|------|------|
| 平均每步合法动作 | ~50 |
| 平均一局步数 | 15~40 步 |
| 单局博弈树节点 | 50^25 ≈ 10^42（中等深度） |
| 对比围棋 | ~10^170 |
| 对比国际象棋 | ~10^47 |

结论：Open Block 的**分支因子中等**（~50 vs 围棋 ~250），但**轨迹长度可变且有终局风险**，属于中等复杂度的单人规划问题。

#### 1.2.4 关键算法瓶颈

1. **`count_clears_if_placed`**：每个合法动作需**克隆棋盘+放置+检查消除**，每步调用 ~50 次。
   - 时间复杂度：O(|legal| × n²)，n=8 → 每步 ~50×64 = 3200 次格子操作
   - 这是特征提取的主要瓶颈（`would_clear` 是动作特征的关键维度）

2. **`get_legal_actions`**：遍历 3×8×8=192 个候选并检查 `can_place`。
   - 每次 `can_place` 需检查形状的所有格子 → O(192 × max_cells)

3. **每步前向推理**：所有合法动作都要过策略网络得到 logit → GPU 推理的 batch 大小等于合法动作数（~50）

### 1.3 当前模型分析

#### 1.3.1 架构（conv-shared，默认）

```
状态 187 维 ─┬─ scalars[48] ───────────────────────────┐
             ├─ grid[64] → reshape(1,8,8)               │
             │   → Conv2d + ResConv×2 + GELU            │
             │   ├─ 全局平均池化 → [32]                 │
             │   └─ 空间特征供 dock cross-attention     │
             └─ dock[75] → DockBoardAttention → [48] ───┤
                                                        ▼
                              concat [46+32+48=126]
                              → LayerNorm → Linear(126→128) + GELU
                              → Linear(128→128) + residual ×2
                              → h(s) [128]
                                   │
              ┌────────────────────┼────────────────────────────┐
              ▼                    ▼                            ▼
         value_head            策略头                       辅助监督头
         Linear(128→64)     h(s) ⊕ ψ(a)                  board_quality /
         → GELU             Linear(15→48) → GELU          feasibility /
         → Linear(64→1)     → Linear(176→128)             survival /
         → V(s)             → GELU → Linear(128→1)        hole / clear_pred /
                            → logit                       topology_aux
```

参数量随辅助头和 dock 编码配置变化；当前默认结构以 `rl_pytorch/model.py` 为事实源。

#### 1.3.2 特征工程评估

**状态特征（187 维）** — 优缺点：

| 维度 | 内容 | 评价 |
|------|------|------|
| 42 标量 | 填充率、行列极值、fillable-aware 临消、空洞、跳变、井、颜色摘要等 | ✅ 覆盖基础几何、拓扑和颜色统计 |
| 64 棋盘 | 二值占用 0/1 | ⚠️ 丢失了格子颜色、相对位置模式 |
| 75 dock | 3×5×5 形状掩码 | ✅ 足够表达形状 |

**仍需持续评估的关键特征**：
1. **连通性**：空白区域的连通分量数和大小仍可作为后续增强。
2. **长期可放置性**：当前 mobility 是即时特征，对未来 dock 分布的估计仍依赖搜索或 spawn predictor。
3. **颜色语义**：颜色不影响基础消行，但影响 bonus 与视觉识别，当前只做摘要统计。

**动作特征（15 维）**：

| 维度 | 内容 | 评价 |
|------|------|------|
| 基础动作 | block_idx、归一化坐标、形状宽高、面积 | 提供动作身份与空间位置 |
| 直接后果 | would_clear、holes_after、delta_transitions | 让策略看到落子后的即时质量 |
| 机会变化 | new_almost_full、post_mobility 等 | 估计临消机会和剩余机动性 |
| 奖励机会 | multi-clear、同 icon/同色 bonus、清屏潜力 | 对齐当前计分与爽感目标 |

**当前重点**：动作特征已经包含放置后的棋盘质量代理，训练效果主要取决于这些代理与辅助监督头是否同口径。

#### 1.3.3 训练管线评估

| 方面 | 当前设置 | 评价 |
|------|---------|------|
| 算法 | PPO (4 epochs, clip=0.2) | ✅ 合理 |
| batch | 16 episodes / update | ⚠️ 偏小，方差大 |
| γ | 0.99 | ⚠️ 对短轨迹过高（15~40 步 → γ^40=0.67） |
| λ (GAE) | 0.95 | ✅ 合理 |
| lr | 1e-3 | ⚠️ 对 PPO 偏高（通常 3e-4） |
| return_scale | 0.1 | ✅ 避免价值目标过大 |
| 熵系数 | 0.01 → 0.004 / 12k ep | ✅ 衰减合理 |
| 温度衰减 | 1.0 → 0.3, rate=0.0003 | ⚠️ 衰减过慢（3333 ep 才从 1→0） |
| 探索 | Dirichlet(α=0.28, ε=0.08) | ✅ 合理 |

#### 1.3.4 核心问题诊断

##### 问题 1：价值估计不准 — 收敛慢的主因

CNN 只处理棋盘占用，无法感知**空洞结构**。Value 头仅 2 层（128→64→1），对复杂局面的价值函数拟合不足。当 V(s) 偏差大时：
- GAE 的 advantage 噪声大 → 梯度方向不稳定
- PPO 的多轮更新在噪声 advantage 上过拟合

##### 问题 2：特征信息瓶颈

当前 187 维编码已经补入空洞、临消、跳变、井、mobility、单步出块难度、客观几何（连通块/凹角）等信号；后续瓶颈从“是否有特征”转向“特征口径是否正确”和“网络能否把特征与空间结构结合”：
- `holes` 必须按“所有形状都无法覆盖”定义，避免传统包围空格误判。
- `lines_clearable_1/2` 必须是 fillable-aware，不能只看空格数。
- 放置后质量要与 `topology_aux_head` 的监督标签保持一致。

##### 问题 3：采集效率低

每步都要对所有合法动作（~50 个）执行 `count_clears_if_placed`（克隆棋盘），占 70%+ 的采集时间。

##### 问题 4：奖励信号稀疏

大多数步骤只得到 `placeBonus(0.12) + survival(0.04) = 0.16`。消行（主要正信号）频率较低。agent 在大量"无明显奖励"的步骤上学习效率低。

### 1.4 优化方案

#### 1.4.1 特征增强（预计提升效果：⭐⭐⭐⭐⭐）

当前已在 `extract_state_features` 中纳入高价值拓扑特征：

| 新特征 | 维度 | 说明 |
|--------|------|------|
| holes_count/area | 1 | 所有形状都无法合法覆盖的空格数 / 总面积 |
| max_height/n | 1 | 最高已占用行的高度归一化 |
| row_transitions/area | 1 | 行内 0→1 和 1→0 的跳变次数 / 总面积 |
| col_transitions/area | 1 | 列内跳变次数 / 总面积 |
| well_depth_sum/(n²) | 1 | 各列"井"深度之和 / 面积 |
| lines_clearable_1/n | 1 | 差 1 格且缺口可被合法形状覆盖的行列数 / n |
| lines_clearable_2/n | 1 | 差 2 格且全部缺口可被合法形状覆盖的行列数 / n |
| dock_mobility/max | 1 | 当前三块总合法位置数 / 理论最大 |

当前契约：**stateScalarDim = 48**，**stateDim = 187**，**actionDim = 15**，**phiDim = 202**。

这些特征在俄罗斯方块 AI 研究中被证明是最关键的状态描述子。

#### 1.4.2 动作特征增强（预计提升：⭐⭐⭐⭐）

当前动作特征已经从早期 7 维扩展到 15 维，重点包括：

| 新特征 | 维度 | 说明 |
|--------|------|------|
| holes_after | 1 | 放置并消行后的不可覆盖空洞数 / maxHoles |
| delta_transitions | 1 | 放置后行列跳变变化量归一化 |
| new_almost_full | 1 | 放置后新增 almost-full 行列数 / n |
| post_mobility | 1 | 放置后剩余块总合法位置数 / max |
| multi_clear | 1 | 本动作是否带来 2 行及以上多消 |
| bonus_line | 1 | 本动作形成同 icon / 同色整线 bonus 的强度 |
| perfect_clear | 1 | 本动作消行后是否清空整个棋盘 |

当前契约：**actionDim = 15**，与状态拼接后的 **phiDim = 202**。

`holes_after` 是最关键的动作质量信号之一：它不看传统列高，而是模拟落子和消行后，统计所有形状库仍无法覆盖的空格，更接近真实死角风险。

#### 1.4.3 超参数调优（预计提升：⭐⭐⭐）

| 参数 | 当前 | 建议 | 理由 |
|------|------|------|------|
| lr | 1e-3 | **3e-4** | PPO 标准实践；过高 lr 导致策略剧烈抖动 |
| batch_episodes | 16 | **32** | 降低梯度方差，PPO 需要较大 batch |
| γ | 0.99 | **0.97** | 游戏轨迹短（~25 步），0.97^25≈0.47 更合理 |
| ppo_epochs | 4 | **3** | 减少对噪声 advantage 的过拟合 |
| return_scale | 0.1 | **0.05** | 配合新的特征使奖励幅度更平缓 |
| value_coef | 0.25 | **0.5** | 提高价值函数学习权重，改善 baseline |
| grad_clip | 1.0 | **0.5** | 更保守的梯度裁剪，配合降低 lr |

#### 1.4.4 模型架构微调（预计提升：⭐⭐⭐）

1. **加深价值头**：当前 `128→64→1`（2 层），改为 `128→128→64→1`（3 层），提升价值拟合能力
2. **CNN 增加残差连接**：3 层 Conv2d 加 skip connection，改善梯度流
3. **Dock 分支加独立编码器**：当前 dock 75 维直接 concat，改为过 1 层 MLP(75→32) 再 concat，让 trunk 输入更均衡

#### 1.4.5 采集加速（预计提升：⭐⭐）

- **缓存 `can_place` 结果**：形状不变时，缓存每个 (gx,gy) 的合法性
- **增量式 `would_clear`**：不克隆整个 grid，而是就地计算受影响的行列是否满
- **并行采集 `--n-workers`**：建议默认开 4 workers

#### 1.4.6 奖励塑形优化（预计提升：⭐⭐）

| 信号 | 当前 | 建议 | 理由 |
|------|------|------|------|
| placeBonus | 0.12 | **0.05** | 降低"只要放就好"的噪声 |
| densePerClear | 2.5 | 2.5（保持） | 消行是核心正信号 |
| survivalPerStep | 0.04 | **0.02** | 降低生存奖励噪声 |
| hole_aux_loss | 已启用 | **SmoothL1(holes_after/maxHoles)** | 作为监督损失学习真实死角风险，不直接污染 advantage |
| topology_aux_loss | 新增 | **SmoothL1(8 维拓扑向量)** | 学习落子后的碎片化、井、可填临消线、机动性和填充变化，给策略头更细的动作质量梯度 |
| stuckPenalty | -2.0 | **-3.0** | 加大死局惩罚 |

### 1.5 优化优先级与预期效果

| 优先级 | 优化项 | 代码改动量 | 预期收敛加速 |
|--------|--------|-----------|-------------|
| P0 | 特征增强（状态+动作） | 中 | 2~3× |
| P1 | 超参调优（lr/batch/γ） | 小 | 1.5~2× |
| P2 | 价值头加深 + CNN 残差 | 小 | 1.3~1.5× |
| P3 | 奖励塑形（holePenalty） | 小 | 1.2~1.5× |
| P4 | 采集加速 | 中 | 训练吞吐 1.5× |

综合实施 P0~P3 后，预计在相同 episode 数下，agent 的**平均得分和存活步数提升 50%~100%**，**收敛到稳定策略的速度提升 3~5 倍**。

### 1.6 附录：当前维度契约

当前维度以 `shared/game_rules.json` 的 `featureEncoding` 为准：

```
featureEncoding:
  stateScalarDim: 48
  gridSpatialDim: 64
  dockSpatialDim: 75
  stateDim:       187
  actionDim:      15
  phiDim:         202
```

需同步更新：`shared/game_rules.json`、`rl_pytorch/features.py`、`rl_pytorch/model.py`、`web/src/bot/features.js`、`web/src/bot/linearAgent.js`、`rl_mlx/features.py`。任何维度变化都意味着旧 checkpoint 不再兼容，必须重训或显式迁移。

## 二、文献对照

> **来源**：由 Canvas `rl-self-play-literature-comparison.canvas.tsx` 转换。
> **定位**：将 OpenBlock RL 与 AlphaZero、MuZero、Ranked Reward、Expert Iteration、Gumbel AlphaZero 等游戏自博弈路线横向对照，明确应借鉴和应暂缓的方向。

### 2.1 核心结论

OpenBlock 已经接近 AlphaZero / Expert Iteration 的轻量工程版本：有搜索 teacher、visit/Q 蒸馏、Ranked Reward 和 EvalGate。真正差距在单人分数游戏特有的：

- Value / Q 归一化。
- 随机出块建模。
- 困难样本重放。
- Bonus-aware 表示。

| 指标 | 数值 |
|------|------|
| 评审算法家族 | 8 |
| 已部分实现 | 3 |
| 最高杠杆缺口 | 2 |
| 低优先家族 | 1 |

### 2.2 算法适配矩阵

| 算法家族 | 最适合场景 | 核心思想 | OpenBlock 适配 | 对照结论 |
|----------|------------|----------|----------------|----------|
| AlphaZero | 双人完美信息 | MCTS + policy/value + visit CE + eval gate | 已具备一部分 | 已有 visit_pi CE、EvalGate、MCTS 可选；但仍是 PPO 混合训练，不是纯 AZ policy iteration |
| MuZero | 未知规则 / Atari | 学习 dynamics/reward/value/policy 供搜索 | 低优先 | OpenBlock 有精确 simulator；更适合把 spawn 随机性做 chance model，而非完整 MuZero |
| Ranked Reward R2 | 单人稀疏分数 | 滑动窗口分位奖励，把单人任务变成相对自博弈 | 已实现 | 已加 p50→p70 爬坡；后续关注绝对分与 ranked 指标是否背离 |
| Single-player MCTS / SameGame | 单人 puzzle | 单人 value normalization、max backup、policy-guided search | 高度相关 | 当前缺少明确的单人 Q/value normalization，这是分数上探的关键缺口 |
| Expert Iteration | 搜索专家 + 网络学生 | 搜索生成更强标签，网络蒸馏，再反哺搜索 | 高度相关 | 当前 q/visit 蒸馏是 ExIt-lite；应加入 replay buffer 和蒸馏退火 |
| Gumbel AlphaZero | 少模拟高效搜索 | 无放回采样 + Q policy improvement，少量 simulation 仍有效 | 高性价比 | 适合 OpenBlock 每步动作多、预算有限；可替代部分 root visit 逻辑 |
| Policy/Search Distillation | 工程化搜索蒸馏 | 把 MCTS/beam 分布压进快速策略 | 已部分实现 | 需要 teacher 质量监控、entropy/margin、分阶段降低蒸馏权重 |
| Dreamer / World Models | 视觉 / 未知动态任务 | 学习 latent world model 并 imagination RL | 中低优先 | 完整世界模型不划算；可借鉴 reward/value transform 与随机出块建模 |

### 2.3 现在应借鉴的内容

| 来源 | 借鉴点 | OpenBlock 落地方式 |
|------|--------|--------------------|
| Single-player MCTS | 对无界分数做归一化，把搜索值视为下界式改进 | 对 beam/MCTS Q 做 per-state rank、z-score 或 softmax 温度校准 |
| Expert Iteration | 搜索标签成为可复用训练集，不只作为临时 batch 信号 | 建立 search-improved replay buffer，并按困难状态重放 |
| Gumbel AlphaZero | 小预算下提高 root action 选择质量 | 在根节点采样 top actions 后做少量 Q 评估 |
| Ranked Reward | 单人任务用滚动分位制造相对进步信号 | 继续保留 p50→p70 爬坡，但同时监控绝对分 |
| Policy/Search Distillation | 快策略吸收慢搜索能力 | 记录 teacher entropy、Q margin、覆盖率，逐步退火蒸馏权重 |

### 2.4 当前应避免的内容

- 不宜完整替换为纯 AlphaZero：单人分数任务没有双人胜负结构，且每步动作多，纯 MCTS policy iteration 成本高。
- 不宜直接做完整 MuZero / Dreamer：OpenBlock 有精确 simulator 和低维结构化状态，完整世界模型投入产出比偏低。
- 不宜让 teacher 永久主导训练：搜索标签应帮助突破平台期，后续要降低蒸馏权重，避免策略只模仿固定搜索偏差。

### 2.5 推荐路线

| 优先级 | 优化 | 实现 | 预期效果 |
|--------|------|------|----------|
| 1 | 单人搜索值归一化 | 对 beam/MCTS Q 做 per-state z-score、rank 或 softmax 温度校准 | 减少 teacher/value 标度错位，提升高分段信号 |
| 2 | ExIt 化训练缓存 | 保留 search-improved targets，按困难/高分/失败前状态重放 | 提升样本效率，不只依赖最新 batch |
| 3 | Gumbel root improvement | 根节点采样 top actions 后做小预算 Q 评估 | 少模拟下提升 root policy target 质量 |
| 4 | Chance-aware dock refill | dock 放完前后加入 spawn predictor 或多样本期望 | 降低对已知当前三块的过拟合 |
| 5 | Bonus-aware 表示升级 | 从颜色摘要进到行列同色进度 / 颜色平面 | 提高同色 bonus 命中率和 600+ 上限 |
| 6 | 稳健评估套件 | 固定 seed、分位数、bonus 率、死亡前 leaf_count、gate A/B | 避免指标好看但真实分不涨 |

### 2.6 评估注意事项

- 评估要同时看绝对分、分位排名、bonus 率、死局前可解叶子数。
- 搜索 teacher 的 entropy 太低可能过拟合，太高可能没有指导性。
- replay buffer 要记录 teacher 版本和样本年龄，避免旧 teacher 污染新策略。
- 单人分数任务的 value 不应简单照搬双人胜负 value 标度。
