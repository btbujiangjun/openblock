# 自适应出块引擎：10 信号融合 + 爽感兑现

> 本文描述 OpenBlock 的自适应出块（Adaptive Spawn）系统的设计理念、架构、配置与调优指南，方便后续迭代。
>
> **配套阅读**：本文聚焦"策略层"——`stress` 是如何由多信号合成的、`spawnHints` 各字段如何被派生。
> 关于"策略层产出的 hints 如何**翻译到具体 3 个块的选择过程**"（5 阶段流水线、30+ 加权乘子、硬约束循环、实数跑步示例），
> 请阅 [出块算法：三层架构 §2.5 策略 → 出块翻译机制](./SPAWN_ALGORITHM.md#25-策略--出块翻译机制v15516)。

## 目录

- [1. 领域知识基础](#1-领域知识基础)
- [2. 系统架构](#2-系统架构)
- [3. 玩家能力画像（PlayerProfile）](#3-玩家能力画像playerprofile)
  - [3.5 stress 域口径（v1.55.17）](#35-stress-域口径v15517)
- [4. 策略候选库（10 档 Profiles）](#4-策略候选库10-档-profiles)
- [10.6 外部实证基线：SGAZ × Tetris Block Puzzle](#106-外部实证基线sgaz--tetris-block-puzzlev15517)
- [5. 自适应引擎（AdaptiveSpawn）](#5-自适应引擎adaptivespawn)
- [6. 出块提示（SpawnHints）](#6-出块提示spawnhints)
- [7. 配置参考（game\_rules.json）](#7-配置参考game_rulesjson)
- [8. 调优指南](#8-调优指南)
- [9. 数据流与集成点](#9-数据流与集成点)
- [10. 后续迭代方向](#10-后续迭代方向)

---

## 1. 领域知识基础

系统设计基于以下休闲游戏领域的研究成果与行业实践：

### 1.1 心流理论（Csíkszentmihályi Flow Model）

- **核心**：当「挑战」与「技能」匹配时，玩家进入忘我投入的心流状态
- **数据支撑**：自适应难度使 30 天留存提升 22%，玩家人均多玩 1 天、多打 10 局/月（2025 实证研究）
- **落地**：`flowState` 三态判定（bored / flow / anxious）→ 实时调节 stress

### 1.2 差一点效应（Near-Miss Effect）

- **核心**：差 1-2 步失败时续玩欲望最强——超过胜利和惨败（Candy Crush 心理学研究）
- **机制**：将失败重构为「距成功很近」，触发更高心率和多巴胺释放
- **落地（出块层）**：`hadRecentNearMiss` → 下轮投放消行友好块，制造「戏剧性消行」正反馈
- **落地（UI 反馈层，v1.50.1）**：`Grid.getMaxLineFill()` ≥ 0.875（整行/整列差 1 格满）且**体感很差**
  （`frustrationLevel ≥ 4` 或 `anxious` 心流叠加挫败 ≥ 2）才展示 `effect.nearMissPlace`（"再一格就消行"）；
  `clearRate ≥ 0.30` / 动量为正 / 心流顺畅任一即抑制；冷启动 12 次落子内不出；单局上限 1、间隔 ≥ 12 落子且 ≥ 30 s。
  门槛与控频集中在 `web/src/nearMissPlaceFeedback.js` 与 `shared/game_rules.json: adaptiveSpawn.nearMissPlaceFeedback`，
  19 个语言包均覆盖 `effect.nearMissPlace` 短句，不回退 zh-CN。
- **与"无路可走"语义分家（v1.49）**：当 `_handleNoMoves` 触发后会置 `_pendingNoMovesEnd` 互斥锁，
  抑制同帧 near-miss toast，并改用独立的 `effect.noMovesEnd`（"棋盘填满，再来一局！"）展示濒死安抚语，
  避免同一文案"差一点... 再冲一把！"被复用在三个完全不同的语境里。
- **触发-展示一致性（v1.51.1）**：toast hold 时长 2.8 s 远长于一次落子，纯靠"触发瞬间几何条件"
  无法保证整段展示与盘面一致。本版本加双闸门：
  - **A. placement / line binding**：`Grid.getMaxLineFillLines(0.875)` 返回所有 ≥ 阈值的 row/col 列表，
    `shouldShowNearMissPlaceFeedback` 必须验证玩家本次落子至少 1 格 `(x,y)` 落在某条 line 上才放行
    （`reason='placement_not_on_near_full_line'`），杜绝"盘面别处近满 / 本次落子与近失线无关"误触发；
  - **B. 显示期间持续校验**：`_triggerNearMissFeedback` 启动 100 ms 轮询，全局 `maxLineFill` 跌破阈值
    或目标 `targetLine.{type,index}` 不再 ≥ 阈值（被消行 / 被旋洗）→ 立刻加 `.float-near-miss--fading`
    220 ms 透明度+位移过渡提前撤回。`HOLD_MS + FADE_MS + 50 ms` 强制 remove 兜底，timer 在所有路径
    都会 `clearInterval`，不漏。

### 1.3 节奏张弛（Pacing / Tension-Release Cycles）

- **核心**：单调递增的难度让玩家倦怠；3-5 次紧张 → 1-2 次释放的周期最佳
- **类比**：音乐的副歌-间奏结构、电影的高潮-过渡节奏
- **落地**：`pacingPhase`（tension / release）按 spawn 计数周期调控

### 1.4 首局保护（First-Session Dynamics）

- **核心**：首 5 分钟连续 2 次失败 → 仅 7% 重试；有渐进引导 → 41% 留存
- **最佳首次成功率**：新手 65-75%，老手 40-50%
- **落地**：`isInOnboarding` → stress 钳制到 onboarding 档，clearGuarantee=2

### 1.5 贝叶斯快速收敛（Bayesian Player Modeling）

- **核心**：拼图游戏 5 步内即可建立可用的玩家模型（学术实测）
- **落地**：`fastConvergenceAlpha=0.35`，前 5 步比正常更快响应

### 1.6 挫败检测与回弹（Comeback / Rubber-Banding）

- **核心**：连续无消行 ≥ 4 步是流失强信号
- **落地**：`frustrationLevel` ≥ 阈值 → 降压 + clearGuarantee=2

### 1.7 认知负荷（Cognitive Load）

- **核心**：思考时间方差高 → 玩家对特定局面犹豫，认知压力大
- **落地**：`cognitiveLoad`（thinkMs 方差归一化）纳入技能计算

### 1.8 竞品参考

| 竞品 | 关键机制 |
|------|---------|
| Block Blast | 3000-4000 分难度阶跃；板面密度高时投放 L/T/Z 制造压力 |
| Woodoku/1010 | AND-OR 树验证三连块可解；避免不公平死局 |
| Candy Crush | 差一点效应最大化；变长奖励间隔维持多巴胺循环 |

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        game.js（信号采集层）                             │
│  recordSpawn() → recordPlace(cleared, lines, fill) → recordMiss()      │
│  recordNewGame()                                                        │
└────────────────────────────┬────────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               playerProfile.js（能力画像层）                             │
│                                                                         │
│  ┌─ 能力维度 ──────────┐  ┌─ 实时状态 ──────────────────────────┐      │
│  │ skillLevel    0~1   │  │ flowState    bored / flow / anxious │      │
│  │ momentum     -1~1   │  │ pacingPhase  tension / release      │      │
│  │ cognitiveLoad 0~1   │  │ frustrationLevel  连续未消行步数     │      │
│  │ engagementAPM  APM  │  │ hadRecentNearMiss  差一点标志       │      │
│  │ clearRate/comboRate  │  │ isNewPlayer / isInOnboarding        │      │
│  └─────────────────────┘  │ sessionPhase  early / peak / late   │      │
│                           └─────────────────────────────────────┘      │
└────────────────────────────┬────────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              adaptiveSpawn.js（策略引擎层）                               │
│                                                                         │
│  10+ 信号融合：                                                         │
│    difficultyBias + scoreStress + skillAdjust + abilityRiskAdjust      │
│    + flowAdjust + pacingAdjust + topologyPressure + sessionArcAdjust   │
│    + recoveryAdjust + frustrationRelief + comboReward + nearMissAdjust │
│                                                                         │
│  爽感兑现：                                                             │
│    skillLevel + flowState + momentum + nearFullLines + pcSetup         │
│    → delightBoost / perfectClearBoost / iconBonusTarget / delightMode  │
│                                                                         │
│  特殊覆写：新手保护 / 差一点放大                                         │
│                                                                         │
│  输出：shapeWeights（10 档插值）+ spawnHints + V3 共享上下文信号          │
└────────────────────────────┬────────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              blockSpawn.js（出块执行层）                                  │
│                                                                         │
│  spawnHints 消费：                                                      │
│    clearGuarantee  → 三连块中至少 N 个能触发即时消行                     │
│    sizePreference  → 偏小块(-1) / 中性(0) / 偏大块(+1)                 │
│    diversityBoost  → 惩罚同品类重复，增加三连块形状多样性                │
│                                                                         │
│  不变量保持：solvability 检查 + minMobility 门槛                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 文件清单

| 文件 | 层级 | 职责 |
|------|------|------|
| `shared/game_rules.json` | 配置 | 10 档策略权重、节奏参数、参与度参数、心流阈值、爽感兑现参数 |
| `web/src/playerProfile.js` | 画像 | 滑动窗口行为追踪、多维技能计算、状态判定、持久化 |
| `web/src/adaptiveSpawn.js` | 引擎 | 10 信号融合 → stress → 10 档插值 + spawnHints |
| `web/src/bot/blockSpawn.js` | 执行 | 接受 spawnHints，生成三连块（保持 solvability 不变量） |
| `web/src/difficulty.js` | 基础 | 原有 score→stress 映射（被自适应引擎内部调用） |
| `web/src/game.js` | 集成 | 事件采集 + 调用入口 |
| `web/src/spawnModel.js` | 生成式 | 构造启发式/V3 共享上下文，调用 SpawnTransformerV3，并管理 `rule` / `model-v3` 模式 |

---

## 3. 玩家能力画像（PlayerProfile）

### 3.1 数据录入接口

| 方法 | 调用时机 | 采集信息 |
|------|---------|---------|
| `recordSpawn()` | 每轮出块时 | 更新 lastActionTs、spawnCounter |
| `recordPickup()` | 玩家激活候选块（`Game.startDrag` 入口） | 更新 `_pickupAt`，下一次 place/miss 与之相减得 `pickToPlaceMs`（v1.46） |
| `recordPlace(cleared, lines, fill)` | 成功放置后 | thinkMs、**pickToPlaceMs**、消行结果、板面填充率 |
| `recordMiss()` | 拖放失败时 | thinkMs、**pickToPlaceMs**（拖出有效区也算反应代价）、失误计数 |
| `recordNewGame()` | 新局开始 | 重置局内计数器、累加终身局数 |

### 3.2 能力维度

| 维度 | 范围 | 计算方式 | 意义 |
|------|------|---------|------|
| `skillLevel` | 0~1 | 5 维加权合成 + 指数平滑 | 综合技能水平 |
| `momentum` | -1~1 | 窗口前后半 clearRate 差 | 表现趋势（上升/下滑） |
| `cognitiveLoad` | 0~1 | thinkMs 方差 / 阈值 | 认知压力 |
| `engagementAPM` | >0 | 窗口内操作数 / 时间 | 参与活跃度 |
| `clearRate` | 0~1 | 消行次数 / 放置总数 | 消行能力 |
| `comboRate` | 0~1 | 多行消行 / 总消行 | 组合规划力 |
| `missRate` | 0~1 | 失误次数 / 总操作 | 操作精度 |
| `metrics.thinkMs` | ms | 上一动作 → 落子的窗口均值 | 决策耗时（含等系统出块/观察/选块/拖动） |
| `metrics.pickToPlaceMs` | ms / null | startDrag → 落子的窗口均值（剔除观察） | **反应**（v1.46）：纯执行段，反映临场操作熟练度与犹豫 |
| `metrics.reactionSamples` | int ≥ 0 | 窗口内含 pickup 链路的有效样本数 | < `reactionAdjust.minSamples` 时反应信号不参与 stress |

#### skillLevel 计算公式

```
rawSkill = thinkScore × 0.15 + clearScore × 0.30 + comboScore × 0.20
         + missScore × 0.20 + loadScore × 0.15

smoothSkill += α × (rawSkill - smoothSkill)
```

- 前 5 步 α = 0.35（贝叶斯快速收敛）
- 之后 α = 0.15（稳态平滑）

### 3.3 实时状态信号

| 信号 | 类型 | 判定规则 | 对出块的影响 |
|------|------|---------|-------------|
| `flowState` | enum | thinkMs / clearRate / missRate / cognitiveLoad 多条件 | bored→加压, anxious→减压 |
| `pacingPhase` | enum | spawnCounter % cycleLength | tension→微加压, release→减压 |
| `frustrationLevel` | int | 连续未消行步数 | ≥ 4 → 挫败救济 |
| `hadRecentNearMiss` | bool | 上步 fill>0.6 且未消行 | true → 降压 + clearGuarantee=2 |
| `needsRecovery` | bool | fill > 0.82 时激活，持续 4 步 | true → 降压 + 偏小块 |
| `isInOnboarding` | bool | 新玩家 + 前 5 轮 spawn | true → stress 钳制到 -0.15 |
| `sessionPhase` | enum | 经过时间 + spawnCounter | early/peak/late 影响策略微调 |

### 3.4 持久化

- 存储位置：`localStorage` key = `openblock_player_profile`
- 跨局保留：`smoothSkill`、`totalLifetimePlacements`、`totalLifetimeGames`
- 衰减机制：超过 24 小时不玩，技能估计向 0.5 衰减（最多 50%），防止久别玩家难度不匹配
- 局内状态（moves 窗口、计数器等）不持久化，每局重建

### 3.5 stress 域口径（v1.55.17）

**对外归一化 [0, 1]，对内保持 raw [-0.2, 1]，**两侧通过 `(raw + 0.2) / 1.2` 一次线性变换互转。

#### 背景

历史上 stress 标量值域是 `[-0.2, 1]`，由 17 个带符号分量（如 `scoreStress`、`flowAdjust`、`recoveryAdjust`、…）求和后 clamp 而成。**但这个值域对外不直观**：
- 玩家面板 / 运营看板 / 策略卡 / DFV / 文档读者看到 `stress = -0.20` 时无法即刻理解"这是被压到最低还是某种异常"；
- 心智模型上"压力指数"普遍认为应为 `[0, 1]`。

#### 决策（B-Clean）

| 维度 | 对外（玩家面板 / DFV / 策略卡 / 文档 / `_adaptiveStress` / `insight.stress`） | 对内（算法源码阈值 / `stressBreakdown.finalStress` / `prevAdaptiveStress` / ML 特征） |
|------|----------------------------------------------------------|--------------------------------------------------------------------|
| 值域 | **`[0, 1]`** 归一化（v1.55.17 起）                           | `[-0.2, 1]` raw（保持不变）                                          |
| 字段名 | `layered._adaptiveStress`、`insight.stress`                | `layered._adaptiveStressRaw`、`stressBreakdown.finalStress`        |
| 数学 | `norm = clamp01((raw + 0.2) / 1.2)`                       | 算法内部 17 个 adjust 求和、25+ 比较阈值、profile 锚点、`lifecycle cap` 表、`game_rules.json` 一律保留 raw |

源码内部所有 `if (stress < 0.7)`、`Math.min(stress, 0.85)`、`flowPayoffStressCap = 0.79` 等阈值**保留 raw 写法**，行内加 "raw 0.7 ≈ norm 0.75" 提示，避免代数变换带来的大量"丑数字"（如 `0.0417`、`0.5833`、`0.8333`）破坏调参直觉与训练时特征分布。

#### 常用锚点对照

| 语义 | raw（内部） | norm（对外） |
|------|------------|-------------|
| 完全减压（onboarding profile） | `-0.20` | `0` |
| baseline / 中性（无任何 adjust） | `0` | `≈ 0.1667`（即 `1/6`） |
| `comfort` profile | `0` | `≈ 0.1667` |
| `balanced` profile（心流核心） | `0.4` | `0.5` |
| `_stressTarget` 中性锚 | `0.325` | `≈ 0.4375` |
| `variety` profile | `0.5` | `≈ 0.5833` |
| `challenge` profile | `0.65` | `≈ 0.7083` |
| `challengeBoost` 饱和门槛 | `0.7` | `0.75` |
| `flowPayoffStressCap`（兑现窗口硬顶） | `0.79` | `0.825` |
| `challengeBoost` 上限 | `0.85` | `0.875` |
| `intense` profile | `0.85` | `0.875` |
| 全局硬顶 | `1.0` | `1.0` |

#### stressMeter 6 档（v1.55.17 起按 norm 域划分）

| 档位 | norm 区间 | raw 等价区间 |
|------|----------|-------------|
| `calm`（放松） | `[-∞, 0.125)` | `[-∞, -0.05)` |
| `easy`（舒缓） | `[0.125, 0.333)` | `[-0.05, 0.20)` |
| `flow`（心流） | `[0.333, 0.542)` | `[0.20, 0.45)` |
| `engaged`（投入） | `[0.542, 0.708)` | `[0.45, 0.65)` |
| `tense`（紧张） | `[0.708, 0.833)` | `[0.65, 0.80)` |
| `intense`（高压） | `[0.833, ∞)` | `[0.80, ∞)` |

#### 例外（继续使用 raw 域的下游）

| 下游 | 字段 | 原因 |
|------|------|------|
| `game.js _spawnContext.prevAdaptiveStress` | raw `[-0.2, 1]` | `adaptiveSpawn.smoothStress(current, ctx, ...)` 的 `current` 是 raw 域，写入与读取必须同单位，否则 `maxStepUp/Down` 步长被错误压缩 |
| `spawnModel.js` ML 特征 `[20-23]` `a.stressRaw` | raw `[-0.2, 1]` | SpawnTransformerV3 模型权重按 raw 训练，norm 域会破坏特征分布尺度 |
| `spawnModel.computeSpawnTargetDifficulty` 公式 `0.15 * stress` | raw | 系数按 raw 域校准（早期回归），切到 norm 会改变量纲 |
| `stressBreakdown.finalStress` | raw | 调试 / 回放 / 训练数据落盘字段，与 17 个 `*Adjust` 同口径便于审计 |

实现位置：`web/src/adaptiveSpawn.js` 顶部 `normalizeStress / denormalizeStress` 函数（导出）；常量 `STRESS_NORM_OFFSET = 0.2`、`STRESS_NORM_SCALE = 1.2`；契约测试 `tests/stressNormalization.test.js`。小程序平行实现：`miniprogram/core/adaptiveSpawn.js` 同步导出。

#### stress 感知化层 4 档反馈渠道（v1.57）

> **背景**：v1.55~v1.56 算法层做了大量 stress 精算（lifecycle cap / occupancyDamping / smoothStress / flowPayoffCap / challengeBoost / pbOvershootBoost 等），但用户反馈 "stress 指标不太能体现到玩家感受上来"。审计发现 5 个本可承载 stress 感知的渠道（HUD/视觉/音效/震动/出块）中只有"出块"生效，其余 4 个全部断层。v1.57 通过 `stressAmbience.js` 系统补全玩家感知通道。详见 `docs/player/BEST_SCORE_CHASE_STRATEGY.md` §5.α.11。

| 档位 | 渠道 | 技术实现 | 玩家体感 |
|------|------|----------|----------|
| **A** | 棋盘氛围光 | `#game-wrapper::before` outer box-shadow 颜色随 `--stress-ambience-glow` 6 档变化（冷青→暗红） | 棋盘外缘色相潜意识感知 |
| **B** | 呼吸节奏 | `--stress-ambience-breath-ms` 驱动 keyframe 周期（`[1500, 4200]` ms 6 档） | 低 stress 4.2s 缓慢 / 高 stress 1.5s 急促 |
| **C** | 消行震动幅度 | 装饰 `renderer.setShake`，intensity × `_stressShakeMultiplier` (`[0.85, 1.30]`) | 高压震感更强 / 低压轻柔 |
| **D** | 音频低通滤波 | BiquadFilter 插入 `audioFx.master → destination`，cutoff `[4000, 14000]` Hz | 高压时 BGM/音效"闷" / 低压明亮 |

阈值与 stressMeter.STRESS_LEVELS 严格同源（单一真理源）；契约测试 `tests/stressAmbience.test.js`（43 用例）。

**严格护栏（v1.56.3 策略隐性原则）**：
- 不向主 HUD 暴露 stress 数字/标签（stressMeter 仍只在 insightPanel 内）
- `stressAmbience.js` 不导出任何 `render*` / `show*` / `*Label` / `*Text` 函数（契约测试白名单）
- 不写 textContent / innerHTML（所有反馈通过 CSS 变量 / 装饰器 / 音频参数）
- `prefers-reduced-motion` 关闭呼吸动画 / `:root.quality-low` 关闭氛围光（降级路径）

#### stress → 出块算法的 5 条传导路径与 v1.57.1 精算细化

> v1.57 §5.α.11 解决了"玩家显性感知"，但 stress 在算法层的传导仍有台阶感。v1.57.1 对 5 条传导路径做精算细化。详见 `docs/player/BEST_SCORE_CHASE_STRATEGY.md` §5.α.12。

| 传导路径 | 实现位置 | 状态 |
|---------|---------|------|
| **A. profile 插值** | `interpolateProfileWeights(profiles, stress)` — 在 10 档 profile 间连续插值 shapeWeights | ✅ 平滑 |
| **B. spawnTargets 投影** | `deriveSpawnTargets(stress)` — 投影到 6 轴目标（shapeComplexity / solutionSpacePressure / clearOpportunity / spatialPressure / payoffIntensity / novelty） | ✅ 平滑 |
| **C. targetSolutionRange 软过滤** | `solutionDifficulty.ranges` 按 stress 选区间，blockSpawn 在三连块通过 sequentiallySolvable 后用 DFS 估算解叶子数软过滤 | ⚠️ v1.57.1 P1 新增 '渐紧' 档（minStress=0.5, max=64）填补 0.5~0.6 断档；v1.57.2 在此轴之外新增 **targetHoleIncrement 第二维度**（详见下文）|
| **D. orderRigor 顺序刚性** | `stressTerm` 控制 `orderRigor`，进而决定 `orderMaxValidPerms` ∈ [2, 4] 软过滤 | ⚠️ v1.57.1 P0 改用 softplus ramp（smoothness=0.08）消除 0.55 跨阈值台阶；P2 D4 高 stress 强锁死（+0.25 boost） |
| **E. spawnIntent 离散意图** | 6 档枚举（relief/engage/harvest/pressure/flow/maintain），决定 hints 套装与 stressMeter 叙事 | ⚠️ v1.57.1 P3 新增 'sprint' 中间档（stress ∈ [0.45, 0.55)）平滑 maintain → pressure 过渡 |

##### P0 orderRigor softplus 公式

```
旧:  stressTerm = max(0, stress - threshold) * orderScale         // 一阶不连续
新:  stressTerm = softplus((stress - threshold) / smoothness)
                * smoothness * orderScale                          // 一阶可导
```

其中 `softplus(x) = ln(1 + e^x)`；smoothness=0.08 让 threshold ± 0.16 范围内平滑过渡，远离 threshold 时与旧公式渐近一致（高 stress 段强约束效果不变）。

数值对照（threshold=0.55, orderScale=1.6）：

| stress | 旧 stressTerm | 新 stressTerm |
|--------|--------------|--------------|
| 0.40   | 0            | 0.018        |
| 0.55   | 0            | 0.089        |
| 0.70   | 0.240        | 0.258        |
| 0.85   | 0.480        | 0.484        |

##### P2 D4 段双重 boost 设计

```
弱档 orderBoostInD4=0.08          : pbOvershootActive=true（任意 stress）
强档 orderBoostInD4HighStress=0.25 : pbOvershootActive=true AND stress ≥ 0.85
```

弱档+强档累加（`pbExtremeOrderBoost = max(0.08)` + `pbOvershootOrderBoost = 0.25`）让 orderRigor 总和 ≥ 0.55 → `maxValidPerms = round(4 - 2 * orderRigor) ≤ 2`，顺序刚性彻底锁死。

##### P3 sprint 优先级链

```
relief > engage > harvest > pressure > sprint > flow > maintain
```

- sprint 低于 pressure：challengeBoost > 0 时仍走 pressure
- sprint 高于 flow / maintain：避免 stress=0.5 落入"看起来比较轻松"误导叙事
- sprint hints：`sizePreference +0.10` / `multiClearBonus ≥ 0.40` / `clearGuarantee` 维持不削减

##### 配置位置

| 配置 | 路径 | 默认值 |
|------|------|--------|
| P0 softplus smoothness | `adaptiveSpawn.topologyDifficulty.orderRigorStressSmoothness` | 0.08 |
| P1 sprint solutionRange 档 | `adaptiveSpawn.solutionDifficulty.ranges[3]`（minStress=0.5, label="渐紧", min=1, max=64） | — |
| P2 D4 强锁死 boost | `adaptiveSpawn.pbChase.overshoot.orderBoostInD4HighStress` | 0.25 |
| P2 D4 高 stress 阈值 | `adaptiveSpawn.pbChase.overshoot.orderHighStressMin` | 0.85 |
| P3 sprint intent | `adaptiveSpawn.sprintIntent`（enabled / minStress / maxStress / sizePreferenceShift / multiClearBonusFloor） | true / 0.45 / 0.55 / 0.10 / 0.40 |

契约测试：`tests/adaptiveSpawnV1571.test.js`（19 用例）。

##### 与 v1.57 感知化层的协同（玩家体感双闭环）

| stress 区间 | §5.α.11 感官反馈（显性） | §5.α.12 算法精算（潜意识） |
|------------|------------------------|--------------------------|
| [0.45, 0.55) | 氛围光 flow→engaged；呼吸 3.0s→2.4s | spawnIntent='sprint'；solutionRange max=64 |
| [0.55, 0.85) | 氛围光 tense；呼吸 1.9s；震动 ×1.20；音频低通 5.5kHz | orderRigor softplus 平滑上升；spawnIntent='pressure'；solutionRange max=32 |
| ≥ 0.85 + D4 | 氛围光 intense；呼吸 1.5s；震动 ×1.30；音频低通 4.0kHz | orderRigor + pbOvershootOrderBoost=0.25 → maxValidPerms=2；solutionRange max=12 |

#### v1.57.2 第二维度：targetHoleIncrement（空洞强迫度）

> 在 `targetSolutionRange`（解空间宽度）之外新增 `targetHoleIncrement`（最干净放法的新空洞数），形成"解空间宽度 × 空洞强迫度"双轴 stress 投射。详见 `docs/player/BEST_SCORE_CHASE_STRATEGY.md` §5.α.13。

##### 算法核心

```
function dfsCountSolutions(grid, perm, depth, accum, budget):
    if depth >= 3:                              // 叶子节点
        accum.count++
        after = countIsolatedHoles(grid)        // O(n²×4)≈256 ops
        delta = max(0, after - accum.baseHoles) // 消行净降 → 0
        accum.minHoleIncrement = min(accum.minHoleIncrement, delta)
        return
```

`evaluateTripletSolutions` 返回值新增 `minHoleIncrement` / `meanHoleIncrement`。

##### 为什么选"孤立空格"作 hole 口径

| 候选口径 | 性能 | OpenBlock 语义 | 选用 |
|---------|------|-------------|------|
| Tetris stacking | O(n²) | ✗ OpenBlock 无重力，"被上方堵住"非物理 hole | 否 |
| `countUnfillableCells` | O(shapes × n²) ≈ 16k ops | ✓ 严谨 | 否——DFS 内 16k × 64 leaves × 22 attempts ≈ 22M ops/spawn 太重 |
| **孤立空格（四面非空）** | O(n²×4) ≈ 256 ops | ✓ 玩家心智里的"漏洞"——必须 1×1 才能填 | **是** |

##### `holeIncrement.ranges` 档位（与 P1 锚点对齐）

| stress | label | minIncrement | maxIncrement | 设计意图 |
|--------|------|-------------|-------------|---------|
| [-1.0, 0.35) | 干净 | null | **0** | 必有 0 新空洞解 |
| [0.35, 0.5) | 宽容 | null | **1** | 允许至多 1 新空洞 |
| [0.5, 0.6) | 渐紧 | null | **2** | 允许至多 2 新空洞 |
| [0.6, 0.8) | 紧张 | **1** | null | 强迫至少 1 新空洞 |
| [0.8, 1.0] | 极限 | **2** | null | 强迫至少 2 新空洞（D4 段透出生命周期）|

##### blockSpawn 软过滤分支

```javascript
if (earlyAttempt && targetHoleIncrement && !solutionMetrics.truncated) {
    const minInc = solutionMetrics.minHoleIncrement;
    if (Number.isFinite(minInc)) {
        if (targetHoleIncrement.max != null && minInc > targetHoleIncrement.max) {
            diagnostics.solutionRejects.holeTooMany++;  continue;
        }
        if (targetHoleIncrement.min != null && minInc < targetHoleIncrement.min) {
            diagnostics.solutionRejects.holeTooClean++; continue;
        }
    }
}
```

- 与 `targetSolutionRange` 同窗口（`attempt < 60% × MAX_SPAWN_ATTEMPTS`）；宽松阶段 fallback 保证 spawn 不死锁
- `truncated=true` / `minHoleIncrement === Infinity` 跳过过滤
- diagnostics 新增 `solutionRejects.holeTooMany` / `holeTooClean` 字段

##### 双轴矩阵

| stress | targetSolutionRange | targetHoleIncrement | 玩家体感 |
|--------|-------------------|---------------------|---------|
| 0.0 | 解 ≥ 4 | 新空洞 ≤ 0 | 多种放法 + 都干净 |
| 0.4 | 解 ≥ 2 | 新空洞 ≤ 1 | 还有得选 + 可能吞 1 洞 |
| 0.55 | 解 ≤ 64 | 新空洞 ≤ 2 | 解数受限 + 接受 2 洞 |
| 0.7 | 解 ≤ 32 | 新空洞 ≥ 1 | 解数少 + **必须**吞 1 洞 |
| 0.9 | 解 ≤ 12 | 新空洞 ≥ 2 | 解数极少 + **必须**吞 2 洞 |

两轴对玩家是独立可感的两个难度信号——宽度变化 = "我没几种选了"（认知收窄），强迫度变化 = "怎么放都得带漏洞"（结构焦虑）。

##### 配置位置 + 测试

| 配置 | 路径 | 默认值 |
|------|------|--------|
| ranges 数组 | `adaptiveSpawn.solutionDifficulty.holeIncrement.ranges` | 5 档（干净/宽容/渐紧/紧张/极限） |
| enabled 开关 | `adaptiveSpawn.solutionDifficulty.holeIncrement.enabled` | true |

契约测试：`tests/holeIncrementFilter.test.js`（15 用例）。

##### 三层协同（v1.57 → v1.57.1 → v1.57.2）

| 玩家体验感 | §5.α.11 感官（显性）| §5.α.12 算法（潜意识）| §5.α.13 算法（潜意识）|
|----------|------------------|-------------------|-------------------|
| 心流期（0.2~0.45）| 氛围光绿、呼吸缓慢 | spawnIntent='maintain'；解空间宽 | 必有干净解（max=0）|
| 渐紧期（0.45~0.55）| 氛围光暖琥珀、呼吸 2.4s | spawnIntent='sprint'；max=64 | 允许 ≤2 新空洞（"渐紧"）|
| 高压期（0.55~0.85）| 氛围光橙红、震动 ×1.20 | spawnIntent='pressure'；max=32 | 强迫 ≥1 新空洞（"紧张"）|
| 极限期（≥0.85，D4）| 氛围光深红、音频 4kHz | orderRigor+0.25 → maxValidPerms=2 | 强迫 ≥2 新空洞（"极限"）|

#### v1.57.3 多轴扩展：9 维 stress→算法 难度投射

> 在 v1.57.2 双轴（`targetSolutionRange` × `targetHoleIncrement`）之外，再引入 9 个 O(n²) 廉价度量，把 stress 投射从 2 轴扩展到 **11 轴**。设计动机：v1.57.2 双轴的过滤约束在中段 stress（0.4~0.6）不够锐利，玩家从 D1 跳到 D2 的"压迫感"切换不显著。详见 `docs/player/BEST_SCORE_CHASE_STRATEGY.md` §5.α.14。

##### 9 维全景

| # | `spawnHints.target*` | 玩家心智轴 | DFS 内代价 | 配置子节 |
|---|---|---|---|---|
| ① | `targetMaxHoleIncrement` | 专注度税上界（"随便放也能干净 vs 必须专心"）| O(n²×4)/叶子 | `solutionDifficulty.maxHoleIncrement` |
| ② | `targetEndFillRatio` | 空间窒息感（剩余决策窗口收窄）| O(n²)/叶子 | `endFillRatio` |
| ③ | `targetNearFullDelta` | 消行节律（rhythmPhase 直接注入 spawn 算法）| O(n²×2)/叶子 | `nearFullDelta` |
| ④ | `targetFirstMoveSurvivorRatio` | 试错代价（第一手必须想清楚）| DFS root 标记 | `firstMoveSurvivor` |
| ⑤ | `targetSolutionDiversity` | 解多样性陷阱（perPermCounts CV）| 零成本 | `solutionDiversity` |
| ⑥ | `targetEndFlatness` | 凹凸审美焦虑（列高方差）| O(n²)/叶子 | `endFlatness` |
| ⑦ | `targetEndDangerColumns` | 爆顶预警（接近 game over 信号）| O(n²)/叶子 | `endDangerColumns` |
| ⑧ | `targetVisualClutter` | 颜色边界审美（花花绿绿 vs 聚团）| O(n²×2)/叶子 | `visualClutter` |
| ⑨ | `targetHoleIncrementGap` | 专注度税差距 max−min（"专心则过、走神则崩"）| 零成本 | `holeIncrementGap` |

总代价：~6 个 O(n²) 调用 × 64 叶子 ≈ 25k ops/triplet（DFS 入栈相比 leafCap 自身代价完全可忽略）。base 度量在评估开始一次性计算，DFS 内只算 delta/绝对值。

##### 关键设计决策

| 决策 | 原因 |
|---|---|
| 单边强约束 / 单边宽松 | 低 stress 段 max 强约束（保护玩家）/ 高 stress 段 min 强约束（强迫面对压力源）；避免双边过严导致 spawn 失败率飙升 |
| 9 维彼此独立、不重叠 | ①⑨ 都和"空洞"相关但语义独立——`targetHoleIncrement.min` 是最优解脏度下限、`targetMaxHoleIncrement.min` 是最差解脏度下限、`targetHoleIncrementGap.min` 是 max-min 差距 |
| 廉价度量优先 | **不用**：`countUnfillableCells` (O(shapes×n²) 太重)、真正的 lookahead spawning (O(shapes³) 不可行)、颜色饱和度等需外部模型的指标 |
| 策略仍然隐性 | 9 维全部只在 `playerInsightPanel` 诊断视图展示数值；主 HUD 只有出块本身 |
| 与 v1.57.2 共享 stress | 9 维派生器全部使用 `solutionStress`，保证多轴对 stress 单调一致 |
| 共享 activationFill 守卫 | 各维度全部走 `solutionDifficulty.activationFill = 0.45` 整体启用阈值 |

##### diagnostics 透传

| 字段 | 位置 | 内容 |
|---|---|---|
| `_target{Max,Gap,Fill,Near,Survivor,Diversity,Flat,Danger,Clutter}` | adaptive 顶层 | `{min, max, label}` 或 null |
| `spawnHints.target*` | adaptive.spawnHints | 同上（供 blockSpawn 消费）|
| `layer1.target*` | blockSpawn diagnostics | 透传上游 hints |
| `solutionRejects.{maxHoleTooMany, maxHoleTooClean, holeGapTooNarrow, holeGapTooWide, fillTooHigh, fillTooLow, nearFullDeltaTooHigh, nearFullDeltaTooLow, survivorTooHigh, survivorTooLow, diversityTooHigh, diversityTooLow, flatnessTooHigh, flatnessTooLow, dangerColsTooHigh, dangerColsTooLow, clutterTooHigh, clutterTooLow}` | blockSpawn diagnostics | 18 个新计数器（9 维 × min/max 2 侧）|

##### 四层协同（升级版）

v1.57.3 之后 stress → 4 个独立可感维度：

| 玩家体验感 | §5.α.11 感官 | §5.α.12 算法 | §5.α.13 算法 | §5.α.14 算法（v1.57.3 新增） |
|----------|-----------|----------|-----------|-----------|
| 心流期（0.2~0.45）| 氛围光绿、呼吸缓慢 | spawnIntent=maintain | 必有干净解（max=0）| `endFillRatio≤0.45 / nearFullDelta≥0.5 / survivor≥0.6 / dangerCol≤2 / flatness≤2 / clutter≤2` |
| 渐紧期（0.45~0.55）| 氛围光暖琥珀 | spawnIntent=sprint | 允许 ≤2 新空洞 | 中性（多数维度不激活）|
| 高压期（0.55~0.85）| 氛围光橙红、震动 ×1.20 | spawnIntent=pressure | 强迫 ≥1 新空洞 | `maxHole≥1 / fill≥0.50 / nearFullDelta≤0.5 / survivor≤0.7 / flatness≥3 / dangerCol≥1` |
| 极限期（≥0.85，D4）| 氛围光深红 | orderRigor+0.25 | 强迫 ≥2 新空洞 | `maxHole≥2 / gap≥3 / fill≥0.65 / nearFullDelta≤-0.5 / survivor≤0.5 / dangerCol≥2 / clutter≥2` |

契约测试：`tests/spawnDimensionalStress.test.js`（18 用例）。

#### v1.57.4 决策快照增量刷新：消除 DFV / stressMeter 文案与盘面的"快照滞后"

> 用户反馈：DFV 显示"盘面具备消行机会"、stressMeter 显示"识别到密集消行机会"，但截图盘面占用 25%、近满数为 0——明显与盘面不符。
>
> 根因：`_lastAdaptiveInsight.spawnIntent` 与 `_lastAdaptiveInsight.spawnDiagnostics.layer1` 是 `spawnBlocks()` 调用时的"决策快照"，而 `spawnBlocks` 只在 dock 三块全部消化后触发。玩家在 dock 周期内的放置 / 消行不会刷新这两个字段，所有基于 insight 的展示文案（DFV reason / stressMeter buildStoryLine / HARVEST_NARRATIVE_BY_DENSITY）都会读到过期的几何信号。

##### 修复架构

| 层 | 改动 | 文件 |
|---|---|---|
| **逻辑抽取** | `deriveSpawnIntent({ playerDistress, forceReliefIntent, afkEngageActive, challengeBoost, delightMode, rhythmPhase, stress, sprintCfg, geometry, pcSetupMinFill })` 纯函数 —— 让 `resolveAdaptiveStrategy` 与 game 层 `_refreshIntentSnapshot` 共用同一套优先级（relief→engage→harvest→pressure→sprint→flow→maintain）| `web/src/adaptiveSpawn.js` |
| **几何快照** | `snapshotInsightGeometry(grid, dockShapePool)` 函数 —— 返回 `{ fill, holes, nearFullLines, multiClearCandidates, pcSetup }`，复用 `analyzeBoardTopology` + `_countMultiClearCandidatesFromShapePool` + `analyzePerfectClearSetup`；总成本 ~3 倍 O(n²)，远低于每帧渲染开销 | `web/src/adaptiveSpawn.js` |
| **次发缺陷修复** | `_mergeLiveGeometrySignals` 补 `pcSetup` 实时重算 —— 旧实现只刷新 `nearFullLines` / `multiClearCandidates`，pcSetup 残留快照会让 17% 散布盘面消行后仍命中 `pcSetup ≥ 1 && fill ≥ 0.45` 分支 | `web/src/adaptiveSpawn.js` |
| **决策侧缓存** | `resolveAdaptiveStrategy` 返回值新增 `_intentInputs`（含 9 个决策侧不变量），`_captureAdaptiveInsight` 落到 `_lastAdaptiveInsight._intentInputs` 供 game 层增量重判时复用 | `web/src/adaptiveSpawn.js` + `web/src/game.js` |
| **增量刷新入口** | game.js 新增 `_refreshIntentSnapshot()`，在两处调用：(1) `_handlePlace` 内 `grid.place` 之后；(2) `playClearEffect.animate` 末尾、`spawnBlocks` 之前 | `web/src/game.js` |

##### 刷新字段边界（重要约束）

| 字段 | 是否刷新 | 原因 |
|---|---|---|
| `spawnIntent` / `spawnHints.spawnIntent` | ✅ 增量重判 | 是 DFV / stressMeter 直接读的"对外口径"，必须与玩家盘面同步 |
| `spawnDiagnostics.layer1.{fill, holes, nearFullLines, multiClearCandidates, pcSetup}` | ✅ 实时快照 | stressMeter `buildStoryLine` 的 geometry 入参 + DFV 几何 chip 读取源 |
| `spawnHints.{sizePreference, clearGuarantee, targetSolutionRange, targetHoleIncrement, target*9 维}` | ❌ 不刷新 | 描述【已经出在 dock 里的三块】是按什么策略生成的，玩家放置不改变它——刷新等于撒谎"这批块是按新意图生成的" |
| `stress` / `stressBreakdown` / `pacingPhase` / `delightMode` / `sessionArc` | ❌ 不刷新 | 这些是 spawn 决策时刻的"心情"快照，需要在下一次 `spawnBlocks()` 时整体重算（避免心情维度的回灌 noise）|

##### 决策侧不变量与几何敏感量分离

`deriveSpawnIntent` 的入参分为两类：

- **决策侧不变量（来自 `_intentInputs`）**：`playerDistress / forceReliefIntent / afkEngageActive / challengeBoost / delightMode / rhythmPhase / stress / sprintCfg / pcSetupMinFill` —— 在 dock 周期内不变，由 spawn 时计算一次并缓存
- **几何敏感量（来自 `snapshotInsightGeometry`）**：`geometry.{nearFullLines, pcSetup, boardFill}` —— 玩家每次放置后实时刷新

这套分离让"决策意图"与"几何反映"解耦，增量重判只重算 harvestable 子条件，性能开销 ~5 µs/次。

##### 契约测试

`tests/spawnIntentSnapshot.test.js`（28 用例）：

- **A. deriveSpawnIntent 7 分支优先级**：覆盖完整优先级链与边界（sprint 区间端点）
- **B. snapshotInsightGeometry 几何正确性**：空盘 / 单近满 / 双近满 / null 保护 / 与 `analyzePerfectClearSetup` 口径一致
- **C. `_mergeLiveGeometrySignals` pcSetup 补漏**：spawn 时 ctx.pcSetup 必须来自实时 grid 重算
- **D. 集成回归**：harvest 快照 + 玩家消行 → 重判应切换；maintain 快照 + 玩家堆出近满 → 重判应升级 harvest
- **E. `_intentInputs` 契约**：`resolveAdaptiveStrategy` 返回 `_intentInputs` 含 deriveSpawnIntent 全部决策侧字段；用相同 geometry 重判结果与 `layered._spawnIntent` 一致

##### 多端同步

| 端 | deriveSpawnIntent | snapshotInsightGeometry | _mergeLiveGeometrySignals.pcSetup | _refreshIntentSnapshot |
|---|---|---|---|---|
| Web | ✅ | ✅ | ✅ | ✅（`web/src/game.js`）|
| 微信小程序 | ✅（mp 无 forceReliefIntent，与改前同行为）| ✅ | ✅ | N/A（mp 当前无 DFV / stressMeter 展示层订阅 insight）|
| Capacitor 移动端 | 复用 web 构建 | 复用 web 构建 | 复用 web 构建 | 复用 web 构建 |
| RL PyTorch | 仅消费 `spawnIntent` 作为 one-hot 训练特征，不重新派生（无需同步）|

#### v1.57.5 决策快照展示层一致性治理：6 项 UI 同源 bug 修复

> v1.57.4 已经把决策层（`spawnIntent` / `spawnDiagnostics.layer1`）做到玩家每次放置后增量刷新，但截图复盘发现 UI 展示侧还有 6 项一致性缺陷分布在 DFV / stressMeter / chip 三处。本节是 v1.57.4 的**展示层补完**，从渲染管线、文案分级、视觉降级三个维度收口。

##### 6 项 bug 与修复对应表

| # | 严重度 | 现象 | 根因 | 修复 |
|---|--------|------|------|------|
| A | P0 | DFV 左侧"占盘 0.40" vs 底部 sparkline"占盘 0.69" 同帧两值 | `_dfvFingerprint` 只看 insight + profile 决策侧字段，漏算 `liveBoardFill`/`liveClearRate`；指纹不变 → 左侧节点被去抖跳过重渲染 | `_dfvFingerprint(insight, profile, { boardFill, clearRate })` 把实时几何按 0.01 量化纳入指纹；同时让 `_refreshIntentSnapshot` 同步刷新 `insight.boardFill` 顶层字段 |
| B | P0 | spawnIntent=relief 时叙事一律"盘面通透又是兑现窗口..."，但盘面实际 fill=0.69 不通透 | relief 是 6 项 `playerDistress` 信号累加触发，文案却暗示了 friendlyBoardRelief（不在 distress 内）的几何 | `RELIEF_NARRATIVE_BY_REASON` + `classifyReliefReason(breakdown, fill)` 按 endgame / friendly / hole / boardRisk / bottleneck / frustration / default 七档分级；**friendly 档加 fill < 0.5 守卫**避免"通透"在密集盘面撒谎；`SPAWN_INTENT_NARRATIVE.relief` 默认文案收窄为中性减压语义 |
| F | P0 | DFV 左侧"消行率 —" vs 底部"消行率 0.31" 同帧两值 | 同 A 同根 —— `liveClearRate` 也漏算 | A 修复一并解决 |
| D | P1 | spawnIntent=relief 时"AFK 介入" chip 仍高亮，但 AFK 已被 relief 优先级覆盖 | DFV decision flags 只看信号本身，不看是否被当前 intent 覆盖 | chip 计算 `overriddenAfkEngage = (intent === 'relief') && afkEngage`，标记 `.dfv-flag--overridden`：CSS 半透明 + 删除线 + title 提示"信号已激活，但本帧被更高优先级意图（relief）覆盖" |
| E | P1 | DFV 调香提示同时高亮"策展紧 / 兑现 / 心流·兑现"等 6+ 项 chip 无层级 | hints 是多维独立投射，玩家会把它误解为"7 个独立决定"互相打架 | 在 hints 列表顶部插入"主导意图锚"高亮行，颜色随 intent 变化（与 SPAWN_INTENT_COLOR 同源），title 写明"下方各 chip 是当前主导意图下的多维状态描述" |
| G | P2 | stress=0.15 (😊 笑脸) + boardFill=0.69 (密集盘面)，视觉与情绪信号反差 | `getStressDisplay` 只看 stress，不看盘面实际占用 | 新增 crowded 变体：`stress < 0.333 (calm/easy)` + `boardFill ≥ 0.65` → 切到 😅 + "（盘面吃紧）" + "盘面较密..." vibe；优先级：挣扎中 > crowded > 救济中 |

##### 关键设计原则

1. **同源治理**（A/F 合并修复）：DFV 节点 / sparkline / playerInsightPanel 三处展示同一指标必须从同一个 `liveBoardFill` 源头出发，去抖指纹也要把"实时几何"维度纳入
2. **文案与几何对齐**（B）：任何含"盘面 X"几何描述的叙事都必须有 fill 守卫，避免数学正确但情绪信号撒谎
3. **视觉降级 vs 物理隐藏**（D）：被覆盖的 chip 不应直接隐藏（玩家会丢失"系统检测到了什么信号"的诊断信息），应当半透明 + 删除线表达"激活但未生效"
4. **锚点 vs 平铺**（E）：多维度 chip 列表必须有主导维度锚，避免玩家把投射当成并列决定
5. **情绪反馈反差守卫**（G）：低 stress + 高 fill 是"系统在减压但盘面其实紧"的真实矛盾，emoji 必须承认这个反差而不是单纯按 stress 笑脸

##### 契约测试

`tests/insightConsistency_v1575.test.js`（32 用例）：
- **§A/F**：DFV 指纹对 `liveBoardFill` / `liveClearRate` 敏感，0.01 级抖动量化稳定
- **§B**：`classifyReliefReason` 七档分类全覆盖，含 friendly 守卫 fill≥0.5 降级、endSessionDistress 优先级、空 breakdown 兜底；`buildStoryLine` 在 intent=relief 路径走分级文案
- **§G**：`getStressDisplay` 紧盘面 crowded 变体；优先级（挣扎中 > crowded > 救济中）
- **§D**：AFK chip overridden 判定纯逻辑契约

`tests/stressMeter.test.js` 两条 v1.23/v1.24 旧测试被更新到 v1.57.5 reason 分级新行为（不再期望返回旧"盘面通透"硬编码文案）。

##### 多端同步

| 端 | DFV 指纹 / chip 渲染 | RELIEF 分级文案 | 紧盘面 emoji 守卫 |
|---|---|---|---|
| Web | ✅ | ✅ | ✅ |
| 微信小程序 | N/A（无 DFV）| N/A（无 stressMeter）| N/A（无 stressMeter）|
| Capacitor 移动端 | 复用 web 构建 | 复用 web 构建 | 复用 web 构建 |
| RL PyTorch | N/A（仅消费 `spawnIntent`）| N/A | N/A |

---

### 3.6 决策派生层（v1.58） — UI 消费算法状态的唯一通道

**v1.58 治理目标**：把 v1.57.5 之前散布在 UI 层的"算法 → 显示"转换逻辑统一收口到新的派生层 `web/src/derivation/`，让 UI 永远只读一个 PresentationModel，杜绝 v1.57.5 §A/B/D/F/G 类"同一指标多 cache 不同步"的根因。

**架构分层**：

```
算法层（adaptiveSpawn.js）  →  derivation/  →  UI 层（DFV / stressMeter / playerInsightPanel）
                                  ↑                ↑
                                SSOT + Trace        只读 PresentationModel
                                + Contract DSL
                                + Reducer
```

**4 个派生层子模块**：

| 文件                                       | 职责                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `derivation/selectors.js`                | SSOT。所有"实时几何 / insight 字段 / playerProfile 读取"必须走 selector 函数（如 `selectLiveBoardFill(game)`） |
| `derivation/intentResolver.js`           | 表驱动 `INTENT_RULES` 优先级矩阵；返回 `{intent, trace, overrides}` 三元组                       |
| `derivation/displayContracts.js`         | 文案 / emoji / chip 契约 DSL；运行时谓词校验 + 自动降级链                                            |
| `derivation/presentationReducer.js`      | 把上面三层组合成 UI 唯一消费的 PresentationModel（含 chips + intent + narrative + emoji + trace）   |

**算法侧契约**：

- `adaptiveSpawn.deriveSpawnIntent` 仍是算法层入口（决策侧 / 旧测试 / miniprogram 镜像）
- `derivation/intentResolver.resolveIntent` 是 UI 侧入口（承载 trace + overrides）
- **行为完全等价**——由 `tests/derivationContracts.test.js §2` 9 条样例 + `tests/properties/derivationInvariants.test.js I1` 1500 次随机扫描强制锁定
- 未来 v1.58.4 计划让 `deriveSpawnIntent` 内部委托 `resolveIntent` 实现单源化

**spawnDiagnostics.layer1 与派生层的衔接**：

- v1.57.4 已让算法层在每次玩家放置后通过 `_refreshIntentSnapshot()` 增量刷新 `spawnDiagnostics.layer1.{fill, holes, nearFullLines, multiClearCandidates, pcSetup}`
- v1.58 派生层 `selectLiveGeometry(game)` **优先**读 `layer1`（已是实时值），缺失时降级到 `grid.getFillRatio()`
- `selectInsightWithLiveGeometry(game)` 把实时几何**注入 insight 顶层 boardFill + layer1**，UI 拿到的 insight 永远是最新的（即便 `_refreshIntentSnapshot` 已经隔了若干帧未再触发）

**详见**：[docs/algorithms/DECISION_DERIVATION_ARCHITECTURE.md](./DECISION_DERIVATION_ARCHITECTURE.md)。

**v1.58.1 增量**：派生层 `selectors.js` 在 `selectReducerInputs(game)` 返回的 `geometry` 上**派生新字段 `harvestReady = (nearFullLines>=1) || (multiClearCandidates>=1) || (pcSetup>=1)`**，作为"节奏类文案承诺（享受多消 / 收获期）"的几何兑现守卫。displayContracts 拆 `flow.payoff` 为 `flow.payoff.ready`（守 harvestReady=true）+ `flow.payoff.waiting`（节奏锁定但无兑现路径时诚实降级），同时 `relief.friendly` 也补加 harvestReady 守卫。性质测试 I11/I12/I12b 跨 contract 锁定"任何含'享受多消/收获期'字样的文案命中时几何必兑现"。

**v1.58.2 增量**：算法层 `forceReliefIntent = endSessionDistressActive || frustrationCritical`（adaptiveSpawn.js:2235）触发后，UI 层 emoji/narrative 也要看 **盘面几何是否确证压力**。`displayContracts` 中 `struggling.lateCollapse` / `struggling.frustCritical` / `relief.endgame` 三档统一加 `boardFill>=0.45` 守卫，盘面通透时分别 fall through 到 `concerned.softRescue.{late,frust}`（emoji 😟 "稍专注（系统已减压）"）/ `relief.endgame.soft`（"临近收尾，盘面仍从容"）——既承认算法在减压，又不撒谎"挣扎"或"接近收尾"。性质 I7（升级）/ I13 / I13b / I14 锁定。

**v1.58.3 增量**：DFV chip 表与算法层完成同源锁定。CHIP_DEFS 中 `lateCollapse` chip 的 on 函数修正为与 stressMeter / adaptiveSpawn 严格同源（`sessionPhase=late && momentum<=-0.30`，之前用 `endSessionDistress<-0.05` 近似），并加 4 个**信号诊断 chip**（`endSessionStress` / `lifecycleLateAccel` / `playerDistressFloor` / `delightModeRelief`）把其它压力链路独立信号也暴露到 DFV。每个 chip 加 `reason(ctx)` 函数，高亮时 title 自动写"触发源：<具体数值>"。同时 `presentationReducer` 派生 `conflicts` 数组（`flowVsIntent` / `pressureVsForce`）显式承认跨维度信号冲突——playerProfile.flowState（中长期）与 adaptiveSpawn.spawnIntent（即时）本就独立可对掐，UI 显式可视化比假装一致更可信。性质 I15 反向锁定"chip 表 vs 算法层 forceReliefIntent 触发条件"同源。

**v1.58.4 增量**：全系统自查 6 处残留修补——`relief.hole` 加 `holes>=1` 守卫、`relief.boardRisk` 加 `boardFill>=0.45` 守卫、`harvest.default` 兜底文案改写（去掉"密集/已识别"虚假承诺）、`flow.intense` + `flow.tense` 加几何守卫（新增 `.soft` 软降级文案）、`reducer._deriveConflicts` 加 `stressVsBoardFill` 跨维度冲突（stress 高但 boardFill 低时显式承认"算法压力来自非几何源"）。性质 I18/I19/I20/I21 锁定。

**新增算法字段时的责任清单**（v1.58 起）：

1. 在算法层（adaptiveSpawn / stress 链）正常加字段
2. 若新字段需被 UI 显示：
   - 在 `selectors.js` 加对应 `selectXxx(game)` 函数
   - 若涉及优先级（新 intent / 新 signal）：在 `intentResolver.INTENT_RULES` 加表项 + 测 `I1` 等价性
   - 若涉及文案 / emoji 守卫：在 `displayContracts.NARRATIVE_CONTRACTS` / `EMOJI_CONTRACTS` 加 contract（声明 `requires` + `fallback`）
   - 若涉及 chip：在 `presentationReducer.CHIP_DEFS` 加定义；若是覆盖类信号在 `intentResolver.SIGNAL_TO_INTENT` 加映射
3. 在 `tests/derivationContracts.test.js` 加单测、在 `tests/properties/derivationInvariants.test.js` 加性质（如果有新的一致性约束）

---

## 4. 策略候选库（10 档 Profiles）

10 档 profile 按 `stress` 值升序排列，引擎在相邻两档间做线性插值。

> **stress 列为 raw 域**（与 `game_rules.json` 配置一致，便于调参时直接对照源码），
> 对外面板与 DFV 显示请按 §3.5 表换算为 norm 域 `[0, 1]`（如 raw `0.85` ≈ norm `0.875`）。

| # | ID | stress（raw / norm） | 线条权重 | 不规则权重 | 设计意图 |
|---|-----|--------|---------|-----------|---------|
| 1 | `onboarding` | -0.20 / 0.000 | 3.0 | 0.35~0.45 | 新玩家首 5 轮：极高消行友好块，建立信心 |
| 2 | `recovery` | -0.10 / 0.083 | 2.8 | 0.5~0.6 | 板面快满：大量线条便于自救 |
| 3 | `comfort` | 0.00 / 0.167 | 2.5 | 0.65~0.75 | 低技能/挫败后：恢复信心，偶尔引入简单不规则块 |
| 4 | `momentum` | 0.10 / 0.250 | 2.4 | 0.78~0.85 | combo 后催化：偏向能串联消行的块型 |
| 5 | `guided` | 0.20 / 0.333 | 2.3 | 0.88~0.95 | 中低技能成长：逐步引入不规则块 |
| 6 | `breathing` | 0.30 / 0.417 | 2.15 | 0.95~1.0 | 紧张期后释放：给玩家喘息空间 |
| 7 | `balanced` | 0.40 / 0.500 | 2.0 | 1.12 | 心流核心区（≈ normal 策略） |
| 8 | `variety` | 0.50 / 0.583 | 1.85 | 1.15~1.2 | 防审美疲劳：拉平权重增加多样性 |
| 9 | `challenge` | 0.65 / 0.708 | 1.7 | 1.25~1.3 | 中高手进阶：不规则块明显增多 |
| 10 | `intense` | 0.85 / 0.875 | 1.45 | 1.38~1.48 | 高手极限：T/Z/L/J 权重超过线条 |

### 设计原则

1. **相邻间距不均匀**：低 stress 区间更密集（新手/挫败场景需要更细腻的调控）
2. **每档有明确的心理学目标**：不是简单的权重渐变，而是对应具体的玩家体验场景
3. **线条→不规则的渐变**：从极度消行友好到空间规划压力的连续谱

---

## 5. 自适应引擎（AdaptiveSpawn）

### 5.1 Stress 计算公式

> **域口径**：本节所有 stress 数值（包括下方公式、阈值、profile 锚点、`flowPayoffStressCap = 0.79`、`challengeBoost` 上限 `0.85` 等）均为**算法内部 raw 域** `[-0.2, 1]`，与源码一致；面板 / DFV / 策略卡显示的是经 `(raw + 0.2) / 1.2` 归一化后的 norm 域 `[0, 1]`。详见 [§3.5 stress 域口径](#35-stress-域口径v15517)。

当前实现把六类输入显式映射到 `stress` 与 `spawnHints`：

| 输入类别 | 代表字段 | 对 `stress` 的影响 | 对 `spawnHints` 的影响 |
|----------|----------|--------------------|------------------------|
| 难度模式 | `easy/normal/hard`、`difficultyTuning` | `stressBias` 调整基线，hard 提高挑战、easy 降低挑战 | `clearGuaranteeDelta`、`sizePreferenceDelta`、`multiClearBonusDelta` |
| 玩家能力 | `AbilityVector.skillScore/confidence/riskLevel/clearEfficiency/boardPlanning` | 高技能高置信可加压；高风险触发 `abilityRiskAdjust` 减压 | 高风险提高 `clearGuarantee`、偏小块；低风险高手提高多样性、多消、清屏与同 icon 兑现 |
| 实时状态 | `flowState`、`pacingPhase`、`frustrationLevel`、`needsRecovery` | bored 加压、anxious/恢复/挫败减压，release 阶段减压 | 挫败/恢复/新手保障消行，必要时偏小块 |
| 盘面拓扑 | `holes`、`nearFullLines`、`pcSetup`、`fillRatio` | 空洞压力通过 `holeReliefStress` 减压 | 清屏准备或近满线提升 `multiClearBonus`、`multiLineTarget` 和 `clearGuarantee` |
| 局内体验 | `comboChain`、`rhythmPhase`、`delightMode` | combo 表现可轻微加压，爽感模式可减压或引导 payoff | payoff 优先多消，清屏机会提高 `perfectClearBoost` |
| 局间弧线 | `totalRounds`、`runStreak`、`warmupRemaining`、`scoreMilestone` | 热身/冷却轻微减压，连战和分数档按规则加压 | 热身与里程碑提高消行保障，连续无消行进入救援 |

`spawnModel.js` 会读取同一份 `adaptiveInsight.spawnHints`、`AbilityVector` 和实时拓扑，作为 SpawnTransformerV3 的上下文输入；因此生成式与启发式看到的是同一组难度、能力和拓扑信号。

```
adaptiveStress = scoreStress           // 分数驱动（原 dynamicDifficulty）
               + runStreakStress        // 连战加成
               + skillAdjust           // (skill - 0.5) × 0.3
               + flowAdjust            // bored: +0.08 / anxious: -0.12
               + pacingAdjust          // tension: +0.04 / release: -0.12
               + recoveryAdjust        // fill > 82%: -0.2
               + frustrationRelief     // ≥ 4 步未消行: -0.18
               + comboReward           // combo ≥ 2: +0.05
               + nearMissAdjust        // 差一点: -0.1
               + boardRiskReliefAdjust // 填充/空洞/能力风险统一救济
               + delightStressAdjust   // 高技能无聊轻加压；焦虑/恢复降压
```

特殊覆写：`isInOnboarding → stress ≤ -0.15`

普通状态会通过 `adaptiveSpawn.stressSmoothing` 做轻量平滑；挫败、近失、恢复或高盘面风险等救场信号立即生效，避免"该救场时还被滞后"。最终范围：`[-0.2, 1.0]`。

**v1.16：占用率衰减（occupancyDamping）**——在 clamp 之后、smoothing 之前对正向 stress 乘 `clamp(boardFill / 0.5, 0.4, 1.0)`。低占用盘面（如 fill=0.39）的伪高压由 0.89 → ~0.69（进入 `tense` 而非 `intense`）；fill ≥ 0.5 时无衰减；负向 stress（救济）不被衰减。该项作为单独信号写入 `_stressBreakdown.occupancyDamping`，并在 `stressBreakdown.afterOccupancy` 上记录衰减后的中间值。

引擎返回 `_stressBreakdown`，包含每个分量、`rawStress`、`beforeClamp`、`afterOccupancy`、`afterSmoothing`、`finalStress` 和 `boardRisk`。面板、回放和测试可直接解释"这轮为什么加压/减压"。

**v1.16：spawnIntent 单一对外口径**——除了多档 `shapeWeights` 与连续型 `spawnHints`，引擎还输出离散 `spawnHints.spawnIntent ∈ { relief, engage, pressure, flow, harvest, maintain }`。所有"意图描述"（拟人化压力表叙事、商业化策略文案、回放标签、推送文案）必须读这一字段，不再各自从信号里推断。优先级：

1. **`relief`** — `recoveryAdjust + frustrationRelief + nearMissAdjust + holeReliefAdjust + boardRiskReliefAdjust < -0.10` 或 `delight.mode === 'relief'`
2. **`engage`** — AFK ≥1 且 `stress < 0.55` 且未触发救济（玩家停顿但状态尚可，给"显著正反馈 + 可见目标"）
3. **`harvest`** — *v1.17 收紧*：`nearFullLines ≥ 2` 或 `(pcSetup ≥ 1 && fill ≥ PC_SETUP_MIN_FILL=0.45)`（避免低占用盘面误触发"密集消行机会"叙事）
4. **`pressure`** — `challengeBoost > 0` 或（`challenge_payoff` 且 `stress ≥ 0.55`）
5. **`flow`** — `flow_payoff` 或节奏 `payoff`
6. **`maintain`** — 默认中性

**v1.16：AFK 召回（engage 路径）**——传统做法是「降难度+小块」让玩家喘息，但实际效果常常是连续给出 4 个单格 + 1×3 横条，盘面瞬间清爽，玩家依然提不起兴趣。新设计在 `profile.metrics.afkCount ≥ 1` 且 `stress < 0.55`、未触发挫败/恢复/新手保护时启用：`clearGuarantee≥2 / multiClearBonus≥0.6 / multiLineTarget≥1 / diversityBoost≥0.15`，rhythmPhase 由 `neutral` 切到 `payoff`（v1.17 起需通过 `canPromoteToPayoff` 几何兜底），给玩家"显著正反馈 + 可见目标"（一根长条 + 多消机会）。

**v1.17：rhythmPhase = 'payoff' 几何兜底**——v1.16 之前所有"基于玩家状态"的分支（`delight.mode='challenge_payoff'/'flow_payoff'`、`playstyle='multi_clear'`、`afkEngage`、`pcSetup ≥ 1`）会无条件把 `rhythmPhase` 升到 `payoff`，于是 17% 散布盘面也会出现：UI pill 「节奏 收获」+ 出块偏向 1×4 长条 + strategyAdvisor 弹「收获期」+ stressMeter 报「密集消行机会」——盘面其实没有任何近满行。新增统一 helper：

```js
const PC_SETUP_MIN_FILL = 0.45;
const canPromoteToPayoff = nearFullLines ≥ 1
    || multiClearCands ≥ 1
    || (pcSetup ≥ 1 && fill ≥ PC_SETUP_MIN_FILL);
```

所有上述分支在升 `payoff` 之前都需通过此兜底，确保出块偏向与 UI 叙事一致。

**v1.17：clearGuarantee 物理可行性兜底**——`cg=3`（来自 warmup `wb=1` 或 `roundsSinceClear ≥ 4`）含义是"本轮强制 ≥3 块能立刻消行"。但若 `multiClearCandidates < 2 && nearFullLines < 2`，盘面物理上无法兑现，UI pill「目标保消 3」即变成空头支票。最终兜底：在所有 `cg` 调整之后，若 `cg ≥ 3` 且无任何几何支撑则回钳到 `2`，仍保持友好出块语义。

**v1.18：叙事颗粒度补丁**——一致性补丁解决了"系统说一套做一套"，本节再处理"做对了但还能讲得更准"。共 5 处：

1. **`stressMeter.getStressDisplay(stress, spawnIntent)` 救济变体头像/文案**：
   `spawnIntent='relief' && stress ≤ −0.05` 落入 calm 档时，把「😌 放松」切到
   **「🤗 放松（救济中）」** + 配套 vibe，避免与故事线"挫败感偏高"撞车。
   easy/flow 等中性档不切，避免过度提示。
2. **`strategyAdvisor` 多消机会卡分两文案**：旧版 `nearFullLines ≥ 3` 无条件
   推"同时完成多行"，但 `multiClearCands < 2` 时物理上做不到。改按几何兜底：
   - `multiClearCands ≥ 2` → 「🎯 多消机会」原文案 + 拼接候选数
   - `multiClearCands < 2` → 「✂️ 逐条清理：先把最容易消的那条清掉」
3. **`strategyAdvisor` 瓶颈块预警卡**：当 `solutionMetrics.validPerms ≤ 2`
   且 `fill ≥ 0.4` 时，弹「⏳ 瓶颈块」(priority 0.86) + 拼接 `firstMoveFreedom`，
   提醒玩家"先放可放置位最少的那块、别再贪连击"。
4. **`PlayerProfile.flowState` 复合挣扎检测**：旧版要求 `F(t) ≥ 0.25` 才进入
   方向判定，会漏掉「思考 4 秒 + 失误 13% + 板面 58% + 消行率 25%」这种
   单一阈值都没踩穿、但多个弱信号同时成立的挣扎。新增前置 4 信号计票
   （missRate>0.10 / thinkMs>3500 / clearRate<0.30 / 高 fill+低 clearRate），
   ≥3 条同时成立 → `anxious`。新增可调键 `flowZone.thinkTimeStruggleMs`（3500ms）。
5. **`playerInsightPanel` 救济三分量 pill**：把 `stressBreakdown.frustrationRelief
   / recoveryAdjust / nearMissAdjust` 直接以紧凑 pill 形式（`挫败救济 −0.12 /
   恢复 −0.08 / 近失 −0.04`）暴露给玩家，不必再从故事线倒推现在 stress 是
   被哪条救济压下去的。仅在 |v| ≥ 0.02 时显示。

**v1.26：AdaptiveSpawn live 几何覆盖**——v1.25 已把 panel/策略卡的多消候选改成 dock 优先，但 adaptiveSpawn 内部仍主要读 `ctx.nearFullLines/multiClearCandidates`（上轮快照），存在时序偏差窗口。本节把 spawn 决策入口同步到 live 几何。

1. **`_mergeLiveGeometrySignals(ctx)`：决策前覆盖 nearFull/multiClear**
   当 `spawnContext._gridRef` 存在时：
   - 用 `analyzeBoardTopology(grid)` 重算 `nearFullLines`
   - `multiClearCandidates` 优先按 `_dockShapePool`（当前可见候选块）统计可达
     `multiClear>=2` 的块数；若 dock 不可用回退全形状库
   - 将结果覆盖到本轮 `ctx`，统一驱动 `spawnIntent` / `rhythmPhase` /
     `multiClearBonus` / `multiLineTarget` 等判定链路

2. **`game.js` 注入临时 live 上下文**
   `resolveAdaptiveStrategy(...)` 调用处注入 `_gridRef` 和 `_dockShapePool`（一次性上下文），
   不写回持久 `_spawnContext`，避免跨轮污染。

**v1.28：合法序统计修复 + 文案口径精简**

1. **`solutionMetrics.validPerms` 与 `leafCap` 解耦**
   旧版在 `solutionCount` 达到 `leafCap` 后提前停止排列遍历，`validPerms` 会被低估（例如面板出现 `1/6`、`2/6` 偏小值）。  
   新版保留 `solutionCount` 的 cap 防护，同时继续按 6 个排列独立判定“是否至少有 1 条完整解”，保证 `validPerms` 不再受 cap 误伤。
2. **提示文案改短并标注快照语义**
   - `strategyAdvisor`「瓶颈块」改为短句：强调“先下可放位最少的块”；
   - `playerInsightPanel` 的 `解法数量/合法序` tooltip 明确为“本轮生成时”数据，避免与实时盘面混读。

**v1.24：flow 叙事相位变体表**——v1.23 修了 stress story 优先级倒置，本节再修 `SPAWN_INTENT_NARRATIVE.flow` 文案与实际 rhythmPhase 硬冲突。

1. **`stressMeter.SPAWN_INTENT_NARRATIVE.flow` 拆按 rhythmPhase 选变体**
   旧版 `flow` 文案硬编码"心流稳定，节奏进入收获期，准备享受多消快感。"，但 spawnIntent
   `'flow'` 的触发条件是 `delight.mode === 'flow_payoff' || rhythmPhase === 'payoff'`
   （`adaptiveSpawn.js:995`）——`delight.mode='flow_payoff'` 在 R1 空盘 + flow=flow +
   skill≥0.55 时也会成立（`deriveDelightTuning` line 351-352），此时实际 `rhythmPhase`
   因 v1.21 的 `nearGeom` mutex 会 fall through 到 `'setup'`。结果三方叙事对立：
   - story："心流稳定，**节奏进入收获期**…"
   - spawn 决策 pill：「节奏 **搭建**」+「意图 心流」
   - strategyAdvisor 卡：🏗️ **搭建期** + "稳定堆叠、预留消行通道"
   
   修复：新增 `FLOW_NARRATIVE_BY_PHASE` 变体表：
   - `payoff`  → "心流稳定，节奏进入收获期，准备享受多消快感。"（保留爽点叙事）
   - `setup`   → "心流稳定，节奏稳步搭建，先留好通道等下一波兑现。"
   - `neutral` → "心流稳定，节奏自然流畅，系统继续维持当前出块。"
   
   `buildStoryLine` 在 `spawnIntent='flow'` 时按 `spawnHints.rhythmPhase` 选变体；
   rhythmPhase 缺失（pv=2 早期回放）时回退到 `SPAWN_INTENT_NARRATIVE.flow`（兜底文案
   也已去"收获期"硬编码，改为通用"心流稳定，系统继续维持流畅的出块节奏。"）。
   其他 intent 仍走单一映射，不引入额外复杂度。

2. **多消策略判断依据（v1.25 口径）**
   strategyAdvisor 当前与“多消”相关的卡，统一按 live 几何优先、snapshot 兜底：
   - live 数据源：`liveTopology.nearFullLines` + `liveMultiClearCandidates`
   - `liveMultiClearCandidates` 优先按当前 dock 三块（未放置）统计可达 `multiClear>=2` 的块数，
     不再按全形状库估算；仅在 dock 不可用时回退全形状库
   - snapshot 兜底：`diag.layer1.nearFullLines` + `diag.layer1.multiClearCandidates`

   判定规则如下（按优先顺序）：
   - **`🎯 多消机会`**：`nearFullLines >= 3 && multiClearCandidates >= 2`
   - **`✂️ 逐条清理`**：`nearFullLines >= 3 && multiClearCandidates < 2`
   - **`💎 收获期 / 收获期·待兑现`**：
     - 前置：`hints.rhythmPhase === 'payoff'`
     - 文案分流：`multiClearCandidates >= 1 || nearFullLines >= 2` → 「收获期」；
       否则 → 「收获期·待兑现」
   - **`🎯 提升挑战`**（前瞻构型建议，不是即时兑现建议）：
     `flowState='bored' && !harvestNow && fill>=0.18`，并与收获期互斥

   设计意图：
   - 兑现类建议必须满足即时几何条件（避免“卡说多消、盘面做不到”）
   - 构型类建议只在非收获态出现（避免“现在兑现”与“先搭建”同帧拉扯）
   - 玩家看到的“多消候选 N”pill 与策略卡共用同一套 live 几何口径

**v1.23：叙事优先级 + 收获期 live 几何 mutex**——v1.22 修了卡间互斥与 sparkline tooltip 解读，本节再修 stress story 文案优先级倒置 与「收获期」卡漏掉 live 几何 mutex 两处残余冲突。

1. **`stressMeter.buildStoryLine`：spawnIntent 永远优先**
   v1.16 引入 spawnIntent 优先级时为防止"系统真在保活时硬信号被吞"加了 gating
   `frust > -0.08 && recovery > -0.08`，但 v1.18 后 stressMeter label/vibe 已经诚实化
   为「放松（救济中）」+「系统正在为你减压」，这条 gating 反而让 frustRelief 触发时
   绕过 `SPAWN_INTENT_NARRATIVE.relief`（"盘面通透又是兑现窗口…"），退回老严厉文案
   "检测到挫败感偏高，正在主动减压并送出可消块"，与 stressMeter 友好叙事三方拉扯。
   截图复现：label = "放松（救济中）" + vibe = "系统正在为你减压" + story = "检测到
   挫败感偏高"，玩家完全混乱。
   
   修复：只在 `boardRisk ≥ 0.6` 时让"保活"叙事抢占（极端硬信号），其余情况下
   spawnIntent 存在就直接返回 `SPAWN_INTENT_NARRATIVE`。老严厉文案 line 182~191
   降级为"spawnIntent 缺失（pv=2 早期回放）的兼容兜底"，确保旧回放向后兼容。
2. **`strategyAdvisor`「💎 收获期」卡加 live 几何 mutex + 待兑现变体**
   `hints.rhythmPhase` 是 spawn 时锁定的快照，spawn 后玩家落了块改变 live 几何
   （multiClearCands→0、nearFullLines→0），仍按 snapshot 触发「积极消除拿分」是空头
   建议。截图复现：spawn 决策 pill 目标保消 3 + 多消 0.95 + 多线×2，但 live 几何 pill
   多消候选 0 + 近满 0，dock 是 4 块 volleyball L 形根本消不了任何行。v1.20 已为
   「多消机会 / 逐条清理 / 瓶颈块」3 张卡都加了 live 几何 mutex（v1.20 通过 panel 把
   `liveTopology` + `liveMultiClearCandidates` 注入 `gridInfo`），本次补上「收获期」卡：
   - `_liveMultiClearCands ≥ 1 || _liveNearFull ≥ 2` → 出原「💎 收获期」卡 + 原文案；
   - 否则 → 切「💎 收获期·待兑现」诚实文案"上一次 spawn 锁定了'收获'节奏，但当前 dock
     与盘面暂时没对上消行机会，先稳住手等下次 spawn 兑现。"
   
   旧 panel 未注入 `liveTopology` / `liveMultiClearCandidates` 时回退到 `diag.layer1.*`
   （spawn 快照），保证向后兼容。

**v1.22：卡互斥 Build vs Harvest + Sparkline Help 解读**——v1.21 修了 phase 撞墙与 borderline 翻面，本节再修策略卡间叙事拉扯，并把 sparkline tooltip 从"指标定义"升级为"如何读图"。

1. **`strategyAdvisor`「规划堆叠」加 `harvestNow` 互斥**
   v1.17 已为「提升挑战」卡加了 `harvestNow = (rhythmPhase==='payoff' || spawnIntent==='harvest')`
   互斥（避免与「收获期」卡叙事拉扯），但同文件第 11 张「构型建议 → 规划堆叠」卡
   仍只看 `fill<0.3 && skill>0.5`。线上截图复现：rhythmPhase=payoff + 板面 30% + skill 78%
   时同帧出现两张方向相反的卡——
   - 💎 收获期：「积极消除享分」（要求当下兑现）
   - 🏗️ 规划堆叠：「留出 1~2 列通道为后续做准备」（要求蓄力搭建）
   
   修复同样加 `&& !harvestNow` 闸；payoff/harvest 时跳过此卡，搭建/中性期仍保留长期建议。
2. **REPLAY_METRICS 19 条 sparkline tooltip 全量补「📈 看图」解读段**
   原 tooltip 只解释"是什么"（指标定义），现在统一追加 `📈 看图：…` 段，说明：
   - 典型读数范围、上行/下行/平台/拐点的含义；
   - 与哪条相邻曲线互相印证（例如「未消行 + 板面 + 负荷」三方共看判定瓶颈）；
   - 什么读数对应哪种 strategyAdvisor 卡或 spawnIntent 切换。
3. **「挑战」(challengeBoost) tooltip 显式说明触发条件**
   玩家常因看到曲线长期为 0 而怀疑指标失效。新 tooltip 写明触发条件
   `score ≥ bestScore × 0.8` 且 `stress < 0.7`、公式 `min(0.15, (score/best - 0.8) × 0.75)`、
   首局（best=0）也恒为 0、触发后会把 spawnIntent 切到 pressure。机制本身
   （adaptiveSpawn.js:615-622 + v1.20 5 条单测）已健壮，本次只补叙事层。

**v1.21：Phase Coherence + Snapshot Marker + Borderline 去抖**——v1.20 修了一帧三方 F(t)/feedbackBias/flowState 撞墙，本节解决残留的 phase 撞墙 + UI 视觉混淆 + borderline 翻面。

1. **`deriveRhythmPhase`：`'setup'` 与 `'harvest'` 互斥兜底**
   v1.17 加 `canPromoteToPayoff` 时只堵了 `'neutral'→'payoff'`，没堵 `'setup'`
   在有几何时被错误返回。`pacingPhase='tension' && roundsSinceClear=0 &&
   nearFullLines>=2` 同时满足时，旧版返回 `'setup'`（line 264 无条件），但
   `harvestable`（`nearFullLines>=2 || pcSetupMeaningful`）同时为 true →
   pill「节奏 搭建」+「意图 兑现」+ stress story「投放促清形状」+
   strategyAdvisor「搭建期 稳定堆叠 留通道」一帧四方对立。
   修复：给 `'setup'` 分支加 `&& !nearGeom`，紧张期开头若几何已经支持兑现就
   fall through 到 `'neutral'`、由后续 `canPromoteToPayoff` 升 `'payoff'`，与
   `spawnIntent='harvest'` 同口径。
2. **`playerInsightPanel._buildWhyLines(insight, profile)` 双参签名**
   纯 live 量（`flowDeviation` / `feedbackBias` / `flowState`）优先取
   `profile.*`，与右侧 pill / 左侧 sparkline 末点同源。spawn 决策类继续读
   `insight.*`。消除"sparkline 0.82 / pill 0.82 / 解释 0.78"三态。
3. **spawn 决策 pill 区分割：插入「📷 R{n} spawn 决策」marker**
   把 spawn 决策快照类 pill（意图/目标保消/节奏/弧线/连击/多消/多线×/形状权重）
   与 live 状态 pill / live 几何 pill 视觉分开，避免「意图 兑现 + 多消候选 0」
   被误判为撞墙（其实是 spawn 后玩家清掉了多消候选导致的时序错位）。
4. **`playerProfile.flowState` borderline 去抖**
   旧版 `fd > 0.5 && clearRate > 0.4` 在 borderline 反复翻面，加 5% 缓冲：
   `fd > 0.55 && clearRate > 0.42`。

**v1.51：末段崩盘 stress 失真修复**——screenshot 实测发现高分濒死场景下 `stress=0.04` 显示舒缓档、`flowState=bored`、`spawnIntent=harvest`，与玩家 `momentum=-0.53 / 最后 8 步 0 消行` 真实状态严重错位。根因：依赖累计均值的 metric 被前 5 分钟良好表现稀释。本节是该问题的全栈修复。

1. **`PlayerProfile.flowState` 三条新通道**（`web/src/playerProfile.js`）
   - `momentum ≤ -0.35` 在所有判定前硬触发 `anxious`，避免"动量持续下行却被误判 bored"；
   - 新增 `_burstStruggleSignals()` 末段 8 步瞬时窗口（newer-half 消行率 ≤ 0.20、思考时间 +20%、
     fill 上升、连续 ≥4 步 0 消，命中 ≥3 即触发）——与累计 `struggleSignals` OR 关系，
     解决"前 5 分钟良好 + 最后 1 分钟崩盘"被均值稀释的盲区；
   - borderline (`fd > 0.55 && clearRate > 0.42`) 加方向门：必须 `boardPressureRatio < 1`
     AND `momentum > -0.15` 才允许 `bored`，否则 fall through 到 `flow` / 由前两条接管。
2. **`adaptiveSpawn.endSessionDistress` 独立 stress 分量**（`web/src/adaptiveSpawn.js` + `shared/game_rules.json` 加 `signals.endSessionDistress` 配置）
   `sessionPhase === 'late' && momentum ≤ -0.30` 时 `−(0.05 + (|momentum|-0.30) * 0.5)`，
   `frustrationLevel ≥ 4` 再叠加 `−0.06`，下限钳制 `−0.25`。与 `sessionArcAdjust` 互补：
   后者看 cooldown 弧线档位、本信号看玩家自己的崩盘强度，两者同时为负但语义独立。
3. **`sessionArcAdjust` cooldown 救济按 `|momentum|` 线性放大**
   旧版 `−0.05` 固定值在 `momentum=-0.53` 时力度不足。新版按 `|momentum|` 在
   `[-0.2, -0.6]` 区间线性放大到 `[-0.05, -0.20]`，与崩盘力度同向。
4. **`spawnIntent` 末段/高挫败强制 `relief`**
   `endSessionDistressActive || frustrationLevel ≥ 5` → `forceReliefIntent=true`，
   即便 `playerDistress` 累计未到 `−0.10` 也走 relief 叙事，杜绝 game over 前一帧
   仍显"识别到密集消行机会，正在投放促清的形状"与濒死状态错位的问题。
5. **`playerInsightPanel` 实时四联 chip 互斥/方向解读**（`_resolveLiveHeadTags`）
   `late + momentum ≤ -0.30` 时 `bored` chip 替换为 `late-stress`、`tension` chip
   加 `series-tag--muted`（line-through + 0.45 opacity），避免"无聊 + 紧张期 + 后期"
   三条标签互相打架。
6. **`stressMeter` 挣扎中变体**（`getStressDisplay` 加 `distress` 入参）
   `stress < 0.20 && (calm/easy 档) && (lateCollapse || frustration ≥ 5)` 时
   face → `😣`，label → 「挣扎中（救济中）」，vibe → "动量持续下行、临 game over，
   系统已强制 relief 出块抢救节奏"。优先级高于 v1.18 的 relief 救济变体。
7. **回归测试 `tests/endSessionStress.test.js`**：10 用例守护 momentum 硬触发、burst 窗口、
   borderline 方向、`endSessionDistress` sign / late-only、`forceReliefIntent`、
   `stressMeter` 三档变体。

**v1.20：Live ↔ Snapshot 一致性补丁 + 标签解耦**——v1.18~v1.19 解决了"指标内涵不准"，本节再处理"同一帧不同来源说不同话"。

1. **`strategyAdvisor`：多消机会卡 / 瓶颈块卡读 live 几何（替代 spawn 快照）**
   `nearFullLines` / `multiClearCandidates` 在 spawn 时被写入 `diag.layer1.*`，
   但玩家在 spawn 后放过 1~3 块、几何已变时，策略卡仍按 spawn 快照叙述
   （"4 个多消放置 + 3 接近满行"），而面板 pill「多消候选 N」走 live 显示 0。
   v1.20 让 `playerInsightPanel._render` 把 `liveTopology` 和
   `liveMultiClearCandidates`（已经为面板 pill 计算过，复用）注入 strategyAdvisor
   的 `gridInfo`，多消机会卡 / 瓶颈块卡用本地 `_liveNearFull` / `_liveMultiClearCands`
   优先读 live、回退到 `diag.layer1.*`。
2. **`playerInsightPanel`：F(t) / 闭环反馈 pill 改读 PlayerProfile live**
   原 `F(t) <pill>` 读 `ins.flowDeviation`（spawn 时快照）、左侧 sparkline 末点读
   `profile.flowDeviation`（live），同帧出现 0.12 量级偏差。统一读 live。
   spawn 决策类字段（`spawnIntent` / `multiClearBonus` 等）仍读 `ins.*`，因为它们
   表达的是"spawn 时做了什么决策"，与 live 解耦才是正确语义。
3. **sparkline `pacingAdjust` 标签 「节奏」→「松紧」**
   v1.17 已把 `pacingPhase` UI 标签解耦为「Session 张弛」，但 sparkline 仍叫
   「节奏」展示 `pacingAdjust`，与右侧 `rhythmPhase` pill「节奏 收获」再次撞名。
   改名「松紧」彻底分开"相位枚举"与"数值偏移"。同步改 `SIGNAL_LABELS`。
4. **`adaptiveSpawn`：补 `challengeBoost` 触发 4 条件单测**
   补 5 条覆盖 `(segment5='B' || sessionTrend!='declining') && bestScore>0 &&
   score>=0.8*bestScore && stress<0.7` 的全部分支 + 触发幅度公式
   `min(0.15, (ratio-0.8)*0.75)` + `spawnIntent='pressure'` 联动。

**v1.19：multiClearBonus 几何兜底 + 救济 pill 自动化**——v1.18 把所有"做对了"的事都讲清楚了，本节再补两处仍能撞墙的地方。

1. **`adaptiveSpawn`：`multiClearBonus` / `multiLineTarget` 几何兜底**
   与 v1.17 cg 兜底同源。当 ① `multiClearCandidates < 1` ② `nearFullLines < 2`
   ③ 不在真 perfect-clear 窗口（`pcSetup ≥ 1` 且 `fill ≥ PC_SETUP_MIN_FILL`）
   ④ 不在 warmup 阶段、未触发 AFK engage —— 四条同时成立时，
   把 `multiClearBonus → min(., 0.4)`、`multiLineTarget → 0`。
   软封顶 0.4 而非 0：单消形状与多消候选大量重合，bonus 仍能起到正向作用，
   只是不再"重押"。warmup / AFK 显式豁免：cg 是「承诺」（必须可兑现），
   `multiClearBonus`/`multiLineTarget` 是「偏好」（可前瞻 / 跨局结构性），
   两类语义对应不同兜底策略。
2. **`playerInsightPanel`：救济 pill 自动化为 top-N 负贡献**
   v1.18 三件套（frustrationRelief/recoveryAdjust/nearMissAdjust）只覆盖 3 条
   救济通路。当 `spawnIntent='relief'` 来自 `delight.mode` / `flowAdjust` /
   `friendlyBoardRelief` 等其他减压源时，三件套全为 0、玩家依然看不出谁在救济。
   改为复用 `stressMeter.summarizeContributors`，从 `stressBreakdown` 自动挑出
   当前帧贡献最大的 **top 2 负向分量**（|v| ≥ 0.04），标签 + tooltip 直接复用
   `SIGNAL_LABELS`，覆盖全部 17 条加减压通路。

### 5.1.1 多轴出块目标

`stress` 不直接等价为“怪块更多”。当前实现先把一维压力投影为 `spawnTargets`，再由规则轨消费：

| 目标轴 | 字段 | 含义 | 消费位置 |
|--------|------|------|----------|
| 形状复杂度 | `shapeComplexity` | 低值偏线条/矩形，高值偏 T/Z/L/J | `blockSpawn` 对品类复杂度加权 |
| 解空间压力 | `solutionSpacePressure` | 低值要求更宽松解空间，高值允许更窄解空间 | 解法数量过滤、首手自由度护栏 |
| 消行机会 | `clearOpportunity` | 救场、近失、恢复时提高即时消行供给 | `clearGuarantee` 席位、gap/multiClear 权重 |
| 空间压力 | `spatialPressure` | 控制大块/中块/小块占比，而非只靠异形 | size/cell 权重与 setup 阶段 |
| Payoff 强度 | `payoffIntensity` | 多消、清屏、连击兑现窗口 | multiClear、perfectClear、payoff 加权 |
| 新鲜度 | `novelty` | 防疲劳的品类变化强度 | 同轮/跨轮品类记忆惩罚 |

这样高压可以表现为“解空间更窄”“空间规划更强”“payoff 窗口更短”，不必总是表现为“方块更怪”；低压也可以通过更宽解空间、更多清线机会和小块救场实现。

### 5.1.2 生命周期 + 成熟度 stress 调制（v1.32 起）

`scoreStress / runStreakStress / skillAdjust / flowAdjust ...` 等所有"局内"信号合成 `rawStress` 之后、进入 `clamp([-0.2, 1])` 之前，会再走**一道由跨局画像驱动的硬调制**：

```
rawStress  ──┐
             ├─→ getLifecycleStressCap(stage, band) ──→ { cap, adjust }
             │                                             │
             ▼                                             ▼
   if (stress > cap):  stress = cap   ←─ 硬上限保护新人 / 防流失
   stress += adjust                    ←─ 整体减压 / 加压
   stress = clamp([-0.2, 1])
```

**输入两个跨局画像维度**（与本文 §5.1 局内 6 维信号正交）：

| 维度 | 来源 | 取值 | 数据更新触发 |
|---|---|---|---|
| `stage` 生命周期阶段 | `retention/playerLifecycleDashboard.js` | `S0..S4`（新入场 / 激活 / 习惯 / 稳定 / 回流） | `daysSinceInstall + totalSessions + daysSinceLastActive` 三项 AND 门，每帧按需重算（300ms TTL 缓存） |
| `band` 成熟度档位 | `retention/playerMaturity.js → calculateSkillScore` | `M0..M4`（新手 / 成长 / 熟练 / 资深 / 核心） | maturity SkillScore 阈值映射，每局 `onSessionEnd → updateMaturity` 写盘 |

> ⚠️ `band` 的判定数据源是 **maturity SkillScore（跨局画像，按天 EMA）**，与 `AbilityVector.skillScore`（局内 5 维 EMA，每帧刷新）**不是同一个指标**——后者直接进上面的 `skillAdjust`，前者只通过 band 进入这道 cap/adjust 调制。详见 `web/src/playerAbilityModel.js` 与 `web/src/retention/playerMaturity.js` 的 docstring 警示。

**调制表（17 项 `lifecycle/lifecycleStressCapMap.js`，single source of truth）**：

|        | M0 新手 | M1 成长 | M2 熟练 | M3 资深 | M4 核心 |
|--------|---------|---------|---------|---------|---------|
| **S0 新入场** | cap 0.50 / adj −0.15 | — | — | — | — |
| **S1 激活**   | 0.60 / −0.10 | 0.65 / −0.05 | 0.70 / 0 | — | — |
| **S2 习惯**   | 0.65 / −0.10 | 0.70 / 0 | 0.75 / +0.05 | 0.82 / +0.10 | — |
| **S3 稳定**   | — | 0.72 / 0 | 0.78 / +0.05 | 0.85 / +0.10 | **0.88 / +0.12** |
| **S4 回流**   | 0.55 / −0.15 | 0.60 / −0.10 | 0.70 / 0 | 0.75 / +0.05 | 0.80 / +0.08 |

**两个维度的影响幅度（实测）**：

- **stage 固定，band 移动**：同一阶段内 M0→M4 → cap 提高 0.16–0.25 → 对应 10 档 difficulty profile 的 **3–4 档**差距；
- **band 固定，stage 移动**：S0/S4 vs S2/S3 在同 band 下 cap 差距 0.10–0.30 → S0/S4 给"保护通路"、S2/S3 给"挑战通路"。

**未在调制表内的 (stage, band) 组合**（如 `S0·M3` / `S3·M0` / `S2·M4`）：`getLifecycleStressCap` 返回 `null`，本调制段直接跳过——这些组合在产线分布极低（如 stability 期玩家的 SkillScore 不会还在 M0），仅由通用 stress 通路 + onboarding/winback 特例处理。

**特殊保护通路**（与上述 cap/adjust 串联，不替代）：

1. **新手保护**：`profile.isInOnboarding === true`（即 stage=S0）→ `stress = min(stress, firstSessionStressOverride=-0.15)`；spawnHints `clearGuarantee≥2 / sizePreference=-0.4`；
2. **winback 保护包**：`daysSinceLastActive ≥ 7`（即 stage=S4）自动激活 `PROTECTED_ROUNDS=3` 局 → `stress cap = min(0.6, lifecycle cap)`、`clearGuarantee += boost`、`sizePreference += shift`（更小块）；
3. **B 类高分挑战**：`segment5='B'` 且 `score ≥ bestScore × 0.8` 且 stress<0.7 → `stress += challengeBoost (≤0.15)`，与 `friendlyBoardRelief` 互抑。

**调制结果透出**（`stressBreakdown`）：

| 字段 | 语义 |
|---|---|
| `lifecycleStage` | 当前判定的 `S0..S4` |
| `lifecycleBand`  | 当前判定的 `M0..M4` |
| `lifecycleStressAdjust` | `cap - rawStress` 之差（负值表示 cap 实际触发，玩家 stress 被压低） |
| `winbackStressCap` | winback 保护包激活时的 cap 值（仅 S4 命中时存在） |

下游消费方都能读到这些字段：

- 玩家画像面板（`#insight-ability` 4×2 grid 的 stage/band 两个 pill）
- 策略解释段（`#insight-why → 📱 生命周期`：阶段调制 bullet + 成熟度横向影响 bullet）
- `_winbackPreset` 在 `ins._winbackPreset`，回放面板可追踪"为何这一帧 stress 被压低"

> 历史备注：v1.50.x 之前 `web/src/retention/difficultyAdapter.js` 定义了一套基于 maturity L1–L4 的 `MATURITY_DIFFICULTY_ADJUST = { L1: stressOffset:-15, L2: -5, L3: 0, L4: 5 }` 平行实现，但全仓**没有任何生产代码调用它到 spawn 路径**（仅自测引用），是 v1 时期遗留。v1.50.x 已**移除**该模块，统一由本文小节描述的 `(stage·band) → cap/adjust` 调制表接管。

### 5.2 信号效果总览

| 信号 | 方向 | 幅度 | 触发条件 | 心理学依据 |
|------|------|------|---------|-----------|
| scoreStress | + | 0~0.78 | 分数越高 | 传统递进难度 |
| skillAdjust | ± | ±0.15 | 技能偏离中位 | 个性化适配 |
| flowAdjust | ± | -0.12~+0.08 | 心流偏移 | Csíkszentmihályi |
| reactionAdjust | ± | ±0.05 | `pickToPlaceMs` < `fastMs` (默认 350ms) → 反射式快放 +stress；> `slowMs` (4500ms) → 拖动犹豫 -stress；`reactionSamples ≥ minSamples`（默认 3）才启用；与 `nearMissAdjust` 同向时让位 | 反应/操作熟练度的早期信号（v1.46） |
| pacingAdjust | ± | -0.12~+0.04 | 周期相位 | 张弛有度 |
| recoveryAdjust | - | -0.2 | fill > 82% | 防止不公平死局 |
| frustrationRelief | - | -0.18 | ≥ 4 步未消行 | 流失预防 |
| nearMissAdjust | - | -0.1 | 高填充+未消行 | 差一点效应 |
| boardRiskReliefAdjust | - | 约 -0.1 | 填充、空洞、能力风险综合偏高 | 避免多处风险重复加压 |
| comboReward | + | +0.05 | combo ≥ 2 | 正反馈 |
| delightStressAdjust | ± | 约 ±0.08 | 高技能无聊 / 焦虑恢复 | 挑战-奖励匹配 |
| onboarding | 覆写 | ≤ -0.15 | 新玩家前 5 轮 | 首局保护 |
| lifecycleStressCap | 覆写 + ± | cap 0.50 ~ 0.88 / adjust −0.15 ~ +0.12 | (S0..S4)·(M0..M4) 二元查表 | 跨局画像分群（详见 §5.1.2） |
| winbackStressCap | 覆写 | ≤ 0.6 | `daysSinceLastActive ≥ 7` 后前 3 局 | 回流玩家保护 |

### 5.4 信号配置与校准

`shared/game_rules.json` 的 `adaptiveSpawn.signals` 支持逐项开关和缩放：

```json
{
  "adaptiveSpawn": {
    "signals": {
      "flowAdjust": { "enabled": true, "scale": 1 },
      "trendAdjust": { "enabled": false, "scale": 1 }
    }
  }
}
```

推荐用回放中的 `stressBreakdown`、`avgStress`、`clearRate`、`gameOver` 和 `sessionLength` 做离线校准：先按场景聚合，再调整各信号 `scale`，最后用 golden tests 固化新阈值。

### 5.3 插值逻辑

给定 `stress` 值，在 10 档 profiles 中找到上下两个 bracket，对 shapeWeights 的每个 key 做线性插值：

```
weight[k] = lower.weight[k] + t × (upper.weight[k] - lower.weight[k])
t = (stress - lower.stress) / (upper.stress - lower.stress)
```

---

## 6. 出块提示（SpawnHints）

自适应引擎输出 `spawnHints` 对象传给 `blockSpawn.js`，在权重之上提供更精细的控制。

| Hint | 范围 | 含义 | 消费方式 |
|------|------|------|---------|
| `clearGuarantee` | 0~3 | 三连块中至少 N 个能触发即时消行 | 优先从 gapFills>0 候选中选取 |
| `sizePreference` | -1~+1 | <0 偏小块、>0 偏大块 | 调整 augmentPool 中的尺寸乘数 |
| `diversityBoost` | 0~1 | 越高→三连块品类越多样 | 惩罚已选品类的权重 |
| `comboChain` | 0~1 | 连消链活跃度 | 消行槽位与消行块权重 |
| `multiClearBonus` | 0~1 | 多消鼓励强度（分段推导） | `bestMultiClearPotential` / augmentPool 乘子 |
| `multiLineTarget` | 0~2 | 显式偏好「同时多线」兑现（v3.2 / v10.33） | 阶段 1 排序与 multi 选取；`multiClear≥2` 额外乘子 |
| `delightBoost` | 0~1 | 能力/心流驱动的爽感兑现强度 | 提高多消候选排序、抽样权重与消行槽位上限 |
| `perfectClearBoost` | 0~1 | 清屏兑现强度 | 提高可清屏块排序与 `pcPotential` 权重；若存在一手清屏块，会优先占用一个出块槽位 |
| `iconBonusTarget` | 0~1 | 同 icon / 同色 bonus 兑现强度 | `game.js` 放大同 icon/同色近满行列对应的 dock 颜色权重 |
| `delightMode` | challenge_payoff / flow_payoff / relief / neutral | 爽感调节模式 | 驱动 payoff、救援偏小块、消行保证 |
| `rhythmPhase` | setup / payoff / neutral | 搭建 / 收获 / 中性（payoff 需几何门控） | augmentPool 相位乘子 |
| `sessionArc` | warmup / peak / cooldown | 局内前段 / 中段 / 收官 | stress 与友好化 hint |
| `scoreMilestone` | bool | 刚跨**局内分数里程碑**（区别于 `maturity_milestone_complete` 的跨局成熟度晋升） | 三条通路：①`adaptiveSpawn` 内部抬高 `clearGuarantee` / 压低 `sizePreference`（出块友好化）；②`game.js spawnBlocks()` 顶部桥接到 `_spawnContext.scoreMilestone`，触发 `blockSpawn.js:870-872` 的 `*= 1.3` 加权（v1.55.16 修复，此前为 dead branch）；③策略卡 / Player Insight 面板 / DFV 仍展示数据流（**UI float toast 已于 v1.55.11 撤销**） |
| `scoreMilestoneValue` | number\|null | 当 `scoreMilestone=true` 时给出具体跨过的分数档（用于 i18n `effect.scoreMilestone` 的 `{{score}}` 占位符） | 仅供策略卡 / Insight 面板 / DFV 数据展示（局内浮层已撤销） |
| `targetSolutionRange` | min/max 或 null | v9 解法数量档位 | 通过可解性校验后收缩解空间 |
| `targetHoleIncrement` | min/max 或 null | **v1.57.2 新增**：新空洞难度档位（与 targetSolutionRange 并列双轴）| 通过 DFS 叶子 isolated-holes delta 软过滤候选 triplet——低 stress max 强约束（必有干净解）/ 高 stress min 强约束（玩家必须吞洞） |
| `targetMaxHoleIncrement` / `targetHoleIncrementGap` / `targetEndFillRatio` / `targetNearFullDelta` / `targetFirstMoveSurvivorRatio` / `targetSolutionDiversity` / `targetEndFlatness` / `targetEndDangerColumns` / `targetVisualClutter` | min/max 或 null | **v1.57.3 新增**：9 维 stress→算法 难度投射（详见 §3.5 v1.57.3 节）| 9 个独立潜意识压力源——专注度税上界/差距、空间窒息、消行节律、试错代价、解多样性、凹凸审美、爆顶预警、视觉杂乱 |
| `orderRigor` | 0~1 | **v1.32 新增**：顺序刚性强度（0=不约束，1=必须按特定顺序） | 仅用于诊断/面板展示 |
| `orderMaxValidPerms` | 1~6 | **v1.32 新增**：硬上限 — 6 种排列里允许的最大可解数 | `blockSpawn` 在早期 attempt 拒绝 `validPerms > N` 的 triplet |
| `farFromPBBoostActive` | bool | **v1.56 §2.1 新增**：远征送爽是否激活（pct &lt; 0.30 且无 bypass 时为 true） | 触发 §2.5 `blockSpawn` 端 multiClear≥2 块权重 ×1.15；触发 §4.3 stressMeter "远征段送爽中" 叙事；豁免 multiClearBonus 几何兜底（≤0.4），让远征段空盘开局仍能保留 multiClearBonus floor=0.45 注入 |
| `winbackProtectionActive` | bool | v1.48 ≥7 天回流玩家保护期标识 | UI / 商业化 / 推送可据此判断"前 3 局保护期内" |

### 局内分数里程碑相对化（v1.49）

**为什么要相对化**：旧版 `MILESTONE_SCORES = [50, 100, 150, 200, 300, 500]` 是绝对档位，对不同水位玩家
的反馈节奏完全失衡：

- **新手**（一局 30–50 分）：偶尔触发一两次，反馈节奏正常；
- **中段玩家**（一局 200–500 分）：开局头几秒被 6 个 milestone toast 连击，单局之后再无任何里程碑反馈；
- **老玩家**（一局 1000+ 分）：前 30 秒刷掉所有 6 个里程碑，之后整局都没有"分数里程碑"反馈——机制对其失效。

**新版（`adaptiveSpawn.js: deriveScoreMilestones`）**：

| 玩家分层 | 触发条件 | 派生档位 |
|---|---|---|
| 新手 / `bestScore < 200` | 沿用绝对档（保留稳定的"突破 50→100→150"节奏） | `[50, 100, 150, 200, 300, 500]` |
| 中段以上 / `bestScore ≥ 200` | 按 `bestScore` 比例派生 | `[0.25, 0.5, 0.75, 1.0, 1.25] × bestScore` |

例如 `bestScore=1000` 的玩家会在 250 / 500 / 750 / 1000 / 1250 分各触发一次——节奏完全跟随个人水位。

**与跨局成熟度里程碑（`maturity_milestone_complete`）严格区分**：

| | 局内分数里程碑（本节） | 跨局成熟度里程碑 |
|---|---|---|
| 实现位置 | `adaptiveSpawn.js: scoreMilestoneCheck` | `retention/maturityMilestones.js` |
| 字段 | `_scoreMilestoneHit` / `_scoreMilestoneValue` / `spawnHints.scoreMilestone` | `playerProfile.maturity` 跃迁（M0→M4） |
| 触发频率 | 单局多次 | 跨局生涯中各一次 |
| 上报事件 | 仅前端浮动 toast | `ANALYTICS_EVENTS.MATURITY_MILESTONE_COMPLETE` |
| i18n key | `effect.scoreMilestone`（"分数突破 {{score}}！"） | maturity toast 走 `progress.*` 与 retention 模块独立翻译 |
| CSS 样式 | `.float-milestone`（蓝色） | retention 自己的 toast / overlay |

**v1.49 之前**两者都被叫"milestone"且文档里没有显式区分；现统一以 `scoreMilestone` vs `maturityMilestone`
两个独立前缀辨识，避免策划/运营/工程在沟通"里程碑"时所指不一。

### 局间热身（无步可走 → 下一局）

与上表独立：`game.js` 在 `noMovesLoss` 结算时写入 `openblock_spawn_warmup_v1`，下一局 `start()` 读入 `warmupRemaining`、`warmupClearBoost` 至 `spawnContext`，`adaptiveSpawn` 在余轮内抬高 `clearGuarantee`、`multiClearBonus` 下限、`multiLineTarget`，并把 `setup` 夹成 `neutral`。详见 [SPAWN_ALGORITHM.md](./SPAWN_ALGORITHM.md) §5.3。

### 爽感兑现（v3.3）

`deriveDelightTuning(profile, spawnContext, fill, cfg.delight)` 把“玩家是否能承接更强反馈”转为 `spawnHints`：

- 高技能且 `flowState==='bored'`：`delightMode='challenge_payoff'`，略提高 stress、提高 `delightBoost`，并把中性节奏推向 payoff，让玩家获得更有挑战的多消机会。
- `flowState==='flow'` 或 `pacingPhase==='release'`：`delightMode='flow_payoff'`，不强行加压，主要提高多消/清屏兑现概率。
- `flowState==='anxious'` 或 `needsRecovery`：`delightMode='relief'`，降低 stress、偏小块、提高消行保证，同时保留多消救援机会。
- `nearFullLines` / `pcSetup` 越高，`delightBoost` / `perfectClearBoost` 越高；若当前盘面已经存在可直接清屏的形状，`blockSpawn` 会优先把它纳入三连块候选。真正能否出对应块仍由候选检测、机动性和可解性校验决定。

### 用户行为奖励概率（v1.33）

启发式轨现在把最新用户行为特征拆成三类奖励概率目标：

- **清屏概率**：`playstyle='perfect_hunter'`，或 `clearEfficiency / boardPlanning` 较高且 `riskLevel` 较低时，在 `pcSetup` 或临消线成立的前提下提高 `perfectClearBoost`。
- **多消概率**：`playstyle='multi_clear' / 'combo'`、`comboChain` 活跃或高消行效率玩家，提高 `multiClearBonus` 与 `multiLineTarget`；无几何支撑时仍受 v1.19 软封顶。
- **同 icon / 同色概率**：`iconBonusTarget` 不改变形状选择，而是放大 `monoNearFullLineColorWeights()` 输出，让 dock 颜色更容易补齐差 1～2 格的同 icon/同色近满行列。

该层是概率倾向而非硬承诺：它不能绕过 `clearGuarantee` 回钳、`multiClearBonus` 几何兜底、`tripletSequentiallySolvable` 与解法数量过滤。

默认配置在 `shared/game_rules.json` 的 `adaptiveSpawn.delight` 下。调大 `highSkillMultiBoost` 会让高手更频繁遇到多消兑现；调大 `reliefMultiBoost` 会让焦虑/恢复态更容易翻盘；调大 `opportunityMultiBoost` 会更积极吃掉盘面已有临消/清屏机会。

### 触发规则

| 场景 | clearGuarantee | sizePreference | diversityBoost |
|------|---------------|----------------|----------------|
| 默认 | 1 | 0 | 0 |
| 差一点 | 2 | 0 | 0 |
| 挫败(≥4步) | 2 | -0.3 | 0 |
| 紧急恢复 | 2 | -0.5 | 0 |
| 新手引导 | 2 | -0.4 | 0 |
| 无聊 | 1 | 0 | 0.15 |
| 疲劳+下滑 | 1 | -0.2 | 0 |
| 连续无消行(≥2轮) | ≥2 | 保持原值 | 保持原值 |
| 连续无消行(≥4轮) | ≥3 | ≤ -0.35 | 保持原值 |

### 保命态说明

`adaptiveSpawn.js` 会把连续无消行转换为更强的 `spawnHints`：

- `roundsSinceClear ≥ 2`：提高到 `clearGuarantee ≥ 2`，让下一轮更容易出现消行/解压块。
- `roundsSinceClear ≥ 4`：提高到 `clearGuarantee ≥ 3`，并将 `sizePreference` 压到 `≤ -0.35`，优先小块与可消行块。

最终是否能出仍由 `blockSpawn.js` 的机动性与可解性约束把关；高填充或久未消行时还会进入严格可解性校验，详见 [SPAWN_ALGORITHM.md](./SPAWN_ALGORITHM.md) 与 [SPAWN_BLOCK_MODELING.md](./SPAWN_BLOCK_MODELING.md)。

---

## 7. 配置参考（game_rules.json）

所有参数位于 `shared/game_rules.json` 的 `adaptiveSpawn` 节，支持热修改（重启 Vite 生效）。

### 7.1 顶层

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `enabled` | bool | true | 总开关；false 时 fallback 到 resolveLayeredStrategy |
| `profileWindow` | int | 15 | 滑动窗口大小（最近 N 步行为） |
| `smoothingFactor` | float | 0.15 | 正常态 skillLevel 平滑系数 |
| `fastConvergenceWindow` | int | 5 | 前 N 步使用快速收敛 alpha |
| `fastConvergenceAlpha` | float | 0.35 | 快速收敛阶段的 alpha |

### 7.2 profiles

数组，每项：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识 |
| `label` | string | 中文描述（调试用） |
| `stress` | float | 在 stress 轴上的位置 |
| `shapeWeights` | object | 7 类形状的权重 |

### 7.3 pacing

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `enabled` | bool | true | 节奏调控开关 |
| `cycleLength` | int | 5 | 一个周期内的 spawn 轮数 |
| `tensionPhases` | int | 3 | 前 N 轮为紧张期 |
| `tensionBonus` | float | +0.04 | 紧张期 stress 加成 |
| `releaseBonus` | float | -0.12 | 释放期 stress 减成 |

### 7.4 engagement

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `firstSessionSpawns` | int | 5 | 新手保护持续的 spawn 轮数 |
| `firstSessionStressOverride` | float | -0.15 | 新手保护时 stress 上限 |
| `frustrationThreshold` | int | 4 | 连续未消行步数触发挫败救济 |
| `frustrationRelief` | float | -0.18 | 挫败救济 stress 减成 |
| `nearMissStressBonus` | float | -0.1 | 差一点效应 stress 减成 |
| `nearMissClearGuarantee` | int | 2 | 差一点效应 clearGuarantee |
| `noveltyDiversityBoost` | float | 0.15 | 无聊时 diversityBoost 值 |

### 7.5 flowZone

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `thinkTimeLowMs` | int | 1200 | 低于此值视为「太快→无聊」 |
| `thinkTimeHighMs` | int | 10000 | 高于此值视为「太慢→焦虑」 |
| `thinkTimeVarianceHigh` | int | 8000000 | 方差归一化上限（cognitiveLoad） |
| `clearRateIdeal` | float | 0.32 | 理想消行率（预留） |
| `clearRateTolerance` | float | 0.12 | 消行率容差（预留） |
| `missRateWorry` | float | 0.28 | 失误率高于此值判定焦虑 |
| `recoveryFillThreshold` | float | 0.82 | 板面填充率高于此值触发恢复 |
| `recoveryDuration` | int | 4 | 恢复模式持续步数 |
| `skillAdjustScale` | float | 0.3 | 技能调节幅度（±scale/2） |
| `flowBoredAdjust` | float | +0.08 | 无聊时 stress 加成 |
| `flowAnxiousAdjust` | float | -0.12 | 焦虑时 stress 减成 |
| `recoveryAdjust` | float | -0.2 | 恢复模式 stress 减成 |
| `comboRewardAdjust` | float | +0.05 | combo 连击 stress 加成 |

---

## 8. 调优指南

### 8.1 常见调优场景

| 目标 | 调整方式 |
|------|---------|
| 新手留存太低 | 增大 `firstSessionSpawns`；降低 `firstSessionStressOverride` |
| 高手觉得无聊 | 增大 `flowBoredAdjust`；增大 `skillAdjustScale` |
| 挫败感太强 | 降低 `frustrationThreshold`；增大 `frustrationRelief` 绝对值 |
| 节奏感不明显 | 增大 `releaseBonus` 绝对值（如 -0.18）；减少 `cycleLength` |
| 出块太单一 | 增大 `noveltyDiversityBoost`；增大 `variety` profile 的 stress 范围覆盖 |
| 差一点效应不够 | 增大 `nearMissClearGuarantee` 到 3 |

### 8.2 验证方法

1. **控制台查看**：`resolveAdaptiveStrategy` 返回值包含 `_adaptiveStress`、`_flowState`、`_skillLevel`、`_pacingPhase` 等调试字段
2. **A/B 测试**：通过 `adaptiveSpawn.enabled=false` 对照组 vs 自适应组
3. **关键指标**：平均局时长、首局续玩率、30 天留存、每局消行数

### 8.3 安全边界

- `adaptiveSpawn.enabled=false` → 完全回退到原有 `resolveLayeredStrategy`，零行为变化
- `blockSpawn.js` 始终保持 solvability 检查（`tripletSequentiallySolvable`），无论 spawnHints 如何设置
- `stress` 被钳制在 `[-0.2, 1.0]`，不会超出 profiles 范围
- **v1.32 orderRigor 安全边界**：(1) 五重 bypass（onboarding / needsRecovery / hasBottleneckSignal / `holes>3` / `boardFill<0.5`）任一成立即归 0；(2) blockSpawn 仅在前 ~55% attempt 内硬过滤，避免死循环；(3) `truncated=true`（DFS 不可信）按通过处理；(4) 完全关闭：`topologyDifficulty.orderRigorEnabled: false`。详见 [SPAWN_SOLUTION_DIFFICULTY §13](./SPAWN_SOLUTION_DIFFICULTY.md#13-v132-升级顺序刚性-orderrigor--高难度算法)。

---

## 9. 数据流与集成点

### 9.1 game.js 集成点

```
constructor()        → PlayerProfile.load()        // 从 localStorage 加载历史画像
start()              → profile.recordNewGame()      // 重置局内计数器
                     → resolveAdaptiveStrategy()    // 开局用自适应策略生成初始盘面
spawnBlocks()        → resolveAdaptiveStrategy()    // 每轮出块走自适应
                     → profile.recordSpawn()        // 记录 spawn 时间戳
endDrag() 放置成功   → profile.recordPlace(...)      // 记录放置结果
endDrag() 放置失败   → profile.recordMiss()          // 记录失误
saveSession()        → profile.save()               // 持久化到 localStorage
```

### 9.2 与其他系统的关系

| 系统 | 关系 |
|------|------|
| `difficulty.js`（原有） | 被 adaptiveSpawn 内部调用（`getSpawnStressFromScore`），不直接用于 game.js |
| `rl_pytorch/` | 不受影响——RL 训练使用 Python 侧的 `simulator.py`，不走自适应出块 |
| `strategies`（easy/normal/hard） | 仍为玩家可选基调，自适应在此基础上微调 |
| `dynamicDifficulty` | scoreStress 作为自适应引擎的一个输入信号 |
| `runDifficulty` | runStreakStress 作为自适应引擎的一个输入信号 |

---

## 关联文档

| 文档 | 说明 |
|------|------|
| [策略体验栈](../player/STRATEGY_EXPERIENCE_MODEL.md) | 通用四层模型、`spawnIntent` 单一口径、几何门控、压力表与叙事职责分离、顾问规则索引 |
| [实时策略系统](../player/REALTIME_STRATEGY.md) | 画像指标、stress 管线、策略卡生成、评审清单、时序与配置 |
| [出块三层架构](./SPAWN_ALGORITHM.md) | Layer1/2/3 与 `blockSpawn` 管线 |

---

## 10. 全球化个性化策略层（已实现）

`adaptiveSpawn.js` 现在在传统 stress 管线之外读取 `PlayerProfile.personalizationContext`，新增三类安全调节：

| 信号 | stress 分量 | `spawnHints` 影响 | 护栏 |
|------|-------------|-------------------|------|
| `motivationIntent=competence/relaxation` | `motivationStressAdjust < 0` | 提高保消、偏小块 | 不叠加 `orderRigor` |
| `motivationIntent=challenge` | 低风险高手小幅加压 | 提高多样性、多消目标，允许顺序规划 | 高填充/低机动/恢复态仍优先救济 |
| `motivationIntent=collection` | 默认不加压 | 提高 `iconBonusTarget`，有几何窗口时提高多消 | 必须通过 `canPromoteToPayoff` |
| `accessibilityLoad` | `accessibilityStressAdjust < 0` | 偏小块、保消、增加多样性 | 不推断年龄/健康，只由设备/操作行为代理 |
| `returningWarmupStrength` | `returningWarmupAdjust < 0` | 回归前几轮友好化 | 沉默时间来自本地会话历史 |
| `socialFairChallenge` | 关闭个体化分量 | 固定规则/固定 seed | 用于异步挑战公平性 |

这些字段会被写入 `spawnHints`、`_lastAdaptiveInsight` 和面板快照，供策略评审追踪。

---

## 10.5 延伸阅读：策略 → 出块的具体翻译

本文止于 `stress` 合成与 `spawnHints` 派生。**「`spawnHints` 如何作用到 `generateDockShapes` 内具体抽出 3 个块」** 的完整路径——5 阶段流水线、每条 hint 对应的加权乘子精确公式、阶段 4 硬约束循环、一个带实数计算的具体场景跑步、以及"概率偏好 / 数量保证 / 难度调控"三层结构设计哲学——见 [出块算法：三层架构 §2.5](./SPAWN_ALGORITHM.md#25-策略--出块翻译机制v15516)。

简要对应关系：

| 本文（策略层） | SPAWN_ALGORITHM.md §2.5（出块层） |
|---|---|
| §5 `stress` 合成 | §2.5.2 表 B 第 1 行 `shapeWeights[category]` 由 `interpolateProfileWeights(stress)` 决定 |
| §6 `spawnHints` 字典 | §2.5.2 表 A（占位）+ 表 B（30+ 加权乘子）+ 表 C（硬约束）三处消费 |
| §6 `scoreMilestone` | §2.5.5 v1.55.16 修复历史：`spawnHints → _spawnContext` 桥接，`blockSpawn.js:870-872` 从 dead branch 变为真生效 |

---

## 10.6 外部实证基线：SGAZ × Tetris Block Puzzle（v1.55.17）

> **来源**：Wang C-J. et al., *Evaluating Game Difficulty in Tetris Block Puzzle*, arXiv:2603.18994（NYCU × Academia Sinica，2026）。  
> **方法**：用 Stochastic Gumbel AlphaZero（SGAZ，结合 Gumbel-Top-k 与 Sequential Halving 的随机环境版 AlphaZero）作为"强 AI 难度评估器"，对 8×8 Tetris Block Puzzle 的规则变体跑短训练，以**训练奖励**（最后 50 iter 平均）与**收敛迭代数**（连续 3 iter 达最大奖励）量化难度。

#### 为什么这篇论文几乎可以直接对位 OpenBlock

| 维度 | 论文（Tetris Block Puzzle） | OpenBlock 默认配置 |
|---|---|---|
| 网格 | 8×8 | 8×8（`web/src/grid.js`） |
| 候选块数 `h` | `h ∈ {1, 2, 3}`，经典 `h=3` | 固定 `dock=3` |
| 块旋转 | 不允许 | 不允许（设计契约） |
| 预览候选 `p` | `p ∈ {0…4}`，经典 `p=0` | 无 preview 机制（`p=0`） |
| 形状库 | 标准 tetromino（+ 可选 U/V/X/T-pentomino） | **40 个变体**（v1.60.0 起，详见 §10.7）：超小直线 + 标准 tetromino + 内部变体 + 斜线散点 + 3 格 L 角；**无 pentomino**（5 格只保留 1x5/5x1/l5-*） |
| 计分 | 完整线 +1 分 | 等价 + multi-clear 加成 |

**结论**：OpenBlock 默认配置 = 论文 **classic `h=3, p=0`** baseline。论文实证该 baseline 下 SGAZ 收敛仅需 **61 iter**、训练奖励 **6544（≈ 上限 6750 的 97%）**——表明在"标准 tetromino + dock=3 + 无预览 + 8×8"这个组合下，强 AI 接近通关，**所有 OpenBlock 的难度调控空间都在这个"已被强 AI 摸顶"的规则边界之内**。

#### 三类规则变体的实证难度强度

| 规则杠杆 | 论文实证强度 | 关键数据 | OpenBlock 现状 |
|---|---|---|---|
| **候选块数 `h`** | **★★★ 最强** | `h=3 → h=2`：奖励从 6544 掉到 4126（−37%），收敛从 61 → 160 iter（+162%）；`h=1` 几乎不可玩（奖励 39，未收敛） | ✗ 固定 `dock=3`，从未浮动 |
| **形状库扩充** | **★★ 强** | 加任意一个 pentomino 即可让奖励显著下行；加两个 pentomino 在 `h=2, p=0` 下直接训练不收敛；**T-pentomino 单独造成最大减速** | ✓ v1.60.0：28 → 40 形状（+ 极小直线 / 斜线散点 / 3 格 L 角），并按"加减压策略"做 gate + 加权（详见 §10.7） |
| **预览数 `p`** | ★ 弱 | 增加 `p` 仅小幅降低难度；`h=1, p=4` 仍只能收敛到 ~5000 奖励，远不及 `h=3, p=0` 的 6544 | ✗ 无 preview 机制 |
| `shapeWeights` profile 插值 | 论文未直接测；OpenBlock 现行主要手段 | — | ✓ 10 档 profile + 17 stress 分量 |

#### 对 OpenBlock 调参的硬约束（**作为决策原则录入**）

1. **杠杆排序原则**：候选块数 > 形状库 > `shapeWeights` 插值 > 预览数。当前 OpenBlock 所有 17 个 stress 分量、25 格 `lifecycle cap`、30+ `blockSpawn` 加权乘子都聚焦于"同一形状池里调权重"这一**中等强度杠杆**；论文实证更强的"调候选块数 / 形状库"完全未被使用。**这意味着我们 stress 调到极限（norm 0.875 / raw 0.85）时仍处在一个相对"温和"的难度天花板下**——这是当前架构的真实边界。
2. **避免实质性 `h=1` 局面**：论文实证 `h=1` 是不可玩的崖底。OpenBlock 虽然名义上 `dock=3`，但在 `fill` 较高 + 形状库收紧 + 全候选块都不可放置时，会出现"实质性 `h=1`"。`bottleneckRelief`、`firstMoveFreedom` 信号即为此设计；调参时**任何会增加 dock 三块全部不可放概率的改动都必须配套加强 `bottleneckRelief`**。
3. **预览的边际效应可控**：未来若引入 preview 机制，论文实证其难度影响小于形状权重调控——意味着 preview 更适合作为**心理安抚 / 仪式感工具**（让玩家"觉得自己能规划"），而非真正改变胜率的杠杆。

#### 与 OpenBlock 自身校准的关系

- 当前 `LIFECYCLE_STRESS_CAP_MAP`（25 格 cap × adjust）与 `difficultyTuning.{easy/normal/hard}.minStress` 均为**经验设置**，无独立可复现基线。论文方法论（"SGAZ 短训练 → 训练奖励 + 收敛迭代"）给出了一个**廉价、可复现的客观校准工具**——未来若要在 `tools/` 中加入"规则变体难度回归"（参考 `tools/spawn_model_*`），可直接复用该范式。
- 论文给出的 baseline（`h=3, p=0` 经典：收敛 61 iter / 奖励 6544）可作为 OpenBlock 自家 SpawnTransformerV3 训练曲线的**外部参照锚**：我们的模型若学会"在此 baseline 下接近 max reward"则证明规则学习成功；继续提升只能通过**改 ruleProfile**（论文路径）而非"再调更多 stress 分量"。

> **关于"挑战自我"主线**：本节启示更细的应用映射详见 [最佳分追逐策略 §5.z 规则层调控（未来方向）](../player/BEST_SCORE_CHASE_STRATEGY.md#5z-基于-sgaz-实证的规则层调控未来方向v15517)。

---

## 13. v1.56 PB 段差异化机制（farFromPBBoost / pbExtremeOrderBoost）

> 与 [BEST_SCORE_CHASE_STRATEGY §5.α](../player/BEST_SCORE_CHASE_STRATEGY.md) 双向引用。本节聚焦算法侧实现细节；产品侧策略意图、用户故事与 KPI 参见策略文档。

### 13.1 PB 距离段五分（D0 ~ D4）

| 段位 | `pct = score / bestScore` | 主导机制 | spawnHints / breakdown 字段 |
|------|----------------------------|---------|------------------------------|
| **D0** 远征 | `[0, 0.30)` | `farFromPBBoostActive` 主动送爽 | `clearGuarantee ≥ 2`、`multiClearBonus ≥ 0.45`、`iconBonusTarget ≥ 0.30`、`sizePreference ≤ -0.12` |
| **D1** 跟随 | `[0.30, 0.80)` | 默认路径（无 PB 段加成） | — |
| **D2** 临近 | `[0.80, 0.95)` | `challengeBoost`（v1.55 §4.2） | `stressBreakdown.challengeBoost ∈ (0, 0.15]` |
| **D3** 决战 | `[0.95, 1.00)` | `pbExtremeOrderBoost` 顺序刚性 | `stressBreakdown.pbExtremeOrderBoost = 0.20`，orderRigor +0.20 |
| **D4** 突破 | `[1.00, ∞)` | `postPbReleaseStressAdjust`（v1.55 §4.9） | stress×0.7 共 3 个 spawn |

**段位边界设计依据**：

- D0 阈值 0.30：基于 P50 玩家"开局前 5 spawn 平均得分≈0.18~0.25 × bestScore"的观测分布
- D2 阈值 0.80 / D3 阈值 0.95：v1.55 即用阈值，保持与 `challengeBoost` / `bestScoreMilestoneCheck` 兼容
- D4 自然延伸：破 PB 即进入，不再有上限

### 13.2 `farFromPBBoost` 算法详解（§5.α §2.1）

**输入**：

- `score`（当前局分数）、`ctx.bestScore`（历史 PB 快照）
- `eng.farFromPBBoost`（`game_rules.json adaptiveSpawn.engagement.farFromPBBoost`）
- 上下文信号：`sessionArc / profile.needsRecovery / profile.hadRecentNearMiss / ctx.pbGrowthFast / ctx.postPbReleaseActive`

**执行顺序**（必须按以下优先级判定 bypass）：

```
1. !farCfg.enabled                → 'config_disabled'
2. !(ctx.bestScore > 0)           → 'no_best_score'
3. pct >= farCfg.pctThreshold     → 'pct_above_threshold'
4. sessionArc === 'warmup'        → 'warmup'
5. profile.needsRecovery          → 'recovery'
6. profile.hadRecentNearMiss      → 'near_miss'
7. ctx.pbGrowthFast               → 'pb_growth_throttled'
8. ctx.postPbReleaseActive        → 'post_pb_release'
9. 全部通过                       → farFromPBBoostActive=true
```

**注入字段**（仅在 9 时执行）：

```js
clearGuarantee = min(3, clearGuarantee + clearGuaranteeBoost);
multiClearBonus = max(multiClearBonus, multiClearBonusFloor);
iconBonusTarget = max(iconBonusTarget, iconBonusTargetFloor);
sizePreference = min(sizePreference, sizePreferenceShift);
```

注意 floor / shift 都用 `max` / `min`：不会覆盖更强的上游加成（如 `pcSetup ≥ 1` 已经把 multiClearBonus 推到 0.9，本节不会回退到 0.45）。

**多消几何兜底豁免**：

`adaptiveSpawn.js:1745` 的"几何缺失时把 multiClearBonus 封顶到 0.4"逻辑，v1.56 把 `farFromPBBoostActive` 加入豁免名单（与 `afkEngageActive` 同类）。理由：远征段开局通常恰好命中"_mcCands<1 && _nfLines<2 && !_realPcSetup"的空盘特征，若不豁免则 floor=0.45 注入会被立即撤回，让送爽机制失效。

### 13.3 `pbExtremeOrderBoost` 算法详解（§5.α §2.3）

**触发条件**（必须全部满足）：

```
ctx.bestScore > 0
∧ score >= ctx.bestScore * 0.95
∧ score < ctx.bestScore     // D3 内，未越过 PB
∧ !ctx.postPbReleaseActive   // 释放窗口内免疫
∧ !profile.needsRecovery
∧ !hasBottleneckSignal
∧ sessionArc !== 'warmup'
∧ !inOnboarding
```

**注入方式**（仅在触发时执行）：

```js
pbExtremeOrderBoost = 0.20;
stressBreakdown.pbExtremeOrderBoost = pbExtremeOrderBoost;

// 在 orderRigor 计算块中：
orderRigor = clamp01(stressTerm + skillTerm + modeBoost + motivationBoost + pbExtremeOrderBoost);
```

**与现有 orderRigor 路径的关系**：

- `orderRigor` 公式（v1.32）：`max(0, stress-threshold)*scale + max(0, skill-0.5)*0.20 + difficultyTuning.orderRigorBoost + motivationBoost`
- D3 段加入的 `pbExtremeOrderBoost=0.20` 与 Hard 模式 `orderRigorBoost=0.30` 同量级但更克制
- 五重 bypass（onboarding / needsRecovery / bottleneck / holes > 3 / boardFill < 0.50）任一成立时整段 `orderRigor=0`，pbExtremeOrderBoost 也不参与计算

**对盘面感知的影响**：

`orderRigor=0.20+原值` 通常会把 `orderMaxValidPerms` 从 4 收紧到 3 或从 3 收紧到 2，让 6 种排列里只有 2~3 种可行的 spawn 通过 `blockSpawn` 早期过滤。玩家感受为"必须按特定顺序摆这三块"，与 `challengeBoost` 的"形状更难塞"形成正交的两种加难手感。

### 13.4 `pbGrowthFast` 节流机制（§5.α §2.4）

**目的**：防止远征送爽（§2.1）让 PB 在远征段被反复抬升而透支生命周期。

**计算口径**（`web/src/pbGrowthTracker.js`）：

```
geometricMeanGrowth = (lastPB / firstPB)^(1 / (n-1))
其中 n = min(5, len(history)), window = history[-n:]
```

阈值 `isPbGrowthFast(0.10)`：最近 5 次 PB 几何平均增长率 ≥ 10% / 局视为"快速"。

**透传链路**：

```
game.js _emitPersonalBestEvent → recordPersonalBest(newBest, ts)
  → localStorage 'openblock_pb_history_v1' = [{value, ts}, ...]
game.js start() → isPbGrowthFast() → this._spawnContext.pbGrowthFast
adaptiveSpawn.js §2.1 → ctx.pbGrowthFast → bypass='pb_growth_throttled'
```

**仅节流远征送爽，不影响其他机制**：challengeBoost、orderRigor、postPbRelease 等正常运行。节流是"收回主动送爽的额外糖"，不是"反过来惩罚玩家"。

### 13.5 stressMeter 联动叙事（§5.α §4.3）

`web/src/stressMeter.js buildStoryLine()` 在 `boardRisk >= 0.6`（保活）之后、`shouldUseScorePushHighStress`（v1.31 守卫）之前插入 PB 距离段抢占：

```js
if (spawnHints?.farFromPBBoostActive === true) {
    return PB_DISTANCE_NARRATIVE.farBoostActive;  // "远征段送爽中：候选块更易消、更易触发同色奖励。"
}
if (Number.isFinite(breakdown?.pbExtremeOrderBoost) && breakdown.pbExtremeOrderBoost > 0) {
    return PB_DISTANCE_NARRATIVE.pbExtremeChase;  // "冲刺区！系统已切到顺序约束模式..."
}
```

D2/D4 段不在守卫范围（D2 走 challengeBoost / score-push 守卫，D4 已破 PB 由 best.over.* HUD 文案承担叙事）。

### 13.6 验证测试

`tests/bestScoreChaseStrategy.test.js` v1.56 §5.α 段（22 个用例）：

| 段 | 测试范围 | 用例数 |
|----|---------|--------|
| §2.1 | farFromPBBoost 5 路 bypass + active 路径 | 5 |
| §2.3 | pbExtremeOrderBoost 触发 / D2 不触发 / postPbRelease 免疫 | 3 |
| §3.1/§3.2/§3.4 | i18n key 完整性（zh-CN + en） | 8 |
| §2.4 | pbGrowthTracker 单调 / 增长率 / streak 计算 | 7（含 _emitPersonalBestEvent 集成 1） |
| §4.3 | stressMeter PB 联动叙事 + 高 boardRisk 优先级 | 3 |

v1.56.2 §5.α.6 段（12 个用例）见下方 §13.7。

### 13.7 认知一致性守卫：`pbChase.minBestScoreForIntenseFeedback`（v1.56.2）

PB 段差异化机制（farFromPBBoost / pbExtremeOrderBoost / D0 远征特效 ×1.3 / pb-streak-badge / endGame nearMiss banner / best-gap 五档文案）的所有"激烈反馈"在低水位玩家（`bestScore < 200`）身上会与实际水平形成**喜剧反差**——`best=80` 时 score=78 走"顺序约束"路径毫无意义，"差 5 分就到最佳！冲刺！" 与 80 的最佳分对比则是滑稽。

**统一阈值**（`shared/game_rules.json adaptiveSpawn.pbChase`）：

```json
{
  "minBestScoreForIntenseFeedback": 200
}
```

**算法侧 bypass 链路**：

| 机制 | 触发条件附加项 | bypass 标识 |
|------|---------------|-------------|
| `farFromPBBoost` | `ctx.bestScore >= floor` | `bypass='low_best_score'`（位于所有 bypass 之首） |
| `pbExtremeOrderBoost` | `ctx.bestScore >= floor` | 直接跳过赋值（`pbExtremeOrderBoost` 字段不出现在 breakdown） |

**`challengeBoost` 不受守卫影响**（设计取舍）：

v1.55 已有的 `challengeBoost` 机制已经 cap 在 0.15 内且有 5 路 bypass，低水位玩家在 D2/D3 段仍然能感受到"逼近最佳"的轻度加压。本守卫只 bypass v1.56 新增的两个机制，避免与 v1.55 已稳定的路径互相干扰。

**UI/特效侧守卫**：由 `web/src/game.js Game._isLowBestForIntenseCopy()` 公共 helper 统一判定，分别在 `updateUI` / `endGame` / `_updateProgressionHud` / `playClearEffect` 4 个挂点消费。详见 [BEST_SCORE_CHASE_STRATEGY §5.α.6](../player/BEST_SCORE_CHASE_STRATEGY.md#5α6-认知一致性守卫低-pb-时所有激烈文案降级v1562)。

### 13.8 策略隐性原则：算法静默执行 + 玩家通过体感感知（v1.56.3）

**核心约束**：远 PB 减压 / 近 PB 加压 / 超 PB 加压是**算法层暗中执行**的策略，**不应**在 UI 文字层暴露"系统在为你做什么"。算法机制（`farFromPBBoost` / `pbExtremeOrderBoost` / `challengeBoost` / 出块特效振幅调制）继续工作，但叙事层 / 文字层全部"去策略暴露"。

**算法行为：保留**（与 v1.56 / v1.56.2 完全一致）：

- `farFromPBBoost`：D0 段（pct < 0.30）主动加 multiClearBonus / iconBonusTarget / clearGuarantee + 多消权重 ×1.15
- `pbExtremeOrderBoost`：D3 段（pct ∈ [0.95, 1)）注入 +0.20 orderRigor
- `challengeBoost`（v1.55 §4.2）：D2/D3/D4 段数值加压（cap 0.15）
- `playClearEffect` 振幅调制：D0 段多消/perfect/bonusLines ×1.3 / D3 段单线弱化
- `near-miss-banner`：D2/D3 终局未破 PB 时展示

**叙事层：移除暴露**：

| 位置 | v1.56 旧实现 | v1.56.3 新实现 |
|------|---------------|----------------|
| `buildStoryLine` PB 距离段抢占 | farFromPBBoostActive=true → "远征段送爽中..."; pbExtremeOrderBoost>0 → "冲刺区！系统已切到顺序约束模式..." | **移除抢占块**——叙事让位给中性的 SPAWN_INTENT_NARRATIVE / 几何密度分级 |
| `PB_DISTANCE_NARRATIVE` 常量 | "远征段送爽中" / "冲刺区！系统已切..." | "节奏顺畅..." / "节奏紧凑..."（中性化，保留 export 兼容性） |
| `SIGNAL_LABELS.pbExtremeOrderBoost.label` | "D3 决战刚性" | "PB 临近调整" |
| `SIGNAL_LABELS.farFromPBBoostActive.label` | "远征送爽" | "PB 远段倾斜" |

**文字层（i18n）：统一事实陈述**：

| Key | v1.56 旧文案 | v1.56.3 新文案 |
|-----|--------------|----------------|
| `best.gap.victory` | "即将刷新最佳！冲刺！" | "差 {{gap}} 分"（@deprecated） |
| `best.gap.close` | "接近了！💪" | "差 {{gap}} 分"（@deprecated） |
| `best.gap.chase` | "冲刺区！还差 {{gap}} 分" | "差 {{gap}} 分"（@deprecated） |
| `best.gap.follow` | "靠近了 · 再 {{gap}} 分" | "差 {{gap}} 分"（@deprecated） |
| `best.over.legend` | "🏆 超越 +{{overPct}}% · 封神时刻" | "已超 {{over}} 分"（@deprecated） |
| `best.over.toNext25` | "突破 +10%！再追 {{next}}" | "已超 {{over}} 分"（@deprecated） |
| `endGame.nearMiss.D3` | "差 {{gap}} 分 · 这把差点就刷了" | "差 {{gap}} 分"（@deprecated，合并到 `endGame.nearMiss`） |
| `endGame.nearMiss.D2` | "差 {{gap}} 分 · 状态不错，再来一把" | "差 {{gap}} 分"（@deprecated，合并到 `endGame.nearMiss`） |
| `pbStreak.badge` | "🏆 {{n}} 连破" | "连破 {{n}} 次" |

**视觉层（CSS extraClass）：差异化保留**：

| 段 | extraClass | 视觉表达 |
|----|------------|----------|
| D3（pct ≥ 0.95） | `best-gap--close` | 红色高亮 |
| D2（0.80 ≤ pct < 0.95） | `best-gap--chase` | 橙色 |
| D4（gap ≤ 0） | `best-gap--over` | 金色 |
| D2/D3 终局 banner | `near-miss-banner--D3` | banner 样式区分紧张度 |

**结果**：玩家通过出块体感（"我突然得分更顺了 / 突然变难了"）、HUD 颜色变化（红 / 橙 / 金）、特效强度（多消庆祝 ×1.3 / 单线弱化）感知策略，**而不是**通过文字被告知"系统正在送爽 / 系统已切到顺序约束模式"。详见 [BEST_SCORE_CHASE_STRATEGY §5.α.7](../player/BEST_SCORE_CHASE_STRATEGY.md#5α7-策略隐性原则远-pb-减压--近-pb-加压--超-pb-加压在算法层暗中执行v1563)。

### 13.9 三原则下的算法完整闭环：D4 持续加压 + D0 分级减压 + PB 增长率反向加压（v1.56.4）

v1.56.3 §5.α.7 确立"策略隐性"原则后，算法层在三大原则下还存在 3 处关键缺口（详见 [BEST_SCORE_CHASE_STRATEGY §5.α.8](../player/BEST_SCORE_CHASE_STRATEGY.md#5α8-三原则下的算法完整闭环d4-持续加压--d0-分级减压--pb-增长率反向加压v1564)）。本节聚焦算法侧实现细节。

#### 13.9.1 D4 段 `pbOvershootBoost` 对数加压公式

```
pbOvershootBoost(score, best) = maxBoost · log10(1 + slope·overshoot) / log10(1 + slope)
overshoot = score / best - 1.0
```

默认 maxBoost=0.16, slope=5.0。归一化后保证 pct=∞ 极限为 maxBoost：

| pct | overshoot | log10(1+5·overshoot) | / log10(6) | × 0.16 |
|-----|-----------|----------------------|------------|--------|
| 1.00 | 0.00 | 0.0000 | 0.000 | 0.000 |
| 1.10 | 0.10 | 0.1761 | 0.226 | 0.036 |
| 1.25 | 0.25 | 0.3522 | 0.453 | 0.072 |
| 1.50 | 0.50 | 0.5441 | 0.700 | 0.112 |
| 2.00 | 1.00 | 0.7782 | 1.000 | 0.160 |

stress 累加后 cap 至 `capStress=0.90`（高于普通 0.85）。

#### 13.9.2 D4 段 `pbExtremeOrderBoost` 延续到 D4（弱强度）

v1.56 原版：`score < ctx.bestScore` 硬条件，破 PB 后立即关闭。
v1.56.4 改为：`_commonOrderGates` 公共门 + 分支
- D3（`score ∈ [0.95·best, best)`）：orderRigor += 0.20
- D4（`score > best`，与 pbOvershootActive 同步）：orderRigor += 0.08（`orderBoostInD4` 配置）

`pbExtremeOrderBoost` 字段以两者的 max 写入 stressBreakdown，下游 `orderRigor` 计算块通过 `Math.max` 取 D3 / D4 较大值。

#### 13.9.3 D4 段 spawnHints 收紧（与 farFromPBBoost 对称）

紧跟 farFromPBBoost 块之后，引入 `pbOvershootActive` 时收紧三参数：

```
multiClearBonus = min(multiClearBonus, overshoot.multiClearBonusCap)  // 默认 0.18
sizePreference = sizePreference + overshoot.sizePreferenceShift        // 默认 +0.12
clearGuarantee = max(0, clearGuarantee + overshoot.clearGuaranteeShift)// 默认 -1
```

#### 13.9.4 D0 段 `farRamp` 分级

farFromPBBoost 触发分支内引入子条件：

```
isExtremeFar = farRampCfg.enabled !== false && pctOfBest < extremeThreshold  // 默认 0.15
if (isExtremeFar) {
  mcbFloor  = max(mcbFloor,  extremeMultiClearBonusFloor)  // 0.55 (原 0.45)
  iconFloor = max(iconFloor, extremeIconBonusTargetFloor)  // 0.40 (原 0.30)
  sizeShift = min(sizeShift, extremeSizePreferenceShift)   // -0.18 (原 -0.12)
}
```

#### 13.9.5 `pbGrowthFast` challengeBoost cap 动态化

```
_growthCapDelta = (pbGrowthThrottle.enabled !== false && ctx.pbGrowthFast === true)
                  ? pbGrowthThrottle.challengeBoostCapDelta  // 默认 0.05
                  : 0
_challengeCap = 0.15 + _growthCapDelta
challengeBoost = min(_challengeCap, (score/best - 0.8) · 0.75)
```

写入 `stressBreakdown.challengeBoostGrowthCapBonus = _growthCapDelta`（仅在 > 0 时）。

#### 13.9.6 blockSpawn 层消费新 hints

| Hint | 触发条件 | 形状权重调制 |
|------|----------|---------------|
| `farFromPBBoostActive` | D0 边缘段 | `s.multiClear >= 2` → ×1.15 |
| `farExtremeBoostActive` | D0 极远段（叠加） | `s.multiClear >= 2` → ×1.13（叠加后 ≈ ×1.30） |
| `pbOvershootActive` | D4 超 PB 段 | `s.multiClear >= 2` → ×0.78；`cellCount >= 4` → ×1.20 |

#### 13.9.7 同源 bypass 链（与 v1.56.2 §5.α.6 一致）

所有 v1.56.4 新增机制全部受以下 bypass 约束：
1. **低 PB 守卫**：`ctx.bestScore < minBestScoreForIntenseFeedback`（默认 200）
2. **postPbRelease**：`ctx.postPbReleaseActive === true`（破 PB 后 3 spawn 内的"高光释放窗口"）
3. **救济**：`profile.needsRecovery === true`
4. **瓶颈**：`hasBottleneckSignal === true`
5. **warmup / onboarding**：会话弧线在热身段 / 新手期

这保证"算法加压"永远不会与"算法减压"自相矛盾，也不会突破玩家 capability cap。

### 13.10 D4 加压链路 4 处冲突完整修复（v1.56.6）

v1.56.4 §5.α.8 在算法**逻辑层**增加了 pbOvershootBoost / D4 spawnHints 收紧，但**端到端 stress 链路审计**发现 D4 加压被 4 处机制反向消解。本节聚焦修复细节。

#### 13.10.1 冲突诊断矩阵

| # | 冲突源 | 公式 | 对 D4 段净效果 |
|---|--------|------|----------------|
| C2 | `occupancyDamping`（line ~1226） | `stress × max(0.4, occAnchor/0.5)` | 玩家破 PB 后盘面骤空 → ×0.5 消解 |
| C3 | `flowPayoffCap`（line ~1256） | `stress ≤ 0.79`（flow+payoff+无空洞时）| 玩家破 PB 时常处 flow + payoff → cap 截断 |
| C4 | `smoothStress`（line ~1246） | `maxStepUp = 0.18` | 单 spawn 限速 → "突然变难"被平滑 |
| C1 | `scoreStress`（difficulty.js percentileMaxOver=0.2） | `projected = min(lastMilestone × 1.2, pct × lastMilestone)` | pct > 1.2 时 scoreStress 完全饱和 |

#### 13.10.2 修复实施

**P0-C2 occupancyDamping 豁免**：

```js
const _ohBypassOcc = (cfg.pbChase?.overshoot?.bypassOccupancyDamping) !== false;
const _ohActiveBypassOcc = pbOvershootActive && _ohBypassOcc;
if (stress > 0 && !_ohActiveBypassOcc) {
  /* 原 damping 逻辑 */
}
stressBreakdown.occupancyDampingBypassed = _ohActiveBypassOcc;
```

**P0-C3 flowPayoffCap 豁免**：

```js
const _ohBypassFpc = (cfg.pbChase?.overshoot?.bypassFlowPayoffCap) !== false;
const _ohActiveBypassFpc = pbOvershootActive && _ohBypassFpc;
if (... && !_ohActiveBypassFpc) {
  stress = Math.min(stress, flowPayoffCap);
}
if (_ohActiveBypassFpc) stressBreakdown.flowPayoffCapBypassed = true;
```

**P1-C4 smoothStress 动态 maxStepUp**：

```js
const _ohSmoothMaxStepUp = Number(cfg.pbChase?.overshoot?.smoothMaxStepUp);  // 默认 0.25
const _smoothingCfg = pbOvershootActive && Number.isFinite(_ohSmoothMaxStepUp)
  ? { ...(cfg.stressSmoothing ?? {}), maxStepUp: _ohSmoothMaxStepUp }
  : cfg.stressSmoothing;
stress = smoothStress(stress, ctx, _smoothingCfg, immediateRelief);
if (pbOvershootActive && Number.isFinite(_ohSmoothMaxStepUp)) {
  stressBreakdown.smoothingDynamicMaxStepUp = _ohSmoothMaxStepUp;
}
```

**P1-C1 percentileMaxOver 0.2 → 0.5**（`shared/game_rules.json`）：

```json
"dynamicDifficulty": { "percentileMaxOver": 0.5 }
```

让 `projected = min(lastMilestone × 1.5, pct × lastMilestone)`，pct 从 1.0 → 1.5 时 scoreStress 仍持续递增。

#### 13.10.3 配置化

| 配置 | v1.55 旧值 | v1.56.6 默认 | 配置路径 |
|------|------------|---------------|----------|
| challengeBoost cap | 0.15（硬编码）| 0.18 | `adaptiveSpawn.pbChase.challengeBoost.baseCap` |
| postPbRelease 窗口 | 3 spawn（硬编码）| 5 spawn | `adaptiveSpawn.pbChase.postPbReleaseWindow.spawns` |
| postPbRelease stress 衰减系数 | 0.7（硬编码）| 0.7 | `adaptiveSpawn.pbChase.postPbReleaseWindow.stressReleaseFactor` |
| D4 occupancyDamping 豁免 | 不存在 | true | `adaptiveSpawn.pbChase.overshoot.bypassOccupancyDamping` |
| D4 flowPayoffCap 豁免 | 不存在 | true | `adaptiveSpawn.pbChase.overshoot.bypassFlowPayoffCap` |
| D4 smoothStress maxStepUp | 0.18（共享）| 0.25 | `adaptiveSpawn.pbChase.overshoot.smoothMaxStepUp` |

#### 13.10.4 净效果验证

| 段位 | 场景 | 修复前 finalStress | 修复后 finalStress |
|------|------|---------------------|---------------------|
| D2 临近 (pct=0.85) | 任意 | ~0.40 | ~0.40（不变） |
| D3 决战 (pct=0.97) | 中等 fill | ~0.68 | ~0.71（cap 提升）|
| **D4 超 PB (pct=1.50)** | **空盘 + flow + payoff** | **~0.50** 🔴 | **~0.85** ✅ |
| **D4 超 PB (pct=1.20)** | **空盘 + flow + payoff** | **~0.45** 🔴 | **~0.75** ✅ |

→ D4 段与 D2 段 finalStress **落差从 ~0.10 提升到 ~0.45**，玩家可清晰感知"超 PB 后越来越紧"。

详见 [BEST_SCORE_CHASE_STRATEGY §5.α.9](../player/BEST_SCORE_CHASE_STRATEGY.md#5α9-d4-段加压链路-4-处冲突完整修复v1566)。

---

### 10.7 形状池扩展（v1.60.0：28 → 40，按"加减压策略"做 gate + 加权）

#### 设计目标

§10.6 论文实证「**形状库扩充**是 ★★ 强级杠杆」——OpenBlock 在 v1.60.0 之前从未动用，仅靠 `shapeWeights` profile 插值（★ 中级杠杆）。**v1.60.0** 首次以"形状库扩充"作为减压/加压双向手段：

- **前期减压**：补充更小、更易消行的形状（占地 2-3 格），让初学者/恢复期的玩家在低 `sizePreference` 区间能稳定拿到"易消行小块"，**降低"无可用形状"挫败感**
- **后期加压**：补充极稀疏散点形状（斜线 3 格），让高手在高 `stress` + `pressure intent` 区间面对"占地少但极难消行"的新挑战类型，**提升 stress 顶部的"形态难度"维度**

#### 新增 12 形状清单（全部 ≤ 3 格，归入既有类目，**不新增 category**）

| ID | 形状 | category | 占格 | 角色 | gate / 加权策略 |
|---|---|---|---|---|---|
| `1x2` `2x1` | 1×2 直线 | `lines` | 2 | **减压·极小补缝** | 默认入池；`sizePreference ≤ -0.3` 时 ×1.6 |
| `1x3` `3x1` | 1×3 直线 | `lines` | 3 | **减压·小补缝** | 默认入池；`sizePreference ≤ -0.3` 时 ×1.6 |
| `diag-2a` `diag-2b` | 2 格对角 ↗/↘ | `zshapes` | 2 | **中性·对角补缝** | 默认入池；无 bonus |
| `diag-3a` `diag-3b` | 3 格对角 ↗/↘ | `zshapes` | 3 | **加压·稀疏挑战** | **gate**：仅 `spawnIntent ∈ {pressure, sprint}` **且** `profile.skillLevel ≥ 0.5` 时入池；否则 reject |
| `l3-a` `l3-b` `l3-c` `l3-d` | 3 格 L 角 ↘/↙/↗/↖ | `lshapes` | 3 | **中性·角落补缝** | 默认入池；`gapFills > 0` 时 ×1.3 |

#### Gate 与加权代码锚点

| 函数 | 文件路径 | 说明 |
|---|---|---|
| `_passesShapeGate(shape, hints, profile, ctx, fill)` | `web/src/bot/blockSpawn.js` | 在 `scored.map` 内"可放置过滤"之后执行；diag-3 严格 gate；其他 10 个新形状默认通过 |
| `_applyShapeBonusWeight(baseWeight, shapeId, hints, gapFills)` | `web/src/bot/blockSpawn.js` | 在 `weight = weights[category]` 之后做乘法 nudge；超小直线在 `sizePreference ≤ -0.3` 时 ×1.6；3 格 L 角在 `gapFills > 0` 时 ×1.3 |
| `_estimateTopDriver(s, shapeWeights)` | `web/src/bot/blockSpawn.js` | 新增 4 个形态特异性 driver：`tinyLine`（极小补缝）、`diagonalPair`（对角补缝）、`diagonalSparse`（稀疏挑战）、`cornerFit`（角落补缝），供 DFV 顶部摘要展示 |

#### 三路词表对齐

形状池扩展涉及 **3 个独立 SHAPE_VOCAB**，**顺序必须严格一致**（新 12 个紧追末尾 idx 28-39，保持原 0-27 兼容）：

| 词表位置 | 文件 | 用途 |
|---|---|---|
| 几何真源 | `shared/shapes.json` | 所有运行时（web + miniprogram + RL）唯一形状数据来源 |
| 前端推理 | `web/src/spawnModel.js` `SHAPE_VOCAB` | model-v3 推理时 logits idx → shape id 映射 |
| 训练侧 | `rl_pytorch/spawn_model/dataset.py` `SHAPE_VOCAB` + `SHAPE_CATEGORY` | 训练数据采样标签 + 多样性辅助损失 |

> ⚠ **重训要求**：SpawnTransformer / model-v3 checkpoint 的 `NUM_SHAPES` 输出维 28 → 40，旧 checkpoint **必须重训**才能在 `SPAWN_MODE_MODEL_V3` 下生效。**rule 模式（默认）不受影响**。

#### 与论文实证强度的关系

| 论文 | OpenBlock v1.60.0 现状 |
|---|---|
| 加 pentomino 让奖励显著下行 | 我们**仅加 2-3 格小块**（不加 pentomino），且对最难的 diag-3 做 skill+intent 双重 gate；预期**只在合适场景**触发新难度，不破坏 baseline |
| T-pentomino 单独造成最大减速 | OpenBlock 早已含 t-up/down/left/right 4 个 T 形（基础池），未扩到 5 格 T-pentomino |
| 形状库扩充 ★★ 强杠杆 | v1.60.0 首次正式动用此杠杆，但**保守、可回滚**：所有新形状均经 `_passesShapeGate` / `_applyShapeBonusWeight` 受控；移除时只需删 12 个 JSON 条目 |

#### 单元测试（5 条 invariant，全过）

详见 `tests/blockSpawn.test.js`：

1. **池扩展**：`getAllShapes().length === 40` 且 12 个新 id 全部存在
2. **diag-3 gate 拦截**：新手场景（`spawnIntent='maintain'` 或 `skillLevel < 0.5`）40 轮采样中 diag-3 永不出现
3. **diag-3 gate 放行**：`pressure` + `skillLevel=0.85` 时 60 轮采样累计至少 1 次 diag-3 入池
4. **超小直线加权**：`sizePreference=-0.6` 时 60 轮采样累计至少 5 次超小直线入选
5. **driver 语义**：人造 scored entry → `_estimateTopDriver` 对各新形状返回 `tinyLine` / `diagonalPair` / `diagonalSparse` / `cornerFit`

#### 多端同步

| 平台 | 路径 | 同步机制 |
|---|---|---|
| Web | `web/src/` | 直读 `shared/shapes.json`（Vite 打包） |
| 微信/抖音小程序 | `miniprogram/core/shapesData.js` | `bash scripts/sync-core.sh` 一键转换为 CJS 数据模块 |
| RL 训练（PyTorch） | `rl_pytorch/shapes_data.py` | 运行时读取 `shared/shapes.json`（路径绑定） |
| RL 训练（MLX） | `rl_mlx/shapes_data.py` | 同上 |
| Spawn 模型词表 | `web/src/spawnModel.js` + `rl_pytorch/spawn_model/dataset.py` | 手动同步（顺序契约见上） |

> v1.60.0 顺便修复了 `scripts/sync-core.sh` 一个长期漂移：未支持 `import * as X` 转换、未对 `monetization/` `retention/` `lifecycle/` 等"小程序未分发子目录"的 require 做 try-wrap，导致每次同步都把 web 端新依赖硬带回小程序而崩溃。**新增软依赖 try-wrap 机制**后，未来 web 端引入任何新子系统都不会破坏小程序构建。

---

## 11. 后续迭代方向

### 11.1 短期（可直接在 JSON 配置层面调优）

- [ ] A/B 测试各参数对留存/局时长的影响
- [ ] 根据真实用户数据校准 `flowZone` 阈值
- [ ] 新增更多 profiles（如 `warmup` 用于每局前 2 轮渐进过渡）

### 11.2 中期（需少量代码改动）

- [ ] **服务端画像同步**：将 PlayerProfile 持久化到 `user_stats` 表，跨设备保留
- [ ] **形状级出块控制**：spawnHints 支持 `preferShapeIds`，可指定特定形状（如教学关）
- [ ] **板面结构感知**：在 adaptiveSpawn 中分析「接近满行」的行数，精准投放补全块
- [ ] **session 维度分析**：在 `server.py` 记录每局的 `_adaptiveStress` 时序，用于后台分析

### 11.3 长期（系统性升级）

- [ ] **ML 驱动 DDA**：用用户行为数据训练预测模型（研究表明可比人工规则提升 20% 留存）
- [ ] **玩家分群**：基于 `user_stats` 聚类不同玩家类型（休闲/竞技/社交），差异化策略
- [ ] **RL + 出块协同**：让 RL 模型学会在自适应出块环境下最优决策
- [ ] **实时 A/B 框架**：无需重启即可对不同玩家群体切换参数
