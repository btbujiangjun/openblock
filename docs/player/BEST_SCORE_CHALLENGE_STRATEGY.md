# 挑战个人最佳分策略设计：体验结构、当前实现与优化路线

> **读者对象**：主策划人、策略设计师、策略算法设计师、负责自适应难度与长期留存的产品负责人。  
> **设计目标**：OpenBlock 的核心动机不是“轻松刷新纪录”，而是让玩家持续感到“我正在逼近并挑战自己的最佳分”。系统应让突破具备仪式感、可解释性和稀缺性，同时避免通过廉价救济或随机好运把个人最佳分贬值。  
> **代码边界**：本文只做策略设计与现状审计；本次不要求更新玩法代码。当前实现事实以 `web/src/adaptiveSpawn.js`、`web/src/lifecycle/lifecycleStressCapMap.js`、`web/src/game.js`、`shared/game_rules.json`、[实时策略系统](./REALTIME_STRATEGY.md) 和 [生命周期与成熟度蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) 为准。

---

## 1. 策略北极星

OpenBlock 应把“个人最佳分”设计成一条长期攀登曲线，而不是单局随机奖金。

核心命题：

- **目标不是平均每局都破纪录**：若玩家频繁刷新最佳分，最佳分会失去价值；若长期毫无接近感，玩家会放弃。
- **最佳体验区是“可见差距 + 有压力 + 可归因”**：玩家应知道自己离最佳分还有多远，感觉到系统正在进入冲刺段，但失败后也能理解“差在哪里”。
- **突破必须来自能力成长与策略执行**：系统可以提供节奏、形状、保底和叙事支持，但不能把突破交给纯随机或过度救济。
- **不同生命周期与成熟度的“最佳分策略”应不同**：S0/M0 的最佳分是信心锚点，S3/M4 的最佳分是荣誉门槛；同一套加压曲线不能服务所有人。

因此，本文建议把 OpenBlock 的个人最佳分策略定义为：

```text
让玩家在大多数有效会话中看到可追赶的个人目标，
在少数高质量会话中完成真实突破，
并在每次失败后获得“下次为什么可能更好”的策略线索。
```

---

## 2. 行业经验：主流休闲游戏如何组织自我挑战

### 2.1 头部休闲游戏的共同结构

主流休闲与益智游戏普遍不是靠复杂规则留住玩家，而是靠稳定的体验结构：

1. **秒懂核心循环**：打开、理解、操作、反馈、再来一局。超休闲游戏强调“几秒内理解、几十秒内形成掌控感”，复杂系统作为调味而非第二套游戏。
2. **渐进式挑战而非线性加压**：优秀无尽或关卡游戏使用波浪式压力曲线，包含热身、加压、峰值、释放和收尾，而不是一路变难。
3. **进展感分层**：关卡进度、连胜、阶段奖励、个人纪录、每日目标共同承担“我在前进”的感受。
4. **失败可接受**：玩家可以失败，但失败必须有解释、接近感或下一局更好的理由。
5. **后期玩家需要身份与稀缺目标**：老玩家不只需要新内容，更需要自己处于高段位、高纪录或高挑战状态的确认。

### 2.2 对“最佳分挑战”的启发

围绕个人最佳分，行业经验可以抽象为五条原则：

- **最佳分是长期目标，不是短期奖励**：应提供接近提示、里程碑和冲刺仪式，但不能把刷新变成高频日常。
- **难度应随“接近最佳分”局部抬升**：越接近历史最佳，越应进入更紧的决策节奏，让突破更像玩家赢来的。
- **突破前应增强反馈密度**：视觉、文案、压力表、策略卡可以告诉玩家“这局有机会”，但不能直接保证出好块。
- **失败后应保留下一局动机**：近失、差距、瓶颈原因、策略建议比单纯“再来一局”更有效。
- **高成熟玩家需要更窄解空间**：资深玩家的挑战来自顺序规划、解法数量、空间结构，而不是简单塞更多烂块。

### 2.3 参考资料

- GameDeveloper：移动益智游戏进度设计与难度“pinch”关卡思路，强调进展感与失败接受度。
- Deconstructor of Fun：Win Streak 作为休闲游戏多层动机系统，能把“过关”扩展成连续自我挑战。
- PocketGamer / MobileGamer 对 Candy Crush 的访谈：King 区分“难度”和“乐趣”，用复杂度阶梯、机器人预跑、time to abandon / time to pass 等指标校准关卡。
- 超休闲设计资料：核心循环必须极简，长期留存来自轻量进度、即时反馈和数据驱动迭代。
- 无尽模式难度曲线研究：持续线性加压容易疲劳，波浪式压力和释放窗口更能维持心流。

---

## 3. 当前策略设计：OpenBlock 已经具备的能力

### 3.1 个人最佳分已经进入出块压力

当前 `adaptiveSpawn` 已将分数与历史最佳纳入压力计算：

- `game.js` 在开局读取 `bestScore` 并写入 `_spawnContext.bestScore`。
- `adaptiveSpawn.js` 通过 `getSpawnStressFromScore(score, { bestScore })` 计算 `scoreStress`。
- `shared/game_rules.json → dynamicDifficulty` 定义分数档与压力档：`milestones`、`spawnStress`、`scoreFloor`、`percentileDecayThreshold`、`percentileDecayFactor`、`percentileMaxOver`。
- v1.13 后，`scoreStress` 已从纯绝对分数改为参考个人百分位，避免玩家一次冲过固定末档后永久锁死最高压力。

设计含义：

- 新手或低最佳分玩家仍能通过绝对档位获得早期进展感。
- 有历史最佳的玩家会按个人水位进入相对挑战，而不是与全服统一阈值比较。
- “挑战自己”已经不是 UI 口号，而是进入了 L2 stress 管线。

### 3.2 逼近历史最佳时已有冲分加压

当前 `adaptiveSpawn.js` 中存在 `challengeBoost`：

- 触发条件围绕 `score / bestScore`，通常在玩家达到历史最佳约 80% 后开始。
- 最高额外加压约 `+0.15`。
- 若 `friendlyBoardRelief` 显著为负，会对 `challengeBoost` 打折，避免盘面友好时出现体验冲突。
- `stressMeter.js` 已有 “B 类挑战” 标签与“冲分仪式感”叙事守卫，避免空盘高压时误说成“保活”。

设计含义：

- 系统已能识别“这局正在冲击个人最佳”的特殊状态。
- 接近最佳时不会单纯保活，而是让体验更紧。
- 当前冲分加压是窄逻辑，不会覆盖 boardRisk、救济、近失等高优先级安全信号。

### 3.3 分数里程碑按个人最佳派生

当前 `deriveScoreMilestones(bestScore)` 使用双轨逻辑：

- `bestScore < 200` 时使用绝对里程碑 `[50, 100, 150, 200, 300, 500]`。
- `bestScore >= 200` 时使用相对里程碑 `[0.25, 0.5, 0.75, 1.0, 1.25] × bestScore`。

设计含义：

- 新手有稳定的“50→100→150”成长节奏。
- 老玩家不会在开局连续吃完所有低档反馈，而是在接近个人水位时才获得关键节点。
- `1.25 × bestScore` 为突破后继续推进留出上限目标，避免刷新后体验立即断崖。

### 3.4 自适应难度不是单一“变难”

当前策略由多信号 stress 与多轴 `spawnTargets` 共同驱动：

- 加压：`scoreStress`、`runStreakStress`、`difficultyBias`、`skillAdjust`、`flowAdjust(bored)`、`pacingAdjust(tension)`、`comboAdjust`、`challengeBoost`。
- 减压：`flowAdjust(anxious)`、`pacingAdjust(release)`、`recoveryAdjust`、`frustrationRelief`、`nearMissAdjust`、`holeReliefAdjust`、`boardRiskReliefAdjust`、`abilityRiskAdjust`、`friendlyBoardRelief`、`bottleneckRelief`。
- 派生目标：`shapeComplexity`、`solutionSpacePressure`、`clearOpportunity`、`spatialPressure`、`payoffIntensity`、`novelty`。
- 下游出块：通过十档 `profiles` 插值、`spawnHints`、解法数量过滤、顺序刚性 `orderRigor` 和几何可行性门控落实。

设计含义：

- 高分段加压并不等于投放不可放的坏块。
- 盘面风险、动态被困、挫败和近失会及时救济，保护公平性。
- “挑战最佳分”的压力可落到形状复杂度、解空间、顺序刚性、消行机会和爽感兑现等不同维度。

### 3.5 生命周期 × 成熟度已接入出块调制

当前 `web/src/lifecycle/lifecycleStressCapMap.js` 将 S0–S4 生命周期与 M0–M4 成熟度映射到 stress cap / adjust：

- S0 新入场与 S4 回流：低 cap + 负 adjust，保护新人和回流玩家。
- S2/S3 高成熟度：更高 cap + 正 adjust，允许更强挑战。
- 同 stage 内，M-band 越高通常 cap 越高。
- 同 band 跨 stage，S0/S4 弱、S2/S3 强。

设计含义：

- 当前系统已具备玩家生命周期差异化，而不是只按当局表现调参。
- 个人最佳分的挑战策略可以进一步消费这张表：同样的“离最佳分 10%”，S0/M0 应是鼓励，S3/M4 应是冲刺。

### 3.6 UI 叙事已有“个人最佳”相关反馈

当前 `game.js` 与压力表已有多处个人最佳反馈：

- HUD 中 `best-gap` 在无尽模式下显示离最佳分的差距，2% 内触发“即将刷新最佳”语义。
- 刷新最佳时触发 `new-best-popup`、皇冠、闪光、震屏等强反馈。
- `stressMeter.js` 对 score-push 高压场景已有专门叙事，避免把冲分压力误解释为盘面危机。

设计含义：

- 个人最佳分已同时进入数值、叙事和视觉反馈。
- 当前缺口不在“有没有最佳分策略”，而在“最佳分挑战区间是否分层、是否可控、是否能证明突破不是过易”。

---

## 4. 体验结构：从开局到破纪录的四段曲线

建议将每局围绕个人最佳分拆成四段，供策划、算法和 UI 使用同一语言。

### 4.1 热身段：0%–50% best

体验目标：让玩家找回手感，避免开局因上局失败或回流导致过早流失。

策略倾向：

- 新手与回流玩家：降低压力、提高消行可见性，优先建立“这局能玩下去”的信心。
- 熟练玩家：保持标准节奏，不应过度送分；以轻量里程碑提示进展。
- 核心玩家：可略缩短热身，但不应直接进入高压，否则会削弱“本局成长曲线”。

当前支撑：

- `sessionArc='warmup'`、新手 stress override、S0/S4 cap、相对里程碑 25%。

### 4.2 建势段：50%–80% best

体验目标：让玩家感觉“这局有机会”，但还没进入最终冲刺。

策略倾向：

- 提高节奏变化和 payoff 机会，让局面出现一到两次可记忆峰值。
- 不应给连续强救济；救济应绑定真实风险。
- 策略卡应强调构型、空间管理和多消机会。

当前支撑：

- `pacing` tension / release 周期、`delight` 多消增强、`friendlyBoardRelief`、`spawnIntent='harvest'`。

### 4.3 冲刺段：80%–100% best

体验目标：让个人最佳成为明确目标，并让压力变得可感。

策略倾向：

- 启动 `challengeBoost`，但受 boardRisk / bottleneck / frustration 护栏约束。
- 对 M2+ 玩家提高 `solutionSpacePressure` 与 `orderRigor`，让突破依赖规划。
- 对 M0/M1 玩家仍保留清行窗口，不应因冲刺直接进入硬核局面。
- UI 叙事从“活下去”转为“冲击新高，稳住关键落点”。

当前支撑：

- `challengeBoost`、score-push narrative、`best-gap`、相对里程碑 75% / 100%。

### 4.4 超越段：100%–125% best

体验目标：把刷新最佳变成高峰记忆，并继续给玩家“还能再多一点”的动机。

策略倾向：

- 刷新瞬间应强反馈，但刷新后不应立刻大幅加压到崩盘。
- 需要短暂的“兑现窗口”：让玩家享受新纪录，而不是马上被惩罚。
- 对高成熟玩家可进入更窄解空间，形成“超越后的传奇局”。

当前支撑：

- `new-best-popup`、`deriveScoreMilestones` 的 `1.25 × bestScore`、`flowPayoffCap`、`stressSmoothing`。

### 4.5 实时分 / 最佳分关系驱动的落地策略

本节把“当前分数与历史最佳的关系”从叙事概念转成可配置的策略输入。建议未来在 L2 派生一个统一对象 `bestScoreChase`，供出块、压力表、策略卡、结算复盘和埋点共用。

#### 4.5.1 核心字段

```text
bestBase        = max(bestScoreAtRunStart, scoreFloor)
bestRatio       = bestScoreAtRunStart > 0 ? score / bestScoreAtRunStart : null
gapToBest       = max(0, bestScoreAtRunStart - score)
gapRatio        = bestScoreAtRunStart > 0 ? gapToBest / bestScoreAtRunStart : null
overBestRatio   = bestScoreAtRunStart > 0 ? max(0, score / bestScoreAtRunStart - 1) : 0
scoreVelocity   = 最近 N 步得分增量 / N
clearMomentum   = 最近 N 步 clearRate 与前 N 步 clearRate 的差
dangerPressure  = max(boardRisk, holePressure, abilityRisk)
```

设计注意：

- `bestScoreAtRunStart` 必须使用开局快照，而不是局中刷新后的 `bestScore`，否则刚破纪录后 `bestRatio` 会被重置，超越段无法持续。
- `scoreFloor` 只用于无历史最佳或历史最佳过低时的冷启动锚点，不应覆盖真实高 best。
- `bestRatio` 是体验主轴，但不能单独决定难度；必须同时读取 `dangerPressure`、`flowState`、`lifecycleStage`、`maturityBand`。

#### 4.5.2 策略区间表

| 区间 | 判定 | 玩家心理 | 系统意图 | 出块策略 | UI / 策略卡 |
|------|------|----------|----------|----------|-------------|
| `best_unknown` | `bestScoreAtRunStart <= 0` 或 `< scoreFloor` | 尚无个人锚点 | 建立第一条纪录 | 低压、更多即时消行、绝对里程碑 | “先创下你的第一条纪录” |
| `warmup` | `bestRatio < 0.50` | 找手感 | 低噪声热身 | 保持当前难度，不因 best 加压 | “热身中，先把空间打开” |
| `build` | `0.50 <= bestRatio < 0.75` | 这局可能不错 | 建势、制造记忆峰值 | 轻微提高 payoff 机会，保持解空间宽 | “这局节奏不错，开始搭分” |
| `approach` | `0.75 <= bestRatio < 0.90` | 已接近有效局 | 明确目标感 | 小幅提高 `solutionSpacePressure`，保留清行窗口 | “已接近历史水位，稳住空间” |
| `push` | `0.90 <= bestRatio < 1.00` | 冲刺、紧张 | 让突破有门槛 | 启动冲分加压；M2+ 提高顺序规划；M0/M1 保留保底 | “距离新高只差一步，别急着赌大消” |
| `breakthrough` | `1.00 <= bestRatio < 1.10` | 爽点、荣耀 | 兑现突破并稳住 | 短窗口防崩；不立即惩罚，但不继续送分 | “新纪录已刷新，把优势稳住” |
| `extend` | `1.10 <= bestRatio < 1.25` | 想把纪录抬高 | 高质量延伸 | M3/M4 可加顺序刚性；其他玩家保持中压 | “正在抬高新纪录，每一步都值钱” |
| `legend` | `bestRatio >= 1.25` | 传奇局 | 稀缺高峰 | 只对高成熟玩家继续加压；低成熟以保体验收尾 | “传奇局，保住这条纪录线” |

关键取舍：

- `approach` 与 `push` 分开。75%–90% 是“有效局确认”，90%–100% 才是“冲刺”；过早加压会让中段疲劳。
- `breakthrough` 不是继续加压的立即入口。刷新最佳后的 1–2 轮应保护峰终体验，避免玩家记住“刚破就死”。
- `legend` 只应对 M3/M4 稳定开放；对 S0/M0 或 S4 回流玩家，`legend` 更适合做强庆祝而非继续压榨。

#### 4.5.3 出块调制矩阵

建议未来把 `bestScoreChase.zone` 作为 `challengeBoost` 的上游，而不是只用一条线性公式。以下是策划可评审的默认矩阵：

| zone | stress 调制 | `clearGuarantee` | `sizePreference` | `solutionSpacePressure` | `orderRigor` | `payoffIntensity` |
|------|-------------|------------------|------------------|--------------------------|--------------|-------------------|
| `best_unknown` | `-0.06` | `+1` | `-0.12` | `-0.10` | `0` | `+0.08` |
| `warmup` | `0` | `0` | `0` | `0` | `0` | `0` |
| `build` | `+0.02` | `0` | `0` | `+0.03` | `0` | `+0.06` |
| `approach` | `+0.05` | `0` | `+0.04` | `+0.08` | `+0.05` | `+0.04` |
| `push` | `+0.08 ~ +0.15` | `0 / -1` | `+0.08` | `+0.14` | `+0.12` | `0` |
| `breakthrough` | `-0.04` 短窗口 | `0` | `-0.04` | `-0.05` | `0` | `+0.10` |
| `extend` | `+0.06` | `0 / -1` | `+0.06` | `+0.10` | `+0.10` | `+0.04` |
| `legend` | `+0.10` 但强护栏 | `-1` | `+0.10` | `+0.16` | `+0.18` | `+0.02` |

落地原则：

- `push` 的加压应主要消费 `solutionSpacePressure` 与 `orderRigor`，少用“不可放的大怪块”。玩家应输在规划，而不是输在系统不公平。
- `breakthrough` 的短窗口建议持续 1–2 次 spawn：让玩家把新纪录稳住，但不保证继续涨分。
- `dangerPressure >= 0.72` 时，所有正向 best 调制降到 0，并优先执行 boardRisk / bottleneck / recovery 救济。
- `friendlyBoardRelief < -0.09` 时，best 加压只允许作用于叙事和轻量 `solutionSpacePressure`，不应显著提高形状复杂度。

#### 4.5.4 生命周期 × 成熟度覆盖规则

同一个 `bestRatio=0.92` 对不同玩家不是同一件事。建议在 zone 调制后再叠加 S/M 覆盖：

| 人群 | 目标 | zone 修正 | 策略重点 |
|------|------|-----------|----------|
| S0/M0 | 建立第一批信心纪录 | `push` 降为 `approach` 强度 | 保消、低失误、结算教学 |
| S1/M0–M1 | 形成回访习惯 | `approach/push` 保持但加压减半 | 任务化：“达到最佳 80%” |
| S2/M1–M2 | 建立技能成长 | 标准 zone | 空间管理、多消兑现、轻顺序规划 |
| S2/S3-M3 | 稳定挑战 | `push/extend` 加强 `orderRigor` | 前瞻规划、低解空间 |
| S3/M4 | 稀缺荣誉 | `push` 更窄，`legend` 开放 | 高压冲刺、传奇局、身份感 |
| S4 全体 | 恢复旧水平 | 前 1–3 局 bestBase 降权 | 40%/60%/75% 台阶目标 |

具体建议：

- S4 回流不要直接拿旧 best 做全强度追赶。可引入 `effectiveBestBase = lerp(scoreFloor, bestScoreAtRunStart, recoveryFactor)`，回流第 1/2/3 局 `recoveryFactor` 分别取 `0.45/0.65/0.85`。
- S0/M0 的 `breakthrough` 可以出现得更频繁，但每次突破后的下一局应逐步提高目标，不要永远低压送纪录。
- S3/M4 的 `best_break_rate` 应低于其他群体，但 `best_90_rate` 应较高，让核心玩家经常进入冲刺段、少数局完成突破。

#### 4.5.5 UI 与策略卡落地

建议将 `bestScoreChase.zone` 映射到三类呈现：

1. HUD 差距提示：
   - `build`：显示“已到历史水位 50%+，这局可冲”。
   - `approach`：显示“接近最佳，稳住空间”。
   - `push`：显示“距离新高还差 X 分”。
   - `breakthrough/extend`：显示“新纪录 +X，继续抬高”。

2. 压力表叙事：
   - `push + low boardRisk`：强调“冲分仪式感”，不说“保活”。
   - `push + high boardRisk`：强调“冲分中但盘面吃紧，先保可落位”。
   - `breakthrough`：强调“已刷新，稳住关键落点”。

3. 策略卡：
   - `approach`：优先给构型建议，如“保留横向通道”“别封死角落”。
   - `push`：优先给风险规避建议，如“先清瓶颈块”“不要赌单次大消”。
   - `extend/legend`：优先给高阶建议，如“规划三块顺序”“保留至少两个落点”。

#### 4.5.6 埋点与回放验收

最小埋点字段：

```json
{
  "bestScoreAtRunStart": 420,
  "score": 386,
  "bestRatio": 0.919,
  "bestZone": "push",
  "gapToBest": 34,
  "overBestRatio": 0,
  "dangerPressure": 0.41,
  "lifecycleStage": "S2",
  "maturityBand": "M2",
  "bestChaseAdjust": 0.08,
  "bestChaseSuppressedReason": null
}
```

回放验收口径：

- 任意进入 `push` 的回放，都应能解释“为什么加压、加压落在哪个轴、为什么没有破坏公平性”。
- 任意 `breakthrough` 后 2 次 spawn 内死亡的回放，都要复查是否缺少突破后稳定窗口。
- 任意 S4 回流玩家首局进入 `push` 的回放，都要复查旧 best 是否过早参与全强度追赶。

### 4.6 可落地指标契约与具体改进项

本节以当前代码为事实来源，给出可直接拆分为 PR 的指标与改进项。原则是：优先复用已经存在的 `Game._captureAdaptiveInsight()`、`PlayerProfile.metrics`、`stressBreakdown`、`spawnHints`、`moveSequence`、`strategyAdvisor` live topology，不新增第二套玩家画像。

#### 4.6.1 当前可用事实源

| 事实 | 当前入口 | 现状 | 可直接消费方式 |
|------|----------|------|----------------|
| 本局开始历史最佳 | `game.js → this._bestScoreAtRunStart` | 开局从 `Database.getBestScore()` 锁定；新纪录庆祝也使用该快照 | 作为 `bestScoreChase.bestBaseRaw`，禁止局中刷新后重置 |
| 当前实时分 | `game.js → this.score`；`_captureAdaptiveInsight.score` | 每次 spawn 快照写入 `_lastAdaptiveInsight` | 计算 `bestRatio`、`gapToBest`、`scoreVelocity` |
| 压力来源 | `adaptiveSpawn.js → stressBreakdown` | 已含 `scoreStress`、`challengeBoost`、`boardRisk`、`bottleneckRelief`、`lifecycle*Adjust`、`finalStress` | 计算冲分加压是否被救济/生命周期抑制 |
| 出块控制轴 | `adaptiveSpawn.js → spawnTargets / spawnHints` | 已有 `solutionSpacePressure`、`clearOpportunity`、`payoffIntensity`、`orderRigor`、`clearGuarantee` 等 | 让 best 分区作用到具体轴，而非只改 stress |
| 盘面风险 | `boardRisk`、`holes`、`bottleneckTrough`、`firstMoveFreedom` | `bottleneckTrough` 已跨 dock 周期记录，`strategyAdvisor` 可读 liveSolutionMetrics | 作为 best 加压抑制器 |
| 玩家执行状态 | `PlayerProfile.metrics` | 已有 `clearRate`、`missRate`、`pickToPlaceMs`、`reactionSamples`、`momentum`、`frustrationLevel` | 区分技术型/犹豫型/失误型 near-best 失败 |
| 生命周期/成熟度 | `lifecycleStressCapMap.js`、`game.js saveSession.lifecycle` | S/M 已写入 session stats，并影响 stress cap/adjust | 作为 best 分区覆盖规则 |
| 策略卡 live 几何 | `strategyAdvisor.js → gridInfo.liveTopology / liveMultiClearCandidates / liveSolutionMetrics` | 策略卡已避免 spawn 快照过期 | near-best 策略卡应优先读 live 而非 spawn 旧快照 |

#### 4.6.2 指标 1：`bestScoreChase`（局内实时追分状态）

目标：把实时分与最佳分关系统一为单一对象，供 L2、L4、回放与运营看板使用。

字段定义：

| 字段 | 公式 | 类型 | 入口 | 用途 |
|------|------|------|------|------|
| `bestBaseRaw` | `_bestScoreAtRunStart` | number | `game.js` | 真实历史最佳快照 |
| `bestBaseEffective` | S4 回流可用 `lerp(scoreFloor,bestBaseRaw,recoveryFactor)`；其他等于 raw | number | 新 helper | 回流保护下的追分锚点 |
| `bestRatio` | `score / bestBaseEffective`，无 best 时 `null` | number|null | `adaptiveSpawn` | 分区判定 |
| `gapToBest` | `max(0, bestBaseRaw - score)` | number | `adaptiveSpawn` | HUD/结算文案 |
| `gapRatio` | `gapToBest / bestBaseRaw` | number|null | `adaptiveSpawn` | 接近程度 |
| `overBestRatio` | `max(0, score / bestBaseRaw - 1)` | number | `adaptiveSpawn` | 超越幅度 |
| `zone` | 按 §4.5.2 表判定 | string | `deriveBestScoreChase()` | 所有下游共享 |
| `dangerPressure` | `max(boardRisk, holePressure, ability.riskLevel)` | number | `adaptiveSpawn` | 抑制加压 |
| `scoreVelocity` | 最近 3 次 placement 的 score delta 均值 | number | `game.js` 可维护轻量 ring | 判断冲分速度 |

具体改进项：

| ID | 改进项 | 代码落点 | 实现要点 | 验收 |
|----|--------|----------|----------|------|
| P0-1 | 新增 `deriveBestScoreChase(score, ctx, profile, risk)` | `web/src/adaptiveSpawn.js` | 不改变现有 stress，只返回派生对象并写入 `layered._bestScoreChase` | 单测覆盖无 best、50%、75%、90%、100%、125%、S4 回流 |
| P0-2 | `_captureAdaptiveInsight` 写入 `bestScoreChase` | `web/src/game.js` | 从 `layered._bestScoreChase` 拷贝到 `_lastAdaptiveInsight` | DFV/面板能读到同一对象 |
| P0-3 | session stats 注入 best 结果 | `game.js → saveSession()` | `gameStats.bestScoreChase = { bestBaseRaw, finalRatio, finalZone, brokeBest }` | SQLite session 中可查最终分区 |
| P0-4 | moveSequence 每次 place 写入 `bestZone` | `game.js → _pushPlaceToSequence()` | 使用当前 `_lastAdaptiveInsight.bestScoreChase.zone` | 回放能定位进入 push 的具体步 |

#### 4.6.3 指标 2：`nearBestQuality`（接近最佳但未破纪录的质量）

目标：衡量玩家“差一点”的质量，判断系统是否让玩家产生可复盘的失败，而不是无意义挫败。

公式：

```text
nearBestQuality =
  0.30 * zoneWeight
+ 0.20 * clearStability
+ 0.15 * mobilitySafety
+ 0.15 * lowMistake
+ 0.10 * payoffSeen
+ 0.10 * retryIntentProxy
```

分项定义：

| 分项 | 计算 | 当前事实源 |
|------|------|------------|
| `zoneWeight` | `approach=0.6, push=1.0, breakthrough=1.0, else=0` | `bestScoreChase.zone` |
| `clearStability` | `clamp(clearRate / 0.45)` | `PlayerProfile.metrics.clearRate` |
| `mobilitySafety` | `clamp(firstMoveFreedom / 6)`，无数据用 `solutionCount` 归一 | `liveSolutionMetrics` / `_spawnContext.bottleneckTrough` |
| `lowMistake` | `1 - clamp(missRate / 0.25)` | `PlayerProfile.metrics.missRate` |
| `payoffSeen` | `multiClearCandidates>=1` 或本局 `maxLinesCleared>=2` | `strategyAdvisor` live 几何 + `gameStats` |
| `retryIntentProxy` | 当前只能用“下一局开始”离线算；局内先置 null | `GAME_EVENTS.GAME_OVER` 后下一次 start |

具体改进项：

| ID | 改进项 | 代码落点 | 实现要点 | 验收 |
|----|--------|----------|----------|------|
| P0-5 | 结算时计算 `nearBestQuality` | `game.js → saveSession()` 或 `moveSequence.js buildReplayAnalysis` | 只在 `finalRatio>=0.90 && !brokeBest` 时计算 | 95% 未破局必须有质量分 |
| P0-6 | 复盘标签新增 `near_best_high_quality` / `near_best_bad_loss` | `moveSequence.js` | 高质量失败用于鼓励；低质量失败用于诊断 | replayAnalysis.tags 出现可测标签 |
| P1-1 | 结算文案按质量分分流 | endGame UI | 高质量：“差一点，空间规划有效”；低质量：“先稳住瓶颈块” | 文案不再只按分差 |

#### 4.6.4 指标 3：`bestBreakSource`（破纪录来源归因）

目标：证明“破纪录不是系统轻易送的”，并让主策划控制不同突破类型占比。

分类规则：

| 类型 | 判定优先级 | 当前事实源 | 设计解释 |
|------|------------|------------|----------|
| `skill_break` | `clearRate>=0.45 && missRate<=0.08 && bottleneckRelief≈0 && frustrationRelief≈0` | `metrics` + `stressBreakdown` | 技术型突破，最健康 |
| `payoff_break` | `maxLinesCleared>=3` 或 `payoffIntensity>=0.65` | `gameStats` + `spawnTargets` | 爽感型突破，可接受 |
| `rescue_break` | `frustrationRelief<0` 或 `bottleneckRelief<0` 或 `recoveryAdjust<0` 多次出现 | `stressBreakdown` 历史 | 救济型突破，需控占比 |
| `risk_break` | `boardRisk>=0.72` 后仍破纪录 | `stressBreakdown.boardRisk` | 高压极限突破，核心玩家可接受 |
| `random_like_break` | 低 clearRate + 高 payoff + 低 skillAdjust | `metrics` + `stressBreakdown` | 疑似随机好运，过高会稀释 best |

具体改进项：

| ID | 改进项 | 代码落点 | 实现要点 | 验收 |
|----|--------|----------|----------|------|
| P0-7 | 每次 spawn 记录 best 相关 stress trace | `_lastAdaptiveInsight` / `moveSequence` | 记录 `scoreStress/challengeBoost/finalStress/zone` | 可还原破纪录前 3 次 spawn |
| P1-2 | 结算计算 `bestBreakSource` | `moveSequence.js` 或 `game.js saveSession` | 仅 `brokeBest=true` 时输出 | 每个新纪录 session 有 source |
| P1-3 | Ops 看板增加 source mix | `opsDashboard.js` + `/api/ops` | 按 S/M 分组统计近 7/30 日占比 | `rescue_break` 超阈值可见 |

建议护栏：

- S0/M0：`rescue_break` 可高一些，但应随局数下降。
- S2/M2：`skill_break + payoff_break` 应占多数。
- S3/M4：`skill_break + risk_break` 应占多数，`random_like_break` 必须低。

#### 4.6.5 指标 4：`pushFairnessGuard`（冲刺段公平性护栏）

目标：进入 `push` 后允许加压，但必须能证明加压没有破坏可解性。

护栏规则：

```text
if bestZone in {push, extend, legend}:
  suppressPositiveBestAdjust when:
    boardRisk >= 0.72
    or bottleneckTrough <= 2
    or profile.needsRecovery
    or frustrationLevel >= frustrationThreshold
    or holes > orderRigorMaxHolesAllow
    or firstMoveFreedom <= 2
```

具体改进项：

| ID | 改进项 | 代码落点 | 实现要点 | 验收 |
|----|--------|----------|----------|------|
| P0-8 | 输出 `bestChaseSuppressedReason` | `adaptiveSpawn.js` | 不先改调制，只在满足抑制条件时写原因 | push 回放能解释为何没加压 |
| P1-4 | `challengeBoost` 接入抑制原因 | `adaptiveSpawn.js` | 当前 friendlyBoard 折扣之外，新增 boardRisk/bottleneck/recovery 抑制 | 高风险 push 不继续加压 |
| P1-5 | 策略卡显示抑制解释 | `strategyAdvisor.js` | “正在冲分，但盘面风险高，先保可落位” | 文案与实际调制一致 |

#### 4.6.6 指标 5：`breakthroughGraceWindow`（破纪录后稳定窗口）

目标：避免玩家刚刷新纪录就立刻被系统加压击穿，保护峰终体验。

设计：

| 字段 | 建议值 | 说明 |
|------|--------|------|
| `graceSpawns` | 2 | 刷新 best 后 2 次 spawn 内生效 |
| `stressCap` | `min(current, 0.65)` 或按 S/M 表 | 防止刚破纪录后直上 intense |
| `clearGuaranteeFloor` | `1` | 不额外送强保消，只防崩 |
| `orderRigorCap` | `0.25` | 暂停高顺序刚性 |
| `payoffBoost` | `+0.06` | 给轻量荣耀延伸 |

具体改进项：

| ID | 改进项 | 代码落点 | 实现要点 | 验收 |
|----|--------|----------|----------|------|
| P0-9 | 记录 `newBestAtPlacement` | `game.js → _maybeCelebrateNewBest()` | 触发时写 `_spawnContext.bestGraceRemaining=2` | 新纪录后上下文可见 |
| P1-6 | grace 只写入 insight，不先调参 | `adaptiveSpawn.js` | 输出 `bestGraceRemaining` 到 `spawnHints` | UI 可先验证 |
| P2-1 | grace 接入 stress/order 调制 | `adaptiveSpawn.js` | 通过 cap 和 orderRigorCap 轻调 | “刚破就崩”回放占比下降 |

#### 4.6.7 具体配置草案

建议未来放入 `shared/game_rules.json → adaptiveSpawn.bestScoreChase`：

```json
{
  "enabled": true,
  "scoreFloor": 180,
  "zones": [
    { "id": "warmup", "min": 0.00, "max": 0.50 },
    { "id": "build", "min": 0.50, "max": 0.75 },
    { "id": "approach", "min": 0.75, "max": 0.90 },
    { "id": "push", "min": 0.90, "max": 1.00 },
    { "id": "breakthrough", "min": 1.00, "max": 1.10 },
    { "id": "extend", "min": 1.10, "max": 1.25 },
    { "id": "legend", "min": 1.25, "max": 999 }
  ],
  "suppression": {
    "boardRisk": 0.72,
    "firstMoveFreedom": 2,
    "bottleneckTrough": 2,
    "maxHolesForOrderRigor": 3
  },
  "grace": {
    "spawns": 2,
    "stressCap": 0.65,
    "orderRigorCap": 0.25,
    "payoffBoost": 0.06
  },
  "winbackEffectiveBest": {
    "enabled": true,
    "factors": [0.45, 0.65, 0.85]
  }
}
```

迁移约束：

- 先只增加配置与派生字段，不改变出块；通过回放确认指标稳定后再打开调制。
- 任何 best 调制都必须写入 `stressBreakdown.bestChaseAdjust` 与 `bestChaseSuppressedReason`，否则无法评审。
- 不允许 UI 自己重新算 zone；统一读 `_lastAdaptiveInsight.bestScoreChase.zone`。

---

## 5. 生命周期与成熟度差异化策略

### 5.1 S0 新入场

主目标：建立“我能消行、我能变好、我愿意再来一局”。

最佳分策略：

- 不把最佳分包装成压力目标，而是包装成成长锚点。
- 第一个 best 应容易形成，但第二次突破不能过于廉价。
- UI 重点是“新纪录”“比上一局更好”“学会了一个技巧”。

建议口径：

- M0：best 是信心锚点；冲刺段只轻微加压，优先保留可消行机会。
- M1/M2：开始展示差距和进步率，但不强调高压。

### 5.2 S1 激活

主目标：形成重复回访和稳定操作习惯。

最佳分策略：

- 让玩家在多局内看到接近 best 的次数增加。
- 失败后给具体策略建议，例如“保留横向空间”“优先处理瓶颈块”。
- 可以引入轻任务：接近最佳 80%、连续 3 局超过历史 50%、完成一次多消。

建议口径：

- M0/M1：最佳分是任务线的一部分。
- M2：开始加入“冲刺段”的可见压力。

### 5.3 S2 习惯

主目标：把最佳分转化为周目标和技能成长目标。

最佳分策略：

- 以个人 best 的百分比做动态目标：70%、85%、100%、110%。
- 开始把“逼近最佳”与更高策略要求绑定，例如空间管理、顺序规划、多消兑现。
- 对 M2/M3 玩家可以提高冲刺段的 `orderRigor` 与解空间压力。

建议口径：

- M1：强调成长任务和清行稳定性。
- M2/M3：强调挑战、自我证明和连局表现。

### 5.4 S3 稳定

主目标：维持核心目标的稀缺性和荣誉感。

最佳分策略：

- 不能让核心玩家轻易破纪录；刷新应成为低频高峰。
- 冲刺段应更明显：更强顺序刚性、更窄解空间、更少无条件保底。
- 失败后提供复盘，而不是单纯减压。

建议口径：

- M2：通过分段挑战维持参与。
- M3/M4：best 是荣誉目标，可引入“传奇局”“高压冲刺”“稳定破线”等称号。

### 5.5 S4 回流

主目标：恢复手感与记忆，不用旧 best 直接压垮玩家。

最佳分策略：

- 回流前 1–3 局不应直接按旧 best 高压追赶。
- 应先给“恢复到旧水平”的台阶目标，例如达到旧 best 的 40%、60%、75%。
- 当玩家重新进入节奏后，再恢复常规冲刺。

建议口径：

- M0/M1：保护局 + 低压目标。
- M3/M4：尊重历史身份，但提示“先热身，再冲旧纪录”。

---

## 6. 当前策略的主要优点

1. **已经把个人最佳接入核心压力管线**  
   `scoreStress` 与 `challengeBoost` 使“挑战自己”进入出块逻辑，而不是只显示在 HUD。

2. **有较完整的公平性护栏**  
   boardRisk、holes、bottleneck、frustration、nearMiss、recovery 都能覆盖高压失控场景。

3. **生命周期 × 成熟度已经影响 stress**  
   S0/S4 与 S2/S3、M0 与 M4 的承压差异已经通过 cap / adjust 落地。

4. **叙事与体感已有纠偏机制**  
   score-push 高压不再被误说成保活，`harvest` 与高压也有合并文案。

5. **突破具备仪式感**  
   刷新最佳有视觉、音效/震动和结算反馈，符合峰终定律。

---

## 7. 当前策略的不足与风险

### 7.1 “接近最佳”的阶段不够显式

当前系统有 `challengeBoost` 和 `best-gap`，但缺少统一的 best-score zone：

- 0–50%：热身
- 50–80%：建势
- 80–100%：冲刺
- 100–125%：超越

没有统一 zone 会导致 UI、出块、策略卡和数据分析各自判断“接近最佳”，后续容易出现口径漂移。

### 7.2 不同生命周期的 best 目标仍可更细

当前 S/M 已调制 stress，但它不是专门为 best-score chase 设计的。

例如：

- S4 回流高 best 玩家可能被旧纪录过早压迫。
- S0 新手可能需要“连续变好”而不是“逼近 best”。
- S3/M4 玩家需要稀缺突破，而不是普通 `+0.15 challengeBoost`。

### 7.3 “不能轻易超越最佳分”的策略证明不足

当前有加压和护栏，但缺少明确的破纪录频率目标。

建议未来用数据定义：

- 有效会话中接近 80% best 的比例。
- 接近 95% best 的比例。
- 刷新 best 的比例。
- 刷新后 1 局 / 3 局 / 7 日留存。
- best 刷新来源：能力成长、救济、随机高 payoff、复活、广告等。

如果没有这些指标，系统很难证明“不是轻易超越”。

### 7.4 冲刺段策略卡还可更贴近“个人最佳”

当前策略卡更偏生存、消行、构型、节奏。接近 best 时，可以增加专属策略语义：

- “冲刺新高：别追单次大消，优先保留 2 个以上落点。”
- “距离最佳很近：先清瓶颈块，避免下一波无位。”
- “已超过最佳：稳住空间结构，把新纪录抬高。”

### 7.5 突破后的“兑现窗口”需要被明确

刷新 best 后，如果系统立刻继续加压，玩家会记住的是“刚破就崩”。当前有 `flowPayoffCap` 和平滑，但尚未把“破纪录后 1–2 轮的荣耀/稳定窗口”作为明确策略状态。

---

## 8. 优化路线：暂不改代码时的策略设计建议

### 8.1 建立 Best Score Zone 统一口径

建议以 §4.5 的 `bestScoreChase.zone` 作为唯一口径，未来实现时不要让 HUD、策略卡、出块和埋点各自推导一套“接近最佳”。最小落地路径如下：

1. `game.js` 在开局锁定 `bestScoreAtRunStart`，所有局内判断只读该快照。
2. `adaptiveSpawn` 派生 `bestRatio / gapRatio / bestZone / overBestRatio`，写入 `_lastAdaptiveInsight`。
3. `stressMeter`、`strategyAdvisor`、`playerInsightPanel` 只消费 `bestZone`，不再重复判断 `score / bestScore`。
4. `moveSequence` 与 session stats 写入 `bestZone`，便于回放与破纪录来源分析。

这样可以把“挑战最佳分”从单点文案升级为完整策略状态。

### 8.2 为不同 S/M 定义 best 策略模板

建议把“挑战最佳分”按 S/M 分层，而非只调 stress。

策略草案：

- S0/M0：目标是连续进步；破纪录可稍容易，但单局结束应强调学习点。
- S1/M0–M1：目标是形成习惯；用 50%/80% best 任务建立重复挑战。
- S2/M1–M2：目标是技能成长；冲刺段开始引入更明确的空间规划压力。
- S2/S3-M3/M4：目标是稀缺突破；使用更窄解空间、顺序刚性和高峰反馈。
- S4 全体：目标是恢复旧水平；先给旧 best 百分比台阶，再恢复冲刺。

### 8.3 定义破纪录频率护栏

建议以“有效会话”为单位定义目标区间：

| 人群 | `best_80_rate` | `best_95_rate` | `best_break_rate` | 设计解释 |
|------|----------------|----------------|-------------------|----------|
| S0/M0 | 中高 | 中 | 中高 | 需要快速建立第一批纪录，但第二次后应逐步收紧 |
| S1/M0–M1 | 高 | 中 | 中 | 重点是反复接近，形成再来一局习惯 |
| S2/M1–M2 | 中高 | 中高 | 中低 | 让玩家经常进入冲刺，但突破需要策略执行 |
| S3/M3–M4 | 中 | 高 | 低 | 核心玩家要经常看到门槛，少数高质量局突破 |
| S4 | 中 | 低到中 | 低 | 回流前三局先恢复旧水平，不追求立刻破纪录 |

这能让“不是轻易超越最佳分”成为可评审指标，而不是主观感觉。

### 8.4 强化失败后的复盘闭环

建议在接近 best 但失败时，结算页优先回答三个问题：

1. 差多少分？
2. 失败来自什么：空间堵塞、瓶颈块、连续未消、误放、过度追多消？
3. 下一局最应该尝试什么？

复盘语义应来自现有事实：

- `bottleneckTrough`：候选块最低落点数。
- `holes` / `boardRisk`：空间结构风险。
- `clearRate` / `frustrationLevel`：清行稳定性。
- `pickToPlaceMs`：操作犹豫或反射式快放。
- `nearFullLines` / `multiClearCandidates`：是否错过兑现窗口。

### 8.5 把“突破”与“救济”分账

破纪录不是不能有救济，而是要知道突破主要来自哪里。

建议未来埋点或复盘中区分：

- 技术型突破：高 clearRate、低 holes、稳定 mobility、少救济。
- 爽感型突破：多消、combo、perfect-clear payoff。
- 救济型突破：frustration / bottleneck / recovery 多次触发后突破。
- 随机型突破：低技能信号但高 payoff，需警惕稀释 best 价值。

主策划可据此决定不同类型突破的占比。

### 8.6 为核心玩家增加“高分后半局”的专属策略

S3/M3+ 与 S3/M4 的高分局不应只靠通用 stress 加压。

建议方向：

- 更强调 `orderRigor` 与 `validPerms`，让顺序规划成为高分门槛。
- 降低无条件 `clearGuarantee`，但保留 boardRisk 急救。
- 提供更强的“传奇局”视觉叙事，而不是普通新纪录反馈。
- 结算页记录“超过个人最佳多少百分比”，形成长期身份资产。

---

## 9. 策略验收指标

### 9.1 体验指标

- 玩家是否知道自己离最佳分有多远。
- 接近最佳但失败时，玩家是否愿意再来一局。
- 刷新最佳是否被记住为“我打得好”，而不是“系统送了我”。
- 高成熟玩家是否感到冲刺段更需要规划。

### 9.2 数据指标

- `best_80_rate`：有效局达到历史最佳 80% 的比例。
- `best_95_rate`：有效局达到历史最佳 95% 的比例。
- `best_break_rate`：有效局刷新历史最佳的比例。
- `post_best_retention`：刷新最佳后的次日 / 7 日回访。
- `near_best_retry_rate`：达到 95% 但未刷新后的下一局开始率。
- `best_source_mix`：技术型 / 爽感型 / 救济型 / 随机型突破占比。
- `best_pressure_abort_rate`：进入 push zone 后快速结束或放弃的比例。
- `near_best_quality_p50/p75`：95% 未破局的质量分位数，防止“差一点”都是低质量挫败。
- `push_suppression_rate`：进入 `push` 后因 boardRisk / bottleneck / recovery 被抑制加压的比例。
- `breakthrough_grace_fail_rate`：刷新最佳后 2 次 spawn 内结束的比例，用于验证 grace window。
- `best_zone_transition`：每局最高进入的 zone 分布，观察玩家是否长期卡在 `build` 或 `approach`。

### 9.3 护栏指标

- S0/M0 的 D1 留存不能因冲分压力下降。
- S4 回流前三局不能因旧 best 压力导致快速流失。
- S3/M4 的破纪录率不能过高，否则长期荣誉感稀释。
- `boardRisk` 高时不得为了冲分继续强加压。
- 破纪录局中的不可解释随机比例不得持续升高。
- `bestChaseSuppressedReason` 为空但 `dangerPressure>=0.72` 的 case 必须为 0。
- `random_like_break` 连续 7 日占比升高时，必须回滚 payoff 或 best 调制实验。
- `rescue_break` 在 S2/S3-M2+ 中持续高于 `skill_break` 时，说明 best 价值被救济稀释。

---

## 10. 后续实施建议

短期（文档与配置评审）：

1. 用 §4.5 的 `bestScoreChase.zone` 作为策划评审口径，统一 UI、策略卡和算法解释语言。
2. 在回放分析中人工标注“接近最佳但失败”的 20–50 局，验证失败原因分类是否足够。
3. 对 S0/S4 与 S3/M4 分别审查当前 `lifecycleStressCapMap` 是否符合 best-score chase 的心理目标。
4. 按 §4.6.2–§4.6.6 拆出 P0 指标 PR：先落 `bestScoreChase`、`nearBestQuality`、`bestChaseSuppressedReason`，暂不改出块结果。

中期（小步实现）：

1. 增加 `bestScoreChase` 派生字段，先只供 UI、策略卡、埋点共用。
2. 增加 near-best 复盘文案，不改变出块逻辑。
3. 增加破纪录来源归因，先只做数据记录。
4. 将突破后 1–2 次 spawn 的稳定窗口接入叙事或轻量调制，验证“刚破就崩”是否下降。
5. 在 `moveSequence` 与 session stats 中沉淀 `bestZone`、`bestBreakSource`、`nearBestQuality`，让回放能复盘每一次 push。

长期（策略算法升级）：

1. 将 `challengeBoost` 从单一公式升级为按 S/M、best zone、boardRisk 分层的策略表。
2. 为核心玩家加入高分后半局的顺序刚性策略模板。
3. 用 A/B 实验校准各生命周期的 `best_break_rate` 与 `near_best_retry_rate`。
4. 将 `best_source_mix` 纳入策略看板，控制“救济型突破”和“随机型突破”的占比。

---

## 11. 与现有文档的关系

- 心理学与休闲游戏体验根基：见 [体验设计基石](./EXPERIENCE_DESIGN_FOUNDATIONS.md)。
- 指标、压力管线、策略卡与叙事：见 [实时策略系统](./REALTIME_STRATEGY.md)。
- 通用 L1–L4 策略体验栈：见 [策略体验栈](./STRATEGY_EXPERIENCE_MODEL.md)。
- S0–S4 / M0–M4 生命周期与成熟度：见 [生命周期与成熟度蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)。
- 难度与自适应策略关系：见 [难度模式](../product/DIFFICULTY_MODES.md)。
