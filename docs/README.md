# OpenBlock 文档中心

> 面向开源协作的统一入口：先理解领域与方法论，再进入架构、算法、工程实现和测试验证。  
> 在线查阅：[文档中心](http://localhost:5000/docs)（服务运行时可用）  
> 根目录入口：[README.md](../README.md) · [ARCHITECTURE.md](../ARCHITECTURE.md) · [CONTRIBUTING.md](../CONTRIBUTING.md)

## 如何阅读

OpenBlock 不是单一小游戏代码库，而是一个“休闲益智玩法 + 自适应出块 + 玩家画像 + 强化学习 + 商业化实验”的开源研究与工程平台。文档中心按三层组织：

1. **领域知识**：为什么要这样设计，包括休闲游戏心理、心流、挫败、留存、变现、测试风险。
2. **方法论与算法**：如何建模，包括出块、玩家画像、RL、商业化推断、计分与难度。
3. **工程框架**：如何落地，包括前后端架构、扩展点、配置、平台适配、验证流程。

## 目录结构

```text
docs/
├── README.md          # 文档中心总入口
├── engineering/       # 工程指南、测试、i18n、Cursor Skills 索引、AI 构建 Skill
├── domain/            # 领域知识、品类研究、竞品与架构对比
├── product/           # 玩法、难度、计分、留存、皮肤、惊喜系统
├── player/            # 玩家画像、面板参数、实时策略、玩法风格
├── algorithms/        # 出块、RL、玩家模型、商业化模型等算法手册
├── operations/        # 商业化、运营、训练面板、策略定制
├── platform/          # Android / iOS 客户端、小程序适配、发布与四端同步
└── archive/           # 已归档的历史方案和早期研究
```

目录组织原则：**按读者任务和知识层次分组，而不是按文件创建时间或功能迭代版本分组**。跨领域文档只保留一个权威位置，在其他章节通过链接引用。

## 角色导航

| 角色 | 先读 | 再读 | 目标 |
|------|------|------|------|
| 产品 / 玩法策划 | [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md)（**顶层方法论**：心理学根基 + 5 轴体验结构）→ [领域知识](./domain/DOMAIN_KNOWLEDGE.md) → [休闲游戏品类分析](./domain/CASUAL_GAME_ANALYSIS.md) | [难度模式](./product/DIFFICULTY_MODES.md) → [彩蛋与惊喜系统](./product/EASTER_EGGS_AND_DELIGHT.md) → [策略定制指南](./engineering/STRATEGY_GUIDE.md) | 理解当前体验曲线、心流、奖励节奏与玩法可调面 |
| 算法工程师 | [算法与模型手册](./algorithms/ALGORITHMS_HANDBOOK.md) → [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md) | [出块算法手册](./algorithms/ALGORITHMS_SPAWN.md) → [玩家画像算法](./algorithms/ALGORITHMS_PLAYER_MODEL.md) → [RL 手册](./algorithms/ALGORITHMS_RL.md) | 统一符号、公式、模型结构、训练/推理链路 |
| 架构 / 平台工程师 | [架构文档](../ARCHITECTURE.md) → [技术总览](./engineering/PROJECT.md) | [二次开发指南](./engineering/DEV_GUIDE.md) → [Android / iOS 客户端外壳](./platform/MOBILE_CLIENTS.md) → [微信小程序适配](./platform/WECHAT_MINIPROGRAM.md) → [i18n](./engineering/I18N.md) | 理解模块边界、数据流、扩展接口与跨端同步 |
| 运营 / 商业化 | [商业化策略](./operations/MONETIZATION.md) → [玩家生命周期与成熟度运营蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | [商业化算法](./algorithms/ALGORITHMS_MONETIZATION.md) → [训练面板](./operations/MONETIZATION_TRAINING_PANEL.md) → [商业运营](./operations/COMMERCIAL_OPERATIONS.md) | 理解当前分群、触发策略、运营面板、实验指标与企业落地项 |
| 测试 / QA | [测试指南](./engineering/TESTING.md) | [PROJECT.md 测试章节](./engineering/PROJECT.md#测试) → [RL 数值稳定](./algorithms/RL_TRAINING_NUMERICAL_STABILITY.md) → [训练看板趋势](./algorithms/RL_TRAINING_DASHBOARD_TRENDS.md) | 建立功能、算法、回归、数据一致性验证清单 |
| 开源贡献者 | [README](../README.md) → [贡献指南](../CONTRIBUTING.md) | [二次开发指南](./engineering/DEV_GUIDE.md) → 本页“文档维护规范” | 快速跑起来、找到任务边界、提交可审查改动 |
| AI 辅助开发（Cursor / OpenCode 等） | [Cursor Skills 索引](./engineering/CURSOR_SKILLS.md) | [休闲游戏构建 Skill](./engineering/CASUAL_GAME_BUILD_SKILL.md) → [ARCHITECTURE](../ARCHITECTURE.md) → [TESTING](./engineering/TESTING.md) | 选用 Project/Personal Skills；可选 Skill 场景见索引 §3 |

## 权威文档地图

### 项目与架构

| 文档 | 何时阅读 | 维护定位 |
|------|----------|----------|
| [README](../README.md) | 第一次了解项目、安装与快速启动 | 项目门面，保持短而稳定 |
| [ARCHITECTURE](../ARCHITECTURE.md) | 理解系统边界、模块关系、核心数据流 | 架构事实来源 |
| [技术总览](./engineering/PROJECT.md) | 需要快速定位前端、后端、RL、商业化模块 | 工程地图 |
| [二次开发指南](./engineering/DEV_GUIDE.md) | 新增模块、接入 SDK、扩展 API | 开发流程与扩展约定 |
| [i18n](./engineering/I18N.md) | 修改文案、语言包、RTL 支持 | 国际化规范 |
| [测试指南](./engineering/TESTING.md) | 提交前验证、写测试、排查回归 | 质量门禁 |
| [SQLite 数据库模式](./engineering/SQLITE_SCHEMA.md) | 表字段、用途、`/api` 映射、空表说明 | 后端、数据、运维 |
| [黄金事件字典](./engineering/GOLDEN_EVENTS.md) | `GAME_EVENTS` / behaviors 命名与版本约定 | 数据、商业化、测试 |
| [Canvas 转换文档索引](./engineering/CANVAS_ARTIFACTS.md) | 已从 Cursor Canvas 转换为 Markdown 的调研、路线图、候选块和 RL 诊断文档入口 | 产品、算法、运营、AI 协作 |
| [Cursor Skills 索引](./engineering/CURSOR_SKILLS.md) | 本仓库 Project Skills、个人可选 Skill、使用与维护约定 | AI 协作、贡献者 |
| [休闲游戏全栈构建 Skill](./engineering/CASUAL_GAME_BUILD_SKILL.md) | 从核心循环到商业化与 CI 的阶段化清单；适配 AI 编码工具 | 架构、全栈、AI 协作 |
| [性能优化说明](./engineering/PERFORMANCE.md) | rAF 合并绘制、懒加载 chunk、可见性定时器、progress 缓存 | 前端、架构 |

### 领域知识与产品方法论

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [领域知识](./domain/DOMAIN_KNOWLEDGE.md) | 方块益智、心流、挫败、RL、商业化的基础概念 | 全角色 |
| [休闲游戏品类分析](./domain/CASUAL_GAME_ANALYSIS.md) | 竞品、能力模型、体验缺口、系统机会 | 产品、运营、算法 |
| [全球休闲游戏个性化策略与调研方案](./domain/GLOBAL_CASUAL_GAME_RESEARCH.md) | 全球市场、地区文化、人口学分层、个性化边界和调研执行方案 | 产品、运营、合规、算法 |
| [竞品与用户分析](./domain/COMPETITOR_USER_ANALYSIS.md) | 目标用户、竞品机制、差异化方向 | 产品、运营 |
| [架构对比](./domain/ARCHITECTURE_COMPARISON.md) | 不同实现路线的取舍 | 架构、技术负责人 |
| [留存路线图归档](./product/RETENTION_ROADMAP_V10_17.md) | 历史 sprint 记录；当前实现以具体产品/工程文档为准 | 产品、运营 |

### 玩法、难度与玩家系统

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [难度模式](./product/DIFFICULTY_MODES.md) | Easy/Normal/Hard 与自适应难度如何协作 | 产品、算法、测试 |
| [消行计分](./product/CLEAR_SCORING.md) | `baseUnit * c^2`、多消、同色/同 icon bonus | 产品、算法、测试 |
| [彩蛋 / 惊喜路线图](./product/EASTER_EGGS_ROADMAP.md) | 感官反馈、皮肤微动效、节日换皮、主动道具、隐藏彩蛋和社交分享机会池 | 产品、运营 |
| [玩家留存 / 活跃提升路线图](./product/PLAYER_RETENTION_ROADMAP.md) | D1/D7/D30 留存、召回、社交、长期进度和 4 周 Sprint 路径 | 产品、运营 |
| [玩家能力评估接入说明](./player/PLAYER_ABILITY_EVALUATION.md) | 玩家能力输出如何被产品和策略消费 | 产品、运营、测试 |
| [玩家面板参数](./player/PANEL_PARAMETERS.md) | UI 指标含义、异常解读、调参提示 | 产品、运营、测试 |
| [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md) | **顶层方法论**：心理学根基（9 条经验研究：心流/SDT/变比奖励/PE/峰终/近失/Yerkes-Dodson/Hooked/MDA）→ 休闲游戏设计理念（7 条）→ **OpenBlock 5 轴体验结构（挑战-能力 / 节奏-兑现 / 掌控-自主 / 情感-回响 / 成长-沉没）+ v1.27→v1.32 反例与正例验证表 + 设计审查清单 8 问**（v1.32 新增：`orderRigor` 顺序刚性高难度算法 — Yerkes-Dodson 上限延展正例） | 产品、设计、算法、架构、测试 |
| [实时策略系统](./player/REALTIME_STRATEGY.md) | 指标字典、**压力指标体系（19 项加压/减压/慢变量/派生痕迹 + 5 条作用机制）**、L1–L4 管线、策略卡生成、**压力表 6 档状态枚举 + 故事线决策树（v1.31 score-push 守卫与 harvest 密度三档分级）+ v1.32 spawnHints 新增 `orderRigor` / `orderMaxValidPerms`（顺序刚性 — 6 种排列里仅 ≤N 种可解的硬难度算法）**、合理性评估清单、配置速查 | 产品、算法、架构、测试 |
| [策略体验栈](./player/STRATEGY_EXPERIENCE_MODEL.md) | 通用四层模型、单一意图、几何门控、叙事职责分离；OpenBlock 映射 | 产品、算法、架构、测试 |
| [玩法风格检测](./player/PLAYSTYLE_DETECTION.md) | 玩家风格识别与策略微调 | 产品、算法 |

### 出块算法与建模

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md) | 启发式出块、生成式出块、PyTorch RL、浏览器 RL 的设计思路、网络结构、损失函数、样本构建与作用机制 | 算法、架构、测试 |
| [出块算法手册](./algorithms/ALGORITHMS_SPAWN.md) | 规则 + SpawnTransformer 的形式化与训练/推理 | 算法 |
| [出块三层架构](./algorithms/SPAWN_ALGORITHM.md) | Layer 1/2/3 如何从盘面到体验生成三连块 | 算法、架构、测试 |
| [自适应出块](./algorithms/ADAPTIVE_SPAWN.md) | 10 信号 stress、心流、爽感兑现、spawnHints | 产品、算法 |
| [候选块概率图鉴](./algorithms/CANDIDATE_BLOCKS_PROBABILITY_ATLAS.md) | 28 个候选块、类别权重、基础概率、难度档位和动态因子 | 产品、算法、测试 |
| [出块建模](./algorithms/SPAWN_BLOCK_MODELING.md) | 规则引擎与 ML 出块模型的设计 rationale | 算法、架构 |
| [解法数量难度](./algorithms/SPAWN_SOLUTION_DIFFICULTY.md) | v9 DFS 解空间计数、leafCap/budget、`solutionCount` 区间软过滤；**v1.32 新增 §13–§14：顺序刚性 (orderRigor) 高难度算法 — 启用此前未消费的 `validPerms ∈ [0,6]` 维度，强制玩家做"按特定顺序"的前瞻规划，含派生公式、五重 bypass、互抑矩阵与配置** | 算法、测试 |

### 强化学习

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [强化学习文档导航](./algorithms/RL_README.md) | RL 栏目的权威手册、专题补充和历史实验如何阅读 | 算法、后端、测试 |
| [RL 算法手册](./algorithms/ALGORITHMS_RL.md) | PPO/GAE、网络结构、奖励、探索、推理 API 的权威事实 | 算法 |
| [玩法与 RL 解耦](./algorithms/RL_AND_GAMEPLAY.md) | 真人玩法、训练环境、共享配置和特征维度边界 | 算法、架构 |
| [PyTorch RL 服务与评估](./algorithms/RL_PYTORCH_SERVICE.md) | 在线 `/api/rl`、离线训练、search replay 和贪心评估 | 算法、后端 |
| [RL v9.1 深度分析](./algorithms/RL_V9_1_DEEP_ANALYSIS.md) | 400-500 分平台期、颜色特征、EvalGate、价值目标和序贯可行性风险 | 算法 |
| [RL v9.3 提分深度分析](./algorithms/RL_V9_3_SCORE_BREAKTHROUGH_ANALYSIS.md) | Replay 新鲜度、teacher 覆盖、目标尺度、评估口径和 bonus auxiliary | 算法 |
| [OpenBlock RL 自博弈提升路线图](./algorithms/RL_SELF_PLAY_ROADMAP.md) | 搜索 teacher、Ranked Reward、困难样本和评估门控路线 | 算法 |
| [自博弈 RL 文献对照与 OpenBlock 适配](./algorithms/RL_SELF_PLAY_LITERATURE_COMPARISON.md) | AlphaZero、MuZero、Expert Iteration、Gumbel AlphaZero 等路线对比 | 算法 |
| [训练观测与排障](./algorithms/RL_README.md#23-训练观测与排障) | 看板数据流、趋势解读、数值稳定和调参优先级 | 算法、测试 |

### 商业化与运营

| 文档 | 核心问题 | 适合角色 |
|------|----------|----------|
| [商业化策略](./operations/MONETIZATION.md) | IAA/IAP、分群、触发、API、模块全景 | 运营、产品、架构 |
| [玩家生命周期与成熟度运营蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | 双轴模型（S0–S4 × M0–M4）、KPI 字典、双分制成熟度（SkillScore / ValueScore）、90 天可落地任务清单和 8 个实验 | 运营、产品、算法、客户端 |
| [运营看板指标审计](./operations/OPS_DASHBOARD_METRICS_AUDIT.md) | `/ops` 指标是否接数据库、SQL 口径、截图数值复核、已知风险和修正建议 | 运营、产品、数据、后端、测试 |
| [商业化算法](./algorithms/ALGORITHMS_MONETIZATION.md) | 鲸鱼分、规则引擎、LTV、CPI 出价 | 算法、运营 |
| [商业化定制](./operations/MONETIZATION_CUSTOMIZATION.md) | 接入真实广告/IAP SDK、规则扩展 | 架构、运营 |
| [训练面板](./operations/MONETIZATION_TRAINING_PANEL.md) | 面板设计、指标、调参 PlayBook | 运营、产品 |
| [商业运营参考分析](./operations/COMMERCIAL_OPERATIONS.md) | 运营机会池与策略参考，不作为当前实现事实来源 | 运营 |
| [个性化变现](./archive/MONETIZATION_PERSONALIZATION.md) | 归档：个性化商业化 v2 设计 | 参考 |
| [变现优化](./archive/MONETIZATION_OPTIMIZATION.md) | 归档：行业调研与早期优化清单 | 参考 |

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
| [宝箱与钱包](./product/CHEST_AND_WALLET.md) | 局末/赛季宝箱入账顺序、`wallet` 与每日 cap 绕过 | 产品、测试 |

### 归档与历史记录

| 文档 | 定位 |
|------|------|
| [留存路线图归档](./product/RETENTION_ROADMAP_V10_17.md) | 阶段性 sprint 记录，不作为当前产品事实入口 |
| [商业化路径研究 v1](./archive/MONETIZATION_OPTIMIZATION.md) | 早期行业调研与优化思路 |
| [个性化商业化设计 v2](./archive/MONETIZATION_PERSONALIZATION.md) | 早期个性化引擎设计 |

## 方法论索引

### 体验设计

- **心流调节**：先读 [领域知识](./domain/DOMAIN_KNOWLEDGE.md)，再读 [自适应出块](./algorithms/ADAPTIVE_SPAWN.md) 与 [玩家画像算法](./algorithms/ALGORITHMS_PLAYER_MODEL.md)。
- **策略与叙事一致性**：先读 [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md)（心理学根基与 5 轴体验结构）→ [策略体验栈](./player/STRATEGY_EXPERIENCE_MODEL.md)（通用分层、`spawnIntent`、压力表职责）→ [实时策略系统](./player/REALTIME_STRATEGY.md)（指标/管线/评审清单与时序配置）。
- **爽感与奖励**：先读 [彩蛋与惊喜](./product/EASTER_EGGS_AND_DELIGHT.md) 与 [宝箱与钱包](./product/CHEST_AND_WALLET.md)，再读 [出块三层架构](./algorithms/SPAWN_ALGORITHM.md) 与 [消行计分](./product/CLEAR_SCORING.md)。
- **难度曲线**：先读 [难度模式](./product/DIFFICULTY_MODES.md)，再读 [解法数量难度](./algorithms/SPAWN_SOLUTION_DIFFICULTY.md)。
- **生命周期与成熟度运营**：先读 [玩家生命周期与成熟度运营蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)（双轴 S0–S4 × M0–M4、KPI 字典、双分制成熟度、90 天落地清单与 8 个实验），再读 [玩家留存路线图](./product/PLAYER_RETENTION_ROADMAP.md) 与 [商业化策略](./operations/MONETIZATION.md)。
- **Canvas 转换文档**：需要查看全球化调研、留存/彩蛋路线图、候选块概率或 RL 诊断时，先读 [Canvas 转换文档索引](./engineering/CANVAS_ARTIFACTS.md)；文档中心注册 Markdown，不直接注册原始 Canvas。

### 算法设计

- **四模型边界**：启发式出块、生成式出块、PyTorch RL、浏览器 RL 的职责与损失，入口为 [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md)。
- **规则引擎**：`shapeWeights + spawnHints + hard constraints`，入口为 [出块算法手册](./algorithms/ALGORITHMS_SPAWN.md)。
- **玩家状态估计**：`rawSkill + EMA + historicalSkill + flowDeviation`，入口为 [玩家画像算法](./algorithms/ALGORITHMS_PLAYER_MODEL.md)。
- **RL 训练**：`simulator + policy/value + search teacher + eval gate`，入口为 [RL 算法手册](./algorithms/ALGORITHMS_RL.md)。
- **商业化推断**：`segmentation + rule engine + LTV proxy`，入口为 [商业化算法](./algorithms/ALGORITHMS_MONETIZATION.md)。

### 工程框架

- **配置单一来源**：玩法、特征、奖励参数优先查 `shared/game_rules.json`。
- **跨端同步**：Web 核心逻辑改动后检查 Android/iOS `dist` 同步、小程序 `miniprogram/core/` 副本和同步脚本。
- **后端持久化**：会话、行为、分数、回放与训练日志走 Flask + SQLite。
- **验证闭环**：单元测试、构建、手动体验、指标看板四类证据都要能追溯。

## 核心事实速查

| 问题 | 当前事实 | 来源 |
|------|----------|------|
| 自适应出块输入 | 分数、连战、技能、心流、节奏、恢复、挫败、combo、趋势、置信度，加上爽感兑现提示；**19 项 `stressBreakdown` 信号枚举、量级、物理含义与 5 条下游作用路径**见 [实时策略系统 §3.2/§3.6](./player/REALTIME_STRATEGY.md)；叙事标签见 [策略体验栈](./player/STRATEGY_EXPERIENCE_MODEL.md)；v1.29 起含 `_occupancyFillAnchor` 跨 spawn 缓降、`challengeBoost`×`friendlyBoardRelief` 互抑；v1.30 起新增 **`bottleneckRelief`**（跨 dock 周期 firstMoveFreedom 低谷救济）+ 与 friendly/frustration/recovery 互抑；v1.31 起 `stressMeter.buildStoryLine` 新增 score-push 守卫（高 stress + 友好盘面切「冲分仪式感」）与 harvest 密度三档分级（dense/visible/edge）；**v1.32 起 spawnHints 新增 `orderRigor` / `orderMaxValidPerms`：要求三连块 6 种排列里仅 ≤N 种可解（默认 N=2，Hard 模式 +0.30 boost），强制按特定顺序放置；五重 bypass（onboarding/needsRecovery/hasBottleneckSignal/`holes>3`/`fill<0.5`）保护新手与被困者** | `web/src/adaptiveSpawn.js` + `web/src/bot/blockSpawn.js`（`solutionRejects.orderTooLoose`）+ `web/src/game.js` + `web/src/stressMeter.js`（`SIGNAL_LABELS.orderRigor`） |
| 出块公平性约束 | 最低机动性、序贯可解性、解法数量软过滤；**v1.32 增加顺序刚性 `validPerms ≤ N` 软过滤**（早期 attempt 内拒绝过宽 triplet，超出窗口 fallback 不会卡死） | `web/src/bot/blockSpawn.js` |
| 真人玩法与 RL | 真人对局走 `game.js + adaptiveSpawn`；Python RL 训练不直接使用网页自适应 | [RL_AND_GAMEPLAY](./algorithms/RL_AND_GAMEPLAY.md) |
| 共享规则来源 | `shared/game_rules.json` | [ALGORITHMS_HANDBOOK](./algorithms/ALGORITHMS_HANDBOOK.md) |
| 默认测试命令 | `npm test`、`npm run lint`、`npm run build` | [测试指南](./engineering/TESTING.md) |
| 商业化默认状态 | 广告/IAP/Push 默认关；任务/排行榜/皮肤/通行证/分享/Stub 默认开 | `web/src/monetization/featureFlags.js` |

## 文档维护规范

1. **代码事实优先**：文档描述必须能追到文件、配置或测试；不确定内容标记为“假设/待验证”。
2. **一页一个职责**：领域知识讲“为什么”，算法手册讲“怎么建模”，工程文档讲“怎么改”，测试文档讲“怎么证明”。
3. **变更同步**：改 `shared/game_rules.json`、出块、玩家画像、RL 特征、商业化规则时，同步更新对应手册和本索引。
4. **保留归档语义**：历史方案不要混入当前事实；归档文档保留背景与取舍，当前实现以权威文档为准。
5. **面向开源审阅**：新增文档应包含适用角色、代码入口、配置入口、验证方式和已知边界。

## 文档状态

- **当前权威**：本页列出的项目、架构、算法、玩法、商业化、测试文档。
- **参考/归档**：早期商业化优化、个性化方案、阶段性路线图等，保留用于理解演进历史。
- **待完善方向**：端到端测试用例、线上指标口径、贡献者任务标签、英文文档对齐。
