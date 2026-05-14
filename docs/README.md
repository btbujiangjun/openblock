# OpenBlock 文档中心

> 面向开源协作的统一入口：先理解领域与方法论，再进入架构、算法、工程实现和测试验证。
> 在线查阅：[文档中心](http://localhost:5000/docs)（服务运行时可用）。
> 根目录入口：[README.md](../README.md) · [ARCHITECTURE.md](../ARCHITECTURE.md) · [CONTRIBUTING.md](../CONTRIBUTING.md)

## 如何阅读

OpenBlock 不是单一小游戏代码库，而是一个 **休闲益智玩法 + 自适应出块 + 玩家画像 +
强化学习 + 商业化实验** 的开源研究与工程平台。文档中心按三层组织：

1. **领域知识**：为什么要这样设计（休闲游戏心理、心流、挫败、留存、变现、品类研究）
2. **方法论与算法**：如何建模（出块、玩家画像、RL、商业化推断、计分与难度）
3. **工程框架**：如何落地（前后端架构、扩展点、配置、平台适配、验证流程）

跨领域文档只保留一个权威位置，在其他章节通过链接引用；阶段性 sprint 文档收敛在
`docs/archive/`。

## 目录结构

```text
docs/
├── README.md          # 文档中心总入口
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

| 角色 | 先读 | 再读 | 目标 |
|------|------|------|------|
| 产品 / 玩法策划 | [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md) → [领域知识](./domain/DOMAIN_KNOWLEDGE.md) → [休闲游戏品类分析](./domain/CASUAL_GAME_ANALYSIS.md) | [难度模式](./product/DIFFICULTY_MODES.md) → [彩蛋与惊喜](./product/EASTER_EGGS_AND_DELIGHT.md) → [策略定制指南](./engineering/STRATEGY_GUIDE.md) | 理解体验曲线、心流、奖励节奏与玩法可调面 |
| 算法工程师 | [算法与模型手册](./algorithms/ALGORITHMS_HANDBOOK.md) → [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md) | [出块算法手册](./algorithms/ALGORITHMS_SPAWN.md) → [玩家画像算法](./algorithms/ALGORITHMS_PLAYER_MODEL.md) → [RL 手册](./algorithms/ALGORITHMS_RL.md) → [商业化模型架构设计](./algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md) | 统一符号、公式、模型结构、训练 / 推理链路 |
| 架构 / 平台工程师 | [架构总览](../ARCHITECTURE.md) → [技术总览](./engineering/PROJECT.md) | [二次开发指南](./engineering/DEV_GUIDE.md) → [Android / iOS 客户端外壳](./platform/MOBILE_CLIENTS.md) → [微信小程序适配](./platform/WECHAT_MINIPROGRAM.md) → [四端同步契约](./platform/SYNC_CONTRACT.md) | 理解模块边界、数据流、扩展接口与跨端同步 |
| 运营 / 商业化 | [商业化系统全景](./operations/MONETIZATION.md) → [商业化系统综合报告](./operations/COMMERCIAL_STRATEGY_REVIEW.md) → [生命周期与成熟度蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | [商业化算法](./algorithms/ALGORITHMS_MONETIZATION.md) → [训练面板](./operations/MONETIZATION_TRAINING_PANEL.md) → [能力对照表](./operations/COMMERCIAL_IMPROVEMENTS_CHECKLIST.md) | 理解分群、触发策略、运营面板、KPI 与企业落地项 |
| 测试 / QA | [测试指南](./engineering/TESTING.md) | [PROJECT 测试章节](./engineering/PROJECT.md#测试) → [RL 数值稳定](./algorithms/RL_TRAINING_NUMERICAL_STABILITY.md) → [训练看板趋势](./algorithms/RL_TRAINING_DASHBOARD_TRENDS.md) | 建立功能 / 算法 / 回归 / 数据一致性验证清单 |
| 开源贡献者 | [README](../README.md) → [贡献指南](../CONTRIBUTING.md) | [二次开发指南](./engineering/DEV_GUIDE.md) → 本页"文档维护规范" | 快速跑起来、找到任务边界、提交可审查改动 |
| AI 辅助开发 | [Cursor Skills 索引](./engineering/CURSOR_SKILLS.md) | [休闲游戏构建 Skill](./engineering/CASUAL_GAME_BUILD_SKILL.md) → [ARCHITECTURE](../ARCHITECTURE.md) → [TESTING](./engineering/TESTING.md) | 选用 Project / Personal Skills |

## 权威文档地图

### 项目与架构

| 文档 | 何时阅读 | 维护定位 |
|------|----------|----------|
| [README](../README.md) | 第一次了解项目、安装与快速启动 | 项目门面，保持短而稳定 |
| [ARCHITECTURE](../ARCHITECTURE.md) | 理解系统边界、模块关系、核心数据流 | 架构事实来源 |
| [技术总览](./engineering/PROJECT.md) | 快速定位前端 / 后端 / RL / 商业化模块 | 工程地图 |
| [二次开发指南](./engineering/DEV_GUIDE.md) | 新增模块、接入 SDK、扩展 API | 开发流程与扩展约定 |
| [i18n](./engineering/I18N.md) | 修改文案、语言包、RTL 支持 | 国际化规范 |
| [测试指南](./engineering/TESTING.md) | 提交前验证、写测试、排查回归 | 质量门禁 |
| [SQLite 数据库模式](./engineering/SQLITE_SCHEMA.md) | 表字段、用途、`/api` 映射 | 后端、数据、运维 |
| [黄金事件字典](./engineering/GOLDEN_EVENTS.md) | `GAME_EVENTS` / behaviors 命名与版本约定 | 数据、商业化、测试 |
| [Canvas 转换索引](./engineering/CANVAS_ARTIFACTS.md) | 已从 Cursor Canvas 转换为 Markdown 的文档入口 | 产品、算法、运营、AI 协作 |
| [Cursor Skills 索引](./engineering/CURSOR_SKILLS.md) | 仓库内 Project Skills、个人可选 Skill、维护约定 | AI 协作、贡献者 |
| [休闲游戏构建 Skill](./engineering/CASUAL_GAME_BUILD_SKILL.md) | 从核心循环到商业化与 CI 的阶段化清单 | 架构、全栈、AI 协作 |
| [性能优化说明](./engineering/PERFORMANCE.md) | rAF 合并绘制、懒加载 chunk、可见性定时器 | 前端、架构 |

### 跨模块架构契约

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [系统架构图（6 张 Mermaid）](./architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md) | 容器 / 组件 / 事件总线 / 双轨算法 / 后端路由 / 部署拓扑 | 全角色 |
| [MonetizationBus 事件契约](./architecture/MONETIZATION_EVENT_BUS_CONTRACT.md) | 商业化 / 生命周期 / 广告事件全集、payload、订阅方 | 架构、商业化、广告 |
| [生命周期数据→策略分层](./architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md) | 数据层 + 编排层 + 策略层三段式架构与单向依赖约束 | 架构、商业化、留存 |
| [架构图生成 Prompt](./architecture/ARCHITECTURE_DIAGRAM_PROMPT.md) | 重生成系统架构图的可复用 prompt 模板与事实包 | 架构、AI 协作 |

### 领域知识与产品方法论

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [领域知识](./domain/DOMAIN_KNOWLEDGE.md) | 方块益智、心流、挫败、RL、商业化的基础概念 | 全角色 |
| [休闲游戏品类分析](./domain/CASUAL_GAME_ANALYSIS.md) | 竞品、能力模型、体验缺口、系统机会 | 产品、运营、算法 |
| [全球休闲游戏个性化策略与调研](./domain/GLOBAL_CASUAL_GAME_RESEARCH.md) | 全球市场、地区文化、人口学分层、个性化边界 | 产品、运营、合规、算法 |
| [竞品与用户分析](./domain/COMPETITOR_USER_ANALYSIS.md) | 目标用户、竞品机制、差异化方向 | 产品、运营 |
| [架构对比](./domain/ARCHITECTURE_COMPARISON.md) | 不同实现路线的取舍 | 架构、技术负责人 |

### 玩法、难度与玩家系统

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [难度模式](./product/DIFFICULTY_MODES.md) | Easy / Normal / Hard 与自适应难度如何协作 | 产品、算法、测试 |
| [消行计分](./product/CLEAR_SCORING.md) | `baseUnit * c²`、多消、同色 / 同 icon bonus | 产品、算法、测试 |
| [玩家能力评估接入说明](./player/PLAYER_ABILITY_EVALUATION.md) | 玩家能力输出如何被产品和策略消费 | 产品、运营、测试 |
| [玩家面板参数](./player/PANEL_PARAMETERS.md) | UI 指标含义、异常解读、调参提示 | 产品、运营、测试 |
| [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md) | 顶层方法论：心理学根基 + 5 轴体验结构 + 设计审查清单 | 产品、设计、算法、架构、测试 |
| [实时策略系统](./player/REALTIME_STRATEGY.md) | 指标字典、压力体系、L1–L4 管线、策略卡生成 | 产品、算法、架构、测试 |
| [策略体验栈](./player/STRATEGY_EXPERIENCE_MODEL.md) | 通用四层模型、单一意图、几何门控、叙事职责分离 | 产品、算法、架构、测试 |
| [玩法风格检测](./player/PLAYSTYLE_DETECTION.md) | 玩家风格识别与策略微调 | 产品、算法 |

### 出块算法与建模

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md) | 启发式出块 / 生成式出块 / PyTorch RL / 浏览器 RL 的设计与损失 | 算法、架构、测试 |
| [模型工程总览](./algorithms/MODEL_ENGINEERING_GUIDE.md) | 把全部模型放在同一张工程地图，统一假设、特征、网络与训练流程 | 算法、架构 |
| [出块算法手册](./algorithms/ALGORITHMS_SPAWN.md) | 规则 + SpawnTransformer 的形式化与训练 / 推理 | 算法 |
| [出块三层架构](./algorithms/SPAWN_ALGORITHM.md) | Layer 1/2/3 如何从盘面到体验生成三连块 | 算法、架构、测试 |
| [自适应出块](./algorithms/ADAPTIVE_SPAWN.md) | 多信号 stress、心流、爽感兑现、spawnHints | 产品、算法 |
| [候选块概率图鉴](./algorithms/CANDIDATE_BLOCKS_PROBABILITY_ATLAS.md) | 28 个候选块、类别权重、基础概率、难度档位 | 产品、算法、测试 |
| [出块建模](./algorithms/SPAWN_BLOCK_MODELING.md) | 规则引擎与 ML 出块模型的设计 rationale | 算法、架构 |
| [解法数量难度](./algorithms/SPAWN_SOLUTION_DIFFICULTY.md) | DFS 解空间计数、`solutionCount` 区间软过滤、`orderRigor` 顺序刚性 | 算法、测试 |

### 强化学习

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [RL 文档导航](./algorithms/RL_README.md) | RL 栏目的权威手册、专题补充和历史实验如何阅读 | 算法、后端、测试 |
| [RL 算法手册](./algorithms/ALGORITHMS_RL.md) | PPO / GAE、网络结构、奖励、探索、推理 API 的权威事实 | 算法 |
| [玩法与 RL 解耦](./algorithms/RL_AND_GAMEPLAY.md) | 真人玩法、训练环境、共享配置和特征维度边界 | 算法、架构 |
| [PyTorch RL 服务与评估](./algorithms/RL_PYTORCH_SERVICE.md) | 在线 `/api/rl`、离线训练、search replay 和贪心评估 | 算法、后端 |
| [RL 训练数值稳定](./algorithms/RL_TRAINING_NUMERICAL_STABILITY.md) | 训练时的梯度 / 数值稳定与排障 | 算法 |
| [RL 看板数据流与刷新机制](./algorithms/RL_TRAINING_DASHBOARD_FLOW.md) | RL 看板的数据来源、刷新机制和自检方法 | 算法、测试 |
| [RL 看板趋势解读](./algorithms/RL_TRAINING_DASHBOARD_TRENDS.md) | 关键曲线、趋势解读 | 算法 |
| [RL AlphaZero 优化方案](./algorithms/RL_ALPHAZERO_OPTIMIZATION.md) | AlphaZero 风格搜索 + 蒸馏在 OpenBlock 的适配方案 | 算法 |
| [RL 自博弈文献对照](./algorithms/RL_SELF_PLAY_LITERATURE_COMPARISON.md) | AlphaZero / MuZero / Expert Iteration / Gumbel AlphaZero 等路线对比 | 算法 |
| [RL 复杂度与瓶颈研究](./algorithms/RL_ANALYSIS.md) | RL 任务复杂度、模型与优化候选池研究专题 | 算法 |

历史 sprint 分析（v9.x 平台期诊断、训练优化清单、浏览器优化、自博弈路线图）已收敛到
[`docs/archive/algorithms/`](./archive/algorithms/)。

### 商业化与运营

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [商业化系统全景](./operations/MONETIZATION.md) | IAA / IAP、分群、触发、API、模块全景 | 运营、产品、架构 |
| [商业化系统综合报告](./operations/COMMERCIAL_STRATEGY_REVIEW.md) | 模块拓扑、关键能力、KPI 监控点 | 运营、产品、架构 |
| [生命周期与成熟度蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | 双轴（S0–S4 × M0–M4）、双分制成熟度、能力与运营接入点 | 运营、产品、算法、客户端 |
| [运营看板指标审计](./operations/OPS_DASHBOARD_METRICS_AUDIT.md) | `/ops` 指标接库、SQL 口径、截图复核 | 运营、产品、数据、后端 |
| [商业化算法手册](./algorithms/ALGORITHMS_MONETIZATION.md) | 鲸鱼分、规则引擎、LTV、CPI 出价；§15 算法层扩展模块索引 | 算法、运营 |
| [商业化模型架构设计](./algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md) | snapshot / 校准 / MTL / 漂移 / bandit / 决策包装 | 算法、商业化 |
| [商业化定制](./operations/MONETIZATION_CUSTOMIZATION.md) | 接入真实广告 / IAP SDK、规则扩展 | 架构、运营 |
| [商业化训练面板](./operations/MONETIZATION_TRAINING_PANEL.md) | MonPanel 字段、界面与调试 | 运营、产品 |
| [Block Blast 商业化运营指南](./platform/MONETIZATION_GUIDE.md) | 跨平台 PWA / 广告 / IAP / 签到 / 分享配置 | 运营、平台 |
| [商业运营参考分析](./operations/COMMERCIAL_OPERATIONS.md) | 运营机会池与策略参考 | 运营 |
| [商业化与企业能力对照表](./operations/COMMERCIAL_IMPROVEMENTS_CHECKLIST.md) | 各项能力的实现状态、外部依赖与规划项 | 运营、产品、集成 |
| [合规与运维 SOP](./operations/COMPLIANCE_AND_SOPS.md) | 隐私、同意管理、数据导出 / 删除、敏感字段掩码 | 运营、合规、后端 |

### 运维与部署

| 文档 | 何时阅读 | 维护定位 |
|------|----------|----------|
| [部署指南](./operations/DEPLOYMENT.md) | 单体 / 微服务 mesh 上线、备份恢复 Runbook | 运维、SRE、平台 |
| [Kubernetes 部署](./operations/K8S_DEPLOYMENT.md) | `k8s/base/` manifest、Helm chart、HPA | 运维、SRE |
| [可观测性](./operations/OBSERVABILITY.md) | Prometheus `/metrics` + OpenTelemetry 接入 | 运维、SRE、后端 |
| [安全加固](./operations/SECURITY_HARDENING.md) | Argon2id、Fernet、JWT 旋转、Redis RateLimit | 安全、运维、后端 |

### 外部集成

| 文档 | 何时阅读 | 维护定位 |
|------|----------|----------|
| [广告与 IAP 接入清单](./integrations/ADS_IAP_SETUP.md) | 接入 AdMob / AppLovin / Stripe / 微信 IAP 的标准步骤 | 运营、平台、商业化 |
| [企业扩展 API](./integrations/ENTERPRISE_EXTENSIONS.md) | `enterprise_extensions.py` 远程配置、策略注册、支付 / 广告占位 | 后端、平台 |

### 平台、视觉与内容系统

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [Android / iOS 客户端外壳](./platform/MOBILE_CLIENTS.md) | Capacitor WebView 壳、构建同步、真机 API、离线边界 | 架构、平台、测试 |
| [微信小程序适配](./platform/WECHAT_MINIPROGRAM.md) | Web → 小程序同步、适配层、能力边界 | 架构、测试 |
| [微信发布流程](./platform/WECHAT_RELEASE.md) | 提审、上线、回滚、运维清单 | 运营、测试 |
| [四端同步契约](./platform/SYNC_CONTRACT.md) | Web / 小程序 / Android / iOS 的规则、构建和 API 对齐 | 架构、平台、测试 |
| [皮肤目录](./product/SKINS_CATALOG.md) | 皮肤分类、渲染管线、icon 唯一性 | 产品、美术、测试 |
| [皮肤语义池](./product/SKIN_ICON_SEMANTIC_POOL.md) | emoji 语义、主题映射、唯一性约束 | 产品、美术 |
| [彩蛋与惊喜](./product/EASTER_EGGS_AND_DELIGHT.md) | 音效、触觉、皮肤、奖励、彩蛋系统 | 产品、运营 |
| [宝箱与钱包](./product/CHEST_AND_WALLET.md) | 局末 / 赛季宝箱入账顺序、`wallet` 与每日 cap 绕过 | 产品、测试 |

### 归档

| 文档 | 定位 |
|------|------|
| [archive/algorithms/](./archive/algorithms/) | RL v9.x 平台期诊断、训练优化清单、浏览器优化、自博弈路线图等 sprint 分析 |
| [archive/product/](./archive/product/) | 留存路线图、彩蛋路线图等阶段性 sprint 文档 |
| [archive/MONETIZATION_OPTIMIZATION.md](./archive/MONETIZATION_OPTIMIZATION.md) | 早期商业化路径研究 |
| [archive/MONETIZATION_PERSONALIZATION.md](./archive/MONETIZATION_PERSONALIZATION.md) | 早期个性化引擎设计 |

归档文档保留用于理解演进背景，**不作为当前实现事实来源**。

## 方法论索引

### 体验设计

- **心流调节**：先读 [领域知识](./domain/DOMAIN_KNOWLEDGE.md)，再读
  [自适应出块](./algorithms/ADAPTIVE_SPAWN.md) 与
  [玩家画像算法](./algorithms/ALGORITHMS_PLAYER_MODEL.md)
- **策略与叙事一致性**：先读 [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md)
  → [策略体验栈](./player/STRATEGY_EXPERIENCE_MODEL.md) →
  [实时策略系统](./player/REALTIME_STRATEGY.md)
- **爽感与奖励**：先读 [彩蛋与惊喜](./product/EASTER_EGGS_AND_DELIGHT.md) 与
  [宝箱与钱包](./product/CHEST_AND_WALLET.md)，再读
  [出块三层架构](./algorithms/SPAWN_ALGORITHM.md) 与
  [消行计分](./product/CLEAR_SCORING.md)
- **难度曲线**：先读 [难度模式](./product/DIFFICULTY_MODES.md)，再读
  [解法数量难度](./algorithms/SPAWN_SOLUTION_DIFFICULTY.md)
- **生命周期与成熟度运营**：先读
  [生命周期与成熟度蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)，再读
  [商业化系统全景](./operations/MONETIZATION.md)

### 算法设计

- **四模型边界**：启发式出块、生成式出块、PyTorch RL、浏览器 RL 的职责与损失，
  入口为 [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md)
- **规则引擎**：`shapeWeights + spawnHints + hard constraints`，入口为
  [出块算法手册](./algorithms/ALGORITHMS_SPAWN.md)
- **玩家状态估计**：`rawSkill + EMA + historicalSkill + flowDeviation`，入口为
  [玩家画像算法](./algorithms/ALGORITHMS_PLAYER_MODEL.md)
- **RL 训练**：`simulator + policy/value + search teacher + eval gate`，入口为
  [RL 算法手册](./algorithms/ALGORITHMS_RL.md)
- **商业化推断**：`segmentation + rule engine + LTV proxy + propensity vector`，
  入口为 [商业化算法手册](./algorithms/ALGORITHMS_MONETIZATION.md)；架构层进一步
  阅读 [商业化模型架构设计](./algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md)

### 工程框架

- **配置单一来源**：玩法、特征、奖励参数优先查 `shared/game_rules.json`
- **跨端同步**：Web 核心逻辑改动后检查 Android / iOS `dist` 同步、小程序
  `miniprogram/core/` 副本和同步脚本
- **后端持久化**：会话、行为、分数、回放与训练日志走 Flask + SQLite
- **验证闭环**：单元测试、构建、手动体验、指标看板四类证据都要能追溯

## 核心事实速查

| 问题 | 当前事实 | 来源 |
|------|----------|------|
| 自适应出块输入 | 多信号 stress + spawnIntent + spawnHints；详见 stressBreakdown 字典 | [实时策略系统](./player/REALTIME_STRATEGY.md) + `web/src/adaptiveSpawn.js` |
| 出块公平性约束 | 最低机动性、序贯可解性、解法数量软过滤、顺序刚性 `validPerms` 软过滤 | `web/src/bot/blockSpawn.js` |
| 真人玩法与 RL | 真人对局走 `game.js + adaptiveSpawn`；Python RL 训练不直接使用网页自适应 | [RL_AND_GAMEPLAY](./algorithms/RL_AND_GAMEPLAY.md) |
| 共享规则来源 | `shared/game_rules.json` | [ALGORITHMS_HANDBOOK](./algorithms/ALGORITHMS_HANDBOOK.md) |
| 默认测试命令 | `npm test`、`npm run lint`、`npm run build` | [测试指南](./engineering/TESTING.md) |
| 商业化基础 flag 默认 | 任务 / 排行榜 / 皮肤 / 通行证 / 分享 / Stub / 体验面板 / 生命周期 Toast 默认开启；广告 / IAP / Push 默认关 | `web/src/monetization/featureFlags.js` |
| 商业化算法层 flag 默认 | 观测能力（quality / outcome / drift）默认开；决策路径（calibration / explorer / MTL / bandit）默认关 | `web/src/monetization/featureFlags.js` |
| MonetizationBus 事件全集 | `purchase_completed` / `iap_purchase` / `ad_show` / `ad_complete` / `daily_task_complete` / `season_tier_unlocked` / `lifecycle:*` | [事件契约](./architecture/MONETIZATION_EVENT_BUS_CONTRACT.md) |

## 文档维护规范

1. **代码事实优先**：文档描述必须能追到文件、配置或测试；不确定内容标记为
   "假设 / 待验证"
2. **一页一个职责**：领域知识讲"为什么"，算法手册讲"怎么建模"，工程文档讲
   "怎么改"，测试文档讲"怎么证明"
3. **不写中间态**：不在主线文档使用"v1.49.x P0-1 已完成 / Phase 2 待启动 /
   计划下一周"等 sprint 节奏语言；这类内容应进 CHANGELOG 或 archive
4. **变更同步**：改 `shared/game_rules.json`、出块、玩家画像、RL 特征、商业化
   规则时，同步更新对应手册和本索引
5. **保留归档语义**：历史方案不要混入当前事实；归档文档保留背景与取舍，当前
   实现以权威文档为准
6. **面向开源审阅**：新增文档应包含适用角色、代码入口、配置入口、验证方式和
   已知边界
