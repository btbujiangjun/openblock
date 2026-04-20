# 实时游戏策略系统设计文档

> 版本：1.0 | 更新日期：2026-04-08

## 1. 系统总览

OpenBlock 实时策略系统由三层组成，形成**感知 → 决策 → 呈现**的闭环：

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         实时策略系统架构                                   │
│                                                                          │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────────┐   │
│  │ PlayerProfile │───▶│ AdaptiveSpawn    │───▶│ StrategyAdvisor       │   │
│  │  玩家画像层    │    │  自适应出块层     │    │  策略顾问层            │   │
│  │              │    │                  │    │                       │   │
│  │ 输入：行为数据 │    │ 输入：画像 + 分数 │    │ 输入：画像+棋盘+insight│   │
│  │ 输出：能力指标 │    │ 输出：stress +   │    │ 输出：1~3 条个性化     │   │
│  │ + 状态信号    │    │  shapeWeights +  │    │  策略建议              │   │
│  │              │    │  spawnHints      │    │                       │   │
│  └──────────────┘    └──────────────────┘    └───────────────────────┘   │
│         ▲                                              │                 │
│         │              每次落子/出块/失误                 ▼                 │
│         └──────────────── game.js ───────────▶ 玩家画像面板 (UI)          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 核心文件

| 文件 | 职责 |
|------|------|
| `web/src/playerProfile.js` | 玩家实时能力画像：滑动窗口行为数据 → 多维指标 + 状态信号 |
| `web/src/adaptiveSpawn.js` | 自适应出块引擎：10 维信号 → stress + spawnHints → 形状权重插值 |
| `web/src/strategyAdvisor.js` | 策略顾问：画像 + 棋盘 → 个性化策略建议 |
| `web/src/playerInsightPanel.js` | 面板渲染：实时展示策略建议 + 系统解释 |
| `shared/game_rules.json` | 全部可调参数的单一数据源 |

---

## 2. 第一层：玩家画像（PlayerProfile）

### 2.1 数据采集

每次玩家操作自动录入：

| 事件 | 采集字段 | 调用方法 |
|------|---------|---------|
| 出块刷新 | timestamp | `recordSpawn()` |
| 放置方块 | thinkMs, cleared, linesCleared, boardFill | `recordPlace()` |
| 放置失败 | thinkMs | `recordMiss()` |
| 新局开始 | — | `recordNewGame()` |

所有数据存入**滑动窗口**（默认 15 步），超出自动淘汰。

**AFK 检测**：`thinkMs > 15s` 的操作标记为 AFK，从 metrics 计算中排除，避免离开/后台干扰能力估计。阈值通过 `game_rules.json → adaptiveSpawn.afk.thresholdMs` 配置。

### 2.2 能力维度

| 维度 | 范围 | 计算方式 |
|------|------|---------|
| **skillLevel** | 0~1 | 5 维加权合成（thinkScore×0.15 + clearScore×0.30 + comboScore×0.20 + missScore×0.20 + loadScore×0.15），指数平滑，前 5 步贝叶斯快速收敛 |
| **momentum** | -1~1 | 滑动窗口前半 vs 后半 clearRate 差值 / 0.3 |
| **cognitiveLoad** | 0~1 | thinkMs 方差 / thinkTimeVarianceHigh |
| **engagementAPM** | >0 | 窗口内操作次数 / 时间跨度（分钟） |

### 2.3 实时状态信号

| 信号 | 类型 | 说明 |
|------|------|------|
| **flowDeviation** | number (0~2) | 量化心流偏移度 F(t) = \|boardPressure / skillLevel − 1\|，越小越沉浸 |
| **flowState** | bored / flow / anxious | 基于 F(t) + 多维阈值判定 |
| **pacingPhase** | tension / release | spawnCounter 对 cycleLength 取模 |
| **frustrationLevel** | number ≥0 | 连续未消行步数 |
| **hadRecentNearMiss** | boolean | 上一步高填充未消行 |
| **needsRecovery** | boolean | 板面曾 >82% → 恢复倒计时 |
| **sessionPhase** | early / peak / late | 按时间和轮次判定 |
| **feedbackBias** | -0.15~0.15 | 闭环反馈：出块后 4 步消行效果 vs 预期 → 微调 stress |

### 2.4 闭环反馈机制

```
recordSpawn()
  │  bias *= decay(0.8)
  │  开启观察窗口 horizon=4
  ▼
recordPlace() × 4 步
  │  累计 clearsInWindow
  ▼
窗口结束
  │  delta = clearsInWindow - expected(1)
  │  bias += delta × alpha(0.02)
  │  bias = clamp(-0.15, 0.15)
  ▼
bias 叠加到下次 stress 计算
```

---

## 3. 第二层：自适应出块引擎（AdaptiveSpawn）

### 3.1 十维信号合成（10 Signal Dimensions）

```
stress = scoreStress          // 分数驱动基础压力
       + runStreakStress       // 连战加成
       + skillAdjust           // (skill - 0.5) × 0.3
       + flowAdjust            // bored +δ / anxious -δ（幅度随 F(t) 放大）
       + pacingAdjust          // tension +0.04 / release -0.12
       + recoveryAdjust        // 恢复 -0.2
       + frustrationRelief     // 挫败 -0.18
       + comboReward           // combo≥2 +0.05
       + nearMissAdjust        // 差一点 -0.1
       + feedbackBias          // 闭环反馈 ±0.15

stress = clamp(-0.2, 1.0)
```

### 3.2 特殊覆写

| 条件 | 行为 |
|------|------|
| `isInOnboarding` | stress 上限钳制到 -0.15 |
| 新手保护 | clearGuarantee ≥ 2, sizePreference = -0.4 |
| 板面恢复 | clearGuarantee ≥ 2, sizePreference = -0.5 |
| 晚期疲劳 | sizePreference ≤ -0.2 |

### 3.3 十档权重 Profile

stress 通过线性插值映射到 10 档 shapeWeights：

| 档位 | stress | 特征 |
|------|--------|------|
| onboarding | -0.2 | 极高线条/矩形，最小化不规则块 |
| recovery | -0.1 | 大量线条便于消行自救 |
| comfort | 0.0 | 消行友好为主 |
| momentum | 0.1 | 催化连击正反馈 |
| guided | 0.2 | 逐步引入不规则块 |
| breathing | 0.3 | 紧张后喘息空间 |
| balanced | 0.4 | 心流核心区，均衡出块 |
| variety | 0.5 | 拉平权重增加多样性 |
| challenge | 0.65 | 不规则块明显增多 |
| intense | 0.85 | T/Z/L/J 超过线条 |

### 3.4 spawnHints 输出

| 字段 | 范围 | 作用 |
|------|------|------|
| clearGuarantee | 1~3 | 优先从能填缺口的形状中抽样 |
| sizePreference | -1~1 | 负值偏小块，正值偏大块 |
| diversityBoost | 0~1 | 惩罚重复品类，增加新鲜感 |

---

## 4. 第三层：策略顾问（StrategyAdvisor）

### 4.1 设计理念

- **面向玩家**：不解释系统参数，而是告诉玩家「该做什么」
- **优先级排序**：多条建议按紧急程度降序，最多展示 3 条
- **5 大策略类别**：survival / clear / build / pace / explore
- **实时刷新**：每次落子、出块、失误后自动更新

### 4.2 十大策略场景

| # | 场景 | 触发条件 | 优先级 | 类别 | 建议 |
|---|------|---------|--------|------|------|
| 1 | **紧急清行** | fill > 75% | 0.95 | survival | 优先放置能完成整行的块，避免堆高 |
| 2 | **控制高度** | fill > 60% | 0.70 | survival | 优先降低最高列或填补空洞 |
| 3 | **恢复模式** | needsRecovery | 0.88 | survival | 利用小块/长条尽快消行腾空间 |
| 4 | **填补空洞** | holes > 3 | 0.72 | build | 优先将块放入凹陷处 |
| 5 | **保持连击** | comboStreak ≥ 2 | 0.80 | clear | 关注接近满行区域延续连击 |
| 6 | **差一步消行** | hadRecentNearMiss | 0.75 | clear | 这轮出块更友好，抓住机会 |
| 7 | **挫败缓解** | frustration ≥ 4 | 0.82 | pace | 系统已降低难度，先找最容易消的行 |
| 8 | **提升挑战** | flowState = bored | 0.50 | build | 尝试构建多行同消或 combo 结构 |
| 9 | **放慢节奏** | flowState = anxious | 0.65 | pace | 多观察候选块与缺口匹配关系 |
| 10 | **简化决策** | thinkMs > 8s & load > 60% | 0.55 | pace | 先放最明确的块 |
| 11 | **调整策略** | momentum < -0.4 | 0.60 | build | 留出一列做长条消行通道 |
| 12 | **规划堆叠** | fill < 30% & skill > 50% | 0.40 | build | 留 1~2 列通道备用 |
| 13 | **新手引导** | isInOnboarding | 1.00 | explore | 操作教学 + 堆叠技巧 |
| 14 | **注意休息** | late + momentum 下降 | 0.35 | pace | 适当休息恢复专注力 |
| 15 | **状态良好** | 无其他触发 | 0.30 | pace | 保持专注，继续当前打法 |

### 4.3 策略选择逻辑

```
1. 扫描所有场景，收集匹配的 tips[]
2. 新手引导最高优先级，覆盖其他所有建议
3. 防止同类别重复（如两条 survival）
4. 按 priority 降序排列
5. 截取前 3 条返回
```

### 4.4 策略类别视觉设计

| 类别 | 色调 | 场景 |
|------|------|------|
| survival | 🟠 橙色 | 棋盘危机、恢复模式 |
| clear | 🔵 蓝色 | 消行机会、连击 |
| build | 🟢 青色 | 堆叠规划、空洞管理 |
| pace | 🟣 紫色 | 节奏调整、情绪管理 |
| explore | 🟢 绿色 | 新手引导、探索 |

---

## 5. 数据流时序

以一次完整的「放置方块」为例：

```
玩家拖拽落子
     │
     ▼
game.js: grid.place(shape, x, y)
     │
     ▼
game.js: grid.checkLines() → result
     │
     ▼
playerProfile.recordPlace(cleared, lines, fill)
  ├── 更新滑动窗口
  ├── 更新 comboStreak / consecutiveNonClears
  ├── 闭环反馈窗口计数
  ├── 恢复模式判定
  └── 技能指数平滑更新
     │
     ▼
game.js: _refreshPlayerInsightPanel()
     │
     ▼
playerInsightPanel._render(game)
  ├── 读取 playerProfile 实时指标
  ├── 读取 _lastAdaptiveInsight（上次出块的 stress / hints）
  ├── 调用 generateStrategyTips(profile, insight, gridInfo)
  │     ├── 扫描 10+ 场景
  │     ├── 按 priority 排序
  │     └── 返回 top 3 tips
  ├── 渲染「实时策略」卡片
  ├── 渲染「策略解释」列表（系统内部参数说明）
  └── 更新能力指标 / 状态信号标签
     │
     ▼
下一轮出块时：
game.js: spawnBlocks()
     │
     ▼
adaptiveSpawn.resolveAdaptiveStrategy(strategy, profile, score, runStreak, fill)
  ├── 合成 10 维信号 → stress
  ├── 插值 shapeWeights
  ├── 计算 spawnHints
  └── 返回策略对象
     │
     ▼
game.js: _captureAdaptiveInsight(layered)  → 保存供面板下次读取
     │
     ▼
blockSpawn: generateDockShapes(grid, strategy)  → 3 个候选块
```

---

## 6. 配置参数速查

所有可调参数集中在 `shared/game_rules.json → adaptiveSpawn`：

### 6.1 画像参数

| 参数路径 | 默认值 | 说明 |
|---------|-------|------|
| `profileWindow` | 15 | 滑动窗口大小 |
| `smoothingFactor` | 0.15 | 技能平滑系数 α |
| `fastConvergenceWindow` | 5 | 前 N 步用更大 α |
| `fastConvergenceAlpha` | 0.35 | 快速收敛 α |

### 6.2 AFK 与闭环反馈

| 参数路径 | 默认值 | 说明 |
|---------|-------|------|
| `afk.thresholdMs` | 15000 | AFK 判定阈值（ms） |
| `feedback.horizon` | 4 | 观察窗口步数 |
| `feedback.expected` | 1 | 预期消行数 |
| `feedback.alpha` | 0.02 | bias 更新步长 |
| `feedback.decay` | 0.8 | 每轮衰减因子 |
| `feedback.biasClamp` | 0.15 | bias 绝对值上限 |

### 6.3 心流参数

| 参数路径 | 默认值 | 说明 |
|---------|-------|------|
| `flowZone.thinkTimeLowMs` | 1200 | 低于此值 → bored 候选 |
| `flowZone.thinkTimeHighMs` | 10000 | 高于此值 → anxious 候选 |
| `flowZone.missRateWorry` | 0.28 | 失误率超此值 → anxious |
| `flowZone.skillAdjustScale` | 0.3 | 技能调节范围 |
| `flowZone.flowBoredAdjust` | 0.08 | bored 基础加压 |
| `flowZone.flowAnxiousAdjust` | -0.12 | anxious 基础减压 |
| `flowZone.recoveryAdjust` | -0.2 | 恢复模式减压 |
| `flowZone.comboRewardAdjust` | 0.05 | combo 加压 |

### 6.4 参与度与节奏

| 参数路径 | 默认值 | 说明 |
|---------|-------|------|
| `engagement.frustrationThreshold` | 4 | 挫败救济触发步数 |
| `engagement.frustrationRelief` | -0.18 | 挫败减压量 |
| `engagement.nearMissStressBonus` | -0.1 | 差一点减压量 |
| `engagement.nearMissClearGuarantee` | 2 | 差一点后最低消行保证 |
| `engagement.noveltyDiversityBoost` | 0.15 | bored 时新鲜感注入 |
| `pacing.cycleLength` | 5 | 节奏周期长度 |
| `pacing.tensionPhases` | 3 | 紧张期步数 |
| `pacing.tensionBonus` | 0.04 | 紧张期加压 |
| `pacing.releaseBonus` | -0.12 | 松弛期减压 |

---

## 7. 扩展指南

### 7.1 添加新策略场景

在 `strategyAdvisor.js` 的 `generateStrategyTips()` 中添加新的条件分支：

```javascript
if (条件表达式 && tips.length < 3) {
    tips.push({
        icon: '🎮',
        title: '短标题',           // ≤ 6 字
        detail: '一句话策略说明',    // 面向玩家的自然语言
        priority: 0.6,             // 0~1 越高越紧急
        category: 'build'          // survival | clear | build | pace | explore
    });
}
```

### 7.2 添加新的玩家状态信号

1. 在 `PlayerProfile` 中添加 getter（与现有信号同模式）
2. 在 `_captureAdaptiveInsight()` 的 `profileAtSpawn` 中捕获快照
3. 在 `strategyAdvisor.js` 中基于新信号生成策略建议
4. 在 `playerInsightPanel.js` 的 `_render()` → `elState` 中添加标签展示
5. 如果需要影响出块，在 `adaptiveSpawn.js` 的 stress 合成中加入新信号维度

### 7.3 调参建议

- **修改心流阈值**：编辑 `game_rules.json → adaptiveSpawn.flowZone`，无需改代码
- **修改出块权重**：编辑 `game_rules.json → adaptiveSpawn.profiles`
- **修改策略文案**：直接编辑 `strategyAdvisor.js` 中的 `title` / `detail`
- **新增权重档位**：在 `profiles` 数组中插入新对象，插值自动适配

---

## 8. 面板 UI 布局

```
┌──────────────────────────────────┐
│  玩家画像          [求助][新局][重开]│
│──────────────────────────────────│
│  技能 52%  消行 35%  失误 8%      │  ← 能力指标
│  思考 2.1s 负荷 28%  APM 8.2     │
│  ████████████░░░░░░ 52%          │  ← 技能条
│──────────────────────────────────│
│  ● flow  F 0.18  tension  peak  │  ← 实时状态信号
│  动量 0.12  未消 1  轮次 6       │
│──────────────────────────────────│
│  stress 0.32 F(t) 0.18 闭环 +0.01│  ← 投放参数
│  fill 42%  清2  尺-0.3  多0.0    │
│  长条 2.2  矩形 1.7  方形 1.4    │  ← 形状权重 top5
│──────────────────────────────────│
│  实时策略                         │  ← 策略建议（NEW）
│  🔥 保持连击                      │
│     已连续 2 次多行消除！...       │
│  ⚠️ 控制高度                      │
│     棋盘偏满，优先降低最高列...     │
│──────────────────────────────────│
│  策略解释                         │  ← 系统内部参数说明
│  · 综合压力 stress=0.32 ...       │
│  · 心流偏移 F(t)=0.18（沉浸区）   │
│  · 节奏相位：紧张期               │
│──────────────────────────────────│
│  [落子建议 — 点击求助后展示]       │  ← 启发式 hint 卡片
└──────────────────────────────────┘
```
