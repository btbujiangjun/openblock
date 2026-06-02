# OpenBlock 文档中心

OpenBlock 是一套以方块益智为最小可玩内核的开源参考实现，将玩法、玩家画像、强化学习、商业化四件事写在同一份代码、同一组特征、同一根事件总线之下。

---

## 按角色快速入门

各角色入口文档按**总（全景视野/顶层框架）→ 分（专题深读/实施细则）**顺序排列。

---

### 👤 管理者 / 决策者

了解业务全景、系统架构与行业格局。

**总——业务全景与顶层设计**

- [系统架构总览](./architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md) —— 三视图架构（业务→全栈→6张Mermaid子图），覆盖四支柱、容器层、领域服务、事件总线、部署拓扑
- [商业化策略全景](./operations/MONETIZATION.md) —— IAA+IAP混合架构、用户分层（鲸鱼/海豚/小鱼）、信号→决策管线、KPI基线
- [全球休闲游戏市场研究](./domain/GLOBAL_CASUAL_GAME_RESEARCH.md) —— 跨地域个性化策略、文化适配框架、SDT动机模型、Hofstede文化维度
- [产品架构图](./architecture/PRODUCT_ARCHITECTURE_DIAGRAMS.md) —— 玩家视角：PB追逐→五层游戏化→生命周期×成熟度差异化→北星指标闭环
- [商业化系统综合报告（附录）](./operations/MONETIZATION.md#15-商业化系统综合报告附录) —— 模块拓扑、信号体系、决策模块、漏斗KPI、演进方向

**分——行业事实与对比**

- [领域知识](./domain/DOMAIN_KNOWLEDGE.md) —— 品类机制、心流、留存、商业化基础概念；附录含休闲游戏品类分析与系统研究、2025-2026行业数据、RL最新进展
- [竞品与用户分析](./domain/COMPETITOR_USER_ANALYSIS.md) —— 目标用户画像、竞品机制拆解、差异化方向
- [架构对比](./domain/ARCHITECTURE_COMPARISON.md) —— 行业参考架构 vs 当前实现的全栈对比，差距与演进路径
- [商业运营参考分析](./operations/COMMERCIAL_OPERATIONS.md) —— 商业化现状诊断、P0–P7改善优先级与集成路径
- [商业化与企业能力对照表](./operations/COMMERCIAL_IMPROVEMENTS_CHECKLIST.md) —— 54项能力的状态矩阵（内置/部分/外部/规划中）

---

### 🎮 游戏策划 / 产品经理

设计玩法、体验与内容系统。

**总——设计理念与体验框架**

- [体验设计基石](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md) —— **顶层方法论**：9条心理学经验研究 → 7条休闲游戏工业设计理念 → 5轴体验结构 + 设计审查清单（8问）
- [策略体验栈模型](./player/STRATEGY_EXPERIENCE_MODEL.md) —— L1–L4四层通用模型（状态估计→策略解析→内容生成→体验呈现）+ `spawnIntent` 枚举 + 几何门控
- [最佳分追逐策略](./player/BEST_SCORE_CHASE_STRATEGY.md) —— **主策划契约**：以挑战最佳分为核心主线，四维差异化矩阵（S×M×D×P）、改进与优化项

**分——玩法与机制细则**

- [难度模式](./product/DIFFICULTY_MODES.md) —— 三档难度（简单/普通/困难）的参数差异（填充率、块形权重、解法空间难度、拓扑压力）
- [消行计分规则](./product/CLEAR_SCORING.md) —— Clear / Combo / Streak 公式、同花色/同icon奖励、全消倍率、web与小程序对齐口径
- [实时策略系统](./player/REALTIME_STRATEGY.md) —— L1指标字典（20+滑动窗口）、stress管线公式、6档压力表、策略卡生成、合理性评估清单
- [玩法风格检测](./player/PLAYSTYLE_DETECTION.md) —— 多消率/清屏率/平均消除条数推算，`playstyle`枚举与出块对齐
- [玩家能力评估](./player/PLAYER_ABILITY_EVALUATION.md) —— AbilityVector 7维输出字段的产品语义、消费方、作用机制与验证方式
- [玩家面板参数手册](./player/PANEL_PARAMETERS.md) —— 面板5个功能区每个参数的数学定义、物理含义、取值范围及异常解读（694行参考手册）

**分——视觉与内容包装**

- [皮肤目录](./product/SKINS_CATALOG.md) —— 34款皮肤×4维度的元数据、设计原则（亮度对比、背景色彩连贯性）+ 216个emoji全局互斥池与语义加固记录
- [宝箱与钱包](./product/CHEST_AND_WALLET.md) —— 局末宝箱、赛季宝箱、技能钱包：存储键、触发概率、发放顺序、日常上限与绕过来源
- [彩蛋与惊喜系统](./product/EASTER_EGGS_AND_DELIGHT.md) —— 程序化音频/触觉/皮肤过渡/粒子/Konami指令等彩蛋，零侵入架构，约7.1人日

---

### 🧠 算法 / AI 工程师

出块、玩家画像、强化学习与商业化推断的算法与模型。

**总——手册与架构总览**

- [算法与模型手册](./algorithms/ALGORITHMS_HANDBOOK.md) —— 总索引与符号约定，全算法体系入口
- [算法架构图](./algorithms/ALGORITHM_ARCHITECTURE_DIAGRAMS.md) —— 六层+七子模型+反馈闭环：设计参考稿、紧凑概念图、8子图内部结构+阈值
- [模型工程总览](./algorithms/MODEL_ENGINEERING_GUIDE.md) —— 全部模型的工程地图：文件、数据流、依赖关系
- [四模型系统设计](./algorithms/MODEL_SYSTEMS_FOUR_MODELS.md) —— 启发式/生成式/PyTorch RL/浏览器RL四类模型的选型与架构

**分——出块算法专题**

- [出块算法手册](./algorithms/ALGORITHMS_SPAWN.md) —— 规则+ `SpawnTransformer` 核心逻辑
- [自适应出块](./algorithms/ADAPTIVE_SPAWN.md) —— §10.8完整流水线（9层v1.60.35代码基准）+ S×M×D×P 25格调制矩阵
- [出块三层架构](./algorithms/SPAWN_ALGORITHM.md) —— 三层架构+5阶段流水线+30+加权乘子+硬约束表
- [解法数量难度](./algorithms/SPAWN_SOLUTION_DIFFICULTY.md) —— 顺序刚性 `orderRigor`、解法空间度量
- [出块建模](./algorithms/SPAWN_BLOCK_MODELING.md) —— 规则引擎+SpawnTransformer；PB双S曲线、P2体验预算、个性化实验轨建模口径
- [出块评估与可视化工具](./algorithms/SPAWN_EVALUATION.md) —— CLI+Web Worker批量评估，公平性/奖励节奏/兜底率分析
- [出块算法优化 v2](./algorithms/SPAWN_TUNING_V2.md) —— 工业化L4 ResNet-MLP：5维context×20维d_curve目标+5分量损失
- [候选块概率图鉴](./algorithms/CANDIDATE_BLOCKS_PROBABILITY_ATLAS.md)
- [实时状态历史序列分析](./algorithms/REALTIME_STATE_HISTORY_ANALYSIS.md) —— 基于 `frames[*].ps` 的历史实时状态分布与分析
- [出块算法信号透视仪](./algorithms/spawn-signal-explorer.html) —— 交互式HTML工具：22个L1×30个L2×7个L3管道阶段的信号链路

**分——玩家画像算法**

- [玩家画像算法](./algorithms/ALGORITHMS_PLAYER_MODEL.md) —— 玩家能力建模公式、特征、参数、`AbilityVector`、评估指标

**分——强化学习专题**

- [RL导航总览](./algorithms/RL_README.md)
- [玩法与RL解耦](./algorithms/RL_AND_GAMEPLAY.md)
- [PyTorch RL服务与评估](./algorithms/RL_PYTORCH_SERVICE.md)
- [RL训练数值稳定性](./algorithms/RL_TRAINING_NUMERICAL_STABILITY.md)
- [RL看板数据流与刷新机制](./algorithms/RL_TRAINING_DASHBOARD_FLOW.md)
- [RL看板趋势解读](./algorithms/RL_TRAINING_DASHBOARD_TRENDS.md)
- [AlphaZero优化方案](./algorithms/RL_ALPHAZERO_OPTIMIZATION.md)
- [自博弈文献对照与适配](./algorithms/RL_SELF_PLAY_LITERATURE_COMPARISON.md)
- [RL复杂度与瓶颈分析](./algorithms/RL_ANALYSIS.md)

**分——商业化算法**

- [商业化算法手册](./algorithms/ALGORITHMS_MONETIZATION.md) —— 鲸鱼分、规则引擎、LTV、广告频控
- [商业化模型架构设计](./algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md) —— 算法层扩展模块的架构与公式

---

### ⚙️ 开发工程师

搭建、编码、测试、部署、跨端适配与AI协作。

**总——项目概览与上手**

- [技术总览](./engineering/PROJECT.md) —— 前端分层、PyTorch RL子系统、后端约定、商业化子系统、测试拓扑
- [二次开发指南](./engineering/DEV_GUIDE.md) —— 环境搭建、项目约定、按章扩展：商业化/RL/玩家画像/小程序适配
- [策略定制指南](./engineering/STRATEGY_GUIDE.md) —— 三层出块引擎的自定义点：出块配置/stress信号/难度模式/广告IAP/RL训练，全由 `game_rules.json` 或插件驱动
- [测试指南](./engineering/TESTING.md) —— 测试金字塔（单元/lint/构建/算法回归/手工QA）、回归检查清单

**分——技术细节参考**

- [SQLite数据库模式](./engineering/SQLITE_SCHEMA.md) —— 全部表结构、用途、HTTP入口、业务JSON格式
- [前端性能优化](./engineering/PERFORMANCE.md) —— Dirty Rect追踪、对象池、rAF分块、progress缓存（v10.18）
- [性能基线与回归检测](./engineering/PERFORMANCE_BASELINE.md) —— CPU自动/GPU手动基线，`npm run perf:check`，敏感模块列表
- [黄金事件字典](./engineering/GOLDEN_EVENTS.md) —— 权威游戏事件常量（`PLACE`/`CLEAR`/`GAME_OVER`等）+ 商业化扩展事件
- [国际化i18n](./engineering/I18N.md) —— `t()` / `applyDom()` / `setLocale()` API、扁平key ES模块、RTL支持、10+语言
- [Canvas转换文档索引](./engineering/CANVAS_ARTIFACTS.md) —— Cursor Canvas产出的Markdown注册中心

**分——跨端适配与企业集成**

- [四端同步契约](./platform/SYNC_CONTRACT.md) —— Web/微信小程序/Android/iOS的单源真相规则
- [Android/iOS客户端外壳](./platform/MOBILE_CLIENTS.md) —— Capacitor包装、`npm run mobile:build`、API配置
- [微信小程序适配](./platform/WECHAT_MINIPROGRAM.md) —— 结构、功能边界（排除RL/监控）、本地开发
- [微信小程序发布流程](./platform/WECHAT_RELEASE.md) —— 账号注册→代码上传→审核，完整Runbook
- [企业扩展API](./integrations/ENTERPRISE_EXTENSIONS.md) —— 远程配置/支付stub/实验/运营/分析/合规端点与数据库表

**分——AI协作**

- [休闲游戏全栈构建Skill](./engineering/CASUAL_GAME_BUILD_SKILL.md) —— AI编程前置的工作流与原则（8条核心+5阶段）
- [Cursor Skills索引](./engineering/CURSOR_SKILLS.md) —— 项目中Skill文件的发现与注册方式

---

### 💰 商业化 / 运营

变现策略、数据运营、留存优化与合规。

**总——策略框架**

- [商业化策略全景](./operations/MONETIZATION.md) —— 架构、数据流、策略配置、`CommercialModelVector`、API与运维边界
- [商业化系统综合报告（附录）](./operations/MONETIZATION.md#15-商业化系统综合报告附录) —— 模块拓扑、信号体系、决策模块、漏斗KPI、演进方向
- [商业运营参考分析](./operations/COMMERCIAL_OPERATIONS.md) —— 机会池评估、P0–P7改善优先级、集成路径建议
- [玩家生命周期与成熟度运营蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) —— S0–S4 × M0–M4双轴模型、KPI字典、5×5决策矩阵、运营接入点与推荐实验
- [Block Blast 商业化运营指南](./platform/MONETIZATION_GUIDE.md) —— PWA离线/广告决策引擎/IAP/签到/分享配置，跨平台指南

**分——配置与面板**

- [商业化定制](./operations/MONETIZATION_CUSTOMIZATION.md) —— 三级定制粒度：面板调参→规则修改→新增动作类型，热重载机制
- [商业化训练面板](./operations/MONETIZATION_TRAINING_PANEL.md) —— MonPanel的4个Tab、字段说明、AB测试流程与扩展指南
- [广告与IAP真实接入清单](./integrations/ADS_IAP_SETUP.md) —— AdMob/AppLovin/Unity Ads + Stripe/微信/支付宝集成步骤，服务端鉴权硬规则

**分——留存与数据分析**

- [留存信号跨平台分析](./operations/RETENTION_SIGNALS_CROSS_PLATFORM.md) —— iOS×Android双平台16个行为信号与D7留存的相关性分析，6项关键发现+8项落地策略
- [留存优化快赢清单](./operations/RETENTION_QUICK_WINS.md) —— 精确到文件/函数/行号的10项优化，总计9人日
- [运营看板指标审计](./operations/OPS_DASHBOARD_METRICS_AUDIT.md) —— `/ops` 数据库接入确认、指标SQL口径审计与修复建议

**分——合规**

- [部署指南](./operations/DEPLOYMENT.md) §8 —— 合规与运维SOP（隐私同意、数据导出删除、备份恢复、事故回滚）

---

### 🔧 运维 / SRE

部署、监控、安全与规模化。

**总——部署总览**

- [部署指南](./operations/DEPLOYMENT.md) —— Docker Compose + 微服务网格双拓扑，本地/Staging/Production完整Runbook
- [百万DAU架构设计](./operations/SCALE_1M_DAU.md) —— 容量测算（3M日游戏/8-12K峰值写QPS）、目标拓扑、P0–P2改造项与灰度路线

**分——运维细则**

- [Kubernetes部署](./operations/K8S_DEPLOYMENT.md) —— `k8s/base/` manifest + Helm chart骨架，4个Flask Deployment + HPA
- [可观测性](./operations/OBSERVABILITY.md) —— 结构化日志 + Prometheus 4金信号 + OpenTelemetry自动埋点（W3C tracecontext）
- [安全加固](./operations/SECURITY_HARDENING.md) —— Argon2id/Fernet AES-128-CBC+HMAC/JWT旋转/RateLimit Redis后端，v1.14迁移Runbook

---

## 四支柱概览

| 支柱 | 定位 |
|------|------|
| **🎮 游戏引擎** | 留存与活跃的入口，承担玩家时长与社交延展 |
| **🧠 自适应出块 AI** | 个性化体验中枢，难度跟随每个玩家实时调节 |
| **🤖 强化学习训练** | 体验质量与算法迭代的科研闭环 |
| **💰 商业化框架** | 把体验转化为可持续经营，不损耗体验本身 |

四支柱共享同一组玩家画像（生命周期 S0–S4 × 成熟度 M0–M4），体验与商业化读同一张画像表。

---

> 在线查阅：启动服务后访问 `/docs` 即可浏览全部文档 | [项目 GitHub](https://github.com/btbujiangjun/openblock)
