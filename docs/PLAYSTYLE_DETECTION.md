# 玩法偏好识别与出块联动

## 设计目标

Open Block 的自适应出块系统已能根据技能、心流、挫败等实时指标动态调整投放策略。但这套系统是"压力驱动"的——它关注玩家**当前状态**（好/坏），却对玩家**长期偏好**（想玩什么）知之甚少。

本模块的目标是从玩家的落子行为中**推断玩法风格偏好**，并将其反馈到出块算法，让系统投放更符合玩家意图的方块。

核心原则：
- **数据就地取用**：所有指标均从 `PlayerProfile._moves` 滑动窗口推算，不增加新的采集点。
- **偏好轻推，非强制**：playstyle 调整在所有条件规则之后执行，只做"最终对齐"，不覆盖反死局等安全逻辑。
- **冷启动友好**：窗口数据不足时返回保守默认值（0 或 `balanced`），不做错误归因。

---

## 数据来源

`PlayerProfile._moves` 是一个长度上限为 `_window`（默认 15）的滑动窗口，每条记录：

```
{ ts: number, thinkMs: number, cleared: boolean, lines: number, fill: number, miss: boolean }
```

关键字段：
| 字段 | 说明 |
|---|---|
| `cleared` | 本次放置是否触发了消行 |
| `lines` | 本次消除的行列条数之和（多消时 > 1） |
| `fill` | **消行之后**的棋盘填充率；`fill === 0` 表示清屏（棋盘全空） |
| `miss` | 是否为 AFK 等异常记录（计算时排除） |

---

## 四个新指标

### `multiClearRate`（多消率）

```js
get multiClearRate() {
    const clears = this._moves.slice(-this._window).filter(m => m.cleared && !m.miss);
    if (clears.length < 2) return 0;           // 冷启动保护
    return clears.filter(m => m.lines >= 2).length / clears.length;
}
```

- **含义**：近期消行事件中，`lines >= 2`（多行/列同时消除）的比例。
- **范围**：`0.0 ~ 1.0`
- **冷启动**：消行事件不足 2 条时返回 `0`，避免单样本过拟合。

### `perfectClearRate`（清屏率）

```js
get perfectClearRate() {
    const clears = this._moves.slice(-this._window).filter(m => m.cleared && !m.miss);
    if (clears.length < 2) return 0;
    return clears.filter(m => m.fill === 0).length / clears.length;
}
```

- **含义**：近期消行事件中，消行后棋盘完全为空（`fill === 0`）的比例。
- **实现技巧**：`fill` 字段是消行**后**的填充率，因此 `fill === 0` 精确对应清屏。

### `avgLinesPerClear`（平均消除条数）

```js
get avgLinesPerClear() {
    const clears = this._moves.slice(-this._window).filter(m => m.cleared && !m.miss);
    if (clears.length === 0) return 0;
    return clears.reduce((s, m) => s + m.lines, 0) / clears.length;
}
```

- **含义**：每次消行平均清除的行列条数。
- **参考值**：`1.0` = 仅单消；`2.5+` = 强多消偏好。

### `playstyle`（玩法风格）

```js
get playstyle() {
    if (this.perfectClearRate >= 0.05)                               return 'perfect_hunter';
    if (this.multiClearRate >= 0.40 || this.avgLinesPerClear >= 2.5) return 'multi_clear';
    if (this.recentComboStreak >= 3)                                 return 'combo';
    if (this.metrics.clearRate < 0.25)                               return 'survival';
    return 'balanced';
}
```

---

## 五种玩法风格

| 风格 | 标识符 | 识别条件（优先级降序） | 描述 |
|---|---|---|---|
| 清屏猎人 | `perfect_hunter` | `perfectClearRate >= 0.05` | 追求一次性消空棋盘，主动构建清屏局势 |
| 多消流 | `multi_clear` | `multiClearRate >= 0.40` 或 `avgLinesPerClear >= 2.5` | 偏好同时消除多行/列，追求组合爆发 |
| 连消流 | `combo` | `recentComboStreak >= 3` | 维持连续消行链，注重节奏和延续性 |
| 生存流 | `survival` | `metrics.clearRate < 0.25` | 以放块保活为主，消行频率低 |
| 均衡 | `balanced` | 不满足上述任何条件 | 无明显单一偏好，按常规自适应策略执行 |

**优先级说明**：清屏猎人 > 多消流 > 连消流 > 生存流 > 均衡。当玩家同时满足多个条件时，取最高优先级。

---

## 出块联动（→ spawnHints）

playstyle 调整块位于 `adaptiveSpawn.js` 的 `resolveAdaptiveStrategy` 末尾，在所有条件规则之后执行：

```js
const playstyle = profile.playstyle ?? 'balanced';
if (playstyle === 'perfect_hunter') {
    multiClearBonus = Math.max(multiClearBonus, 0.85);
    clearGuarantee  = Math.max(clearGuarantee, 2);
} else if (playstyle === 'multi_clear') {
    multiClearBonus = Math.max(multiClearBonus, 0.65);
    if (rhythmPhase === 'neutral') rhythmPhase = 'payoff';
} else if (playstyle === 'combo') {
    clearGuarantee = Math.max(clearGuarantee, 2);
} else if (playstyle === 'survival') {
    sizePreference = Math.min(sizePreference, -0.25);
    clearGuarantee = Math.max(clearGuarantee, 1);
}
```

### 各风格的 spawnHints 影响

| 风格 | multiClearBonus | clearGuarantee | rhythmPhase | sizePreference |
|---|---|---|---|---|
| `perfect_hunter` | ≥ 0.85 | ≥ 2 | 不变 | 不变 |
| `multi_clear` | ≥ 0.65 | 不变 | `neutral` → `payoff` | 不变 |
| `combo` | 不变 | ≥ 2 | 不变 | 不变 |
| `survival` | 不变 | ≥ 1 | 不变 | ≤ −0.25 |
| `balanced` | 不变 | 不变 | 不变 | 不变 |

这些调整通过 `blockSpawn.js` 中已有的权重逻辑（`multiClearBonus`、`clearGuarantee`、`rhythmPhase`）作用到实际方块选择。

---

## 数据流

```
_moves[fill=0 & cleared]  ──► perfectClearRate ──► playstyle='perfect_hunter'
                                                          │
_moves[lines≥2 & cleared] ──► multiClearRate   ──►       ▼
_moves[lines]             ──► avgLinesPerClear  ──► adaptiveSpawn.resolveAdaptiveStrategy()
                                                          │
_comboStreak ≥ 3          ──► playstyle='combo' ──►       ▼
                                                    spawnHints.multiClearBonus
metrics.clearRate < 0.25  ──► playstyle='survival' ─►     │
                                                    spawnHints.clearGuarantee
                                                          │
                                                          ▼
                                                    blockSpawn.js（权重已有逻辑）
```

---

## 历史记录

`recordSessionEnd` 在每局结束时将 `playstyle`、`multiClearRate`、`perfectClearRate` 写入 `SessionSummary`，保留最近 30 局。可用于未来实现跨局趋势分析（如"连续 3 局为 perfect_hunter 时进一步强化"）。

---

## 已知局限

| 局限 | 说明 |
|---|---|
| 窗口过短 | 默认 15 步窗口对快速风格切换不够敏感；低频消行玩家可能长期处于冷启动状态 |
| 无负反馈 | 目前只做"偏好增强"，若玩家偏好导致失误（如 perfect_hunter 卡盘），系统不会主动降权 |
| 无历史跨局权重 | playstyle 基于当局行为，不考虑历史 30 局的累积偏好 |
| 单一标签 | 一次只取一个风格标签；多风格混合（如"多消 + 连消"）无法同时表达 |

---

## 相关文件

| 文件 | 作用 |
|---|---|
| `web/src/playerProfile.js` | 四个新 getter + `recordSessionEnd` 写入 |
| `web/src/adaptiveSpawn.js` | playstyle → spawnHints 联动调整块 |
| `web/src/playerInsightPanel.js` | 玩法偏好行 + spawn 区域 playstyle pill |
| `web/src/spawnModelPanel.js` | 算法解释面板 Layer 2 中的 `玩法偏好` 参数 |
| `web/index.html` | Layer 2 kv-grid 追加 `sl-playstyle` 节点 |
| `web/public/styles/main.css` | `.insight-playstyle-*` 样式规则 |
| `tests/playstyle.test.js` | 32 个单元测试，覆盖四个 getter 和 adaptiveSpawn 联动 |
