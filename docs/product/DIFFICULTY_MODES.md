# 难度模式：设计与实现

> 本文档描述 OpenBlock 的「简单 / 普通 / 困难」三档难度模式的全链路分析、参数差异、已修复问题及设计原理。

## 目录

- [1. 概述](#1-概述)
- [2. 全链路追踪](#2-全链路追踪)
- [3. 三档参数对比](#3-三档参数对比)
- [4. 自适应系统与难度的交互](#4-自适应系统与难度的交互)
- [5. 发现的问题与修复](#5-发现的问题与修复)
- [6. 设计原理](#6-设计原理)
- [7. 涉及文件](#7-涉及文件)
- [8. 后续方向](#8-后续方向)

---

## 1. 概述

OpenBlock 提供三档基础难度：**简单（easy）**、**普通（normal）**、**困难（hard）**。用户在主菜单通过按钮切换，影响：

| 维度 | 是否受难度影响 | 备注 |
|------|:------------:|------|
| 消行计分 | ❌ | 三档统一：以 `scoring.singleLine` 为 **baseUnit**，默认 20，按 [消行计分规则](./CLEAR_SCORING.md) 计算；`multiLine` / `combo` 仍保留在 JSON 中兼容旧存档，但 **消行得分与 RL/回放重算均不再使用这两项** |
| 初始棋盘填充率 | ✅ | easy 0% → normal 18% → hard 32% |
| 出块形状权重 | ✅ | 通过 `difficultyTuning.stressBias` 偏移自适应 stress 基线 |
| 出块保底 / 块大小 / 多消倾向 | ✅ | `difficultyTuning` 直接调节 `spawnHints.clearGuarantee / sizePreference / multiClearBonus` |
| 解空间难度 | ✅ | `solutionStressDelta` 让困难更早进入低解法数量过滤，简单更偏向宽松区间 |
| 拓扑空洞压力 | ✅ | `topologyDifficulty` 读取“所有形状都无法覆盖的空格”数量；空洞越多，盘面难度越高，同时触发保活/救援护栏 |
| 棋盘尺寸 | ❌ | 三档均为 8×8 |
| 颜色数量 | ❌ | JSON 定义了 `colorCount` 但前端未读取 |

---

## 2. 全链路追踪

### 2.1 UI 选择

```
web/index.html → <button class="strategy-btn" data-level="easy|normal|hard">
```

三个按钮位于主菜单，默认「普通」带 `active` 类。

### 2.2 事件绑定（game.js `bindEvents`）

```javascript
document.querySelectorAll('.strategy-btn').forEach(btn => {
    btn.onclick = () => {
        this.strategy = btn.dataset.level;
        localStorage.setItem('openblock_strategy', this.strategy);  // 持久化
    };
});
```

### 2.3 初始化读取

```javascript
// Game 构造函数
this.strategy = localStorage.getItem('openblock_strategy') || 'normal';
```

### 2.4 开局 `start()`

```
baseStrategy = getStrategy(this.strategy)           → 计分规则
layeredOpen = resolveAdaptiveStrategy(this.strategy) → 出块权重 + 填充率
grid.initBoard(layeredOpen.fillRatio, layeredOpen.shapeWeights)
```

### 2.5 每次补块 `spawnBlocks()`

```
layered = resolveAdaptiveStrategy(this.strategy, profile, score, ...)
generateDockShapes(grid, layered, spawnContext)
```

### 2.6 计分（消行）

对局消行得分由 `web/src/game.js` → `computeClearScore()` 计算，详见 **[消行计分规则](./CLEAR_SCORING.md)**。

要点：

- **基础分**：`baseScore = baseUnit × c²`（`c` 为本次消除的行列总数）。
- **同 icon / 同色 bonus**：在 `bonusLines` 中统计条数 `b`，增量 `iconBonusScore = (baseUnit × c) × b × (5 - 1)`；全 bonus 时总分为 `5 × baseScore`。
- **理论最大消除数**：由 `shared/shapes.json` 决定，当前 **`c_max = 6`**（单元测试枚举校验）。

---

## 3. 三档参数对比

### 3.1 计分（统一）

详见 [CLEAR_SCORING.md](./CLEAR_SCORING.md)。三档仅 **`baseUnit`（即 `singleLine`）** 一致；难度不影响消行公式本身。分数可直接跨难度比较。难度主要影响出块分布和初始填充率。

### 3.2 初始填充率

| 难度 | fillRatio | 效果 |
|------|:---------:|------|
| 简单 | 0 | 开局空棋盘，零压力起步 |
| 普通 | 0.18 | 开局 ~12 个格子预填充，标准体验 |
| 困难 | 0.32 | 开局 ~20 个格子预填充，开局即需规划 |

初始填充率只决定**开局基线**，不是运行中盘面难度的唯一来源。运行中还会叠加拓扑质量，尤其是空洞数。

### 3.2.1 运行中盘面难度：填充率 + 空洞数

运行中评估盘面难度时不只看裸 `fillRatio`，还会把 holes 折算为等效填充压力：

```text
holePressure    = clamp(holes / holePressureMax)
boardDifficulty = clamp(fill + holePressure × holeFillEquivalent)
```

默认参数：

| 参数 | 默认值 | 含义 |
|------|-------:|------|
| `holePressureMax` | 8 | 空洞归一化上限，8 个及以上视为满空洞压力 |
| `holeFillEquivalent` | 0.8 | 空洞压力折算为等效填充率的强度 |

因此两个同样填充率的盘面，空洞越多会被认为越难。例如 `fill=0.35` 且 `holes=4` 时，`holePressure=0.5`，`boardDifficulty≈0.75`；这比单看 35% 填充率更符合玩家体感，因为不可覆盖空格会显著压缩后续可操作空间。

注意：`boardDifficulty` 是**难度评估口径**，不是“继续加压”的唯一依据。系统同时保留 `boardRisk` 作为**保活口径**：当高填充、高空洞或能力风险让盘面接近危险区时，仍会提高消行保障、偏向小块，避免把“难盘”推成“不公平盘”。

### 3.3 形状权重（JSON 定义值）

| 形状类别 | 简单 | 普通 | 困难 | 趋势说明 |
|---------|-----:|-----:|-----:|---------|
| lines 线条 | 2.30 | 2.15 | 2.05 | 简单偏多，利于消行 |
| rects 矩形 | 1.65 | 1.55 | 1.55 | 简单偏多 |
| squares 方块 | 1.45 | 1.35 | 1.42 | 困难偏多，占空间 |
| tshapes T形 | 1.05 | 1.12 | 1.18 | 困难偏多，增加规划难度 |
| zshapes Z形 | 1.05 | 1.12 | 1.18 | 同上 |
| lshapes L形 | 1.13 | 1.20 | 1.26 | 同上 |
| jshapes J形 | 1.05 | 1.12 | 1.18 | 同上 |

**设计思路**：简单模式偏向线条/矩形等「消行友好」形状，困难模式增加 T/Z/L/J 等「空间规划型」不规则形状的出现概率。

---

## 4. 自适应系统与难度的交互

### 4.1 两套出块路径

```
resolveAdaptiveStrategy(baseStrategyId, ...)
├─ adaptiveSpawn.enabled = true（默认）
│   └─ shapeWeights = interpolateProfileWeights(10档profiles, stress)
│   └─ fillRatio = base.fillRatio + 连战修正
│   └─ stress = scoreStress + difficultyTuning.stressBias + skillAdjust + flowAdjust + ...
│   └─ topologyDifficulty.holePressure → boardDifficulty + boardRisk 双通路
│      ├─ boardDifficulty → spatialPressure / 模型 targetDifficulty（空洞越多越难）
│      └─ boardRisk       → 减压、偏小块、提高消行保障（危险盘面保活）
│   └─ spawnHints += difficultyTuning.clearGuaranteeDelta / sizePreferenceDelta / multiClearBonusDelta
│   └─ targetSolutionRange = deriveTargetSolutionRange(stress + solutionStressDelta)
└─ adaptiveSpawn.enabled = false
    └─ resolveLayeredStrategy(baseStrategyId, score, runStreak)
    └─ shapeWeights = blend(base → hard, totalStress)
```

### 4.2 难度偏置（difficultyTuning）

当自适应系统开启时，三档难度通过 `difficultyTuning` 同时影响压力档位、出块提示和解空间过滤：

| 难度 | stressBias | clearGuaranteeDelta | sizePreferenceDelta | multiClearBonusDelta | solutionStressDelta | 效果 |
|------|-----------:|--------------------:|--------------------:|---------------------:|--------------------:|------|
| 简单 | -0.22 | +1 | -0.22 | +0.05 | -0.14 | 更多消行保底，更偏小块，解法空间更宽 |
| 普通 | 0.00 | 0 | 0.00 | 0.00 | 0.00 | 标准自适应体验 |
| 困难 | +0.22 | -1 | +0.24 | -0.08 | +0.18 | 更少常态消行保底，更偏大块/复杂局面，更早进入窄解空间 |

`hard.minStress=0.18` 用于避免困难模式在普通状态下被其他轻量减压项完全拉回舒适档；但新手保护、救场、挫败恢复和跨局热身不会被困难模式削弱。

### 4.3 拓扑难度（topologyDifficulty）

空洞数采用统一口径：**只有所有形状库中的块都无法合法覆盖的空格，才算空洞**。这与传统“某列上方有块、下方为空”的列高口径不同，更符合 OpenBlock 的任意位置放置规则。

同一套 coverability 也用于临消/多消机会判定：行列不能只看“还差几个空格”，还必须确认这些缺口能被合法形状覆盖。否则一个被不可填空洞卡住的“近满行”不会再提高 `nearFullLines`、`close1/close2` 或多消兑现权重。

该指标有两条消费通路：

| 通路 | 消费字段 | 策略含义 |
|------|----------|----------|
| 难度评估 | `boardDifficulty = fill + holePressure × holeFillEquivalent` | 同填充率下，空洞越多代表可修复性越差，运行中难度越高 |
| 保活护栏 | `boardRisk = 0.45·fillRisk + 0.35·holePressure + 0.20·abilityRisk` | 盘面进入危险区时降低过度压力，提高消行保障 |

这解决了过去“holes 只减压”的单向解释问题：空洞本身确实让盘面更难，但玩家已经处在难盘时，系统不应继续投放不公平的高压块。因此实现上区分**难度事实**与**出块响应**。

关键参数：

- `holePressureMax=8`：空洞数归一化上限。
- `holeFillEquivalent=0.8`：空洞压力折算为等效填充率，用于 `boardDifficulty`。
- `holeReliefStress=-0.16`：空洞压力越高，下一轮自适应 stress 越低。
- `holeClearGuaranteeAt=2`：空洞达到阈值后，下一轮至少保障 2 个消行/解压候选。
- `holeSizePreference=-0.22`：偏向更小块，提升填补局部不可达区域的概率。

### 4.4 模型出块目标难度（targetDifficulty）

当使用 `model-v3` 出块路径时，前端会构造 `targetDifficulty` 传给 V3.1 行为上下文模型。该目标也采用“填充率 + 空洞数”的运行中难度口径，并与 `behaviorContext[26] = boardDifficulty` 保持一致：

```text
targetDifficulty =
  clamp(
    0.3
    + 0.5 × skill
    - 0.2 × frustration
    + 0.15 × stress
    + 0.08 × boardDifficulty
    - 0.1 × boardRisk
    + 0.06 × nearClear
  )
```

其中 `boardDifficulty` 让 holes 正向增加目标难度，`boardRisk` 仍负责抵消危险盘面的过度挑战。这样规则出块与模型出块对“空洞越多越难”的理解一致，不会出现规则轨保活、模型轨却按低难度或相反方向学习的错位。V3.1 旧权重不兼容，模型不可用或输出非法时仍回退规则出块。

### 4.5 10 档 Profile 与 stress 的对应关系

```
stress -0.2  → 新手引导（onboarding）：线条权重 3.18
stress -0.1  → 紧急救场（recovery）
stress  0.0  → 舒适体验（comfort）
stress  0.1  → 连击催化（momentum）
stress  0.2  → 引导成长（guided）
stress  0.3  → 节奏呼吸（breathing）
stress  0.4  → 均衡标准（balanced）← normal 的 shapeWeights 与此一致
stress  0.5  → 新鲜变化（variety）
stress  0.65 → 进阶挑战（challenge）
stress  0.85 → 极限考验（intense）
```

简单模式的 `-0.22` 偏移使中等水平玩家从「均衡标准」(0.4) 降至「引导成长/节奏呼吸」之间；
困难模式的 `+0.22` 偏移使之升至「进阶挑战」附近，不规则块和空间规划压力明显增多。

---

## 5. 发现的问题与修复

### 5.1 难度不持久化（已修复）

**问题**：`this.strategy` 仅存于内存，刷新页面后回退到默认 `normal`，HTML 按钮也恢复默认选中状态。

**修复**：
- 切换时写入 `localStorage.setItem('openblock_strategy', level)`
- 构造时读取 `localStorage.getItem('openblock_strategy') || 'normal'`
- `bindEvents` 中恢复按钮 `active` 状态与内存一致

**文件**：`web/src/game.js`

### 5.2 自适应模式下 shapeWeights 不区分难度（已修复）

**问题**：当 `adaptiveSpawn.enabled = true`（默认）时，`shapeWeights` 完全由 10 档 profile 插值决定，所选难度对块型分布 **无影响** —— 用户选「简单」或「困难」，在自适应系统中出块感受一样。

**原因**：`resolveAdaptiveStrategy` 的 `stress` 计算公式中没有包含用户所选难度的贡献项。

**修复**：在综合 stress 计算中增加 `difficultyTuning.stressBias` 项：
```javascript
const difficultyTuning = cfg.difficultyTuning?.[baseStrategyId] || {};
const difficultyBias = difficultyTuning.stressBias ?? 0;

let stress = scoreStress + runMods.stressBonus + difficultyBias + skillAdjust + ...;
```

**文件**：`web/src/adaptiveSpawn.js`

### 5.3 难度体感差异被自适应保底稀释（已修复）

**问题**：虽然 stress 已有难度偏移，但 `generateDockShapes()` 后续会优先考虑消行、保活、多消、合法落点和节奏 payoff。类别权重只是基础值，实际体感容易被这些更强的兜底倍率盖过。

**修复**：
- `shared/game_rules.json` 新增 `adaptiveSpawn.difficultyTuning`，让三档难度直接调节 `clearGuarantee / sizePreference / multiClearBonus`。
- 困难模式只在普通状态下降低 `clearGuarantee`；新手保护、救场、挫败恢复、跨局热身仍保持公平性。
- 普通/困难初始填充率从 `0.20/0.25` 拉开到 `0.18/0.32`，减少开局体感重叠。

**文件**：`shared/game_rules.json`、`web/src/adaptiveSpawn.js`

### 5.4 解法数量难度过滤读取路径错误（已修复）

**问题**：配置位于 `adaptiveSpawn.solutionDifficulty`，但 `blockSpawn.js` 读取的是旧顶层 `GAME_RULES.solutionDifficulty`，导致解空间过滤没有参与真实出块。

**修复**：`blockSpawn.js` 改为优先读取 `GAME_RULES.adaptiveSpawn.solutionDifficulty`，并保留旧顶层路径兜底。

**文件**：`web/src/bot/blockSpawn.js`

### 5.5 空洞口径与难度/RL 目标不一致（已修复）

**问题**：前端出块、策略面板、RL 特征、模拟器和小程序镜像曾混用不同空洞口径，部分位置仍使用列高口径，导致面板、难度反馈和 RL 监督目标不一致。

**修复**：
- Web 新增 `boardTopology.js` 统一 `countUnfillableCells()`。
- PyTorch `fast_board_features()`、`board_potential()`、`holes_after` 和 `hole_aux_loss` 统一使用不可覆盖空格。
- 动作特征 `holesRisk` 改为“模拟放置并消行后的不可覆盖空洞数”，不再用放置块下方空格估算。
- 小程序 bot/模拟器同步同口径。

**文件**：`web/src/boardTopology.js`、`rl_pytorch/fast_grid.py`、`rl_pytorch/features.py`、`miniprogram/core/boardTopology.js`

### 5.6 策略解释面板未显示难度信息（已修复）

**问题**：策略解释面板中的 stress 说明未标明当前选择的难度模式。

**修复**：在 insight 中传递 `difficultyBias` 字段，策略解释面板展示如：
```
综合压力 stress=0.25（简单模式 难度偏移-0.22；含分数、连战、心流、节奏等信号）
```

**文件**：`web/src/playerInsightPanel.js`、`web/src/game.js`

### 5.7 空洞只被当作减压信号（已修复）

**问题**：空洞原本主要通过 `holeReliefAdjust`、`boardRiskReliefAdjust` 进入救济链路，能正确触发保消、偏小块和降压，但没有在运行中难度评估里表达“同样填充率下，空洞越多越难”。这会让 `spatialPressure` 和模型 `targetDifficulty` 仍偏向裸 `fillRatio`，低估结构性坏盘。

**修复**：
- 新增 `boardDifficulty = clamp(fill + holePressure × holeFillEquivalent)`，默认 `holeFillEquivalent=0.8`。
- `adaptiveSpawn.deriveSpawnTargets()` 的 `spatialPressure` 改为消费 `boardDifficulty`。
- `spawnModel.computeSpawnTargetDifficulty()` 改为使用 `boardDifficulty`，holes 正向增加目标难度；`boardRisk` 继续作为保活抵消项。
- 增加测试，验证同填充率下 holes 更多时 `boardDifficulty` / `targetDifficulty` 更高。

**文件**：`shared/game_rules.json`、`web/src/adaptiveSpawn.js`、`web/src/spawnModel.js`、`tests/adaptiveSpawn.test.js`、`tests/spawnModel.test.js`

---

## 6. 设计原理

### 6.1 计分分离原则

三档的 `scoring` 始终直接使用 JSON 配置，**不**受自适应系统影响。这保证了：
- 三档分数公式一致，成绩可直接比较
- 排行榜可按难度分组，成绩可比

### 6.2 自适应优先 + 显式难度旋钮

出块权重不直接套用三档的 `shapeWeights`，而是通过 `difficultyTuning` 微调 stress 和 spawnHints，原因：
- **个性化体验优先**：同一难度下，新手和高手的出块需求不同
- **避免断裂感**：直接使用静态权重会与自适应的动态调节冲突
- **可控偏移**：stress、块大小、消行保底、解空间各自有独立旋钮，既能拉开体感又不牺牲可解性

### 6.3 难度事实与保活响应分离

空洞数体现的是盘面的结构性难度：不可覆盖空格越多，未来可操作空间越少，玩家需要更多规划。但策略响应不能简单理解为“难就继续加难”。OpenBlock 将其拆成两类信号：

- **难度事实**：`boardDifficulty` 用于判断盘面本身有多难，影响 `spatialPressure` 和模型 `targetDifficulty`。
- **保活响应**：`boardRisk`、`holeReliefAdjust`、`clearGuarantee`、`sizePreference` 用于在危险盘面降低不公平压力。

这种拆分让 UI、规则出块和模型出块可以同时满足两个条件：承认“空洞越多越难”，并在玩家已经陷入坏盘时给出修复机会。

### 6.4 模拟器与真机差异

RL 训练模拟器（`web/src/bot/simulator.js`）使用静态策略配置（`getStrategy(strategyId)`），**不走** `resolveAdaptiveStrategy`。这是设计使然：
- 模拟器需要稳定的出块分布来保证训练收敛
- 自适应的多维信号（心流、节奏等）在模拟环境中不存在

---

## 7. 涉及文件

| 文件 | 角色 |
|------|------|
| `shared/game_rules.json` | 三档策略定义（scoring / fillRatio / shapeWeights） |
| `web/index.html` | UI 按钮（data-level） |
| `web/src/game.js` | 状态存储、事件绑定、开局/出块/计分调用链 |
| `web/src/config.js` | `getStrategy(id)` 配置读取 |
| `web/src/adaptiveSpawn.js` | 自适应引擎 + `difficultyTuning` 偏移 |
| `web/src/spawnModel.js` | 模型出块上下文与 `targetDifficulty`，消费 `boardDifficulty` |
| `web/src/difficulty.js` | 非自适应路径的层叠策略 |
| `web/src/bot/blockSpawn.js` | 出块生成（消费 strategyConfig 与 `targetSolutionRange`） |
| `web/src/bot/simulator.js` | RL 训练模拟器（静态策略） |
| `web/src/playerInsightPanel.js` | 策略解释面板展示难度信息 |

---

## 8. 后续方向

1. **`colorCount` 前端化**：当前 JSON 定义了 `colorCount` 但前端硬编码为 8，可读取配置以支持不同颜色数
2. **出块分布统计回归**：固定随机种子批量比较三档的不规则块占比、平均块面积、即时消行块数量、解法叶子数
3. **模拟器自适应支持**：可选地让模拟器走自适应路径，使 RL 训练更贴近真机分布
4. **难度自适应推荐**：根据玩家历史表现自动推荐合适的难度档位
5. **分数归一化**：引入难度系数归一化分数，支持跨难度排行榜公平比较
