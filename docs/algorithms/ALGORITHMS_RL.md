# RL 训练与推理：算法工程师手册

> 本文是 OpenBlock **强化学习子系统**的统一算法手册。  
> 范围：RL 智能体的**算法选型 / 网络结构 / 状态-动作设计 / 奖励函数 / 训练流程 / 推理流程 / 数值稳定 / 演进路线**。  
> 与现有文档的关系：本文做**统一推导与公式**，分散于 `RL_AND_GAMEPLAY.md` / `RL_ANALYSIS.md` / `RL_TRAINING_NUMERICAL_STABILITY.md` 等的细节**保留并被引用**。
> 若需要横向理解 RL 与 Spawn、玩家画像、商业化、LTV、PCGRL 的契约关系，先读 [`MODEL_ENGINEERING_GUIDE.md`](./MODEL_ENGINEERING_GUIDE.md)。

---

## 目录

1. [设计动机与算法选型](#1-设计动机与算法选型)
2. [系统总览与数据流](#2-系统总览与数据流)
3. [状态空间 $s$（181 维）](#3-状态空间-s181-维)
4. [动作空间与 $\psi(a)$（12 维）](#4-动作空间与-psia12-维)
5. [奖励函数 $r_t$ 与塑形](#5-奖励函数-r_t-与塑形)
6. [网络结构 ConvSharedPolicyValueNet](#6-网络结构-convsharedpolicyvaluenet)
7. [损失函数与优化目标](#7-损失函数与优化目标)
8. [训练流程：从环境采样到参数更新](#8-训练流程从环境采样到参数更新)
9. [探索策略：温度 + Dirichlet 噪声](#9-探索策略温度--dirichlet-噪声)
10. [价值目标：GAE × Outcome 混合](#10-价值目标gae--outcome-混合)
11. [辅助监督头：稠密信号注入](#11-辅助监督头稠密信号注入)
12. [Curriculum 与课程学习](#12-curriculum-与课程学习)
13. [Lookahead / Beam / MCTS 搜索增强](#13-lookahead--beam--mcts-搜索增强)
14. [推理流程与服务化](#14-推理流程与服务化)
15. [浏览器线性 RL Fallback](#15-浏览器线性-rl-fallback)
16. [数值稳定性与裁剪](#16-数值稳定性与裁剪)
17. [训练观测与调参顺序](#17-训练观测与调参顺序)
18. [演进路线 v1 → v7](#18-演进路线-v1--v7)
19. [常见问题诊断](#19-常见问题诊断)
20. [附录：完整超参数表](#20-附录完整超参数表)

---

## 1. 设计动机与算法选型

### 1.1 任务特性诊断

OpenBlock 的"放置 + 消行"是一个**有约束的离散 MDP**：

| 维度 | 数值 | 影响 |
|------|------|------|
| 原始局面（离散直觉） | **棋盘 8×8**：观测中 **64 维为占用 0/1**，仅二元抽象时 **$\sim 2^{64}$**；若「空 + 8 色」则 **$\sim 9^{64}$**（详见 `RL_ANALYSIS.md` §2.1）。**Dock**：`shared/shapes.json` **28** 种块型，三块形状身份量级 **$\mathcal{O}(28^3)$**（粗略；未乘 **$8^3$** 颜色，也未单独计放置进度）。 | 巨大但稀疏 |
| 观测编码（实现事实来源） | **`featureEncoding.stateDim = 181`**：42 维标量（含颜色摘要）+ 64 棋盘占用 + **75** dock 空间掩码（**3×5×5**）；策略输入 **$\psi\in\mathbb{R}^{181}$**（§3），与 **$2^{64}\!\times\!28^3$** 笛卡尔积**不等价**。 | 固定维度、可微近似；旧文档若写 162 维指 v9.2 前编码 |
| 单步合法动作数 | 0~120（典型 30~80） | 维度可变 |
| 单局长度 | 平均 ~30 步，最长 ~120 步 | 短轨迹 |
| 终局奖励稀疏度 | 高（许多步都不消行） | 信用分配难 |
| 决定性 vs 随机 | **状态转移是决定的**，但 dock 刷新有随机 | partial stochastic |

**结论**：纯蒙特卡洛 REINFORCE 方差大；纯 DQN 难处理变长动作空间；**PPO + 价值基线 + 稠密辅助信号** 是工程上 ROI 最高的组合。

### 1.2 为什么不是 DQN

- **可变动作维度**：每步 `legal` 数量不同，DQN 通常假设固定 |A|
- **短轨迹**：经验回放价值有限（局长 ~30 步即可丢弃）
- **可视化与调试**：策略网络的 logit 直接可解释为"该位置的偏好"

### 1.3 为什么不是纯 REINFORCE

- 单局回报方差大（消行 vs 不消行差异大）
- **PPO 的 clipping** 减少策略大幅波动；`n_epochs > 1` 时同 batch 多次更新提高样本效率

### 1.4 当前选型：PPO + GAE + Direct Supervision

```
主算法：       PPO（n_epochs > 1）/ REINFORCE-baseline（n_epochs = 1）
价值学习：     V(s) 监督学习 + GAE 优势
辅助监督：     board_quality / feasibility / survival / hole / clear_pred
搜索增强：     默认 3-ply beam teacher；可切换 1-step / 2-ply / MCTS（用于 Q 蒸馏）
探索：         softmax 温度 + Dirichlet 噪声
平台期突破：   Ranked Reward（滚动历史分位）+ EvalGate
```

---

## 2. 系统总览与数据流

### 2.1 双训练路径

OpenBlock RL 有**两条平行训练路径**，同一份模型：

```
路径 A: Python 自博弈（高吞吐）
   ┌──────────────────────────────────────────────────────────────┐
   │  python -m rl_pytorch.train                                 │
   │     ↓                                                        │
   │  collect_episode (OpenBlockSimulator + 网络选动作)            │
   │     ↓                                                        │
   │  攒 batch_episodes 局 → Ranked Reward → _reevaluate_and_update │
   │     ↓                                                        │
   │  PPO 更新（多 worker 可选）                                   │
   │     ↓                                                        │
   │  checkpoint → openblock_rl.pt                                │
   └──────────────────────────────────────────────────────────────┘

路径 B: 浏览器自博弈（在线）
   ┌──────────────────────────────────────────────────────────────┐
   │  浏览器 RlGameplayEnvironment + runSelfPlayEpisode           │
   │     ↓                                                        │
   │  每步：侧栏勾选 lookahead 时 POST /api/rl/eval_values + 轨迹 q_teacher │
   │        （默认不勾选 → POST /api/rl/select_action）             │
   │     ↓                                                        │
   │  局终 POST /api/rl/train_episode（攒批 32 局）                │
   │     ↓                                                        │
   │  Flask replay_buffer → _flush_replay_buffer (PPO)            │
   │     ↓                                                        │
   │  共享 checkpoint                                              │
   └──────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
┌─── 真人对局（不影响 RL）─────────────────────────┐
│  game.js → adaptiveSpawn → blockSpawn          │
└──────────────────────────────────────────────────┘
                      ┊ (解耦)
┌─── RL 训练/推理 ────────────────────────────────┐
│                                                 │
│   shared/game_rules.json     ← 单一数据源       │
│   shared/shapes.json                            │
│         ↓                                       │
│   features.py / features.js  ← 双端一致编码     │
│         ↓                                       │
│   simulator.py / simulator.js ← 无头模拟器      │
│         ↓                                       │
│   model.py: ConvSharedPolicyValueNet            │
│         ↓                                       │
│   train.py: PPO 更新循环                         │
│         ↓                                       │
│   checkpoint: rl_pytorch/openblock_rl.pt        │
│         ↓                                       │
│   rl_backend.py /api/rl/* ← HTTP 推理服务       │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 2.3 关键文件入口

| 文件 | 职责 |
|------|------|
| `rl_pytorch/train.py` | 训练循环、`collect_episode`、PPO 更新 |
| `rl_pytorch/model.py` | `ConvSharedPolicyValueNet` 与变体 |
| `rl_pytorch/simulator.py` | 无头对局 + step 奖励 + 监督信号生成 |
| `rl_pytorch/features.py` | $s$ / $\psi(a)$ / $\phi$ 编码 |
| `rl_pytorch/fast_grid.py` | NumPy 加速的合法动作 / 消行 |
| `rl_pytorch/mcts.py` | 轻量 MCTS（可选） |
| `rl_pytorch/eval_gate.py` | 评估门控（可选） |
| `rl_pytorch/spawn_predictor.py` | dock 生成预测（可选） |
| `rl_backend.py` | Flask `/api/rl/*` 推理与 replay buffer |
| `web/src/bot/trainer.js` | 浏览器自博弈与 lookahead |
| `web/src/bot/pytorchBackend.js` | HTTP 调用 RL API |
| `web/src/bot/gameEnvironment.js` | 浏览器 RL 环境包装 |

---

### 2.4 v9 平台期突破数据流

针对平均分停在 400-500 附近的问题，Python 自博弈训练默认增加三层信号：

```text
collect_episode
  ├─ 3-ply beam 生成 q_vals（搜索 teacher）
  ├─ trajectory 保存 q_vals / visit_pi
  └─ batch 采集结束后：
       score 与历史滚动窗口比较 → ranked_reward
       ranked_reward 加到该局终局步
       ↓
_reevaluate_and_update
  ├─ PPO / GAE
  ├─ Q distillation：policy 学归一化后的 beam/MCTS Q softmax 搜索分布
  ├─ visit_pi distillation：MCTS 模式下直接学习访问分布（系数可退火）
  ├─ auxiliary heads：board_quality / feasibility / survival / hole / clear_pred
  ├─ searchReplay：抽样重放困难 self-play 局
  └─ EvalGate：固定节奏、多 seed 组评估候选 vs 基线
```

设计取舍：

- **Ranked Reward** 解决单人游戏没有对手胜负、绝对分数平台化的问题。
- **3-ply beam** 对齐 OpenBlock「一轮三块」的结构，比单步 lookahead 更能发现组合摆法。
- **Q distillation** 把 beam 的临时搜索能力蒸馏进策略头，避免推理时完全依赖搜索。
- **visit_pi distillation** 在启用 MCTS 时直接模仿访问分布，比 Q 代理更接近 AlphaZero 的策略目标。
- **EvalGate** 用配对 seed 做候选/基线贪心评估，减少出块随机性造成的误判。

v9.1 修正了 teacher 质量相关的三个细节：

- `beam2/beam3` 的剩余块判断改为读取 dock 槽位的 `placed` 字段，只在真正还有 2/3 个未放置块时展开多层 beam。
- `Ranked Reward` 的目标分位从 p50 逐步爬坡到 p70，早期保留探索，平台期提高晋级标准。
- batched MCTS 展开 priors 统一使用 `forward_policy_logits(phi)`，与非批量 MCTS 保持同一套 action-feature API。
- PPO 轨迹里 `old_log_prob` 记录真实采样分布（包含 teacher 混合与 Dirichlet），避免多 epoch 更新时 ratio 与行为策略不一致。
- EvalGate 评估门槛改为与当前课程阈值对齐，并以配对严格赢率（非不输率）+ 分差双条件判定晋级，降低平局误判。
- EvalGate 新增规则开关：`RL_EVAL_GATE_RULE=win|nonloss`，默认 `win`（严格赢率）。
- Zobrist 热启动改为传入真实 numpy 网格状态，避免缓存命中路径被类型不匹配静默绕过。

v9.3 继续增强 teacher 吸收与样本效率：

- `qDistillation` 和 `visitPiDistillation` 支持 `annealEndCoef` / `annealEpisodes` 线性退火，前期强模仿、后期降低 teacher 偏差。
- Q 蒸馏默认对每个状态做 `zscore` 归一化，且用 `minStd` 限制近似平局动作的噪声放大。
- `searchReplay` 缓存高分未通关、尾局 feasibility 差的困难局，训练时抽样重放，日志显示 `replay=N`。replay 样本只参与 value / aux / distillation，不参与 PPO policy ratio；其 value target 使用纯 outcome，避免旧 GAE/ranked reward 污染。
- Teacher metrics 日志显示 `tq=覆盖率/std/margin/H` 和 `tv=覆盖率/H`，用于判断 teacher 覆盖不足、分布过尖或过平。
- MCTS 支持风险自适应 sims：高填充、低 mobility、序贯解少的局面自动增加搜索预算。
- EvalGate 支持 `rounds` 多组 seed 汇总判定，降低单组随机出块导致的门控波动。

---

## 3. 状态空间 $s$（181 维）

`s ∈ ℝ^181`，由 `extract_state_features(grid, dock)` 产出，**双端一致**（`features.py` / `features.js`）。

### 3.1 拆分

```
s = [scalars(42) ; grid_flat(64) ; dock_flat(75)]
            ↑              ↑              ↑
         手工特征      8×8 棋盘 occupancy  3 槽 × 5×5 形状 mask
```

### 3.2 42 个标量特征（手工设计）

| 编号 | 含义 | 计算 | 归一 |
|-----|------|------|------|
| 0  | 填充率 | `占用格数 / 64` | $[0,1]$ |
| 1  | 行均值 | `行填充率均值` | $[0,1]$ |
| 2  | 行方差 | $\sigma$(各行填充率) | scaled |
| 3  | 行最大 | 最大行填充率 | $[0,1]$ |
| 4  | 列均值 | `列填充率均值` | $[0,1]$ |
| 5  | 列方差 | $\sigma$(各列填充率) | scaled |
| 6  | 列最大 | 最大列填充率 | $[0,1]$ |
| 7  | 近满线比例 | `count(line ≥ 6/8) / 16` | $[0,1]$ |
| 8  | 空洞数 | 所有形状都无法合法覆盖的空格 | scaled |
| 9  | 过渡数 | 0↔1 边界总数 | scaled |
| 10 | 井深和 | 列高与邻居差 ≥2 的累加 | scaled |
| 11 | mobility | 当前可放法数 | $[0,1]$ |
| 12-22 | 结构摘要 | 高低差、近满线、空洞、过渡、井、mobility 等 | 各自归一 |
| 23-30 | 棋盘颜色占比 | 8 种 `colorIdx` 的占格比例 | $[0,1]$ |
| 31-38 | 同色线潜力 | 每种颜色在“只含该色或空格”的最佳行/列进度 | $[0,1]$ |
| 39-41 | dock 颜色 | 3 个候选块的 `colorIdx/(colorCount-1)` | $[0,1]$ |

> 完整定义：`rl_pytorch/features.py` 与 `web/src/bot/features.js` 必须**字节级一致**，单测 `tests/features.test.js` 校验。

### 3.2.1 盘面扩展感知指标含义

这些指标的目标不是直接代替棋盘 64 维 occupancy，而是把“为什么这个盘面危险/有潜力”显式暴露给策略和辅助损失：

| 指标 | 含义 | 对策略的作用 | RL 接入 |
|------|------|--------------|---------|
| `fill_ratio` | 已占格 / 64 | 判断总体拥挤度，防止高填充继续堆叠 | state + `topology_aux` |
| `row/col mean/std/max/min` | 行列填充分布 | 识别局部堆积、横向/纵向不均衡 | state |
| `almost_full_rows/cols` | 接近满行/列且空格可被形状库覆盖的数量 | 发现可兑现消行机会，排除死角假机会 | state |
| `close1/close2` | 差 1 / 2 格且所有缺口可被合法形状覆盖的行列数 | 区分“马上能消”和“需要搭桥”，但不把不可填空洞算作机会 | state + `topology_aux` |
| `holes` | 所有形状都无法合法覆盖的空格 | 表示真实死角，不是列高空洞 | state + `hole_aux` + `topology_aux` |
| `row_trans/col_trans` | 行/列 0↔1 边界次数 | 衡量碎片化程度，越高越难规划 | state + `topology_aux` |
| `wells` | 左右被挡住的空格数量 | 衡量狭窄井/夹缝风险 | state + `topology_aux` |
| `mobility` | 当前 dock 的总合法落点数 | 衡量剩余选择空间 | state + `topology_aux` |
| `color_counts` | 各颜色占格比例 | 支持同色 / 同 icon bonus 机会识别 | state |
| `mono_line_potential` | 每种颜色在可同色线中的最佳进度 | 识别 bonus 线潜力 | state |

动作特征中的 `holesRisk` 也使用同一口径：模拟当前动作落子并消行后，统计不可覆盖空洞数，而不是估算落子下方空格。

### 3.3 64 维 grid 占用

按行优先展平：`grid[r][c] ∈ {0, 1}` → 64 维。

### 3.4 75 维 dock

3 个槽 × 5×5 二值掩码：

```
dock[k] (5×5) → 展平 25 维
3 槽拼接 → 75 维
未占用槽全 0
```

### 3.5 维度变更代价

```
shared/game_rules.json featureEncoding.stateDim = 181
                       ↓
   features.py:STATE_FEATURE_DIM 同步检查（启动时 assert）
                       ↓
       checkpoint 失效（width 不变也失效，因 input layer 维度不同）
```

v9.2 将 state 从 162 扩展到 181，主要是补上颜色可观测性：同色整线 bonus 是重要得分来源，单纯 occupancy 无法区分“能拿 bonus 的满线”和“普通满线”。该变更要求旧 checkpoint 全部重训。

**改维度 ≡ 重训**。这是项目"算法 vs 数据"契约的最严格条款。

---

## 4. 动作空间与 $\psi(a)$（12 维）

### 4.1 动作语义

每步合法落子 $a = (\text{block\_idx}, g_x, g_y)$：
- `block_idx ∈ {0, 1, 2}`：dock 中第几个未消耗的形状
- $(g_x, g_y) \in \{0..7\}^2$：放置左上角

`get_legal_actions(grid, dock)` 返回**变长列表**（典型 30~80，最大 ~120）。

### 4.2 $\psi(a)$ 的 12 维

`extract_action_features` 在 `features.py` 中：

| 编号 | 含义 |
|------|------|
| 0-2 | block_idx 的 one-hot |
| 3 | $g_x / 7$ 归一 |
| 4 | $g_y / 7$ 归一 |
| 5 | 形状宽度 / 5 |
| 6 | 形状高度 / 5 |
| 7-11 | **5 维棋盘交互特征**：放后产生的消行预测、空洞变化、井影响等（v4 新增） |

> 5 维交互特征是 v4 的关键升级——之前 7 维 ψ 不带"放置后果"，导致网络难学位置选择。

### 4.3 $\phi(s, a) = [s; \psi(a)]$

- $\phi \in \mathbb{R}^{193}$
- `build_phi_batch` 一次性计算整批 $\phi$，用于策略 logit 输出

### 4.4 策略输出

```python
# model.py forward_policy_logits(phi_batch)
h = self._encode_state(states)      # [B, width]
psi = self.action_proj(action_feats)  # [B, action_embed_dim]
fused = torch.cat([h, psi], dim=-1)
logits = self.policy_fuse(fused).squeeze(-1)  # [B]
```

对每条合法动作输出**一个 logit**，最后对**该步合法动作集**做 softmax → 概率分布。**不是固定 |A| 的离散动作空间**。

---

## 5. 奖励函数 $r_t$ 与塑形

### 5.1 简化奖励（v5）

```python
# simulator.py step()
r = gain                          # 1. 消行得分增量
if _POT_ENABLED:
    r += _POT_COEF * (Φ(s') - Φ(s))   # 2. 势函数塑形
if score >= threshold and prev_score < threshold:
    r += winBonus                  # 3. 胜利奖励（一次性）
```

### 5.2 三项的物理含义

#### (1) gain — 直接计分

```
gain = baseUnit · c² + bonus_lines_score
```

与玩家计分**完全一致**（`_clear_score_gain` 与 `clearScoring.js`）。

#### (2) ΔΦ — 势函数塑形

```
Φ(s) = w_h·holes + w_t·transitions + w_w·wells 
     + w_n·near_full_lines + w_m·mobility
```

各权重在 `shared/game_rules.json.rlRewardShaping.potentialShaping`：

| 项 | 默认权重 | 物理意义 |
|----|---------|---------|
| `holeWeight` | -0.4 | 空洞数（越多越糟） |
| `transitionWeight` | -0.2 | 0↔1 边界（越多越乱） |
| `wellWeight` | -0.3 | 井深（不可达的深沟） |
| `nearFullWeight` | +0.5 | 近满线（鼓励攒大消） |
| `mobilityWeight` | +0.3 | 可落子数 |

总权重 `coef = 0.8`（外层乘子）。

> **势函数塑形 (Potential-Based Reward Shaping, Ng 1999)** 的关键性质：$r' = r + \gamma\Phi(s') - \Phi(s)$ **不改变最优策略**，只改变学习速度。

#### (3) winBonus — 胜利奖励

```
winBonus = 35   (默认)
触发：prev_score < threshold && score ≥ threshold
仅在跨越门槛的那一步加，确保稀疏但明显
```

### 5.3 终局惩罚

```python
# train.py collect_episode 末尾
if not won and ep_done:
    rewards[-1] += stuckPenalty   # = -8
```

加在**最后一步**而非分摊：让 advantage 集中在"导致死亡的关键决策"上。

### 5.4 与 v4 的差异

v4 时奖励 = `gain + Σ 各种细粒度信号`（生存、连击、消行等多达 8 项），导致：
- 权重难调
- 网络学到"在中间步刷信号"而忽视终局
- 价值目标不稳定

v5 简化为 **gain + ΔΦ + winBonus**，把细粒度信号转为**辅助监督**（§ 11），实现：
- 主奖励纯粹 → 价值目标稳定
- 细粒度信号通过 supervised regression 学，不入 advantage

---

## 6. 网络结构 ConvSharedPolicyValueNet

### 6.1 整体架构（v5 默认）

```
Input s ∈ ℝ¹⁸¹
  │
  ├── scalars[:42] ────────────────┐
  │                                  │
  ├── grid[42:106] reshape(1,8,8)   │
  │     │                            │
  │     CNN(1→32) GELU              │
  │     ResConv(32) GELU            │
  │     ResConv(32) GELU            │
  │     │ (32, 8, 8)                │
  │     ├─ AvgPool → 32 维 ─────────┤
  │     │                            │
  │     └─ keep [B,32,8,8] ────┐    │
  │                              │    │
  └── dock[106:181] reshape(3,5,5)│   │
        │                        │    │
        DockBoardAttention       │    │
          ┌────── Q ←────────────┘    │
          ├────── K, V ←──── (CNN feature map flatten 64)
          │                            │
          └─→ 3 × 16 = 48 维 ─────────┤
                                       │
                                       ▼
              concat [42 + 32 + 48 = 122 维]
                       │
                       LayerNorm(122)
                       Linear(122 → 128) GELU
                       Linear(128 → 128) GELU
                       Linear(128 → 128)
                       │
                       h(s) ∈ ℝ¹²⁸ (trunk)
                       │
        ┌──────────────┼──────────────────────┐
        │              │                      │
        ↓              ↓                      ↓
   Policy Head    Value Head           Aux Heads (3)
        │              │                      │
   ψ(a) → 48d         128 → 64           board_quality
   concat 176        GELU                feasibility
   Linear(176→128)   64 → 32             survival
   GELU              GELU                hole_aux
   Linear(128→1)     32 → 1              clear_pred
        │              │                      │
   logit(a)        V(s) ∈ ℝ              辅助监督 targets
```

### 6.2 关键模块

#### DockBoardAttention（v5 创新点）

让 dock 形状能"看见"棋盘特征图，决定"哪里有空位适合我"：

```python
class DockBoardAttention(nn.Module):
    """
    Q: dock_mask (3 槽 × 25) → Linear → 16 维 query
    K, V: grid_feature [B, C=32, 8, 8] flatten → [B, 64, 32]
    
    Attention: softmax(Q · Kᵀ / √d) · V → 每个 dock 槽得到 16 维上下文
    输出: 3 × 16 = 48 维
    """
```

物理意义：dock 的每个块"问"棋盘"我能放在哪里？"，棋盘"答"通过 cross-attention 给出空间响应。

#### ResConv

```python
class _ResConvBlock(nn.Module):
    def forward(self, x):
        h = GELU(conv1(x))
        h = conv2(h)
        return GELU(x + h)   # residual
```

经典残差块，避免深度 CNN 梯度消失。

### 6.3 参数量

| 模块 | 参数量（约） |
|------|-------------|
| grid_conv_stem (1→32) | 320 |
| ResConv × 2 | ~18K |
| DockBoardAttention | ~3K |
| trunk (LN + 3×Linear 128×128) | ~46K |
| action_proj (12→48) | 624 |
| policy_fuse (176→128→1) | ~22K |
| value_head (128→64→32→1) | ~10K |
| 三辅助 head | ~8K |
| **总计** | **~108K-110K** （v5 文档报 ~182K，含 PointNet 变体） |

### 6.4 变体

| 类名 | 用途 | 与默认差异 |
|------|------|-----------|
| `ConvSharedPolicyValueNet` | 默认 | CNN + Attention（如上） |
| `SharedPolicyValueNet` | 轻量 fallback | 纯 MLP（无 CNN/Attn） |
| `LightPolicyValueNet` | 实验 | 极简结构 |

切换由 `RL_ARCH` 环境变量控制（默认 `conv-shared`）。

### 6.5 forward 接口

```python
# 推理：单 phi → 单 logit
def forward_policy_logits(phi_batch):
    return logits  # [N]

# 推理：states → V(s)
def forward_value(states):
    return values  # [B]

# 训练：三辅助监督 head
def forward_aux_all(states):
    return {
        "board_quality": ...,
        "feasibility": ...,
        "survival": ...,
    }
```

---

## 7. 损失函数与优化目标

### 7.1 总损失

```python
# train.py _reevaluate_and_update
loss = (
    policy_loss
    + value_coef    · value_loss
    - entropy_coef  · entropy_mean        # ← 减号：最大化熵
    + hole_coef     · hole_aux_loss
    + clear_pred_coef · clear_pred_loss
    + topology_coef · topology_aux_loss
    + bq_coef       · bq_loss              # board_quality
    + feas_coef     · feas_loss            # feasibility
    + surv_coef     · surv_loss            # survival
    + q_distill_coef · q_distill_loss      # Q 分布蒸馏（可选）
)
```

### 7.2 PolicyLoss

#### PPO（n_epochs > 1）

```
ratio_t = exp(log π_new(a|s) - log π_old(a|s))
surr1 = ratio · A_t
surr2 = clip(ratio, 1-ε, 1+ε) · A_t
policy_loss = -mean( min(surr1, surr2) )
```

`ε = ppo_clip = 0.2`（默认）。

#### REINFORCE-baseline（n_epochs = 1）

```
policy_loss = -mean( log π(a|s) · A_t )
```

退化形式，无 importance ratio 修正。

### 7.3 ValueLoss（双裁剪 SmoothL1）

```python
v_clipped = v_old + clamp(v_new - v_old, -ε, +ε)
vl_unclipped = SmoothL1(v_new, return_target, β=1.0)
vl_clipped   = SmoothL1(v_clipped, return_target, β=1.0)
value_loss = mean( max(vl_unclipped, vl_clipped) )
```

**SmoothL1（Huber）** 比 MSE 抗异常值；**双裁剪**与 PPO 对称防价值估计抖动。

### 7.4 EntropyLoss

```
H(π) = -Σ π(a|s) log π(a|s)
entropy_loss = entropy_coef · mean(H)
```

`entropy_coef = 0.025` 起步，**线性衰减到 0.008**：早期鼓励探索，后期收敛。

### 7.5 辅助监督损失

| 名称 | 形式 | 系数 | Target 来源 |
|------|------|-----|------------|
| hole_aux | SmoothL1 | hole_coef | 放置并消行后的不可覆盖空洞数 |
| clear_pred | CrossEntropy(4 类) | clear_pred_coef | 实际消行类别（0/1/2/≥3） |
| topology_aux | SmoothL1(8 维) | topology_coef | 落子后的 holes / transitions / wells / 可填 close1 / 可填 close2 / mobility / fill |
| board_quality | SmoothL1 | bq_coef | $\Phi(s)$ |
| feasibility | BCE | feas_coef | 是否仍有合法动作 |
| survival | SmoothL1 | surv_coef | 距离游戏结束的步数（归一） |

### 7.6 Q 蒸馏（可选）

当启用 lookahead Q 时：

```
target_pi = softmax(Q / τ)        # τ ∈ [0.1, ∞)
q_distill_loss = -mean(Σ target_pi · log π)
```

让策略模仿 search 得到的 Q 分布——AlphaZero 策略改进的轻量版本。

---

## 8. 训练流程：从环境采样到参数更新

### 8.1 主循环（伪代码）

```python
# train.py train_loop
for episode in range(N_episodes):
    # —————— 1. Collect ——————
    transitions = collect_episode(net, simulator, ε_dirichlet, T_softmax)
    # transitions = list of (state, phi, action, log_prob, reward, value, mask, ...)
    
    episode_buffer.append(transitions)
    
    if len(episode_buffer) >= batch_episodes:
        # —————— 2. Compute returns ——————
        for ep in episode_buffer:
            ep.returns = compute_gae(ep.rewards, ep.values, γ=0.99, λ=0.85)
            ep.returns = mix_outcome(ep.returns, ep.outcome, mix=0.5)
        
        # —————— 3. PPO Update ——————
        for epoch in range(ppo_epochs):
            for mini_batch in shuffle(episode_buffer):
                loss = compute_loss(net, mini_batch, old_log_probs, old_values)
                opt.zero_grad()
                loss.backward()
                clip_grad_norm_(net.parameters(), max_norm=1.0)
                opt.step()
        
        episode_buffer.clear()
    
    # —————— 4. Periodic ——————
    if episode % save_interval == 0:
        save_checkpoint(net, optimizer)
        log_metrics(...)
```

### 8.2 collect_episode 细节

```python
def collect_episode(net, sim, ε_dirichlet, T):
    transitions = []
    sim.reset()
    while not sim.done:
        phi_batch = build_phi_batch(sim.state, sim.legal_actions)
        logits = net.forward_policy_logits(phi_batch)
        
        # 探索：温度 + Dirichlet
        probs = mix_dirichlet(softmax(logits / T), ε_dirichlet, α=0.28)
        a_idx = Categorical(probs).sample()
        
        # 可选 lookahead 改写动作
        if lookahead_enabled:
            a_idx = lookahead_select(net, sim, ...)
        
        # 执行动作
        v = net.forward_value(sim.state)
        r = sim.step(legal_actions[a_idx])
        
        transitions.append({
            'state': sim.state,
            'phi': phi_batch[a_idx],
            'action_idx': a_idx,
            'log_prob': log(probs[a_idx]),
            'reward': r,
            'value': v,
            'legal_mask': mask,  # 用于 PPO 阶段重算 logits
        })
    
    return transitions
```

### 8.3 GAE 计算

Generalized Advantage Estimation (Schulman 2015)：

$$A_t^{\text{GAE}(\gamma, \lambda)} = \sum_{l=0}^{T-t-1} (\gamma \lambda)^l \delta_{t+l}$$

其中 $\delta_t = r_t + \gamma V(s_{t+1}) - V(s_t)$。

代码：

```python
def compute_gae(rewards, values, γ=0.99, λ=0.85):
    advantages = np.zeros_like(rewards)
    last_gae = 0
    for t in reversed(range(len(rewards))):
        v_next = values[t+1] if t+1 < len(values) else 0
        delta = rewards[t] + γ * v_next - values[t]
        last_gae = delta + γ * λ * last_gae
        advantages[t] = last_gae
    returns = advantages + values
    return advantages, returns
```

### 8.4 默认超参

| 名称 | 值 | 来源 |
|------|----|----|
| `γ` (discount) | 0.99 | `RL_GAMMA` |
| `λ` (GAE) | 0.85 | `RL_GAE_LAMBDA` |
| `ppo_clip` | 0.2 | `RL_PPO_CLIP` |
| `ppo_epochs` (online) | 3 | `RL_PPO_EPOCHS_ONLINE` |
| `lr` | 3e-4 | `RL_LR` |
| `batch_episodes` | 8 | `RL_BATCH_EPISODES` |
| `entropy_coef` | 0.025 → 0.008 | `RL_ENTROPY_COEF[_MIN]` |
| `value_coef` | 0.5 | `RL_VALUE_COEF` |
| `hole_coef` | 0.1 | `RL_HOLE_COEF` |

---

## 9. 探索策略：温度 + Dirichlet 噪声

### 9.1 为什么不是 ε-greedy

- **ε-greedy 的均匀噪声**对长尾 logit 分布破坏严重（强势动作概率被稀释）
- **温度缩放**保持相对偏好，更细腻
- **Dirichlet 噪声**（AlphaZero 风格）只在概率"已经存在的方向"上扰动

### 9.2 公式

```python
def _mix_dirichlet_and_sample(logits, T, ε, α):
    probs = softmax(logits / T)             # 温度
    noise = Dirichlet(α · 1_n).sample()    # n = |legal|
    mixed = (1 - ε) · probs + ε · noise    # 线性混合
    return Categorical(mixed).sample()
```

### 9.3 默认值

| 参数 | 默认 | 物理意义 |
|------|------|---------|
| `T` (temperature) | 1.0 | logits 的温度（采样阶段；推理时可用 0） |
| `ε` (dirichlet_epsilon) | 0.08 | 噪声混合比例 |
| `α` (dirichlet_alpha) | 0.28 | Dirichlet 形状参数（小 α → 噪声更尖） |

### 9.4 衰减机制

`RL_DIRICHLET_DECAY_EPISODES = 5000` 时，前 5000 局 ε 从 0.08 线性衰减到 0：

```
ε(ep) = max(0, ε_start · (1 - ep / decay_ep))
```

让网络从"鼓励探索"过渡到"利用经验"。

### 9.5 推理时的探索

`POST /api/rl/select_action` 的 `temperature` 字段：
- `T = 0`：贪心（argmax）
- `T = 1.0`：保留训练分布
- `T = 1.5`：更随机（用于调试 / 多样性）

---

## 10. 价值目标：GAE × Outcome 混合

### 10.1 问题

纯 GAE 回报 $G_t = A_t + V(s_t)$ 在长轨迹上累积估计误差：
- 早期 $V$ 不准 → $A$ 不准 → 训练发散
- 但终局得分 (outcome) 是**精确**的真值

### 10.2 v9.2 的混合方案

```python
outcome = clip(log1p(final_score) / log1p(win_threshold), 0, 3)
return_target = (1 - mix) · GAE_return + mix · outcome
```

`mix = 0.5` 默认（`outcomeValueMix.mix`）。所有时刻共享同一 outcome 终局信号。v9.2 改用 log 目标，是为了避免 400-500 分在 `score / threshold` 表达下过早贴近 clip 上限，导致价值头难以区分更高分局。

### 10.3 直观

```
GAE：     "根据 V 估的，可能不准但有时序信息"
Outcome： "终局这一局打了多少分（log 后除以胜利门槛）"
混合：    "前期主要看终局，后期相信 V"（其实是按 mix 直接加权）
```

### 10.4 副作用

- ✅ 价值头训练更稳（有真值 anchor）
- ⚠ 对长轨迹 advantage 有 bias（terminal 信号"渗透"到中间步）
- ✅ 与 outcome 加权一起的还有"survival" 辅助 head，互为补充

---

## 11. 辅助监督头：稠密信号注入

### 11.1 设计思想

把"难学的稀疏信号"通过辅助任务**强行注入到 trunk**，让 $h(s)$ 成为更好的特征：

| Head | Target | 作用 |
|------|--------|-----|
| `board_quality` | $\Phi(s)$ | trunk 学会"棋盘好坏" |
| `feasibility` | 是否存在顺序能放完剩余 dock | trunk 学会"是否还能继续" |
| `survival` | 距离 game over 步数（归一） | trunk 学会"活多久" |
| `hole_aux` | 放置并消行后的不可覆盖 holes | $\phi$ 学会"这步会留下多少真实死角" |
| `topology_aux` | 落子后 8 维拓扑向量 | $\phi$ 学会"这步会如何改变盘面结构" |
| `clear_pred` | 实际消行类别 (0/1/2/≥3) | $\phi$ 学会"会不会消行" |

### 11.2 信号来源

`simulator.py` `get_supervision_signals()` 在每步返回 ground truth：

```python
{
    'board_quality': potential(grid, dock),
    'feasibility': 1 if sequential_solution_leaves > 0 else 0,
    'survival_steps_remaining': T_max - t,  # 估算
    'holes_after': count_unfillable_cells(grid_after_clear),
    'topology_after': [holes, row_trans, col_trans, wells, fillable_close1, fillable_close2, mobility, fill],
    'clears_class': 0/1/2/3,
}
```

### 11.3 系数策略

```
hole_coef:        0.1   # 较强（直接信号）
clear_pred_coef:  0.05
bq_coef:          0.05
feas_coef:        0.05
surv_coef:        0.03
```

总辅助损失约占总损失 20-30%。过高会主导 trunk，过低又起不到 regularization 作用。

---

## 12. Curriculum 与课程学习

### 12.1 为什么需要

- 直接训"赢 220 分"局：早期网络几乎不可能赢，所有 episode 都失败 → 学习信号极弱
- 解法：**线性提升胜利门槛**，从易到难

### 12.2 默认课程（`shared/game_rules.json.rlCurriculum`）

```json
{
    "enabled": true,
    "startScore": 40,
    "endScore": 220,
    "totalEpisodes": 40000
}
```

```
threshold(ep) = startScore + (endScore - startScore) · min(1, ep / totalEpisodes)
```

| Episode | Threshold |
|---------|-----------|
| 0 | 40 |
| 10000 | 40 + 180 · 0.25 = 85 |
| 20000 | 130 |
| 30000 | 175 |
| 40000+ | 220（上限） |

### 12.3 自适应课程（实验）

`adaptiveCurriculum.enabled = true` 时，按滑动胜率调整虚拟 episode 推进：

```
if win_rate_last_500 > 0.7:
    virtual_ep += 1  # 推进更快
elif win_rate < 0.3:
    virtual_ep += 0.3  # 慢慢加难度
```

### 12.4 推理与课程

**推理时**统一用 `WIN_SCORE_THRESHOLD = 220`（产品常量），不读 curriculum。仅训练时算"是否赢"用 `sim.win_score_threshold`。

> ⚠️ **已知不一致**：浏览器 `RlGameplayEnvironment.won` 用固定 220，与 Python `collect_episode` 的动态门槛不一致。如做严格对照，需对齐。

---

## 13. Lookahead / Beam / MCTS 搜索增强

### 13.1 三种搜索模式

| 模式 | 复杂度 | 用途 |
|------|--------|------|
| **1-step** | $O(\|A\|)$ | 评估每个合法动作的 V(s')，选 max(r + V) |
| **2-ply Beam** | $O(K \cdot \|A\|)$ | 从 1-step 的 top-K 中再展开一步 |
| **MCTS** | $O(N \cdot \text{depth})$ | 模拟 N 次完整树搜索 |

### 13.2 1-step Lookahead

```python
# trainer.js _selectWithLookahead
for each legal action a:
    s' = simulator.simulate_step(s, a)
    Q(a) = r(s, a) + γ · V(s')
return argmax_a Q(a)
```

仅在 `len(legal) ≤ 120` 时启用，避免过慢。

### 13.3 Beam 2-ply（实验）

`shared/game_rules.json.beam2ply.enabled = true` 时：

```
top_K_actions = top-K(logits)  # K = 15
for each a in top_K:
    s' = sim_step(s, a)
    legal' = legal_actions(s')
    for each a' in legal'_top:
        s'' = sim_step(s', a')
        Q(a, a') = r + γ·r' + γ²·V(s'')
return argmax_{a, a'} Q
```

复杂度从 $O(\|A\|)$ → $O(15 \times \|A'\|)$。

### 13.4 MCTS（更前沿）

`rl_pytorch/mcts.py` 实现 PUCT-style 搜索：

```
UCT(s, a) = Q(s, a) + c_puct · π(a|s) · √(ΣN) / (1 + N(s, a))
```

- $c_{puct}$ 默认 1.5
- 用网络 $\pi$ 作为先验，价值 $V$ 作为叶节点估值
- N 次模拟后用 visit count 作为改进策略

仅训练时用（生成 Q 蒸馏 target），推理因延迟太高不用。

---

## 14. 推理流程与服务化

### 14.1 推理路径（生产）

```
浏览器：
   step → 调 pytorchBackend.selectActionRemote(state, legal)
              ↓ HTTP
   Flask /api/rl/select_action
              ↓
   load checkpoint（首次） / hot model
              ↓
   model.forward_policy_logits(phi_batch)
              ↓
   softmax + Categorical sample
              ↓
   return { index }
   
Latency: ~5-50ms（CPU）/ ~2-10ms（MPS/CUDA）
```

### 14.2 API 详表

| 路径 | 方法 | 入参 | 出参 |
|------|------|-----|-----|
| `/api/rl/select_action` | POST | `{ phi: float[][], state: float[], temperature?: float }` | `{ index: int }` |
| `/api/rl/eval_values` | POST | `{ states: float[][] }` | `{ values: float[] }` |
| `/api/rl/train_episode` | POST | 整局轨迹 | `{ ok, batched: bool }` |
| `/api/rl/flush_buffer` | POST | `{}` | 未满批也可触发批量 PPO |
| `/api/rl/eval_greedy` | POST | `{ n_games?, rounds?, temperature?, win_threshold?, seed_base? }` | 贪心评估 + 写 JSONL |
| `/api/rl/training_log` | GET | `?tail=N` | 最新 N 条训练记录 |
| `/api/rl/checkpoint` | POST | `{ action: 'save' / 'load' }` | `{ ok }` |

在线训练与离线评估对照、search replay、`npm run rl:eval` 详见 **[RL_PYTORCH_SERVICE.md](./RL_PYTORCH_SERVICE.md)**。

### 14.3 模型加载

`rl_backend.py` 启动时：

```python
def _ensure_initialized():
    if model is None:
        meta = _load_checkpoint_meta()  # arch / width / state_dim
        model = ConvSharedPolicyValueNet(width=meta['width'])
        model.load_state_dict(torch.load(CKPT_PATH))
        model.eval()
```

热加载：`/api/rl/checkpoint?action=reload` 强制重读 checkpoint（用于训练中替换模型）。

### 14.4 并发与设备

- **设备**：自动选 `cuda > mps > cpu`（`rl_pytorch/device.py`）
- **批量推理**：`/api/rl/eval_values` 接受多个 state 一次返回（用于 lookahead 加速）
- **线程安全**：Flask 默认单进程；高并发时建议加 GIL-bypass（torch.no_grad + torch.jit）

### 14.5 浏览器 fallback

无服务端时：

```
useBackend=false → trainer.js 用 LinearAgent
                   - 状态 → 线性投影 → softmax
                   - 在浏览器内 REINFORCE 学习
                   - 无神经网络
```

性能差但无依赖。

### 14.6 在线训练与贪心评估对照

在侧栏 **勾选 1-step lookahead**（默认不勾选；`trainSelfPlay` / `runSelfPlayEpisode` 未传 **`useLookahead`** 时亦为 **`false`**）时，POST 可携带 **`q_teacher`**（每条合法动作的 `r + γ V(s')`），服务端映射为 `q_vals` 后 **Q 蒸馏**生效，**Teacher Q coverage** 可大于 0（弱 teacher，**不等价**于离线 beam/MCTS）。前端对 **`/api/rl/eval_values`** 响应做长度与类型校验，失败或非法时 **回退 `select_action`**。**visit_pi**（MCTS 访问分布）在线仍不传，除非扩展协议。判断策略是否进步应结合 **`python3 -m rl_pytorch.eval_cli`**（或 `POST /api/rl/eval_greedy`）的**固定协议贪心评估**，而非仅依赖滑动窗口胜率。完整说明见 [RL_PYTORCH_SERVICE.md](./RL_PYTORCH_SERVICE.md)。

---

## 15. 浏览器线性 RL Fallback

### 15.1 设计理由

- 演示场景不依赖后端
- 移动端 / 小程序低延迟
- 用作"对照基线"看 NN 究竟有多大提升

### 15.2 实现（与仓库一致）

- **代码**：`web/src/bot/linearAgent.js`（`W·φ` 策略、`Vw·ψ` 价值）、`web/src/bot/trainer.js`（`runSelfPlayEpisode`、`trainSelfPlay`、`reinforceUpdate`）。
- **超参与温度**：`shared/game_rules.json` → **`browserRlTraining`**（`gamma`、`policyLr`、`valueLr`、`entropyCoef`、`maxGradNorm`、`temperatureLocal`、`temperatureBackend`）。前端通过 `resolveBrowserRlTrainingConfig()` 读取；**PyTorch 在线训练**路径每局采样温度使用 `temperatureBackend`。
- **算法要点**：回报 Welford 标准化 + 批内优势标准化 + 裁剪；策略更新为 **REINFORCE + 基线**，并叠加 **熵 bonus**：`ΔW ∝ lr · (A · ∇logπ(a) + β · ∇_W H)`，β=`entropyCoef`（详见 [`RL_BROWSER_OPTIMIZATION.md`](./RL_BROWSER_OPTIMIZATION.md) §3.2 / §5）。

### 15.3 关键差异

| 维度 | 浏览器线性 | PyTorch NN |
|-----|----------|-----------|
| 算法 | REINFORCE-baseline | PPO + GAE |
| 状态编码 | 直接喂旧版低维状态 | CNN + Attention + 181 维颜色摘要状态 |
| 收敛局数 | ~5000 | ~40000 |
| 收敛上限 | ~100 分 | ~220 分（理论） |
| 推理延迟 | <1ms | 5-50ms |

---

## 16. 数值稳定性与裁剪

详见 `RL_TRAINING_NUMERICAL_STABILITY.md`，本节做要点摘录：

### 16.1 logits 裁剪

```python
def _stable_logits(logits, max_abs=20.0):
    return torch.clamp(logits, -max_abs, max_abs)
```

防止 softmax 后 inf/nan。

### 16.2 log_prob 裁剪

```python
def _clamp_log_probs_pg(lp, min_lp=-30.0):
    return torch.clamp(lp, min=min_lp)
```

防止 log(0) → -inf 影响梯度。

### 16.3 ratio 裁剪

```python
log_ratio = (new_lp - old_lp).clamp(-10.0, 10.0)
ratio = exp(log_ratio)
```

防止 PPO 的 ratio 爆炸。

### 16.4 advantage 归一化

```python
A_normalized = (A - A.mean()) / (A.std() + 1e-8)
```

每个 batch 内归一化，让不同 episode 的 reward scale 不影响梯度尺度。

### 16.5 gradient clipping

```python
torch.nn.utils.clip_grad_norm_(net.parameters(), max_norm=1.0)
```

防止梯度爆炸。

### 16.6 NaN safety

```python
def _safe_aux(t):
    return t if torch.isfinite(t).item() else torch.zeros_like(t)
```

每个辅助 loss 都过 `_safe_aux`，防止单条坏样本毁掉一次 update。

### 16.7 环境变量列表

| 变量 | 用途 | 默认 |
|------|-----|-----|
| `RL_RETURN_SCALE` | 终局 outcome 归一分母 | `WIN_SCORE_THRESHOLD` |
| `RL_LOG_LEVEL` | 日志级别 | `INFO` |
| `RL_LOG_MAX_LINES` | training.jsonl 最大行数 | 100000 |
| `RL_GRAD_CLIP` | gradient norm 上限 | 1.0 |
| `RL_Q_DISTILL_NORM` | teacher Q 归一化：`zscore` / `rank` / `none` | `zscore` |
| `RL_Q_DISTILL_MIN_STD` | Q zscore 标准差下限，防止近似平局目标过尖 | `0.25` |
| `RL_SEARCH_REPLAY` | 困难样本 replay 开关 | `1` |
| `RL_MCTS_RISK_ADAPTIVE` | MCTS 风险自适应 sims 开关 | `1` |
| `RL_MCTS_MAX_SIMS` | 风险自适应 MCTS 单步模拟上限 | `80` |
| `RL_EVAL_GATE_ROUNDS` | EvalGate 配对 seed 组数 | `2` |

---

## 17. 训练观测与调参顺序

### 17.1 看板六图（详见 `RL_TRAINING_DASHBOARD_TRENDS.md`）

| 图 | 健康形态 | 异常形态 |
|----|---------|---------|
| Episode Score | 平稳上升 | 长平台 / 阵发性下跌 |
| Policy Loss | 下降后稳定在 0.05-0.2 | 持续上升 |
| Value Loss | 单调下降到 < 1.0 | 震荡或平坦 |
| Entropy | 缓慢下降（探索→利用） | 突降到 0（饱和）/不下降（无收敛） |
| Win Rate | 随 curriculum 上升 | 长期 < 0.05 |
| Avg Steps per Episode | 稳定增长（活更久） | 突降（频繁 stuck） |

### 17.2 调参顺序（经验）

```
①  lr 找对 → 价值损失收敛
②  γ / λ 调 → advantage 形状对（看 distribution）
③  entropy_coef 调衰减 → 不饱和也不发散
④  辅助 head 系数 → 不抢主任务但 trunk 更稳
⑤  curriculum 节奏 → 始终有合理胜率（5-30%）
⑥  搜索增强（lookahead/MCTS） → 最后加
```

**反模式**：直接堆 PPO epochs / batch size，不调上面 → 大概率发散。

### 17.3 何时停训

- Episode score 7 日内提升 < 5%
- Win rate 7 日内提升 < 1pp
- Entropy 已稳定不再下降
- 验证集（如有）评估持平

→ 此时模型已"在当前架构下基本到顶"，需考虑改架构 / 改 reward / 加 search。

---

## 18. 演进路线 v1 → v7

| 版本 | 关键变化 | 状态 |
|------|---------|------|
| **v1** | 浏览器 LinearAgent + REINFORCE + ε-greedy | 历史 |
| **v2** | PyTorch 残差 MLP + advantage normalization | 历史 |
| **v3** | + replay buffer + 离线 PPO | 历史 |
| **v4** | + 7→12 维 ψ（5 维交互特征） | 历史 |
| **v5** | + ConvSharedPolicyValueNet（DockBoardAttention）<br>+ outcome/GAE 价值混合<br>+ 三辅助监督头<br>+ 简化 reward | **当前** |
| **v6** | + Q 蒸馏 / 2-ply beam 搜索（实验） | 路线图 |
| **v7** | + 评估门控 / spawn predictor / MCTS 完整 | 路线图 |

详见各分册：
- v5：`RL_TRAINING_OPTIMIZATION.md`
- v6/v7：`RL_ALPHAZERO_OPTIMIZATION.md`

---

## 19. 常见问题诊断

### 19.1 "训练几千局后熵突降到 0"

- 原因 1：`entropy_coef` 衰减过快
- 原因 2：advantage 归一化失效（标准差爆 0）
- 解决：拉长 `RL_ENTROPY_DECAY_EPISODES` / 检查 advantage `std`

### 19.2 "胜率稳定在 0% 附近"

- 原因 1：curriculum 起点太高（startScore > 当前能力）
- 原因 2：模型太大 batch 太小，过拟合
- 解决：起点降到 30-40 / batch_episodes = 16

### 19.3 "value_loss 不收敛"

- 原因 1：return scale 不匹配（reward 太大或太小）
- 原因 2：outcome mix 太小，全靠 GAE 估
- 解决：`RL_RETURN_SCALE` 调 / `outcomeValueMix.mix=0.5`

### 19.4 "policy_loss 持续负值且大"

- 原因：advantage 没归一化或 sign 错（log_prob 计算 bug）
- 解决：检查 `_clamp_log_probs_pg` 与 `mask` 一致性

### 19.5 "推理时 forward_policy_logits 报维度错"

- 原因：checkpoint 与代码 `STATE_FEATURE_DIM` 不一致
- 解决：删旧 checkpoint 重训 / 回退代码到匹配版本

### 19.6 "浏览器训练日志看不到曲线"

- 原因：未勾选 PyTorch 时用 localStorage；勾选后用 `/api/rl/training_log`
- 解决：见 `RL_TRAINING_DASHBOARD_FLOW.md` § 数据源切换

---

## 20. 附录：完整超参数表

### 20.1 网络结构

| 参数 | 默认 | 来源 |
|------|------|-----|
| `RL_ARCH` | `conv-shared` | env / checkpoint meta |
| `RL_WIDTH` | 128 | env |
| `conv_channels` | 32 | 代码常量 |
| `action_embed_dim` | 48 | 代码常量 |
| `dock_attn_head_dim` | 16 | 代码常量 |

### 20.2 训练超参

| 参数 | 默认 | env 变量 |
|------|------|---------|
| `lr` | 3e-4 | `RL_LR` |
| `γ` (discount) | 0.99 | `RL_GAMMA` |
| `λ` (GAE) | 0.85 | `RL_GAE_LAMBDA` |
| `ppo_clip` | 0.2 | `RL_PPO_CLIP` |
| `ppo_epochs_online` | 3 | `RL_PPO_EPOCHS_ONLINE` |
| `batch_episodes` | 8 | `RL_BATCH_EPISODES` |
| `online_batch_size` | 32 | `RL_BATCH_SIZE` |
| `value_coef` | 0.5 | `RL_VALUE_COEF` |
| `entropy_coef_start` | 0.025 | `RL_ENTROPY_COEF` |
| `entropy_coef_min` | 0.008 | `RL_ENTROPY_COEF_MIN` |
| `value_huber_beta` | 1.0 | `RL_VALUE_HUBER_BETA` |
| `grad_clip` | 1.0 | `RL_GRAD_CLIP` |

### 20.3 探索

| 参数 | 默认 |
|------|------|
| `temperature` | 1.0 |
| `dirichlet_epsilon_start` | 0.08 |
| `dirichlet_epsilon_end` | 0.0 |
| `dirichlet_alpha` | 0.28 |
| `decay_episodes` | 5000 |

### 20.4 辅助损失

| 参数 | 默认 |
|------|------|
| `hole_coef` | 0.1 |
| `clear_pred_coef` | 0.05 |
| `bq_coef` | 0.05 |
| `feas_coef` | 0.05 |
| `surv_coef` | 0.03 |
| `q_distill_coef` | 0.0（默认关） |
| `q_distill_tau` | 1.0 |

### 20.5 课程

| 参数 | 默认 |
|------|------|
| `startScore` | 40 |
| `endScore` | 220 |
| `totalEpisodes` | 40000 |
| `WIN_SCORE_THRESHOLD` | 220 |
| `stuckPenalty` | -8 |
| `winBonus` | 35 |

### 20.6 势函数

| 参数 | 默认 |
|------|------|
| `coef` (外层乘子) | 0.8 |
| `holeWeight` | -0.4 |
| `transitionWeight` | -0.2 |
| `wellWeight` | -0.3 |
| `nearFullWeight` | +0.5 |
| `mobilityWeight` | +0.3 |

---

## 关联文档

| 文档 | 关系 |
|------|------|
| [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md) | 总索引 |
| [`RL_AND_GAMEPLAY.md`](./RL_AND_GAMEPLAY.md) | 系统分层与单一数据源 |
| [`RL_ANALYSIS.md`](./RL_ANALYSIS.md) | 早期评估与改进建议 |
| [`RL_TRAINING_OPTIMIZATION.md`](./RL_TRAINING_OPTIMIZATION.md) | v4 → v5 重构记录 |
| [`RL_TRAINING_NUMERICAL_STABILITY.md`](./RL_TRAINING_NUMERICAL_STABILITY.md) | 数值稳定专章 |
| [`RL_ALPHAZERO_OPTIMIZATION.md`](./RL_ALPHAZERO_OPTIMIZATION.md) | v6/v7 路线图（Q 蒸馏 / search） |
| [`RL_BROWSER_OPTIMIZATION.md`](./RL_BROWSER_OPTIMIZATION.md) | 浏览器 LinearAgent 调优 |
| [`RL_TRAINING_DASHBOARD_FLOW.md`](./RL_TRAINING_DASHBOARD_FLOW.md) | 训练看板数据流 |
| [`RL_TRAINING_DASHBOARD_TRENDS.md`](./RL_TRAINING_DASHBOARD_TRENDS.md) | 训练曲线判读 |

---

> 最后更新：2026-04-27 · 与 v5 实现对齐（ConvSharedPolicyValueNet）  
> 维护：算法工程团队
