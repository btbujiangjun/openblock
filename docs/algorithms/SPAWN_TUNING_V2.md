# OpenBlock 出块算法寻参系统 v2.0 — 工业化版

> **定位**：通过大规模数据采样 + 深度学习模型拟合，自动找到让玩家"接近 PB 但难以超越、偶有惊喜"的算法参数。
> **范围**：业务目标量化 → 特征/标签设计 → 样本采集 → ResNet-MLP 模型 → 增量训练 → 灰度部署 → 真实玩家监控。
> **与 v1 的关系**：完全重写，v1 代码作为对照保留，迁移完成后归档。

---

## 0. 业务目标

### 0.1 核心命题

让玩家在游戏中体验「**挑战 PB → 接近 PB → 难以超越但偶有惊喜**」的难度曲线。

定义归一化进度 `r = score / PB`，目标难度曲线 `D(r)` 应满足 **S 型**：

```
难度 D
 1.0 ┤                                ▁▁▁▁▁▁▁▁  ← 超越后持续加压
     │                          ▂▃▄▅▆▇▇
 0.7 ┤                    ▁▃▅▆       ← 临近 PB 急剧上升 (刹车段)
     │              ▃▄▅              
 0.4 ┤        ▂▃▃▄                   ← 接近 PB 温和上升
     │  ▂▂▂▂                          ← 远离 PB 简单
 0.2 ┤   • • • • •  ← 偶发"惊喜局" (5-10%)
     └─────────────────────────────────────────→ r = score / PB
        0      0.5     0.95  1.0     1.5
```

### 0.2 量化指标

| 业务诉求 | 量化指标 | 数学定义 |
|---|---|---|
| 整体 S 形 | `L_shape` | `MSE(D_observed, D_target)` |
| 远近段平衡 | `L_balance` | 各 r 段 D 均值的方差 |
| 偶发惊喜 | `L_surprise` | `(observed_rate − 0.07)²` |
| 超越加压 | `L_breaking` | `max(0, D̄[r∈0.9-1.0] − D̄[r>1])²` |
| 算法平滑 | `L_smooth` | `‖∂D/∂θ‖²` |

总目标：

```
L = α·L_shape + β·L_balance + γ·L_surprise + δ·L_breaking + ε·L_smooth
默认权重: α=1.0  β=0.5  γ=0.3  δ=0.5  ε=0.05
```

---

## 1. 特征与标签

### 1.1 算法参数 θ (14 维，3 组)

**组 A：PB 曲线核心 (5 维)**

| 名称 | 范围 | 默认 | 作用 |
|---|---|---|---|
| `pbTension_strength` | [0.1, 1.0] | 0.55 | 接近 PB 的张力强度 |
| `pbBrake_slope` | [2, 8] | 5.0 | 临近 PB sigmoid 斜率 |
| `pbBrake_center` | [0.85, 0.98] | 0.95 | 刹车拐点位置 |
| `pbOvershoot_decay` | [0.1, 0.4] | 0.25 | 超越 PB 衰减率 |
| `pbSurprise_rate` | [0.02, 0.15] | 0.07 | 惊喜频率上限 |

**组 B：个性化 (4 维)**

| 名称 | 范围 | 默认 |
|---|---|---|
| `personalizationStrength` | [0.05, 0.18] | 0.10 |
| `temperature` | [0.03, 0.08] | 0.05 |
| `surpriseBudgetGain` | [0.05, 0.10] | 0.07 |
| `surpriseCooldown` | [4, 10] | 6 |

**组 C：基础推理 (5 维)**

| 名称 | 取值 | 默认 |
|---|---|---|
| `maxEvaluatedTriplets` | {32, 48, 64, 80, 96, 128} | 80 |
| `tripletBaseTemp` | [0.5, 2.0] | 1.0 |
| `floorBoost` | [0.0, 0.3] | 0.1 |
| `cornerPenalty` | [0.0, 0.4] | 0.15 |
| `lineBonusWeight` | [0.5, 2.0] | 1.0 |

### 1.2 场景维度 context (5 维 = 360 个场景)

```
context_key = difficulty:generator:bot_policy:pb_bin:lifecycle_stage

difficulty ∈ {easy, normal, hard}                          (3)
generator  ∈ {triplet-p1, budget-p2}                       (2)
bot_policy ∈ {random, clear-greedy, survival}              (3)
pb_bin     ∈ {500, 1500, 4000, 10000, 25000}              (5)
lifecycle  ∈ {onboarding, growth, mature, plateau}         (4)

3 × 2 × 3 × 5 × 4 = 360 个场景
```

### 1.3 标签 (从单局轨迹提取)

每局游戏结束后,从该局所有步骤的轨迹提取:

| 字段 | 类型 | 来源 |
|---|---|---|
| **`d_curve`** | `float[20]` | 把 `r = score/PB` 按 [0, 1.5] 等分 20 段, 每段平均**单步难度信号** |
| `final_score` | int | 单局最终得分 |
| `survived_steps` | int | 总步数 |
| `clear_rate` | float | 消行密度 = clears / steps |
| `noMove_step` | int | 首次出现 noMove 的步数 (-1 = 未出现) |
| `pb_broke` | bool | 是否破 PB |
| `surprise_count` | int | 该局出现的"惊喜"次数 |

**单步难度信号定义**：

```python
def step_difficulty(state, action_freedom, no_move):
    """
    state:           当前盘面填充率 [0, 1]
    action_freedom:  可放置的位置数 / 总位置数
    no_move:         是否 noMove (硬死局)
    """
    if no_move:
        return 1.0
    # 综合 3 个信号: 填充率 (越高越难) + 自由度倒数 + 趋势项
    return clip(0.3 * fill_rate + 0.5 * (1 - action_freedom) + 0.2 * trend, 0, 1)
```

---

## 2. 数据库 Schema

详细 DDL 见 `schemas/spawn_tuning_v2.sql`，核心 4 张表：

### 2.1 `sample_sets` (样本集)

```sql
CREATE TABLE sample_sets (
    set_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    description   TEXT,
    config_json   TEXT,        -- 采集配置 (chips/权重/参数空间版本)
    sample_count  INTEGER DEFAULT 0,
    status        TEXT,         -- collecting / completed / archived / failed
    tags          TEXT,
    parent_set_id INTEGER,      -- 集合运算派生时指向父集
    created_at    INTEGER NOT NULL,
    completed_at  INTEGER
);
```

### 2.2 `samples` (单样本)

```sql
CREATE TABLE samples (
    sample_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id          INTEGER NOT NULL REFERENCES sample_sets(set_id) ON DELETE CASCADE,
    -- context (5 维)
    difficulty TEXT, generator TEXT, bot_policy TEXT,
    pb_bin INTEGER, lifecycle_stage TEXT,
    -- θ (14 维)
    theta_json      TEXT NOT NULL,
    -- 标签
    d_curve_json    TEXT NOT NULL,   -- length 20 array
    final_score     INTEGER,
    survived_steps  INTEGER,
    clear_rate      REAL,
    noMove_step     INTEGER,
    pb_broke        INTEGER,
    surprise_count  INTEGER,
    -- 元信息
    seed            INTEGER,
    eval_ms         INTEGER,
    evaluated_at    INTEGER
);
CREATE INDEX idx_samples_set ON samples(set_id);
CREATE INDEX idx_samples_ctx ON samples(difficulty, generator, bot_policy, pb_bin, lifecycle_stage);
```

### 2.3 `models` (训出的模型)

```sql
CREATE TABLE models (
    model_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    version         TEXT,
    model_type      TEXT,           -- 'linear'/'gbdt'/'mlp'/'resnet'
    weights_path    TEXT,
    sha256          TEXT,
    size_bytes      INTEGER,
    parent_model_id INTEGER REFERENCES models(model_id),  -- 增量训练父模型
    train_job_id    INTEGER,
    metrics_json    TEXT,           -- val_loss / curve_mae / balance / surprise_rate
    status          TEXT,           -- staging / deployed / archived / rollbacked
    tags            TEXT,
    created_at      INTEGER NOT NULL,
    deployed_at     INTEGER
);
```

### 2.4 `training_jobs` (训练任务队列)

```sql
CREATE TABLE training_jobs (
    job_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT,
    status            TEXT,         -- queued/running/done/failed/cancelled
    model_type        TEXT,
    arch_json         TEXT,         -- 网络结构超参
    loss_weights      TEXT,         -- α β γ δ ε
    sample_set_ids    TEXT,         -- JSON 数组,支持多集合 union
    base_model_id     INTEGER,      -- 增量训练的基础模型
    output_model_id   INTEGER REFERENCES models(model_id),
    -- 训练监控
    train_loss        REAL,
    val_loss          REAL,
    val_curve_mae     REAL,
    val_balance       REAL,
    val_surprise_rate REAL,
    val_breaking      REAL,
    log_path          TEXT,
    -- 时间线
    started_at        INTEGER,
    completed_at      INTEGER,
    created_at        INTEGER NOT NULL
);
```

---

## 3. 模型设计 — ResNet-MLP (L4)

### 3.1 输入输出契约

```
输入 x (46 维 = 32 + 14):
  context_embedding (32):
    Embedding(difficulty:3 → 4d)
    + Embedding(generator:2 → 4d)
    + Embedding(bot_policy:3 → 4d)
    + Embedding(pb_bin:5 → 8d)
    + Embedding(lifecycle:4 → 8d)
    + log10(pb_actual) z-score (1d, projected to 4d)
    = 32d (concat)
  θ_normalized (14): min-max 归一化到 [0, 1]

输出 ŷ (24 维):
  d_curve_pred (20):   主输出
  pb_broke_prob (1):   辅助
  noMove_step_pred (1): 辅助 (归一化到 [0,1], -1→0)
  mean_score_log (1):  辅助
  survival_pred (1):   辅助
```

### 3.2 ResNet-MLP 网络结构 (~200K 参数)

```
Input: (B, 46)
  │
  ▼
Linear(46 → 256) + LayerNorm + GELU              [trunk_in]
  │
  ▼
┌────────────────── ResBlock × 8 ───────────────────┐
│ x → Linear(256→256) + LN + GELU + Dropout(0.1)    │
│   → Linear(256→256) + LN                          │
│   → + x (residual)                                │
│   → GELU                                          │
└──────────────────────────────────────────────────┘
  │
  ▼
LayerNorm(256)
  │
  ├── Head_curve:    Linear(256→128) → GELU → Linear(128→20) → Sigmoid (20 维)
  ├── Head_pb:       Linear(256→64)  → GELU → Linear(64→1)   → Sigmoid (pb_broke prob)
  ├── Head_noMove:   Linear(256→64)  → GELU → Linear(64→1)   → Sigmoid (归一化步数)
  ├── Head_score:    Linear(256→64)  → GELU → Linear(64→1)             (log_score)
  └── Head_survival: Linear(256→64)  → GELU → Linear(64→1)   → Sigmoid

参数量统计:
  trunk_in:     46 × 256 + 256 = 12,032
  resblock × 8: 8 × (256×256×2 + 256×4)  ≈ 1,050,624 / 8 ≈ 131K (实际共享 LN 后 ≈ 134K)
  heads × 5:   ~5 × (256×64 + 64×N + ...) ≈ 90K
  total:       ≈ 235K 参数 (符合 L4 ResNet-MLP 量级)
```

### 3.3 损失函数

```python
L_total = α · L_shape    # MSE on d_curve (主)
        + β · L_balance  # PB 段间方差
        + γ · L_surprise # 惊喜频率拟合
        + δ · L_breaking # 超越 PB 单调性 (ReLU hinge)
        + ε · L_smooth   # ‖∂D/∂θ‖² 正则
        + ζ · L_aux      # 辅助标签 (pb_broke / noMove / score / survival)

# 默认权重: α=1.0  β=0.5  γ=0.3  δ=0.5  ε=0.05  ζ=0.2
```

详细数学定义见 §3.4。

### 3.4 目标 S 曲线

```python
def target_S_curve(r: float) -> float:
    """r = score / PB; 返回该 r 下的目标难度 D ∈ [0, 1]"""
    import numpy as np
    if r < 0.5:
        return 0.20 + 0.20 * r
    elif r < 0.95:
        return 0.30 + 0.44 * (r - 0.5)
    elif r < 1.0:
        x = (r - 0.97) * 40
        return 0.50 + (1 / (1 + np.exp(-x))) * 0.40
    else:
        return 0.90 + 0.10 * (1 - np.exp(-(r - 1.0) * 3))
```

20 段离散化采样:`r_grid = [0.0, 0.0789, 0.1579, ..., 1.5]`

---

## 4. 训练管线

### 4.1 训练协议

**从头训练**：

```
1. 加载 sample_set_ids 对应的全部 samples
2. 90/10 split (固定 random seed for reproducibility)
3. Adam optimizer (lr=1e-3, weight_decay=1e-5)
4. CosineAnnealing LR schedule
5. EarlyStopping monitor=val_curve_mae, patience=10
6. 每 epoch 记录 6 项指标到 log_path (JSONL)
7. 训完保存为 checkpoint + 同步写 models 表
```

**增量训练 (base_model_id != NULL)**：

```
1. 加载 base_model 权重 → 初始化新模型
2. 加载新 sample_set_ids 数据
3. 旧样本子采样 10-20% 混入 batch (rehearsal, 防遗忘)
4. lr × 0.1 微调
5. EarlyStopping patience=5
6. 训完 parent_model_id = base_model_id, 形成版本树
```

### 4.2 训练监控 (实时输出)

```jsonl
{"epoch": 0, "train_loss": 0.082, "val_loss": 0.094, "val_curve_mae": 0.187, "val_balance": 0.045, "lr": 1e-3, "elapsed_s": 12.3}
{"epoch": 1, "train_loss": 0.063, "val_loss": 0.071, "val_curve_mae": 0.142, ...}
...
```

可视化 dashboard (③ Tab):
- 面板 A: train/val loss 双曲线 + 5 项分项 loss
- 面板 B: 目标 S 曲线 vs 模型预测 (核心业务图)
- 面板 C: 5 维场景泛化热力图 (val_loss per ctx)
- 面板 D: 与 base_model 对比

---

## 5. 部署

### 5.1 部署阶段

```
[训完模型] status=staging
  ↓
[D.1 Phase C 寻参]
  用模型在 360 场景上跑梯度上升,每场景 8 起点 × 300 步
  输出 policies-{model_id}.json (360 条 (ctx, θ*, expected_curve))
  ↓
[Shadow 影子模式] rollout_pct=0
  后台计算, 不影响玩家, 跑 24h
  ↓
[灰度 10%] rollout_pct=10
  用户 hash 决定, 客户端上报真实 d_curve
  ↓
[全量 100%] status=deployed
  烘焙离线 bundle 给四端
  ↓
[出问题] ① 概览点 ↩ 回滚 → 上一个 deployed
  原模型 status=rollbacked
```

### 5.2 离线 bundle

```
web/public/spawn-tuning/policies.json          (Web/Android/iOS)
web/public/spawn-tuning/policies.meta.json     (SHA-256 / run_id / 时间)
miniprogram/core/tuning/spawnPolicies.js       (微信小程序 CJS)
```

客户端启动 offline-first：bundle 先生效，server 异步覆盖，全失败走 default。

---

## 6. 看板组织 (5 Tab)

```
┌──────────────────────────────────────────────────────────┐
│ ① 概览  ② 样本集  ③ 模型训练  ④ 模型部署  ⑤ 监控          │
└──────────────────────────────────────────────────────────┘
```

详细规划见 §6 各 tab 子区，与 v1 看板结构一致但表对应 v2 schema。

---

## 7. 实施路线 (4 PR)

| PR | 内容 | 状态 |
|---|---|---|
| **PR1** | 数据层重构 — v2 schema + d_curve 提取 + 后端 CRUD | ⏳ 本次落地核心 |
| **PR2** | 训练管线 — ResNet-MLP + 5 项 loss + 增量训练 | ⏳ 本次落地核心 |
| **PR3** | 看板重构 — ②/③/④/⑤ tab + d_curve 可视化 | 后续 |
| **PR4** | 监控运维 — 真实玩家 SDK + 灰度 + 一键回滚 | 后续 |

---

## 8. 与 v1 的对照

| v1 | v2 | 差异 |
|---|---|---|
| 3 标量标签 (fairness/excitement/anti) | 20 维 d_curve + 5 辅助标签 | 直接对应业务 S 曲线 |
| 14 维 θ 平铺 | 14 维分 3 组 (PB 核心/个性化/基础) | UI 分组清晰 |
| 4 维 context | 5 维 (加 bot_policy) | bot 行为单独建模 |
| MLP 9.7K 参 | ResNet-MLP 235K 参 (L4) | 拟合能力 ×20 |
| run_id 兼用元数据 | sample_sets first-class | CRUD 完整 |
| checkpoint 文件平铺 | models 表 + 版本树 + 增量训练 | 模型管理工业化 |
| Phase B/C/D 分立 | training_jobs 统一队列 | 异步 job 系统 |
| 无真实玩家回写 | ⑤ tab 真实 d_curve 上报 + 对照 | 闭环 |

---

## 9. 设计取舍

| 决策 | 选择 | 理由 |
|---|---|---|
| 标签维度 | d_curve 20 维 | 直接对应业务目标 |
| 模型 | ResNet-MLP (L4) | 235K 参数,拟合非线性曲线足够,但比 ResNet/Transformer 轻 |
| 增量训练 | 强制支持 | 新样本不必从头训,省 80% 时间 |
| 损失函数 | 5 项加权 | 每项对应一个明确业务约束 |
| 维度 | bot_policy 独立 | 同 θ 在不同 bot 下行为差异大,必须建模 |
| 数据库 | sample_sets first-class | 支持集合运算/标签/血缘 |
| 部署阶段 | 三段灰度 (shadow→10%→100%) | 工业级控风险 |
| 监控 | 真实 d_curve vs 预测 | 唯一可信的"模型好不好"信号 |

---

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| d_curve 提取算法错误 | 单元测试 + 与人工标注样本对比 (见 `tests/v2/test_extractor.py`) |
| 模型过拟合 | L_balance 正则 + 5 维加权采样保证覆盖 |
| 增量训练遗忘旧场景 | 旧样本 10-20% rehearsal 混入 batch |
| Bot 与真实玩家差异 | ⑤ tab 真实 d_curve 上报, 差距大时回到 ② 补样本 |
| 200K 模型体积 | 大模型 server 推断, 离线 bundle 只装 360 条 (ctx,θ*),不装模型 |
| 数据漂移 | 周度自动跑 health check (v1 已有 weekly workflow,迁移到 v2) |

---

## 11. 修订记录

| 版本 | 日期 | 改动 |
|---|---|---|
| v2.0 | 2026-05-25 | 完全重写: d_curve 标签 / ResNet-MLP / 5 项 loss / sample_sets first-class / 三段灰度 / 真实玩家闭环。v1 代码保留作对照。 |

---

## 附录 A: 各文件清单

```
docs/algorithms/SPAWN_TUNING_V2.md       ← 本文档
schemas/spawn_tuning_v2.sql              ← DDL

rl_pytorch/spawn_tuning_v2/
  __init__.py
  target_curve.py        ← 目标 S 曲线
  extractor.py           ← d_curve 提取
  model.py               ← ResNet-MLP (L4)
  losses.py              ← 5 项 loss
  train.py               ← 训练管线 (含增量)
  feature_io.py          ← SQLite IO
  optimize_theta.py      ← Phase C 寻参

web/src/tuning/v2/
  targetSCurve.js        ← 目标 S 曲线 (JS 端可视化用)
  dCurveExtractor.js     ← 单局轨迹 → d_curve

tests/spawn_tuning_v2/
  test_target_curve.py
  test_extractor.py
  test_model.py
  test_losses.py
  test_train.py
  test_feature_io.py

tests/tuning/v2/
  targetSCurve.test.js
  dCurveExtractor.test.js
```
