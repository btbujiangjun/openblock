# OpenBlock 系统架构图

> **定位**：以「业务架构 → 全栈分层 → 6 张 Mermaid 子图」三层视图覆盖
> OpenBlock 从产品形态到技术实现的完整架构，作为
> [`ARCHITECTURE.md`](../../ARCHITECTURE.md) 的可视化伴随文档。
> **范围**：业务四支柱与统一生态、四端形态、前端五层、L3 业务子系统、
> MonetizationBus 事件总线、出块 / RL 双轨、后端路由 / 数据持久化、四端
> 同步与部署拓扑。
> **生成方式**：技术分层视图与 6 张子图依据
> [`ARCHITECTURE_DIAGRAM_PROMPT.md`](./ARCHITECTURE_DIAGRAM_PROMPT.md)
> 的事实包与约束生成；如需重生成，按照该 prompt 喂给大模型即可。
> **维护约定**：图中模块名必须能在
> [`engineering/PROJECT.md`](../engineering/PROJECT.md)、
> [`MONETIZATION_EVENT_BUS_CONTRACT.md`](./MONETIZATION_EVENT_BUS_CONTRACT.md) 或
> [`LIFECYCLE_DATA_STRATEGY_LAYERING.md`](./LIFECYCLE_DATA_STRATEGY_LAYERING.md)
> 中找到原文；不允许出现已归档模块和 sprint / 版本号语言。

## 阅读顺序

| 图 | 回答的问题 | 适合角色 |
|---|---|---|
| [业务架构](#业务架构总览四支柱--统一生态) | OpenBlock 是一个什么样的产品？四个能力如何串成一个生态？ | 全角色 / 对外宣讲 / 新人破冰 |
| [总览图](#总览图全栈分层--设计原则) | 一图看懂从端到云的整体技术架构 | 全角色 / 新人入门 |
| [图 1](#图-1宏观分层c4-容器视图) | 整个项目长什么样？ | 全角色 |
| [图 2](#图-2l3-domain-services-组件图) | 前端业务子系统怎么拆？ | 算法、前端、商业化 |
| [图 3](#图-3monetizationbus-事件总线) | 谁发什么事件、谁订什么？ | 商业化、生命周期、数据 |
| [图 4](#图-4出块双轨--rl-双轨融合) | 算法系统怎么收敛？ | 算法、出块、RL |
| [图 5](#图-5后端路由--数据持久化) | 接口与表怎么映射？ | 后端、SRE、数据 |
| [图 6](#图-6四端同步与部署拓扑) | 一份代码怎么覆盖四端？ | 架构、平台、运维 |

---

## 业务架构总览：四支柱 + 统一生态

> **回答的问题**：OpenBlock 作为一个"游戏 + AI + RL + 商业化"的开源平台，
> 究竟由哪些产品能力组成？这些能力之间如何形成正反馈闭环？
>
> 本图是**最高层的产品视角**：不涉及代码模块、不出现技术名词，把整个项目
> 浓缩为四个产品支柱 + 一个共享数据 / 统一生态中枢。下方的"技术总览图"
> 与 6 张展开图，本质上都是这四个支柱在不同抽象层次上的细化。

![OpenBlock 业务架构：四支柱 + 共享数据源 + 统一生态](./assets/business-architecture.png)

| 支柱 | 一句话定位 | 关键能力 | 对应技术文档 |
|---|---|---|---|
| 🎮 **Games Engine** | 多端方块益智核心玩法 | Web / Android / iOS / 微信小程序四端体验一致 | [图 6: 四端同步与部署拓扑](#图-6四端同步与部署拓扑) · [MOBILE_CLIENTS](../platform/MOBILE_CLIENTS.md) |
| 🧠 **Adaptive Spawning AI** | 心流 / 技能 / 节奏驱动的智能出块 | 双轨出块（启发式 + Transformer V3）+ 统一护栏 + 多样可玩三连块 | [图 4: 出块 / RL 双轨](#图-4出块双轨--rl-双轨融合) · [ALGORITHMS_SPAWN](../algorithms/ALGORITHMS_SPAWN.md) |
| 🤖 **Reinforce Learning Trainer** | 神经网络训练平台 | PyTorch / MLX 双引擎 + PPO + GAE + EvalGate + 自博弈 | [ALGORITHMS_RL](../algorithms/ALGORITHMS_RL.md) · [RL_PYTORCH_SERVICE](../algorithms/RL_PYTORCH_SERVICE.md) |
| 💰 **Monetization Framework** | 可插拔商业化框架 | 广告 / IAP / 个性化推荐三类适配器 + MonetizationBus 零侵入接入 | [图 3: MonetizationBus](#图-3monetizationbus-事件总线) · [MONETIZATION](../operations/MONETIZATION.md) |
| 🗄️ **Shared Data Source** | 单一数据源 / 共享配置 | `shared/game_rules.json` + `shapes.json` + SQLite 行为库四端共用 | [图 5: 后端路由 + 持久化](#图-5后端路由--数据持久化) · [SQLITE_SCHEMA](../engineering/SQLITE_SCHEMA.md) |
| 🔁 **Unified Ecosystem** | 闭环正反馈 | 玩家行为 → 数据 → AI 决策 → 体验 → 行为 | [LIFECYCLE_DATA_STRATEGY_LAYERING](./LIFECYCLE_DATA_STRATEGY_LAYERING.md) |

> **下一步**：业务上明白后，接着看下方"全栈分层"总览了解技术形态；
> 主策划 / 玩法设计师可直接跳到
> [OpenBlock 产品架构图](./PRODUCT_ARCHITECTURE_DIAGRAMS.md) 看 "玩家旅程视角"；
> 算法工程师可直接跳到
> [算法架构图](../algorithms/ALGORITHM_ARCHITECTURE_DIAGRAMS.md)。

---

## 总览图：全栈分层 + 设计原则

> **回答的问题**：OpenBlock 由哪些层、各层做什么、有什么贯穿全局的约束？
>
> 本节给出**一图概览 + 紧凑版 Mermaid 概念图**两种视图：图集中描述能力
> 与边界，**不绑定具体代码文件**。如需追溯到模块、契约、路由、表的细节，
> 参见下方 6 张展开图。

### 视图 A：设计参考图

![OpenBlock 全栈分层架构总览（设计参考）](./assets/architecture-overview.png)

> 上图为完整的设计参考视觉稿：每层右侧附"层内约束"，底部一条带列出
> 6 条贯穿全局的设计原则，便于在评审、培训、对外宣讲时使用。

### 视图 B：紧凑概念图（一屏可视）

> 用 mermaid 11 的 **`block-beta`** 网格语法，可精确指定每行列数，
> 把 6 层 + 1 设计原则带渲染为 7 行水平条带，整体宽高比 ≈ 4:3。
> 相较 `flowchart` + `direction LR`（dagre / ELK 在嵌套 subgraph
> 内无视 LR、把每层挤成 2×N 网格的"法棍"形态），`block-beta` 不依赖
> 自动布局算法去"猜"方向，所见即所得。
>
> 注意：`block-beta` 不支持箭头，层间关系靠从上到下的垂直堆叠
> 自然表达；如需查看显式数据流，参见下方 6 张展开图。

```mermaid
---
config:
  theme: base
  themeVariables:
    primaryColor: "#f8fafc"
    primaryBorderColor: "#94a3b8"
    primaryTextColor: "#0f172a"
    fontSize: "13px"
---
block-beta
  columns 7

  L1T["①<br/>客户端"]:1
  block:L1:6
    columns 4
    L1A["💻 Web"] L1B["📱 Android"] L1C["📱 iOS"] L1D["🟢 微信小程序"]
  end

  L2T["②<br/>编排层"]:1
  block:L2:6
    columns 6
    L2A["🎮 主流程"] L2B["🧠 玩家状态"] L2C["🎯 自适应出块"] L2D["📢 商业化触点"] L2E["🔄 生命周期"] L2F["🤖 强化学习"]
  end

  L3T["③<br/>领域层"]:1
  block:L3:6
    columns 4
    L3A["👤 玩家系统"] L3B["🎲 出块引擎（双轨）"] L3C["💰 商业化框架"] L3D["🔁 生命周期与留存"]
  end

  L4T["④<br/>事件总线"]:1
  block:L4:6
    columns 3
    L4A["📤 发布方"] L4B(("⚡ 事件总线")) L4C["📥 订阅方"]
  end

  L5T["⑤<br/>后端服务"]:1
  block:L5:6
    columns 3
    L5A["🧱 单体服务"] L5B["🧩 微服务"] L5C[("🗄️ 数据存储")]
  end

  L6T["⑥<br/>基础设施"]:1
  block:L6:6
    columns 4
    L6A["📦 部署"] L6B["⚙️ 基础设施"] L6C["📊 可观测"] L6D["🚀 运维交付"]
  end

  PT["🎯<br/>设计原则"]:1
  block:P:6
    columns 6
    P1["🔒 零侵入事件总线"] P2["➡️ 单向依赖"] P3["📚 共享数据语义"] P4["🛡️ 开关默认安全"] P5["🔌 适配器可插拔"] P6["📈 渐进增强"]
  end

  classDef titleCli   fill:#1976d2,stroke:#0d47a1,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleOrch  fill:#5e35b1,stroke:#311b92,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleDom   fill:#388e3c,stroke:#1b5e20,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleBus   fill:#ef6c00,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleBack  fill:#00796b,stroke:#004d40,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleInfra fill:#455a64,stroke:#263238,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titlePrin  fill:#f57f17,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold

  classDef clientLayer  fill:#e3f2fd,stroke:#1976d2,color:#0d47a1,stroke-width:1.2px
  classDef orchLayer    fill:#ede7f6,stroke:#5e35b1,color:#311b92,stroke-width:1.2px
  classDef domainLayer  fill:#e8f5e9,stroke:#388e3c,color:#1b5e20,stroke-width:1.2px
  classDef busLayer     fill:#fff3e0,stroke:#ef6c00,color:#e65100,stroke-width:1.2px
  classDef backendLayer fill:#e0f2f1,stroke:#00796b,color:#004d40,stroke-width:1.2px
  classDef infraLayer   fill:#eceff1,stroke:#455a64,color:#263238,stroke-width:1.2px
  classDef principle    fill:#fff8e1,stroke:#f57f17,color:#5d4037,stroke-width:1.2px

  class L1T titleCli
  class L2T titleOrch
  class L3T titleDom
  class L4T titleBus
  class L5T titleBack
  class L6T titleInfra
  class PT  titlePrin

  class L1A,L1B,L1C,L1D clientLayer
  class L2A,L2B,L2C,L2D,L2E,L2F orchLayer
  class L3A,L3B,L3C,L3D domainLayer
  class L4A,L4B,L4C busLayer
  class L5A,L5B,L5C backendLayer
  class L6A,L6B,L6C,L6D infraLayer
  class P1,P2,P3,P4,P5,P6 principle
```

### 层级与原则解读

| 层级 | 职责 | 层内约束 |
|---|---|---|
| ① 客户端（四端） | 跨平台一致的玩家入口 | 共享同一套规则与数据语义；进度·成就·故障跨端同步；渐进增强 |
| ② 应用编排层 | 局内流程与体验编排 | 数据 → 编排 → 策略；零侵入；特性开关按需开启能力模块 |
| ③ 领域服务层 | 沉淀业务能力 | 玩家 / 出块 / 商业化 / 留存四子系统协同；商业化结果回流玩家画像 |
| ④ 事件总线层 | 零侵入的事件分发 | 统一事件语义；松耦合发布 / 订阅；隐私合规·最小化 |
| ⑤ 后端服务层 | 能力 API + 数据持久化 | 单体（轻量形态）与微服务（生产形态）双形态并存；网关统一安全 |
| ⑥ 基础设施层 | 部署、运维与交付 | 自动化运维与交付；可观测·可追溯；安全合规·稳健可靠 |

| 设计原则 | 解释 |
|---|---|
| 🔒 零侵入事件总线 | 只观察不预设核心心流，保障系统边界清晰 |
| ➡️ 单向依赖 | 体验层 → 领域层 → 数据层 → 基础设施层，层次清晰 |
| 📚 共享数据语义 | 规则与玩法数据为训练 / 玩法 / 分析共享语义，体验一致 |
| 🛡️ 开关默认安全 | 观测路径默认开启，决策路径默认关闭、按需放量 |
| 🔌 适配器可插拔 | 广告与支付等能力可热插拔，支持多平台与多供应商 |
| 📈 渐进增强 | 离线完整可玩，在线解锁更多能力与个性化体验 |

> **下一步**：如需了解具体模块、契约、路由与表，请继续阅读下方 6 张展开图。

---

## 图 1：宏观分层（C4 容器视图）

> 整个项目长什么样？四端形态、前端五层、后端、RL 训练、微服务的
> 容器级关系。本节给出**两张紧凑视图**：上方"容器构成"用 block-beta
> 网格强制 4:3 横向布局（一屏可视所有容器），下方"关键数据流"用
> 小型 flowchart 保留 REST 调用方向。

### 1.1 容器构成（紧凑横向）

```mermaid
---
config:
  theme: base
  themeVariables:
    primaryColor: "#f8fafc"
    primaryBorderColor: "#94a3b8"
    primaryTextColor: "#0f172a"
    fontSize: "12px"
---
block-beta
  columns 7

  CLT["📱<br/>客户端<br/>四端"]:1
  block:CL:6
    columns 4
    web["💻 Web<br/>Vite + Canvas"] android["📱 Android<br/>Capacitor WebView"] ios["📱 iOS<br/>WKWebView"] mp["🟢 微信小程序<br/>miniprogram/"]
  end

  FET["🧱<br/>前端五层<br/>web/src/"]:1
  block:FE:6
    columns 5
    L5["L5 Presentation<br/>renderer · panel"] L4["L4 Orchestration<br/>main · game · trainer"] L3["L3 Domain<br/>Player · Spawn · Mon · LC"] L2["L2 Core Logic<br/>grid · shapes · api · db"] L1["L1 Shared<br/>game_rules · shapes · .env"]
  end

  BET["🌐<br/>后端<br/>Flask + SQLite"]:1
  block:BE:6
    columns 5
    server["server.py<br/>核心路由"] monBackend["mon_backend<br/>/api/mon/*"] rlBackend["rl_backend<br/>/api/rl/*"] enterprise["enterprise<br/>/api/enterprise/*"] sqlite[("🗄️ SQLite<br/>sessions · mon_*")]
  end

  RLT["🤖<br/>RL 训练<br/>双引擎"]:1
  block:RL:6
    columns 2
    pytorch["rl_pytorch/<br/>残差 MLP + DockBoardAttention"] mlx["rl_mlx/<br/>Apple Silicon 等价实现"]
  end

  SVT["⚙️<br/>微服务<br/>services/"]:1
  block:SV:6
    columns 6
    nginx["🚪 nginx<br/>gateway"] user["👤 user<br/>_service"] gameSvc["🎮 game<br/>_service"] analytics["📊 analytics<br/>_service"] monitoring["📈 monitoring<br/>Prom · OTel"] pg[("🗃️ Postgres<br/>· Redis")]
  end

  classDef titleCli   fill:#1976d2,stroke:#0d47a1,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleFe    fill:#5e35b1,stroke:#311b92,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleBe    fill:#00796b,stroke:#004d40,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleRl    fill:#c2185b,stroke:#880e4f,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleSv    fill:#455a64,stroke:#263238,color:#fff,stroke-width:1.4px,font-weight:bold

  classDef cliNode    fill:#e3f2fd,stroke:#1976d2,color:#0d47a1,stroke-width:1.2px
  classDef feNode     fill:#ede7f6,stroke:#5e35b1,color:#311b92,stroke-width:1.2px
  classDef beNode     fill:#e0f2f1,stroke:#00796b,color:#004d40,stroke-width:1.2px
  classDef rlNode     fill:#fce4ec,stroke:#c2185b,color:#880e4f,stroke-width:1.2px
  classDef svNode     fill:#eceff1,stroke:#455a64,color:#263238,stroke-width:1.2px

  class CLT titleCli
  class FET titleFe
  class BET titleBe
  class RLT titleRl
  class SVT titleSv

  class web,android,ios,mp cliNode
  class L5,L4,L3,L2,L1 feNode
  class server,monBackend,rlBackend,enterprise,sqlite beNode
  class pytorch,mlx rlNode
  class nginx,user,gameSvc,analytics,monitoring,pg svNode
```

### 1.2 关键数据流（REST · 文件依赖）

```mermaid
---
config:
  flowchart:
    nodeSpacing: 18
    rankSpacing: 32
---
flowchart LR
  classDef fe fill:#ede7f6,stroke:#5e35b1,color:#311b92
  classDef be fill:#e0f2f1,stroke:#00796b,color:#004d40
  classDef rl fill:#fce4ec,stroke:#c2185b,color:#880e4f
  classDef sv fill:#eceff1,stroke:#455a64,color:#263238

  L2["L2 Core Logic"]:::fe
  L4["L4 Orchestration"]:::fe
  L1["L1 Shared Data"]:::fe
  server["server.py"]:::be
  monBackend["mon_backend"]:::be
  enterprise["enterprise"]:::be
  rlBackend["rl_backend"]:::be
  sqlite[("SQLite")]:::be
  pytorch["rl_pytorch"]:::rl
  mlx["rl_mlx"]:::rl
  nginx["nginx"]:::sv
  user["user_service"]:::sv
  gameSvc["game_service"]:::sv
  analytics["analytics"]:::sv
  monitoring["monitoring"]:::sv
  pg[("PG / Redis")]:::sv

  L2 -.->|REST| server
  L2 -.->|REST /api/mon/*| monBackend
  L2 -.->|REST /api/enterprise/*| enterprise
  L4 -.->|REST /api/rl| rlBackend
  server --> sqlite
  monBackend --> sqlite
  rlBackend --> pytorch
  pytorch --> L1
  mlx --> L1

  nginx --> user
  nginx --> gameSvc
  nginx --> analytics
  user --> pg
  gameSvc --> pg
  monitoring -.->|/metrics| user
  monitoring -.->|/metrics| gameSvc
```

**解读**：四端共享 `web/src` 与 `shared/` 的核心逻辑；前端五层严格自顶向下
依赖；后端有"单体 Flask（4 入口）+ 微服务（4 服务 + nginx + 共享 PG/Redis）"
两种部署形态可选；RL 训练层独立运行，仅通过 `/api/rl` 与浏览器/服务端解耦，
并复用 L1 的同一份规则数据源。

---

## 图 2：L3 Domain Services 组件图

> 前端业务子系统怎么拆？Player、Spawn、Monetization、Lifecycle / Retention
> 四块如何协作。本节给出**两张紧凑视图**：上方 2.1 用 block-beta 网格
> 列出所有模块，下方 2.2 用 flowchart 画跨子系统的关键协作关系。

### 2.1 组件构成（紧凑横向）

```mermaid
---
config:
  theme: base
  themeVariables:
    primaryColor: "#f8fafc"
    primaryBorderColor: "#94a3b8"
    primaryTextColor: "#0f172a"
    fontSize: "12px"
---
block-beta
  columns 7

  PT["👤<br/>Player<br/>System"]:1
  block:P:6
    columns 5
    p1["playerProfile<br/>实时画像"] p2["abilityModel<br/>5 维 ability"] p3["progression<br/>XP · 等级 · 签到"] p4["personalization<br/>信号 → 商业策略"] p5["insightPanel<br/>玩家面板 UI"]
  end

  ST["🎲<br/>Spawn<br/>Engine"]:1
  block:S:6
    columns 4
    s1["adaptiveSpawn<br/>12 信号 → stress"] s2["difficulty<br/>score → stress 基线"] s3["blockSpawn<br/>三连块 + 护栏"] s4["spawnModel<br/>V3 Transformer + LoRA"]
  end

  LT["🔄<br/>Lifecycle<br/>Retention"]:1
  block:L:6
    columns 5
    l1["lifecycleOrchestrator<br/>编排"] l2["lifecycleSignals<br/>信号聚合"] l3["lifecycleDashboard<br/>看板"] l4["playerMaturity<br/>成熟度"] l5["retention/*<br/>churn · funnel · winback · vip"]
  end

  MT["💰<br/>Monetization<br/>Framework"]:1
  block:M:6
    columns 3
    m1(["MonetizationBus<br/>事件总线"]) m2["featureFlags"] m3["commercialModel<br/>+ snapshot + abilityBias"] m4["commercialPolicy<br/>推理 + 探索 + AOM"] m5["adAdapter / adTrigger<br/>+ ad/decisionEngine + insertionRL"] m6["iapAdapter<br/>+ paymentManager"] m7["lifecycleAwareOffers<br/>offerToast / outreach"] m8["dailyTasks · seasonPass<br/>leaderboard"] m9["scaffolding<br/>calibration · explorer · ml · quality"]
  end

  classDef titleP   fill:#1976d2,stroke:#0d47a1,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleS   fill:#388e3c,stroke:#1b5e20,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleL   fill:#f57c00,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleM   fill:#c2185b,stroke:#880e4f,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef pNode    fill:#e3f2fd,stroke:#1976d2,color:#0d47a1,stroke-width:1.2px
  classDef sNode    fill:#e8f5e9,stroke:#388e3c,color:#1b5e20,stroke-width:1.2px
  classDef lNode    fill:#fff3e0,stroke:#f57c00,color:#e65100,stroke-width:1.2px
  classDef mNode    fill:#fce4ec,stroke:#c2185b,color:#880e4f,stroke-width:1.2px

  class PT titleP
  class ST titleS
  class LT titleL
  class MT titleM
  class p1,p2,p3,p4,p5 pNode
  class s1,s2,s3,s4 sNode
  class l1,l2,l3,l4,l5 lNode
  class m1,m2,m3,m4,m5,m6,m7,m8,m9 mNode
```

### 2.2 关键跨子系统协作（数据流）

```mermaid
---
config:
  flowchart:
    nodeSpacing: 20
    rankSpacing: 38
    htmlLabels: true
---
flowchart LR
  classDef p fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
  classDef s fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef l fill:#fff3e0,stroke:#f57c00,color:#e65100
  classDef m fill:#fce4ec,stroke:#c2185b,color:#880e4f

  playerProfile["playerProfile"]:::p
  abilityModel["abilityModel"]:::p
  personalization["personalization"]:::p
  insightPanel["insightPanel"]:::p

  difficulty["difficulty"]:::s
  adaptiveSpawn["adaptiveSpawn"]:::s
  blockSpawn["blockSpawn"]:::s
  spawnModel["spawnModel V3"]:::s

  signals["lifecycleSignals"]:::l
  orchestrator["lifecycleOrchestrator"]:::l
  funnel["firstPurchaseFunnel"]:::l

  bus(["MonetizationBus"]):::m
  flags["featureFlags"]:::m
  commercialModel["commercialModel"]:::m
  commercialPolicy["commercialPolicy"]:::m
  adAdapter["adAdapter"]:::m
  iapAdapter["iapAdapter"]:::m
  offers["lifecycleAwareOffers"]:::m
  tasks["tasks · season"]:::m
  algo["scaffolding"]:::m

  playerProfile --> personalization
  abilityModel --> personalization
  playerProfile --> adaptiveSpawn
  difficulty --> adaptiveSpawn
  adaptiveSpawn --> blockSpawn
  spawnModel -. 可选生成式轨道 .-> blockSpawn
  abilityModel --> spawnModel

  signals --> orchestrator
  funnel --> orchestrator
  orchestrator --> bus

  bus ==> offers
  bus ==> commercialPolicy
  bus ==> tasks
  flags -.-> commercialPolicy
  flags -.-> adAdapter
  personalization --> commercialModel
  commercialModel --> commercialPolicy
  algo -.-> commercialPolicy
  commercialPolicy --> adAdapter
  commercialPolicy --> iapAdapter
  commercialPolicy --> offers
  commercialModel --> insightPanel
```

**解读**：`personalization` 是 Player ↔ Monetization 的桥；`adaptiveSpawn`
接收 `playerProfile` 后输出 stress + spawnHints 给 `blockSpawn`，`spawnModel`
作为可选生成式轨道并行存在；Lifecycle 子系统遵循"信号源 → orchestrator →
总线 emit → 策略消费"的单向链；`commercialPolicy` 作为决策包装层把
`commercialModel + algo/* + adapter` 串成一条线，`featureFlags` 以虚线门控。

---

## 图 3：MonetizationBus 事件总线

> 谁发什么事件、谁订什么？事件契约的可视化版本，详细 payload 与触发时机见
> [`MONETIZATION_EVENT_BUS_CONTRACT.md`](./MONETIZATION_EVENT_BUS_CONTRACT.md)。
>
> 布局：**三栏 LR（发布方 ｜ 总线 ｜ 订阅方）**——把扇入扇出全部拉直
> 成水平流，事件名压成精简前缀（按事件家族归并），整体宽 > 高接近 4:3。

```mermaid
---
config:
  flowchart:
    nodeSpacing: 14
    rankSpacing: 60
    htmlLabels: true
    curve: basis
---
flowchart LR
  classDef pub fill:#e3f2fd,stroke:#1976d2,color:#0d47a1,stroke-width:1.2px
  classDef sub fill:#fff3e0,stroke:#ef6c00,color:#e65100,stroke-width:1.2px
  classDef bus fill:#fff8e1,stroke:#f57f17,color:#5d4037,stroke-width:1.6px,font-weight:bold

  subgraph publishers["📤 发布方"]
    direction TB
    gameJs["game.js<br/>透传 logBehavior"]
    iapAdapter["iapAdapter"]
    adAdapter["adAdapter"]
    orchestrator["lifecycleOrchestrator"]
    lifecycleOffers["lifecycleAwareOffers"]
    dailyTasks["dailyTasks"]
    seasonPass["seasonPass"]
  end
  class gameJs,iapAdapter,adAdapter,orchestrator,lifecycleOffers,dailyTasks,seasonPass pub

  bus(("⚡<br/>MonetizationBus<br/>on / off / emit / attach")):::bus

  subgraph subscribers["📥 订阅方"]
    direction TB
    adTrigger["adTrigger<br/>插屏 + 激励频控"]
    commercialInsight["commercialInsight<br/>注入玩家面板"]
    offerToast["offerToast<br/>Toast · 24h cooldown"]
    outreach["lifecycleOutreach<br/>push + 分享卡"]
    analyticsTracker["analyticsTracker<br/>funnels.AD_WATCH"]
    aom["actionOutcomeMatrix<br/>30 min attribution"]
    lifecycleOffersSub["lifecycleAwareOffers<br/>自订 + 他源订阅"]
  end
  class adTrigger,commercialInsight,offerToast,outreach,analyticsTracker,aom,lifecycleOffersSub sub

  %% ── 发布方 → 总线（按家族压缩事件名，避免边标签过长撑爆宽度）──
  gameJs         ==>|"game_over · spawn_blocks · no_clear · score_update"| bus
  iapAdapter     ==>|"purchase_completed · iap_purchase（兼容）"| bus
  adAdapter      ==>|"ad_show · ad_complete"| bus
  orchestrator   ==>|"lifecycle:session_start/end · intervention · early_winback"| bus
  lifecycleOffers ==>|"lifecycle:offer_available · churn_high · first_purchase"| bus
  dailyTasks     ==>|"daily_task_complete"| bus
  seasonPass     ==>|"season_tier_unlocked"| bus

  %% ── 总线 → 订阅方 ──
  bus ==>|"game_over · no_clear"| adTrigger
  bus ==>|"spawn_blocks · no_clear · game_over"| commercialInsight
  bus ==>|"lifecycle:offer_available / churn_high / early_winback / first_purchase"| offerToast
  bus ==>|"同上"| outreach
  bus ==>|"ad_show · ad_complete"| analyticsTracker
  bus ==>|"purchase_completed · ad_complete · lifecycle:session_end"| aom
  bus ==>|"purchase_completed · lifecycle:session_*"| lifecycleOffersSub
```

**解读**：`game.js` 通过 `attach(game)` 包装 `logBehavior`，把游戏事件**零侵
入**透传到总线；显式事件分四组（IAP / 广告 / 生命周期 / 任务赛季），其中
`purchase_completed` 与 `iap_purchase` 双 emit 兼容旧订阅；
`lifecycleAwareOffers` 既是发布方也是订阅方（典型的"先 emit 信号、再聚合
决策"模式）；`actionOutcomeMatrix` 自动接 IAP / 广告 / 会话结束三类事件做
归因。

---

## 图 4：出块双轨 + RL 双轨融合

> 算法系统怎么收敛？双轨出块如何 fallback、RL 双轨如何共享数据源。
>
> 布局：**LR 三段式**——左侧"共享数据源（L1）"作为入口、中段"出块双轨"
> 主流程横向走、右侧"RL 双轨"做训练/推理；色块按子系统分组。

```mermaid
---
config:
  flowchart:
    nodeSpacing: 18
    rankSpacing: 42
    htmlLabels: true
    curve: basis
---
flowchart LR
  classDef data    fill:#eceff1,stroke:#455a64,color:#263238,stroke-width:1.2px
  classDef heur    fill:#e8f5e9,stroke:#388e3c,color:#1b5e20,stroke-width:1.2px
  classDef gen     fill:#ede7f6,stroke:#5e35b1,color:#311b92,stroke-width:1.2px
  classDef gate    fill:#fff8e1,stroke:#f57f17,color:#5d4037,stroke-width:1.4px,font-weight:bold
  classDef rlBro   fill:#e1f5fe,stroke:#0277bd,color:#01579b,stroke-width:1.2px
  classDef rlPy    fill:#fce4ec,stroke:#c2185b,color:#880e4f,stroke-width:1.2px
  classDef rlSvc   fill:#fff3e0,stroke:#ef6c00,color:#e65100,stroke-width:1.2px

  subgraph DATA["📦 共享数据源（L1）"]
    direction TB
    rulesJson[("game_rules.json<br/>规则 · RL 超参 · reward")]:::data
    shapesJson[("shapes.json<br/>方块定义")]:::data
  end

  subgraph SPAWN["🎲 出块双轨"]
    direction LR
    spawnCtx["buildSpawnModelContext<br/>统一上下文"]:::heur
    subgraph TH["轨道 1 启发式"]
      direction TB
      adaptive["adaptiveSpawn<br/>12 信号 → stress + hints"]:::heur
      blockSpawn["bot/blockSpawn<br/>generateDockShapes"]:::heur
    end
    subgraph TG["轨道 2 生成式"]
      direction TB
      v3["spawnModel<br/>POST /api/spawn-model/v3/predict<br/>SpawnTransformerV3 + LoRA"]:::gen
    end
    guard["🛡️ validateSpawnTriplet<br/>唯一性 / 可放性 / 机动性 / 序贯 / orderRigor"]:::gate
    commit["_commitSpawn<br/>记录 source · V3 meta · fallback"]:::gate
  end

  subgraph RL["🤖 RL 双轨"]
    direction LR
    subgraph RLB["浏览器端（实时）"]
      direction TB
      linearAgent["linearAgent<br/>线性 REINFORCE + 价值基线"]:::rlBro
      browserTrainer["trainer"]:::rlBro
      simulator["simulator"]:::rlBro
    end
    rlBackendNode["rl_backend.py<br/>/api/rl/{select_action, train, save, load, log}"]:::rlSvc
    subgraph RLP["Python 端（离线）"]
      direction TB
      rlPytorch["rl_pytorch/<br/>残差 MLP + DockBoardAttention<br/>GAE + 监督头 + 课程"]:::rlPy
      rlMlx["rl_mlx/<br/>Apple Silicon 等价"]:::rlPy
    end
  end

  %% 出块双轨主流程
  spawnCtx --> adaptive
  spawnCtx --> v3
  adaptive --> blockSpawn
  blockSpawn --> guard
  v3 --> guard
  v3 -. 失败 fallback .-> blockSpawn
  guard --> commit

  %% L1 数据源 → 各 consumer
  rulesJson --> adaptive
  rulesJson --> blockSpawn
  rulesJson --> rlPytorch
  rulesJson --> rlMlx
  rulesJson --> linearAgent
  shapesJson --> blockSpawn
  shapesJson --> rlPytorch
  shapesJson --> rlMlx

  %% RL 双轨内部
  browserTrainer --> linearAgent
  linearAgent --> simulator
  linearAgent -. REST .-> rlBackendNode
  rlBackendNode <--> rlPytorch
  rlBackendNode -. 可选 .-> rlMlx
```

**解读**：双轨出块共享 `buildSpawnModelContext` 上下文，生成式失败时自动降级
到启发式轨道，所有出块结果统一过 `validateSpawnTriplet` 五层护栏；RL 双轨中
浏览器线性 agent 与 PyTorch/MLX 离线训练通过 `rl_backend.py` 解耦；
`shared/game_rules.json + shapes.json` 是出块和 RL 共四套实现的**单一数据源
**，确保前端实时玩法、训练环境、模型推理三者特征对齐。

---

## 图 5：后端路由 + 数据持久化

> 接口与表怎么映射？单体 Flask 与微服务两种部署形态如何并存。本节
> 给出**两张紧凑视图**：5.1 用 block-beta 列出所有路由分组与表，
> 5.2 用 flowchart 画"路由 → 表"的映射关系。

### 5.1 单体路由 + 表 · 微服务（紧凑横向）

```mermaid
---
config:
  theme: base
  themeVariables:
    primaryColor: "#f8fafc"
    primaryBorderColor: "#94a3b8"
    primaryTextColor: "#0f172a"
    fontSize: "11px"
---
block-beta
  columns 7

  R1T["🛣️<br/>核心<br/>路由"]:1
  block:R1:6
    columns 4
    rs1["server.py · /api/session<br/>/behavior · /score · /stats"] rs2["/api/leaderboard · /achievement<br/>/replays · /move-sequence"] rs3["/api/spawn-model/v3/*<br/>status · predict · train · reload"] rs4["/api/health · /export<br/>/docs · /ops"]
  end

  R2T["💰<br/>商业化<br/>路由"]:1
  block:R2:6
    columns 4
    rm1["mon_backend · /api/mon<br/>/user-profile/{id}"] rm2["/api/mon/aggregate"] rm3["/api/mon/model/config<br/>GET / PUT"] rm4["/api/mon/strategy/log"]
  end

  R3T["🤖🏢<br/>RL +<br/>企业"]:1
  block:R3:6
    columns 5
    rr1["rl_backend · /api/rl<br/>select_action · train_episode"] rr2["/api/rl/status · save<br/>load · training_log"] re1["enterprise · remote-config<br/>experiments · live-ops"] re2["/api/payment/verify<br/>ad-impression"] re3["/api/compliance/<br/>{consent, export, delete}"]
  end

  D1T["🗄️<br/>SQLite<br/>核心表"]:1
  block:D1:6
    columns 7
    t1[("sessions<br/>+ attribution JSON")] t2[("behaviors")] t3[("scores")] t4[("user_stats")] t5[("achievements")] t6[("replays<br/>move_sequences")] t7[("client_strategies")]
  end

  D2T["💎<br/>商业化表"]:1
  block:D2:6
    columns 3
    tm1[("mon_user_segments<br/>whale · dolphin · minnow")] tm2[("mon_model_config")] tm3[("mon_strategy_log")]
  end

  MST["⚙️<br/>微服务<br/>形态"]:1
  block:MS:6
    columns 6
    nginx["🚪 nginx<br/>limit_req · auth · TLS"] userSvc["👤 user_service<br/>SqlUserRepository"] gameSvc["🎮 game_service"] analyticsSvc["📊 analytics"] monSvc["📈 monitoring<br/>/metrics · OTel"] pgRedis[("🗃️ PG + Redis<br/>USE_POSTGRES 热切")]
  end

  classDef titleR  fill:#1976d2,stroke:#0d47a1,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleD  fill:#00796b,stroke:#004d40,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleMS fill:#455a64,stroke:#263238,color:#fff,stroke-width:1.4px,font-weight:bold

  classDef rNode    fill:#e3f2fd,stroke:#1976d2,color:#0d47a1,stroke-width:1.2px
  classDef monRoute fill:#fce4ec,stroke:#c2185b,color:#880e4f,stroke-width:1.2px
  classDef rlRoute  fill:#fff3e0,stroke:#ef6c00,color:#e65100,stroke-width:1.2px
  classDef entRoute fill:#ede7f6,stroke:#5e35b1,color:#311b92,stroke-width:1.2px
  classDef dNode    fill:#e0f2f1,stroke:#00796b,color:#004d40,stroke-width:1.2px
  classDef msNode   fill:#eceff1,stroke:#455a64,color:#263238,stroke-width:1.2px

  class R1T,R2T,R3T titleR
  class D1T,D2T titleD
  class MST titleMS

  class rs1,rs2,rs3,rs4 rNode
  class rm1,rm2,rm3,rm4 monRoute
  class rr1,rr2 rlRoute
  class re1,re2,re3 entRoute
  class t1,t2,t3,t4,t5,t6,t7 dNode
  class tm1,tm2,tm3 dNode
  class nginx,userSvc,gameSvc,analyticsSvc,monSvc,pgRedis msNode
```

### 5.2 路由 → 表映射（数据持久化路径）

```mermaid
---
config:
  flowchart:
    nodeSpacing: 16
    rankSpacing: 30
    htmlLabels: true
---
flowchart LR
  classDef route fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
  classDef monR  fill:#fce4ec,stroke:#c2185b,color:#880e4f
  classDef tbl   fill:#e0f2f1,stroke:#00796b,color:#004d40
  classDef ms    fill:#eceff1,stroke:#455a64,color:#263238

  %% 把两个独立子图横向排开（用 invisible edge `~~~` 强制 LR 排列，
  %% 否则 dagre 会把没有跨 subgraph 边的两个 subgraph 上下堆叠）
  subgraph SG_MONOLITH["单体 Flask · 路由 → SQLite 表"]
    direction LR
    sessionR["/api/session<br/>/behavior · /score · /stats"]:::route
    contentR["/api/leaderboard · /achievement<br/>/replays · /move-sequence"]:::route
    monRoutes["/api/mon/user-profile<br/>· aggregate · model · log"]:::monR

    tSessions[("sessions")]:::tbl
    tBehaviors[("behaviors")]:::tbl
    tScores[("scores · stats")]:::tbl
    tAch[("achievements")]:::tbl
    tReplays[("replays · move_sequences")]:::tbl
    tMon[("mon_segments<br/>model_config · strategy_log")]:::tbl

    sessionR --> tSessions
    sessionR --> tBehaviors
    contentR --> tScores
    contentR --> tAch
    contentR --> tReplays
    monRoutes --> tMon
  end

  subgraph SG_MICRO["微服务 · nginx → svc → PG/Redis"]
    direction LR
    nginx["🚪 nginx"]:::ms
    userSvc["user_service"]:::ms
    gameSvc["game_service"]:::ms
    analyticsSvc["analytics"]:::ms
    monSvc["monitoring"]:::ms
    pgRedis[("PG + Redis")]:::ms

    nginx --> userSvc
    nginx --> gameSvc
    nginx --> analyticsSvc
    userSvc --> pgRedis
    gameSvc --> pgRedis
    analyticsSvc --> pgRedis
    monSvc -. /metrics .-> userSvc
    monSvc -. /metrics .-> gameSvc
  end

  tMon ~~~ nginx
```

**解读**：后端两套形态并存——单体 Flask 把 4 个入口（核心 / 商业化 / RL /
企业）挂在同一个 app，便于本地与小型部署；微服务形态把 user / game /
analytics / monitoring 拆开，统一过 nginx 网关，后端持久化 PG/Redis
（`USE_POSTGRES=true` 热切）；`sessions.attribution` 是跨端归因的关键 JSON
字段；`mon_*` 表族支撑分群、模型配置和策略日志，独立于核心表族。

---

## 图 6：四端同步与部署拓扑

> 一份代码怎么覆盖四端？同步管道、能力边界与部署形态。本节给出**两张
> 紧凑视图**：6.1 用 block-beta 列出"源 ｜ 四端形态 ｜ 部署形态"，
> 6.2 用紧凑 LR flowchart 画"同步流水线 + 部署关系"。

### 6.1 四端形态 + 部署形态（紧凑横向）

```mermaid
---
config:
  theme: base
  themeVariables:
    primaryColor: "#f8fafc"
    primaryBorderColor: "#94a3b8"
    primaryTextColor: "#0f172a"
    fontSize: "12px"
---
block-beta
  columns 7

  STT["📦<br/>单一<br/>源"]:1
  block:ST:6
    columns 2
    sharedDir["shared/<br/>game_rules · shapes"] webSrc["web/src/<br/>核心 + 商业化 + RL bot"]
  end

  BPT["🔧<br/>构建<br/>同步"]:1
  block:BP:6
    columns 4
    viteBuild["npm run build<br/>Vite manualChunks"] distDir["dist/<br/>主包 230KB · CI 门禁"] syncCore["sync-core.sh<br/>ESM → CJS"] mobileSync["mobile:sync<br/>Capacitor copy"]
  end

  EPT["📱<br/>四端<br/>形态"]:1
  block:EP:6
    columns 4
    webApp["💻 Web<br/>Vite + Canvas<br/>含 RL · v3 · 看板"] androidApp["📱 Android<br/>Capacitor WebView"] iosApp["📱 iOS<br/>Capacitor WKWebView"] miniBlock["🟢 小程序<br/>core + adapters<br/>(无 RL · v3 · 看板)"]
  end

  DPT["🚀<br/>部署<br/>形态"]:1
  block:DP:6
    columns 4
    monoDeploy["🧱 单体<br/>Flask + SQLite + gunicorn"] k8sDeploy["☸️ k8s/base + helm<br/>8 manifests · HPA"] obs["📊 可观测<br/>Prom · OTel auto"] secHard["🛡️ 安全加固<br/>Argon2id · Fernet · JWT"]
  end

  classDef titleST fill:#1976d2,stroke:#0d47a1,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleBP fill:#5e35b1,stroke:#311b92,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleEP fill:#388e3c,stroke:#1b5e20,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleDP fill:#c2185b,stroke:#880e4f,color:#fff,stroke-width:1.4px,font-weight:bold

  classDef stNode  fill:#e3f2fd,stroke:#1976d2,color:#0d47a1,stroke-width:1.2px
  classDef bpNode  fill:#ede7f6,stroke:#5e35b1,color:#311b92,stroke-width:1.2px
  classDef epNode  fill:#e8f5e9,stroke:#388e3c,color:#1b5e20,stroke-width:1.2px
  classDef dpNode  fill:#fce4ec,stroke:#c2185b,color:#880e4f,stroke-width:1.2px

  class STT titleST
  class BPT titleBP
  class EPT titleEP
  class DPT titleDP

  class sharedDir,webSrc stNode
  class viteBuild,distDir,syncCore,mobileSync bpNode
  class webApp,androidApp,iosApp,miniBlock epNode
  class monoDeploy,k8sDeploy,obs,secHard dpNode
```

### 6.2 同步流水线 + 部署关系

> 本图本质是 TB 顺序流水线（源 → 构建 → 端 → 部署），自然偏纵向。
> 想看四端 / 部署形态的横向构成对比，请回看 [§6.1](#61-四端形态--部署形态紧凑横向)。

```mermaid
---
config:
  flowchart:
    nodeSpacing: 18
    rankSpacing: 32
    htmlLabels: true
    curve: basis
---
flowchart TB
  classDef src   fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
  classDef build fill:#ede7f6,stroke:#5e35b1,color:#311b92
  classDef ep    fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef dep   fill:#fce4ec,stroke:#c2185b,color:#880e4f

  %% 三个内部 LR 的 subgraph 上下叠：第一段是源+构建串，第二段四端横排，
  %% 第三段部署横排；跨段箭头展示同步管道与 HTTPS 调用
  subgraph SRC_BUILD["📦 单一源 + 🔧 构建/同步"]
    direction LR
    sharedDir["shared/<br/>game_rules · shapes"]:::src
    webSrc["web/src/"]:::src
    syncCore["sync-core.sh<br/>ESM → CJS"]:::build
    viteBuild["Vite build"]:::build
    distDir["dist/"]:::build
    mobileSync["mobile:sync<br/>Capacitor copy"]:::build

    sharedDir --> webSrc
    webSrc --> viteBuild
    webSrc --> syncCore
    viteBuild --> distDir
    distDir --> mobileSync
  end

  subgraph EP["📱 四端形态"]
    direction LR
    webApp["💻 Web"]:::ep
    androidApp["📱 Android"]:::ep
    iosApp["📱 iOS"]:::ep
    miniCore["🟢 小程序 core"]:::ep
  end

  subgraph DEP["🚀 部署形态"]
    direction LR
    monoDeploy["🧱 单体 Flask<br/>+ SQLite + gunicorn"]:::dep
    k8sDeploy["☸️ k8s + Helm<br/>HPA · 安全加固"]:::dep
  end

  distDir --> webApp
  mobileSync --> androidApp
  mobileSync --> iosApp
  syncCore --> miniCore
  sharedDir --> miniCore

  webApp -. HTTPS .-> monoDeploy
  androidApp -. HTTPS .-> monoDeploy
  iosApp -. HTTPS .-> monoDeploy
  monoDeploy -. 可选升级 .-> k8sDeploy
```

**解读**：`shared/` + `web/src/` 是四端的**唯一源头**，Web/Android/iOS 走
`Vite build → dist → Capacitor sync` 同一条流水线，小程序走 `sync-core.sh`
把 ESM 转 CJS 落到 `miniprogram/core/`；小程序通过 `storageShim` 把
`wx.*StorageSync` 桥成 `localStorage`，但**显式不包含** RL 训练 / v3 推理 /
运营看板；部署侧从单体 Flask 一键起步，可平滑升级到 k8s + Helm + 自动
Prometheus/OTel + 全套安全加固。

---

## 维护规约

1. **代码事实优先**：图中模块名必须能在
   [`engineering/PROJECT.md`](../engineering/PROJECT.md) 与 §2 事实包追溯到
   实际文件；新增模块同步加入。
2. **单向依赖红线**：L5 → L4 → L3 → L2 → L1；Monetization / Lifecycle /
   Retention 不得反向调用 `game.js` / `grid.js`。
3. **不写中间态**：禁止在图标签里出现 `Phase X / v1.49.x / 已完成 /
   规划中` 等 sprint 节奏语言；状态信息进 [`CHANGELOG.md`](../../CHANGELOG.md)。
4. **重生成流程**：架构发生结构性变化时，更新
   [`ARCHITECTURE_DIAGRAM_PROMPT.md`](./ARCHITECTURE_DIAGRAM_PROMPT.md) 的事实
   包，再用大模型重生成本文档。
5. **渲染验证**：所有 Mermaid 图须能在 mermaid.live 直接渲染；CI 可用
   [`scripts/check_docs_registered.py`](../../scripts/check_docs_registered.py)
   保证注册到文档中心。

## 关联文档

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) —— 文字版完整架构（含 ADR）
- [`./ARCHITECTURE_DIAGRAM_PROMPT.md`](./ARCHITECTURE_DIAGRAM_PROMPT.md) —— 重生成本文档的 prompt 模板
- [`./MONETIZATION_EVENT_BUS_CONTRACT.md`](./MONETIZATION_EVENT_BUS_CONTRACT.md) —— 事件总线 payload / 订阅方契约
- [`./LIFECYCLE_DATA_STRATEGY_LAYERING.md`](./LIFECYCLE_DATA_STRATEGY_LAYERING.md) —— 数据 → 编排 → 策略三段式
- [`../engineering/PROJECT.md`](../engineering/PROJECT.md) —— 模块字典与职责
- [`../algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md`](../algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md) —— 商业化算法层设计
