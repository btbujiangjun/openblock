# 休闲游戏品类分析与系统研究

> 日期：2026-04-08 | 最后更新：2026-04-20 | 范围：玩家能力评价、心流/挫败状态、游戏策略建模、个性化推荐、2025-2026 行业数据  
> **方法论上溯**：本文是「**行业事实与系统映射**」清单；如需把这些事实串成顶层体验设计逻辑（心理学根基 + 设计理念 + OpenBlock 5 轴体验结构 + 设计审查清单），请阅读 [体验设计基石](../player/EXPERIENCE_DESIGN_FOUNDATIONS.md)。

---

## 第一部分 — 行业知识综述

### 1 玩家能力评价模型

| 模型 | 核心思想 | 适用场景 |
|------|----------|----------|
| **Elo / Glicko / TrueSkill** | 基于对局胜负的贝叶斯评分系统，每局结果更新 μ±σ | PvP 竞技；不适合单人休闲 |
| **Performance Metrics** | 直接采集操作指标（通关速度、失误率、消行率、APM）作为能力代理 | 单人休闲/益智（本项目采用） |
| **EDDA（Engagement-oriented DDA）** | 以"玩家在挑战单元的停留时间"度量流失倾向，反推能力 | Match-3 / Block Puzzle |
| **深度玩家行为建模（DPBM）** | 用 DNN 对行为序列建模，比启发式更细腻但需要大量数据 | 大型手游、需后端 |
| **综合加权评分** | 多维指标（思考时长、消行率、Combo率、失误率、认知负荷）加权 → 单一 skillLevel | 适合本项目量级 |

**业界最佳实践**：休闲游戏中最常见的做法是 **Performance Metrics + 滑动窗口 + 指数平滑**，因为：
- 无对手、无胜负，Elo 体系不适用
- 滑窗保证「近因效应」，玩家近期状态权重更高
- 指数平滑抑制噪声

---

### 2 玩家实时状态定义

#### 2.1 心流模型（Csikszentmihalyi, 1990; Jenova Chen, 2007）

核心公式：**心流偏移度 F(t) = |C(t)/P(t) − 1|**

- F(t) < 0.15 → **Flow**（沉浸）
- 0.15 ≤ F(t) < 0.35 → **Tension**（紧张但可控）
- F(t) ≥ 0.35 且 C > P → **Anxiety**（焦虑）
- F(t) ≥ 0.35 且 C < P → **Boredom**（无聊）

在休闲方块游戏中，C(t) 的代理变量包括：
- 棋盘填充率、孔洞数、可消行距离
- 候选块复杂度 / 摆放难度

P(t) 的代理变量即上文的 **skillLevel**。

#### 2.2 挫败感（Frustration）

| 信号 | 含义 |
|------|------|
| **连续未消行步数** | 超过阈值说明「卡住」，需要投放救济 |
| **Near-miss 检测** | 填充率 > 0.6 但未消行 → 玩家「差一点就消掉」，near-miss 效应可提升留存 |
| **Recovery 状态** | 高填充后的「恢复期」，应降低出块难度 |

#### 2.3 节奏（Pacing）

波浪式节奏设计（难→易→难→易）：
- **Tension Phase**：加压，出块偏向大块 / 异形
- **Release Phase**：减压，出块偏向小块 / 长条
- 周期长度 = `cycleLength`（如 8 轮为一个周期）

#### 2.4 会话阶段

| 阶段 | 时间特征 | 设计意图 |
|------|----------|----------|
| **early** | 前 2 轮或开局 30s 内 | 降低门槛，新手友好 |
| **peak** | 30s ~ 300s | 心流区，维持最佳挑战 |
| **late** | > 300s | 允许适度放松，防止疲劳 |

---

### 3 游戏状态定义

对于 Block Puzzle 类游戏，**游戏状态** 需要同时刻画「局面难度」和「进展」：

| 维度 | 指标 | 含义 |
|------|------|------|
| **空间占用** | fillRatio, holes, maxHeight | 棋盘压力 |
| **结构质量** | row_transitions, col_transitions, well_depth | 棋面「糟糕程度」 |
| **消行潜力** | lines_clearable_1, lines_clearable_2 | 接近满行的数量 |
| **机动性** | dock_mobility, post_mobility | 剩余候选块可放置位置数 |
| **得分 / 连续性** | score, streak, combo | 进展与连击 |

---

### 4 游戏策略建模

#### 4.1 自适应出块策略

目标：根据玩家实时状态，动态调整 **候选块形状分布** 和 **辅助 Hints**，使体验落在心流通道。

建模步骤：
1. **计算 stress（综合压力）**：聚合 score_stress + skill_adjust + flow_adjust + pacing + recovery + frustration_relief + combo + near_miss
2. **查表插值 shapeWeights**：在 profiles 十档之间线性插值
3. **生成 spawnHints**：clearGuarantee, sizePreference, diversityBoost

#### 4.2 启发式策略推荐（Hint Engine）

| 维度 | 权重 | 说明 |
|------|------|------|
| **消行（clear）** | 50 | 最重要 — 直接得分 |
| **存活（survival）** | 25 | DFS 验证剩余块能否放下 |
| **缺口填补（gapFill）** | 8 | 减少孔洞 |
| **机动性（mobility）** | 3 | 保持未来选择空间 |
| **紧凑度（compact）** | 1.5 | 重心偏低、居中 |
| **填充惩罚（fillPenalty）** | -30 | 高填充率时强力惩罚 |

---

### 5 策略个性化推荐

| 方法论 | 描述 | 在本项目中的对应 |
|--------|------|------------------|
| **玩家分群（Segmentation）** | Bartle 四类型或 K-Means 聚类 | ✅ 已实现 Whale/Dolphin/Minnow 三级分群（`monetization_backend.py`，基于最高分×0.4 + 总局数×0.3 + 时长×0.3） |
| **自我决定论（SDT）** | 自主性、胜任感、归属感 | 出块策略让玩家保持「胜任感」，difficulty选择提供「自主性」 |
| **协同过滤** | 基于相似玩家推荐关卡/道具 | 本项目为单人、无关卡系统，暂无需求 |
| **实时个性化参数** | 基于实时画像动态调参 | 正是 `adaptiveSpawn` 做的事 |

---

## 第二部分 — 本项目分析

### 6 当前实现评估

#### 6.1 玩家能力评价（playerProfile.js）

**优点：**
- ✅ 五维加权评分（think, clear, combo, miss, load），维度全面
- ✅ 双速率指数平滑（前5步快收敛 α=0.35，之后 α=0.15），对新手友好
- ✅ 24h 衰减机制，防止长期不玩导致技能评估过时
- ✅ 滑窗 = 15，既有统计显著性又保持近因效应

**改进方向：**
- ⚠️ **权重固定**：五维权重 [0.15, 0.30, 0.20, 0.20, 0.15] 硬编码，未随 difficulty 或 sessionPhase 动态调整。业界推荐在「新手期」增大 missScore 权重（容错），「后期」增大 comboScore 权重（挑战感）
- ⚠️ **thinkMs 上界偏高**：60s 上界太大，对于 Block Puzzle 的典型思考时间 1~10s，超过 15s 可能表示 AFK 而非思考，建议 AFK 检测后排除
- ⚠️ **momentum 计算**：简单的窗口前后半 clearRate 差，对短窗口 (15) 噪声较大；可考虑加权移动平均或线性回归斜率
- ⚠️ **缺少历史趋势**：没有跨局技能趋势（如本周 vs 上周），难以做长线个性化

#### 6.2 心流状态检测

**优点：**
- ✅ 三态模型（bored / flow / anxious）与经典心流理论对齐
- ✅ 综合考虑 pacing、frustration、near-miss、recovery 多信号
- ✅ sessionPhase 区分了热身期、巅峰期、后期

**改进方向：**
- ⚠️ **flowState 阈值 JSON 化但未充分利用**：`flowZone.clearRateIdeal/clearRateTolerance` 定义了但代码中未使用
- ⚠️ **缺少生理/行为模拟**：无法像 EDDA 那样用「停留时间」检测流失倾向；可以增加「单局放弃率」和「关闭前最后操作间隔」作为代理
- ⚠️ **连续未消行数（frustrationLevel）过于粗粒度**：可以叠加「连续失误类型」（如反复放同一种块失败）提供更精准的挫败检测

#### 6.3 自适应出块策略（adaptiveSpawn.js）

**优点：**
- ✅ **stress 公式多信号融合**：7+ 个维度参与，覆盖全面
- ✅ **十档 profile 线性插值**：比硬切换平滑
- ✅ **spawnHints 机制**：为底层出块生成器提供软约束（clearGuarantee 等），不暴力干预
- ✅ **新手保护 + 连战奖励**：onboarding 封顶 stress，连战叠加 stressBonus

**改进方向：**
- ⚠️ **无 A/B 实验框架**：参数调优只能靠手动观察面板，建议增加 **自动化 A/B 分桶 + 留存指标回收**
- ⚠️ **pacing 周期固定**：`cycleLength` 对所有玩家统一，未根据 APM / sessionPhase 自适应调整周期
- ⚠️ **shapeWeights 仅控制形状分布**：未涉及「颜色搭配」「方向旋转」等额外维度
- ⚠️ **stress → experience 映射单向**：只有 stress → 出块，缺少反馈闭环（如出块后观察玩家是否真的进入 flow，再修正模型）

#### 6.4 Hint Engine（hintEngine.js）

**优点：**
- ✅ 六维评分 + DFS 存活验证，实用性强
- ✅ 权重配置清晰，易调优

**改进方向：**
- ⚠️ **权重固定**：不随 stress / skillLevel 变化；对新手应加大 survival 权重，对高手应加大 clear 权重
- ⚠️ **计算成本**：DFS 存活检查在高填充率时可能耗时较长，需加剪枝或 budget 限制
- ⚠️ **缺少「连续手」考量**：只评估单步最优，不考虑两步联动（如「先放这块铺路、下一步再消行」）

#### 6.5 RL 模型与特征工程

**优点：**
- ✅ 23 维状态标量 + 64 维棋盘 + 75 维 dock = 162 维状态，信息丰富
- ✅ 11 维动作特征含 delta_holes / delta_transitions / post_mobility，关注动作后果
- ✅ CNN 残差 + dock MLP + 3 层 value head 架构合理

**改进方向：**
- ⚠️ **3 个候选块未编码为有序集合**：当前将 dock 展平为 75 维掩码，丢失了「哪个块已放置」的状态
- ⚠️ **没有 attention 机制**：候选块之间的组合关系（如「这两块一起可消两行」）无法被 MLP 直接捕捉
- ⚠️ **奖励塑形 holePenaltyPerCell = -0.08**：对长期策略可能过弱（模型倾向先消行不管孔洞）

---

### 7 与业界最佳实践的 Gap 分析

| 维度 | 业界标准 | 本项目现状 | Gap | 优先级 |
|------|----------|------------|-----|--------|
| 玩家能力评估 | 多维加权 + 指数平滑 | ✅ 已实现 | — | — |
| 心流检测 | F(t) = \|C/P − 1\| 的量化模型 | ⚠️ 有三态但未量化 F(t) | 中 | P1 |
| 挫败感管理 | 多信号融合 + 实时干预 | ✅ frustration + near-miss + recovery | 小 | — |
| DDA 出块 | stress 多维融合 + 插值 | ✅ 七信号 + 十档插值 | — | — |
| 节奏控制 | 自适应周期 | ⚠️ 固定 cycleLength | 中 | P2 |
| Hint 系统 | 多步前瞻 + 个性化权重 | ⚠️ 单步 + 固定权重 | 中 | P2 |
| 闭环反馈 | 出块后验证效果 → 修正模型 | ❌ 无 | 大 | P1 |
| 跨局趋势 | 周/月维度技能趋势 | ❌ 仅当前局/24h衰减 | 中 | P2 |
| 玩家分群 | K-Means / Bartle 显式分群 | ✅ 已实现（Whale/Dolphin/Minnow） | 小 | ✅ |
| A/B 测试 | 自动分桶 + 指标回收 | ❌ 无 | 大 | P1 |

---

### 8 优化路线图

#### P0（已做好）
- [x] 五维技能评估 + 双速率平滑
- [x] 三态心流 + 多维 stress 自适应出块
- [x] 六维启发式 Hint
- [x] RL 特征 162 → 173 + CNN 残差架构

#### P1（建议优先实施）

| # | 改进项 | 预期收益 | 工作量 |
|---|--------|----------|--------|
| 1 | **闭环反馈**：出块后 3~5 步内检测玩家是否消行 / 进入 flow → 微调 stress 偏移 | 自适应精度↑ | 中 |
| 2 | **量化心流偏移 F(t)**：用 `boardPressure / skillLevel` 量化 → 替代三态硬分类 | 更精细的 DDA | 小 |
| 3 | **AFK 检测**：thinkMs > 15s 且无操作事件 → 标记为 AFK，排除出 metrics | 技能评估准确度↑ | 小 |

#### P2（中期迭代）

| # | 改进项 | 预期收益 |
|---|--------|----------|
| 4 | **自适应 pacing 周期**：cycleLength 随 APM / sessionPhase 伸缩 | 节奏更个性化 |
| 5 | **Hint 权重个性化**：新手加大 survival，高手加大 clear | 推荐更贴合能力 |
| 6 | **两步联动评估**：Hint 考虑「放块 A → 再放块 B → 消行」的组合 | 推荐质量↑ |
| 7 | **跨局技能趋势**：记录每局结束时 skillLevel → localStorage，面板展示周趋势 | 成长可视化 |

#### P3（长线规划）

| # | 改进项 |
|---|--------|
| 8 | 显式玩家分群（已实现：Whale/Dolphin/Minnow，基于 whale_score 加权计算，见 `monetization_backend.py`） |
| 9 | A/B 分桶框架 + 留存/时长指标自动回收 |
| 10 | RL 模型增加 attention on dock slots |

---

### 9 数据流全景图

```
                     ┌──────────────────────────────────┐
                     │          playerProfile.js         │
                     │   metrics → skillLevel → flowState│
                     │   momentum, frustration, pacing   │
                     └──────────┬───────────────────────┘
                                │
              ┌─────────────────▼────────────────────┐
              │          adaptiveSpawn.js             │
              │  stress = Σ(skill + flow + pacing     │
              │           + recovery + combo + ...)   │
              │  shapeWeights = interpolate(profiles) │
              │  spawnHints = {clear, size, diversity} │
              └──┬──────────────────────────────┬────┘
                 │                              │
     ┌───────────▼──────┐         ┌─────────────▼──────────┐
     │  blockSpawn.js   │         │ playerInsightPanel.js   │
     │  按 weights 抽形  │         │  展示画像 + 策略解释     │
     │  → 候选 dock     │         │  Hint 交互 + 预览       │
     └──────────────────┘         └────────────────────────┘
                 │
     ┌───────────▼──────┐         ┌────────────────────────┐
     │    game.js       │         │    hintEngine.js       │
     │  recordPlace →   │────────▶│  6维评分 Top-N 建议     │
     │  recordMiss →    │         └────────────────────────┘
     │  → profile 更新  │
     └──────────────────┘
                 │
     ┌───────────▼──────────────────────────────┐
     │           RL Training Pipeline           │
     │  features.py → simulator.py → model.py  │
     │  → train.py (PPO)                        │
     │  162-dim state + 11-dim action → policy  │
     └──────────────────────────────────────────┘
```

---

---

## 第二部分 — 2025-2026 行业最新研究与数据

### 10 消块品类竞争格局与市场数据

#### 10.1 Block Blast! 的成功解构

Block Blast!（Hungry Studio）是 2025 年消块品类的标杆，其核心竞争力：

| 维度 | 做法 | 效果 |
|------|------|------|
| **DDA 系统** | AI 实时检测挫败 → 推送能填入的形状 | D60 留存 19%（超大多数游戏 D7） |
| **A/B 测试** | 50 个测试/周，3000+ 测试积累 | 每个版本均经过验证的最优化 |
| **AI 模拟先行** | 先用 AI 模拟玩家筛选方案，再升级到真人测试 | 减少无效迭代成本 |
| **内容简洁** | 核心循环极致简单，不添加复杂规则 | 低流失，高 D1 留存 |

#### 10.2 第二代消块游戏：静态关卡

Rollic Games 引领第二代消块游戏（Color Block Jam，2025）：

```
核心差异：不是随机出块，而是预设关卡
  每关卡包含：预设棋盘初始状态 + 明确通关目标 + 限制可用块集
  难度控制：关卡设计师直接编辑，精确到每个障碍物
  变现锚点：在特定"壁垒关"（Level 20/50/100）设置精确的付费墙
```

Open Block 现状对比：
- 已有无尽模式（DDA 驱动）≈ 第一代最优实现
- 尚无静态关卡系统 ≈ 缺少第二代核心竞争力
- 已有复活系统（ReviveManager）≈ 关键变现锚点已落地

#### 10.3 行业留存基准（2025-2026 Sensor Tower / Adjust 数据）

```
┌──────────────────────────────────────────────────────────┐
│  移动游戏留存率基准（2025 数据，Adjust & Sensor Tower）  │
├──────────────────┬────────┬────────┬────────┬────────────┤
│  指标            │ D1     │ D7     │ D30    │ 备注       │
├──────────────────┼────────┼────────┼────────┼────────────┤
│  全品类均值      │ 27%    │ -      │ -      │            │
│  休闲（下滑）    │ <27%   │ 下滑   │ 下滑   │ 2022-2025  │
│  混合休闲        │ >27%   │ 改善中 │ -      │            │
│  Top 四分位标准  │ 40%+   │ 20%+   │ 10%+   │ 行业目标   │
│  Block Blast D60 │ -      │ -      │ -      │ 19%（超越）│
└──────────────────┴────────┴────────┴────────┴────────────┘
```

#### 10.4 进度驱动商业化（2025 新范式）

研究数据（Airflux 2025）：广告容忍度与投入深度强相关。

```
新玩家（关卡 1-5）     ← 180+ 秒广告间隔才合适
投入玩家（关卡 6-15）  ← 60-90 秒可接受
深度玩家（关卡 16+）   ← 30 秒也可接受
                        容忍度差距：6 倍
```

实施效果：
- 广告收入/用户 **+43%**
- D7 留存 **+18%**（少了早期广告骚扰）

### 11 方块益智游戏 RL 最新学术进展（2025）

#### 11.1 Tetris Block Puzzle 难度量化（arXiv:2603.18994）

用 SGAZ（Stochastic Gumbel AlphaZero）评估游戏难度：

| 规则变体 | 难度影响 | 结论 |
|---------|---------|------|
| 增加 hold 块数 | 显著降低难度 | hold=3 比 hold=0 训练收益高 2x |
| 增加 preview 数 | 轻微降低难度 | 预览下一块帮助规划 |
| 添加 T-五联骨牌 | 显著增加难度 | 训练收益降低 40%+ |

**意义**：首次为方块类益智游戏提供**可量化的 AI 难度基准**，为关卡设计者提供理论工具。

#### 11.2 PCGRL 关卡生成（Linköping 2025）

**Solution-down PCGRL**：先设计解法路径，再反向构建关卡，保证 100% 可解且难度可控。

相比传统 PCG（生成后筛选），SDPCGRL：
- 无效关卡比例大幅降低
- 结合难度预测器，生成目标难度档的关卡
- 难度预测器用真实玩家数据训练（尝试次数作为标签）

**Open Block 路线**：SpawnTransformerV2 的玩家行为数据可训练难度预测器。

#### 11.3 AlphaZeroES 单人环境优化（AAMAS 2025）

发现：在单人谜题（Sokoban、2048、TSP）中，直接最大化 Episode 得分比标准 AlphaZero 规划损失更有效。

原因分析：
```
AlphaZero 原始训练目标：最小化 MCTS 访问分布的 KL 散度
AlphaZeroES 训练目标：  直接最大化 Episode 总得分

单人优化 vs 博弈：没有对手需要"反制"，Episode 得分更直接反映目标
```

对 Open Block 的启示：Open Block RL 是单人优化，值得尝试 ES 微调替代 PPO Loss。

---

## 参考文献

1. Csikszentmihalyi, M. (1990). *Flow: The Psychology of Optimal Experience*
2. Chen, J. (2007). *Flow in Games* — thatgamecompany
3. Bartle, R. (1996). *Hearts, Clubs, Diamonds, Spades: Players Who Suit MUDs*
4. Hunicke, R. (2005). *The Case for Dynamic Difficulty Adjustment in Games*
5. Ryan, R.M. & Deci, E.L. (2000). *Self-Determination Theory and the Facilitation of Intrinsic Motivation*
6. Engagement-Oriented DDA, MDPI Applied Sciences 15(10), 2025
7. WWW 2017 — *Dynamic Difficulty Adjustment for Maximized Engagement in Digital Games*
8. arXiv:2603.18994 (2025) — *Evaluating Game Difficulty in Tetris Block Puzzle*（SGAZ）
9. Johansson, E. (2025) — *Solution-down PCGRL for hyper-casual puzzle games*（Linköping）
10. AAMAS 2025 — *AlphaZeroES: Direct Score Maximization Outperforms Planning Loss*
11. arXiv:2504.14636 (2025) — *AlphaZero-Edu: Democratizing Access to AlphaZero*
12. arXiv:2504.07757 (2025) — *Search-contempt: a hybrid MCTS algorithm*
13. Sensor Tower (2026) — *State of Gaming 2026*
14. Adjust (2026) — *Gaming App Insights Report 2026*
15. Airflux (2025) — *Progression-Based Mobile Game Monetization*
16. Deconstructor of Fun (2026) — *The Post-Block Blast Playbook*
