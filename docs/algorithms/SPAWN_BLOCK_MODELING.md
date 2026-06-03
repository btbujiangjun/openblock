# 出块建模：SpawnPolicyRules 与 SpawnPolicyNet 双轨

> 📍 **本文档定位**：`L1 · SpawnPolicy` 双轨建模 rationale（`SpawnPolicyRules` 与 `SpawnPolicyNet`）  
> 📐 **职责轴**：仅覆盖「谁产 3 块」这一层；**不涉及**参数寻优（θ 寻参属于 `L2 · SpawnParamTuner`）  
> ⚠️ **不是**：`SpawnParamTuner`（详见 [`SPAWN_TUNING_V2.md`](./SPAWN_TUNING_V2.md)）的前身或子模块；二者沿不同层独立演进  
> 🗺️ 双层总览与角色定义：[`SPAWN_OVERVIEW.md`](./SPAWN_OVERVIEW.md)

> 内部版本：1.6 | 更新：2026-05-29  
> 本文在实现细节之上，给出**可复用的设计 rationale**，并与 [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md)、[`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) 互补：后两者偏「模块说明与配置」，本文偏「问题形式化 + ML 侧数学结构」。  
> **角色映射**：本文 §2「规则引擎」= `SpawnPolicyRules`；§3「SpawnPolicyNet」= `SpawnPolicyNet`（其内部权重版本号 v3.1 用于 checkpoint 管理，不参与产品命名）。

---

## 1. 总览：L1 双轨出块

Open Block 的每轮出块要产出 **三个不重复形状**（dock triplet）。系统提供两条可切换路径：

| 路线 | 核心思想 | 优点 | 典型失败/代价 |
|------|----------|------|----------------|
| **规则引擎** | 手工特征 + 多层启发式权重 + **硬约束过滤** | 可解释、可保证公平性与可解性 | 规则复杂、跨用户风格难极致拟合 |
| **SpawnPolicyNet** | 从对局日志学习 **条件分布** \(P(s_1,s_2,s_3 \mid \text{board}, \text{behaviorContext}, \text{history})\) | 显式消费玩家行为、能力向量、盘面拓扑与策略意图 | 需数据、需防「分数膨胀」等捷径；权重与旧 V3 不兼容 |

运行时：`game.js` 根据 `getSpawnPolicyMode()` 选择 `_spawnBlocksWithModel` 或 `generateDockShapes`；模型推理失败时 **自动回退** 到规则路径（见 `web/src/game.js`）。

> **2026-05-23 代码事实补充**：规则主路径仍是线上权威；PB 双 S 曲线已进入 `adaptiveSpawn` 主规则轨并暴露诊断字段。P1/P2、个性化与惊喜预算当前先落在评估 / 优化器实验轨（`web/src/bot/spawnExperiments.js`、`web/src/bot/spawnEvaluation.js`、`web/spawn-eval.html`），不直接替换 `generateDockShapes()`。

---

## 2. 规则引擎路径（`blockSpawn.js` + `adaptiveSpawn.js`）

### 2.1 建模思路

1. **问题分解（层次化贝叶斯式启发）**  
将「给怎样三块」拆成与决策频率匹配的三层（与 `SPAWN_ALGORITHM.md` 一致）：
   - **Layer 1（盘面瞬时）**：当前网格上哪些形状「几何上可行」且「拓扑上有利」。
   - **Layer 2（局内体验）**：combo、节奏、多样性——控制短期情绪曲线。
   - **Layer 3（跨局/session）**：热身、里程碑、冷却——控制长期留存与挫败恢复。

   各层不直接优化单一标量，而是输出 **乘性权重修正** 与 **离散策略开关**（如 `clearGuarantee`），便于策划调参与 A/B。

2. **约束优先于偏好（Constrained sampling）**  
   先构造候选与权重（偏好），再通过 **拒绝采样** 保证不变量：
   - **机动性下限** `minMobilityTarget(fill, attempt)`：每块合法落点数下限随填充率升高；重试时逐步放宽。
   - **序贯可解性** `tripletSequentiallySolvable`：当 `fill ≥ 0.52` 时，在三块的所有放置顺序（6 种排列）下 DFS，要求存在一种顺序使三块均能落下（预算 `SURVIVE_SEARCH_BUDGET`）。这是对「不公平死局」的硬约束，近似于竞品常用的可解性校验。
   - **危险态严格校验**：当 `fill ≥ 0.68` 或 `roundsSinceClear ≥ 3` 时进入 danger zone；前 70% 重试尝试使用更高搜索预算，且预算耗尽**不再默认放行**，降低“看似可放、实际很快怼死”的三连块组合。

 因而规则路径在概念上是：**在可行域 \(\mathcal{F}\) 内对偏好分布 \(\pi(s_1,s_2,s_3)\) 做近似采样**，其中 \(\mathcal{F}\) 由上述约束隐式定义。

3. **自适应层作为上下文映射**  
   `adaptiveSpawn.js` 将玩家画像与实时状态映射为：
   - 连续量：`stress` → 在10 档 `shapeWeights` 间插值；
   - 离散/结构化量：`spawnHints`（`clearGuarantee`、`sizePreference`、`diversityBoost`、`comboChain`、`multiClearBonus`、`perfectClearBoost`、`iconBonusTarget`、`rhythmPhase`、session 相关字段等）。

   规则出块层 **不直接读画像**，只读 `strategyConfig`（权重 + hints），保证单一数据契约。

### 2.2 优化目标（显式与隐式）

规则路径没有单一损失函数，但可归纳为 **多目标在权重中折衷**：

| 目标 | 含义 | 主要落实位置 |
|------|------|----------------|
| **公平 / 可玩** | 避免无解三连、高填充仍有一定落子自由度 | `minMobilityTarget`、`tripletSequentiallySolvable` |
| **救场与修形** | 减空洞、利用多消窗口 | `bestHoleReduction`、`bestMultiClearPotential`、拓扑特征 |
| **奖励兑现** | 提高玩家偏好的清屏、同 icon、多消概率 | `perfectClearBoost`、`iconBonusTarget`、`multiClearBonus` |
| **心流与挫败恢复** | 无消行后的救济、里程碑正反馈 | `spawnHints`（Layer 2/3）+ `augmentPool` 乘子 |
| **多样性** | 同轮去重、跨轮品类记忆、`diversityBoost` | `usedCategories`、`catFreq` 惩罚 |
| **与策略档位一致** | 低 stress 偏线条、高 stress 偏不规则 | `shapeWeights`（`adaptiveSpawn` 输出） |
| **多轴压力消费** | stress 不只映射块型，还映射到解空间、消行机会、空间压力、payoff 与新鲜度 | `spawnHints.spawnTargets` |

### 2.3 方法（算法结构）

1. **形状级特征与先验排序**  
   对每个可放置形状计算：`gapFills`（`findGapPositions`：行/列 **1～4** 空格上的补洞潜力）、`placements`、`multiClear`（**始终**用 `bestMultiClearPotential` 计算）、`pcPotential`（疏板或 `pcSetup` 时评估一手清屏）、`holeReduce`（高填充且空洞多）、以及 `weight`。默认按 `pcPotential`、`multiClear`、`gapFills` 排序。

2. **两阶段构造 triplet**  
   - **阶段 1**：从「消行相关」子集占坑：`gapFills>0` **或** `multiClear≥1` **或** `pcPotential===2`＼�，再按 `clearGuarantee` / `effectiveClearTarget`；高 `multiClearBonus` 时排序偏向「多消 + 缺口 + 清屏」综合分。  
   - **阶段 2**：对剩余槽位做 **加权抽样** `pickWeighted(augmentPool(...))`，权重为多层乘子（机动性、空洞、多消、清屏、combo、节奏、`sizePreference`、多样性惩罚、里程碑等）。同 icon/同色 bonus 在 `game.js` 的 dock 染色层通过 `iconBonusTarget` 消费，不改变形状可解性判断。

3. **拒绝采样循环**  
   若 triplet 违反机动性或可解性，则 `attempt++` 重试，最多 `MAX_SPAWN_ATTEMPTS`；仍失败则走简化兜底路径。高填充区间的 `minMobilityTarget` 已提高（`0.68+`、`0.75+`、`0.88+` 三档更严格），优先选择合法落点更充足的组合。

4. **顺序随机化**  
   通过校验后对三块 **Fisher–Yates 打乱**，避免玩家从顺序推断内部「主块/辅块」优先级。

### 2.4 特征设计（规则侧）

**A. 盘面拓扑（Layer 1标量）**

| 特征 | 构造要点 | 设计意图 |
|------|----------|----------|
| `holes` | 列上「上方已有块且当前为空」的格数累计 | 识别结构恶化 |
| `flatness` | \(1/(1+\mathrm{Var}(\text{colHeights}))\) | 表面起伏过大时倾向平衡型落子（通过形状权重间接作用） |
| `nearFullLines` | 行/列缺 1～2 格即满的数量 | 多消/setup机会信号 |
| `maxColHeight` | 列顶高度 | 危险度 |

**B. 形状级特征（与 grid 耦合）**

- `gapFills` / `countGapFills`：与即时消行强相关；阶段 1 与 `multiClear`、`pcPotential` **并列** gate（见 `SPAWN_ALGORITHM.md` §2.3）。
- `placements`：合法位置计数，进入 \(\log\) 型机动性奖励。
- `multiClear`：`previewClearOutcome` 上的行列消除数上界（不再依赖 `gapFills` 才算）。
- `holeReduce`：仅在 `fill>0.5 && holes>2` 时深算，权衡算力。

**C. 上下文特征（`spawnContext` + hints）**  
跨轮状态如 `lastClearCount`、`roundsSinceClear`、`recentCategories`、`totalRounds`、`scoreMilestone` 等进入 Layer 2/3 行为；具体字段见 `SPAWN_ALGORITHM.md` 第2～5 节。

### 2.5 降低怼死率的保命策略

近期的保命优化主要集中在 `web/src/bot/blockSpawn.js` 与 `web/src/adaptiveSpawn.js`，并同步到小程序 `miniprogram/core/`：

| 机制 | 触发 | 行为 |
|------|------|------|
| 危险态 `CRITICAL_FILL` | `fill ≥ 0.68` 或 `roundsSinceClear ≥ 3` | 提高三连块可解性搜索预算；严格模式下预算耗尽不再当作通过 |
| 机动性阈值提升 | `fill ≥ 0.68 / 0.75 / 0.88` | 提高每块最低合法落点数，减少“只有一两个落点”的窄路组合 |
| 连续无消行救援态 | `roundsSinceClear ≥ 2` | `clearGuarantee ≥ 2`，优先给可解压/可消行块 |
| 强救援态 | `roundsSinceClear ≥ 4` | `clearGuarantee ≥ 3` 且 `sizePreference ≤ -0.35`，倾向小块与消行块 |

这些机制不是降低全部难度，而是只在危险窗口内提高“可继续玩”的概率；正常低填充或心流阶段仍由原三层权重控制。

### 2.6 「网络结构」（规则路径）

规则路径 **无神经网络**。其结构可类比为 **手工构建的浅层评分图（factor graph）**：节点为特征与张量乘子，边为「加权乘积 + 截断 + 约束过滤」。这与 ML 路径的 deep encoder 形成对照。

### 2.7 PB 双 S 曲线与体验预算实验轨（P2）

OpenBlock 的核心长期目标是：**让玩家频繁接近个人最佳（PB），但不轻易突破；突破后给短暂释放，再快速防止分数膨胀**。因此压力更适合按 `score / bestScore` 的相对进度建模，而不是只看绝对分数。

当前代码中，PB 追逐已有多条规则轨实现：

- `adaptiveSpawn.js` 中的 `challengeBoost`、`farFromPBBoost`、`pbOvershootBoost`、`postPbReleaseWindow`；
- `orderRigor / orderMaxValidPerms` 在 PB 临界段和超 PB 段会提高顺序规划要求；
- `spawnHints` 会在远离 PB、突破后释放、超 PB 刹车等阶段调节 `clearGuarantee / sizePreference / multiClearBonus`。

当前主规则轨已把这类设计抽象成双 S 曲线，并通过 `adaptiveSpawn.derivePbCurve()` 输出：

```text
pbRatio   = score / bestScore
pbTension = sigmoid((pbRatio - 0.82) / 0.08)   # PB 前张力
pbBrake   = sigmoid((pbRatio - 1.05) / 0.06)   # PB 后刹车
pbRelease = postPbReleaseRemaining > 0 ? 1 : 0 # 突破释放窗口
```

这些曲线不直接选形状，而是映射到四类体验预算：

```text
survival  保活 / 可解性 / 首步自由
payoff    消行 / 多消 / 清屏 / 同花
pressure  形状复杂度 / 顺序刚性 / 空间压力
novelty   品类变化 / 低重复 / 趣味
```

实验轨的组合评分形式为：

```text
score(triplet) =
  survival * survivalScore(triplet)
+ payoff   * payoffScore(triplet)
+ pressure * pressureScore(triplet)
+ novelty  * noveltyScore(triplet)
```

其中：

- `survivalScore` 主要来自 `firstMoveFreedom / firstMoveSurvivorRatio / meanEndFillRatio`；
- `payoffScore` 来自消行潜力、精确卡入与奖励机会；
- `pressureScore` 来自总占格、形状复杂度和可解排列收窄；
- `noveltyScore` 来自品类多样性和复杂度。

实现位置：

- `web/src/bot/spawnExperiments.js`
  - `triplet-p1`：组合级候选评分；
  - `budget-p2`：在组合评分上叠加 `survival / payoff / pressure / novelty`；
  - 两阶段评估：先廉价扫描最多 `maxEvaluatedTriplets` 个组合，再只对 Top 8 做完整解法评估。
- `web/src/bot/spawnEvaluation.js`
  - 批量评估 `baseline / triplet-p1 / budget-p2`；
  - 输出 `budgetMean / evaluatedTripletsMean / deepEvaluatedTripletsMean / optimizerScore`。
- `web/src/spawnEval.worker.js`
  - Web Worker 执行评估，避免可视化工具阻塞 UI。

### 2.8 个性化、受控随机与惊喜预算

P2 实验轨还支持轻量模型化参数，但仍遵守规则轨硬约束：

```text
personalizationStrength  个性化预算强度
temperature              Top 合法组合内的受控随机温度
surpriseBudgetGain       惊喜预算增长速度
surpriseCooldown         惊喜预算冷却轮次
```

玩家偏好向量采用 5 维估算：

```text
clearSeeker   直消偏好
comboPlanner  连锁偏好
survivalist   生存偏好
riskTaker     冒险偏好
noveltyLover  新鲜偏好
```

偏好只微调体验预算，不直接改 shape，不绕过约束：

```text
clearSeeker   → payoff +
comboPlanner  → payoff + novelty +
survivalist   → survival +
riskTaker     → pressure +
noveltyLover  → novelty +
```

受控随机只发生在合法 Top 组合中：

```text
softmax((score + jitter) / temperature)
```

这保证“偶然性”来自安全候选集合内部，而不是随机发不可解释块。

### 2.9 DFV 与评估工具的解释口径

当前 DFV 已同步展示：

- baseline 主规则轨：玩家信号、压力、`spawnHints`、`spawnTargets`、调度参数、三块 `chosen` 与 `topDriver`；
- P1/P2 实验轨：`triplet-p1 / budget-p2` reason 和 driver path；
- P2 体验预算：`survival / payoff / pressure / novelty`、`personalizationStrength`、`surpriseBudget`、`evaluatedTriplets / deepEvaluatedTriplets`；
- PB 曲线解释：`pbTension / pbBrake / pbRelease`；
- 个性化偏好估算：`clearSeeker / comboPlanner / survivalist / riskTaker / noveltyLover`。

重要边界：

- DFV 中 PB 曲线来自主规则轨 `_lastAdaptiveInsight.pbCurve / pbTension / pbBrake / pbRelease / pbPhase`；
- 个性化偏好向量目前仍是解释层重建 / 估算；
- 若将 P2 切入主路径，应先把体验预算与偏好向量作为正式诊断字段输出，并同步更新小程序规则轨契约。

---

## 3. 学习路径：SpawnPolicyNet

当前实现为 **V3.1**：网络 `rl_pytorch/spawn_model/model_v3.py`（`SpawnPolicyNet`）、训练 `train_v3.py`、数据/特征 `dataset.py`、可行性 `feasibility.py`、个性化 `lora.py` / `personalize.py`；前端推理契约见 `web/src/spawnModel.js`。旧 V2（`model.py` / `train.py`，`SpawnTransformer` 三槽独立 head、无 AR/可行性/风格/意图）仅作历史 lineage 保留。
> **权威性**：线上默认仍是 `SpawnPolicyRules`（§2）；V3.1 是切换路径，推理失败 **自动回退** 规则轨（`web/src/game.js`）。`spawn_transformer_v3.pt` 与旧权重不兼容，扩形状池（28→40）后必须重训。

### 3.1 建模思路

1. **行为克隆 + 自回归联合分布（U1）**  
   训练标签来自真实对局：每一帧 `spawn` 事件记录 dock 三块形状 ID。V2 用三个 **独立** head 近似 \(P(s_0)P(s_1)P(s_2)\)，联合建模弱；V3.1 改为 **autoregressive 分解**：
   \[
   P(s_0,s_1,s_2 \mid \text{ctx}) = P(s_0\mid\text{ctx})\cdot P(s_1\mid\text{ctx},s_0)\cdot P(s_2\mid\text{ctx},s_0,s_1)
   \]
   训练用 **teacher forcing**（`prev_shapes=targets[:, :2]`），推理逐槽采样并回填已选形状 embedding。条件信号为 **8×8 棋盘二值矩阵**、**57 维行为上下文**、**历史三连形状**。

2. **条件难度嵌入（Difficulty conditioning）**  
   标量 `target_difficulty ∈ [0,1]` 经 `difficulty_proj` 升维成一个 token，使推理时可 **显式拨动压力**（易 ↔ 难），与规则里 `stress` 语义对齐但参数化方式不同。

3. **风格条件 token（U2）**  
   `playstyle_id` 经 `playstyle_embed` 注入一个风格 token（`balanced / perfect_hunter / multi_clear / combo / survival`），推理时可指定，训练时由 `_infer_playstyle_from_context` 给出弱标签自监督。

4. **可行性辅助 + 软不可行约束（U3 + U4）**  
   - **可行性头**：对每个形状预测「当前 board 是否至少有一个合法落点」（`NUM_SHAPES` 维 sigmoid），用 GT mask 做 BCE 监督，得到可在 **无外部规则** 的设备上内嵌过滤的轻量 predictor；
   - **软不可行惩罚**：把 GT 可行性 mask 作为权重，惩罚主分布落在不可放集合上的概率质量，训练阶段就把概率从不可放区拉走（弥补 ML 路径不强保证 `tripletSequentiallySolvable`）。

5. **多任务辅助头：抑制捷径学习**  
   仅用 CE 模仿分布易导致 **捷径**（永远送易消块刷分）。因此叠加：
   - **多样性头**：预测每槽形状所属 **品类**（7 类），逼迫 CLS 表征捕捉「三块品类如何搭配」；
   - **难度回归头**：回归 `compute_target_difficulty(behavior_context)`，强化上下文与「挑战度」耦合；
   - **意图头（自监督）**：预测 `spawnIntent`（`relief/engage/harvest/pressure/flow/maintain/sprint`，新增 sprint 共 7 类），让生成分布学习策略语义；
   - **反膨胀损失**：在高技能且低填充时对「易形状」softmax 质量惩罚。

6. **LoRA-ready（U5）**  
   所有 `head_0/1/2`、`feasibility_head`、`style_head` 均为 `nn.Linear`，可被 `lora.inject_lora_into_model()` 识别，支撑 `userId` 维度的个性化微调路径。

7. **与规则的关系**  
   ML 路径 **不强保证** `tripletSequentiallySolvable`，靠数据分布 + 可行性损失塑形逼近；上线以规则为 **安全回退**，形成「探索（ML）+ 保险（规则）」产品策略。

### 3.2 优化目标与损失函数

训练总损失为 **8 项多任务加权和**（`train_v3.py`）：

\[
\mathcal{L} =
w_{\mathrm{ce}}\mathcal{L}_{\mathrm{ce}}
+ w_{\mathrm{div}}\mathcal{L}_{\mathrm{div}}
+ w_{\mathrm{anti}}\mathcal{L}_{\mathrm{anti}}
+ w_{\mathrm{diff}}\mathcal{L}_{\mathrm{diff}}
+ w_{\mathrm{feas}}\mathcal{L}_{\mathrm{feas}}
+ w_{\mathrm{si}}\mathcal{L}_{\mathrm{si}}
+ w_{\mathrm{st}}\mathcal{L}_{\mathrm{style}}
+ w_{\mathrm{intent}}\mathcal{L}_{\mathrm{intent}}
\]

默认权重（命令行可调）：

| 权重 | 默认 | 损失项 | 作用 |
|------|------|--------|------|
| `w_ce` | **1.0** | \(\mathcal{L}_{\mathrm{ce}}\) | 自回归三槽分类（主目标） |
| `w_div` | **0.3** | \(\mathcal{L}_{\mathrm{div}}\) | 品类多样性 |
| `w_anti` | **0.5** | \(\mathcal{L}_{\mathrm{anti}}\) | 反分数膨胀 |
| `w_diff` | **0.1** | \(\mathcal{L}_{\mathrm{diff}}\) | 难度回归 |
| `w_feas` | **0.4** | \(\mathcal{L}_{\mathrm{feas}}\) | 可行性头 BCE 监督 |
| `w_si` | **0.2** | \(\mathcal{L}_{\mathrm{si}}\) | 主分布软不可行惩罚 |
| `w_st` | **0.15** | \(\mathcal{L}_{\mathrm{style}}\) | 风格自监督 CE |
| `w_intent` | **0.10** | \(\mathcal{L}_{\mathrm{intent}}\) | 出块意图自监督 CE |

> `w_feas > 0` 或 `w_si > 0` 才会在每个 batch 用 board 现算 GT 可行性 mask（`build_feasibility_batch`）；`w_st > 0` 才计算风格弱标签。

**（1）主分类 \(\mathcal{L}_{\mathrm{ce}}\)（自回归）**  

对三个槽位 logits \((l_0,l_1,l_2)\) 各做交叉熵后取均值，**再按样本权重 `weight` 加权**（`reduction='none'` 后 `(\cdot)\cdot\text{weight}` 再 `.mean()`）。其中 \(l_1\)、\(l_2\) 由 teacher forcing 的前序真值（`targets[:, :2]`）条件化，对应 §3.1 的 AR 分解。权重设计见 §3.3。  
直觉：在「高分且高消行质量」的局上更信任标签，减轻纯刷分轨迹对梯度的支配。

**（2）多样性 \(\mathcal{L}_{\mathrm{div}}\)**  

`diversity_head` 输出 `(B, 3, NUM_CATEGORIES)`，对每一槽与真实品类 `categories[:, slot]` 做 CE，再对三槽平均。  
直觉：迫使 CLS 表示捕获「这一轮三块在品类上如何搭配」，减少三槽独立 CE 带来的模式坍塌。

**（3）反膨胀 \(\mathcal{L}_{\mathrm{anti}}\)**  

令 `skill = context[:, 2]`，`fill = context[:, 1]`，触发强度：

\[
\text{trigger} =
\mathrm{clamp}((\mathrm{skill}-0.6)\cdot 5,\,0,\,1)
\cdot
\mathrm{clamp}((0.4-\mathrm{fill})\cdot 5,\,0,\,1)
\]

对三个槽位的 softmax，将 **易形状集合**（实现中为 `2x2`、`1x4`、`4x1`）概率质量求和，与 `trigger` 相乘后平均。  
直觉：在「高手 + 空板」区域压制「无脑送简单块」的捷径，与策划担心的分数膨胀一致。

**（4）难度回归 \(\mathcal{L}_{\mathrm{diff}}\)**  

目标由上下文解析（`compute_target_difficulty`）：

\[
d^\* = \mathrm{clamp}\bigl(
0.3 + 0.5\,\mathrm{skill} - 0.2\,\mathrm{frustration} + 0.15\,\mathrm{stress}
+ 0.08\,\mathrm{boardDifficulty} - 0.1\,\mathrm{boardRisk}
+ 0.06\,\mathrm{nearClear},\, 0,\,1
\bigr)
\]

其中 `boardDifficulty = clamp(fill + holePressure × 0.8, 0, 1)`，`holePressure = clamp(holes / 10, 0, 1)`。`stress` 在这里保持与规则轨一致：越高代表越强挑战目标；同样填充率下，holes 越多代表可修复性越差，因此目标难度上升。`boardRisk` 来自 `adaptiveSpawn._stressBreakdown.boardRisk`，仍作为保活护栏用于抵消过度挑战，避免模型轨在危险盘面继续硬加压。

规则轨还会读取 `spawnTargets`：

- `shapeComplexity`：控制品类复杂度，而不是只依赖 profile 形状权重。
- `solutionSpacePressure`：调节解法数量过滤和首手自由度。
- `clearOpportunity`：控制消行席位和 gap/multiClear 权重。
- `spatialPressure`：控制占格压力和大块/小块倾向。
- `payoffIntensity`：强化多消/清屏兑现。
- `novelty`：提高品类多样性、降低重复疲劳。

> 🔗 **与 L2 `SpawnParamTuner` 的唯一耦合通道**：当寻参 bundle（`policies.json`）部署后，B 组 4 个 PB 曲线 θ 经 `adaptiveSpawn.derivePbCurve()` 调制上面 `spawnTargets` 的 `solutionSpacePressure/clearOpportunity/spatialPressure/payoffIntensity/novelty`，而这 5 项正是 `behaviorContext[39–43]`——因此 **SpawnPolicyNet 的条件输入会随 θ 变化**（单向 L2→L1）。A 组 5 个 θ（personalization/temperature/surprise*/maxEvaluatedTriplets）只进规则实验轨，不进 Net。注意 `target_difficulty` 吃的 `stress` 在 `derivePbCurve` 之前已算定，**不携带 θ**，故耦合发生在 `spawnTargets` 而非难度回归目标。详见 [`SPAWN_OVERVIEW.md`](./SPAWN_OVERVIEW.md) §3/§6。
>

对 `difficulty_head` 输出做 MSE，目标 `target_diff = compute_target_difficulty(behavior_context)`（57 维上下文走 `boardDifficulty=ctx[26] / boardRisk=ctx[37] / nearClear=clamp(ctx[29]+ctx[30])`；旧 24 维退化为裸 `fill`、risk=0）。推理时前端可用同一公式或手动指定 `targetDifficulty`。

**（5）可行性 BCE \(\mathcal{L}_{\mathrm{feas}}\)**  

每个 batch 用当前 board 现算 GT 可行性 mask \(m\in\{0,1\}^{\text{NUM\_SHAPES}}\)（`build_feasibility_mask`：形状在 board 上至少有 1 个合法落点则为 1），对 `feasibility_head` logits 做 `binary_cross_entropy_with_logits(feas\_logits, m)`。  
直觉：训练一个 **内嵌的轻量可行性 predictor**，使无外部规则可调用的设备也能内部过滤不可放形状。

**（6）软不可行 \(\mathcal{L}_{\mathrm{si}}\)**  

把同一 GT mask 作为权重，对三槽主分布求

\[
\mathcal{L}_{\mathrm{si}} = \frac{1}{3}\sum_{i=0}^{2}\Bigl[-\log\bigl(\textstyle\sum_j \mathrm{softmax}(l_i)_j\cdot m_j\bigr)\Bigr]
\]

直觉：直接把主分布的概率质量 **拉向可行集合**，弥补 ML 路径不强保证 `tripletSequentiallySolvable`。注意训练期用 **GT board** 的 mask（无法对每个生成 shape 重算 board 后的可行性）。

**（7）风格自监督 \(\mathcal{L}_{\mathrm{style}}\)**  

`style_head` logits 与启发式弱标签 `playstyle_id` 做 CE。弱标签 `_infer_playstyle_from_context`：`clearRate≥0.6 且 comboRate<0.4 → perfect_hunter`；`comboRate≥0.4 或 clearRate≥0.5 → multi_clear`；`recentCombo≥0.5 → combo`；`clearRate<0.25 → survival`；否则 `balanced`。

**（8）意图自监督 \(\mathcal{L}_{\mathrm{intent}}\)**  

`intent_head` logits 与意图弱标签 `intent_id` 做 CE。弱标签 `_infer_intent_from_behavior_context` 取行为上下文 `[48:55]` 的 7 维 `spawnIntent` one-hot argmax（无信号回退 `maintain=5`）。

**优化方法**

- 优化器：**AdamW**（`lr=3e-4` 默认，`weight_decay=1e-4`）
- 调度：**CosineAnnealingLR**，\(T_{\max}=\) `epochs`
- 批量/划分：`batch_size=64`、`drop_last=True`、10% 随机 val 划分
- 稳定技巧：**grad clip** 范数 1.0
- checkpoint：按 **最优 val_loss** 保存到 `models/spawn_transformer_v3.pt`
- 验证：仅监控 **无权重 CE**（AR，teacher forcing `prev_shapes=targets[:, :2]`；forward 不传 `target_difficulty` 用默认 0.5），同时统计三槽 argmax top-1 acc。

### 3.3 特征设计（学习侧）

**（1）棋盘**  
`8×8` 二值矩阵（有块为 1），与规则层 `Grid` 对齐；展平为 64 维后与 context 拼接进入 `board_proj`。

**（2）63 维行为上下文向量**（`dataset._parse_behavior_context`）  

V3.1 仍保留前 24 维基础画像（`_parse_context`），后 37 维显式纳入最新用户行为、能力向量、拓扑、策略意图与 PB 曲线 θ：

| 索引 | 语义 | 说明 |
|------|------|------|
| 0–23 | 旧基础 context | 分数、填充率、技能、动量、情绪/认知、冷启动标志、窗口统计、长期能力、stress/flow/pacing/session |
| 24–31 | 数据可信度 + 拓扑 | `coldStart`、活跃样本量、`boardDifficulty`、holes、nearFull/close1/close2/solutionCount |
| 32–37 | `AbilityVector` | `skillScore`、`controlScore`、`clearEfficiency`、`boardPlanning`、`riskTolerance`、`riskLevel` |
| 38–47 | `spawnTargets` + hints | 复杂度、解空间、清行机会、空间压力、payoff、新鲜度、`clearGuarantee`、`sizePreference`、`multiClearBonus`、`orderRigor` |
| 48–54 | `spawnIntent` one-hot（**7 维**） | relief / engage / harvest / pressure / flow / maintain / **sprint** |
| 55–56 | 额外策略上下文 | `multiLineTarget`、`sessionArc` |
| 57–60 | **PB 曲线 θ 显式条件**＼� | `pbTensionCenter / pbTensionWidth / pbBrakeCenter / pbBrakeWidth`，按 `_PB_THETA_RANGES` 归一化；来源 `ps.adaptive.stressBreakdown.pbCurveParams`，缺省 → 默认 θ 域 |

枚举映射：`_FLOW_MAP`（bored/flow/anxious）、`_PACING_MAP`、`_SESSION_MAP`。前 24 维保留旧索引，便于反膨胀、playstyle/intent 弱标签等训练 helper 复用基础字段；V3.1 模型实际输入维度为 **`BEHAVIOR_CONTEXT_DIM=63`**（v1.66 P7：尾部 [61-62] 追加 2 维客观几何 `contiguousRegions/concaveCorners`；θ 段 [57:61] 不变）。

> 🧭 **显式 θ 条件（把 L2→L1-Net 隐式耦合转为显式输入）**：把本帧实际生效的 4 个 PB 曲线 θ 直接喂进网络（[57–60]），让模型对 θ **泛化**而非把 θ 当作不可见的分布漂移源——这是消除「换 θ 不重训 → 行为克隆假设失效」退化的治本手段。配套样本元数据 `theta_regime`（int，不进网络）供**分层重训 / 漂移分组**；运行期分布漂移由 `rl_pytorch/spawn_model/drift.py`（`spawn_targets_drift / pb_theta_drift / assert_spawn_targets_drift`，PSI）做部署门禁兜底。

> ✅ **前后端契约已对齐（2026-06-03，63 维）**：前端 `web/src/spawnModel.js` 的 `SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM=63`、`SPAWN_INTENT_VOCAB`（7 类含 `sprint`）、`SHAPE_VOCAB`（40）、`SPAWN_PB_THETA_RANGES`（4 维 θ 归一化区间）+ 2 维客观几何与 Python `dataset.py` 逐项一致，确保前端拼接维度与后端 `board_proj.in_features`（64+63=127）相符；服务端 `/api/spawn-model/v3/predict` 以 `BEHAVIOR_CONTEXT_DIM` 动态裁剪/补零。该契约由 `tests/spawnModelPythonParity.test.js` 静态钉死，任一侧漂移即测试失败。

**（3）历史三连形状**  
`history` 形状 `(3, 3)`：最近最多 `HISTORY_LEN=3` 轮，每轮3 个形状 ID；不足填0。嵌入为 `shape_embed` + **位置编码** `history_pos`（长度 `3×3=9`），使模型区分「上一轮第 2 块」与「上两轮第 1 块」等不同时间位置。

**（4）样本权重**

局级 `session_score` 与粗粒度 `clear_rate`（实现中用 place/spawn 计数比）：

\[
w = 0.6 \bigl(1 + \frac{\max(0,\,\text{score}-50)}{200}\bigr)
 + 0.4 \bigl(1 + \text{clearRate}\cdot 0.5\bigr)
\]

避免「高分但几乎不消行」的畸形局主导梯度。

**（5）品类标签**  
7 类：`lines/rects/squares/T/Z/L/J`，用于 `L_div`；与 `SHAPE_CATEGORY` 一致。

### 3.4 网络结构（张量流）

**超参默认**：`d_model=128`，`nhead=4`，`num_layers=2`，`dim_ff=256`，`dropout=0.1`。

**Token 构造**（序列长度 \(\underbrace{1}_{\text{CLS}}+\underbrace{1}_{\text{state}}+\underbrace{1}_{\text{diff}}+\underbrace{1}_{\text{style}}+\underbrace{9}_{\text{history}}=13\)）：

1. **CLS**：可学习向量 `cls_token`，聚合全局表示。  
2. **State token**：`[board_flat(64) ; behaviorContext(63)]` → `board_proj = Linear(127→d_model)` + GELU + LayerNorm。  
3. **Difficulty token**：`target_difficulty (1)` → `difficulty_proj = Linear(1→d_model)` + GELU + LayerNorm；为 `None` 时填 0.5。  
4. **Style token**：`playstyle_id` → `Embedding(NUM_PLAYSTYLES=5, d_model)` + `style_pos`；为 `None` 时填零向量。  
5. **History tokens（9 个）**：每个 cell 为形状 ID → 共享 `shape_embed = Embedding(NUM_SHAPES+1, d_model, padding_idx=NUM_SHAPES)`，加 `history_pos`（长度 `3×3=9`）。注：`dataset` 对不足 3 轮的历史用 **0**（即 `1x4`）补位，而非 `padding_idx`；该 PAD 位仅在推理拼接 PAD 时生效。

**编码器**：`nn.TransformerEncoder`（`num_layers=2`，`batch_first=True`，激活 GELU），输出经 `LayerNorm`，取 **CLS 位置** `encoded[:, 0]` 作为 `cls_out`。

**输出头**（除 AR 形状头外均接在 `cls_out` 上）：

| 头 | 输入 | 维度 | 作用 |
|----|------|------|------|
| `head_0` | `cls_out` | `NUM_SHAPES`（**40**） | 第 0 槽 logits |
| `head_1` | `[cls_out ; emb(s_0)]`（`2·d_model`） | `NUM_SHAPES` | 第 1 槽 logits（AR 条件于 \(s_0\)） |
| `head_2` | `[cls_out ; emb(s_0) ; emb(s_1)]`（`3·d_model`） | `NUM_SHAPES` | 第 2 槽 logits（AR 条件于 \(s_0,s_1\)） |
| `diversity_head` | `cls_out` | `7 × 3` → reshape `(3, 7)` | 每槽品类 logits |
| `difficulty_head` | `cls_out` | `1` | 难度回归 |
| `feasibility_head` | `cls_out` | `NUM_SHAPES` | 每形状可放 logits（sigmoid→P(可放)） |
| `style_head` | `cls_out` | `NUM_PLAYSTYLES=5` | 风格自监督 |
| `intent_head` | `cls_out` | `NUM_SPAWN_INTENTS=7` | 出块意图自监督 |

> 前序槽位 embedding 复用 `shape_embed` 并加 `slot_pos`（区分 slot0/slot1）；训练 teacher forcing 用真值，推理用已采样结果。

**推理 `sample`（autoregressive）**：逐槽计算 logits → 可选 `feasibility_mask` 将不可放位置 logit 置 `-1e4` → 已选 ID 减 `1e4` 去重 → 除以 `temperature` → **top-k 多项式采样**（默认 `top_k=8`）。可指定 `playstyle` / `target_difficulty`。

**参数量级**：约数十万级（`count_params()`），适合 CPU 推理与快速迭代。

### 3.5 数据管线与产物

- **来源**：SQLite `sessions ⨝ move_sequences.frames`（JSON），筛选 `status='completed'` 且 `score ≥ min_score`，**按分降序**取 `max_sessions`（默认 500）；少于 5 帧的对局丢弃。  
- **逐帧解析**（`extract_samples_from_session`）：`init`/`place` 维护 `last_grid`（`place` 用 `gridAfter` 更新），每个 `spawn` 帧产 1 条样本，标签为 dock 前 3 块形状 ID + 品类。  
- **样本权重**：局级 `clearRate = place 帧数 / spawn 帧数`，与分数共同决定 `weight`（公式见 §3.3-(4)），避免「高分但几乎不消行」的畸形局主导梯度。  
- **产物**：`models/spawn_transformer_v3.pt`（含 `model_state_dict`、`config` 超参、`model_version='v3.1-behavior'`、`context_dim=24`、`behavior_context_dim=63`、`num_shapes/num_categories/num_playstyles/num_spawn_intents`、`epoch/val_loss/val_acc`、还含 **`drift_reference`**（训练集 spawnTargets/PB θ 画像）与 **`theta_regimes`**（θ-regime 分布））；进度 JSON `models/spawn_train_status.json` 供训练面板展示。

> 🧩 配合 `PLAYER_STATE_SNAPSHOT_VERSION=4`（v1.66 P7：spawnGeo 增 `contiguousRegions/concaveCorners`），把"出块算法优化"真正需要的标签补齐——
> 1. **逐 triplet 因果结果** `outcome`（`OUTCOME_DIM=7`：消行数 / 得分增量 / 填充 delta / 空洞 delta / 落子数 / 单步最大消行 / 一手清屏），由 `_compute_spawn_outcome` 从 spawn→下一 spawn 间的 place 帧聚合；`weight` 叠加 `_outcome_weight_factor`（[0.5,1.8]）做因果微调，奖励消行/减洞、惩罚恶化盘面/弃块。`outcome` 已进 `SpawnDataset.__getitem__`，`train_v3` 可选作 reward/advantage 加权。
> 2. **近消行拓扑落库**：`spawnGeo.nearFullLines/close1/close2/maxColHeight` 此前 snapshot 未写 → `behaviorContext[28-30]` 恒 0，现已真实填充（`detectNearClears` 同源，索引不变）。
> 3. **PB 相对进度基线**：`ps.bestScore` / `ps.pbRatio`，让 `pbRatio=score/bestScore` 可离线重建。
> 4. **逐 spawn provenance**：`ps.provenance`（`spawnSource` rule/model-v3/rule-fallback、`modelVersion`、`fallbackReason`、`thetaSource`、`policyBundleSha/Version`、`rolloutPct`）+ spawn 帧 dock 逐块 `feat`（规则侧形状特征）+ 帧级 `spawnMeta`（拒绝采样 `attempt`/`solutionRejects`），供反事实 / 分组对比与"何种组合在何盘面被判不可行"的学习。
> 5. **终局 / 死亡标签**：`sessions.game_over_reason`（`jam` 被怼死 / `level_clear` / `level_fail` / `normal`）独立列 + `gameStats.finalBoard`/`deadDock` 死亡盘面，`load_training_data` 读出 `died` 元数据；保命 / 可解性优化与公平性回归用。
> 6. **会话级留存**：`load_session_retention()` join `player_visits` 算 `returned_24h/7d`、`played_next_session`、`next_gap_sec`，对齐"出块策略→留存"的优化目标。
>
> 🎲 ��训练样本里 PB 若是常量，模型只能学该 PB 档位的出块分布、换 PB 即 OOD。采样时让 PB 围绕"指定数值"（本局 run-start `bestScore` / 打包行 `pb_baseline`）上下波动（`PB_JITTER_DEFAULT=0.15` 域随机化），并把 **reward 计算口径绑定到采样到的 PB**（`_pb_reward`，与 `pbTension` 中心 0.82 同口径）：`r = 0.5·(分增/采样PB) + 0.2·tanh((pbRatio−0.82)/0.12) + 0.15·消行 + 0.25·清屏 − 盘面恶化/弃块`。样本新增 `pb_sampled / pb_ratio_sampled / reward`（`reward`、`pb_ratio_sampled` 进 `__getitem__`）；`pb_jitter=0` 退化为常量旧行为。逐 session 用派生子 `rng` 保证可复现。
>
> 🗄️ ��新增 `spawn_dataset_samples` 表，作为与 `sessions/move_sequences` **去耦**的训练资产：
> - **自动同步**：`put_move_sequence`（写帧）与会话结算（`patch_session` 完成 / `end_session`）经 `_sync_session_to_dataset` 幂等 `UPSERT`（`UNIQUE(session_id)`），随帧增长收敛到最终态；`/api/spawn-dataset/sync` 可回填存量，`/api/spawn-dataset/stats` 看概览。
> - **不支持删除（WORM）**：`BEFORE DELETE` 触发器 `RAISE(ABORT)` 阻断任何 DELETE；且故意不被 `/api/replay-sessions/delete`、`/api/user/data` 擦除路径触及 —— 即使原始对局被删，样本集仍完整（`payload` 存 `frames` 独立副本）。
> - **训练读取**：`load_packed_dataset()` 从该表抽样（删除安全，PB 中心优先取 `pb_baseline` 列）；`load_training_data(prefer_packed=True)` 默认优先样本集、回退 `sessions⨝move_sequences`。
> - 回归：`rl_pytorch/spawn_model/test_dataset_v163.py`（PB 波动/ reward 口径 / WORM / 去耦 / 打包加载，server 侧 Flask 缺失自动跳过）。

### 3.6 个性化与可行性扩展（V3.1 配套）

- **LoRA 个性化**（`lora.py` / `personalize.py`）：对 `nn.Linear` 头注入低秩适配，支持按 `userId` 训练/加载个性化增量；前端 `predictSpawnV3` 传 `userId` 时走该路径。
- **可行性子系统**（`feasibility.py`）：`check_shape_feasibility` / `build_feasibility_mask` / `build_feasibility_weight` 既用于训练期 GT mask，也可在推理期由后端用 `board` 现算、屏蔽不可放形状（`enforceFeasibility`）。
- **形状提案**（`shape_proposer.py`）：与 `SHAPE_VOCAB`（40）配套的候选生成/校验工具。
- **分布漂移监控**：对 behaviorContext 的 `spawnTargets` 段（[38:44]）与 PB θ 段（[57:61]）计算 PSI（`population_stability_index`），`assert_spawn_targets_drift` 可作为重训/部署门禁（经验阈值 0.10 关注 / 0.25 重训）；配合显式 θ 条件防止 L2 换 θ 后 Net 的 OOD 退化。自检见 `test_drift.py`。
- **部署门禁 CLI**：`python -m rl_pytorch.spawn_model.drift_check --db <db> --ckpt <pt>` 用 checkpoint 内 baked-in 的 `drift_reference` 对照线上 behaviorContext，漂移超阈值退出码 1。这是**数据漂移门禁**，需线上 DB + ckpt，属**部署期/发布前**检查（不进 CI，因 CI 无生产数据）；npm 别名 `npm run spawn:drift-check -- --db <db> --ckpt <pt>`。训练侧 `train_v3.py` 会打印 θ-regime 分布并与上一版 ckpt 的参考画像做非致命漂移对照。
- **CI 回归门禁**：每次 push / PR 安装 CPU 版 torch + numpy 后跑 `test_drift`（PSI / θ 归一化 / 63 维契约 / 漂移参考构建）与 `test_v3`（63 维前向、`board_proj=127`、AR 头、LoRA 往返）。守护的是**逻辑与张量契约不回退**；web↔python 维度 parity 由 vitest 覆盖。本地等价命令：`npm run spawn:gate`。
- **显式 θ 日志就绪度门禁**：`python -m rl_pytorch.spawn_model.theta_readiness --db <db>`（npm 别名 `spawn:theta-readiness`）。重训**前置**检查 `ps.adaptive.stressBreakdown.pbCurveParams` 的三项指标：覆盖率、θ-regime 数、归一化后跨度。任一不达标（默认 80% / ≥2 / ≥0.05）→ 退出码 3，说明显式 θ 那 4 列接近常数、重训学不到 θ→出块映射（此时显式 θ 仅为安全网，需先让 L2 tuner 产出有差异的 PB 曲线 θ 并累计新日志）。属数据相关的部署/重训前门禁，不进 CI。

---

## 4. 规则 vs学习：选型建议

| 维度 | 规则 | SpawnPolicyNet |
|------|------|---------------------|
| 可解性保证 | 强（高填充 DFS） | 弱（数据+损失间接） |
| 可解释性 | 强（`_spawnDiagnostics`） | 弱（需归因工具） |
| 个性化 | 依赖画像→stress→权重 | 直接吃 57 维行为上下文 + 历史 + playstyle/LoRA |
| 冷启动 | 无数据即可 | 需足够 `spawn` 样本 |
| 运维 | 调 JSON与乘子 | 再训练、版本管理、回退 |

**推荐策略**：默认规则保证体验底线；积累会话数据后训练模型，在 A/B 中对比 **留存、局时长、挫败率** 再扩大流量。

---

## 5. 代码与文档索引

| 主题 | 路径 |
|------|------|
| 规则出块核心 | `web/src/bot/blockSpawn.js` |
| 自适应与 hints | `web/src/adaptiveSpawn.js` |
| 集成与模型分支 | `web/src/game.js` |
| 三层架构说明 | [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md) |
| 自适应系统设计 | [`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) |
| 数据集与特征 | `rl_pytorch/spawn_model/dataset.py` |
| 行为样本集（append-only/WORM） | `server.py`（`spawn_dataset_samples` 表 + `/api/spawn-dataset/sync\|stats`） |
| B.2 样本集库展示（行为集注入） | `backend/spawn_tuning_v2_backend.py`（`BEHAVIOR_SET_ID` 合成集）、`web/src/tuning/v2/dashboardV2.js` |
| 真实对局 → v2 寻参样本（转换器） | `rl_pytorch/spawn_tuning_v2/behavior_import.py`（`session_to_v2_sample`，复用 `extractor.extract_d_curve`）、端点 `POST /api/spawn-tuning-v2/import-behavior`、按钮「👤→📊 导入真实样本」 |
| 网络定义（V3.1） | `rl_pytorch/spawn_model/model_v3.py` |
| 训练（V3.1，8 项损失） | `rl_pytorch/spawn_model/train_v3.py` |
| 损失 helper（anti/diff/div） | `rl_pytorch/spawn_model/train.py` |
| 可行性子系统 | `rl_pytorch/spawn_model/feasibility.py` |
| 分布漂移监控 / 门禁 | `rl_pytorch/spawn_model/drift.py`、`drift_check.py` |
| LoRA 个性化 | `rl_pytorch/spawn_model/lora.py`、`personalize.py` |
| 网络定义（V2，历史） | `rl_pytorch/spawn_model/model.py` |
| 前端推理 | `web/src/spawnModel.js` |

---

## 附录：候选块概率图鉴

> **来源**：由 Canvas `candidate-blocks.canvas.tsx` 转换。  
> **定位**：说明 OpenBlock 候选块池、基础抽样概率、难度档位权重和运行时动态因子，便于验证"出块概率"展示与策略逻辑。

### 核心结论

OpenBlock 的候选块从 **40 个形状** 池中按类别权重抽样。基础概率由：

> **基础概率 = 类别权重 / Σ(类别权重 × 类别成员数)**

运行时再叠加清屏、多消、机动性、节奏、玩家画像等 12+ 个动态因子，形成最终选择。

| 指标 | 数值 |
|---|---|
| 候选形状总数 | 28 |
| 形状类别 | 7 |
| 平均单元数 | 约 3.7 |
| 自适应难度档位 | 10 |

### Normal 难度类别占比

单格抽样中各类别的概率分布由权重和成员数共同决定。

| 类别 | 权重 w | 成员数 n | w × n |
|---|---|---|---|
| 线条 | 1.40 | 4 | 5.60 |
| 矩形 | 1.20 | 2 | 2.40 |
| 方形 | 1.10 | 2 | 2.20 |
| T 形 | 0.95 | 4 | 3.80 |
| Z 形 | 0.90 | 4 | 3.60 |
| L 形 | 1.20 | 8 | 9.60 |
| J 形 | 0.95 | 4 | 3.80 |

### 单形状概率解释

单形状概率不是简单看类别权重，而是看"类别权重被类别成员数分摊后的结果"。L 形类别整体占比高是因为成员数多，但单个 L 形的概率低于类别直觉。线条类成员少，所以单个线条块的概率通常更高。

### 难度权重矩阵的作用

自适应引擎根据玩家压力 `stress ∈ [-0.2, 0.85]` 在多个 profile 间插值出实时权重；菜单难度 Easy / Normal / Hard 提供静态基线。

| 档位类型 | 策略倾向 |
|---|---|
| Easy | 增加小块、线性块和高机动块，减少复杂拐角块 |
| Normal | 在可消行、可填缝和多样性之间平衡 |
| Hard | 增加更依赖顺序、位置和空间结构的块 |
| Adaptive Low Stress | 允许更大块、更复杂块，制造挑战 |
| Adaptive High Stress | 增加可放置、可救援、可消行的块，降低死局概率 |

### 运行时动态因子

| 层级 | 因子 | 倍率 |
|---|---|---|
| Layer 1 | 完美清屏 | ×12.0 |
| Layer 1 | 清屏准备 | ×1-7 |
| Layer 1 | 多消潜力 | ×1.6-2.7 |
| Layer 1 | 机动性 | ×log(1+P) |
| Layer 1 | 空洞修复 | ×1-2 |
| Layer 1 | 临消行加成 | ×1-3 |
| Layer 2 | Combo 链 | ×1-1.8 |
| Layer 2 | 节奏 payoff | ×1.7 |
| Layer 2 | Size 偏好 | ×0.5-2.5 |
| Layer 2 | 类别多样性 | ×0.2-1 |
| Layer 3 | ClearGuarantee | ×1.6-2.1 |
| Layer 3 | 里程碑 | ×1.3 |

### UI 展示建议

候选块概率展示应遵循：
- 展示"出块概率"，不要展示"候选块概率"。
- 优先展示最终归一化后的具体形状概率。
- 类别权重只作为策略解释，不作为用户主指标。
- 动态因子应独立说明。

### 策略合理性检查

| 检查项 | 合理表现 | 风险表现 |
|---|---|---|
| 高压局 | 小块、可放置块、消行块概率上升 | 仍持续生成大块或低机动块 |
| 低压局 | 大块、复杂块、多样性上升 | 长期只给保守块 |
| 多消窗口 | 可触发多线消除的块被放大 | 多消机会存在但概率不变 |
| 清屏窗口 | gap 填充块被强加权 | 清屏差一步时仍随机出块 |
| 类别重复 | 同类块短期降权 | 连续多轮重复同一结构 |

### 个性化对出块概率的影响

新增 `motivationIntent` 只改变概率倾向，不绕过可解性与几何校验：

| 个性化信号 | 概率变化 |
|---|---|
| 回归暖启动 | 小块、可消行块、多消友好块权重上升 |
| 可访问性负担 | 小块和高机动块上升，复杂顺序块下降 |
| 收集/完成动机 | 同 icon / bonus 目标上升 |
| 高手挑战动机 | 多样性、多消、顺序规划块上升 |
| 社交公平挑战 | 个性化概率关闭，固定规则保证可比 |

---

## 6. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-05-29 | **下线合成「用户行为样本集 (自动同步)」哨兵集**(原 `BEHAVIOR_SET_ID=900000001`)。该集与 v2 寻参 `d_curve` schema 异构、不可参训也不可删, 在 B.2 里只是占位 → 直接移除(后端删除哨兵注入/详情/预览/下载/守卫与 `_behavior_*` 辅助, 前端删除其行渲染/专属预览/选择器过滤)。主库 `spawn_dataset_samples` WORM 原始档**保留**, 继续作为「用户行为样本集 (寻参可训)」的数据源。**寻参可训集删除后如何再生**:它是普通可变集, 整集可删; 删除后下次打开面板(`DOMContentLoaded` 静默 `import-behavior`)或点「👤→📊 同步用户行为样本」即按集名重建(新 `set_id`), 增量从主库回放转换, 质量门照常过滤废局 |
| 2026-05-29 | 真实样本集**自动增量同步 + 无效数据质量门**。`import-behavior` 改增量(每样本 `seed=session_id` 去重, 默认 `rebuild=false`), 前端 `DOMContentLoaded` 后台静默同步 → 「用户行为样本集 (寻参可训)」自动出现在 B.2 与训练选择器(普通可变集, 可删/可训)。**两类用户行为集职责分离**:① `BEHAVIOR_SET_ID=900000001`「(自动同步)」= 主库 `spawn_dataset_samples` WORM 原始档(append-only, 不可删, 预览/下载)②「(寻参可训)」= 整理后的 v2 `samples`(可变, full CRUD)。无效数据质量门(`is_valid_real_sample`: `survived_steps<5` / `n_bins_filled<2` / `final_score<1` → 废局)在导入时过滤 + 已入库清理, 自动同步下一致跳过不复活(实测 970→921, 滤除 49 废局) |
| 2026-05-29 | **真实对局作为 v2 寻参样本的「第二类数据源」**（构造样本 vs 玩家真实，本质同 schema）。新增转换器 `rl_pytorch/spawn_tuning_v2/behavior_import.py`：把主库 `spawn_dataset_samples` 的每局 frames → 1 条 v2 `samples` 行（5 维 context + 27 维 θ + 20 维 d_curve + 辅助标签）。d_curve **复用 `extractor.extract_d_curve`**（与 samplerV2/policyMetricsV2 同公式，跨语言一致）；`action_freedom` 未落库 → 由帧内 `grid.cells`+`dock`（`shared/shapes.json` 几何）**回放合法落子数/64** 重算；θ 取该局实际 `pbCurveParams`（4 维）叠默认 27 维；context 由 `provenance.spawnSource`→generator、`_v2_pb_bin(pb)`、`stressBreakdown.lifecycleStage`(S0–S4)→v2 四阶段 推导；死局补 `no_move` 步。端点 `POST /api/spawn-tuning-v2/import-behavior`（幂等全量重建）写入普通 sample_set（tag `real,field,behavior`，`algo_version=real-v1`），自动出现在 B.2 与训练选择器（标 👤真实），与构造样本无差别地进 d_curve 寻参训练/评估（实测 120 条真实样本可训，val_mae 0.15→0.11）。前端「👤→📊 导入真实样本」按钮。注：真实局多数 r=score/PB<0.5，高 r bin 由 `bin_counts` 置信加权 mask |
| 2026-05-29 | 校准 §3 至 V3.1 实现：自回归联合分布、8 项损失（新增 feasibility BCE / soft-infeasible / style / intent，并给出默认权重）、57 维上下文（sprint）、`model_v3/train_v3` 网络与头、`spawn_transformer_v3.pt` 产物、§3.6 LoRA/可行性，并修复前端 56→57 维不一致 |
| 2026-05-10 | V3.1：生成式模型升级为 56 维行为上下文，新增 `spawnIntent` 辅助头，旧 V3 权重不兼容 |
| 2026-04-17 | 初版：双轨建模、规则目标/特征、V2 损失与网络、数据与索引 |
