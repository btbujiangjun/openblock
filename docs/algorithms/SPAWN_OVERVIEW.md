# 出块算法系统总览

> **定位**：出块算法的双层叙事入口，消除「神经版出块」与「参数寻优」的命名混淆。  
> **范围**：仅梳理职责轴与术语契约，不重复各子系统的实现细节（链接到对应文档）。  
> **维护要求**：任何新增 / 重命名 `SpawnPolicy*` 或 `SpawnParam*` 角色时，必须同步本文 §2 表与 §3 词典。

---

## 1. 一图入门

出块算法分两层，**沿不同轴独立演进**：

```
┌────────────────────── L1 · SpawnPolicy 层 ──────────────────────┐
│  职责：给玩家产 dock triplet（3 个候选块）                        │
│  契约：board + ctx + history  →  {shape_id × 3}                  │
│                                                                  │
│    ├── SpawnPolicyRules     ◆ 当前权威主路径                      │
│    │     启发式规则 + 加权乘子 + 硬约束拒绝采样                    │
│    │     web/src/bot/blockSpawn.js · adaptiveSpawn.js            │
│    │                                                             │
│    └── SpawnPolicyNet       ◇ 可切换分支，失败自动回退 Rules       │
│          Transformer 学条件分布 P(s₁,s₂,s₃ | board, ctx₅₆, hist)  │
│          rl_pytorch/spawn_model/ · web/src/spawnModel.js         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 消费 9 维 θ
                           ▼
┌────────────────────── L2 · SpawnParam 层 ──────────────────────┐
│  职责：给 L1 挑参数 θ（不参与决策本身）                          │
│  契约：(ctx₅, θ₉)  →  d_curve₂₀                                 │
│                                                                 │
│    ├── HandTuned            ◆ 当前权威                          │
│    │     game_rules.json + DEFAULT_PB_CURVE_PARAMS 硬编码常数    │
│    │                                                            │
│    └── SpawnParamTuner      ◇ 工业化寻参                        │
│          ResNet-MLP 拟合 (ctx, θ) → d_curve + 梯度上升搜 θ*      │
│          rl_pytorch/spawn_tuning_v2/ · web/src/tuning/v2/        │
└─────────────────────────────────────────────────────────────────┘

闭环：field_metrics 真实玩家上报 d_curve → ⑤ Tab 三线对照 → 增量训练
```

---

## 2. 四个角色定义

| 角色 | 层 | 输入契约 | 输出契约 | 当前文件入口 | 详细文档 |
|---|---|---|---|---|---|
| **`SpawnPolicyRules`** | L1 | `grid + strategyConfig + spawnContext` | `{shape_id × 3} + _spawnDiagnostics` | `web/src/bot/blockSpawn.js · generateDockShapes()` | [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md) |
| **`SpawnPolicyNet`** | L1 | `board(64) + behaviorContext(56) + history(3×3) + target_difficulty` | `{shape_id × 3}`（top-k 采样） | `rl_pytorch/spawn_model/model_v3.py · SpawnTransformerV3` | [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) §3 |
| **`HandTuned`** | L2 | — | θ ∈ `game_rules.json + DEFAULT_PB_CURVE_PARAMS` | `web/src/adaptiveSpawn.js` + `shared/game_rules.json` | [`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) |
| **`SpawnParamTuner`** | L2 | `(ctx₅, θ₉)` | `d_curve₂₀ + 4 辅助 head` → 反求 θ* | `rl_pytorch/spawn_tuning_v2/model.py · SpawnTuningResNetMLP` | [`SPAWN_TUNING_V2.md`](./SPAWN_TUNING_V2.md) |

---

## 3. 常见误读 vs 正读

| ❌ 误读 | ✅ 正读 |
|---|---|
| 「`SpawnParamTuner` 是 `SpawnPolicyNet` 的下一代」 | 二者在不同层，**职责正交**：一个产 θ，一个产 3 块 |
| 「`SpawnPolicyNet` 替代了 `SpawnPolicyRules`」 | 二者同层互斥；`SpawnPolicyNet` 上线必须以 `SpawnPolicyRules` 为回退兜底 |
| 「V3.1 / V2 是同一项目的两代版本」 | 是两个**独立项目**的内部版本号，分别属于 L1 / L2，**无继承关系** |
| 「调好 `SpawnParamTuner` 就能取代调 `game_rules.json`」 | `SpawnParamTuner` 只搜 9 维 θ；其余规则参数仍需 `HandTuned` 维护 |
| 「`SpawnParamTuner` 输出 θ 只对规则版生效」 | 实际上：`pbTension/pbBrake` 4 个 θ 同时被 `SpawnPolicyRules` 和 `SpawnPolicyNet` 的 `target_difficulty` 公式消费 |
| 「`SpawnPolicyNet` 推理失败会怎样？」 | 自动回退到 `SpawnPolicyRules`，玩家无感（见 `web/src/game.js · _spawnBlocksWithModel`） |

---

## 4. 术语词典（仅一次定义，全仓引用）

| 术语 | 中文 | 所属层 | 维度 | 取值示例 |
|---|---|---|---|---|
| `SpawnPolicy` | 出块策略 | L1 | — | `Rules` / `Net` |
| `SpawnParam` (θ) | 出块参数 | L1 输入 / L2 输出 | 9 | `{personalizationStrength: 0.10, temperature: 0.05, pbTensionCenter: 0.82, ...}` |
| `d_curve` | 难度曲线 | L2 标签 | 20 | 把 `r = score/PB ∈ [0, 2.0]` 等分 20 段的单步难度均值 |
| `context_key` | L2 场景维度 | L2 输入 | 5 | `easy:budget-p2:survival:1500:growth` 形式（共 360 个场景） |
| `behaviorContext` | L1 神经版输入 | L1 输入 | 56 | 见 `SPAWN_BLOCK_MODELING.md §3.3` |
| `spawnHints` | L1 规则版软目标 | L1 内部 | 字典 | 见 `SPAWN_ALGORITHM.md §2.5.2` |
| `spawnTargets` | stress 投影多轴目标 | L1 内部 | 6 | 见 `ADAPTIVE_SPAWN.md` |
| `Policies bundle` | 部署包 | L2 → L1 | 360 条 | `web/public/spawn-tuning-v2/policies.json`（URL 保留 v2 历史路径） |
| `field_metrics` | 真实玩家上报闭环 | L2 反馈 | 表 | `spawn_tuning_v2_backend.py · field_metrics 表` |

> ⚠️ **废弃术语**（不再在新代码 / 文档中使用）：`Spawn Generator`、`SpawnTransformer`、`Spawn Tuning`、`Spawn Model`（裸名）。这些词义穿透多层，已被上表角色名替代。

---

## 5. 数据契约：`SPAWN_PARAM_KEYS`（9 维 θ）

L1 与 L2 通过 θ 通信。`SpawnParamTuner` 输出 θ\*，`SpawnPolicyRules` 消费 θ：

```
组 A: 个性化 + 选拔 (5 维) — 由 spawnExperiments.js 消费
  personalizationStrength  ∈ [0.05, 0.18]  默认 0.10
  temperature              ∈ [0.03, 0.08]  默认 0.05
  surpriseBudgetGain       ∈ [0.05, 0.10]  默认 0.07
  surpriseCooldown         ∈ [4, 10]       默认 6
  maxEvaluatedTriplets     ∈ {32,48,64,80,96,128}  默认 80

组 B: PB 双 S 曲线 (4 维) — 由 adaptiveSpawn.js · derivePbCurve 消费
  pbTensionCenter          ∈ [0.70, 0.92]  默认 0.82
  pbTensionWidth           ∈ [0.04, 0.15]  默认 0.08
  pbBrakeCenter            ∈ [0.98, 1.15]  默认 1.05
  pbBrakeWidth             ∈ [0.03, 0.12]  默认 0.06
```

**演进契约**：任何后续新增 θ 必须 **先在 `simulator/adaptiveSpawn/spawnExperiments` 接入并真实生效**，再加入 `SPAWN_PARAM_KEYS`。否则 `SpawnParamTuner` 学到的只是噪声（v2.0 → v2.1 教训）。

---

## 6. 切换矩阵（运行时）

| L1 选择 | L2 来源 | 触发方式 | 备注 |
|---|---|---|---|
| `SpawnPolicyRules` | `HandTuned` | 默认 | 零模型依赖 |
| `SpawnPolicyRules` | `SpawnParamTuner` | `policies.json` 加载成功 | 当前线上灰度形态 |
| `SpawnPolicyNet` | `HandTuned` | `getSpawnMode() === 'model-v3'` | `target_difficulty` 用默认 0.5 / 手动覆盖 |
| `SpawnPolicyNet` | `SpawnParamTuner` | 同时启用 | 仅 PB 曲线 4 参数生效；其余 5 参数不被 Net 消费 |
| 任意 L1 失败 | — | 异常 / 推理超时 | 永远回退到 `SpawnPolicyRules + HandTuned` 默认兜底 |

---

## 7. 命名规范（PR 检查项）

| 场景 | 用 | 不用 |
|---|---|---|
| 新建类 / 常量前缀 | `SpawnPolicy*` / `SpawnParam*` | `SpawnTransformer*` / `SpawnTuning*` |
| 新建文档标题 | 含角色名（如 `SpawnPolicyNet`） | 仅写「出块模型」「Spawn Model」 |
| 提及版本 | 写在内部字段（`__version__`） | 写在产品命名 / 公共 API |
| 跨文档引用 | 链接 `SPAWN_OVERVIEW.md` | 散落各处自由定义 |

---

## 8. 演进与负责人

| 角色 | 当前状态 | 主要演进方向 |
|---|---|---|
| `SpawnPolicyRules` | 线上权威 | shapeWeights / spawnHints 精细化、PB 段差异化 |
| `SpawnPolicyNet` | 可切换实验 | 数据扩量、LoRA 个性化、playstyle 嵌入 |
| `HandTuned` | 配置维护 | 与 `SpawnParamTuner` 共存，作为冷启动与回退基线 |
| `SpawnParamTuner` | 工业化收尾（v2.10.8） | 真实流量回写、增量训练自动化 |

---

## 9. 修订记录

| 日期 | 改动 |
|---|---|
| 2026-05-26 | 初版：建立 L1/L2 双层叙事，定义 `SpawnPolicyRules / SpawnPolicyNet / HandTuned / SpawnParamTuner` 四角色与命名规范 |
