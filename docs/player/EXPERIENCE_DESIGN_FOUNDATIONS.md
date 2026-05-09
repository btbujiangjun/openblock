# 体验设计基石：心理学根基 → 休闲游戏理念 → OpenBlock 体验结构

> **定位**：把休闲游戏体验设计的**心理学经验研究**、**工业设计理念**与 OpenBlock 当前系统**一次性串成顶层方法论**，作为产品决策、调参与新功能审查的「为什么这样设计」总入口。
>
> **与既有文档的边界**：
> - 行业市场数据 / 竞品 / RL 进展 → [`docs/domain/CASUAL_GAME_ANALYSIS.md`](../domain/CASUAL_GAME_ANALYSIS.md)、[`docs/domain/DOMAIN_KNOWLEDGE.md`](../domain/DOMAIN_KNOWLEDGE.md)
> - 通用 L1–L4 分层与 `spawnIntent` 单一口径 → [`STRATEGY_EXPERIENCE_MODEL.md`](./STRATEGY_EXPERIENCE_MODEL.md)
> - 指标定义、压力管线、状态枚举与决策树 → [`REALTIME_STRATEGY.md`](./REALTIME_STRATEGY.md)
> - 玩家能力评估细节 → [`PLAYER_ABILITY_EVALUATION.md`](./PLAYER_ABILITY_EVALUATION.md)
>
> **本文不重复以上内容**，只回答："**这些系统为何这样组织？背后的心理学和设计理念是什么？体验在 OpenBlock 中应如何整体结构化？**"

---

## 0. 阅读地图

```
Part A 心理学根基（9 条经验研究）  ── "为什么人会这样反应"
   ↓
Part B 休闲游戏设计理念（7 条工业实践）── "工业上常用的应对模式"
   ↓
Part C OpenBlock 5 轴体验结构      ── "本项目把 A/B 落到哪些系统"
   ↓
Part D 设计审查清单（8 问）         ── "新功能/调参前先逐项核对"
```

---

## Part A. 心理学根基（Empirical Foundations）

> 每条只列：**核心命题 → 量化模型 / 可观测信号 → 在休闲游戏的常见误用 → OpenBlock 落点**。深入文献请按引用回到原作。

### A.1 心流理论（Flow Theory，Csikszentmihalyi 1990；Jenova Chen 2007）

**核心命题**：当**挑战水平 C** 与**能力水平 P** 接近匹配（C ≈ P，且 C 略大于 P）时，玩家进入「忘我专注」的最优体验区。

**量化代理**：心流偏移度 `F(t) = |C(t)/P(t) − 1|`（CASUAL_GAME_ANALYSIS §2.1 已给阈值表）。

**常见误用**：
- 以**绝对压力**判断心流（如 stress > 0.8 = 失控）→ 忽略 P 端的能力跟踪。
- 误以为**心流 = 完全无压力** → 实际心流带 `stress ∈ [0.20, 0.45)`，是有压力但可控的状态。

**OpenBlock 落点**：`playerProfile.skillLevel`（P 代理）× `adaptiveSpawn.stress`（C 代理）联合判定，落在 `STRESS_LEVELS.flow [0.20, 0.45)` 区间为目标心流带。

---

### A.2 自我决定论（Self-Determination Theory，Deci & Ryan 2000）

**核心命题**：内在动机由三大基本心理需求驱动 —— **自主性（Autonomy）/ 胜任感（Competence）/ 关联感（Relatedness）**。三者满足越多，外在奖励才越能维持长期动机；外在奖励压制内在动机会反噬。

**单机休闲映射**：
| 需求 | 在 Block Puzzle 中的形态 |
|------|------------------------|
| Autonomy   | 选难度、选模式、忽略提示的权利、放弃当前局的尊重 |
| Competence | 能力可视化、技能进步可感、挑战与能力匹配（与 A.1 重叠） |
| Relatedness | 排行榜、好友对比、公会（OpenBlock 当前弱化，主走单机） |

**常见误用**：用强制弹窗、强制教程、强制路径剥夺 autonomy → 留存短期升、长期崩。

**OpenBlock 落点**：
- Autonomy：`difficultyMode` 选择、`strategyAdvisor` 是**建议而非命令**、可关闭面板
- Competence：`playerInsightPanel` 技能曲线、连战奖励、`STRESS_LEVELS` 头像变化
- Relatedness：暂以最高分/连战记录承担轻关联感

---

### A.3 操作性条件反射 + 变比奖励（Operant Conditioning & Variable Ratio Schedule，Skinner 1957）

**核心命题**：**变比强化（VR：随机次数后给奖励）** 比固定比强化产生**更强、更抗消退**的行为。Skinner 鸽子实验显示：VR 槽机式奖励能让动物在停止给奖后仍长时间持续按键。

**在游戏中的形态**：消行触发的**不可预测性**（同样放置，时机不同结果不同）→ 多巴胺峰值，激活"再放一块试试"的循环。

**伦理边界**：纯 VR + 损失厌恶（A.6）+ 沉没成本是赌博机的成瘾配方。**休闲游戏必须主动加抑制器**：
- 单局有限时长（compulsion 自然中断）
- 不引入真实金额下注（避免槽机化）
- 系统在玩家"卡住"时**主动减压**（减少负反馈持续时长）

**OpenBlock 落点**：消行的随机性来自玩家放置策略 + 系统出块共同决定（非纯随机）；`confidenceGate` 限制极端调整；`immediateRelief` 短路平滑让减压**即时**生效。

---

### A.4 奖励预测误差与多巴胺（Reward Prediction Error，Schultz 1997；Berridge "wanting ≠ liking" 1996）

**核心命题**：多巴胺神经元编码的不是"奖励本身"，而是**奖励 − 期望**（PE = R − E）：
- 兑现等于预期：基线
- **兑现略超预期 → 正 PE → 强烈学习信号 + 愉悦感**
- 兑现远低于预期 → 负 PE → 失望与回避

Berridge 进一步分离：多巴胺主要驱动**"想要"（wanting）**，不直接产生**"喜欢"（liking）**——这就是为什么有些游戏让人停不下来但并不快乐（"成瘾感"≠"满足感"）。

**设计含义**：
- **小惊喜优于大保证**：偶尔的 multi-clear、Perfect Clear 比稳定单消更激发兴奋。
- **预期管理**：UI / 叙事不要承诺超出系统能兑现的体验，否则负 PE 反噬。
- **"想要" vs "喜欢"分离**：长期沉迷指标（DAU/局数）和短期幸福指标（评分/复购）需要分别监控。

**OpenBlock 落点**：`scoreMilestone` / `multiClearBonus` / `delight.mode='flow_payoff'` 制造正 PE；`spawnIntent='harvest'` 的承诺由 v1.17 几何回钳保证可兑现，避免负 PE。

---

### A.5 峰终定律（Peak-End Rule，Kahneman 1993）

**核心命题**：人对一段经验的**记忆评分**几乎完全由两个时刻决定：**情感峰值（最强烈瞬间）+ 结尾时刻**。**总时长几乎不影响评分**（"时长忽略效应"）。

**著名实验**：冷水手测试中，60 秒（14°C）+ 30 秒（缓慢回暖到 15°C）的组别记忆评分**优于** 60 秒（恒 14°C）的组别 —— 即使总痛苦更多。

**设计含义**：
- 单局必须**有可控的峰值**（Combo 爆发、Perfect Clear、连消彩蛋）。
- 结尾**必须可控**：endGame 总结画面、最高分庆祝、近失"差一点"叙事，都是塑造记忆的最后窗口。
- 反过来：**长时间平淡 ≈ 短时间平淡**（在记忆维度），所以不要靠"耗时间"做留存。

**OpenBlock 落点**：
- 峰值：`delight.mode='flow_payoff'` 主动制造高潮；`scoreMilestone` 阶段性兑现
- 结尾：`endGame` 总结 + 复活弹窗（既给最后峰值，也给"差一点"叙事）
- 反例守卫：`flowPayoffCap=0.79` 防止结尾失控成"高压崩盘"，保护记忆

---

### A.6 损失厌恶 + 近失效应（Loss Aversion，Kahneman & Tversky 1979；Near-Miss Effect，Reid 1986；Clark fMRI 2009）

**核心命题**：
- **损失厌恶**：失去 N 单位的痛感 ≈ 得到 N 单位快感的 **2.25×**（前景理论实验）。
- **近失（Near-Miss）**：差一点就赢的局面会激活与"赢"几乎相同的脑区（Clark 2009 fMRI），触发**强烈"再试一次"**动机 —— 即使客观上仍是失败。

**设计含义**：
- 失败时不要立刻强制结束 —— 给"差一点"的叙事和复活机会，把损失厌恶转化为"再战一局"的强化器。
- 但**不能滥用**：纯 Near-Miss 设计是赌博机的核心套路，必须配合**真实可掌控的能力增长**（A.2 Competence）才不变成成瘾陷阱。

**OpenBlock 落点**：
- `nearMissAdjust`（detection）→ 触发激励广告窗口（参 DOMAIN_KNOWLEDGE §7）
- `revive.js` 复活机制（每局 1 次限制，保留失败感）
- v1.31 `score-push 守卫`：在玩家**正在打破个人最佳**（损失厌恶最强烈的瞬间）时，叙事切到"冲分仪式感"而非"保活"，强化继续投入的动机

---

### A.7 Yerkes-Dodson 倒 U 形（1908）

**核心命题**：**唤醒水平（arousal）与表现的关系是倒 U 形** —— 太低无聊、表现差；太高焦虑、表现差；中段为最优表现带。任务越**复杂**，最优唤醒带越**靠左**（即复杂任务承受不了高唤醒）。

**与心流的关系**：心流（A.1）是 Yerkes-Dodson 中段在主观体验维度的对应物。

**设计含义**：
- 难度封顶：高难度任务上限不能让 stress 失控
- 难度托底：太低也要主动加压（防"无聊离开"）
- 复杂度分级：操作越复杂，可承受的压力越低

**OpenBlock 落点**：
- 上限：`flowPayoffCap=0.79`（v1.27 软封顶到 tense 档）
- 下限：`difficultyTuning.hard.minStress=0.18`（Hard 模式即使 stress 低也保持基线）
- 复杂度分级：`shapeWeights` 十档插值 → 在压力高时投放更小、更易放置的形状

---

### A.8 钩子模型 / 强迫循环（Hooked Model，Eyal 2014；Compulsion Loop）

**核心命题**：可持续的产品参与由四步循环驱动：
```
Trigger（触发）→ Action（行动）→ Variable Reward（变化奖励）→ Investment（投入）
                                            ↓
                            投入越多，下次 Trigger 越易激活
```

**设计中性**：Hooked 不必然是负面 —— 当玩家**积极同意**（Autonomy 充分）且**真实获益**（Competence 真实），它就是好的体验设计。变成"暗黑模式"的关键标志：
- Trigger 强制化（红点/弹窗/通知轰炸）
- Action 摩擦化（设置入口隐藏、退订困难）
- Variable Reward 槽机化（纯运气、无能力增长）
- Investment 不可携带（账号绑定、皮肤不通用）

**OpenBlock 落点**：
- Trigger：单局结束的 endGame 总结（被动展示，无强推送）
- Action：核心循环 < 3 步（拖拽放置 → 消行 → 重复）
- Variable Reward：消行/Combo/PC 的随机时机 + 阶段性兑现
- Investment：本地存档 + 多端同步契约（参 platform/SYNC_CONTRACT.md）

---

### A.9 MDA 框架（Mechanics → Dynamics → Aesthetics，Hunicke et al. 2004）

**核心命题**：游戏可分三层
- **M (Mechanics)**：规则与系统组件（如：8×8 盘、3 块 dock、消行规则）
- **D (Dynamics)**：M 在玩家交互下涌现的运行时行为（如：随着 fill 升高，可放置位置数下降）
- **A (Aesthetics)**：玩家的情感反应（如：紧张、爽快、被照顾感、成就感）

**关键不对称**：
- **设计师视角**：M → D → A（先设计规则，看涌现什么动态，影响什么情感）
- **玩家视角**：A → D → M（先有情感反应，再理解动态，最后逆推规则）

**设计含义**：
- DDA 的所有调整都必须**保护 A**（情感连贯性）。即使 M/D 数学上正确，A 错位也是 bug（v1.31 score-push 守卫的根因）。
- 测试覆盖必须**三层分离**：M 层走单测、D 层走 replay 集成、A 层走截图复现。

**OpenBlock 落点**：
| 层 | 文件 | 测试 |
|---|------|------|
| M | `clearRules.js`、`shapes.js`、`grid.js` | `tests/clearRules.test.js`、`tests/shapes.test.js`、`tests/grid.test.js` |
| D | `adaptiveSpawn.js`、`blockSpawn.js`、`hintEngine.js` | `tests/adaptiveSpawn.test.js`、`tests/blockSpawn.test.js` |
| A | `stressMeter.js`、`strategyAdvisor.js`、`playerInsightPanel.js` | `tests/stressMeter.test.js`（含 v1.30/v1.31 截图复现用例）|

---

## Part B. 休闲游戏设计理念（Casual Game Design Philosophies）

> 工业上反复验证的「应对模式」，每条对应 Part A 的若干心理学原理。

### B.1 易学难精（Easy to Learn, Hard to Master）

**90 秒理解规则，几十小时挖掘深度。**

- 心理学根基：A.7（复杂任务承受不了高唤醒）+ A.2（Competence 渐进满足）
- 实操：核心循环操作 ≤ 3 步；规则用一屏说完；策略深度由"涌现"提供，不靠"叠规则"
- OpenBlock：拖拽 → 放置 → 消行；策略深度来自 8×8 + 3 块的组合爆炸（参 DOMAIN_KNOWLEDGE §1）

### B.2 碎片会话（2-5 分钟单局）

**单局必须能在地铁/排队/碎片场景完整结束**。

- 心理学根基：A.5（峰终定律 —— 长时间不必要）+ 移动场景的注意力窗口（多项研究均值 ≤ 5 min）
- 实操：单局结构 = 开局 30s 上手 + 中段 2-3 min 心流 + 结尾峰值；超时无强惩罚
- OpenBlock：典型 8×8 + 3 块单局 2-5 min；`sessionArc` 自然推进 warmup → peak → cooldown

### B.3 即时反馈与"汁液"（Juice & Feel，Swink 2008）

**每个操作必须有视觉/听觉/触觉反馈，强度与重要度匹配。**

- 心理学根基：A.4（正 PE 需要可感知）+ A.3（强化必须及时）
- 实操：放置 = 轻反馈；消行 = 中反馈 + 粒子；Combo = 强反馈 + 庆祝；Perfect Clear = 顶级反馈
- OpenBlock：`effectLayer.js` 处理消行动画与粒子；音效 / 触觉接口预留在 `feedbackToggles`

### B.4 公平随机（Fair Random）

**真随机会让玩家感知不公平 —— 必须加权、限连续坏运气、保可解性。**

- 心理学根基：A.6（损失厌恶让"连续坏运气"被放大记忆）+ A.4（负 PE 累积导致流失）
- 实操：加权采样 + DFS 可解性验证 + 连续坏块计数器；玩家不应看到"无解出块"
- OpenBlock：`blockSpawn.js` 多层守卫（参 ALGORITHMS_SPAWN）+ `clearGuarantee` 物理回钳（v1.17）

### B.5 自适应难度 + 隐蔽性原则

**DDA 必须不被察觉。优秀的 DDA 让玩家觉得"这游戏真好玩"，而不是"游戏在帮我"。**

- 心理学根基：A.2（Autonomy 不能被剥夺）+ A.4（"被施舍"的兑现产生不了正 PE）
- 实操：单帧 stress 变化 ≤ 0.05；保留低概率"难"形状（防"作弊感"）；调节理由不直接暴露给玩家
- OpenBlock：`smoothing` 平滑 + `confidenceGate` 限幅；`stressMeter` 叙事**只描述意图**而不解释参数（"系统在投放促清形状" ≠ "因为 stress=0.7 + scoreStress=0.3 所以..."）

### B.6 多层次进度 + 沉没成本对抗

**单局/日/周/月四层奖励叠加，对抗"无意义连胜"和"无回报连败"。**

- 心理学根基：A.3（变比奖励多层叠加）+ A.5（每层都是潜在峰值）+ Hooked Investment（A.8）
- 实操：分数（每步）/ 消行（30s）/ 任务（10min）/ 赛季（1 周）/ 收藏（1 月）
- OpenBlock：分数 + Combo + ScoreMilestone（局内）；最高分 + 连战（跨局）；任务 + 赛季（roadmap，参 product/RETENTION_ROADMAP_V10_17.md）

### B.7 友好商业化（Player-Friendly Monetization）

**激励广告（玩家主动）> 插屏广告（被动打断）；首 48 小时不强推 IAP。**

- 心理学根基：A.2（Autonomy 红线）+ A.6（高 intent 时刻的商业接受度高 6×）
- 实操：进度驱动广告频率（CASUAL_GAME_ANALYSIS §10.3）；复活/续关用激励广告；订阅去广告作为长期付费 anchor
- OpenBlock：`revive.js` 预留 `adAdapter.showRewardedAd` 接口；分群（Whale/Dolphin/Minnow）走差异化策略（参 archive/MONETIZATION_PERSONALIZATION.md）

---

## Part C. OpenBlock 体验结构：5 轴模型

> 把 Part A 的心理学原理与 Part B 的设计理念，映射到 OpenBlock 的**具体系统、可观测信号、玩家可感叙事**，并按 5 个**正交轴**组织。
>
> 选 5 轴而不是 3 / 7 的理由：体验=「**挑战 × 兑现 × 掌控 × 情感 × 成长**」是覆盖 SDT(A.2)、心流(A.1)、PE(A.4)、峰终(A.5)、Hooked(A.8) 的最小正交集。每轴可独立调参、独立测试，跨轴拉锯由互抑机制（参 REALTIME_STRATEGY §3.7）显式管理。

### C.1 五轴一览

| 轴 | 心理学根基 | 设计理念 | 系统入口 | 测量信号 | 玩家可感叙事 |
|---|----|----|----|----|----|
| **C-1 挑战-能力** | 心流 (A.1) + Yerkes-Dodson (A.7) | DDA + 隐蔽性 (B.5) | `playerProfile` × `adaptiveSpawn` | `skillLevel` / `stress` / `flowDeviation` | 头像 + 6 档压力级 + `level.vibe` |
| **C-2 节奏-兑现** | 变比奖励 (A.3) + 预测误差 (A.4) | 即时反馈 (B.3) + 易学难精 (B.1) | `rhythmPhase` / `scoreMilestone` / `multiClearBonus` | `rhythmPhase ∈ {setup, payoff, neutral}` / `spawnIntent='harvest'` | `FLOW_NARRATIVE_BY_PHASE` / harvest 三档 (v1.31) |
| **C-3 掌控-自主** | SDT (A.2) | 易学难精 (B.1) + 隐蔽 DDA (B.5) | `strategyAdvisor` / 难度模式 / hint 开关 | tip categories / `difficultyMode` | 策略卡（建议而非命令）/ "看起来比较轻松，悄悄加点料" |
| **C-4 情感-回响** | 峰终 (A.5) + 损失厌恶/近失 (A.6) | 公平随机 (B.4) + 友好商业化 (B.7) | `stressMeter` / `nearMissAdjust` / `revive` / `delight` | `nearMissAdjust` / `boardRisk` / score-push 守卫 | 一句话叙事 / 复活弹窗 / "冲分仪式感" (v1.31) |
| **C-5 成长-沉没** | Hooked (A.8) + Competence (A.2) | 多层次进度 (B.6) + 友好商业化 (B.7) | `sessionArc` / `playstyle` / 收藏 / 任务 | `sessionArc ∈ {warmup, peak, cooldown}` / `playstyle` | 弧线 pill / 长期统计 / 任务完成回响 |

> 五轴**不是分层**（不是 L1→L2→L3 这种顺序依赖），而是**正交关注点**：同一帧 spawn 决策可能同时影响 4 个轴；UI 上的一句话叙事是 5 轴的**协同投影**。

### C.2 五轴互抑：避免单维度过度优化

任何一个轴优化过头都会反噬其他轴。已在系统中沉淀的互抑机制：

| 过度优化 | 反噬表现 | 现有守卫 | 守卫所属 |
|---|---|---|---|
| **C-1 挑战压顶** | 玩家"被卷"流失 | `immediateRelief` 短路 + `flowPayoffCap=0.79` 软封顶 + **`orderRigor` 五重 bypass (v1.32)** | adaptiveSpawn 平滑层 + topologyDifficulty |
| **C-2 兑现过频** | 玩家"被宠"无成就感 | `clearGuarantee` 物理回钳 + `delight` 频率封顶 | blockSpawn 几何门控 |
| **C-3 掌控过强**（hint 太密） | 玩家失去 Autonomy → 失兴趣 | `applyTipCategoryDiversity` (v1.29) 强制类别多样 | strategyAdvisor 后处理 |
| **C-4 情感过激** | 叙事与盘面错位 → 信任崩塌 | `score-push 守卫` (v1.31) + `harvest 密度三档` (v1.31) | stressMeter buildStoryLine |
| **C-5 推进过快** | 后期无目标 → 倦怠 | `sessionArc` 自然 cooldown + `pacingPhase` 张弛交替 | adaptiveSpawn |

### C.3 五轴 → 三层验证（M-D-A 视角）

每个轴在 Mechanics / Dynamics / Aesthetics 三层都需要独立测试覆盖（A.9）：

| 轴 | M 层（单测） | D 层（集成/回放） | A 层（截图复现/状态枚举） |
|---|---|---|---|
| C-1 | `tests/playerAbilityModel.test.js` | `tests/adaptiveSpawn.test.js`（19 信号 + v1.32 orderRigor 7 用例） | `tests/stressMeter.test.js`（6 档 + 救济变体 + v1.32 SIGNAL_LABELS skip） |
| C-2 | `tests/clearRules.test.js`、`tests/blockSpawn.test.js` | `tests/spawnLayers.test.js` | v1.31 harvest 密度 3 档用例 |
| C-3 | `tests/hintEngine.test.js` | `tests/strategyAdvisor.test.js` | tip 类别多样性测试（v1.29） |
| C-4 | `tests/grid.test.js`、`tests/revive.test.js` | `tests/features.test.js`（near-miss）| v1.30 bottleneckRelief + v1.31 score-push 用例 |
| C-5 | `tests/levelManager.test.js` | `tests/v10_17_retention.test.js` | sessionArc / playstyle 状态枚举 |

### C.4 反例与守卫枚举（v1.27 → v1.31，来自截图复现）

按时间序回顾"算法对、体感错"的 case，验证 5 轴模型的实战价值。**每个守卫都对应至少 2 条心理学/设计原则**：

| 版本 | 反例（玩家可见现象） | 错位的轴 | 心理学违反 | 守卫位置 |
|---|---|---|---|---|
| v1.27 | 高压档 + flow 意图 → "心流稳定"叙事 vs 头像"紧张" | C-1 ↔ C-4 错位 | A.5（结尾被错误叙事破坏）+ A.9（A 层错位）| `FLOW_HIGH_STRESS_NARRATIVE_BY_LEVEL` |
| v1.29 | harvest + 紧张档 → "密集消行机会" vs "紧张" | C-2 ↔ C-4 错位 | A.4（兑现承诺与体感反差）+ A.9 | `HARVEST_HIGH_STRESS_NARRATIVE_BY_LEVEL` |
| v1.29 | 顾问 top3 全 survival → 玩家失去策略选择空间 | C-3 失衡 | A.2（Autonomy 被剥夺）| `applyTipCategoryDiversity` |
| v1.29 | 消行后裸 fill 骤降 → `occupancyDamping` 锯齿 | C-1 ↔ C-4 锯齿 | B.5（DDA 隐蔽性被破坏）| `_occupancyFillAnchor` 缓降 |
| v1.30 | dock 中后期 firstMoveFreedom 跌到 1-2 → "被困高压"得不到救济 | C-1 失感知 | A.1（C 端跟踪粗粒度）+ A.6（损失厌恶被放大）| `bottleneckRelief` |
| v1.31 | 高 stress + 空盘 → 旧"保活"叙事错位 | C-4 误读 C-1 | A.5（峰终被错误叙事破坏）+ A.9（A 层错位）| score-push 守卫 |
| v1.31 | harvest 一律说"密集" → 强度未匹配几何 | C-2 语义膨胀 | A.4（预期 ≠ 兑现 → 负 PE 风险）| harvest 密度 3 档分级 |
| **v1.32 升级**（**正例**：主动加难，而非反例修复） | 高承受力玩家在 hard 模式 + 高 stress 时缺少"上限+1"难度，操作精度已触顶但**前瞻规划**维度未利用 | C-1 上限延伸 | **A.7**（Yerkes-Dodson 上限延展）+ **A.2**（高 skill 玩家 Competence 阈值）+ **B.1**（"Easy to learn, hard to master" 中"hard to master"端） | `orderRigor` / `orderMaxValidPerms` — 把 `validPerms` 维度从未消费转为软过滤；五重 bypass 守卫"不刁难新手/被困者" |

**规律**：所有守卫几乎都发生在 **A 层（叙事 / UI）**或 **D-A 边界**。这印证了 A.9 的关键不对称 —— **玩家是从 A 反推 M 的，A 层错位就是体验 bug**，即使 M/D 层完全正确。

### C.5 五轴在单局生命周期中的协同

```
单局时间 →   开局(0-30s)         中段(30-180s)        结尾(180s-收尾)
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
C-1 挑战    onboarding 上限      心流带 [0.20-0.45)    可达 tense 制造峰值
C-2 兑现    必有 1 次消行         payoff/setup 交替    final combo / PC 机会
C-3 掌控    引导隐藏              hint 按需             复活弹窗保留"放弃"按钮
C-4 情感    友好叙事              紧张/兑现守卫         endGame 总结 + 近失叙事
C-5 成长    sessionArc=warmup    sessionArc=peak       sessionArc=cooldown
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            (B.2 碎片会话总长 2-5 min)
```

每轴在不同阶段的目标值不同；调参时**先确认目标曲线**，再调具体阈值。

---

## Part D. 设计审查清单（New Feature / Tuning Checklist）

新功能或调参提交前，按以下 8 问逐项核对（建议作为 PR 模板）：

- [ ] **Q1 多轴影响**：是否同时影响多个轴（C-1～C-5）？多轴改动需要 cross-system 审查（最少包括 adaptiveSpawn + stressMeter + 1 个测试文件）。
- [ ] **Q2 A 层一致性**：是否可能让"叙事-体感"错位？需要新守卫吗？参考 v1.27/v1.29/v1.31 守卫模式。
- [ ] **Q3 DDA 隐蔽性**：单帧 stress 变化是否 ≤ 0.05？是否保留了低概率"难"形状（防作弊感）？
- [ ] **Q4 Autonomy**：是否给玩家可感的自主选择空间？是否避免了强制弹窗 / 强制路径？
- [ ] **Q5 峰终设计**：单局是否包含至少一个"峰值"和一个清晰"结尾"？（B.6 多层次进度叠加峰值）
- [ ] **Q6 商业化触发时机**：商业化是否在 high-intent 时刻（near-miss / endGame）？避免低 intent 强插。
- [ ] **Q7 抗成瘾守卫**：是否有 confidenceGate / immediateRelief 短路 / 单局复活上限等抑制器？
- [ ] **Q8 测试-文档同步**：vitest 用例是否覆盖了 M-D-A 三层？REALTIME_STRATEGY 反向工程章节是否同步更新？

---

## Part E. 关联文档（Reading Map）

按问题域查找：

| 你想了解 | 优先阅读 | 后续展开 |
|---|---|---|
| 心理学原理在本项目的具体公式实现 | `REALTIME_STRATEGY.md` §3.2 压力指标体系 | `algorithms/ALGORITHMS_PLAYER_MODEL.md` |
| 通用 L1–L4 分层与 spawnIntent | `STRATEGY_EXPERIENCE_MODEL.md` | 本文 Part C |
| 自适应出块的参数矩阵与调参 | `algorithms/ADAPTIVE_SPAWN.md` | `engineering/STRATEGY_GUIDE.md` |
| 行业市场数据与竞品 | `domain/CASUAL_GAME_ANALYSIS.md` §10、`domain/DOMAIN_KNOWLEDGE.md` §2 | `product/RETENTION_ROADMAP_V10_17.md` |
| 商业化分群与广告时机 | `domain/DOMAIN_KNOWLEDGE.md` §7-§8 | `archive/MONETIZATION_PERSONALIZATION.md` |
| 玩家面板上的每个指标 | `player/PANEL_PARAMETERS.md` | `player/REALTIME_STRATEGY.md` §5 |
| 玩法风格识别与策略微调 | `player/PLAYSTYLE_DETECTION.md` | `algorithms/ALGORITHMS_PLAYER_MODEL.md` |

---

## 参考文献（Selected）

| 引用 | 本文用处 |
|---|---|
| Csikszentmihalyi M. (1990). *Flow: The Psychology of Optimal Experience.* | A.1 心流通道与 F(t) |
| Chen J. (2007). *Flow in Games.* CACM 50(4). | A.1 在游戏中的应用 |
| Deci E.L. & Ryan R.M. (2000). *The "What" and "Why" of Goal Pursuits.* Psych Inquiry 11. | A.2 SDT 三需求 |
| Skinner B.F. (1957). *Schedules of Reinforcement.* | A.3 变比奖励 |
| Schultz W. (1997). *A Neural Substrate of Prediction and Reward.* Science 275. | A.4 多巴胺 PE |
| Berridge K.C. & Robinson T.E. (1998). *Wanting vs Liking.* Brain Res Rev 28. | A.4 想要 ≠ 喜欢 |
| Kahneman D. & Tversky A. (1979). *Prospect Theory.* Econometrica 47. | A.6 损失厌恶 |
| Kahneman D. et al. (1993). *When More Pain Is Preferred to Less.* Psych Sci 4. | A.5 峰终定律 |
| Clark L. et al. (2009). *Gambling Near-Misses Enhance Motivation to Gamble and Recruit Win-Related Brain Circuitry.* Neuron 61. | A.6 近失 fMRI |
| Yerkes R.M. & Dodson J.D. (1908). *The Relation of Strength of Stimulus to Rapidity of Habit-Formation.* J Comp Neurol Psychol 18. | A.7 倒 U 形 |
| Eyal N. (2014). *Hooked: How to Build Habit-Forming Products.* | A.8 Hooked 模型 |
| Hunicke R. et al. (2004). *MDA: A Formal Approach to Game Design and Game Research.* AAAI Workshop. | A.9 MDA 框架 |
| Swink S. (2008). *Game Feel.* Morgan Kaufmann. | B.3 Juice 与手感 |

---

*文档版本：1.1（v1.31 体验结构方法论顶层入口 + v1.32 顺序刚性高难度算法正例验证）· 与 STRATEGY_EXPERIENCE_MODEL v1.3、REALTIME_STRATEGY v2.0 配套使用。*
