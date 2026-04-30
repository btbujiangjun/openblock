# 出块算法：三层架构

> 版本: v3.1 | 更新: 2026-04-30  
> 建模思路、优化目标、特征与网络结构的形式化说明见 `docs/SPAWN_BLOCK_MODELING.md`。

## 1. 概述

出块算法是 Open Block 的核心体验引擎，决定了每轮为玩家提供哪三个候选方块。算法采用**三层架构**，从即时盘面到跨局体验，逐层叠加影响：

```
┌─────────────────────────────────────────────┐
│  Layer 3: 局间体验 (Cross-Game)              │
│  session 弧线 · 里程碑庆祝 · 回流玩家热身    │
├─────────────────────────────────────────────┤
│  Layer 2: 局内体感 (Within-Game)             │
│  combo 链催化 · 多消鼓励 · 节奏 setup/payoff │
│  品类记忆 · 多样性                            │
├─────────────────────────────────────────────┤
│  Layer 1: 即时出块 (Immediate)               │
│  盘面拓扑 · 多消潜力 · 空洞修复 · 反死局     │
│  机动性保障 · 可解性验证                      │
└─────────────────────────────────────────────┘
         ↑ 盘面状态 (Grid)
```

## 2. 数据流

```
game.js
  ├── 构建 spawnContext {lastClearCount, roundsSinceClear, recentCategories, totalRounds, scoreMilestone}
  │
  ├── adaptiveSpawn.js ← resolveAdaptiveStrategy(strategy, profile, score, runStreak, fill, spawnContext)
  │     ├── Layer 3: deriveSessionArc(), checkMilestone()
  │     ├── Layer 2: deriveComboChain(), deriveMultiClearBonus(), deriveRhythmPhase()
  │     ├── 多维信号 → stress → interpolateProfileWeights → shapeWeights
  │     └── 输出: { shapeWeights, spawnHints: {clearGuarantee, sizePreference, diversityBoost,
  │                  comboChain, multiClearBonus, rhythmPhase, sessionArc, scoreMilestone} }
  │
  └── blockSpawn.js ← generateDockShapes(grid, strategyConfig, spawnContext)
        ├── Layer 1: analyzeBoardTopology() → {holes, flatness, nearFullLines, colHeights}
        ├── Layer 1: bestMultiClearPotential() — 每个形状的最大同消行数
        ├── Layer 1: bestHoleReduction() — 放置后空洞减少量
        ├── 阶段 1: 消行候选选取（clearGuarantee + combo 催化 + 多消优先排序）
        ├── 阶段 2: 加权抽样（三层信号整合到权重乘子）
        ├── 校验: minMobilityTarget + tripletSequentiallySolvable
        └── 输出: 三连块 + _spawnDiagnostics（供面板解释）

_commitSpawn()（颜色分配）
  ├── clearScoring.monoNearFullLineColorWeights(grid, skin)
  │     └── 扫描“差 1~2 格即满”的行列；若已填格同 icon（有 blockIcons）或同色（无 icon）
  │        则给对应 dock 色位累加偏置权重
  ├── clearScoring.pickThreeDockColors(biasWeights)
  │     └── 8 色池无放回加权抽样，输出 3 个互异 colorIdx
  └── descriptors[i].colorIdx = dockColors[i]
```

### 2.1 v3.1 新增：颜色采样与 bonus 计分目标对齐

此前 dock 颜色使用纯洗牌（随机前三色），与“同 icon/同色 bonus 线”的计分目标是弱耦合。  
v3.1 起，颜色分配改为**轻偏置随机**：

- **目标不变**：形状可解性与保命逻辑仍由 `blockSpawn.js` 主导；
- **颜色侧软目标**：当盘面存在“近满且已同 icon/同色”的行列时，提升相关色在当前 3 个候选块中的出现概率；
- **随机性保留**：采用无放回加权抽样而非硬指定，避免玩家感知“被喂牌过重”。

这使出块体感与 `detectBonusLines` / `computeClearScore` 的奖励方向更一致：  
玩家在临门一脚阶段更容易拿到“语义上正确”的补线颜色，但不会破坏整体多样性。

**RL 训练环境（PyTorch / MLX）**：形状生成与 Web 同源的 `block_spawn`；dock 颜色由 `rl_pytorch/dock_color_bias.py`（及 `rl_mlx` 副本）实现同一套偏置，色数取策略 `color_count`，使策略梯度里的奖励分布与主局更一致。

## 3. Layer 1: 即时出块 — 盘面感知

### 3.1 盘面拓扑分析 `analyzeBoardTopology(grid)`

| 指标 | 计算方式 | 用途 |
|------|---------|------|
| `holes` | 每列中，有方块覆盖上方但自身为空的格数之和 | 高空洞 → 优先出能修复空洞的块 |
| `flatness` | `1 / (1 + 列高度方差)` | 低平整 → 偏好能平衡高度的块 |
| `maxColHeight` | 最高列的高度 | 危险指标 |
| `nearFullLines` | 行/列中仅缺 1~2 格即满的数量 | 多消潜力指标 |
| `colHeights` | 每列高度数组 | 供其他分析使用 |

### 3.2 多消潜力评分 `bestMultiClearPotential(grid, shapeData)`

对每个候选形状，遍历所有合法放置位，用 `grid.previewClearOutcome` 模拟放置后的消行数，返回最大值。当该形状 `multiClear ≥ 2` 时在权重中获得额外加成：

```
w *= 1 + (multiClear - 1) * (0.3 + multiClearBonus * 0.5)
```

### 3.3 空洞修复评分 `bestHoleReduction(grid, shapeData, currentHoles)`

仅在 `fill > 0.5 && holes > 2` 时激活。对每个合法位模拟放置+消行，比较前后空洞数变化。能减少空洞的形状获得权重加成：

```
w *= 1 + holeReduce * 0.4
```

### 3.4 机动性保障

- `minMobilityTarget(fill, attempt)`: 盘面越满，要求每个候选块的最少合法落点数越高
- 随重试次数逐步放宽（每 5 次 -1），避免过度严苛导致超时
- 高填充档位已强化：`fill ≥ 0.68` 起进入更高最低落点要求，`0.75+`、`0.88+` 进一步加严，减少“只有极少落点”的窄路组合

### 3.5 可解性验证

当 `fill ≥ 0.52` 时，执行 `tripletSequentiallySolvable`：DFS 搜索三块的所有排列顺序（6 种），验证存在某种放置序列使三块均能落下。搜索预算 14000 节点。

危险态（`fill ≥ 0.68` 或 `roundsSinceClear ≥ 3`）会启用严格校验：前 70% 重试尝试使用更高搜索预算，且预算耗尽不再默认放行。该策略只在高风险窗口启用，用于降低“刚出块就怼死”的概率。

## 4. Layer 2: 局内体感

### 4.1 Combo 链催化

**信号来源**: `spawnContext.lastClearCount` + `profile.recentComboStreak`

```javascript
comboChain = min(1, streak * 0.25 + (lastClear > 0 ? 0.3 : 0))
```

**对出块的影响**:
- `comboChain > 0.5` → `clearGuarantee` 至少为 2
- `comboChain > 0.3` → 消行候选按 `multiClear + gapFills` 综合排序
- 加权抽样中 `gapFills > 0` 的块获得 `1 + comboChain * 0.8` 乘子

**设计意图**: 消行后的下一轮"延续感"——玩家刚完成消除，新出的块更容易触发新一轮消除，形成正反馈循环。

### 4.2 多消鼓励

```javascript
multiClearBonus = roundsSinceClear > 3 ? 0.6 : fill > 0.55 ? 0.3 : 0.1
```

长时间未消行 → 更强的多消偏好，帮助玩家"破冰"。

### 4.3 节奏相位 (Rhythm Phase)

| 相位 | 触发条件 | 出块行为 |
|------|---------|---------|
| `setup` | pacing 紧张期 + 刚消过行 | 偏好 4~6 格构型块（蓄力） |
| `payoff` | pacing 释放期 或 连续 ≥3 轮未消行 | 偏好消行块 + 多消块 |
| `neutral` | 其他 | 标准权重 |

补充：连续无消行会进入救援态。`roundsSinceClear ≥ 2` 时 `clearGuarantee` 至少为 2；`roundsSinceClear ≥ 4` 时至少为 3，并额外偏小块（`sizePreference ≤ -0.35`）。

### 4.4 品类记忆

- **同轮**: `usedCategories` 防止同一轮出重复品类
- **跨轮**: `_categoryMemory` 记录最近 3 轮已出品类，频次 > 2 的品类权重衰减 `max(0.4, 1 - (freq-2) * 0.12)`
- **diversityBoost**: 来自自适应引擎，无聊心流时提高，进一步惩罚同品类重复

## 5. Layer 3: 局间体验

### 5.1 Session 弧线 (Session Arc)

| 阶段 | 条件 | 对 stress 的影响 | 对 spawnHints 的影响 |
|------|------|-----------------|---------------------|
| `warmup` | `totalRounds ≤ 3` | `-0.08` | `clearGuarantee ≥ 2`, `sizePreference ≤ -0.2` |
| `peak` | 中间阶段 | 0 | 正常 |
| `cooldown` | `sessionPhase === 'late'` | `-0.05` (当 momentum < -0.2) | 正常 |

**设计意图**: 每局都有"起承转合"——开局友好建立信心，中期正常挑战，后期适当放松避免疲劳导致的挫败。

### 5.2 分数里程碑

里程碑分数: `[50, 100, 150, 200, 300, 500]`

当分数首次跨越里程碑时:
- `clearGuarantee ≥ 2`
- `sizePreference ≤ -0.2`
- 加权抽样中消行块额外 `×1.3`

**设计意图**: 在玩家达到成就点时，给出一轮"奖励性"出块，配合策略面板的"🎉 里程碑达成"提示，制造"绝处逢生"的爽感。

### 5.3 长周期信号（继承自 playerProfile）

- **trend**: 长周期进步/退步趋势 → stress 微调
- **confidence**: 数据置信度 → 收窄/放宽技能调节幅度
- **historicalSkill**: 历史综合技能 → 与实时技能混合

## 6. 策略解释面板同步

### 6.1 投放区新增指标

| 指标 | 来源 | 说明 |
|------|------|------|
| 连击 | `spawnHints.comboChain` | Combo 链强度 |
| 多消 | `spawnHints.multiClearBonus` | 多消鼓励强度 |
| 节奏 | `spawnHints.rhythmPhase` | 搭建/收获/中性 |
| 弧线 | `spawnHints.sessionArc` | 热身/巅峰/收官 |
| 空洞 | `spawnDiagnostics.layer1.holes` | 盘面空洞数 |
| 平整 | `spawnDiagnostics.layer1.flatness` | 表面平整度 |
| 近满 | `spawnDiagnostics.layer1.nearFullLines` | 接近满行数 |

### 6.2 策略建议新增条目

| 条件 | 图标 | 标题 | 类别 |
|------|------|------|------|
| `comboChain > 0.5` | 🔥 | 延续连击 | combo |
| `rhythmPhase === 'payoff'` | 💎 | 收获期 | pace |
| `rhythmPhase === 'setup'` | 🏗️ | 搭建期 | build |
| `nearFullLines ≥ 3` | 🎯 | 多消机会 | clear |
| `sessionArc === 'warmup'` | 🌅 | 热身阶段 | explore |
| `sessionArc === 'cooldown'` | 🌙 | 收官阶段 | pace |
| `scoreMilestone` | 🎉 | 里程碑达成 | combo |

### 6.3 出块诊断 `_spawnDiagnostics`

每轮出块后记录:

```json
{
  "layer1": { "fill": 0.45, "holes": 2, "flatness": 0.72, "nearFullLines": 3, "maxColHeight": 6 },
  "layer2": { "comboChain": 0.55, "multiClearBonus": 0.3, "rhythmPhase": "payoff", "divBoost": 0.15, "recentCatFreq": {"lines": 2, "rects": 1} },
  "layer3": { "scoreMilestone": false, "roundsSinceClear": 1, "totalRounds": 12 },
  "chosen": [
    { "id": "line_h5", "category": "lines", "reason": "clear" },
    { "id": "rect_2x3", "category": "rects", "reason": "weighted" },
    { "id": "tshape_t", "category": "tshapes", "reason": "weighted" }
  ],
  "attempt": 2
}
```

## 7. 配置参数

### game_rules.json 相关

| 路径 | 说明 |
|------|------|
| `adaptiveSpawn.profiles[].stress` | 10 档压力-权重映射 |
| `adaptiveSpawn.pacing.cycleLength` | 节奏周期长度 |
| `adaptiveSpawn.pacing.tensionPhases` | 紧张期轮数 |
| `adaptiveSpawn.engagement.frustrationThreshold` | 挫败触发阈值 |
| `adaptiveSpawn.flowZone.recoveryFillThreshold` | 恢复模式触发填充率 |

### blockSpawn.js 内置常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `MAX_SPAWN_ATTEMPTS` | 22 | 最大重试次数 |
| `FILL_SURVIVABILITY_ON` | 0.52 | 可解性验证触发填充率 |
| `SURVIVE_SEARCH_BUDGET` | 14000 | DFS 搜索预算 |

### adaptiveSpawn.js 里程碑

| 里程碑分数 | 效果 |
|-----------|------|
| 50, 100, 150, 200, 300, 500 | 庆祝出块（clearGuarantee↑, sizePreference↓） |

## 8. 行业对标

| 维度 | Block Blast 等竞品 | Open Block 实现 |
|------|-------------------|----------------|
| 放置性校验 | 生成时验证可放置 | `tripletSequentiallySolvable` ✅ |
| 盘面感知 | 扫描缺口、精准填补 | `analyzeBoardTopology` + `bestMultiClearPotential` + `bestHoleReduction` ✅ |
| 救济机制 | 困境出"绝处逢生"块 | recovery/frustration + 空洞修复权重 ✅ |
| Combo 催化 | 消行后催化续链 | `comboChain` + 消行候选多消排序 ✅ |
| 多样性 | 同轮去重 + 跨轮记忆 | `usedIds` + `_categoryMemory` + `diversityBoost` ✅ |
| 节奏曲线 | setup/payoff 交替 | `rhythmPhase` + pacing 周期 ✅ |
| Session Arc | 开局热身→收尾 | `sessionArc` warmup/peak/cooldown ✅ |
| 里程碑 | 分数节点友好出块 | `MILESTONE_SCORES` + 庆祝出块 ✅ |

## 9. SpawnTransformerV2：生成式推荐模型

### 9.1 概述

除了规则算法（Layer 1-3），系统还提供基于 Transformer 的**生成式推荐模型**，从玩家行为序列中学习出块策略。用户可在运行时切换规则算法和模型推荐。

```
┌────────────────────────────────────────────────────────┐
│              SpawnTransformerV2 架构                     │
├────────────────────────────────────────────────────────┤
│                                                        │
│   输入:                                                │
│   ┌───────────────┐ ┌──────────┐ ┌──────────────┐     │
│   │ Board 8×8=64  │ │Context 24│ │ Difficulty 1 │     │
│   └───────┬───────┘ └────┬─────┘ └──────┬───────┘     │
│           │              │              │              │
│           └──── concat ──┘              │              │
│                  │                      │              │
│           ┌──────┴──────┐    ┌──────────┴──────────┐   │
│           │ board_proj  │    │  difficulty_proj     │   │
│           │ 88→d_model  │    │  1→d_model           │   │
│           └──────┬──────┘    └──────────┬──────────┘   │
│                  │                      │              │
│   ┌──────┐  ┌───┴───┐  ┌───────┐  ┌───┴───┐          │
│   │ CLS  │  │ state │  │  diff │  │history │×9        │
│   └──┬───┘  └───┬───┘  └───┬───┘  └───┬───┘          │
│      └──────────┴──────────┴──────────┘               │
│                      │                                 │
│           ┌──────────┴──────────┐                      │
│           │  Transformer Enc.   │                      │
│           │  (2层 4头 d=128)    │                      │
│           └──────────┬──────────┘                      │
│                      │ CLS output                      │
│      ┌───────────────┼───────────────┐                 │
│   ┌──┴──┐  ┌──┴──┐  ┌──┴──┐  ┌──┴──────┐  ┌──┴──┐   │
│   │head0│  │head1│  │head2│  │div_head │  │diff │   │
│   │→28  │  │→28  │  │→28  │  │→7×3    │  │→1   │   │
│   └─────┘  └─────┘  └─────┘  └────────┘  └─────┘   │
│   shape_0  shape_1  shape_2  diversity   difficulty   │
│                                regressor  regressor   │
└────────────────────────────────────────────────────────┘
```

### 9.2 24 维上下文向量

| 维度 | 字段 | 来源 | 范围 |
|------|------|------|------|
| 0 | `score / 500` | 当前分数归一化 | 0~1+ |
| 1 | `boardFill` | 盘面填充率 | 0~1 |
| 2 | `skill` | 实时技能 | 0~1 |
| 3 | `momentum` | 动量 | -1~1 |
| 4 | `frustration` | 挫败程度 | 0~1 |
| 5 | `cognitiveLoad` | 认知负荷 | 0~1 |
| 6 | `engagementAPM / 30` | 操作频率归一化 | 0~1 |
| 7 | `flowDeviation` | 心流偏差 | -1~1 |
| 8 | `needsRecovery` | 板满恢复标志 | 0/1 |
| 9 | `hadNearMiss` | 差一点效应 | 0/1 |
| 10 | `isNewPlayer` | 新手标志 | 0/1 |
| 11 | `comboStreak / 5` | 连击归一化 | 0~1 |
| 12 | `clearRate` | 消行率 | 0~1 |
| 13 | `missRate` | 失误率 | 0~1 |
| 14 | `comboRate` | 连击率 | 0~1 |
| 15 | `thinkMs / 10000` | 思考时间归一化 | 0~1 |
| 16 | `afkCount / 5` | AFK 次数归一化 | 0~1 |
| 17 | `historicalSkill` | 长周期技能基线 | 0~1 |
| 18 | `trend` | 长周期进退步趋势 | -1~1 |
| 19 | `confidence` | 数据置信度 | 0~1 |
| 20 | `stress` | 自适应压力值 | -0.5~1.5 |
| 21 | `flowState` | 心流三态编码 | -1/0/1 |
| 22 | `pacingPhase` | 节奏相位编码 | 0/0.5/1 |
| 23 | `sessionPhase` | 局间弧线编码 | 0/0.5/1 |

### 9.3 目标难度条件生成

推理时传入 `targetDifficulty ∈ [0, 1]`，由前端根据实时玩家状态计算：

```
targetDifficulty = clamp(0.3 + 0.5·skill - 0.2·frustration - 0.15·stress + 0.1·fill, 0, 1)
```

- 高技能 + 低挫败 → 偏高难度（挑战性出块）
- 高挫败 + 高压力 → 偏低难度（送温暖出块）
- 训练时从数据自动推导，推理时可手动调节

### 9.4 多任务训练损失

```
L = w_ce · L_ce + w_div · L_div + w_anti · L_anti + 0.1 · L_diff
```

| 损失 | 默认权重 | 作用 |
|------|---------|------|
| `L_ce` | 1.0 | 主目标：形状预测交叉熵（高分+高消行率局加权） |
| `L_div` | 0.3 | 多样性辅助头：预测三块的品类分布，鼓励品类多样 |
| `L_anti` | 0.5 | 反膨胀惩罚：高技能+低填充时，抑制大概率出易消块 |
| `L_diff` | 0.1 | 难度回归：让 difficulty token 学会条件控制 |

**反膨胀机制详解**：

当 `skill > 0.6` 且 `fill < 0.4` 时触发，对三个输出头的 softmax 概率中"易消块"（2×2, 1×4, 4×1）的总概率施加惩罚。触发强度随 skill-fill 差值线性增长。这防止模型学到"高手也无脑送简单块→分数无上限"的策略。

### 9.5 品类体系

| 品类 ID | 包含形状 |
|---------|---------|
| 0 (lines) | 1×4, 4×1, 1×5, 5×1 |
| 1 (rects) | 2×3, 3×2 |
| 2 (squares) | 2×2, 3×3 |
| 3 (T) | t-up, t-down, t-left, t-right |
| 4 (Z) | z-h, z-h2, z-v, z-v2 |
| 5 (L) | l-1~l-4, l5-a~l5-d |
| 6 (J) | j-1~j-4 |

### 9.6 采样权重

```
weight = 0.6 · (1 + max(0, score - 50) / 200) + 0.4 · (1 + clearRate · 0.5)
```

同时考虑分数和消行率，避免"高分但低消行"的膨胀局获得过高权重。

### 9.7 推理流程

1. 前端构建 24 维 context + board + history + targetDifficulty
2. POST → `/api/spawn-model/predict`
3. 后端 `SpawnTransformerV2.predict()` 执行 top-k 采样（去重）
4. 返回 3 个 shape ID → 前端渲染
5. 失败则自动回退到规则算法

### 9.8 训练面板参数说明

UI 面板「模型训练」提供三个可调参数，控制训练数据的筛选和训练过程：

| 参数 | 默认值 | 范围 | 含义 |
|------|:------:|:----:|------|
| **Epochs** | 50 | 5~500 | 训练轮数——模型遍历全部训练样本的完整次数。每轮包含对训练集的一次前向+反向传播。轮数越多模型拟合越充分，但过高容易过拟合（训练损失低但验证损失反弹）。推荐 30~100 |
| **最低分** | 0 | 0~500 | 数据筛选的分数门槛——仅选取最终得分 ≥ 此值的对局作为训练数据。提高此值可过滤掉低质量/短局对局，让模型只学习较优秀的出块模式；设为 0 则使用全部对局 |
| **最大局数** | 500 | 10~5000 | 从数据库中按分数降序最多取多少局。即从所有满足最低分的已完成对局中，取得分最高的前 N 局构建训练集。增大可覆盖更多样的玩法风格，但训练耗时也会增加 |

#### 数据流

```
数据库（sessions + move_sequences）
  ↓  WHERE score >= 最低分 ORDER BY score DESC LIMIT 最大局数
筛选后的对局
  ↓  extract_samples_from_session() 逐帧提取
训练样本（board + 24维context + history → 3个目标shape）
  ↓  90% train / 10% val
DataLoader → 训练 Epochs 轮
  ↓  每轮结束计算 val_loss，保存最佳模型
models/spawn_transformer.pt
```

#### 多任务损失

训练过程同时优化四个目标，通过加权求和：

```
L = w_ce × L_ce + w_div × L_div + w_anti × L_anti + 0.1 × L_diff
```

| 损失项 | 权重 | 含义 |
|--------|:----:|------|
| L_ce（主分类） | 1.0 | 预测下一轮 3 个出块形状的交叉熵，经采样权重加权 |
| L_div（多样性） | 0.3 | 品类预测辅助损失，鼓励模型学习出块的品类多样性 |
| L_anti（反膨胀） | 0.5 | 当玩家技能高(>0.6)且棋盘空(fill<0.4)时，惩罚模型偏好简单块（如 2×2、1×4），控制分数膨胀 |
| L_diff（难度预测） | 0.1 | 目标难度回归损失，让模型学习根据玩家状态调节出块难度 |

#### 调参建议

| 场景 | Epochs | 最低分 | 最大局数 |
|------|:------:|:------:|:--------:|
| 数据量少（<50局） | 30~50 | 0 | 全部 |
| 常规训练 | 50 | 0~10 | 500 |
| 精选高质量对局 | 80~100 | 50~100 | 200~300 |
| 大规模数据 | 30~50 | 0 | 2000~5000 |

### 9.9 文件清单（模型相关）

| 文件 | 职责 |
|------|------|
| `rl_pytorch/spawn_model/dataset.py` | 24 维特征提取 + 品类标注 + 采样权重 |
| `rl_pytorch/spawn_model/model.py` | SpawnTransformerV2 架构定义 |
| `rl_pytorch/spawn_model/train.py` | 多任务训练脚本 |
| `server.py` | predict/train/reload API |
| `web/src/spawnModel.js` | 前端推理客户端 + 24 维 context 构建 |

## 10. 文件清单（全局）

| 文件 | 职责 |
|------|------|
| `web/src/bot/blockSpawn.js` | Layer 1 核心 + 三层权重整合 |
| `web/src/adaptiveSpawn.js` | Layer 2/3 信号计算 + spawnHints 构建 |
| `web/src/game.js` | spawnContext 维护 + 调用链编排 |
| `web/src/strategyAdvisor.js` | 三层策略建议文案 |
| `web/src/playerInsightPanel.js` | 面板展示三层指标 |
| `web/src/spawnModel.js` | 模型推理客户端 |
| `rl_pytorch/spawn_model/` | Transformer 训练 + 推理 |
| `shared/game_rules.json` | 可配置参数 |
