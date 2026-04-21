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
| 计分倍率 | ❌ | 三档统一（singleLine=20, multiLine=60, combo=100） |
| 初始棋盘填充率 | ✅ | easy 0% → normal 20% → hard 25% |
| 出块形状权重 | ✅（修复后） | 通过 `difficultyBias` 偏移自适应 stress 基线 |
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

### 2.6 计分 `_handleClears()`

```javascript
const strategyConfig = getStrategy(this.strategy);
const scoring = strategyConfig.scoring;
// singleLine / multiLine / combo 直接取策略配置
```

---

## 3. 三档参数对比

### 3.1 计分规则（统一）

| 得分类型 | 全难度统一 |
|---------|----------:|
| 单消 singleLine | 20 |
| 多消 multiLine | 60 |
| Combo | 100 |

三档使用相同计分规则，分数可直接跨难度比较。难度仅影响出块分布和初始填充率。

### 3.2 初始填充率

| 难度 | fillRatio | 效果 |
|------|:---------:|------|
| 简单 | 0 | 开局空棋盘，零压力起步 |
| 普通 | 0.20 | 开局 ~13 个格子预填充，标准体验 |
| 困难 | 0.25 | 开局 ~16 个格子预填充，开局即需规划 |

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
│   └─ stress = scoreStress + difficultyBias + skillAdjust + flowAdjust + ...
└─ adaptiveSpawn.enabled = false
    └─ resolveLayeredStrategy(baseStrategyId, score, runStreak)
    └─ shapeWeights = blend(base → hard, totalStress)
```

### 4.2 难度偏移（difficultyBias）

当自适应系统开启时，三档难度通过 `difficultyBias` 偏移综合 stress 基线：

| 难度 | difficultyBias | 效果 |
|------|:--------------:|------|
| 简单 | -0.12 | stress 基线降低，出块偏向舒适/友好档位 |
| 普通 | 0.00 | 不偏移，纯粹由玩家能力驱动 |
| 困难 | +0.12 | stress 基线提高，出块偏向挑战/极限档位 |

±0.12 约等于从 10 档 profile 中偏移 1~2 档，既能让用户感知到明显的难度差异，又不会完全覆盖自适应系统的个性化调节能力。

### 4.3 10 档 Profile 与 stress 的对应关系

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

简单模式的 `-0.12` 偏移使中等水平玩家从「均衡标准」(0.4) 降至「节奏呼吸」(0.28) 附近；
困难模式的 `+0.12` 偏移使之升至「新鲜变化」(0.52) 附近，不规则块明显增多。

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

**修复**：在综合 stress 计算中增加 `difficultyBias` 项：
```javascript
const difficultyBias = baseStrategyId === 'easy' ? -0.12
    : baseStrategyId === 'hard' ? 0.12 : 0;

let stress = scoreStress + runMods.stressBonus + difficultyBias + skillAdjust + ...;
```

**文件**：`web/src/adaptiveSpawn.js`

### 5.3 策略解释面板未显示难度信息（已修复）

**问题**：策略解释面板中的 stress 说明未标明当前选择的难度模式。

**修复**：在 insight 中传递 `difficultyBias` 字段，策略解释面板展示如：
```
综合压力 stress=0.35（简单模式 难度偏移-0.12；含分数、连战、心流、节奏等信号）
```

**文件**：`web/src/playerInsightPanel.js`、`web/src/game.js`

---

## 6. 设计原理

### 6.1 计分分离原则

三档的 `scoring` 始终直接使用 JSON 配置，**不**受自适应系统影响。这保证了：
- 困难模式得分更高，给予成就感回报
- 排行榜可按难度分组，成绩可比

### 6.2 自适应优先 + 难度偏移

出块权重不直接套用三档的 `shapeWeights`，而是通过 `difficultyBias` 微调 stress，原因：
- **个性化体验优先**：同一难度下，新手和高手的出块需求不同
- **避免断裂感**：直接使用静态权重会与自适应的动态调节冲突
- **可控偏移**：±0.12 在 10 档 profile 中约偏移 1~2 档，既可感知又不失平衡

### 6.3 模拟器与真机差异

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
| `web/src/adaptiveSpawn.js` | 自适应引擎 + `difficultyBias` 偏移 |
| `web/src/difficulty.js` | 非自适应路径的层叠策略 |
| `web/src/bot/blockSpawn.js` | 出块生成（消费 strategyConfig） |
| `web/src/bot/simulator.js` | RL 训练模拟器（静态策略） |
| `web/src/playerInsightPanel.js` | 策略解释面板展示难度信息 |

---

## 8. 后续方向

1. **`colorCount` 前端化**：当前 JSON 定义了 `colorCount` 但前端硬编码为 8，可读取配置以支持不同颜色数
2. **难度专属 spawnHints**：三档可附加不同的 `clearGuarantee`、`sizePreference` 默认值
3. **模拟器自适应支持**：可选地让模拟器走自适应路径，使 RL 训练更贴近真机分布
4. **难度自适应推荐**：根据玩家历史表现自动推荐合适的难度档位
5. **分数归一化**：引入难度系数归一化分数，支持跨难度排行榜公平比较
