# 浏览器端 RL 优化 v3

> 版本: v3.1 | 更新: 2026-05-02

## 1. 问题诊断

### 1.1 原始现象

浏览器端 RL 机器人（非 PyTorch 后端）在 `normal` 策略下训练，得分在 **~150** 附近饱和，无法继续提升。

### 1.2 根因分析

| # | 问题 | 量化 | 影响 |
|---|------|------|------|
| 1 | **REINFORCE 高方差** | MC 回报 γ=0.99，无标准化 | 梯度噪声极大，学习不稳定 |
| 2 | **无熵正则** | v3.0 仅记录 H，未写入策略梯度 | v3.1 起 `entropyCoef·∇_W H` 与 REINFORCE 同尺度叠加 |
| 3 | **温度衰减过快** | `max(0.4, 1-0.002e)` → 300 局到底 | 探索不足 |
| 4 | **无梯度裁剪** | 权重更新无上界 | 异常大回报导致权重爆炸 |
| 5 | **特征冗余** | 第 0 维与第 22 维都是 `filled/area` | 浪费一个特征维度 |
| 6 | **无课程学习** | `WIN_SCORE_THRESHOLD` 固定 220 | 前期奖励稀疏，难以跨越 150→220 |
| 7 | **右侧看板断联** | 浏览器训练不写 `training.jsonl` | 无法分析训练曲线与趋势 |

## 2. MLP 尝试与失败教训

### 2.1 尝试

首次优化将线性模型（336 参数）替换为 2 层 MLP（~15K 参数）：

```
φ(s,a) [193] → Dense(64) → ReLU → Dense(32) → ReLU → logit
ψ(s)   [181] → Dense(48) → ReLU → Dense(16) → ReLU → V
```

### 2.2 失败原因

MLP 在实验中得分仅 **~80**，远低于线性模型的 150。根本原因：

| 维度 | 线性模型 | MLP |
|------|---------|-----|
| **梯度传递** | `∂logit/∂W = φ`（直达，无衰减） | `∂logit/∂W₁ = φ · relu'₁ · W₂ · relu'₂ · W₃`（链式衰减 ~250×） |
| **有效学习率** | policyLr = 0.02 直接作用 | policyLr × ~0.015 ≈ 0.0003 |
| **数据效率** | 单局 REINFORCE 可行 | 需要经验回放 + mini-batch |
| **收敛到 150** | ~300 局 | 数万局仍不收敛 |

**核心矛盾**：REINFORCE 是单样本蒙特卡洛（inherently high variance），线性模型因梯度=特征本身，能高效利用每条轨迹信号；MLP 的链式法则让梯度衰减至噪声水平。

### 2.3 额外踩坑

MLP 实现中还遇到了两个严重的手写反向传播 bug：

1. **多动作循环更新**（v1 bug）：`computePolicyGradients` 对所有合法动作循环调 `_backpropPolicyOnce`，但每次调用**直接修改权重**——第 k+1 个动作的前向传播看到的是被第 k 个动作更新过的权重，梯度完全被污染。

2. **权重更新顺序**（v2 bug）：修复为 chosen-only 后，`_backpropPolicy` 中仍然**先更新外层权重，再用已修改的权重计算内层 δ**：
   ```
   this.pOut.W[j] += w * a2[j];          // ← 先改了权重
   dA2[j] = w * this.pOut.W[j];          // ← 用已污染的权重算梯度！
   ```

### 2.4 结论

> 在浏览器 REINFORCE 单局在线更新场景下，**线性模型是唯一可靠架构**。MLP 需要经验回放 + mini-batch + Adam 优化器等基础设施，不适合当前浏览器场景。

## 3. 最终方案：线性模型 + 训练改进

### 3.1 架构（保持线性）

```
策略：logit = W · φ(s,a)     W ∈ ℝ¹⁹³     (193 参数)
价值：V(s)  = Vw · ψ(s)      Vw ∈ ℝ¹⁸¹    (181 参数)
                                            合计 374 参数
```

维度由 `web/src/bot/features.js` 的 `PHI_DIM` 与 `STATE_FEATURE_DIM` 读取；若 `shared/game_rules.json` 的 `featureEncoding` 变化，旧浏览器线性权重会被判定为不兼容并重新初始化。

### 3.2 训练算法改进

| 改进项 | v1（原始） | v3.1（当前） |
|--------|-----------|-----------|
| 回报标准化 | 无 | Welford 在线估计均值/方差，标准化 G_t |
| 优势标准化 | 无 | 批内 `(A - mean) / std` |
| 梯度裁剪 | 无 | 优势/价值 delta 钳制在 `±maxGradNorm`（默认 5） |
| 熵正则 | 无 | **策略更新**：`ΔW ∝ A·∇logπ + β·∇_W H`，β=`entropyCoef`（默认 0.012，**0=关闭**） |
| 温度衰减 | `max(0.4, 1-0.002e)` → 300 局 | 由 `shared/game_rules.json` → **`browserRlTraining.temperature*`**（本地默认约 400 局触底） |
| 学习率 / γ | policy 0.02, value 0.05, γ=0.99 | **同上为默认**，均可 JSON 覆盖 |
| 课程学习 | 无 | `rlCurriculum`：`winThresholdStart` → `winThresholdEnd`，`rampEpisodes`（非 stages） |

### 3.3 特征修复

`features.js` 第 22 维从冗余的 `filled/area` 改为 **列高度标准差**（`heightStd`）——衡量盘面平整度，对出块评估有信息量。

### 3.4 右侧看板联通

原先只有 PyTorch 后端的 `training.jsonl` 能出曲线。现在浏览器训练也写入看板：

```
trainer.js
  └─ reinforceUpdate() 返回 { lossPolicy, lossValue, entropy, stepCount }
      └─ onEpisode() 写入 browserTrainingLog（localStorage 环形缓冲，最多 3000 条）
          └─ rlPanel.js → refreshTrainingCharts() 从 localStorage 读取
              └─ rlTrainingCharts.js 绘制曲线（与 PyTorch 后端共用同一套渲染逻辑）
```

指标定义（与 PyTorch 后端对齐）：

| 字段 | 含义 |
|------|------|
| `loss_policy` | `-log π(a\|s) · A` 的批均（标准化后的策略 surrogate loss） |
| `loss_value` | `(G_norm - V(s))²` 的批均（价值误差） |
| `entropy` | `H(π) = -Σ π_k log π_k` 的批均 |
| `step_count` | 本局轨迹长度 |
| `score` / `won` | 对局得分与是否达到胜利阈值 |

## 4. 改动文件

| 文件 | 改动 |
|------|------|
| `web/src/bot/linearAgent.js` | 恢复线性架构（W·φ + Vw·ψ，336 参数）；兼容旧 MLP 存档（遇到则重新初始化） |
| `web/src/bot/trainer.js` | 回报/优势标准化、熵梯度、`resolveBrowserRlTrainingConfig()`、温度日程、`reinforceUpdate` 返回训练指标 |
| `shared/game_rules.json` → `browserRlTraining` | γ、学习率、熵系数、裁剪阈值、本地/后端温度衰减 |
| `web/src/bot/features.js` | 第 22 维 `filled/area` → `heightStd` |
| `web/src/bot/browserTrainingLog.js` | **新增** — localStorage 环形缓冲，存储浏览器训练的 `train_episode` 记录 |
| `web/src/bot/rlPanel.js` | `onEpisode` 写入浏览器日志；`refreshTrainingCharts` 区分 PyTorch/浏览器数据源；训练中自动轮询 |
| `web/src/bot/rlTrainingCharts.js` | 空数据提示更新 |
| `web/index.html` | 看板提示文案更新（说明两种数据源） |

## 5. 超参数速查

**首选改 JSON**：`shared/game_rules.json` → **`browserRlTraining`**（`miniprogram/core/game_rules.json` 与之对齐）。实现读取：`web/src/bot/trainer.js` 中 `resolveBrowserRlTrainingConfig()`。

| 参数 | 默认值（JSON 可覆盖） | 字段 |
|------|---------------------|------|
| 策略 | logit = W·φ, W ∈ ℝ¹⁹³ | `linearAgent.js` |
| 价值 | V = Vw·ψ, Vw ∈ ℝ¹⁸¹ | `linearAgent.js` |
| γ (折扣) | 0.99 | `browserRlTraining.gamma` |
| policyLr | 0.02 | `browserRlTraining.policyLr` |
| valueLr | 0.05 | `browserRlTraining.valueLr` |
| entropyCoef β | 0.012 | `browserRlTraining.entropyCoef`（**0** = 纯 REINFORCE） |
| 本地温度 | max(min, start − e·decay) | `temperatureLocal.{start,min,decayPerEpisode}` |
| 后端采样温度 | 同上，按服务端全局局数 | `temperatureBackend.{start,min,decayPerGlobalEpisode}` |
| 梯度裁剪 | ±5.0 | `browserRlTraining.maxGradNorm` |
| 回报标准化 | Welford 在线算法（n≥20 后生效） | `trainer.js`（逻辑未 JSON 化） |

熵梯度公式：`∂H/∂logit_k = −π_k(log π_k + H)`，`∇_W H = Σ_k (∂H/∂logit_k) φ_k`。

## 6. 预期效果

| 指标 | v1（原始线性） | v3（线性+训练改进） |
|------|-------------|-----------------|
| 得分 | ~150 饱和 | 150+ 更稳定，有望 170~200 |
| 训练稳定性 | 波动大，偶尔权重爆炸 | 更平滑（标准化 + 裁剪） |
| 看板 | 仅 PyTorch 后端有曲线 | **浏览器训练也出曲线** |
| 探索/利用 | 300 局后过早收敛 | 400 局温度到底，过渡更平缓 |

## 7. 后续方向

1. **经验回放 + mini-batch**：缓存高分局轨迹，累积后统一更新——这是 MLP 能在浏览器发挥的前提
2. **前瞻模拟特征**：加入 1-ply search（放块后的空洞/近满变化），类似棋类引擎的评估
3. **PPO 替代 REINFORCE**：clip ratio 约束更新步长，与经验回放配合可支撑更大网络
4. **PyTorch 后端蒸馏**：用 PyTorch 训练的大网络作为教师，蒸馏到浏览器小模型
5. **WebGL/WASM 加速**：如引入 MLP，可用 WebGL 或 WASM SIMD 加速矩阵运算
