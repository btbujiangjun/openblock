# AlphaZero 对比与 RL 优化方案（v8）

## 一、AlphaZero 系列论文核心分析

### 1.1 算法三大支柱

| 组件 | 作用 | 关键创新 |
|------|------|----------|
| **MCTS（蒙特卡洛树搜索）** | 每步行动前做数百次模拟，生成高质量策略目标 | UCB 探索 + 神经网络引导 → 平衡探索与利用 |
| **策略-价值双头网络 f(s)→(p,v)** | 输入棋盘状态 → 输出策略分布 p(a\|s) 和局面评估 v(s) | 共享编码器提取局面特征，两个头分别服务搜索和评估 |
| **纯自博弈** | 不使用人类棋谱，完全从自我对弈中学习 | MCTS 搜索结果作为策略改进目标，游戏胜负作为价值目标 |

### 1.2 训练循环

```
┌───────────────────────────────────────────────────────────┐
│                    AlphaZero 训练循环                       │
│                                                           │
│  1. 自博弈：用 MCTS + 当前网络 f_θ 生成对局                  │
│     → 每步策略目标 π = MCTS 访问分布（非网络原始输出）          │
│     → 价值目标 z = 终局胜负 {-1, 0, +1}                     │
│                                                           │
│  2. 训练网络：                                              │
│     L = (v - z)² + π·log(p) + c·‖θ‖²                     │
│     价值损失 + 策略交叉熵 + 正则化                            │
│                                                           │
│  3. 评估：新网络 vs 旧网络对弈，胜率>55% 则替换               │
│                                                           │
│  ↺ 重复直到收敛                                             │
└───────────────────────────────────────────────────────────┘
```

### 1.3 关键设计选择

1. **MCTS 提供更好的策略目标**：网络的原始策略 p(a|s) 可能很差（尤其早期），但经过 MCTS 搜索后的访问分布 π(a|s) 要好得多。策略头学习「模仿搜索结果」而非「从稀疏奖励中摸索」
2. **价值目标来自终局结果**：z ∈ {-1, 0, +1}，简单且无偏
3. **探索通过 UCB 和 Dirichlet 噪声**：在根节点加 Dir(α) 噪声确保探索新着法
4. **残差 CNN 编码器**：19 或 40 层残差塔处理二维棋盘空间特征

---

## 二、Open Block 游戏玩法分析

### 2.1 核心机制

| 属性 | 值 |
|------|-----|
| 棋盘 | 8×8 正方网格 |
| 颜色 | 8 种（不影响消除判定） |
| 候选区 | 每轮 3 个形状，放完才刷新 |
| 消除 | 行或列**整行满**即消除（类似 1010!），无重力 |
| 终局 | 剩余未放置的块都无合法位置 |
| 胜利 | 分数达到阈值（课程 40→220 / 40k ep） |

### 2.2 复杂度估计

| 指标 | Open Block | 围棋 | 国际象棋 |
|------|-----------|------|----------|
| 棋盘大小 | 8×8 | 19×19 | 8×8 |
| 平均分支因子 | ~50 | ~250 | ~35 |
| 平均局长 | 15-40 步 | ~200 步 | ~40 步 |
| 博弈树节点 | ~10⁴² | ~10¹⁷⁰ | ~10⁴⁷ |
| 对手 | 无（单人） | 有 | 有 |
| 随机性 | 出块随机 | 无 | 无 |

### 2.3 特殊挑战

1. **随机性**：每轮出块是随机的，玩家无法完全控制局面走向
2. **空间规划**：无重力意味着空洞是永久的，一步错可能万步难回
3. **顺序依赖**：三块的放置顺序强烈影响后续可行性
4. **信用分配**：得分集中在消行步，大量步骤无直接奖励

---

## 三、当前 RL 实现与 AlphaZero 的差距诊断

### 3.1 架构对比

| 方面 | AlphaZero | Open Block RL (v5) | 差距评估 |
|------|-----------|-------------------|----------|
| **搜索/规划** | MCTS（每步数百次模拟） | **无搜索**，直接采样 | ⚠️⚠️⚠️ **致命差距** |
| **策略目标** | MCTS 访问分布（高质量） | REINFORCE/PPO 策略梯度（从奖励学） | ⚠️⚠️ 策略改进效率低 |
| **价值目标** | 终局胜负 z | 纯 outcome（score/threshold） | ⚠️ 合理但粒度粗 |
| **网络架构** | 残差 CNN | 残差 CNN + DockBoardAttention | ✅ 适合问题 |
| **探索** | Dirichlet 噪声 + UCB | 温度采样（Dirichlet 默认关） | ⚠️ 探索不足 |
| **训练算法** | 监督学习（模仿搜索） | PPO（策略梯度） | 方法论差异 |

### 3.2 不收敛的根本原因链

```
根因 1: 无 MCTS → 策略靠自身输出采样 → 早期近乎随机
  → 游戏极短（~10步）→ 每局数据极少
  → MC returns 方差巨大 → V 学不会

根因 2: V 学不会 → GAE advantage ≈ 纯 reward（噪声）
  → 策略梯度几乎无方向 → 策略不改善
  → 数据质量不提升 → V 更学不会 → 恶性循环

根因 3（v5特有）: outcome_mix=1.0 → V_target = 常数（同一局所有步相同）
  → V 收敛到全局平均分（~0.25）→ 丧失逐步评估能力
  → advantage = returns - V(s) ≈ returns - 0.25（退化为无 baseline 的 REINFORCE）

根因 4: 浏览器训练路径用 Flask 单局 REINFORCE
  → 极高方差，每局一次梯度更新
  → 完全不如离线 PPO + GAE + 批量更新
```

### 3.3 各子问题严重度排序

| 优先级 | 问题 | 严重度 | 影响 |
|--------|------|--------|------|
| P0 | 无搜索/规划（最关键 AlphaZero 差距） | ⭐⭐⭐⭐⭐ | 策略质量差 → 短局 → 少数据 → 不收敛 |
| P1 | Flask 单局 REINFORCE（浏览器训练路径） | ⭐⭐⭐⭐⭐ | 梯度方差极大，更新无方向 |
| P2 | outcome_mix=1.0 导致 V≈常数 | ⭐⭐⭐⭐ | advantage 退化，信用分配失败 |
| P3 | 探索不足（Dirichlet 关闭） | ⭐⭐⭐ | 过早收敛到次优策略 |
| P4 | 课程起点过高（80 分） | ⭐⭐ | 早期几乎拿不到 winBonus |

---

## 四、优化方案：v6 改动清单

### 4.1 核心改动：1-Step Lookahead（弥补 MCTS 缺失）

**原理**：为每个合法动作模拟一步，评估后继状态 V(s')，计算：
```
Q(s, a) = r(s, a) + γ · V(s')
```

这是 MCTS 的最小可用替代品（1-ply search）。AlphaZero 用数百次 MCTS 模拟，我们用单步前瞻：
- 不需要完整树搜索，计算开销可控
- V(s') 由训练好的价值网络评估
- Q 值与策略 logits 混合后采样，兼顾网络策略和前瞻评估

**实现**（`rl_pytorch/train.py`）：
```python
def _lookahead_q_values(net, device, sim, legal, gamma):
    saved = sim.save_state()
    for i, a in enumerate(legal):
        r = sim.step(a)                    # 模拟一步
        next_states[i] = extract_features(sim)  # 提取后继特征
        rewards[i] = r
        sim.restore_state(saved)           # 回退
    v_next = net.forward_value(next_states)  # 批量评估 V(s')
    return rewards + gamma * v_next         # Q(s,a)

# 动作选择时混合：
combined_logits = (1 - mix) * policy_logits + mix * Q_values / temp
```

**配置**：
- `RL_LOOKAHEAD=1`（默认开启）
- `RL_LOOKAHEAD_MIX=0.5`（策略与 Q 值各占一半）
- 开局探索阶段（step < explore_first_moves）不使用 lookahead，保持高温探索

### 4.2 Flask 后端：Replay Buffer + 批量 PPO

**问题**：浏览器训练每局发一个 HTTP 请求，Flask 端即时做单步 REINFORCE 更新。

**方案**：
```
浏览器发送轨迹 → 加入 replay buffer
  ↓
buffer 未满 → 返回 {buffered: true}，不做梯度更新
  ↓
buffer 满（默认 32 局）→ 执行批量 PPO（3 epochs）→ 返回 loss
```

**实现**（`rl_backend.py`）：
- `_convert_episode_for_ppo()`：将 Flask 数据转为 `train.py` 格式，包括计算 `old_log_prob`
- `_flush_replay_buffer()`：调用 `train.py` 的 `_reevaluate_and_update` 做真正的 PPO 更新
- 新端点 `/api/rl/flush_buffer`：手动触发 buffer 刷新
- 新端点 `/api/rl/eval_values`：批量 V(s) 评估，供浏览器端 lookahead

**配置**：
- `RL_BATCH_SIZE=32`（buffer 容量；设为 1 回退到旧行为）
- `RL_PPO_EPOCHS_ONLINE=3`
- `RL_GAE_LAMBDA=0.85`
- `RL_PPO_CLIP=0.2`

### 4.3 价值目标修复：混合 outcome

**问题**：v5 的 `outcome_mix=1.0` 导致 V 学习常数值。

**修复**：降至 `0.5`，让价值函数同时从：
- **GAE returns**（含势函数塑形的逐步回报）→ 学会区分好坏局面
- **Outcome**（终局得分比）→ 提供稳定锚点，避免 V bootstrap 发散

### 4.4 课程与奖励调优

| 参数 | v5 | v6 | 原因 |
|------|----|----|------|
| `winThresholdStart` | 80 | **40** | 更低起点让早期拿到 winBonus |
| `rampEpisodes` | 80000 | **40000** | 更快课程爬坡 |
| `potentialShaping.coef` | 0.5 | **0.8** | 更强逐步信号，补偿 outcome_mix 降低 |
| `winBonus` | 25 | **35** | 更强胜利激励 |
| `stuckPenalty` | -5.0 | **-8.0** | 更强死局惩罚，学会避险 |
| `dirichlet_epsilon` | 0.0 | **0.15** | 默认开启 Dirichlet 探索 |
| `explore_temp_mult` | 1.5 | **1.3** | 配合 Dirichlet 降低纯温度探索 |

### 4.5 浏览器端 1-Step Lookahead

**流程**：
```
浏览器端每步决策:
  1. 获取合法动作列表 legal[]
  2. 对每个动作: sim.saveState() → sim.step(a) → extractStateFeatures(s') → sim.restoreState()
  3. 批量发送 states[] 到 /api/rl/eval_values → 得到 V(s')[]
  4. 计算 Q(s,a) = r(s,a) + γ·V(s')
  5. 用 Q 值 softmax 采样（带温度）
```

**配置**：`opts.useLookahead = true` 传入 `trainSelfPlay()`

---

## 五、v7 优化：向 AlphaZero 三大支柱进一步靠拢

在 v6 已验证的基础（1-step lookahead + outcome 混合 + 势函数 + 课程）上，v7 实现三项针对性优化，逐步弥合与 AlphaZero 的核心差距。

### 5.1 Q 分布蒸馏（策略头学搜索目标）

**动机**：AlphaZero 的策略头学习「模仿 MCTS 访问分布」，而不是靠稀疏的 PPO 梯度摸索方向。我们已有 lookahead Q 值，但它们仅用于动作采样的 logit 混合，策略头本身并不学习 Q 分布。

**实现**：在 `_reevaluate_and_update` 中，对每个有 Q 值的步骤额外计算蒸馏损失：
```python
target_pi = softmax(Q(s, ·) / τ)            # Q 值 → 目标分布（τ 控制峰值）
loss_q_distill = -Σ target_pi * log π_θ(·|s)  # CE 损失，与 PPO 损失叠加
```

**关键设计**：
- `target_pi` 在收集阶段固定（不随 PPO 多轮 epoch 变化），等价于监督学习目标
- τ=1.0（默认）：保留 Q 值差异的完整信息；τ→0 退化为硬标签（最优动作独占概率 1）
- 系数 `coef=0.1`：不干扰主要 PPO 损失，仅提供额外梯度方向

**配置**（`game_rules.json`）：
```json
"qDistillation": {
  "enabled": true,
  "coef": 0.1,   // 蒸馏损失权重（RL_Q_DISTILL_COEF 覆盖）
  "tau": 1.0     // 软化温度（RL_Q_DISTILL_TAU 覆盖）
}
```

**训练日志**：启用后输出 `qdst=xxx` 损失值，应在训练初期快速下降至 0.1 以下。

---

### 5.2 三块组合 2-ply Beam（捕捉跨块协同）

**动机**：Block Puzzle 每轮放 3 块，当前 1-step lookahead 只看「当前块怎么放」，完全忽略「放完这块后，下一块怎么放」的协同效应。这是游戏结构特有的重要信息。

**实现**（`_beam_2ply_q_values`）：
```
Q_2ply(s, a1) = r1 + γ · max_{a2 ∈ legal(s')} [r2 + γ · V(s'')]
```

**效率设计**（避免 O(n²) GPU 调用）：
```
第一层：对所有 n_actions 计算 Q_1ply（1 次批量 GPU 推理）
         ↓
选出 top-k（按 Q_1ply 排序，k=15）做第二层展开
         ↓
第二层：收集所有 s'' 后做 1 次合并批量推理（而非每个 top-k 单独推理）
         ↓
其余动作保持 Q_1ply（退化为 1-step）
```

**Guard 条件**：
- dock 剩余块 < 2：自动退化为 1-step lookahead（2-ply 无意义）
- n_actions > max_actions（默认 100）：跳过，防止动作过多时爆内存

**配置**：
```json
"beam2ply": {
  "enabled": true,
  "topK": 15,         // 第二层展开的动作数（RL_BEAM2PLY_TOPK 覆盖）
  "maxActions": 100   // 超出此数时退化为 1-step
}
```

环境变量 `RL_BEAM2PLY=0` 可临时关闭，退化为 v6 的 1-step lookahead。

---

### 5.3 评估门控（训练稳定性保障）

**动机**：AlphaZero 第三步「仅当新模型胜率 >55% 才替换基线」，防止训练震荡和灾难性遗忘。v6 无此机制。

**实现**（`rl_pytorch/eval_gate.py`）：
```python
# 每 eval_gate_every 局：
baseline_net.load_state_dict(baseline_sd)       # 加载历史最优权重
passed, metrics = eval_gate_check(net, baseline_net, device, n_games=50)
# 候选胜率 >= 基线胜率 × 0.55 → 更新基线
```

**两种门控模式**：
- **软门控**（默认）：仅打印日志 `[EvalGate] ✓/✗`，训练继续
- **硬门控**（`RL_EVAL_GATE_HARD=1`）：失败时恢复到基线权重

**启用方式**：
```bash
# 每 2000 局检查一次，50 局贪心评估，候选须超过基线胜率的 55%
python -m rl_pytorch.train --eval-gate-every 2000 --eval-gate-games 50 --eval-gate-win-ratio 0.55
```

默认关闭（`--eval-gate-every 0`），适合初始训练阶段不干预。

---

### 5.4 v7/v8 新增环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RL_Q_DISTILL_COEF` | 0.1 | Q 蒸馏损失权重；0=关闭 |
| `RL_Q_DISTILL_TAU` | 1.0 | Q → target_pi 的软化温度 |
| `RL_BEAM2PLY` | 1 | 2-ply beam 开关；0=退化为 1-step |
| `RL_EVAL_GATE_HARD` | 0 | 硬门控开关；1=失败时恢复**历史最优**权重（v8 升级） |
| `RL_BEAM3PLY` | 0 | v8：1=启用 3-ply 全排列 beam（dock=3 时激活） |
| `RL_ADAPTIVE_CURRICULUM` | 0 | v8：1=启用自适应课程（滑动胜率控速） |
| `RL_MCTS` | 0 | v8：1=启用轻量 UCT-MCTS（与 beam 互斥，优先级更高） |
| `RL_MCTS_SIMS` | 20 | v8：MCTS 每步模拟次数 |
| `RL_MCTS_CPUCT` | 1.5 | v8：UCB 探索系数 |
| `RL_MCTS_MAX_DEPTH` | 8 | v8：单次模拟最大展开深度 |

---

## 六、训练效率优化

### 5.1 Simulator State Save/Restore

新增 `saveState()` / `restoreState()` 方法（Python 和 JavaScript 双端），避免 1-step lookahead 中的完整对象深拷贝。只保存/恢复最小必要状态（cells 数组、dock 列表、标量计数器）。

### 5.2 环境变量一览（v6 新增）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RL_BATCH_SIZE` | 32 | Flask replay buffer 大小；1=回退旧行为 |
| `RL_PPO_EPOCHS_ONLINE` | 3 | Flask 批量 PPO 轮数 |
| `RL_PPO_CLIP` | 0.2 | PPO clip ε |
| `RL_GAE_LAMBDA` | 0.85 | GAE λ |
| `RL_LOOKAHEAD` | 1 | 离线训练是否开启 1-step lookahead |
| `RL_LOOKAHEAD_MIX` | 0.5 | lookahead Q 值与策略 logits 混合比 |

### 5.3 新增 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/rl/eval_values` | POST | 批量 V(s) 评估：`{states: float[][]}` → `{values: float[]}` |
| `/api/rl/flush_buffer` | POST | 手动触发 replay buffer PPO 更新 |

---

## 六、文件变更清单

| 文件 | 变更类型 | 主要内容 |
|------|----------|----------|
| `shared/game_rules.json` | 参数调整 | outcome_mix, 课程, 势函数, 奖惩信号 |
| `rl_backend.py` | 重大改进 | replay buffer, batch PPO, eval_values, flush_buffer |
| `rl_pytorch/train.py` | 重大改进 | 1-step lookahead (\_lookahead\_q\_values), Dirichlet 默认开启 |
| `rl_pytorch/simulator.py` | 功能增强 | save_state/restore_state |
| `web/src/bot/simulator.js` | 功能增强 | saveState/restoreState |
| `web/src/bot/trainer.js` | 功能增强 | lookahead 动作选择, buffer flush |
| `web/src/bot/pytorchBackend.js` | 新增接口 | evalValuesRemote, flushBufferRemote |

---

## 七、预期效果与验证指标

### 7.1 收敛改善预期

| 改动 | 预期效果 | 验证指标 |
|------|----------|----------|
| 1-step lookahead | 每局存活步数 10→25+，平均得分 50→120+ | `avg_score`, `game_steps` |
| Batch PPO（Flask） | 梯度方差降 10×，loss 平稳下降 | `loss_policy` 曲线 |
| outcome_mix=0.5 | V 学会逐步评估（非常数），advantage 有意义 | `loss_value` 持续下降 |
| 课程起点 40 | 前 5k 局 winBonus 触发率从 <5% → 20%+ | `win_rate` |
| Dirichlet 探索 | 发现更多高分策略，避免局部最优 | `max_score` 分位数 |

### 7.2 综合预期

在 **10,000 局**训练后：
- **平均得分**：从 ~50 提升到 **~150**（3× 提升）
- **胜率（≥220 分）**：从 <1% 提升到 **~15%**
- **平均存活步数**：从 ~10 提升到 **~30**

在 **50,000 局**训练后：
- **平均得分**：~200
- **胜率**：~40%
- 模型开始展现空间规划能力（主动避免空洞、预留消行通道）

### 7.3 如何验证

```bash
# 离线训练（推荐先跑 5000 局看趋势）
python -m rl_pytorch.train --episodes 5000 --device auto --save rl_checkpoints/v6.pt

# 观察关键指标：
# - avg100：近 100 局平均得分（应持续上升）
# - win%：胜率（应从 0 逐步上升）
# - π：策略损失（应先降后趋于稳定）
# - V：价值损失（应持续下降）
# - bq/feas/surv：辅助头损失（应快速下降）
```

---

## 八、预期效果与验证指标（v7 更新）

### 8.1 v7 新增改动的预期效果

| 改动 | 预期效果 | 验证指标 |
|------|----------|----------|
| 2-ply beam | 跨块协同得分提升，avg_score +20-40 | `avg100` 曲线，消行频率 |
| Q 蒸馏（coef=0.1） | 策略头更快收敛，探索阶段更有方向 | `loss_q_distill` 快速降至 0.1 以下 |
| eval gate | 训练后期稳定性提升，防止震荡 | 连续 5 次门控 PASSED 后胜率无明显回退 |

### 8.2 v7 训练命令

```bash
# 标准 v7 训练（含评估门控，适合长跑）
python -m rl_pytorch.train \
  --episodes 50000 --device auto --arch conv-shared --width 128 \
  --batch-episodes 128 --ppo-epochs 4 --gae-lambda 0.85 \
  --dirichlet-epsilon 0.15 \
  --eval-gate-every 2000 --eval-gate-games 50 \
  --save rl_checkpoints/v7.pt
```

---

## 九、v8 优化：课程自适应 + 全排列 Beam + 历史最优门控 + 轻量 MCTS

### 9.1 自适应课程（Adaptive Curriculum）

**动机**：v7 课程为固定线性爬坡（40→220 / 40k ep），无法响应模型的实际学习进度。若模型进展快（高胜率），门槛升得太慢；进展慢（低胜率），门槛升得过快导致奖励稀疏。

**实现**（`rl_pytorch/train.py` + `rl_pytorch/game_rules.py`）：

```
维护虚拟局数 virtual_ep（vs 真实 ep_cursor）
每 checkEvery 局检查滑动窗口胜率：
  win_rate > target_win_rate → virtual_ep += stepUp × checkEvery  # 加速推进
  win_rate < target_win_rate × 0.6 → virtual_ep += 0  # 暂停
  否则 → virtual_ep += checkEvery  # 正常速度
win_threshold = rl_win_threshold_from_virtual_ep(virtual_ep)
```

**关键设计**：
- 虚拟局数与真实局数解耦，仅控制课程门槛，不影响全局训练进度
- `stepDown=0` 防止课程倒退（已学到的能力不应被否定）
- 参数化配置（`game_rules.json → adaptiveCurriculum`）

**启用方式**：
```bash
python -m rl_pytorch.train --adaptive-curriculum --episodes 50000
# 或：RL_ADAPTIVE_CURRICULUM=1 python -m rl_pytorch.train ...
```

**新增环境变量**：

| 变量 | 说明 |
|------|------|
| `RL_ADAPTIVE_CURRICULUM` | 1=启用自适应课程 |

---

### 9.2 三块全排列 3-ply Beam

**动机**：v7 的 2-ply beam 覆盖「当前块→次块」的跨步协同，但 Open Block 每轮 3 块构成完整组合，第三块的放置往往决定是否能触发多消行。3-ply beam 覆盖完整三块序列，捕捉最完整的跨块协同效应。

**实现**（`rl_pytorch/train.py → _beam_3ply_q_values`）：

```
Q_3ply(s, a1) = r1 + γ · max_{a2}[r2 + γ · max_{a3}[r3 + γ · V(s''')]]
```

层次开销控制：
- **第一层**：全部 n_actions 动作（有 maxActions 上限）
- **第二层**：仅 top_k 个 a1 展开（默认 15）
- **第三层**：仅 top_k2 个 a2 展开（默认 5），且限制第二层每 a1 下的动作数
- **批量推理**：所有 \(s'''\) 合并为一次 GPU forward，最小化推理开销

**Guard 条件**：dock 剩余块 < 3 时自动退化为 2-ply；dock = 1 时退化为 1-step。

**启用方式**：
```bash
python -m rl_pytorch.train --beam3ply --episodes 50000
# 或：RL_BEAM3PLY=1 python -m rl_pytorch.train ...
```

**新增 game_rules.json 配置**：
```json
"beam3ply": {
  "enabled": false, "topK": 15, "topK2": 5,
  "maxActions": 100, "maxActions2": 50
}
```

---

### 9.3 Eval Gate 硬门控 + 历史最优保留

**v7 问题**：硬门控失败时仅恢复到「上一次通过门控时的基线」，若基线权重本身是在某次运气较好的局上通过的，可能并非真正最优。

**v8 改进**（`rl_pytorch/train.py`）：

```
维护 _best_ever_sd（历史最优权重）+ _best_ever_wr（对应胜率）
门控 PASSED：若 cand_wr > best_ever_wr → 更新 _best_ever_sd（标注 ★）
门控 FAILED + 硬门控：恢复到 _best_ever_sd（非 _baseline_sd）
```

**效果**：确保训练全程永远不低于历史观测到的最优性能点，类似 AlphaZero 的「锦标赛冠军保留」机制。

**启用方式**：
```bash
# 软门控（默认）：仅记录
python -m rl_pytorch.train --eval-gate-every 2000

# 硬门控 + 历史最优
RL_EVAL_GATE_HARD=1 python -m rl_pytorch.train --eval-gate-every 2000
```

**日志示例**：
```
[EvalGate] ep=4000  ✓ PASSED  cand=62.0%  base=55.0%  → 基线已更新  ★ 历史最优已更新
[EvalGate] ep=6000  ✗ FAILED  cand=48.0%  base=55.0%  [已恢复历史最优 best_wr=62.0%]
```

---

### 9.4 轻量 MCTS（UCT，10-50 次模拟）

**动机**：AlphaZero 最核心的创新是「用 MCTS 搜索分布替代网络原始策略作为训练目标」。v8 实现轻量 UCT，以可接受的开销向此目标靠拢。

**算法**（`rl_pytorch/mcts.py`）：

```
UCB(s, a) = Q(s,a) + c_puct × P(a|s) × √N(s) / (1 + N(s,a))

每次模拟流程：
1. Selection  : 从根节点向下，按 UCB 选子节点，直到未展开节点或终局/深度限制
2. Expansion  : 用策略网络输出 P(a|s) 初始化子节点先验
3. Evaluation : 用价值网络 V(leaf)（替代随机 rollout，低方差）
4. Backup     : 沿路径更新 Q(s,a) = W(s,a)/N(s,a)

搜索结束后：π(a) = N(root_child_a) / Σ N(root_child)
π 作为策略改进目标（通过 Q 代理接入 Q-蒸馏损失）
```

**实现亮点**：
- 使用 `sim.save_state()/restore_state()` 实现零拷贝树遍历
- `mcts_q_proxy()` 将访问分布转为对数尺度的伪 Q 值，直接兼容现有 Q 蒸馏框架
- 无跨步树复用（每步从零建树），适合 10~50 次模拟的轻量场景

**启用方式**：
```bash
# 默认 20 次模拟，c_puct=1.5，最大深度 8
python -m rl_pytorch.train --mcts --episodes 10000

# 自定义模拟次数
python -m rl_pytorch.train --mcts --mcts-sims 50

# 环境变量方式
RL_MCTS=1 RL_MCTS_SIMS=30 RL_MCTS_CPUCT=2.0 python -m rl_pytorch.train ...
```

**新增环境变量**：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RL_MCTS` | 0 | 1=启用轻量 MCTS（优先级高于 beam） |
| `RL_MCTS_SIMS` | 20 | 每步模拟次数 |
| `RL_MCTS_CPUCT` | 1.5 | UCB 探索系数 |
| `RL_MCTS_MAX_DEPTH` | 8 | 单次模拟最大展开深度 |
| `RL_BEAM3PLY` | 0 | 1=启用 3-ply beam |

**搜索方式优先级**：`MCTS > 3-ply beam > 2-ply beam > 1-step lookahead`

---

### 9.5 v8 综合训练命令

```bash
# 完整 v8 训练（自适应课程 + 3-ply beam + 历史最优硬门控）
python -m rl_pytorch.train \
  --episodes 80000 --device auto --arch conv-shared --width 128 \
  --batch-episodes 128 --ppo-epochs 4 --gae-lambda 0.85 \
  --dirichlet-epsilon 0.15 \
  --adaptive-curriculum \
  --beam3ply \
  --eval-gate-every 2000 --eval-gate-games 50 \
  --save rl_checkpoints/v8.pt

# MCTS 实验（较慢，建议先用小 batch 验证）
RL_EVAL_GATE_HARD=1 python -m rl_pytorch.train \
  --episodes 20000 --device auto \
  --adaptive-curriculum --mcts --mcts-sims 20 \
  --eval-gate-every 1000 \
  --save rl_checkpoints/v8_mcts.pt

# 消融实验矩阵
RL_BEAM3PLY=0 python -m rl_pytorch.train --episodes 10000 --save rl_checkpoints/v8_no3ply.pt
RL_ADAPTIVE_CURRICULUM=0 python -m rl_pytorch.train --episodes 10000 --save rl_checkpoints/v8_fixedcur.pt
```

---

## 十、与 AlphaZero 的剩余差距及未来方向

### 10.1 当前实现与 AlphaZero 的差距（v8 更新）

| 特性 | AlphaZero | v8 现状 | 差距 | 未来方向 |
|------|-----------|---------|------|----------|
| **多步搜索** | MCTS 数百 ply | **1/2/3-ply beam + 轻量 MCTS(10-50)**| 小→中 | 增大 MCTS 模拟次数，树复用 |
| **策略改进目标** | MCTS 访问分布（监督 CE） | PPO + **Q 蒸馏 + MCTS 访问分布代理** | 小 | 直接用 MCTS π 做 CE 目标 |
| **模型评估门控** | 新>旧 55% 替换 | **软/硬门控 + ★历史最优保留** | 已实现 | 锦标赛循环赛（多次对弈） |
| **课程学习** | 固定对手强度递增 | **自适应课程（滑动胜率控速）** | 已实现 | 双向自适应（也可减速） |
| **数据并行** | 数千局并行自博弈 | 2-6 CPU workers | 中 | 增加 n_workers，Ray 分布式 |

### 10.2 v8.1 落地：MCTS 树复用 · 多温度自博弈 · 出块建模 · 形状感知编码

---

#### 10.2.1 MCTS 树复用（`MCTSTreeState`）

**文件**：`rl_pytorch/mcts.py`

AlphaZero 在每步执行动作后，将对应子树复用作为下一步的搜索根节点，节省约 40% 建树开销。

```python
# 使用示例
from rl_pytorch.mcts import MCTSTreeState, run_mcts_reuse, select_action_from_visits

tree = MCTSTreeState()
while not done:
    visit_pi = run_mcts_reuse(tree, net, device, sim, n_simulations=20)
    chosen = select_action_from_visits(visit_pi, temperature=1.0)
    sim.step(legal[chosen])
    tree.advance(chosen)    # 复用对应子树
    if dock_slots_refilled:
        tree.invalidate()   # dock 刷新后重建
```

**关键实现细节**：
- `MCTSTreeState.advance(idx)` 将根指针移动到 `children[idx]`，保留已有统计信息（N/W/Q）
- `run_mcts_reuse` 在已有 N 次模拟的基础上**追加**不足部分，避免重复计算
- dock 刷新检测：`cur_dock_remain > prev_dock_remain` → 自动调用 `tree.invalidate()`
- `n_legal` 校验：动作数改变时（新 dock 布局）强制重建，防止子树索引错乱

**开关**：`RL_MCTS_REUSE=0` 关闭（默认启用），`--mcts-no-reuse` 用于消融实验。

---

#### 10.2.2 多温度自博弈（AlphaZero 风格动作采样）

**文件**：`rl_pytorch/mcts.py` + `rl_pytorch/train.py`

AlphaZero 用访问分布 $\pi(a) \propto N(a)^{1/T}$ 采样训练动作，与温度解耦：

| 场景 | 温度 | 效果 |
|------|------|------|
| 训练早期 | T=1.0 | 按访问比例采样，保持探索多样性 |
| 训练后期 | T→0 | 偏贪心，加速收敛 |
| 评估推理 | T=0 | 纯贪心（argmax），最优策略执行 |

```python
from rl_pytorch.mcts import select_action_from_visits

# 训练时（T=1）
chosen = select_action_from_visits(visit_pi, temperature=1.0)

# 评估时（T=0，贪心）
best = select_action_from_visits(visit_pi, temperature=0.0)
```

**开关**：`--mcts-train-temp 0.8`（渐进降温）或 `RL_MCTS_TRAIN_TEMP=1.0`。

---

#### 10.2.3 出块建模集成（SpawnPredictor + 随机 MCTS 展开）

**文件**：`rl_pytorch/spawn_predictor.py`（新建）

利用已有 `SpawnTransformerV2` 预测下一轮出块分布，在 MCTS 叶子节点评估时以多个 dock 采样求**期望 V**，减少「已知确定 dock」带来的乐观偏差。

```python
from rl_pytorch.spawn_predictor import SpawnPredictor

# 加载预测模型
predictor = SpawnPredictor.load("rl_checkpoints/spawn_v2.pt", device)

# 在 MCTS 中启用随机出块评估
visit_pi = run_mcts(net, device, sim, n_simulations=20,
                   spawn_predictor=predictor)  # 叶子节点 V 用期望值

# 直接预测下一轮形状分布
p0, p1, p2 = predictor.predict_next_shapes(board_np)   # 三槽各 NUM_SHAPES 维概率
s0, s1, s2 = predictor.sample_shape_ids(board_np)       # 一组采样形状 ID

# 求期望价值（n_samples 次采样取均值）
ev = predictor.expected_value(sim, policy_net, device, n_samples=4)
```

**检查点自动发现**：`RL_SPAWN_MODEL_PATH` > `rl_checkpoints/spawn_v2.pt` > 退化为确定性 dock。

**开关**：`--mcts-stochastic [--spawn-model-path PATH]` 或 `RL_MCTS_STOCHASTIC=1`。

**新增环境变量**：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RL_MCTS_REUSE` | 1 | MCTS 树复用开关 |
| `RL_MCTS_TRAIN_TEMP` | 1.0 | 训练时访问分布采样温度 |
| `RL_MCTS_STOCHASTIC` | 0 | 随机出块评估（需 SpawnPredictor） |
| `RL_SPAWN_MODEL_PATH` | - | SpawnTransformerV2 检查点路径 |

---

#### 10.2.4 形状感知编码（DockPointEncoder）

**文件**：`rl_pytorch/model.py`

当前默认编码 `DockBoardAttention` 将 5×5 mask 视为平坦向量，对形状的几何精确性不足。
`DockPointEncoder` 将每个 dock 块的占用格子视为点集，用轻量 PointNet 编码：

```
占用格子坐标 (x_norm, y_norm) → per-point MLP → max pooling → slot embedding
```

| 编码器 | 参数量 | 特点 |
|--------|--------|------|
| `DockBoardAttention`（默认） | ~640 参数 | dock-board 交叉注意力，感知棋盘上下文 |
| `DockPointEncoder`（新增） | ~640 参数 | 几何精确，平移不变，不依赖棋盘特征 |

**使用方式**：
```bash
# 使用 PointNet 形状感知编码（需从头训练，与旧 checkpoint 不兼容）
python -m rl_pytorch.train --point-encoder --episodes 50000 --save rl_checkpoints/v8_point.pt
```

**注意**：更改编码器需从头训练，旧 checkpoint 不可直接复用。建议先用默认 DockBoardAttention 训练到一定水平，再对比 PointEncoder 消融实验。

---

#### 10.2.5 完整 v8.1 训练命令

```bash
# 全功能 v8.1（MCTS 树复用 + 多温度 + 自适应课程 + 历史最优门控）
python -m rl_pytorch.train \
  --episodes 80000 --device auto --arch conv-shared --width 128 \
  --batch-episodes 128 --ppo-epochs 4 \
  --adaptive-curriculum \
  --mcts --mcts-sims 20 --mcts-train-temp 1.0 \
  --eval-gate-every 2000 \
  --save rl_checkpoints/v8_1.pt

# 随机出块 MCTS（需先训练 SpawnTransformerV2）
RL_EVAL_GATE_HARD=1 python -m rl_pytorch.train \
  --mcts --mcts-stochastic \
  --spawn-model-path rl_checkpoints/spawn_v2.pt \
  --episodes 30000 --save rl_checkpoints/v8_stochastic.pt

# PointNet 形状编码消融实验
python -m rl_pytorch.train \
  --point-encoder --mcts --episodes 20000 \
  --save rl_checkpoints/v8_point.pt

# 消融：无树复用（对比开销）
python -m rl_pytorch.train --mcts --mcts-no-reuse --episodes 5000
```

---

### 10.3 剩余未来优化方向

| 优化 | 难度 | 优先级 | 说明 |
|------|------|--------|------|
| MCTS 树持久化（跨局） | 中 | 低 | 当前跨步复用，跨局重建；可用 Zobrist hash 持久化 |
| 完整 MCTS（增大模拟次数）| 低 | 中 | 当前 10~50 次；增至 100+ 可进一步提升策略质量 |
| SpawnTransformerV2 联合训练 | 高 | 中 | 目前独立训练；联合训练让 RL 感知出块先验 |
| Ray 分布式自博弈 | 高 | 低 | 当前 2-6 CPU workers；Ray Actor 可扩展至数十个 |
