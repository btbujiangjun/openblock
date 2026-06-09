# AI 协作

Cursor Skills、Canvas 转换文档、休闲游戏全栈构建 Skill。

---

## 一、休闲游戏全栈构建 Skill

> **用途**：供 Cursor、OpenCode、Codex 等 AI 编码助手在从零或增量开发休闲游戏时作为工作流与检查清单。  
> **项目内 Skill 文件**：`.cursor/skills/casual-game-build/SKILL.md`（Cursor Agent 可加载）。

### 1.1 核心原则

| 原则 | 做法 | 反模式 |
|------|------|--------|
| 体验模型先于复杂系统 | 先定义玩家状态、压力、奖励兑现、恢复/加压节奏，再写策略 | 只堆功能，不知道为什么变好玩 |
| 规则和模型分层 | 启发式规则保公平和低延迟，生成式/RL 学偏好和策略 | 让神经网络绕过玩法不变量 |
| 指标必须有物理含义 | 每个面板字段写清来源、范围、解释和作用 | 只显示缩写/曲线，无法评估合理性 |
| 可解性优先于刺激 | 高难可以缩小解空间，但不能破坏基本可放、序贯可解和回退 | 为了难度制造随机死局 |
| 奖励概率与几何约束分离 | 清屏、多消、同 icon 是概率倾向，仍受盘面几何校验 | 直接承诺奖励但盘面无法兑现 |
| 截图驱动 UI 修复 | 根据实际截图定位浮层锚点、对比度、可移动区域和视觉遮挡 | 只凭代码推测 UI 正确 |
| 文档是策略契约 | 算法、状态、字段、损失函数、网络结构和测试入口同步更新 | 代码改了，文档仍停留在旧语义 |
| 回归测试保护体验 bug | 分数特效、出块概率、压力状态等用户可感知逻辑都要补测试 | 修一次、之后同类问题反复出现 |

### 1.2 阶段工作流

**阶段 0：产品与核心循环** — 60 秒体验 pitch、核心循环、失败/再来一局、会话边界、体验结构

**阶段 1：核心玩法层** — 单一真实状态、规则外置 JSON、合法动作 API、确定性、回放最小集、策略快照

**阶段 2：表现与输入** — 渲染与逻辑分离、输入管线、Juice、帧与耗电、盘面锚点、画质档位、视觉 QA

**阶段 3：难度、关卡与自适应** — 难度维度、曲线、自适应、压力状态枚举、盘面难度事实、奖励兑现、高难顺序规划

**阶段 4：Meta、留存与社交壳** — 进度/XP、每日/每周循环、召回触点、社交轻量

**阶段 5：商业化插座** — 事件总线、Feature Flag、适配器模式、服务端校验占位

**阶段 6：数据、隐私与运营闭环** — 黄金事件字典、会话模型、归因、合规 API、策略可观测性、样本质量

**阶段 7：多端与交付** — 共享规则包、构建、小程序差异

**阶段 8：AI / RL** — 环境与玩法契约、推理接口、离线门禁、四类模型分工、特征字段字典、搜索蒸馏、失败回退

**阶段 9：质量与发布** — 测试金字塔、静态检查、运维、用户可感知回归、文档索引、无警告基线

### 1.3 OpenBlock 对照速查

| 主题 | 路径或文档 |
|------|------------|
| 架构总览 | `ARCHITECTURE.md` |
| 工程地图 | `docs/engineering/PROJECT.md` |
| 二次开发 | `docs/engineering/DEV_GUIDE.md` |
| 数据库与 API | `docs/engineering/SQLITE_SCHEMA.md`、`docs/integrations/ENTERPRISE_EXTENSIONS.md` |
| 体验策略 | `docs/player/EXPERIENCE_DESIGN_FOUNDATIONS.md`、`docs/player/STRATEGY_EXPERIENCE_MODEL.md` |
| 实时策略链路 | `docs/algorithms/REALTIME_STRATEGY.md` |
| 四模型系统 | `docs/algorithms/MODEL_SYSTEMS_FOUR_MODELS.md` |

---

## 二、Cursor Skills 索引

### 2.1 Skill 存放位置

| 位置 | 路径 | 适用场景 |
|------|------|----------|
| **仓库内（团队共享）** | `.cursor/skills/<name>/SKILL.md` | 克隆即可被 Cursor 扫描 |
| **个人全局** | `~/.cursor/skills/<name>/SKILL.md` | 个人偏好、跨项目复用 |
| **文档-only** | `docs/engineering/*.md` | 给人读或 Rules 引用；Agent 不自动加载 |

### 2.2 已注册 Project Skills

| Skill | 目录 | 何时使用 |
|-------|------|----------|
| `casual-game-build` | `.cursor/skills/casual-game-build/SKILL.md` | 从零或增量搭建休闲游戏 |

### 2.3 建议个人安装技能

| 场景 | 建议主题 |
|------|----------|
| PR 合并前修 CI | `babysit` |
| 大改动拆多个 PR | `split-to-prs` |
| 数据表 / Dashboard | `canvas` |
| 编写 Hooks / Rules | `create-hook` / `create-rule` |

### 2.4 维护约定

- 新增仓库内 Skill：包含合法 YAML（`name` + `description`），在 §2.2 登记。
- 新增 Cursor Canvas：先转为 `docs/` Markdown，在 §3 登记。
- Skill 正文过长时：`SKILL.md` 保持摘要，权威长文在 `docs/engineering/` 并由 Skill 链接。

---

## 三、Canvas 转换文档索引

### 3.1 已转换文档

| 类别 | 文档 | 来源 Canvas |
|------|------|-------------|
| 全球化 | [全球休闲游戏个性化策略](../domain/DOMAIN_KNOWLEDGE.md#全球休闲游戏个性化策略与调研) | `global-casual-game-research.canvas.tsx` |
| 产品留存 | [玩家生命周期与成熟度运营蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | `player-lifecycle-maturity-ops-blueprint.canvas.tsx` |
| 出块 | [出块建模 §附录](../algorithms/ALGORITHMS_SPAWN.md#十三出块建模双轨实现与设计-rationale) | `candidate-blocks.canvas.tsx` |
| RL | [RL 研究](../algorithms/ALGORITHMS_RL.md#23-rl-研究复杂度瓶颈与文献对照)（§二） | `rl-self-play-literature-comparison.canvas.tsx` |

### 3.2 使用方式

| 场景 | 做法 |
|------|------|
| 阅读稳定结论 | 从表格打开对应 `docs/` Markdown 文档 |
| 追溯来源 | 查看"来源 Canvas"列 |
| 注册文档 | 只把 Markdown 文档加入 `server.py` 的 `_DOC_CATEGORIES` |
