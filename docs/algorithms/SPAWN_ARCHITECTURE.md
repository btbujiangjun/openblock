# 出块算法：架构总览

> 本文档合并以下三份源文档：**SPAWN_OVERVIEW.md**（出块算法系统总览：L1/L2 角色定义、术语契约、切换矩阵）、**SPAWN_ALGORITHM.md**（出块算法三层架构：数据流、策略翻译机制、Layer 1/2/3 实现细节）与 **SPAWN_DIAGRAM_PROMPT.md**（架构图生成 Prompt：8 层流水线 Prompt、视觉规范、派生用法）。三者在同一命名空间下互为引用，现已整合为单篇架构总览。

---

## 一、出块算法系统总览

> **定位**：出块算法的双层叙事入口，消除「神经版出块」与「参数寻优」的命名混淆。  
> **范围**：仅梳理职责轴与术语契约，不重复各子系统的实现细节（链接到对应文档）。  
> **维护要求**：任何新增 / 重命名 `SpawnPolicy*` 或 `SpawnParam*` 角色时，必须同步本文 §2 表与 §3 词典。

---

### 1.1 一图入门

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
│          Transformer 学条件分布 P(s₁,s₂,s₃ | board, ctx₆₁, hist)  │
│          rl_pytorch/spawn_model/ · web/src/spawnModel.js         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 消费 9 维 θ
                           ▼
┌────────────────────── L2 · SpawnParam 层 ──────────────────────┐
│  职责：给 L1 挑参数 θ（不参与决策本身）                            │
│  契约：(ctx₅, θ₉)  →  d_curve₂₀                                 │
│                                                                  │
│    ├── HandTuned            ◆ 当前权威                          │
│    │     game_rules.json + DEFAULT_SPAWN_PARAMS_PB_CURVE 硬编码常数    │
│    │                                                            │
│    └── SpawnParamTuner      ◇ 工业化寻参                        │
│          ResNet-MLP 拟合 (ctx, θ) → d_curve + 梯度上升搜 θ*      │
│          rl_pytorch/spawn_tuning_v2/ · web/src/tuning/v2/        │
└─────────────────────────────────────────────────────────────────┘

闭环：field_metrics 真实玩家上报 d_curve → ⑤ Tab 三线对照 → 增量训练
```

### 1.2 四个角色定义

| 角色 | 层 | 输入契约 | 输出契约 | 当前文件入口 | 详细文档 |
|---|---|---|---|---|---|
| **`SpawnPolicyRules`** | L1 | `grid + strategyConfig + spawnContext` | `{shape_id × 3} + _spawnDiagnostics` | `web/src/bot/blockSpawn.js · generateDockShapes()` | [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md) |
| **`SpawnPolicyNet`** | L1 | `board(64) + behaviorContext(63) + history(3×3) + target_difficulty` | `{shape_id × 3}`（top-k 采样） | `rl_pytorch/spawn_model/model_v3.py · SpawnPolicyNet` | [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) §3 |
| **`HandTuned`** | L2 | — | θ ∈ `game_rules.json + DEFAULT_SPAWN_PARAMS_PB_CURVE` | `web/src/adaptiveSpawn.js` + `shared/game_rules.json` | [`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) |
| **`SpawnParamTuner`** | L2 | `(ctx₅, θ₉)` | `d_curve₂₀ + 4 辅助 head` → 反求 θ* | `rl_pytorch/spawn_tuning_v2/model.py · SpawnParamTunerResNet` | [`SPAWN_TUNING_V2.md`](./SPAWN_TUNING_V2.md) |

### 1.3 常见误读 vs 正读

| ❌ 误读 | ✅ 正读 |
|---|---|
| 「`SpawnParamTuner` 是 `SpawnPolicyNet` 的下一代」 | 二者在不同层，**职责正交**：一个产 θ，一个产 3 块 |
| 「`SpawnPolicyNet` 替代了 `SpawnPolicyRules`」 | 二者同层互斥；`SpawnPolicyNet` 上线必须以 `SpawnPolicyRules` 为回退兜底 |
| 「调好 `SpawnParamTuner` 就能取代调 `game_rules.json`」 | `SpawnParamTuner` 只搜 9 维 θ；其余规则参数仍需 `HandTuned` 维护 |
| 「`SpawnParamTuner` 输出 θ 只对规则版生效」 | 实际上：B 组 4 个 PB 曲线 θ 经 `derivePbCurve → spawnTargets` 调制，而 `spawnTargets` 又是 `SpawnPolicyNet` 的 `behaviorContext[39–43]` 输入段，故 Net 也间接被这 4 个 θ 影响（A 组 5 个 θ 只进规则实验轨，不进 Net）。注意：耦合通道是 **`spawnTargets / behaviorContext`**，而非 `target_difficulty`——后者吃的 `stress` 在 `derivePbCurve` 之前已算定，不携带 θ。**v1.61.0** 起这 4 个 θ 还作为 `behaviorContext[57–60]` 的**显式条件输入**，使 Net 可对 θ 泛化（治本防分布漂移），并由 `spawn_model/drift.py` 做 PSI 漂移门禁兜底 |
| 「`SpawnPolicyNet` 推理失败会怎样？」 | 自动回退到 `SpawnPolicyRules`，玩家无感（见 `web/src/game.js · _spawnBlocksWithModel`） |

### 1.4 术语词典（仅一次定义，全仓引用）

| 术语 | 中文 | 所属层 | 维度 | 取值示例 |
|---|---|---|---|---|
| `SpawnPolicy` | 出块策略 | L1 | — | `Rules` / `Net` |
| `SpawnParam` (θ) | 出块参数 | L1 输入 / L2 输出 | 9 | `{personalizationStrength: 0.10, temperature: 0.05, pbTensionCenter: 0.82, ...}` |
| `d_curve` | 难度曲线 | L2 标签 | 20 | 把 `r = score/PB ∈ [0, 2.0]` 等分 20 段的单步难度均值 |
| `context_key` | L2 场景维度 | L2 输入 | 5 | `easy:budget-p2:survival:1500:growth` 形式（共 360 个场景） |
| `behaviorContext` | L1 神经版输入 | L1 输入 | 63 | 见 `SPAWN_BLOCK_MODELING.md §3.3`（v1.61.0 含 4 维 PB θ；v1.66 P7 含 2 维客观几何） |
| `spawnHints` | L1 规则版软目标 | L1 内部 | 字典 | 见 `SPAWN_ALGORITHM.md §2.5.2` |
| `spawnTargets` | stress 投影多轴目标 | L1 内部 | 6 | 见 `ADAPTIVE_SPAWN.md` |
| `Policies bundle` | 部署包 | L2 → L1 | 360 条 | `web/public/spawn-tuning-v2/policies.json`（URL 保留 v2 历史路径） |
| `field_metrics` | 真实玩家上报闭环 | L2 反馈 | 表 | `backend/spawn_tuning_v2_backend.py · field_metrics 表` |

> ⚠️ **历史名称**（仅在 git log / 老文档归档中可能见到，仓库代码已彻底清除）：
> `SpawnTransformerV3` / `SpawnTransformerV3.1`（→ `SpawnPolicyNet`）、`SpawnTuningResNetMLP`（→ `SpawnParamTunerResNet`）、`SpawnTuningTransformer`（→ `SpawnParamTunerTransformer`）、`getSpawnMode`（→ `getSpawnPolicyMode`）、`SPAWN_GENERATOR_*`（→ `SPAWN_POLICY_RULES*`）、`DEFAULT_PB_CURVE_PARAMS`（→ `DEFAULT_SPAWN_PARAMS_PB_CURVE`）。  
> ⚠️ **保留旧名**（不属于产品命名空间，仍在使用）：`SpawnTransformerV2`（spawn_model 包内部历史 V2 实现，仅供旧 checkpoint 兼容）、`SPAWN_MODE_RULE` / `SPAWN_MODE_MODEL_V3`（localStorage 模式字符串常量，与 `SPAWN_POLICY_RULES` 命名空间不冲突）。

### 1.5 数据契约：`SPAWN_PARAM_KEYS`（9 维 θ）

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

### 1.6 切换矩阵（运行时）

| L1 选择 | L2 来源 | 触发方式 | 备注 |
|---|---|---|---|
| `SpawnPolicyRules` | `HandTuned` | 默认 | 零模型依赖 |
| `SpawnPolicyRules` | `SpawnParamTuner` | `policies.json` 加载成功 | 当前线上灰度形态 |
| `SpawnPolicyNet` | `HandTuned` | `getSpawnPolicyMode() === 'model-v3'` | `target_difficulty` 用默认 0.5 / 手动覆盖 |
| `SpawnPolicyNet` | `SpawnParamTuner` | 同时启用 | 仅 B 组 PB 曲线 4 参数经 `spawnTargets → behaviorContext[39–43]` 间接生效；A 组 5 参数不被 Net 消费 |
| 任意 L1 失败 | — | 异常 / 推理超时 | 永远回退到 `SpawnPolicyRules + HandTuned` 默认兜底 |

### 1.7 命名规范（PR 检查项）

| 场景 | 用 | 不用 |
|---|---|---|
| 新建类 / 常量前缀 | `SpawnPolicy*` / `SpawnParam*` | `SpawnTransformer*` / `SpawnTuning*` / `Spawn Generator*` |
| 新建文档标题 | 含角色名（如 `SpawnPolicyNet`） | 仅写「出块模型」「Spawn Model」 |
| 提及版本 | 写在内部字段（`__version__`） / `'v3.1'` 字符串 | 写在产品命名 / 公共 API |
| 跨文档引用 | 链接 `SPAWN_OVERVIEW.md` | 散落各处自由定义 |
| 命名 alias | 严格禁止（仓库**零 alias 政策**） | `NewName = OldName` 风格的兼容 alias |

### 1.8 演进与负责人

| 角色 | 当前状态 | 主要演进方向 |
|---|---|---|
| `SpawnPolicyRules` | 线上权威 | shapeWeights / spawnHints 精细化、PB 段差异化 |
| `SpawnPolicyNet` | 可切换实验 | 数据扩量、LoRA 个性化、playstyle 嵌入 |
| `HandTuned` | 配置维护 | 与 `SpawnParamTuner` 共存，作为冷启动与回退基线 |
| `SpawnParamTuner` | 工业化收尾（v2.10.8） | 真实流量回写、增量训练自动化 |

### 1.9 修订记录

| 日期 | 改动 |
|---|---|
| 2026-06-03 | v1.66 P7：behaviorContext 61→63（尾部加 2 维客观几何 `contiguousRegions/concaveCorners`，与 RL state 同源）；`board_proj` 125→127；`PLAYER_STATE_SNAPSHOT_VERSION` 3→4（spawnGeo 增几何字段）；回放/DFV 同步外露几何 |
| 2026-06-03 | v1.66 同源化：v2 `d_step` 真人局优先用统一难度分 scd_score 作 `state_d`（`StepInfo.state_difficulty`，缺则回退代理）；DFV chosen 块 tooltip 外露盘面几何（碎片/凹角/占盘） |
| 2026-05-29 | v1.61.0：behaviorContext 56→61（含 4 维 PB θ 显式条件，把 L2→L1-Net 隐式耦合转显式）；澄清耦合通道为 `spawnTargets/behaviorContext`（非 `target_difficulty`）；新增 `drift.py` PSI 漂移门禁 |
| 2026-05-26 | 初版：建立 L1/L2 双层叙事，定义 `SpawnPolicyRules / SpawnPolicyNet / HandTuned / SpawnParamTuner` 四角色与命名规范 |
| 2026-05-26 | PR-4 彻底统一：物理重命名所有 class / 函数 / 常量为角色名（`SpawnTransformerV3 → SpawnPolicyNet` 等），删除全部 alias 与 shim，确立**零 alias 政策** |

---

## 二、出块算法三层架构

> 📍 **本文档定位**：`L1 · SpawnPolicyRules`（出块策略·规则版）  
> 📐 **职责轴**：用启发式规则 + 加权乘子 + 硬约束直接产 3 块，**不涉及**参数寻优  
> ⚠️ **不是**：`SpawnPolicyNet`（神经版出块决策，详见 [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md) §3）的前身/后续；也**不是** `SpawnParamTuner`（参数寻优器，详见 [`SPAWN_TUNING_V2.md`](./SPAWN_TUNING_V2.md)）

> 建模思路、优化目标、特征与网络结构的形式化说明见 [`SPAWN_BLOCK_MODELING.md`](./SPAWN_BLOCK_MODELING.md)。

### 2.1 概述

出块算法是 Open Block 的核心体验引擎，决定了每轮为玩家提供哪三个候选方块。算法采用**三层架构**，从即时盘面到跨局体验，逐层叠加影响：

```
┌─────────────────────────────────────────────┐
│  Layer 3: 局间体验 (Cross-Game)              │
│  session 弧线 · 里程碑庆祝 · 回流玩家热身    │
├─────────────────────────────────────────────┤
│  Layer 2: 局内体感 (Within-Game)             │
│  combo 链催化 · 爽感兑现 · 多消鼓励 · multiLineTarget · 节奏 setup/payoff │
│  品类记忆 · 多样性                            │
├─────────────────────────────────────────────┤
│  Layer 1: 即时出块 (Immediate)               │
│  盘面拓扑 · 多消潜力 · 空洞修复 · 反死局     │
│  机动性保障 · 可解性验证                      │
└─────────────────────────────────────────────┘
         ↑ 盘面状态 (Grid)
```

> **一图入门**：下图是 `generateDockShapes` 的 9 层端到端流水线全览，对应 §2.5 的 5 阶段分解（盘面感知 → 评分 → 优先选拔 → 加权补齐 → 约束验证 → 注入优化 → 输出 → 染色）：
>
> ![出块算法架构图：9层流水线（输入层→染色层）](./assets/spawn-architecture.png)

### 2.2 数据流

```
game.js
  ├── 构建 spawnContext {lastClearCount, roundsSinceClear, recentCategories, totalRounds, scoreMilestone,
  │       nearFullLines, pcSetup（上轮诊断回写）, warmupRemaining / warmupClearBoost（局间热身，可选）}
  │
  ├── adaptiveSpawn.js ← resolveAdaptiveStrategy(strategy, profile, score, runStreak, fill, spawnContext)
  │     ├── Layer 3: deriveSessionArc(), checkMilestone()
  │     ├── Layer 2: deriveComboChain(), deriveMultiClearBonus(), deriveMultiLineTarget(), deriveRhythmPhase()
  │     ├── 爽感兑现: deriveDelightTuning()（能力/心流/动量/恢复需求 → 多消/清屏偏置）
  │     ├── 多维信号 → stress → interpolateProfileWeights → shapeWeights
  │     └── 输出: { shapeWeights, spawnHints: {clearGuarantee, sizePreference, diversityBoost,
  │                  comboChain, multiClearBonus, multiLineTarget, delightBoost, perfectClearBoost,
  │                  delightMode, rhythmPhase, sessionArc, scoreMilestone} }
  │
  └── blockSpawn.js ← generateDockShapes(grid, strategyConfig, spawnContext)
        ├── Layer 1: analyzeBoardTopology() → {holes, flatness, nearFullLines, colHeights}
        ├── Layer 1: bestMultiClearPotential() — 每个形状的最大同消行数
        ├── Layer 1: bestHoleReduction() — 放置后空洞减少量
        ├── 阶段 1: 消行候选选取（clearGuarantee + combo 催化 + 爽感兑现 + 多消/清屏优先排序）
        ├── 阶段 2: 加权抽样（三层信号整合到权重乘子；`multiLineTarget`≥2 或 `delightBoost` 高时强化 multiClear≥2）
        ├── 校验: minMobilityTarget + tripletSequentiallySolvable
        └── 输出: 三连块 + _spawnDiagnostics（供面板解释）

_commitSpawn()（颜色分配）
  ├── clearScoring.monoNearFullLineColorWeights(grid, skin)
  │     └── 扫描差 1~2 格即满的行列；若已填格同 icon（有 blockIcons）或同色（无 icon）
  │        则给对应 dock 色位累加偏置权重
  ├── clearScoring.pickThreeDockColors(biasWeights)
  │     └── 8 色池无放回加权抽样，输出 3 个互异 colorIdx
  └── descriptors[i].colorIdx = dockColors[i]
```

### 2.3 颜色采样与 bonus 计分目标对齐

此前 dock 颜色使用纯洗牌（随机前三色），与"同 icon/同色 bonus 线"的计分目标是弱耦合。颜色分配改为**轻偏置随机**：

- **目标不变**：形状可解性与保命逻辑仍由 `blockSpawn.js` 主导；
- **颜色侧软目标**：当盘面存在"近满且已同 icon/同色"的行列时，提升相关色在当前 3 个候选块中的出现概率；
- **随机性保留**：采用无放回加权抽样而非硬指定，避免玩家感知"被喂牌过重"。

**RL 训练环境（PyTorch / MLX，v1.68+）**：形状生成默认经 `scripts/rl-spawn-worker.mjs` → `web/src/bot/rlSpawnBridge.js`，与真人规则轨 `adaptiveSpawn` + `blockSpawn` 一致；`RL_SPAWN_ONLINE=0` 时回退 `rl_pytorch/block_spawn.py`。dock 颜色由 `rl_pytorch/dock_color_bias.py`（及 `rl_mlx` 副本）与 `clearScoring` 偏置对齐。三条路径对照见 [`RL_CONTRACT_AND_SERVICE.md` §2.6](./RL_CONTRACT_AND_SERVICE.md#26-rl-训练机制三条路径对照权威)。

### 2.4 策略 → 出块翻译机制

`generateDockShapes` (`web/src/bot/blockSpawn.js:540`) 是从「策略 hints」到「3 个 Shape」的实际抽块器。**它不是一个 argmax 选择器，而是一个「概率分布塑形 + 多层过滤」过程**：

```
策略层输出（adaptiveSpawn.js → layered = { shapeWeights, spawnHints, spawnTargets, ... }）
    │
    ▼ generateDockShapes(grid, layered, ctx)
    │
[阶段 0] 解包 hints / shapeWeights / spawnTargets / ctx                     (blockSpawn.js:540-580)
    │
[阶段 1] 候选池构建：28 个 shape 逐个评分                                    (:583-628)
    │   产物：scored[]（每条带 6 维属性：placements / multiClear / pcPotential
    │              / gapFills / holeReduce / weight）
    │   排序：清屏 > 多消 > 消行（保证清屏一手永远在最前）
    │
[阶段 2] 清屏 / 消行优先槽位                                                 (:695-751)
    │   规则：clearGuarantee + comboChain + clearOpportunityTarget → 决定占几槽
    │   特例：见到 pcPotential===2 一手清屏 → 直接抢占；
    │        pcSetup≥2 / perfectClearBoost≥0.9 → 3 槽全用消行
    │   产物：blocks[0..N]，N ∈ {0..3}
    │
[阶段 3] 加权抽样补齐（augmentPool）                                          (:753-877)
    │   把 30+ 条 hints / spawnTargets / ctx 翻译为乘子（详见策略翻译表），
    │   按 pickWeighted 轮盘抽样 —— 不是 argmax，保留随机感
    │
[阶段 4] 硬约束校验循环（最多 MAX_SPAWN_ATTEMPTS 次）                          (:903-985)
    │   ① 最低机动性    minPc ≥ mobTarget(fill, attempt)
    │   ② 序贯可解性    tripletSequentiallySolvable（fill≥0.52 才检）
    │   ③ 解法数量软过滤 targetSolutionRange.min/max
    │   ④ 解空间压力    solutionSpacePressure 双边
    │   ⑤ 顺序刚性硬过滤 validPerms ≤ orderMaxValidPerms
    │   任一失败 → continue 重抽（早期严格、后期渐进放松，避免死循环）
    │
[阶段 5] 打乱顺序 → 写诊断（diagnostics）→ 返回 3 个 Shape                    (:987-1005)
```

#### 策略 → 出块翻译表

按"出块层消费方式"分 3 类：

**A. 决定"哪些块直接进消行槽位"（阶段 2 占位）**

| 策略输入 | 转译规则 | 出块层效果 |
|---|---|---|
| `clearGuarantee` (0..3) | `effectiveClearTarget = clearTarget + (comboChain>0.5?1:0) + (clearOpp≥0.72?1:0)` | 至少几个槽留给"能消行"的块 |
| `perfectClearBoost ≥ 0.9` 或 `pcSetup ≥ 2` | `clearSeats = min(3, candidates)` | **3 槽全部强制是消行块** |
| `delightBoost > 0.65` 或 `nearFullLines ≥ 4` | `maxClearSeats = 3` | 允许 3 槽全消行 |
| `multiClearBonus > 0.3` / `delightBoost > 0.25` / `multiLineTarget ≥ 2` | 优先从 `multiClear≥2` 池中抽 | 消行槽里偏好**多消块** |
| 任意候选 `pcPotential === 2` | 直接占第一个槽 | **见到一手清屏就抢占** |

**B. 决定"剩下槽位选什么"（阶段 3 加权乘子）**

30+ 条乘子叠乘。`w` 初值 = `shapeWeights[category]`，然后逐条相乘。关键乘子包括：fill 自适应机动性、空洞修复、清屏一手（×18~32）、清屏准备（×4~7+）、多消（×1.6~2.7+）、multiLineTarget、rhythmPhase payoff、comboChain、sizePreference、spatialPressureTarget、diversityBoost、clearGuarantee 补足、scoreMilestone 等。

**C. 决定"3 块能不能一起出"（阶段 4 硬约束）**

| 策略 | 校验公式 | 失败行为 |
|---|---|---|
| 最低机动性 | `min(placements₁₋₃) ≥ mobTarget(fill, attempt)` | continue 重抽 |
| 序贯可解性 | `fill≥0.52` 时 `tripletSequentiallySolvable`（DFS 搜索 3! 种顺序） | continue |
| `targetSolutionRange` | `solutionCount ∈ [min, max]` | tooFew / tooMany 拒绝 |
| `solutionSpacePressure` 双边 | ≥0.78 → 解法数 ≤48；≤0.22 → firstMoveFreedom≥5 | 控制绝对解法数 |
| `orderRigor` 顺序刚性 | `validPerms ≤ orderMaxValidPerms` | 强制规划顺序 |

### 2.5 难度调控杠杆层级（基于 SGAZ 实证）

| 优先级 | 杠杆 | 实证强度 | OpenBlock 现状 |
|---|---|---|---|
| 1 | **候选块数 `dock` / `h`** | ★★★ 最强 | ✗ 固定 `dock=3`，从未浮动 |
| 2 | **形状库扩充**（pentomino） | ★★ 强 | ✓ 28 → 40 形状，gate + 加权 |
| 3 | **`shapeWeights` profile 插值** | 中 | ✓ 10 档 profile × 17 stress 分量 |
| 4 | **预览数 `preview` / `p`** | ★ 弱 | ✗ 无 preview 机制 |

### 2.6 PB 距离段倾斜

在 `blockSpawn.js` 的 `augmentPool` 末尾有一条**远征段多消潜力倾斜**规则：当 `spawnHints.farFromPBBoostActive === true`（PB 距离段 D0）且候选块 `s.multiClear >= 2` 时，权重乘 `1.15`。

### 2.7 Layer 1: 即时出块 — 盘面感知

**盘面拓扑分析**：holes、flatness、maxColHeight、nearFullLines、colHeights。

**多消潜力评分**：对每个候选形状遍历所有合法放置位，模拟放置后的消行数。

**空洞修复评分**：仅在 `fill > 0.5 && holes > 2` 时激活。

**机动性保障**：`minMobilityTarget(fill, attempt)` 盘面越满要求越高，随重试逐步放宽。

**可解性验证**：`fill ≥ 0.52` 时执行 `tripletSequentiallySolvable`，DFS 搜索 6 种顺序。

### 2.8 Layer 2: 局内体感

**Combo 链催化**：`comboChain = min(1, streak * 0.25 + (lastClear > 0 ? 0.3 : 0))`。

**多消鼓励**：按优先级返回 0.15～1.0 分段常数，与 `blockSpawn` 里的乘子配合。

**多线目标**：0/1/2 三档，控制是否显式偏好 `multiClear≥2`。

**节奏相位**：`setup` / `payoff` / `neutral`，加入几何门控防止空盘强行 payoff。

**爽感兑现**：`deriveDelightTuning()` 根据 skill/flow/momentum/nearFullLines/pcSetup 输出 `delightBoost` / `perfectClearBoost` / `delightMode`。

### 2.9 Layer 3: 局间体验

**Session 弧线**：`warmup`（前 3 轮减压）→ `peak` → `cooldown`（后期放松）。

**分数里程碑**：`[50, 100, 150, 200, 300, 500]` 触发庆祝出块。

**局间热身**：无步可走终局写入 localStorage，下局注入 `warmupRemaining` / `warmupClearBoost`。

**跨局画像调制**：lifecycle stage（S0..S4）× maturity band（M0..M4）25 格矩阵，调制 stress 上限和偏移。

### 2.10 配置参数

**game_rules.json**：`adaptiveSpawn.profiles[]`、`pacing.cycleLength`、`engagement.frustrationThreshold`、`flowZone.recoveryFillThreshold` 等。

**blockSpawn.js 内置常量**：`MAX_SPAWN_ATTEMPTS=22`、`FILL_SURVIVABILITY_ON=0.52`、`SURVIVE_SEARCH_BUDGET=14000`。

### 2.11 行业对标

| 维度 | Block Blast 等竞品 | Open Block 实现 |
|---|---|---|
| 放置性校验 | 生成时验证可放置 | `tripletSequentiallySolvable` ✅ |
| 盘面感知 | 扫描缺口、精准填补 | `analyzeBoardTopology` + `bestMultiClearPotential` + `bestHoleReduction` ✅ |
| 救济机制 | 困境出"绝处逢生"块 | recovery/frustration + 空洞修复权重 ✅ |
| Combo 催化 | 消行后催化续链 | `comboChain` + 消行候选多消排序 ✅ |
| 多样性 | 同轮去重 + 跨轮记忆 | `usedIds` + `_categoryMemory` + `diversityBoost` ✅ |
| 节奏曲线 | setup/payoff 交替 | `rhythmPhase` + pacing 周期 ✅ |
| Session Arc | 开局热身→收尾 | `sessionArc` warmup/peak/cooldown ✅ |
| 里程碑 | 分数节点友好出块 | `MILESTONE_SCORES` + 庆祝出块 ✅ |

### 2.12 SpawnTransformerV2：生成式模型

除了启发式（Layer 1-3），系统还提供基于 Transformer 的**生成式模型**，从玩家行为序列中学习出块策略。用户可在运行时切换启发式和生成式。该模型使用 24 维上下文向量 + 盘面 8×8 + 目标难度条件，通过多任务训练（CE + diversity + anti-inflation + difficulty regression）学习三连块分布。

### 2.13 文件清单

| 文件 | 职责 |
|---|---|
| `web/src/bot/blockSpawn.js` | Layer 1 核心 + 三层权重整合 |
| `web/src/adaptiveSpawn.js` | Layer 2/3 信号计算 + spawnHints 构建 |
| `web/src/game.js` | spawnContext 维护 + 调用链编排 |
| `web/src/strategyAdvisor.js` | 三层策略建议文案 |
| `web/src/playerInsightPanel.js` | 面板展示三层指标 |
| `web/src/spawnModel.js` | 模型推理客户端 |
| `rl_pytorch/spawn_model/` | Transformer 训练 + 推理 |
| `shared/game_rules.json` | 可配置参数 |

---

## 三、架构图生成 Prompt

> **已生成图片**：当前版本架构图已保存在
> [`docs/algorithms/assets/spawn-architecture.png`](./assets/spawn-architecture.png)，
> 可直接在各文档中引用（`ADAPTIVE_SPAWN.md §10.8`、`SPAWN_ALGORITHM.md §1`、
> `ALGORITHMS_SPAWN.md` 均已内嵌）。本 prompt 用于**重新生成或派生新版图片**。
>
> **定位**：可复用的"喂给大模型即生成出块算法架构图"的 prompt 模板。
> 产出物为 **PNG 格式图片**，视觉规范参考图1（OpenBlock 算法架构总览图）
> 的设计语言：深色背景 + 分层彩色节点 + 左侧序号徽章 + 横向数据流箭头。
>
> **使用方式**：复制 §"Prompt 全文"整段粘贴给支持图片输出的大模型
> （GPT-4o / Gemini 2.5 Pro / Claude 等），直接获得可保存的 PNG 架构图。

### 3.1 适用场景

- 技术文档配图：为 [`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) §10.8 生成对应可视化
- 算法评审材料：展示出块从信号感知到染色的完整数据链路
- 新成员 onboarding：给不读源码的协作者提供算法全景图
- 派生：只截取"盘面感知 + 评分构建"等部分子链路的独立图

### 3.2 设计原则

1. **语义优先**：图中所有节点使用语义化中文描述，不暴露原始代码标识符。
2. **八层流水线**：体现从"三路输入"到"三块输出+染色"的完整 8 层流水。
3. **同花顺三层不变式可读**：识别始终计算、节流在激活门控、单轮预算守卫。
4. **视觉层级清晰**：每层独立配色，层间箭头标注主数据流向。

### 3.3 Prompt 全文

> 以下为完整 Prompt，可直接复制给支持图片输出的大模型使用。详细内容见 [SPAWN_DIAGRAM_PROMPT.md](./SPAWN_DIAGRAM_PROMPT.md)。

```
# 角色
你是一位资深游戏算法架构师，擅长把多阶段评分-抽样系统拆解为清晰的分层数据流架构图。

# 任务
为开源项目 OpenBlock 的出块决策引擎（v1.60.35）生成一张 PNG 格式的视觉架构图，
图名为「OpenBlock 出块算法架构图」，完整呈现从"三路输入"到"三块输出+染色"的 8 层分层数据流。

# 八层流水线
层 0 · 输入层：游戏棋盘 + 策略配置 + 出块调度参数
层 1 · 盘面感知层：填充率、临满行数、空洞、平整度、清屏机会、同花顺信号
层 2 · 评分构建层：9 项指标真模拟打分（缺口填充、多消潜力、清屏潜力等）
层 3 · 优先选拔层：消行席位（1~3 席），同花预算守卫
层 4 · 加权补齐层：14 维权重乘法链轮盘抽样
层 5 · 约束验证层：最多 22 次重试循环，硬约束过滤
层 6 · 注入优化层：救援/压力注入 + 品类多样化注入
层 7 · 输出层：三块候选组 + 选择元数据 + 诊断快照
底部 · 染色层：同花顺锁色 + 三色无放回抽样

# 同花顺三层不变式
识别层（始终计算）→ 评分构建层中同花顺潜力对所有形状真实计算
节流层（激活门控）→ 彩蛋激活标志（3.3%~10%概率）控制是否选入
预算守卫（双修护）→ 单轮最多 1 个同花块

# 视觉规范
整体尺寸 1400×1000px，深色背景（#0a0a0f），各层独立配色
左侧序号徽章 + 中部节点卡片 + 右侧协同信息栏
```

### 3.4 派生用法

| 场景 | 改动建议 |
|---|---|
| 只要评分层子图 | 删除其他层，只保留层 2 |
| 只要约束验证流程图 | 保留层 5 |
| 改用 Mermaid 文本 | 输出 Mermaid `flowchart TB` 代码 |
| 改用 SVG 矢量版 | 输出独立 SVG 文件 |
| 改用 HTML 交互版 | 输出单文件 HTML |
| 英文版 | 中文标签替换为英文 |

### 3.5 关联文档

- [`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) §10.8 — 出块算法完整流水线代码基准
- [`ALGORITHM_DIAGRAM_PROMPT.md`](./ALGORITHM_DIAGRAM_PROMPT.md) — 全算法栈架构图 prompt
- [`ALGORITHM_ARCHITECTURE_DIAGRAMS.md`](./ALGORITHM_ARCHITECTURE_DIAGRAMS.md) — 全算法栈 Mermaid 子图集合
- [`CANDIDATE_BLOCKS_PROBABILITY_ATLAS.md`](./CANDIDATE_BLOCKS_PROBABILITY_ATLAS.md) — 候选块概率图鉴
