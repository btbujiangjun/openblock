# OpenBlock 架构图生成 Prompt

> **定位**：可复用的"喂给大模型即生成完整 OpenBlock 架构图集合"的 prompt
> 模板。其输出物登记在
> [`SYSTEM_ARCHITECTURE_DIAGRAMS.md`](./SYSTEM_ARCHITECTURE_DIAGRAMS.md)。
> **使用方式**：复制 §"Prompt 全文"整段粘贴给具备长上下文 + Mermaid 输出
> 能力的大模型（GPT-5 / Claude Opus 4 / Gemini 2.5 Pro 等），即可获得 6 张
> Mermaid 图与解读。
> **维护要求**：当 `web/src/`、`shared/`、`services/`、`monetization/` 等
> 顶层结构发生增减时，同步更新 §"Prompt 全文"中的事实包。

## 适用场景

- 重新生成 [`SYSTEM_ARCHITECTURE_DIAGRAMS.md`](./SYSTEM_ARCHITECTURE_DIAGRAMS.md)
  以反映架构变化
- 给 AI 协作者一份"自包含的项目地图"以便其在不读源码时也能理解结构
- 作为新贡献者的"项目结构介绍材料"
- 派生定制：只生成单个子系统图（如只画 RL 或只画 Monetization）

## 设计原则

1. **事实包密度优先**：LLM 在没有源码访问时，输出准确性 100% 取决于 prompt
   的事实密度，故 §2 必须穷尽全部模块名 / 事件 / 路由。
2. **Mermaid 优先**：覆盖率最高、可直接嵌入 GitHub README / docs 渲染、
   `mermaid.live` 即时预览。
3. **多张图代替单张图**：单张图覆盖整个项目必然拥挤；C4 风格分级
   （容器 → 组件 → 序列 → 特性专题 → 后端 → 部署）让每张图节点数都落在
   人类可读区间（12–25 个节点）。
4. **三处复述红线**：在角色定义、约束清单、自检清单三处重复声明"单向依赖、
   不发明模块、不写中间态"，提高一次成功率。

---

## Prompt 全文

````markdown
# 角色

你是一位资深开源项目系统架构师，擅长把复杂工程拆解为分层架构图、组件图、
数据流图与部署图。你的产出物用于公开技术文档，必须严格基于"事实包"中给出的
模块和契约，**不得发明不存在的模块、不得编造接口、不得猜测内部实现细节**。

# 任务

为开源项目 **OpenBlock**（休闲方块益智 + 自适应出块 + 强化学习 +
可插拔商业化平台）生成一套**总体系统架构图**，用 Mermaid 语法输出，并配以
简短解读。要求覆盖 §4 列出的全部 6 张图，每张图独立、可编译、可读。

# §1 项目一句话定位

> OpenBlock 是一个开源的"网页方块益智游戏 + 自适应出块引擎 + 强化学习训练
> 平台 + 可插拔商业化框架"四合一研究/工程平台，支持 Web / Android / iOS /
> 微信小程序四端，前后端解耦，所有商业化与 RL 子系统对游戏核心零侵入。

# §2 事实包（必须严格采用，禁止增删模块名）

## 2.1 仓库顶层目录

```
shared/         单一数据源：game_rules.json + shapes.json，前端/RL/微服务共用
web/            Vite + ESM 前端（Canvas 渲染）
miniprogram/    微信小程序（轻量包，由 scripts/sync-core.sh 同步 web/src 核心）
mobile/         Android + iOS Capacitor WebView 壳，复用 web 构建产物 dist/
rl_pytorch/     PyTorch RL 训练（残差 MLP + DockBoardAttention，PPO/REINFORCE）
rl_mlx/         Apple Silicon MLX 等价实现，API 一致
services/       微服务：user / game / analytics / monitoring + common + security
k8s/            base manifests + helm chart
docs/           分层文档中心
tests/          88 测试文件 / 1306 用例
```

后端入口三件套：`server.py`（核心 Flask）、`monetization_backend.py`
（Blueprint `/api/mon/*`）、`rl_backend.py`（可选 `/api/rl/*`）。

## 2.2 前端五层架构（Layer 1 → Layer 5，自底向上）

| 层 | 名称 | 关键模块 |
|---|---|---|
| L1 | Shared Data & Config | `shared/game_rules.json`, `shared/shapes.json`, `.env` |
| L2 | Core Game Logic | `grid.js`(棋盘状态机), `shapes.js`, `gameRules.js`, `config.js`, `api.js`, `database.js` |
| L3 | Domain Services | Player System / Spawn Engine / Monetization Framework / Lifecycle / Retention（见 2.3） |
| L4 | Application Orchestration | `main.js`, `game.js`(主控), `monetization/index.js`, `bot/trainer.js` |
| L5 | Presentation | `renderer.js`, `playerInsightPanel.js`, `rlPanel.js`, `monPanel.js`, `spawnModelPanel.js`, `hintEngine.js`, `replayUI.js` |

## 2.3 L3 Domain Services 内部三大子系统

**Player System**（`web/src/`）
- `playerProfile.js`：实时画像（skill / flowState / frustration / pacingPhase / momentum / segment5 / sessionPhase）
- `playerAbilityModel.js`：5 维 abilityVector
- `playerInsightPanel.js`：左侧画像 UI
- `progression.js`：XP / 等级 / 连签
- `personalization.js`：实时信号 → 商业策略

**Spawn Engine**（`web/src/`）
- `adaptiveSpawn.js`：12 信号融合 → stress → 10 档 profile + spawnHints
- `bot/blockSpawn.js`：执行层，生成三连块（含 solvability / 机动性 / 序贯可解 / orderRigor 校验）
- `spawnModel.js`：可选 ML 推理（SpawnTransformerV3 + LoRA + feasibility + playstyle）
- `difficulty.js`：score → stress 基础映射

**Monetization Framework**（`web/src/monetization/`）
- 总线核心：`MonetizationBus.js` + `index.js`(initMonetization) + `featureFlags.js`
- 适配器：`adAdapter.js`, `iapAdapter.js`, `paymentManager.js`
- 触发器：`adTrigger.js`, `ad/adDecisionEngine.js`, `ad/adInsertionRL.js`
- 留存触点：`dailyTasks.js`, `seasonPass.js`, `leaderboard.js`, `offerToast.js`,
  `lifecycleAwareOffers.js`, `lifecycleOutreach.js`, `inviteRewardSystem.js`
- 商业模型：`commercialModel.js`, `commercialInsight.js`, `commercialPolicy.js`,
  `commercialFeatureSnapshot.js`, `ltvPredictor.js`, `personalization.js`
- 算法层（opt-in scaffolding）：
  - `calibration/propensityCalibrator.js`（isotonic + Platt）
  - `explorer/epsilonGreedyExplorer.js`（ε-greedy + IPS）
  - `ml/multiTaskEncoder.js`, `ml/zilnLtvModel.js`, `ml/priceElasticityModel.js`,
    `ml/contextualBandit.js`(LinUCB), `ml/survivalPushTiming.js`(Cox PH)
  - `quality/modelQualityMonitor.js`(PR-AUC/Brier), `quality/actionOutcomeMatrix.js`,
    `quality/distributionDriftMonitor.js`(KL)
- 实验：`abTestManager.js`, `experimentPlatform.js`, `lifecycleExperiments.js`,
  `cohortManager.js`, `analyticsTracker.js`, `analyticsPlatform.js`, `analyticsDashboard.js`
- UI：`monPanel.js`, `offerToast.js`

**Lifecycle / Retention**（`web/src/lifecycle/` + `web/src/retention/`）
- 编排层：`lifecycle/lifecycleOrchestrator.js`, `lifecycle/lifecycleSignals.js`
- 信号源：`retention/playerLifecycleDashboard.js`, `retention/playerMaturity.js`,
  `retention/churnPredictor.js`, `retention/firstPurchaseFunnel.js`,
  `retention/winbackProtection.js`, `retention/vipSystem.js`,
  `retention/difficultyAdapter.js`, `retention/socialIntroTrigger.js`,
  `retention/maturityMilestones.js`, `retention/lifecyclePlaybook.js`,
  `retention/goalSystem.js`, `retention/levelProgression.js`,
  `retention/retentionManager.js`, `retention/difficultyPredictor.js`

## 2.4 MonetizationBus 事件契约

`MonetizationBus.attach(game)` 包装 `game.logBehavior(eventType, data)`，把任意
游戏事件转发到总线。

**显式事件**：
- `lifecycle:session_start` / `lifecycle:session_end` / `lifecycle:intervention`
- `lifecycle:offer_available` / `lifecycle:churn_high` / `lifecycle:early_winback`
- `lifecycle:first_purchase`
- `purchase_completed`（首选）+ `iap_purchase`（兼容）
- `ad_show` / `ad_complete`
- `daily_task_complete` / `season_tier_unlocked`

**透传游戏事件**：`game_over` / `spawn_blocks` / `no_clear` / `score_update`

**主要订阅方**：`lifecycleAwareOffers` / `offerToast` / `lifecycleOutreach` /
`analyticsTracker` / `commercialInsight` / `actionOutcomeMatrix` / `adTrigger`

## 2.5 出块双轨架构（Spawn Engine 的核心特性）

```
game.spawnBlocks()
  └── spawnModel.buildSpawnModelContext()
       ├── 轨道 1：启发式 = adaptiveSpawn → blockSpawn.generateDockShapes
       ├── 轨道 2：生成式 = spawnModel → /api/spawn-model/v3/predict (SpawnTransformerV3)
       └── 统一护栏 validateSpawnTriplet → V3 失败时 fallback 到规则轨
```

## 2.6 RL 双轨架构

| 轨道 | 位置 | 算法 |
|---|---|---|
| 浏览器端（实时） | `web/src/bot/linearAgent.js + trainer.js + simulator.js` | 线性 REINFORCE + 价值基线 |
| Python 端（离线） | `rl_pytorch/{train,model,features,simulator}.py` 或 `rl_mlx/` | 残差 MLP + DockBoardAttention + GAE + 直接监督头 + 课程学习 |

通过 Flask `rl_backend.py`（`/api/rl/*`）暴露给浏览器；
共享数据源：`shared/game_rules.json` + `shared/shapes.json`。

## 2.7 后端路由分组

`server.py`：`/api/session` `/api/behavior` `/api/score` `/api/stats`
`/api/leaderboard` `/api/achievement` `/api/analytics` `/api/replays`
`/api/move-sequence` `/api/client/*` `/api/export` `/api/health`
`/api/spawn-model/v3/*` `/docs`

`monetization_backend.py`（Blueprint）：`/api/mon/user-profile/<userId>`
`/api/mon/aggregate` `/api/mon/model/config` `/api/mon/strategy/log`

`rl_backend.py`：`/api/rl/status` `/api/rl/select_action`
`/api/rl/train_episode` `/api/rl/save` `/api/rl/load` `/api/rl/training_log`

`enterprise_extensions.py`：`/api/enterprise/remote-config`
`/api/payment/verify` `/api/enterprise/ad-impression`
`/api/enterprise/experiments` `/api/enterprise/live-ops` `/api/compliance/*`

## 2.8 SQLite 表

核心表：`sessions`, `behaviors`, `scores`, `user_stats`, `achievements`,
`replays`, `move_sequences`, `client_strategies`

商业化表：`mon_user_segments`, `mon_model_config`, `mon_strategy_log`

## 2.9 微服务（services/）

`user_service` / `game_service` / `analytics_service` / `monitoring`
+ `common`（config/logging/metrics/tracing/orm）
+ `security`（encryption=Fernet / password=Argon2id / jwt_tokens / payment / rate_limit）
+ `migrations`（Alembic）+ `nginx.conf`（gateway）+ docker-compose

可观测：Prometheus `/metrics` + OpenTelemetry 自动埋点
部署：`k8s/base/` 8 个 manifest + `k8s/helm/openblock/`

## 2.10 四端同步契约

| 端 | 运行形态 | 核心逻辑来源 |
|---|---|---|
| Web | Vite 静态前端 + Canvas | `web/src` + `shared` |
| Android | Capacitor WebView 壳 (`mobile/android`) | `dist`（由 web 构建） |
| iOS | Capacitor WKWebView 壳 (`mobile/ios`) | `dist`（由 web 构建） |
| 微信小程序 | 轻量包 (`miniprogram/`) | `shared` + `scripts/sync-core.sh` 生成 `miniprogram/core/` |

小程序**不包含**：RL 训练、ML 推理（v3 spawn model）、后端运营看板。

# §3 设计原则（必须在图中体现的不变量）

1. **零侵入事件总线**：商业化和 RL 通过 `MonetizationBus` 包装
   `game.logBehavior` 来观察游戏，**严禁** Monetization / Lifecycle / Retention
   反向调用 `game.js` / `grid.js`。
2. **单向依赖**：L5 → L4 → L3 → L2 → L1；不得有反向箭头。
3. **数据→编排→策略三段式**（生命周期）：
   `lifecycleSignals` (数据) → `lifecycleOrchestrator` (编排) → `lifecycleAwareOffers / offerToast / lifecycleOutreach` (策略)。
4. **共享数据源**：`shared/game_rules.json` + `shared/shapes.json` 同时被
   Web、PyTorch、MLX、小程序四端加载。
5. **Feature Flag 默认值**：观测能力（quality / outcome / drift）默认 ON；
   决策路径（calibration / explorer / MTL / bandit / 广告 / IAP）默认 OFF
   （金丝雀）。
6. **适配器热插拔**：`setAdProvider()` / `setIapProvider()` 运行时替换 SDK。
7. **渐进增强**：无后端时游戏完整可玩；RL / 商业化 / 持久化均为可选层。

# §4 输出规格

按以下顺序，**输出 6 张图**。每张图前用一句话说明它回答了什么问题，图后用
3–6 行解读关键节点 / 边。所有图统一用 Mermaid 语法。

## 图 1：宏观分层（Container 视图，C4-Style）

- 用 `flowchart TB` + `subgraph` 表示 5 个前端层 + 后端 + RL 训练 + 微服务 + 四端
- 每个 subgraph 内只列代表性模块（≤ 6 个），避免拥挤
- 端到端依赖箭头要清晰，禁止反向

## 图 2：前端 L3 Domain Services 组件图

- 三个 subgraph：Player System / Spawn Engine / Monetization Framework
- 加上 Lifecycle + Retention 子系统（独立 subgraph）
- 把 §2.3 列出的关键模块全部呈现（每个子系统至少 5 个核心模块）
- 用箭头表达：`personalization` 需要 `playerProfile`、`adaptiveSpawn` 需要
  `playerProfile + difficulty`、`commercialPolicy` 调用 `commercialModel +
  explorer + actionOutcomeMatrix` 等

## 图 3：MonetizationBus 事件总线（Sequence 或 Flowchart 风格）

- 中心节点 = `MonetizationBus`
- 左侧：发布方（`game.js`(透传) / `iapAdapter` / `adAdapter` /
  `lifecycleOrchestrator` / `lifecycleAwareOffers` / `dailyTasks` / `seasonPass`）
- 右侧：订阅方（`adTrigger` / `commercialInsight` / `offerToast` /
  `lifecycleOutreach` / `analyticsTracker` / `actionOutcomeMatrix` /
  `lifecycleAwareOffers`）
- 每条边标事件名，至少覆盖 §2.4 显式事件 + 透传游戏事件 4 类

## 图 4：出块双轨 + RL 双轨融合图

- 上半：Spawn 双轨（启发式 vs 生成式 + 统一护栏 + fallback）
- 下半：RL 双轨（浏览器线性 vs PyTorch 残差 + REST 桥）
- 中部用 `shared/game_rules.json` + `shared/shapes.json` 作为四端共享数据源节点

## 图 5：后端路由 + 数据持久化图

- 三个 Flask 入口：`server.py` / `monetization_backend.py` / `rl_backend.py`
  + `enterprise_extensions.py`
- 每个入口下列出 §2.7 的代表性路由（不必全列，按分组聚合）
- 路由 → SQLite 表的写读关系（§2.8）
- 微服务（user / game / analytics / monitoring + nginx + Postgres + Redis）
  作为独立 subgraph 与单体后端并列

## 图 6：四端同步与部署拓扑

- 中心 = `shared/` 单一数据源 + `web/src/` 核心
- 四个客户端形态（Web / Android / iOS / 微信小程序）以 subgraph 排开
- 标注同步路径：`npm run build → dist`、`npm run mobile:sync`、
  `scripts/sync-core.sh`
- 标注 `miniprogram` 不包含 RL / v3 spawn model / 运营看板的能力边界
- 部署侧：单体 Flask vs 微服务 + k8s + nginx gateway 两种形态并列

# §5 Mermaid 编码约定

- 全部用 `flowchart TB` 或 `flowchart LR`（图 3 可用 `sequenceDiagram` 替代）
- 节点 ID 用 `camelCase` 短名（如 `playerProfile`），label 用中文 + 路径
  示例：`playerProfile["playerProfile.js<br/>实时画像"]`
- 子系统用 `subgraph "<层名>"` 包裹，end 闭合
- 跨层边用实线 `-->`；可选 / 热插拔关系用虚线 `-.->`；事件总线用粗线
  `==>`
- 同一 subgraph 内禁止出现完整文件路径，避免噪声
- 每张图节点数控制在 12–25 之间，超量需要拆图

# §6 禁止与红线

1. **不要发明** §2 列表之外的模块名、文件名、表名、路由名。
2. **不要画反向依赖**（如 `MonetizationBus → game.js` 直接调用、
   `monetization → grid.js`）。
3. **不要把已归档的模块**（`docs/archive/` 下任何内容、`v9.x` RL 历史模型）
   画进当前架构。
4. **不要混淆 web 和 miniprogram**：小程序不含 RL / v3 spawn model / 运营看板。
5. **不要写中间态**："Phase 1-4 实施中 / v1.49.x 待发布"等 sprint 语言禁止
   出现在图标签里。
6. **不要把 Feature Flag 当作模块**画，应作为门控属性体现在边的标签上
   （如 `-. flag:adInsertionRL .->`）。

# §7 自检清单（输出前对照）

- [ ] 6 张图全部产出，且每张图前有问题陈述、后有解读
- [ ] 所有模块名都能在 §2 找到原文
- [ ] L1 → L5 单向依赖，无反向箭头
- [ ] MonetizationBus 至少出现 §2.4 中 6 个显式事件 + 3 个透传游戏事件
- [ ] 出块双轨与 RL 双轨都标注了 fallback / 共享数据源
- [ ] 四端同步图标注了能力边界差异
- [ ] 部署图同时呈现单体 + 微服务两种形态
- [ ] 全部 Mermaid 图可在 mermaid.live 直接渲染（无语法错误）

# §8 输出格式

```
## 图 1：<问题陈述>
```mermaid
flowchart TB
  ...
```
**解读**：3–6 行说明关键节点与边。

## 图 2：...
（同上）

...

## 图 6：...

## 自检结果
- [x] ...
- [x] ...
```

现在请基于以上事实包，输出全部 6 张架构图与解读。
````

---

## 派生用法

| 场景 | 改动建议 |
|---|---|
| 只要一张总图 | 删除 §4 的图 2–6，把图 1 节点上限放宽到 30 |
| 改用 PlantUML / draw.io | 把 §5 的 Mermaid 约定换成对应语法 |
| 生成可交互 SVG | 在 §4 末尾加："为每张图额外输出一份 D2 语法版本" |
| 给 RL/商业化做专题 | 把 §2 的事实包按子系统切开，分别喂给模型 |
| 自动校验输出 | 在 §7 后追加："输出 JSON 格式的 audit 结果，标注每张图节点数 / 边数 / 是否有反向依赖" |

## 关联文档

- [`SYSTEM_ARCHITECTURE_DIAGRAMS.md`](./SYSTEM_ARCHITECTURE_DIAGRAMS.md) —— 本 prompt 的当前输出物
- [`MONETIZATION_EVENT_BUS_CONTRACT.md`](./MONETIZATION_EVENT_BUS_CONTRACT.md) —— §2.4 事件契约的权威源
- [`LIFECYCLE_DATA_STRATEGY_LAYERING.md`](./LIFECYCLE_DATA_STRATEGY_LAYERING.md) —— §3.3 三段式的权威源
- [`../engineering/PROJECT.md`](../engineering/PROJECT.md) —— §2.2 模块字典的权威源
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) —— 文字版完整架构（含 ADR）
