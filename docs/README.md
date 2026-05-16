# OpenBlock 文档中心

> 面向开源协作的统一入口：先理解项目愿景，再按角色进入对应的方法论、架构契约与工程文档。
> 在线查阅：[文档中心](http://localhost:5000/docs)（服务运行时可用）。
> 根目录入口：[README.md](../README.md) · [ARCHITECTURE.md](../ARCHITECTURE.md) · [CONTRIBUTING.md](../CONTRIBUTING.md)

## 项目定位

**OpenBlock 是一套以方块益智为最小可玩内核的开源参考实现，把玩法、玩家画像、强化学习、商业化四件事写在同一份代码、同一组特征、同一根事件总线之下。**

它适合这样一类研发场景：难度需要按瞬时能力 + 跨局画像逐回合调控；变现需要按生命周期与成熟度做精细分群、而非按量级粗放投放；算法栈要与商业化共享同一份玩家事实；Web / Android / iOS / 微信小程序需要共用同一套玩法逻辑、特征向量与语言资源。

下面四张架构图分别从 **业务、产品、系统、算法** 四个视角展开同一份实现：业务视角看四支柱如何串起玩家旅程；产品视角看「挑战个人最佳」如何作为唯一主线被 5 层游戏化结构包裹、再按生命周期 × 成熟度差异化；系统视角看跨端、可观测、合规、安全如何被前置为架构默认值；算法视角看从信号采集到 RL 自博弈的六层工序如何共享同一组特征定义。

---

## 一、业务视角：四支柱共生于同一份玩家事实

> **写给经营决策者、业务负责人、产品总监**——
> 帮助你判断：这套体验生态可以解决什么样的业务问题？它如何把"玩家时长"沉淀为"经营成果"而不是单向损耗？

![OpenBlock 业务架构：四支柱 + 共享数据源 + 统一生态](./architecture/assets/business-architecture.png)

OpenBlock 的业务结构由 **四大产品支柱** 通过 **一份共享的玩家事实** 串成持续的正反馈闭环：

| 支柱 | 业务定位 |
|---|---|
| 🎮 **游戏引擎** | 留存与活跃的入口，承担玩家时长与社交延展 |
| 🧠 **自适应出块 AI** | 个性化体验中枢，让难度跟着每个玩家走 |
| 🤖 **强化学习训练** | 体验质量与算法迭代的科研闭环 |
| 💰 **商业化框架** | 把体验转化为可持续经营，且不损耗体验本身 |

**业务穿透性**：体验侧与商业侧共享**同一组玩家画像**（生命周期 S0–S4 × 成熟度 M0–M4），既输入到出块系统决定下一回合的难度，也输入到商业化分群决定下一次触达的内容与节奏。体验团队与增长团队据此读同一张玩家画像表，而非各自维护一套用户标签。

**经营回报**——决策层视角下的三项具体收益：

- **变现以画像触发**：广告频次、IAP 弹出、签到奖励按 25 格双轴策略矩阵当前格位决定；玩家在体验劣化时不会被叠加变现压力。
- **每一项 KPI 可回溯到 SQL 口径**：配置、事件、数据库表与运营看板字段逐项对齐，决策层与合规团队可独立复核。
- **换皮 / 换品类不重建数据中台**：玩家画像、商业化分群、训练栈在新品类里只需替换玩法逻辑与奖励规则即可复用。

详见 [生命周期与成熟度蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) 与 [商业化系统全景](./operations/MONETIZATION.md)。

---

## 二、产品视角：以「挑战个人最佳」为主线的 5 层游戏化结构

> **写给主策划、产品 / 玩法设计师**——
> 帮助你判断：这套产品如何把"刺激追逐 PB"与"不轻易超越 PB"调到一根弦上？外围系统如何在不抢戏的前提下补全长线动机？

![OpenBlock 产品架构：体验五轴 + 5 层游戏化结构 + 生命周期 × 成熟度 25 格 + 北极星闭环](./architecture/assets/product-architecture.png)

OpenBlock 的产品结构由 **一根核心主线 + 5 层游戏化结构 + 一张差异化矩阵 + 一组北极星指标** 组成：

| 结构 | 一句话定位 |
|---|---|
| 🎯 **核心主线** | 「挑战个人最佳分」是唯一可被全角色复述的玩法目标 |
| 🎮 **核心玩法层** | 短循环：观察棋盘 → 选块 → 拖拽 → 合法判断 → 消行 → 下一组三连块 |
| 🎛️ **体验调控层** | 多信号融合的实时难度调控、出块意图与节奏相位 |
| 🧭 **策略辅助层** | 给玩家可解释的策略卡、拓扑洞察、瓶颈识别、多消机会 |
| 🪜 **目标成长层** | 最佳分追赶 + 里程碑 + 段位 + 经验 / 等级 / 关卡 |
| 💖 **情感反馈层** | 多消 / 完美清台 / 近失提示 / 新纪录 / 震动 / 特效 / 叙事 |
| 🎪 **外围系统** | 任务 / 签到 / 赛季 / 通行证 / 技能 / 道具 / 宝箱 / 社交 / 异步 PK（可关闭、不抢戏） |
| 💰 **商业化边界** | 广告 / 内购 / 礼包；压力抑制期与心流期自动降低变现强度（可关闭、体验优先） |

**产品哲学**——四条与"行业默认做法"不同的具体选择：

- **核心主线唯一可复述**：所有外围系统的奖励都要回到"让我离 PB 更近一步"这一根叙事弦上；与之无关的玩法点收进归档而非主线。
- **难度按 25 格映射而非单一全局曲线**：新手保护与核心冲分在同一棋盘上得到完全不同的出块与节奏。
- **外围 / 商业化都可关闭**：任务、排行榜、皮肤、通行证、分享走"成就 / 自我表达"路径而非"付费阻断"；商业化在心流期与认知疲劳期自动降权。
- **北极星指标支撑「追逐 PB 而不轻易超越 PB」**：核心指标按"接近最佳率 / 高质量会话率 / 新纪录突破率 / 近失质量 / 突破来源结构 / 冲分抑制率"6 项组织，其中"接近最佳率"与"新纪录突破率"被设计为相互制衡，前者高且后者不爆表才证明产品调到了"足够想追、不轻易破"的甜区。

详见 [OpenBlock 产品架构图](./architecture/PRODUCT_ARCHITECTURE_DIAGRAMS.md) 与 [最佳分追逐策略](./player/BEST_SCORE_CHASE_STRATEGY.md)。

---

## 三、系统视角：边界清晰、契约先行的全栈一体

> **写给系统架构师与业务负责人**——
> 帮助你判断：这套架构能否承载业务的长期演进？在团队扩张、品类扩展、跨端发布、合规上线、技术债治理等环节，它能为业务提供怎样的运营杠杆？

![OpenBlock 全栈分层架构总览](./architecture/assets/architecture-overview.png)

系统按 **「容器 → 组件 → 事件 → 部署」** 四个粒度自顶向下展开，每一层都遵循同一条工程纪律：**边界由契约描述，不由心照不宣的默契描述**。

| 层 | 关键约束 |
|---|---|
| **容器层** | Web SPA / Flask 后端 / 移动端外壳 / 微信小程序 / 双训练栈五容器各自可独立部署，统一通过 REST + 事件契约通信 |
| **组件层** | 玩法引擎、玩家画像、自适应出块、商业化、留存、可观测各自严格单向依赖共享配置文件，禁止反向耦合 |
| **事件层** | 商业化与生命周期事件汇总到单一总线，事件全集与 payload 由契约文档兜底 |
| **部署层** | 单体起步、K8s 微服务 mesh 平滑收口；可观测、合规、安全自第一版即在仓库内 |

**该架构把以下典型运营摩擦点前置为架构默认值**：

- **跨端发布同频**：同一次玩法 / 皮肤 / 活动改动一份配置下发到四端，规避「同一规则在四端各写四遍、版本错位」。
- **单体起步、微服务收口**：起步阶段单台 Flask 即可承载；规模上量后按既定 K8s manifest 与 Helm chart 拆分，业务代码无需改动。
- **可观测、合规、安全自起步即在仓库内**：埋点、密码哈希、字段加密、JWT 旋转、隐私同意管理与数据导出 / 删除 SOP 自第一版即被布线，规避「上量后才补埋点 / 补合规」的版本债。

**契约先行带来的长线迭代回报**：新成员的入手路径是「读契约 → 改契约 → 提 PR」；品类扩展无需新搭基础设施；技术债以契约违反计票，新偏差在 PR 阶段被定位、不积累为后续版本的隐性回归。

详见 [系统架构图](./architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md) 与 [架构总览](../ARCHITECTURE.md)。

---

## 四、算法视角：六层工序串起从信号到训练的连续链路

> **写给算法架构师与业务负责人**——
> 帮助你判断：这套算法栈在合理性、领先性、高效率三个维度是否过硬？它能否真正支撑留存、ARPU、LTV 等业务核心指标的稳定改善？

![OpenBlock 算法架构总览：六层结构 + 七子模型 + 反馈闭环](./algorithms/assets/algorithm-architecture.png)

算法栈按 **六层** 组织，每层都对应一个具体子模型与一个明确的契约：

| 层 | 一句话作用 |
|---|---|
| 1. **信号采集** | 把玩家行为与盘面状态压缩为可建模的连续特征 |
| 2. **玩家画像** | 把"瞬时能力 / 跨局画像 / 商业价值"解耦但共存 |
| 3. **自适应决策** | 把多维信号融合成单一压力 + 出块意图，指挥下一回合出块 |
| 4. **内容生成** | 在硬约束下采样三连块，启发式与生成式双轨可切换 |
| 5. **强化学习** | 自博弈 + 蒸馏持续刷新策略上限，通过 API 接入在线推理 |
| 6. **训练监控** | 把"模型能不能用"提到与"模型有没有训"同等优先级 |

算法栈按**合理性、领先性、高效率**三项工程性保证组织：

- **合理性**——每条算法路径在手册中都有可被双向复核的依据：心流理论、近失效应、节奏张弛、首局保护、贝叶斯快速收敛、挫败检测等心理学命题逐一落到可调参面，调参时不必猜量纲。
- **领先性**——四模型（启发式、生成式、训练侧 RL、推理侧 RL）共享同一组特征定义，避免训-推漂移；跨局画像与局内能力分流为两条信号通路，避免相近指标错位代入；AlphaZero 风格搜索 + 蒸馏的改进路径不依赖外部 SaaS。
- **高效率**——策略级调优多数只需改一份共享配置即在四端生效；浏览器侧可独立完成推理与训练课程，本地开发不需要 GPU 集群；CI 与契约共同充当回归门禁，命名相近指标错位与跨端字段漂移在 PR 阶段即被拦截。

**业务指标到算法路径的可追溯映射**：留存改善由压力调制 + 生命周期 toast + 挫败救济兑现；ARPU / LTV 改善由 25 格双轴策略矩阵 + IAA-IAP 切换 + LTV 出价 + 触达节奏调度兑现；下一个增长点探索由 RL 自博弈与商业化 bandit 实验供给。

详见 [算法架构图](./algorithms/ALGORITHM_ARCHITECTURE_DIAGRAMS.md) 与 [算法与模型手册](./algorithms/ALGORITHMS_HANDBOOK.md)。

---

## 设计取舍：与行业默认做法不同的三处具体选择

上节四张架构图说明"它由什么构成"。本节列出三处**非默认选择**及其代价与回报，便于读者判断这些取舍是否适合自己的项目。

- **产品层 — 把心流 / 挫败 / 节奏 / 爽感落到具体特征通路**：四类体验感受不再是策划文档里的关键词，而是各自落到独立的可调参面。代价是策划写"我希望玩家此处产生什么体验"时需先选一条已有通路或显式新增一条；回报是体验需求可在 PR 评审中被双向校验，避免"调了几次手感都说不清原因"的反复迭代。详见 [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md)。
- **算法层 — 四模型强制共享同一组特征定义**：启发式、生成式、训练侧 RL、推理侧 RL 四个模型共享同一份特征向量与配置事实源。代价是新增任何一个算法都必须先扩展共享特征再做模型本身；回报是消除 ML 项目最常见的训-推漂移，命名相近指标不会被无意识代入彼此位置。详见 [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md)。
- **架构层 — 跨端走"单核多端 + 配置事实源单一"**：Web 为唯一玩法实现，其它三端经契约同步玩法逻辑、特征向量与语言资源。代价是需要维护跨端同步脚本与契约文档；回报是跨端发布天然同频，任一端事故可由其它三端的契约比对快速定位偏差。详见 [四端同步契约](./platform/SYNC_CONTRACT.md)。

---

## 面向四类核心读者的阅读建议

| 角色 | 它对你的价值 | 推荐起点 |
|---|---|---|
| **经营决策层 / 商业化** | 把"玩家画像 → 体验调控 → 商业化触达 → 经营 KPI"完整闭环开放出来，让经营策略与体验策略第一次共享同一组事实 | [生命周期与成熟度蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) → [商业化系统全景](./operations/MONETIZATION.md) |
| **游戏策划 / 体验设计** | 一套把"心流、挫败、节奏、爽感"翻译为可调参面与心理学根据的工程语言，让设计意图能落到代码而不是停留在脑海 | [OpenBlock 产品架构图](./architecture/PRODUCT_ARCHITECTURE_DIAGRAMS.md) → [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md) → [自适应出块](./algorithms/ADAPTIVE_SPAWN.md) |
| **算法 / ML 工程师** | 启发式、生成式、强化学习三栈共存且共享特征定义的工程模板，把"算法漂移"与"训-推不一致"作为可被预防的工程问题处理 | [算法与模型手册](./algorithms/ALGORITHMS_HANDBOOK.md) → [RL 算法手册](./algorithms/ALGORITHMS_RL.md) |
| **架构 / 平台工程师** | Web 核心 + 跨端真共享的单核多端架构，把"四端各写一份"的常见困境转化为一份契约管理问题 | [架构总览](../ARCHITECTURE.md) → [二次开发指南](./engineering/DEV_GUIDE.md) → [四端同步契约](./platform/SYNC_CONTRACT.md) |

---

## 如何阅读

文档中心按三层组织，跨领域文档只保留一个权威位置，在其他章节通过链接引用；阶段性 sprint 文档收敛在 `docs/archive/`：

1. **领域知识**：为什么要这样设计
2. **方法论与算法**：如何建模
3. **工程框架**：如何落地

### 目录结构

```text
docs/
├── README.md          # 文档中心总入口（本页）
├── algorithms/        # 出块、RL、玩家模型、商业化模型等算法手册
├── architecture/      # 跨模块架构契约（事件总线、生命周期分层）
├── archive/           # 已归档的历史方案与早期 sprint 文档
├── domain/            # 领域知识、品类研究、竞品与架构对比
├── engineering/       # 工程指南、测试、i18n、性能、Cursor Skills
├── integrations/      # 广告 / IAP / 企业 API 接入
├── operations/        # 商业化、运营、训练面板、运维与合规
├── platform/          # Android / iOS 客户端、小程序适配、四端同步
├── player/            # 玩家画像、面板参数、实时策略、玩法风格
└── product/           # 玩法、难度、计分、留存、皮肤、惊喜系统
```

## 角色导航

| 角色 | 先读 | 再读 |
|------|------|------|
| 产品 / 玩法策划 | [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md) → [领域知识](./domain/DOMAIN_KNOWLEDGE.md) → [休闲游戏品类分析](./domain/CASUAL_GAME_ANALYSIS.md) | [难度模式](./product/DIFFICULTY_MODES.md) → [彩蛋与惊喜](./product/EASTER_EGGS_AND_DELIGHT.md) → [策略定制指南](./engineering/STRATEGY_GUIDE.md) |
| 主策划 / 策略设计师 | [OpenBlock 产品架构图](./architecture/PRODUCT_ARCHITECTURE_DIAGRAMS.md) → [最佳分追逐策略](./player/BEST_SCORE_CHASE_STRATEGY.md) → [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md) | [策略体验栈](./player/STRATEGY_EXPERIENCE_MODEL.md) → [实时策略系统](./player/REALTIME_STRATEGY.md) → [生命周期与成熟度蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) |
| 算法工程师 | [算法架构图](./algorithms/ALGORITHM_ARCHITECTURE_DIAGRAMS.md) → [算法与模型手册](./algorithms/ALGORITHMS_HANDBOOK.md) → [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md) | [出块算法手册](./algorithms/ALGORITHMS_SPAWN.md) → [玩家画像算法](./algorithms/ALGORITHMS_PLAYER_MODEL.md) → [RL 手册](./algorithms/ALGORITHMS_RL.md) → [商业化模型架构设计](./algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md) |
| 架构 / 平台工程师 | [架构总览](../ARCHITECTURE.md) → [技术总览](./engineering/PROJECT.md) | [二次开发指南](./engineering/DEV_GUIDE.md) → [Android / iOS 客户端外壳](./platform/MOBILE_CLIENTS.md) → [微信小程序适配](./platform/WECHAT_MINIPROGRAM.md) → [四端同步契约](./platform/SYNC_CONTRACT.md) |
| 运营 / 商业化 | [商业化系统全景](./operations/MONETIZATION.md) → [生命周期与成熟度蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | [商业化算法](./algorithms/ALGORITHMS_MONETIZATION.md) → [训练面板](./operations/MONETIZATION_TRAINING_PANEL.md) → [能力对照表](./operations/COMMERCIAL_IMPROVEMENTS_CHECKLIST.md) |
| 测试 / QA | [测试指南](./engineering/TESTING.md) | [RL 数值稳定](./algorithms/RL_TRAINING_NUMERICAL_STABILITY.md) → [训练看板趋势](./algorithms/RL_TRAINING_DASHBOARD_TRENDS.md) |
| 开源贡献者 | [README](../README.md) → [贡献指南](../CONTRIBUTING.md) | [二次开发指南](./engineering/DEV_GUIDE.md) → 本页"文档维护规范" |
| AI 辅助开发 | [Cursor Skills 索引](./engineering/CURSOR_SKILLS.md) | [休闲游戏构建 Skill](./engineering/CASUAL_GAME_BUILD_SKILL.md) → [ARCHITECTURE](../ARCHITECTURE.md) → [TESTING](./engineering/TESTING.md) |

## 权威文档地图

### 项目与架构

| 文档 | 何时阅读 |
|------|----------|
| [README](../README.md) | 第一次了解项目、安装与快速启动 |
| [ARCHITECTURE](../ARCHITECTURE.md) | 理解系统边界、模块关系、核心数据流 |
| [技术总览](./engineering/PROJECT.md) | 快速定位前端 / 后端 / RL / 商业化模块 |
| [二次开发指南](./engineering/DEV_GUIDE.md) | 新增模块、接入 SDK、扩展 API |
| [i18n](./engineering/I18N.md) | 修改文案、语言包、RTL 支持 |
| [测试指南](./engineering/TESTING.md) | 提交前验证、写测试、排查回归 |
| [SQLite 数据库模式](./engineering/SQLITE_SCHEMA.md) | 表字段、用途、API 映射 |
| [黄金事件字典](./engineering/GOLDEN_EVENTS.md) | 事件命名与版本约定 |
| [Canvas 转换索引](./engineering/CANVAS_ARTIFACTS.md) | 已从 Cursor Canvas 转换为 Markdown 的文档入口 |
| [Cursor Skills 索引](./engineering/CURSOR_SKILLS.md) | 仓库内 Project Skills、个人可选 Skill、维护约定 |
| [休闲游戏构建 Skill](./engineering/CASUAL_GAME_BUILD_SKILL.md) | 从核心循环到商业化与 CI 的阶段化清单 |
| [性能优化说明](./engineering/PERFORMANCE.md) | 绘制合并、懒加载 chunk、可见性定时器 |

### 跨模块架构契约

| 文档 | 核心问题 |
|------|----------|
| [OpenBlock 产品架构图](./architecture/PRODUCT_ARCHITECTURE_DIAGRAMS.md) | 核心主线（PB 追逐）+ 5 层游戏化结构 + 生命周期 × 成熟度 25 格 + 外围 / 商业化边界 + 北极星指标 |
| [系统架构图](./architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md) | 业务四支柱 / 容器 / 组件 / 事件总线 / 双轨算法 / 后端路由 / 部署拓扑 |
| [算法架构图](./algorithms/ALGORITHM_ARCHITECTURE_DIAGRAMS.md) | 六层结构 + 七子模型 + 反馈闭环 |
| [MonetizationBus 事件契约](./architecture/MONETIZATION_EVENT_BUS_CONTRACT.md) | 商业化 / 生命周期 / 广告事件全集、payload、订阅方 |
| [生命周期数据→策略分层](./architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md) | 数据层 + 编排层 + 策略层三段式架构与单向依赖约束 |
| [架构图生成 Prompt（系统侧）](./architecture/ARCHITECTURE_DIAGRAM_PROMPT.md) | 重生成系统架构图的可复用 prompt 模板 |
| [架构图生成 Prompt（算法侧）](./algorithms/ALGORITHM_DIAGRAM_PROMPT.md) | 重生成算法架构图的可复用 prompt 模板 |

### 领域知识与产品方法论

| 文档 | 核心问题 |
|------|----------|
| [领域知识](./domain/DOMAIN_KNOWLEDGE.md) | 方块益智、心流、挫败、RL、商业化的基础概念 |
| [休闲游戏品类分析](./domain/CASUAL_GAME_ANALYSIS.md) | 竞品、能力模型、体验缺口、系统机会 |
| [全球休闲游戏个性化策略与调研](./domain/GLOBAL_CASUAL_GAME_RESEARCH.md) | 全球市场、地区文化、人口学分层、个性化边界 |
| [竞品与用户分析](./domain/COMPETITOR_USER_ANALYSIS.md) | 目标用户、竞品机制、差异化方向 |
| [架构对比](./domain/ARCHITECTURE_COMPARISON.md) | 不同实现路线的取舍 |

### 玩法、难度与玩家系统

| 文档 | 核心问题 |
|------|----------|
| [难度模式](./product/DIFFICULTY_MODES.md) | Easy / Normal / Hard 与自适应难度如何协作 |
| [消行计分](./product/CLEAR_SCORING.md) | 计分公式、多消、同色 / 同 icon bonus |
| [玩家能力评估接入说明](./player/PLAYER_ABILITY_EVALUATION.md) | 玩家能力输出如何被产品和策略消费 |
| [玩家面板参数](./player/PANEL_PARAMETERS.md) | UI 指标含义、异常解读、调参提示 |
| [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md) | 顶层方法论：心理学根基 + 5 轴体验结构 + 设计审查清单 |
| [实时策略系统](./player/REALTIME_STRATEGY.md) | 指标字典、压力体系、四级管线、策略卡生成 |
| [策略体验栈](./player/STRATEGY_EXPERIENCE_MODEL.md) | 通用四层模型、单一意图、几何门控、叙事职责分离 |
| [最佳分追逐策略](./player/BEST_SCORE_CHASE_STRATEGY.md) | 主策划契约：以"挑战自我最佳分"为核心主线的策略事实清单与四维差异化矩阵 |
| [玩法风格检测](./player/PLAYSTYLE_DETECTION.md) | 玩家风格识别与策略微调 |

### 出块算法与建模

| 文档 | 核心问题 |
|------|----------|
| [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md) | 启发式出块 / 生成式出块 / PyTorch RL / 浏览器 RL 的设计与损失 |
| [模型工程总览](./algorithms/MODEL_ENGINEERING_GUIDE.md) | 把全部模型放在同一张工程地图，统一假设、特征、网络与训练流程 |
| [出块算法手册](./algorithms/ALGORITHMS_SPAWN.md) | 规则 + SpawnTransformer 的形式化与训练 / 推理 |
| [出块三层架构](./algorithms/SPAWN_ALGORITHM.md) | 三层结构、5 阶段流水线、策略 → 出块翻译机制 |
| [自适应出块](./algorithms/ADAPTIVE_SPAWN.md) | 多信号压力、心流、爽感兑现、spawnHints |
| [候选块概率图鉴](./algorithms/CANDIDATE_BLOCKS_PROBABILITY_ATLAS.md) | 28 个候选块、类别权重、基础概率、难度档位 |
| [出块建模](./algorithms/SPAWN_BLOCK_MODELING.md) | 规则引擎与 ML 出块模型的设计 rationale |
| [解法数量难度](./algorithms/SPAWN_SOLUTION_DIFFICULTY.md) | 解空间计数、区间软过滤、顺序刚性 |

### 强化学习

| 文档 | 核心问题 |
|------|----------|
| [RL 文档导航](./algorithms/RL_README.md) | RL 栏目的权威手册、专题补充和历史实验如何阅读 |
| [RL 算法手册](./algorithms/ALGORITHMS_RL.md) | PPO / GAE、网络结构、奖励、探索、推理 API 的权威事实 |
| [玩法与 RL 解耦](./algorithms/RL_AND_GAMEPLAY.md) | 真人玩法、训练环境、共享配置和特征维度边界 |
| [PyTorch RL 服务与评估](./algorithms/RL_PYTORCH_SERVICE.md) | 在线 RL API、离线训练、search replay 和贪心评估 |
| [RL 训练数值稳定](./algorithms/RL_TRAINING_NUMERICAL_STABILITY.md) | 训练时的梯度 / 数值稳定与排障 |
| [RL 看板数据流与刷新机制](./algorithms/RL_TRAINING_DASHBOARD_FLOW.md) | RL 看板的数据来源、刷新机制和自检方法 |
| [RL 看板趋势解读](./algorithms/RL_TRAINING_DASHBOARD_TRENDS.md) | 关键曲线、趋势解读 |
| [RL AlphaZero 优化方案](./algorithms/RL_ALPHAZERO_OPTIMIZATION.md) | AlphaZero 风格搜索 + 蒸馏在 OpenBlock 的适配方案 |
| [RL 自博弈文献对照](./algorithms/RL_SELF_PLAY_LITERATURE_COMPARISON.md) | AlphaZero / MuZero / Expert Iteration / Gumbel AlphaZero 等路线对比 |
| [RL 复杂度与瓶颈研究](./algorithms/RL_ANALYSIS.md) | RL 任务复杂度、模型与优化候选池研究专题 |

历史 sprint 分析（平台期诊断、训练优化清单、浏览器优化、自博弈路线图）收敛到 [`docs/archive/algorithms/`](./archive/algorithms/)。

### 外部实证锚点（学术对照）

| 来源 | 与 OpenBlock 的对位 | 在本仓库的落地引用 |
|------|---------------------|--------------------|
| [Wang C-J. et al., *Evaluating Game Difficulty in Tetris Block Puzzle*, arXiv:2603.18994](https://arxiv.org/pdf/2603.18994)（NYCU × Academia Sinica，2026） | 8×8 网格 + `dock` + 无旋转 + 消行得分，与 OpenBlock 几乎同款；用 Stochastic Gumbel AlphaZero 实证规则杠杆的难度强度排序：`dock` > 形状库 > `shapeWeights` > 预览数 | [自适应出块 §10.6](./algorithms/ADAPTIVE_SPAWN.md#106-外部实证基线sgaz--tetris-block-puzzlev15517)、[出块三层架构 §2.6](./algorithms/SPAWN_ALGORITHM.md#26-难度调控杠杆层级基于-sgaz-实证--v15517)、[最佳分追逐策略 §5.z](./player/BEST_SCORE_CHASE_STRATEGY.md#5z-基于-sgaz-实证的规则层调控未来方向v15517) |

> **如何使用外部锚点**：本仓库 `shapeWeights` 调控参数（`LIFECYCLE_STRESS_CAP_MAP`、`difficultyTuning.minStress`、17 个 stress 分量等）多为经验设置；外部实证锚点用于提供"客观难度坐标"——OpenBlock 默认配置 = 论文 classic `h=3, p=0` baseline（SGAZ 接近通关），意味着当前所有 stress 调控空间均处于一个**强 AI 已摸顶的难度边界内**。未来若需更强难度（如 PB 冲刺）应考虑规则层杠杆（`dock` / 形状库）而非继续叠加 stress 分量。

### 商业化与运营

| 文档 | 核心问题 |
|------|----------|
| [商业化系统全景](./operations/MONETIZATION.md) | IAA / IAP、分群、触发、API、模块全景 |
| [商业化系统综合报告](./operations/COMMERCIAL_STRATEGY_REVIEW.md) | 模块拓扑、关键能力、KPI 监控点 |
| [生命周期与成熟度蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | 双轴（S0–S4 × M0–M4）、双分制成熟度、能力与运营接入点 |
| [运营看板指标审计](./operations/OPS_DASHBOARD_METRICS_AUDIT.md) | 运营看板指标接库、SQL 口径、截图复核 |
| [商业化算法手册](./algorithms/ALGORITHMS_MONETIZATION.md) | 鲸鱼分、规则引擎、LTV、CPI 出价 |
| [商业化模型架构设计](./algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md) | snapshot / 校准 / MTL / 漂移 / bandit / 决策包装 |
| [商业化定制](./operations/MONETIZATION_CUSTOMIZATION.md) | 接入真实广告 / IAP SDK、规则扩展 |
| [商业化训练面板](./operations/MONETIZATION_TRAINING_PANEL.md) | 训练面板字段、界面与调试 |
| [Block Blast 商业化运营指南](./platform/MONETIZATION_GUIDE.md) | 跨平台 PWA / 广告 / IAP / 签到 / 分享配置 |
| [商业运营参考分析](./operations/COMMERCIAL_OPERATIONS.md) | 运营机会池与策略参考 |
| [商业化与企业能力对照表](./operations/COMMERCIAL_IMPROVEMENTS_CHECKLIST.md) | 各项能力的实现状态、外部依赖与规划项 |
| [合规与运维 SOP](./operations/COMPLIANCE_AND_SOPS.md) | 隐私、同意管理、数据导出 / 删除、敏感字段掩码 |

### 运维与部署

| 文档 | 何时阅读 |
|------|----------|
| [部署指南](./operations/DEPLOYMENT.md) | 单体 / 微服务 mesh 上线、备份恢复 Runbook |
| [Kubernetes 部署](./operations/K8S_DEPLOYMENT.md) | K8s manifest、Helm chart、HPA |
| [可观测性](./operations/OBSERVABILITY.md) | Prometheus + OpenTelemetry 接入 |
| [安全加固](./operations/SECURITY_HARDENING.md) | Argon2id、Fernet、JWT 旋转、Redis RateLimit |

### 外部集成

| 文档 | 何时阅读 |
|------|----------|
| [广告与 IAP 接入清单](./integrations/ADS_IAP_SETUP.md) | 接入 AdMob / AppLovin / Stripe / 微信 IAP 的标准步骤 |
| [企业扩展 API](./integrations/ENTERPRISE_EXTENSIONS.md) | 企业扩展、远程配置、策略注册、支付 / 广告占位 |

### 平台、视觉与内容系统

| 文档 | 核心问题 |
|------|----------|
| [Android / iOS 客户端外壳](./platform/MOBILE_CLIENTS.md) | Capacitor WebView 壳、构建同步、真机 API、离线边界 |
| [微信小程序适配](./platform/WECHAT_MINIPROGRAM.md) | Web → 小程序同步、适配层、能力边界 |
| [微信发布流程](./platform/WECHAT_RELEASE.md) | 提审、上线、回滚、运维清单 |
| [四端同步契约](./platform/SYNC_CONTRACT.md) | Web / 小程序 / Android / iOS 的规则、构建和 API 对齐 |
| [皮肤目录](./product/SKINS_CATALOG.md) | 皮肤分类、渲染管线、icon 唯一性 |
| [皮肤语义池](./product/SKIN_ICON_SEMANTIC_POOL.md) | emoji 语义、主题映射、唯一性约束 |
| [彩蛋与惊喜](./product/EASTER_EGGS_AND_DELIGHT.md) | 音效、触觉、皮肤、奖励、彩蛋系统 |
| [宝箱与钱包](./product/CHEST_AND_WALLET.md) | 局末 / 赛季宝箱入账顺序与每日 cap 绕过 |

### 归档

| 文档 | 定位 |
|------|------|
| [archive/algorithms/](./archive/algorithms/) | RL 平台期诊断、训练优化清单、浏览器优化、自博弈路线图等 sprint 分析 |
| [archive/product/](./archive/product/) | 留存路线图、彩蛋路线图等阶段性 sprint 文档 |
| [archive/MONETIZATION_OPTIMIZATION.md](./archive/MONETIZATION_OPTIMIZATION.md) | 早期商业化路径研究 |
| [archive/MONETIZATION_PERSONALIZATION.md](./archive/MONETIZATION_PERSONALIZATION.md) | 早期个性化引擎设计 |

归档文档保留用于理解演进背景，**不作为当前实现事实来源**。

---

## 文档维护规范

1. **代码事实优先**：文档描述必须能追到文件、配置或测试；不确定内容标记为"假设 / 待验证"。
2. **一页一个职责**：领域知识讲"为什么"，算法手册讲"怎么建模"，工程文档讲"怎么改"，测试文档讲"怎么证明"。
3. **不写中间态**：主线文档不使用"sprint 节奏"语言；这类内容进 CHANGELOG 或 archive。
4. **变更同步**：改共享配置、出块、玩家画像、RL 特征、商业化规则时，同步更新对应手册和本索引。
5. **保留归档语义**：历史方案不要混入当前事实；归档文档保留背景与取舍，当前实现以权威文档为准。
6. **面向开源审阅**：新增文档应包含适用角色、代码入口、配置入口、验证方式和已知边界。
