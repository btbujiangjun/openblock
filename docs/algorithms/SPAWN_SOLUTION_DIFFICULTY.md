# 出块算法：解法数量难度调控（v9 → v1.32）

> 版本: v1.32（v9 基础上增「顺序刚性 orderRigor」） | 更新: 2026-05-09
> 关联：`SPAWN_ALGORITHM.md` §4「Layer 1 / 反死局」、`ADAPTIVE_SPAWN.md` §3「stress → spawnHints」、`EXPERIENCE_DESIGN_FOUNDATIONS.md` §A.7（Yerkes-Dodson 上限）
> 代码位置：`web/src/bot/blockSpawn.js`、`web/src/adaptiveSpawn.js`、`shared/game_rules.json`、`web/src/playerInsightPanel.js`

> **v9 → v1.32 增量提示**：v9 已经计算出 `validPerms ∈ [0,6]`（6 种排列里有几种全可解），但此前只把 `solutionCount` 作为软过滤维度。v1.32 把 `validPerms` 作为**第二个**软过滤维度启用，构成"**顺序刚性 (orderRigor)**"高难度算法 —— 当玩家高压且具备承受力时，要求三连块**必须按特定顺序**才能放下（默认 `validPerms ≤ 2`）。详见本文 §13。

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
- **orderRigor**（v1.32）— 0~1 标量，表征"三块必须按特定顺序放下"的严苛程度。
- **orderMaxValidPerms**（v1.32）— 1~6 整数硬上限，blockSpawn 直接消费；`validPerms > maxAllowed` 的 triplet 在早期 attempt 被拒绝。

---

## 13. v1.32 升级：顺序刚性 (orderRigor) — 高难度算法

### 13.1 动机：从"空间难度"到"时序难度"

v9 的 `solutionCount` 区间过滤解决了「解空间体量」难度连续可调，但仍然只调控**总解数**这一**位置层**指标。在玩家**高压 + 高承受力**时，传统加压手段（更大块、更碎形状、`spatialPressure` 推高）会触顶 —— 再加只会让玩家挫败。

**关键观察**：`evaluateTripletSolutions` 已经返回 `validPerms ∈ [0, 6]`（6 种全排列里有几种"全可解"），但 v9 没消费它。这个指标天然反映"**顺序自由度**"：

| `validPerms` | 含义 | 玩家体感 |
|---|---|---|
| 6 | 任何顺序都行 | 完全无顺序压力 |
| 4–5 | 大多数顺序行 | 偶尔需注意 |
| 3 | 大致一半 | 需要简单规划 |
| **2** | **必须挑特定顺序** | **强制前瞻规划**（v1.32 默认目标） |
| 1 | 唯一序列 | 烧脑模式 |
| 0 | 无解（已被 sequentiallySolvable 拦截） | — |

**v1.32 设计**：把 `validPerms` 作为**第二个软过滤维度**启用，与 `solutionCount` 正交：

| 维度 | 调控对象 | 体感 |
|---|---|---|
| `solutionCount` 区间（v9） | 总解空间体量 | "解多/少" |
| **`validPerms` 上限（v1.32）** | **顺序自由度** | **"是否需要按特定顺序"** |

### 13.2 派生公式 — `adaptiveSpawn.js`

```js
let orderRigor = 0;
let orderMaxValidPerms = 6;
{
    const enabled       = topoCfg.orderRigorEnabled !== false;
    const threshold     = topoCfg.orderRigorStressThreshold ?? 0.55;
    const orderScale    = topoCfg.orderRigorScale            ?? 1.6;
    const skillScale    = topoCfg.orderRigorSkillScale       ?? 0.20;
    const tight         = topoCfg.orderRigorMaxPermsTight    ?? 2;   // rigor=1 时的上限
    const loose         = topoCfg.orderRigorMaxPermsLoose    ?? 4;   // rigor=0 时的上限
    const activFill     = topoCfg.orderRigorActivationFill   ?? 0.50;
    const maxHolesAllow = topoCfg.orderRigorMaxHolesAllow    ?? 3;
    const modeBoost     = difficultyTuning.orderRigorBoost   ?? 0;   // hard=0.30

    const bypass = !enabled
        || inOnboarding                       // 1) 新手保护
        || profile.needsRecovery === true     // 2) 救场期
        || hasBottleneckSignal                // 3) bottleneckRelief 已触发
        || holes > maxHolesAllow              // 4) 盘面空洞过多
        || boardFill < activFill;             // 5) 空盘强制顺序无意义

    if (!bypass) {
        const stressTerm = Math.max(0, stress - threshold) * orderScale;
        const skillTerm  = Math.max(0, skill  - 0.5)       * skillScale;
        orderRigor       = clamp01(stressTerm + skillTerm + modeBoost);
        orderMaxValidPerms = round(loose - (loose - tight) * orderRigor);
        // clamp to [tight, loose]
    }
}
```

**示例**：

| 场景 | mode | stress | skill | rigor | maxValidPerms | 体感 |
|---|---|---|---|---|---|---|
| 新手第 1 局，高压 | normal | 0.80 | 0.50 | **0.00** (bypass) | **6** | 完全不约束 |
| 中级玩家心流 | normal | 0.50 | 0.65 | 0.03 | 4 | 微感 |
| 高级玩家高压 | normal | 0.75 | 0.80 | **0.38** | 3 | 偶发顺序压力 |
| 同上 + Hard | hard | 0.80 | 0.80 | **0.86** | **2** | 强制前瞻规划 |
| 玩家被困（trough=0） | hard | 0.78 | 0.80 | **0.00** (bypass) | **6** | 减压期不刁难 |

### 13.3 五重 bypass 的物理依据

| Bypass | 原因 | 心理学依据 |
|---|---|---|
| `inOnboarding` | 新手最多 25 局，强制顺序属于"过早爆发难度" | Self-Determination Theory · Competence 阈值 |
| `needsRecovery` | 玩家正被救场，再加约束 = 救场失败 | Yerkes-Dodson 下行段 |
| `hasBottleneckSignal` | bottleneckRelief 已减压，再加 rigor 等于双重打击 | 信号互抑（避免叠加越档） |
| `holes > 3` | 盘面修复都难，再加顺序 = 不公平 | Fairness perception |
| `boardFill < 0.5` | 空盘上"validPerms=2 vs 6"差异不可感知 | 与 `activationFill` 同源 |

### 13.4 主循环集成 — `blockSpawn.js`

接在 v9 的 `solutionCount` 区间过滤之后：

```js
/* v9：solutionCount 区间过滤 */
if (range && !truncated && (sc > range.max || sc < range.min)) continue;

/* v1.32：validPerms 上限过滤 */
const orderEarly = attempt < MAX_SPAWN_ATTEMPTS * SOLUTION_FILTER_ATTEMPT_RATIO * 0.92;
if (orderEarly
    && !solutionMetrics.truncated
    && orderMaxValidPerms < 6
    && solutionMetrics.validPerms > orderMaxValidPerms) {
    diagnostics.solutionRejects.orderTooLoose++;
    diagnostics.orderRigor.applied = true;
    continue;
}
```

设计要点：

- **早期窗口稍紧（55% vs solutionCount 的 60%）**：dock 候选稀缺时不死撑，避免连锁卡死。
- **truncated 视为通过**：与 v9 同口径（结果不可信）。
- **validPerms=0 不会进入**：上方 `tripletSequentiallySolvable` 已先剔除"6 种顺序均不可解"的情况。
- **fallback 兜底**：若早期窗口未能找到 `validPerms ≤ N` 的 triplet，后期 attempt 接受任意 triplet（保证 dock 永远填满）。

### 13.5 配置 — `shared/game_rules.json`

```json
"topologyDifficulty": {
  "orderRigorEnabled": true,
  "orderRigorStressThreshold": 0.55,
  "orderRigorScale": 1.6,
  "orderRigorSkillScale": 0.20,
  "orderRigorMaxPermsTight": 2,
  "orderRigorMaxPermsLoose": 4,
  "orderRigorActivationFill": 0.50,
  "orderRigorMaxHolesAllow": 3
},
"difficultyTuning": {
  "easy":   { "orderRigorBoost": 0.00 },
  "normal": { "orderRigorBoost": 0.00 },
  "hard":   { "orderRigorBoost": 0.30 }
}
```

| 调参方向 | 操作 |
|---|---|
| 让 Hard 模式更狠 | `orderRigorBoost: 0.45` 或 `orderRigorMaxPermsTight: 1` |
| 让 Normal 偶发出现顺序压力 | `orderRigorStressThreshold: 0.50`（更早激活） |
| 完全关闭 v1.32 | `orderRigorEnabled: false` |
| 防止过严卡死 | `orderRigorMaxPermsLoose` 提到 5、`orderRigorMaxHolesAllow` 提到 5 |

### 13.6 与既有信号的互抑矩阵

| 同时触发 | 处理 |
|---|---|
| `orderRigor` + `bottleneckRelief` | **bypass**：bottleneckRelief 优先，orderRigor 直接归 0（避免双重打击） |
| `orderRigor` + `B 类挑战 challengeBoost` | **正交叠加**：challengeBoost 已经把 stress 推高 → orderRigor 自然加强（无需额外处理） |
| `orderRigor` + `solutionCount` 紧张档 | **同向加强**：两者都会拒绝过宽的 triplet，但用不同维度正交，可同时生效 |
| `orderRigor` + `friendlyBoardRelief` | 不互抑：friendlyBoardRelief 减压会让 stress 降到阈值以下，自然让 orderRigor=0 |
| `orderRigor` + `flowPayoffCap` | 极少同时：flowPayoffCap 把 stress 软封顶到 0.79，仍可能触发 orderRigor，但效果柔和 |

### 13.7 性能影响

`evaluateTripletSolutions` 已经在计算 `validPerms`（v9 就有），v1.32 只是**消费**它，**不增加任何 DFS 开销**。唯一新增是：

- `adaptiveSpawn.js` 中 ~20 行派生逻辑（O(1)）
- `blockSpawn.js` 中 1 个比较 + 计数器（O(1) per attempt）

整体性能影响：**< 0.1%**。

### 13.8 测试覆盖

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `tests/adaptiveSpawn.test.js` | 7 个 v1.32 用例 | 默认/高压/Hard 加成/Onboarding bypass/Bottleneck bypass/Holes bypass/低 fill bypass |
| `tests/blockSpawn.test.js` | 3 个 v1.32 用例 | 过滤器触发（rejTotal>0）/不触发（rejTotal=0）/旧调用方默认值 |

### 13.9 玩家面板曝光（建议后续工作）

当前 `playerInsightPanel.js` 的 4 个 Pill（解法 / 合法序 / 首手 / 区间）已经包含 `合法序 V/6`，可直接看到 `validPerms`。建议后续追加：

| Pill | 数据来源 | 例 |
|---|---|---|
| `顺序刚性 R` | `_orderRigor`（0~1） | `顺序刚性 0.78` |
| `序贯上限 ≤N` | `_orderMaxValidPerms` | `序贯上限 ≤2` |
| 触发标签 | `diagnostics.orderRigor.applied` | `🧩 强制顺序` |

并在 stressMeter 的"为什么"列表追加："因为 stress 高 + 技能足够，本拍要求三块按特定顺序放置"。

### 13.10 与 EXPERIENCE_DESIGN_FOUNDATIONS 的对应

`EXPERIENCE_DESIGN_FOUNDATIONS.md` 5 轴体验结构里：

- **挑战-能力轴 (C)**：v1.32 在 `boardPressure / skillLevel ≈ 1` 但已经触顶时，把压力从"操作精度"切到"前瞻规划"，把单局难度天花板**纵向延伸**了一档
- **节奏-报偿轴 (R)**：rigor 高时玩家会有"先想清楚再下"的停顿（thinkMs 上升），打断纯反应式快节奏，**主动制造规划停顿** → 兑现时的多消爽点更强
- **情感-共鸣轴 (E)**：成功按对顺序 = "解谜爽点"（Variable Ratio Reward 的认知版本），与"消行爽点"形成情感对位

---

## 14. v9 → v1.32 变更清单

| 文件 | v9 改动 | v1.32 改动 |
|---|---|---|
| `shared/game_rules.json` | 新增 `solutionDifficulty` 配置块 | `topologyDifficulty.orderRigor*` 8 项 + `difficultyTuning.{easy,normal,hard}.orderRigorBoost` |
| `web/src/bot/blockSpawn.js` | `evaluateTripletSolutions` + `solutionCount` 软过滤 | `hints.orderRigor`/`orderMaxValidPerms` 消费 + `validPerms` 软过滤 + `solutionRejects.orderTooLoose` + `diagnostics.orderRigor` |
| `web/src/adaptiveSpawn.js` | `deriveTargetSolutionRange` | `orderRigor` / `orderMaxValidPerms` 派生 + 写入 `spawnHints` 与顶层 `_orderRigor` / `_orderMaxValidPerms` |
| `web/src/stressMeter.js` | — | `SIGNAL_LABELS.orderRigor` + `summarizeContributors` skip 列表 |
| `tests/adaptiveSpawn.test.js` | — | 7 个 v1.32 用例 |
| `tests/blockSpawn.test.js` | — | 3 个 v1.32 用例 |
| `docs/algorithms/SPAWN_SOLUTION_DIFFICULTY.md` | — | §13 + §14（本文） |
