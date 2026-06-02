# OpenBlock 文档中心

OpenBlock 是一套以方块益智为最小可玩内核的开源参考实现，将玩法、玩家画像、强化学习、商业化四件事写在同一份代码、同一组特征、同一根事件总线之下。

---

## 按角色快速入门

| 角色 | 入口文档 |
|------|----------|
| **👤 管理者 / 决策者** — 了解业务全景与系统架构 | [产品设计理念](./player/EXPERIENCE_DESIGN_FOUNDATIONS.md) · [系统架构总览](./architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md) · [竞品与行业分析](./domain/GLOBAL_CASUAL_GAME_RESEARCH.md) |
| **🎮 游戏策划 / 产品经理** — 设计玩法与体验 | [难度模式与自适应系统](./product/DIFFICULTY_MODES.md) · [消行计分](./product/CLEAR_SCORING.md) · [最佳分追逐策略](./player/BEST_SCORE_CHASE_STRATEGY.md) · [皮肤目录](./product/SKINS_CATALOG.md) |
| **🧠 算法 / AI 工程师** — 出块、玩家画像、RL | [算法与模型手册](./algorithms/ALGORITHMS_HANDBOOK.md) · [出块算法](./algorithms/ALGORITHMS_SPAWN.md) · [实时状态历史序列分析](./algorithms/REALTIME_STATE_HISTORY_ANALYSIS.md) · [RL 算法](./algorithms/ALGORITHMS_RL.md) · [出块信号透视仪](./algorithms/spawn-signal-explorer.html) |
| **⚙️ 开发工程师** — 搭建、编码、测试、部署 | [项目总览](./engineering/PROJECT.md) · [二次开发指南](./engineering/DEV_GUIDE.md) · [数据库模式](./engineering/SQLITE_SCHEMA.md) · [黄金事件字典](./engineering/GOLDEN_EVENTS.md) |
| **💰 商业化 / 运营** — 变现与数据运营 | [商业化系统全景](./operations/MONETIZATION.md) · [生命周期与成熟度蓝图](./operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) · [运营看板](/ops) |
| **🔧 运维 / SRE** — 部署、监控、安全 | [部署指南](./operations/DEPLOYMENT.md) · [百万 DAU 架构](./operations/SCALE_1M_DAU.md) · [可观测性](./operations/OBSERVABILITY.md) · [安全加固](./operations/SECURITY_HARDENING.md) |

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
