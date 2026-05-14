# OpenBlock 算法与策略架构图

> **定位**：以「设计参考视图 + 紧凑概念视图 + 8 张算法子图」覆盖 OpenBlock
> 全部算法栈与策略决策路径，作为
> [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md) 的可视化伴随文档。
>
> **范围**：六层结构（数据输入 / 核心模型 / 决策输出 / 训练与优化 / 支撑 /
> 反馈闭环）、七大具名子模型（PlayerProfile · AbilityVector ·
> CommercialPolicy · AdTrigger · AdInsertionRL · LifecycleOrchestrator ·
> ActionOutcomeMetrics）+ 中央融合决策引擎；下沉到子图层即覆盖出块双轨、
> Gameplay RL、商业化决策与 ML scaffolding、生命周期编排。
>
> **生成方式**：紧凑概念图与 8 张子图依据
> [`ALGORITHM_DIAGRAM_PROMPT.md`](./ALGORITHM_DIAGRAM_PROMPT.md)
> 的事实包与约束生成；如需重生成，按照该 prompt 喂给大模型即可。设计参考
> 视图为产品 / 算法评审稿，对应 `algorithm-architecture.png`。
>
> **维护约定**：图中模型与阈值必须能在
> [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md)、
> [`ALGORITHMS_SPAWN.md`](./ALGORITHMS_SPAWN.md)、
> [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md)、
> [`ALGORITHMS_MONETIZATION.md`](./ALGORITHMS_MONETIZATION.md)、
> [`COMMERCIAL_MODEL_DESIGN_REVIEW.md`](./COMMERCIAL_MODEL_DESIGN_REVIEW.md)
> 中找到原文；scaffolding / opt-in 模块必须用虚线或 `flag:` 边标签标注，
> 不允许画成已稳定上线。

## 阅读顺序

| 图 | 回答的问题 | 适合角色 |
|---|---|---|
| [总览图](#总览图算法栈分层--反馈环) | 算法栈整体长什么样？信号怎么回流？视图 A 给六层 / 七子模型设计参考稿，视图 B 给紧凑概念图 | 全角色 / 新算法成员入门 |
| [图 1](#图-1出块双轨决策架构) | 出块怎么决策？V3 失败怎么办？ | 出块算法 / 玩法 |
| [图 2](#图-2spawntransformerv3-网络与推理流) | V3 内部结构？怎么个性化？ | 出块算法 / ML |
| [图 3](#图-3gameplay-rl-训练栈ppo--gae--eval-gate) | RL 怎么训？怎么上线？ | RL / 训练平台 |
| [图 4](#图-4玩家画像与能力评估) | 画像怎么算？能力多少维？ | 玩家系统 / 体验 |
| [图 5](#图-5商业化核心决策线性规则--guardrail--abilitybias) | 规则版决策怎么走？哪些 guardrail？ | 商业化 / 数据 |
| [图 6](#图-6商业化-ml-scaffolding-栈opt-in) | ML 这一组现在在哪？ | 商业化 / ML / 分析 |
| [图 7](#图-7决策与执行管线rule--freq--policy--adinsertion) | 决策怎么落到广告/IAP？ | 商业化 / 客户端 |
| [图 8](#图-8生命周期信号--编排--策略) | 留存触点是怎么编排的？ | 留存运营 / 数据 |

---

## 总览图：算法栈分层 + 反馈环

> **回答的问题**：OpenBlock 由哪些算法、各算法做什么、信号如何回流？
>
> 本节给出 **设计参考视图 + 紧凑概念视图** 两种总览：前者偏产品 / 评审 /
> 培训语言，覆盖六层 + 反馈闭环 + 七大子模型；后者用 Mermaid + ELK 渲染，
> 与下方 8 张子图保持同一抽象层级，便于追溯到代码、阈值、API。

### 视图 A：设计参考图（六层 + 七子模型 + 反馈闭环）

![OpenBlock 算法架构总览：六层结构 + 七子模型 + 反馈闭环](./assets/algorithm-architecture.png)

> 上图为评审 / 培训 / 对外宣讲使用的设计参考稿，把整个算法栈拆为六层
> + 一条独立的"反馈闭环"流水线，并把核心模型层的七个具名子模型围绕"融合
> 决策引擎"展开。表格映射六层与代码 / 文档锚点：

| 层 | 作用 | 关键模块 / 文档 |
|---|---|---|
| ① **数据输入层** | 玩家行为 / 环境状态 / 特征快照 / 历史数据等多源信号 | `playerProfile.js` · `commercialFeatureSnapshot.js` · [SQLITE_SCHEMA](../engineering/SQLITE_SCHEMA.md) |
| ② **核心模型层** | 七大子模型协同：`PlayerProfile` · `AbilityVector` · `CommercialPolicy` · `AdTrigger` · `AdInsertionRL` · `LifecycleOrchestrator` · `ActionOutcomeMetrics`，外加居中的"融合决策引擎"做加权融合 / 规则约束 / 冲突协调 / 风险控制 | [ALGORITHMS_HANDBOOK](./ALGORITHMS_HANDBOOK.md) · [MODEL_SYSTEMS_FOUR_MODELS](./MODEL_SYSTEMS_FOUR_MODELS.md) · [COMMERCIAL_MODEL_DESIGN_REVIEW](./COMMERCIAL_MODEL_DESIGN_REVIEW.md) |
| ③ **决策输出层** | 推荐行动集合 · 执行指令 · 策略解释 · 日志记录 | `commercialPolicy.js` · `strategyEngine.js` · [事件契约](../architecture/MONETIZATION_EVENT_BUS_CONTRACT.md) |
| ④ **训练与优化层** | 数据存储 → 离线训练 → 在线学习 → 评估与验证 → 模型更新；底部一条"奖励信号（多目标优化）"带：收益 / 留存 / 满意度 / 风险 / 生态健康 | [ALGORITHMS_RL](./ALGORITHMS_RL.md) · [RL_PYTORCH_SERVICE](./RL_PYTORCH_SERVICE.md) · `quality/modelQualityMonitor.js` |
| ⑤ **支撑层** | 特征工程平台 · 模型服务平台 · 实验平台 · 监控与告警，所有 ML 子系统的共享基座 | [PROJECT.md](../engineering/PROJECT.md) · [OBSERVABILITY](../operations/OBSERVABILITY.md) · `experimentPlatform.js` · `quality/distributionDriftMonitor.js` |
| ⑥ **反馈闭环** | 效果反馈 → 归因分析 → 策略改进 → 模型迭代，把上线效果回灌到 ① 数据输入与 ④ 训练优化 | `actionOutcomeMatrix.js` · [LIFECYCLE_DATA_STRATEGY_LAYERING](../architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md) |

> **诚实标注**：图中"七大子模型"覆盖**已稳定上线**与**opt-in scaffolding**两类；
> calibration / explorer ε / LinUCB bandit / MTL / ZILN / survival / drift 等仍以
> 默认 identity / baseline 入库（`flag` 默认 OFF），具体 flag 默认值与上线状态
> 见下方 8 张展开图与 [ALGORITHMS_HANDBOOK](./ALGORITHMS_HANDBOOK.md)。

### 视图 B：紧凑概念图（与 8 张子图同抽象层级）

![OpenBlock 算法栈紧凑视图（ELK 静态渲染）](./assets/algorithms-overview.png)

> 上图为 ELK 渲染的离线静态视图，便于在 GitHub / 不支持 Mermaid 的阅读器
> 中直出。下方 ` ```mermaid ` 块是同源源码，文档门户与 mermaid.live 可
> 实时重渲染（缩放更清晰）。视图 B 按 "信号采集 → 算法核心 → 决策与策略
> → 训练与监控" 四层 + 1 行算法侧设计原则带组织，与下方 8 张展开图保持
> 同一节点 / 边粒度，方便逐图深入。
>
> **渲染方案**：使用 mermaid 11 的 `block-beta` 网格语法，**不依赖 ELK
> CDN 加载**（避免浏览器 15s 超时），层间垂直堆叠隐含"信号 → 决策"流向，
> 反馈环用文字下方"反馈环"小节补述（block-beta 语法不支持箭头）。

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
  columns 5

  L1T["①<br/>信号采集"]:1
  block:L1:4
    columns 4
    S1["👤 玩家画像<br/>技能·心流·节奏"] S2["🎯 能力向量<br/>5 维 + playstyle"] S3["🔁 生命周期<br/>S0-S4 · churn blend"] S4["📦 商业化特征<br/>schema v1 · 29 字段"]
  end

  L2T["②<br/>算法核心"]:1
  block:L2:4
    columns 4
    C1["🎲 出块双轨<br/>启发式 + V3 · 硬切换"] C2["🤖 Gameplay RL<br/>PPO + CNN + DockAttn"] C3["💰 商业化模型<br/>线性规则 · 4 倾向"] C4["🔄 生命周期编排<br/>信号 → 编排 → 策略"]
  end

  L3T["③<br/>决策策略"]:1
  block:L3:4
    columns 4
    D1["📋 规则引擎<br/>active 优先 → priority"] D2["⏱️ 广告频控<br/>多窗 cap + LTV shield"] D3["📦 决策包装<br/>vector + 探索 + 记录"] D4["📢 留存触点<br/>winback · 复购 · churn_high"]
  end

  L4T["④<br/>训练监控"]:1
  block:L4:4
    columns 4
    T1["🛠️ PyTorch / MLX<br/>PPO + GAE / REINFORCE"] T2["🛠️ SpawnV3 训练<br/>Transformer + LoRA"] T3["📊 漂移监控<br/>KL > 0.10 警告"] T4["📈 模型质量<br/>PR-AUC · Brier · outcome"]
  end

  PT["🎯<br/>设计原则"]:1
  block:P:4
    columns 4
    P1["🔁 闭环反馈<br/>用户行为 → 信号 → 决策"] P2["🛡️ 默认安全<br/>观测开 · 决策 ε 极小"] P3["🔌 解耦边界<br/>RL ⊥ 真人 · V3 ⊥ RL"] P4["📚 共享数据源<br/>game_rules · shapes 四端"]
  end

  classDef titleSig   fill:#1976d2,stroke:#0d47a1,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleCore  fill:#388e3c,stroke:#1b5e20,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleDec   fill:#ef6c00,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleTrain fill:#5e35b1,stroke:#311b92,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titlePrin  fill:#f57f17,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold

  classDef signalLayer  fill:#e3f2fd,stroke:#1976d2,color:#0d47a1,stroke-width:1.2px
  classDef coreLayer    fill:#e8f5e9,stroke:#388e3c,color:#1b5e20,stroke-width:1.2px
  classDef decisionLayer fill:#fff3e0,stroke:#ef6c00,color:#e65100,stroke-width:1.2px
  classDef trainLayer   fill:#ede7f6,stroke:#5e35b1,color:#311b92,stroke-width:1.2px
  classDef principle    fill:#fff8e1,stroke:#f57f17,color:#5d4037,stroke-width:1.2px

  class L1T titleSig
  class L2T titleCore
  class L3T titleDec
  class L4T titleTrain
  class PT  titlePrin

  class S1,S2,S3,S4 signalLayer
  class C1,C2,C3,C4 coreLayer
  class D1,D2,D3,D4 decisionLayer
  class T1,T2,T3,T4 trainLayer
  class P1,P2,P3,P4 principle
```

**反馈环**（block-beta 不支持箭头，文字补述）：

- ① 信号采集 → ② 算法核心 → ③ 决策策略（垂直主流向）
- ② 算法核心 ⇄ ④ 训练监控（训练入参 / 参数注入双向）
- ③ 决策策略 → 用户行为 → ① 信号采集（外部闭环）

**层级与反馈环解读**：

| 层 | 关键约束 |
|---|---|
| ① 信号采集 | 玩家画像贝叶斯快收敛；能力向量 5 维 + flowState；生命周期 churn 三源 blend（predictor 0.45 / maturity 0.35 / commercial 0.20） |
| ② 算法核心 | 出块双轨**硬切换**（无加权融合）；Gameplay RL 与 SpawnV3 是两个独立模型；商业化模型为**线性规则版**，**非**深度学习 |
| ③ 决策与策略 | 频控含日/局/会话 3 窗 cap、心流 / 认知疲劳 / LTV shield；广告插入 RL 实质为规则 scaffolding |
| ④ 训练与监控 | RL checkpoint `.pt`；ONNX 仓库内未实现；漂移 KL / 质量 PR-AUC 监控默认 ON |

**反馈环**（虚线）：策略层 → 用户反应 → 信号采集层；训练监控 ⇄ 算法核心层（参数注入与训练入参）。

> **下一步**：如需了解每个算法的内部结构与阈值，请继续阅读下方 8 张详细图。

---

## 图 1：出块双轨决策架构

> **回答的问题**：每一轮出块的两条轨道分别是怎么决策的？V3 失败怎么回退？
> 切换是怎么发生的？
>
> **渲染方案**：`flowchart LR`（横向 4 段：入口 → 双轨 → 护栏 → 提交），
> 节点 ID 避免 `switch` 等保留字（旧版触发解析死循环）。

```mermaid
---
config:
  flowchart:
    nodeSpacing: 28
    rankSpacing: 40
    curve: basis
---
flowchart LR
  classDef entry fill:#fce4ec,stroke:#ad1457,color:#880e4f
  classDef dispatch fill:#ffebee,stroke:#c62828,color:#b71c1c
  classDef heuristic fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef generative fill:#ede7f6,stroke:#5e35b1,color:#311b92
  classDef shared fill:#fff3e0,stroke:#ef6c00,color:#e65100
  classDef guard fill:#fffde7,stroke:#f57f17,color:#5d4037

  entry["🎮 game.spawnBlocks()<br/>入口"]:::entry
  dispatch{"localStorage<br/>ob_spawn_mode ?"}:::dispatch

  subgraph H["🅰️ 启发式轨道 · rule"]
    direction TB
    h1["12 信号融合<br/>combo · multiClear · rhythm · sessionArc"]
    h2["adaptiveStress → 10 档 profile<br/>interpolateProfileWeights"]
    h3["spawnHints<br/>combo · multiLineTarget · rhythm 几何门"]
    h4["generateDockShapes<br/>两阶段加权 + 机动性 + DFS"]
    h1 --> h2 --> h3 --> h4
  end
  class h1,h2,h3,h4 heuristic

  subgraph G["🅱️ 生成式轨道 · model-v3"]
    direction TB
    g1["buildSpawnModelContext<br/>topology + ability + ctx24 + bhv56"]
    g2["POST /api/spawn-model/v3/predict<br/>SpawnTransformerV3 + LoRA"]
    g3["返回 3 形状 ID + feasibility 分"]
    g1 --> g2 --> g3
  end
  class g1,g2,g3 generative

  subgraph V["🛡️ 统一护栏 validateSpawnTriplet"]
    direction TB
    v1["≥3 块 · 无重复"]
    v2["canPlaceAnywhere"]
    v3["最低机动性"]
    v4["fill ≥ FILL_SURVIVABILITY_ON<br/>序贯可解（预算 14000）"]
    v1 --> v2 --> v3 --> v4
  end
  class v1,v2,v3,v4 guard

  fallback["⚠️ rule-fallback<br/>记录 fallbackReason"]:::shared
  commit["✅ _commitSpawn<br/>→ Dock 三连块"]:::shared
  feedback["🔁 _feedbackBias<br/>玩家落子 → 画像回流"]:::shared

  entry --> dispatch
  dispatch -- rule --> H
  dispatch -- model-v3 --> G
  H --> V
  G --> V
  V -- 通过 --> commit
  V -- 失败 --> fallback
  fallback -.回退到启发式.-> H
  commit -.下一轮.-> feedback
  feedback -.信号回流.-> h1
  feedback -.信号回流.-> g1
```

**解读**：
- 切换是**硬切换**（`localStorage:ob_spawn_mode`），**没有运行时加权融合，没有独立置信度门**；模型轨"置信度"等价于"V3 HTTP 成功 + `validateSpawnTriplet` 通过"。
- 启发式轨核心阈值：`MAX_SPAWN_ATTEMPTS=22`、`FILL_SURVIVABILITY_ON=0.52`、`SURVIVE_SEARCH_BUDGET=14000`、`CRITICAL_FILL=0.68`、`PC_SETUP_MIN_FILL=0.45`。
- V3 失败的处理是**回退到启发式轨**而不是抛异常；失败原因写入 `fallbackReason`，可作漂移信号。
- 反馈环：用户落子 → `_feedbackBias` → `playerProfile` 与 `behaviorContext` 双向回流，下一轮再驱动两条轨道。

---

## 图 2：SpawnTransformerV3 网络与推理流

> **回答的问题**：V3 的网络结构是什么？输入特征怎么组织？解码怎么保证可行性？
> 怎么按用户做个性化（LoRA）？
>
> **渲染方案**：`block-beta` 网格（同视图 B），4 行结构（输入 → 主干 →
> 输出头 → 解码采样），每行内多节点横排；流向 / 反馈环用文字补述
> （block-beta 不支持箭头，但避免了浏览器渲染超时）。

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

  T1["📥<br/>输入特征"]:1
  block:IN:6
    columns 6
    inA["board<br/>occupancy"] inB["context<br/>24 维"] inC["bhvContext<br/>56 维"] inD["history<br/>3×3 形状 idx"] inE["playstyle<br/>embedding"] inF["userId<br/>→ LoRA"]
  end

  T2["🧠<br/>主干 V3"]:1
  block:BB:6
    columns 3
    b1["Token Embedding<br/>board + ctx + bhv + history"] b2["nn.TransformerEncoder<br/>多层自注意力"] b3["LoRA Adapter<br/>按 userId 切换低秩矩阵"]
  end

  T3["🎯<br/>输出头"]:1
  block:HD:6
    columns 3
    hA["Autoregressive Joint<br/>P_s1 · P_s2|s1 · P_s3"] hB["Feasibility Head<br/>每候选可行概率"] hC["Playstyle Embedding"]
  end

  T4["🎲<br/>解码采样"]:1
  block:DC:6
    columns 4
    d1["temperature = 0.8"] d2["topK = 8"] d3["enforceFeasibility mask"] d4["SHAPE_VOCAB · 28 词表"]
  end

  T5["📦<br/>输出闭环"]:1
  block:OUT:6
    columns 3
    out["3 个 shape ID + feasibility 分"] validate["🛡️ validateSpawnTriplet<br/>详见图 1"] loop["🔁 用户落子 → bhv / playerProfile<br/>→ 下一次推理"]
  end

  classDef titleIn  fill:#1976d2,stroke:#0d47a1,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleBB  fill:#5e35b1,stroke:#311b92,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleHD  fill:#388e3c,stroke:#1b5e20,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleDC  fill:#ef6c00,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleOut fill:#f57f17,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold

  classDef input fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
  classDef backbone fill:#ede7f6,stroke:#5e35b1,color:#311b92
  classDef head fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef sample fill:#fff3e0,stroke:#ef6c00,color:#e65100
  classDef output fill:#fffde7,stroke:#f57f17,color:#5d4037

  class T1 titleIn
  class T2 titleBB
  class T3 titleHD
  class T4 titleDC
  class T5 titleOut

  class inA,inB,inC,inD,inE,inF input
  class b1,b2,b3 backbone
  class hA,hB,hC head
  class d1,d2,d3,d4 sample
  class out,validate,loop output
```

**推理流向**（block-beta 不支持箭头，文字补述）：

- 输入特征 → 主干 V3 → 输出头 → 解码采样 → 输出（5 行垂直堆叠隐含主流向）
- 主干内部：`b1 Token Embedding → b2 TransformerEncoder → b3 LoRA Adapter`
- 反馈闭环：输出 → 用户落子 → bhv / playerProfile → 下一次推理回到输入特征

**解读**：
- 主干用 `nn.TransformerEncoder`，**与 Gameplay RL 的 `ConvSharedPolicyValueNet` 完全独立**——不要混淆为同一个模型。
- LoRA 按 `userId` 切换低秩矩阵，实现轻量级用户级个性化；不写时退化为基础参数。
- 解码是**自回归** joint：先采 s₁，再条件采 s₂、s₃；每步用 `feasibility mask` 屏蔽不可放置的形状候选。
- 采样默认 `temperature=0.8`、`topK=8`；服务端可通过请求体覆写。
- 闭环：用户落子结果回流到 `behaviorContext`（含 `AbilityVector`），下一轮再驱动 V3。

---

## 图 3：Gameplay RL 训练栈（PPO + GAE + Eval Gate）

> **回答的问题**：RL 在训什么、用什么算法、怎么探索、怎么评估、怎么上线？
>
> **渲染方案**：`flowchart LR`，6 段横向流水线（数据 → 主干 → 多任务头 →
> 训练 → 评估门 → 上线）+ 闭环；多任务头并列展开。

```mermaid
---
config:
  flowchart:
    nodeSpacing: 24
    rankSpacing: 36
    curve: basis
---
flowchart LR
  classDef data fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
  classDef net fill:#ede7f6,stroke:#5e35b1,color:#311b92
  classDef head fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef train fill:#fff3e0,stroke:#ef6c00,color:#e65100
  classDef gate fill:#ffebee,stroke:#c62828,color:#b71c1c
  classDef serve fill:#fffde7,stroke:#f57f17,color:#5d4037

  subgraph DATA["📥 数据来源"]
    direction TB
    da1["simulator self-play"]
    da2["replay buffer<br/>POST /api/rl/train_episode"]
    da3["shared/game_rules.json<br/>shared/shapes.json"]
  end
  class da1,da2,da3 data

  subgraph NET["🧠 主干 · ConvSharedPolicyValueNet"]
    direction TB
    n1["CNN 棋盘编码<br/>state dim = 181"]
    n2["DockBoardAttention<br/>Cross-attention"]
    n3["DockPointEncoder<br/>PointNet 风格"]
    n1 --> n2 --> n3
  end
  class n1,n2,n3 net

  subgraph HEADS["🎯 多任务头"]
    direction TB
    head1["policy · 15 维"]
    head2["value · outcome 混合"]
    head3["board_quality"]
    head4["feasibility"]
    head5["survival"]
    head6["topology_aux"]
    head7["clear_pred"]
  end
  class head1,head2,head3,head4,head5,head6,head7 head

  subgraph TR["🛠️ 训练管线 PPO"]
    direction TB
    t1["GAE λ + outcome 混合 value"]
    t2["PPO 多 epoch + clipping"]
    t3["探索：温度 + Dirichlet 噪声"]
    t4["辅助监督头联合损失"]
    t1 --> t2 --> t3 --> t4
  end
  class t1,t2,t3,t4 train

  subgraph EVAL["🚦 EvalGate"]
    direction TB
    e1["Ranked Reward<br/>对历史 ckpt 排名"]
    e2["KPI 守门<br/>不通过 → 不上线"]
    e1 --> e2
  end
  class e1,e2 gate

  subgraph SERVE["🚀 上线"]
    direction TB
    sv1["openblock_rl.pt<br/>checkpoint"]
    sv2["POST /api/rl/select_action<br/>HTTP 推理"]
    sv3["replay 上报<br/>/api/rl/train_episode"]
    sv1 --> sv2
    sv2 -.玩家行为回流.-> sv3
  end
  class sv1,sv2,sv3 serve

  loop["🔁 自博弈对局<br/>→ 下一轮数据"]:::serve

  DATA --> NET --> HEADS --> TR --> EVAL
  EVAL -- 通过 --> SERVE
  SERVE -.闭环.-> loop
  loop -.数据回灌.-> DATA
  sv3 -.replay flush.-> da2
```

**解读**：
- **算法家族**：主路径 **PPO + GAE**（`rl_pytorch/train.py` + `rl_backend.py`）；MLX 路径 **REINFORCE + value baseline**；DQN/SAC **未采用**；MCTS / AlphaZero **可选**。
- **主干 ≠ Transformer**：Gameplay RL 用 `ConvSharedPolicyValueNet`（CNN + DockBoardAttention + DockPointEncoder）；TransformerEncoder **仅** SpawnV3 用，两者完全解耦。
- **多任务头**：5 个辅助头与 policy/value 共享主干，做联合监督，提升样本利用率。
- **探索**：softmax 温度 + Dirichlet 噪声（**非** ε-greedy）。
- **EvalGate**：Ranked Reward 不通过则不上线；上线即写入 `openblock_rl.pt`，HTTP 暴露给浏览器与训练栈。
- **闭环**：浏览器对局 → replay flush → 下一轮 PPO 数据。

---

## 图 4：玩家画像与能力评估

> **回答的问题**：技能与能力是怎么从原始行为算出来的？信号怎么回流？
>
> **渲染方案**：`block-beta` 网格，4 行结构（原始信号 → PlayerProfile →
> AbilityVector → 消费方），PlayerProfile 6 步流水线横排展示；流向 / 反馈
> 用文字补述。

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

  T1["📥<br/>原始信号"]:1
  block:RAW:6
    columns 4
    r1["thinkMs<br/>clearLine"] r2["combo<br/>misses"] r3["cognitiveLoad"] r4["sessionDuration<br/>placementCount"]
  end

  T2["🧠<br/>PlayerProfile<br/>实时画像"]:1
  block:PP:6
    columns 6
    p1["_computeRawSkill<br/>think/clear/combo/miss/load"] p2["Bayes 平滑<br/>α=0.35 → 0.15"] p3["historicalSkill<br/>EWMA decay 0.85"] p4["trend<br/>EWLS 回归"] p5["confidence<br/>局数/20 + 24h 衰减"] p6["segment5 分箱<br/>E/D/C/B/A"]
  end

  T3["🎯<br/>AbilityVector v2<br/>5 维 + 扩展"]:1
  block:AV:6
    columns 6
    a1["skillScore"] a2["controlScore<br/>含 pickToPlaceMs"] a3["clearEfficiency"] a4["boardPlanning"] a5["riskTolerance<br/>riskHigh=0.72"] a6["+ playstyle<br/>flowState"]
  end

  T4["🔌<br/>主要消费方"]:1
  block:CONS:6
    columns 4
    c1["spawnModel<br/>bhv 注入"] c2["commercialModel<br/>_abilityBias ±0.12~0.18"] c3["commercialFeatureSnapshot<br/>ability 字段"] c4["adaptiveSpawn<br/>flowState · pacingPhase"]
  end

  classDef titleRaw  fill:#1976d2,stroke:#0d47a1,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titlePP   fill:#5e35b1,stroke:#311b92,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleAV   fill:#388e3c,stroke:#1b5e20,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleCons fill:#f57f17,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold

  classDef raw fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
  classDef profile fill:#ede7f6,stroke:#5e35b1,color:#311b92
  classDef ability fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef cons fill:#fffde7,stroke:#f57f17,color:#5d4037

  class T1 titleRaw
  class T2 titlePP
  class T3 titleAV
  class T4 titleCons

  class r1,r2,r3,r4 raw
  class p1,p2,p3,p4,p5,p6 profile
  class a1,a2,a3,a4,a5,a6 ability
  class c1,c2,c3,c4 cons
```

**计算与反馈流向**（block-beta 不支持箭头，文字补述）：

- ① 原始信号 → ② PlayerProfile → ③ AbilityVector → ④ 消费方（4 行垂直堆叠隐含主流向）
- PlayerProfile 内部流水线：`_computeRawSkill → Bayes 平滑 → historicalSkill → trend → confidence → segment5`
- 反馈环：消费方 → 用户落子 / 决策结果 → `recordSpawn` / `place` / `_feedbackBias` → 下一步更新原始信号

**解读**：
- 画像设计为**前期快收敛 + 后期慢平滑**：前 5 步用大 α（`fastConvergenceAlpha=0.35`），之后切换为 `smoothingFactor=0.15`，避免新玩家被冷启动卡住。
- 长周期：会话均值 EWMA(`0.85`) → EWLS 回归 trend → confidence 由局数/20 与 24h 衰减叠加；分档为 segment5 规则分箱（**非** K-Means 在线聚类）。
- 能力向量是**统一消费层**：spawnModel 通过 `behaviorContext(56)` 注入，commercialModel 通过 `_abilityBias` 微调四个倾向，commercialFeatureSnapshot 持久化。
- IRT 模型在仓库内**未实现**。
- 反馈环：`recordSpawn` / `place` / `_feedbackBias` 产生的新信号闭环回 `_computeRawSkill`。

---

## 图 5：商业化核心决策（线性规则 + guardrail + abilityBias）

> **回答的问题**：规则版商业化模型怎么从信号算出 `recommendedAction`？
> Guardrail 是怎么压制激进决策的？
>
> **渲染方案**：`flowchart LR`，5 段横向（输入 → 线性加权 → guardrail
> → 决策阈值 → 放行）+ abilityBias 旁路注入。

```mermaid
---
config:
  flowchart:
    nodeSpacing: 24
    rankSpacing: 36
    curve: basis
---
flowchart LR
  classDef input fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
  classDef weight fill:#ede7f6,stroke:#5e35b1,color:#311b92
  classDef bias fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef guard fill:#ffebee,stroke:#c62828,color:#b71c1c
  classDef out fill:#fffde7,stroke:#f57f17,color:#5d4037

  subgraph INP["📥 输入信号"]
    direction TB
    i1["persona · 用户画像"]
    i2["realtime · 本局节奏 / 心流"]
    i3["LTV · 归一 ltvNormMax=20"]
    i4["adFrequency · 历史频控"]
    i5["AbilityVector · 5 维能力"]
  end
  class i1,i2,i3,i4,i5 input

  subgraph LIN["⚖️ 线性加权 + clamp"]
    direction TB
    w1["payerScore"]
    w2["iapPropensity"]
    w3["rewardedAdPropensity"]
    w4["interstitialPropensity"]
    w5["churnRisk"]
    w6["adFatigueRisk"]
  end
  class w1,w2,w3,w4,w5,w6 weight

  ab["🎯 _abilityBias<br/>±0.12~0.18<br/>flag: abilityCommercial (默认 ON)"]:::bias

  subgraph GR["🛡️ Guardrail 链"]
    direction TB
    g1["protectPayerScore=0.68<br/>付费保护"]
    g2["suppressInterstitialChurn=0.62"]
    g3["suppressInterstitialFatigue=0.55"]
    g4["suppressRewardedFatigue=0.72"]
    g5["suppressAllFatigue=0.82<br/>全压制"]
    g1 --> g2 --> g3 --> g4 --> g5
  end
  class g1,g2,g3,g4,g5 guard

  subgraph DEC["🎯 recommendedAction 决策阈值"]
    direction TB
    a1["iap ≥ 0.68"]
    a2["rewarded ≥ 0.55"]
    a3["interstitial ≥ 0.5"]
    a4["churn ≥ 0.62 或 payer < 0.35<br/>→ task_or_push"]
  end
  class a1,a2,a3,a4 out

  shouldAllow["✅ shouldAllowMonetizationAction<br/>allowAction ≥ 0.45"]:::out
  loop["🔁 用户行为 → 频控 + outcome<br/>→ 下一轮信号"]:::out

  INP --> LIN
  i5 --> ab
  ab -.调整 4 倾向.-> w2
  ab -.调整.-> w3
  ab -.调整.-> w4
  ab -.调整.-> w5
  LIN --> GR --> DEC --> shouldAllow
  shouldAllow -.闭环.-> loop
  loop -.信号回流.-> INP
```

**解读**：
- 规则版核心是**线性加权 + clamp**，**非深度学习**——这是诚实事实，不要画成 ML 决策。
- AbilityVector 通过 `_abilityBias` 微调四个倾向（±0.12~0.18），由 `flag:abilityCommercial`（默认 ON）控制开关。
- Guardrail 链按"付费保护 → 流失 / 疲劳分级压制 → 全局疲劳"五段顺序裁剪激进决策；任何一段命中即影响最终倾向。
- `recommendedAction` 阈值：`iap≥0.68` / `rewarded≥0.55` / `interstitial≥0.5` / `churn≥0.62 或 payer<0.35 → task_or_push`。
- `shouldAllowMonetizationAction` 默认放行阈值 `0.45`，用于二次门控。
- 反馈环：决策结果 → 频控状态 + actionOutcomeMatrix → 下一轮 `realtime / adFrequency` 重算。

---

## 图 6：商业化 ML Scaffolding 栈（opt-in）

> **回答的问题**：哪些 ML 能力已经入库为骨架？哪些默认开关？怎么注入离线
> 训练好的参数？
>
> **渲染方案**：`flowchart LR`，"稳定核心 → scaffolding 扇出 → 监控 →
> 离线训练 → 参数回灌"，6 个 scaffolding 子图横向并列；scaffolding
> classDef 用虚线边框（`stroke-dasharray:4 3`）显式区分稳定 vs opt-in。

```mermaid
---
config:
  flowchart:
    nodeSpacing: 22
    rankSpacing: 34
    curve: basis
---
flowchart LR
  classDef stable fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef scaffold fill:#fffde7,stroke:#fbc02d,color:#5d4037,stroke-dasharray:4 3
  classDef offline fill:#eceff1,stroke:#455a64,color:#263238
  classDef monitor fill:#ffebee,stroke:#c62828,color:#b71c1c

  cm["💰 commercialModel<br/>线性规则版（已稳定）"]:::stable
  policy["📦 commercialPolicy<br/>vector + 探索 + 记录"]:::stable

  subgraph CAL["🎯 校准 · flag:propensityCalibration"]
    direction TB
    cal1["propensityCalibrator<br/>isotonic/Platt/identity"]
    cal2["setCalibrationBundle<br/>注入离线参数"]
  end
  class cal1,cal2 scaffold

  subgraph EXP["🎲 探索 · 默认 ε=0.05"]
    direction TB
    exp1["epsilonGreedyExplorer<br/>每用户每小时 cap=6"]
    exp2["wrapWithExplorer<br/>action + IPS 权重"]
  end
  class exp1,exp2 scaffold

  subgraph BAN["🎰 LinUCB Bandit · flag:bandit"]
    direction TB
    b1["LinUCB α=0.5 · dim=8"]
    b2["selectAction / updateBandit"]
    b3["buildBanditPolicyForAdInsertion"]
    b4["localStorage<br/>openblock_linucb_state_v1"]
  end
  class b1,b2,b3,b4 scaffold

  subgraph LTV["💎 ZILN LTV · flag:zilnLtvModel"]
    direction TB
    z1["predictZilnLtv<br/>未注入 → baseline"]
    z2["setZilnParams<br/>注入离线 ZILN 参数"]
  end
  class z1,z2 scaffold

  subgraph SUR["⏰ Survival Push · flag:survivalPushTiming"]
    direction TB
    sp1["recommendPushTime<br/>thr=0.7 · horizon=21d"]
    sp2["未注入 β → hazard=1"]
  end
  class sp1,sp2 scaffold

  subgraph MTL["🧬 MTL Encoder · flag:multiTaskEncoder (OFF)"]
    direction TB
    m1["linear → latent16 → ReLU"]
    m2["每任务 sigmoid head"]
    m3["默认 identity 编码"]
  end
  class m1,m2,m3 scaffold

  subgraph MON["📊 监控（默认 ON）"]
    direction TB
    mo1["distributionDriftMonitor<br/>KL > 0.10 警告 · > 0.25 下线"]
    mo2["modelQualityMonitor<br/>PR-AUC · Brier"]
    mo3["actionOutcomeMatrix"]
  end
  class mo1,mo2,mo3 monitor

  subgraph OFFL["💼 离线训练（仓库外）"]
    direction TB
    o1["历史数据"]
    o2["EconML / sklearn / PyTorch"]
    o3["参数 JSON"]
    o1 --> o2 --> o3
  end
  class o1,o2,o3 offline

  cm -.倾向.-> CAL
  cm --> policy
  policy -.探索.-> EXP
  policy -.bandit.-> BAN
  cm -.LTV.-> LTV
  policy -.timing.-> SUR
  cm -.特征.-> MTL

  cm --> MON
  policy --> MON
  EXP --> MON
  BAN --> MON

  o3 -.参数注入.-> cal2
  o3 -.参数注入.-> z2
  o3 -.β 注入.-> sp2
  o3 -.权重注入.-> m1

  loop["🔁 漂移 → 重训信号<br/>→ 离线训练"]:::monitor
  MON -.超阈值.-> loop
  loop -.触发.-> OFFL
```

**解读**：
- **稳定（实线）**：`commercialModel`、`commercialPolicy` 是当前默认决策路径。
- **Scaffolding（虚线 + flag）**：`propensityCalibration` / `bandit` / `zilnLtvModel` / `survivalPushTiming` / `multiTaskEncoder` 都以"骨架 + 推理路径 + 默认参数（identity / baseline）"形式入库——**真训练在仓库外离线完成后通过 setter 注入**。
- **常驻监控（默认 ON）**：drift monitor (KL `>0.10` 警告)、quality monitor (PR-AUC / Brier)、actionOutcomeMatrix——观测路径默认开启，决策路径默认关闭，符合"默认安全"原则。
- 闭环：监控超阈值 → 离线训练流水线 → 参数 JSON → setter 注入对应模块 → 下一窗口生效。

---

## 图 7：决策与执行管线（rule + freq + policy + adInsertion）

> **回答的问题**：从规则决策到广告 / IAP / 任务的最终落地，途中经过哪些
> 层、有哪些频控？
>
> **渲染方案**：`flowchart LR`，5 段横向（规则 → 频控 → 决策包装 →
> 广告插入 → 执行）+ 频控级联用虚线表示同层"或"关系。

```mermaid
---
config:
  flowchart:
    nodeSpacing: 24
    rankSpacing: 36
    curve: basis
---
flowchart LR
  classDef rule fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
  classDef freq fill:#fff3e0,stroke:#ef6c00,color:#e65100
  classDef policy fill:#ede7f6,stroke:#5e35b1,color:#311b92
  classDef ad fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef out fill:#fffde7,stroke:#f57f17,color:#5d4037

  subgraph RE["📋 规则引擎 strategyEngine"]
    direction TB
    re1["filter 规则候选"]
    re2["_renderAction"]
    re3["排序：active → priority high=3"]
    re4["buildWhyLines"]
    re1 --> re2 --> re3 --> re4
  end
  class re1,re2,re3,re4 rule

  subgraph FQ["⏱️ 广告频控 adTrigger"]
    direction TB
    f1["rewarded · 3/局 · 12/日 · cd 90s"]
    f2["interstitial · 6/日 · cd 180s · 首 3 局禁"]
    f3["体验分 < 60 → 休养期"]
    f4["心流护栏 · frustration max=2"]
    f5["认知疲劳 · reaction×1.5 / baseline 1500ms"]
    f6["LTV shield · spend≥50 或 VIP T2-T5"]
    f1 -. 同时生效 .-> f2
    f2 -.-> f3
    f3 -.-> f4
    f4 -.-> f5
    f5 -.-> f6
  end
  class f1,f2,f3,f4,f5,f6 freq

  subgraph PO["📦 决策包装 commercialPolicy"]
    direction TB
    po1["buildCommercialModelVector"]
    po2["wrapWithExplorer · ε=0.05"]
    po3["recordRecommendation<br/>flag:actionOutcomeMatrix"]
    po1 --> po2 --> po3
  end
  class po1,po2,po3 policy

  subgraph AD["📺 adInsertionRL · flag 默认 OFF"]
    direction TB
    ad1["注入 policy"]
    ad2["adInsertionBandit"]
    ad3["_ruleBasedPolicy<br/>fatigue≥0.8 或 churn≥0.7 → skip"]
    ad4["奖励 · filled +1 / rewarded +0.5<br/>abandon -1.5 / fatigue -0.3"]
    ad1 --> ad2 --> ad3 --> ad4
  end
  class ad1,ad2,ad3,ad4 ad

  exec["🚀 适配器执行<br/>adAdapter / iapAdapter / tasks / outreach"]:::out
  outcome["📊 outcome 收集<br/>ad_show / complete / purchase"]:::out
  loop["🔁 频控状态 + outcomeMatrix 更新"]:::out

  RE --> FQ --> PO --> AD --> exec
  exec -.事件.-> outcome
  outcome -.频控更新.-> FQ
  outcome -.outcome 矩阵.-> po3
```

**解读**：
- 规则引擎排序逻辑：先按 `active` 优先（`when` 命中或满足广告类型阈值），再按 `priority`（high=3）。
- 频控不是单一窗口，而是**多窗 cap + 体验分 + 心流 + 认知疲劳 + LTV shield** 的级联——任一档命中即压制；图中用虚线表示同层"或"关系。
- `adInsertionRL` 实际是**规则版 scaffolding**（`flag:adDecisionEngine` 默认 OFF），上线时的"RL"等价于规则裁决；reward 公式记录在那里，等真训练接入时复用。
- 反馈环：广告 / IAP / 任务事件 → 频控状态更新（rewarded/interstitial 各 cap） + actionOutcomeMatrix 记录，下一次决策即用新状态。

---

## 图 8：生命周期信号 → 编排 → 策略

> **回答的问题**：留存运营是怎么从 5 阶段 + churn blend 编排到 winback /
> 复购 / churn_high 的？
>
> **渲染方案**：`block-beta` 网格，4 行严格分层（信号 → 编排 → 策略 → 总线）
> + 触点执行；体现"三段式"分层；流向 / 反馈用文字补述。

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

  T1["📡<br/>lifecycleSignals<br/>信号层"]:1
  block:SIG:6
    columns 4
    sg1["stage<br/>S0/S1/S2/S3/S4"] sg2["churn 三源 blend<br/>0.45 + 0.35 + 0.20"] sg3["churnLevel<br/>critical/high/med/low"] sg4["unifiedRisk<br/>maturityScore"]
  end

  T2["🎼<br/>lifecycleOrchestrator<br/>编排层"]:1
  block:ORC:6
    columns 4
    or1["onSessionStart<br/>会话识别 + 阶段刷新"] or2["onSessionEnd<br/>engagement 计算"] or3["engagement 公式<br/>0.6×min(1,dur/300)<br/>+0.4×(1-miss/place)"] or4["updateMaturity<br/>每局结束写入"]
  end

  T3["🎯<br/>lifecycleAwareOffers<br/>策略层"]:1
  block:POL:6
    columns 4
    p1["winback<br/>daysSinceLastActive ≥ 7"] p2["复购 · 窗口 7d<br/>getRecommendedOffer"] p3["首充漏斗<br/>firstPurchaseFunnel"] p4["churn_high<br/>unifiedRisk ≥ 0.5"]
  end

  T4["📤<br/>MonetizationBus<br/>事件总线"]:1
  block:EV:6
    columns 5
    e1["session_start/end"] e2["offer_available"] e3["churn_high"] e4["first_purchase"] e5["early_winback"]
  end

  T5["🚀<br/>触点 + 反馈"]:1
  block:OUT:6
    columns 2
    exec["触点执行<br/>offerToast · outreach · dailyTasks"] fb["🔁 用户接受/拒绝/沉默 → analyticsTracker<br/>→ 下一轮 churn blend 重算"]
  end

  classDef titleSig fill:#1976d2,stroke:#0d47a1,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleOrc fill:#5e35b1,stroke:#311b92,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titlePol fill:#388e3c,stroke:#1b5e20,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleEv  fill:#ef6c00,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold
  classDef titleOut fill:#f57f17,stroke:#e65100,color:#fff,stroke-width:1.4px,font-weight:bold

  classDef sig fill:#e3f2fd,stroke:#1976d2,color:#0d47a1
  classDef orc fill:#ede7f6,stroke:#5e35b1,color:#311b92
  classDef pol fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
  classDef evt fill:#fff3e0,stroke:#ef6c00,color:#e65100
  classDef out fill:#fffde7,stroke:#f57f17,color:#5d4037

  class T1 titleSig
  class T2 titleOrc
  class T3 titlePol
  class T4 titleEv
  class T5 titleOut

  class sg1,sg2,sg3,sg4 sig
  class or1,or2,or3,or4 orc
  class p1,p2,p3,p4 pol
  class e1,e2,e3,e4,e5 evt
  class exec,fb out
```

**编排流向与反馈环**（block-beta 不支持箭头，文字补述）：

- ① 信号 → ② 编排 → ③ 策略 → ④ 事件总线 → ⑤ 触点（5 行垂直堆叠隐含三段式严格分层；任何反向调用属于违规）
- 反馈环：用户对 offer 的反应 → analyticsTracker → 下一轮 churn blend / maturity 重算回到信号层

**解读**：
- **三段式**严格分层：`lifecycleSignals`（数据） → `lifecycleOrchestrator`（编排） → `lifecycleAwareOffers / offerToast / lifecycleOutreach`（策略）；任何反向调用属于违规。
- churn 是**三源 blend**：`predictor 0.45 + maturity 0.35 + commercial 0.20`（默认权重）；`commercial` 来自 `commercialModel.churnRisk`，权重最低，避免商业化倾向反向支配留存判断。
- engagement 公式以"会话长度（封顶 5 分钟）"与"放置成功率"加权，体现"耗时 ≠ 体验"。
- 事件全部走 `MonetizationBus`，订阅方零侵入；详细事件契约见
  [`MONETIZATION_EVENT_BUS_CONTRACT.md`](../architecture/MONETIZATION_EVENT_BUS_CONTRACT.md)。
- 反馈环：用户对 offer 的反应 → analyticsTracker → 下一轮 churn blend 与 maturity 重算。

---

## 自检结果

- [x] 1 张总览图 + 8 张算法子图全部产出，且每张图前有问题陈述、后有解读
- [x] 所有模型 / 算法 / 阈值 / 路由都能在 [`ALGORITHM_DIAGRAM_PROMPT.md`](./ALGORITHM_DIAGRAM_PROMPT.md) §2 找到原文
- [x] scaffolding 模块（calibration / explorer / bandit / ZILN / survival / MTL）全部用虚线 + `flag:` 标注，未画成已稳定
- [x] 每张子图都画出反馈回流边
- [x] 出块双轨标注硬切换（不是加权融合）+ 统一护栏 + rule-fallback
- [x] Gameplay RL 与 SpawnV3 在图中是两个独立模型，没有共享主干（图 2 vs 图 3）
- [x] 商业化决策图（图 5）体现 guardrail 链 + abilityBias
- [x] 生命周期图（图 8）体现三段式 + churn blend 默认权重 0.45/0.35/0.20
- [x] 全部 Mermaid 图本地 `mermaid.parse` 通过

## 关联文档

- [`ALGORITHM_DIAGRAM_PROMPT.md`](./ALGORITHM_DIAGRAM_PROMPT.md) —— 本图集的生成 prompt（事实包 + 输出规范）
- [`ALGORITHMS_HANDBOOK.md`](./ALGORITHMS_HANDBOOK.md) —— 算法手册主入口
- [`ALGORITHMS_SPAWN.md`](./ALGORITHMS_SPAWN.md) —— 出块算法权威源（图 1 / 图 2）
- [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md) —— RL 训练栈权威源（图 3）
- [`ALGORITHMS_MONETIZATION.md`](./ALGORITHMS_MONETIZATION.md) —— 商业化算法手册（图 5 / 图 6 / 图 7）
- [`COMMERCIAL_MODEL_DESIGN_REVIEW.md`](./COMMERCIAL_MODEL_DESIGN_REVIEW.md) —— 商业化模型架构设计
- [`SPAWN_ALGORITHM.md`](./SPAWN_ALGORITHM.md) —— 出块算法三层模型
- [`../architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md`](../architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md) —— 系统架构图（系统侧的姊妹篇）
