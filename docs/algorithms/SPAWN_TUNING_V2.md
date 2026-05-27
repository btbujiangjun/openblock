# SpawnParamTuner — 出块算法参数寻优器

> **定位**:`L2 · SpawnParamTuner`(出块参数·寻优器)
> **职责**:给 `L1 · SpawnPolicyRules` 拟合 9 维 θ;**不替换**出块决策本身,**不直接产 3 块**
> **不是**:`SpawnPolicyNet`(详见 [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) §3)的前身、后续或替代品;二者层级正交、独立演进
> **总览**:双层架构与角色定义见 [`SPAWN_OVERVIEW.md`](./SPAWN_OVERVIEW.md)

本文档面向算法工程师,描述当前实现的特征、样本、模型、损失、训练、部署、API 与测试。所有内容以代码为准。

---

## 1. 业务目标与核心命题

通过大规模数据采样 + 深度学习模型拟合,自动找到让玩家"接近 PB 但难以超越、偶有惊喜"的算法参数 θ。

### 核心命题(可量化为四条业务约束)

| 命题 | 量化 |
|---|---|
| **接近 PB 时加压** | `D(r ≈ 0.95)` 应显著 > `D(r ≈ 0.5)`,差值 ≥ 0.20 |
| **破 PB 后持续加压** | `D̄(r ≥ 1.0)` ≥ `D̄(r ∈ [0.9, 1.0))`(单调非降 hinge) |
| **甜区破 PB 率** | `P(reach r=1.0) ≈ 18%`(健康区间 10-25%) |
| **偶尔惊喜** | `~7%` 步触发 d_step < 0.30(消行轻松一步) |

其中 `r = score / PB`,`D` 是单步难度 ∈ [0, 1]。

### S 形难度曲线 — `target_S_curve(r)`

```
D(r) = ⎧ D_BASE + k₁·r                       , r ∈ [0, 0.5)   gentle   (线性, k₁=0.2)
       ⎨ D_GENTLE_END + k₂·(r−0.5)            , r ∈ [0.5, 0.7) mid      (线性, k₂=1.0)
       ⎨ D_MID_END + s_brake(r)·(0.92−0.50)   , r ∈ [0.7, 1.1) brake    (重缩放 sigmoid k=6)
       ⎩ D_BRAKE_END + 0.08·(1−e^(−6·(r−1.1))), r ∈ [1.1, 2.0] overshoot(指数趋近 D_CAP)
```

| 常量 | 值 | 含义 |
|---|---|---|
| `D_BASE` | 0.20 | r=0 时业务期望最低难度 |
| `D_GENTLE_END` | 0.30 | r=0.5 |
| `D_MID_END` | 0.50 | r=0.70 |
| `D_BRAKE_END` | 0.92 | r=1.10 |
| `D_CAP` | 1.00 | r→∞ 渐近上界 |
| `BRAKE_SIGMOID_K` | 6.0 | brake 段陡度 |
| `OVERSHOOT_DECAY` | 6.0 | overshoot 段衰减系数 |

跨度 0.80(D=0.20 → 1.00),用于训练 `L_endpoint` 和最终业务验收。

### Calibrated S 曲线 — `target_S_curve_calibrated(r)`

跟 ideal S 同结构,5 个 D 端点平移压窄(bot 数据下实际可达的"折中目标"):

| 常量 | 值 |
|---|---|
| `D_BASE_CAL` | 0.30 |
| `D_GENTLE_END_CAL` | 0.38 |
| `D_MID_END_CAL` | 0.50 |
| `D_BRAKE_END_CAL` | 0.82 |
| `D_CAP_CAL` | 0.92 |

跨度 0.62,用于训练 `L_target_fit`(弱锚)和 `val_calibrated_mae` 指标。

跨语言一致性:`web/src/tuning/v2/targetSCurve.js` 镜像 Python 全部常量,有 7 个 JS 单元测试锁定值。

---

## 2. 系统架构

四层闭环:**采样 → 训练 → 推断 → 部署 → 真实玩家反馈 → 调整**。

```
┌─────────────────────────────────────────────────────────────────┐
│  ① 配置 (web/spawn-tuning-v2-dashboard.html)                    │
│     5 维 ctx chip 加权 + LossWeights + Bot/Generator 选择       │
│                                                                  │
│  ② 样本采集 (samplerV2.js, 浏览器主线程, async)                  │
│     OpenBlockSimulator 跑 N 局 → d_curve 提取 → SQLite          │
│                                                                  │
│  ③ 异步训练 (rl_pytorch/spawn_tuning_v2/train.py)                │
│     job_executor 调度 → ResNet-MLP / Transformer → ckpt + log    │
│                                                                  │
│  ④ 推断 (POST /api/spawn-tuning-v2/models/<id>/predict-curve)    │
│     单点 / 批量 / MC Dropout 不确定性                            │
│                                                                  │
│  ⑤ 部署 (optimize_theta.py → bundle)                             │
│     360 ctx × default θ → PAVA 单调投影 → JSON bundle            │
│     iOS / Android / 小程序 / Web 离线复制                        │
│                                                                  │
│  ⑥ field_metrics 回流 (/api/spawn-tuning-v2/field-metrics/*)     │
│     真实玩家上报 d_curve → aggregate → health alert + scorecard │
└─────────────────────────────────────────────────────────────────┘
```

后端用 Flask Blueprint(`backend/spawn_tuning_v2_backend.py`)+ SQLite(`.cursor-stress-logs/spawn-tuning-v2.sqlite`)+ 独立 `job_executor` 后台线程轮询任务队列。

---

## 3. 建模逻辑闭环

> 这一节是**面向算法工程师的核心认识论**:解释样本如何构造、model 学什么、为什么 sample 在公式上 ≈ ideal target 但**不是循环作弊**、最终如何转化为线上 θ。后续 §4 起进入实施细节。

### 3.1 业务命题量化为 `target_S_curve(r)`

业务命题「**接近 PB 加压、破 PB 持续加压、偶尔惊喜**」**由设计者数学化**为 `target_S_curve(r)` — 4 段分段函数,跨度 [0.20, 1.00]。**这是从设计端定义的 ground truth,不来自数据**。

这条曲线在 **4 个位置同时出现**,保持训练 / 部署目标一致:

| 出现位置 | 角色 |
|---|---|
| **Sampler 主项**(`d_pb_base = target_S_curve(r)`) | sample 的"形态骨架" |
| **Loss `L_shape` target** | model 直接拟合 sample(= ideal ± 偏差) |
| **Loss `L_endpoint` / `L_anchor` 硬约束** | 端点 + 7 关键 r 点强制朝 ideal 收 |
| **最终业务验收** | `预测 vs 目标 MAE`、`实测 vs 目标 MAE` 都用这条 |

### 3.2 样本构造 — 为什么不是循环作弊

虽然 `d_pb_base = target_S_curve`,但 sample 的 `d_curve` **不是简单 = target**。每步 `d_step` 公式:

```
d_step(t) = target_S_curve(r_t)  +  (state_d_t − 0.5) · 0.20
            ─────────┬─────────    ──────────────┬───────────
              形态主项                 ctx + θ 携带的扰动
              (全 ctx 共享)         ── 这才是 model 要学的信号 ──
```

`state_d_t` 是一个**复杂随机量**,由当前棋盘状态和 θ 共同决定:

```
state_d_t = 0.30 · fillRate_t  +  0.40 · (1 − action_freedom_t)  +  0.30 · trend_norm_t
           ┌─────────┴─────────┐ ┌─────────────┴─────────────┐ ┌─────┴─────┐
           棋盘满度              候选 action 数量              填充率趋势

  受 simulator 影响 (θ ∈ {pbTensionCenter, Width, pbBrakeCenter, Width} 改 PB 曲线 → spawn 难度)
  受 generator 影响 (triplet-p1 / budget-p2 / heuristic-rule / generative 不同算法)
  受 bot 影响      (random / clear-greedy / survival / rl-bot 不同决策质量)
```

**关键结论**:同一个 r,不同 (ctx, θ) 下 `state_d_t` 分布不同,所以 sample 的 `d_curve` **携带 ctx/θ 个性化信息**(±0.04 量级)。

| ctx 示例 | 典型 state_d 分布 | state_offset 平均 |
|---|---|---|
| `easy + budget-p2 + clear-greedy + pb=4000 + onboarding` | 0.35-0.55 | −0.02 |
| `hard + triplet-p1 + random + pb=10000 + plateau` | 0.55-0.75 | +0.03 |
| `normal + budget-p2 + survival + pb=1500 + mature` | 0.45-0.65 | +0.005 |

→ sample d_curve = `target_S_curve` **形态骨架** + **(ctx, θ) 携带的偏差信号**。**这才是 model 要学的有效信号**(光形态全 ctx 一样,model 学到平凡解;光偏差没业务意义)。

### 3.3 大样本聚合时实测均值的统计性质

跨 sample 平均(很多 sample × 不同 fillRate/freedom/trend 状态):

```
E[state_d]              ≈ 0.5     (随机棋盘的统计中点)
E[state_offset]         = E[(state_d − 0.5) · 0.20] = 0     ← 期望抵消
E[d_step | r]           = target_S_curve(r) + 0
```

→ **大样本下 d_curve_avg ≈ ideal target**,残留 MAE = `O(σ/√N)` 是大数定律的统计噪声。

实测验证:v2.12 sampler 在 3520 样本聚合后 `实测 vs 目标 MAE = 0.0043`(N=3520,σ ≈ 0.07,理论残余 σ/√N ≈ 0.0012,叠加 bin-level 不均匀 ~ 0.003,跟实测吻合)。

### 3.4 Model 学什么

```
Input  (41 维):  ctx_emb (32 维 = 5 离散 emb + log_pb proj) + θ_norm (9 维)
                  ↓
ResNet-MLP trunk  (8 残差块, hidden 128, GELU, dropout 0.10)
                  ↓
6 Heads (并联):
  head_curve  (主任务) → d_curve (20 维, sigmoid)
  head_pb_broke / head_score / head_noMove / head_survival / head_r (辅助)
```

`head_curve` 学的映射:

```
f(ctx, θ) = target_S_curve(r)  +  Δ(ctx, θ)
            ─────────┬───       ─────┬─────
              主形态              偏差项
            (全 ctx 共享)      (~±0.04, 不同 ctx/θ 不同)
```

**两阶段隐式学习**:
- **早期 epoch**:trunk 把所有 ctx 都映射到一个共同 d_curve ≈ target(主项)
- **后期 epoch**:trunk 学到不同 ctx_emb 输出微差 → 不同 head_curve 输出 → 拟合每个 ctx 的特有偏差

→ Model 不是预测 ideal target 本身,而是 **"该 (ctx, θ) 配置下,bot 跑出来的实际 d_curve"**。

### 3.5 12 项 Loss 都把 model 朝 ideal target 收

| Loss | 拉力方向 | 跟 sample 一致性 |
|---|---|---|
| `L_shape` (主, w=3.0) | model → sample (= ideal ± 偏差) | ✓ 一致 |
| `L_target_fit` (w=0.5) | model → calibrated S(防过激) | 弱 |
| `L_endpoint` (w=4.0) | head/tail → ideal 端点 (0.20, 1.00) | ✓ 一致 |
| `L_anchor` (w=3.0) | 7 r 点 hinge → ideal 范围 | ✓ 一致 |
| `L_monotonic` (w=2.5) | curve 非降 | 与 ideal 同向 |
| 其他 8 项 | 业务正则 / 辅助 head | 不冲突 |

**v2.12 的关键改进**:`L_shape` 拉力(sample)跟 `L_endpoint / L_anchor`(ideal)同方向,**无矛盾**。
v2.11 时代 `L_shape` 拉去 calibrated 形态(中段偏低 0.04-0.10),其他 loss 拉向 ideal,矛盾 → model 折中。

### 3.6 推断与利用 — model 怎么转化为线上 θ

**单 ctx 推断**(d_curve 三线对照 chart):

```
给 (ctx*, default θ) → model.forward → d_curve_pred
对比 d_curve_pred vs ideal target → 看 model 在该 ctx 学得多准
```

**θ 优化**(`optimize_theta.py`):

```
for ctx in 360 stable contexts:
    best_θ = argmin_θ  ‖ model(ctx, θ) − ideal_target ‖
              ↑ 把 model 当做 surrogate, 在 9 维 θ 空间搜索

→ 每个 ctx 找到让 d_curve 最贴 ideal 的 θ*
→ PAVA 单调投影
→ 写入 bundle JSON: 360 行 { context_key: θ* }
```

**客户端运行时**:

```javascript
const ctx   = { difficulty, generator, bot_policy, pb_bin, lifecycle_stage };
const θ     = resolveThetaV2(ctx);                       // 查 bundle
const opts  = derivePbCurve(score, pb, θ);               // θ 真实影响出块
spawnNextBlocks(opts);
```

### 3.7 完整闭环图

```
┌────────────────────────────────────────────────────────────────────────┐
│ 业务命题                                                                 │
│   "接近 PB 加压、破 PB 持续加压、偶尔惊喜"                                │
│   ↓                                                                     │
│ 设计端量化                                                               │
│   target_S_curve(r) = 4 段分段函数, 跨度 [0.20, 1.00]                    │
└────────────────────────────────────────┬───────────────────────────────┘
                                         │ (同一条曲线进入 4 个地方)
        ┌────────────────────┬───────────┴───────────────┬─────────────────┐
        ↓                    ↓                           ↓                 ↓
┌──────────────┐  ┌────────────────────┐  ┌───────────────────────┐  ┌─────────┐
│ Sampler      │  │ L_shape target     │  │ L_endpoint / anchor  │  │ Bundle  │
│ d_step =     │  │ (训练时拟合)        │  │ (硬约束朝 ideal 收)   │  │ 部署验收 │
│  target +    │  │                    │  │                       │  │         │
│  state_off   │  │                    │  │                       │  │         │
└──────┬───────┘  └─────────┬──────────┘  └──────────┬────────────┘  └─────────┘
       ↓                    ↓                        ↓
   Sample 表 ←── ──── ─── 训练 ResNet-MLP ── ─── ── 计算 12 项 loss
       │                    │                        │
       │                    ↓                        │
       │              Model weights  ← ── ── ── ── ──┘
       │                    │
       │ 验证               ↓
       │              推断 + θ 优化器
       ↓                    ↓
   d_curve 分析 ←── ── 预测 d_curve ←── ── ── ────┐
   (三线对照)                                       ↓
                                              360 ctx × best θ
                                                       ↓
                                                   Bundle JSON
                                                       ↓
                                               客户端运行时
                                               (iOS / Android / 小程序 / Web)
                                                       ↓
                                                field_metrics 上报
                                                       ↓
                                                   健康监控
                                                       │
                                                       ↓
                                            (周度回流到样本采集, 重训)
```

### 3.8 关键点速记

1. **Ideal target 在 4 处出现**(sampler 主项 / shape loss / endpoint hinge / 最终验收)→ **统一目标,无歧义**
2. **Sample 不是 = target**,而是 `target + ctx/θ 偏差` → model 仍要学 ctx/θ → d_curve 的映射,**不退化为常数函数**
3. **Model 主要学的是偏差结构** Δ(ctx, θ),而非 S 形本身(S 形已在 sample 主项里给了)
4. **θ 优化器在 model 上做最小化**:对每个 ctx 找让 d_curve 最贴 ideal 的 θ,这才是真正的"寻参"
5. **闭环验证**:bundle 部署后 field_metrics 上报真实玩家 d_curve,跟 ideal 对比看 model + θ 是否在真实数据上也成立

---

## 4. 特征工程

总输入维度 **41 = 32 ctx_emb + 9 θ**。

### 3.1 Context(5 维离散类别 + 1 维数值)

| 字段 | 取值 | N | embedding 维度 |
|---|---|---|---|
| `difficulty` | `easy / normal / hard` | 3 | 4 |
| `generator` | `triplet-p1 / budget-p2 / heuristic-rule / generative` | 4 | 4 |
| `bot_policy` | `random / clear-greedy / survival / rl-bot` | 4 | 4 |
| `pb_bin` | `500 / 1500 / 4000 / 10000 / 25000` | 5 | 8 |
| `lifecycle_stage` | `onboarding / growth / mature / plateau` | 4 | 8 |
| **小计** | **240 unique ctx** | | **28** |

加上 `log_pb = log10(pb_bin)` 通过 `Linear(1→4)` 投影 → **EMB_TOTAL = 32**。

类别索引存于 `feature_io.py::{DIFFICULTY,GENERATOR,BOT,PB_BIN,LIFECYCLE}_INDEX`。

### 3.2 θ(9 维 LHS 抽样空间)

THETA_KEYS 顺序与 `feature_io.THETA_KEYS` 严格对应:

| # | 字段 | (min, max) | default(中点) | 业务作用 |
|---|---|---|---|---|
| 0 | `personalizationStrength` | (0.05, 0.18) | 0.10 | PlayerProfile 信号注入候选权重 |
| 1 | `temperature` | (0.03, 0.08) | 0.05 | 候选选拔随机温度 |
| 2 | `surpriseBudgetGain` | (0.05, 0.10) | 0.07 | 惊喜事件触发增益 |
| 3 | `surpriseCooldown` | (4.0, 10.0) | 6 | 惊喜事件冷却轮数 |
| 4 | `maxEvaluatedTriplets` | (32, 128) | 80 | 三块组合最大评估数(推理预算) |
| 5 | `pbTensionCenter` | (0.70, 0.92) | 0.82 | 张力 sigmoid 拐点 |
| 6 | `pbTensionWidth` | (0.04, 0.15) | 0.08 | 张力斜率宽度(越小越陡) |
| 7 | `pbBrakeCenter` | (0.98, 1.15) | 1.05 | 刹车 sigmoid 拐点 |
| 8 | `pbBrakeWidth` | (0.03, 0.12) | 0.06 | 刹车斜率宽度 |

约束:**任何 θ 必须在 simulator/adaptiveSpawn/spawnExperiments 至少一处真实消费**,装饰性参数禁止入 THETA_KEYS。

归一化:全部 min-max → [0, 1] 由 `normalize_theta()` 完成,反向用 `denormalize_theta()`。

### 3.3 LHS(拉丁超立方)采样

前端 `_lhsThetas(n)`(`dashboardV2.js`)在 9 维 [0,1]^9 空间生成 n 组样本:

1. 每维分 n 段
2. 段中点 + 段内均匀扰动 → 段内一个采样点
3. 每维独立 shuffle → 跨维去相关
4. 反归一化到 θ 真实范围

→ 比纯随机覆盖更均匀,避免 cluster。

---

## 5. 样本采集与标签

### 4.1 采样流程

```
context (5 维, 全笛卡尔积或加权) × θ (LHS, k 组) × seed (m 个)
    ↓
runOneSampleV2(context, theta, seed, maxSteps=500)
    ↓
new OpenBlockSimulator(difficulty, { spawnGenerator, bestScore=pb_bin, modelConfig: {...θ} })
    ↓
for step in [0, maxSteps):
    if sim.isTerminal(): break
    if generator == "generative": await predictShapesV3() 替换 sim.dock 的 shape
    action = _selectAction(sim, bot_policy, rng, { lookahead, lookahead2, mcts })
            或 await selectActionRemote(phiList, stateFeat, ...)  if bot_policy == "rl-bot"
    sim.step(action) → 记录 StepInfo(score, fillRate, actionFreedom, noMove, clears)
    ↓
labels = _extractDCurveFromSteps(steps, pb)
    → d_curve (20D), bin_counts (20D), n_bins_filled,
      final_score, survived_steps, clear_rate, noMove_step, pb_broke, surprise_count
    ↓
POST 批量 (batch=20) → /api/spawn-tuning-v2/sample-sets/<set_id>/samples
```

### 4.2 d_curve 提取(PB-aware + 贝叶斯先验平滑)

**单步难度 `d_step`**(`samplerV2.js::_stepDifficulty` + `extractor.py::step_difficulty` 跨语言一致):

```python
# d_pb_base = ideal target_S_curve (4 段分段 — gentle/mid/brake/overshoot)
# 范围 [D_BASE, D_CAP] = [0.20, 1.00], 跨度 0.80 (= ideal target)
d_pb_base = target_S_curve(ratio)

# 棋盘状态难度 (扰动 ±0.10)
state_d = 0.30 * fillRate + 0.40 * (1 - action_freedom) + 0.30 * trend_norm
state_d = clip(state_d, 0, 1)
if clears >= SURPRISE_MIN_CLEARS: state_d *= SURPRISE_DAMPING   # 惊喜衰减

# 组合: ideal target + state 偏移 (ctx 差异性)
d_step = clip(d_pb_base + (state_d - 0.5) * 0.20, 0, 1)
```

**关键**:`d_pb_base` 直接复用 ideal `target_S_curve`,sample 数据基础 = 训练目标,从源头消除"sample 跟 ideal 形态偏离"。model 学到的 d_curve 直接对齐业务 ideal。

特例:`noMove == True` 时 `d_step = 1.0`(死局视为最高难度)。

**bin 聚合**:把 `r = score / pb` 映射到 20 bin([0, 2.0] 等分),用**贝叶斯先验平滑**(`PB_AWARE_PRIOR_STRENGTH=3`):

```python
for i in range(20):
    r_center = (i + 0.5) * 0.1     # bin 中点
    d_prior = d_pb_base(r_center)
    if bin_counts[i] >= 1:
        obs = bin_sums[i] / bin_counts[i]
        w = bin_counts[i] / (bin_counts[i] + 3)
        d_curve[i] = w * obs + (1 - w) * d_prior     # 加权融合
    else:
        d_curve[i] = d_prior                          # 完全先验
```

→ bin 有 3 个真实观察时 w=0.5,完全压过先验需要 ≥10 个观察。
→ `n_bins_filled` = `sum(bin_counts >= 1)`,反映真实数据覆盖率。

### 4.3 Bot 策略

| 策略 | 实现 | 复杂度/step | 用途 |
|---|---|---|---|
| `random` | 均匀采样 legal action | O(legal) | 基线 |
| `clear-greedy` | 启发式评分 = `clears×100 - fill×2` | O(legal) | 主力 |
| `survival` | 保守评分 = `(clears>0?50:0) - fill×3` | O(legal) | 弱场景 |
| `clear-greedy + lookahead=1` | + survival proxy `(1-fill)×30` | O(legal) | 强 |
| `clear-greedy + lookahead=2` | top-K=5 候选 × 抽样 20 a2 二级评分 | O(K·20) | 最强(非 HTTP) |
| `clear-greedy + mcts` | top-K=10 候选 × 30 rollouts × 30 steps 平均 score 增量 | O(K·R·L) | 实验,慢 ~500x |
| `rl-bot` | HTTP `POST /api/rl/select_action` 用 PyTorch policy | HTTP RT ≥ 30ms | 跨模型对比 |

`lookahead2` 和 `mcts` 用 `sim.saveState()` / `sim.restoreState()`(simulator 原生 API)做状态回溯。

`rl-bot` HTTP 失败 → fallback `clear-greedy`,sampling 不中断。

### 4.4 Generator 算法

| 算法 | 实现 | 速度 |
|---|---|---|
| `triplet-p1` | P1 启发式 — triplet 组合评分 | 快(同步) |
| `budget-p2` | P2 启发式 — 4 类预算约束 | 快(同步) |
| `heuristic-rule` | sim 原生 `SPAWN_POLICY_RULES='baseline'`(底层 default) | 快(同步) |
| `generative` | HTTP `POST /api/spawn-model/v3/predict` 用 `SpawnPolicyNet V3` | 慢 ~10-50x |

`generative` HTTP 失败 → fallback sim 内部 baseline dock,sampling 不中断。

### 4.5 标签字段(8 项)

| 字段 | 类型 | 含义 | 用途 |
|---|---|---|---|
| `d_curve` | `float[20]` | 难度曲线 ∈ [0, 1] | 主标签(`L_shape / L_anchor / ...`) |
| `bin_counts` | `int[20]` | 每 bin 真实观察样本数 | `L_shape` confidence 加权 |
| `n_bins_filled` | `int` | 20 bin 中真实观察数 | UI 透明化 |
| `final_score` | `int` | 局终分数 | 计算 `r = score/pb` 训 `head_r`;`head_score` 用 `log10(final_score)` |
| `survived_steps` | `int` | 局长 | 元数据 |
| `pb_broke` | `bool` | 是否破 PB(`final_score > pb`) | `head_pb_broke`(BCE) |
| `noMove_step` | `int` | 死局步(-1=未死局) | `head_noMove`(MSE,归一化) |
| `clear_rate` | `float` | 消行密度 | 仅 UI 分析,不入 loss |

### 4.6 推荐配置 — `🎯 高质量` Preset

| 配置 | 值 | 目的 |
|---|---|---|
| `thetas` 每场景 | 8 | LHS 覆盖足够广 |
| `seeds` 每 θ | 3 | 多 seed 降噪 |
| `maxSteps` 单局 | 500 | 让强 bot 在高 PB 桶有机会触达 r≥1 |
| `lookahead2` | ✓ | bot score/step +60% |
| `pb_bin` chip | 关闭 10000 / 25000 | 高 PB 桶 bot 几乎打不到,d_curve 几乎全先验填充 |

预期效果:`avg n_bins_filled / 20 ≥ 60%`(对照默认 `prod` preset ~30%),`avg r ≈ 0.75+`。

---

## 6. 模型架构

### 5.1 ResNet-MLP(主模型,L4)

`SpawnParamTunerResNet`,~325K 参数:

```
ContextEmbedding (5 离散 emb concat + log_pb proj) = (B, 32)
    + θ_norm (B, 9)
    = (B, 41) 输入

TrunkIn:  Linear(41 → 128) → LayerNorm → GELU
    ↓
ResBlock × 8:
    x → Linear(128→128) → LN → GELU → Dropout(0.1) → Linear(128→128) → LN → (+x) → GELU
    ↓
TrunkOutLN: LayerNorm(128)
    ↓
6 Heads (并联):
    ├─ head_curve:    Linear(128→128) → GELU → Linear(128→20) → sigmoid     (B, 20)  ★ 主标签
    ├─ head_pb_broke: Linear(128→64)  → GELU → Linear(64→1)   → sigmoid     (B,)
    ├─ head_noMove:   Linear(128→64)  → GELU → Linear(64→1)   → sigmoid     (B,)
    ├─ head_score:    Linear(128→64)  → GELU → Linear(64→1)               (linear, log_score)
    ├─ head_survival: Linear(128→64)  → GELU → Linear(64→1)   → sigmoid     (B,)
    └─ head_r:        Linear(128→64)  → GELU → Linear(64→1)   → 2·sigmoid   (B,) ∈ [0, 2.0]
```

| 默认超参 | 值 |
|---|---|
| `DEFAULT_HIDDEN_DIM` | 128 |
| `DEFAULT_N_BLOCKS` | 8 |
| `DEFAULT_DROPOUT` | 0.10 |
| `DEFAULT_HEAD_HIDDEN` | 64 |

### 5.2 Transformer(备用模型)

`SpawnParamTunerTransformer`,~200K 参数:

```
ContextEmbedding + θ → condition (B, 32+9)
    ↓ Linear(41 → 128)
    ↓ broadcast 到 20 个 bin + pos_embedding (20, 128)
    ↓
TransformerEncoder × 4 (heads=4, ffn=128, dropout=0.10)
    ↓
TrunkOutLN (per-position)
    ↓
6 Heads:
    ├─ head_curve (per-position): Linear(128→1) → sigmoid                 (B, 20)
    └─ mean pooling → 5 个全局 head (pb_broke / noMove / score / survival / r_value)
```

| 默认超参 | 值 |
|---|---|
| `DEFAULT_TRANSFORMER_DIM` | 128 |
| `DEFAULT_TRANSFORMER_LAYERS` | 4 |
| `DEFAULT_TRANSFORMER_HEADS` | 4 |
| `DEFAULT_TRANSFORMER_FFN` | 128 |

Transformer LR 自动上限 `1e-3`(超过会落入退化解,实测)。

### 5.3 Embedding 兼容加载 — `load_state_dict_compat()`

类别数变化(e.g. `N_GENERATOR` 老 ckpt 2 → 现在 4)时,**前 N_OLD 行复制 + 后续行保持当前模型随机初始化**:

```python
for key in ["ctx_emb.emb_diff.weight", "ctx_emb.emb_gen.weight", ...]:
    if old_w.shape[0] < cur_w.shape[0]:
        new_w = cur_w.clone()
        new_w[:old_w.shape[0]] = old_w   # pad 前 N_OLD 行
        compat_sd[key] = new_w
```

被 3 处加载点统一使用:`backend.predict-curve` × 3,`train.py`(增量训练),`optimize_theta.py`(bundle 部署)。

### 5.4 MC Dropout 不确定性

`SpawnParamTunerResNet.predict_with_uncertainty(n_samples=30)`:

1. 让 Dropout 层 `train(True)` 但其他保持 `eval()`
2. 跑 N 次 forward
3. 返回 `{curve_mean, curve_std, r_mean, r_std}`

后端 `/predict-curve` 支持 `body.uncertainty=true`,返回 `curves_std` + `r_std`。UI 在 d_curve chart 画 ±2σ 半透明带。

---

## 7. 损失函数

### 6.1 总 Loss

```python
L_total = α · L_shape          (weighted MSE + confidence)
        + β · L_balance        (PB bin 间方差)
        + γ · L_surprise       (惊喜频率 7%)
        + δ · L_breaking       (破 PB 后单调加压 hinge)
        + ε · L_smooth         (∂D/∂θ 平滑正则)
        + ζ · L_aux            (辅助 4 head BCE/MSE)
        + η · L_pb_distribution (P_reach 业务分布, default w=0)
        + κ · L_anchor         (7 锚点 hinge)
        + μ · L_monotonic      (软单调 hinge)
        + ν · L_target_fit     (calibrated S 形 MSE)
        + ξ · L_endpoint       (ideal 端点 hinge)
        + ω · L_r_value        (multi-task smooth_l1)
```

### 6.2 默认权重 — `LossWeights`

| 符号 | 字段 | 默认 | 说明 |
|---|---|---|---|
| α | `shape` | **3.0** | 主信号 |
| β | `balance` | 0.15 | 跨 PB bin 一致性 |
| γ | `surprise` | 0.3 | |
| δ | `breaking` | 0.5 | |
| ε | `smooth` | 0.04 | |
| ζ | `aux` | 0.2 | |
| η | `pb_distribution` | 0.0 | 默认关(仅 P_reach 看板展示) |
| κ | `anchor` | 3.0 | 关键 r 点强力修正 |
| μ | `monotonic` | 2.5 | |
| ν | `target_fit` | **0.5** | 弱锚 calibrated |
| ξ | `endpoint` | **2.5** | 锚 ideal 端点拉宽跨度 |
| ω | `r_value` | 0.5 | multi-task 辅助 |

### 6.3 各 Loss 详解

#### `L_shape` — 主信号,confidence-weighted MSE

```python
weights = [1, 1, ..., 2(bin7), 3(bin8), 4(bin9), 4(bin10), 3(bin11), 2.5(bin12), 1, 1, 1, 2(bin15), 1, 1, 1, 1]
sq_err = (pred - target) ** 2
weighted = sq_err * weights[None, :]
if bin_counts is not None:
    conf = bin_counts / (bin_counts + 3)    # n / (n + PRIOR_STRENGTH)
    weighted *= conf
    return weighted.sum() / (weights * conf).sum()
return weighted.sum() / (B * weights.sum())
```

设计要点:
- **拐点区加权**:bin 8-12 (`r ∈ [0.85, 1.25]`) 权重 3-4x,强制 model 精确拟合 S 形拐点而非"水平均值"陷阱
- **confidence 加权**:bin 无观察(`bin_counts[i]=0`)→ `conf=0` → 不贡献 loss,**model 不学贝叶斯先验填充的虚假数据**
- bin_counts 缺失时退化为普通 weighted MSE

#### `L_balance` — 跨 PB bin 方差

```python
per_sample_mean = curve.mean(-1)                 # (B,)
bin_means = [per_sample_mean[pb_idx==b].mean() for b in range(N_PB_BIN) if any(pb_idx==b)]
return torch.var(stack(bin_means))
```

避免某档 PB 玩家体验明显异于其他档。**只是弱正则**,权重 0.15。

#### `L_surprise` — 惊喜频率拟合

```python
soft_below = sigmoid((SURPRISE_RATE_THRESHOLD - curve) * 10.0)   # 软阈值, threshold=0.30
observed = soft_below.mean()
return (observed - TARGET_SURPRISE_RATE) ** 2                     # target_rate=0.07
```

#### `L_breaking` — 破 PB 单调加压

```python
pre  = curve[:, low:high].mean(-1)    # r ∈ [0.9, 1.0)
post = curve[:, high:].mean(-1)        # r ≥ 1.0
return ReLU(pre - post).pow(2).mean()  # 应 post ≥ pre
```

hinge 在违规时 gradient 是常数,强力推 model 保持破 PB 后非降。

#### `L_smooth` — ∂D/∂θ 平滑正则

```python
obj = curve.mean(-1).sum()
grad = torch.autograd.grad(obj, theta_norm, create_graph=True)[0]
return grad.pow(2).mean()
```

要求 `theta_norm.requires_grad = True`。让 model 对 θ 微小扰动产生平滑响应,减少锯齿。

#### `L_aux` — 4 辅助 head 联合

```python
L = BCE(pb_broke_pred, pb_broke_target)
  + MSE(noMove_pred, noMove_norm)         # noMove_step / max_survived_steps
  + MSE(score_pred, log10_score)
  + BCE(survival_pred, survival)
return L / 4
```

#### `L_pb_distribution` — P_reach 业务分布(默认权重 0)

用 log-domain 公式避免数值饱和:

```python
log_p_cont = -clamp(curve, 1e-4, 1-1e-4) * 1.6     # PB_DIST_SCALE
log_p_reach = cumsum(log_p_cont, dim=1)
p_reach = exp(log_p_reach)                          # (B, 20)

target = {
    0.50: 0.85,   # 85% 玩家至少 1/2 PB
    0.80: 0.55,
    0.95: 0.30,
    1.00: 0.18,   # ⭐ 18% 破 PB
    1.20: 0.05,
    1.50: 0.01,
}
return MSE(p_reach[bin], target_p) across all r
```

**默认权重 0**(只用 `p_reach_metrics` 在 val 阶段做业务看板,不参与 loss)。

#### `L_anchor` — 7 锚点 hinge ⭐

```python
ANCHOR_CONSTRAINTS = [
    (0.20, "upper", 0.32),   # r=0.20: D ≤ 0.32  (远 PB 必须易)
    (0.30, "upper", 0.38),   # r=0.30: D ≤ 0.38
    (0.50, "upper", 0.48),   # r=0.50: D ≤ 0.48  (中段过渡)
    (0.95, "lower", 0.55),   # r=0.95: D ≥ 0.55  (临近 PB 有挑战)
    (1.00, "lower", 0.65),   # r=1.00: D ≥ 0.65  (破 PB 临界)
    (1.20, "lower", 0.75),   # r=1.20: D ≥ 0.75  (持续加压)
    (1.50, "lower", 0.85),   # r=1.50: D ≥ 0.85
]

for (r, kind, target) in constraints:
    bin = int(r * 10)
    if kind == "upper": violation = ReLU(curve[:, bin] - target)
    else:               violation = ReLU(target - curve[:, bin])
    losses.append(violation.pow(2).mean())
return mean(losses)
```

设计要点:**per-sample 计算 hinge 后再 batch-mean**,避免"batch 内一半超界一半欠界平均后刚好满足 → 丢失 gradient"。

#### `L_monotonic` — 软单调

```python
diff = curve[:, :-1] - curve[:, 1:]    # (B, 19)
violation = ReLU(diff - tol)           # tol=0.02 允许微小倒退
return violation.pow(2).mean()
```

#### `L_target_fit` — Calibrated S 形 MSE

```python
target_cal = target_curve_calibrated_vector()      # (20,) cached per device
return ((curve_pred - target_cal) ** 2).mean()
```

**弱锚**(权重 0.5),防止 model 在样本稀疏区飞走。

#### `L_endpoint` — Ideal 端点锚定

```python
head_mean = curve[:, :2].mean(-1)         # 前 2 bin (r ∈ [0, 0.2])
tail_mean = curve[:, -2:].mean(-1)        # 后 2 bin (r ∈ [1.8, 2.0])
head_viol = ReLU(|head_mean - 0.20| - 0.06)
tail_viol = ReLU(|tail_mean - 1.00| - 0.06)
return (head_viol.pow(2).mean() + tail_viol.pow(2).mean()) / 2
```

锚到 ideal `(D_BASE=0.20, D_CAP=1.00)`,tol ±0.06(严格)+ 权重 4.0(强力)→ **强制 model 端点贴 ideal,不能逃到 calibrated**。配合 sampler PB_AWARE 拉宽 d_step 端点到 [0.22, 0.96],样本本身就在 ideal 附近,loss 拉拢成功率高。

#### `L_r_value` — Multi-task r 预测

```python
return F.smooth_l1_loss(r_pred, r_target)   # r_target = final_score / pb_bin, clamp ≤ 2.0
```

Huber loss(robust to outliers,例如 random bot 偶尔超 PB)。让 model 显式学到"该 ctx 下 bot 实际能触达的 r 上限",推断时可作为 `r > r_pred` 区域不可信的 mask 信号。

---

## 8. 训练管线

### 7.1 入口 — `train.py::train()`

```python
def train(
    db_path: str,
    sample_set_ids: List[int],
    output_path: str,
    *,
    base_model_path: Optional[str] = None,   # 增量训练
    rehearsal_set_ids: Optional[List[int]] = None,
    rehearsal_ratio: float = 0.15,
    epochs: int = 50,
    batch_size: int = 256,
    lr: float = 1e-3,
    weights: Optional[LossWeights] = None,
    device_str: str = "cpu",                  # 后端自动检测 cuda > mps > cpu
    val_ratio: float = 0.1,
    early_stop_patience: int = 15,
    seed: int = 42,
    model_type: str = "resnet",               # "resnet" / "transformer"
    model_kwargs: Optional[Dict] = None,
) -> Dict[str, float]
```

### 7.2 流程

```
1. Dataset 加载  SamplesDataset.from_sqlite(db_path, sample_set_ids)
                 → 加载 11 字段: 5 维 ctx_idx + log_pb (z-score) + theta_norm (min-max)
                                + d_curve + bin_counts + r_value + 4 辅助标签
                 ↓
2. Train/Val 切  90/10 随机切分 (seed=42)
                 ↓
3. 模型构建      build_model(model_type, **arch_kwargs).to(device)
                 增量训练: load_state_dict_compat(model, ckpt) + lr ← lr × 0.1
                 Transformer LR cap = 1e-3
                 ↓
4. 优化器        AdamW(lr, weight_decay=1e-5)
   LR Schedule  LinearLR warmup (lr×0.01 → lr, max(5, epochs//10) epoch)
                + CosineAnnealingLR (lr → 0, 余下 epoch)
                ↓
5. 训练循环      for epoch in epochs:
                     for batch in iter_batches(batch_size, shuffle=True):
                         theta_norm.requires_grad_(True)        # 用于 L_smooth
                         preds = model(**batch)
                         targets = {curve, pb_broke, noMove, score, survival, bin_counts, r_value}
                         breakdown = compute_total_loss(preds, targets, pb_bin_idx, theta_norm, weights)
                         breakdown.total.backward()
                         clip_grad_norm_(5.0)
                         optimizer.step()
                         # 每 4 batch 写一行 JSONL → 前端实时刷新
                     scheduler.step()
                     val_m = _eval_one_epoch()
                     EarlyStop 检查
                 ↓
6. 验证指标      curve_mae, calibrated_mae, curve_var, val_loss_breakdown × 12,
                 p_reach_metrics × 6 (reach_50/80/95/100/120/150)
                 ↓
7. EarlyStop     composite = curve_mae + 0.5×anchor + 0.4×target_fit + 0.6×calibrated_mae
                 退化检测: per-sample curve_var < 0.005 → reject improvement
                 if (composite < best_val) and not degenerate:
                     save best ckpt, patience = 15
                 else: patience -= 1
                 patience == 0 → early stop
                 ↓
8. Save          best ckpt (.pt, 含 model_state_dict + arch + best_metrics) + sidecar .log JSONL
                 → /api/spawn-tuning-v2/models POST 写 models 表
```

### 7.3 关键超参速查

| 参数 | 默认 | 注 |
|---|---|---|
| `epochs` | 50 | 实测大多 ep 10-25 收敛 |
| `batch_size` | 256(CLI)/ 64(UI) | UI default 跟 GPU 兼容 |
| `lr` | 1e-3 / 5e-3 | UI 4 档下拉,Transformer 自动 cap |
| `weight_decay` | 1e-5 | AdamW |
| `warmup_epochs` | `min(5, epochs // 10)` | |
| `early_stop_patience` | 15 | composite metric |
| `grad_clip` | 5.0 | |
| `dropout` | 0.10 | 同时供 MC Dropout 用 |
| `val_ratio` | 0.10 | |

### 7.4 异步训练 — `job_executor.py`

后端独立线程 poll `jobs` 表(状态 = `queued`),fork 子进程跑 `train.py`,期间:

- 进程 PID 写入 `jobs.pid` 供 `delete-job` kill
- `train.py` 写 `.log` JSONL,UI 通过 `GET /api/spawn-tuning-v2/jobs/<id>/metrics` 轮询
- 训练完毕 → 写 `models` 表 → 自动调 `optimize_theta` 生成 bundle
- 失败 → exponential backoff retry 3 次后标 `failed`

### 7.5 训练 13 项可视化指标

UI `📈 训练曲线` 模态分 13 个独立子图,各自纵轴自适应:

| 指标 | 计算 | 健康范围 |
|---|---|---|
| `train_loss` | 每 4 batch 采样 | 单调下降 |
| `val_loss` | 每 epoch | < train_loss + ε |
| `val_curve_mae` | mean(\|pred - target\|) | < 0.05 |
| `val_calibrated_mae` | mean(\|pred - calibrated\|) | < 0.03 |
| `val_curve_var` | std(pred, dim=-1).mean() | > 0.10(防退化) |
| `val_anchor` | 7 hinge 平均 | → 0 |
| `val_monotonic` | 软单调 hinge | → 0 |
| `val_target_fit` | calibrated MSE | < 0.005 |
| `val_endpoint` | ideal 端点 hinge | → 0 |
| `val_pb_distribution` | P_reach MSE(仅展示) | 平稳 |
| `val_balance` | 跨 PB 方差 | → 0 |
| `val_surprise` | 频率 MSE | → 0 |
| `val_breaking` | 破 PB hinge | → 0 |

最佳 epoch 标记用 composite 而非 `val_curve_mae`(避免主指标震荡时被误判)。

---

## 9. 推断与部署

### 8.1 单次推断 API

`POST /api/spawn-tuning-v2/models/<model_id>/predict-curve`:

```json
{
  "contexts": [
    { "difficulty": "normal", "generator": "budget-p2", "bot_policy": "clear-greedy",
      "pb_bin": 4000, "lifecycle_stage": "mature" }
  ],
  "theta_norm": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],   // 缺省 = 中点
  "uncertainty": false,                                            // true 开 MC Dropout
  "n_mc_samples": 30
}
```

响应:

```json
{
  "model_id": 28,
  "n_contexts": 1,
  "curves": [[0.2, 0.25, ..., 0.92]],          // (B, 20)
  "curves_std": [[0.001, ...]],                 // 仅 uncertainty=true
  "r_pred": [0.51],                             // head_r 输出
  "r_std": [0.003]                              // 仅 uncertainty=true
}
```

### 8.2 Bundle 生成 — `optimize_theta.py::build_bundle()`

部署时枚举 360 个稳定 ctx(`DEPLOYABLE_GENERATORS × DEPLOYABLE_BOTS × 全 difficulty × 全 pb_bin × 全 lifecycle = 3 × 2 × 3 × 5 × 4 = 360`),用 `default theta` 推断:

```python
for ctx in enumerate_all_contexts():            # 360 ctx (稳定子集)
    curve = model(ctx, default_theta).cpu().numpy()
    curve = pava_monotonic_projection(curve)    # PAVA 强制单调非降
    bundle.append({ "context_key": "easy:triplet-p1:clear-greedy:500:mature",
                    "d_curve": curve.tolist(),
                    "theta": default_theta_dict })

save_json(bundle, "web/public/spawn-tuning-bundles/<sha256>.json")
```

**`DEPLOYABLE_*` 子集**仅含真实可部署的算法(`triplet-p1 / budget-p2` + `random / clear-greedy / survival`),占位类别(`heuristic-rule / generative / rl-bot`)训练时用但不参与 bundle,保持 360 ctx 跨版本兼容。

### 8.3 PAVA 单调投影

Pool Adjacent Violators 算法:

```python
def pava_monotonic(curve):
    blocks = [(v, 1) for v in curve]   # (mean, count)
    i = 1
    while i < len(blocks):
        if blocks[i][0] < blocks[i-1][0]:    # 倒退
            # merge
            merged_mean = (blocks[i-1][0] * blocks[i-1][1] + blocks[i][0] * blocks[i][1]) / (blocks[i-1][1] + blocks[i][1])
            blocks[i-1] = (merged_mean, blocks[i-1][1] + blocks[i][1])
            blocks.pop(i)
            i = max(1, i - 1)              # 回退检查
        else:
            i += 1
    return expand_blocks(blocks)
```

→ 输出严格单调非降 d_curve,部署给 game 后无需运行时单调约束。

### 8.4 客户端 Bundle 消费

`web/src/tuning/v2/clientPolicyV2.js::resolveThetaV2(ctx)`:

1. 启动时 fetch `/public/spawn-tuning-bundles/<sha256>.json`(或本地文件)
2. 把 360 ctx 索引到 hashmap `{context_key: theta}`
3. 运行时 `resolveThetaV2(currentCtx)` → 查 default θ
4. 找不到 ctx → 返回 `DEFAULT_THETA_FALLBACK`

在 `adaptiveSpawn.js::derivePbCurve()` 内,用 `resolveThetaV2(ctx).pbTensionCenter` 等覆盖默认值。

---

## 10. 数据库 Schema

`schemas/spawn_tuning_v2.sql` 4 张主表 + 1 张外挂表:

### `sample_sets` — 样本集元数据

```sql
CREATE TABLE sample_sets (
    set_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT,
    sample_count    INTEGER DEFAULT 0,    -- denormalized 计数, 入库时 +N
    created_at      INTEGER NOT NULL,
    archived_at     INTEGER
);
```

### `samples` — 单样本

```sql
CREATE TABLE samples (
    sample_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id          INTEGER REFERENCES sample_sets ON DELETE CASCADE,
    -- Context 5 维
    difficulty      TEXT CHECK IN ('easy', 'normal', 'hard'),
    generator       TEXT CHECK IN ('triplet-p1', 'budget-p2', 'heuristic-rule', 'generative'),
    bot_policy      TEXT CHECK IN ('random', 'clear-greedy', 'survival', 'rl-bot'),
    pb_bin          INTEGER CHECK IN (500, 1500, 4000, 10000, 25000),
    lifecycle_stage TEXT CHECK IN ('onboarding', 'growth', 'mature', 'plateau'),
    -- 9 维 θ
    theta_json      TEXT NOT NULL,
    -- 8 项标签
    d_curve_json    TEXT NOT NULL,
    final_score     INTEGER,
    survived_steps  INTEGER,
    clear_rate      REAL,
    noMove_step     INTEGER,
    pb_broke        INTEGER DEFAULT 0,
    surprise_count  INTEGER DEFAULT 0,
    n_bins_filled   INTEGER,
    bin_counts_json TEXT,
    -- 元
    seed            INTEGER,
    eval_ms         INTEGER,
    evaluated_at    INTEGER,
    algo_version    TEXT DEFAULT 'v2.10'      -- 区分 d_step 算法版本
);
CREATE INDEX idx_samples_set ON samples(set_id);
CREATE INDEX idx_samples_ctx ON samples(difficulty, generator, bot_policy, pb_bin, lifecycle_stage);
CREATE INDEX idx_samples_pb_broke ON samples(pb_broke);
```

### `models` — 模型注册表

```sql
CREATE TABLE models (
    model_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    version         TEXT DEFAULT 'v0.0.1',
    model_type      TEXT CHECK IN ('linear', 'gbdt', 'mlp', 'resnet', 'transformer'),
    weights_path    TEXT,
    weights_sha256  TEXT,
    size_bytes      INTEGER,
    metrics_json    TEXT,                  -- val_curve_mae / best_epoch / loss_breakdown ...
    status          TEXT CHECK IN ('training', 'completed', 'failed', 'deployed', 'archived'),
    created_at      INTEGER,
    deployed_at     INTEGER,
    job_id          INTEGER REFERENCES jobs(job_id)
);
```

### `jobs` — 异步训练任务

```sql
CREATE TABLE jobs (
    job_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT,
    job_type        TEXT DEFAULT 'train',
    config_json     TEXT NOT NULL,         -- {sample_set_ids, epochs, lr, weights, ...}
    status          TEXT CHECK IN ('queued', 'running', 'completed', 'failed', 'cancelled'),
    pid             INTEGER,               -- 子进程 PID, 供 kill
    progress_pct    INTEGER DEFAULT 0,
    error_message   TEXT,
    queued_at       INTEGER,
    started_at      INTEGER,
    finished_at     INTEGER
);
```

### `field_metrics` — 真实玩家上报(外挂表,启动时 DDL 创建)

```sql
CREATE TABLE field_metrics (
    metric_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    context_key     TEXT NOT NULL,
    pb              INTEGER NOT NULL,
    model_id        INTEGER,
    theta_hash      TEXT,
    d_curve_json    TEXT NOT NULL,
    final_score     INTEGER,
    survived_steps  INTEGER,
    clear_rate      REAL,
    noMove_step     INTEGER,
    pb_broke        INTEGER DEFAULT 0,
    surprise_count  INTEGER DEFAULT 0,
    client_ts       INTEGER NOT NULL,
    received_at     INTEGER NOT NULL
);
CREATE INDEX idx_field_metrics_ctx ON field_metrics(context_key, received_at DESC);
CREATE INDEX idx_field_metrics_model ON field_metrics(model_id, received_at DESC);
```

### 启动自动 schema migration

`ensure_schema()` 启动时:

1. 跑 `schemas/spawn_tuning_v2.sql`(`CREATE TABLE IF NOT EXISTS`)
2. 检测 `samples` 表是否缺少列 → 自动 ALTER `n_bins_filled` / `bin_counts_json`
3. 检测 CHECK 约束是否包含 `heuristic-rule / generative / rl-bot` → 不含则**重建表**(snapshot → DROP → schema.sql 重跑 → 数据回填)

---

## 11. HTTP API 端点

`backend/spawn_tuning_v2_backend.py::register_v2_routes(app)` 全部路由,prefix `/api/spawn-tuning-v2/`:

### 样本集

| Method | Path | 功能 |
|---|---|---|
| GET | `/sample-sets` | 列表(分页) |
| POST | `/sample-sets` | 创建 |
| GET | `/sample-sets/<id>` | 详情 |
| DELETE | `/sample-sets/<id>` | 软删除(置 `archived_at`) |
| POST | `/sample-sets/<id>/samples` | 批量入库(本文档 §4.1 流程终点) |
| GET | `/sample-sets/<id>/preview` | 5 维 chip 筛选 + 标签摘要 + 原型样本 |
| GET | `/sample-sets/<id>/aggregate` | 按 `group_by` 聚合 d_curve |
| GET | `/sample-sets/<id>/download` | 流式 JSONL/JSON gzip 下载 |
| GET | `/sample-sets/<id>/quality` | 数据质量分析(r 分布 / bot 性能 / 警告) |

### 模型

| Method | Path | 功能 |
|---|---|---|
| GET | `/models` | 列表(分页 + status 过滤) |
| GET | `/models/<id>` | 详情 |
| DELETE | `/models/<id>` | 删除(含 weights 文件 + bundle) |
| POST | `/models/<id>/predict-curve` | 单次/批量推断 + 可选 MC Dropout |
| POST | `/models/<id>/build-and-export` | 一键生成 bundle |
| POST | `/models/<id>/deploy` | 切到 `status='deployed'`, 旧 deployed 归档 |
| POST | `/models/<id>/rollback` | 回退到默认 θ bundle |

### 任务

| Method | Path | 功能 |
|---|---|---|
| GET | `/jobs` | 列表(分页) |
| POST | `/jobs` | 提交训练 |
| DELETE | `/jobs/<id>` | 删除(含 SIGTERM kill 子进程) |
| GET | `/jobs/<id>/metrics` | JSONL 日志 + 当前 metrics |

### 工具

| Method | Path | 功能 |
|---|---|---|
| GET | `/target-curve` | 返回 ideal target 20D 向量(用于 chart) |
| POST | `/field-metrics` | 真实玩家上报 |
| GET | `/field-metrics/aggregate` | 健康度看板(curve_mae / pb_break_rate / noMove_rate) |
| GET | `/field-metrics/biz-scorecard` | 业务命题量化评分(balance / delight / fairness / surprise) |
| POST | `/validate-e2e` | bundle 跟 sample set 平均 d_curve 一致性校验 |

---

## 12. 测试矩阵

合计 **388 测试**(295 Python + 93 JS),`tests/spawn_tuning_v2/` + `tests/tuning/v2/`:

| 测试文件 | 覆盖 | 测试数 |
|---|---|---|
| `test_target_curve.py` | ideal + calibrated 4 段曲线 + 跨语言常数 | 15 |
| `test_extractor.py` | d_step 公式 + bin 聚合 + Bayesian prior 平滑 | 23 |
| `test_feature_io.py` | SamplesDataset 加载 + 归一化 + bin_counts | 11 |
| `test_model.py` | ResNet + Transformer forward + head_r + MC Dropout + load_state_dict_compat | 33 |
| `test_losses.py` | 12 项 loss 单元 + confidence-weighted + 7 anchor | 52 |
| `test_cross_lang.py` | Python ↔ JS 数值一致(target 曲线 / stepDifficulty) | 10 |
| `test_cross_lang_dcurve.py` | d_curve 提取跨语言一致 | 8 |
| `test_earlystop_composite.py` | composite 计算 + 退化检测 | 6 |
| `test_job_executor.py` | 任务调度 + kill + retry + DB locking | 20 |
| `test_optimize_theta.py` | 360 ctx 枚举 + PAVA + bundle | 9 |
| `test_backend_api.py` | 全部 v2 路由 + schema migration + 分页 | 85 |
| `test_policy_utils.py` | 部署/回退状态机 | 14 |
| `test_validate_e2e.py` | bundle vs sample 一致性 | 8 |
| `tests/tuning/v2/targetSCurve.test.js` | JS target/calibrated 一致 | 25 |
| `tests/tuning/v2/samplerV2.test.js` | sampler + bot 策略 + generative/rl-bot fallback | 24 |
| `tests/tuning/v2/clientPolicyV2.test.js` | bundle fetch + 默认 fallback | 21 |
| `tests/tuning/v2/dCurveChart.test.js` | chart 渲染 + hover + legend toggle | 23 |

---

## 13. 关键设计决策

### 12.1 d_curve(20D)而非 θ 作为标签

**原因**:
- θ 是因,d_curve 是果。直接学 θ 会陷入"什么 θ 好"的循环推理
- d_curve 是业务可量化的目标(S 形 + 关键 r 点),loss 可以直接对齐业务命题
- model 推断时给 ctx 输出 d_curve,反向用 `optimize_theta` 通过 surrogate 找最优 θ

### 12.2 PB-aware d_step + Bayesian Prior

- 老 v2.9 公式 `d_step = state_d` 跟 r 无关,d_curve 平坦,model 无法学到 S 形
- PB-aware d_step 显式编码"接近 PB 加压"
- bot 弱时高 r bin 几乎无数据,纯实测会导致 d_curve 末段断裂或"卡在最后观察值"
- 贝叶斯先验填充用 `_pb_aware_d_pb_base` S 形数学公式作为软先验,**w = n/(n+3)** 让先验在数据稀疏时主导
- `bin_counts` 同时进入训练:`L_shape` 用 `conf = n/(n+3)` 加权,**model 不学先验填充的虚假数据**

### 12.3 Endpoint 锚到 ideal,target_fit 锚到 calibrated

- `target_fit` 用 calibrated(跨度 0.62)作为弱锚 — bot 数据下可达
- `endpoint` 用 ideal(跨度 0.80)做硬端点约束,强制 model 端点向 ideal 拉宽
- 配合 `shape=3.0 / target_fit=0.5 / endpoint=2.5` 权重比,让 model 跨度落在 0.75+ 而非塌缩到 calibrated

### 12.4 异步训练 vs 在线训练

- 离线训练每次跑 30K-100K 样本 50 epoch,~5-30 min(CPU/MPS)
- 在线 RL 类训练样本效率低且不稳定
- 异步训练 + bundle 部署可控,失败回滚清晰
- 真实玩家 d_curve 通过 `field_metrics` 周度回流,作为下一轮训练数据

### 12.5 Bundle 部署 vs 服务端推断

- 移动端无网络场景需要离线 θ
- 360 个稳定 ctx 的 `(ctx_key, θ_default)` 映射 = 几 KB JSON,跟二进制一起发布
- 服务端推断也保留(`/predict-curve`),作为 Web 端测试/调试通道

### 12.6 360 ctx vs 240/960

- 实际数据库 CHECK 允许 4 × 4 = 16 generator × bot,但**部署枚举只用 2 × 3 = 6**(`DEPLOYABLE_GENERATORS / DEPLOYABLE_BOTS`)
- 占位类别(`heuristic-rule / generative / rl-bot`)训练时学,但不入 bundle,保持 360 ctx 跨版本兼容
- 360 = 3 难度 × 2 generator × 3 bot × 5 PB × 4 lifecycle

---

## 附录 A:代码索引

| 文件 | 内容 |
|---|---|
| `rl_pytorch/spawn_tuning_v2/target_curve.py` | ideal + calibrated S 曲线数学定义 |
| `rl_pytorch/spawn_tuning_v2/extractor.py` | d_curve 提取(d_step + bin 聚合 + 贝叶斯先验) |
| `rl_pytorch/spawn_tuning_v2/feature_io.py` | THETA_KEYS / INDEX 表 / `SamplesDataset` / `normalize_theta` |
| `rl_pytorch/spawn_tuning_v2/model.py` | ResNet + Transformer + `load_state_dict_compat` + `predict_with_uncertainty` |
| `rl_pytorch/spawn_tuning_v2/losses.py` | 12 项 loss + `LossWeights` + `compute_total_loss` |
| `rl_pytorch/spawn_tuning_v2/train.py` | 训练入口 + composite EarlyStop + LR 调度 |
| `rl_pytorch/spawn_tuning_v2/job_executor.py` | 异步任务调度 |
| `rl_pytorch/spawn_tuning_v2/optimize_theta.py` | bundle 生成 + PAVA + 360 ctx 枚举 |
| `rl_pytorch/spawn_tuning_v2/validate_e2e.py` | bundle vs sample 一致性校验 |
| `backend/spawn_tuning_v2_backend.py` | Flask Blueprint + 全部 HTTP 路由 + schema migration |
| `schemas/spawn_tuning_v2.sql` | 4 张主表 schema |
| `web/spawn-tuning-v2-dashboard.html` | UI 主页面(5 tab) |
| `web/src/tuning/v2/dashboardV2.js` | UI 逻辑 + LHS + chip 加权 + chart 渲染 |
| `web/src/tuning/v2/samplerV2.js` | 浏览器端 sampler + d_curve 提取(跨语言镜像 extractor.py)|
| `web/src/tuning/v2/targetSCurve.js` | ideal + calibrated S 曲线 JS 镜像 |
| `web/src/tuning/v2/dCurveChart.js` | Canvas chart(legend toggle / hover / ±2σ 带) |
| `web/src/tuning/v2/clientPolicyV2.js` | 客户端 bundle 加载 + `resolveThetaV2` |

---

## 附录 B:关键常量速查

### Target Curve(`target_curve.py` / `targetSCurve.js`)

```
CURVE_N_BINS    = 20
CURVE_R_MAX     = 2.0
SEG_GENTLE_END  = 0.5
SEG_MID_END     = 0.70
SEG_BRAKE_END   = 1.10
BRAKE_SIGMOID_K = 6.0
OVERSHOOT_DECAY = 6.0

# Ideal (业务期望)                # Calibrated (训练 target)
D_BASE         = 0.20             D_BASE_CAL         = 0.30
D_GENTLE_END   = 0.30             D_GENTLE_END_CAL   = 0.38
D_MID_END      = 0.50             D_MID_END_CAL      = 0.50
D_BRAKE_END    = 0.92             D_BRAKE_END_CAL    = 0.82
D_CAP          = 1.00             D_CAP_CAL          = 0.92
跨度 0.80                         跨度 0.62
```

### PB-aware d_step(`extractor.py` / `samplerV2.js` / `policyMetricsV2.js` 三处镜像)

```
d_pb_base(r)  = target_S_curve(r)    # 直接复用 ideal 4 段分段, 跨度 0.80
PB_AWARE_D_BASE       = 0.20         # = D_BASE (ideal) [legacy 镜像常量]
PB_AWARE_D_PEAK       = 1.00         # = D_CAP (ideal)  [legacy 镜像常量]
PB_AWARE_CENTER       = 0.85         # legacy 单段 sigmoid 拐点 (不参与计算, 仅文档)
PB_AWARE_WIDTH        = 0.18         # legacy
PB_AWARE_STATE_WEIGHT = 0.20         # state_d 偏移幅度 (±0.10), 提供 ctx 差异
PB_AWARE_PRIOR_STRENGTH = 3          # n/(n+3) 加权融合
```

sample 数据基础 = ideal `target_S_curve`,加上 state_offset(±0.10)给 ctx 差异性。
**model 学到的 d_curve 直接对齐业务 ideal**,无需 calibrated 中间目标。

### Loss 业务常量(`losses.py`)

```
TARGET_SURPRISE_RATE     = 0.07
SURPRISE_RATE_THRESHOLD  = 0.30
BREAKING_R_LOW           = 0.9
BREAKING_R_HIGH          = 1.0
PB_DIST_SCALE            = 1.6

ANCHOR_CONSTRAINTS = [
    (0.20, "upper", 0.32), (0.30, "upper", 0.38), (0.50, "upper", 0.48),
    (0.95, "lower", 0.55), (1.00, "lower", 0.65), (1.20, "lower", 0.75), (1.50, "lower", 0.85),
]
TARGET_REACH_PROBABILITIES = {
    0.50: 0.85, 0.80: 0.55, 0.95: 0.30, 1.00: 0.18, 1.20: 0.05, 1.50: 0.01,
}
```

### Shape Bin 权重(`_get_shape_bin_weights`)

```
overrides = { 7: 2.0, 8: 3.0, 9: 4.0, 10: 4.0, 11: 3.0, 12: 2.5, 15: 2.0 }   # 其他 bin = 1.0
```

### LossWeights 默认值

```
shape:           3.0           target_fit:      0.5
balance:         0.15          endpoint:        4.0   (锚 ideal, tol ±0.06)
surprise:        0.3           r_value:         0.5
breaking:        0.5           anchor:          3.0
smooth:          0.04          monotonic:       2.5
aux:             0.2           pb_distribution: 0.0  (默认关)
```

### 训练默认超参

```
epochs              = 50
batch_size          = 256 (CLI) / 64 (UI)
lr                  = 1e-3 / 5e-3   (Transformer 自动 cap 1e-3)
weight_decay        = 1e-5
warmup_epochs       = min(5, epochs // 10)
early_stop_patience = 15
grad_clip           = 5.0
dropout             = 0.10
val_ratio           = 0.10
```

