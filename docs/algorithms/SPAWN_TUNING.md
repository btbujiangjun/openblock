# 出块参数寻优

> 本文档合并以下两份源文档：**SPAWN_TUNING_V2.md**（SpawnParamTuner 算法原理：业务目标、建模逻辑、特征工程、模型架构、损失函数、训练管线、推断部署、数据库 Schema、HTTP API）与 **SPAWN_TUNING_V2_USER_GUIDE.md**（用户操作手册：系统架构、看板 5-tab 工作流、端到端流程示例、常见问题、CLI 工具）。

---

## 一、算法原理

> **定位**：`L2 · SpawnParamTuner`（出块参数·寻优器）
> **职责**：给 `L1 · SpawnPolicyRules` 拟合 9 维 θ；**不替换**出块决策本身，**不直接产 3 块**
> **不是**：`SpawnPolicyNet`（详见 [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) §3）的前身、后续或替代品；二者层级正交、独立演进
> **总览**：双层架构与角色定义见 [`SPAWN_OVERVIEW.md`](./SPAWN_OVERVIEW.md)

### 1.1 业务目标与核心命题

通过大规模数据采样 + 深度学习模型拟合，自动找到让玩家"接近 PB 但难以超越、偶有惊喜"的算法参数 θ。

| 命题 | 量化 |
|---|---|
| **接近 PB 时加压** | `D(r ≈ 0.95)` 应显著 > `D(r ≈ 0.5)`，差值 ≥ 0.20 |
| **破 PB 后持续加压** | `D̄(r ≥ 1.0)` ≥ `D̄(r ∈ [0.9, 1.0))` |
| **甜区破 PB 率** | `P(reach r=1.0) ≈ 18%` |
| **偶尔惊喜** | `~7%` 步触发 d_step < 0.30 |

其中 `r = score / PB`，`D` 是单步难度 ∈ [0, 1]。

#### S 形难度曲线 — `target_S_curve(r)`

```
D(r) = 分段函数: [0, 0.5) 线性 gentle → [0.5, 0.7) 线性 mid → [0.7, 1.1) sigmoid brake → [1.1, 2.0] 指数 overshoot
```

跨度 0.90（D=0.10 → 1.00）是**唯一** target。

### 1.2 系统架构

四层闭环：**采样 → 训练 → 推断 → 部署 → 真实玩家反馈 → 调整**。

```
① 配置 (dashboard HTML) → ② 样本采集 (samplerV2.js, 浏览器) → ③ 异步训练 (train.py)
→ ④ 推断 (POST /predict-curve) → ⑤ 部署 (optimize_theta.py → bundle JSON)
→ ⑥ field_metrics 回流
```

后端用 Flask Blueprint + SQLite + 独立 `job_executor` 后台线程轮询任务队列。

### 1.3 建模逻辑闭环

#### 业务命题量化为 target_S_curve(r)

业务命题由设计者数学化为 `target_S_curve(r)` — 4 段分段函数，跨度 [0.10, 1.00]。这是从设计端定义的 ground truth，不来自数据。该曲线在 4 个位置同时出现：Sampler 主项、Loss `L_shape` target、Loss `L_endpoint` / `L_anchor` 硬约束、最终业务验收。

#### 样本构造

sample 必须真实反映 (ctx, θ) 配置下启发式算法 + bot 跑出来的 d_curve，**不能把 ideal target 数据泄露进 sample**。每步 `d_step` 公式：

```
d_step(t) = 0.30 · fillRate + 0.50 · (1 − action_freedom) + 0.20 · trend_norm
死局时: d_step = 1.0
惊喜事件: if clears ≥ 3: state_d *= 0.5
```

真实启发式算法跑出来的 d_curve 不是 ideal S 形，跨度也不是 ideal 的 0.80。这才是 model + θ 优化器要解决的真实问题。

#### 事实门禁 `fact_eval`

以目标 S 曲线为唯一基准，预估口径与实测口径都用「到目标的距离」打分。

| 项 | 角色 | 默认阈值 |
|---|---|---|
| **提升量 `Δ = E_meas − E_pred`** | **唯一判定** | ≥ 0.0 |
| 覆盖率 | 告警 | ≥ 0.50 |
| 高分段覆盖 | 告警 | ≥ 0.30 |

#### Model 学什么

```
Input (41 维): ctx_emb (32 维) + θ_norm (9 维)
  → ResNet-MLP trunk (8 残差块, hidden 128, GELU, dropout 0.10)
  → 6 Heads: head_curve (20D sigmoid) + 5 辅助 head
```

Loss 角色分工：
- `L_shape` (w=0.2)：拉 model → sample（真实形态）
- `L_target_fit` (w=5.0)：★ 拉 model → ideal target
- `L_endpoint` (w=12.0)：端点锚 ideal
- `L_anchor` (w=15.0)：22 r 点 hinge 关键范围
- `L_monotonic` (w=2.5)：curve 非降

#### 推断与利用

**单 ctx 推断**：给 (ctx*, default θ) → model.forward → d_curve_pred

**θ 优化（Surrogate Optimization）**：
```
for ctx in 360 stable contexts:
    best_θ = argmin_θ ‖ model(ctx, θ) − ideal_target ‖
    → PAVA 单调投影 → bundle JSON: 360 行 { context_key: θ* }
```

#### 完整闭环

```
业务命题 → target_S_curve(r) → 进入 Sampler / Loss / Bundle 验收
     ↓                                                     ↑
Sample 表 ← 训练 ResNet-MLP → Model weights → 推断 + θ 优化器
     ↓                                                     |
d_curve 分析 ← 预测 d_curve → 360 ctx × best θ → Bundle JSON
                                                         ↓
                                              客户端运行时 → field_metrics
```

### 1.4 特征工程

总输入维度 **41 = 32 ctx_emb + 9 θ**。

#### Context（5 维离散 + 1 维数值）

| 字段 | 取值 | N | embedding 维度 |
|---|---|---|---|
| `difficulty` | easy / normal / hard | 3 | 4 |
| `generator` | rule / generative | 2 | 2 |
| `bot_policy` | random / clear-greedy / survival / rl-bot | 4 | 4 |
| `pb_bin` | 500 / 1500 / 4000 / 10000 / 25000 | 5 | 8 |
| `lifecycle_stage` | onboarding / growth / mature / plateau | 4 | 8 |

加上 `log_pb` 投影 → EMB_TOTAL = 32。

#### 全 27 维 θ 一览

**组 A：候选选拔 / 个性化（5 维）** — `spawnExperiments.js`

| 字段 | (min, max) | 默认 |
|---|---|---|
| `personalizationStrength` | (0.05, 0.18) | 0.10 |
| `temperature` | (0.03, 0.08) | 0.05 |
| `surpriseBudgetGain` | (0.05, 0.10) | 0.07 |
| `surpriseCooldown` | (4, 10) | 6 |
| `maxEvaluatedTriplets` | (32, 128) | 80 |

**组 B：PB 双 S 曲线（4 维）** — `adaptiveSpawn.derivePbCurve()`

| 字段 | (min, max) | 默认 |
|---|---|---|
| `pbTensionCenter` | (0.70, 0.92) | 0.82 |
| `pbTensionWidth` | (0.04, 0.15) | 0.08 |
| `pbBrakeCenter` | (0.98, 1.15) | 1.05 |
| `pbBrakeWidth` | (0.03, 0.12) | 0.06 |

**组 C：augmentPool 乘性加权（8 维）** — `blockSpawn.generateDockShapes`

| 字段 | (min, max) | 默认 |
|---|---|---|
| `perfectClearWeight` | (15.0, 40.0) | 25.0 |
| `multiClearBaseFactor` | (0.4, 0.8) | 0.6 |
| `nearFullFactor` | (1.5, 2.5) | 2.0 |
| `exactFitBonus` | (1.2, 2.0) | 1.5 |
| `monoFlushBoost` | (0.2, 0.8) | 0.4 |
| `payoffWeight` | (1.2, 2.0) | 1.7 |
| `sizePreferenceGain` | (1.2, 2.0) | 1.5 |
| `diversityPenalty` | (0.5, 1.8) | 1.0 |

**组 D：deriveSpawnTargets 翻译矩阵（5 维）** — `adaptiveSpawn.deriveSpawnTargets`

| 字段 | (min, max) | 默认 |
|---|---|---|
| `complexityFromStress` | (0.5, 1.0) | 0.75 |
| `complexityRiskRelief` | (-0.7, -0.2) | -0.45 |
| `solutionFromStress` | (0.5, 1.0) | 0.7 |
| `pbTensionTargetWeight` | (0.05, 0.20) | 0.10 |
| `pbBrakeTargetWeight` | (0.05, 0.20) | 0.10 |

**组 E：PB 段细节弯折（5 维）** — `adaptiveSpawn.js`

| 字段 | (min, max) | 默认 |
|---|---|---|
| `challengeBoostSlope` | (0.5, 1.0) | 0.75 |
| `challengeBoostCap` | (0.12, 0.25) | 0.18 |
| `pbOvershootMax` | (0.10, 0.22) | 0.16 |
| `releaseFactor` | (0.5, 0.85) | 0.7 |
| `farFromPBBoost` | (0.30, 0.60) | 0.45 |

### 1.5 模型架构

**ResNet-MLP（主模型）**：`SpawnParamTunerResNet`，~325K 参数。Trunk: Linear(41→128) → LayerNorm → GELU → ResBlock × 8 → LayerNorm → 6 Heads。

**Transformer（备用模型）**：`SpawnParamTunerTransformer`，~200K 参数。Condition 广播到 20 bin + pos_embedding → TransformerEncoder × 4。

### 1.6 损失函数

12 项 loss 加权求和。默认权重：

| Loss | 权重 | 拉力方向 |
|---|---|---|
| `L_target_fit` | 5.0 | ★ model → ideal target |
| `L_endpoint` | 12.0 | head/tail → ideal |
| `L_anchor` | 15.0 | 22 r 点 hinge |
| `L_shape` | 0.2 | model → sample |
| `L_monotonic` | 2.5 | curve 非降 |
| 其他 8 项 | 0.15~0.5 | 业务正则 / 辅助 head |

### 1.7 训练管线

**入口**：`train.py::train()`，参数包括 `db_path`、`sample_set_ids`、`output_path`、`base_model_path`（增量训练）、`epochs`（50）、`batch_size`（256）、`lr`（1e-3）等。

**流程**：Dataset 加载 → 90/10 切分 → 模型构建（增量训练 lr×0.1）→ AdamW → LinearLR warmup + CosineAnnealingLR → 训练循环 → 验证指标（`val_ideal_mae` ★）→ EarlyStop → Save ckpt。

**13 项可视化指标**：`val_curve_mae`、`val_ideal_mae`（★ 业务核心）、`val_curve_var`、`val_anchor`、`val_monotonic`、`val_target_fit`、`val_endpoint` 等。

### 1.8 推断与部署

**推断 API**：`POST /api/spawn-tuning-v2/models/<id>/predict-curve`。

**Bundle 生成**：`optimize_theta.py::build_bundle()` 枚举 360 个稳定 ctx → PAVA 单调投影 → JSON。

**客户端消费**：`resolveThetaV2(ctx)` 查 hashmap，找不到返回 fallback。

### 1.9 关键设计决策

| 决策 | 原因 |
|---|---|
| d_curve(20D) 而非 θ 作为标签 | θ 是因，d_curve 是果 |
| PB-aware d_step + Bayesian Prior | 让 d_curve 具备 r 依赖的 S 形 |
| 全链路对齐 ★ ideal target | 三股力同向往 ideal 拉 |
| Surrogate 寻参与迭代闭环 | 防止部署阶段模型映射被丢弃 |
| 联合寻参（训练+寻参合并） | 部署耗时从 90-180s 降到 <1s |

### 1.10 数据库 Schema

4 张主表：`sample_sets`（样本集元数据）、`samples`（单样本）、`models`（模型注册表）、`jobs`（异步训练任务）。外挂表：`field_metrics`（真实玩家上报）。

### 1.11 HTTP API 端点

全部路由 prefix `/api/spawn-tuning-v2/`。样本集 CRUD、模型管理（predict / build-and-export / deploy / rollback）、任务管理、工具（target-curve / field-metrics / validate-e2e）。

---

## 二、用户操作手册

> 面向**第一次使用本系统的工程师**，演示从 0 到部署上线的完整流程。

### 2.1 系统架构一览

```
样本采集 (浏览器/小程序)
  ↓ POST /sample-sets/<id>/samples
SQLite 数据库
  ↓ 训练任务
PyTorch 模型 (ResNet-MLP 或 Transformer)
  ↓ build-and-export
离线策略 Bundle (web/public + miniprogram)
  ↓ 客户端加载
游戏运行时 (ctx → 查表 → predicted d_curve → 调整 adaptiveSpawn)
```

### 2.2 启动系统

```bash
python server.py
npm run dev
open http://localhost:5173/spawn-tuning-v2-dashboard.html
```

### 2.3 看板 5-tab 工作流

| Tab | 功能 | 典型操作 |
|---|---|---|
| ① 总览 | 系统状态卡片 + 当前 deployed model | 查看 |
| ② 样本构建 | 创建样本集 + chips 加权采集 + 预览 + 质量分析 | 采样 |
| ③ 训练 | 提交训练任务 + 任务队列 + 训练曲线 + 参数推荐 | 训练 |
| ④ 模型库 | 模型列表 + d_curve 推断 + 对比 + 删除 | 选模型 |
| ⑤ 部署 | 一键 build+export bundle + 灰度 + 状态 | 上线 |

### 2.4 端到端流程示例

**Step 1 — 采集样本（Tab ②）**：新建样本集 → 配置 chips → 加权 → 设置样本数量（建议 5000 起步）→ 开始采集 → 查看质量分析。

**Step 2 — 训练模型（Tab ③）**：选样本集 → 选模型类型（ResNet 推荐）→ 参数自动推荐 → 提交训练任务 → 观察训练曲线（★ 关注 `val_ideal_mae`）。

**Step 3 — 模型对比（Tab ④）**：勾选 ≥2 个模型 → 对比 → 选 `val_ideal_mae` 最低。

**Step 4 — 部署 Bundle（Tab ⑤）**：v3.0.9 起推荐在 Tab ③ 提交训练时勾选「训完自动部署」。也可手动选模型 → 灰度比例 → 勾选「优化 θ 寻参」→ 导出。

**Step 5 — 闭环迭代精化**：部署完 bundle 后，回到 Tab ② 重新采集，θ 来源从 LHS 切到「围绕 deployed θ\* 抖动」。

**Step 6 — 监控**：A/B 对比 `GET /api/spawn-tuning-v2/field-metrics/ab-compare?hours=168`。

### 2.5 质量分析关键指标

| 指标 | 健康值 | 不健康时怎么办 |
|---|---|---|
| 综合评分 | > 0.7 | < 0.4 时重新采集 |
| 破 PB 率 | 10-20% | < 5% 表示 bot 太弱 |
| d_curve 跨度 | > 0.4 | < 0.3 表示 d_step 计算有 bug |
| r 分布 | r<0.2 占比 < 40% | > 50% 表示 bot 弱 |
| 倒退 bin 数 | < 3 | > 5 表示算法有问题 |
| no_move 率 | 1-10% | ≈ 0% 表示模型预测无法到 ideal 顶部 |

### 2.6 收敛轨迹预期

| 迭代 | θ 来源 | 实测 MAE | 撬动 |
|---|---|---|---|
| 0 | LHS + default θ 部署 | 0.27 | baseline |
| 1 | LHS + best θ\* 部署 | 0.22-0.24 | -15% |
| 2 | bundle-perturb 采集 + best θ\* | 0.20-0.22 | -7% |
| 3+ | 同上 | 收敛 ~0.18 | -5%/轮 |

### 2.7 CLI 工具速查

```bash
# 训练
python -m rl_pytorch.spawn_tuning_v2.train \
    --db .cursor-stress-logs/spawn-tuning-v2.sqlite \
    --sample-sets 6 --output checkpoints/v2/mymodel.pt

# 修复历史样本 d_curve
python -m rl_pytorch.spawn_tuning_v2.repair_dcurves \
    --db .cursor-stress-logs/spawn-tuning-v2.sqlite --set-id 6 --apply

# 离线 build policies + bundle
python -m rl_pytorch.spawn_tuning_v2.optimize_theta \
    --checkpoint checkpoints/v2/mymodel.pt \
    --output checkpoints/v2/mymodel.policies.json
```

### 2.8 常见问题

| 问题 | 解答 |
|---|---|
| 模型预测曲线水平，没有 S 形？ | 90% 是数据问题 → 检查质量评分，重新采样 |
| Transformer 训练失败？ | LR 极敏感，推荐 1e-3，自动 cap 到 5e-3 |
| val_curve_mae 卡在 0.07-0.10？ | 理论下界，真正业务指标是 `val_ideal_mae` |
| 部署 bundle 404？ | 使用 `POST /policies/build-and-export` 一键完成 |
| 任务卡在 running？ | 检查 sidecar JSON + SQLite timeout |

### 2.9 版本历史

| 版本 | 关键修复 |
|---|---|
| v2.10 | d_step 加 PB 命题 |
| v2.10.1 | 贝叶斯先验平滑空 bin |
| v2.10.4 | 一键 build-and-export |
| v2.10.6 | 端点拉宽 |
| v2.10.7 | PAVA 单调投影 |
| **v2.10.8** | **G1-G6+G9 工业化收尾** |

### 2.10 何时考虑 v3？

当前 v2.10.8 已接近**数据可达的物理上限**。若需要模型预测 MAE vs ideal < 0.05 或 D=1.0 极端难度可达，需要 v3 工作：RL bot、真实玩家数据 fine-tune、多步 lookahead 出块算法。
