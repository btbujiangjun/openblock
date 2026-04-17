# AlphaZero 算法分析与 Open Block RL 优化方案（v6）

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

## 五、训练效率优化

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

## 八、与 AlphaZero 的剩余差距及未来方向

### 8.1 当前实现仍未覆盖的 AlphaZero 特性

| 特性 | AlphaZero | v6 | 差距 | 未来方向 |
|------|-----------|-----|------|----------|
| 多步搜索 | MCTS 数百 ply | 1-step lookahead | 大 | 实现轻量 MCTS（10-50 次模拟） |
| 策略改进目标 | MCTS 访问分布 | PPO 策略梯度 | 中 | 用 Q 值分布替代 REINFORCE 目标 |
| 模型评估 | 对弈胜率筛选 | 无 | 小 | 加入周期性 vs 旧版对比评估 |
| 数据并行 | 数千局并行自博弈 | 单进程或少量 worker | 中 | 增加 n_workers，异步采集 |

### 8.2 Block Blast 特有优化方向

1. **3-块组合搜索**：每轮放 3 块，可对三步组合做 beam search（宽度 5-10）
2. **形状感知编码**：将 dock 块用 GNN 或 PointNet 编码，比 5×5 mask 更精确
3. **对手建模**：出块分布有规律（adaptiveSpawn），学习预测未来出块
4. **课程自适应**：根据实际胜率动态调整课程速度，而非固定线性爬坡
