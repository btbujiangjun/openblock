# OpenBlock 系统架构

> 版本：2026-04-20 | 详细模块文档见 [docs/README.md](docs/README.md)

---

## 目录

1. [设计原则](#1-设计原则)
2. [整体分层](#2-整体分层)
3. [前端模块边界](#3-前端模块边界)
4. [商业化层架构](#4-商业化层架构)
5. [出块引擎架构](#5-出块引擎架构)
6. [强化学习架构](#6-强化学习架构)
7. [后端架构](#7-后端架构)
8. [数据流](#8-数据流)
9. [扩展点索引](#9-扩展点索引)
10. [技术决策记录](#10-技术决策记录)

---

## 1. 设计原则

| 原则 | 实现方式 |
|------|---------|
| **最小侵入** | 商业化/RL 通过事件总线观察游戏，不修改 `game.js`/`grid.js` |
| **策略解耦** | 出块策略、难度策略、广告策略均可通过配置文件或 SDK 替换 |
| **热插拔** | `adAdapter`/`iapAdapter` 支持 `setProvider()` 运行时替换 SDK |
| **配置外化** | 所有数值参数在 `shared/game_rules.json` 或 `.env` 中定义 |
| **可测试性** | 所有模块支持 mock，localStorage 通过 stub 注入 |
| **渐进增强** | 无后端时游戏完整运行；RL/商业化/持久化均为可选层 |

---

## 2. 整体分层

```
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 5: Presentation                                               │
│  renderer.js  playerInsightPanel.js  rlPanel.js  monPanel.js        │
│  spawnModelPanel.js  hintEngine.js  replayUI.js                     │
├──────────────────────────────────────────────────────────────────────┤
│  Layer 4: Application Orchestration                                  │
│  game.js (主控制器)  main.js (入口)  monetization/index.js          │
│  bot/trainer.js  bot/rlPanel.js                                     │
├──────────────────────────────────────────────────────────────────────┤
│  Layer 3: Domain Services                                            │
│  ┌────────────┐ ┌────────────────┐ ┌──────────────────────────────┐ │
│  │  Player    │ │  Spawn Engine  │ │  Monetization Framework      │ │
│  │  System    │ │                │ │                              │ │
│  │playerPro-  │ │adaptiveSpawn   │ │MonetizationBus (Event Hub)   │ │
│  │file.js     │ │blockSpawn.js   │ │featureFlags.js               │ │
│  │progression │ │spawnModel.js   │ │adAdapter / iapAdapter        │ │
│  │.js         │ │difficulty.js   │ │personalization.js            │ │
│  └────────────┘ └────────────────┘ └──────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│  Layer 2: Core Game Logic                                            │
│  grid.js (棋盘状态机)  shapes.js (方块定义)  config.js (常量)       │
│  gameRules.js (规则加载)  api.js (REST 客户端)  database.js        │
├──────────────────────────────────────────────────────────────────────┤
│  Layer 1: Shared Data & Configuration                                │
│  shared/game_rules.json  shared/shapes.json  .env                  │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ REST API (Flask)
┌──────────────────────────────────────────────────────────────────────┐
│  Backend Layer                                                       │
│  server.py (核心路由)  monetization_backend.py  rl_backend.py      │
│  SQLite: sessions / behaviors / scores / move_sequences /           │
│          mon_user_segments / mon_model_config / mon_strategy_log    │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ Python import
┌──────────────────────────────────────────────────────────────────────┐
│  RL Training Layer                                                   │
│  rl_pytorch/: train.py model.py features.py simulator.py           │
│  rl_mlx/:    (Apple Silicon MLX 版本，API 一致)                     │
│  shared/game_rules.json  shared/shapes.json  (同一数据源)           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. 前端模块边界

### 模块职责与依赖关系

```
main.js
  └── game.js ──────────────────────────────────────┐
        ├── grid.js (状态)                           │
        ├── renderer.js (渲染)                       │
        ├── playerProfile.js ←────────────────────┐  │
        ├── adaptiveSpawn.js ←── playerProfile    │  │
        │     └── blockSpawn.js (blockSpawn.js)   │  │
        ├── spawnModel.js (可选 ML 推理)           │  │
        ├── strategyAdvisor.js                    │  │
        ├── hintEngine.js                         │  │
        ├── playerInsightPanel.js ←── playerProfile│
        ├── progression.js (XP/等级/连签)         │
        ├── database.js (SQLite REST)             │
        └── services/backendSync.js               │
                                                  │
monetization/index.js ──── MonetizationBus.attach(game)
  ├── adAdapter.js ← featureFlags                 ↑
  ├── adDecisionEngine.js ← 商业模型向量决策      ↑
  ├── adTrigger.js ← MonetizationBus('no_clear')  │
  ├── iapAdapter.js                               │
  ├── dailyTasks.js ← MonetizationBus('game_over')│
  ├── checkInPanel.js ← 签到系统                  │
  ├── wallet.js ← 道具/货币管理                  │
  ├── leaderboard.js                             │
  ├── seasonPass.js ← MonetizationBus('game_over')│
  ├── personalization.js ← PlayerProfile (实时)──┘
  ├── commercialInsight.js (注入 insight panel)
  ├── commercialModel.js (商业化向量计算)        │
  └── monPanel.js (训练面板浮层)
```

### 模块分类

| 类型 | 模块 | 特征 |
|------|------|------|
| **核心不可替换** | `grid.js` `shapes.js` `gameRules.js` | 游戏规则定义 |
| **可配置策略** | `adaptiveSpawn.js` `difficulty.js` | 参数在 `game_rules.json` |
| **可插拔适配器** | `adAdapter.js` `iapAdapter.js` | `setProvider()` 热替换 |
| **事件驱动模块** | 所有 `monetization/*.js` | 通过 MonetizationBus 解耦 |
| **功能开关控制** | 所有商业化子模块 | `featureFlags.getFlag()` 门控 |

---

## 4. 商业化层架构

### 核心设计：零侵入事件总线

```
  game.js
    │
    │  game.logBehavior(eventType, data)
    │  ↓ (MonetizationBus.attach 包装此方法)
    │
  MonetizationBus ──── emit(eventType, data)
    │
    ├── 'game_over'    → adTrigger (插屏广告)
    │                  → seasonPass (XP 累计)
    │                  → dailyTasks (任务检查)
    │                  → replayShare (分享按钮)
    │
    ├── 'no_clear'     → adTrigger (近失/挫败激励广告)
    │
    ├── 'spawn_blocks' → personalization (实时信号更新)
    │
    └── 任意事件       → 自定义模块（通过 on() 订阅）
```

### 功能开关层次

```
FLAG_DEFAULTS (featureFlags.js)
  ↓ 被 localStorage 'openblock_mon_flags_v1' 覆盖
  ↓ 可通过 setFlag() API 或 monPanel 界面修改

广告开关：adsRewarded=false, adsInterstitial=false
支付开关：iap=false
留存开关：dailyTasks=true, leaderboard=true, seasonPass=true
其他开关：pushNotifications=false, replayShare=true, stubMode=true
```

### 适配器接口（Provider Interface）

```typescript
// 广告 Provider（需实现此接口接入真实 SDK）
interface AdProvider {
    showRewarded(reward: object): Promise<{ success: boolean }>;
    showInterstitial(): Promise<void>;
    loadAd(type: string): Promise<{ success: boolean, ad?: object }>;
}

// 广告决策引擎
interface AdDecisionEngine {
    init(): void;
    requestAd(scene: string, context: object): Promise<{ allowed: boolean, adType: string }>;
    getAdStatus(): { canShowRewarded: boolean, rewardedRemaining: number };
}

// IAP Provider
interface IapProvider {
    purchase(productId: string): Promise<{ success: boolean }>;
    restore(): Promise<string[]>;  // 返回已购 productId 列表
    isPurchased(productId: string): boolean;
}
```

### 广告决策流程

```
玩家行为 → AdDecisionEngine.requestAd(scene)
    │
    ├── 商业模型向量 (buildCommercialVector)
    │   ├── 付费倾向 (payerScore)
    │   ├── 流失风险 (churnRisk)
    │   ├── 广告疲劳 (adFatigueRisk)
    │   └── LTV 预估
    │
    ├── Guardrail 检查
    │   ├── 保护付费用户 (suppressInterstitial)
    │   ├── 疲劳保护 (suppressAll)
    │   └── 流失保护
    │
    ├── 场景特定决策
    │   ├── GAME_OVER: 根据付费倾向选择
    │   ├── NO_MOVES: 优先激励广告
    │   └── STAMINA_EMPTY: 激励广告
    │
    └── 频率控制
        ├── 每日上限 (rewarded: 12, interstitial: 6)
        └── 最小间隔 (60s)
```

### 道具钱包系统

```
wallet.js (技能/货币统一管理)
    │
    ├── 消耗品类: hintToken, undoToken, bombToken, rainbowToken
    ├── 货币类: coin, fragment
    └── 权限类: trialPass (24h 皮肤试用)
    
    存储策略：
    ├── SQLite 优先 (API 可用时)
    └── localStorage 回退
```

---

## 5. 出块引擎架构

### 双轨出块架构

```
  game.js: spawnBlocks()
    │
    ├── 统一出块上下文
    │   spawnModel.js: buildSpawnModelContext()
    │   └── 难度 / AbilityVector / 实时状态 / 拓扑 / 体验节奏 / 局间弧线 / history / spawnHints
    │
    ├── 轨道一：启发式
    │   ├── adaptiveSpawn.js → stress + spawnHints
    │   └── blockSpawn.js → generateDockShapes()
    │
    ├── 轨道二：生成式
    │   ├── spawnModel.js → /api/spawn-model/v3/predict
    │   └── SpawnTransformerV3 (feasibility + playstyle + LoRA)
    │
    └── 统一护栏与提交
        ├── validateSpawnTriplet()：唯一性 / 可放性 / 机动性 / 序贯可解性
        ├── V3 失败或护栏未通过 → 规则轨兜底
        └── _commitSpawn() 记录 source / V3 meta / fallbackReason
```

### Stress 与 SpawnHints 信号

```
stress = Σ(signal_i * weight_i), clamp(-0.2, 1.0)

  signal_1: scoreStress       分数驱动基础压力（分段线性）
  signal_2: runStreakStress    连战加成（难度叠加）
  signal_3: skillAdjust       高手加压 / 新手减压（置信度门控）
  signal_4: flowAdjust        无聊+δ / 焦虑-δ / 心流0
  signal_5: pacingAdjust      节奏张弛（tension+δ / release-δ）
  signal_6: recoveryAdjust    板面快满时短期降压
  signal_7: frustrationRelief 连续未消行 → 降压救济
  signal_8: comboReward       连续 combo → 轻微加压（正反馈）
  signal_9: trendAdjust       长周期趋势（历史会话）
  signal_10: confidenceGate   置信度低时收窄调节幅度
  signal_11: abilityRisk      高风险 AbilityVector 触发保活减压
  signal_12: topologyChance   近满线 / 清屏准备转为多消与清屏兑现

  → 查表插值 10 档 shapeWeights profile
  → 传递 spawnHints 到 blockSpawn.js
  → 同步写入 SpawnTransformerV3 共享上下文
```

---

## 6. 强化学习架构

### 双轨训练

```
  浏览器端（实时）                    Python 端（离线/大算力）
  ─────────────────                   ───────────────────────
  bot/linearAgent.js                  rl_pytorch/train.py
  bot/trainer.js                      rl_pytorch/model.py
  bot/simulator.js    →  REST API ←   rl_backend.py
                      /api/rl/*
  线性 REINFORCE                      残差双塔网络
  + 价值基线                          DockBoardAttention
                                      直接监督头（位置/形状/combo）
                                      课程学习（40 → 220 分）
```

### 共享数据源

```
shared/game_rules.json ──┬── gameRules.js (前端)
                          ├── rl_pytorch/game_rules.py
                          └── rl_mlx/game_rules.py

shared/shapes.json ──────┬── shapes.js (前端)
                          ├── rl_pytorch/shapes_data.py
                          └── rl_mlx/shapes_data.py
```

### 状态特征维度

```
ψ(s) = [
    15 维全局统计（分数、消行数、连击、填充率等）
    + 棋盘占用（8×8 = 64 维，或 maxGridWidth²）
    + 待选块形状掩码（3块 × dockMaskSide²）
]
总维度：见 shared/game_rules.json 的 featureEncoding.stateDim
```

---

## 7. 后端架构

### Flask 路由分组

```
server.py (核心)
  /api/session    会话生命周期 (POST/GET/PATCH/PUT)
  /api/behavior   行为事件 (POST/batch)
  /api/score      得分记录
  /api/stats      用户统计聚合
  /api/leaderboard 排行榜
  /api/achievement 成就
  /api/analytics/ 行为分析
  /api/replays    回放存取
  /api/move-sequence 移动序列（新回放格式）
  /api/client/    客户端同步（策略/统计）
  /api/export     数据导出
  /api/health     健康检查
  /api/spawn-model/v3/*  出块生成式：status / predict / train / reload / personalize
  /docs           文档门户（HTML + API）

enterprise_extensions.py（挂载于同一 Flask app）
  /api/enterprise/remote-config   远程配置
  /api/payment/verify             IAP 占位入库（幂等）
  /api/enterprise/ad-impression   广告曝光占位
  /api/enterprise/experiments     实验配置表读写
  /api/enterprise/live-ops        Live Ops 时间窗
  /api/compliance/*               同意 / 导出 / 删除用户
  详见 docs/integrations/ENTERPRISE_EXTENSIONS.md

monetization_backend.py (Blueprint: /api/mon/*)
  /user-profile/<userId>  用户商业画像
  /aggregate              全局聚合指标
  /model/config           模型配置 GET/PUT
  /strategy/log           策略曝光/转化日志

rl_backend.py (可选: /api/rl/*)
  /status  /select_action  /train_episode  /save  /load
  /training_log  /eval_values
```

### SQLite 表结构

```
核心表（server.py init_db）:
  sessions          会话记录（user_id, strategy, score, duration, attribution JSON）
  behaviors         行为事件（session_id, event_type, event_data）
  scores            分数记录（历史）
  user_stats        用户聚合统计（PK: user_id）
  achievements      成就记录（PK: user_id + achievement_id）
  replays           旧格式回放
  move_sequences    新格式移动序列（PK: session_id）
  client_strategies 客户端策略同步

商业化表（monetization_backend.py）:
  mon_user_segments   用户分群缓存（whale/dolphin/minnow）
  mon_model_config    个性化模型配置（JSON）
  mon_strategy_log    策略曝光/转化日志
```

---

## 8. 数据流

### 游戏事件数据流

```
玩家操作（拖拽放置）
  ↓
game.onMove / onEnd
  ↓
grid.place() → 消行检测 → 分数更新
  ↓
game.logBehavior('place_block' | 'no_clear' | 'game_over', data)
  ↓
┌────────────────────────────────────────────┐
│  MonetizationBus (emit)                    │
│    ↓ 并发触发多个订阅者                     │
├── adTrigger → 广告弹窗                     │
├── dailyTasks → 任务进度                    │
├── seasonPass → XP 累计                     │
└── 自定义模块 → 业务逻辑                    │
└────────────────────────────────────────────┘
  ↓
database.js → /api/behavior (batch) → SQLite
  ↓
playerProfile.recordPlace() → 实时信号更新
  ↓
adaptiveSpawn.resolveStrategy() → 下一轮出块
```

### 商业化个性化数据流

```
PlayerProfile（实时）         Backend（历史）
    │                             │
    ↓                             ↓
realtimeSignals ──────────── fetchPersonaFromServer()
(frustration, skill,         (/api/mon/user-profile)
 flowState, hadNearMiss)          │
    │                             ↓
    └──────► personalization.getCommercialInsight()
                    │
                    ├── commercialInsight.js (注入玩家画像面板)
                    └── monPanel.js (训练面板)
```

---

## 9. 扩展点索引

| 扩展类型 | 文件 | 方法/接口 | 文档 |
|---------|------|----------|------|
| 广告 SDK | `monetization/adAdapter.js` | `setAdProvider(provider)` | [STRATEGY_GUIDE §广告策略](./docs/engineering/STRATEGY_GUIDE.md#4-广告策略定制-ad-sdk) |
| IAP SDK | `monetization/iapAdapter.js` | `setIapProvider(provider)` | [STRATEGY_GUIDE §IAP策略](./docs/engineering/STRATEGY_GUIDE.md#5-iap-策略定制-iap-sdk) |
| 新商业化模块 | `monetization/index.js` | `MonetizationBus.on()` | [DEV_GUIDE §新增模块](./docs/engineering/DEV_GUIDE.md#2-新增商业化模块) |
| 出块权重 | `shared/game_rules.json` | `adaptiveSpawn.profiles` | [STRATEGY_GUIDE §出块策略](./docs/engineering/STRATEGY_GUIDE.md#1-出块策略定制) |
| Stress 信号 | `web/src/adaptiveSpawn.js` | 信号计算函数 | [STRATEGY_GUIDE §Stress信号](./docs/engineering/STRATEGY_GUIDE.md#2-stress-信号定制) |
| RL 奖励 | `shared/game_rules.json` | `RL_REWARD_SHAPING` | [DEV_GUIDE §RL奖励](./docs/engineering/DEV_GUIDE.md#7-自定义-rl-奖励函数) |
| 课程学习 | `shared/game_rules.json` | `rlCurriculum` | [DEV_GUIDE §课程学习](./docs/engineering/DEV_GUIDE.md#8-自定义课程学习) |
| 难度模式 | `shared/game_rules.json` | `difficultyBias` | [STRATEGY_GUIDE §难度模式](./docs/engineering/STRATEGY_GUIDE.md#3-难度模式定制) |
| 功能开关 | `monetization/featureFlags.js` | `FLAG_DEFAULTS` | [DEV_GUIDE §Feature Flag](./docs/engineering/DEV_GUIDE.md#5-新增-feature-flag) |
| 后端蓝图 | `server.py` | `app.register_blueprint()` | [DEV_GUIDE §后端蓝图](./docs/engineering/DEV_GUIDE.md#6-后端蓝图扩展) |

---

## 10. 技术决策记录

### ADR-001: 事件总线而非直接调用（MonetizationBus）

**背景**：商业化模块需要感知游戏事件，但不应修改游戏核心代码。

**决策**：包装 `game.logBehavior` 方法（非修改 class），将游戏行为日志事件广播到商业化总线。

**优势**：零侵入，可随时 attach/detach，游戏核心无需知道商业化层存在。

**权衡**：商业化模块依赖游戏事件名称（字符串耦合），事件名变更需同步更新。

---

### ADR-002: localStorage 功能开关（featureFlags）

**背景**：需要在开发阶段灵活开关各商业化功能，且对不同用户有不同默认值。

**决策**：使用 `localStorage` 持久化 feature flags，代码默认值为保守（广告/IAP 默认关闭）。

**优势**：开发者可实时切换，无需重建；生产环境可通过 monPanel UI 或代码调用修改。

**权衡**：不支持服务端远程配置，需自行实现 A/B 测试层（预留 Provider 接口）。

---

### ADR-003: shared/game_rules.json 单一数据源

**背景**：游戏规则同时被前端（web/src）、Python RL 训练（rl_pytorch/rl_mlx）使用，需保持一致。

**决策**：所有游戏规则、出块参数、RL 超参数统一写在 `shared/game_rules.json`，各端各自加载。

**优势**：修改一处，两端同步；减少版本漂移风险。

**权衡**：JSON 不支持注释，需在文档中说明每个字段含义。

---

### ADR-004: Stub 模式（广告/IAP 开发测试）

**背景**：开发阶段无法接入真实广告/支付 SDK，需要可测试的替代实现。

**决策**：默认启用 `stubMode`，在浏览器内渲染模拟 UI（广告倒计时、IAP 弹窗），行为与真实 SDK 一致。

**优势**：开发者无需真实账号即可测试完整商业化流程；测试套件可直接调用 stub 函数。

**权衡**：stub 与真实 SDK 行为可能有差异，需要在真机上补充测试。
