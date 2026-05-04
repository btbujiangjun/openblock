# 消行计分规则 · Clear Scoring

> 最后更新：2026-04-30（RL / 小程序模拟器出块与计分已对齐主局）  
> 以代码为准：`web/src/clearScoring.js` 的 `computeClearScore`（由 `game.js` 透传导出）与 `miniprogram/core/bonusScoring.js` 对齐。

---

## 1. 术语

| 名称 | 含义 |
|------|------|
| `c` | 本次消除的**行列总数**（`grid.checkLines()` 返回的 `count`，行 + 列） |
| `baseUnit` | 策略配置中的 `scoring.singleLine`，缺省为 **20**（见 `shared/game_rules.json`） |
| **基础分** `baseScore` | 与「多消规模」相关的基准得分 |
| **同 icon / 同色 bonus 线** | 满行或满列上，所有格为同一 icon（有 `blockIcons` 时）或同一 `colorIdx`（无 icon 皮肤时）；检测在清除前完成 |
| `b` | `bonusLines.length`，且实现中会钳制为 `min(b, c)` |
| `ICON_BONUS_LINE_MULT` | **5**，表示 bonus 线在「该线基础价值」上按 **5×** 计（相对普通线多 **4×** 的增量） |
| `PERFECT_CLEAR_MULT` | **10**，表示本次消除后盘面清空时，对基础分 + bonus 分整体乘以 **10×** |

---

## 2. 基础分（多消力度随 `c` 放大）

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

## 3. 同 icon / 同色 bonus

每条被消除的线有一个**随多消规模增长**的基础价值：

\[
\text{lineScore} = \text{baseUnit} \times c
\]

其中 **恰好**有 `b` 条线为 bonus 线（`0 ≤ b ≤ c`），则 bonus 增量为：

\[
\text{iconBonusScore} = \text{lineScore} \times b \times (\text{ICON\_BONUS\_LINE\_MULT} - 1)
= \text{lineScore} \times b \times 4
\]

最终得分：

\[
\text{subtotal} = \text{baseScore} + \text{iconBonusScore}
\]

若本次消除后盘面清空：

\[
\text{clearScore} = \text{subtotal} \times \text{PERFECT\_CLEAR\_MULT}
\]

否则：

\[
\text{clearScore} = \text{subtotal}
\]

性质：

- 任意合法 `c、b` 下，得分均为 **10 的整数倍**（`baseUnit` 为整十时恒成立）。
- 当 **所有消除线均为 bonus**（`b = c`）时：  
  \(\text{clearScore} = \text{baseUnit} \times c^2 + (\text{baseUnit} \times c) \times c \times 4 = 5 \times \text{baseUnit} \times c^2 = \text{ICON\_BONUS\_LINE\_MULT} \times \text{baseScore}\)。

实现见（Web）：

```129:149:web/src/clearScoring.js
export function computeClearScore(strategyId, result) {
    const scoring = scoringOverride && typeof scoringOverride === 'object'
        ? scoringOverride
        : getStrategy(strategyId).scoring;
    const c = result?.count ?? 0;
    const baseUnit = scoring.singleLine ?? 20;
    const baseScore = c > 0 ? baseUnit * c * c : 0;

    const bonusLines = result?.bonusLines || [];
    const bonusCount = bonusLines.length;
    if (c <= 0) return { baseScore, iconBonusScore: 0, clearScore: baseScore };
    const effectiveBonusCount = Math.min(bonusCount, c);
    const lineScore = baseUnit * c;
    const iconBonusScore = lineScore * effectiveBonusCount * (ICON_BONUS_LINE_MULT - 1);
    const subtotal = baseScore + iconBonusScore;
    const perfectMult = result?.perfectClear ? PERFECT_CLEAR_MULT : 1;
    return { baseScore, iconBonusScore, clearScore: subtotal * perfectMult };
}
```

---

## 4. 出块颜色与 bonus 对齐（v10.17+）

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

## 5. 理论最大消除数 `c_max`（与形状库一致）

单次落子能触发的消除行列数上限，由 **`shared/shapes.json`** 中各形状的占用行数 + 占用列数之和的最大值决定。当前形状库下 **`c_max = 6`**（例如 `1×5` / `5×1`、`3×3`、五连 L 等形状可达该上限）。

单元测试在 `tests/bonusLineFeature.test.js` 中对 `1…c_max` 与 `b = 0…c` 做枚举断言。

---

## 6. 与 RL / 回放字段的关系

- **对局消行得分**：以本节 `computeClearScore` 为准。  
- **无头模拟器**（`web/src/bot/simulator.js`）与 **RL 模拟器**（`rl_pytorch/simulator.py`、`rl_mlx/simulator.py`）：与主局相同使用 `baseUnit × c²`、bonus 公式和清屏 10× 公式；在消除前写入 `result.bonusLines`，消除后写入 `perfectClear` 再计分。
- **格子上的 bonus 原始字段**：`Grid.checkLines()` 仍会构造 `bonus_lines`（Python / JS）；计分时以 `detectBonusLines` 合并结果为准的情况见主局 `game.js`。纯同色盘面下与 `checkLines` 同色判定一致。  
- **回放重算** `web/src/moveSequence.js` 的 `replayStateAt`：仍受帧内是否含皮肤 icon 信息约束。  
  - **回放限制**：序列帧通常不含 `blockIcons`，重算未必能识别「同 icon、不同 `colorIdx`」的 bonus；与仅依赖颜色的对局分支一致。  
- **`scoring.multiLine` / `scoring.combo`**：仍存在于 `shared/game_rules.json` 与历史 `init` 帧里，便于旧数据兼容；**消行得分仅读取 `singleLine` 作为 `baseUnit`**。

---

## 7. 商业化策略「存储在哪里」（与消行计分分开）

商业化策略分三层，不要与「消行得分」混淆：

| 层级 | 内容 | 主要存储位置 |
|------|------|----------------|
| **可调参数** | 分群权重、阈值、`adTrigger` / `iapTrigger` / `taskWeights` 等 JSON | SQLite 表 **`mon_model_config`**（`id='default'`，字段 `config`），经 `GET/PUT /api/mon/model/config` 读写；默认种子见 `monetization_backend.py` 初始化 |
| **用户画像与推荐结果** | 分群、`strategy.actions` 等 | 后端按 `user_stats` / `sessions` / `behaviors` 计算；**缓存**在浏览器 `localStorage['openblock_mon_persona_v1']`（`web/src/monetization/personalization.js`）；分群快照表 **`mon_user_segments`** |
| **规则引擎（硬编码）** | `_build_strategy` 里按 whale/dolphin/minnow 拼 action 列表 | **`monetization_backend.py`** 源码 |
| **曝光日志** | 策略展示/转化 | SQLite 表 **`mon_strategy_log`**，`POST /api/mon/strategy/log` |
| **前端频控与开关** | 广告冷却、体验分、功能开关等 | 多个 **`localStorage`** 键（如 `openblock_ad_freq_v1`、`openblock_mon_flags_v1` 等，见 `web/src/monetization/adTrigger.js`、`featureFlags.js`） |

表结构片段：

```67:91:monetization_backend.py
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
