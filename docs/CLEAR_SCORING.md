# 消行计费规则（Clear Scoring）

> 最后更新：2026-04-26  
> 以代码为准：`web/src/game.js` 的 `computeClearScore` 与 `miniprogram/core/bonusScoring.js`（二者对齐）。

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
\text{clearScore} = \text{baseScore} + \text{iconBonusScore}
\]

性质：

- 任意合法 `c、b` 下，得分均为 **10 的整数倍**（`baseUnit` 为整十时恒成立）。
- 当 **所有消除线均为 bonus**（`b = c`）时：  
  \(\text{clearScore} = \text{baseUnit} \times c^2 + (\text{baseUnit} \times c) \times c \times 4 = 5 \times \text{baseUnit} \times c^2 = \text{ICON\_BONUS\_LINE\_MULT} \times \text{baseScore}\)。

实现见：

```100:116:web/src/game.js
export function computeClearScore(strategyId, result) {
    const scoring = getStrategy(strategyId).scoring;
    const c = result?.count ?? 0;
    const baseUnit = scoring.singleLine ?? 20;
    const baseScore = c > 0 ? baseUnit * c * c : 0;

    const bonusLines = result?.bonusLines || [];
    const bonusCount = bonusLines.length;
    if (c <= 0 || bonusCount <= 0) {
        return { baseScore, iconBonusScore: 0, clearScore: baseScore };
    }
    const effectiveBonusCount = Math.min(bonusCount, c);
    const lineScore = baseUnit * c;
    const iconBonusScore = lineScore * effectiveBonusCount * (ICON_BONUS_LINE_MULT - 1);
    return { baseScore, iconBonusScore, clearScore: baseScore + iconBonusScore };
}
```

---

## 4. 理论最大消除数 `c_max`（与形状库一致）

单次落子能触发的消除行列数上限，由 **`shared/shapes.json`** 中各形状的占用行数 + 占用列数之和的最大值决定。当前形状库下 **`c_max = 6`**（例如 `1×5` / `5×1`、`3×3`、五连 L 等形状可达该上限）。

单元测试在 `tests/bonusLineFeature.test.js` 中对 `1…c_max` 与 `b = 0…c` 做枚举断言。

---

## 5. 与 RL / 回放字段的关系（易混点）

- **对局消行得分**：以本节 `computeClearScore` 为准。  
- **`scoring.multiLine` / `scoring.combo`**：仍存在于 `shared/game_rules.json`，供 **RL 模拟器**、部分序列快照等路径使用；**与当前 Web/小程序对局 `computeClearScore` 的公式已解耦**。若需统一，应单独开任务评估对训练数据与奖励塑形的影响。

---

## 6. 商业化策略「存储在哪里」（与消行计费分开）

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

更完整的商业化栈说明仍以 **[MONETIZATION.md](./MONETIZATION.md)** 为总览。
