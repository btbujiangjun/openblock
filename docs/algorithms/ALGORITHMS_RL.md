# RL 训练与推理：算法工程师手册

> 本文是 OpenBlock **强化学习子系统**的统一算法手册。
> 范围：RL 智能体的**算法选型 / 网络结构 / 状态-动作设计 / 奖励函数 / 训练流程 / 推理流程 / 数值稳定 / 演进路线**。
> 与现有文档的关系：本文维护当前算法事实和公式；[本手册 §21](#二十一rl-契约与在线服务) §一维护栏目导航，其他 RL 文档只维护契约、服务、看板或历史实验专题。
> 若需要横向理解 RL 与 Spawn、玩家画像、商业化、LTV、PCGRL 的契约关系，先读 [`MODEL_ENGINEERING_GUIDE.md`](./MODEL_ENGINEERING_GUIDE.md)；若要对比启发式出块、生成式出块、PyTorch RL 与浏览器 RL，读 [`MODEL_SYSTEMS_FOUR_MODELS.md`](./MODEL_SYSTEMS_FOUR_MODELS.md)。

---

## 目录

1. [设计动机与算法选型](#一设计动机与算法选型)
2. [系统总览与数据流](#二系统总览与数据流)（含 [三条路径对照](#21-三条运行路径训练--推理--线上)）
3. [状态空间 $s$（190 维）](#三状态空间-s190-维)
4. [动作空间与 $\psi(a)$（15 维）](#四动作空间与-psia15-维)
5. [奖励函数 $r_t$ 与塑形](#五奖励函数-r_t-与塑形)
6. [网络结构 ConvSharedPolicyValueNet](#六网络结构-convsharedpolicyvaluenet)
7. [损失函数与优化目标](#七损失函数与优化目标)
8. [训练流程：从环境采样到参数更新](#八训练流程从环境采样到参数更新)
9. [探索策略：温度 + Dirichlet 噪声](#九探索策略温度-dirichlet-噪声)
10. [价值目标：GAE × Outcome 混合](#十价值目标gae-outcome-混合)
11. [辅助监督头：稠密信号注入](#十一辅助监督头稠密信号注入)
12. [Curriculum 与课程学习](#十二curriculum-与课程学习)
13. [Lookahead / Beam / MCTS 搜索增强](#十三lookahead-beam-mcts-搜索增强)
14. [推理流程与服务化](#十四推理流程与服务化)
15. [浏览器线性 RL Fallback](#十五浏览器线性-rl-fallback)
16. [数值稳定性与裁剪](#十六数值稳定性与裁剪)
17. [训练观测与调参顺序](#十七训练观测与调参顺序)
18. [演进路线 v1 → v7](#十八演进路线-v1-v7)
19. [常见问题诊断](#十九常见问题诊断)
20. [附录：完整超参数表](#二十附录完整超参数表)
21. [RL 契约与在线服务](#二十一rl-契约与在线服务)
22. [RL 训练监控与排障](#二十二rl-训练监控与排障)
23. [RL 研究：复杂度、瓶颈与文献对照](#二十三rl-研究复杂度瓶颈与文献对照)

---

## 一、设计动机与算法选型

### 1.1 任务特性诊断

OpenBlock 的"放置 + 消行"是一个**有约束的离散 MDP**：

| 维度 | 数值 | 影响 |
|------|------|------|
| 原始局面（离散直觉） | **棋盘 8×8**：观测中 **64 维为占用 0/1**，仅二元抽象时 **$\sim 2^{64}$**；若「空 + 8 色」则 **$\sim 9^{64}$**（详见 本手册 §23 §1.1）。**Dock**：`shared/shapes.json` **28** 种块型，三块形状身份量级 **$\mathcal{O}(28^3)$**（粗略；未乘 **$8^3$** 颜色，也未单独计放置进度）。 | 巨大但稀疏 |
| 观测编码（实现事实来源） | **`featureEncoding.stateDim = 190`**：51 维标量（25 结构 + 19 颜色 + 4 单步难度 + **3 策略 one-hot**）+ 64 棋盘 + **75** dock 掩码；**$\phi\in\mathbb{R}^{205}$**。训练每局随机 `strategyId`；推理用 UI 所选难度。 | 固定维度、可微近似 |
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

## 二、系统总览与数据流

### 2.1 三条运行路径（训练 · 推理 · 线上）

OpenBlock RL 在工程上呈现 **三条路径**（完整对照表、Mermaid 图与代码锚点见 **[`RL_CONTRACT_AND_SERVICE.md` §2.6](./RL_CONTRACT_AND_SERVICE.md#26-rl-训练机制三条路径对照权威)**）：

| 路径 | 作用 | 是否写 checkpoint |
|------|------|-------------------|
| **A 离线 PyTorch** | `train.py` + `collect_episode`；默认 MCTS teacher + 线上同源出块 worker | ✅ |
| **B 浏览器 RL** | `trainer.js` → `/api/rl/*`；同特征与（规则轨）同出块；teacher 弱于 A | ✅（与 A 互斥写盘） |
| **C 线上对局** | `game.js`；产品真相源；可选 spawn 模型 | ❌ |

**两条训练路径**（A + B）共享同一份 `PolicyValueNet` 权重；**路径 C** 不参与梯度更新，但决定玩家体验的出块/难度与 Bot 推理时的 `strategyId` 输入。

```
路径 A: Python 自博弈（高吞吐，推荐量产样本）
   ┌──────────────────────────────────────────────────────────────┐
   │  python -m rl_pytorch.train  或  scripts/train_full_mcts.sh │
   │     ↓                                                        │
   │  collect_episode(simulator.py + spawn worker / block_spawn)  │
   │     · 每局随机 strategyId → state 末 3 维 one-hot（190 维）   │
   │     · 落子：MCTS > beam3ply > beam2ply > 1-step（可配置）      │
   │     ↓                                                        │
   │  batch → Ranked Reward → PPO（多 worker + searchReplay）      │
   │     ↓                                                        │
   │  checkpoint → rl_checkpoints/*.pt                            │
   └──────────────────────────────────────────────────────────────┘

路径 B: 浏览器自博弈（在线面板 / 弱 teacher）
   ┌──────────────────────────────────────────────────────────────┐
   │  RlGameplayEnvironment(simulator.js) + runSelfPlayEpisode    │
   │     ↓                                                        │
   │  每步 POST /api/rl/select_action（默认）或 eval_values（Q）   │
   │     ↓                                                        │
   │  局终 POST /api/rl/train_episode（RL_BATCH_SIZE 攒批）        │
   │     ↓                                                        │
   │  共享 checkpoint（勿与 A 同时训练写同一文件）                    │
   └──────────────────────────────────────────────────────────────┘

路径 C: 线上（推理与数据，非训练环）
   ┌──────────────────────────────────────────────────────────────┐
   │  game.js → spawnBlocks → adaptiveSpawn / spawnModel          │
   │  玩家落子；RL Bot 部署时用 B/A 的 net + 界面 strategyId       │
   └──────────────────────────────────────────────────────────────┘
```

**机制要点（避免常见误解）**

- **出块**：A 在 v1.68 默认与 B/C 规则轨一致（`rl-spawn-worker`）；仅 `RL_SPAWN_ONLINE=0` 时 A 退回启发式 `block_spawn.py`，与线上分布分叉。
- **落子**：A 的 MCTS/beam 蒸馏远强于 B 的默认采样；B 的 `teacher_q_coverage` 依赖 lookahead + `q_teacher`。
- **策略条件化**：训练随机 `easy|normal|hard`；面板「评估一局」与线上一致，固定为 `game.strategy`。
- **BlockPool**：仅 C（经 `main.js`）有；A/B 训练局无此包装，部署 Bot 时仍有轻微分布差。

### 2.2 数据流

```
┌─── 路径 C：真人对局 / 产品主流程 ─────────────────┐
│  game.js → adaptiveSpawn → blockSpawn            │
│           （或 spawnModel v3 + 护栏回退）          │
│  行为日志 frames → spawn 模型 / 分析（可选）       │
└──────────────────────────────────────────────────┘
                      ┊ 规则 JSON 契约（解耦观测内部状态）
┌─── 路径 A + B：RL 训练 / 推理 ────────────────────┐
│  shared/game_rules.json + shared/shapes.json      │
│         ↓                                         │
│  features.py / features.js  (state 190, φ 205)    │
│         ↓                                         │
│  simulator.py + spawn worker  |  simulator.js     │
│         ↓                                         │
│  ConvSharedPolicyValueNet (model.py)              │
│         ↓                                         │
│  train.py (A)  |  rl_backend.py (B)             │
│         ↓                                         │
│  checkpoint → 推理：Bot / 面板 / eval_cli         │
└───────────────────────────────────────────────────┘
```

### 2.3 关键文件入口

| 文件 | 职责 |
|------|------|
| `rl_pytorch/train.py` | 训练循环、`collect_episode`、PPO 更新 |
| `rl_pytorch/model.py` | `ConvSharedPolicyValueNet` 与变体 |
| `rl_pytorch/simulator.py` | 无头对局 + step 奖励 + 监督信号；默认线上同源出块（`spawn_online.py`） |
| `scripts/rl-spawn-worker.mjs` | Node 持久 worker，SSR 加载 `rlSpawnBridge.js` |
| `web/src/bot/rlSpawnBridge.js` | Python 离线出块与 `adaptiveSpawn`+`blockSpawn` 对齐 |
| `rl_pytorch/strategy_features.py` | 训练随机 / 推理固定 strategyId → one-hot |
| `rl_pytorch/features.py` | $s$ / $\psi(a)$ / $\phi$ 编码 |
| `rl_pytorch/fast_grid.py` | NumPy 加速的合法动作 / 消行 |
| `rl_pytorch/mcts.py` | 轻量 MCTS（可选） |
| `rl_pytorch/eval_gate.py` | 评估门控（可选） |
| `rl_pytorch/spawn_predictor.py` | dock 生成预测（可选） |
| `backend/rl_backend.py` | Flask `/api/rl/*` 推理与 replay buffer |
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

- `beam2/beam3` 的剩余块判断改为读取 dock 槽位的 `placed` 字段，只在真正还有 2/3 个未放置块时展开多层 beam。
- `Ranked Reward` 的目标分位从 p50 逐步爬坡到 p70，早期保留探索，平台期提高晋级标准。
- batched MCTS 展开 priors 统一使用 `forward_policy_logits(phi)`，与非批量 MCTS 保持同一套 action-feature API。
- PPO 轨迹里 `old_log_prob` 记录真实采样分布（包含 teacher 混合与 Dirichlet），避免多 epoch 更新时 ratio 与行为策略不一致。
- EvalGate 评估门槛改为与当前课程阈值对齐，并以配对严格赢率（非不输率）+ 分差双条件判定晋级，降低平局误判。
- EvalGate 新增规则开关：`RL_EVAL_GATE_RULE=win|nonloss`，默认 `win`（严格赢率）。
- Zobrist 热启动改为传入真实 numpy 网格状态，避免缓存命中路径被类型不匹配静默绕过。
- `qDistillation` 和 `visitPiDistillation` 支持 `annealEndCoef` / `annealEpisodes` 线性退火，前期强模仿、后期降低 teacher 偏差。
- Q 蒸馏默认对每个状态做 `zscore` 归一化，且用 `minStd` 限制近似平局动作的噪声放大。
- `searchReplay` 缓存高分未通关、尾局 feasibility 差的困难局，训练时抽样重放，日志显示 `replay=N`。replay 样本只参与 value / aux / distillation，不参与 PPO policy ratio；其 value target 使用纯 outcome，避免旧 GAE/ranked reward 污染。
- Teacher metrics 日志显示 `tq=覆盖率/std/margin/H` 和 `tv=覆盖率/H`，用于判断 teacher 覆盖不足、分布过尖或过平。
- MCTS 支持风险自适应 sims：高填充、低 mobility、序贯解少的局面自动增加搜索预算。
- EvalGate 支持 `rounds` 多组 seed 汇总判定，降低单组随机出块导致的门控波动。

---

## 三、状态空间 $s$（190 维）

`s ∈ ℝ^190`，由 `extract_state_features(grid, dock, strategyId)` 产出，**双端一致**（`features.py` / `features.js`）。

**策略条件化（v1.68）**：标量段末 **3 维 one-hot**，顺序为 `featureEncoding.strategyIds`（默认 `easy, normal, hard`）。`collect_episode` / 浏览器训练每局随机采样；面板「评估一局」与线上一致，传入 `game.strategy`。
组成：44 维标量[25 结构（含 heightStd + **2 维客观几何** §3.7）+ 19 颜色摘要] + **4 维单步出块难度**（§3.6）+ 64 棋盘占用 + 75 dock 空间掩码（合计标量段 48 维）。

### 3.1 拆分

```
s = [scalars(48) ; grid_flat(64) ; dock_flat(75)]
            ↑              ↑              ↑
         手工特征      8×8 棋盘 occupancy  3 槽 × 5×5 形状 mask
```

> 标量段 48 = 核心 42（下表，结构 + 颜色摘要）+ 4 维单步难度（§3.6）+ 2 维客观几何（§3.7）。
> 其中第 23 维起为 heightStd + `contiguousRegions` + `concaveCorners`，尾部 4 维为单步难度。

### 3.2 核心标量特征（手工设计）

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
shared/game_rules.json featureEncoding.stateDim = 187
                       ↓
   features.py:STATE_FEATURE_DIM 同步检查（启动时 assert）
                       ↓
       checkpoint 失效（width 不变也失效，因 input layer 维度不同）
```

演进：162 → 181（补颜色可观测性：同色整线 bonus 无法由纯 occupancy 区分）→ **185**（v1.65
把单步出块难度的 4 维子向量正式拼入标量段，见 §3.6）→ **187**（v1.66 再拼 2 维客观几何难度
`contiguousRegions / concaveCorners`，见 §3.7）。`model.py` 的段切分全部由
`_SCALAR_DIM / _GRID_FLAT`（来自 `featureEncoding`）推导，扩维后 Linear/Conv 输入自动重建，
无需改 `model.py` 代码；旧维度 checkpoint 在 `train.py` resume 时触发 size-mismatch
`RuntimeError`，被捕获后**自动回退从头训练**（符合本轮「不顾虑废弃 checkpoint」的取舍）。

### 3.6 单步出块难度（spawn step difficulty）正式进入 state（v1.65，理想态）

单步出块难度统一分 `spawnStepDifficulty`（详见 [`ALGORITHMS_SPAWN.md` §14.二](./ALGORITHMS_SPAWN.md#14-出块难度与评估)）
由 `web/src/spawnStepDifficulty.js` 产出，并有 Python 镜像 `rl_pytorch/spawn_step_difficulty.py`
（公式逐项对齐，跨语言契约测试 `tests/test_spawn_step_difficulty.py` ↔
`tests/spawnStepDifficulty.test.js` 共享 fixture `tests/fixtures/spawnStepDifficulty.cases.json`）。

**理想态升级（不顾虑 checkpoint 失效）**：模块新增 SSOT 函数
`spawnStepDifficultyFeatures(shapes, occupiedCount)`（JS / Python 同名同口径），输出**固定 4 维、
均 clamp 到 [0,1]、确定性、无 DFS / 无落点扫描**，可在 MCTS 热路径每节点调用。`features.js` 与
`features.py` 在标量段尾部（颜色摘要之后）**共同调用该函数**拼入，使 **stateScalarDim 42 → 46、
stateDim 181 → 185、phiDim 196 → 200**（v1.66 再 +2 维几何 → 48 / 187 / 202，见 §3.7）：

| 标量索引 | 名称 | 含义（归一化） |
|---|---|---|
| 42 | `scdNorm` | 空间约束密度 scd / `scdSaturation`（三块总格 ÷ 空格） |
| 43 | `comboCellsNorm` | 三块总格 / `comboCellsNorm`(=15) |
| 44 | `comboKillerNorm` | 致命块数（形状口径：≥`killerMinCells` 或长条）/ dockSlots |
| 45 | `comboLongBarNorm` | 长条数 / dockSlots |

- **为何放尾部**：保持原 0–41 索引不变，diff 最小；`model.py` 按 `_SCALAR_DIM` 切片自动适配。
- **为何这 4 维**：它们是**盘面 × 候选三块的组合级几何难度**，原 75 维 dock 空间掩码只编码单块形状、
  不显式给出「总格压力 / 致命块计数 / 空间约束密度」，作为显式标量是强且廉价的归纳偏置。
- **flexibility / solution 不进 state**：min-flexibility 需逐块扫合法落点、solutionCount 需 DFS，
  二者过重不适合 MCTS 热路径；且 mobility（idx 21）、holes（idx 15）已隐含同类信息。它们仍在
  离线 `compute_spawn_step_difficulty` 的合成分里使用（落库 `spawnMeta.stepDifficulty`、难度分桶）。
- **跨语言一致性**：fixture 每个 case 追加 `expected.features`，JS / Python 双侧断言逐位相等。
- **RND**：`rlRewardShaping.rndCuriosity.stateDim` 同步至 187（RND 复用同一 state 空间）。

### 3.7 客观几何难度进入 state（v1.66，理想态）

在 §3.6 的 4 维单步难度之后、`features.js` / `features.py` 标量段尾部再拼 **2 维客观几何难度**，
使 **stateScalarDim 46 → 48、stateDim 185 → 187、phiDim 200 → 202**。两值由
`web/src/boardTopology.js` 的 `countEmptyRegions / countConcaveCorners`（Python 镜像
`rl_pytorch/fast_grid.py` 的 `_contiguous_regions / _concave_corners`，跨语言逐位一致）产出：

| 标量索引 | 名称 | 含义（归一化） |
|---|---|---|
| 46 | `contiguousRegionsNorm` | 空白 4-连通分量数 / `actionNorm.maxEmptyRegions`(=16) |
| 47 | `concaveCornersNorm` | 凹角数 / `actionNorm.maxConcaveCorners`(=32) |

- **为何这 2 维**：`contiguous_regions` 度量剩余空间的**碎片化程度**（被切成几块），`concave_corners`
  度量已落方块轮廓形成的**内凹缺口/陷阱位数**。两者都是**全局拓扑量**——卷积核局部感受野难以
  数出「连通分量数」与「跨格凹角」，作为显式标量是强且廉价（O(n²)）的归纳偏置；与 holes（填不进）、
  wells（左右夹）口径互补，且 `concave_corners` 正是「放置块吸附」软约束（§ ΔΦ 势函数）的天然目标位。
- **同口径复用**：同两值同时随 `spawnMeta.stepDifficulty.contiguousRegions / concaveCorners` 落库
  （`bot/blockSpawn.js` post-hoc 附挂），供 `scripts/aggregate-step-difficulty.mjs` 按难度桶聚合、
  并经 `analyzeBoardTopology` 进入 DFV / 玩家洞察面板，做到「同一几何量贯穿 模型 / 打点 / 离线 / 面板」。
- **idx 22 修正**：本轮顺带把 `features.py` 第 23 个结构标量从重复的 `fill` 对齐为 `heightStd`
  （列高 top-profile 标准差），与 `features.js` 逐位一致（此前为遗留跨语言偏差）。

> Spawn V3 behaviorContext **61 → 63（v1.66 P7）**：`board_difficulty[26]`（= `clamp01(fill + holePressure·0.8)`）
> 已在位，尾部 [61-62] 新增 2 维客观几何 `contiguousRegions/concaveCorners`（盘面**输入**属性，落子前可知，
> 与 RL state 同源 boardTopology）；而 scd / killer / longbar 是**候选三块（即出块模型的输出）的属性**，
> 不能作为出块模型的输入特征（会泄漏标签），故仍不入网。统一难度分作为出块模型的**条件目标**仍由 `target_difficulty` 承载。

---

## 四、动作空间与 $\psi(a)$（15 维）

### 4.1 动作语义

每步合法落子 $a = (\text{block\_idx}, g_x, g_y)$：
- `block_idx ∈ {0, 1, 2}`：dock 中第几个未消耗的形状
- $(g_x, g_y) \in \{0..7\}^2$：放置左上角

`get_legal_actions(grid, dock)` 返回**变长列表**（典型 30~80，最大 ~120）。

### 4.2 $\psi(a)$ 的 15 维

`extract_action_features` 在 `features.py` 中：

| 编号 | 含义 |
|------|------|
| 0 | `block_idx / maxBlockIndex` |
| 1 | $g_x / gridSize$ |
| 2 | $g_y / gridSize$ |
| 3 | 形状宽度 / `shapeSpan` |
| 4 | 形状高度 / `shapeSpan` |
| 5 | 形状格子数 / `maxCells` |
| 6 | 本动作可消除行列数 / `maxClearsHint` |
| 7-11 | 近满线命中、剩余块比例、邻接度、放后高度、放后空洞风险 |
| 12 | 多消强度：`max(clears - 1, 0) / (maxClearsHint - 1)` |
| 13 | 同 icon / 同色 bonus 行列数 / `maxClearsHint` |
| 14 | 清屏潜力：本动作消行后盘面为空则为 1 |

> 5 维交互特征是 v4 的关键升级——之前 7 维 ψ 不带"放置后果"，导致网络难学位置选择。

### 4.3 $\phi(s, a) = [s; \psi(a)]$

- $\phi \in \mathbb{R}^{202}$（= state 187 + action 15）
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

## 五、奖励函数 $r_t$ 与塑形

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
     + w_n·near_full_lines + w_m·mobility + w_a·edge_exposure
```

各权重在 `shared/game_rules.json.rlRewardShaping.potentialShaping`：

| 项 | 默认权重 | 物理意义 |
|----|---------|---------|
| `holeWeight` | -0.4 | 空洞数（越多越糟） |
| `transitionWeight` | -0.08 | 0↔1 边界（越多越乱） |
| `wellWeight` | -0.15 | 井深（不可达的深沟） |
| `closeToFullWeight` | +0.35 | 近满线（鼓励攒大消） |
| `mobilityWeight` | +0.12 | 可落子数 |
| `adhesionWeight` | **-0.12** | **吸附/贴合约束**：`edge_exposure`（占用区朝向界内空格的暴露边，墙边不计） |

总权重 `coef = 0.8`（外层乘子）。

##### 放置块吸附（贴合）软约束

`adhesionWeight · edge_exposure` 是「放置块后尽量与边或其他方块贴合」的软约束。`edge_exposure`
= 占用区朝向**界内空格**的 4-邻接边数(墙边不计 → 贴墙即视为吸附)，等价于不含墙 padding 的行列跳变；
JS / Python 同口径(`web/src/bot/simulator.js` `_edgeExposure` ↔ `rl_pytorch/fast_grid.py`
`fast_board_features.edge_exposure`)。

- **越贴边/贴块 → 暴露边越少 → Φ 越高 → ΔΦ 奖励越高**，落子被引导贴合墙体与既有结构、减少孤立悬空。
- **仍允许中间放置**：放在棋盘中部但**与既有方块相连**的落子同样降低暴露边、同样受益；只有「四面临空的孤立悬空」被软性抑制。
- 作为**势函数项**(Potential-Based Shaping)，理论上**不改变最优策略**，仅引导更紧凑的探索；权重温和、得分增量(消行)仍主导，不会强迫只贴墙。
- 落点：`board_potential` / `boardPotential`(`simulator.py` / `simulator.js`)；rl_mlx 简化奖励轨未含势函数，不受影响。

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

## 六、网络结构 ConvSharedPolicyValueNet

### 6.1 整体架构（v5 默认）

```
Input s ∈ ℝ¹⁸⁷
  │
  ├── scalars[:48] ────────────────┐   （含 4 维单步难度 §3.6 + 2 维客观几何 §3.7）
  │                                  │
  ├── grid[48:112] reshape(1,8,8)   │
  │     │                            │
  │     CNN(1→32) GELU              │
  │     ResConv(32) GELU            │
  │     ResConv(32) GELU            │
  │     │ (32, 8, 8)                │
  │     ├─ AvgPool → 32 维 ─────────┤
  │     │                            │
  │     └─ keep [B,32,8,8] ────┐    │
  │                              │    │
  └── dock[112:187] reshape(3,5,5)│   │
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

## 七、损失函数与优化目标

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

## 八、训练流程：从环境采样到参数更新

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

## 九、探索策略：温度 + Dirichlet 噪声

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

## 十、价值目标：GAE × Outcome 混合

### 10.1 问题

纯 GAE 回报 $G_t = A_t + V(s_t)$ 在长轨迹上累积估计误差：
- 早期 $V$ 不准 → $A$ 不准 → 训练发散
- 但终局得分 (outcome) 是**精确**的真值

### 10.2 混合方案

```python
outcome = clip(log1p(final_score) / log1p(win_threshold), 0, 3)
return_target = (1 - mix) · GAE_return + mix · outcome
```

`mix = 0.5` 默认（`outcomeValueMix.mix`）。所有时刻共享同一 outcome 终局信号。改用 log 目标，是为了避免 400-500 分在 `score / threshold` 表达下过早贴近 clip 上限，导致价值头难以区分更高分局。

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

## 十一、辅助监督头：稠密信号注入

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

## 十二、Curriculum 与课程学习

### 12.1 胜利门槛对训练效果的影响机制

OpenBlock 的单步奖励为 dense + sparse 混合，其中只有 `winBonus`（默认 35）是**整局唯一的离散正反馈**：

```python
r_t = score_gain_t                              # dense
    + POT_COEF · (potential_after - prev)       # dense
    + (winBonus if prev_score < thr <= score_t else 0)   # sparse, 整局至多触发 1 次
```

`thr` 的设定通过四条独立通路传导到训练效果，是 RL 训练中**信噪比**的核心调节器：

| 传导通路 | `thr` 远低于均分（被穿透） | `thr` 远高于均分（够不着） | `thr` ≈ 模型实际能力 |
|---|---|---|---|
| **Reward variance** | 几乎每局都拿到 +35 → 变成常数 → 方差 → 0 | 几乎都拿不到 → 方差 → 0 | 一半 win 一半 lose → 方差极大 |
| **Policy gradient 信噪比** | advantage ≈ 0 → 梯度信号被噪声淹没 | 同左 | advantage 量级大 → 梯度方向锐利 |
| **Value head 监督信号** | V(s) 把 +35 当固定项 → 学到的是"常数 + 得分增量" | V(s) 学不到稀疏跳变 → 长期与实际偏离 → Lv 高位震荡 | V(s) 必须区分"会赢/会输"状态 → 提供有意义的拟合目标 |
| **探索激励** | 已知能拿 → 策略趋于最短路径达成 → 局长缩短 | 拿不到 → 方向迷失 → 高熵随机游走 | 既有正反馈又鼓励冒险 → 局长自然延展 |

理论与教育心理学的 **最近发展区（ZPD）** 同构：在 win_rate 30%~60% 区间训练信号最强（Wiewiora 1996；AlphaStar；OpenAI Five）。

#### 12.1.1 典型病态识别

| 症状 | 根因 | 课程层修复方向 |
|---|---|---|
| `win_rate` 长期 ≥ 90% + `mean_score` 远高于 `thr` + `Lv` 高位震荡 | `thr` 被穿透 | 拉高 `thr`（linear/adaptive）或换 quantile 模式 |
| `win_rate` 长期 < 5% + `entropy` 不收敛 + 局长极短 | `thr` 够不着 | 降低 `thr` 起始值或减缓爬升速率 |
| `mean_score` 增长但 `win_rate` 与之同步漂移到极端 | 课程与能力不同步 | 换 `mode=quantile`（阈值随分布漂移） |

> ⚠️ 这三种病态都不靠"调网络/调学习率"能根治，必须从**环境契约（thr 的设定方式）**入手。

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

### 12.3 自适应课程（v8 引入，v11 闭环化）

`adaptiveCurriculum.enabled = true` 时，按滑动胜率四档反馈调整虚拟 episode 推进。**v11 关键修复**：v8 的 `stepDown` 默认 `0` 只升不降，threshold 推到高位后塌缩永远爬不回；v11 默认 `stepDown=1.0` 并引入 severe rollback 形成真闭环。借鉴 search-contempt（[arXiv:2504.07757](https://arxiv.org/pdf/2504.07757) §4.2）"保持 (w+l)/d≈1"思想在 1-player 随机环境的等价物——保持 win_rate ≈ 0.5。

#### 四档分级响应

| win_rate 区间（target=0.5，默认带宽） | 动作 | virtual_ep 变化 | log 显示 |
|---|---|---|---|
| `≥ 0.6`（target + accelBand） | **accel** | +stepUp × checkEvery = +100 | `act=accel` |
| `[0.4, 0.6)` | **hold** | +checkEvery = +50 | `act=hold` |
| `[0.3, 0.4)` | **pause** | 0 | `act=pause` |
| `[0.1, 0.3)` | **rollback** | -stepDown × checkEvery = -50 | `act=rollback` |
| `< 0.1` | **severe** | virtual_ep × severeRollbackFactor = ×0.5 | `act=severe` |
| 样本数 < `minSamplesForAction` | **warmup** | +checkEvery | `act=warmup` |

#### 配置（`shared/game_rules.json → rlRewardShaping.adaptiveCurriculum`）

```json
{
  "enabled": true,
  "window": 200, "checkEvery": 50, "minSamplesForAction": 10,
  "targetWinRate": 0.5,
  "accelBand": 0.1, "holdBand": 0.1,
  "lowWinRateBand": 0.2, "severeWinRateBand": 0.4,
  "stepUp": 2.0, "stepDown": 1.0,
  "minVirtualEp": 0, "rollbackOnSevereDrop": true, "severeRollbackFactor": 0.5
}
```

#### 训练日志字段

```
ep 12000 | ... | thr=180  [adap wr=42% vep=8000 act=hold] | sc=145 avg100=98.3 win%=35.0% | ...
                              ↑滑窗胜率 ↑虚拟局 ↑当次决策
```

#### 实现

纯函数 `rl_pytorch/curriculum_feedback.compute_curriculum_action`（pytest 覆盖 16/16）；主循环每 `checkEvery` 局调用一次写回 `_virtual_ep`。可通过 `RL_ADAPTIVE_CURRICULUM=0` 退回固定线性课程。

### 12.4 分位数自适应课程（v11.2 引入，**新默认**）

`rlCurriculum.mode = "quantile"` 时（v11.2 起为默认），完全去掉手工 `winThresholdEnd`，让胜利门槛等于近 N 局分数分布的第 p 分位数：

$$
\text{thr}_t = \text{EMA}\left(\text{percentile}(\text{recent\_scores}_t, p), \alpha\right)
$$

数学上有恒等式 $P(\text{score}_t \ge \text{thr}_t) = 1 - p/100$ — 例如 `p=70` → win_rate 自然收敛到 30%，**无论模型当前能力如何**。

#### 设计动机

v11 闭环虽然解决了"只升不降"的问题，但 `winThresholdEnd` 仍是写死的硬上限——这等价于在配置文件里**预先猜模型最终能力**，每次模型升级（架构/算力/算法）都要重设。借鉴 OpenAI Five / AlphaStar 的 **percentile-based reward** 思想，但更朴素：不改奖励函数本体，只让 `winBonus` 触发阈值随分布漂移，把"猜模型上限"这个隐性超参从配置层删掉。

三模式横向对比详见 [§12.6 选型决策](#126-课程模式选型决策)。

#### 状态机

```
score_history (collections.deque, maxlen=500)
    │
    ├── n < bootstrapEpisodes (100):  action=bootstrap, thr=40
    ├── 首次有效计算           :   action=ema_init, thr=ema=percentile
    └── 后续                   :   action=quantile, ema = α·target + (1-α)·ema
```

#### 配置（`shared/game_rules.json → rlCurriculum.quantile`）

```json
{
  "mode": "quantile",
  "quantile": {
    "p": 70,
    "windowEpisodes": 500,
    "emaAlpha": 0.05,
    "bootstrapEpisodes": 100,
    "bootstrapThreshold": 40,
    "floor": 40,
    "ceil": 9999
  }
}
```

#### 训练日志字段（v11.2）

```
ep 500 | ... | thr=287  [quant p70 tgt=295 ema=287.4 n=500 act=quantile] | sc=312 avg100=255.6 win%=31.5% | ...
                          ↑分位数 ↑窗口分位     ↑EMA    ↑样本   ↑分支
```

- `tgt=295`：近 500 局得分的 70 分位 = 295
- `ema=287.4`：EMA 平滑后的内部状态
- `thr=287`：clip 后实际生效的整数阈值（注意 `floor=40` 兜底）
- `act` 三态：`bootstrap` / `ema_init` / `quantile`

#### 实现

纯函数 `rl_pytorch/curriculum_quantile.compute_quantile_threshold`（pytest 覆盖 21/21，含统计性质验证 `P(win) ≈ 1 - p/100`）；主循环每 batch 调用一次写回 `cur_win_thr`。可通过 `RL_CURRICULUM_MODE=linear` 或 `RL_CURRICULUM_MODE=adaptive` 切回旧模式。

#### 与 v11 闭环的关系

quantile 模式下 v11 的 `compute_curriculum_action` 不再启用（mode 互斥）。若需"分位数控难度 + 闭环监控胜率偏移"组合，下一版可让 v11 在 quantile 下退化为 observer（只打 alert 不调 thr）。当前实现保持简洁：三模式互斥，避免双控制环耦合。

### 12.5 推理与课程

**推理时**统一用 `WIN_SCORE_THRESHOLD = 220`（产品常量），不读 curriculum。仅训练时算"是否赢"用 `sim.win_score_threshold`。

> ⚠️ **已知不一致**：浏览器 `RlGameplayEnvironment.won` 用固定 220，与 Python `collect_episode` 的动态门槛不一致。如做严格对照，需对齐。

### 12.6 课程模式选型决策

三模式互斥共存，由 `rlCurriculum.mode` 或环境变量 `RL_CURRICULUM_MODE` 选择。

#### 12.6.1 横向对比矩阵

| 维度 | `linear`（v8 默认） | `adaptive`（v11） | `quantile`（v11.2，**当前默认**） |
|---|---|---|---|
| **`thr` 来源** | `start + (end-start)·ep/ramp` | 同 linear 公式，`ep` → `virtual_ep`（闭环调） | `EMA(percentile(recent_scores, p))` |
| **输入信号** | episode 计数 | win/lose 序列 | score 数值序列 |
| **手工硬上限** | `winThresholdEnd` | 同左（仍受 End 限制） | **无** |
| **数学保证** | 无 | win_rate → target（受 End 限制） | `P(win) ≡ 1 - p/100`（严格恒等式） |
| **抗模型升级** | ❌ End 被穿透即失效 | ⚠️ End 仍是天花板 | ✅ 阈值自动随分布漂移 |
| **手工超参** | 3（Start/End/Ramp） | 13（含 4 档带宽 + rollback） | 7（仅 p 一阶关键） |
| **对应实现** | `rl_win_threshold_for_episode` | `compute_curriculum_action` | `compute_quantile_threshold` |
| **细节章节** | [§12.2](#122-默认课程shared_game_rulesjsonrlcurriculum) | [§12.3](#123-自适应课程v8-引入v11-闭环化) | [§12.4](#124-分位数自适应课程v112-引入新默认) |

#### 12.6.2 选型决策树

```
是否需要复现旧实验 / A/B 对照？
├── 是 → mode=linear（保留固定曲线）
└── 否
    └── 模型能力上限是否事先已知（如复现已发表论文）？
        ├── 是 → mode=adaptive（手工设 End，享受闭环加速）
        └── 否（生产场景常见）→ mode=quantile（推荐，零调参）
```

#### 12.6.3 切换路径与回滚

| 切换方向 | 触发条件 | 操作 | 回滚策略 |
|---|---|---|---|
| linear → quantile | win_rate 长期 ≥ 90% + Lv 高位震荡 | `mode: "quantile"` 或 `RL_CURRICULUM_MODE=quantile` | 直接回退环境变量，无 checkpoint 兼容问题 |
| quantile → adaptive | 想精确控住目标 win_rate=50% | 同上，env=adaptive | 同上 |
| 任意 → 关闭 | 短期 sanity check / debug | `RL_CURRICULUM=0` | 直接取消环境变量 |

> ⚠️ **切换时不需重训**：三模式只改变训练时 `sim.win_score_threshold` 的算法，不改变网络/奖励/损失。同一 checkpoint 可在三模式下接力训练，但**统计指标（win_rate, avg_score）需要 200 ep 左右才能收敛到新模式的稳态**，期间日志可能看似异常。

#### 12.6.4 与其他奖励整形模块的关系

| 模块 | 与课程模式的关系 |
|---|---|
| `Ranked Reward`（[§5.3](#53-终局惩罚)）| 独立运行，**不互斥**；在 score 层做分位奖励 |
| `winBonus`（sparse） | 触发阈值由课程模式决定；本身不变 |
| `smoothWinBonus` (B, [§12.7](#127-后续演进路线v12-备选方案)) | **替代** sparse `winBonus`，与三种课程模式正交叠加 |
| `rndCuriosity` (C, [§12.7](#127-后续演进路线v12-备选方案)) | **叠加**到每步 reward，与三种课程模式正交叠加 |
| `potential` shaping | 与课程模式完全无关 |
| `辅助监督头`（hole/clear/topo） | 同上 |

---

### 12.7 后续演进路线（v12+ 备选方案）

v11.2 解决了"`thr` 设定方式"的问题；剩余两类训练信号缺陷在 v11.2 已落地为 **opt-in 完整实现 + 默认 off + 触发监测**：未启用前不会改变当前训练曲线，触发条件成立时一行 JSON / 环境变量即可启用。

#### 12.7.1 三个 P-tier 方案对比

| 方案 | 解决问题 | 实施位置 | 启用方式 | 默认 off 的原因 |
|---|---|---|---|---|
| **B：平滑奖励整形**<br>（smoothWinBonus） | sparse `winBonus` 在阈值附近的 0/35 跳变让 V 头难拟合 | `rl_pytorch/reward_shaping_smooth.py` + `simulator.py` (屏蔽 sparse) + `train.py` (注入 smooth) | `RL_SMOOTH_WIN_BONUS=1` 或 `rlRewardShaping.smoothWinBonus.enabled=true` | 改变奖励量级 → 旧 checkpoint V 头会失配；需重训或长 warmup |
| **C：RND Curiosity**<br>（rndCuriosity） | 高 ep 后探索退化（entropy → 0 + 策略陷入"短而稳"局部最优） | `rl_pytorch/intrinsic_rnd.py`（双 MLP + Welford 归一化 + 触发监测）+ `train.py` (集成) | `RL_RND=1` 或 `rlRewardShaping.rndCuriosity.enabled=true`<br>**+ 即使 disabled 也定期评估触发条件并打 alert** | 50k+ ep 前探索通常未塌缩；过早启用会引入未必需要的内在动机干扰已收敛策略 |
| **D：League / PBT** | — | — | — | **不适用**（OpenBlock 单玩家环境，无对手概念可建模） |

#### 12.7.2 B 方案：平滑奖励整形

**核心公式**（与 `game_rules.json -> rlRewardShaping.smoothWinBonus` 字段对齐）：

$$
r_{\text{terminal}} = w_{\text{winBonus}} \cdot \tanh\!\left(\operatorname{clip}\!\left(\frac{\text{final\_score} - \mu}{\sigma},\ \pm c\right)\right)
$$

- $\mu = \mathrm{percentile}_{p_{\text{target}}}(\text{近 N 局 score})$，默认 $p_{50}$
- $\sigma = \mathrm{percentile}_{p_{\text{high}}} - \mathrm{percentile}_{p_{\text{low}}}$，默认 IQR，下限 `spanFloor=5`
- $c$ = `saturationClip` = 1.5（让 $\pm 1.5\sigma$ 进入 $\pm 0.905\,w_{\text{winBonus}}$）
- bootstrap 期（前 `bootstrapEpisodes=200` 局）用固定 `bootstrapTarget=100` / `bootstrapSpan=60`

**与 sparse 的关键差异**：

| 行为 | sparse `winBonus` | smooth (B) |
|---|---|---|
| score = target | 0（未触发） | 0 |
| score = target + σ | 0 或 `winBonus`（视 thr） | `tanh(1)·winBonus ≈ 26.6` |
| score = target − σ | 0 | `−26.6`（强负反馈） |
| 永远有梯度信号 | ✗ | ✓ |

**何时启用**：实际训练 5k+ ep 后 `Lv` 仍长期 > 10 且 V 拟合曲线（图 6）误差 > 30%。详见 [RL_ALPHAZERO_OPTIMIZATION §9.1.z](./RL_ALPHAZERO_OPTIMIZATION.md#91z-课程后续演进路线v12-备选方案)。

#### 12.7.3 C 方案：RND Curiosity

**核心公式**（[Burda et al. 2018, arXiv:1810.12894](https://arxiv.org/pdf/1810.12894)）：

$$
r_{\text{intrinsic}}(s) = \beta \cdot \frac{\left\| f_{\text{target}}(s) - f_{\text{predictor}}(s) \right\|^2}{\sigma_{\text{normalizer}}}
$$

- $f_{\text{target}}$：随机初始化的小 MLP，参数永远冻结
- $f_{\text{predictor}}$：在线学习预测 $f_{\text{target}}$ 输出（仅它有梯度）
- $\sigma_{\text{normalizer}}$：Welford running std，让 β 在不同任务/模型上可比

**自动触发监测**（即使 disabled 也会定期评估并打 alert）：

| 触发条件 | 判定式 | alert 示例 |
|---|---|---|
| `score_stall` | 近 `scoreSlopeWindow=5000` ep 内 \|slope\| < `scoreSlopeThreshold=1e-3` | `RND Trigger: score_stall \| 斜率 \|0.00042\| < 0.001` |
| `entropy_collapse` | entropy < `entropyCollapseThreshold=0.2` 且 avg_score < `expectedScoreAtCollapse × 0.8` | `RND Trigger: entropy_collapse \| entropy 0.087 < 0.2 且 ...` |
| `manual` | `manual_force=True` 强制 | `RND Trigger: manual` |

**何时启用**：alert 触发后，或主动观察到 entropy 持续低于 0.2 + score 停滞。详见 [RL_ALPHAZERO_OPTIMIZATION §9.1.z](./RL_ALPHAZERO_OPTIMIZATION.md#91z-课程后续演进路线v12-备选方案)。

#### 12.7.4 设计原则

1. **触发条件可观测**：通过看板指标或 alert 自动判断，而非定期"升级"
2. **与现有模式正交**：B / C 不破坏 `linear` / `adaptive` / `quantile` 三态契约
3. **可一键回滚**：环境变量或 JSON 字段开关
4. **默认 off + 监测优先**：未触发条件前不主动启用，避免预先施加未必需要的压力

---

## 十三、Lookahead / Beam / MCTS 搜索增强

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

## 十四、推理流程与服务化

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

在线训练与离线评估对照、search replay、`npm run rl:eval` 详见 **[本手册 §21](#二十一rl-契约与在线服务)**。

### 14.3 模型加载

`backend/rl_backend.py` 启动时：

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

在侧栏 **勾选 1-step lookahead**（默认不勾选；`trainSelfPlay` / `runSelfPlayEpisode` 未传 **`useLookahead`** 时亦为 **`false`**）时，POST 可携带 **`q_teacher`**（每条合法动作的 `r + γ V(s')`），服务端映射为 `q_vals` 后 **Q 蒸馏**生效，**Teacher Q coverage** 可大于 0（弱 teacher，**不等价**于离线 beam/MCTS）。前端对 **`/api/rl/eval_values`** 响应做长度与类型校验，失败或非法时 **回退 `select_action`**。**visit_pi**（MCTS 访问分布）在线仍不传，除非扩展协议。判断策略是否进步应结合 **`python3 -m rl_pytorch.eval_cli`**（或 `POST /api/rl/eval_greedy`）的**固定协议贪心评估**，而非仅依赖滑动窗口胜率。完整说明见 [本手册 §21](#二十一rl-契约与在线服务)。

---

## 十五、浏览器线性 RL Fallback

### 15.1 设计理由

- 演示场景不依赖后端
- 移动端 / 小程序低延迟
- 用作"对照基线"看 NN 究竟有多大提升

### 15.2 实现（与仓库一致）

- **代码**：`web/src/bot/linearAgent.js`（`W·φ` 策略、`Vw·ψ` 价值）、`web/src/bot/trainer.js`（`runSelfPlayEpisode`、`trainSelfPlay`、`reinforceUpdate`）。
- **超参与温度**：`shared/game_rules.json` → **`browserRlTraining`**（`gamma`、`policyLr`、`valueLr`、`entropyCoef`、`maxGradNorm`、`temperatureLocal`、`temperatureBackend`）。前端通过 `resolveBrowserRlTrainingConfig()` 读取；**PyTorch 在线训练**路径每局采样温度使用 `temperatureBackend`。
- **算法要点**：回报 Welford 标准化 + 批内优势标准化 + 裁剪；策略更新为 **REINFORCE + 基线**，并叠加 **熵 bonus**：`ΔW ∝ lr · (A · ∇logπ(a) + β · ∇_W H)`，β=`entropyCoef`。

### 15.3 关键差异

| 维度 | 浏览器线性 | PyTorch NN |
|-----|----------|-----------|
| 算法 | REINFORCE-baseline | PPO + GAE |
| 状态编码 | 直接喂旧版低维状态 | CNN + Attention + 187 维状态（颜色摘要 + 单步难度 + 客观几何） |
| 收敛局数 | ~5000 | ~40000 |
| 收敛上限 | ~100 分 | ~220 分（理论） |
| 推理延迟 | <1ms | 5-50ms |

---

## 十六、数值稳定性与裁剪

详见 本手册 §22（§三），本节做要点摘录：

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

## 十七、训练观测与调参顺序

### 17.1 核心看板指标（详见 本手册 §22 §二）

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

## 十八、演进路线 v1 → v7

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

- v6/v7：[`RL_ALPHAZERO_OPTIMIZATION.md`](./RL_ALPHAZERO_OPTIMIZATION.md)

---

## 十九、常见问题诊断

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
- 解决：见 本手册 §22 §1.1 数据源切换

---

## 二十、附录：完整超参数表

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
| `transitionWeight` | -0.08 |
| `wellWeight` | -0.15 |
| `closeToFullWeight` | +0.35 |
| `mobilityWeight` | +0.12 |
| `adhesionWeight`（吸附/贴合） | -0.12 |

---

## 二十一、RL 契约与在线服务

> 当前定位：本文是 RL 栏目的总入口 + 维护 RL 与主玩法之间的契约边界 + Flask `/api/rl/*` 在线服务与离线评估说明。
> 权威事实来源为 [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md)；若其他 RL 专题文档与其冲突，以 `ALGORITHMS_RL.md` 和代码为准。
> RL 算法公式和训练流程见 [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md)。

---

### 一、阅读入口

| 需求 | 先读 |
|------|------|
| 理解当前 RL 算法、状态/动作、奖励、网络、训练和推理 | [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) |
| 理解 RL 与玩法边界 + 部署在线/离线服务 | 本文 · [本手册 §22](#二十二rl-训练监控与排障) |
| 看训练曲线、判断是否正常 + 排查数值异常 | [本手册 §22](#二十二rl-训练监控与排障) |

#### 1.1 文档分层

| 分类 | 文档 | 维护内容 |
|------|------|----------|
| 权威 | [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) | PPO/GAE/辅助头/search teacher/浏览器 fallback/服务化推理的统一说明 |
| 契约与服务 | [本手册 §21](#二十一rl-契约与在线服务) (本文) | RL 与玩法的解耦边界 + Flask 在线训练/离线评估/HTTP 评估/批量 PPO |
| 训练观测与排障 | [本手册 §22](#二十二rl-训练监控与排障) | 看板数据流/刷新机制 + 八图趋势解读 + 数值稳定与 loss 裁剪 |
| 分析与实验记录 | [本手册 §23](#二十三rl-研究复杂度瓶颈与文献对照) | 复杂度分析、瓶颈诊断、优化候选池、文献对照 |
| 历史实验参考 | [`RL_ALPHAZERO_OPTIMIZATION.md`](./RL_ALPHAZERO_OPTIMIZATION.md) | AlphaZero/MCTS 对比和搜索蒸馏思路 |

#### 1.2 维护原则

- 算法公式、网络结构、状态/动作维度、奖励口径只在 `ALGORITHMS_RL.md` 维护。
- 玩法规则、得分、形状、特征维度以 `shared/game_rules.json` 和 `shared/shapes.json` 为准。
- 看板字段和曲线口径只在 dashboard 相关文档维护。
- 历史实验文档可以保留失败原因和取舍结论，但不要把旧版本号写成当前状态。

---

### 二、RL 契约：玩法边界与共享规则

### 二、RL 契约：玩法边界与共享规则

#### 1.1 单一数据源

| 内容 | 文件 | 说明 |
|------|------|------|
| 难度、得分、棋盘宽高、胜局分、RL 训练用策略 id、特征维度与归一化常数、统一消行计分 `clearScoring`、RL 奖励塑形 `rlRewardShaping`、RL 与主局对齐的 bonus icon/染色 `rlBonusScoring` | `shared/game_rules.json` | 改玩法优先只改此处 |
| 多连块几何 | `shared/shapes.json` | 与 `web` / `rl_pytorch` / `rl_mlx` 共用 |

#### 1.2 分层

1. **规则与数据**：上述 JSON。
2. **环境（对局动力学）**：`web/src/bot/simulator.js`、`rl_pytorch/simulator.py`、`rl_mlx/simulator.py` 等实现落子、消除、得分、每轮 dock 三色采样；须与主游戏 `Grid` / `clearScoring` 逻辑一致。
   - **得分**：消行前 `detectBonusLines` → `computeClearScore`，与主局公式相同；bonus 倍率由 `shared/game_rules.json` → `clearScoring.iconBonusLineMult` 统一提供。**连击倍数 v1.66+** 由 `clearScoring.comboMultiplier`（默认 ≥ 3 连 ×2 cap）累乘，与 web 主局完全同源（见 [CLEAR_SCORING.md §3bis](../product/CLEAR_SCORING.md#三-bis连击倍数combo-multiplier--v166)）。训练路径不用玩家当前皮肤，icon 语义只读取 `rlBonusScoring.blockIcons`；为空时浏览器无头局、PyTorch、MLX 都退化为同色整线 bonus。
   - **dock 染色偏置**：仅依据盘面可见的近满线几何 + 同一套 icon/同色规则调用 `monoNearFullLineColorWeights`，不是 adaptiveSpawn / spawnHints。
   - **出块形状**：v1.68 起 Python 默认经 Node worker 与线上一致；`RL_SPAWN_ONLINE=0` 时回退 `block_spawn.generate_*`。详见 [`RL_CONTRACT_AND_SERVICE.md` §2.6](./RL_CONTRACT_AND_SERVICE.md#26-rl-训练机制三条路径对照权威)。
3. **观测编码（与策略网络绑定）**：`web/src/bot/features.js`、`rl_pytorch/features.py`；**v1.68：190 维 state**（含 3 维策略 one-hot）、**phi=205**。
4. **RL 训练入口（不直接碰棋盘）**：`web/src/bot/gameEnvironment.js` 的 `RlGameplayEnvironment`、`web/src/bot/trainer.js` 中的自博弈循环。

#### 1.3 自适应出块（网页端）

网页端真人主流程有两种可选出块模式：启发式（`adaptiveSpawn.js` + `blockSpawn.js`）与生成式（`spawnModel.js` 调用 SpawnPolicyNet）。两者共享同一份出块上下文。生成式必须通过前端 `validateSpawnTriplet()` 护栏；模型不可用、输出非法或不可解时回退启发式并记录原因。

Python/MLX 训练仍使用固定策略与共享 `game_rules.json` / `shapes.json`，不读取真人网页的 `spawnHints`、V3 推理结果或玩家画像。

#### 1.4 spawnIntent 单一口径

`adaptiveSpawn` 输出 `spawnHints.spawnIntent ∈ { relief, engage, pressure, flow, harvest, maintain }`。拟人化叙事 / 商业化策略 / 回放标签都从 spawnIntent 派生。几何近满检测由 `boardTopology.detectNearClears()` 单一来源提供。

#### 1.5 harvest / payoff 几何兜底 + 词义解耦

`spawnIntent` 统一为 6 值枚举。`spawnIntent='harvest'` 要求 `nearFullLines ≥ 2 || (pcSetup ≥ 1 && fill ≥ PC_SETUP_MIN_FILL)`。UI 词义：`PlayerProfile.pacingPhase` 展示为 "Session 张弛"；`spawnHints.rhythmPhase` 称 "节奏相位"。

#### 1.6 修改玩法时建议顺序

- 只调难度/分数字段：编辑 `shared/game_rules.json`
- 改方块集合：编辑 `shared/shapes.json`
- 改观测或网络输入维度：改 `featureEncoding` + `features.js` / `features.py`

#### 1.7 PyTorch 与浏览器线性模型：收敛速度差异

| 因素 | 线性 `LinearAgent` | PyTorch `PolicyValueNet` / `SharedPolicyValueNet` |
|------|---------------------|---------------------------------------------------|
| 参数量 | φ 205 + state 190 | 默认以 `rl_pytorch/model.py` 和 checkpoint meta 为准 |
| 每局梯度步数 | 逐步更新 | 整局一次 `backward` |
| 回报与价值 | MC 回报，无缩放 | `RL_RETURN_SCALE` + GAE + `smooth_l1` |
| 探索 | 温度 softmax | 温度衰减 + Dirichlet + 熵 bonus |

---

### 三、PyTorch RL：在线服务与离线评估

#### 2.1 两条训练路径

| 路径 | 采样来源 | Teacher | Search replay | v11 闭环课程 |
|------|-----------|---------|---------------|-------------|
| **离线** `python -m rl_pytorch.train` | Python `OpenBlockSimulator` + `collect_episode` | MCTS / beam / 1-step | ✅ | ✅ `--adaptive-curriculum` |
| **在线** 浏览器 → `/api/rl/train_episode` | 浏览器仿真 + POST 轨迹 | 可选：侧栏 `1-step lookahead` 时 Q 蒸馏 | ✅（批量 flush） | ❌ 仅 `rlCurriculum` |

**一键启动离线训练**（v11.1 推荐，含 MCTS + Dirichlet + v11 闭环 + 3-ply beam）：

```bash
./scripts/train_full_mcts.sh
RESUME=1 ./scripts/train_full_mcts.sh
EPISODES=20000 ./scripts/train_full_mcts.sh
```

脚本内启用：`RL_MCTS=1`、`RL_ADAPTIVE_CURRICULUM=1`、`RL_MCTS_REUSE=1`、`RL_ZOBRIST_SHARED=1`、`DIRICHLET_EPSILON=0.20`。

#### 2.2 两栈选择建议（v11.1）

| 现象 | 建议 |
|---|---|
| teacher 覆盖率长期为 0 | 切换到离线训练（默认开 MCTS） |
| win_rate ≥ 90% 且 mean_score 远高于阈值 | 离线 v11 四档闭环 |
| Lv 高位震荡 + 不增长 | 多 worker GAE + Dirichlet |
| 需要低延迟实时观察 | 浏览器（优先） |

#### 2.3 侧栏 UI 与 POST 字段

- `#rl-lookahead`：默认不勾选；勾选后训练/评估均启用 lookahead
- `trainSelfPlay`/`runSelfPlayEpisode`：未传 `useLookahead` 时默认为 `false`
- POST `q_teacher`：`number[]`，长度等于该步 `phi` 行数
- `visit_pi`：在线默认不传

#### 2.4 `/api/rl/eval_values` 前端校验与回退

- `evalValuesRemote`：要求响应体含 `values` 且数组长度与请求的 `states` 条数一致
- `_selectWithLookahead`：请求失败或返回值长度与合法动作数不一致时，回退 `select_action`

#### 2.5 服务端 Q 蒸馏与单局日志

`_convert_episode_for_ppo`：若某步含 `q_teacher` 且长度与 `phi` 行数一致，写入该步 `q_vals`。`training.jsonl` 的 `train_episode` 事件可含 `loss_q_distill`、`q_distill_coef`、`teacher_q_coverage`。

#### 2.6 在线批量 PPO 与 search replay

当 `RL_BATCH_SIZE`（默认 32）> 1 且轨迹攒满缓冲时，调用与离线相同的 `_reevaluate_and_update`。`shared/game_rules.json` → `rlRewardShaping.searchReplay` 控制启用、抽样比例等。服务端维护内存队列 `search_replay_buffer`。

#### 2.7 独立评估

**命令行**：`npm run rl:eval` / `python3 -m rl_pytorch.eval_cli`
**HTTP**：`POST /api/rl/eval_greedy` 对当前内存权重跑评估并追加 `training.jsonl`

#### 2.8 吞吐与批次

- `RL_BATCH_SIZE`：在线攒批大小
- `RL_PPO_EPOCHS_ONLINE`：每批 PPO epoch 数
- `POST /api/rl/flush_buffer`：手动触发

#### 2.9 推荐阅读

1. [RL 算法手册 §14](./ALGORITHMS_RL.md#十四推理流程与服务化)
2. [RL 训练监控](#二十二rl-训练监控与排障)
3. [测试指南](../engineering/TESTING.md)

---

## 二十二、RL 训练监控与排障

> 当前定位：RL 训练看板的数据流与刷新机制 + 趋势解读与调优建议 + 数值稳定与指标诊断。
> 配套看板代码：`web/src/bot/rlTrainingCharts.js`；算法总览见 [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md)。

---

### 一、看板：数据流与刷新机制

#### 1.1 数据来源

| 模式 | 曲线与摘要 | 左侧统计 |
|------|-----------|----------|
| 未勾选 PyTorch | `browserTrainingLog.js`（localStorage 环形缓冲） | 本页会话内 `onEpisode` 累计 |
| 勾选 PyTorch | `GET /api/rl/training_log?tail=5000` 读 `training.jsonl` | 与 `onEpisode` 取 max，刷新时与 `/api/rl/status` 对齐 |

请求带 `cache: 'no-store'`。

#### 1.2 自动刷新机制

1. 每局结束 `onEpisode` → `scheduleDashRefresh()`：约 350ms 后 `refreshDashboardFull()`
2. 定时轮询 `syncChartPoll()`：约 1.2s（浏览器）/ 1.8s（PyTorch）再调一次

若关闭「训练中自动刷新」，则仅在点击「刷新图表」或改下拉时更新。

#### 1.3 刷新图表流程

1. `refreshTrainingCharts()`：拉日志 → `updateRlTrainingCharts` 重绘摘要条与 8 个面板
2. 勾选 PyTorch 时：`refreshServerTrainingLog()` + `syncEpisodesFromServer()`

#### 1.4 有效性自检

- 勾选 PyTorch、启动训练：摘要末局序号与 `training.jsonl` 最新事件一起增长
- 关闭自动刷新、手动刷新：曲线与摘要跳变为当前文件内容
- 切换「最近 N 局」：立即重绘

#### 1.5 PyTorch 在线训练：lookahead 与左侧统计

`#rl-lookahead` 默认不勾选。勾选后首局可能长时间无日志。左侧局数与 `/api/rl/status` 取 max。`startBatch` 异常时 finally 解锁按钮。

#### 1.6 面板布局与交互（v1.14）

- 训练日志在训练时默认展开（`startBatch()` 自动 open）
- 看板摘要去层级（`<details>` 直接挂载）
- 「训练曲线」→「训练指标」统一命名
- 训练指标自适应高度：JS 动态测量写 `maxHeight`，超长时内部滚动
- 左侧画像默认展开更多 panel
- 主题化细滚动条

#### 1.7 面板收起 / 展开（v1.33–v1.34）

RL 训练面板在不需要时占用 120~360px 右侧栏。收起态（`.rl-collapsed`）：

| 维度 | 展开态 | 收起态 |
|------|--------|--------|
| `.rl-panel` 宽度 | `clamp(120px, …, 360px)` | 36px |
| `--cell-px-max` | 80px | 88px |
| 可见内容 | header-row + 全部 details | 仅收缩按钮 |

状态持久化：`localStorage["openblock_rl_panel_collapsed_v1"]`。`index.html <head>` 中 inline 脚本防闪烁。

---

### 二、看板：趋势解读

#### 2.1 八图各自回答的问题

| 图表 | 粗线含义 | 健康形态 | 需警惕 |
|------|----------|----------|--------|
| Lπ 策略损失 | 近 20 局策略 surrogate 平滑 | 缓慢下行或窄幅横盘 | 持续上行且胜率不再涨 |
| Lv 价值损失 | 近 20 局价值拟合误差平滑 | 有界、尖峰稀疏 | 阶跃上升或纵轴被撑爆 |
| 策略熵 H(π) | 单序列 | 缓慢下降 | 长期贴 0 或剧烈反弹 |
| 轨迹长度 | 单序列 | 随能力上升拉长 | 突然塌回极短 |
| 近 40 局胜率 | 滑动平均 | 从低到高再平台化 | 持续下滑无恢复 |
| 对局得分 | 滑动平均 | 与胜率、步长同向 | 与胜率背离 |

**解读顺序**：胜率/得分/步数 → 熵/Lπ → Lv → 图 7/8

#### 2.2 图 7：Teacher 覆盖与目标形态

| 图例 | 颜色 | 日志字段 | 含义 |
|------|------|----------|------|
| Q coverage | 深绿 | `teacher_q_coverage` | 带 Q teacher 的步占比 |
| visit coverage | 深蓝虚线 | `teacher_visit_coverage` | 带 MCTS visit_pi teacher 的步占比 |
| q entropy norm | 紫 | `teacher_q_entropy_norm` | teacher Q softmax 分布熵归一化 |
| q top margin | 橙红虚线 | `teacher_q_margin` | teacher Q 归一化后 top1 − top2 |

#### 2.3 图 8：蒸馏吸收与 Replay 占比

| 图例 | 颜色 | 含义 |
|------|------|------|
| Q distill | 青绿 | Q 蒸馏损失 |
| visit_pi distill | 玫红虚线 | visit_pi 蒸馏损失 |
| replay ratio | 棕 | search replay 混入步占比 |

#### 2.4 训练日志字段解读

##### `[adap ...]`（v11 adaptive 模式）

`thr=180 [adap wr=42% vep=8000 act=hold] sc=145`

| 字段 | 含义 | 健康范围 |
|------|------|----------|
| wr | 近 window 局滑动胜率 | 30%~60% |
| vep | 虚拟课程局数 | 单调缓慢上升 |
| act | 反馈决策 | hold / accel / pause / rollback / severe |

##### `[quant ...]`（v11.2 quantile 模式，当前默认）

`thr=287 [quant p70 tgt=295 ema=287.4 n=500 act=quantile] sc=312`

win_rate 应数学上恒等于 `1 - p/100`（如 p=70 → 30%）。

##### `[smooth ...]`（v11.2 方案 B 平滑奖励，opt-in）

`smooth tgt=180 span=120 r=+18.3 act=smooth`

##### `[rnd ...]`（v11.2 方案 C RND Curiosity，opt-in）

`rnd ī=0.68 Lp=0.68 σ=0.11`

#### 2.5 看板图 9：课程门槛与得分分位（v11.2）

4 条曲线：`win threshold`（红）、`quantile target`（蓝虚线）、`quantile EMA`（青）、`win_rate × 100`（紫点线）。

#### 2.6 典型案例研判

**偏正常信号**：局数大、胜率曾爬升至 50%~70%、步数/得分粗线长期抬升、熵总体下行。

**需关注信号**：Lv 粗线末端抬升（常见于课程阈值变化导致分布偏移）、胜率从峰值略回落（自博弈下常见、未必是 bug）。

| 情形 | 建议结论 |
|------|----------|
| 胜/分/步粗线向上，Lv 偶发尖峰 | 整体正常 |
| 胜/分粗线下行 + Lv/Lπ 同时恶化 | 可能异常 |
| 仅 Lv 爆炸、外在指标仍涨 | 价值分支不稳 |

#### 2.7 优化建议

**已落地的数值裁剪**：`RL_RETURNS_CLIP`、`RL_VALUE_TARGET_CLIP`、`RL_GAE_DELTA_CLIP`、`RL_LOG_LOSS_CLIP`

**训练策略层**：调 `RL_VALUE_COEF`、`RL_GRAD_CLIP` / `RL_LR`、熵系数、课程阈值、Teacher/Replay 指标。

**工程与运维**：定期存盘与回滚 (`RL_SAVE_EVERY`)、双机对比超参。

---

### 三、排障：数值稳定与指标解读

#### 3.1 根因归纳

##### 单局 `train_episode` 路径

价值目标为 MC 折扣回报与当前价值估计的 smooth L1。长局单步奖励大时 G_t 可达数百到数千，若价值头接近初始化量级，|G−V| 很大 → loss_value 数值高。

##### 批量 PPO 路径

使用 GAE 构造优势与回报；TD 误差在长局、大 r 时可累积放大。原 `rets_np` 使用 ±1e5 宽松裁剪，与 outcome 混合目标（约 [0,2]）尺度不一致时价值分支仍可能学在错误量级上。

#### 3.2 代码侧优化

| 位置 | 改动 |
|------|------|
| `backend/rl_backend.py` | `RL_RETURNS_CLIP`（±512）裁剪单局 MC 回报 |
| `backend/rl_backend.py` | `_loss_scalar_for_log`：有限性检查 + `RL_LOG_LOSS_CLIP`（1e6） |
| `rl_pytorch/train.py` | `RL_VALUE_TARGET_CLIP`（512）裁剪回报目标 |
| `rl_pytorch/train.py` | `RL_GAE_DELTA_CLIP`（80）裁剪 TD 误差 |
| `web/src/bot/rlTrainingCharts.js` | 异常点置 NaN 避免旧日志污染纵轴 |

#### 3.3 环境变量参考

| 变量 | 默认 | 作用 |
|------|------|------|
| `RL_RETURNS_CLIP` | 512 | 单局路径：\|G\| 逐元素上限 |
| `RL_VALUE_TARGET_CLIP` | 512 | 批量 PPO：价值回归目标逐元素上限 |
| `RL_GAE_DELTA_CLIP` | 80 | 批量 PPO：TD 误差裁剪 |
| `RL_LOG_LOSS_CLIP` | 1e6 | 写入日志/API 的损失标量绝对值上限 |

#### 3.4 看板解读建议

- Lv：优先看粗线滑动平均；偶发尖峰对照是否旧 JSONL 或未重启后端
- Lπ：高噪声常见；与熵、胜率同向则多为可接受
- 胜率/得分/步数：外在指标，与 Lv 解耦判断

---

## 二十三、RL 研究：复杂度、瓶颈与文献对照

> 当前定位：复杂度分析、瓶颈诊断、优化候选池与自博弈文献对照，作为 [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) 的背景材料。
> 当前算法、维度、奖励和服务路径以 `ALGORITHMS_RL.md` 与代码为准。

---

### 一、复杂度、模型与优化候选池

#### 1.1 游戏玩法机制

| 属性 | 值 |
|------|-----|
| 棋盘 | 8×8 正方网格 |
| 颜色 | 8 种（不影响消除判定） |
| 候选区 | 每轮 3 个形状，放完才刷新 |
| 消除 | 行或列整行满即消除 |
| 终局 | 剩余块无合法位置 |
| 胜利 | 分数达到阈值 |

#### 1.2 计分

Web/小程序消行得分由 `computeClearScore()` 统一计算。规则：
- 基础分：`baseScore = baseUnit × c²`，`baseUnit = scoring.singleLine`（默认 20）
- 同 icon/同色 bonus：`subtotal = baseScore + baseUnit × c × b × 4`
- **连击倍数 v1.66+**：`clearScore = subtotal × perfectMult × comboMult`，`comboMult` 由 `_clearStreak`（连续消行落子计数）经 `clearScoring.comboMultiplier` 推导，默认 ≥ 3 连 ×2 cap

Python RL 模拟器盘面分数增量与上述公式对齐。

#### 1.3 RL 即时奖励

| 信号 | 值 | 触发 |
|------|-----|------|
| placeBonus | +0.12 | 每次放置 |
| densePerClear | +2.5×c | 消除 c 行 |
| multiClearBonus | +1.8×(c-1) | c≥2 |
| survivalPerStep | +0.04 | 每步 |
| winBonus | +50 | 首次达标 |
| stuckPenalty | -2.0 | 终局未赢 |

#### 1.4 状态/动作空间

- 状态空间理论：9^64（每个格子 9 种状态），实际 187 维编码
- 动作空间：单步最大 192，典型 30~80
- 博弈树：~10^42（中等复杂度，围棋 ~10^170，国际象棋 ~10^47）

#### 1.5 关键算法瓶颈

1. `count_clears_if_placed`：每步调用 ~50 次，O(50 × 64) = 3200 次格子操作
2. `get_legal_actions`：遍历 3×8×8=192 候选并检查 `can_place`
3. 每步所有合法动作过策略网络 → GPU batch 大小~50

#### 1.6 模型架构

conv-shared（默认）：187 维 → 标量 48（含 4 维单步难度 + 2 维客观几何）+ grid Conv2d→32 + dock attention→48 → concat 126 → h(s)[128] → value_head + policy_head + 辅助监督头。

#### 1.7 特征工程评估

| 组件 | 维度 | 评价 |
|------|------|------|
| 48 标量 | 填充率、行列极值、临消、空洞、颜色统计、**4 维单步出块难度**、**2 维客观几何（连通块/凹角）** | ✅ 覆盖几何/拓扑/颜色/组合难度 |
| 64 棋盘 | 二值占用 0/1 | ⚠️ 丢失颜色和相对位置模式 |
| 75 dock | 3×5×5 形状掩码 | ✅ 足够 |
| 15 动作 | 坐标、形状、后果代理 | ✅ 含放置后棋盘质量代理 |

#### 1.8 核心问题诊断

1. **价值估计不准**：CNN 无法感知空洞结构，Value 头仅 2 层
2. **特征信息瓶颈**：holes、lines_clearable 口径必须正确且与拓扑辅助监督头一致
3. **采集效率低**：每步克隆棋盘占 70%+ 采集时间
4. **奖励稀疏**：多数步只有 0.16，消行频率低

#### 1.9 优化方案

**特征增强（P0）**：holes_count/area、max_height、行/列跳变、井深度、fillable-aware 临消线、dock_mobility

**动作特征增强（P1）**：holes_after、delta_transitions、new_almost_full、post_mobility、multi_clear、bonus_line、perfect_clear

**超参调优（P1）**：lr 1e-3→3e-4, batch 16→32, γ 0.99→0.97, ppo_epochs 4→3, return_scale 0.1→0.05

**模型架构微调（P2）**：加深价值头（3 层）、CNN 加残差连接、Dock 分支独立编码器

**采集加速（P4）**：缓存 `can_place`、增量式 `would_clear`、并行采集 `--n-workers`

#### 1.10 当前维度契约

```
stateScalarDim: 48  gridSpatialDim: 64  dockSpatialDim: 75
stateDim: 187  actionDim: 15  phiDim: 202
```

---

### 二、自博弈 RL 文献对照与 OpenBlock 适配

> 来源：Canvas `rl-self-play-literature-comparison.canvas.tsx`

#### 2.1 核心结论

OpenBlock 已接近 AlphaZero / Expert Iteration 轻量工程版本。真正差距在：
- Value / Q 归一化
- 随机出块建模
- 困难样本重放
- Bonus-aware 表示

#### 2.2 算法适配矩阵

| 算法家族 | 核心思想 | OpenBlock 适配 | 对照结论 |
|----------|----------|----------------|----------|
| AlphaZero | MCTS + policy/value + visit CE + eval gate | 已有 visit_pi CE、EvalGate、MCTS；仍是 PPO 混合 | 已有部分 |
| MuZero | 学习 dynamics/reward/value/policy | 低优先（有精确 simulator） | 暂缓 |
| Ranked Reward | 滑动窗口分位奖励 | 已实现 p50→p70 | 后续关注背离 |
| Single-player MCTS | 单人 value normalization | 关键缺口（分数上探的关键） | 高优先 |
| Expert Iteration | 搜索专家→网络蒸馏 | 当前 q/visit 蒸馏是 ExIt-lite | 应加入 replay buffer |
| Gumbel AlphaZero | 少模拟高效搜索 | 适合动作多、预算有限 | 高性价比 |
| Policy/Search Distillation | MCTS/beam 蒸馏 | 已部分实现 | 需质量监控 |
| Dreamer / World Models | latent world model | 中低优先 | 不划算 |

#### 2.3 推荐路线

| 优先级 | 优化 | 预期效果 |
|--------|------|----------|
| 1 | 单人搜索值归一化（z-score / rank / softmax 温度校准） | 减少 value 标度错位 |
| 2 | ExIt 化训练缓存（search-improved targets replay） | 提升样本效率 |
| 3 | Gumbel root improvement（采样 top actions 后小预算 Q 评估） | 少模拟下提升 root policy 质量 |
| 4 | Chance-aware dock refill（spawn predictor 或多样本期望） | 降低对当前三块过拟合 |
| 5 | Bonus-aware 表示升级（行列同色进度/颜色平面） | 提高同色 bonus 命中率 |
| 6 | 稳健评估套件（固定 seed、分位数、bonus 率、gate A/B） | 避免指标好看但真实分不涨 |

#### 2.4 评估注意事项

- 同时看绝对分、分位排名、bonus 率、死局前可解叶子数
- teacher entropy 太低可能过拟合，太高无指导性
- replay buffer 需记录 teacher 版本和样本年龄
- 单人分数任务的 value 不应简单照搬双人胜负 value 标度

## 关联文档

| 文档 | 关系 |
|------|------|
| [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md) | 总索引 |
| 本手册 §21 RL 契约与在线服务 | 系统分层与单一数据源 + 在线/离线服务（原 本手册 §21） |
| 本手册 §22 RL 训练监控与排障 | 训练看板数据流 + 曲线判读 + 数值稳定（原 本手册 §22） |
| 本手册 §23 RL 研究 | 复杂度/瓶颈/文献对照（原 本手册 §23） |
| [`RL_ALPHAZERO_OPTIMIZATION.md`](./RL_ALPHAZERO_OPTIMIZATION.md) | AlphaZero/MCTS 历史实验档案（v6–v8.3） |

---

> 最后更新：2026-04-27 · 与 v5 实现对齐（ConvSharedPolicyValueNet）  
> 维护：算法工程团队
