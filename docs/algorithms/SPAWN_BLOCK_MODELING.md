# 出块建模：规则引擎与 SpawnTransformer

> 版本：1.2 | 更新：2026-05-02  
> 本文在实现细节之上，给出**可复用的设计 rationale**，并与 [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md)、[`ADAPTIVE_SPAWN.md`](./ADAPTIVE_SPAWN.md) 互补：后两者偏「模块说明与配置」，本文偏「问题形式化 + ML 侧数学结构」。

---

## 1. 总览：双轨出块

Open Block 的每轮出块要产出 **三个不重复形状**（dock triplet）。系统提供两条可切换路径：

| 路线 | 核心思想 | 优点 | 典型失败/代价 |
|------|----------|------|----------------|
| **规则引擎** | 手工特征 + 多层启发式权重 + **硬约束过滤** | 可解释、可保证公平性与可解性 | 规则复杂、跨用户风格难极致拟合 |
| **SpawnTransformerV2** | 从对局日志学习 **条件分布** \(P(s_1,s_2,s_3 \mid \text{board}, \text{context}, \text{history})\) | 能拟合真实玩家环境下的出块模式 | 需数据、需防「分数膨胀」等捷径 |

运行时：`game.js` 根据 `getSpawnMode()` 选择 `_spawnBlocksWithModel` 或 `generateDockShapes`；模型推理失败时 **自动回退** 到规则路径（见 `web/src/game.js`）。

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
   - 离散/结构化量：`spawnHints`（`clearGuarantee`、`sizePreference`、`diversityBoost`、`comboChain`、`multiClearBonus`、`rhythmPhase`、session 相关字段等）。

   规则出块层 **不直接读画像**，只读 `strategyConfig`（权重 + hints），保证单一数据契约。

### 2.2 优化目标（显式与隐式）

规则路径没有单一损失函数，但可归纳为 **多目标在权重中折衷**：

| 目标 | 含义 | 主要落实位置 |
|------|------|----------------|
| **公平 / 可玩** | 避免无解三连、高填充仍有一定落子自由度 | `minMobilityTarget`、`tripletSequentiallySolvable` |
| **救场与修形** | 减空洞、利用多消窗口 | `bestHoleReduction`、`bestMultiClearPotential`、拓扑特征 |
| **心流与挫败恢复** | 无消行后的救济、里程碑正反馈 | `spawnHints`（Layer 2/3）+ `augmentPool` 乘子 |
| **多样性** | 同轮去重、跨轮品类记忆、`diversityBoost` | `usedCategories`、`catFreq` 惩罚 |
| **与策略档位一致** | 低 stress 偏线条、高 stress 偏不规则 | `shapeWeights`（`adaptiveSpawn` 输出） |
| **多轴压力消费** | stress 不只映射块型，还映射到解空间、消行机会、空间压力、payoff 与新鲜度 | `spawnHints.spawnTargets` |

### 2.3 方法（算法结构）

1. **形状级特征与先验排序**  
   对每个可放置形状计算：`gapFills`（`findGapPositions`：行/列 **1～4** 空格上的补洞潜力）、`placements`、`multiClear`（**始终**用 `bestMultiClearPotential` 计算）、`pcPotential`（疏板或 `pcSetup` 时评估一手清屏）、`holeReduce`（高填充且空洞多）、以及 `weight`。默认按 `pcPotential`、`multiClear`、`gapFills` 排序。

2. **两阶段构造 triplet**  
   - **阶段 1**：从「消行相关」子集占坑：`gapFills>0` **或** `multiClear≥1` **或** `pcPotential===2`（v3.4），再按 `clearGuarantee` / `effectiveClearTarget`；高 `multiClearBonus` 时排序偏向「多消 + 缺口 + 清屏」综合分。  
   - **阶段 2**：对剩余槽位做 **加权抽样** `pickWeighted(augmentPool(...))`，权重为多层乘子（机动性、空洞、多消、combo、节奏、`sizePreference`、多样性惩罚、里程碑等）。

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

---

## 3. 学习路径：SpawnTransformerV2

实现见 `rl_pytorch/spawn_model/model.py`、`dataset.py`、`train.py`；前端上下文对齐见 `web/src/spawnModel.js`。

### 3.1 建模思路

1. **行为克隆式的结构化输出**  
   训练标签来自真实对局：每一帧 `spawn` 事件记录 dock 三块形状 ID。模型学习在相同 **棋盘二值矩阵**、**24 维玩家/自适应上下文**、**历史三连形状** 条件下，复现（并泛化）数据中的出块分布。

2. **条件难度嵌入（Difficulty conditioning）**  
   引入标量 `target_difficulty ∈ [0,1]`，经 `difficulty_proj` 映射为与状态同维的 token，使推理时可 **显式拨动压力**（易 ↔ 难），与规则里 `stress` 的语义对齐但参数化方式不同。

3. **多任务头：主预测 + 辅助约束**  
   仅用 CE 模仿分布易导致 **捷径学习**（例如永远预测易消块刷分）。因此增加：
   - **多样性头**：预测每槽形状所属 **品类**（7 类），与真实品类对齐；
   - **难度回归头**：预测 `compute_target_difficulty(context)`，强化上下文与「挑战度」的耦合；
   - **反膨胀损失**：在高技能且低填充时对「易形状」softmax 质量惩罚。

4. **与规则的关系**  
   ML 路径 **不保证** `tripletSequentiallySolvable`；依赖数据分布与损失塑形。上线时以规则为 **安全回退**，形成「探索（ML）+ 保险（规则）」产品策略。

### 3.2 优化目标与损失函数

训练总损失（`train.py`）：

\[
\mathcal{L} =
w_{\mathrm{ce}}\mathcal{L}_{\mathrm{ce}}
+ w_{\mathrm{div}}\mathcal{L}_{\mathrm{div}}
+ w_{\mathrm{anti}}\mathcal{L}_{\mathrm{anti}}
+ 0.1\,\mathcal{L}_{\mathrm{diff}}
\]

**（1）主分类 \(\mathcal{L}_{\mathrm{ce}}\)**  

对三个槽位各自做交叉熵，**按样本权重 `weight` 加权平均**（`reduction='none'` 再 `mean`）。权重设计见 3.3 节。  
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
+ 0.08\,\mathrm{fill} - 0.08\,\mathrm{holes} - 0.1\,\mathrm{boardRisk}
+ 0.06\,\mathrm{nearClear},\, 0,\,1
\bigr)
\]

`stress` 在这里保持与规则轨一致：越高代表越强挑战目标。`boardRisk` 来自 `adaptiveSpawn._stressBreakdown.boardRisk`，用于在高填充、空洞或能力风险较高时抵消过度挑战，避免模型轨和规则轨对危险盘面的解释相反。

规则轨还会读取 `spawnTargets`：

- `shapeComplexity`：控制品类复杂度，而不是只依赖 profile 形状权重。
- `solutionSpacePressure`：调节解法数量过滤和首手自由度。
- `clearOpportunity`：控制消行席位和 gap/multiClear 权重。
- `spatialPressure`：控制占格压力和大块/小块倾向。
- `payoffIntensity`：强化多消/清屏兑现。
- `novelty`：提高品类多样性、降低重复疲劳。

对 `difficulty_head` 输出做 MSE。推理时前端可用同一公式或手动指定 `targetDifficulty`。

**优化方法**

- 优化器：**AdamW**（`weight_decay=1e-4`）
- 调度：**CosineAnnealingLR**，\(T_{\max}=\) `epochs`
- 稳定技巧：**grad clip** 范数 1.0
- 验证：仅监控加权 CE（forward 不传 `target_difficulty` 时用默认 0.5），避免验证集与训练条件不一致带来的误解（若需严格对齐可再改验证逻辑）。

### 3.3 特征设计（学习侧）

**（1）棋盘**  
`8×8` 二值矩阵（有块为 1），与规则层 `Grid` 对齐；展平为 64 维后与 context 拼接进入 `board_proj`。

**（2）24 维上下文向量**（`dataset._parse_context`）  

| 索引 | 语义 | 说明 |
|------|------|------|
| 0 | `score/500` | 分数尺度归一 |
| 1 | `boardFill` | 填充率 |
| 2 | `skill` | 实时技能 |
| 3 | `momentum` | 动量 |
| 4–7 | `frustration`, `cognitiveLoad`, `engagementAPM/30`, `flowDeviation` | 情绪/认知/参与 |
| 8–11 | `needsRecovery`, `hadNearMiss`, `isNewPlayer`, `recentComboStreak/5` | 布尔或截断计数 |
| 12–16 | `clearRate`, `missRate`, `comboRate`, `thinkMs/10000`, `afkCount/5` | 窗口统计 |
| 17–19 | `historicalSkill`, `trend`, `confidence` | 长周期估计 |
| 20–23 | `stress`（clip）, `flowState` 编码, `pacingPhase` 编码, `sessionPhase` 编码 | 与自适应引擎对齐的离散/连续信号 |

枚举映射：`_FLOW_MAP`（bored/flow/anxious）、`_PACING_MAP`、`_SESSION_MAP`（与 `player_state` JSON 中字段一致）。

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

**Token 构造**（序列长度 \(1+1+1+9=12\)）：

1. **CLS**：可学习向量 `cls_token`，聚合全局表示。  
2. **State token**：`[board_flat(64) ; context(24)]` → `Linear(88→d_model)` + GELU + LayerNorm。  
3. **Difficulty token**：`target_difficulty (1)` → `Linear(1→d_model)` + GELU + LayerNorm。  
4. **History tokens（9 个）**：每个 cell为形状 ID → `Embedding(NUM_SHAPES+1, d_model)`，加 `history_pos`，`padding_idx=NUM_SHAPES`（与实现一致）。

**编码器**：`nn.TransformerEncoder`（`batch_first=True`，激活 GELU），输出经 `LayerNorm`，取 **CLS 位置** `encoded[:, 0]`。

**输出头**（均接在 CLS 上）：

| 头 | 维度 | 作用 |
|----|------|------|
| `head_0/1/2` | 各 `NUM_SHAPES`（28） | 三槽形状分类 logits |
| `diversity_head` | `7 × 3` → reshape `(3, 7)` | 每槽品类 logits |
| `difficulty_head` | `1` | 难度回归 |

**推理 `predict`**：对三槽依次在 softmax 上 **top-k 多项式采样**（默认 `top_k=8`），已选形状 logits 减大惩罚（`-10`）避免重复 ID。温度 `temperature` 缩放 logits。

**参数量级**：约数十万级（与 `train.py` 打印的 `count_params()` 一致），适合 CPU 推理与快速迭代。

### 3.5 数据管线与产物

- **来源**：SQLite `sessions` + `move_sequences.frames`（JSON），筛选 `completed` 且 `score ≥ min_score`，按分降序取 `max_sessions`。  
- **样本**：每个 `spawn` 帧一条；`place` 后更新 `last_grid` 供下一 spawn 使用。  
- **产物**：`models/spawn_transformer.pt`（含 `model_state_dict`、架构超参、`context_dim`、`model_version` 等）；状态 JSON `spawn_train_status.json` 供 UI 展示进度。

---

## 4. 规则 vs学习：选型建议

| 维度 | 规则 | SpawnTransformerV2 |
|------|------|---------------------|
| 可解性保证 | 强（高填充 DFS） | 弱（数据+损失间接） |
| 可解释性 | 强（`_spawnDiagnostics`） | 弱（需归因工具） |
| 个性化 | 依赖画像→stress→权重 | 可直接吃24 维上下文 + 历史 |
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
| 网络定义 | `rl_pytorch/spawn_model/model.py` |
| 训练 | `rl_pytorch/spawn_model/train.py` |
| 前端推理 | `web/src/spawnModel.js` |

---

## 6. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-04-17 | 初版：双轨建模、规则目标/特征、V2 损失与网络、数据与索引 |
