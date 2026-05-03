# RL 训练架构 v5：直接监督头

> **数值稳定与看板 Lv 爆炸**：见 `docs/RL_TRAINING_NUMERICAL_STABILITY.md`（回报裁剪、GAE delta 裁剪、日志幅值上限）。  
> **看板趋势、训练是否正常、优化清单**：见 `docs/RL_TRAINING_DASHBOARD_TRENDS.md`。

## 1. 根因诊断：为什么 v4 仍然不收敛？

### v4 的做法和局限

v4 引入了势函数奖励塑形、outcome 混合价值目标、12 维动作特征等改进。
但 50 局随机游戏的统计揭示了**根本性矛盾**：

| 统计量 | 值 | 问题 |
|--------|------|------|
| 平均存活步数 | **10 步** | 每局数据极少，MC returns 方差巨大 |
| 零消行率 | **36%** | 超过 1/3 的局拿到零分 → 价值信号极度稀疏 |
| 平均得分 | **51.6** / 阈值 220 | 随机策略离胜利阈值差 4× |

这导致一个**死循环**：
```
V 学不会（MC returns 太嘈杂） → GAE advantage ≈ 噪声
→ 策略梯度无意义 → 策略不改善 → V 更学不会
```

### v5 核心洞察

> **我们拥有棋盘质量的精确公式，为什么要通过稀疏的游戏结果间接学习？**

v5 的关键转变：从「RL from scratch」变为「直接监督 + RL 微调」。

## 2. v5 架构改动

### A. DockBoardAttention — 交叉注意力编码器（最大架构改动）

**问题**：v4 用 `MLP(75→32)` 压缩 dock 特征，丢失了 dock 与棋盘的空间交互信息。
网络无法回答「这个 L 形块能填补棋盘左上角的缺口吗？」

**方案**：每个 dock 块（5×5 mask）对 CNN 棋盘空间特征做 cross-attention：
```
Q = dock_mask(25) → Linear → [head_dim=16]
K, V = grid_conv(32, 8, 8) → Conv1×1 → [16, 64]
Output = softmax(QK/√d) · V → [3, 16] → flatten → [48]
```

**效果**：
- 替代了 flat MLP(75→32) 的盲压缩
- 每个 dock 块自动"看到"棋盘上最适合放置的区域
- trunk 输入从 87 维 → 103 维（23 scalars + 32 grid_pooled + 48 dock_ctx）
- 新增参数 ~10K → 总参数从 172K → 182K

### B. 三个直接监督头（核心收敛突破）

这三个辅助头从共享编码器 h(s) 出发，**每步都有即时梯度**：

| 头 | 输出 | 目标 | 损失函数 | 系数 |
|----|------|------|----------|------|
| `board_quality_head` | 标量 | `board_potential(s) / 30` | Smooth L1 | 0.5 |
| `feasibility_head` | logit | 1 if 所有剩余块可放, else 0 | BCE | 0.3 |
| `survival_head` | 标量 | `steps_to_end / 30` | Smooth L1 | 0.2 |

**为什么这能打破死循环**：
1. `board_quality` 是已知公式 → **无信用分配问题**，每步直接告诉编码器"这个棋盘好不好"
2. `feasibility` 是生存的最直接信号 → 编码器学会识别危险状态
3. `survival` 线性递减 → 平滑的监督信号，帮助编码器理解游戏进程
4. 这三个损失训练的是**共享编码器**，间接帮助价值头和策略头

### C. 纯 Outcome 价值目标

**v4**：`V_target = 0.6 * GAE_returns + 0.4 * outcome`
**v5**：`V_target = outcome = clip(final_score / threshold, 0, 2)`

**原因**：
- GAE returns 依赖 V(s) → 早期 V 随机 → returns 是噪声 → V 学噪声 → 恶性循环
- 纯 outcome 虽然同一局所有步的 target 相同，但跨局的方差足够 V 学习
- 直接监督三头提供了 V 无法获得的 per-step 信号，弥补 outcome 的粗粒度

### D. 精简奖励

**v4 奖励**（7 项，噪声大）：
```
r = gain + placeBonus + densePerClear*c + multiClearBonus*(c-1) + survivalPerStep
  + holePenaltyPerCell*Δholes + heightPenalty*h + potentialShaping
```

**v5 奖励**（3 项，干净）：
```
r = gain + potentialShaping + winBonus
```

移除的项（`placeBonus`, `densePerClear`, `holePenalty`, `heightPenalty`, `survivalPerStep`）
全部由直接监督头学习，不再注入奖励产生噪声。

## 3. 损失函数总览

```
L_total = L_policy + value_coef * L_value - entropy_coef * H
        + 0.5 * L_board_quality     ← 棋盘结构质量回归
        + 0.3 * L_feasibility       ← 剩余块可行性二分类
        + 0.2 * L_survival          ← 生存步数回归
        + 0.15 * L_clear_pred       ← 消行数分类（v4 保留）
        + 0.12 * L_hole_aux         ← 空洞数回归（v4 保留）

where:
  L_policy = PPO clipped surrogate (ratio * adv, clip(ratio) * adv)
  L_value  = PPO-clipped smooth_l1(V, outcome_target)
  L_board_quality = smooth_l1(pred_bq, board_potential/30)
  L_feasibility   = BCE(pred_logit, actual_feasible)
  L_survival      = smooth_l1(pred_surv, steps_to_end/30)
```

## 4. 训练参数变更

| 参数 | v4 | v5 | 原因 |
|------|----|----|------|
| GAE λ | 0.95 | **0.85** | outcome 目标下 V 收敛更快，可用较低 λ 降方差 |
| outcome_mix | 0.4 | **1.0** | 纯 outcome 目标，MC returns 不再参与价值损失 |
| placeBonus | 0.05 | **移除** | 由 board_quality 头学习 |
| densePerClear | 2.0 | **移除** | 由 clear_pred 头学习 |
| holePenaltyPerCell | -0.35 | **移除** | 由 board_quality + hole_aux 头学习 |
| heightPenalty | -0.06 | **移除** | 由 board_quality 头学习 |

## 5. game_rules.json 新增/变更 Key

```jsonc
"rlRewardShaping": {
  "boardQualityLossCoef": 0.5,   // 棋盘质量回归系数
  "feasibilityLossCoef": 0.3,    // 可行性二分类系数
  "survivalLossCoef": 0.2,       // 生存预测回归系数
  "outcomeValueMix": {
    "enabled": true,
    "mix": 1.0                   // 纯 outcome（v4 为 0.4）
  }
}
```

环境变量覆盖：
| 变量 | 默认 | 说明 |
|------|------|------|
| `RL_BQ_COEF` | 0.5 | 棋盘质量损失系数 |
| `RL_FEAS_COEF` | 0.3 | 可行性损失系数 |
| `RL_SURV_COEF` | 0.2 | 生存预测损失系数 |
| `RL_OUTCOME_VALUE_MIX` | 1.0 | outcome 混合比例 |

## 6. 10-Batch 收敛验证

```
batch  1: V=0.792  bq=0.0111  feas=0.623  surv=0.035
batch  5: V=0.355  bq=0.0065  feas=0.376  surv=0.037
batch 10: V=0.284  bq=0.0029  feas=0.434  surv=0.008
```

| 指标 | batch 1 → 10 | 下降幅度 | 含义 |
|------|-------------|----------|------|
| `bq` | 0.0111 → 0.0029 | **−74%** | 网络迅速学会评估棋盘结构 |
| `surv` | 0.035 → 0.008 | **−77%** | 迅速学会预测游戏持续时长 |
| `V` | 0.792 → 0.284 | **−64%** | outcome 目标稳定收敛 |
| `feas` | 0.623 → 0.434 | **−30%** | 开始区分安全/危险状态 |

## 7. 与 v4 的兼容性

**v5 模型与 v4 checkpoint 不兼容**（DockBoardAttention 替代了 dock_proj，trunk 输入维度变化）。
`load_state_dict(strict=False)` 会跳过不匹配的权重，但建议从头训练。

## 8. 文件变更清单

| 文件 | 主要变更 |
|------|----------|
| `rl_pytorch/model.py` | `DockBoardAttention` + `board_quality_head` / `feasibility_head` / `survival_head` |
| `rl_pytorch/simulator.py` | `check_feasibility()` + `get_supervision_signals()` + 精简奖励 |
| `rl_pytorch/train.py` | outcome 价值目标 + 三头损失 + 收集监督信号 |
| `rl_backend.py` | 后端训练 API 支持新损失 |
| `web/src/bot/simulator.js` | `boardPotential()` + `checkFeasibility()` + 精简奖励 |
| `web/src/bot/trainer.js` | 采集并发送监督信号 |
| `web/src/bot/pytorchBackend.js` | 转发 `board_quality` / `feasibility` / `steps_to_end` |
| `shared/game_rules.json` | 新增损失系数，移除噪声奖励项 |
