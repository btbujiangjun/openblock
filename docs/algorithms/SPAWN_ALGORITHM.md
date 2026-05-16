# 出块算法：三层架构

> 版本: v3.4 | 更新: 2026-05-02  
> 建模思路、优化目标、特征与网络结构的形式化说明见 `docs/SPAWN_BLOCK_MODELING.md`。

## 1. 概述

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

## 2. 数据流

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

### 2.2 v3.2 补充：`multiLineTarget`、收紧的 `rhythmPhase`、局间 `warmup`

- **`deriveMultiLineTarget`**：见 §4.3；输出写入 `spawnHints.multiLineTarget`，由 `blockSpawn` 阶段 1/2 消费。
- **`deriveRhythmPhase`**：`payoff` 需几何门控（§4.4），避免「盘面疏松仍处于收获期」的错位。
- **局间热身**：`game.js` 在无步可走结算时写入 `openblock_spawn_warmup_v1`，下局 `start()` 注入 `warmupRemaining` / `warmupClearBoost`（§5.3）；与局内前 3 轮的 `sessionArc === 'warmup'` 不同源。

### 2.3 v3.4 补充：清屏 / 多消可达性（缺口识别与 scoring）

**动机**：实战反馈「几乎不可能清屏」。根因之一是 `Grid.findGapPositions()` 只把 **每行/列 1～3 个空格** 当作「可补缺口」，差 **4 格** 即满的行被完全忽略 → 大量形状 `countGapFills === 0`，进而 **`multiClear` / `pcPotential` 在代码里长期不算**（旧逻辑要求先 `gapFills > 0`）。

**v3.4 改动摘要**（`web/src/grid.js` + `web/src/bot/blockSpawn.js`，小程序 / `rl_pytorch` / `rl_mlx` 的 `Grid` 同步）：

| 项 | 行为 |
|----|------|
| 缺口行/列 | 空格数 **1～4** 均纳入 `findGapPositions`（8×8 上「差一整块即满」的行可见） |
| `countGapFills` | 贡献改为 `max(1, 4 - empty)`，避免 4 空格行在可落子时仍得 0 分 |
| `multiClear` | **对每个可放置形状始终**调用 `bestMultiClearPotential`，不再依赖 `gapFills` |
| `pcPotential` | 在 `pcSetup > 0` **或** 疏板（`occupied ≤ 22` 或 `fill ≤ 0.46`）时评估 `bestPerfectClearPotential`，满板跳过以控性能 |
| 阶段 1 候选 | `clearCandidates` 含 `gapFills > 0` **或** `multiClear ≥ 1` **或** `pcPotential === 2` |
| `analyzePerfectClearSetup` | 阈值略放宽（更易得到 `pcSetup ∈ {1,2}`） |
| `deriveDelightTuning` | 在「双线临门 / 疏板」下抬高 `perfectClearBoost` 下限 |
| `deriveMultiClearBonus` 基底 | Idle 分支由 **0.15 → 0.22**（`game_rules.adaptiveSpawn.delight.baseMultiClearBoost` 同步） |

公平性约束（`tripletSequentiallySolvable`、机动性、解法数量过滤等）不变。

### 2.4 v3.3 补充：能力/心流驱动的爽感兑现

新增 `deriveDelightTuning()`，在 `adaptiveSpawn.js` 中把 `skillLevel`、`flowState`、`momentum`、`needsRecovery`、`nearFullLines`、`pcSetup` 组合成三类提示：

- `delightBoost`：0～1，多消爽感强度。高手、正动量、心流/释放期、盘面已有临消机会时提高；焦虑/恢复态也会保留一定提升，用作救援式消行。
- `perfectClearBoost`：0～1，清屏兑现强度。上轮诊断发现 `pcSetup` 或大量临消行时，提高可直接清屏块的排序和抽样权重。
- `delightMode`：`challenge_payoff` / `flow_payoff` / `relief` / `neutral`。高手无聊进入 `challenge_payoff`，略加压并推动 payoff；焦虑或恢复进入 `relief`，降压、偏小块、提高消行保证。

该层只改变软权重与 `spawnHints`，不绕过 `minMobilityTarget`、`tripletSequentiallySolvable`、解法数量过滤等公平性约束。

## 2.5 策略 → 出块翻译机制（v1.55.16）

> **本节回答的问题**：`adaptiveSpawn` 算出来的那一堆 `stress` / `spawnHints` / `spawnTargets`，**到底是怎么变成具体的 3 个块**的？源码事实链路是什么、每条策略落在哪个加权乘子或硬约束上、最终 3 个 Shape 的选择过程是否可解释、可调控、可兜底。

### 2.5.1 出块的 5 阶段流水线

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
    │   把 30+ 条 hints / spawnTargets / ctx 翻译为乘子（详见 §2.5.2 表 B），
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

**关键工程取舍**：策略层产出 **17 个 stress 分量 + 30+ 个 spawnHints**，但它们**绝不直接选块**——全部经"占位 + 乘子 + 软硬过滤"三段式作用于抽样过程。

### 2.5.2 策略 → 出块翻译表

按"出块层消费方式"分 3 类。每条都可在 `web/src/bot/blockSpawn.js` 精确行号回溯。

#### A. 决定"哪些块直接进消行槽位"（阶段 2 占位）

| 策略输入 | 转译规则（精确行号） | 出块层效果 |
|---|---|---|
| `clearGuarantee` (0..3) | `effectiveClearTarget = clearTarget + (comboChain>0.5?1:0) + (clearOpp≥0.72?1:0)` (`:714-717`) | 至少几个槽留给"能消行"的块 |
| `perfectClearBoost ≥ 0.9` 或 `pcSetup ≥ 2` | `clearSeats = min(3, candidates)` (`:722-723`) | **3 槽全部强制是消行块**（清屏窗口期不留杂块） |
| `delightBoost > 0.65` 或 `nearFullLines ≥ 4` | `maxClearSeats = 3` (`:720`) | 允许 3 槽全消行 |
| `multiClearBonus > 0.3` / `delightBoost > 0.25` / `multiLineTarget ≥ 2` | 优先从 `multiClear≥2` 池中抽 (`:739-741`) | 消行槽里偏好**多消块**而非"只能消 1 行" |
| 任意候选 `pcPotential === 2` | 直接占第一个槽 (`:736-738`) | **见到一手清屏就抢占** |

#### B. 决定"剩下槽位选什么"（阶段 3 加权乘子）

`augmentPool` 内 30+ 条乘子叠乘。`w` 初值 = `shapeWeights[category]`（来自 `interpolateProfileWeights(stress)`），然后按下表逐条相乘。

| 策略 / 信号 | 公式 | 行号 | 物理含义 |
|---|---|---|---|
| **stress → shapeWeights** | `w₀ = weights[category]` | `:758` | stress 通过 `interpolateProfileWeights` 在 category 权重间插值 |
| **fill 自适应机动性** | `w *= 1 + log1p(placements) * (0.35 + fill*0.55)` | `:764` | 高填充时**强烈偏好合法落点多的块**（自救） |
| **空洞修复** | `fill>0.5 && holes>2` → `w *= 1 + holeReduce*0.4` | `:770-772` | 高填充 + 多孔时偏好"减少空洞"的块 |
| **清屏一手** | `pcPotential===2` → `w *= 18.0 + perfectClearBoost*14.0` | `:775-777` | **18~32×** 压顶级倍率，覆盖一切 |
| **清屏准备** | `pcSetup≥1 && gapFills>0` → `w *= 1 + pcSetup*3.0 + perfectClearBoost*2.0` | `:778-781` | pcSetup=2 时 ×7+，pcSetup=1 时 ×4+ |
| **多消** | `mc≥1` → `w *= 1 + mc*(0.6 + multiClearBonus*0.6 + delightBoost*0.45 + payoffTarget*0.35)` | `:783-788` | mc 数 + 多 hint 叠加加权 |
| **multiLineTarget=2** | `mc≥2` → `w *= 1.45 + multiClearBonus*0.28` | `:790-791` | 显式"同时多线"目标 |
| **postCombo + payoff** | `lastClearCount≥2 && rhythmPhase='payoff' && gapFills>0 && cells∈[2,6]` → `w *= 1.28` | `:796-799` | 刚多消完，给小巧消行块续手感 |
| **临消行机会** | `nearFullFactor>0 && gapFills>0` → `w *= 1 + nearFullFactor*(2.0 + clearOpp)` | `:802-804` | 临消行越多越偏好消行块 |
| **清屏窗口期多消** | `nearFullLines≥5 && mc≥2` → `w *= 1.6` | `:806-808` | 额外加持 |
| **comboChain** | `comboChain>0.1 && gapFills>0` → `w *= 1 + comboChain*0.8` | `:811-813` | combo 活跃时催化续链 |
| **shapeComplexityTarget** | `≥0.55` 偏异形；`<0.55` 偏规整（双向插值） | `:815-820` | 难度调控直接落到形状复杂度 |
| **rhythmPhase='payoff'** | `gapFills>0 → ×1.7`；`mc≥2 → ×1.4`；`delightBoost>0.35 → ×(1+delight*0.55)` | `:823-826` | 收获相位"组合拳" |
| **rhythmPhase='setup'** | `cells∈[4,6] && gapFills===0` → `w *= 1.2 + spatialPressure*0.25` | `:827-829` | 搭建相位偏好"中等不消行"块 |
| **delightMode='relief'** | `gapFills>0 && cells≤5` → `w *= 1.18 + delightBoost*0.35` | `:830-832` | 救援模式偏小且能消行的块 |
| **sizePreference** | `<0` 偏小，`>0` 偏大；中性时若 `bulky≥10` 强偏小 | `:834-844` | 块体积调控（小=救场，大=加压） |
| **spatialPressureTarget** | `>0.55 && fill<0.62` 偏大；否则偏小 | `:845-851` | 与 sizePref 独立但同向调制 |
| **diversityBoost + noveltyTarget** | 同轮已选 category → `w *= max(0.2, 1-divBoost*catPenalty)`；跨轮记忆 >2 进一步压低 | `:854-862` | 防"连刷同类块" |
| **clearGuarantee 补足** | `clearCount<clearTarget && gapFills>0` → `w *= 1.6 + clearOpp*0.55`；`mc≥2` 再 `×1.3` | `:864-868` | 阶段 2 没占满消行槽时，阶段 3 用乘子补救 |
| **`scoreMilestone`（v1.55.16 修复）** | `ctx.scoreMilestone && gapFills>0` → `w *= 1.3` | `:870-872` | 接近 PB 50/75/90% 时偏好能消行块（修复前为 dead branch，详见 §2.5.4） |

**抽样动作**：`pickWeighted(pool)` 按 `w` 做**轮盘抽样**（不是 argmax）。所以所有乘子是**概率权重，不是硬选择**——这保证策略在统计意义上生效，但单次仍有随机性。

#### C. 决定"3 块能不能一起出"（阶段 4 硬约束）

| 策略 | 校验公式 | 行号 | 失败行为 |
|---|---|---|---|
| **最低机动性** | `min(placements₁₋₃) ≥ mobTarget(fill, attempt)` | `:903-908` | continue 重抽 |
| **序贯可解性** | `fill≥0.52` 时调 `tripletSequentiallySolvable`（DFS 搜索 3! 种顺序，任一种 3 块能依次放下即通过） | `:910-919` | continue（不让玩家拿到必死组合） |
| **`targetSolutionRange`** | `solutionCount ∈ [min, max]`，由 `solutionDifficulty` v9 按 stress 调档 | `:934-944` | tooFew / tooMany 拒绝 |
| **`solutionSpacePressure` 双边** | ≥0.78 → 解法数 ≤48；≤0.22 → firstMoveFreedom≥5 | `:945-955` | 控制解法**绝对数量** |
| **`orderRigor` 顺序刚性** | `validPerms ≤ orderMaxValidPerms`（6 种排列里允许的最大可解数） | `:976-984` | 拒绝"放哪个顺序都行"的组合，**强制玩家规划顺序** |

**重抽守卫**：单次 attempt 任一硬约束失败就 continue 重抽，最多 `MAX_SPAWN_ATTEMPTS` 次；早期 attempt 严格、后期渐进放松（避免死循环）。`truncated=true`（DFS 预算耗尽）时按通过处理（与 v9 同口径）。

### 2.5.3 具体场景跑步示例

**场景**：S2·M3 老玩家，本局得分 750 / PB=1000（75% 里程碑刚命中），盘面 fill=0.55、2 个孔、3 行临消行（`nearFullLines=3`）、上一波刚多消 2 行（postCombo + `rhythmPhase='payoff'`）、心流偏 anxious。

**adaptiveSpawn 输出（简化）**：

```js
stress = 0.62        // raw 域；对外 norm 域 ≈ 0.683；lifecycle cap (S2·M3 = 0.75) 内
spawnHints = {
  clearGuarantee: 2,            // anxious + 临消行抬高
  sizePreference: -0.15,        // 75% 里程碑命中 → 偏小块
  multiClearBonus: 0.55,
  multiLineTarget: 1,
  delightBoost: 0.35,
  perfectClearBoost: 0.2,
  rhythmPhase: 'payoff',        // 刚消行 + lastClearCount=2
  scoreMilestone: true,         // 跨过 75% 档（v1.55.16 修复后真生效）
  comboChain: 0.45,
  orderMaxValidPerms: 4,        // 中等 rigor
  targetSolutionRange: { min: 8, max: 28 }
}
```

**阶段 2 占位结果**：
- `effectiveClearTarget = 2 + 0 + 0 = 2`（`comboChain=0.45<0.5`、`clearOpp=0.68<0.72` 均不触发 +1）
- `maxClearSeats = 2`（`pcSetup=0`、`nearFullLines=3<4`、`delightBoost=0.35<0.65`）
- → **2 个槽强制留给消行块**，其中若有 `multiClear≥2` 候选会优先抢（`multiClearBonus=0.55>0.3` 命中 `:739-741` 分支）

**阶段 3 加权计算**（以 1×3 直条 `cells=3, gapFills=1, multiClear=1` 候选为例）：

```
w₀ = weights['linear']                                   = 1.0    (假设)
× 1 + log1p(8)·(0.35+0.55·0.55)                          = 2.30   机动性
× 1 + 1·(0.6+0.55·0.6+0.35·0.45+0.35·0.35)              = 2.21   多消
× 1 + 0.6·(2.0+0.68)         (nearFullFactor=3/5=0.6)    = 2.61   临消行
× 1 + 0.45·0.8                                           = 1.36   comboChain
× 1 + (0.5-0.4)·(0.55-0.45)·1.1                          ≈ 1.01   shapeComplexity 中性
× 1.7                                                    = 1.7    payoff + gapFills>0
× 1.18 + 0.35·0.35           (delightMode=relief 命中)    = 1.30
× 1 + 0.15·1.5               (sizePref=-0.15, cells=3≤4) = 1.23
× 1.3                        (v1.55.16 scoreMilestone)   = 1.3
────────────────────────────────────────────────────────────────
w_final ≈ 1.0 × 2.30 × 2.21 × 2.61 × 1.36 × 1.01 × 1.7 × 1.30 × 1.23 × 1.3 ≈ 71.4
```

同场景下的"中性大块" (`cells=8, gapFills=0, multiClear=0`)，`w_final` 大约只有 **~1.4** 量级。

→ pickWeighted 抽到"小巧能消行块"的概率是抽到"大块"的 **~50 倍**。

**阶段 4 校验**：抽出 3 块后算 `validPerms`——
- `validPerms=5` 时，`5 > orderMaxValidPerms=4` → **重抽**（强制玩家"必须按某种顺序放"）；
- `validPerms=3` 时通过 → 打乱 → 返回；
- `solutionCount=42` 时在 `[8,28]` 之外 → **重抽**（解法过多 = 太松，与高 stress 不符）。

### 2.5.4 三层结构的设计哲学

源码呈现的设计是把策略按"作用方式"分到 3 个机制里：

| 策略类型 | 机制 | 行为契约 |
|---|---|---|
| **概率偏好**（rhythmPhase / sizePref / comboChain / scoreMilestone / multiClearBonus 等） | 阶段 3 **加权乘子** | 改变分布、不改值域——保证策略生效但不消除"随机感" |
| **数量保证**（clearGuarantee） | 阶段 2 **占位** + 阶段 3 **补足乘子** 双保险 | 不依赖概率，硬性保证"至少 N 个消行块" |
| **可玩性 / 难度调控**（mobTarget / sequentiallySolvable / targetSolutionRange / orderRigor） | 阶段 4 **硬过滤 + 重抽** | 拒绝"必死"和"过松/过严"组合，**任何 stress 下都保证可玩** |

**好处**：

1. **可解释性**：每个块为什么被选出来，可由 `diagnostics` 完整回放（`reason: 'perfectClear' / 'clear' / 'weighted' / 'fallback'`）；DFV 面板与 `_lastDiagnostics` 都能跟踪到字段级。
2. **不可预测性**：乘子 ≠ argmax，所以**相同心情/盘面下仍会拿到不同的 3 块**，避免"看穿算法"。
3. **公平地板**：硬约束总是兜底，任何策略组合都不能造成必死局——产品可以**激进调策略**而不担心翻车。

### 2.5.5 历史修复：scoreMilestone 桥接（v1.55.16）

在 v1.55.16 之前，`blockSpawn.js:870-872` 的 `ctx.scoreMilestone && s.gapFills > 0 → w *= 1.3` 加权分支属于 **dead branch**：

- `adaptiveSpawn` 把里程碑命中信号写在 `layered.spawnHints.scoreMilestone`（权威源）
- `blockSpawn` 却读 `ctx.scoreMilestone`（即 `_spawnContext`）
- `_commitSpawn` 只在每轮末把 `_spawnContext.scoreMilestone` 清为 `false`、**从不置 `true`**
- → 加权 `×1.3` 在主路径上**从未触发**

**修复**：在 `web/src/game.js spawnBlocks()` 顶部、`generateDockShapes` 调用之前桥接一次：

```js
this._spawnContext.scoreMilestone = layered?.spawnHints?.scoreMilestone === true;
```

让 `spawnHints` 成为唯一权威输入；`_commitSpawn` 末尾的清零行作为"栈底重置"语义保留。回归测试见 `tests/gameSpawnMilestoneBridge.test.js`（4 条契约 case）。

---

## 2.6 难度调控杠杆层级（基于 SGAZ 实证 · v1.55.17）

OpenBlock 当前所有难度调控都在"**形状权重 + spawnHints 加权乘子**"这一中等强度杠杆上展开（17 个 stress 分量、25 格 `lifecycle cap`、30+ `blockSpawn` 加权乘子）。但**这并不是难度调控的全部可能性**——下表基于 [Wang C-J. et al., *Evaluating Game Difficulty in Tetris Block Puzzle*, arXiv:2603.18994](https://arxiv.org/pdf/2603.18994)（SGAZ 在 8×8 Tetris Block Puzzle 上的难度量化实验）给出**四类规则杠杆的实证强度排序**，供后续调参与扩展时作为优先级参考。

| 优先级 | 杠杆 | 实证强度 | 数据 | OpenBlock 现状 |
|---|---|---|---|---|
| 1 | **候选块数 `dock` / `h`** | ★★★ 最强 | `h=3→h=2`：训练奖励 6544→4126（−37%），收敛 61→160 iter（+162%）；`h=1` 几乎不可玩（奖励 39，未收敛） | ✗ 固定 `dock=3`，从未浮动 |
| 2 | **形状库扩充**（pentomino） | ★★ 强 | 加任一 pentomino 即可让奖励显著下行；加两个在 `h=2, p=0` 下直接训练不收敛；**T-pentomino 单独造成最大减速** | ✗ 仅在固定形状池里调权重 |
| 3 | **`shapeWeights` profile 插值** | 中（论文未直接测；OpenBlock 现行主路径） | — | ✓ 10 档 profile × 17 stress 分量（详见 [ADAPTIVE_SPAWN §4 / §5.1](./ADAPTIVE_SPAWN.md)） |
| 4 | **预览数 `preview` / `p`** | ★ 弱 | 增加 `p` 仅小幅降低难度；`h=1, p=4` 仍只能收敛到 ~5000，远不及 `h=3, p=0` 的 6544 | ✗ 无 preview 机制 |

#### 三条调参原则（直接录入调参手册）

1. **杠杆排序原则**：未来若需"硬难度上调/下调"，优先评估 `dock` / 形状库变体，再调 `shapeWeights`；预览仅作为心理安抚工具，不作为难度主杠杆。
2. **OpenBlock 默认配置 = 论文 baseline**：当前 `dock=3 + 无 preview + 仅 tetromino` 即论文的 classic `h=3, p=0`——SGAZ 在此 baseline 下接近通关（奖励 6544/6750），意味着我们当前 `shapeWeights` 体系再如何调，都处在一个"强 AI 已摸顶"的难度边界内。
3. **避免实质性 `h=1`**：dock 名义为 3，但在 fill 较高 + 形状池收紧 + 三块全部不可放时会退化为"实质性 `h=1`"。这是 `bottleneckRelief` / `firstMoveFreedom` / `targetSolutionRange` 等约束存在的根本原因，调参时**任何会增加三块全不可放概率的改动都必须配套加强 `bottleneckRelief`**。

> **完整启示与对"挑战自我"主线的应用**：见 [ADAPTIVE_SPAWN §10.6 外部实证基线](./ADAPTIVE_SPAWN.md#106-外部实证基线sgaz--tetris-block-puzzlev15517) 与 [最佳分追逐策略 §5.z 规则层调控（未来方向）](../player/BEST_SCORE_CHASE_STRATEGY.md#5z-基于-sgaz-实证的规则层调控未来方向v15517)。

---

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

对每个候选形状，遍历所有合法放置位，用 `grid.previewClearOutcome` 模拟放置后的消行数，返回最大值。**v3.4**：不再以 `gapFills > 0` 为前置条件才算 `multiClear`（见 §2.3）。当该形状 `multiClear ≥ 2` 时在权重中获得额外加成：

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

### 4.2 多消鼓励 `deriveMultiClearBonus(ctx, fill)`

按优先级返回 **0.15～1.0 的分段常数**（非连续插值），与 `blockSpawn` 里 `multiClearBonus * 0.6` 等乘子配合：

| 条件（自上而下命中即返回） | 返回值 |
|---------------------------|--------|
| `pcSetup ≥ 2` | 1.0 |
| `pcSetup ≥ 1` | 0.9 |
| `nearFullLines ≥ 5` | 1.0 |
| `nearFullLines ≥ 3` | 0.8 |
| `roundsSinceClear > 3` | 0.7 |
| `fill > 0.60` | 0.6 |
| `fill > 0.45` | 0.4 |
| 否则 | 0.22（基础引导，v3.4↑） |

**设计意图**：与 `multiLineTarget` 分工——`multiClearBonus` 抬高「多消相关」整体权重曲线；`multiLineTarget` 再在阶段 1 排序与阶段 2 加权里**显式偏好 multiClear≥2** 的兑现块。

### 4.3 多线目标 `multiLineTarget`（0 / 1 / 2，v3.2）

| 值 | 含义 | 典型来源 |
|----|------|----------|
| 0 | 不额外强调「同时多线」| _default_ |
| 1 | 中等：加权池略偏 `multiClear≥2` | `nearFullLines≥3`、或刚完成 `lastClearCount≥2` 且 `fill>0.35`、或 `fill>0.58` 且 `nearFullLines≥2` |
| 2 | 强：阶段 1 排序 + 选块与加权池强烈偏 `multiClear≥2` | `pcSetup≥1`、`nearFullLines≥5`、清屏猎人玩法、局间热身（见 §5.4） |

**blockSpawn 中的耦合**：

- 阶段 1：`multiLineTarget≥2` 时消行候选排序为 `multiClear` 项增加 `0.35×multiLineTarget` 的等效 bonus；与 `multiClear≥2` 的优先截断条件与 `multiClearBonus>0.3` 并列。
- 阶段 2：对 `multiLineTarget≥2` 且 `multiClear≥2` 的块额外 `×(1.45 + 0.28×multiClearBonus)` 量级乘子；`Target==1` 时 `×1.22`。
- **多消后续航**：`lastClearCount≥2` 且 `rhythmPhase==='payoff'` 时，对 `gapFills>0` 且 `multiClear≤1`、格数 2～6 的块加权，降低「只有巨型多线块、续不上手」的断裂感。

### 4.4 节奏相位 `deriveRhythmPhase`（v3.2 收紧）

**原问题**：仅因 `pacingPhase==='release'` 或 `roundsSinceClear≥2` 就进入 `payoff`，在**无近满行、无清屏准备**的疏松盘面上仍强行「收获期」，体感和几何机会错位。

**现规则（摘要）**：

- 先算几何门控 `nearGeom`：`pcSetup≥1` 或 `nearFullLines≥2` 或（`fill>0.52` 且 `nearFullLines≥1`）。
- `payoff`：`pcSetup≥1`；或 `nearFullLines≥3`；或（`release` 且 `nearGeom`）；或（`roundsSinceClear≥2` 且 `nearGeom`）。
- `setup`：`pacing` 紧张期且刚消过行（`roundsSinceClear===0`）。
- 其余为 `neutral`。

| 相位 | 触发（更新后） | 出块行为（blockSpawn 侧不变） |
|------|----------------|------------------------------|
| `setup` | 紧张期 + 刚消过行 | 偏好 4~6 格、非消行构型（蓄力） |
| `payoff` | 清屏准备 / 多临消行 / 有几何门控下的 release 或久未消行 | 消行与多消乘子升高 |
| `neutral` | 其他 | 标准权重 |

**救援态**（与相位独立）：`roundsSinceClear ≥ 2` 时 `clearGuarantee` 至少为 2；`≥ 4` 时至少为 3 且 `sizePreference ≤ -0.35`。

### 4.5 品类记忆

- **同轮**: `usedCategories` 防止同一轮出重复品类
- **跨轮**: `_categoryMemory` 记录最近 3 轮已出品类，频次 > 2 的品类权重衰减 `max(0.4, 1 - (freq-2) * 0.12)`
- **diversityBoost**: 来自自适应引擎，无聊心流时提高，进一步惩罚同品类重复

### 4.6 爽感兑现 `deriveDelightTuning`（v3.3）

**输入信号**：

- 玩家能力：`skillLevel` 高于 `adaptiveSpawn.delight.highSkillThreshold` 时，增加多消偏置；若同时 `flowState==='bored'`，额外轻微加压。
- 心流状态：`flow` 或 `release` 更容易进入 `flow_payoff`；`anxious` 或 `needsRecovery` 进入 `relief`，降低 stress 但保持清线爽感。
- 过程表现：`momentum>0` 表示玩家正在顺手，增加 `multiClearBoost`，让好状态能接上更强反馈。
- 盘面机会：`nearFullLines` 与 `pcSetup` 越高，`delightBoost` / `perfectClearBoost` 越高。

**blockSpawn 消费方式**：

- 阶段 1 排序：`pcPotential` 的权重随 `perfectClearBoost` 提升，`multiClear` 的权重随 `delightBoost` 提升。
- 阶段 1 选块：`delightBoost>0.25` 时，多消候选进入优先截断池；`perfectClearBoost>0.45` 时，可清屏块优先。
- 阶段 2 加权：清屏块从 `×12` 提升到 `×(12 + 10×perfectClearBoost)`；多消项增加 `0.45×delightBoost`；payoff 期对 `multiClear≥1` 再乘 `1 + 0.55×delightBoost`。
- 槽位策略：`delightBoost>0.65` 时允许 3 个槽位都服务于消行/多消，制造连续兑现窗口。

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

### 5.3 无步可走后的局间热身（v3.2）

当本局因**无可行步**结束（`endGame({ noMovesLoss: true })`）时，按终局 `roundsSinceClear` 与 `fill` 写入 `localStorage` 键 `openblock_spawn_warmup_v1`（48h 内有效）。**下一局 `start()`** 消费该键（读入后即删除），向 `spawnContext` 注入：

- `warmupRemaining`：余下多少**出块轮**（补块次数）应用热身；写入值为 2～4（`start()` 侧再夹到 1～5 以防脏数据）；
- `warmupClearBoost`：0～2，抬高 `clearGuarantee` 与 `multiLineTarget` 的档量。

`resolveAdaptiveStrategy` 在 `warmupRemaining>0` 时：抬高 `clearGuarantee`、压 `sizePreference`、抬 `multiClearBonus` 下限、抬 `multiLineTarget`，并将 `setup` 夹为 `neutral` 以免与「刚给糖」冲突。`game._commitSpawn` 每轮 `warmupRemaining--`。

**设计意图**：把「死局挫败」接上一段可感知的**下一局前几个三连**友好窗口，与 Layer3 的 `warmup` 弧线互补（前者是跨局死亡补偿，后者是局内前 3 轮）。

### 5.4 长周期信号（继承自 playerProfile）

- **trend**: 长周期进步/退步趋势 → stress 微调
- **confidence**: 数据置信度 → 收窄/放宽技能调节幅度
- **historicalSkill**: 历史综合技能 → 与实时技能混合

### 5.5 跨局画像调制：生命周期阶段 + 成熟度档位（v1.32 起）

`adaptiveSpawn.js` 在 Layer 1/2/3 所有信号合成出 `rawStress` 后、`clamp([-0.2, 1])` 之前（**算法内部仍用 raw 域**；对外口径 `[0, 1]` 见 [自适应出块 §3.5 stress 域口径](./ADAPTIVE_SPAWN.md#35-stress-域口径v15517)），会对 stress 再走一道**由跨局画像驱动的硬调制**：

```
final.stress = clamp(
    min(rawStress, lifecycleCap)  +  lifecycleAdjust,
    -0.2, 1.0
)
其中 (lifecycleCap, lifecycleAdjust) = getLifecycleStressCap(stage, band)
```

**两个画像维度**（与本文 Layer1/2/3 的局内信号正交）：

| 维度 | 来源 | 取值 | 数据更新 |
|---|---|---|---|
| `stage` 生命周期 | `retention/playerLifecycleDashboard.js` | `S0..S4`（新入场 / 激活 / 习惯 / 稳定 / 回流） | 三项 AND 门：`daysSinceInstall + totalSessions + daysSinceLastActive`，每帧按需重算（300ms TTL） |
| `band` 成熟度 | `retention/playerMaturity.js` | `M0..M4`（新手 / 成长 / 熟练 / 资深 / 核心） | maturity SkillScore 阈值映射（≥90→M4 / 80–89→M3 / 60–79→M2 / 40–59→M1 / <40→M0），每局 `onSessionEnd` 写盘 |

> ⚠️ M-band 的 SkillScore 与本文 §3 投放区的 `AbilityVector.skillScore` 是两个不同指标——前者是跨局画像、按天 EMA、仅决定 band；后者是局内 5 维 EMA、每帧刷新、直接进 `skillAdjust`。详见 `web/src/playerAbilityModel.js` 与 `web/src/retention/playerMaturity.js` 的 docstring 警示。

**调制表（`web/src/lifecycle/lifecycleStressCapMap.js`，全仓 single source of truth）**：

|        | M0 新手 | M1 成长 | M2 熟练 | M3 资深 | M4 核心 |
|--------|---------|---------|---------|---------|---------|
| **S0 新入场** | cap 0.50 / adj −0.15 | — | — | — | — |
| **S1 激活**   | 0.60 / −0.10 | 0.65 / −0.05 | 0.70 / 0 | — | — |
| **S2 习惯**   | 0.65 / −0.10 | 0.70 / 0 | 0.75 / +0.05 | 0.82 / +0.10 | — |
| **S3 稳定**   | — | 0.72 / 0 | 0.78 / +0.05 | 0.85 / +0.10 | **0.88 / +0.12** |
| **S4 回流**   | 0.55 / −0.15 | 0.60 / −0.10 | 0.70 / 0 | 0.75 / +0.05 | 0.80 / +0.08 |

**两个维度的影响幅度**：

- **band 移动**（同 stage）：M0→M4 → cap 抬升 0.16–0.25 → 对应本文 §7 的 10 档 difficulty profile 的 **3–4 档**差距；
- **stage 移动**（同 band）：S0/S4（保护期）vs S2/S3（挑战期）在同 band 下 cap 差 0.10–0.30。

**未在调制表内的组合**（如 `S0·M3` / `S3·M0`）：`getLifecycleStressCap` 返回 `null`，本调制段直接跳过——产线分布极低，仅由通用 stress 通路 + onboarding/winback 特例处理。

**与现有特殊保护通路的关系**（串联，不替代）：

1. **新手保护**（`profile.isInOnboarding === true`，stage=S0）→ 进一步把 stress 压到 `≤ -0.15`；
2. **winback 保护包**（`daysSinceLastActive ≥ 7`，stage=S4）→ 前 3 局 cap 取 `min(0.6, lifecycleCap)`；
3. **B 类高分挑战**（segment5='B' 且 score ≥ best×0.8）→ stress 加 `≤ +0.15`，与 lifecycle adjust 同向时不叠加。

**透出字段**（`stressBreakdown`，回放面板可追踪）：

- `lifecycleStage` / `lifecycleBand`：当前判定的画像
- `lifecycleStressAdjust`：cap 实际触发时的差值（负值 = stress 被压低）
- `winbackStressCap`：winback 包激活时的 cap

详细推导与历史演进见 [`ADAPTIVE_SPAWN.md` §5.1.2](./ADAPTIVE_SPAWN.md#512-生命周期--成熟度-stress-调制v132)。

## 6. 策略解释面板同步

### 6.1 投放区新增指标

| 指标 | 来源 | 说明 |
|------|------|------|
| 连击 | `spawnHints.comboChain` | Combo 链强度 |
| 多消 | `spawnHints.multiClearBonus` | 多消鼓励强度 |
| 多线×n | `spawnHints.multiLineTarget` | 0/1/2，显式偏好多线兑现块型 |
| 节奏 | `spawnHints.rhythmPhase` | 搭建/收获/中性 |
| 弧线 | `spawnHints.sessionArc` | 热身/巅峰/收官 |
| 空洞 | `spawnDiagnostics.layer1.holes` | 盘面空洞数 |
| 平整 | `spawnDiagnostics.layer1.flatness` | 表面平整度 |
| 近满 | `spawnDiagnostics.layer1.nearFullLines` | 接近满行数 |
| 阶段 | `stressBreakdown.lifecycleStage` | S0..S4 → 进 §5.5 调制表 |
| 成熟 | `stressBreakdown.lifecycleBand`  | M0..M4 → 进 §5.5 调制表 |
| 调制 | `stressBreakdown.lifecycleStressAdjust` | cap 触发时的 stress 差值 |

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
  "layer2": { "comboChain": 0.55, "multiClearBonus": 0.3, "multiLineTarget": 1, "rhythmPhase": "payoff", "divBoost": 0.15, "recentCatFreq": {"lines": 2, "rects": 1} },
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

## 9. SpawnTransformerV2：生成式模型

### 9.1 概述

除了启发式（Layer 1-3），系统还提供基于 Transformer 的**生成式模型**，从玩家行为序列中学习出块策略。用户可在运行时切换启发式和生成式。

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
5. 失败则自动回退到启发式

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
