# 自适应出块引擎：10 信号融合

> 本文描述 OpenBlock 的自适应出块（Adaptive Spawn）系统的设计理念、架构、配置与调优指南，方便后续迭代。

## 目录

- [1. 领域知识基础](#1-领域知识基础)
- [2. 系统架构](#2-系统架构)
- [3. 玩家能力画像（PlayerProfile）](#3-玩家能力画像playerprofile)
- [4. 策略候选库（10 档 Profiles）](#4-策略候选库10-档-profiles)
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
- **落地**：`hadRecentNearMiss` → 下轮投放消行友好块，制造「戏剧性消行」正反馈

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
│  10 信号融合：                                                           │
│    scoreStress + skillAdjust + flowAdjust + pacingAdjust               │
│    + recoveryAdjust + frustrationRelief + comboReward + nearMissAdjust │
│                                                                         │
│  特殊覆写：新手保护 / 差一点放大                                         │
│                                                                         │
│  输出：shapeWeights（10 档插值）+ spawnHints                            │
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
| `shared/game_rules.json` | 配置 | 10 档策略权重、节奏参数、参与度参数、心流阈值 |
| `web/src/playerProfile.js` | 画像 | 滑动窗口行为追踪、多维技能计算、状态判定、持久化 |
| `web/src/adaptiveSpawn.js` | 引擎 | 10 信号融合 → stress → 10 档插值 + spawnHints |
| `web/src/bot/blockSpawn.js` | 执行 | 接受 spawnHints，生成三连块（保持 solvability 不变量） |
| `web/src/difficulty.js` | 基础 | 原有 score→stress 映射（被自适应引擎内部调用） |
| `web/src/game.js` | 集成 | 事件采集 + 调用入口 |

---

## 3. 玩家能力画像（PlayerProfile）

### 3.1 数据录入接口

| 方法 | 调用时机 | 采集信息 |
|------|---------|---------|
| `recordSpawn()` | 每轮出块时 | 更新 lastActionTs、spawnCounter |
| `recordPlace(cleared, lines, fill)` | 成功放置后 | thinkMs、消行结果、板面填充率 |
| `recordMiss()` | 拖放失败时 | thinkMs、失误计数 |
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

---

## 4. 策略候选库（10 档 Profiles）

10 档 profile 按 `stress` 值升序排列，引擎在相邻两档间做线性插值。

| # | ID | stress | 线条权重 | 不规则权重 | 设计意图 |
|---|-----|--------|---------|-----------|---------|
| 1 | `onboarding` | -0.2 | 3.0 | 0.35~0.45 | 新玩家首 5 轮：极高消行友好块，建立信心 |
| 2 | `recovery` | -0.1 | 2.8 | 0.5~0.6 | 板面快满：大量线条便于自救 |
| 3 | `comfort` | 0.0 | 2.5 | 0.65~0.75 | 低技能/挫败后：恢复信心，偶尔引入简单不规则块 |
| 4 | `momentum` | 0.1 | 2.4 | 0.78~0.85 | combo 后催化：偏向能串联消行的块型 |
| 5 | `guided` | 0.2 | 2.3 | 0.88~0.95 | 中低技能成长：逐步引入不规则块 |
| 6 | `breathing` | 0.3 | 2.15 | 0.95~1.0 | 紧张期后释放：给玩家喘息空间 |
| 7 | `balanced` | 0.4 | 2.0 | 1.12 | 心流核心区（≈ normal 策略） |
| 8 | `variety` | 0.5 | 1.85 | 1.15~1.2 | 防审美疲劳：拉平权重增加多样性 |
| 9 | `challenge` | 0.65 | 1.7 | 1.25~1.3 | 中高手进阶：不规则块明显增多 |
| 10 | `intense` | 0.85 | 1.45 | 1.38~1.48 | 高手极限：T/Z/L/J 权重超过线条 |

### 设计原则

1. **相邻间距不均匀**：低 stress 区间更密集（新手/挫败场景需要更细腻的调控）
2. **每档有明确的心理学目标**：不是简单的权重渐变，而是对应具体的玩家体验场景
3. **线条→不规则的渐变**：从极度消行友好到空间规划压力的连续谱

---

## 5. 自适应引擎（AdaptiveSpawn）

### 5.1 Stress 计算公式

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
```

特殊覆写：`isInOnboarding → stress ≤ -0.15`

最终范围：`[-0.2, 1.0]`

### 5.2 信号效果总览

| 信号 | 方向 | 幅度 | 触发条件 | 心理学依据 |
|------|------|------|---------|-----------|
| scoreStress | + | 0~0.78 | 分数越高 | 传统递进难度 |
| skillAdjust | ± | ±0.15 | 技能偏离中位 | 个性化适配 |
| flowAdjust | ± | -0.12~+0.08 | 心流偏移 | Csíkszentmihályi |
| pacingAdjust | ± | -0.12~+0.04 | 周期相位 | 张弛有度 |
| recoveryAdjust | - | -0.2 | fill > 82% | 防止不公平死局 |
| frustrationRelief | - | -0.18 | ≥ 4 步未消行 | 流失预防 |
| nearMissAdjust | - | -0.1 | 高填充+未消行 | 差一点效应 |
| comboReward | + | +0.05 | combo ≥ 2 | 正反馈 |
| onboarding | 覆写 | ≤ -0.15 | 新玩家前 5 轮 | 首局保护 |

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

## 10. 后续迭代方向

### 10.1 短期（可直接在 JSON 配置层面调优）

- [ ] A/B 测试各参数对留存/局时长的影响
- [ ] 根据真实用户数据校准 `flowZone` 阈值
- [ ] 新增更多 profiles（如 `warmup` 用于每局前 2 轮渐进过渡）

### 10.2 中期（需少量代码改动）

- [ ] **服务端画像同步**：将 PlayerProfile 持久化到 `user_stats` 表，跨设备保留
- [ ] **形状级出块控制**：spawnHints 支持 `preferShapeIds`，可指定特定形状（如教学关）
- [ ] **板面结构感知**：在 adaptiveSpawn 中分析「接近满行」的行数，精准投放补全块
- [ ] **session 维度分析**：在 `server.py` 记录每局的 `_adaptiveStress` 时序，用于后台分析

### 10.3 长期（系统性升级）

- [ ] **ML 驱动 DDA**：用用户行为数据训练预测模型（研究表明可比人工规则提升 20% 留存）
- [ ] **玩家分群**：基于 `user_stats` 聚类不同玩家类型（休闲/竞技/社交），差异化策略
- [ ] **RL + 出块协同**：让 RL 模型学会在自适应出块环境下最优决策
- [ ] **实时 A/B 框架**：无需重启即可对不同玩家群体切换参数
