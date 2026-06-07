# 消行计分规则 · Clear Scoring

> 以代码为准：`web/src/clearScoring.js` 的 `computeClearScore`（由 `game.js` 透传导出）与 `miniprogram/core/bonusScoring.js` 对齐。

---

## 〇、术语权威：「Combo」的两个独立维度

> ⚠️ **代码与历史文档里 "combo" 一词同名两义**。本节是唯一权威定义，所有新代码/分析/i18n 必须按此区分；旧字段保留向后兼容但语义已锁死，不应再用于其他维度。

OpenBlock 的"combo"客观上对应**两个完全独立、可同时发生**的物理量：

| 维度 | 标准名 | 触发逻辑 | 代码字段 / 事件 | 计分含义 |
|------|--------|----------|----------------|---------|
| **空间维度**<br/>（"一次落子有多猛"） | **multi-clear** / 多消 | 单次落子 → `grid.checkLines()` 触发的**行 + 列总数** `c` | `result.count` (≡ `c`)、`gameStats.maxCombo`*（"max linesCleared"）*、`gameStats.maxLinesCleared`、`isCombo = c >= 3`、`effectType = 'combo'`、`.float-combo`、`effect.multiClear`、`effect.doubleClear`、`miniGoals.onClear(c, …)` | 进入 `baseScore = baseUnit × c²` 的平方增长项；`c ≥ 3` 走 'combo' 飘字 + 火焰特效时长 |
| **时间维度**<br/>（"节奏延续多久" · 粉色爱心 ♥N） | **combo chain** / 连击节奏（带 grace 窗口） | 清线启动 combo（`_comboCount = 1`）；之后 0 ~ `gracePlacements - 1` 步未清不打断；当连续 ≥ `gracePlacements` 步未清线 → combo 进入"待断"，下次清线**重置**为 1 | `_comboCount` + `_roundsSinceLastClear`（web/web-bot/cocos/小程序/RL 同口径，旧名 `_clearStreak` 仍以 getter 兼容）、`deriveNextComboCount` / `isComboBroken`、`comboMultiplier`、`recordDelight('comboHigh')`、`GAME_EVENTS.COMBO_HIGH`、HUD 粉色爱心徽章 `.combo-heart` / `#combo-heart`、火焰庆祝徽章 `.streak-badge`、`effect.streakCombo`、`effect.comboMultiplier`、`effect.comboHeartAria` | 进入 `comboMultiplier = clamp(1 + (n − activation + 1) × step, 1, max)` 的得分倍数项；默认 `n ≥ 3 → ×2 cap` |

*\* `gameStats.maxCombo` 是历史字段名（v1.0 起持久化到 `localStorage` / 后端 `user_stats.max_combo`），**实际语义是空间维度的 max `linesCleared`**，不是连击 streak 的最大值。新代码若需"max combo streak"，应另起字段 `maxClearStreak` / `recentComboStreak`，不要复用 `maxCombo`。*

### 完整状态机：grace 窗口下 combo 如何延续 / 重置

> **关键直觉**：粉色爱心 ♥N 是 combo 进行中的标志。**连续 N 步未清才断**，不是「未清立即断」。这让节奏型选手在做铺垫时也能保住 combo。

设 `_comboCount = 0`、`_roundsSinceLastClear = +∞`(尚未启动);每次落子按如下伪代码更新:

```
on placement(cleared):                              // cleared = (result.count > 0)
  if cleared:
    if _comboCount == 0 OR _roundsSinceLastClear >= gracePlacements:
      _comboCount = 1                               // 启动 / 重启
    else:
      _comboCount += 1                              // 延续
    _roundsSinceLastClear = 0
  else:
    _roundsSinceLastClear += 1                       // 累加 grace 计数（_comboCount 不动）
    if _roundsSinceLastClear >= gracePlacements:
      // combo 进入"待断"态：爱心徽章淡出；下次清线必重启 = 1
```

### 用户语义示例(默认 `gracePlacements = 3`)

| 步 | 是否清线 | `_rounds`(前→后) | `_comboCount` | 爱心 |
|---:|:------:|:----:|:------:|:----:|
| 100 | ✓ | ∞ → 0 | **1**(启动) | ♥1 |
| 101 | ✗ | 0 → 1 | 1 | ♥1 |
| 102 | ✗ | 1 → 2 | 1 | ♥1 |
| 103 | ✓ (gap=2<3) | 2 → 0 | **2**(延续) | ♥2 |
| 104 | ✗ | 0 → 1 | 2 | ♥2 |
| 105 | ✗ | 1 → 2 | 2 | ♥2 |
| 106 | ✓ (gap=2<3) | 2 → 0 | **3**(累加) | ♥3 |

→ 与用户原话"第 100 步清 → 101/102 未清 → 103 清 → combo 延续……106 清 → combo 继续增长"完全吻合。

**断 combo 示例**:

| 步 | 是否清线 | `_rounds`(前→后) | `_comboCount` | 爱心 |
|---:|:------:|:----:|:------:|:----:|
| 100 | ✓ | ∞ → 0 | 1 | ♥1 |
| 101 | ✗ | 0 → 1 | 1 | ♥1 |
| 102 | ✗ | 1 → 2 | 1 | ♥1 |
| 103 | ✗ | 2 → 3 | 1 | ♥1 → 淡出 |
| 104 | ✗ | 3 → 4 | 1 | (淡出态) |
| 105 | ✓ (gap=4≥3) | 4 → 0 | **1**(重启) | ♥1 |

→ 与用户原话"第 101/102/103 都没清 + 104 仍未清 → combo 大概率已断"完全吻合;第 103 步即进入"淡出/待断"态、第 105 步重启。

### 与空间维度的四种组合

| 落子序列 | 空间 `c` | 时间 `_comboCount` | 计分 |
|---------|---------:|--------------------:|------|
| 单消 → 单消 → **单消** | 1 / 1 / 1 | 1 / 2 / **3** | 第 3 块开始 `×comboMult` |
| **三消** 一次 | **3** | 1 | `baseScore = 20 × 9 = 180`，无连击加成 |
| 单消 → **三消**（连续两块都消） | 1 / **3** | 1 / 2 | `180`，仍未到 combo 阈值 |
| 单消 → 单消 → **三消** | 1 / 1 / **3** | 1 / 2 / **3** | `180 × 2 = 360`（空间 + 时间叠加） |
| 单消 → 未消 → 未消 → 三消 | 1 / 0 / 0 / **3** | 1 / 1 / 1 / **2** | `180`（gap=2<3，combo 延续到 2，未到 3 阈值） |
| 单消 → 未未未未 → 三消 | 1 / 0×4 / **3** | 1 / 1 / **1**(重启) | `180`（gap=4≥3，combo 已断、重启） |

### 命名约定（新代码强制）

- 描述"一次落子的消除规模"：用 **`linesCleared`** / **`multiClear`** / **`c`**，避免 "combo"
- 描述"连续清线的链条"：用 **`comboCount`** / **`comboMultiplier`** / **`gracePlacements`**，避免"多消"
- 描述"距上次清线的未清步数"：用 **`roundsSinceLastClear`**
- UI 文案保持现状（`effect.multiClear` = "{n} 消"、`effect.streakCombo` = "🔥 N 连消"），但**不要让两个文案在同一种场景互相替换**
- 行为埋点：`GAME_EVENTS.COMBO_HIGH` 一律指**时间维度** `_comboCount ≥ 4`；空间维度的"高阶多消"统一用 `multiClear`
- **历史字段兼容**：`_clearStreak` 现作为 `_comboCount` 的 getter/setter 别名(grace 窗口模型已并入);`comboStreak` 旧事件载荷字段已改名 `comboCount`,旧 cocos `clearStreak` 字段亦改名 `comboCount`

---

## 一、术语

| 名称 | 含义 | 维度 |
|------|------|------|
| `c` | 本次消除的**行列总数**（`grid.checkLines()` 返回的 `count`，行 + 列） | 空间 |
| `baseUnit` | 策略配置中的 `scoring.singleLine`，缺省为 **20**（见 `shared/game_rules.json`） | — |
| **基础分** `baseScore` | 与「单手多消规模 `c`」相关的基准得分 | 空间 |
| **同 icon / 同色 bonus 线** | 满行或满列上，所有格为同一 icon（有 `blockIcons` 时）或同一 `colorIdx`（无 icon 皮肤时）；检测在清除前完成 | 空间 |
| `b` | `bonusLines.length`，且实现中会钳制为 `min(b, c)` | 空间 |
| `ICON_BONUS_LINE_MULT` | **5**，表示 bonus 线在「该线基础价值」上按 **5×** 计（相对普通线多 **4×** 的增量） | 空间 |
| `PERFECT_CLEAR_MULT` | **10**，表示本次消除后盘面清空时，对基础分 + bonus 分整体乘以 **10×** | 空间 |
| `_comboCount`（旧名 `_clearStreak`/`comboStreak` 仍兼容） | 当前 combo 链中累计的清线次数（粉色爱心 ♥N）。**带 grace 窗口**：清线 → `+1`（gap < grace）或重启 = 1（gap ≥ grace）；未清不归零，只累加 gap | **时间** |
| `_roundsSinceLastClear` | 距上次清线的未清线步数。每次落子前 +1，清线时归零；用于 grace 窗口判定 | **时间** |
| `gracePlacements` | 连续 ≥ 该步数未清 → combo 进入"待断"。`1` = 严格连击（旧 `_clearStreak` 等价）；`3` = 默认（缓冲 2 步） | **时间** |
| `comboMultiplier` | 由 `_comboCount` 推导的得分倍数。默认 `activation=3 / step=1 / max=2` → 1~2 连无加成、**≥3 连 ×2 cap** | **时间** |
| `gameStats.maxCombo` *（历史字段名）* | 实际是「本局最大单手 `linesCleared`」，**不是 streak 最大值**；新代码勿复用 | 空间 |

---

## 二、基础分（多消力度随 c 放大）

\[
\text{baseScore} = \text{baseUnit} \times c^2
\]

默认 `baseUnit = 20` 时：

| `c` | `baseScore` |
|----:|--------------:|
| 1 | 20 |
| 2 | 80 |
| 3 | 180 |
| 4 | 320 |
| 5 | 500 |
| 6 | 720 |

---

## 三、同 icon / 同色 bonus

每条被消除的线有一个**随多消规模增长**的基础价值：

\[
\text{lineScore} = \text{baseUnit} \times c
\]

其中 **恰好**有 `b` 条线为 bonus 线（`0 ≤ b ≤ c`），则 bonus 增量为：

\[
\text{iconBonusScore} = \text{lineScore} \times b \times (\text{ICON\_BONUS\_LINE\_MULT} - 1)
= \text{lineScore} \times b \times 4
\]

最终得分（与「连击倍数」串行累乘，见 §3bis）：

\[
\text{subtotal} = \text{baseScore} + \text{iconBonusScore}
\]

\[
\text{clearScore} = \text{subtotal} \times \text{perfectMult} \times \text{comboMult}
\]

其中 `perfectMult = PERFECT_CLEAR_MULT` 仅在本次消除后盘面清空时生效（否则为 1），`comboMult` 由 §3bis 决定。

性质：

- 任意合法 `c、b` 下且 `comboMult` 为整数时，得分均为 **10 的整数倍**（`baseUnit` 为整十时恒成立）。
- 当 **所有消除线均为 bonus**（`b = c`）时：  
  \(\text{subtotal} = \text{baseUnit} \times c^2 + (\text{baseUnit} \times c) \times c \times 4 = 5 \times \text{baseUnit} \times c^2 = \text{ICON\_BONUS\_LINE\_MULT} \times \text{baseScore}\)。

实现见 **`web/src/clearScoring.js → computeClearScore`**（接收可选第 4 参 `comboStreak`，未传则不加成 = 100% 向后兼容）。

---

## 三 bis、连击倍数（Combo Multiplier · 带 grace 窗口） · v1.66+

> 与「单次落子的多消 `c`」是**两个互补维度**：`c` 反映单手力度，`_comboCount` 反映节奏延续。
> v1.66+ 起 combo 采用**带 grace 窗口**的 chain 模型（详见 §〇）：1~N-1 步未清不打断，连续 ≥ N 步未清才断。

### 定义

`_comboCount` = 当前 combo 链中已累计的清线次数（HUD 上的粉色爱心 ♥N）。其更新由 §〇 的**纯函数** `deriveNextComboCount(prev, gap, cleared)` 决定，所有端共用同源；详见 `web/src/clearScoring.js`。

倍数公式（与 `web/src/clearScoring.js → deriveComboMultiplier` 同口径）：

\[
\text{comboMult}(n) = \mathrm{clamp}\bigl(1 + \max(0,\ n - \text{activationCount} + 1) \times \text{stepBonus},\ 1,\ \text{maxMultiplier}\bigr)
\]

### 默认参数（`shared/game_rules.json → clearScoring.comboMultiplier`）

| 字段 | 默认值 | 含义 |
|------|-------:|------|
| `enabled` | `true` | 整体开关；`false` 或对象缺失即回退到旧无加成行为 |
| `gracePlacements` | `3` | 连续 ≥ 该步数未清 → combo "待断"，下次清线重启为 1。`1` = 严格连击（旧 `_clearStreak`）|
| `activationCount`（旧名 `activationStreak`） | `3` | 从 `_comboCount` ≥ 该值开始触发加成 |
| `stepBonus` | `1.0` | `_comboCount` 每多 1 递增的倍数增量 |
| `maxMultiplier` | `2.0` | 倍数上限 |

默认配置下：

| `_comboCount` | `comboMult` |
|--------------:|-----------:|
| 1 | ×1 |
| 2 | ×1 |
| **3** | **×2**（首次触发） |
| 4+ | ×2（cap） |

### 与 perfectClear / iconBonus 的串行累乘

三个倍数互不冲突，可叠加：

| 场景 | 倍数链 |
|------|--------|
| 1 连 + 普通双消 | `baseScore × 1 × 1 = baseScore` |
| 3 连 + 普通双消 | `baseScore × 1 × 2 = 2 × baseScore` |
| 1 连 + 清屏 | `baseScore × 10 × 1 = 10 × baseScore` |
| 3 连 + 清屏 | `baseScore × 10 × 2 = **20 × baseScore**` |
| 3 连 + 全 bonus 双消 + 清屏 | `5 × baseScore × 10 × 2 = **100 × baseScore**` |

### 调参指引

| 目标 | 推荐配置 |
|------|---------|
| 默认平衡：3 连及以上 ×2 cap、缓冲 2 步 | `grace=3, activation=3, step=1, max=2` |
| 严格连击（旧 `_clearStreak` 兼容）：未消立即断 | `grace=1, activation=3, step=1, max=2` |
| 宽松节奏：缓冲 4 步（让铺垫型选手保住 combo） | `grace=5, activation=3, step=1, max=2` |
| 高手节奏放大：3 连 ×2、4 连 ×3、5+ 连 ×4 | `grace=3, activation=3, step=1, max=4` |
| 缓启型：3 连 ×1.5、4 连 ×2 cap | `grace=3, activation=3, step=0.5, max=2` |
| 整体关闭加成（回归无 combo 行为） | `enabled: false` |

### UI 提示

- **HUD 粉色爱心徽章 `#combo-heart`**：得分右上角的常驻徽章，combo 进行中显示 `♥ × N`(N = `_comboCount`)；每次清线 pop 动画重启,combo 达到 4+ 时叠加金边光晕(`.combo-heart--high`);当 `_roundsSinceLastClear ≥ gracePlacements` 即进入"待断",CSS 类 `.combo-heart--fading` 让爱心淡出但保留 DOM,下次清线立即复活。
- **`_showStreakBadge`**：`_comboCount ≥ 3` 时在板面中央渲染 🔥 烟火徽章；当 `comboMult > 1` 时叠加金色 `×N` 大字（CSS：`.streak-badge--mult`）。
- **`showFloatScore`**：`+score` 浮分文本同时在标签后追加 `· combo ×N`，确保「多消 / 清屏 / icon bonus」与「连击 ×N」可同时展示而不冲突。
- **i18n**：`effect.comboMultiplier`（zh-CN: `Combo ×N`、en: `Combo ×N`）、`effect.comboHeartAria`（爱心徽章无障碍标签）。

### 跨端一致性

所有 5 端共用同一组**纯函数** `deriveNextComboCount` / `deriveComboMultiplier` / `isComboBroken`（公式 1:1 镜像），输入即输出，无随机源：

| 端 | 实现位置 | 状态字段 | 说明 |
|----|---------|---------|------|
| Web 主局 | `web/src/game.js → playClearEffect` + `_pushPlaceToSequence` + `_updateComboHeart`（HUD 爱心同步） | `_comboCount` + `_roundsSinceLastClear`（向后兼容 getter `_clearStreak`） | 真人对局，含 HUD 粉色爱心徽章 |
| Web 无头模拟器 | `web/src/bot/simulator.js → step` | 同上 | RL 仿真、AI 评估 |
| 回放重算 | `web/src/moveSequence.js → replayStateAt` | `replayComboCount` + `replayRoundsSinceLastClear` 局部变量 | 按帧重放完全同口径 |
| 小程序 | `miniprogram/core/bonusScoring.js`（镜像 4 函数）+ `miniprogram/utils/gameController.js` 跟踪 + `onLineClear` 回调透出 `comboCount / comboMultiplier` | `this._comboCount` + `this._roundsSinceLastClear` | 与 web 完全同源 |
| Cocos | `cocos/assets/scripts/core/scoring.ts`（镜像 4 函数）+ `gameModel.ts`（含 `clearStreak` getter 兼容） + `GameEvent.clear` 字段 `comboCount / comboMultiplier` | `this.comboCount` + `this.roundsSinceLastClear` | 引擎事件回调 |
| Python RL（PyTorch / MLX） | `rl_pytorch/simulator.py` + `rl_mlx/simulator.py`（`_derive_next_combo_count` / `_derive_combo_multiplier`） | `self._combo_count` + `self._rounds_since_last_clear` | Online RL 与浏览器/移动端奖励信号完全对齐 |

### 配置/契约校验

- `tests/bonusLineFeature.test.js` covers: `deriveComboMultiplier` / `deriveNextComboCount` / `isComboBroken` 全状态机、grace 窗口边界（gap = grace、gap = grace-1、首次启动、严格 `grace=1` 等价旧行为）、用户描述的两个示例（100/103/106 延续 vs 101-104 全未清后断）、`enabled=false` 退化、30 步端到端 combo 演进。
- `tests/miniprogramCore.test.js` covers: 小程序镜像与 web 同公式 + grace 窗口 parity。
- Python parity 由 `rl_pytorch/simulator.py::_derive_next_combo_count` / `_derive_combo_multiplier` 与 `rl_mlx/simulator.py` 同名函数 1:1 对照 web 公式（同一 `shared/game_rules.json` 源），CI 内通过 `tests/miniprogramCore.test.js` 间接验证；离线手测见 `git log` 中本 commit 描述。

---

## 四、出块颜色与 bonus 对齐

为减少“分数规则和出块体感不一致”的感受，在**不改形状可解性约束**的前提下对 dock 三色做软引导：

| 端 | 入口 |
|----|------|
| Web 主局 | `game.js` → `_commitSpawn()`：`monoNearFullLineColorWeights` + `pickThreeDockColors`（`web/src/clearScoring.js`） |
| Web / 小程序无头模拟器 | `OpenBlockSimulator._spawnDock()`：同上 API；模拟器传 `skin=null`，即用色值版偏置 |
| PyTorch / MLX RL | `rl_pytorch/dock_color_bias.py`、`rl_mlx/dock_color_bias.py`，由各自 `simulator.OpenBlockSimulator._spawn_dock()` 调用；色池大小取策略 `color_count`（默认 8） |

步骤归纳：

1. `monoNearFullLineColorWeights(grid, skin)` 扫描“差 1~2 格即满”的行列；
2. 若该行/列已填格满足同 icon（有 `blockIcons`）或同色（无 icon），则给关联 dock 色位增加偏置；
3. `pickThreeDockColors(bias)` 在色池上做**无放回加权抽样**，抽出 3 个互异颜色。

设计要点：

- **icon 语义优先**：有 icon 皮肤按 icon 同一性判断（与 bonus 判定一致）；
- **无 icon 回退色值**：与 `detectBonusLines` 的回退策略一致；
- **仅软偏置**：不是“强制给色”，仍保留随机性与多样性。
- **RL 侧**：当前 Python 盘面无 `blockIcons`，偏置实现等价于「仅色值」分支，与训练网格一致。

---

## 五、理论最大消除数 c_max（与形状库一致）

单次落子能触发的消除行列数上限，由 **`shared/shapes.json`** 中各形状的占用行数 + 占用列数之和的最大值决定。当前形状库下 **`c_max = 6`**（例如 `1×5` / `5×1`、`3×3`、五连 L 等形状可达该上限）。

单元测试在 `tests/bonusLineFeature.test.js` 中对 `1…c_max` 与 `b = 0…c` 做枚举断言。

---

## 六、与 RL / 回放字段的关系

- **对局消行得分**：以本节 `computeClearScore` 为准（含 §3bis 的 `comboMultiplier`）。  
- **无头模拟器**（`web/src/bot/simulator.js`）与 **RL 模拟器**（`rl_pytorch/simulator.py`、`rl_mlx/simulator.py`）：与主局相同使用 `baseUnit × c²`、bonus 公式、清屏 10× 公式与 **`comboMultiplier`**；在消除前写入 `result.bonusLines`，消除后写入 `perfectClear` 再计分。RL 奖励信号同步包含 combo 倍数，无需额外 reward shaping。
- **格子上的 bonus 原始字段**：`Grid.checkLines()` 仍会构造 `bonus_lines`（Python / JS）；计分时以 `detectBonusLines` 合并结果为准的情况见主局 `game.js`。纯同色盘面下与 `checkLines` 同色判定一致。  
- **回放重算** `web/src/moveSequence.js` 的 `replayStateAt`：用局部 `replayComboCount` + `replayRoundsSinceLastClear` 按帧重放 combo 链(走同一 `deriveNextComboCount` 纯函数),与对局公式同口径;仍受帧内是否含皮肤 icon 信息约束。  
  - **回放限制**：序列帧通常不含 `blockIcons`，重算未必能识别「同 icon、不同 `colorIdx`」的 bonus；与仅依赖颜色的对局分支一致。  
- **消行得分仅读取 `scoring.singleLine` 作为 `baseUnit`**；`scoring.comboMultiplier` 可在回放 init 帧内嵌以避免与未来策略默认值漂移。

---

## 七、商业化策略存储位置（与消行计分分开）

商业化策略分三层，不要与「消行得分」混淆：

| 层级 | 内容 | 主要存储位置 |
|------|------|----------------|
| **可调参数** | 分群权重、阈值、`adTrigger` / `iapTrigger` / `taskWeights` 等 JSON | SQLite 表 **`mon_model_config`**（`id='default'`，字段 `config`），经 `GET/PUT /api/mon/model/config` 读写；默认种子见 `backend/monetization_backend.py` 初始化 |
| **用户画像与推荐结果** | 分群、`strategy.actions` 等 | 后端按 `user_stats` / `sessions` / `behaviors` 计算；**缓存**在浏览器 `localStorage['openblock_mon_persona_v1']`（`web/src/monetization/personalization.js`）；分群快照表 **`mon_user_segments`** |
| **规则引擎（硬编码）** | `_build_strategy` 里按 whale/dolphin/minnow 拼 action 列表 | **`backend/monetization_backend.py`** 源码 |
| **曝光日志** | 策略展示/转化 | SQLite 表 **`mon_strategy_log`**，`POST /api/mon/strategy/log` |
| **前端频控与开关** | 广告冷却、体验分、功能开关等 | 多个 **`localStorage`** 键（如 `openblock_ad_freq_v1`、`openblock_mon_flags_v1` 等，见 `web/src/monetization/adTrigger.js`、`featureFlags.js`） |

表结构片段：

```67:91:backend/monetization_backend.py
        CREATE TABLE IF NOT EXISTS mon_user_segments (
            user_id          TEXT    PRIMARY KEY,
            segment          TEXT    DEFAULT 'minnow',
            whale_score      REAL    DEFAULT 0,
            activity_score   REAL    DEFAULT 0,
            skill_score      REAL    DEFAULT 0,
            frustration_avg  REAL    DEFAULT 0,
            near_miss_rate   REAL    DEFAULT 0,
            last_computed    INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS mon_model_config (
            id         TEXT    PRIMARY KEY DEFAULT 'default',
            config     TEXT    NOT NULL    DEFAULT '{}',
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS mon_strategy_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      TEXT    NOT NULL,
            strategy     TEXT    NOT NULL,
            action       TEXT    NOT NULL,
            converted    INTEGER DEFAULT 0,
            logged_at    INTEGER DEFAULT (strftime('%s', 'now'))
        );
```

更完整的商业化栈说明仍以 **[MONETIZATION.md](../operations/MONETIZATION.md)** 为总览。
