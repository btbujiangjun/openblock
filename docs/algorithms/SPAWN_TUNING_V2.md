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

跨度 0.90(D=0.10 → 1.00)是**唯一** target — `L_target_fit` / `L_endpoint` / `L_anchor` 三股 loss 全部拉向它,`val_ideal_mae` 作为业务核心验收指标。

跨语言一致性:`web/src/tuning/v2/targetSCurve.js` 镜像 Python 全部常量,有 JS 单元测试锁定值。

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

业务命题「**低分阶段低平台、接近 PB 前后快速加压、破 PB 持续加压、偶尔惊喜**」**由设计者数学化**为 `target_S_curve(r)` — 4 段分段函数,跨度 [0.10, 1.00]。**这是从设计端定义的 ground truth,不来自数据**。

这条曲线在 **4 个位置同时出现**,保持训练 / 部署目标一致:

| 出现位置 | 角色 |
|---|---|
| **Sampler 主项**(`d_pb_base = target_S_curve(r)`) | sample 的"形态骨架" |
| **Loss `L_shape` target** | model 直接拟合 sample(= ideal ± 偏差) |
| **Loss `L_endpoint` / `L_anchor` 硬约束** | 端点 + 7 关键 r 点强制朝 ideal 收 |
| **最终业务验收** | `预测 vs 目标 MAE`、`实测 vs 目标 MAE` 都用这条 |

### 3.2 样本构造 — sample 反映真实算法,不注入 target

**v3.0 关键设计**:sample 必须真实反映 (ctx, θ) 配置下启发式算法 + bot 跑出来的 d_curve,**不能把 ideal target 数据泄露进 sample**。否则 model 学到的是数学公式而非真实算法的行为,θ 优化器找的"最优 θ"对真实部署无意义。

每步 `d_step` 公式(纯真实状态):

```
d_step(t) = state_d_t
          = 0.30 · fillRate_t  +  0.50 · (1 − action_freedom_t)  +  0.20 · trend_norm_t
            ┌─────────┴─────────┐ ┌─────────────┴─────────────┐ ┌─────┴─────┐
            棋盘满度              候选 action 比例              填充率上升趋势

死局时:    d_step = 1.0
惊喜事件:  if clears ≥ 3:  state_d *= 0.5  (大消行压力骤降)
```

**(ctx, θ) 如何影响 d_step**:

```
θ ∈ {pbTensionCenter, pbBrakeCenter, ...} 9 维  →  simulator.modelConfig  →  derivePbCurve
                                                                                ↓
generator (rule / generative)                                                spawn 候选难度
                                                                                ↓
bot (random / clear-greedy / survival / rl-bot)                            玩家放置决策
                                                                                ↓
                                                                      fillRate / freedom / trend
                                                                                ↓
                                                                            state_d → d_step
                                                                                ↓
                                                                          d_curve (20 bin)
```

→ **不同 (ctx, θ) 跑出真实不同的 d_curve**,这才是 model 寻参的有效信号。

| ctx 示例 | 典型 d_curve 跨度(默认 θ) |
|---|---|
| `easy + rule + clear-greedy + pb=4000 + onboarding` | 0.25 → 0.55(跨度 0.30) |
| `hard + rule + random + pb=10000 + plateau` | 0.35 → 0.85(跨度 0.50,棋盘后期更满) |
| `normal + generative + survival + pb=1500 + mature` | 0.30 → 0.65(跨度 0.35) |

**真实启发式算法跑出来的 d_curve 不是 ideal S 形**,跨度也不是 ideal 的 0.80。这才是 model + θ 优化器要解决的真实问题。

### 3.3 真实算法 d_curve 跟 ideal target 的 gap

v3.0 接受这个客观事实:**8×8 grid + 启发式规则在物理上达不到 ideal 0.10 → 1.00 的端点**:

- r=0 时:bot 刚开局,但 `Grid.initBoard(fillRatio=0.3-0.5)` 已有填充 → `state_d` 不可能 < 0.10
- r=2 时:启发式算法不会让棋盘"几乎卡死",`noMove` 一旦触发就 break 局 → 实际能看到的最高 `d_step` ≈ 0.90 而非 1.00

→ 真实跨度 ≈ **0.30-0.50**(取决于算法 + θ + bot 组合),远小于 ideal 0.80。

**这个 gap 不是 sampler 的 bug,是真实算法的物理上限。** model + θ 优化器的真正价值在于:

1. **量化 gap**:同一 ctx 下,不同 θ 让 d_curve 跨度有 ±0.10 变化
2. **找最优 θ**:在 9 维 θ 空间搜索,让 d_curve **尽可能接近 ideal**(无法完全到达,但能缩小 gap)
3. **跨 ctx 个性化**:不同 ctx 下最优 θ 不同,bundle 部署 360 行映射

### 3.3.1 事实门禁 `fact_eval`(v1.62.0)——以目标 S 曲线为准判定「效果是否提升」

**口径(核心)**:**以目标 S 曲线为唯一基准**,预估口径与实测口径都用「到目标的距离」打分;**预估比实测更逼近目标 → 提升,更偏离 → 下降**。三条曲线在**同一批真实观测 bin** 上对比(无数据 bin 的预估属外推,不参与判定):

- 目标 `target` = 理想难度 S 曲线(唯一基准);实测 `measured` = 真实对局聚合的 d_curve(现状事实);预估 `predicted` = 模型对该 ctx 的预测曲线(寻参后的投影)。
- **实测口径误差** `E_meas = MAE_O(measured, target)`(现状到目标);**预估口径误差** `E_pred = MAE_O(predicted, target)`(预估到目标,与 `E_meas` 同 bin,可比)。
- **提升量** `Δ = E_meas − E_pred`:`Δ>0` → 预估更逼近目标 = **提升**;`Δ<0` → **下降**。
- 诊断量(**不参与判定**):**预测-实测偏离** `R = MAE_O(predicted, measured)` = 模型相对现状的**改动幅度**;`Δ>0` 时 `R` 大只表示「改动大且朝目标」,并非问题。`E_pred_all`(全 20 bin,含外推)同为诊断。

> **设计沿革(两处修正)**:① 早期把「预测-实测偏离 `R`」当阻断门是过激的冗余代理——`Δ` 只在真实观测 bin 上算,`R` 大只是模型提出的有益改动幅度大,故 `R` **降级为诊断量**。② 早期把覆盖率/高分段覆盖当 fail,导致 `Δ=+0.0726>0`(预估明显更贴目标)却被判"未提升"——这是逻辑错误:覆盖不足只说明"提升被验证到的 r 区间有限"(尤其接近 PB 的高分段因 bot 太弱/对局太短打不到 PB、尚无实测),**不等于没提升**。故覆盖率 **降级为告警**,提升与否唯一由 `Δ` 决定。

**门禁规则(`rl_pytorch/spawn_tuning_v2/fact_eval.py`)**——**提升与否唯一由 `Δ` 决定**,其余仅为告警/诊断:

| 项 | 角色 | 默认阈值 | 含义 |
|---|---|---|---|
| **提升量 `Δ = E_meas − E_pred = \|实测−S\| − \|预估−S\|`** | **唯一判定** | ≥ 0.0 (`min_improvement`) | `Δ>0` → 预估比实测更逼近目标 = **提升**;`Δ<0` → 下降 |
| 覆盖率(有数据 bin 占比) | 告警(caveat) | ≥ 0.50 (`min_coverage`) | **不达标 ≠ 未提升**;只提示"提升结论仅覆盖已观测 r 区间" |
| 高分段覆盖(bin≥10) | 告警(caveat) | ≥ 0.30 (`min_high_coverage`) | 接近 PB 的高 r 段尚无实测、未参与验证(覆盖告警) |
| 绝对底线 `E_meas` | 可选门 | `max_measured_mae`(默认关闭) | 显式启用时额外要求实测口径误差达标 |
| 校准上限 `R` | 可选/诊断 | `max_calib_residual`(默认关闭) | 默认仅诊断;显式启用才作偏离上限阻断 |
| 武装下限 `min_armed_contexts` | 前置 | 20 | 有实测支撑的 ctx 不足时判 `indeterminate`(不拦截,避免冷启动死锁) |

> **覆盖率不再翻转"提升"结论**:之前把"高分段覆盖 10% < 30%"当 fail,导致 `Δ=+0.0726>0`(预估明显更贴目标)却显示"未提升"——这是逻辑错误。覆盖率只刻画"提升被验证到多大 r 区间",覆盖不足应作告警(提升仍成立,只是高分段未验证),不能判未提升。

- CLI/npm:`python -m rl_pytorch.spawn_tuning_v2.fact_eval --db <sqlite> --bundle <policies.json>`(别名 `npm run spawn:fact-eval`);退出码 `0` 提升(`Δ≥阈值`,可能附覆盖告警) / `2` 不足以判定 / `3` 未提升/下降(`Δ<阈值`)。
- **部署硬门禁**:后端 `build-and-export`(`spawn_tuning_v2_backend.py`)在写 `web/public` bundle、auto-deploy **之前**调 `gate()`;`passed is False` → `HTTP 422` 拒绝部署并回报指标。`require_fact_eval=false` 仅用于明确的 shadow(不部署)。
- 旧阈值键 `max_self_delusion` 仍被接受(映射为可选的 `max_calib_residual`,默认不阻断),向后兼容。

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
f(ctx, θ) ≈ smoothed( sample d_curve at (ctx, θ) )
            ─────────────────┬───────────────────
                  在「真实形态」和「ideal target」之间妥协
                  (取决于 L_shape 和 L_target_fit 权重比)
```

v3.0 Loss 角色分工:
- `L_shape` (w=1.5):拉 model → sample(真实形态),让 model **不偏离物理可达范围**
- `L_target_fit` (w=3.0):★ 拉 model → ideal target,让 model **朝业务期望靠拢**
- `L_endpoint` (w=4.0):端点锚 ideal head≈0.102 / tail=1.00 ±0.04
- `L_anchor` (w=3.0):11 个 r 点 hinge,**重点强化低 r 段**(0.05/0.15/0.20/0.30 双向控制)

→ Model 输出 ∈ [真实 sample 形态, ideal] 之间,具体落在哪由权重决定。这正是 model 作为 **smoothed surrogate** 的本意。

### 3.5 12 项 Loss 在「真实 sample」与「ideal target」之间妥协

| Loss | 权重 | 拉力方向 | 业务作用 |
|---|---|---|---|
| `L_target_fit` (主) | **5.0** | model → ★ **ideal** target_S_curve (跨度 0.90) | ★ 直拉业务目标(v3.0.3 起用 ideal 而非 calibrated) |
| `L_endpoint` | **12.0** | head/tail → ideal (head≈0.102, tail=1.00) tol ±0.025 | 端点死锁 |
| `L_anchor` | **15.0** | **22 r 点** hinge → 业务关键范围 | ★ 低 r 双向 + **中段 0.40/0.50/0.60/0.70 双向夹紧** + 高 r 下界收紧 |
| `L_shape` | **0.2** | model → sample(真实形态) | 极弱锚,几乎放弃 sample 拉力 |
| `L_monotonic` | 2.5 | curve 非降 | 与 ideal 同向 |
| 其他 8 项 | 0.15 / 0.5 / 0.3 ... | 业务正则 / 辅助 head | 不冲突 |

**v3.0.3 anchor 全集(22 r 点)**:

```
ANCHOR_CONSTRAINTS = [
    # ─── 低 r 双向 (玩家初期, ideal ± 0.03) ───
    (0.05, "lower", 0.08),  (0.05, "upper", 0.13),   # ideal 0.10
    (0.15, "lower", 0.08),  (0.15, "upper", 0.14),   # ideal 0.10
    # ─── 远 PB 上界 ───
    (0.20, "upper", 0.14),  (0.30, "upper", 0.15),
    # ─── 中段双向 (v3.0.25 参考红线, 低平台后缓慢抬升) ───
    (0.40, "lower", 0.08),  (0.40, "upper", 0.14),   # ideal 0.11
    (0.50, "lower", 0.10),  (0.50, "upper", 0.16),   # ideal 0.13
    (0.60, "lower", 0.13),  (0.60, "upper", 0.20),   # ideal 0.16
    (0.70, "lower", 0.16),  (0.70, "upper", 0.23),   # ideal 0.19
    # ─── 临近 / 破 / 超 PB 段 (v3.0.25 r≈1 后快速上冲) ───
    (0.95, "lower", 0.38),  # ideal 0.43
    (1.00, "lower", 0.86),  # ideal 0.90
    (1.20, "lower", 0.94),  # ideal 0.99
    (1.50, "lower", 0.98),  # ideal 0.99
    (1.80, "lower", 0.99),  # ideal 1.00
]

# Shape bin 权重 (低 r 段 + 拐点段加权)
overrides = {
    0: 3.0, 1: 2.5, 2: 2.0, 3: 1.5,     # ★ 低 r 强化 (v3.0 新增)
    7: 2.0, 8: 3.0, 9: 4.0, 10: 4.0, 11: 3.0, 12: 2.5,   # 拐点
    15: 2.0,                             # 高超 PB
}
```

**v3.0.3 设计要点(D+A+B 三动作)**:

- **D** — `L_target_fit` 改拉 ★ ideal(当前跨度 0.90)而非 calibrated(跨度 0.62),直接对齐业务目标,backward 信号本身就向 ideal 倾斜
- **A** — 中段 r=0.40/0.50/0.60/0.70 新增 lower 下界,形成 `ideal ± 0.03` 双向夹紧,根治"中段被 L_shape 拉低"
- **B** — 高 r r=1.00/1.20/1.50/1.80 lower 全部收紧到 `ideal − 0.02`,防止 model 在破 PB 后停在 0.85

注:`bin_idx = int(r / bin_width + 1e-9)`(v3.0.3 修复浮点 bug,例 `int(0.6/0.1)` 原本得 5 应得 6)。

### 3.6 推断与利用 — model 怎么转化为线上 θ

**单 ctx 推断**(d_curve 三线对照 chart):

```
给 (ctx*, default θ) → model.forward → d_curve_pred
对比 d_curve_pred vs ideal target → 看 model 在该 ctx 学得多准
```

**θ 优化(Surrogate Optimization,`optimize_theta.py`)**:

```
for ctx in 360 stable contexts:
    best_θ = argmin_θ  ‖ model(ctx, θ) − ideal_target ‖
              ↑ 把 model 当做可微 surrogate, 在 9 维 θ 空间用 Adam 搜索
              ↑ n_starts=8 (多起点防局部解), steps=300

→ 每个 ctx 找到让 d_curve 最贴 ideal 的 θ*
→ PAVA 单调投影
→ 写入 bundle JSON: 360 行 { context_key: θ* }
```

**部署接通(v3.0.6 关键修复)**:

| 版本 | bundle 内 θ | build_mode | 备注 |
|------|-------------|-----------|------|
| ≤ v3.0.5 | 全 ctx 都用 `[0.5]*9`(中点) | `model-inference-default-theta` | ★ 闭环断裂:模型学的 (ctx,θ)→curve 映射在部署阶段被丢掉 |
| ≥ v3.0.6 | 每 ctx 跑 surrogate 优化得到 best θ* | `model-inference-best-theta` | UI 点「导出 Bundle」时勾选「优化 θ 寻参」(默认开),后端调用 `optimize_one_context` 360 次 |

API 用法:

```http
POST /api/spawn-tuning-v2/policies/build-and-export
{
  "model_id": 40,
  "rollout_pct": 100,
  "optimize_theta": true,        # v3.0.6: 主动启用 surrogate 寻参
  "opt_n_starts": 8,             # 每 ctx 多起点数 (默认 8)
  "opt_steps": 300               # 每起点 Adam 步数 (默认 300)
}
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
│   target_S_curve(r) = 4 段分段函数, 跨度 [0.10, 1.00]                    │
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

### 3.8 多轮迭代精化(v3.0.6,Iterative Refinement)

**业务诉求**:让启发式 + θ\* 实际跑出来的 d_curve 逼近 ideal S,而不仅仅是模型预测贴 ideal。

**多轮迭代流程**:

```
迭代 i (i ≥ 1):
  1. 采集 θ_i: 从 deployed bundle (上一轮 θ_{i-1}*) 读 best θ, ±10% 抖动
              UI 选 「围绕 deployed θ* 抖动」 / 「70% 抖动 + 30% LHS 混合」
  2. 跑 simulator → 真实 d_curve 样本
  3. 训练 model_i (学 (ctx,θ) → 真实 d_curve)
  4. surrogate 优化: 对每 ctx 找 θ_{i+1}* = argmin_θ ‖model_i(ctx,θ) − ideal‖
  5. 导出 bundle (build_mode=model-inference-best-theta)
  6. 测量: 用 default θ=0.5 跑一组 baseline 样本 vs 用 θ_{i+1}* 跑一组 best 样本
            实测 MAE(baseline) - 实测 MAE(best) = 本轮"撬动幅度"
  7. 撬动 < 阈值 → 终止; 否则 i ← i + 1
```

**θ 采样策略对照(`web/src/tuning/v2/dashboardV2.js`)**:

| 策略 | 适用场景 | 实现 |
|------|----------|------|
| **LHS · 全空间探索** | 迭代 0(首训) / 重训 | 9 维 Latin Hypercube 抽样,覆盖 [0,1]⁹ |
| **围绕 deployed θ\* 抖动** | 迭代 i ≥ 1 精化 | 从 `policies.json` 读每 ctx best θ,各维 `θ ± 10% × (hi-lo)` 均匀噪声 |
| **70% 抖动 + 30% LHS(混合)** | 不放弃探索时 | 7 个 perturb + 3 个 LHS,兼顾「利用」与「逃离局部解」 |

**为什么需要迭代**(单轮收敛不充分的原因):

1. **模型在 best θ 邻域精度不足** — 训练 set 用 LHS 均匀采,best θ 区域样本少
2. **真实 d_curve vs surrogate 预测有 gap** — model 仍是近似,best θ 在 simulator 上可能不是最优
3. **迭代精化** = "在 best θ 邻域加密采样 → 局部精度提升 → 下一轮找到更优 θ"

**θ 撬动的物理上限**:

- v3.0 起 `d_step = state_d`(fillRate + actionFreedom + trend),θ 只影响"决策侧"(spawn 偏好 / 惊喜阈值),**不直接控制 fillRate 物理动力学**
- θ 撬动 d_curve MAE 的极限大概 **10-15%**(实测;基准:default θ MAE ≈ 0.27,best θ MAE ≈ 0.22-0.24)
- 想要更深改善 → §12.5(把 θ 接入 simulator.spawn 物理侧,例如 PB-aware spawn)

### 3.9 关键点速记

1. **Sample 不注入 ideal target** — d_step = state_d,纯反映真实算法行为。否则寻参无意义。
2. **Ideal target 只在 Loss 端出现**(`L_target_fit / L_endpoint / L_anchor`)→ 训练时拉 model 朝业务期望靠拢
3. **Model 学的是 (ctx, θ) → 真实 d_curve 的映射** — 作为可微 surrogate 替代昂贵的 simulator
4. **θ 优化器在 model 上反向搜索**:对每个 ctx 找让 d_curve 最贴 ideal 的 θ,这才是真正"寻参"
5. **★ Bundle 必须写 best θ\*(v3.0.6)** — 否则模型学的 (ctx,θ)→curve 映射在部署阶段被丢弃,闭环断裂
6. **迭代精化(v3.0.6)** — 单轮 surrogate 极限有限,多轮"围绕 deployed θ\* 抖动采样"持续逼近
5. **接受物理上限**:启发式算法跨度天花板 ~0.50,远低于 ideal 0.80。θ 优化器能把 gap 从 0.30 缩到 0.15(50% 改进),不能完全消除
6. **低 r 段重点强化**:r ∈ [0, 0.3] 决定玩家能否持续推进游戏,11 anchor 双向控制 + bin 0-3 加权 + endpoint tol 0.04
7. **闭环验证**:field_metrics 上报真实玩家 d_curve **应跟 sample 形态一致**(因为 sample 反映真实算法),跟 model 输出有 gap(model 被 ideal 拉)

---

## 4. 特征工程

总输入维度 **41 = 32 ctx_emb + 9 θ**。

### 3.1 Context(5 维离散类别 + 1 维数值)

| 字段 | 取值 | N | embedding 维度 |
|---|---|---|---|
| `difficulty` | `easy / normal / hard` | 3 | 4 |
| `generator` | `rule / generative` (v3.0.8 与 game.js 对齐) | 2 | 2 |
| `bot_policy` | `random / clear-greedy / survival / rl-bot` | 4 | 4 |
| `pb_bin` | `500 / 1500 / 4000 / 10000 / 25000` | 5 | 8 |
| `lifecycle_stage` | `onboarding / growth / mature / plateau` | 4 | 8 |
| **小计** | **240 unique ctx** | | **28** |

加上 `log_pb = log10(pb_bin)` 通过 `Linear(1→4)` 投影 → **EMB_TOTAL = 32**。

类别索引存于 `feature_io.py::{DIFFICULTY,GENERATOR,BOT,PB_BIN,LIFECYCLE}_INDEX`。

### 3.2 θ(27 维 LHS 抽样空间)

THETA_KEYS 顺序与 `feature_io.THETA_KEYS` / `clientPolicyV2.THETA_KEYS_ORDER` 严格对齐。所有 θ 必须在 `simulator / adaptiveSpawn / blockSpawn / spawnExperiments` **至少一处真实消费**,改变值能直接影响 d_curve 形状。

#### 3.2.1 全 27 维 θ 一览

##### 组 A:候选选拔 / 个性化(5 维) — `spawnExperiments.js`

| # | 字段 | (min, max) | 默认 | 决策面板对应 |
|---|------|------------|------|--------------|
| 0 | `personalizationStrength` | (0.05, 0.18) | 0.10 | 「偏好」区 6 条 bar(直消/连锁/冒险/新鲜/生存/预算微调)的**振幅** |
| 1 | `temperature`             | (0.03, 0.08) | 0.05 | 「形状权重」5 条 bar 的**离散度** — 高时均匀,低时 top1 独秀 |
| 2 | `surpriseBudgetGain`      | (0.05, 0.10) | 0.07 | 「决策标志/调度提示」「愉悦模式·救济」chip 的**亮灯频率** |
| 3 | `surpriseCooldown`        | (4, 10)      | 6    | 同上 chip 的**亮灯间隔** |
| 4 | `maxEvaluatedTriplets`    | (32, 128)    | 80   | 「压力归因 top4」排序稳定性 + 「出块目标」精细度 |

##### 组 B:PB 双 S 曲线(4 维) — `adaptiveSpawn.derivePbCurve()` + `extractor.step_difficulty()`

| # | 字段 | (min, max) | 默认 | 决策面板对应 |
|---|------|------------|------|--------------|
| 5 | `pbTensionCenter`         | (0.70, 0.92) | 0.82 | 「决策动态/PB」「张力」浮标的**触发位置** |
| 6 | `pbTensionWidth`          | (0.04, 0.15) | 0.08 | 张力浮标的**翻转速度**(越小越陡) |
| 7 | `pbBrakeCenter`           | (0.98, 1.15) | 1.05 | 「决策动态/PB」「刹车」浮标的**触发位置** |
| 8 | `pbBrakeWidth`            | (0.03, 0.12) | 0.06 | 刹车浮标的**翻转速度** |

##### 组 C:augmentPool 乘性加权(8 维) — `blockSpawn.generateDockShapes`

| # | 字段 | (min, max) | 默认 | 决策面板对应 |
|---|------|------------|------|--------------|
| 9  | `perfectClearWeight`    | (15.0, 40.0) | 25.0 | 清屏潜力块的**峰值高度** — 直接控制 d_curve 高 r 段拐点 |
| 10 | `multiClearBaseFactor`  | (0.4, 0.8)   | 0.6  | 多消段抬升 — d_curve 中段宽度 |
| 11 | `nearFullFactor`        | (1.5, 2.5)   | 2.0  | 临消行峰宽 — d_curve 高 r 段平台 |
| 12 | `exactFitBonus`         | (1.2, 2.0)   | 1.5  | 完美卡入局部尖峰 — d_curve 锯齿强度 |
| 13 | `monoFlushBoost`        | (0.2, 0.8)   | 0.4  | 同花次峰频率 — d_curve 中 r 段震荡 |
| 14 | `payoffWeight`          | (1.2, 2.0)   | 1.7  | 兑现期峰宽 — d_curve 拐点平滑度 |
| 15 | `sizePreferenceGain`    | (1.2, 2.0)   | 1.5  | 块大小谱系 — d_curve 整体偏移 |
| 16 | `diversityPenalty`      | (0.5, 1.8)   | 1.0  | 品类多样性强度 — d_curve 峰值离散度 |

##### 组 D:deriveSpawnTargets 翻译矩阵(5 维) — `adaptiveSpawn.deriveSpawnTargets`

| # | 字段 | (min, max) | 默认 | 决策面板对应 |
|---|------|------------|------|--------------|
| 17 | `complexityFromStress`     | (0.5, 1.0)    | 0.75  | stress → 复杂度梯度 — d_curve 整体斜率 |
| 18 | `complexityRiskRelief`     | (-0.7, -0.2)  | -0.45 | 救济期复杂度下压力度 — d_curve 低谷深度 |
| 19 | `solutionFromStress`       | (0.5, 1.0)    | 0.7   | stress → 解空压力 — 中段紧度 |
| 20 | `pbTensionTargetWeight`    | (0.05, 0.20)  | 0.10  | PB 张力对 6 类目标的调制 — 拐点位置 |
| 21 | `pbBrakeTargetWeight`      | (0.05, 0.20)  | 0.10  | 超 PB 段目标二次拐弯 — 末段反翘幅度 |

##### 组 E:PB 段细节弯折(5 维) — `adaptiveSpawn.js`

| # | 字段 | (min, max) | 默认 | 决策面板对应 |
|---|------|------------|------|--------------|
| 22 | `challengeBoostSlope`   | (0.5, 1.0)   | 0.75 | 追 PB 加压斜率 — d_curve r∈[0.8,1.0] 爬升速度 |
| 23 | `challengeBoostCap`     | (0.12, 0.25) | 0.18 | 追 PB 加压上限 — d_curve r=1.0 峰高 |
| 24 | `pbOvershootMax`        | (0.10, 0.22) | 0.16 | 超 PB 后对数加压幅度 — d_curve r>1.0 抬升 |
| 25 | `releaseFactor`         | (0.5, 0.85)  | 0.7  | 破 PB 释放窗口 stress 衰减 — d_curve 破 PB 后低谷 |
| 26 | `farFromPBBoost`        | (0.30, 0.60) | 0.45 | D0 远征段送爽强度 — d_curve r<0.30 抬升 |

归一化:全部 min-max → [0, 1] 由 `normalize_theta()` 完成,反向用 `denormalize_theta()`。注意第 18 维 `complexityRiskRelief` 范围**为负值** `[-0.7, -0.2]`,归一化公式仍然标准 `(v-lo)/(hi-lo)`。

#### 3.2.2 决策数据流 5 阶段与 θ 接入位置

```text
┌──────────────────────┐
│ playerProfile        │  玩家近 200 局统计(技能/动量/挫败/心流/阶段/...)
└──────────┬───────────┘
           ▼
┌──────────────────────┐         ┌─────────────────────────┐
│ ① 压力 (stress)      │ ◀──── │ E. PB 段细节 (5)         │
│ deriveStress()       │ PB 段  │ challengeBoost*,        │
│                      │ 加压   │ pbOvershootMax,         │
│                      │        │ releaseFactor,          │
│                      │        │ farFromPBBoost          │
└──────────┬───────────┘         └─────────────────────────┘
           ▼
┌──────────────────────┐         ┌─────────────────────────┐
│ ② 策略(5 锚点)       │ ◀──── │ A. 候选选拔/个性化 (5)   │
│ 保消/尺寸/刚性/      │ 个性化 │ personalizationStrength,│
│ 多样/连击            │ 调制   │ temperature             │
└──────────┬───────────┘         └─────────────────────────┘
           ▼
┌──────────────────────┐         ┌─────────────────────────┐
│ ③ 目标(6 类)         │ ◀──── │ D. targets 翻译 (5)      │
│ deriveSpawnTargets() │ stress │ complexityFromStress,   │
│ 兑现/消机/空间/      │ → 目标 │ complexityRiskRelief,   │
│ 解空/复杂/新奇       │ 翻译   │ solutionFromStress,     │
│                      │ + PB   │ pbTension/BrakeTarget*  │
└──────────┬───────────┘         └─────────────────────────┘
           ▼
┌──────────────────────┐         ┌─────────────────────────┐
│ ④ 调度(双 S)         │ ◀──── │ B. PB 双 S 曲线 (4)      │
│ tension + brake      │ PB     │ pbTensionCenter/Width,  │
│ 出块意图 = relief    │        │ pbBrakeCenter/Width     │
└──────────┬───────────┘         └─────────────────────────┘
           ▼
┌──────────────────────┐         ┌─────────────────────────┐
│ ⑤ 意图 → 形状选拔    │ ◀──── │ C. augmentPool 乘性 (8)  │
│ 候选 N → 1 (5 形状)  │ 形状层 │ perfectClearWeight,     │
│ generateDockShapes() │ 加权   │ multiClearBaseFactor,   │
│                      │        │ nearFullFactor,         │
│                      │        │ exactFitBonus,          │
│                      │        │ monoFlushBoost,         │
│                      │        │ payoffWeight,           │
│                      │        │ sizePreferenceGain,     │
│                      │        │ diversityPenalty        │
└──────────┬───────────┘         └─────────────────────────┘
           ▼
        出块决策
```

**寻参视角的因果**:
1. 输入 5 维 ctx → 模型输出该 ctx 下最优 27 维 θ
2. 部署后,游戏端每帧根据当前 ctx 查 bundle 拿 θ,**穿给 L1**(simulator 把 modelConfig 注入 `_spawnContext`,所有 derive* / augmentPool 读 `ctx.modelConfig.X ?? 默认值`)
3. L1 用新 θ 跑出来的 d_curve 应该更贴近 ideal S

> ⚠️ 若 L1 物理上做不到那条 ideal S,**无论 L2 怎么寻参也不可能**(算法物理 gap)。这就是 PB-aware d_step 物理混合的原因(让 PB θ 直接参与 `state_d` 计算)。

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
# v3.0: 纯真实棋盘状态, 不注入 target_S_curve (避免数据泄露)
state_d = 0.30 * fillRate + 0.50 * (1 - action_freedom) + 0.20 * trend_norm
state_d = clip(state_d, 0, 1)

if clears >= SURPRISE_MIN_CLEARS:    # ≥ 3 行消行
    state_d *= 0.5                    # 惊喜事件减压

if no_move:
    d_step = 1.0                      # 死局 = 最高难度
else:
    d_step = state_d
```

**关键**:`d_step` **完全独立于 r**(`ratio` 参数不参与计算)。sample 数据真实反映 (ctx, θ, bot) 跑出来的算法行为,**不向 sample 注入 ideal target**。这让 model 学到 (ctx, θ) → 真实 d_curve 的因果关系,θ 优化器才能找到对真实部署有效的最优 θ。

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
| `rule` | 启发式 — game.js `_commitSpawn(generateDockShapes(...), 'rule')`;sampler 内部 `simulator.spawnGenerator='baseline'` 调用**同一**函数 `generateDockShapes(grid, layered, spawnContext)`,θ 通过 `modelConfig` 注入,与 game.js 通过 `resolveThetaV2 → derivePbCurve` 链路完全等价 | 快(同步) |
| `generative` | 生成式 — game.js `_spawnBlocksWithModel` 调 SpawnPolicyNet;sampler 通过 HTTP `POST /api/spawn-model/v3/predict` 拿 dock,**同一 SpawnPolicyNet 接口** | 慢 ~10-50x |

**v3.0.8 关键决策:与游戏页面 1:1 严格对齐 / 无 alias / 无历史枚举** —
v3.0.7 还保留了 4 个老 enum 的透明 alias(`triplet-p1 / budget-p2 / heuristic-rule / generative`→ 新 enum),但代码复杂度高、容易让人误解为还有"内部细分"。v3.0.8 决定:

- **DB 老样本**:migration 时 **purge**(`generator NOT IN ('rule', 'generative')` 的样本 DELETE)
- **CHECK 收紧**:`CHECK (generator IN ('rule', 'generative'))`,仅 2 个值
- **代码去 alias**:`feature_io.GENERATOR_ALIASES` / JS `GENERATOR_ALIASES_JS` / `clientPolicyV2._GEN_ALIAS_BUNDLE` / sampler `GENERATOR_ALIASES_INTERNAL` **全部移除**
- **修正 sampler 内部路径**:v3.0.7 错误地把 `rule → 'budget-p2'`(那条路径走 `generateExperimentalDockShapes`,游戏页面 rule 模式不会调到),v3.0.8 改回 `rule → 'baseline' (SPAWN_POLICY_RULES)`,调用与 game.js **同一** `generateDockShapes` 函数
- **`generative` HTTP 失败** → fallback sim 内部 baseline dock(规则路径),sampling 不中断

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

**`📊 覆盖优先` Preset(v1.62.0,用于扩大 §3.3.1 的验证范围)**:在 `🎯 高质量` 基础上进一步把采样**集中到够得着的高分段**——`lookahead-2` + 关 `random` bot + **仅采 `pb_bin=500/1500`**(实测 4000+ 时 `r_max≈0.57`,bot 完全够不着 PB)+ `12 θ × 5 seed × maxSteps 800`。目标是让 S 曲线 `bin≥10` 段累计到足够真实观测,降低 `fact_eval` 的覆盖告警。注意:覆盖率/高分段覆盖只表示"提升结论被验证到多大 r 区间",**不再决定是否提升**;提升与否仍唯一看 `Δ=|实测−S|-|预估−S|`。

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
        + κ · L_anchor         (22 r 点 hinge)
        + μ · L_monotonic      (软单调 hinge)
        + ν · L_target_fit     (★ ideal S 形 MSE — v3.0.3 改拉 ideal 而非 calibrated)
        + ξ · L_endpoint       (ideal 端点 hinge, tol ±0.025)
        + ω · L_r_value        (multi-task smooth_l1)
```

### 6.2 默认权重 — `LossWeights`(v3.0.3)

| 符号 | 字段 | 默认 | 说明 |
|---|---|---|---|
| α | `shape` | **0.2** | 极弱锚(几乎放弃 sample 拉力) |
| β | `balance` | 0.15 | 跨 PB bin 一致性 |
| γ | `surprise` | 0.3 | |
| δ | `breaking` | 0.5 | |
| ε | `smooth` | 0.04 | |
| ζ | `aux` | 0.2 | |
| η | `pb_distribution` | 0.0 | 默认关(仅 P_reach 看板展示) |
| κ | `anchor` | **15.0** | 22 r 点关键修正,中段双向夹紧 |
| μ | `monotonic` | 2.5 | |
| ν | `target_fit` | **5.0** | ★ 主导 — 拉 model → ideal S(当前跨度 0.90) |
| ξ | `endpoint` | **12.0** | 锚 ideal 端点,tol ±0.025 |
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

#### `L_anchor` — 22 锚点 hinge ⭐ (v3.0.3)

```python
ANCHOR_CONSTRAINTS = [
    # ─── 低 r 双向 (玩家初期, ideal ± 0.03) ───
    (0.05, "lower", 0.08),  (0.05, "upper", 0.13),   # ideal 0.10
    (0.15, "lower", 0.08),  (0.15, "upper", 0.14),   # ideal 0.10
    # ─── 远 PB 上界 ───
    (0.20, "upper", 0.14),  (0.30, "upper", 0.15),
    # ─── 中段双向 (v3.0.25 参考红线, 低平台后缓慢抬升) ───
    (0.40, "lower", 0.08),  (0.40, "upper", 0.14),   # ideal 0.11
    (0.50, "lower", 0.10),  (0.50, "upper", 0.16),   # ideal 0.13
    (0.60, "lower", 0.13),  (0.60, "upper", 0.20),   # ideal 0.16
    (0.70, "lower", 0.16),  (0.70, "upper", 0.23),   # ideal 0.19
    # ─── 临近 / 破 / 超 PB 段 (v3.0.25 r≈1 后快速上冲) ───
    (0.95, "lower", 0.38),  # ideal 0.43
    (1.00, "lower", 0.86),  # ideal 0.90
    (1.20, "lower", 0.94),  # ideal 0.99
    (1.50, "lower", 0.98),  # ideal 0.99
    (1.80, "lower", 0.99),  # ideal 1.00
]

for (r, kind, target) in constraints:
    bin = int(r / bin_width + 1e-9)   # +1e-9 修浮点 (v3.0.3)
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

#### `L_target_fit` — ★ Ideal S 形 MSE(v3.0.3)

```python
target_ideal = target_curve_vector()              # (20,) ★ ideal, cached per device
return ((curve_pred - target_ideal) ** 2).mean()
```

**主导拉力**(权重 5.0,v3.0.3 改拉 ideal 而非 calibrated)— 让 model 直接朝业务目标收敛,而非中间妥协态。

#### `L_endpoint` — Ideal 端点锚定

```python
head_mean = curve[:, :2].mean(-1)         # 前 2 bin (r ∈ [0, 0.2])
tail_mean = curve[:, -2:].mean(-1)        # 后 2 bin (r ∈ [1.8, 2.0])
head_viol = ReLU(|head_mean - 0.20| - 0.025)
tail_viol = ReLU(|tail_mean - 1.00| - 0.025)
return (head_viol.pow(2).mean() + tail_viol.pow(2).mean()) / 2
```

锚到 ideal `(head≈0.102, D_CAP=1.00)`,tol ±0.025(死锁)+ 权重 12.0(强力)→ **强制 model 端点贴 ideal,不能逃到 calibrated**。v3.0.25 起参考红线,低 r 长平台更轻,接近 PB 前后快速上冲,tail 仍保持 PB 后持续加压。

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
6. 验证指标      curve_mae, ideal_mae, curve_var, val_loss_breakdown × 12,
                 p_reach_metrics × 6 (reach_50/80/95/100/120/150)
                 ↓
7. EarlyStop     composite = ideal_mae + 0.3×endpoint + 0.2×anchor   (v3.0.4)
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
| `val_curve_mae` | mean(\|pred - sample d_curve\|) | < 0.05 |
| `val_ideal_mae` ★ | mean(\|pred - ★ ideal target\|) | < 0.03(业务核心) |
| `val_curve_var` | std(pred, dim=-1).mean() | > 0.10(防退化) |
| `val_anchor` | 22 hinge 平均 | → 0 |
| `val_monotonic` | 软单调 hinge | → 0 |
| `val_target_fit` | ideal MSE | < 0.005 |
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
    { "difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
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

部署时枚举 360 个稳定 ctx(`DEPLOYABLE_GENERATORS × DEPLOYABLE_BOTS × 全 difficulty × 全 pb_bin × 全 lifecycle = 3 × 2 × 3 × 5 × 4 = 360`,其中 generator ∈ `{rule, generative}`):

```python
for ctx in enumerate_all_contexts():            # 360 ctx (稳定子集)
    curve = model(ctx, default_theta).cpu().numpy()
    curve = pava_monotonic_projection(curve)    # PAVA 强制单调非降
    bundle.append({ "context_key": "easy:rule:clear-greedy:500:mature",
                    "d_curve": curve.tolist(),
                    "theta": default_theta_dict })

save_json(bundle, "web/public/spawn-tuning-bundles/<sha256>.json")
```

**`DEPLOYABLE_*` 子集**(v3.0.8) 等同于 GENERATOR_INDEX 全集:`rule / generative` + `random / clear-greedy / survival`,与游戏页面 1:1 对齐,360 ctx 即全量部署目标。`rl-bot` 仍是占位类别(UI 可勾选采样,不入 bundle)。

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
    generator       TEXT CHECK IN ('rule', 'generative'),   -- v3.0.8 严格 2 enum
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
3. v3.0.8 检测 CHECK 约束是否严格 `('rule', 'generative')` → 不是则**重建表**:snapshot → DROP → schema.sql 重跑 → **只回填 generator IN ('rule', 'generative') 的样本**(老 enum 样本被 purge);UPDATE sample_sets.sample_count 重算

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

### 12.3 v3.0.4:全链路对齐 ★ ideal target,移除 calibrated

- `target_fit / endpoint / anchor` **全部锚 ideal**(当前跨度 0.90)→ 三股力同向往 ideal 拉
- `L_shape` 权重压到 0.2,几乎放弃 sample 的拉力,sample 仅作为防止 model 飞走的极弱锚
- **`calibrated` 已彻底移除**:Python `target_S_curve_calibrated / target_curve_calibrated_vector / D_*_CAL 常量` + JS 对应函数 + UI 图例曲线 + `val_calibrated_mae` 全部清除。`val_ideal_mae` 是唯一 target MAE 指标。
- 权重比 `shape:target_fit:anchor:endpoint = 0.2:5:15:12`,让 model 跨度直追 ideal 0.80
- 浮点 bug 修复:所有 `int(r / bin_width)` 改为 `int(r / bin_width + 1e-9)`(原本 `int(0.6/0.1)` 浮点误差得 5,正确应为 6)

### 12.4 v3.0.6:接通 surrogate 寻参与迭代闭环(G1 + G2)

**根因**:v3.0.5 及之前 `build-and-export` 直接写 `theta_norm=[0.5]*9` 进 bundle,模型学到的 `(ctx, θ) → d_curve` 映射**在部署阶段被丢弃**。结果即便 model 预测和 ideal 几乎重合(MAE 0.008),启发式实测 d_curve 仍是 default θ 跑出来的平坦曲线(MAE 0.27)。看板可见:

```
模型预测  ━━━━━━ 紧贴 ideal S 曲线
实测均值  ━ ━ ━  平坦于 0.5-0.6      ← gap 0.27 持续存在
```

**G1 修复(部署侧)**:`build-and-export` 加 `optimize_theta=true` 参数,对每 ctx 跑 `optimize_one_context`(8 starts × 300 Adam steps)在 model 上找 best θ*,写入 bundle(`build_mode=model-inference-best-theta`)。API 默认 `False`(向后兼容老 caller / 测试),UI checkbox 默认 `True`(推荐路径)。

**G2 修复(采集侧)**:sampler 的 `thetas` 参数支持 `(ctx) => theta[]` 工厂函数。三种来源策略:

```
LHS         全空间探索       — 首训用
bundle-perturb  围绕 deployed θ* ±10% 抖动   — 迭代精化
bundle-mix      70% 抖动 + 30% LHS           — 平衡探索/利用
```

实现:`_loadDeployedBundle()` 缓存 `policies.json` 一次,`_perturbThetas` 在 9 维 θ 范围内均匀抖动并 clip 到合法区间。

**迭代闭环效果(预期)**:

| 迭代 | θ 来源 | 实测 d_curve MAE | 撬动幅度 |
|------|--------|----------------|----------|
| 0 | LHS(default θ=0.5 写 bundle) | 0.27 | - |
| 1 | LHS + G1 (best θ* 写 bundle) | 0.22-0.24 | -15% |
| 2 | bundle-perturb(围绕 θ_1\*) | 0.20-0.22 | -7% |
| 3 | bundle-perturb(围绕 θ_2\*) | 0.18-0.20 | -5% |
| → | 收敛(每轮 -2%~-5%) | ~0.18 | θ 撬动物理极限 |

**θ 撬动极限**:d_step = state_d 限制了 θ 影响范围(只能改 spawn 偏好,改不动 fillRate 物理),实测 MAE 收敛在 0.18 附近。要进一步突破需 §12.5。

### 12.4.3 v3.0.13:Loss 大平衡 — 让 model 真学 ctx/θ 分布

**根因**:之前 (v3.0.3-v3.0.12) 朝 ideal 合力 vs 朝 sample 力 = **34:1**,model 收敛到"近似常数函数"(无视 ctx/θ,只输出 ideal_S)。后果:

- `predict-curve` 永远贴 ideal,跟实测均值 MAE 长期 ≈ 0.25 锁死
- 寻参时 model 对 θ 不敏感 → θ\* 信号弱
- 看似 model "完美" (predict MAE vs ideal=0.008),实际"什么都没学"

**v3.0.13 调整**:把比例从 34:1 改为 **10:5 (2:1)**:

| 权重 | v3.0.3-v3.0.12 | v3.0.13 | 变化 |
|------|---------------|---------|------|
| `shape` | 0.2 → 1.0(v3.0.12) | **5.0** | sample 主导 |
| `target_fit` | 5.0 → 2.5(v3.0.12) | **0.5** | ideal 仅弱锚 |
| `endpoint` | 12.0 | **2.0** | 端点不再死锁,只是 hint |
| `anchor` | 15.0 | **3.0** | 仅保关键 r 点,中段放开 |
| `monotonic` | 2.5 | 2.5 | 不变 |
| `deploy` | 2.0 | 2.0 | 不变(G6 联合寻参) |

**总合力对比**:

```
朝 ideal: target_fit 0.5 + endpoint 2 + anchor 3 + monotonic 2.5 + deploy 2 = 10.0
朝 sample: shape 5.0
→ 2:1 (温和向 ideal, 但 sample 拉力够强让 model 学到分布)
```

**预期变化**(重训后):

| 指标 | v3.0.12 (34:1) | v3.0.13 (2:1) |
|------|--------------|--------------|
| `predict MAE vs ideal` | 0.008(完美) | 0.05-0.10(不再"完美") |
| `predict MAE vs 实测` | 0.25(脱节) | 0.05-0.10(真实拟合) |
| `predict 跟 ctx/θ 关系` | 几乎无 | 显著 |
| 寻参 θ\* 信号 | 弱 | 强 |
| 实测撬动 | ~0% | +10-20% |

**风险**:模型预测线不再贴 ideal,看起来"没有以前漂亮",但**评估意义反而真实了**(跟实测能对齐)。

### 12.4.2 v3.1 (G5):物理侧 θ 接入 — 让 θ 真正撬动启发式

**问题**:v3.0 起 `d_step = state_d` (仅 fillRate/freedom/trend),启发式物理上**跑不出 S 形**,实测 vs ideal MAE 长期锁死在 0.25 附近。模型/loss/寻参所有上层努力都被这个物理天花板锁住。

**v3.1 解法**:让 θ 通过 PB-aware sigmoid 直接调制 d_step:

```python
d_step = (1 - BLEND) * state_d + BLEND * sigmoid((r - θ_center) / θ_width)
       BLEND = 0.40 (受控)
       θ_center = θ.pbTensionCenter (默认 0.82, 寻参可调)
       θ_width  = θ.pbTensionWidth  (默认 0.08, 寻参可调)
```

效果:
- state_d 恒定 0.5 时,d_curve 跨度从 v3.0 的 **0** → v3.1 的 **~0.40**
- 启发式实测 d_curve 物理上具备 r 依赖的 S 形
- θ 寻参的物理空间被打开:不同 θ_center/width 让 d_curve 形状显著不同

### v3.x PB-aware 与 v2.x data leakage 的本质区别

| 项 | v2.x PB-aware (废弃) | v3.1 G5 PB-aware (本次) |
|---|---|---|
| `center / width` | **写死** ideal target 端点 (0.85 / 0.18) | **trainable** θ.pbTensionCenter/Width |
| 性质 | data leakage:sample 直接 mimic ideal | 受 θ 控制的物理因果 |
| 寻参意义 | θ 几乎无效 (sample 公式固定) | θ 决定 d_step 形状 → 寻参强信号 |
| 物理意义 | 数学公式,跟启发式没关系 | 启发式跟 r 物理感知 (即"接近 PB 时算法变难") |

### v3.1 BLEND 系数的权衡

| BLEND | 物理 vs PB-aware 比例 | 撬动预期 | 风险 |
|------|---------------------|---------|------|
| 0.0 | 100% state_d | ~5% (= v3.0) | 无 |
| 0.3 | 70% / 30% | ~20% | 低 |
| **0.4** ★ | **60% / 40%** | **~30%**(当前默认) | 平衡 |
| 0.7 | 30% / 70% | ~55% | 趋近 leakage 边缘 |
| 1.0 | 100% PB-aware | ~70% | 完全等价 v2.x leakage,不推荐 |

#### 12.4.1 v3.0.11 进化:联合寻参 (G6) — 训练 + 寻参合并

**问题**:v3.0.6 起 `build-and-export?optimize_theta=true` 部署时跑 surrogate Adam (360 ctx × n_starts × steps),实测 ~90-180s。

**根因**:寻参跟训练**解耦**了 — 训练完才反向求 θ\*,等于"先建仿真器,再去仿真器上爬山"。

**v3.0.11 改造**:把寻参合并进训练:

```python
class SpawnParamTunerResNet:
    # ★ 新增: 360 ctx 各自的 θ_optim_raw, trainable
    self.theta_optim_raw = nn.Parameter(torch.zeros(360, 9))   # sigmoid → [0,1]

# 训练 loss 末尾追加 L_deploy:
L_deploy = MSE(model(360_ctx, theta_optim), ideal_S)
total_loss = L_shape + L_target_fit + ... + w_deploy · L_deploy
total_loss.backward()
# → model 权重 + theta_optim_raw 一次 backprop 同步更新
```

**部署**:`build-and-export` 直接读 `ckpt.theta_optim_raw → sigmoid → bundle`,**秒级完成**(原 90-180s)。

**Fallback**:老 ckpt 无 `theta_optim_raw` 时,自动走 v3.0.6 的 surrogate 路径(确保历史模型部署不破)。

**收益**:

| 项 | v3.0.6 (老) | v3.0.11 (G6 联合) |
|---|---|---|
| 部署耗时 | 90-180s (n_starts=4, steps=150) | **< 1s** |
| 一次训练 + N 次部署 | 每次部署都要 90s | 部署成本几乎归零 |
| 多次迭代闭环可行性 | 每轮额外 90s | 完全省掉 |

**权衡**:
- 训练每 step 多一次 360-ctx forward(开销 ~+15-25% 单 epoch 时间)
- `theta_optim_raw` 额外参数 3240 个(对 325K 总参可忽略)
- LossWeights.deploy 默认 2.0,可调

### 12.5 v3.0.8:generator 与 game.js 严格 1:1(无 alias、无历史遗留)

v3.0.7 已经把 sampler/feature_io 的 generator 枚举改为 `rule / model-v3`,但仍保留了 4 个老 enum(`triplet-p1 / budget-p2 / heuristic-rule / generative`)→ 新 enum 的透明 alias。结果代码 4 处兼容映射,新人不易理解"内部到底跑啥"。v3.0.8 全部清理:

| 项 | v3.0.7 (有 alias) | v3.0.8 (严格 1:1) |
|---|---|---|
| 枚举命名 | `rule / model-v3` | **`rule / generative`** (`model-v3` 太泛, 改为更直白的"生成式") |
| `feature_io.GENERATOR_ALIASES` | 4 老 → 2 新 alias dict | **删除** |
| JS `GENERATOR_ALIASES_JS / _GEN_ALIAS_BUNDLE / GENERATOR_ALIASES_INTERNAL` | 多处 alias | **全部删除** |
| DB CHECK | 6 enum(新 2 + 老 4 共存) | **2 enum**(`'rule' / 'generative'`) |
| DB migration | 老样本保留 | **purge** `generator NOT IN ('rule', 'generative')` 的样本;UPDATE sample_count 重算 |
| sampler `rule` 内部 | `simulator.spawnGenerator='budget-p2'`(错!) | **`'baseline'`** — 与 game.js `_commitSpawn` rule 模式调用同一 `generateDockShapes` 函数 |

**关键修正**:v3.0.7 把 `rule` 映射到 `simulator.spawnGenerator='budget-p2'` 是错的——那条路径走 `generateExperimentalDockShapes`(v2 历史实验路径),**游戏页面 rule 模式不会调到**。v3.0.8 改为 `'baseline'`(`SPAWN_POLICY_RULES`),simulator 内部直接调 `generateDockShapes(grid, layered, spawnContext)`,这跟 game.js `_commitSpawn` 调的是**同一函数同一参数**。θ 通过 `modelConfig` 注入,等价于 game.js 通过 `resolveThetaV2` 拿 θ 后 `derivePbCurve`。

**收益**:sampler 跑出来的样本 d_curve = 启发式算法 + θ + bot 真实跑出来的,与游戏页面部署后真实玩家场景物理上等价。寻参的 θ\* 一旦写入 bundle,游戏页面跑出来的难度曲线就是 sampler 训练数据的延续——这才是真正闭环。

### 12.7 异步训练 vs 在线训练

- 离线训练每次跑 30K-100K 样本 50 epoch,~5-30 min(CPU/MPS)
- 在线 RL 类训练样本效率低且不稳定
- 异步训练 + bundle 部署可控,失败回滚清晰
- 真实玩家 d_curve 通过 `field_metrics` 周度回流,作为下一轮训练数据

### 12.8 Bundle 部署 vs 服务端推断

- 移动端无网络场景需要离线 θ
- 360 个稳定 ctx 的 `(ctx_key, θ_default)` 映射 = 几 KB JSON,跟二进制一起发布
- 服务端推断也保留(`/predict-curve`),作为 Web 端测试/调试通道

### 12.9 360 ctx vs 240/960

- 实际数据库 CHECK 允许 4 × 4 = 16 generator × bot,但**部署枚举只用 2 × 3 = 6**(`DEPLOYABLE_GENERATORS / DEPLOYABLE_BOTS`)
- v3.0.8: generator 与 game.js 严格 1:1 对齐(`rule / generative`),占位类别仅剩 `rl-bot`(训练可学,不入 bundle)
- 360 = 3 难度 × 2 generator × 3 bot × 5 PB × 4 lifecycle

---

## 附录 A:代码索引

| 文件 | 内容 |
|---|---|
| `rl_pytorch/spawn_tuning_v2/target_curve.py` | ★ ideal S 曲线数学定义 (v3.0.4 起 calibrated 已移除) |
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
| `web/src/tuning/v2/targetSCurve.js` | ★ ideal S 曲线 JS 镜像 |
| `web/src/tuning/v2/dCurveChart.js` | Canvas chart(legend toggle / hover / ±2σ 带) |
| `web/src/tuning/v2/clientPolicyV2.js` | 客户端 bundle 加载 + `resolveThetaV2` |

---

## 附录 B:关键常量速查

### Target Curve(`target_curve.py` / `targetSCurve.js`)

```
CURVE_N_BINS    = 20
CURVE_R_MAX     = 2.0
SEG_GENTLE_END  = 0.45
SEG_MID_END     = 0.65
SEG_BRAKE_END   = 1.15
BRAKE_SIGMOID_K = 10.5
OVERSHOOT_DECAY = 6.0

# Ideal (业务期望, v3.0.4 起为唯一 target)
D_BASE         = 0.10
D_GENTLE_END   = 0.11
D_MID_END      = 0.18
D_BRAKE_END    = 0.98
D_CAP          = 1.00
跨度 0.90
```

### PB-aware d_step(v3.0: 纯真实状态, 不注入 target)

```
# State_d 权重 (跨语言: extractor.py / samplerV2.js / policyMetricsV2.js)
FILL_RATE_WEIGHT      = 0.30        # 棋盘满度
ACTION_FREEDOM_WEIGHT = 0.50        # 候选 action 比例
TREND_WEIGHT          = 0.20        # 填充率上升趋势

SURPRISE_MIN_CLEARS   = 3           # ≥ 3 行消行触发惊喜
SURPRISE_DAMPING      = 0.50        # 触发时 state_d *= 0.5

# Legacy 常量 (跨语言一致性测试镜像, 不参与新 d_step 计算)
PB_AWARE_D_BASE       = 0.10
PB_AWARE_D_PEAK       = 1.00
PB_AWARE_CENTER       = 0.85
PB_AWARE_WIDTH        = 0.18
PB_AWARE_STATE_WEIGHT = 0.20

# bin 填充
PB_AWARE_PRIOR_STRENGTH = 3         # L_shape confidence = n / (n + 3)
PB_AWARE_MIN_OBS        = 1
```

`d_step` 范围:
- 棋盘高压(fill=1, freedom=0): `state_d = 0.30 + 0.50 + 0.10 = 0.90`
- 棋盘低压(fill=0, freedom=1): `state_d = 0 + 0 + 0.10 = 0.10`
- 中性(fill=0.5, freedom=0.5): `state_d = 0.15 + 0.25 + 0.10 = 0.50`
- 死局: `d_step = 1.0`
- 惊喜事件: `state_d *= 0.5`

→ sample d_curve 跨度 ≈ **0.30-0.50**(取决于算法 + θ 跑出的状态轨迹),**远小于 ideal 0.80**。这是真实算法的物理上限,model + θ 优化器在 surrogate 上尽可能向 ideal 靠拢。

### Loss 业务常量(`losses.py`)

```
TARGET_SURPRISE_RATE     = 0.07
SURPRISE_RATE_THRESHOLD  = 0.30
BREAKING_R_LOW           = 0.9
BREAKING_R_HIGH          = 1.0
PB_DIST_SCALE            = 1.6

ANCHOR_CONSTRAINTS = [
    # 低 r 双向控制 (v3.0 新增, 玩家初期关键)
    (0.05, "lower", 0.18), (0.05, "upper", 0.26),
    (0.15, "lower", 0.20), (0.15, "upper", 0.30),
    # 远 PB
    (0.20, "upper", 0.30), (0.30, "upper", 0.36), (0.50, "upper", 0.45),
    # 临近/破/超 PB
    (0.95, "lower", 0.55), (1.00, "lower", 0.65),
    (1.20, "lower", 0.75), (1.50, "lower", 0.85),
]
TARGET_REACH_PROBABILITIES = {
    0.50: 0.85, 0.80: 0.55, 0.95: 0.30, 1.00: 0.18, 1.20: 0.05, 1.50: 0.01,
}
```

### Shape Bin 权重(`_get_shape_bin_weights`)

```
overrides = {
    # 低 r 段 (v3.0 新增, 玩家初期业务关键)
    0: 3.0, 1: 2.5, 2: 2.0, 3: 1.5,
    # 拐点段
    7: 2.0, 8: 3.0, 9: 4.0, 10: 4.0, 11: 3.0, 12: 2.5,
    # 高超 PB
    15: 2.0,
}
# 其他 bin (4-6, 13-14, 16-19) 权重 = 1.0
```

### LossWeights 默认值

```
shape:           1.5           target_fit:      3.0    ★ 主导 (拉 model → ideal)
balance:         0.15          endpoint:        4.0   (锚 ideal, tol ±0.04)
surprise:        0.3           r_value:         0.5
breaking:        0.5           anchor:          3.0   (11 r 点, 含低 r 双向)
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
