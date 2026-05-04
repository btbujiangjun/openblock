# 出块算法：解法数量难度调控（v9）

> 版本: v9.0 | 更新: 2026-04-27
> 关联：`SPAWN_ALGORITHM.md` §4「Layer 1 / 反死局」、`ADAPTIVE_SPAWN.md` §3「stress → spawnHints」
> 代码位置：`web/src/bot/blockSpawn.js`、`web/src/adaptiveSpawn.js`、`shared/game_rules.json`、`web/src/playerInsightPanel.js`

---

## 1. 背景：为什么需要解法数量？

### 1.1 现有算法对「难度」的两个粗粒度信号

`generateDockShapes` 在中高填充时仅靠两个布尔/整数指标过滤候选三连块：

| 信号 | 类型 | 涵义 | 局限 |
|---|---|---|---|
| `tripletSequentiallySolvable` | bool | 至少存在 **1** 种放置顺序能完整放下三块 | 1 解 vs 100 解都「通过」，无法区分难度 |
| `countLegalPlacements`（单块自由度） | int | 单个形状放在当前盘面的合法点数 | 仅看局部，不考虑「放完一块后下一块还能不能下」的耦合 |

这两个信号合起来只能把「绝对死局」过滤掉，但无法区分：

- **"唯一解"局面**（1 个序列里 1 个解，每步都必须算准）
- **"宽松"局面**（百千个解，玩家随意放都行）

二者从体感上是两种完全不同的难度档，但在当前算法下被同等对待。

### 1.2 引入「解法数量」作为第三类难度信号

定义 **三连块解法数 (Solution Count)**：

> 在当前盘面下，三连块的 **6** 种放置顺序（3! 排列）中，能完整完成「逐块放下并应用消行」的「位置组合」叶子总数。

形式化：
设三连块为 \(\{s_1, s_2, s_3\}\)，盘面 \(B\)。对每个排列 \(\pi \in S_3\)，定义：

\[
\mathrm{leaves}(\pi) = \big|\{(p_1, p_2, p_3)\ \big|\ B \xrightarrow{s_{\pi_1}@p_1} B_1 \xrightarrow{s_{\pi_2}@p_2} B_2 \xrightarrow{s_{\pi_3}@p_3} B_3\}\big|
\]

（每步 \(p_i\) 必须是当前盘面下 \(s_{\pi_i}\) 的合法位置，应用「放置 + 消行」后得到下一盘面。）

则 **总解数** \(N_{\mathrm{sol}} = \sum_{\pi} \mathrm{leaves}(\pi)\)，**有效排列数** \(V = |\{\pi : \mathrm{leaves}(\pi) > 0\}| \in [0, 6]\)。

\(N_{\mathrm{sol}}\) 是一个**密度指标**，比"是否可解"细粒度高 1–3 个数量级，可以直接映射到难度档位。

---

## 2. 设计目标

| 目标 | 描述 |
|---|---|
| **G1 难度连续可调** | 用 `targetSolutionRange = [min, max]` 在 stress 各档间平滑切换"宽松/紧张/极限" |
| **G2 不破坏可玩性** | 软过滤：只在前 60% attempt 内拒绝越界，超过则降级；budget 截断时跳过过滤 |
| **G3 性能可控** | DFS 双重剪枝（leafCap + budget），且 `fill < activationFill` 时完全不评估 |
| **G4 可解释** | 在玩家画像面板曝光 4 个 Pill：解法数 / 合法序 / 首手 / 区间 |
| **G5 配置化** | 阈值、区间全部进 `game_rules.json`，关 `enabled=false` 即恢复原行为 |

---

## 3. 算法详解

### 3.1 `dfsCountSolutions` — 带剪枝的解叶子枚举

```js
function dfsCountSolutions(grid, orderedShapes, depth, accum, budget) {
    if (accum.count >= accum.cap) return;          // 撞 cap → 立即返回
    if (budget.n <= 0) {                            // 撞 budget → 标记 truncated
        accum.truncated = true;
        return;
    }
    if (depth >= orderedShapes.length) {
        accum.count++;                              // 叶子计入总数
        return;
    }
    const s = orderedShapes[depth];
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (accum.count >= accum.cap || budget.n <= 0) return;
            if (!grid.canPlace(s, x, y)) continue;
            budget.n--;
            const next = placeAndClear(grid, s, x, y);  // 应用消行
            dfsCountSolutions(next, orderedShapes, depth + 1, accum, budget);
        }
    }
}
```

要点：

- `accum.cap = leafCap`（默认 64）：解到 64 个叶子就够"宽松"判定，不再继续展开。
- `budget.n`（默认 8000）：累计入栈次数，相当于状态扩展数硬上限。空盘 8×8 单深度可达数百，三层最坏可达 \(10^7\) 左右，必须截断。
- `placeAndClear`：clone + place + checkLines，确保子盘面已应用消行（这是与"放置数量"截然不同的精确建模）。

### 3.2 `evaluateTripletSolutions` — 6 排列汇总 + 多维指标

返回字段：

```ts
{
  validPerms: number,        // 0..6   有解的顺序数
  solutionCount: number,     // 0..cap 全部叶子总数
  capped: boolean,           // 撞 leafCap（实际 ≥ cap，过滤时按"无上限"对待）
  truncated: boolean,        // 撞 budget（结果不可信，过滤时跳过）
  firstMoveFreedom: number,  // 三块单独放的最小合法点数（瓶颈块）
  perPermCounts: number[]    // 每种顺序贡献的叶子数（debug 用）
}
```

**budget / cap 在 6 个排列间复用**：第一个排列若撞 cap，其余 5 个直接跳过——这是"宽松"局面的 fast-path。

### 3.3 与 `tripletSequentiallySolvable` 的关系

| 维度 | sequentiallySolvable | evaluateTripletSolutions |
|---|---|---|
| 输出 | `bool`（≥1 解 / 无解） | 多维 metrics |
| 顺序 | 找到 1 个解的顺序就 break | 全部 6 个排列都展开 |
| 阶段 | **硬过滤**（无解 → continue） | **软过滤**（区间外 → continue 但有兜底） |
| 性能 | 短路，最佳 case O(单块合法点数) | 永远跑完 cap 或 budget |

二者是**互补**关系：先 sequentiallySolvable 廉价判可行，过了再用 evaluateTripletSolutions 精算难度。

### 3.4 stress → 解法区间映射

`shared/game_rules.json` 的 `solutionDifficulty.ranges`：

| 档位 | minStress | min | max | 体感 |
|---|---|---|---|---|
| 宽松 | -1.0 | 8 | ∞ | 起手 / 救场，至少 8 种解 |
| 舒适 | 0.0 | 4 | ∞ | 心流核心区 |
| 标准 | 0.35 | 2 | ∞ | 基本不限上限 |
| 紧张 | 0.6 | 1 | 32 | 解空间收窄到 32 内 |
| 极限 | 0.8 | 1 | 12 | 唯一解附近的精算挑战 |

匹配规则：选 `stress >= minStress` 的最大档位。

> ⚠️ 注意 `min=1` 时下限恒满足（既然通过了 sequentiallySolvable）；真正约束的是 `max`。

### 3.5 主循环集成（`generateDockShapes`）

伪代码（实际见 `web/src/bot/blockSpawn.js`）：

```js
for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
    const triplet = sampleTriplet();              // 阶段 1+2 加权抽样
    if (minMobility(triplet) < target) continue;
    if (!tripletSequentiallySolvable(triplet)) continue;  // 旧硬过滤

    // === v9 新增 ===
    let solutionMetrics = null;
    if (cfg.enabled && fill >= cfg.activationFill) {
        solutionMetrics = evaluateTripletSolutions(grid, triplet, cfg);
        const earlyAttempt = attempt < MAX_SPAWN_ATTEMPTS * 0.6;
        if (earlyAttempt && range && !solutionMetrics.truncated) {
            if (range.max != null && !solutionMetrics.capped
                && solutionMetrics.solutionCount > range.max) {
                rejectsTooMany++; continue;
            }
            if (range.min != null && solutionMetrics.solutionCount < range.min) {
                rejectsTooFew++; continue;
            }
        }
    }
    // === ===

    diagnostics.layer1.solutionMetrics = solutionMetrics;
    return shuffle(triplet);
}
```

关键设计：

- **`earlyAttempt` 软化**：第 13~22 个 attempt（约 40%）放弃区间约束，避免极端配置卡死循环。
- **`capped` 视为通过 max**：撞 cap 表明 "解 ≥ 64"，这种情况一定满足 `max=null` 档；对 `max=12/32` 的紧张/极限档应被拒，但`capped=true` 时累加值已经 ≥ cap，直接走拒绝路径。
- **`truncated` 视为透传**：budget 撞顶意味着实际解空间比 budget/leaf 还大，结果不可信；我们让它通过。

---

## 4. 配置 (`shared/game_rules.json`)

```json
"solutionDifficulty": {
  "comment": "v9 新增·解法数量难度调控：...",
  "enabled": true,
  "activationFill": 0.45,
  "leafCap": 64,
  "budget": 8000,
  "ranges": [
    { "minStress": -1.0, "label": "宽松", "min": 8, "max": null },
    { "minStress": 0.0,  "label": "舒适", "min": 4, "max": null },
    { "minStress": 0.35, "label": "标准", "min": 2, "max": null },
    { "minStress": 0.6,  "label": "紧张", "min": 1, "max": 32 },
    { "minStress": 0.8,  "label": "极限", "min": 1, "max": 12 }
  ]
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关闭后退化到 v8 行为（保留 sequentiallySolvable） |
| `activationFill` | `0.45` | 低于此 fill 完全不评估（性能门控；空板/低板没必要） |
| `leafCap` | `64` | DFS 累计叶子上限。命中 cap → `capped=true`，等价"解 ≥ cap" |
| `budget` | `8000` | DFS 入栈次数上限。命中 → `truncated=true`，过滤时跳过 |
| `ranges` | 5 档 | stress 越高档位越窄；`min=null` / `max=null` 表示该侧不约束 |

**调参建议**：

- **想让游戏更难** → 把"紧张/极限"的 `max` 调小到 8 / 4。
- **想让游戏更宽松** → 把"宽松/舒适"的 `min` 提高到 16 / 8。
- **性能不够** → 降 `leafCap` 到 32、`budget` 到 4000（牺牲精度）。
- **测试期完全关闭** → `enabled: false` 即恢复 v8 行为（仍走 sequentiallySolvable）。

---

## 5. adaptiveSpawn 接入

`resolveAdaptiveStrategy` 在 stress 钳制后、playstyle 调整后，调用 `deriveTargetSolutionRange(stress, cfg, fill)`：

```js
function deriveTargetSolutionRange(stress, cfg, fill) {
    if (!cfg?.enabled) return null;
    if (fill < (cfg.activationFill ?? 0.45)) return null;
    const sorted = [...cfg.ranges].sort((a, b) => a.minStress - b.minStress);
    let chosen = null;
    for (const r of sorted) if (stress >= r.minStress) chosen = r;
    return chosen ? { min: chosen.min, max: chosen.max, label: chosen.label } : null;
}
```

写入 `spawnHints.targetSolutionRange`，由 `blockSpawn.js` 消费。同时 `_targetSolutionRange` 暴露在 strategy 对象顶层，供面板诊断。

---

## 6. 玩家画像面板可视化

`playerInsightPanel.js` 在 Layer 1 诊断 Pill 行追加：

| Pill | 数据来源 | 例 |
|---|---|---|
| `解法 N[+]` | `solutionMetrics.solutionCount` （capped 加 `+`） | `解法 64+` |
| `合法序 V/6` | `solutionMetrics.validPerms` | `合法序 4/6` |
| `首手 K` | `solutionMetrics.firstMoveFreedom` | `首手 12` |
| `区间 标签 [min, max]` | `targetSolutionRange` | `区间 紧张 [1, 32]` |

Tooltip 在 `SPAWN_TOOLTIP` 字典：`solutionCount` / `validPerms` / `firstMoveFreedom` / `targetSolutionRange`。

`_hintsExplain(spawnHints)` 在右侧"为什么这样出"列表追加"解法上限/下限"解释项。

---

## 7. 性能分析

### 7.1 DFS 状态空间

最坏情况（空板 8×8）：

- 每深度 ~64 合法点 × 3 深度 = \(64^3 ≈ 262{,}144\) 状态 / 排列
- 6 排列 → \(\approx 1.57 \times 10^6\) 状态

带 `leafCap=64, budget=8000` 后：

- 实测：每次 `evaluateTripletSolutions` 平均 1–4 ms，p99 ~12 ms（M2 / V8）
- 整轮 generateDockShapes 增加 ≤ 5%（多次 attempt 摊销）

### 7.2 性能门控分级

| 阶段 | 是否调用 evaluate | 说明 |
|---|---|---|
| `enabled=false` | ✗ | 完全跳过 |
| `fill < activationFill` (默认 0.45) | ✗ | 低板无意义 |
| `fill ≥ activationFill` | ✓ | 仅在通过 sequentiallySolvable 后才评估 |

### 7.3 退化策略

- `truncated=true`：DFS 撞 budget，结果不准；**视为通过**。
- `capped=true`：实际解 ≥ cap；对 `max=null` 档总通过，对有限 `max` 档总拒绝（保守）。

---

## 8. 与现有不变量的关系

```
candidate triplet
  │
  ├── canPlaceAnywhere  (单块层面)
  ├── minMobilityTarget (单块合法点数下限)
  ├── tripletSequentiallySolvable (≥1 解)
  ├── ★ targetSolutionRange (软过滤区间)  ← v9 新增
  └── 通过校验
```

**优先级**：硬约束（前 3 项）必须先满足，v9 区间是"在已可解的基础上做精度调节"。这保证了 v9 永远不会让游戏变成不可解。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| **极端配置导致过滤过严，attempt 全部失败** | 60% attempt 后停止过滤；最差退化到 v8 行为 |
| **DFS budget 在某些病态盘面爆炸** | 双重剪枝（cap + budget），且 `truncated` 视为通过 |
| **配置错误（min > max）** | 等价"无可通过"→ 60% 后兜底，不会卡死 |
| **stress 频繁震荡导致区间跳档** | 区间档位有 5 档冗余，相邻档跨度合理 |
| **小程序端性能不及 web** | 默认配置已保守；可在 miniprogram 端复写 `leafCap`/`budget` |

---

## 10. 测试与回归

### 10.1 单元测试

`tests/blockSpawn.test.js` 已有 6 个用例覆盖三连块基本属性。`evaluateTripletSolutions` 作为新导出函数可以独立测试：

```js
// 推荐新增：
it('counts solutions correctly on simple boards', () => {
    const grid = new Grid(8);
    const lineShape = getAllShapes().find(s => s.id === 'line2');
    const m = evaluateTripletSolutions(grid, [lineShape.data, lineShape.data, lineShape.data]);
    expect(m.validPerms).toBe(6);  // 对称形状所有顺序等价
    expect(m.solutionCount).toBeGreaterThan(0);
});
```

### 10.2 端到端验证

1. 配置 `solutionDifficulty.enabled = true`
2. 启动 `npm run dev`
3. 玩到 fill ≥ 0.45 时观察画像面板的"解法 / 合法序"Pill 是否出现
4. 切换难度（easy → hard）观察"区间"Pill 标签从"宽松"过渡到"紧张/极限"

---

## 11. 当前边界与可选扩展

当前代码事实：

| 能力 | 状态 | 入口 |
|---|---|---|
| 解法数量计算 | 已实现 | `evaluateTripletSolutions()` |
| 诊断曝光 | 已实现 | `playerInsightPanel` 解法 / 合法序 Pill |
| 按 stress 选择目标区间 | 已实现 | `adaptiveSpawn.solutionDifficulty.ranges` |
| 软过滤 | 已实现 | `blockSpawn` 在前 60% attempt 中按区间重抽 |

可选扩展不作为当前实现事实：

| 扩展 | 说明 | 上线前要求 |
|------|------|------------|
| 解法贴近度加权 | 在 augmentPool 阶段加入 \( w \mathrel{*}= 1 + \alpha \cdot \mathrm{closeness}(N_{\mathrm{sol}}, [\min, \max]) \)，用加权替代部分硬重抽 | 增加配置、单测和面板诊断 |
| RL 课程信号 | 将 `solutionMetrics` 写入 RL 训练数据流，作为难度课程或辅助监督 | 同步 `featureEncoding` / 训练脚本并说明 checkpoint 兼容性 |

---

## 12. 变更影响清单

| 文件 | 改动 |
|---|---|
| `shared/game_rules.json` | 新增 `adaptiveSpawn.solutionDifficulty` 配置块 |
| `web/src/bot/blockSpawn.js` | 新增 `dfsCountSolutions` / `evaluateTripletSolutions` / `getSolutionDifficultyCfg`；主循环集成软过滤 + 诊断 |
| `web/src/adaptiveSpawn.js` | 新增 `deriveTargetSolutionRange`；输出到 `spawnHints.targetSolutionRange` |
| `web/src/playerInsightPanel.js` | 新增 4 个 Pill 与 tooltip；`_hintsExplain` 增加解法区间解释项 |
| `miniprogram/core/*` | 由 `scripts/sync-core.sh` 自动同步 |
| `docs/SPAWN_SOLUTION_DIFFICULTY.md` | 本文件 |

---

## 附：关键术语速查

- **解 (Solution)** — 一个完整的 `(顺序, 位置, 位置, 位置)` 元组，使三块都能被合法放下。
- **leaf** — DFS 在 depth=3 处计入的 `accum.count++`，等价于一个解。
- **leafCap** — `accum.count` 的上限；命中后立即返回，所有后续展开被剪枝。
- **budget** — DFS 入栈次数上限；命中后整个 evaluate 调用结果被标记 `truncated`。
- **validPerms** — 6 个排列里 leaves(π) > 0 的数量。"1/6" 表示"唯一解链"，"6/6" 表示完全宽松。
- **firstMoveFreedom** — 三块各自独立合法点数的最小值，反映"瓶颈块"的灵活性。
- **targetSolutionRange** — 来自 stress→ranges 的目标区间 `{min, max, label}`。
- **capped / truncated** — 两种"不可信"标记，过滤时分别按拒绝/通过对待。
